const roomCode = document.body.dataset.roomCode;
const isHost = document.body.dataset.isHost === 'true';
let roomState;
let hostPlayers = [];
let spotifyPlayer;
let spotifyDeviceId;
let excerptTimer;

document.addEventListener('DOMContentLoaded', async () => {
    bindControls();
    await refreshRoom();
    connectRoomSocket();
    if (isHost) startHostHeartbeat();
});

window.onSpotifyWebPlaybackSDKReady = () => {
    if (isHost) initializeSpotifyPlayer();
};

function bindControls() {
    document.getElementById('add-player-btn')?.addEventListener('click', async () => {
        const input = document.getElementById('add-player-input');
        const player = input.value.trim();
        if (!player || hostPlayers.some(name => name.toLowerCase() === player.toLowerCase())) return;
        hostPlayers.push(player);
        input.value = '';
        renderPlayerLists();
        await saveLobbySettings();
    });
    document.getElementById('host-settings')?.addEventListener('submit', startGame);
    document.getElementById('play-btn')?.addEventListener('click', playSong);
    document.getElementById('reveal-btn')?.addEventListener('click', revealSong);
    document.getElementById('award-form')?.addEventListener('submit', awardPoints);
}

async function refreshRoom() {
    const response = await fetch(`/songfy/api/rooms/${roomCode}`);
    if (response.status === 404) return roomMissing();
    if (!response.ok) return showError('Unable to load this room.');
    renderRoom(await response.json());
}

function connectRoomSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/songfy/ws/rooms/${roomCode}`);
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.type === 'room_state') renderRoom(message.room);
        if (message.type === 'room_expired' || message.type === 'room_closed') roomMissing();
    });
    socket.addEventListener('close', () => {
        if (!document.body.dataset.roomMissing) setTimeout(connectRoomSocket, 2000);
    });
}

function renderRoom(nextState) {
    roomState = nextState;
    const lobby = document.getElementById('lobby');
    const game = document.getElementById('game');
    const finished = document.getElementById('finished');
    lobby.hidden = nextState.status !== 'lobby';
    game.hidden = nextState.status !== 'active';
    finished.hidden = nextState.status !== 'finished';

    if (nextState.status === 'lobby') renderLobby(nextState);
    if (nextState.status === 'active') renderGame(nextState);
    if (nextState.status === 'finished') renderFinished(nextState);
}

function renderLobby(state) {
    document.getElementById('lobby-status').textContent = isHost
        ? 'Configure the game, then share the room code with spectators.'
        : 'Waiting for the host to start the game.';
    const settingsForm = document.getElementById('host-settings');
    settingsForm.hidden = !isHost;
    if (isHost) {
        hostPlayers = [...state.settings.players];
        if (Object.hasOwn(state.settings, 'playlistId')) {
            document.getElementById('playlist-input').value = state.settings.playlistId || '';
        }
        setValue('song-duration-input', state.settings.songDurationSeconds);
        setValue('rounds-input', state.settings.rounds);
        setValue('song-name-points-input', state.settings.songNamePoints);
        setValue('artist-points-input', state.settings.artistPoints);
        setValue('release-year-points-input', state.settings.releaseYearPoints);
    }
    renderPlayerLists();
}

function renderPlayerLists() {
    const players = isHost ? hostPlayers : (roomState?.settings.players || []);
    const hostList = document.getElementById('setup-player-list');
    const spectatorList = document.getElementById('spectator-player-list');
    hostList.replaceChildren(...players.map((player, index) => {
        const item = document.createElement('li');
        item.textContent = player;
        const remove = document.createElement('button');
        remove.type = 'button'; remove.textContent = 'Remove';
        remove.addEventListener('click', async () => { hostPlayers.splice(index, 1); renderPlayerLists(); await saveLobbySettings(); });
        item.append(remove);
        return item;
    }));
    spectatorList.hidden = isHost;
    if (!isHost) spectatorList.replaceChildren(...players.map(player => {
        const item = document.createElement('li'); item.textContent = player; return item;
    }));
}

function renderGame(state) {
    document.getElementById('round-header').textContent =
        `Round ${state.round} of ${state.settings.rounds} — ${state.currentPlayer}'s turn`;
    document.getElementById('playback-status').textContent = playbackLabel(state.playbackStatus);
    document.getElementById('host-controls').hidden = !isHost;
    document.getElementById('play-btn').disabled = !isHost || !['ready', 'done'].includes(state.playbackStatus) || state.revealed;
    document.getElementById('reveal-btn').disabled = !isHost || state.revealed;
    renderScoreboard(state);
    const answer = document.getElementById('answer');
    answer.hidden = !state.revealed;
    if (state.revealed && state.answer) {
        document.getElementById('answer-name').textContent = state.answer.name;
        document.getElementById('answer-artists').textContent = state.answer.artists.join(', ');
        document.getElementById('answer-year').textContent = state.answer.yearReleased;
    }
    document.getElementById('award-form').hidden = !isHost || !state.revealed;
}

