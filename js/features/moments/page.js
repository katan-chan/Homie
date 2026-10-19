// Khoảnh khắc page: capture (capture.js) on top, then the shared album; on phones the camera and the album are two
// views. The viewer shows one moment with download, and caption edit / delete for its owner. User text via textContent.
import { apiRequest, getUser } from '../../auth.js';
import { API_BASE_URL } from '../../config.js';
import { NAME, addDays, localDate } from '../jar/model.js';
import { button, createCapture, el } from './capture.js';
import { withCaption } from './image.js';
import { fileName, saveImage } from './save.js';

export const FOCUS_KEY = 'homie.moments.focus';
const enc = encodeURIComponent;
export const momentsApi = {
  list: (query, signal) => apiRequest(`/api/moments${query}`, { signal }),
  create: body => apiRequest('/api/moments', { method: 'POST', body }),
  update: (id, body) => apiRequest(`/api/moments/${enc(id)}`, { method: 'PUT', body }),
  remove: id => apiRequest(`/api/moments/${enc(id)}`, { method: 'DELETE' }),
};
const KIND = { booth: 'Photobooth', snap: 'Chụp nhanh', upload: 'Từ máy' };
const FILTERS = [['all', 'Tất cả'], ['minhle', 'Của Minh'], ['haiyen', 'Của Yến']];
const desktopQuery = matchMedia('(min-width: 900px) and (pointer: fine)');

function when(moment, today = localDate()) {
  const [y, m, d] = moment.localDate.split('-');
  const day = moment.localDate === today ? 'Hôm nay' : moment.localDate === addDays(today, -1) ? 'Hôm qua' : `${+d}/${+m}${y === today.slice(0, 4) ? '' : `/${y}`}`;
  return `${day} ${moment.time}`;
}
function image(url, alt = '') {
  const img = el('img');
  img.src = API_BASE_URL + url; img.alt = alt; img.loading = 'lazy'; img.decoding = 'async';
  return img;
}
function caption(text) {
  const cap = el('span', 'moments-cap', text);
  cap.hidden = !text;
  return cap;
}

