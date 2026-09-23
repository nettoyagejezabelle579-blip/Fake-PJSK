// Game state, chart loading, judgement, score/combo, main loop.
const Game = (() => {
  // Timing windows (± seconds). Generous by design.
  const WINDOWS = { perfect: 0.060, great: 0.110, good: 0.160 };
  const POINTS = { perfect: 1000, great: 700, good: 300 };
  const LANES = 4;

  const state = {
    notes: [], // { time, lane, state: 0 pending | 1 hit | 2 missed, judge }
    running: false,
    duration: 0,
    score: 0, combo: 0, maxCombo: 0,
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    lastJudge: null, // { judge, time, dt }
    effects: [],     // { lane, judge, time }
    log: [],         // per judged note: { time, tap, dt, judge, at }
    pressed: new Array(LANES).fill(0),
  };

  // Chart JSON: { offset, bpm, notes: [{ t, lane, type }] }; note time = offset + t (seconds).
  function loadChart(chart) {
    const off = chart.offset || 0;
    // Hold {t, end} → head note + 'tail' note (judged on release).
    const notes = [];
    for (const n of chart.notes) {
      const h = { time: off + n.t, lane: n.lane, type: n.type || 'tap', state: 0, judge: null };
      notes.push(h);
      if (h.type === 'hold') notes.push(h.tail = { time: off + n.end, lane: n.lane, type: 'tail', head: h, state: 0, judge: null });
    }
    state.notes = notes.sort((a, b) => a.time - b.time);
    state.score = state.combo = state.maxCombo = 0;
    state.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    state.lastJudge = null;
    state.effects = [];
    state.log = [];
  }

  async function fetchChart(id, diff) {
    return (await fetch(`songs/${id}/${diff}.json`)).json();
  }

  // dt null = no input offset (miss, or hold tail auto-completed).
  function record(n, judge, t, dt = null) {
    n.state = judge === 'miss' ? 2 : 1;
    n.judge = judge;
    state.counts[judge]++;
    state.log.push({ time: n.time, tap: dt == null ? null : t, dt, judge, at: new Date().toISOString() });
    state.lastJudge = { judge, time: t, dt };
    if (judge === 'miss') {
      state.combo = 0;
      return;
    }
    state.combo++;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.score += POINTS[judge];
    state.effects.push({ lane: n.lane, judge, time: t });
  }

  const grade = (a) => a <= WINDOWS.perfect ? 'perfect' : a <= WINDOWS.great ? 'great' : a <= WINDOWS.good ? 'good' : 'miss';

  // t: song time (audio clock) at which the press (or flick, if flick) happened.
  function hit(lane, t, flick = false) {
    for (const n of state.notes) {
      if (n.state !== 0 || n.lane !== lane || n.type === 'tail' || (n.type === 'flick') !== flick) continue;
      const dt = t - n.time;
      if (dt > WINDOWS.good) continue;  // too late; update() will miss it
      if (dt < -WINDOWS.good) return;   // earliest candidate is still too far away
      record(n, grade(Math.abs(dt)), t, dt);
      if (n.type === 'hold') n.held = true;
      return;
    }
  }

  // Lane fully released at song time t: judge any held hold's tail (early release).
  function release(lane, t) {
    for (const n of state.notes) {
      if (n.type !== 'tail' || n.state !== 0 || n.lane !== lane || !n.head.held) continue;
      n.head.held = false;
      record(n, grade(Math.abs(t - n.time)), t, t - n.time);
    }
  }

  function update(t) {
    for (const n of state.notes) {
      if (n.time - t > 0) break;
      if (n.state !== 0) continue;
      if (n.type === 'tail') {
        if (n.head.held) { n.head.held = false; record(n, 'perfect', t); }
        else if (n.head.state === 2) record(n, 'miss', t);
      } else if (t - n.time > WINDOWS.good) record(n, 'miss', t);
    }
    state.effects = state.effects.filter((f) => t - f.time < 0.5);
    if (t > state.duration + 0.5) finish();
  }

  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const text = document.getElementById('overlay-text');
  const btn = document.getElementById('start-btn');
  const cover = document.getElementById('overlay-cover');
  const diffSelect = document.getElementById('diff-select');

  const DIFFS = ['easy', 'normal', 'hard'];
  const q = new URLSearchParams(location.search);
  const songId = q.get('song') || 'demo';
  let songTitle = songId;
  let diff = DIFFS.includes(q.get('diff')) ? q.get('diff') : 'normal';

  function selectDiff(d) {
    diff = d;
    for (const b of diffSelect.children) b.setAttribute('aria-pressed', b.dataset.diff === d);
  }

  async function showSong() {
    const meta = await AudioEngine.loadMeta(songId);
    const levels = meta.difficulties || {};
    title.textContent = songTitle = meta.title;
    text.textContent = `${meta.artist} · ${meta.bpm} BPM\nKeys: D F J K (+Space = flick) · or tap, swipe up to flick`;
    if (meta.cover) { cover.src = `songs/${songId}/${meta.cover}`; cover.hidden = false; }
    const avail = DIFFS.filter((d) => d in levels);
    diffSelect.replaceChildren(...avail.map((d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'diff-btn';
      b.dataset.diff = d;
      b.innerHTML = `${d}<span>${levels[d]}</span>`;
      b.addEventListener('click', () => selectDiff(d));
      return b;
    }));
    selectDiff(avail.includes(diff) ? diff : avail[0] || diff);
  }

  // Rank by score / max possible score.
  const RANKS = [['S', 0.9], ['A', 0.8], ['B', 0.7], ['C', 0]];

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.id = 'export-btn';
  exportBtn.textContent = 'EXPORT CSV';
  exportBtn.hidden = true;
  btn.after(exportBtn);

  function exportCsv() {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const ms = (v) => v == null ? '' : (v * 1000).toFixed(1);
    const rows = [['song', 'difficulty', 'note_time', 'tap_time', 'offset_ms', 'judgment', 'timestamp']];
    for (const e of state.log) {
      rows.push([q(songTitle), diff, e.time.toFixed(3), e.tap == null ? '' : e.tap.toFixed(3), ms(e.dt), e.judge, e.at]);
    }
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n') + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${songId}_${diff}_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  exportBtn.addEventListener('click', exportCsv);

  function finish() {
    state.running = false;
    AudioEngine.stop();
    const c = state.counts;
    const ratio = state.notes.length ? state.score / (state.notes.length * POINTS.perfect) : 0;
    const rank = RANKS.find(([, min]) => ratio >= min)[0];
    const offs = state.log.filter((e) => e.dt != null).map((e) => e.dt);
    const avg = offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length * 1000 : 0;
    title.textContent = `Rank ${rank}`;
    text.textContent = `Score ${state.score}\nMax combo ${state.maxCombo}\n` +
      `Perfect ${c.perfect} · Great ${c.great} · Good ${c.good} · Miss ${c.miss}\n` +
      `Avg offset ${avg >= 0 ? '+' : ''}${avg.toFixed(1)} ms ${avg < 0 ? '(early)' : avg > 0 ? '(late)' : ''}`;
    btn.textContent = 'RETRY';
    exportBtn.hidden = false;
    overlay.classList.remove('hidden');
  }

  async function start() {
    await AudioEngine.init();
    const [{ buffer }, chart] = await Promise.all([AudioEngine.loadSong(songId), fetchChart(songId, diff)]);
    loadChart(chart);
    const last = state.notes.length ? state.notes[state.notes.length - 1].time : 0;
    state.duration = Math.max(buffer.duration, last + 1);
    overlay.classList.add('hidden');
    exportBtn.hidden = true;
    AudioEngine.play(buffer);
    state.running = true;
  }

  function frame() {
    if (state.running) {
      const t = AudioEngine.songTime();
      update(t);
      Render.draw(t, state);
    }
    requestAnimationFrame(frame);
  }

  Render.init(document.getElementById('stage'));
  Input.init(
    document.getElementById('stage'),
    (lane, stamp) => {
      state.pressed[lane]++;
      if (state.running) hit(lane, AudioEngine.songTimeAt(stamp));
    },
    (lane, stamp) => {
      state.pressed[lane] = Math.max(0, state.pressed[lane] - 1);
      if (state.running && !state.pressed[lane]) release(lane, AudioEngine.songTimeAt(stamp));
    },
    (lane, stamp) => { if (state.running) hit(lane, AudioEngine.songTimeAt(stamp), true); },
  );
  btn.addEventListener('click', start);
  showSong();
  Render.draw(-10, state);
  requestAnimationFrame(frame);

  return { state, WINDOWS };
})();
