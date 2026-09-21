/*
Non-priority:
    Set playlist by Spotify link through HTML
    Store in DB sets of songs to be selected, e.g., 2000s, Classic Rock,
    Brazilian Funk, Top Streamed etc.
    Backend store current game data
    Confirmation dialog before removing player
    Animation to increment points?
    Allow multiple rooms/matches to be created
*/

const SONGS_API_PATH = '/songfy/get-songs';
const SONG_START_POSITION_MS = 30_000;

const params = new URLSearchParams(window.location.search);
const playlistId = params.get('playlistId') ?? '';
const players = params.getAll('player').map(name => name.trim()).filter(Boolean);
const NUMBER_OF_ROUNDS = getIntegerSetting('rounds', 10, 1, 100);

const SONG_PLAYBACK_DURATION_MS =
    getIntegerSetting('songDurationSeconds', 25, 1, 300) * 1_000;

const SONG_NAME_POINTS =
    getIntegerSetting('songNamePoints', 1, 0, 100);

const ARTIST_POINTS =
    getIntegerSetting('artistPoints', 1, 0, 100);

const RELEASE_YEAR_POINTS =
    getIntegerSetting('releaseYearPoints', 1, 0, 100);

let currentPlayer = 0;
let currentRound = 1;

let domReady = false;
let spotifyReady = false;
let gameStarted = false;
let finalTurnPending = false;
let resultMessageTimeoutId;

document.addEventListener('DOMContentLoaded', () => {
    domReady = true;

    if (players.length === 0) {
        window.location.replace('/songfy/?playersRequired=1');
        return;
    }

    renderScoreboard();
    renderRoundHeader();
    renderConfiguredPoints();

    document
        .getElementById('confirmButton')
        .addEventListener('click', finishPlayerTurn);

    tryStart();
});

window.onSpotifyWebPlaybackSDKReady = () => {
    spotifyReady = true;

    tryStart();
};

function tryStart() {
    if (!domReady || !spotifyReady || gameStarted) {
        return;
    }

    gameStarted = true;
    start();
}

async function start() {
    try {
        let counter = 0;
        let timeoutId;
        let deviceId;
        let waitingForPlaybackStart = false;
        let currentSongPlayed = false;
        let gameFinished = false;

        const songs = await getSongs();

        if (songs.length === 0) {
            throw new Error('No songs were returned for this playlist.');
        }

        let currentSong = songs[counter];
        const playButton = document.getElementById('playBtn');
        const nextButton = document.getElementById('nextBtn');
        const player = new Spotify.Player({
            name: 'Songfy',
            getOAuthToken: callback => {
                getSpotifyAccessToken().then(callback).catch(handleAuthError);
            },
            volume: 0.8
        });

        player.addListener('ready', event => {
            deviceId = event.device_id;
            finishSongLoading();
            togglePlayBtn(true);
        });

        player.addListener('not_ready', () => {
            deviceId = undefined;
            togglePlayBtn(false, 'Spotify disconnected');
        });

        for (const eventName of [
            'initialization_error',
            'authentication_error',
            'account_error',
            'playback_error'
        ]) {
            player.addListener(eventName, event => {
                console.error(`Spotify ${eventName}:`, event.message);
                togglePlayBtn(false, 'Spotify unavailable');
            });
        }

        player.addListener('player_state_changed', state => {
            const expectedSongUri = `spotify:track:${currentSong.id}`;

            if (
                !state ||
                !waitingForPlaybackStart ||
                state.paused ||
                state.track_window.current_track.uri !== expectedSongUri
            ) {
                return;
            }

            waitingForPlaybackStart = false;
            currentSongPlayed = true;
            clearPlaybackTimeout();
            togglePlayBtn(false, 'Playing...');

            timeoutId = setTimeout(async () => {
                await player.pause();
                playButton.innerText = 'Done';
            }, SONG_PLAYBACK_DURATION_MS);
        });

        playButton.addEventListener('click', async () => {
            if (
                !deviceId ||
                waitingForPlaybackStart ||
                currentSongPlayed ||
                gameFinished
            ) {
                return;
            }

            clearPlaybackTimeout();
            waitingForPlaybackStart = true;
            togglePlayBtn(false, 'Starting...');

            try {
                await player.activateElement();
                await startSpotifyPlayback(
                    deviceId,
                    `spotify:track:${currentSong.id}`
                );
            } catch (error) {
                console.error('Failed to start Spotify playback:', error);
                waitingForPlaybackStart = false;
                togglePlayBtn(true, undefined, 'Retry');
            }
        });

        nextButton.addEventListener('click', async () => {
            clearPlaybackTimeout();
            waitingForPlaybackStart = false;
            currentSongPlayed = false;
            await player.pause();

            document.getElementById('nameSpan').innerText = currentSong.name;
            document.getElementById('artistsSpan').innerText =
                currentSong.artists.join(', ');
            document.getElementById('releaseSpan').innerText =
                currentSong.yearReleased;

            counter++;

            if (counter >= songs.length) {
                gameFinished = true;
                finalTurnPending = true;
                togglePlayBtn(false, 'No more songs');
                nextButton.disabled = true;
                toggleDisplayedContainer();
                return;
            }

            currentSong = songs[counter];
            togglePlayBtn(true);
            toggleDisplayedContainer();
        });

        function clearPlaybackTimeout() {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = undefined;
            }
        }

        const connected = await player.connect();

        if (!connected) {
            throw new Error('Spotify Web Playback SDK could not connect.');
        }
    } catch (error) {
        console.error('Failed to start the game:', error);
        finishSongLoading(false);

        const playButton = document.getElementById('playBtn');

        if (playButton) {
            playButton.disabled = true;
            playButton.innerText = 'Unable to load songs';
        }
    }
}

