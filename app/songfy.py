from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from os import getenv
from pydantic import BaseModel
from secrets import token_urlsafe
from urllib.parse import urlsplit
from app.spotify_auth import spotify_auth
from app.rooms import Room, room_manager
from app.spotify_service import SpotifyService

router = APIRouter(
    prefix='/songfy'
)

# Set up Jinja2 for rendering templates
templates = Jinja2Templates(directory="app/templates")


class RoomSettingsInput(BaseModel):
    playlistId: str = ""
    players: list[str]
    rounds: int = 10
    songDurationSeconds: int = 25
    songNamePoints: int = 1
    artistPoints: int = 1
    releaseYearPoints: int = 1


class AwardInput(BaseModel):
    songName: bool = False
    artist: bool = False
    releaseYear: bool = False


def browser_id(request: Request) -> str:
    value = request.session.get("browser_id")
    if not value:
        value = token_urlsafe(24)
        request.session["browser_id"] = value
    return value


def validate_settings(settings: RoomSettingsInput) -> dict:
    players = [player.strip() for player in settings.players if player.strip()]
    if not players:
        raise HTTPException(status_code=422, detail="Add at least one player.")
    if len(players) > 20 or len({player.casefold() for player in players}) != len(players):
        raise HTTPException(status_code=422, detail="Player names must be unique (maximum 20).")
    if any(len(player) > 20 for player in players):
        raise HTTPException(status_code=422, detail="Player names must be 20 characters or fewer.")

    ranges = {
        "rounds": (1, 100),
        "songDurationSeconds": (1, 300),
        "songNamePoints": (0, 100),
        "artistPoints": (0, 100),
        "releaseYearPoints": (0, 100),
    }
    for field, (minimum, maximum) in ranges.items():
        value = getattr(settings, field)
        if not minimum <= value <= maximum:
            raise HTTPException(status_code=422, detail=f"{field} is out of range.")

    playlist_id = settings.playlistId.strip()
    if playlist_id and not playlist_id.isalnum():
        raise HTTPException(status_code=422, detail="Invalid playlist ID.")

    serialized = settings.model_dump() if hasattr(settings, "model_dump") else settings.dict()
    return {**serialized, "players": players, "playlistId": playlist_id}


def require_spotify_host(request: Request) -> None:
    if not request.session.get("spotify_authenticated"):
        raise HTTPException(status_code=401, detail="Spotify Premium login required.")


def require_matching_local_oauth_origin(request: Request) -> None:
    redirect_uri = getenv("REDIRECT_URI", "")
    configured = urlsplit(redirect_uri)

    # Spotify permits HTTP only for loopback development callbacks. The browser
    # session cookie is host-specific, so localhost and 127.0.0.1 cannot be mixed.
    if configured.scheme != "http":
        return

    if getenv("ENVIRONMENT") == "production":
        raise HTTPException(
            status_code=500,
            detail="Set ENVIRONMENT=development when using a local HTTP redirect URI.",
        )

    expected_origin = f"{configured.scheme}://{configured.netloc}"
    request_origin = str(request.base_url).rstrip("/")
    if request_origin != expected_origin:
        raise HTTPException(
            status_code=400,
            detail=(
                "Local OAuth must start from the same origin as REDIRECT_URI. "
                f"Open {expected_origin}/songfy/ instead."
            ),
        )


async def host_room(request: Request, code: str) -> Room:
    require_spotify_host(request)
    return await room_manager.require_host(code, browser_id(request))


@router.get("/")
async def read_root(request: Request):
    # Establish the room-owner identity before the first create-room request.
    # This avoids the create response and room navigation racing to persist it.
    browser_id(request)
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"spotify_authenticated": bool(request.session.get("spotify_authenticated"))},
    )

@router.get("/rooms/{code}")
async def read_room(request: Request, code: str):
    room = await room_manager.get(code)
    return templates.TemplateResponse(
        request=request,
        name="room.html",
        context={
            "room_code": room.code,
            "is_host": room.owner_browser_id == browser_id(request),
        },
    )


@router.get("/join")
async def join_room(code: str = ""):
    normalized_code = code.strip().upper()
    if not normalized_code:
        return RedirectResponse("/songfy/", status_code=303)
    return RedirectResponse(f"/songfy/rooms/{normalized_code}", status_code=303)


@router.get("/login")
async def login(request: Request, next: str = "/songfy/"):
    require_matching_local_oauth_origin(request)
    if not next.startswith("/songfy/"):
        next = "/songfy/"
    request.session["spotify_login_next"] = next
    return RedirectResponse(
        spotify_auth.authorization_url(request),
        status_code=303,
    )


@router.get("/auth/callback")
async def auth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    if error or not code or not state:
        raise HTTPException(
            status_code=400,
            detail="Spotify authorization was not completed.",
        )

    spotify_auth.complete_login(request, code, state)
    return RedirectResponse(request.session.pop("spotify_login_next", "/songfy/"), status_code=303)


@router.get("/auth/token")
async def auth_token(request: Request):
    return JSONResponse({"access_token": spotify_auth.access_token(request)})


@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/songfy/login", status_code=303)


@router.post("/api/rooms")
async def create_room(request: Request):
    require_spotify_host(request)
    room = await room_manager.create(browser_id(request))
    return JSONResponse({"code": room.code, "url": f"/songfy/rooms/{room.code}"}, status_code=201)


@router.get("/api/rooms/{code}")
async def room_state(request: Request, code: str):
    room = await room_manager.get(code)
    is_host = room.owner_browser_id == browser_id(request)
    return room_manager.snapshot(room, is_host=is_host)


