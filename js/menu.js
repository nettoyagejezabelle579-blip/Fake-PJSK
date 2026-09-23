// Song select: category sidebar, searchable cover grid, phone-style detail panel, 10 s preview; speed in settings popup.
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
  let cat = 'All', sort = store.get('pjsk.sort', 'default'), query = '';
  let root, tabs, list, detail;

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
    const q = query.trim().toLowerCase();
    const v = songs.filter((s) => (cat === 'All' || (s.meta.category || 'Other') === cat) &&
      (!q || `${s.meta.title}\n${s.meta.artist}\n${s.meta.vocals || ''}`.toLowerCase().includes(q)));
    if (sort === 'level') v.sort((a, b) => (lvl(a) ?? 1e9) - (lvl(b) ?? 1e9));
    else if (sort === 'title') v.sort((a, b) => a.meta.title.localeCompare(b.meta.title));
    return v;
  }

  function startGame() {
    stopPreview();
    location.search = new URLSearchParams({ song: sel.id, diff }).toString();
  }

  function renderDetail() {
    const s = sel, m = s.meta, levels = m.difficulties || {};
    const avail = DIFFS.filter((d) => d in levels);
    if (!avail.includes(diff)) diff = avail[0] || 'normal';
    root.dataset.diff = diff;
    detail.parentElement.style.setProperty('--cover', m.cover ? `url("songs/${s.id}/${m.cover}")` : 'none');

    const cover = el('img', 'phone-cover');
    cover.alt = '';
    if (m.cover) cover.src = `songs/${s.id}/${m.cover}`;

    const info = el('div', 'phone-info');
    const txt = el('div');
    txt.append(el('h1', null, m.title), el('p', null, m.artist));
    if (m.vocals) txt.append(el('p', 'phone-vocals', `Vo. ${m.vocals}`));
    const hs = best(s.id, diff);
    const score = el('div', 'phone-score', hs ? hs.toLocaleString() : '--');
    score.title = 'High score';
    info.append(txt, score);

    const diffs = el('div', 'phone-diffs');
    for (const d of avail) {
      const b = el('button', 'phone-diff');
      b.type = 'button';
      b.dataset.diff = d;
      b.setAttribute('aria-pressed', d === diff);
      b.append(el('b', null, levels[d]), el('small', null, d.toUpperCase()));
      b.addEventListener('click', () => { diff = d; store.set('pjsk.diff', d); renderDetail(); renderList(); });
      diffs.append(b);
    }
    const share = iconBtn('phone-share', 'share', 'Share', async () => {
      const url = `${location.origin}${location.pathname}?${new URLSearchParams({ song: s.id, diff })}`;
      try { await (navigator.share ? navigator.share({ title: m.title, url }) : navigator.clipboard.writeText(url)); } catch (e) { /* cancelled */ }
    });
    detail.replaceChildren(share, cover, info, diffs);
  }

  function markSel(scroll) {
    for (const c of list.children) {
      const on = c.dataset.id === sel.id;
      c.setAttribute('aria-pressed', on);
      if (on && scroll) c.scrollIntoView({ block: 'nearest', behavior: scroll });
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
      const b = el('button', 'tile');
      b.type = 'button';
      b.dataset.id = s.id;
      b.setAttribute('aria-label', `${m.title} – ${m.artist}`);
      const img = el('img');
      img.alt = '';
      if (m.cover) img.src = `songs/${s.id}/${m.cover}`;
      else b.append(el('span', 'tile-title', m.title));
      const clear = el('div', 'tile-clear');
      for (const d of DIFFS) {
        const i = el('i', !(d in levels) ? 'na' : cleared(s.id, d) ? 'gold' : null);
        i.title = d;
        clear.append(i);
      }
      b.prepend(img);
      b.append(el('span', 'tile-lv', levels[diff] ?? '–'), clear);
      const tag = m.tag || m.category;
      if (tag) b.append(el('span', 'tile-tag', tag));
      b.addEventListener('click', () => (sel === s ? startGame() : select(s)));
      return b;
    }));
    if (!v.length) list.append(el('p', 'menu-empty', 'No songs found'));
    if (sel) markSel('instant');
  }

  function renderTabs() {
    const named = [...new Set(songs.map((s) => s.meta.category).filter(Boolean))];
    const cats = ['All', ...named, ...(named.length && songs.some((s) => !s.meta.category) ? ['Other'] : [])];
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

  const ICON = {
    search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11"/></svg>',
    filter: '<svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24"><path d="M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  };
  function iconBtn(cls, icon, label, fn) {
    const b = btn(cls, null, label, fn);
    b.innerHTML = ICON[icon];
    return b;
  }

  function buildSide() {
    const side = el('div', 'menu-side');
    const up = btn('side-arrow', '▲', 'Scroll categories up', () => tabs.scrollBy({ top: -120, behavior: 'smooth' }));
    const down = btn('side-arrow', '▼', 'Scroll categories down', () => tabs.scrollBy({ top: 120, behavior: 'smooth' }));
    side.append(btn('menu-back', '↩', 'Back', () => { stopPreview(); history.back(); }), up, tabs, down);
    return side;
  }

  function buildTop() {
    const top = el('div', 'menu-top');
    const search = el('label', 'menu-search');
    const input = el('input');
    input.type = 'search';
    input.placeholder = 'Search title or artist';
    input.setAttribute('aria-label', 'Search songs');
    input.addEventListener('input', () => { query = input.value; renderList(); });
    search.append(input);
    search.insertAdjacentHTML('beforeend', ICON.search);

    const view = iconBtn('menu-view', 'list', 'Toggle list view', () => {
      const on = root.classList.toggle('list-view');
      store.set('pjsk.view', on ? 'list' : 'grid');
      markSel('instant');
    });
    view.append(el('span', null, 'List'));
    top.append(search, view);
    return top;
  }

  function buildPhone() {
    const phone = el('div', 'menu-phone');
    const notch = el('div', 'phone-notch');
    const tools = el('div', 'menu-tools');
    const sortBox = el('label', 'phone-sort');
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
    const filter = iconBtn('phone-filter', 'filter', 'Sort', () => sortSel.showPicker?.() ?? sortSel.focus());
    tools.append(filter, sortBox);

    const icons = el('div', 'phone-actions');
    icons.append(
      iconBtn('phone-icon', 'shuffle', 'Random song', () => {
        const v = visible();
        if (v.length) select(v[Math.floor(Math.random() * v.length)]);
      }),
      iconBtn('phone-icon', 'note', 'Play preview', () => sel && playPreview(sel)));
    phone.append(notch, detail, btn('phone-go', 'Decide', null, () => sel && startGame()), icons);
    return [phone, tools];
  }

  function buildMenuBtn() {
    const pop = el('dialog', 'menu-pop');
    const fs = btn('menu-close', 'Fullscreen', null, () => document.getElementById('fs-btn').click());
    pop.append(el('h2', null, 'Settings'), speedRow(), fs,
      btn('menu-close', 'Close', null, () => pop.close()));
    pop.addEventListener('click', (e) => { if (e.target === pop) pop.close(); });
    const b = btn('menu-burger', '☰', 'Settings', () => pop.showModal());
    return [b, pop];
  }

  async function show() {
    root = el('div', 'menu');
    root.id = 'menu';
    if (store.get('pjsk.view', 'grid') === 'list') root.classList.add('list-view');
    tabs = el('div', 'menu-tabs');
    list = el('div', 'menu-grid');
    detail = el('div', 'phone-detail');
    const main = el('div', 'menu-main');
    main.append(buildTop(), list);
    root.append(buildSide(), main, ...buildPhone(), ...buildMenuBtn());
    document.body.append(root);

    const idx = await (await fetch('songs/index.json')).json();
    const ids = Array.isArray(idx) ? idx : idx.songs || [];
    songs = (await Promise.all(ids.map(async (id) => {
      try { return { id, meta: await AudioEngine.loadMeta(id) }; } catch (e) { return null; }
    }))).filter(Boolean);
    if (!songs.length) { detail.replaceChildren(el('p', 'menu-empty', 'No songs found')); return; }
    const last = store.get('pjsk.song', null);
    sel = songs.find((x) => x.id === last) || songs[0];
    renderTabs();
    renderDetail(); // no autoplay preview on load; browsers block it without a gesture
    renderList();
  }

  // Result screen (after a play): song card with score bar + rank, score / high score, judgement table, combo.
  let resultEl = null;
  const digits = (n, len) => {
    const str = String(n).padStart(len, '0'), lead = str.match(/^0*(?=.)/)[0];
    const w = el('span', 'res-num');
    w.append(el('span', 'dim', lead), el('span', null, str.slice(lead.length)));
    return w;
  };

  function hideResult() { if (resultEl) { resultEl.remove(); resultEl = null; } }

  function showResult(d) {
    hideResult();
    const m = d.meta, root = el('div', 'result');
    root.dataset.diff = d.diff;
    root.append(el('div', 'res-mark', 'RESULT'));

    const top = el('div', 'res-top');
    const cover = el('img', 'res-cover');
    cover.alt = '';
    if (m.cover) cover.src = `songs/${d.id}/${m.cover}`;
    const info = el('div', 'res-info');
    const badges = el('div', 'res-badges');
    const lv = el('span', 'res-lv', 'Song Lv. ');
    lv.append(el('b', null, (m.difficulties || {})[d.diff] ?? '–'));
    badges.append(el('span', 'res-diff', d.diff.toUpperCase()), lv);
    info.append(el('div', 'res-title', m.title), badges);
    const bar = el('div', 'res-bar');
    const fill = el('i', 'res-fill');
    fill.style.width = `${(d.ratio * 100).toFixed(1)}%`;
    bar.append(fill);
    for (const [r, v] of Render.RANKS) {
      if (!v) continue;
      const pin = el('span', 'res-pin', r);
      pin.style.left = `${v * 100}%`;
      bar.append(pin);
    }
    const tile = el('div', 'res-rank');
    tile.dataset.rank = d.rank;
    tile.append(el('b', null, d.rank), el('small', null, 'SCORERANK'));
    top.append(cover, info, bar, tile);

    const body = el('div', 'res-body');
    const scoreRow = el('div', 'res-score');
    if (d.score > d.best) scoreRow.append(el('span', 'res-new', '✦ NEW RECORD! ✦'));
    scoreRow.append(el('span', 'res-label', 'Score'), digits(d.score, 8));
    const bestRow = el('div', 'res-best');
    bestRow.append(el('span', 'res-label', 'High Score'), digits(d.best, 8)); // previous best, as before this play
    const judges = el('div', 'res-judges');
    const table = el('div', 'res-table');
    for (const j of ['perfect', 'great', 'good', 'miss']) {
      const row = el('div', 'res-row');
      row.dataset.j = j;
      row.append(el('span', 'res-j', j.toUpperCase()), digits(d.counts[j], 4));
      table.append(row);
    }
    const combo = el('div', 'res-combo');
    combo.append(el('span', 'res-label', 'COMBO'), digits(d.maxCombo, 4));
    judges.append(table, combo);
    body.append(scoreRow, bestRow, judges);

    const art = el('img', 'res-art');
    art.alt = '';
    if (m.cover) art.src = cover.src;

    const actions = el('div', 'res-actions');
    actions.append(btn('res-btn res-retry', 'Retry', null, () => { hideResult(); d.onRetry(); }),
      btn('res-btn res-next', 'Next', null, d.onNext));
    root.append(top, body, art, actions);
    document.body.append(root);
    resultEl = root;
  }

  if (!new URLSearchParams(location.search).get('song')) show();

  return { show, showResult, hideResult, stopPreview, get speed() { return Settings.get('noteSpeed'); } };
})();

// Fullscreen + landscape lock; both best-effort (unsupported on some browsers, e.g. iOS).
document.getElementById('fs-btn').addEventListener('click', async () => {
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (e) { /* ignore */ } return; }
  try { await document.documentElement.requestFullscreen(); } catch (e) { /* ignore */ }
  try { await screen.orientation.lock('landscape'); } catch (e) { /* ignore */ }
});
