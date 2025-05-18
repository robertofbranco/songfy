Check it out on: https://songfy-dueae8btf4dnasbx.polandcentral-01.azurewebsites.net/songfy/

Songfy is a couch multiplayer game which players must
guess the songs information to obtain points.
Current information available: song's name, artists, and release date.

In the first page, the players can choose the set of songs
by inserting a link to a Spotify's playlist, or play with
the default set.\
Upcoming: choose songs based on more predefined sets.

On the game page, the players can add their names and start playing.
The marked border indicates the player's turn.\
Click on 'Play' and listen the song.\
When the player or the song is done. Move forward by pressing the '>' button. \
Finally, select the items the player got right and confirm.\
It's the next player turn now.

Running it locally:
Requirements: Python 3 installed and Spotify API credentials
1. In the folder, run 'pip install -r requirements.txt'
2. Once the installation is done, run 'uvicorn main:app --host 0.0.0.0 --port 8000'
3. Access the web address 'localhost:8000/songfy'
