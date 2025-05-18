from fastapi import APIRouter
from fastapi import FastAPI, Request
from fastapi.templating import Jinja2Templates
from app.spotify_service import SpotifyService

router = APIRouter(
    prefix='/songfy'
)

app = FastAPI()

# Set up Jinja2 for rendering templates
templates = Jinja2Templates(directory="app/templates")


@router.get("/")
async def read_root(request: Request):
    response = templates.TemplateResponse("index.html", {"request": request})
    return response


@router.get("/game")
async def read_root(request: Request):
    response = templates.TemplateResponse("game.html", {"request": request})
    return response


@router.get("/get-songs")
async def get_songs(playlistId: str = None):
    if not playlistId:
        playlist_id = '4qdHxoedPCArR4pa2MMdAe'

    spotify_setlist_service = SpotifyService()
    return await spotify_setlist_service.get_playlist_songs(playlistId)
