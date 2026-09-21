from fastapi import APIRouter, HTTPException, Query
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from app.spotify_auth import spotify_auth
from app.spotify_service import SpotifyService

router = APIRouter(
    prefix='/songfy'
)

app = FastAPI()

# Set up Jinja2 for rendering templates
templates = Jinja2Templates(directory="app/templates")


@router.get("/")
async def read_root(request: Request):
    if not request.session.get("spotify_authenticated"):
        return RedirectResponse("/songfy/login", status_code=303)

    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={},
    )

@router.get("/game")
async def read_game(request: Request):
    if not request.session.get("spotify_authenticated"):
        return RedirectResponse("/songfy/login", status_code=303)

    return templates.TemplateResponse(
        request=request,
        name="game.html",
        context={},
    )


@router.get("/login")
async def login(request: Request):
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
    return RedirectResponse("/songfy/", status_code=303)


@router.get("/auth/token")
async def auth_token(request: Request):
    return JSONResponse({"access_token": spotify_auth.access_token(request)})


@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/songfy/login", status_code=303)


@router.get("/get-songs")
async def get_songs(songCount: int = Query(ge=1), playlistId: str = None):
    if not playlistId:
        playlistId = '2YRe7HRKNRvXdJBp9nXFza'

    spotify_setlist_service = SpotifyService()
    return await spotify_setlist_service.get_playlist_songs(
        playlistId,
        songCount,
    )
