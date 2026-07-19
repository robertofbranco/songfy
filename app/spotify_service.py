from os import getenv
import random

from spotipy import Spotify, SpotifyOAuth, SpotifyClientCredentials
from app.song import Song
from dotenv import load_dotenv
load_dotenv()


class SpotifyService:
    SEARCH_LIMIT = 3
    CLIENT_ID = getenv("CLIENT_ID")
    CLIENT_SECRET = getenv("CLIENT_SECRET")
    REDIRECT_URI = getenv("REDIRECT_URI")
    SCOPE = "user-library-read"
    sp_oauth = SpotifyOAuth(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        redirect_uri=REDIRECT_URI,
        scope=SCOPE
    )

    @staticmethod
    async def get_playlist_songs(playlist_id, song_count: int) -> list[Song]:
        client_credentials_manager = SpotifyClientCredentials(client_id=SpotifyService.CLIENT_ID,
                                                              client_secret=SpotifyService.CLIENT_SECRET)
        sp = Spotify(client_credentials_manager=client_credentials_manager)
        songs_found: list[Song] = []
        seen_song_ids: set[str] = set()

        playlist_page = sp.playlist_items(playlist_id)

        while playlist_page:
            for item in playlist_page["items"]:
                song = item.get("track")

                if not song or not song.get("id"):
                    continue

                song_name = song["name"]
                song_id = song["id"]

                if song_id in seen_song_ids:
                    continue

                seen_song_ids.add(song_id)
                song_artists_names = [
                    artist["name"] for artist in song["artists"]
                ]
                song_year = song["album"]["release_date"]

                songs_found.append(Song(
                    id=song_id,
                    name=song_name,
                    artists=song_artists_names,
                    yearReleased=song_year,
                ))

            playlist_page = (
                sp.next(playlist_page)
                if playlist_page.get("next")
                else None
            )

        random.shuffle(songs_found)
        return songs_found[:song_count]
