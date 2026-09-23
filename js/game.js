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
    pressed: new Array(LANES).fill(0),
  };

  function loadChart(chart) {
    state.notes = chart.notes
      .map((n) => ({ time: n.time, lane: n.lane, state: 0, judge: null }))
      .sort((a, b) => a.time - b.time);
    state.score = state.combo = state.maxCombo = 0;
    state.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    state.lastJudge = null;
    state.effects = [];
  }

  // Generated test chart matching AudioEngine.makeMetronome(bpm, beats, offset).
  function makeMetronomeChart(bpm, beats, offset) {
    const spb = 60 / bpm;
    const walk = [0, 1, 2, 3, 3, 2, 1, 0];
    const notes = [];
    for (let b = 8; b < beats - 4; b++) {
      const time = offset + b * spb;
      const bar = Math.floor(b / 4);
      notes.push({ time, lane: walk[b % 8] });
      if (bar >= 6 && bar < 10 && b % 4 === 0) notes.push({ time, lane: 3 - walk[b % 8] });
      if (bar >= 10) notes.push({ time: time + spb / 2, lane: walk[(b + 2) % 8] });
    }
    return { bpm, offset, notes };
  }

  function record(n, judge, t, dt = 0) {
    n.state = judge === 'miss' ? 2 : 1;
    n.judge = judge;
    state.counts[judge]++;
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

  // t: song time (audio clock) at which the press happened.
  function hit(lane, t) {
    for (const n of state.notes) {
      if (n.state !== 0 || n.lane !== lane) continue;
      const dt = t - n.time;
      if (dt > WINDOWS.good) continue;  // too late; update() will miss it
      if (dt < -WINDOWS.good) return;   // earliest candidate is still too far away
      const a = Math.abs(dt);
      record(n, a <= WINDOWS.perfect ? 'perfect' : a <= WINDOWS.great ? 'great' : 'good', t, dt);
      return;
    }
  }

  function update(t) {
    for (const n of state.notes) {
      if (n.time - t > 0) break;
      if (n.state === 0 && t - n.time > WINDOWS.good) record(n, 'miss', t);
    }
    state.effects = state.effects.filter((f) => t - f.time < 0.5);
    if (t > state.duration + 0.5) finish();
  }

  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const text = document.getElementById('overlay-text');
  const btn = document.getElementById('start-btn');

  function finish() {
    state.running = false;
    AudioEngine.stop();
    const c = state.counts;
    title.textContent = 'Results';
    text.textContent = `Score ${state.score}\nMax combo ${state.maxCombo}\n` +
      `Perfect ${c.perfect} · Great ${c.great} · Good ${c.good} · Miss ${c.miss}`;
    btn.textContent = 'RETRY';
    overlay.classList.remove('hidden');
  }

  async function start() {
    await AudioEngine.init();
    const bpm = 120, beats = 72, offset = 0.5;
    const buffer = AudioEngine.makeMetronome(bpm, beats, offset);
    loadChart(makeMetronomeChart(bpm, beats, offset));
    state.duration = buffer.duration;
    overlay.classList.add('hidden');
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
    (lane) => { state.pressed[lane] = Math.max(0, state.pressed[lane] - 1); },
  );
  btn.addEventListener('click', start);
  Render.draw(-10, state);
  requestAnimationFrame(frame);

  return { state, WINDOWS };
})();
