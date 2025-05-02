from fastapi import APIRouter
from fastapi.responses import RedirectResponse
from fastapi import FastAPI, HTTPException, Request, Cookie
from fastapi.templating import Jinja2Templates

from app.spotify_service import SpotifyService

router = APIRouter(
    prefix='/songfy'
)

app = FastAPI()

# Set up Jinja2 for rendering templates
templates = Jinja2Templates(directory="app/templates")


@router.get("/login")
def login():
    auth_url = SpotifyService.sp_oauth.get_authorize_url()
    return RedirectResponse(auth_url)


@router.get("/")
async def read_root(request: Request):
    if not request.cookies.get("user_token"):
        return RedirectResponse("http://localhost:8000/songfy/login")

    response = templates.TemplateResponse("songfy.html", {"request": request})
    response.set_cookie(key="user_token", value=request.cookies["user_token"], httponly=True, secure=True, max_age=3600)
    return response


@router.get("/callback")
async def callback(request: Request):
    code = request.query_params.get("code")

    if not code:
        return RedirectResponse("http://localhost:8000/songfy/login")

    token_info = SpotifyService.sp_oauth.get_access_token(code, check_cache=False)

    if "access_token" not in token_info:
        raise HTTPException(status_code=400, detail="Failed to get access token")

    response = RedirectResponse("http://localhost:8000/songfy/")
    response.set_cookie(key="user_token", value=token_info['access_token'], httponly=True, secure=True, max_age=3600)

    return response


@router.get("/get-songs")
async def get_songs():
    spotify_setlist_service = SpotifyService()
    return await spotify_setlist_service.get_playlist_songs('4qdHxoedPCArR4pa2MMdAe')
