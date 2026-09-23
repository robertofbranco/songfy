import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const roomScript = readFileSync('app/static/room.js', 'utf8');
const roomTemplate = readFileSync('app/templates/room.html', 'utf8');
const openDoms = [];

function roomHtml(isHost) {
    return roomTemplate
        .replaceAll('{{ room_code }}', 'ABC234')
        .replaceAll("{{ 'true' if is_host else 'false' }}", String(isHost))
        .replaceAll(
            "{% if not is_host %} hidden{% endif %}",
            isHost ? '' : ' hidden'
        )
        .replace(/\{\{[^}]+\}\}/g, '')
        .replace(/\{%[^%]+%\}/g, '')
        .replace(/<script[\s\S]*?<\/script>/g, '');
}

function loadRoom({ isHost = true } = {}) {
    const dom = new JSDOM(roomHtml(isHost), {
        url: 'http://localhost/songfy/rooms/ABC234',
        runScripts: 'outside-only',
    });
    openDoms.push(dom);
    dom.window.document.body.dataset.roomCode = 'ABC234';
    dom.window.document.body.dataset.isHost = String(isHost);

    let readyListener;
    const addEventListener = dom.window.document.addEventListener.bind(
        dom.window.document
    );
    dom.window.document.addEventListener = (type, listener, options) => {
        if (type === 'DOMContentLoaded') {
            readyListener = listener;
            return;
        }
        addEventListener(type, listener, options);
    };
    dom.window.eval(roomScript);
    dom.window.document.addEventListener = addEventListener;

    return {
        dom,
        runReady: async () => readyListener(),
    };
}

function lobbyState(overrides = {}) {
    return {
        code: 'ABC234',
        isHost: true,
        status: 'lobby',
        settings: {
            playlistId: '',
            players: [],
            rounds: 3,
            songDurationSeconds: 25,
            songNamePoints: 1,
            artistPoints: 2,
            releaseYearPoints: 3,
        },
        round: 1,
        currentPlayer: null,
        scores: {},
        playbackStatus: 'ready',
        revealed: false,
        ...overrides,
    };
}

function activeState(overrides = {}) {
    return lobbyState({
        status: 'active',
        settings: {
            ...lobbyState().settings,
            players: ['Alice', 'Bob'],
        },
        currentPlayer: 'Alice',
        scores: { Alice: 4, Bob: 2 },
        controller: {
            trackUri: 'spotify:track:first',
            songDurationSeconds: 25,
        },
        ...overrides,
    });
}

function response(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    while (openDoms.length) openDoms.pop().window.close();
});

describe('room setup', () => {
    it('shows field-level validation when starting without players', async () => {
        const { dom } = loadRoom();
        const input = dom.window.document.querySelector('#add-player-input');

        await dom.window.startGame({ preventDefault() {} });

        expect(input.classList).toContain('is-invalid');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.validationMessage).toBe('Add at least one player.');
        expect(dom.window.document.querySelector('#room-error').hidden).toBe(true);
    });

    it('builds settings from the real room template and rejects bad links', () => {
        const { dom } = loadRoom();
        dom.window.eval("hostPlayers = ['Alice', 'Roberto']");
        const playlist = dom.window.document.querySelector('#playlist-input');
        playlist.value = 'https://open.spotify.com/playlist/abc123';

        expect(dom.window.settingsPayload()).toEqual({
            playlistId: 'abc123',
            players: ['Alice', 'Roberto'],
            rounds: 10,
            songDurationSeconds: 25,
            songNamePoints: 1,
            artistPoints: 1,
            releaseYearPoints: 1,
        });

        playlist.value = 'https://example.com/not-spotify';
        expect(() => dom.window.settingsPayload()).toThrow(
            'Enter a valid Spotify playlist link.'
        );
    });

    it('wires DOMContentLoaded controls and persists an added player', async () => {
        const { dom, runReady } = loadRoom();
        const requests = [];
        dom.window.fetch = vi.fn(async (url, options = {}) => {
            requests.push([url, options]);
            return response(lobbyState({
                settings: {
                    ...lobbyState().settings,
                    players: ['Alice'],
                },
            }));
        });
        dom.window.setInterval = vi.fn();
        const sockets = [];
        dom.window.WebSocket = class {
            constructor(url) {
                this.url = url;
                this.listeners = {};
                sockets.push(this);
            }
            addEventListener(type, listener) {
                this.listeners[type] = listener;
            }
        };

        await runReady();
        const input = dom.window.document.querySelector('#add-player-input');
        input.value = 'Bob';
        dom.window.document.querySelector('#add-player-btn').click();
        await new Promise(resolve => dom.window.setTimeout(resolve, 0));

        expect(requests[0][0]).toBe('/songfy/api/rooms/ABC234');
        expect(requests[1][1].method).toBe('PUT');
        expect(JSON.parse(requests[1][1].body).players).toEqual(['Alice', 'Bob']);
        expect(sockets[0].url).toBe('ws://localhost/songfy/ws/rooms/ABC234');
        expect(dom.window.setInterval).toHaveBeenCalledOnce();
    });

    it('saves settings before starting and restores the button after failure', async () => {
        const { dom } = loadRoom();
        dom.window.eval("hostPlayers = ['Alice']");
        const calls = [];
        dom.window.fetch = vi.fn(async (url, options) => {
            calls.push([url, options]);
            if (calls.length === 1) return response(lobbyState());
            return response({ detail: 'Playlist is unavailable.' }, 422);
        });

        await dom.window.startGame({ preventDefault() {} });

        expect(calls.map(([, options]) => options.method)).toEqual(['PUT', 'POST']);
        expect(dom.window.document.querySelector('#start-game-btn').disabled).toBe(false);
        expect(dom.window.document.querySelector('#room-error').textContent)
            .toBe('Playlist is unavailable.');
    });
});

