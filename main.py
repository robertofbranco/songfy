from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn
import app.songfy as songfy

app = FastAPI()

# Mount the static folder to serve JS and CSS files
#app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Allow CORS for your frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update with your frontend URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(songfy.router)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)


