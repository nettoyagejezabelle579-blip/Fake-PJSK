// Canvas drawing: cover-window stage, perspective 4-lane highway, slab notes, judgment bar, hit effects, score/life HUD.
const Render = (() => {
  const LANES = 4;
  const PERSP = 5;       // perspective strength: scale at far end = 1 / (1 + PERSP)
  const NOTE_DEPTH = 0.0065;
  const JUDGE_COLORS = { perfect: '#ffe45c', great: '#ff7ad9', good: '#5cd0ff', miss: '#9a9aa8' };
  const JUDGE_GRAD = { perfect: ['#fff7a8', '#ff8ad8'], great: ['#ffd1f2', '#ff5fc4'], good: ['#d1f0ff', '#4fb4ff'], miss: ['#f2f2f7', '#a8a6b8'] };
  const FX_COLORS = { perfect: '#7ff4ff', great: '#ff9ae0', good: '#8fb8ff' };
  const NOTE_PAL = {
    tap: { top: '#ffffff', mid: '#dcd6ff', side: '#9fa8ff', edge: '#b3a4ff', cap: '#6474ff' },
    hold: { top: '#d9ffe9', mid: '#7cf0b0', side: '#2fbf7f', edge: '#4fe39a', cap: '#12a868' },
    flick: { top: '#fff0f7', mid: '#ffc2dd', side: '#ff6fa6', edge: '#ff8fbd', cap: '#ff3d86' },
  };
  // Score rank thresholds (score / max score); shared with the results screen.
  const RANKS = [['S', 0.9], ['A', 0.75], ['B', 0.6], ['C', 0.45], ['D', 0]];
  const RANK_COLORS = { S: '#ffd84a', A: '#ff7ad9', B: '#6fb6ff', C: '#b98bff', D: '#7ef2c8' };
  const FONT = '"M PLUS Rounded 1c", "Nunito", ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif';

  // Effect tuning
  const FX = { glowFade: 0.15, particles: 10, partLife: 0.45, bounce: 0.18, bgDots: 14, bannerIn: 0.35 };

  let cv, g, W = 0, H = 0, SA = { l: 0, t: 0, r: 0 }; // safe-area insets (px)
  let bg, dot, cover = null;                     // cached background, soft-dot sprite, song cover
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
    if (document.fonts) for (const w of [800, 900]) document.fonts.load(`${w} 20px "M PLUS Rounded 1c"`).catch(() => {});
  }

  function setCover(url) {
    const img = new Image();
    img.onload = () => { cover = img; if (cv) resize(); };
    img.src = url;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = cv.clientWidth;
    H = cv.clientHeight;
    const cs = getComputedStyle(document.documentElement);
    SA = { l: parseFloat(cs.getPropertyValue('--sal')) || 0, t: parseFloat(cs.getPropertyValue('--sat')) || 0, r: parseFloat(cs.getPropertyValue('--sar')) || 0 };
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    bg = document.createElement('canvas');
    bg.width = cv.width; bg.height = cv.height;
    const b = bg.getContext('2d');
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStage(b);
    if (!dot) {
      dot = document.createElement('canvas');
      dot.width = dot.height = 64;
      const d = dot.getContext('2d'), dg = d.createRadialGradient(32, 32, 0, 32, 32, 32);
      dg.addColorStop(0, 'rgba(255,255,255,1)'); dg.addColorStop(0.35, 'rgba(255,255,255,0.5)'); dg.addColorStop(1, 'rgba(255,255,255,0)');
      d.fillStyle = dg; d.fillRect(0, 0, 64, 64);
    }
  }

  function rrect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // Floating "app window" showing the song cover (title bar with _ □ × marks).
  function drawWindow(b, x, y, w, h, alpha) {
    const bar = Math.max(8, h * 0.09);
    b.globalAlpha = alpha;
    rrect(b, x - 5, y - bar, w + 10, h + bar + 5, 6);
    b.fillStyle = 'rgba(58,40,104,0.9)'; b.fill();
    b.strokeStyle = 'rgba(210,190,255,0.45)'; b.lineWidth = 2; b.stroke();
    b.strokeStyle = 'rgba(230,215,255,0.7)'; b.lineWidth = Math.max(1, bar * 0.14);
    const m = bar * 0.28, cy = y - bar / 2, xr = x + w - m;
    b.beginPath();
    b.moveTo(xr - m * 0.6, cy - m * 0.6); b.lineTo(xr + m * 0.6, cy + m * 0.6);
    b.moveTo(xr + m * 0.6, cy - m * 0.6); b.lineTo(xr - m * 0.6, cy + m * 0.6);
    b.rect(xr - m * 3.6, cy - m * 0.55, m * 1.1, m * 1.1);
    b.moveTo(xr - m * 6, cy + m * 0.55); b.lineTo(xr - m * 4.9, cy + m * 0.55);
    b.stroke();
    if (cover) {
      const k = Math.max(w / cover.width, h / cover.height), sw = w / k, sh = h / k;
      b.drawImage(cover, (cover.width - sw) / 2, (cover.height - sh) / 2, sw, sh, x, y, w, h);
    } else {
      const cg = b.createLinearGradient(x, y, x + w, y + h);
      cg.addColorStop(0, '#5fd7ff'); cg.addColorStop(1, '#ff6fb5');
      b.fillStyle = cg; b.fillRect(x, y, w, h);
    }
    b.fillStyle = 'rgba(40,20,90,0.18)'; b.fillRect(x, y, w, h);
    b.globalAlpha = 1;
  }

  function cloud(b, x, y, r) {
    b.beginPath();
    b.arc(x, y, r, Math.PI, 0); b.arc(x + r * 1.1, y + r * 0.2, r * 0.7, Math.PI, 0); b.arc(x - r * 1.05, y + r * 0.25, r * 0.6, Math.PI, 0);
    b.rect(x - r * 1.65, y + r * 0.25, r * 3.45, r * 0.45);
    b.fill();
  }

  // Static stage: purple gradient, equalizer arcs, clouds, shards, floating cover windows + floor reflection.
  function buildStage(b) {
    const lg = b.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, '#231444'); lg.addColorStop(0.45, '#1b1440'); lg.addColorStop(0.75, '#2a1650'); lg.addColorStop(1, '#40195c');
    b.fillStyle = lg; b.fillRect(0, 0, W, H);
    for (const [x, y, r, c] of [[0.97, 1, 0.55, 'rgba(230,80,220,0.5)'], [0.02, 1.02, 0.45, 'rgba(150,90,255,0.4)'], [0.5, 0.05, 0.6, 'rgba(110,80,230,0.25)']]) {
      const rg = b.createRadialGradient(W * x, H * y, 0, W * x, H * y, Math.max(W, H) * r);
      rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = rg; b.fillRect(0, 0, W, H);
    }
    // equalizer bars along a shallow arc, plus a dimmer mirrored band on the floor
    const cols = 70, cw = W / cols, seg = Math.max(3, H * 0.008);
    const EQ = ['#4fd0c8', '#5a7dff', '#8e6bff', '#46b5e6'];
    for (const [base, amp, alpha] of [[0.5, 0.22, 0.34], [0.8, 0.12, 0.14]]) {
      for (let i = 0; i < cols; i++) {
        const x = i * cw, e = (x - W / 2) / (W / 2), y = H * (base - 0.1 * (1 - e * e) * (base < 0.6 ? 1 : -1));
        const n = 3 + Math.floor(rnd(i, base * 10) * 14 * (0.4 + 0.6 * Math.abs(e)));
        b.fillStyle = EQ[i % EQ.length];
        b.globalAlpha = alpha;
        for (let k = 0; k < n; k++) b.fillRect(x + cw * 0.15, y - k * seg * 2, cw * 0.7, seg);
        if (amp && i % 9 === 0) { b.globalAlpha = alpha * 0.5; b.fillRect(x, y - H * amp, cw * 0.4, H * amp); }
      }
    }
    b.globalAlpha = 1;
    // shards and streaks
    const SH = ['#8a5cff', '#ff5fd0', '#4fd0c8', '#5a7dff'];
    for (let i = 0; i < 18; i++) {
      const x = rnd(i, 21) * W, y = rnd(i, 22) * H, r = (0.02 + rnd(i, 23) * 0.04) * Math.min(W, H) * 1.5, a = rnd(i, 24) * 6.3;
      b.globalAlpha = 0.18 + rnd(i, 25) * 0.25;
      b.fillStyle = SH[i % SH.length];
      b.beginPath();
      b.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      b.lineTo(x + Math.cos(a + 2.4) * r * 0.5, y + Math.sin(a + 2.4) * r * 0.5);
      b.lineTo(x + Math.cos(a + 3.9) * r * 0.6, y + Math.sin(a + 3.9) * r * 0.6);
      b.fill();
    }
    b.strokeStyle = '#8a7cff'; b.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const x = rnd(i, 31) * W, y = rnd(i, 32) * H * 0.7, l = H * (0.08 + rnd(i, 33) * 0.12);
      b.globalAlpha = 0.3; b.setLineDash([l * 0.25, l * 0.1]);
      b.beginPath(); b.moveTo(x, y); b.lineTo(x + l * 0.8, y - l * 0.6); b.stroke();
    }
    b.setLineDash([]);
    b.globalAlpha = 1;
    // clouds
    b.fillStyle = 'rgba(92,64,170,0.75)';
    const cu = Math.min(W, H);
    for (const [x, y, r] of [[0.24, 0.2, 0.05], [0.36, 0.16, 0.035], [0.73, 0.12, 0.06], [0.64, 0.21, 0.035], [0.87, 0.23, 0.045], [0.12, 0.26, 0.03]]) cloud(b, W * x, H * y, cu * r);
    // floating side windows
    const wu = Math.min(H * 0.3, W * 0.15);
    for (const [x, y, sc, al] of [[0.21, 0.2, 0.75, 0.55], [0.29, 0.29, 0.95, 0.8], [0.62, 0.05, 0.85, 0.75], [0.74, 0.26, 0.6, 0.45], [0.84, 0.2, 0.55, 0.3], [0.07, 0.4, 0.5, 0.3]]) {
      drawWindow(b, W * x, H * y, wu * sc * 1.25, wu * sc * 0.85, al);
    }
    // main cover window behind the far end of the highway, reflected on the floor
    const mw = Math.min(H * 0.44, W * 0.22), mx = W / 2 - mw / 2, my = H * 0.1;
    drawWindow(b, mx, my, mw, mw, 0.95);
    b.save();
    b.translate(0, (my + mw) * 2 + H * 0.12);
    b.scale(1, -1);
    drawWindow(b, mx, my, mw, mw, 0.28);
    b.restore();
    const fade = b.createLinearGradient(0, H * 0.55, 0, H);
    fade.addColorStop(0, 'rgba(27,20,64,0)'); fade.addColorStop(1, 'rgba(50,22,80,0.55)');
    b.fillStyle = fade; b.fillRect(0, H * 0.55, W, H * 0.45);
  }

  // Stage: cached background + slow drifting sparkles (static when reduced motion).
  function drawStage(t) {
    g.drawImage(bg, 0, 0, W, H);
    const at = reduced ? 0 : t;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < FX.bgDots; i++) {
      const r = 4 + rnd(i, 1) * 14, sp = 0.02 + rnd(i, 2) * 0.04;
      const x = rnd(i, 3) * W + Math.sin(at * 0.3 + i) * 20;
      const y = (((rnd(i, 4) - at * sp) % 1) + 1) % 1 * (H + 2 * r) - r;
      g.globalAlpha = 0.1 + 0.08 * Math.sin(at * 1.3 + i * 2);
      g.drawImage(dot, x - r, y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  function geo() {
    return { cx: W / 2, hy: -H * 0.02, jy: H * 0.8, half: Math.min((W - SA.l - SA.r) * 0.34, H * 0.8) };
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

  // Slab-style note: light top face, darker front edge, coloured end caps.
  function drawNote(G, d, lane, type, alpha) {
    const P = NOTE_PAL[type] || NOTE_PAL.tap;
    const u0 = laneU(lane) + 0.025, u1 = laneU(lane + 1) - 0.025;
    const a = proj(G, d - NOTE_DEPTH, u0), b = proj(G, d - NOTE_DEPTH, u1), c = proj(G, d + NOTE_DEPTH, u1), e = proj(G, d + NOTE_DEPTH, u0);
    const th = 7 * a.s;
    g.globalAlpha = alpha;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(b.x, b.y + th); g.lineTo(a.x, a.y + th); g.closePath();
    g.fillStyle = P.side; g.fill();
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(e.x, e.y); g.closePath();
    const fg = g.createLinearGradient(0, e.y, 0, a.y);
    fg.addColorStop(0, P.top); fg.addColorStop(1, P.mid);
    g.fillStyle = fg; g.fill();
    g.lineWidth = Math.max(1, 2.5 * a.s); g.strokeStyle = P.edge; g.stroke();
    const cw = (u1 - u0) * 0.07;
    g.fillStyle = P.cap;
    quad(G, d - NOTE_DEPTH * 0.45, d + NOTE_DEPTH * 0.45, u0 + cw * 0.5, u0 + cw * 1.5); g.fill();
    quad(G, d - NOTE_DEPTH * 0.45, d + NOTE_DEPTH * 0.45, u1 - cw * 1.5, u1 - cw * 0.5); g.fill();
    if (type === 'flick') {
      const m = proj(G, d + NOTE_DEPTH, (u0 + u1) / 2), w = (G.half / LANES) * 0.45 * m.s;
      g.beginPath(); g.moveTo(m.x - w, m.y - 3 * m.s); g.lineTo(m.x, m.y - w * 1.1); g.lineTo(m.x + w, m.y - 3 * m.s); g.closePath();
      g.fillStyle = P.cap; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, 2 * m.s); g.stroke();
    }
    g.globalAlpha = 1;
  }

  function star(x, y, r) {
    g.beginPath();
    g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r);
    g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.fill();
  }

  function diamond(x, y, r, flat) {
    g.beginPath(); g.moveTo(x, y - r * flat); g.lineTo(x + r, y); g.lineTo(x, y + r * flat); g.lineTo(x - r, y); g.closePath();
  }

  function draw(t, s) {
    const G = geo();
    if (s.notes !== lastNotes) { lastNotes = s.notes; doneAt = null; lastCombo = s.combo; comboAt = -1e9; }
    if (s.combo > lastCombo) comboAt = t;
    lastCombo = s.combo;
    drawStage(t);

    // Highway: translucent, running from the bottom edge to the vanishing point
    const near = (1 / ((H - G.hy) / (G.jy - G.hy)) - 1) / PERSP - 0.01, far = 1.05, farL = 8;
    const unit = G.half / LANES;
    quad(G, near, farL, -1, 1);
    const hg = g.createLinearGradient(0, H, 0, 0);
    hg.addColorStop(0, 'rgba(10,6,30,0.6)'); hg.addColorStop(0.5, 'rgba(10,6,30,0.4)'); hg.addColorStop(1, 'rgba(10,6,30,0.15)');
    g.fillStyle = hg; g.fill();

    // Pressed-lane glow (fades out on release)
    const top = proj(G, 0.6, 0).y, bot = proj(G, 0, 0).y;
    for (let l = 0; l < LANES; l++) {
      if (wasPressed[l] && !s.pressed[l]) releaseAt[l] = t;
      wasPressed[l] = s.pressed[l];
      const ra = t - releaseAt[l];
      const k = s.pressed[l] ? 1 : (ra >= 0 && ra < FX.glowFade ? 1 - ra / FX.glowFade : 0);
      if (!k) continue;
      g.globalAlpha = k;
      quad(G, 0, 0.6, laneU(l), laneU(l + 1));
      const grad = g.createLinearGradient(0, bot, 0, top);
      grad.addColorStop(0, 'rgba(140,200,255,0.35)'); grad.addColorStop(1, 'rgba(140,200,255,0)');
      g.fillStyle = grad; g.fill();
      g.globalAlpha = 1;
    }

    // Lane lines: bright edges, thin dividers
    for (let l = 0; l <= LANES; l++) {
      const a = proj(G, near, laneU(l)), b = proj(G, farL, laneU(l));
      g.strokeStyle = l === 0 || l === LANES ? 'rgba(255,255,255,0.75)' : l === LANES / 2 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.35)';
      g.lineWidth = l === 0 || l === LANES ? 2 : 1.3;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }

    // Judgment bar: glowing magenta frame split into 12 cells
    const j0 = -0.009, j1 = 0.011, ju = 1.03;
    quad(G, j0, j1, -ju, ju);
    g.fillStyle = 'rgba(8,4,22,0.62)'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1.2;
    for (let i = 1; i < 12; i++) {
      const u = -ju + (2 * ju * i) / 12, a = proj(G, j0, u), b = proj(G, j1, u);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    quad(G, j0, j1, -ju, ju);
    const jl = proj(G, 0, -ju).x, jr = proj(G, 0, ju).x;
    const jg = g.createLinearGradient(jl, 0, jr, 0);
    jg.addColorStop(0, '#b24dff'); jg.addColorStop(0.5, '#ff6ad5'); jg.addColorStop(1, '#b24dff');
    g.strokeStyle = jg; g.lineWidth = Math.max(3, H * 0.007);
    g.shadowColor = '#e05bff'; g.shadowBlur = 14;
    g.stroke();
    g.shadowBlur = 0;

    // Hold bodies, then chord lines, then notes (far to near so near ones draw on top)
    const LOOKAHEAD = Settings.noteTime(); // seconds visible, from saved note speed
    for (let i = s.notes.length - 1; i >= 0; i--) {
      const n = s.notes[i];
      if (n.type !== 'hold' || n.tail.state !== 0 || n.state === 2) continue;
      const d0 = n.state === 1 ? 0 : Math.max(near, (n.time - t) / LOOKAHEAD), d1 = Math.min(far, (n.tail.time - t) / LOOKAHEAD);
      if (d1 <= d0) continue;
      quad(G, d0, d1, laneU(n.lane) + 0.07, laneU(n.lane + 1) - 0.07);
      g.fillStyle = n.held ? 'rgba(110,255,190,0.5)' : 'rgba(110,255,190,0.3)';
      g.fill();
      if (d1 < far) drawNote(G, d1, n.lane, 'hold', 0.85);
    }
    let prev = null;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    for (const n of s.notes) {
      if (n.type === 'tail' || n.state !== 0) continue;
      const d = (n.time - t) / LOOKAHEAD;
      if (d > far) break;
      if (prev && Math.abs(prev.time - n.time) < 0.002 && d > near) {
        const a = proj(G, d, (laneU(prev.lane) + laneU(prev.lane + 1)) / 2), b = proj(G, d, (laneU(n.lane) + laneU(n.lane + 1)) / 2);
        g.lineWidth = Math.max(1, 3 * a.s);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      prev = n;
    }
    for (let i = s.notes.length - 1; i >= 0; i--) {
      const n = s.notes[i];
      if (n.type === 'tail' || n.state !== 0) continue;
      const d = (n.time - t) / LOOKAHEAD;
      if (d > far || d < near - NOTE_DEPTH) continue;
      drawNote(G, d, n.lane, n.type, Math.min(1, (far - d) * 6));
    }

    // Held holds: glowing block sitting on the judgment bar
    g.globalCompositeOperation = 'lighter';
    for (const n of s.notes) {
      if (n.type !== 'hold' || !n.held) continue;
      const pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 20);
      const u0 = laneU(n.lane) + 0.02, u1 = laneU(n.lane + 1) - 0.02;
      g.globalAlpha = 0.8 * pulse;
      quad(G, 0, 3, u0, u1);
      const c0 = proj(G, 0, 0).y, c1 = proj(G, 3, 0).y;
      const bg2 = g.createLinearGradient(0, c0, 0, c1);
      bg2.addColorStop(0, 'rgba(120,255,200,0.75)'); bg2.addColorStop(0.5, 'rgba(110,240,230,0.35)'); bg2.addColorStop(1, 'rgba(110,240,230,0.05)');
      g.fillStyle = bg2; g.fill();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.shadowColor = '#6dffb0'; g.shadowBlur = 18;
      drawNote(G, 0, n.lane, 'hold', 1);
      g.shadowBlur = 0;
      g.globalCompositeOperation = 'lighter';
      if (!reduced) {
        const c = proj(G, 0, (u0 + u1) / 2), unit = G.half / LANES, k = (t * 3) % 1;
        g.strokeStyle = '#ffffff'; g.globalAlpha = 0.8 * (1 - k); g.lineWidth = 2;
        diamond(c.x, c.y, unit * (0.3 + 0.6 * k), 0.45); g.stroke();
        g.globalAlpha = 1;
      }
    }
    g.globalAlpha = 1;

    // Hit effects: light beam, expanding diamonds, sparkles, rising shards
    for (const f of s.effects) {
      const age = t - f.time;
      if (age < 0 || age > 0.45) continue;
      const k = age / 0.45, col = FX_COLORS[f.judge];
      const c = proj(G, 0, (laneU(f.lane) + laneU(f.lane + 1)) / 2);
      g.globalAlpha = 0.6 * (1 - k);
      const bh = H * 0.5, bw0 = unit * 0.55, bw1 = unit * 0.95;
      const lg = g.createLinearGradient(0, c.y, 0, c.y - bh);
      lg.addColorStop(0, col); lg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(c.x - bw0, c.y); g.lineTo(c.x + bw0, c.y); g.lineTo(c.x + bw1 + unit * 0.25, c.y - bh); g.lineTo(c.x - bw1 + unit * 0.25, c.y - bh); g.closePath(); g.fill();
      if (reduced) continue;
      const r = unit * (0.45 + k * 1.1);
      g.globalAlpha = 1 - k;
      g.strokeStyle = '#ffffff'; g.lineWidth = 3 * (1 - k) + 1;
      diamond(c.x, c.y, r, 0.9); g.stroke();
      g.strokeStyle = col; diamond(c.x, c.y, r * 0.6, 0.9); g.stroke();
      g.fillStyle = '#ffffff'; star(c.x, c.y, unit * 0.4 * (1 - k * 0.7));
      for (let i = 0; i < FX.particles; i++) {
        const seed = f.time * 97 + f.lane;
        const px = c.x + (rnd(seed, i) - 0.5) * unit * 2.6 * (0.3 + k);
        const py = c.y - rnd(i, seed) * unit * 2 * k + unit * 0.2;
        g.fillStyle = i % 3 ? col : '#a8ffcf';
        diamond(px, py, 3 + 5 * (1 - k), 1); g.fill();
      }
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 3; i++) star(c.x + (rnd(i, f.time) - 0.5) * unit * 2.4, c.y - rnd(f.time, i) * unit * 2.4 * (0.3 + k), unit * 0.12 * (1 - k));
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // Judgement + combo
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const big = Math.max(22, H * 0.075);
    if (s.lastJudge && t - s.lastJudge.time < 0.6) {
      const j = s.lastJudge.judge, ja = t - s.lastJudge.time;
      const sc = reduced ? 1 : 1 + 0.25 * Math.max(0, 1 - ja / 0.08);
      g.save();
      g.translate(G.cx, H * 0.62);
      g.scale(sc, sc);
      const jb = Math.max(16, H * 0.05);
      g.font = `900 ${jb}px ${FONT}`;
      const label = j.toUpperCase(), tw = g.measureText(label).width / 2;
      let tg;
      if (j === 'perfect') {
        tg = g.createLinearGradient(-tw, -jb / 2, tw, jb / 2);
        ['#ffc4ec', '#fff3b0', '#c8fff0', '#b8d8ff', '#e8c8ff'].forEach((c, i, a) => tg.addColorStop(i / (a.length - 1), c));
      } else {
        const [c0, c1] = JUDGE_GRAD[j];
        tg = g.createLinearGradient(0, -jb / 2, 0, jb / 2);
        tg.addColorStop(0, c0); tg.addColorStop(1, c1);
      }
      g.lineWidth = jb * 0.14; g.strokeStyle = 'rgba(60,40,110,0.55)'; g.lineJoin = 'round';
      g.strokeText(label, 0, 0);
      g.fillStyle = tg; g.fillText(label, 0, 0);
      g.restore();
      if (j === 'great' || j === 'good') {
        const early = s.lastJudge.dt < 0;
        const jb = Math.max(16, H * 0.05);
        g.font = `800 ${jb * 0.5}px ${FONT}`;
        g.fillStyle = early ? '#7fd8ff' : '#ff9a6b';
        g.fillText(early ? 'EARLY' : 'LATE', G.cx, H * 0.62 + jb * 0.85);
      }
    }
    if (s.combo >= 2) {
      const ca = t - comboAt;
      const bs = reduced || ca < 0 || ca > FX.bounce ? 1 : 1 + 0.22 * (1 - ca / FX.bounce) ** 2;
      const cx = Math.min(W - SA.r - big * 1.8, G.cx + G.half * 1.18), cy = H * 0.44;
      // pale lavender fill, thin violet outline, soft violet glow (label and number share the look)
      const glowText = (txt, x, y, size) => {
        g.font = `900 ${size}px ${FONT}`;
        g.lineJoin = 'round';
        g.shadowColor = 'rgba(150,90,255,0.9)'; g.shadowBlur = size * 0.22;
        g.lineWidth = size * 0.07; g.strokeStyle = '#7b4dff';
        g.strokeText(txt, x, y);
        g.shadowBlur = 0;
        g.fillStyle = '#f5efff'; g.fillText(txt, x, y);
      };
      if ('letterSpacing' in g) g.letterSpacing = `${Math.round(big * 0.04)}px`;
      glowText('COMBO', cx, cy - big * 1.08, big * 0.4);
      if ('letterSpacing' in g) g.letterSpacing = '0px';
      g.save();
      g.translate(cx, cy);
      g.scale(bs, bs);
      glowText(String(s.combo), 0, 0, big * 1.55);
      g.restore();
    }

    // Full Combo / All Perfect
    const c = s.counts;
    if (doneAt === null && s.notes.length && c.perfect + c.great + c.good + c.miss >= s.notes.length) doneAt = t;
    if (doneAt !== null && !c.miss) drawClear(t - doneAt, !c.great && !c.good, G, big);

    drawHud(t, s);
  }

  // Top HUD: score rank tile, score bar with C/B/A/S pins, 8-digit score + gain; life bar (pause button is DOM).
  function drawHud(t, s) {
    // Laid out in reference units (rank tile = 273 wide), scaled by k.
    const k = Math.max(40, H * 0.1) / 273;
    const x0 = Math.max(SA.l + 8, W * 0.05), y0 = Math.max(0, SA.t);
    const X = (px) => x0 + (px - 105) * k, Y = (py) => y0 + py * k;
    const max = s.notes.length * 1000 || 1, ratio = Math.min(1, s.score / max);
    const rank = RANKS.find(([, m]) => ratio >= m)[0];
    const HUD_BG = '#5d5b8a', ink = 'rgba(40,36,80,0.85)';
    const outlined = (txt, x, y, lw, fill) => {
      g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = ink;
      g.shadowColor = 'rgba(255,255,255,0.35)'; g.shadowBlur = 6 * k * 3;
      g.strokeText(txt, x, y);
      g.shadowBlur = 0;
      g.fillStyle = fill; g.fillText(txt, x, y);
    };

    // capsule with folder tab, attached to the right of the rank tile
    rrect(g, X(420), Y(55), 310 * k, 80 * k, 20 * k);
    g.fillStyle = HUD_BG; g.fill();
    rrect(g, X(300), Y(100), 1560 * k, 150 * k, 75 * k);
    g.fill();
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = `900 ${75 * k}px ${FONT}`;
    outlined('SCORE', X(445), Y(125), 8 * k, '#fff');

    // bar: dark track, mint fill, C/B/A/S pins
    const bx = X(420), bw = 1405 * k, by = Y(148), bh = 60 * k;
    rrect(g, bx, by, bw, bh, bh / 2);
    g.fillStyle = '#33334e'; g.fill();
    if (ratio > 0) {
      g.save();
      rrect(g, bx, by, bw, bh, bh / 2); g.clip();
      const sg = g.createLinearGradient(bx, 0, bx + bw * ratio, 0);
      sg.addColorStop(0, '#6cf0bf'); sg.addColorStop(1, '#94f7e2');
      g.fillStyle = sg; g.fillRect(bx, by, bw * ratio, bh);
      g.restore();
    }
    g.textAlign = 'center';
    for (const [r, m] of RANKS) {
      if (!m) continue;
      const mx = bx + bw * m;
      g.fillStyle = '#fff';
      g.fillRect(mx - 4 * k, Y(95), 8 * k, 113 * k);
      g.beginPath(); g.moveTo(mx - 28 * k, Y(95)); g.lineTo(mx + 28 * k, Y(95)); g.lineTo(mx, Y(138)); g.closePath();
      g.lineWidth = 5 * k; g.strokeStyle = ink; g.stroke(); g.fill();
      g.font = `900 ${80 * k}px ${FONT}`;
      outlined(r, mx, Y(85), 10 * k, '#fff');
    }

    // rank tile (drawn over the capsule's left end)
    g.fillStyle = '#4c4a74'; g.fillRect(X(105), Y(0), 273 * k, 378 * k);
    g.fillStyle = RANK_COLORS[rank];
    g.font = `900 ${300 * k}px ${FONT}`;
    g.fillText(rank, X(241), Y(252));
    g.font = `900 ${44 * k}px ${FONT}`;
    g.fillText('SCORERANK', X(241), Y(342), 230 * k);

    // score digits (leading zeros dimmed) + last gain
    const str = String(s.score).padStart(8, '0'), lead = str.match(/^0*(?=.)/)[0];
    g.textAlign = 'left';
    g.font = `900 ${150 * k}px ${FONT}`;
    const sx = X(440), sy = Y(338);
    outlined(lead, sx, sy, 12 * k, '#c9c7e2');
    const lw0 = g.measureText(lead).width;
    outlined(str.slice(lead.length), sx + lw0, sy, 12 * k, '#fff');
    const sw = g.measureText(str).width;
    if (s.lastGain && t - s.lastGain.time < 0.6) {
      g.globalAlpha = 1 - (t - s.lastGain.time) / 0.6;
      g.font = `900 ${62 * k}px ${FONT}`;
      outlined('+', sx + sw + 18 * k, sy - 4 * k, 8 * k, '#bdbcd2');
      const pw = g.measureText('+').width;
      g.font = `900 ${88 * k}px ${FONT}`;
      outlined(String(s.lastGain.v), sx + sw + 22 * k + pw, sy, 8 * k, '#bdbcd2');
      g.globalAlpha = 1;
    }

    // life (right): solid capsule tucked under the DOM pause button, folder-tab label, heart + thick bar, value on the top edge
    const pb = Math.min(60, Math.max(40, H * 0.09));
    const pl = W - Math.max(SA.r + 8, W * 0.05) - pb, pcx = pl + pb / 2, pcy = Math.max(8, SA.t) + pb / 2;
    const ch = pb * 0.7, cy = pcy - ch / 2, cx0 = pcx - ch * 6.6;
    const life = Math.max(0, s.life ?? 1000), lk = life / 1000;
    const LIFE_BG = '#5d5b8a', lc = lk < 0.3 ? '#ff7b7b' : '#a3f0a0';
    const tabH = ch * 0.4, tabX = cx0 + ch * 0.9, tabW = ch * 1.5;
    rrect(g, tabX, cy - tabH, tabW, tabH + ch * 0.5, tabH * 0.45);
    g.fillStyle = LIFE_BG; g.fill();
    rrect(g, cx0, cy, pcx - cx0, ch, ch / 2);
    g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${ch * 0.42}px ${FONT}`;
    g.fillStyle = '#fff'; g.fillText('LIFE', tabX + tabW / 2, cy - tabH * 0.35);
    const hs = ch * 0.58, hx = cx0 + ch * 0.55, hy = cy + ch * 0.5;
    // classic parametric heart: x = 16 sin³t, y = 13 cos t − 5 cos 2t − 2 cos 3t − cos 4t
    const hk = hs * 1.05 / 32;
    g.fillStyle = lc;
    g.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const px = 16 * Math.sin(a) ** 3, py = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
      g[i ? 'lineTo' : 'moveTo'](hx + px * hk, hy - (py + 2.6) * hk);
    }
    g.closePath(); g.fill();
    const lx = cx0 + ch * 0.92, be = pl - ch * 0.35, lh = ch * 0.29, ly = hy - lh / 2;
    rrect(g, lx, ly, be - lx, lh, lh / 2);
    g.fillStyle = 'rgba(40,36,80,0.55)'; g.fill();
    if (lk > 0) { rrect(g, lx, ly, Math.max(lh, (be - lx) * lk), lh, lh / 2); g.fillStyle = lc; g.fill(); }
    g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.font = `900 ${ch * 0.62}px ${FONT}`;
    g.lineWidth = ch * 0.12; g.strokeStyle = 'rgba(40,36,80,0.9)'; g.lineJoin = 'round';
    g.strokeText(String(life), be, cy + ch * 0.2);
    g.fillStyle = '#fff'; g.fillText(String(life), be, cy + ch * 0.2);
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

  return { init, draw, laneAtX, setCover, JUDGE_COLORS, RANKS };
})();