@router.put("/api/rooms/{code}/settings")
async def update_room_settings(request: Request, code: str, settings: RoomSettingsInput):
    room = await host_room(request, code)
    values = validate_settings(settings)
    async with room.lock:
        if room.status != "lobby":
            raise HTTPException(status_code=409, detail="Game settings are locked after the game starts.")
        room.settings = values
    await room_manager.broadcast(room)
    return room_manager.snapshot(room, is_host=True)


@router.post("/api/rooms/{code}/start")
async def start_room(request: Request, code: str):
    room = await host_room(request, code)
    async with room.lock:
        if room.status != "lobby":
            raise HTTPException(status_code=409, detail="This room has already started.")
        settings = room.settings.copy()
        if not settings["players"]:
            raise HTTPException(status_code=422, detail="Configure players before starting.")

    playlist_id = settings["playlistId"] or "2YRe7HRKNRvXdJBp9nXFza"
    song_count = len(settings["players"]) * settings["rounds"]
    songs = await SpotifyService.get_playlist_songs(playlist_id, song_count)
    if len(songs) < song_count:
        raise HTTPException(status_code=422, detail="The playlist does not contain enough playable songs.")

    async with room.lock:
        room.songs = songs
        room.scores = {player: 0 for player in settings["players"]}
        room.song_index = 0
        room.current_player_index = 0
        room.current_round = 1
        room.status = "active"
        room.playback_status = "ready"
        room.revealed = False
    await room_manager.broadcast(room)
    return room_manager.snapshot(room, is_host=True)


@router.post("/api/rooms/{code}/play")
async def play_room_song(request: Request, code: str):
    room = await host_room(request, code)
    async with room.lock:
        if room.status != "active" or room.revealed or room.playback_status not in {"ready", "done"}:
            raise HTTPException(status_code=409, detail="The current song cannot be started.")
        room.playback_status = "starting"
        snapshot = room_manager.snapshot(room, is_host=True)
    await room_manager.broadcast(room)
    return snapshot


@router.post("/api/rooms/{code}/playback-started")
async def playback_started(request: Request, code: str):
    room = await host_room(request, code)
    async with room.lock:
        if room.status == "active" and room.playback_status == "starting":
            room.playback_status = "playing"
    await room_manager.broadcast(room)
    return room_manager.snapshot(room, is_host=True)


@router.post("/api/rooms/{code}/playback-finished")
async def playback_finished(request: Request, code: str):
    room = await host_room(request, code)
    async with room.lock:
        if room.status == "active" and not room.revealed:
            room.playback_status = "done"
    await room_manager.broadcast(room)
    return room_manager.snapshot(room, is_host=True)


@router.post("/api/rooms/{code}/reveal")
async def reveal_room_song(request: Request, code: str):
    room = await host_room(request, code)
    async with room.lock:
        if room.status != "active" or room.revealed:
            raise HTTPException(status_code=409, detail="The answer cannot be revealed now.")
        room.revealed = True
        room.playback_status = "revealed"
    await room_manager.broadcast(room)
    return room_manager.snapshot(room, is_host=True)


@router.post("/api/rooms/{code}/award")
async def award_points(request: Request, code: str, award: AwardInput):
    room = await host_room(request, code)
    async with room.lock:
        if room.status != "active" or not room.revealed:
            raise HTTPException(status_code=409, detail="Reveal the answer before awarding points.")
        player = room.settings["players"][room.current_player_index]
        points = (
            (room.settings["songNamePoints"] if award.songName else 0)
            + (room.settings["artistPoints"] if award.artist else 0)
            + (room.settings["releaseYearPoints"] if award.releaseYear else 0)
        )
        room.scores[player] += points
        room.song_index += 1
        if room.song_index >= len(room.songs):
            room.status = "finished"
            room.playback_status = "finished"
            room.revealed = False
        else:
            room.current_player_index = (room.current_player_index + 1) % len(room.settings["players"])
            if room.current_player_index == 0:
                room.current_round += 1
            room.revealed = False
            room.playback_status = "ready"
        snapshot = room_manager.snapshot(room, is_host=True)
    await room_manager.broadcast(room)
    return snapshot


@router.post("/api/rooms/{code}/heartbeat")
async def room_heartbeat(request: Request, code: str):
    room = await host_room(request, code)
    return room_manager.snapshot(room, is_host=True)


@router.delete("/api/rooms/{code}", status_code=204)
async def close_room(request: Request, code: str):
    await host_room(request, code)
    await room_manager.remove(code, reason="room_closed")


@router.websocket("/ws/rooms/{code}")
async def room_websocket(websocket: WebSocket, code: str):
    try:
        room = await room_manager.get(code)
    except HTTPException:
        await websocket.close(code=4404)
        return

    await websocket.accept()
    is_host = room.owner_browser_id == websocket.session.get("browser_id")
    async with room.lock:
        room.sockets[websocket] = is_host
    await websocket.send_json({"type": "room_state", "room": room_manager.snapshot(room, is_host=is_host)})

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        room.sockets.pop(websocket, None)


@router.get("/get-songs")
async def get_songs(songCount: int = Query(ge=1), playlistId: str = None):
    if not playlistId:
        playlistId = '2YRe7HRKNRvXdJBp9nXFza'

    spotify_setlist_service = SpotifyService()
    return await spotify_setlist_service.get_playlist_songs(
        playlistId,
        songCount,
    )
