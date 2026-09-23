// Canvas drawing: perspective 4-lane highway, falling notes, judgment line, effects.
const Render = (() => {
  const LANES = 4;
  const LOOKAHEAD = 1.3; // seconds of chart visible above the judgment line
  const PERSP = 5;       // perspective strength: scale at far end = 1 / (1 + PERSP)
  const NOTE_DEPTH = 0.012;
  const LANE_COLORS = ['#33e0ff', '#ff5fa8', '#ff5fa8', '#33e0ff'];
  const JUDGE_COLORS = { perfect: '#ffe45c', great: '#ff7ad9', good: '#5cd0ff', miss: '#9a9aa8' };

  let cv, g, W = 0, H = 0;

  function init(canvas) {
    cv = canvas;
    g = cv.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = cv.clientWidth;
    H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function geo() {
    return { cx: W / 2, hy: H * 0.06, jy: H * 0.84, half: Math.min(W * 0.49, H * 0.62) };
  }

  // depth d: 0 = judgment line, 1 = far end. u: -1..1 across the highway.
  function proj(G, d, u) {
    const s = 1 / (1 + d * PERSP);
    return { x: G.cx + u * G.half * s, y: G.hy + (G.jy - G.hy) * s, s };
  }

  const laneU = (lane) => -1 + (2 * lane) / LANES;

  function quad(G, d0, d1, u0, u1) {
    const a = proj(G, d0, u0), b = proj(G, d0, u1), c = proj(G, d1, u1), e = proj(G, d1, u0);
    g.beginPath();
    g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(e.x, e.y);
    g.closePath();
  }

  function laneAtX(x) {
    const G = geo();
    const u = (x - G.cx) / G.half;
    return Math.max(0, Math.min(LANES - 1, Math.floor(((u + 1) / 2) * LANES)));
  }

  function draw(t, s) {
    const G = geo();
    g.fillStyle = '#07070f';
    g.fillRect(0, 0, W, H);

    // Highway
    const near = -0.035, far = 1.05;
    quad(G, near, far, -1, 1);
    g.fillStyle = '#12122a';
    g.fill();

    // Pressed-lane glow
    for (let l = 0; l < LANES; l++) {
      if (!s.pressed[l]) continue;
      quad(G, near, 0.6, laneU(l), laneU(l + 1));
      const top = proj(G, 0.6, 0).y, bot = proj(G, 0, 0).y;
      const grad = g.createLinearGradient(0, bot, 0, top);
      grad.addColorStop(0, 'rgba(255,255,255,0.28)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fill();
    }

    // Lane dividers
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    for (let l = 0; l <= LANES; l++) {
      const a = proj(G, near, laneU(l)), b = proj(G, far, laneU(l));
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }

    // Judgment line
    const jl = proj(G, 0, -1), jr = proj(G, 0, 1);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    g.shadowColor = '#33e0ff';
    g.shadowBlur = 16;
    g.beginPath(); g.moveTo(jl.x, jl.y); g.lineTo(jr.x, jr.y); g.stroke();
    g.shadowBlur = 0;

    // Notes (far to near so near ones draw on top)
    for (let i = s.notes.length - 1; i >= 0; i--) {
      const n = s.notes[i];
      if (n.state !== 0) continue;
      const d = (n.time - t) / LOOKAHEAD;
      if (d > far || d < near - NOTE_DEPTH) continue;
      const inset = 0.04;
      quad(G, d - NOTE_DEPTH, d + NOTE_DEPTH, laneU(n.lane) + inset, laneU(n.lane + 1) - inset);
      g.globalAlpha = Math.min(1, (far - d) * 6);
      g.fillStyle = LANE_COLORS[n.lane];
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = '#ffffff';
      g.stroke();
      g.globalAlpha = 1;
    }

    // Hit effects
    for (const f of s.effects) {
      const age = t - f.time;
      if (age < 0 || age > 0.35) continue;
      const k = age / 0.35;
      const c = proj(G, 0, (laneU(f.lane) + laneU(f.lane + 1)) / 2);
      const r = (G.half / LANES) * (0.4 + k * 0.8);
      g.globalAlpha = 1 - k;
      g.strokeStyle = JUDGE_COLORS[f.judge];
      g.lineWidth = 8 * (1 - k) + 2;
      g.beginPath(); g.ellipse(c.x, c.y, r, r * 0.4, 0, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }

    // Judgement + combo
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const big = Math.max(28, Math.min(W, H) * 0.08);
    if (s.lastJudge && t - s.lastJudge.time < 0.6) {
      g.font = `900 ${big}px system-ui, sans-serif`;
      g.fillStyle = JUDGE_COLORS[s.lastJudge.judge];
      g.fillText(s.lastJudge.judge.toUpperCase(), G.cx, H * 0.5);
      const j = s.lastJudge.judge;
      if (j === 'great' || j === 'good') {
        const early = s.lastJudge.dt < 0;
        g.font = `800 ${big * 0.5}px system-ui, sans-serif`;
        g.fillStyle = early ? '#5cd0ff' : '#ff8a5c';
        g.fillText(early ? 'EARLY' : 'LATE', G.cx, H * 0.5 + big * 0.8);
      }
    }
    if (s.combo >= 2) {
      g.font = `900 ${big * 1.4}px system-ui, sans-serif`;
      g.fillStyle = '#ffffff';
      g.fillText(String(s.combo), G.cx, H * 0.34);
      g.font = `700 ${big * 0.45}px system-ui, sans-serif`;
      g.fillText('COMBO', G.cx, H * 0.34 + big * 0.95);
    }

    // Score
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.font = `800 ${Math.max(22, big * 0.55)}px system-ui, sans-serif`;
    g.fillStyle = '#ffffff';
    g.fillText(String(s.score).padStart(7, '0'), 16, 16);
  }

  return { init, draw, laneAtX, JUDGE_COLORS };
})();
