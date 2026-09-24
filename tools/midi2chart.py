#!/usr/bin/env python3
"""Generate 12-lane Project Sekai-style charts (easy..master) from a transcription.

Usage: python3 tools/midi2chart.py SCORE.mid RAW.mid OUT_DIR [--bpm 111] [--only expert,master]

SCORE.mid: quantized score MIDI (steady tempo, melody in track 1, bass in track 2).
RAW.mid:   raw transcription of the audio (its note times follow the audio file).
The score notes give the musical grid; the raw notes give where each note is heard in
the audio, so chart times are warped onto the audio. Charts end on the last melody note.
Needs: pip install mido
"""
import json, sys, bisect
import mido

LANES = 12


def read_notes(path):
    """Notes with absolute times (s), per track (tracks may share a MIDI channel)."""
    m = mido.MidiFile(path)
    tempos = []                                      # (tick, tempo) from every track's set_tempo
    for tr in m.tracks:
        t = 0
        for x in tr:
            t += x.time
            if x.type == 'set_tempo':
                tempos.append((t, x.tempo))
    tempos = sorted(tempos) or [(0, 500000)]
    secs, acc, (pt, pv) = [], 0.0, (0, tempos[0][1])
    for tk, tv in tempos:                            # seconds at each tempo change
        acc += mido.tick2second(tk - pt, m.ticks_per_beat, pv); secs.append((tk, acc, tv)); pt, pv = tk, tv
    ticks = [x[0] for x in secs]
    def to_s(tick):
        k = max(0, bisect.bisect_right(ticks, tick) - 1)
        tk, base, tv = secs[k]
        return base + mido.tick2second(tick - tk, m.ticks_per_beat, tv)
    out = []
    for i, tr in enumerate(m.tracks):
        t, on = 0, {}
        for x in tr:
            t += x.time
            if x.type == 'note_on' and x.velocity > 0:
                on[x.note] = (t, x.velocity)
            elif x.type in ('note_off', 'note_on') and x.note in on:
                s0, v = on.pop(x.note)
                out.append(dict(s=to_s(s0), e=to_s(t), p=x.note, v=v, tr=i))
    return sorted(out, key=lambda n: (n['s'], n['p']))


def onset_groups(notes, tol=0.03):
    groups = []
    for n in notes:
        if groups and n['s'] - groups[-1][0] <= tol:
            groups[-1][1].add(n['p'])
        else:
            groups.append([n['s'], {n['p']}])
    return groups


