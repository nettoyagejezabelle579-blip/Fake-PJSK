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
                out.append(dict(s=to_s(s0), e=to_s(t), bs=s0 / m.ticks_per_beat, be=t / m.ticks_per_beat, p=x.note, v=v, tr=i))
    out = NoteList(sorted(out, key=lambda n: (n['s'], n['p'])))
    out.beat_to_s = lambda b: to_s(b * m.ticks_per_beat)   # follows the file's tempo map
    return out


class NoteList(list):
    pass


def onset_groups(notes, tol=0.03):
    groups = []
    for n in notes:
        if groups and n['s'] - groups[-1][0] <= tol:
            groups[-1][1].add(n['p'])
        else:
            groups.append([n['s'], {n['p']}])
    return groups


def time_warp(score, raw):
    """Score-time → audio-time map from pitch matching against the raw (audio-timed) transcription.
    1) global tempo scale + offset maximising same-pitch-class onsets within 35 ms;
    2) per-8-second-window offset correction (handles ritardandos / tempo changes that the
       score states differently from the recording), smoothed and linearly interpolated."""
    import numpy as np
    byp = {}
    for n in raw:
        byp.setdefault(n['p'] % 12, []).append(n['s'])
    byp = {p: np.array(sorted(v)) for p, v in byp.items()}
    pts = [(n['s'], n['p'] % 12) for n in score if n['tr'] == 1]

    def hits(a, b, sub, tol=0.035):
        c = 0
        for x, p in sub:
            A = byp.get(p)
            if A is None:
                continue
            t = a + b * x
            j = np.searchsorted(A, t)
            if (j < len(A) and abs(A[j] - t) < tol) or (j > 0 and abs(A[j - 1] - t) < tol):
                c += 1
        return c

    first = min(v[0] for v in byp.values()) - pts[0][0]
    coarse = pts[::3]
    _, a, b = max((hits(a, b, coarse), a, b) for b in np.arange(0.97, 1.0301, 0.0005)
                  for a in np.arange(first - 0.5, first + 0.5, 0.02))
    _, a, b = max((hits(a2, b2, pts), a2, b2) for b2 in np.arange(b - 0.0005, b + 0.00051, 0.0001)
                  for a2 in np.arange(a - 0.03, a + 0.031, 0.005))
    xs, offs, matched = [], [], 0
    end = pts[-1][0]
    for w0 in np.arange(0, end + 8, 8):
        sub = [q for q in pts if w0 <= q[0] < w0 + 8]
        if len(sub) < 8:
            continue
        h, da = max((hits(a + d, b, sub), -abs(d), d) for d in np.arange(-0.3, 0.3001, 0.005))[0::2]
        matched += h
        xs.append(w0 + 4); offs.append(da)
    sm = [sorted(offs[max(0, i - 1):i + 2])[len(offs[max(0, i - 1):i + 2]) // 2] for i in range(len(offs))]
    warp = lambda t: a + b * t + float(np.interp(t, xs, sm))
    return warp, matched, len(pts)


# Per difficulty: min gap between melody notes (beats), note width, hold threshold (beats),
# flick at phrase ends, doubles (extra simultaneous notes), bass fills in melody rests.
DIFFS = {  # hard = the transcription's melody as written; others simplify or add to it
    'easy':   dict(gap=1.0,  w=4, hold=1.0, flick=False, phrase=16, doubles=0, fill=0,   level=6),
    'normal': dict(gap=0.5,  w=3, hold=1.0, flick=True,  phrase=16, doubles=0, fill=0,   level=12),
    'hard':   dict(gap=0.25, w=3, hold=1.0, flick=True,  phrase=8,  doubles=2, fill=0,   level=19),
    'expert': dict(gap=0.25, w=3, hold=1.0, flick=True,  phrase=8,  doubles=0.5, fill=0.5, chord_only=True, level=24),
    'master': dict(gap=0.25, w=2, hold=1.0, flick=True,  phrase=4,  doubles=0.25, fill=0.25, level=28),
}


def build_exact(score, warp, audio_end, level, style='hard'):
    """One note per right-hand onset at its exact MIDI time (no grid, no thinning, no extra notes).
    Chords become one wider note; notes held >= 1 beat become holds; the last note of a phrase is a flick."""
    beat_s = lambda b: score.beat_to_s(b)
    groups = {}
    for n in score:
        if n['tr'] == 1:
            groups.setdefault(round(n['bs'], 3), []).append(n)
    onsets = sorted(groups)
    if style in ('easy', 'normal'):                                 # thin: keep >= 3/4 beat (normal) or 1.5 beats (easy) apart
        mg = 0.75 if style == 'normal' else 1.5
        kept = []
        for b in onsets:
            if kept and b - kept[-1] < mg - 1e-6:
                if b % 1 == 0 and kept[-1] % 1 != 0 and (len(kept) < 2 or b - kept[-2] >= mg - 1e-6):
                    kept[-1] = b                                    # prefer the on-beat note
                continue
            kept.append(b)
        onsets = kept
    ps = sorted(max(x['p'] for x in groups[b]) for b in onsets)
    lo, hi = ps[len(ps) // 20], ps[len(ps) * 19 // 20]
    out, last_col = [], 4
    for i, b in enumerate(onsets):
        g = groups[b]
        top = max(x['p'] for x in g)
        w = {'easy': 5, 'normal': 4}.get(style, 3 if len(g) == 1 or style != 'hard' else min(6, 3 + len(g) - 1))
        col = round((min(hi, max(lo, top)) - lo) / max(1, hi - lo) * (LANES - w))
        nxt = onsets[i + 1] if i + 1 < len(onsets) else b + 8
        gap = nxt - b
        reach = 2 if gap <= 0.26 else (3 if style in ('easy', 'normal') else 4) if gap <= 0.51 else LANES
        col = max(0, min(LANES - w, max(last_col - reach, min(last_col + reach, col))))
        dur = max(x['be'] for x in g) - b
        note = dict(t=round(min(warp(beat_s(b)), audio_end), 3), lane=col, w=w, type='tap')
        if dur >= 1 and gap >= dur - 0.05:
            note['type'] = 'hold'
            note['end'] = round(min(warp(beat_s(b + min(dur, gap) - 0.25)), audio_end), 3)
        elif dur < 1 and (gap >= 4 if style == 'easy' else gap >= 1.5 if style == 'normal' else gap >= 1 or (style != 'hard' and gap >= 0.5 and (b + gap) % 4 < 0.01)):
            note['type'] = 'flick'                                  # phrase end before a rest / bar line
        out.append(note)
        if style in ('expert', 'master') and len(g) > 1 and note['type'] == 'tap' and gap >= 0.25:
            m = LANES - col - w if abs(LANES - col - w - col) >= w else (col + w + 1 if col + 2 * w + 1 <= LANES else col - w - 1)
            if 0 <= m <= LANES - w:
                out.append(dict(t=note['t'], lane=m, w=w, type='tap'))   # chord → second note on the other side
        last_col = col
    if style in ('expert', 'master'):                               # left-hand notes where the melody rests
        rh = [beat_s(b) for b in onsets]
        holds = [(n['t'], n['end']) for n in out if n['type'] == 'hold']
        side = 0
        for b in sorted({round(n['bs'], 3) for n in score if n['tr'] == 2} - set(onsets)):
            x = beat_s(b)
            j = bisect.bisect_left(rh, x)
            near = min([abs(rh[k] - x) for k in (j - 1, j) if 0 <= k < len(rh)] or [9])
            t = round(min(warp(x), audio_end), 3)
            if near < (0.12 if style == 'master' else 0.2) or any(h0 - 0.1 <= t <= h1 + 0.1 for h0, h1 in holds):
                continue                                            # master: 16th-note fills too
            out.append(dict(t=t, lane=0 if side else LANES - 3, w=3, type='tap'))
            side ^= 1
    if style == 'master':                                           # bass on a beat or half-beat under a single melody note → two-hand double
        bass = {round(n['bs'], 3) for n in score if n['tr'] == 2}
        holds = [(n['t'], n['end']) for n in out if n['type'] == 'hold']
        taken = {}
        for n in out:
            taken[n['t']] = taken.get(n['t'], 0) + 1
        for n in list(out):
            b = next((x for x in onsets if abs(warp(beat_s(x)) - n['t']) < 0.002), None)
            if b is None or b % 0.5 or b not in bass or taken[n['t']] > 1 or n['type'] != 'tap' or any(h0 - 0.1 <= n['t'] <= h1 + 0.1 for h0, h1 in holds):
                continue
            m = LANES - n['lane'] - n['w'] if abs(LANES - 2 * n['lane'] - n['w']) >= n['w'] else (n['lane'] + n['w'] + 1 if n['lane'] + 2 * n['w'] + 1 <= LANES else n['lane'] - n['w'] - 1)
            if 0 <= m <= LANES - n['w']:
                out.append(dict(t=n['t'], lane=m, w=n['w'], type='tap'))
                taken[n['t']] = 2
    return sorted(out, key=lambda n: (n['t'], n['lane']))


def build(score, warp, beat, cfg, audio_end):
    q = lambda b: round(b * 4) / 4                 # quantize to 16ths (in beats, tempo-map aware)
    mel = {}
    for n in score:                                  # melody = top voice of track 1
        if n['tr'] != 1:
            continue
        b = q(n['bs'])
        if b not in mel or n['p'] > mel[b]['p']:
            mel[b] = dict(b=b, p=n['p'], dur=max(0.25, q(n['be']) - b), v=n['v'])
    mel = [mel[b] for b in sorted(mel)]
    bass = sorted({q(n['bs']) for n in score if n['tr'] == 2})
    chords = {b for b in {q(n['bs']) for n in score if n['tr'] == 1} if sum(1 for n in score if n['tr'] == 1 and q(n['bs']) == b) >= 2}
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
    to_t = lambda b: round(min(warp(score.beat_to_s(b)), audio_end), 3)   # nothing after the last sound
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
    if '--exact' in sys.argv:                          # follow the score note-for-note
        name = sys.argv[sys.argv.index('--exact') + 1]
        notes = build_exact(score, warp, max(n['e'] for n in raw) - 0.1, DIFFS[name]['level'], name)
        with open(f'{out_dir}/{name}.json', 'w') as f:
            json.dump(dict(lanes=LANES, bpm=round(bpm, 2), offset=0, notes=notes), f, separators=(',', ':'))
        kinds = {k: sum(n['type'] == k for n in notes) for k in ('tap', 'hold', 'flick')}
        print(f'{name} (exact) {len(notes)} notes {kinds}  last {max(n.get("end", n["t"]) for n in notes):.2f}s')
        return
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
