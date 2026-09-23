// Keyboard (D/F/J/K, +Space = flick) and multi-touch/pointer (swipe up = flick) → lane events, stamped with event.timeStamp.
const Input = (() => {
  const KEYS = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
  const FLICK_PX = 30;        // upward swipe distance that counts as a flick
  const pointers = new Map(); // pointerId → { lane, y, flicked }
  const held = new Set();     // lanes held on keyboard
  let space = false;

  function init(el, onPress, onRelease, onFlick) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) { space = true; for (const l of held) onFlick(l, e.timeStamp); }
        return;
      }
      const lane = KEYS[e.code];
      if (lane === undefined) return;
      e.preventDefault();
      if (e.repeat) return;
      held.add(lane);
      onPress(lane, e.timeStamp);
      if (space) onFlick(lane, e.timeStamp);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { space = false; return; }
      const lane = KEYS[e.code];
      if (lane !== undefined) { held.delete(lane); onRelease(lane, e.timeStamp); }
    });

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const lane = Render.laneAtX(e.clientX - rect.left);
      pointers.set(e.pointerId, { lane, y: e.clientY, flicked: false });
      onPress(lane, e.timeStamp);
    });
    el.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      if (e.clientY > p.y) p.y = e.clientY; // measure from lowest point
      else if (!p.flicked && p.y - e.clientY >= FLICK_PX) { p.flicked = true; onFlick(p.lane, e.timeStamp); }
    });
    const up = (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      pointers.delete(e.pointerId);
      onRelease(p.lane, e.timeStamp);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  return { init };
})();
