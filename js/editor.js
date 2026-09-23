// Chart editor: live recording (D F J K / pads), timeline drag/delete, beat snap, JSON export.
// Chart JSON: { offset, bpm, notes: [{ t, lane, type }] }; note time = offset + t (seconds).
(() => {
  const KEYS = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
  const LANE_COLORS = ['#3ce6d2', '#ff6ec7', '#ff6ec7', '#3ce6d2'];
  const PLAY_Y = 0.85;   // playhead position (fraction of canvas height)
  const NOTE_H = 16;
  const $ = (id) => document.getElementById(id);
  const cv = $('timeline');
  const g = cv.getContext('2d');

  let buffer = null;
  let notes = [];          // { t, lane } (t relative to offset)
  let selected = null;
  let playing = false;
  let viewTime = 0;        // song time at the playhead while stopped
  let pps = 200;           // pixels per second
  let drag = null;

  const bpm = () => Math.max(1, +$('bpm').value || 120);
  const offset = () => +$('offset').value || 0;
  const step = () => (60 / bpm()) * +$('snap').value;
  const snap = (t) => Math.round(t / step()) * step();
  const now = () => (playing ? AudioEngine.songTime() : viewTime);

  function laneW() { return cv.clientWidth / 4; }
  function timeToY(time) { return cv.clientHeight * PLAY_Y - (time - now()) * pps; }
  function yToTime(y) { return now() + (cv.clientHeight * PLAY_Y - y) / pps; }
  function xToLane(x) { return Math.min(3, Math.max(0, Math.floor(x / laneW()))); }

  function addNote(t, lane) {
    t = Math.max(0, snap(t));
    const dup = notes.find((n) => n.lane === lane && Math.abs(n.t - t) < 1e-4);
    if (dup) return dup;
    const n = { t, lane };
    notes.push(n);
    return n;
  }

  function deleteSelected() {
    if (!selected) return;
    notes = notes.filter((n) => n !== selected);
    selected = null;
  }

  function hitNote(x, y) {
    const lane = xToLane(x);
    let best = null, bestD = NOTE_H;
    for (const n of notes) {
      if (n.lane !== lane) continue;
      const d = Math.abs(timeToY(offset() + n.t) - y);
      if (d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  // ---- Song / chart loading ----
  async function loadIndex() {
    const idx = await (await fetch('songs/index.json')).json();
    for (const id of idx.songs) $('song').add(new Option(id, id));
  }

  async function load() {
    stop();
    await AudioEngine.init();
    const id = $('song').value, diff = $('diff').value;
    $('info').textContent = 'Loading…';
    const song = await AudioEngine.loadSong(id);
    buffer = song.buffer;
    let chart = null;
    try { chart = await (await fetch(`songs/${id}/${diff}.json`)).json(); } catch (e) { /* new chart */ }
    $('bpm').value = (chart && chart.bpm) || song.meta.bpm || 120;
    $('offset').value = (chart && chart.offset) || 0;
    notes = chart ? chart.notes.map((n) => ({ t: n.t, lane: n.lane })) : [];
    selected = null;
    viewTime = 0;
    $('play').disabled = $('rec').disabled = false;
  }

  // ---- Playback ----
  function play() {
    if (!buffer) return;
    const from = Math.min(Math.max(0, viewTime), buffer.duration);
    AudioEngine.play(buffer, 0.1, from);
    playing = true;
    $('play').textContent = 'Stop';
  }

  function stop() {
    if (!playing) return;
    viewTime = Math.max(0, AudioEngine.songTime());
    AudioEngine.stop();
    playing = false;
    $('play').textContent = 'Play';
  }

  // ---- Recording ----
  function press(lane, stamp) {
    const pad = document.querySelector(`.pad[data-lane="${lane}"]`);
    pad.classList.add('down');
    if (playing && $('rec').getAttribute('aria-pressed') === 'true') {
      selected = addNote(AudioEngine.songTimeAt(stamp) - offset(), lane);
    }
  }
  function release(lane) {
    document.querySelector(`.pad[data-lane="${lane}"]`).classList.remove('down');
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.code in KEYS) { if (!e.repeat) press(KEYS[e.code], e.timeStamp); e.preventDefault(); }
    else if (e.code === 'Space') { document.activeElement.blur(); playing ? stop() : play(); e.preventDefault(); }
    else if (e.code === 'Delete' || e.code === 'Backspace') { deleteSelected(); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (e.code in KEYS) release(KEYS[e.code]); });

  for (const pad of document.querySelectorAll('.pad')) {
    const lane = +pad.dataset.lane;
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); press(lane, e.timeStamp); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) pad.addEventListener(ev, () => release(lane));
  }

  // ---- Timeline: tap empty = add, drag note = move, drag empty = scroll, right-click = delete ----
  function pos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  cv.addEventListener('pointerdown', (e) => {
    if (!buffer || e.button === 2) return;
    const p = pos(e);
    const n = hitNote(p.x, p.y);
    cv.setPointerCapture(e.pointerId);
    selected = n;
    drag = { note: n, y0: p.y, view0: viewTime, moved: false };
  });

  cv.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = pos(e);
    if (Math.abs(p.y - drag.y0) > 6) drag.moved = true;
    if (drag.note) {
      drag.note.t = Math.max(0, snap(yToTime(p.y) - offset()));
      drag.note.lane = xToLane(p.x);
    } else if (!playing) {
      viewTime = Math.max(0, drag.view0 + (p.y - drag.y0) / pps);
    }
  });

  cv.addEventListener('pointerup', (e) => {
    if (drag && !drag.note && !drag.moved) {
      const p = pos(e);
      selected = addNote(yToTime(p.y) - offset(), xToLane(p.x));
    }
    drag = null;
  });
  cv.addEventListener('pointercancel', () => { drag = null; });

  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = pos(e);
    selected = hitNote(p.x, p.y);
    deleteSelected();
  });

  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey) pps = Math.min(1000, Math.max(50, pps * (e.deltaY > 0 ? 0.9 : 1.1)));
    else if (!playing) viewTime = Math.max(0, viewTime - e.deltaY / pps);
  }, { passive: false });

  // ---- Export ----
  function exportJSON() {
    const out = {
      offset: offset(),
      bpm: bpm(),
      notes: notes.slice().sort((a, b) => a.t - b.t || a.lane - b.lane)
        .map((n) => ({ t: +n.t.toFixed(3), lane: n.lane, type: 'tap' })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${$('diff').value}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- Drawing ----
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    cv.width = cv.clientWidth * dpr;
    cv.height = cv.clientHeight * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    const W = cv.clientWidth, H = cv.clientHeight, lw = laneW();
    if (playing && buffer && AudioEngine.songTime() > buffer.duration) stop();
    g.fillStyle = '#07070f';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#10101c' : '#141424';
      g.fillRect(i * lw, 0, lw, H);
    }

    // Beat grid at the current snap
    const st = step(), spb = 60 / bpm(), off = offset();
    const t0 = yToTime(H), t1 = yToTime(0);
    for (let k = Math.ceil((t0 - off) / st); off + k * st <= t1; k++) {
      const t = k * st, y = timeToY(off + t);
      const beat = Math.round(t / spb * 1000) / 1000;
      const onBeat = Number.isInteger(beat);
      g.strokeStyle = onBeat && beat % 4 === 0 ? '#fff' : onBeat ? '#777' : '#333';
      g.lineWidth = onBeat && beat % 4 === 0 ? 2 : 1;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }

    // Notes
    for (const n of notes) {
      const y = timeToY(off + n.t);
      if (y < -NOTE_H || y > H + NOTE_H) continue;
      g.fillStyle = LANE_COLORS[n.lane];
      g.fillRect(n.lane * lw + 6, y - NOTE_H / 2, lw - 12, NOTE_H);
      if (n === selected) {
        g.strokeStyle = '#ffe23c'; g.lineWidth = 4;
        g.strokeRect(n.lane * lw + 4, y - NOTE_H / 2 - 2, lw - 8, NOTE_H + 4);
      }
    }

    // Playhead
    g.fillStyle = '#ff3c6e';
    g.fillRect(0, H * PLAY_Y - 2, W, 4);

    const t = now();
    $('info').textContent = buffer
      ? `${t.toFixed(2)}s · beat ${((t - off) / spb).toFixed(2)} · ${notes.length} notes`
      : 'Choose a song and press Load';
    requestAnimationFrame(draw);
  }

  $('load').addEventListener('click', () => load().catch((e) => { $('info').textContent = 'Load failed: ' + e.message; }));
  $('play').addEventListener('click', () => (playing ? stop() : play()));
  $('rec').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', on);
  });
  $('del').addEventListener('click', deleteSelected);
  $('export').addEventListener('click', exportJSON);
  for (const id of ['song', 'diff', 'snap']) $(id).addEventListener('change', (e) => e.target.blur());

  window.addEventListener('resize', resize);
  resize();
  loadIndex();
  requestAnimationFrame(draw);
})();
