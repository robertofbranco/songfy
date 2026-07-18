const GAME_SETTINGS = [
    ['song-duration-input', 'songDurationSeconds'],
    ['song-name-points-input', 'songNamePoints'],
    ['artist-points-input', 'artistPoints'],
    ['release-year-points-input', 'releaseYearPoints']
];

window.addEventListener('DOMContentLoaded', () => {
    document
        .getElementById('start-game-btn')
        .addEventListener('click', startGame);
});

function startGame() {
    const playlistLink =
        document.getElementById('playlist-input').value.trim();

    const gameParams = new URLSearchParams();

    if (playlistLink) {
        const playlistId = playlistLink
            .split('https://open.spotify.com/playlist/')[1]
            ?.split('?')[0];

        if (playlistId) {
            gameParams.set('playlistId', playlistId);
        }
    }

    GAME_SETTINGS.forEach(([inputId, parameterName]) => {
        gameParams.set(
            parameterName,
            document.getElementById(inputId).value
        );
    });

    window.location.href =
        '/songfy/game?' + gameParams.toString();
}
