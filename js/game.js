// Game state, chart loading, judgement, score/combo, main loop.
const Game = (() => {
  // Timing windows (± seconds). Generous by design.
  const WINDOWS = { perfect: 0.060, great: 0.110, good: 0.160 };
  const POINTS = { perfect: 1000, great: 700, good: 300 };
  const LANES = 4;
  const LIFE_MAX = 1000, MISS_DAMAGE = 60; // no fail: life only shows how the run went

  const state = {
    notes: [], // { time, lane, state: 0 pending | 1 hit | 2 missed, judge }
    running: false,
    duration: 0,
    score: 0, combo: 0, maxCombo: 0, life: LIFE_MAX,
    lastGain: null,  // { v, time } for the +N next to the score
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    lastJudge: null, // { judge, time, dt }
    effects: [],     // { lane, judge, time }
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
    state.life = LIFE_MAX;
    state.lastGain = null;
    state.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    state.lastJudge = null;
    state.effects = [];
  }

  async function fetchChart(id, diff) {
    return (await fetch(`songs/${id}/${diff}.json`)).json();
  }

  // dt null = no input offset (miss, or hold tail auto-completed).
  function record(n, judge, t, dt = null) {
    n.state = judge === 'miss' ? 2 : 1;
    n.judge = judge;
    state.counts[judge]++;
    state.lastJudge = { judge, time: t, dt };
    if (judge === 'miss') {
      state.combo = 0;
      state.life = Math.max(0, state.life - MISS_DAMAGE);
      return;
    }
    state.combo++;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.score += POINTS[judge];
    state.lastGain = { v: POINTS[judge], time: t };
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
    // clear ~1 s after the last note is judged (or when the audio runs out)
    const judged = state.notes.length && state.notes.every((n) => n.state !== 0);
    if ((judged && t > state.lastTime + 1) || t > state.duration + 0.5) finish(t);
  }

  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const text = document.getElementById('overlay-text');
  const btn = document.getElementById('start-btn');
  const cover = document.getElementById('overlay-cover');
  const diffSelect = document.getElementById('diff-select');

  const DIFFS = ['easy', 'normal', 'hard', 'expert', 'master'];
  const q = new URLSearchParams(location.search);
  let songId = q.get('song') || 'demo';
  let songTitle = songId, songMeta = null;
  let diff = DIFFS.includes(q.get('diff')) ? q.get('diff') : 'normal';

  function selectDiff(d) {
    diff = d;
    for (const b of diffSelect.children) b.setAttribute('aria-pressed', b.dataset.diff === d);
  }

  async function showSong() {
    const meta = songMeta = await AudioEngine.loadMeta(songId);
    const levels = meta.difficulties || {};
    title.textContent = songTitle = meta.title;
    text.textContent = `${meta.artist} · ${meta.bpm} BPM\nKeys: D F J K (+Space = flick) · or tap, swipe up to flick`;
    if (meta.cover) { cover.src = `songs/${songId}/${meta.cover}`; cover.hidden = false; Render.setCover(cover.src); }
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
  const RANKS = Render.RANKS;

  const songsBtn = document.createElement('button');
  songsBtn.type = 'button';
  songsBtn.id = 'songs-btn';
  songsBtn.textContent = 'SONG SELECT';
  songsBtn.hidden = true;
  btn.after(songsBtn);
  songsBtn.addEventListener('click', toSongSelect);

  // Song over: stop judging, save best/clear, then the renderer plays the ending (clear banner → rank)
  // and frame() hands off to the result screen.
  let result = null;
  function finish(t) {
    state.running = false;
    document.body.classList.remove('playing');
    document.body.classList.add('ending');
    const ratio = state.notes.length ? state.score / (state.notes.length * POINTS.perfect) : 0;
    const rank = RANKS.find(([, min]) => ratio >= min)[0];
    let best = 0;
    try { // read by the song select (high score pill, clear diamonds)
      const k = `pjsk.best.${songId}.${diff}`;
      best = +localStorage.getItem(k) || 0;
      if (state.score > best) localStorage.setItem(k, state.score);
      localStorage.setItem(`pjsk.clear.${songId}.${diff}`, '1');
    } catch (e) { /* storage unavailable */ }
    result = {
      id: songId, meta: songMeta || { title: songTitle }, diff, score: state.score, best, ratio, rank,
      counts: { ...state.counts }, maxCombo: state.maxCombo,
      onRetry: start, onNext: toSongSelect,
    };
    state.ending = { at: t };
  }

  function showResult() {
    state.ending = null;
    document.body.classList.remove('ending');
    AudioEngine.stop();
    Menu.showResult(result);
  }

  async function start() {
    await AudioEngine.init();
    const [{ buffer }, chart] = await Promise.all([AudioEngine.loadSong(songId), fetchChart(songId, diff)]);
    loadChart(chart);
    Menu.hideResult();
    state.ending = null;
    const last = state.lastTime = state.notes.length ? state.notes[state.notes.length - 1].time : 0;
    state.duration = Math.max(buffer.duration, last + 1);
    overlay.classList.add('hidden');
    songsBtn.hidden = true;
    AudioEngine.play(buffer);
    state.running = true;
    paused = false;
    document.body.classList.add('playing');
  }

  function frame() {
    if (state.running) {
      const t = AudioEngine.songTime();
      update(t);
      Render.draw(t, state);
    } else if (state.ending) {
      const t = AudioEngine.songTime();
      Render.draw(t, state);
      if (t - state.ending.at > Render.END_A + Render.END_B) showResult();
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
  // Pause: suspends the AudioContext (the song clock), shows the overlay with Resume + Song Select.
  let paused = false;
  const pauseBtn = document.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.id = 'pause-btn';
  pauseBtn.setAttribute('aria-label', 'Pause');
  document.body.append(pauseBtn);
  async function pause() {
    if (!state.running) return;
    state.running = false;
    paused = true;
    document.body.classList.remove('playing');
    await AudioEngine.pause();
    title.textContent = 'PAUSED';
    text.textContent = '';
    btn.textContent = 'RESUME';
    songsBtn.hidden = false;
    overlay.classList.add('paused');
    overlay.classList.remove('hidden');
  }
  async function resume() {
    overlay.classList.add('hidden');
    overlay.classList.remove('paused');
    songsBtn.hidden = true;
    await AudioEngine.resume();
    paused = false;
    state.running = true;
    document.body.classList.add('playing');
  }
  pauseBtn.addEventListener('click', pause);
  window.addEventListener('keydown', (e) => { if (e.code === 'Escape') (paused ? resume() : pause()); });

  btn.addEventListener('click', () => (paused ? resume() : start()));
  // Deep link (?song=) keeps the START overlay: audio needs a tap on this page first.
  if (q.get('song')) showSong();

  // Song select → play without a page load, so the Decide tap itself unlocks audio.
  async function play(id, d) {
    songId = id;
    diff = DIFFS.includes(d) ? d : 'normal';
    const unlock = AudioEngine.init(); // must run inside the tap
    overlay.classList.add('hidden');
    history.replaceState(null, '', `?${new URLSearchParams({ song: id, diff })}`);
    await unlock;
    await showSong();
    await start();
  }

  function toSongSelect() { location.assign(location.pathname); }
  Render.draw(-10, state);
  requestAnimationFrame(frame);

  return { state, WINDOWS, play };
})();
