// Hũ page: three jars on a shelf (desktop) or one jar at a time (phone, ≤640px), a list for the chosen jar,
// the drop-into-jar animation, the feeling form and the ball sheet. Data goes in with textContent only.
import { apiRequest, authEvents, getUser } from '../../auth.js';
import { ballColor, mini, moodColor, SAMPLE } from './colors.js';
import {
  CAP, JAR_NAME, KIND_NAME, KINDS, NAME, RANGES, RANGE_NAME, SHAPES, SUGG, TAG, ballLabel, byTime, dayHeading,
  energyWord, jarPath, localDate, localTime, moodName, other, pack, quadrant, radius, rangeQuery, valenceWord, vnDate,
} from './model.js';

const enc = encodeURIComponent;
export const jarApi = {
  list: (query, signal) => apiRequest(`/api/jar${query}`, { signal }),
  create: body => apiRequest('/api/jar', { method: 'POST', body }),
  update: (id, body) => apiRequest(`/api/jar/${enc(id)}`, { method: 'PUT', body }),
  archive: id => apiRequest(`/api/jar/${enc(id)}/archive`, { method: 'POST', body: {} }),
  restore: id => apiRequest(`/api/jar/${enc(id)}/restore`, { method: 'POST', body: {} }),
};
const RIBBON = { kiss: ['#e98fab', '#c76687'], sorry: ['#8fcfb2', '#5ea585'], mood: ['#ecc35f', '#c89a35'] };
const phoneQuery = matchMedia('(max-width: 640px)'), calmQuery = matchMedia('(prefers-reduced-motion: reduce)');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(className, text) { const node = el('button', className, text); node.type = 'button'; return node; }
// Jar drawings are built from the numeric SHAPES and constant labels only, never from user data.
function svg(className, markup) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('class', className); node.setAttribute('viewBox', '0 0 320 400'); node.setAttribute('aria-hidden', 'true');
  node.innerHTML = markup;
  return node;
}

