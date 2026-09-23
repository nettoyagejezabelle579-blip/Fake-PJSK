# Adding Songs

## 1. Create the song folder
Make `songs/<id>/` (`<id>` = short lowercase name, no spaces) containing:
- the audio file (e.g. `song.mp3`, `.ogg` or `.wav`)
- `cover.png`/`.svg` (optional, square)
- `meta.json`:
```json
{ "title": "My Song", "artist": "Me", "audio": "song.mp3", "bpm": 128,
  "preview": 30, "cover": "cover.png",
  "difficulties": { "easy": 5, "normal": 12, "hard": 20 } }
```
`difficulties` lists which charts exist and their levels; `preview` is the preview start (seconds).

## 2. Register in `songs/index.json`
Add the id: `{ "songs": ["demo", "<id>"] }`. The menu and editor read this list.

## 3. Chart each difficulty in `editor.html`
1. Serve the folder (`python3 -m http.server`) and open `editor.html`.
2. Pick the song and difficulty, press **Load** (missing charts start empty).
3. Set **BPM** and **Offset** (seconds to the first beat) so grid lines match the music.
4. Pick **Type** (tap/hold/flick) and **Snap**, turn on **Rec**, press **Play** (Space), and tap D F J K or the pads.
5. Fix up: tap empty timeline = add, drag note = move, drag hold tail = length, right-click / Delete = remove, wheel = scroll, Ctrl+wheel = zoom.
6. **Export JSON** downloads `<difficulty>.json`; move it into `songs/<id>/`.
7. Repeat for `easy`, `normal`, `hard`.

## 4. Test
Open `index.html`, pick the song, play each difficulty.