function finishSongLoading(enableControls = true) {
    document.getElementById('gameLoader').hidden = true;
    document.getElementById('gameContent').hidden = false;

    if (enableControls) {
        document.getElementById('nextBtn').disabled = false;
        document.getElementById('confirmButton').disabled = false;
    }
}

function togglePlayBtn(
    enabled,
    disabledText = 'Playing...',
    enabledText = 'Play'
) {
    const playBtn = document.getElementById('playBtn');

    playBtn.disabled = !enabled;
    playBtn.innerText = enabled ? enabledText : disabledText;
}

async function getSpotifyAccessToken() {
    const response = await fetch('/songfy/auth/token');

    if (response.status === 401) {
        window.location.replace('/songfy/login');
        throw new Error('Spotify login expired.');
    }

    if (!response.ok) {
        throw new Error(`Spotify token request failed: ${response.status}`);
    }

    return (await response.json()).access_token;
}

async function startSpotifyPlayback(deviceId, songUri) {
    const accessToken = await getSpotifyAccessToken();
    const response = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
        {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uris: [songUri],
                position_ms: SONG_START_POSITION_MS
            })
        }
    );

    if (!response.ok) {
        throw new Error(`Spotify playback failed: ${response.status}`);
    }
}

function handleAuthError(error) {
    console.error('Spotify authentication failed:', error);
    window.location.replace('/songfy/login');
}

async function getSongs() {
    const url = new URL(SONGS_API_PATH, window.location.origin);

    url.searchParams.set(
        'songCount',
        players.length * NUMBER_OF_ROUNDS
    );

    if (playlistId) {
        url.searchParams.set('playlistId', playlistId);
    }

    const response = await fetch(url, {
        headers: {
            Accept: 'application/json'
        }
    });

    if (!response.ok) {
        const responseBody = await response.text();

        throw new Error(
            `Failed to load songs: ${response.status} ` +
            `${response.statusText}. ${responseBody}`
        );
    }

    return response.json();
}

function toggleDisplayedContainer() {
    const infoContainer = document.getElementById('infoContainer');
    const btnContainer = document.getElementById('buttonContainer');

    if (infoContainer.hidden) {
        btnContainer.classList.remove('button-container');
        infoContainer.classList.add('info-container');

        infoContainer.hidden = false;
        btnContainer.hidden = true;
    } else {
        infoContainer.hidden = true;
        btnContainer.hidden = false;

        infoContainer.classList.remove('info-container');
        btnContainer.classList.add('button-container');
    }
}

function renderScoreboard() {
    const container = document.querySelector(".players-container");
    players.forEach((playerName, index) => {
        const playerElement = document.createElement("div");
        const name = document.createElement("span");
        const score = document.createElement("span");
        const points = document.createElement("span");
        playerElement.className = "player-container";
        if (index === 0) playerElement.classList.add("current-player");
        name.className = "value";
        name.textContent = playerName;
        points.className = "points";
        points.textContent = "0";
        score.append(points, " points");
        playerElement.append(name, score);
        container.appendChild(playerElement);
    });
}