export function mountJar(container, { signal, api = jarApi }) {
  const viewer = getUser()?.id, partner = other(viewer);
  let items = [], kind = 'kiss', range = 30, status = 'loading', loadSeq = 0, disposed = false, selectedId = null, openSheet = null, toastTimer = 0, swipe = null, swallowClick = false;
  const busy = {}, timers = new Set(), stages = {}, acts = {}, tabs = {};
  const alive = () => !disposed && !signal.aborted;
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (alive()) fn(); }, ms); timers.add(id); };
  const wait = ms => new Promise(resolve => later(resolve, ms));
  const motionOK = () => !calmQuery.matches;

  const root = el('section', 'jar-page');
  const title = el('h1', 'jar-title', 'Hũ');
  const sub = el('p', 'jar-sub', 'Ba chiếc bình của hai đứa: nụ hôn, lời xin lỗi và cảm xúc.');
  const top = el('div', 'jar-top');
  const tablist = el('div', 'jar-tabs'); tablist.setAttribute('role', 'tablist');
  const chips = el('div', 'jar-chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Khoảng thời gian');
  const statusLine = el('div', 'jar-status'); statusLine.setAttribute('role', 'status');
  const shelf = el('div', 'jar-shelf');
  const hint = el('p', 'jar-hint', 'Vuốt ngang trên bình để đổi bình. Chạm một viên để xem.');
  const listSection = el('section', 'jar-list'); listSection.id = 'jar-list'; listSection.setAttribute('role', 'tabpanel');
  const listTitle = el('h2'), rows = el('div', 'jar-rows');
  const fx = el('div', 'jar-fx'), toastHost = el('div', 'jar-toast-host');
  toastHost.setAttribute('aria-live', 'polite');
  listSection.append(listTitle, rows);
  top.append(tablist, chips);
  const defs = svg('jar-defs', '<defs><linearGradient id="jar-glass" x1="0" x2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".7"/><stop offset=".55" stop-color="#fdf1f4" stop-opacity=".3"/><stop offset="1" stop-color="#f3d3de" stop-opacity=".6"/></linearGradient></defs>');
  root.append(defs, title, sub, top, statusLine, shelf, listSection, fx, toastHost);
  container.replaceChildren(root);

  for (const k of KINDS) {
    const tab = button('jar-tab'); tab.setAttribute('role', 'tab'); tab.id = `jar-tab-${k}`; tab.setAttribute('aria-controls', 'jar-list');
    tab.append(mini(k, SAMPLE[k]), TAG[k]); tab.addEventListener('click', () => setKind(k));
    tablist.append(tab); tabs[k] = tab;
  }
  for (const [days, label] of RANGES) {
    const chip = button('jar-chip', label); chip.dataset.range = days;
    chip.addEventListener('click', () => { if (range !== days) { range = days; load(); } });
    chips.append(chip);
  }
  for (const k of KINDS) shelf.append(buildStage(k));
  const plank = el('div', 'jar-plank'); plank.setAttribute('aria-hidden', 'true'); shelf.append(plank);
  for (const k of KINDS) {
    const act = button(`jar-act ${k}`);
    act.append(mini(k, SAMPLE[k]), k === 'kiss' ? `Hôn ${NAME[partner]}` : k === 'sorry' ? `Xin lỗi ${NAME[partner]}` : 'Thêm cảm xúc');
    act.addEventListener('click', () => k === 'mood' ? openMood({ opener: act }) : send(k, act.getBoundingClientRect()));
    shelf.append(act); acts[k] = act;
  }
  // Phones: the list and the time range open in a sheet, so the page fits one screen.
  const listBtn = button('jar-btn jar-list-btn', 'Xem danh sách');
  listBtn.addEventListener('click', openList);
  shelf.append(listBtn, hint);

  function buildStage(k) {
    const s = SHAPES[k], path = jarPath(s), [rib, ribDark] = RIBBON[k], lx = s.nl - 8, lw = s.nr - s.nl + 16, bx = s.nr - 18;
    const stage = el('div', 'jar-stage'); stage.dataset.jar = k; stage.setAttribute('role', 'group');
    const back = svg('jar-back', `<ellipse cx="160" cy="388" rx="${(s.R - s.L) / 2 + 8}" ry="8" fill="#5d3c4c" opacity=".12"/><path d="${path}" fill="url(#jar-glass)"/>`);
    const front = svg('jar-front', `<path d="${path}" fill="none" stroke="#c99aac" stroke-width="2.5"/>
      <path d="M${s.L + 16} ${s.sh + 18} C${s.L + 9} ${s.sh + 80} ${s.L + 10} ${s.F - 100} ${s.L + 22} ${s.F - 46}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".75"/>
      <path d="M${s.R - 14} ${s.sh + 30} C${s.R - 10} ${s.sh + 76} ${s.R - 10} ${s.sh + 124} ${s.R - 14} ${s.sh + 164}" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5"/>
      <rect x="${s.nl - 6}" y="46" width="${s.nr - s.nl + 12}" height="10" rx="5" fill="#f7e8ee" stroke="#c99aac" stroke-width="2"/>
      <path d="M${s.nr + 2} 53 C${s.nr + 12} 60 ${s.nr + 18} 66 ${s.nr + 24} 76" fill="none" stroke="#a8765a" stroke-width="1.2"/>
      <g transform="rotate(9 ${s.nr + 52} 88)"><rect x="${s.nr + 20}" y="73" width="66" height="30" rx="5" fill="#fff8ee" stroke="#d9b6c1" stroke-width="1.5"/><circle cx="${s.nr + 27}" cy="88" r="3" fill="none" stroke="#d9b6c1" stroke-width="1.5"/>
        <text x="${s.nr + 56}" y="93" text-anchor="middle" font-family="Patrick Hand, Comic Sans MS, cursive" font-size="15" fill="#5d3c4c">${TAG[k]}</text></g>
      <g class="jar-lid"><rect x="${lx}" y="14" width="${lw}" height="34" rx="9" fill="#d8a47c" stroke="#a8765a" stroke-width="2"/>
        <path d="M${lx + 10} 22 H${lx + lw - 10} M${lx + 10} 28 H${lx + lw - 10}" stroke="#a8765a" stroke-width="1" opacity=".35"/>
        <rect x="${lx}" y="34" width="${lw}" height="8" fill="${rib}"/>
        <path d="M${bx} 38 C${bx - 12} 26 ${bx - 20} 30 ${bx - 16} 38 C${bx - 20} 46 ${bx - 12} 50 ${bx} 38 Z M${bx} 38 C${bx + 12} 26 ${bx + 20} 30 ${bx + 16} 38 C${bx + 20} 46 ${bx + 12} 50 ${bx} 38 Z" fill="${rib}" stroke="${ribDark}" stroke-width="1.5"/>
        <path d="M${bx - 2} 40 L${bx - 8} 56 M${bx + 2} 40 L${bx + 10} 54" stroke="${rib}" stroke-width="4" stroke-linecap="round"/></g>`);
    const balls = el('div', 'jar-balls'), empty = el('p', 'jar-empty');
    stage.append(back, balls, front, empty);
    stages[k] = { el: stage, balls, empty, buttons: new Map(), order: [], focusId: null };
    balls.addEventListener('click', event => { const ball = event.target.closest('.jar-ball'); if (ball) openBall(ball.dataset.id, ball); });
    balls.addEventListener('keydown', event => {
      const st = stages[k], i = st.order.indexOf(event.target.dataset.id);
      const j = { ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1, Home: 0, End: st.order.length - 1 }[event.key];
      if (i < 0 || j === undefined) return;
      event.preventDefault();
      st.focusId = st.order[Math.max(0, Math.min(st.order.length - 1, j))];
      for (const [id, b] of st.buttons) b.tabIndex = id === st.focusId ? 0 : -1;
      st.buttons.get(st.focusId).focus();
    });
    return stage;
  }

  const inJar = k => items.filter(item => item.kind === k).sort(byTime).slice(-CAP);
  const ballOf = item => stages[item.kind].buttons.get(item.id);
  // A reload replaces item objects; a server answer lands on whichever copy is live now.
  const upsert = (item, record) => Object.assign(items.find(x => x.id === item.id) ?? item, record);

  // Keyed by id: existing balls are moved, never recreated, so a ball that is still landing keeps its animation.
  function syncStage(k) {
    const st = stages[k], list = inJar(k), { pos } = pack(k, list), seen = new Set(list.map(item => item.id));
    for (const [id, b] of st.buttons) if (!seen.has(id)) { b.remove(); st.buttons.delete(id); }
    if (!seen.has(st.focusId)) st.focusId = list.at(-1)?.id ?? null;
    list.forEach((item, i) => {
      let b = st.buttons.get(item.id);
      if (!b) { b = button(`jar-ball jar-skin k-${item.kind}`); b.dataset.id = item.id; st.buttons.set(item.id, b); st.balls.append(b); }
      const p = pos[i];
      b.style.cssText = `left:${(p.x / 3.2).toFixed(2)}%;top:${(p.y / 4).toFixed(2)}%;width:${(p.r / 1.6).toFixed(2)}%;--c:${ballColor(item)};--fall:${((p.y - 24) / 3.2).toFixed(1)}cqw;--dx:${((160 - p.x) / 3.2).toFixed(1)}cqw`;
      b.classList.toggle('pending', !!item.pending);
      b.classList.toggle('lifted', item.id === selectedId);
      b.setAttribute('aria-label', ballLabel(item));
      b.tabIndex = item.id === st.focusId ? 0 : -1;
    });
    st.order = list.map(item => item.id);
    st.el.setAttribute('aria-label', `${JAR_NAME[k]} có ${list.length} viên trong ${RANGE_NAME[range]}. Dùng phím mũi tên để đi qua từng viên.`);
    st.empty.textContent = status === 'loading' && !list.length ? 'Đang mở bình…' : status === 'error' && !list.length ? 'Chưa mở được bình.' : list.length ? '' : 'Bình còn trống.\nThả viên đầu tiên nhé.';
    st.empty.hidden = !st.empty.textContent;
  }

  function rowText(item) {
    const text = el('span', 't'), who = el('b', '', NAME[item.ownerId]);
    if (item.kind !== 'mood') { text.append(who, ` ${item.kind === 'kiss' ? 'hôn' : 'xin lỗi'} ${NAME[other(item.ownerId)]}`); return text; }
    text.append(who, ` · ${moodName(item)}`);
    if (item.ownerId === viewer && item.visibility !== 'shared') text.append(' ', el('span', 'jar-badge', 'Chỉ mình bạn'));
    text.append(el('small', '', `${valenceWord(item.valence)}, năng lượng ${energyWord(item.energy).toLowerCase()}`));
    return text;
  }
  function buildRow(item) {
    const row = button(`jar-row${item.pending ? ' pending' : ''}`);
    row.dataset.id = item.id;
    row.append(mini(item.kind, ballColor(item)), rowText(item), el('time', '', item.pending ? 'Đang gửi…' : item.time));
    row.addEventListener('click', () => openBall(item.id, row));
    return row;
  }
  function renderList() {
    const list = inJar(kind).reverse(), today = localDate();
    listTitle.textContent = `Trong ${JAR_NAME[kind].toLowerCase()}`;
    listSection.setAttribute('aria-labelledby', `jar-tab-${kind}`);
    const out = [];
    let day = null;
    for (const item of list) {
      if (item.localDate !== day) { day = item.localDate; out.push(el('h3', 'jar-day', dayHeading(day, today))); }
      out.push(buildRow(item));
    }
    if (!list.length && status === 'ready') out.push(el('p', 'jar-note', `Chưa có viên nào trong ${RANGE_NAME[range]}.`));
    rows.replaceChildren(...out);
  }
  // A server answer changes only its own ball and row.
  function refreshItem(item) {
    syncStage(item.kind);
    const row = rows.querySelector(`.jar-row[data-id="${CSS.escape(item.id)}"]`);
    if (row) row.replaceWith(buildRow(item));
  }
  function renderStatus() {
    statusLine.replaceChildren();
    if (status !== 'error') return;
    const retry = button('jar-btn', 'Thử lại'); retry.addEventListener('click', load);
    statusLine.append(el('span', '', 'Chưa mở được bình. '), retry);
  }
  function syncAll() { KINDS.forEach(syncStage); renderList(); renderStatus(); for (const k of KINDS) acts[k].disabled = status !== 'ready'; }

  function setKind(k, focusTab = false) {
    kind = k;
    for (const x of KINDS) {
      tabs[x].setAttribute('aria-selected', String(x === k)); tabs[x].tabIndex = x === k ? 0 : -1;
      stages[x].el.classList.toggle('is-current', x === k); acts[x].classList.toggle('is-current', x === k);
    }
    if (focusTab) tabs[k].focus();
    renderList();
  }
  tablist.addEventListener('keydown', event => {
    const i = KINDS.indexOf(kind), j = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: 2 }[event.key];
    if (j === undefined) return;
    event.preventDefault(); setKind(KINDS[(j + 3) % 3], true);
  });
  const layout = () => {
    tablist.setAttribute('aria-label', phoneQuery.matches ? 'Chọn bình' : 'Danh sách của bình');
    if (!phoneQuery.matches && listSection.closest('dialog')) listSection.closest('dialog').close();
  };
  phoneQuery.addEventListener('change', layout, { signal });
  layout();

  async function load() {
    const request = ++loadSeq;
    status = 'loading';
    for (const chip of chips.children) chip.setAttribute('aria-pressed', String(+chip.dataset.range === range));
    syncAll();
    try {
      const { items: next } = await api.list(rangeQuery(range), signal);
      if (!alive() || request !== loadSeq) return;
      // Balls still on their way to the server stay in the jar.
      items = [...next, ...items.filter(item => item.pending && !next.some(n => n.id === item.id))];
      status = 'ready';
    } catch {
      if (!alive() || request !== loadSeq) return;
      status = 'error';
    }
    syncAll();
  }

  /* Putting a ball in a jar (~1.3 s): it pops out of the button, the lid flips open, the ball flies an arc to the
     mouth (apologies drift slower and sway), drops through the neck to its spot with a squash and a bounce while
     the lid snaps shut, then the jar wobbles, the ball glows and kisses puff three hearts, apologies one leaf.
     Reduced motion, or the jar not on screen: the ball just fades in place. */
  function onScreen(node) {
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
  }
  function fly(item, from, stage, size) {
    const sr = stage.getBoundingClientRect();
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2 - 16, x1 = sr.left + sr.width / 2, y1 = sr.top + sr.height * 24 / 400;
    const cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - Math.max(50, Math.abs(x1 - x0) * 0.4);
    const g = Math.max(size, 24), end = size / g, h = g / 2;
    const ghost = mini(item.kind, ballColor(item), 'jar-fly');
    ghost.style.width = ghost.style.height = `${g}px`;
    fx.append(ghost);
    const frames = [{ transform: `translate(${x0 - h}px,${y0 + 16 - h}px) scale(.2)`, offset: 0 }, { transform: `translate(${x0 - h}px,${y0 - h}px) scale(1.15)`, offset: 0.16 }];
    for (let i = 1; i <= 12; i++) {
      const t = i / 12, u = 1 - t, y = u * u * y0 + 2 * u * t * cy + t * t * y1;
      let x = u * u * x0 + 2 * u * t * cx + t * t * x1;
      if (item.kind === 'sorry') x += Math.sin(t * Math.PI * 2) * 12 * u;
      frames.push({ transform: `translate(${x - h}px,${y - h}px) scale(${1.15 + (end - 1.15) * t})`, offset: 0.16 + 0.84 * t });
    }
    return ghost.animate(frames, { duration: item.kind === 'sorry' ? 820 : 580, easing: 'ease-in-out', fill: 'forwards' }).finished.catch(() => {}).then(() => ghost.remove());
  }
  function burst(k, ball) {
    const r = ball.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top, count = k === 'kiss' ? 3 : k === 'sorry' ? 1 : 0;
    for (let i = 0; i < count; i++) {
      const spark = el('i', `jar-spark k-${k}`);
      spark.style.setProperty('--c', k === 'kiss' ? `hsl(${338 + i * 7} 75% 66%)` : 'hsl(160 45% 52%)');
      fx.append(spark);
      const dx = k === 'kiss' ? (i - 1) * 14 : 18;
      spark.animate([{ transform: `translate(${x - 6}px,${y - 2}px) scale(.3)`, opacity: 0 }, { transform: `translate(${x - 6 + dx * 0.4}px,${y - 22}px) scale(1)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${x - 6 + dx}px,${y - 62}px) scale(.8) rotate(${k === 'sorry' ? 60 : (i - 1) * 15}deg)`, opacity: 0 }],
      { duration: k === 'sorry' ? 1200 : 900, delay: i * 110, easing: 'ease-out', fill: 'both' }).finished.catch(() => {}).then(() => spark.remove());
    }
  }
  function restartClass(node, name) { node.classList.remove(name); void node.offsetWidth; node.classList.add(name); }
  async function put(item, from) {
    const k = item.kind, st = stages[k];
    if (!motionOK() || !from || !onScreen(st.el)) {
      items.push(item); syncStage(k); renderList();
      ballOf(item)?.classList.add('fadein');
      return;
    }
    busy[k] = true;
    st.el.classList.add('open');
    const { k: scale } = pack(k, [...inJar(k), item].slice(-CAP));
    await fly(item, from, st.el, 2 * radius(item) * scale / 320 * st.el.offsetWidth);
    busy[k] = false;
    if (!alive()) return;
    items.push(item); syncStage(k); renderList();
    const ball = ballOf(item);
    ball?.classList.add('drop');
    later(() => st.el.classList.remove('open'), 200);
    await wait(650);
    if (!ball?.isConnected) return;
    ball.classList.remove('drop');
    restartClass(st.el, 'wobble');
    ball.classList.add('glow');
    burst(k, ball);
  }

  async function send(k, from, draft = {}, requestId = crypto.randomUUID()) {
    if (busy[k] || status !== 'ready') return;
    hideToast();
    const occurredAt = new Date().toISOString();
    const item = { id: requestId, kind: k, ownerId: viewer, occurredAt, localDate: localDate(occurredAt), time: localTime(occurredAt), visibility: k === 'mood' ? draft.visibility : 'shared', pending: true, ...draft };
    const answer = api.create({ requestId, kind: k, ...draft }).then(data => data.record, () => null);
    await put(item, from);
    const record = await answer;
    if (!alive()) return;
    if (record) {
      Object.assign(item, record, { pending: false });
      refreshItem(item);
      toast(k === 'kiss' ? `Đã thả một nụ hôn vào bình cho ${NAME[partner]}.` : k === 'sorry' ? `Đã thả một lời xin lỗi vào bình cho ${NAME[partner]}.` : 'Đã thả cảm xúc vào bình.', { label: 'Hoàn tác', fn: () => takeOut(item) });
      return;
    }
    ballOf(item)?.classList.add('failed');
    await wait(500);
    items = items.filter(x => x !== item);
    syncStage(k); renderList();
    // A retry keeps the requestId, so a request that did reach the server is not stored twice.
    if (k === 'mood') openMood({ draft, requestId, opener: acts.mood, error: 'Chưa lưu được vì mất kết nối. Nội dung bạn viết vẫn còn đây, bấm “Thả vào bình” để thử lại.' });
    else toast(`Chưa gửi được ${k === 'kiss' ? 'nụ hôn' : 'lời xin lỗi'}. Kiểm tra mạng rồi thử lại.`, { label: 'Thử lại', fn: () => send(k, acts[k].getBoundingClientRect(), {}, requestId) }, true);
  }

  async function takeOut(item) {
    items = items.filter(x => x.id !== item.id);
    syncStage(item.kind); renderList();
    try {
      const { record } = await api.archive(item.id);
      if (!alive()) return;
      Object.assign(item, record);
      toast('Đã lấy viên này ra khỏi bình.', { label: 'Hoàn tác', fn: () => putBack(item) });
    } catch {
      if (!alive()) return;
      if (!items.some(x => x.id === item.id)) items.push(item);
      syncStage(item.kind); renderList();
      toast('Chưa lấy viên này ra được. Kiểm tra mạng rồi thử lại.', { label: 'Thử lại', fn: () => takeOut(item) }, true);
    }
  }
  async function putBack(item) {
    try {
      const { record } = await api.restore(item.id);
      if (!alive()) return;
      Object.assign(item, record);
      delete item.archivedAt;
      if (!items.some(x => x.id === item.id)) items.push(item);
      syncStage(item.kind); renderList();
      ballOf(item)?.classList.add('fadein');
      toast('Viên này đã về lại bình.');
    } catch {
      if (alive()) toast('Chưa hoàn tác được. Kiểm tra mạng rồi thử lại.', { label: 'Thử lại', fn: () => putBack(item) }, true);
    }
  }

  // The toast lives outside the jars and the list, so it can carry an action without cutting an animation.
  function toast(message, action, error = false) {
    clearTimeout(toastTimer);
    const box = el('div', `jar-toast${error ? ' err' : ''}`);
    box.append(el('span', '', message));
    if (action) {
      const act = button('', action.label);
      act.addEventListener('click', () => { hideToast(); action.fn(); });
      box.append(act);
    }
    toastHost.replaceChildren(box);
    toastTimer = setTimeout(hideToast, action ? 6000 : 3200);
  }
  function hideToast() { clearTimeout(toastTimer); toastHost.replaceChildren(); }

  // Native modal dialog: focus stays inside, Esc closes; a tap on the backdrop closes; focus returns to the opener.
  function sheet(titleText, opener, { form = false, onClose } = {}) {
    openSheet?.dialog.close();
    const dialog = el('dialog', 'jar-sheet'), box = el(form ? 'form' : 'div', 'jar-sheet-box'), head = el('div', 'jar-sheet-head');
    const heading = el('h2', '', titleText); heading.id = `jar-sheet-title-${Date.now()}`;
    const close = button('jar-icon-btn', '×'); close.setAttribute('aria-label', 'Đóng');
    close.addEventListener('click', () => dialog.close());
    dialog.setAttribute('aria-labelledby', heading.id);
    head.append(heading, close); box.append(head); dialog.append(box);
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    const current = { dialog, box, opener };
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (openSheet === current) openSheet = null;
      onClose?.();
      const target = current.opener?.isConnected ? current.opener : acts[kind];
      if (alive() && !openSheet) target.focus();
    });
    root.append(dialog);
    openSheet = current;
    return current;
  }
  function openList() {
    const s = sheet(listTitle.textContent, listBtn, { onClose: () => { top.append(chips); shelf.after(listSection); } });
    s.dialog.classList.add('jar-list-sheet');
    s.box.append(chips, listSection);
    s.dialog.showModal();
  }
  const actionsRow = (...buttons) => { const row = el('div', 'jar-actions'); row.append(...buttons); return row; };

  function openBall(id, opener) {
    const item = items.find(x => x.id === id);
    if (!item || item.pending) return;
    selectedId = id; syncStage(item.kind);
    const mine = item.ownerId === viewer;
    const s = sheet(item.kind === 'mood' ? moodName(item) : KIND_NAME[item.kind], opener, { onClose: () => { selectedId = null; if (alive()) syncStage(item.kind); } });
    const headRow = el('div', 'jar-ball-head'), who = el('span', '', item.kind === 'mood' ? `Cảm xúc của ${NAME[item.ownerId]}` : `${NAME[item.ownerId]} gửi ${NAME[other(item.ownerId)]}`);
    who.append(el('br'), el('small', '', `${vnDate(item.localDate)}, ${item.time}`));
    headRow.append(mini(item.kind, ballColor(item), 'big'), who);
    s.box.append(headRow);
    if (item.kind === 'mood') {
      const dims = el('dl', 'jar-dims');
      for (const [label, cls, left, word] of [['Dễ chịu', 'val', (item.valence + 1) * 50, valenceWord(item.valence)], ['Năng lượng', 'en', item.energy * 100, energyWord(item.energy)]]) {
        const rowEl = el('div'), dd = el('dd'), meter = el('span', `jar-meter ${cls}`), knob = el('i');
        knob.style.left = `${left}%`; meter.append(knob); dd.append(meter, word);
        rowEl.append(el('dt', '', label), dd); dims.append(rowEl);
      }
      s.box.append(dims);
      if (item.note) s.box.append(el('p', 'jar-hand', item.note));
      s.box.append(el('span', `jar-badge${item.visibility === 'shared' ? ' both' : ''}`, item.visibility === 'shared' ? `${NAME.minhle} và ${NAME.haiyen} cùng xem` : 'Chỉ mình bạn xem'));
    }
    const actions = [];
    if (mine && item.kind === 'mood') {
      const edit = button('jar-btn small', 'Sửa');
      edit.addEventListener('click', () => openMood({ item, opener }));
      const share = button('jar-btn small', item.visibility === 'shared' ? 'Thôi chia sẻ' : `Cho ${NAME[partner]} xem`);
      share.addEventListener('click', () => toggleShare(item, share));
      actions.push(edit, share);
    }
    if (mine) {
      const remove = button('jar-btn small danger', 'Lấy ra khỏi bình');
      remove.addEventListener('click', () => { s.opener = acts[item.kind]; s.dialog.close(); takeOut(item); });
      actions.push(remove);
    } else if (item.kind === 'kiss') {
      const back = button('jar-btn primary', `Hôn lại ${NAME[item.ownerId]}`);
      back.addEventListener('click', () => { const from = back.getBoundingClientRect(); s.opener = acts.kiss; s.dialog.close(); setKind('kiss'); send('kiss', from); });
      actions.push(back);
    }
    // Receiving an apology has no button: it does not mean it was forgiven.
    if (actions.length) s.box.append(actionsRow(...actions));
    s.dialog.showModal();
  }

  async function toggleShare(item, control) {
    control.disabled = true;
    const visibility = item.visibility === 'shared' ? 'private' : 'shared';
    try {
      const { record } = await api.update(item.id, { version: item.version, visibility });
      if (!alive()) return;
      openSheet?.dialog.close();
      refreshItem(upsert(item, record));
      toast(visibility === 'shared' ? `${NAME[partner]} giờ xem được cảm xúc này.` : 'Giờ chỉ mình bạn xem cảm xúc này.');
    } catch (error) {
      if (!alive()) return;
      control.disabled = false;
      if (error.status === 409 || error.status === 404) { openSheet?.dialog.close(); load(); }
      toast(error.status === 409 ? 'Cảm xúc này vừa được sửa ở nơi khác. Đã tải bản mới.' : 'Chưa đổi được. Kiểm tra mạng rồi thử lại.', error.status === 409 || error.status === 404 ? null : { label: 'Thử lại', fn: () => toggleShare(item, control) }, true);
    }
  }

  function openMood({ item = null, draft = {}, requestId, error = '', opener }) {
    const base = { valence: 0.2, energy: 0.5, label: '', note: '', visibility: 'private', ...(item || {}), ...draft };
    const mv = { valence: base.valence, energy: base.energy };
    let version = item?.version;
    const s = sheet(item ? 'Sửa cảm xúc' : 'Bạn đang thấy thế nào?', opener, { form: true });
    const alert = el('div', 'jar-alert', error); alert.setAttribute('role', 'alert'); alert.hidden = !error;
    const pad = el('div', 'jar-pad'); pad.setAttribute('aria-hidden', 'true');
    for (const [cls, text] of [['tl', 'Căng thẳng'], ['tr', 'Hào hứng'], ['bl', 'Buồn, mệt'], ['br', 'Bình yên']]) pad.append(el('span', `q ${cls}`, text));
    const padBall = mini('mood', moodColor(mv.valence), 'jar-pad-ball'); pad.append(padBall);
    const slider = (labelText, min, ends) => {
      const wrap = el('label', 'jar-range'), word = el('b'), input = el('input'), endRow = el('span', 'ends');
      const caption = el('span', '', `${labelText}: `); caption.append(word);
      Object.assign(input, { type: 'range', min, max: 100, step: 5 });
      endRow.setAttribute('aria-hidden', 'true'); endRow.append(el('span', '', ends[0]), el('span', '', ends[1]));
      wrap.append(caption, input, endRow);
      return { wrap, word, input };
    };
    const val = slider('Mức dễ chịu', -100, ['Khó chịu', 'Dễ chịu']), en = slider('Năng lượng', 0, ['Uể oải', 'Tràn năng lượng']);
    val.input.autofocus = true;
    const field = (labelText, control) => { const wrap = el('label', 'jar-field'); wrap.append(el('span', '', labelText), control); return wrap; };
    const label = Object.assign(el('input'), { name: 'label', maxLength: 80, placeholder: 'Ví dụ: Bình yên', value: base.label });
    const sugg = el('div', 'jar-sugg'); sugg.setAttribute('role', 'group'); sugg.setAttribute('aria-label', 'Gợi ý tên');
    const note = Object.assign(el('textarea'), { name: 'note', maxLength: 1000, value: base.note });
    const count = el('small', 'jar-count');
    const updateCount = () => { count.textContent = `${note.value.length}/1000`; };
    note.addEventListener('input', updateCount); updateCount();
    const audience = el('fieldset', 'jar-aud');
    audience.append(el('legend', '', 'Ai xem'));
    for (const [value, text] of [['private', 'Chỉ mình tôi'], ['shared', `Cho ${NAME[partner]} xem cùng`]]) {
      const option = el('label'), radio = Object.assign(el('input'), { type: 'radio', name: 'visibility', value, checked: base.visibility === value });
      option.append(radio, ` ${text}`); audience.append(option);
    }
    const cancel = button('jar-btn', 'Hủy'); cancel.addEventListener('click', () => s.dialog.close());
    const submit = el('button', 'jar-btn primary', item ? 'Lưu' : 'Thả vào bình'); submit.type = 'submit';
    const noteField = field('Ghi chú (không bắt buộc)', note); noteField.append(count);
    s.box.append(alert, pad, el('p', 'jar-pad-hint', 'Chạm hoặc kéo trong ô, hoặc dùng hai thanh trượt.'), val.wrap, en.wrap,
      field('Gọi tên cảm xúc (không bắt buộc)', label), sugg, noteField, audience, actionsRow(cancel, submit));

    let shownQuadrant = null;
    function sync() {
      padBall.style.left = `${6 + (mv.valence + 1) * 44}%`; padBall.style.top = `${6 + (1 - mv.energy) * 88}%`;
      padBall.style.width = padBall.style.height = `${22 + 26 * mv.energy}px`;
      padBall.style.setProperty('--c', moodColor(mv.valence));
      val.input.value = Math.round(mv.valence * 100); en.input.value = Math.round(mv.energy * 100);
      val.input.setAttribute('aria-valuetext', valenceWord(mv.valence)); en.input.setAttribute('aria-valuetext', energyWord(mv.energy));
      val.word.textContent = valenceWord(mv.valence); en.word.textContent = energyWord(mv.energy);
      const q = quadrant(mv.valence, mv.energy);
      if (q === shownQuadrant) return;
      shownQuadrant = q;
      sugg.replaceChildren(...SUGG[q].map(word => { const chip = button('jar-chip', word); chip.addEventListener('click', () => { label.value = word; }); return chip; }));
    }
    val.input.addEventListener('input', () => { mv.valence = +val.input.value / 100; sync(); });
    en.input.addEventListener('input', () => { mv.energy = +en.input.value / 100; sync(); });
    // Pointer only; the two sliders carry the keyboard path.
    const padSet = event => {
      const r = pad.getBoundingClientRect();
      const fx0 = Math.min(1, Math.max(0, ((event.clientX - r.left) / r.width - 0.06) / 0.88)), fy = Math.min(1, Math.max(0, ((event.clientY - r.top) / r.height - 0.06) / 0.88));
      mv.valence = Math.round((fx0 * 2 - 1) * 20) / 20; mv.energy = Math.round((1 - fy) * 20) / 20; sync();
    };
    pad.addEventListener('pointerdown', event => { pad.setPointerCapture(event.pointerId); padSet(event); });
    pad.addEventListener('pointermove', event => { if (pad.hasPointerCapture(event.pointerId)) padSet(event); });
    sync();

    s.box.addEventListener('submit', async event => {
      event.preventDefault();
      const data = { valence: mv.valence, energy: mv.energy, label: label.value.trim().slice(0, 80), note: note.value.slice(0, 1000), visibility: s.box.elements.visibility.value || 'private' };
      if (!item) {
        const from = padBall.getBoundingClientRect();
        s.opener = acts.mood; s.dialog.close(); setKind('mood');
        send('mood', from, data, requestId);
        return;
      }
      submit.disabled = true;
      try {
        const { record } = await api.update(item.id, { version, ...data });
        if (!alive()) return;
        s.dialog.close(); refreshItem(upsert(item, record));
        toast('Đã lưu cảm xúc.');
      } catch (failure) {
        if (!alive()) return;
        submit.disabled = false;
        if (failure.status === 409) {
          await load();
          version = items.find(x => x.id === item.id)?.version ?? version;
          alert.textContent = 'Cảm xúc này vừa được sửa ở nơi khác. Bản bạn đang viết vẫn còn nguyên; bấm “Lưu” để ghi đè.';
        } else alert.textContent = failure.status === 404 ? 'Viên này không còn trong bình.' : 'Chưa lưu được. Nội dung bạn viết vẫn còn đây, thử lại nhé.';
        alert.hidden = false;
      }
    });
    s.dialog.showModal();
  }

  // Phone: swipe across the jar to change jars.
  shelf.addEventListener('pointerdown', event => { if (phoneQuery.matches && event.target.closest('.jar-stage')) swipe = { x: event.clientX, y: event.clientY }; });
  shelf.addEventListener('pointerup', event => {
    if (!swipe) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { swallowClick = true; later(() => { swallowClick = false; }, 0); setKind(KINDS[(KINDS.indexOf(kind) + (dx < 0 ? 1 : -1) + 3) % 3]); }
  });
  shelf.addEventListener('pointercancel', () => { swipe = null; });
  shelf.addEventListener('click', event => { if (swallowClick) { event.stopPropagation(); swallowClick = false; } }, true);

  // A session that ends while the page is open takes the private jars off the screen.
  authEvents.addEventListener('change', () => {
    if (getUser()?.id === viewer || !alive()) return;
    openSheet?.dialog.close(); hideToast(); items = [];
    const login = button('jar-btn primary', 'Đăng nhập');
    login.addEventListener('click', () => authEvents.dispatchEvent(new Event('login-request')));
    const gone = el('div', 'jar-gone'); gone.append(el('p', '', 'Phiên đăng nhập đã kết thúc. Đăng nhập lại để mở Hũ.'), login);
    root.replaceChildren(title, gone);
  }, { signal });

  setKind('kiss');
  load();

  function cleanup() {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', cleanup);
    for (const id of timers) clearTimeout(id);
    clearTimeout(toastTimer);
    openSheet?.dialog.close();
    root.remove();
  }
  signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}
