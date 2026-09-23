// Song select: category tabs, sortable song list, cover + difficulty, high score, 10 s preview; speed in settings popup.
// Shown when the page has no ?song= param; Play navigates to ?song=&diff= for game.js.
const Menu = (() => {
  const DIFFS = ['easy', 'normal', 'hard', 'expert', 'master'];
  const PREVIEW_LEN = 10; // seconds

  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  let songs = [];     // [{ id, meta }]
  let sel = null;     // selected song entry
  let diff = store.get('pjsk.diff', 'normal');
  let preview = null, previewTimer = 0;
  let cat = 'All', sort = store.get('pjsk.sort', 'default');
  let root, tabs, list, detail, hiscore;

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

  const lvl = (s) => (s.meta.difficulties || {})[diff];
  const best = (id, d) => +store.get(`pjsk.best.${id}.${d}`, 0) || 0;
  const cleared = (id, d) => store.get(`pjsk.clear.${id}.${d}`, '') === '1';

  function visible() {
    const v = songs.filter((s) => cat === 'All' || s.meta.category === cat);
    if (sort === 'level') v.sort((a, b) => (lvl(a) ?? 1e9) - (lvl(b) ?? 1e9));
    else if (sort === 'title') v.sort((a, b) => a.meta.title.localeCompare(b.meta.title));
    return v;
  }

  function startGame() {
    stopPreview();
    location.search = new URLSearchParams({ song: sel.id, diff }).toString();
  }

  function renderDetail() {
    const s = sel, levels = s.meta.difficulties || {};
    const avail = DIFFS.filter((d) => d in levels);
    if (!avail.includes(diff)) diff = avail[0] || 'normal';
    root.dataset.diff = diff;

    const cover = el('img', 'menu-cover');
    cover.alt = '';
    if (s.meta.cover) cover.src = `songs/${s.id}/${s.meta.cover}`;

    const diffs = el('div', 'menu-diffs');
    for (const d of avail) {
      const b = el('button', 'menu-diff');
      b.type = 'button';
      b.dataset.diff = d;
      b.setAttribute('aria-pressed', d === diff);
      b.append(el('b', null, levels[d]), el('small', null, d.toUpperCase()));
      b.addEventListener('click', () => { diff = d; store.set('pjsk.diff', d); renderDetail(); renderList(); });
      diffs.append(b);
    }
    detail.replaceChildren(cover, diffs);
    hiscore.textContent = best(s.id, diff).toLocaleString();
  }

  function markSel(scroll) {
    for (const c of list.children) {
      const on = c.dataset.id === sel.id;
      c.setAttribute('aria-pressed', on);
      if (on && scroll) c.scrollIntoView({ block: 'center', behavior: scroll });
    }
  }

  function select(s) {
    sel = s;
    store.set('pjsk.song', s.id);
    markSel('smooth');
    renderDetail();
    playPreview(s);
  }

  function renderList() {
    const v = visible();
    list.replaceChildren(...v.map((s) => {
      const m = s.meta, levels = m.difficulties || {};
      const b = el('button', 'menu-song');
      b.type = 'button';
      b.dataset.id = s.id;
      const lv = el('div', 'song-lv');
      lv.append(el('small', null, 'Song Lv.'), el('b', null, levels[diff] ?? '–'));
      const img = el('img');
      img.alt = '';
      if (m.cover) img.src = `songs/${s.id}/${m.cover}`;
      const clear = el('div', 'song-clear');
      for (const d of DIFFS) {
        const i = el('i', !(d in levels) ? 'na' : cleared(s.id, d) ? 'gold' : null);
        i.title = d;
        clear.append(i);
      }
      const txt = el('div', 'song-txt');
      txt.append(el('strong', null, m.title), el('small', null, m.artist),
        el('small', 'song-vocals', `Vocals/Artist: ${m.vocals || m.artist}`), clear);
      b.append(lv, img, txt);
      const tag = m.tag || m.category;
      if (tag) b.append(el('span', 'song-tag', tag));
      b.addEventListener('click', () => (sel === s ? startGame() : select(s)));
      return b;
    }));
    if (sel) markSel('instant');
  }

  function renderTabs() {
    const cats = ['All', ...new Set(songs.map((s) => s.meta.category).filter(Boolean))];
    tabs.replaceChildren(...cats.map((c) => {
      const b = el('button', 'menu-tab', c);
      b.type = 'button';
      b.setAttribute('aria-pressed', c === cat);
      b.addEventListener('click', () => {
        cat = c;
        renderTabs();
        renderList();
        const v = visible();
        if (v.length && !v.includes(sel)) select(v[0]);
      });
      return b;
    }));
  }

  function speedRow() {
    const sp = el('div', 'menu-speed');
    const val = el('output', null, Settings.get('noteSpeed').toFixed(1));
    const mk = (label, delta) => {
      const b = el('button', 'menu-step', label);
      b.type = 'button';
      b.setAttribute('aria-label', (delta < 0 ? 'Slower ' : 'Faster ') + Math.abs(delta));
      const step = () => {
        Settings.set('noteSpeed', Settings.get('noteSpeed') + delta);
        val.textContent = Settings.get('noteSpeed').toFixed(1);
      };
      let timer = 0;
      const stop = () => { clearTimeout(timer); timer = 0; };
      const repeat = ms => { timer = setTimeout(() => { step(); repeat(Math.max(40, ms * 0.8)); }, ms); };
      b.addEventListener('pointerdown', e => { e.preventDefault(); stop(); step(); repeat(400); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, stop));
      b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); step(); } });
      b.addEventListener('contextmenu', e => e.preventDefault());
      return b;
    };
    sp.append(el('span', null, 'Note speed'), mk('−1', -1), mk('−', -0.1), val, mk('+', 0.1), mk('+1', 1));
    return sp;
  }

  function btn(cls, text, label, fn) {
    const b = el('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  }

  function buildTop() {
    const top = el('div', 'menu-top');
    const banner = el('div', 'menu-banner');
    banner.append(el('h1', null, 'Solo Live'), el('p', null, 'Song Select'));

    const sortBox = el('label', 'menu-sort');
    sortBox.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>';
    const sortSel = el('select');
    sortSel.setAttribute('aria-label', 'Sort');
    for (const [v, t] of [['default', 'Default'], ['level', 'Level'], ['title', 'Title']]) {
      const o = el('option', null, t);
      o.value = v;
      sortSel.append(o);
    }
    sortSel.value = sort;
    sortSel.addEventListener('change', () => { sort = sortSel.value; store.set('pjsk.sort', sort); renderList(); });
    sortBox.append(sortSel);

    const pop = el('dialog', 'menu-pop');
    pop.append(el('h2', null, 'Settings'), speedRow(),
      btn('menu-close', 'Close', null, () => pop.close()));
    pop.addEventListener('click', (e) => { if (e.target === pop) pop.close(); });

    const tools = el('div', 'menu-tools');
    tools.append(sortBox, btn('menu-burger', '☰', 'Menu', () => pop.showModal()));
    top.append(btn('menu-back', '‹', 'Back', () => { stopPreview(); history.back(); }), banner, tools, pop);
    return top;
  }

  function buildBottom() {
    const bot = el('div', 'menu-bottom');
    const hs = el('div', 'menu-hs', 'High Score');
    hiscore = el('span', null, '0');
    hs.append(hiscore);
    bot.append(hs,
      btn('menu-random', '⤮ Random', null, () => {
        const v = visible();
        if (v.length) select(v[Math.floor(Math.random() * v.length)]);
      }),
      btn('menu-play', 'Select', null, () => sel && startGame()));
    return bot;
  }

  async function show() {
    root = el('div', 'menu');
    root.id = 'menu';
    tabs = el('div', 'menu-tabs');
    list = el('div', 'menu-list');
    detail = el('div', 'menu-art');
    root.append(buildTop(), tabs, list, detail, buildBottom());
    document.body.append(root);

    const idx = await (await fetch('songs/index.json')).json();
    const ids = Array.isArray(idx) ? idx : idx.songs || [];
    songs = (await Promise.all(ids.map(async (id) => {
      try { return { id, meta: await AudioEngine.loadMeta(id) }; } catch (e) { return null; }
    }))).filter(Boolean);
    if (!songs.length) { detail.replaceChildren(el('p', null, 'No songs found')); return; }
    const last = store.get('pjsk.song', null);
    sel = songs.find((x) => x.id === last) || songs[0];
    renderTabs();
    renderDetail(); // no autoplay preview on load; browsers block it without a gesture
    renderList();
  }

  if (!new URLSearchParams(location.search).get('song')) show();

  return { show, stopPreview, get speed() { return Settings.get('noteSpeed'); } };
})();

// Fullscreen + landscape lock; both best-effort (unsupported on some browsers, e.g. iOS).
document.getElementById('fs-btn').addEventListener('click', async () => {
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) { /* ignore */ } return; }
  try { await document.documentElement.requestFullscreen(); } catch (e) { /* ignore */ }
  try { await screen.orientation.lock('landscape'); } catch (e) { /* ignore */ }
});
