const GAME_SETTINGS = [
    ['song-duration-input', 'songDurationSeconds'], ['rounds-input', 'rounds'],
    ['song-name-points-input', 'songNamePoints'], ['artist-points-input', 'artistPoints'],
    ['release-year-points-input', 'releaseYearPoints']
];
const players = [];

window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('add-player-btn').addEventListener('click', addPlayer);
    document.getElementById('add-player-input').addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); addPlayer(); }
    });
    document.getElementById('playlist-input').addEventListener('input', event => event.target.setCustomValidity(''));
    document.getElementById('game-setup-form').addEventListener('submit', startGame);
});

function addPlayer() {
    const input = document.getElementById('add-player-input');
    const name = input.value.trim();
    if (!name || players.some(player => player.toLowerCase() === name.toLowerCase())) return;
    players.push(name);
    input.value = '';
    document.getElementById('players-error').hidden = true;
    renderPlayers();
    input.focus();
}

function renderPlayers() {
    const list = document.getElementById('setup-player-list');
    list.replaceChildren(...players.map((name, index) => {
        const item = document.createElement('li');
        const label = document.createElement('span');
        const button = document.createElement('button');
        label.textContent = name;
        button.type = 'button';
        button.textContent = 'Remove';
        button.setAttribute('aria-label', `Remove ${name}`);
        button.addEventListener('click', () => { players.splice(index, 1); renderPlayers(); });
        item.append(label, button);
        return item;
    }));
}

function startGame(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    if (players.length === 0) {
        document.getElementById('players-error').hidden = false;
        document.getElementById('add-player-input').focus();
        return;
    }
    const params = new URLSearchParams();
    const playlistInput = document.getElementById('playlist-input');
    const playlistLink = playlistInput.value.trim();
    if (playlistLink) {
        const match = playlistLink.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
        if (!match) {
            playlistInput.setCustomValidity('Enter a valid Spotify playlist link.');
            playlistInput.reportValidity();
            return;
        }
        params.set('playlistId', match[1]);
    }
    players.forEach(player => params.append('player', player));
    GAME_SETTINGS.forEach(([id, name]) => params.set(name, document.getElementById(id).value));
    window.location.href = '/songfy/game?' + params.toString();
}
