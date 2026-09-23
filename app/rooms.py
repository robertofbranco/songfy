import asyncio
import secrets
import string
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException, WebSocket

from app.song import Song


ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ROOM_CODE_LENGTH = 6
ROOM_IDLE_SECONDS = 2 * 60 * 60


@dataclass
class Room:
    code: str
    owner_browser_id: str
    settings: dict[str, Any] = field(default_factory=lambda: {
        "playlistId": "",
        "players": [],
        "rounds": 10,
        "songDurationSeconds": 25,
        "songNamePoints": 1,
        "artistPoints": 1,
        "releaseYearPoints": 1,
    })
    status: str = "lobby"
    songs: list[Song] = field(default_factory=list)
    song_index: int = 0
    current_player_index: int = 0
    current_round: int = 1
    scores: dict[str, int] = field(default_factory=dict)
    playback_status: str = "ready"
    revealed: bool = False
    last_host_activity: float = field(default_factory=time.monotonic)
    sockets: dict[WebSocket, bool] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class RoomManager:
    def __init__(self):
        self.rooms: dict[str, Room] = {}
        self.lock = asyncio.Lock()

    async def create(self, owner_browser_id: str) -> Room:
        async with self.lock:
            for _ in range(100):
                code = "".join(
                    secrets.choice(ROOM_CODE_ALPHABET)
                    for _ in range(ROOM_CODE_LENGTH)
                )
                if code not in self.rooms:
                    room = Room(code=code, owner_browser_id=owner_browser_id)
                    self.rooms[code] = room
                    return room

        raise RuntimeError("Could not allocate a room code.")

    async def get(self, code: str) -> Room:
        normalized_code = code.strip().upper()
        async with self.lock:
            room = self.rooms.get(normalized_code)

        if room is None:
            raise HTTPException(status_code=404, detail="Room not found or expired.")

        return room

    async def require_host(self, code: str, browser_id: str) -> Room:
        room = await self.get(code)
        if room.owner_browser_id != browser_id:
            raise HTTPException(status_code=403, detail="Only the room host can do that.")
        room.last_host_activity = time.monotonic()
        return room

    def snapshot(self, room: Room, is_host: bool = False) -> dict[str, Any]:
        players = room.settings["players"]
        state: dict[str, Any] = {
            "code": room.code,
            "isHost": is_host,
            "status": room.status,
            "settings": {
                key: value
                for key, value in room.settings.items()
                if key != "playlistId" or is_host
            },
            "round": room.current_round,
            "currentPlayer": (
                players[room.current_player_index]
                if room.status == "active" and players
                else None
            ),
            "scores": room.scores,
            "playbackStatus": room.playback_status,
            "revealed": room.revealed,
        }

        if room.revealed and room.songs and room.song_index < len(room.songs):
            song = room.songs[room.song_index]
            state["answer"] = {
                "name": song.name,
                "artists": song.artists,
                "yearReleased": song.yearReleased,
            }

        if is_host and room.status == "active" and room.songs:
            state["controller"] = {
                "trackUri": f"spotify:track:{room.songs[room.song_index].id}",
                "songDurationSeconds": room.settings["songDurationSeconds"],
            }

        return state

    async def broadcast(self, room: Room) -> None:
        stale_sockets: list[WebSocket] = []

        for socket, is_host in list(room.sockets.items()):
            try:
                await socket.send_json({"type": "room_state", "room": self.snapshot(room, is_host=is_host)})
            except Exception:
                stale_sockets.append(socket)

        for socket in stale_sockets:
            room.sockets.pop(socket, None)

    async def remove(self, code: str, reason: str = "room_expired") -> None:
        async with self.lock:
            room = self.rooms.pop(code, None)

        if room is None:
            return

        for socket in list(room.sockets):
            try:
                await socket.send_json({"type": reason})
                await socket.close()
            except Exception:
                pass

    async def cleanup_expired(self, now: float | None = None) -> list[str]:
        now = now if now is not None else time.monotonic()
        async with self.lock:
            expired_codes = [
                code for code, room in self.rooms.items()
                if now - room.last_host_activity >= ROOM_IDLE_SECONDS
            ]

        for code in expired_codes:
            await self.remove(code)

        return expired_codes


room_manager = RoomManager()
