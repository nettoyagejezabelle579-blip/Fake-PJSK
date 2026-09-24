// Keyboard (D/F/J/K, +Space = flick) and multi-touch/pointer (swipe up = flick) → column-range events (c0, c1, timeStamp).
// Each key covers a quarter of the 12 columns; a touch covers the one column under the finger.
const Input = (() => {
  const KEYS = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
  const KEY_COLS = 3;
  const FLICK_PX = 30;        // upward swipe distance that counts as a flick
  const pointers = new Map(); // pointerId → { col, y, flicked }
  const held = new Set();     // keys (0-3) held on keyboard
  const k0 = (k) => k * KEY_COLS, k1 = (k) => k * KEY_COLS + KEY_COLS - 1;
  // Pointer position in page (game) coordinates; the page may be drawn sideways (html.rot.cw / .ccw).
  function local(e) {
    const c = document.documentElement.classList;
    if (!c.contains('rot')) return { x: e.clientX, y: e.clientY };
    return c.contains('ccw') ? { x: innerHeight - e.clientY, y: e.clientX } : { x: e.clientY, y: innerWidth - e.clientX };
  }
  let space = false;

  function init(el, onPress, onRelease, onFlick) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) { space = true; for (const k of held) onFlick(k0(k), k1(k), e.timeStamp); }
        return;
      }
      const k = KEYS[e.code];
      if (k === undefined) return;
      e.preventDefault();
      if (e.repeat) return;
      held.add(k);
      onPress(k0(k), k1(k), e.timeStamp);
      if (space) onFlick(k0(k), k1(k), e.timeStamp);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { space = false; return; }
      const k = KEYS[e.code];
      if (k !== undefined) { held.delete(k); onRelease(k0(k), k1(k), e.timeStamp); }
    });

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const p = local(e);
      const col = Render.laneAtX(p.x);
      pointers.set(e.pointerId, { col, y: p.y, flicked: false });
      onPress(col, col, e.timeStamp);
    });
    el.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const y = local(e).y;
      if (y > p.y) p.y = y; // measure from lowest point
      else if (!p.flicked && p.y - y >= FLICK_PX) { p.flicked = true; onFlick(p.col, p.col, e.timeStamp); }
    });
    const up = (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      pointers.delete(e.pointerId);
      onRelease(p.col, p.col, e.timeStamp);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  return { init };
})();
