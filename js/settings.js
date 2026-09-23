// Player settings (offset, note speed, lane brightness) persisted to localStorage,
// plus tap-along offset calibration timed on the Web Audio clock.
const Settings = (() => {
  const KEY = 'fakepjsk.settings';
  const DEFAULTS = { offset: 0, noteSpeed: 6, laneBrightness: 0.6 };
  const LIMITS = {
    offset: [-0.3, 0.3],       // seconds; judged time = songTimeAt(ts) - offset
    noteSpeed: [1, 12],
    laneBrightness: [0.1, 1],
  };

  // Calibration constants.
  const CAL_BPM = 100;
  const CAL_BEATS = 20;
  const CAL_SKIP = 4;          // lead-in beats, not scored
  const CAL_LEAD = 1;          // seconds of silence before beat 0

  let values = { ...DEFAULTS };

  function clamp(k, v) {
    const [lo, hi] = LIMITS[k];
    const c = Math.min(hi, Math.max(lo, +v || 0));
    return k === 'noteSpeed' ? Math.round(c * 10) / 10 : c;
  }

  // Note speed 1.0–12.0 → seconds a note is on screen: 6 s at 1.0, 0.5 s at 12.0, exponential between.
  function noteTime(speed = values.noteSpeed) {
    const [lo, hi] = LIMITS.noteSpeed;
    return 6 * Math.pow(0.5 / 6, (clamp('noteSpeed', speed) - lo) / (hi - lo));
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || '{}');
      for (const k in DEFAULTS) if (k in s) values[k] = clamp(k, s[k]);
    } catch (e) { /* storage unavailable */ }
    return values;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch (e) { /* storage unavailable */ }
  }

  function get(k) { return values[k]; }

  function set(k, v) {
    if (!(k in DEFAULTS)) return;
    values[k] = clamp(k, v);
    save();
  }

  function reset() { values = { ...DEFAULTS }; save(); }

  // --- Calibration: play a click track, collect taps, offset = median(tap - beat). ---
  let cal = null;

  async function startCalibration() {
    await AudioEngine.init();
    const spb = 60 / CAL_BPM;
    AudioEngine.play(AudioEngine.makeMetronome(CAL_BPM, CAL_BEATS, CAL_LEAD), 0.2);
    cal = { spb, taps: [], end: CAL_LEAD + CAL_BEATS * spb + 0.5 };
  }

  // eventTimeStamp: input event.timeStamp. Returns number of scored taps so far.
  function calibrationTap(eventTimeStamp) {
    if (!cal) return 0;
    const t = AudioEngine.songTimeAt(eventTimeStamp) - CAL_LEAD;
    const beat = Math.round(t / cal.spb);
    if (beat >= CAL_SKIP && beat < CAL_BEATS) cal.taps.push(t - beat * cal.spb);
    return cal.taps.length;
  }

  function calibrationDone() { return !!cal && AudioEngine.songTime() > cal.end; }

  // Stops calibration; applies and returns the new offset, or null if too few taps.
  function finishCalibration() {
    if (!cal) return null;
    AudioEngine.stop();
    const taps = cal.taps.sort((a, b) => a - b);
    cal = null;
    if (taps.length < 4) return null;
    const m = taps.length >> 1;
    const median = taps.length % 2 ? taps[m] : (taps[m - 1] + taps[m]) / 2;
    set('offset', median);
    return values.offset;
  }

  // --- Overlay panel ---
  function open(onClose) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.92);color:#fff;' +
      'font:bold 22px sans-serif;display:flex;flex-direction:column;gap:24px;padding:24px;overflow:auto';
    const btn = 'font:bold 24px sans-serif;min-height:64px;padding:0 24px;border:0;border-radius:12px;background:#3ee;color:#000';
    el.innerHTML = `
      <h2 style="margin:0;font-size:32px">Settings</h2>
      <label>Note speed: <span data-v="noteSpeed"></span>
        <input type="range" data-k="noteSpeed" min="1" max="12" step="0.1" style="width:100%;height:48px"></label>
      <label>Lane brightness: <span data-v="laneBrightness"></span>
        <input type="range" data-k="laneBrightness" min="0.1" max="1" step="0.05" style="width:100%;height:48px"></label>
      <label>Offset (ms): <span data-v="offset"></span>
        <input type="range" data-k="offset" min="-0.3" max="0.3" step="0.001" style="width:100%;height:48px"></label>
      <div data-cal style="min-height:28px">Tap along to the clicks to calibrate offset.</div>
      <button data-a="cal" style="${btn}">Calibrate</button>
      <button data-a="reset" style="${btn};background:#555;color:#fff">Reset</button>
      <button data-a="close" style="${btn};background:#fff">Done</button>`;
    const msg = el.querySelector('[data-cal]');
    let pad = null;

    function refresh() {
      el.querySelectorAll('input[data-k]').forEach(i => { i.value = values[i.dataset.k]; });
      el.querySelector('[data-v=noteSpeed]').textContent = values.noteSpeed.toFixed(1);
      el.querySelector('[data-v=laneBrightness]').textContent = Math.round(values.laneBrightness * 100) + '%';
      el.querySelector('[data-v=offset]').textContent = Math.round(values.offset * 1000);
    }

    el.addEventListener('input', e => {
      if (e.target.dataset.k) { set(e.target.dataset.k, e.target.value); refresh(); }
    });

    function endCal() {
      if (!pad) return;
      pad.remove(); pad = null;
      const off = finishCalibration();
      msg.textContent = off === null ? 'Not enough taps — try again.' : `Offset set to ${Math.round(off * 1000)} ms.`;
      refresh();
    }

    async function runCal() {
      pad = document.createElement('div');
      pad.style.cssText = 'position:fixed;inset:0;z-index:101;background:#123;display:flex;align-items:center;' +
        'justify-content:center;text-align:center;font:bold 36px sans-serif;touch-action:none;user-select:none';
      pad.textContent = 'Tap anywhere (or press any key) on every click';
      el.appendChild(pad);
      const tap = e => {
        e.preventDefault();
        const n = calibrationTap(e.timeStamp);
        pad.textContent = `Taps: ${n}`;
      };
      pad.addEventListener('pointerdown', tap);
      pad.tabIndex = 0;
      pad.addEventListener('keydown', e => { if (!e.repeat) tap(e); });
      pad.focus();
      await startCalibration();
      const poll = () => { if (!pad) return; if (calibrationDone()) endCal(); else requestAnimationFrame(poll); };
      requestAnimationFrame(poll);
    }

    el.addEventListener('click', e => {
      const a = e.target.dataset && e.target.dataset.a;
      if (a === 'cal') runCal();
      else if (a === 'reset') { reset(); refresh(); }
      else if (a === 'close') { endCal(); el.remove(); if (onClose) onClose(values); }
    });

    refresh();
    document.body.appendChild(el);
    return el;
  }

  load();
  return { DEFAULTS, load, save, get, set, reset, open, noteTime,
    startCalibration, calibrationTap, calibrationDone, finishCalibration };
})();
