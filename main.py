from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from os import getenv
from secrets import token_urlsafe
import asyncio
import uvicorn
import app.songfy as songfy
from app.rooms import room_manager

app = FastAPI()

app.add_middleware(
    SessionMiddleware,
    secret_key=getenv("SESSION_SECRET") or token_urlsafe(32),
    https_only=getenv("ENVIRONMENT") == "production",
    same_site="lax",
)

# Mount the static folder to serve JS and CSS files
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Allow CORS for your frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update with your frontend URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(songfy.router)


@app.on_event("startup")
async def start_room_cleanup() -> None:
    async def cleanup_rooms() -> None:
        while True:
            await asyncio.sleep(300)
            await room_manager.cleanup_expired()

    app.state.room_cleanup_task = asyncio.create_task(cleanup_rooms())


@app.on_event("shutdown")
async def stop_room_cleanup() -> None:
    app.state.room_cleanup_task.cancel()
