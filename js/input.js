// Keyboard (D/F/J/K) and multi-touch/pointer → lane presses, stamped with event.timeStamp.
const Input = (() => {
  const KEYS = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
  const pointers = new Map(); // pointerId → lane

  function init(el, onPress, onRelease) {
    window.addEventListener('keydown', (e) => {
      const lane = KEYS[e.code];
      if (lane === undefined) return;
      e.preventDefault();
      if (!e.repeat) onPress(lane, e.timeStamp);
    });
    window.addEventListener('keyup', (e) => {
      const lane = KEYS[e.code];
      if (lane !== undefined) onRelease(lane);
    });

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const lane = Render.laneAtX(e.clientX - rect.left);
      pointers.set(e.pointerId, lane);
      onPress(lane, e.timeStamp);
    });
    const up = (e) => {
      const lane = pointers.get(e.pointerId);
      if (lane === undefined) return;
      pointers.delete(e.pointerId);
      onRelease(lane);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  return { init };
})();