describe('live room rendering', () => {
    it('renders active scores and reveals an answer for the host', () => {
        const { dom } = loadRoom();
        dom.window.renderRoom(activeState({
            revealed: true,
            playbackStatus: 'revealed',
            answer: {
                name: 'A Song',
                artists: ['First Artist', 'Guest'],
                yearReleased: '2004',
            },
        }));

        const document = dom.window.document;
        expect(document.querySelector('#game').hidden).toBe(false);
        expect(document.querySelector('#answer').hidden).toBe(false);
        expect(document.querySelector('#answer-name').textContent).toBe('A Song');
        expect(document.querySelector('#answer-artists').textContent)
            .toBe('First Artist, Guest');
        expect(document.querySelector('.current-player').textContent)
            .toContain('Alice: 4 points');
        expect(document.querySelector('#award-form').hidden).toBe(false);
    });

    it('keeps host controls hidden in the spectator view', () => {
        const { dom } = loadRoom({ isHost: false });

        dom.window.renderRoom(activeState({ isHost: false, controller: undefined }));

        expect(dom.window.document.querySelector('#host-controls').hidden).toBe(true);
        expect(dom.window.document.querySelector('#award-form').hidden).toBe(true);
        expect(dom.window.document.querySelectorAll('#scoreboard .player-container'))
            .toHaveLength(2);
    });

    it('renders final rankings in score order', () => {
        const { dom } = loadRoom();

        dom.window.renderRoom(activeState({
            status: 'finished',
            currentPlayer: null,
            scores: { Alice: 2, Bob: 7 },
        }));

        const rankings = [...dom.window.document.querySelectorAll('#rankings-list li')]
            .map(item => item.textContent);
        expect(rankings).toEqual(['Bob: 7 points', 'Alice: 2 points']);
    });

    it('applies WebSocket room updates and handles room closure', async () => {
        const { dom, runReady } = loadRoom({ isHost: false });
        dom.window.fetch = vi.fn(async () => response(lobbyState({ isHost: false })));
        let socket;
        dom.window.WebSocket = class {
            constructor() {
                socket = this;
                this.listeners = {};
            }
            addEventListener(type, listener) {
                this.listeners[type] = listener;
            }
        };
        await runReady();

        socket.listeners.message({
            data: JSON.stringify({
                type: 'room_state',
                room: activeState({ isHost: false, controller: undefined }),
            }),
        });
        expect(dom.window.document.querySelector('#game').hidden).toBe(false);
        expect(dom.window.document.querySelector('#round-header').textContent)
            .toContain("Alice's turn");

        socket.listeners.message({ data: JSON.stringify({ type: 'room_closed' }) });
        expect(dom.window.document.body.dataset.roomMissing).toBe('true');
        expect(dom.window.document.querySelector('#game').hidden).toBe(true);
        expect(dom.window.document.querySelector('#room-error').textContent)
            .toContain('no longer exists');
    });
});

describe('host game actions', () => {
    it('starts Spotify playback at 30 seconds and confirms playback state', async () => {
        const { dom } = loadRoom();
        const requests = [];
        dom.window.fetch = vi.fn(async (url, options = {}) => {
            requests.push([String(url), options]);
            if (String(url).endsWith('/play')) return response(activeState({ playbackStatus: 'starting' }));
            if (url === '/songfy/auth/token') return response({ access_token: 'token' });
            return response({}, String(url).startsWith('https://api.spotify.com') ? 204 : 200);
        });
        dom.window.setTimeout = vi.fn();
        let player;
        dom.window.Spotify = {
            Player: class {
                constructor() {
                    player = this;
                    this.listeners = {};
                }
                addListener(type, listener) {
                    this.listeners[type] = listener;
                }
                connect() {
                    return Promise.resolve(true);
                }
                async activateElement() {}
                async pause() {}
            },
        };
        dom.window.initializeSpotifyPlayer();
        player.listeners.ready({ device_id: 'browser-device' });

        await dom.window.playSong();

        const spotifyRequest = requests.find(([url]) => url.startsWith('https://api.spotify.com'));
        expect(spotifyRequest[0]).toContain('device_id=browser-device');
        expect(spotifyRequest[1].headers.Authorization).toBe('Bearer token');
        expect(JSON.parse(spotifyRequest[1].body)).toEqual({
            uris: ['spotify:track:first'],
            position_ms: 30000,
        });
        expect(requests.some(([url]) => url.endsWith('/playback-started'))).toBe(true);
    });

    it('submits selected award categories and resets the form', async () => {
        const { dom } = loadRoom();
        const form = dom.window.document.querySelector('#award-form');
        dom.window.document.querySelector('#song-name-check').checked = true;
        dom.window.document.querySelector('#year-check').checked = true;
        dom.window.fetch = vi.fn(async () => response(activeState()));

        await dom.window.awardPoints({ preventDefault() {}, currentTarget: form });

        const [, options] = dom.window.fetch.mock.calls[0];
        expect(JSON.parse(options.body)).toEqual({
            songName: true,
            artist: false,
            releaseYear: true,
        });
        expect(dom.window.document.querySelector('#song-name-check').checked).toBe(false);
        expect(dom.window.document.querySelector('#year-check').checked).toBe(false);
    });
});
