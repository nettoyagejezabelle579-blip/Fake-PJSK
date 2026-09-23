// AudioContext, song loading/decoding, playback, and the song clock.
const AudioEngine = (() => {
  let ctx = null;
  let source = null;
  let startAt = 0; // ctx time at which song time 0 is played

  function init() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    return ctx.resume();
  }

  async function load(url) {
    const res = await fetch(url);
    return ctx.decodeAudioData(await res.arrayBuffer());
  }

  // Song folder songs/<id>/: meta.json + audio file named by meta.audio.
  // meta: { title, artist, cover, audio, bpm, difficulties: { easy, normal, hard } (levels) }
  async function loadMeta(id) {
    return (await fetch(`songs/${id}/meta.json`)).json();
  }

  async function loadSong(id) {
    const meta = await loadMeta(id);
    return { meta, buffer: await load(`songs/${id}/${meta.audio}`) };
  }

  // Click track: accented click every `beatsPerBar` beats, song time 0 = start of buffer.
  function makeMetronome(bpm, beats, offset, beatsPerBar = 4) {
    const sr = ctx.sampleRate;
    const spb = 60 / bpm;
    const len = Math.ceil((offset + beats * spb + 1) * sr);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const n = Math.floor(0.06 * sr);
    for (let b = 0; b < beats; b++) {
      const t0 = Math.round((offset + b * spb) * sr);
      const f = b % beatsPerBar === 0 ? 1760 : 880;
      for (let i = 0; i < n && t0 + i < len; i++) {
        const t = i / sr;
        d[t0 + i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 50) * 0.6;
      }
    }
    return buf;
  }

  // from: song position (seconds) to start playback at.
  function play(buffer, lead = 0.6, from = 0) {
    stop();
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const at = ctx.currentTime + lead;
    startAt = at - from;
    source.start(at, Math.max(0, from));
  }

  function stop() {
    if (!source) return;
    try { source.stop(); } catch (e) { /* not started */ }
    source.disconnect();
    source = null;
  }

  // Audio-clock time being heard at the speakers at performance-clock instant `perfMs`
  // (event.timeStamp / performance.now() domain), via getOutputTimestamp().
  function outputTimeAt(perfMs) {
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      if (ts.performanceTime > 0 && ts.contextTime > 0) {
        return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
      }
    }
    const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    return ctx.currentTime - latency - (performance.now() - perfMs) / 1000;
  }

  // Song position (seconds) as heard now.
  function songTime() { return outputTimeAt(performance.now()) - startAt; }

  // Song position (seconds) that was audible when an input event happened.
  function songTimeAt(eventTimeStamp) { return outputTimeAt(eventTimeStamp) - startAt; }

  return { init, load, loadMeta, loadSong, makeMetronome, play, stop, songTime, songTimeAt };
})();