function renderScoreboard(state) {
    const scoreboard = document.getElementById('scoreboard');
    scoreboard.replaceChildren(...state.settings.players.map(player => {
        const row = document.createElement('div');
        row.className = `player-container${player === state.currentPlayer ? ' current-player' : ''}`;
        row.textContent = `${player}: ${state.scores[player] ?? 0} points`;
        return row;
    }));
}

function renderFinished(state) {
    const rankings = Object.entries(state.scores).sort(([, left], [, right]) => right - left);
    document.getElementById('rankings-list').replaceChildren(...rankings.map(([player, points]) => {
        const item = document.createElement('li'); item.textContent = `${player}: ${points} points`; return item;
    }));
}

async function startGame(event) {
    event.preventDefault();
    try {
        await hostRequest('PUT', '/settings', settingsPayload());
        await hostRequest('POST', '/start');
    } catch (error) { showError(error.message); }
}

async function saveLobbySettings() {
    try { await hostRequest('PUT', '/settings', settingsPayload()); }
    catch (error) { showError(error.message); }
}

async function playSong() {
    try {
        const state = await hostRequest('POST', '/play');
        const controller = state.controller;
        if (!spotifyPlayer || !spotifyDeviceId || !controller) throw new Error('Spotify player is not ready.');
        await spotifyPlayer.activateElement();
        const token = await spotifyToken();
        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(spotifyDeviceId)}`, {
            method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uris: [controller.trackUri], position_ms: 30000 })
        });
        if (!response.ok) throw new Error('Spotify could not start this track.');
        await hostRequest('POST', '/playback-started');
        clearTimeout(excerptTimer);
        excerptTimer = setTimeout(async () => {
            await spotifyPlayer.pause();
            await hostRequest('POST', '/playback-finished');
        }, controller.songDurationSeconds * 1000);
    } catch (error) {
        await hostRequest('POST', '/playback-finished').catch(() => {});
        showError(error.message);
    }
}

async function revealSong() {
    try {
        clearTimeout(excerptTimer);
        await spotifyPlayer?.pause();
        await hostRequest('POST', '/reveal');
    } catch (error) { showError(error.message); }
}

async function awardPoints(event) {
    event.preventDefault();
    try {
        await hostRequest('POST', '/award', {
            songName: document.getElementById('song-name-check').checked,
            artist: document.getElementById('artist-check').checked,
            releaseYear: document.getElementById('year-check').checked,
        });
        event.currentTarget.reset();
    } catch (error) { showError(error.message); }
}

async function hostRequest(method, suffix, body) {
    const response = await fetch(`/songfy/api/rooms/${roomCode}${suffix}`, {
        method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Room action failed.');
    }
    return response.status === 204 ? undefined : response.json();
}

function settingsPayload() {
    const playlist = document.getElementById('playlist-input').value.trim();
    const match = playlist.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
    if (playlist && !match) throw new Error('Enter a valid Spotify playlist link.');
    return {
        playlistId: match?.[1] || '', players: hostPlayers,
        rounds: numberValue('rounds-input'), songDurationSeconds: numberValue('song-duration-input'),
        songNamePoints: numberValue('song-name-points-input'), artistPoints: numberValue('artist-points-input'),
        releaseYearPoints: numberValue('release-year-points-input'),
    };
}

function initializeSpotifyPlayer() {
    if (spotifyPlayer || !window.Spotify) return;
    spotifyPlayer = new Spotify.Player({ name: `Songfy room ${roomCode}`, volume: 0.8, getOAuthToken: callback => spotifyToken().then(callback) });
    spotifyPlayer.addListener('ready', event => { spotifyDeviceId = event.device_id; });
    spotifyPlayer.addListener('authentication_error', () => showError('Spotify login expired.'));
    spotifyPlayer.connect();
}

async function spotifyToken() {
    const response = await fetch('/songfy/auth/token');
    if (response.status === 401) { window.location.assign(`/songfy/login?next=/songfy/rooms/${roomCode}`); throw new Error('Spotify login expired.'); }
    if (!response.ok) throw new Error('Unable to get a Spotify playback token.');
    return (await response.json()).access_token;
}

function startHostHeartbeat() { setInterval(() => hostRequest('POST', '/heartbeat').catch(() => {}), 300000); }
function playbackLabel(status) { return ({ ready: 'Ready to play', starting: 'Starting…', playing: 'Playing excerpt', done: 'Excerpt complete', revealed: 'Answer revealed' })[status] || status; }
function setValue(id, value) { document.getElementById(id).value = value; }
function numberValue(id) { return Number(document.getElementById(id).value); }
function showError(message) { const error = document.getElementById('room-error'); error.textContent = message; error.hidden = false; }
function roomMissing() { document.body.dataset.roomMissing = 'true'; showError('This room no longer exists. Create or join another room.'); document.getElementById('lobby').hidden = true; document.getElementById('game').hidden = true; }
