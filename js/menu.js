// Song select: list from songs/index.json, cover/title/artist, difficulty + level, 10 s preview, speed.
// Shown when the page has no ?song= param; Play navigates to ?song=&diff=&speed= for game.js.
const Menu = (() => {
  const DIFFS = ['easy', 'normal', 'hard'];
  const PREVIEW_LEN = 10; // seconds
  const SPEED_MIN = 0.5, SPEED_MAX = 3, SPEED_STEP = 0.25;

  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  let songs = [];     // [{ id, meta }]
  let sel = null;     // selected song entry
  let diff = store.get('pjsk.diff', 'normal');
  let speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, +store.get('pjsk.speed', 1) || 1));
  let preview = null, previewTimer = 0;
  let root, list, detail;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function stopPreview() {
    clearTimeout(previewTimer);
    if (preview) { preview.pause(); preview.src = ''; preview = null; }
  }

  // Preview audio only (not gameplay timing), so a plain media element is enough.
  function playPreview(s) {
    stopPreview();
    const a = new Audio(`songs/${s.id}/${s.meta.audio}`);
    const start = s.meta.preview || 0;
    a.volume = 0.8;
    a.addEventListener('loadedmetadata', () => { a.currentTime = Math.min(start, Math.max(0, a.duration - PREVIEW_LEN)); }, { once: true });
    a.play().catch(() => { /* autoplay blocked until a tap */ });
    preview = a;
    previewTimer = setTimeout(stopPreview, PREVIEW_LEN * 1000);
  }

  function renderDetail() {
    const s = sel, levels = s.meta.difficulties || {};
    const avail = DIFFS.filter((d) => d in levels);
    if (!avail.includes(diff)) diff = avail[0] || 'normal';

    const cover = el('img', 'menu-cover');
    cover.alt = '';
    if (s.meta.cover) cover.src = `songs/${s.id}/${s.meta.cover}`;

    const diffs = el('div', 'menu-diffs');
    for (const d of avail) {
      const b = el('button', 'diff-btn', d);
      b.type = 'button';
      b.dataset.diff = d;
      b.setAttribute('aria-pressed', d === diff);
      b.append(el('span', null, levels[d]));
      b.addEventListener('click', () => { diff = d; store.set('pjsk.diff', d); renderDetail(); });
      diffs.append(b);
    }

    const sp = el('div', 'menu-speed');
    const val = el('output', null, `${speed.toFixed(2)}x`);
    const mk = (label, delta) => {
      const b = el('button', 'menu-step', label);
      b.type = 'button';
      b.setAttribute('aria-label', delta < 0 ? 'Slower' : 'Faster');
      b.addEventListener('click', () => {
        speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed + delta));
        store.set('pjsk.speed', speed);
        val.textContent = `${speed.toFixed(2)}x`;
      });
      return b;
    };
    sp.append(el('span', null, 'Speed'), mk('−', -SPEED_STEP), val, mk('+', SPEED_STEP));

    const prev = el('button', 'menu-preview', '▶ Preview');
    prev.type = 'button';
    prev.addEventListener('click', () => playPreview(s));
    sp.append(prev); // one row keeps Play on screen in landscape

    const play = el('button', 'menu-play', 'PLAY');
    play.type = 'button';
    play.addEventListener('click', () => {
      stopPreview();
      location.search = new URLSearchParams({ song: s.id, diff, speed }).toString();
    });

    detail.replaceChildren(cover, el('h1', null, s.meta.title), el('p', 'menu-artist', s.meta.artist),
      diffs, sp, play);
  }

  function select(s) {
    sel = s;
    store.set('pjsk.song', s.id);
    for (const c of list.children) c.setAttribute('aria-pressed', c.dataset.id === s.id);
    renderDetail();
    playPreview(s);
  }

  function renderList() {
    list.replaceChildren(...songs.map((s) => {
      const b = el('button', 'menu-song');
      b.type = 'button';
      b.dataset.id = s.id;
      const img = el('img');
      img.alt = '';
      if (s.meta.cover) img.src = `songs/${s.id}/${s.meta.cover}`;
      const txt = el('div');
      txt.append(el('strong', null, s.meta.title), el('small', null, s.meta.artist));
      b.append(img, txt);
      b.addEventListener('click', () => select(s));
      return b;
    }));
  }

  async function show() {
    root = el('div', 'menu');
    root.id = 'menu';
    list = el('div', 'menu-list');
    detail = el('div', 'menu-detail');
    root.append(list, detail);
    document.body.append(root);

    const idx = await (await fetch('songs/index.json')).json();
    const ids = Array.isArray(idx) ? idx : idx.songs || [];
    songs = (await Promise.all(ids.map(async (id) => {
      try { return { id, meta: await AudioEngine.loadMeta(id) }; } catch (e) { return null; }
    }))).filter(Boolean);
    if (!songs.length) { detail.replaceChildren(el('p', null, 'No songs found')); return; }
    renderList();
    const last = store.get('pjsk.song', null);
    const s = songs.find((x) => x.id === last) || songs[0];
    sel = s;
    for (const c of list.children) c.setAttribute('aria-pressed', c.dataset.id === s.id);
    renderDetail(); // no autoplay preview on load; browsers block it without a gesture
  }

  if (!new URLSearchParams(location.search).get('song')) show();

  return { show, stopPreview, get speed() { return speed; } };
})();

// Fullscreen + landscape lock; both best-effort (unsupported on some browsers, e.g. iOS).
document.getElementById('fs-btn').addEventListener('click', async () => {
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) { /* ignore */ } return; }
  try { await document.documentElement.requestFullscreen(); } catch (e) { /* ignore */ }
  try { await screen.orientation.lock('landscape'); } catch (e) { /* ignore */ }
});
