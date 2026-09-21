document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('create-room-btn')?.addEventListener('click', createRoom);
    document.getElementById('join-room-form').addEventListener('submit', joinRoom);
});

async function createRoom() {
    const error = document.getElementById('create-room-error');
    try {
        const response = await fetch('/songfy/api/rooms', { method: 'POST' });
        if (response.status === 401) {
            window.location.assign('/songfy/login?next=/songfy/');
            return;
        }
        if (!response.ok) throw new Error('Unable to create room.');
        window.location.assign((await response.json()).url);
    } catch (requestError) {
        error.textContent = requestError.message;
        error.hidden = false;
    }
}

function joinRoom(event) {
    event.preventDefault();
    const input = document.getElementById('room-code-input');
    const code = input.value.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) {
        input.setCustomValidity('Enter a valid six-character room code.');
        input.reportValidity();
        return;
    }
    window.location.assign(`/songfy/join?code=${encodeURIComponent(code)}`);
}
