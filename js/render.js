// Canvas drawing: perspective 4-lane highway, falling notes, judgment line, effects.
const Render = (() => {
  const LANES = 4;
  const LOOKAHEAD = 1.3 / (+new URLSearchParams(location.search).get('speed') || 1); // seconds visible; ?speed= from menu
  const PERSP = 5;       // perspective strength: scale at far end = 1 / (1 + PERSP)
  const NOTE_DEPTH = 0.012;
  const LANE_COLORS = ['#33e0ff', '#ff5fa8', '#ff5fa8', '#33e0ff'];
  const HOLD_COLOR = '#5cff9a', FLICK_COLOR = '#ff4d5e';
  const JUDGE_COLORS = { perfect: '#ffe45c', great: '#ff7ad9', good: '#5cd0ff', miss: '#9a9aa8' };

  // Effect tuning
  const FX = { glowFade: 0.15, particles: 10, partLife: 0.45, bounce: 0.18, bgDots: 14, bannerIn: 0.35 };

  let cv, g, W = 0, H = 0;
  let bg, dot;                                   // cached background + soft-dot sprite
  const rmq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(rmq && rmq.matches);
  if (rmq) (rmq.addEventListener ? rmq.addEventListener('change', (e) => { reduced = e.matches; }) : rmq.addListener((e) => { reduced = e.matches; }));
  const wasPressed = [0, 0, 0, 0], releaseAt = [-1e9, -1e9, -1e9, -1e9];
  let lastCombo = 0, comboAt = -1e9, lastNotes = null, doneAt = null;
  const rnd = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

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
    bg = document.createElement('canvas');
    bg.width = cv.width; bg.height = cv.height;
    const b = bg.getContext('2d');
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lg = b.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, '#1a0b3a'); lg.addColorStop(0.55, '#0b0b22'); lg.addColorStop(1, '#05050c');
    b.fillStyle = lg; b.fillRect(0, 0, W, H);
    const rg = b.createRadialGradient(W / 2, H * 0.1, 0, W / 2, H * 0.1, Math.max(W, H) * 0.6);
    rg.addColorStop(0, 'rgba(120,80,255,0.35)'); rg.addColorStop(1, 'rgba(120,80,255,0)');
    b.fillStyle = rg; b.fillRect(0, 0, W, H);
    if (!dot) {
      dot = document.createElement('canvas');
      dot.width = dot.height = 64;
      const d = dot.getContext('2d'), dg = d.createRadialGradient(32, 32, 0, 32, 32, 32);
      dg.addColorStop(0, 'rgba(255,255,255,1)'); dg.addColorStop(0.35, 'rgba(255,255,255,0.5)'); dg.addColorStop(1, 'rgba(255,255,255,0)');
      d.fillStyle = dg; d.fillRect(0, 0, 64, 64);
    }
  }

  // Animated stage: rotating light beams + drifting bokeh (static when reduced motion).
  function drawStage(t) {
    g.drawImage(bg, 0, 0, W, H);
    const at = reduced ? 0 : t;
    g.globalCompositeOperation = 'lighter';
    const L = Math.max(W, H) * 1.2;
    for (let i = 0; i < 4; i++) {
      const ox = W * (i < 2 ? 0.08 : 0.92), a = Math.PI / 2 + (i % 2 ? 1 : -1) * 0.35 + Math.sin(at * 0.6 + i * 1.7) * 0.3;
      const w = 0.06;
      g.beginPath();
      g.moveTo(ox, -10);
      g.lineTo(ox + Math.cos(a - w) * L, Math.sin(a - w) * L);
      g.lineTo(ox + Math.cos(a + w) * L, Math.sin(a + w) * L);
      g.closePath();
      g.fillStyle = i % 2 ? 'rgba(255,95,168,0.07)' : 'rgba(51,224,255,0.07)';
      g.fill();
    }
    for (let i = 0; i < FX.bgDots; i++) {
      const r = 10 + rnd(i, 1) * 40, sp = 0.02 + rnd(i, 2) * 0.05;
      const x = rnd(i, 3) * W + Math.sin(at * 0.3 + i) * 20;
      const y = (((rnd(i, 4) - at * sp) % 1) + 1) % 1 * (H + 2 * r) - r;
      g.globalAlpha = 0.12 + 0.1 * Math.sin(at * 1.3 + i * 2);
      g.drawImage(dot, x - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
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
    if (s.notes !== lastNotes) { lastNotes = s.notes; doneAt = null; lastCombo = s.combo; comboAt = -1e9; }
    if (s.combo > lastCombo) comboAt = t;
    lastCombo = s.combo;
    drawStage(t);

    // Highway
    const near = -0.035, far = 1.05;
    quad(G, near, far, -1, 1);
    g.fillStyle = 'rgba(18,18,42,0.9)';
    g.fill();

    // Pressed-lane glow (lane-colored, fades out on release)
    const top = proj(G, 0.6, 0).y, bot = proj(G, 0, 0).y;
    for (let l = 0; l < LANES; l++) {
      if (wasPressed[l] && !s.pressed[l]) releaseAt[l] = t;
      wasPressed[l] = s.pressed[l];
      const ra = t - releaseAt[l];
      const k = s.pressed[l] ? 1 : (ra >= 0 && ra < FX.glowFade ? 1 - ra / FX.glowFade : 0);
      if (!k) continue;
      g.globalAlpha = k;
      quad(G, near, 0.6, laneU(l), laneU(l + 1));
      const grad = g.createLinearGradient(0, bot, 0, top);
      grad.addColorStop(0, LANE_COLORS[l] + '88');
      grad.addColorStop(0.25, 'rgba(255,255,255,0.18)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fill();
      quad(G, near, 0.02, laneU(l), laneU(l + 1));
      g.fillStyle = LANE_COLORS[l];
      g.fill();
      g.globalAlpha = 1;
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
      if (n.type === 'tail') continue;
      const d = (n.time - t) / LOOKAHEAD;
      const inset = 0.04;
      if (n.type === 'hold' && n.tail.state === 0 && n.state !== 2) {
        const d0 = n.state === 1 ? 0 : Math.max(near, d), d1 = Math.min(far, (n.tail.time - t) / LOOKAHEAD);
        if (d1 > d0) {
          quad(G, d0, d1, laneU(n.lane) + inset * 2, laneU(n.lane + 1) - inset * 2);
          g.fillStyle = n.held ? 'rgba(92,255,154,0.6)' : 'rgba(92,255,154,0.35)';
          g.fill();
        }
      }
      if (n.state !== 0) continue;
      if (d > far || d < near - NOTE_DEPTH) continue;
      quad(G, d - NOTE_DEPTH, d + NOTE_DEPTH, laneU(n.lane) + inset, laneU(n.lane + 1) - inset);
      g.globalAlpha = Math.min(1, (far - d) * 6);
      g.fillStyle = n.type === 'hold' ? HOLD_COLOR : n.type === 'flick' ? FLICK_COLOR : LANE_COLORS[n.lane];
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = '#ffffff';
      g.stroke();
      if (n.type === 'flick') { // upward arrow above the note
        const c = proj(G, d + NOTE_DEPTH, (laneU(n.lane) + laneU(n.lane + 1)) / 2);
        const w = (G.half / LANES) * 0.5 * c.s;
        g.beginPath(); g.moveTo(c.x - w, c.y - 4 * c.s); g.lineTo(c.x, c.y - w * 1.2); g.lineTo(c.x + w, c.y - 4 * c.s);
        g.closePath(); g.fillStyle = FLICK_COLOR; g.fill(); g.stroke();
      }
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

    // Hit particles (stateless: derived from each effect's time + lane)
    if (!reduced) {
      g.globalCompositeOperation = 'lighter';
      const unit = G.half / LANES;
      for (const f of s.effects) {
        const age = t - f.time;
        if (age < 0 || age > FX.partLife) continue;
        const k = age / FX.partLife, c = proj(G, 0, (laneU(f.lane) + laneU(f.lane + 1)) / 2);
        const n = f.judge === 'perfect' ? FX.particles : FX.particles >> 1;
        g.fillStyle = JUDGE_COLORS[f.judge];
        g.globalAlpha = 1 - k;
        for (let i = 0; i < n; i++) {
          const seed = f.time * 97 + f.lane;
          const a = Math.PI * (1 + rnd(seed, i)), v = unit * (0.8 + rnd(i, seed) * 1.6);
          const x = c.x + Math.cos(a) * v * k, y = c.y + Math.sin(a) * v * k + unit * 1.2 * k * k;
          const sz = 4 + 6 * (1 - k);
          g.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        }
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
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
      const ca = t - comboAt;
      const bs = reduced || ca < 0 || ca > FX.bounce ? 1 : 1 + 0.22 * (1 - ca / FX.bounce) ** 2;
      g.save();
      g.translate(G.cx, H * 0.34);
      g.scale(bs, bs);
      g.font = `900 ${big * 1.4}px system-ui, sans-serif`;
      g.fillStyle = '#ffffff';
      g.fillText(String(s.combo), 0, 0);
      g.restore();
      g.font = `700 ${big * 0.45}px system-ui, sans-serif`;
      g.fillStyle = '#ffffff';
      g.fillText('COMBO', G.cx, H * 0.34 + big * 0.95);
    }

    // Full Combo / All Perfect
    const c = s.counts;
    if (doneAt === null && s.notes.length && c.perfect + c.great + c.good + c.miss >= s.notes.length) doneAt = t;
    if (doneAt !== null && !c.miss) drawClear(t - doneAt, !c.great && !c.good, G, big);

    // Score
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.font = `800 ${Math.max(22, big * 0.55)}px system-ui, sans-serif`;
    g.fillStyle = '#ffffff';
    g.fillText(String(s.score).padStart(7, '0'), 16, 16);
  }

  function drawClear(age, ap, G, big) {
    if (age < 0) return;
    const k = reduced ? 1 : Math.min(1, age / FX.bannerIn);
    const sc = reduced ? 1 : 1 + 0.6 * (1 - k) ** 3;
    const y = H * 0.5, bh = big * 1.9;
    g.globalAlpha = k;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, y - bh / 2, W, bh);
    if (!reduced) { // expanding rays + confetti burst
      g.globalCompositeOperation = 'lighter';
      const u = Math.min(W, H);
      for (let i = 0; i < 24; i++) {
        const a = rnd(i, 7) * Math.PI * 2, v = u * (0.2 + rnd(i, 8) * 0.5) * Math.min(1, age / 1.2);
        g.fillStyle = ap ? (i % 3 ? '#ffe45c' : '#ff7ad9') : (i % 2 ? '#33e0ff' : '#ffffff');
        g.globalAlpha = Math.max(0, 1 - age / 1.5);
        g.fillRect(G.cx + Math.cos(a) * v - 4, y + Math.sin(a) * v - 4 + age * age * 40, 8, 8);
      }
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = k;
    }
    g.save();
    g.translate(G.cx, y);
    g.scale(sc, sc);
    g.font = `900 ${big * 1.15}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText('ALL PERFECT').width / 2;
    const tg = g.createLinearGradient(-tw, 0, tw, 0);
    if (ap) { tg.addColorStop(0, '#ffe45c'); tg.addColorStop(0.5, '#ffffff'); tg.addColorStop(1, '#ff7ad9'); }
    else { tg.addColorStop(0, '#33e0ff'); tg.addColorStop(0.5, '#ffffff'); tg.addColorStop(1, '#5cff9a'); }
    g.lineWidth = 6; g.strokeStyle = '#000000';
    const label = ap ? 'ALL PERFECT' : 'FULL COMBO';
    g.strokeText(label, 0, 0);
    g.fillStyle = tg;
    g.fillText(label, 0, 0);
    g.restore();
    g.globalAlpha = 1;
  }

  return { init, draw, laneAtX, JUDGE_COLORS };
})();
