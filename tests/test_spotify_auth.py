from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException
from spotipy.oauth2 import SpotifyOauthError

from app.spotify_auth import SpotifyAuth


def request_with_state(state="expected-state"):
    request = Mock()
    request.session = {"spotify_oauth_state": state}
    return request


def test_complete_login_accepts_profile_without_product_field():
    auth = SpotifyAuth()
    auth._oauth = Mock()
    auth._oauth.get_access_token.return_value = {"access_token": "token"}
    request = request_with_state()

    with patch("app.spotify_auth.Spotify") as spotify:
        spotify.return_value.current_user.return_value = {"id": "user"}
        auth.complete_login(request, "code", "expected-state")

    assert request.session["spotify_authenticated"] is True


def test_complete_login_rejects_explicit_non_premium_profile():
    auth = SpotifyAuth()
    auth._oauth = Mock()
    auth._oauth.get_access_token.return_value = {"access_token": "token"}
    request = request_with_state()

    with (
        patch("app.spotify_auth.Spotify") as spotify,
        pytest.raises(HTTPException) as error,
    ):
        spotify.return_value.current_user.return_value = {"product": "free"}
        auth.complete_login(request, "code", "expected-state")

    assert error.value.status_code == 403
    assert auth.cache.get_cached_token() is None


def test_complete_login_turns_token_exchange_failure_into_bad_request():
    auth = SpotifyAuth()
    auth._oauth = Mock()
    auth._oauth.get_access_token.side_effect = SpotifyOauthError(
        "invalid grant",
        error="invalid_grant",
    )

    with pytest.raises(HTTPException) as error:
        auth.complete_login(
            request_with_state(),
            "expired-code",
            "expected-state",
        )

    assert error.value.status_code == 400
    assert "Start the sign-in again" in error.value.detail


def test_authorization_url_stores_and_forwards_state():
    auth = SpotifyAuth()
    auth._oauth = Mock()
    auth._oauth.get_authorize_url.return_value = "https://accounts.spotify.test/login"
    request = Mock()
    request.session = {}

    assert auth.authorization_url(request) == "https://accounts.spotify.test/login"

    state = request.session["spotify_oauth_state"]
    assert state
    auth._oauth.get_authorize_url.assert_called_once_with(state=state)


def test_complete_login_rejects_mismatched_state_before_token_exchange():
    auth = SpotifyAuth()
    auth._oauth = Mock()
    request = request_with_state()

    with pytest.raises(HTTPException) as error:
        auth.complete_login(request, "code", "wrong-state")

    assert error.value.status_code == 400
    assert "spotify_oauth_state" not in request.session
    auth._oauth.get_access_token.assert_not_called()


def test_access_token_returns_valid_cached_token():
    auth = SpotifyAuth()
    auth._oauth = Mock()
    auth.cache.save_token_to_cache({"access_token": "cached-token"})
    auth._oauth.validate_token.return_value = {"access_token": "fresh-token"}
    request = Mock()
    request.session = {"spotify_authenticated": True}

    assert auth.access_token(request) == "fresh-token"
    auth._oauth.validate_token.assert_called_once_with({"access_token": "cached-token"})


def test_access_token_clears_session_when_cached_token_is_expired():
    auth = SpotifyAuth()
    auth._oauth = Mock()
    auth._oauth.validate_token.return_value = None
    request = Mock()
    request.session = {"spotify_authenticated": True, "browser_id": "browser"}

    with pytest.raises(HTTPException) as error:
        auth.access_token(request)

    assert error.value.status_code == 401
    assert request.session == {}


def test_access_token_requires_an_authenticated_session():
    auth = SpotifyAuth()
    auth._oauth = Mock()
    request = Mock()
    request.session = {}

    with pytest.raises(HTTPException) as error:
        auth.access_token(request)

    assert error.value.status_code == 401
    auth._oauth.validate_token.assert_not_called()