function renderConfiguredPoints() {
    document.getElementById('songNamePointsLabel').textContent =
        `(+${SONG_NAME_POINTS})`;
    document.getElementById('artistPointsLabel').textContent =
        `(+${ARTIST_POINTS})`;
    document.getElementById('releaseYearPointsLabel').textContent =
        `(+${RELEASE_YEAR_POINTS})`;
}

function renderRoundHeader() {
    document.getElementById("roundHeader").textContent =
        `Round ${currentRound} of ${NUMBER_OF_ROUNDS} — ` +
        `${players[currentPlayer]}’s turn.`;
}

function finishPlayerTurn() {
    if (players.length === 0) {
        toggleDisplayedContainer();
        return;
    }

    const songNameCheckbox =
        document.getElementById('songNameCheckbox');

    const artistsCheckbox =
        document.getElementById('artistsCheckbox');

    const releaseDateCheckbox =
        document.getElementById('releaseDateCheckbox');

    const checkboxes = [
        songNameCheckbox,
        artistsCheckbox,
        releaseDateCheckbox
    ];

    const pointValues = [
        SONG_NAME_POINTS,
        ARTIST_POINTS,
        RELEASE_YEAR_POINTS
    ];

    const pointsToAdd = checkboxes.reduce(
        (total, checkbox, index) =>
            total + (checkbox.checked ? pointValues[index] : 0),
        0
    );

    const playerElement =
        document.getElementsByClassName('current-player')[0];

    if (!playerElement) {
        return;
    }

    const playerPointsElement =
        playerElement.getElementsByClassName('points')[0];

    const playerPoints =
        Number(playerPointsElement.innerText) + pointsToAdd;

    playerPointsElement.innerText = playerPoints;
    showResultMessage(players[currentPlayer], pointsToAdd);

    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });

    if (finalTurnPending) {
        showEndGame();
        return;
    }

    playerElement.classList.remove('current-player');

    if (currentPlayer === players.length - 1) {
        currentPlayer = 0;
        currentRound++;
    } else {
        currentPlayer++;
    }

    const playerElements = document.querySelectorAll(
        '.players-container > .player-container'
    );

    playerElements[currentPlayer]
        .classList.add('current-player');

    renderRoundHeader();

    toggleDisplayedContainer();

}

function showResultMessage(playerName, points) {
    const resultMessage = document.getElementById('resultMessage');
    clearTimeout(resultMessageTimeoutId);
    resultMessage.textContent = `${playerName} earned ${points} points.`;
    resultMessage.hidden = false;
    resultMessageTimeoutId = setTimeout(() => {
        resultMessage.hidden = true;
    }, 2500);
}

function showEndGame() {
    const rankedPlayers = Array.from(
        document.querySelectorAll('.player-container'),
        (playerElement, position) => ({
            position,
            name: playerElement.querySelector('.value').textContent,
            points: Number(playerElement.querySelector('.points').textContent)
        })
    ).sort((first, second) =>
        second.points - first.points || first.position - second.position
    );

    const rankingsList = document.getElementById('rankingsList');
    rankingsList.replaceChildren(...rankedPlayers.map((player, index) => {
        const item = document.createElement('li');
        const position = document.createElement('span');
        const name = document.createElement('span');
        const total = document.createElement('span');
        item.className = 'ranking-item';
        if (index === 0) {
            item.classList.add('ranking-winner');
        }
        position.className = 'ranking-position';
        position.textContent = index === 0 ? '🏆' : `#${index + 1}`;
        position.setAttribute('aria-label', `Place ${index + 1}`);
        name.className = 'ranking-player';
        name.textContent = player.name;
        total.className = 'ranking-points';
        total.textContent = `${player.points} points`;
        item.append(position, name, total);
        return item;
    }));

    clearTimeout(resultMessageTimeoutId);
    document.getElementById('gameplayContainer').hidden = true;
    document.getElementById('endGameContainer').hidden = false;
}

function getIntegerSetting(name, defaultValue, minimum, maximum) {
    const rawValue = params.get(name);

    if (rawValue === null || rawValue.trim() === '') {
        return defaultValue;
    }

    const value = Number(rawValue);

    if (
        !Number.isInteger(value) ||
        value < minimum ||
        value > maximum
    ) {
        return defaultValue;
    }

    return value;
}