def time_warp(score, raw):
    """DTW over onset groups (pitch-set distance) → monotonic score-time → audio-time map."""
    A, B = onset_groups(score), onset_groups(raw)
    n, m, INF = len(A), len(B), float('inf')
    band = max(60, abs(n - m) + 40)
    D = [[INF] * (m + 1) for _ in range(n + 1)]
    D[0][0] = 0
    for i in range(1, n + 1):
        c = i * m // n
        for j in range(max(1, c - band), min(m, c + band) + 1):
            a, b = A[i - 1][1], B[j - 1][1]
            cost = 1 - len(a & b) / len(a | b)
            D[i][j] = cost + min(D[i - 1][j - 1], D[i - 1][j], D[i][j - 1])
    i, j, pairs = n, m, []
    while i > 0 and j > 0:
        if A[i - 1][1] == B[j - 1][1]:
            pairs.append((A[i - 1][0], B[j - 1][0]))
        k = min((D[i - 1][j - 1], 0), (D[i - 1][j], 1), (D[i][j - 1], 2))[1]
        i, j = (i - 1, j - 1) if k == 0 else (i - 1, j) if k == 1 else (i, j - 1)
    pairs.sort()
    # robust smoothing: median audio-minus-score offset over a sliding window of anchors
    xs = [p[0] for p in pairs]
    offs = [p[1] - p[0] for p in pairs]
    sm = []
    for k in range(len(pairs)):
        w = sorted(offs[max(0, k - 8):k + 9])
        sm.append(w[len(w) // 2])
    ys = [x + o for x, o in zip(xs, sm)]
    for k in range(1, len(ys)):  # keep monotonic
        ys[k] = max(ys[k], ys[k - 1] + 1e-3)

    def warp(t):
        k = bisect.bisect_left(xs, t)
        if k <= 0:
            return t + (ys[0] - xs[0])
        if k >= len(xs):
            return t + (ys[-1] - xs[-1])
        x0, x1, y0, y1 = xs[k - 1], xs[k], ys[k - 1], ys[k]
        return y0 + (y1 - y0) * (t - x0) / (x1 - x0) if x1 > x0 else y0
    return warp, len(pairs), len(A)


# Per difficulty: min gap between melody notes (beats), note width, hold threshold (beats),
# flick at phrase ends, doubles (extra simultaneous notes), bass fills in melody rests.
DIFFS = {  # hard = the transcription's melody as written; others simplify or add to it
    'easy':   dict(gap=1.0,  w=4, hold=1.0, flick=False, phrase=16, doubles=0, fill=0,   level=6),
    'normal': dict(gap=0.5,  w=3, hold=1.0, flick=True,  phrase=16, doubles=0, fill=0,   level=12),
    'hard':   dict(gap=0.25, w=3, hold=1.0, flick=True,  phrase=8,  doubles=2, fill=0,   level=19),
    'expert': dict(gap=0.25, w=3, hold=1.0, flick=True,  phrase=8,  doubles=0.5, fill=0.5, chord_only=True, level=24),
    'master': dict(gap=0.25, w=2, hold=1.0, flick=True,  phrase=4,  doubles=1, fill=0.5, level=28),
}


def build(score, warp, beat, cfg, audio_end):
    q = lambda t: round(t / beat * 4) / 4          # quantize to 16ths (in beats)
    mel = {}
    for n in score:                                  # melody = top voice of track 1
        if n['tr'] != 1:
            continue
        b = q(n['s'])
        if b not in mel or n['p'] > mel[b]['p']:
            mel[b] = dict(b=b, p=n['p'], dur=max(0.25, q(n['e']) - b), v=n['v'])
    mel = [mel[b] for b in sorted(mel)]
    bass = sorted({q(n['s']) for n in score if n['tr'] == 2})
    chords = {b for b in {q(n['s']) for n in score if n['tr'] == 1} if sum(1 for n in score if n['tr'] == 1 and q(n['s']) == b) >= 2}
    phrase_end = {n['b'] for i, n in enumerate(mel) if i + 1 == len(mel) or mel[i + 1]['b'] - (n['b'] + n['dur']) >= 1}

    # thin to the difficulty's minimum gap, preferring on-beat and louder notes
    keep = []
    for n in mel:
        if keep and n['b'] - keep[-1]['b'] < cfg['gap'] - 1e-6:
            prev = keep[-1]
            if (n['b'] % 1 == 0 and prev['b'] % 1 != 0) or (n['b'] % 1 == prev['b'] % 1 and n['v'] > prev['v'] + 20):
                keep[-1] = n
            continue
        keep.append(n)
    if cfg['gap'] <= 0.25:                            # cap 16th-note runs at 4 in a row
        out, run = [], 0
        for n in keep:
            run = run + 1 if out and n['b'] - out[-1]['b'] <= 0.25 else 0
            if run < 4:
                out.append(n)
        keep = out

    ps = sorted(n['p'] for n in keep)                 # spread the middle 80% of the range across the lanes
    lo, hi = ps[len(ps) // 10], ps[len(ps) * 9 // 10]
    w = cfg['w']
    notes, last_col, last_p, side = [], (LANES - w) // 2, None, 1
    for i, n in enumerate(keep):
        nxt = keep[i + 1]['b'] if i + 1 < len(keep) else n['b'] + 8
        span = nxt - n['b']
        # horizontal position follows pitch; repeated pitches step sideways; big jumps only with time
        col = round((min(hi, max(lo, n['p'])) - lo) / max(1, hi - lo) * (LANES - w))
        if last_p is not None and n['p'] == last_p:
            col = last_col + side * w
            if col < 0 or col > LANES - w:
                side = -side; col = last_col + side * w
        dt = n['b'] - (notes[-1]['b'] if notes else -8)
        reach = 2 if dt <= 0.25 else 4 if dt <= 0.5 else LANES
        col = max(last_col - reach, min(last_col + reach, col))
        col = max(0, min(LANES - w, col))
        typ, end = 'tap', None
        if n['dur'] >= cfg['hold'] and span >= n['dur']:
            typ, end = 'hold', n['b'] + max(0.5, min(n['dur'], span) - 0.25)
        elif cfg['flick'] and span >= 0.5 and (n['b'] in phrase_end or int(n['b'] // cfg['phrase']) != int(nxt // cfg['phrase'])):
            typ = 'flick'                            # last note before a rest or a phrase boundary
        notes.append(dict(b=n['b'], lane=col, w=w, type=typ, end=end))
        last_col, last_p = col, n['p']

    busy = lambda b: any(abs(x['b'] - b) < 0.2 or (x['end'] and x['b'] <= b <= x['end'] + 0.25) for x in notes)
    last_b = max(n['end'] or n['b'] for n in notes)
    extra = []
    if cfg['doubles']:                                # mirrored second note on strong beats
        for n in notes:
            if n['type'] == 'tap' and n['b'] % cfg['doubles'] == 0 and (n['b'] in chords if cfg.get('chord_only') else cfg['fill'] or n['b'] in chords):
                m = LANES - n['lane'] - n['w']
                in_hold = any(h['end'] and h['b'] - 0.1 <= n['b'] <= h['end'] + 0.25 and h is not n for h in notes)
                if abs(m - n['lane']) >= n['w'] and not in_hold:
                    extra.append(dict(b=n['b'], lane=m, w=n['w'], type='tap', end=None))
    if cfg['fill']:                                   # bass fills where the melody rests
        for b in bass:
            if b % cfg['fill'] == 0 and b < last_b and not busy(b) and not any(abs(x['b'] - b) < 0.2 for x in extra):
                extra.append(dict(b=b, lane=0 if int(b / cfg['fill']) % 2 else LANES - w, w=w, type='tap', end=None))
    notes = sorted(notes + extra, key=lambda n: (n['b'], n['lane']))
    to_t = lambda b: round(min(warp(b * beat), audio_end), 3)   # nothing after the last sound
    out = []
    for n in notes:
        o = dict(t=to_t(n['b']), lane=n['lane'], w=n['w'], type=n['type'])
        if n['end'] is not None:
            o['end'] = to_t(n['end'])
        out.append(o)
    return out


def main():
    score_path, raw_path, out_dir = sys.argv[1:4]
    bpm = float(sys.argv[sys.argv.index('--bpm') + 1]) if '--bpm' in sys.argv else None
    score, raw = read_notes(score_path), read_notes(raw_path)
    if bpm is None:
        tempo = next(x.tempo for x in mido.MidiFile(score_path).tracks[0] if x.type == 'set_tempo')
        bpm = 60e6 / tempo
    beat = 60 / bpm
    warp, anchors, groups = time_warp(score, raw)
    print(f'bpm {bpm:.2f}, {anchors}/{groups} onset groups anchored, audio span {warp(0):.2f}s → {warp(score[-1]["s"]):.2f}s')
    only = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else list(DIFFS)
    for name, cfg in DIFFS.items():
        if name not in only:
            continue
        notes = build(score, warp, beat, cfg, max(n['e'] for n in raw) - 0.1)
        chart = dict(lanes=LANES, bpm=round(bpm, 2), offset=0, notes=notes)
        with open(f'{out_dir}/{name}.json', 'w') as f:
            json.dump(chart, f, ensure_ascii=False, separators=(',', ':'))
        kinds = {k: sum(n['type'] == k for n in notes) for k in ('tap', 'hold', 'flick')}
        print(f'{name:7s} lv{cfg["level"]:>3} {len(notes):4d} notes {kinds}  last {max(n.get("end", n["t"]) for n in notes):.2f}s')


if __name__ == '__main__':
    main()
