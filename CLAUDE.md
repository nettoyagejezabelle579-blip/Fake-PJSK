# CLAUDE.md

Project Sekai–style web rhythm game. Plain HTML/CSS/JS, no framework, no build step, no bundler. Open `index.html` via a static server.

## Layout
- `index.html` — single entry page
- `css/` — styles
- `js/audio.js` — AudioContext, song loading/decoding, playback, clock
- `js/game.js` — game state, chart loading, judgement, score/combo
- `js/render.js` — canvas drawing: perspective highway, notes, effects
- `js/input.js` — touch/pointer/keyboard → lane hits
- `js/menu.js` — song select, difficulty select, results screens
- `songs/<id>/` — audio file, `meta.json`, `easy.json`, `normal.json`, `hard.json`

## Core rules
- ALL timing uses the Web Audio clock: `audioContext.currentTime` corrected with `audioContext.getOutputTimestamp()`. Never use frame time, `performance.now()` deltas, or rAF timestamps for song position or judgement.
- rAF is for drawing only; each frame reads song time from audio.js.
- Exactly 4 wide lanes.
- Perspective highway: lanes converge toward a vanishing point, notes scale with depth.
- Generous timing windows (forgiving Perfect/Great/Good; tune in one constants block).
- UI: large, high-contrast, touch-friendly (big tap targets, readable at arm's length, works on phones).
- No external dependencies unless explicitly requested.

## Token rules (every task)
- Read only the files needed for the task.
- Make minimal diffs; never rewrite whole files.
- No explanations; reply only with the list of changed files.
- `git commit` after each working step.
