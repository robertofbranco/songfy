# Songfy

Songfy is a couch multiplayer music-guessing game powered by Spotify playlists.
Players listen to a song excerpt and earn configurable points for identifying the
song name, artist, and release year.

Live app: https://playlist-fperg0hccngddwep.polandcentral-01.azurewebsites.net/songfy/

## Playing the game

1. Sign in with a Spotify Premium account when prompted.
2. Optionally paste a Spotify playlist link. Leaving it blank uses the default playlist.
3. Add every player taking part.
4. Optionally configure the song duration, number of rounds, and points awarded for each answer.
5. Select **Start game**.
6. Follow the round header to see whose turn it is, then select **Play** to hear the excerpt, starting 30 seconds into the track.
7. Select **Reveal answer**, mark each correct answer, and select **Award points**.

The scoreboard highlights the current player and a brief message reports the points
earned after every turn. When all rounds are complete, Songfy displays the final
rankings and each player's total points. Select **Play again** to return to game setup.

## Run locally

Requirements:

- Python 3
- Spotify API credentials

Create a `.env` file containing:

```dotenv
CLIENT_ID=your_spotify_client_id
CLIENT_SECRET=your_spotify_client_secret
REDIRECT_URI=http://127.0.0.1:8000/songfy/auth/callback
SESSION_SECRET=a-long-random-secret
```

Add that exact redirect URI to the allowlist for your app in the Spotify
Developer Dashboard. For Azure, use the deployed HTTPS callback URL instead
and set `ENVIRONMENT=production` so the login session cookie is HTTPS-only.

Install the application dependencies and start the server:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000/songfy/.

## Tests

Install the backend and frontend test dependencies:

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
npm install
```

Run both suites:

```bash
.venv/bin/python -m pytest
npm test
```

The backend suite tests Spotify playlist mapping, duplicate removal, and playlist
selection in the API. The frontend suite tests settings validation, configured point
labels, scoring and turn progression, result messages, final rankings, and shuffling.
