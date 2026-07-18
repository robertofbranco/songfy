/*
Non-priority:
    Set playlist by Spotify link through HTML
    Store in DB sets of songs to be selected, e.g., 2000s, Classic Rock, Brazilian Funk, Top Streamed etc.
    Backend store current game data
    Confirmation dialog before removing player
    Animation to increment points?
    Allow multiple rooms/matches to be created
*/

const SONGS_API_PATH = '/songfy/get-songs';
const params = new URLSearchParams(window.location.search);
const playlistId = params.get('playlistId') ?? '';

let iFrameApi;
let players = [];
let currentPlayer = 0;

window.onload = () => {
    document
        .getElementById('add-player-btn')
        .addEventListener('click', addPlayer);

    document
        .getElementById('confirmButton')
        .addEventListener('click', finishPlayerTurn);
};

window.onSpotifyIframeApiReady =