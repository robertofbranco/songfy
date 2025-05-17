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
    response = templates.TemplateResponse("songfy.html", {"request": request})
    return response


@router.get("/get-songs")
async def get_songs():
    spotify_setlist_service = SpotifyService()
    return await spotify_setlist_service.get_playlist_songs('4qdHxoedPCArR4pa2MMdAe')
