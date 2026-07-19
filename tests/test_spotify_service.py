import asyncio
from unittest.mock import AsyncMock, Mock, patch

from app.song import Song
from app.songfy import get_songs
from app.spotify_service import SpotifyService


def test_get_playlist_songs_maps_tracks_and_removes_duplicates():
    spotify = Mock()
    spotify.playlist_items.return_value = {
        "items": [
            {
                "track": {
                    "id": "track-1",
                    "name": "First song",
                    "artists": [{"name": "First artist"}],
                    "album": {"release_date": "1999-04-12"},
                }
            },
            {
                "track": {
                    "id": "track-1",
                    "name": "First song",
                    "artists": [{"name": "First artist"}],
                    "album": {"release_date": "1999-04-12"},
                }
            },
            {
                "track": {
                    "id": "track-2",
                    "name": "Second song",
                    "artists": [
                        {"name": "Second artist"},
                        {"name": "Guest artist"},
                    ],
                    "album": {"release_date": "2005"},
                }
            },
        ]
    }

    with (
        patch("app.spotify_service.Spotify", return_value=spotify),
        patch("app.spotify_service.SpotifyClientCredentials"),
        patch("app.spotify_service.random.shuffle"),
    ):
        songs = asyncio.run(SpotifyService.get_playlist_songs("playlist-123", 2))

    spotify.playlist_items.assert_called_once_with("playlist-123")
    assert songs == [
        Song(
            id="track-1",
            name="First song",
            artists=["First artist"],
            yearReleased="1999-04-12",
        ),
        Song(
            id="track-2",
            name="Second song",
            artists=["Second artist", "Guest artist"],
            yearReleased="2005",
        ),
    ]


def test_get_playlist_songs_fetches_every_page_before_selecting():
    spotify = Mock()
    first_page = {"items": [], "next": "next-page"}
    second_page = {
        "items": [
            {
                "track": {
                    "id": "track-3",
                    "name": "Third song",
                    "artists": [{"name": "Third artist"}],
                    "album": {"release_date": "2015"},
                }
            }
        ],
        "next": None,
    }
    spotify.playlist_items.return_value = first_page
    spotify.next.return_value = second_page

    with (
        patch("app.spotify_service.Spotify", return_value=spotify),
        patch("app.spotify_service.SpotifyClientCredentials"),
        patch("app.spotify_service.random.shuffle"),
    ):
        songs = asyncio.run(
            SpotifyService.get_playlist_songs("playlist-123", 1)
        )

    spotify.next.assert_called_once_with(first_page)
    assert [song.id for song in songs] == ["track-3"]


def test_get_songs_uses_default_playlist_when_none_is_provided():
    expected = [
        Song(id="1", name="Song", artists=["Artist"], yearReleased="2000")
    ]

    with patch.object(
        SpotifyService,
        "get_playlist_songs",
        new=AsyncMock(return_value=expected),
    ) as get_playlist_songs:
        result = asyncio.run(get_songs(songCount=20))

    get_playlist_songs.assert_awaited_once_with(
        "2YRe7HRKNRvXdJBp9nXFza", 20
    )
    assert result == expected


def test_get_songs_uses_requested_playlist():
    with patch.object(
        SpotifyService,
        "get_playlist_songs",
        new=AsyncMock(return_value=[]),
    ) as get_playlist_songs:
        result = asyncio.run(
            get_songs(songCount=12, playlistId="custom-playlist")
        )

