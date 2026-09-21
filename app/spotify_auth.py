from os import getenv
from secrets import token_urlsafe

from fastapi import HTTPException, Request
from spotipy import Spotify, SpotifyOAuth
from spotipy.cache_handler import MemoryCacheHandler


class SpotifyAuth:
    SCOPES = (
        "streaming user-read-email user-read-private "
        "user-modify-playback-state"
    )

    def __init__(self):
        self.cache = MemoryCacheHandler()
        self._oauth = None

    @property
    def oauth(self):
        if self._oauth is None:
            self._oauth = SpotifyOAuth(
                client_id=getenv("CLIENT_ID"),
                client_secret=getenv("CLIENT_SECRET"),
                redirect_uri=getenv("REDIRECT_URI"),
                scope=self.SCOPES,
                cache_handler=self.cache,
                open_browser=False,
            )

        return self._oauth

    def authorization_url(self, request: Request) -> str:
        state = token_urlsafe(32)
        request.session["spotify_oauth_state"] = state
        return self.oauth.get_authorize_url(state=state)

    def complete_login(
        self,
        request: Request,
        code: str,
        state: str,
    ) -> None:
        expected_state = request.session.pop("spotify_oauth_state", None)

        if not expected_state or state != expected_state:
            raise HTTPException(status_code=400, detail="Invalid OAuth state.")

        token_info = self.oauth.get_access_token(
            code,
            check_cache=False,
            as_dict=True,
        )
        profile = Spotify(auth=token_info["access_token"]).current_user()

        if profile.get("product") != "premium":
            self.cache.save_token_to_cache(None)
            raise HTTPException(
                status_code=403,
                detail="A Spotify Premium account is required.",
            )

        request.session["spotify_authenticated"] = True

    def access_token(self, request: Request) -> str:
        if not request.session.get("spotify_authenticated"):
            raise HTTPException(status_code=401, detail="Spotify login required.")

        token_info = self.oauth.validate_token(
            self.cache.get_cached_token()
        )

        if not token_info:
            request.session.clear()
            raise HTTPException(status_code=401, detail="Spotify login expired.")

        return token_info["access_token"]


spotify_auth = SpotifyAuth()