export function mountMoments(container, { signal, api = momentsApi }) {
  const me = getUser()?.id;
  let items = [], status = 'loading', filter = 'all', phoneView = 'camera', reviewing = false, albumMode = 'feed', viewer = null, capture = null, disposed = false, toastTimer = 0, opener = null;
  let desktop = desktopQuery.matches;
  const alive = () => !disposed && !signal.aborted;

  const root = el('section', 'moments-page');
  const head = el('div', 'moments-head');
  const title = el('h1', 'moments-title', 'Khoảnh khắc');
  const sub = el('p', 'moments-sub', 'Chụp photobooth cùng nhau, hoặc chọn ảnh có sẵn trong máy.');
  const count = button('', 'moments-btn moments-count', () => showPhone('album'));
  const captureHost = el('div', 'moments-capture');
  const swipe = button('⌃ Vuốt lên để xem ảnh đã lưu', 'moments-swipe', () => showPhone('album'));
  const album = el('section', 'moments-album');
  album.setAttribute('aria-label', 'Ảnh đã lưu');
  // The viewer sits on <body>: inside the tab panel it would stay under the app's menu button.
  const overlay = el('div', 'moments-layer');
  const toastHost = el('div', 'moments-toast-host');
  toastHost.setAttribute('aria-live', 'polite');
  root.append(head, captureHost, swipe, album, toastHost);
  container.replaceChildren(root);
  document.body.append(overlay);

  function toast(text, { error = false } = {}) {
    clearTimeout(toastTimer);
    toastHost.replaceChildren(el('div', `moments-toast${error ? ' err' : ''}`, text));
    toastTimer = setTimeout(() => toastHost.replaceChildren(), 2800);
  }
  async function download(blob) {
    const where = await saveImage(blob, fileName());
    toast(where === 'gallery' ? 'Đã lưu vào thư viện ảnh (Pictures/Homie).' : `Đã tải về ${fileName()}.`);
  }
  async function downloadMoment(moment) {
    try {
      const response = await fetch(API_BASE_URL + moment.fileUrl, { credentials: 'include' });
      if (!response.ok) throw new Error('fetch');
      await download(await withCaption(await response.blob(), moment.caption));
    } catch { toast('Không tải được ảnh. Thử lại nhé.', { error: true }); }
  }

  /* ---------- capture ---------- */
  function mountCapture() {
    capture?.destroy();
    capture = null;
    if (!desktop && phoneView !== 'camera') return;
    reviewing = false;
    capture = createCapture({
      host: captureHost, desktop, toast, onDownload: download,
      // A photo waiting to be saved must not be thrown away by the album shortcuts.
      onReview: open => { reviewing = open; renderHead(); },
      onSave: async body => {
        const { moment } = await api.create(body);
        if (!alive()) return;
        items = [moment, ...items.filter(item => item.id !== moment.id)];
        renderAlbum(); renderHead();
      },
    });
  }
  function showPhone(view) {
    if (desktop || phoneView === view || reviewing) return;
    phoneView = view;
    root.classList.toggle('album-open', view === 'album');
    mountCapture(); renderAlbum(); renderHead();
    (view === 'album' ? album.querySelector('button') : count)?.focus();
  }

  /* ---------- head ---------- */
  function renderHead() {
    root.classList.toggle('desktop', desktop);
    head.replaceChildren(title);
    if (desktop) { head.append(sub); swipe.hidden = true; return; }
    swipe.hidden = phoneView !== 'camera' || reviewing;
    if (phoneView === 'camera') { if (!reviewing) { count.textContent = `Đã lưu · ${items.length}`; head.append(count); } }
    else head.append(button('‹ Camera', 'moments-btn', () => showPhone('camera')));
  }

  /* ---------- album ---------- */
  const visible = () => items.filter(item => filter === 'all' || item.ownerId === filter);
  function meta(moment) {
    const row = el('div', 'moments-meta');
    const who = el('span', `moments-who ${moment.ownerId}`, NAME[moment.ownerId]?.[0] ?? '?');
    who.setAttribute('aria-hidden', 'true');
    row.append(who, el('span', '', `${NAME[moment.ownerId] ?? ''} · ${when(moment)}`), el('span', 'moments-kind', KIND[moment.kind]));
    return row;
  }
  function seg(label, options, current, onPick) {
    const group = el('div', 'moments-seg');
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const b = button(text, '', () => onPick(value));
      b.setAttribute('aria-pressed', String(value === current));
      group.append(b);
    }
    return group;
  }
  function chips() {
    const group = el('div', 'moments-chips');
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Lọc theo người chụp');
    for (const [value, text] of FILTERS) {
      const b = button(text, 'moments-chip', () => { filter = value; renderAlbum(); });
      b.setAttribute('aria-pressed', String(filter === value));
      group.append(b);
    }
    return group;
  }
  function card(moment) {
    const b = button('', 'moments-card', event => openViewer(moment.id, 'view', event.currentTarget));
    b.setAttribute('aria-label', `Mở ảnh của ${NAME[moment.ownerId]}, ${when(moment)}`);
    const pic = el('div', 'moments-pic');
    pic.append(image(moment.fileUrl), caption(moment.caption));
    b.append(pic, meta(moment));
    return b;
  }
  function feedItem(moment) {
    const article = el('article', 'moments-feed-item');
    const open = button('', 'moments-feed-pic', event => openViewer(moment.id, 'view', event.currentTarget));
    open.setAttribute('aria-label', `Mở ảnh của ${NAME[moment.ownerId]}, ${when(moment)}`);
    const pic = el('div', 'moments-pic');
    pic.append(image(moment.fileUrl), caption(moment.caption));
    open.append(pic);
    const actions = el('div', 'moments-row');
    actions.append(button('⤓ Tải về', 'moments-btn', () => downloadMoment(moment)));
    if (moment.ownerId === me) {
      actions.append(button('Sửa dòng chữ', 'moments-btn', event => openViewer(moment.id, 'edit', event.currentTarget)),
        button('Xóa', 'moments-btn', event => openViewer(moment.id, 'confirm', event.currentTarget)));
    }
    article.append(open, meta(moment), actions);
    return article;
  }
  function renderAlbum() {
    if (!desktop && phoneView !== 'album') { album.hidden = true; album.replaceChildren(); return; }
    album.hidden = false;
    const bar = el('div', 'moments-albumbar');
    bar.append(el('h2', '', 'Đã lưu'));
    if (!desktop) bar.append(seg('Kiểu xem', [['feed', 'Từng tấm'], ['grid', 'Lưới']], albumMode, mode => { albumMode = mode; renderAlbum(); }));
    bar.append(chips());
    const body = [];
    if (status === 'loading') body.push(el('p', 'moments-empty', 'Đang tải ảnh…'));
    else if (status === 'error') {
      const line = el('p', 'moments-empty', 'Chưa tải được ảnh. ');
      line.append(button('Thử lại', 'moments-btn', load));
      body.push(line);
    } else if (!visible().length) body.push(el('p', 'moments-empty', 'Chưa có ảnh nào ở đây.'));
    else if (desktop) { const list = el('div', 'moments-cards'); list.append(...visible().map(card)); body.push(list); }
    else if (albumMode === 'grid') {
      const grid = el('div', 'moments-grid');
      for (const moment of visible()) {
        const b = button('', '', event => openViewer(moment.id, 'view', event.currentTarget));
        b.setAttribute('aria-label', `Mở ảnh của ${NAME[moment.ownerId]}, ${when(moment)}`);
        b.append(image(moment.thumbUrl));
        grid.append(b);
      }
      body.push(grid);
    } else { const feed = el('div', 'moments-feed'); feed.append(...visible().map(feedItem)); body.push(feed); }
    album.replaceChildren(bar, ...body);
  }

  /* ---------- viewer ---------- */
  function openViewer(id, mode = 'view', from = null) {
    opener = from ?? opener;
    viewer = { id, mode, busy: false };
    renderViewer();
    overlay.querySelector(mode === 'edit' ? 'input' : mode === 'confirm' ? '[data-keep]' : '[aria-label="Đóng"]')?.focus();
  }
  function closeViewer() {
    viewer = null;
    overlay.replaceChildren();
    if (opener?.isConnected) opener.focus();
    opener = null;
  }
  function step(delta) {
    const list = visible(), index = list.findIndex(item => item.id === viewer?.id);
    const next = list[index + delta];
    if (next) { viewer = { id: next.id, mode: 'view', busy: false }; renderViewer(); }
  }
  async function saveCaption(moment, value) {
    viewer.busy = true; renderViewer();
    try {
      const { moment: saved } = await api.update(moment.id, { caption: value, version: moment.version });
      if (!alive()) return;
      items = items.map(item => (item.id === saved.id ? saved : item));
      viewer = { id: saved.id, mode: 'view', busy: false };
      renderAlbum(); renderViewer(); toast('Đã sửa dòng chữ.');
    } catch (error) {
      if (!alive()) return;
      viewer.busy = false; renderViewer();
      toast(error.status === 409 ? 'Ảnh vừa được sửa ở máy khác. Tải lại trang rồi thử nhé.' : 'Chưa sửa được, thử lại nhé.', { error: true });
    }
  }
  async function removeMoment(moment) {
    viewer.busy = true; renderViewer();
    try {
      await api.remove(moment.id);
      if (!alive()) return;
      items = items.filter(item => item.id !== moment.id);
      opener = null; closeViewer(); renderAlbum(); renderHead(); toast('Đã xóa ảnh.');
    } catch {
      if (!alive()) return;
      viewer.busy = false; renderViewer(); toast('Chưa xóa được, thử lại nhé.', { error: true });
    }
  }
  function renderViewer() {
    const list = visible(), index = list.findIndex(item => item.id === viewer?.id), moment = list[index];
    if (!moment) { closeViewer(); return; }
    const mine = moment.ownerId === me;
    const box = el('div', 'moments-viewer');
    box.dataset.id = moment.id;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Xem ảnh');
    const top = el('div', 'moments-vtop');
    const close = button('✕', 'moments-vbtn', closeViewer);
    close.setAttribute('aria-label', 'Đóng');
    top.append(meta(moment), close);
    const body = el('div', 'moments-vbody');
    const prev = button('‹', 'moments-vbtn', () => step(-1)), next = button('›', 'moments-vbtn', () => step(1));
    prev.setAttribute('aria-label', 'Ảnh mới hơn'); next.setAttribute('aria-label', 'Ảnh cũ hơn');
    prev.disabled = index === 0; next.disabled = index === list.length - 1;
    const pic = el('div', 'moments-vpic');
    pic.append(image(moment.fileUrl, `Ảnh của ${NAME[moment.ownerId]}`));
    if (viewer.mode !== 'edit') pic.append(caption(moment.caption));
    body.append(prev, pic, next);
    let actions;
    if (viewer.mode === 'confirm' && mine) {
      actions = el('div', 'moments-confirm');
      actions.setAttribute('role', 'alertdialog'); actions.setAttribute('aria-labelledby', 'moments-confirm-q');
      const q = el('p', '', 'Xóa hẳn tấm này? Không lấy lại được.');
      q.id = 'moments-confirm-q';
      const row = el('div', 'moments-row center');
      const yes = button('Xóa hẳn', 'moments-btn danger', () => removeMoment(moment));
      const keep = button('Giữ lại', 'moments-btn', () => { viewer.mode = 'view'; renderViewer(); });
      keep.dataset.keep = '';
      yes.disabled = keep.disabled = viewer.busy;
      row.append(yes, keep);
      actions.append(q, row);
    } else if (viewer.mode === 'edit' && mine) {
      actions = el('div', 'moments-vedit');
      const input = el('input');
      input.maxLength = 40; input.value = moment.caption; input.placeholder = 'Một dòng chữ'; input.setAttribute('aria-label', 'Dòng chữ');
      input.disabled = viewer.busy;
      const ok = button('Lưu', 'moments-vbtn', () => saveCaption(moment, input.value));
      input.addEventListener('keydown', event => { if (event.key === 'Enter') ok.click(); });
      const cancel = button('Hủy', 'moments-vbtn', () => { viewer.mode = 'view'; renderViewer(); });
      ok.disabled = cancel.disabled = viewer.busy;
      actions.append(input, ok, cancel);
    } else {
      actions = el('div', 'moments-vactions');
      actions.append(button('⤓ Tải về', 'moments-vbtn', () => downloadMoment(moment)));
      if (mine) {
        actions.append(button('Sửa dòng chữ', 'moments-vbtn', () => { viewer.mode = 'edit'; renderViewer(); overlay.querySelector('input')?.focus(); }),
          button('Xóa', 'moments-vbtn', () => { viewer.mode = 'confirm'; renderViewer(); overlay.querySelector('[data-keep]')?.focus(); }));
      }
    }
    box.append(top, body, actions);
    overlay.replaceChildren(box);
  }
  function onKey(event) {
    if (!viewer) return;
    if (event.key === 'Escape') { if (viewer.mode !== 'view') { viewer.mode = 'view'; renderViewer(); } else closeViewer(); }
    else if (viewer.mode === 'view' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) step(event.key === 'ArrowLeft' ? -1 : 1);
    else if (event.key === 'Tab') {
      const focusable = [...overlay.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  /* ---------- data and lifecycle ---------- */
  async function load() {
    status = 'loading'; renderAlbum();
    try {
      const data = await api.list('', signal);
      if (!alive()) return;
      items = data.moments; status = 'ready';
    } catch {
      if (!alive()) return;
      status = 'error';
    }
    renderHead(); renderAlbum();
    const wanted = focus;
    focus = null;
    if (wanted && items.some(item => item.id === wanted)) { filter = 'all'; renderAlbum(); openViewer(wanted); }
    else if (wanted && !desktop) showPhone('camera');
  }
  let touchY = null;
  const onTouchStart = event => { touchY = event.touches[0].clientY; };
  const onTouchEnd = event => {
    if (touchY !== null && !desktop && phoneView === 'camera' && event.changedTouches[0].clientY - touchY < -60) showPhone('album');
    touchY = null;
  };
  const onMode = () => {
    if (desktop === desktopQuery.matches) return;
    desktop = desktopQuery.matches; phoneView = 'camera'; root.classList.remove('album-open');
    mountCapture(); renderHead(); renderAlbum();
  };
  // Opened from Lịch: on a phone go straight to the album, so the camera never starts for a photo being viewed.
  let focus = null;
  try { focus = sessionStorage.getItem(FOCUS_KEY); sessionStorage.removeItem(FOCUS_KEY); } catch {}
  if (focus && !desktop) { phoneView = 'album'; root.classList.add('album-open'); }
  captureHost.addEventListener('touchstart', onTouchStart, { passive: true });
  captureHost.addEventListener('touchend', onTouchEnd, { passive: true });
  desktopQuery.addEventListener('change', onMode);
  document.addEventListener('keydown', onKey);
  renderHead(); mountCapture(); renderAlbum(); load();

  return () => {
    disposed = true;
    clearTimeout(toastTimer);
    desktopQuery.removeEventListener('change', onMode);
    document.removeEventListener('keydown', onKey);
    capture?.destroy();
    overlay.remove();
  };
}
