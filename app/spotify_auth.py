from os import getenv
from secrets import token_urlsafe

from fastapi import HTTPException, Request
from requests import RequestException
from spotipy import Spotify, SpotifyException, SpotifyOAuth
from spotipy.cache_handler import MemoryCacheHandler
from spotipy.oauth2 import SpotifyOauthError


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

        try:
            token_info = self.oauth.get_access_token(
                code,
                check_cache=False,
                as_dict=True,
            )
            profile = Spotify(auth=token_info["access_token"]).current_user()
        except SpotifyOauthError as exc:
            self.cache.save_token_to_cache(None)
            raise HTTPException(
                status_code=400,
                detail="Spotify authorization failed. Start the sign-in again.",
            ) from exc
        except SpotifyException as exc:
            self.cache.save_token_to_cache(None)
            raise HTTPException(
                status_code=502,
                detail=(
                    "Spotify rejected the profile request. Check that this account "
                    "is allowed to use the app, then sign in again."
                ),
            ) from exc
        except (RequestException, KeyError, TypeError) as exc:
            self.cache.save_token_to_cache(None)
            raise HTTPException(
                status_code=502,
                detail="Spotify authentication is temporarily unavailable.",
            ) from exc

        # Development Mode no longer returns the subscription product field as
        # of Spotify's February 2026 API changes. The Web Playback SDK still
        # enforces Premium access, so only reject an explicit non-Premium value.
        if profile.get("product") not in (None, "premium"):
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
