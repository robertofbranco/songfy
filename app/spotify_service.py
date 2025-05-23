from os import getenv
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
    async def get_playlist_songs(playlist_id) -> list[Song]:
        client_credentials_manager = SpotifyClientCredentials(client_id=SpotifyService.CLIENT_ID,
                                                              client_secret=SpotifyService.CLIENT_SECRET)
        sp = Spotify(client_credentials_manager=client_credentials_manager)
        songs_found: list[Song] = []

        playlist = sp.playlist_items(playlist_id)["items"]
        for item in playlist:
            song = item["track"]
            song_name = song['name']
            song_id = song['id']
            song_artists = song['artists']
            song_artists_names = [artist["name"] for artist in song_artists]
            song_year = song['album']['release_date']

            song = Song(id=song_id, name=song_name, artists=song_artists_names, yearReleased=song_year)
            songs_found.append(song)

        return songs_found
