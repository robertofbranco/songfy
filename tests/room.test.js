import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

const roomScript = readFileSync('app/static/room.js', 'utf8');

function loadRoom() {
    const dom = new JSDOM(`
        <body data-room-code="ABC234" data-is-host="true">
        <p id="room-error" hidden></p><section id="lobby"></section><section id="game"></section>
        <form id="host-settings"></form><button id="add-player-btn"></button><button id="play-btn"></button><button id="reveal-btn"></button><form id="award-form"></form>
        <input id="playlist-input"><input id="rounds-input" value="3"><input id="song-duration-input" value="25"><input id="song-name-points-input" value="1"><input id="artist-points-input" value="2"><input id="release-year-points-input" value="3">
        <input id="add-player-input"><ul id="setup-player-list"></ul><ul id="spectator-player-list"></ul>
        </body>`, { url: 'http://localhost/songfy/rooms/ABC234', runScripts: 'outside-only' });
    dom.window.eval(roomScript);
    return dom;
}

describe('room setup', () => {
    it('converts a Spotify playlist link into the room configuration', () => {
        const dom = loadRoom();
        dom.window.eval("hostPlayers = ['Alice', 'Roberto']");
        dom.window.document.querySelector('#playlist-input').value =
            'https://open.spotify.com/playlist/abc123';

        expect(dom.window.settingsPayload()).toEqual({
            playlistId: 'abc123', players: ['Alice', 'Roberto'], rounds: 3,
            songDurationSeconds: 25, songNamePoints: 1, artistPoints: 2,
            releaseYearPoints: 3,
        });
    });
});
