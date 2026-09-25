"""Rate each chart's level on the Project Sekai scale and write it into songs/<id>/meta.json.

Project Sekai levels follow note density (combo per second), weighted toward the hardest stretch,
plus a little for patterns that need two hands or extra motion (doubles, flicks).
Reference points (density → level) come from typical official charts; each difficulty stays in its
official range and every difficulty is rated above the one below it.

usage: python3 tools/levels.py [song_id ...]   (default: every song in songs/index.json)
"""
import bisect, json, os, sys

DIFFS = ['easy', 'normal', 'hard', 'expert', 'master']
RANGE = {'easy': (5, 9), 'normal': (10, 16), 'hard': (15, 24), 'expert': (21, 31), 'master': (26, 37)}
CURVE = [(0.5, 3), (1.0, 5), (2.0, 9.5), (3.5, 16), (5.5, 24), (8.0, 30), (10.0, 33), (12.0, 36), (15.0, 39)]


def density(notes):
    """(combo per second over the whole chart, busiest 10 s), doubles share, flick share."""
    combo = len(notes) + sum(n.get('type') == 'hold' for n in notes)   # hold = head + tail
    ts = sorted(n['t'] for n in notes)
    span = max(max(n.get('end', n['t']) for n in notes) - ts[0], 10)
    peak = max(bisect.bisect_left(ts, t + 10) - bisect.bisect_left(ts, t) for t in ts) / 10
    doubles = sum(1 for a, b in zip(ts, ts[1:]) if b - a < 0.002) / len(ts)
    flicks = sum(n.get('type') == 'flick' for n in notes) / len(ts)
    return combo / span, peak, doubles, flicks


def level(notes, diff):
    avg, peak, doubles, flicks = density(notes)
    d = 0.6 * avg + 0.4 * peak
    for (x0, y0), (x1, y1) in zip(CURVE, CURVE[1:]):
        if d <= x1 or (x1, y1) == CURVE[-1]:
            lv = y0 + (y1 - y0) * (d - x0) / (x1 - x0)
            break
    lv += 4 * doubles + 3 * flicks
    lo, hi = RANGE[diff]
    return max(lo, min(hi, round(lv)))


def rate(song):
    base = f'songs/{song}'
    meta_path = f'{base}/meta.json'
    meta = json.load(open(meta_path))
    levels, prev = {}, 0
    for diff in DIFFS:
        path = f'{base}/{diff}.json'
        if not os.path.exists(path):
            continue
        notes = json.load(open(path)).get('notes') or []
        if not notes:
            continue
        levels[diff] = prev = max(prev + 1, level(notes, diff))
    meta['difficulties'] = levels
    with open(meta_path, 'w') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(song, levels)


if __name__ == '__main__':
    songs = sys.argv[1:] or json.load(open('songs/index.json'))['songs']
    for s in songs:
        rate(s)
