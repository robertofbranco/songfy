# Songfy

Songfy is a couch multiplayer music-guessing game powered by Spotify playlists.
Players listen to a song excerpt and earn configurable points for identifying the
song name, artist, and release year.

Live app: https://playlist-fperg0hccngddwep.polandcentral-01.azurewebsites.net/songfy/

## Playing the game

1. Sign in with a Spotify Premium account, then create a room and share its code.
2. Spectators can join anonymously with the code and see live game information.
3. The host configures the playlist, players, duration, rounds, and scoring, then starts the game.
4. Only the host can play excerpts, reveal answers, and award points.

The scoreboard highlights the current player and a brief message reports the points
earned after every turn. When all rounds are complete, Songfy displays the final
rankings and each player's total points. Select **Play again** to return to game setup.

Rooms are held only in the running application process. They expire after two hours
without host activity and are also lost when the app restarts, deploys, or scales out.
Run the Azure App Service with one worker/instance, WebSockets enabled, and Always On.

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
