from pydantic import BaseModel


class Song(BaseModel):
    id: str
    name: str
    artists: list[str]
    yearReleased: str
