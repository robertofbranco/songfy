window.onload = (e) => {
    document.getElementById('start-game-btn').addEventListener('click', startGame);
}

function startGame() {
    const playlistLink = document.getElementById('playlist-input').value;
    if (playlistLink === "") {
         window.location.href = '/songfy/game';
    } else {
        const playlistId = playlistLink.split('https://open.spotify.com/playlist/')[1].split('?')[0];
        // if (playlistId.length === 0) {
        //
        // }

        window.location.href = `/songfy/game?playlistId=${playlistId}`;
    }
}