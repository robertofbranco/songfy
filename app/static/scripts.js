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

let iFrameApi;
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

window.onSpotifyIframeApiReady = IFrameAPI => {
    iFrameApi = IFrameAPI;
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
        let expectedSongUri;
        let embedReady = false;
        let waitingForPlaybackStart = false;
        let currentSongPlayed = false;
        let gameFinished = false;
        let entityLoadFallbackId;
        let playbackStartWatchdogId;
        let pendingPlayRetryId;
        let currentEntityReady = false;

        const songs = await getSongs();

        if (songs.length === 0) {
            throw new Error('No songs were returned for this playlist.');
        }

        finishSongLoading();

        let currentSong = songs[counter];

        const element = document.getElementById('embed-iframe');
        const options = {
            width: '0',
            height: '0',
            uri: `spotify:track:${currentSong.id}`
        };

        const callback = EmbedController => {
            const playButton = document.getElementById('playBtn');
            const nextButton = document.getElementById('nextBtn');

            expectedSongUri = `spotify:track:${currentSong.id}`;
            togglePlayBtn(false, 'Loading...');

            EmbedController.addListener('ready', () => {
                embedReady = true;
                markEntityReady(expectedSongUri);
            });

            EmbedController.addListener('playback_update', event => {
                if (event.data?.playingURI === expectedSongUri) {
                    markEntityReady(expectedSongUri);
                }
            });

            EmbedController.addListener(
                'playback_started',
                event => {
                    const playback = event.data;

                    if (
                        !waitingForPlaybackStart ||
                        playback?.playingURI !== expectedSongUri
                    ) {
                        return;
                    }

                    waitingForPlaybackStart = false;
                    currentSongPlayed = true;
                    clearPendingPlayTimers();
                    clearPlaybackTimeout();
                    togglePlayBtn(false, 'Playing...');

                    timeoutId = setTimeout(() => {
                        EmbedController.pause();
                        playButton.innerText = 'Done';
                    }, SONG_PLAYBACK_DURATION_MS);
                }
            );

            playButton.addEventListener('click', () => {
                if (
                    !embedReady ||
                    !currentEntityReady ||
                    waitingForPlaybackStart ||
                    currentSongPlayed ||
                    gameFinished
                ) {
                    return;
                }

                clearPlaybackTimeout();
                clearPendingPlayTimers();

                waitingForPlaybackStart = true;
                togglePlayBtn(false, 'Starting...');

                attemptPlayback();
            });

            nextButton.addEventListener('click', () => {
                clearPlaybackTimeout();
                clearEntityLoadTimer();
                clearPendingPlayTimers();

                waitingForPlaybackStart = false;
                currentSongPlayed = false;

                EmbedController.pause();

                document.getElementById('nameSpan').innerText =
                    currentSong.name;

                document.getElementById('artistsSpan').innerText =
                    currentSong.artists.join(', ');

                document.getElementById('releaseSpan').innerText =
                    currentSong.yearReleased;

                counter++;

                if (counter >= songs.length) {
                    gameFinished = true;
                    finalTurnPending = true;
                    expectedSongUri = undefined;
                    togglePlayBtn(false, 'No more songs');
                    nextButton.disabled = true;
                    toggleDisplayedContainer();
                    return;
                }

                currentSong = songs[counter];
                expectedSongUri = `spotify:track:${currentSong.id}`;
                beginEntityLoading(expectedSongUri);

                EmbedController.loadEntity(
                    expectedSongUri,
                    false,
                    30
                );

                toggleDisplayedContainer();
            });

            function clearEntityLoadTimer() {
                if (entityLoadFallbackId) {
                    clearTimeout(entityLoadFallbackId);
                    entityLoadFallbackId = undefined;
                }
            }

            function clearPendingPlayTimers() {
                if (pendingPlayRetryId) {
                    clearTimeout(pendingPlayRetryId);
                    pendingPlayRetryId = undefined;
                }

                if (playbackStartWatchdogId) {
                    clearTimeout(playbackStartWatchdogId);
                    playbackStartWatchdogId = undefined;
                }
            }

            function markEntityReady(songUri) {
                if (songUri !== expectedSongUri || gameFinished) {
                    return;
                }

                clearEntityLoadTimer();
                currentEntityReady = true;

                if (!waitingForPlaybackStart && !currentSongPlayed) {
                    togglePlayBtn(true);
                }
            }

            function beginEntityLoading(songUri) {
                clearEntityLoadTimer();
                clearPendingPlayTimers();
                currentEntityReady = false;
                togglePlayBtn(false, 'Loading...');

                entityLoadFallbackId = setTimeout(() => {
                    markEntityReady(songUri);
                }, 1_500);
            }

            function attemptPlayback() {
                const songUri = expectedSongUri;

                EmbedController.play();

                pendingPlayRetryId = setTimeout(() => {
                    if (
                        waitingForPlaybackStart &&
                        !currentSongPlayed &&
                        songUri === expectedSongUri
                    ) {
                        EmbedController.play();
                    }
                }, 1_500);

                playbackStartWatchdogId = setTimeout(() => {
                    if (
                        waitingForPlaybackStart &&
                        !currentSongPlayed &&
                        songUri === expectedSongUri
                    ) {
                        waitingForPlaybackStart = false;
                        clearPendingPlayTimers();
                        togglePlayBtn(true);
                    }
                }, 6_000);
            }

            function clearPlaybackTimeout() {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = undefined;
                }
            }
        };

        iFrameApi.createController(element, options, callback);
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

function togglePlayBtn(enabled, disabledText = 'Playing...') {
    const playBtn = document.getElementById('playBtn');

    playBtn.disabled = !enabled;
    playBtn.innerText = enabled ? 'Play' : disabledText;
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
