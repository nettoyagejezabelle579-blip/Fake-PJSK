// Canvas drawing: cover-window stage, perspective 4-lane highway, slab notes, judgment bar, hit effects, score/life HUD.
const Render = (() => {
  const LANES = 12;      // Project Sekai-style columns; notes span n.w columns
  const SLOPE = 0.8;     // screen scale falls linearly with depth (1 at the line, 0.16 at the far end): notes move down the screen at a steady speed, like Project Sekai
  const NOTE_DEPTH = 0.02;
  const JUDGE_COLORS = { perfect: '#ffe45c', great: '#ff7ad9', good: '#5cd0ff', miss: '#9a9aa8' };
  const JUDGE_GRAD = { perfect: ['#fff7a8', '#ff8ad8'], great: ['#ffd1f2', '#ff5fc4'], good: ['#d1f0ff', '#4fb4ff'], miss: ['#f2f2f7', '#a8a6b8'] };
  const FX_COLORS = { perfect: '#7ff4ff', great: '#ff9ae0', good: '#8fb8ff' };
  const NOTE_PAL = {
    // white face, thick coloured rim, small caps at both ends, glow (Project Sekai look)
    tap: { face0: '#ffffff', face1: '#eef0ff', rim: '#b9a8ff', side: '#8a7ce8', cap: '#5f8dff', glow: '#b4a4ff' },
    hold: { face0: '#f2fff8', face1: '#d4fbe6', rim: '#7eefb4', side: '#3fcf86', cap: '#2fbf7f', glow: '#7dffc0' },
    flick: { face0: '#fff5fa', face1: '#ffe2ef', rim: '#ff8fbe', side: '#e0508c', cap: '#ff4f94', glow: '#ff8fc0' },
  };
  // Score rank thresholds (score / max score); shared with the results screen.
  const RANKS = [['S', 0.9], ['A', 0.75], ['B', 0.6], ['C', 0.45], ['D', 0]];
  const RANK_COLORS = { S: '#ffd84a', A: '#ff8fd8', B: '#8fb8ff', C: '#86f5f0', D: '#7ef2c8' };
  const FONT = '"M PLUS Rounded 1c", "Nunito", ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif';

  // Effect tuning
  const FX = { glowFade: 0.15, particles: 10, partLife: 0.45, bounce: 0.18, bgDots: 14, bannerIn: 0.35 };

  let cv, g, W = 0, H = 0, SA = { l: 0, t: 0, r: 0 }; // safe-area insets (px)
  let bg, dot, cover = null;                     // cached background, soft-dot sprite, song cover
  const rmq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(rmq && rmq.matches);
  if (rmq) (rmq.addEventListener ? rmq.addEventListener('change', (e) => { reduced = e.matches; }) : rmq.addListener((e) => { reduced = e.matches; }));
  const wasPressed = new Array(LANES).fill(0), releaseAt = new Array(LANES).fill(-1e9);
  let lastCombo = 0, comboAt = -1e9, lastNotes = null;
  const END_A = 2.1, END_B = 2.5; // ending: clear banner, then rank screen (seconds)
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
    const s = Math.max(0, 1 - d * SLOPE);
    return { x: G.cx + u * G.half * s, y: G.hy + (G.jy - G.hy) * s, s };
  }

  const laneU = (lane) => -1 + (2 * lane) / LANES;
  const midU = (n) => laneU(n.lane + (n.w || 1) / 2);

  function quad(G, d0, d1, u0, u1) {
    const a = proj(G, d0, u0), b = proj(G, d0, u1), c = proj(G, d1, u1), e = proj(G, d1, u0);
    g.beginPath();
    g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(e.x, e.y);
    g.closePath();
  }

  function laneAtX(x) {
    const G = geo();
    const u = (x - G.cx) / G.half;
    if (u < -1 || u >= 1) return -1; // outside the highway
    return Math.floor(((u + 1) / 2) * LANES);
  }

  // Slab-style note: light top face, darker front edge, coloured end caps.
  function drawNote(G, d, lane, w, type, alpha) {
    const P = NOTE_PAL[type] || NOTE_PAL.tap;
    const u0 = laneU(lane) + 0.012, u1 = laneU(lane + w) - 0.012;
    const pts = (d0, d1, v0, v1) => [proj(G, d0, v0), proj(G, d0, v1), proj(G, d1, v1), proj(G, d1, v0)];
    const path = (q) => { g.beginPath(); g.moveTo(q[0].x, q[0].y); for (let i = 1; i < 4; i++) g.lineTo(q[i].x, q[i].y); g.closePath(); };
    const q = pts(d - NOTE_DEPTH, d + NOTE_DEPTH, u0, u1), s0 = q[0].s;
    const rimW = Math.max(3, 9 * s0), th = 6 * s0;
    g.globalAlpha = alpha;
    g.lineJoin = 'round';
    // underside band (thickness)
    g.beginPath(); g.moveTo(q[0].x, q[0].y); g.lineTo(q[1].x, q[1].y); g.lineTo(q[1].x, q[1].y + th); g.lineTo(q[0].x, q[0].y + th); g.closePath();
    g.lineWidth = rimW; g.strokeStyle = P.side; g.stroke(); g.fillStyle = P.side; g.fill();
    // glowing coloured rim (thick round-joined stroke gives rounded corners)
    path(q);
    g.shadowColor = P.glow; g.shadowBlur = 16 * s0;
    g.lineWidth = rimW; g.strokeStyle = P.rim; g.stroke(); g.fillStyle = P.rim; g.fill();
    g.shadowBlur = 0;
    // white face
    const iu = (u1 - u0) * 0.012;
    const f = pts(d - NOTE_DEPTH * 0.55, d + NOTE_DEPTH * 0.55, u0 + iu, u1 - iu);
    path(f);
    const fg = g.createLinearGradient(0, f[3].y, 0, f[0].y);
    fg.addColorStop(0, P.face0); fg.addColorStop(1, P.face1);
    g.lineWidth = Math.max(1, 3 * s0); g.strokeStyle = P.face0; g.stroke();
    g.fillStyle = fg; g.fill();
    // end caps
    const cw = Math.min(0.05, (u1 - u0) * 0.08);
    g.fillStyle = P.cap;
    for (const [v0, v1] of [[u0 + cw * 0.4, u0 + cw * 1.4], [u1 - cw * 1.4, u1 - cw * 0.4]]) {
      path(pts(d - NOTE_DEPTH * 0.4, d + NOTE_DEPTH * 0.4, v0, v1));
      g.lineWidth = Math.max(1, 2 * s0); g.strokeStyle = P.cap; g.stroke(); g.fill();
    }
    if (type === 'flick') { // arrow above the note
      const m = proj(G, d + NOTE_DEPTH, (u0 + u1) / 2), aw = Math.min(0.25, (u1 - u0) * 0.22) * G.half * m.s;
      g.beginPath(); g.moveTo(m.x - aw, m.y - 4 * m.s); g.lineTo(m.x, m.y - aw * 1.2); g.lineTo(m.x + aw, m.y - 4 * m.s); g.closePath();
      g.shadowColor = P.glow; g.shadowBlur = 10 * m.s;
      g.fillStyle = P.cap; g.fill(); g.shadowBlur = 0;
      g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.5, 3 * m.s); g.stroke();
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
    if (s.notes !== lastNotes) { lastNotes = s.notes; lastCombo = s.combo; comboAt = -1e9; }
    if (s.ending && t - s.ending.at >= END_A) { drawEndingRank(t - s.ending.at - END_A, s); return; }
    if (s.combo > lastCombo) comboAt = t;
    lastCombo = s.combo;
    drawStage(t);

    // Highway: translucent, running from the bottom edge to the vanishing point
    const near = (1 - (H - G.hy) / (G.jy - G.hy)) / SLOPE - 0.01, far = 1.05, farL = 1 / SLOPE;
    quad(G, near, farL, -1, 1);
    const hg = g.createLinearGradient(0, H, 0, 0);
    hg.addColorStop(0, 'rgba(10,6,30,0.78)'); hg.addColorStop(0.5, 'rgba(10,6,30,0.74)'); hg.addColorStop(1, 'rgba(10,6,30,0.7)');
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
    for (let l = 0; l <= LANES; l += 2) {
      const a = proj(G, near, laneU(l)), b = proj(G, farL, laneU(l));
      g.strokeStyle = l === 0 || l === LANES ? 'rgba(255,255,255,0.75)' : l === LANES / 2 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.35)';
      g.lineWidth = l === 0 || l === LANES ? 2 : 1.3;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }

    // Judgment bar: glowing magenta frame split into 12 cells
    const j0 = -0.035, j1 = 0.04, ju = 1.03;
    quad(G, j0, j1, -ju, ju);
    g.fillStyle = 'rgba(8,4,22,0.62)'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1.2;
    for (let i = 1; i < 12; i++) {
      const u = laneU(i), a = proj(G, j0, u), b = proj(G, j1, u);
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
      quad(G, d0, d1, laneU(n.lane) + 0.035, laneU(n.lane + n.w) - 0.035);
      g.fillStyle = n.held ? 'rgba(125,245,190,0.55)' : 'rgba(125,245,190,0.38)';
      g.fill();
      if (d1 < far) drawNote(G, d1, n.lane, n.w, 'hold', 0.85);
    }
    let prev = null;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    for (const n of s.notes) {
      if (n.type === 'tail' || n.state !== 0) continue;
      const d = (n.time - t) / LOOKAHEAD;
      if (d > far) break;
      if (prev && Math.abs(prev.time - n.time) < 0.002 && d > near) {
        const a = proj(G, d, midU(prev)), b = proj(G, d, midU(n));
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
      drawNote(G, d, n.lane, n.w, n.type, Math.min(1, (far - d) * 6));
    }

    // Held holds: glowing block sitting on the judgment bar
    g.globalCompositeOperation = 'lighter';
    for (const n of s.notes) {
      if (n.type !== 'hold' || !n.held) continue;
      const pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * 20);
      const u0 = laneU(n.lane) + 0.01, u1 = laneU(n.lane + n.w) - 0.01;
      g.globalAlpha = 0.8 * pulse;
      quad(G, 0, 3, u0, u1);
      const c0 = proj(G, 0, 0).y, c1 = proj(G, 3, 0).y;
      const bg2 = g.createLinearGradient(0, c0, 0, c1);
      bg2.addColorStop(0, 'rgba(120,255,200,0.75)'); bg2.addColorStop(0.5, 'rgba(110,240,230,0.35)'); bg2.addColorStop(1, 'rgba(110,240,230,0.05)');
      g.fillStyle = bg2; g.fill();
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.shadowColor = '#6dffb0'; g.shadowBlur = 18;
      drawNote(G, 0, n.lane, n.w, 'hold', 1);
      g.shadowBlur = 0;
      g.globalCompositeOperation = 'lighter';
      if (!reduced) {
        const c = proj(G, 0, (u0 + u1) / 2), unit = G.half * n.w / LANES, k = (t * 3) % 1;
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
      const c = proj(G, 0, midU(f)), unit = G.half * (f.w || 3) / LANES; // effect size follows note width
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

    drawHud(t, s);
    if (s.ending) drawClearBanner(t - s.ending.at, s);
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
    // round lobes + pointed tip as one path; the lower curves leave each lobe along its tangent (no side notches)
    const H_ = (x, y) => [hx + x * hs, hy + y * hs], A0 = Math.PI * 0.8, A1 = Math.PI * 0.2;
    const tip = H_(0, 0.45), lp = H_(-0.25 + 0.27 * Math.cos(A0), -0.13 + 0.27 * Math.sin(A0)), rp = H_(0.25 + 0.27 * Math.cos(A1), -0.13 + 0.27 * Math.sin(A1));
    const tx = 0.15 * Math.sin(A0) * hs, ty = 0.15 * Math.cos(A0) * hs;
    g.fillStyle = lc;
    g.beginPath();
    g.moveTo(...tip);
    g.bezierCurveTo(tip[0] - hs * 0.17, tip[1] - hs * 0.11, lp[0] + tx, lp[1] - ty, lp[0], lp[1]);
    g.arc(hx - hs * 0.25, hy - hs * 0.13, hs * 0.27, A0, Math.PI * 2);
    g.arc(hx + hs * 0.25, hy - hs * 0.13, hs * 0.27, Math.PI, Math.PI * 2 + A1);
    g.bezierCurveTo(rp[0] - tx, rp[1] - ty, tip[0] + hs * 0.17, tip[1] - hs * 0.11, tip[0], tip[1]);
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

  const clearLabel = (c) => (!c.miss && !c.good && !c.great ? 'ALL PERFECT!' : !c.miss ? 'FULL COMBO!' : 'LIVE CLEAR!');

  function labelFill(label, x, w) {
    if (label === 'LIVE CLEAR!') return '#fff6e8';
    const lg = g.createLinearGradient(x - w, 0, x + w, 0);
    const stops = label === 'ALL PERFECT!' ? ['#ffc4ec', '#fff3b0', '#c8fff0', '#b8d8ff', '#e8c8ff'] : ['#8ff4ff', '#ffffff', '#ffc9ef'];
    stops.forEach((c, i) => lg.addColorStop(i / (stops.length - 1), c));
    return lg;
  }

  // Ending stage 1: dim the stage, pop the clear label in, twinkling sparkles.
  function drawClearBanner(age, s) {
    const k = Math.min(1, age / 0.3);
    g.fillStyle = `rgba(12,8,35,${0.5 * k})`; g.fillRect(0, 0, W, H);
    const label = clearLabel(s.counts), size = Math.min(H * 0.19, W * 0.085);
    const sc = reduced ? 1 : 1 + 0.35 * (1 - k) ** 3;
    g.save();
    g.translate(W / 2, H * 0.5);
    g.scale(sc, sc);
    g.globalAlpha = k;
    g.font = `900 ${size}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText(label).width / 2;
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = size * 0.15;
    g.fillStyle = labelFill(label, 0, tw);
    g.fillText(label, 0, 0);
    g.restore();
    if (!reduced) sparkles(age, 0.9);
    g.globalAlpha = 1;
  }

  function sparkles(age, a) {
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 22; i++) {
      const tw = 0.5 + 0.5 * Math.sin(age * 5 + i * 1.7);
      g.globalAlpha = a * tw;
      star(rnd(i, 41) * W, rnd(i, 42) * H, (2 + rnd(i, 43) * 5) * (0.6 + tw * 0.6));
    }
    g.globalAlpha = 1;
  }

  // Ending stage 2: indigo screen, clear label with outlined echoes, score bar filling, rank tile.
  function drawEndingRank(age, s) {
    const lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, '#2c2a56'); lg.addColorStop(0.6, '#34305f'); lg.addColorStop(1, '#43306a');
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.22; g.drawImage(bg, 0, 0, W, H); g.globalAlpha = 1;
    const rg = g.createRadialGradient(W * 0.85, H, 0, W * 0.85, H, W * 0.5);
    rg.addColorStop(0, 'rgba(170,80,200,0.35)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
    const fade = Math.min(1, age / 0.3);

    const label = clearLabel(s.counts), size = Math.min(H * 0.19, W * 0.07);
    const cx = W * 0.435, cy = H * 0.47;
    g.font = `900 ${size}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText(label).width / 2;
    g.globalAlpha = 0.3 * fade; g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
    for (const dy of [-0.15, 0.15]) g.strokeText(label, cx, cy + H * dy);
    g.globalAlpha = fade;
    g.fillStyle = label === 'LIVE CLEAR!' ? '#ffffff' : labelFill(label, cx, tw);
    g.fillText(label, cx, cy);

    // score bar
    const max = s.notes.length * 1000 || 1, ratio = Math.min(1, s.score / max);
    const fillK = reduced ? 1 : Math.min(1, Math.max(0, (age - 0.3) / 1.1));
    const ease = 1 - (1 - fillK) ** 3;
    const bx = W * 0.155, bw = W * 0.575, by = H * 0.64, bh = H * 0.036;
    rrect(g, bx, by, bw, bh, bh / 2);
    g.fillStyle = '#2a2848'; g.fill();
    if (ratio * ease > 0) {
      g.save(); rrect(g, bx, by, bw, bh, bh / 2); g.clip();
      const fg = g.createLinearGradient(bx, 0, bx + bw * ratio, 0);
      fg.addColorStop(0, '#8ff5cf'); fg.addColorStop(1, '#7ff4f0');
      g.fillStyle = fg; g.fillRect(bx, by, bw * ratio * ease, bh);
      g.restore();
    }
    g.fillStyle = '#fff';
    g.font = `800 ${H * 0.045}px ${FONT}`;
    for (const [r, m] of RANKS) {
      if (!m) continue;
      const mx = bx + bw * m, tp = by - H * 0.03;
      g.fillRect(mx - 1.5, tp, 3, by + bh - tp);
      g.beginPath(); g.moveTo(mx - H * 0.016, tp); g.lineTo(mx + H * 0.016, tp); g.lineTo(mx, tp + H * 0.025); g.closePath(); g.fill();
      g.fillText(r, mx, tp - H * 0.035);
    }

    // rank tile
    const rank = RANKS.find(([, m]) => ratio >= m)[0];
    const tk = reduced ? 1 : Math.min(1, Math.max(0, (age - 1.3) / 0.35));
    if (tk > 0) {
      const tx = W * 0.752, ty = H * 0.33, tw2 = W * 0.095, th = H * 0.345;
      g.globalAlpha = tk;
      g.fillStyle = '#2e2c50'; g.fillRect(tx, ty + (1 - tk) * H * 0.03, tw2, th);
      const col = RANK_COLORS[rank], ls = th * 0.72, lx = tx + tw2 / 2, ly = ty + th * 0.43;
      g.font = `900 ${ls}px ${FONT}`;
      g.strokeStyle = col; g.lineWidth = 1.2; g.globalAlpha = tk * 0.6;
      g.strokeText(rank, lx - tw2 * 0.08, ly - th * 0.06);
      g.globalAlpha = tk;
      const ps = reduced ? 1 : 1 + 0.3 * (1 - tk) ** 2;
      g.save(); g.translate(lx, ly); g.scale(ps, ps);
      g.fillStyle = col; g.fillText(rank, 0, 0);
      g.restore();
      g.font = `900 ${th * 0.085}px ${FONT}`;
      g.fillText('SCORERANK', lx, ty + th * 0.9, tw2 * 0.9);
    }
    g.globalAlpha = 1;
    if (!reduced) sparkles(age + END_A, 0.5);
  }

  return { init, draw, laneAtX, setCover, JUDGE_COLORS, RANKS, END_A, END_B };
})();
