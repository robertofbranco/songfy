import base64
import json
import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner
from starlette.websockets import WebSocketDisconnect

os.environ.setdefault("SESSION_SECRET", "test-session-secret")

from app.rooms import room_manager
from app.song import Song
from app.spotify_service import SpotifyService
from main import app


def session_cookie(**values: object) -> str:
    payload = base64.b64encode(json.dumps(values).encode("utf-8"))
    return TimestampSigner(os.environ["SESSION_SECRET"]).sign(payload).decode("utf-8")


@pytest.fixture(autouse=True)
def empty_global_room_manager():
    room_manager.rooms.clear()
    yield
    room_manager.rooms.clear()


@pytest.fixture
def host_client():
    with TestClient(app) as client:
        client.cookies.set(
            "session",
            session_cookie(
                spotify_authenticated=True,
                browser_id="host-browser",
            ),
        )
        yield client


def create_room(client: TestClient) -> str:
    response = client.post("/songfy/api/rooms")
    assert response.status_code == 201
    return response.json()["code"]


def test_room_api_runs_a_complete_two_player_game(host_client):
    code = create_room(host_client)
    settings = {
        "playlistId": "playlist123",
        "players": [" Alice ", "Bob"],
        "rounds": 1,
        "songDurationSeconds": 20,
        "songNamePoints": 2,
        "artistPoints": 3,
        "releaseYearPoints": 4,
    }

    response = host_client.put(f"/songfy/api/rooms/{code}/settings", json=settings)
    assert response.status_code == 200
    assert response.json()["settings"]["players"] == ["Alice", "Bob"]

    songs = [
        Song(id="one", name="First", artists=["Artist A"], yearReleased="2001"),
        Song(id="two", name="Second", artists=["Artist B"], yearReleased="2002"),
    ]
    with patch.object(
        SpotifyService,
        "get_playlist_songs",
        new=AsyncMock(return_value=songs),
    ) as get_playlist_songs:
        response = host_client.post(f"/songfy/api/rooms/{code}/start")

    assert response.status_code == 200
    assert response.json()["currentPlayer"] == "Alice"
    get_playlist_songs.assert_awaited_once_with("playlist123", 2)

    with TestClient(app) as spectator:
        public_state = spectator.get(f"/songfy/api/rooms/{code}").json()
    assert public_state["isHost"] is False
    assert "playlistId" not in public_state["settings"]
    assert "controller" not in public_state
    assert "answer" not in public_state

    assert host_client.post(f"/songfy/api/rooms/{code}/play").json()["playbackStatus"] == "starting"
    assert host_client.post(f"/songfy/api/rooms/{code}/playback-started").json()["playbackStatus"] == "playing"
    assert host_client.post(f"/songfy/api/rooms/{code}/playback-finished").json()["playbackStatus"] == "done"
    revealed = host_client.post(f"/songfy/api/rooms/{code}/reveal").json()
    assert revealed["answer"]["name"] == "First"

    first_award = host_client.post(
        f"/songfy/api/rooms/{code}/award",
        json={"songName": True, "artist": False, "releaseYear": True},
    )
    assert first_award.status_code == 200
    assert first_award.json()["scores"] == {"Alice": 6, "Bob": 0}
    assert first_award.json()["currentPlayer"] == "Bob"
    assert first_award.json()["round"] == 1

    host_client.post(f"/songfy/api/rooms/{code}/reveal")
    finished = host_client.post(
        f"/songfy/api/rooms/{code}/award",
        json={"artist": True},
    )
    assert finished.status_code == 200
    assert finished.json()["status"] == "finished"
    assert finished.json()["scores"] == {"Alice": 6, "Bob": 3}


def test_room_mutations_require_login_and_owner(host_client):
    code = create_room(host_client)
    settings = {
        "players": ["Alice"],
        "rounds": 1,
        "songDurationSeconds": 25,
        "songNamePoints": 1,
        "artistPoints": 1,
        "releaseYearPoints": 1,
    }

    with TestClient(app) as anonymous:
        assert anonymous.post("/songfy/api/rooms").status_code == 401
        response = anonymous.put(f"/songfy/api/rooms/{code}/settings", json=settings)
        assert response.status_code == 401

        anonymous.cookies.set(
            "session",
            session_cookie(
                spotify_authenticated=True,
                browser_id="different-browser",
            ),
        )
        response = anonymous.put(f"/songfy/api/rooms/{code}/settings", json=settings)
        assert response.status_code == 403


@pytest.mark.parametrize(
    ("changes", "detail"),
    [
        ({"players": []}, "Add at least one player"),
        ({"players": ["Alice", "alice"]}, "unique"),
        ({"players": ["A" * 21]}, "20 characters"),
        ({"rounds": 0}, "rounds is out of range"),
        ({"playlistId": "not/a/playlist"}, "Invalid playlist ID"),
    ],
)
def test_settings_validation_rejects_invalid_payloads(host_client, changes, detail):
    code = create_room(host_client)
    payload = {
        "playlistId": "",
        "players": ["Alice"],
        "rounds": 1,
        "songDurationSeconds": 25,
        "songNamePoints": 1,
        "artistPoints": 1,
        "releaseYearPoints": 1,
        **changes,
    }

    response = host_client.put(f"/songfy/api/rooms/{code}/settings", json=payload)

    assert response.status_code == 422
    assert detail in response.json()["detail"]


def test_invalid_game_transitions_return_conflict(host_client):
    code = create_room(host_client)

    assert host_client.post(f"/songfy/api/rooms/{code}/play").status_code == 409
    assert host_client.post(f"/songfy/api/rooms/{code}/reveal").status_code == 409
    assert host_client.post(
        f"/songfy/api/rooms/{code}/award",
        json={"songName": True},
    ).status_code == 409


def test_room_websocket_identifies_host_and_spectator(host_client):
    code = create_room(host_client)

    with host_client.websocket_connect(f"/songfy/ws/rooms/{code}") as websocket:
        message = websocket.receive_json()
        assert message["type"] == "room_state"
        assert message["room"]["isHost"] is True

    with TestClient(app) as spectator:
        with spectator.websocket_connect(f"/songfy/ws/rooms/{code}") as websocket:
            message = websocket.receive_json()
            assert message["room"]["isHost"] is False

        with pytest.raises(WebSocketDisconnect) as error:
            with spectator.websocket_connect("/songfy/ws/rooms/MISSING") as websocket:
                websocket.receive_json()
        assert error.value.code == 4404
