import asyncio
import time

import pytest
from fastapi import HTTPException

from app.rooms import ROOM_IDLE_SECONDS, RoomManager
from app.song import Song


def test_room_codes_are_unique_and_six_characters():
    async def create_rooms():
        manager = RoomManager()
        return [await manager.create(f"host-{index}") for index in range(20)]

    rooms = asyncio.run(create_rooms())
    assert len({room.code for room in rooms}) == 20
    assert all(len(room.code) == 6 for room in rooms)


def test_spectator_snapshot_hides_unrevealed_song_and_host_track():
    async def build_room():
        manager = RoomManager()
        room = await manager.create("host")
        room.status = "active"
        room.settings["players"] = ["Alice"]
        room.scores = {"Alice": 0}
        room.songs = [Song(id="secret", name="Hidden", artists=["Artist"], yearReleased="2000")]
        return manager, room

    manager, room = asyncio.run(build_room())
    spectator = manager.snapshot(room)
    host = manager.snapshot(room, is_host=True)

    assert "answer" not in spectator
    assert "controller" not in spectator
    assert host["controller"]["trackUri"] == "spotify:track:secret"

    room.revealed = True
    assert manager.snapshot(room)["answer"]["name"] == "Hidden"


def test_only_creator_browser_can_control_room():
    async def assert_owner():
        manager = RoomManager()
        room = await manager.create("host-browser")
        assert await manager.require_host(room.code, "host-browser") is room
        with pytest.raises(HTTPException, match="Only the room host"):
            await manager.require_host(room.code, "spectator-browser")

    asyncio.run(assert_owner())


def test_idle_rooms_are_removed():
    async def expire_room():
        manager = RoomManager()
        room = await manager.create("host")
        room.last_host_activity = time.monotonic() - ROOM_IDLE_SECONDS
        assert await manager.cleanup_expired() == [room.code]
        with pytest.raises(HTTPException, match="Room not found"):
            await manager.get(room.code)

    asyncio.run(expire_room())
