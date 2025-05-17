/*
Non-priority:
    Set playlist by spotify link through html
    Store in DB sets of songs to be selected, e.g., 2000s, Classic Rock, Brazilian Funk, Top Streamed etc.
    Backend store current game data
    Confirmation dialog bf removing player
    Animation to increment points?
    Allow multiple rooms/matches to be created
*/

let iFrameApi;
let players = [];
let currentPlayer = 0;

window.onload = (e) => {
    document.getElementById('add-player-btn').addEventListener('click', addPlayer);
    document.getElementById('confirmButton').addEventListener('click', finishPlayerTurn);
}

window.onSpotifyIframeApiReady = (IFrameAPI) => {
    iFrameApi = IFrameAPI;
    start();
};

async function start() {
    let counter = 0;
    let songs = shuffle((await getSongs()).filter(s => !s.yearReleased.includes('2025')));
    let currentSong = songs[counter];
    let cancelChange = false;

    const element = document.getElementById('embed-iframe');
    const options = {
        width: '0',
        height: '0',
        uri: `spotify:track:${currentSong['id']}`
    };
    const callback = (EmbedController) => {
        document.getElementById('playBtn').addEventListener('click', () => {
            cancelChange = false;
            EmbedController.resume();
            togglePlayBtn(false);
            setTimeout(() => {
                if (!cancelChange) {
                    EmbedController.pause();
                    document.getElementById('playBtn').innerText = "Done"
                }
            }, 25000);
        });

        document.getElementById('nextBtn')
            .addEventListener('click', () => {
                cancelChange = true;
                document.getElementById('nameSpan').innerText = currentSong.name;
                document.getElementById('artistsSpan').innerText = currentSong.artists.join(', ');
                document.getElementById('releaseSpan').innerText = currentSong.yearReleased;
                counter++;
                currentSong = songs[counter];
                EmbedController.loadUri(`spotify:track:${currentSong['id']}`, false, 30);
                EmbedController.pause();
                toggleDisplayedContainer();
            });
    };
    iFrameApi.createController(element, options, callback);
}

function togglePlayBtn(state) {
    let playBtn = document.getElementById('playBtn');
    playBtn.disabled = !state;

    if (playBtn.disabled) {
        playBtn.innerText = "Playing..."
    } else {
        playBtn.innerText = "Play"
    }
}

async function getSongs() {
    let response = await fetch('http://192.168.100.5:8000/songfy/get-songs')
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
}

function toggleDisplayedContainer() {
    let infoContainer = document.getElementById('infoContainer');
    let btnContainer = document.getElementById('buttonContainer');

    if (infoContainer.hidden) {
        btnContainer.classList.remove('button-container');
        infoContainer.classList.add('info-container');
        infoContainer.hidden = false
        btnContainer.hidden = true
    } else {
        togglePlayBtn(true);
        infoContainer.hidden = true;
        btnContainer.hidden = false;
        infoContainer.classList.remove('info-container');
        btnContainer.classList.add('button-container');
    }
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1)); // random index from 0 to i
        [array[i], array[j]] = [array[j], array[i]];   // swap elements
    }
    return array;
}

function addPlayer() {
    const playerNameInput = document.getElementById('add-player-input');
    const playerName = playerNameInput.value;
    if (playerName.length === 0) {
        // Print error msg
        return;
    }

    const playerElement = document.createElement('div');
    const playerElementHtml = '<div>' +
        `                  <span class="value">${playerName}</span>` +
        '                  <span>has</span>' +
        '                  <span class="value"><span class="points">0</span> points</span>' +
        '              </div>';
    const deleteBtn = document.createElement('button');
    const playersContainer = document.getElementsByClassName('players-container')[0];
    const addPlayerContainer = document.getElementsByClassName('add-player-container')[0];
    deleteBtn.innerText = 'X';
    deleteBtn.addEventListener('click', deletePlayer);

    playerElement.classList.add('player-container');
    playerElement.innerHTML = playerElementHtml;
    playerElement.appendChild(deleteBtn);

    playersContainer.insertBefore(playerElement, addPlayerContainer);

    if (playersContainer.children.length === 2) {
        playerElement.classList.add('current-player');
    }

    playerNameInput.value = '';
    players.push(playerName);
}

function deletePlayer(event) {
    const playerElement = event.target.parentElement;
    const playerIndex = Array.from(playerElement.parentElement.children).indexOf(playerElement);
    let changeCurrentPlayer = playerElement.classList.contains('current-player');
    playerElement.remove();

    if (changeCurrentPlayer) {
        const playersContainer = document.getElementsByClassName('players-container')[0];
        playersContainer.children[0].classList.add('current-player');
    }

    players.splice(Number(playerIndex), 1);
}

function finishPlayerTurn() {
    if (players.length === 0) {
        toggleDisplayedContainer();
    }

    const songNameCheckbox = document.getElementById('songNameCheckbox');
    const artistsCheckbox = document.getElementById('artistsCheckbox');
    const releaseDateCheckbox = document.getElementById('releaseDateCheckbox');
    const checkboxes = [songNameCheckbox, artistsCheckbox, releaseDateCheckbox];
    const pointsToAdd = checkboxes.filter(c => c.checked).length;

    const playersContainer = document.getElementsByClassName('players-container')[0];
    const playerElement = document.getElementsByClassName('current-player')[0];
    const playerPointsElement = playerElement.getElementsByClassName('points')[0];
    let playerPoints = Number(playerPointsElement.innerText);
    playerPoints += pointsToAdd;

    playerPointsElement.innerText = playerPoints;
    playerElement.classList.remove('current-player');
    currentPlayer = currentPlayer === players.length - 1 ? 0 : currentPlayer + 1;

    playersContainer.children[currentPlayer].classList.add('current-player');
    toggleDisplayedContainer();
    checkboxes.map(c => c.checked = false);
}
