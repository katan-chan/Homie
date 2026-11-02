// Vị trí: both members on an Esri map with their picture, note and "x phút trước"; each sets a note that expires; a
// day's timeline of named places joined by the shortest road. The phone shares in the background (share.js); the web
// only looks. Calls /api/location, /api/places, /api/timeline and the public profiles.
import * as config from '../../config.js';
import { apiRequest, getUser } from '../../auth.js';
import { avatarNode } from '../avatar/editor.js';
import { clock, duration, localDay, personLine } from './format.js';
import { mountSharing } from './share.js';

const PEOPLE = [{ id: 'minhle', short: 'Minh', accent: '#6e7b5b' }, { id: 'haiyen', short: 'Yến', accent: '#985a74' }];
const REFRESH_MS = 30000;
const CENTER = [21.0285, 105.8542];
const TILES = 'https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/arcgis/streets/static/tile/{z}/{y}/{x}';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function loadLeafletCss() {
  const href = new URL('../../../assets/vendor/leaflet.css', import.meta.url).href;
  if ([...document.styleSheets].some(sheet => sheet.href === href) || document.querySelector(`link[href="${href}"]`)) return;
  const link = el('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

export function mountLocation(container, { signal }) {
  const local = new AbortController();
  const on = local.signal;
  const stop = () => local.abort();
  signal.addEventListener('abort', stop, { once: true });
  const button = (text, className, onClick) => {
    const b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick, { signal: on });
    return b;
  };

  // The map covers the window. Everything else is in one bar: on wide screens fixed to the right edge, full height, slid
  // out and back with a handle on its edge; on phones fixed to the bottom edge, swiped between open, half and hidden.
  const page = el('section', 'location-page');
  const mapEl = el('div', 'location-map');
  mapEl.setAttribute('role', 'application');
  mapEl.setAttribute('aria-label', 'Bản đồ vị trí');
  const mapNote = el('p', 'location-map-note');
  mapNote.hidden = true;
  const cross = el('span', 'location-cross');
  cross.hidden = true;
  const bar = el('aside', 'location-bar');
  bar.setAttribute('aria-label', 'Vị trí');
  const handle = el('button', 'location-handle');
  handle.type = 'button';
  handle.setAttribute('aria-controls', 'location-bar-content');
  handle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg><span></span>';
  const content = el('div', 'location-bar-content');
  content.id = 'location-bar-content';
  const grip = el('button', 'location-grip');
  grip.type = 'button';
  grip.append(el('span'));
  const head = el('div', 'location-head');
  head.append(el('h1', 'location-title', 'Vị trí'));
  const modes = el('div', 'location-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Chế độ xem');
  head.append(modes);
  const barBody = el('div', 'location-bar-body');
  // What a half-open sheet shows: the two people, or the timeline's who and day.
  const half = el('div', 'location-half');
  const status = el('p', 'location-status form-message');
  status.setAttribute('role', 'status');
  const panel = el('div', 'location-panel');
  barBody.append(half, status, panel);
  content.append(grip, head, barBody);
  bar.append(handle, content);
  page.append(mapEl, mapNote, cross, bar);
  container.replaceChildren(page);

  let L = null, map = null, layer = null;
  // closed: the wide bar slid out. snap: the phone sheet at 'open', 'half' or 'hidden'.
  let closed = false, snap = 'half';
  let mode = 'now', people = null, profiles = {}, now = Date.now();
  let timelineUser = getUser()?.id === 'minhle' ? 'haiyen' : 'minhle', timelineDate = localDay(Date.now()), day = null;
  let sharing = null, timer = null, fitted = false;
  // The note box is rebuilt only when the note itself changes, so a refresh never wipes what is being typed.
  let nowParts = null, noteShown;

  const nameOf = id => profiles[id]?.displayName ?? (id === 'minhle' ? 'Minh Lê' : 'Hải Yến');
  const short = id => PEOPLE.find(p => p.id === id).short;
  const accent = id => PEOPLE.find(p => p.id === id).accent;

  // ----- the bar -----
  // 901 px matches the break in location.css. The phone sheet's snaps are measured from the sheet itself; hidden leaves
  // only the grip strip.
  const wide = () => matchMedia('(min-width: 901px)').matches;
  const SNAPS = ['open', 'half', 'hidden'], STRIP = 46;
  function offsetOf(name) {
    const height = bar.offsetHeight;
    if (name === 'open') return 0;
    if (name === 'hidden') return height - STRIP;
    return Math.max(0, height - (half.getBoundingClientRect().bottom - content.getBoundingClientRect().top + 14));
  }
  let shown = [0, 0];
  /** Puts the bar where its state says (offset: a phone sheet held by a finger) and tells the map how much it covers. */
  function layout(offset) {
    if (wide()) {
      bar.style.transform = closed ? 'translateX(100%)' : '';
      shown = [closed ? 0 : bar.offsetWidth, 0];
      content.inert = closed;
      head.inert = half.inert = panel.inert = false;
    } else {
      const y = offset ?? offsetOf(snap);
      bar.style.transform = `translateY(${y}px)`;
      shown = [0, bar.offsetHeight - y];
      content.inert = false;
      head.inert = half.inert = offset === undefined && snap === 'hidden';
      panel.inert = offset === undefined && snap !== 'open';
    }
    page.style.setProperty('--bar-x', `${shown[0]}px`);
    page.style.setProperty('--bar-y', `${shown[1]}px`);
    handle.lastChild.textContent = closed ? 'Hiện' : 'Ẩn';
    handle.setAttribute('aria-label', closed ? 'Hiện thanh Vị trí' : 'Ẩn thanh, chỉ xem bản đồ');
    handle.setAttribute('aria-expanded', String(!closed));
    grip.setAttribute('aria-label', `Kéo lên hoặc xuống. Đang ${snap === 'open' ? 'mở hết' : snap === 'half' ? 'mở một nửa' : 'ẩn'}`);
    grip.setAttribute('aria-expanded', String(snap !== 'hidden'));
  }
  const setSnap = name => { snap = name; layout(); };
  handle.addEventListener('click', () => { closed = !closed; layout(); }, { signal: on });
  // A tap on the grip (or Enter) steps hidden → half → open → half; a swipe moves one snap, a long quick one to the end.
  let swipe = null, swiped = 0;
  grip.addEventListener('click', () => { if (performance.now() - swiped > 300) setSnap(snap === 'hidden' ? 'half' : snap === 'half' ? 'open' : 'half'); }, { signal: on });
  content.addEventListener('pointerdown', event => {
    if (wide() || !(event.target.closest('.location-grip') || (event.target.closest('.location-head') && !event.target.closest('button,input,select')))) return;
    swipe = { y: event.clientY, t: performance.now(), base: offsetOf(snap), max: bar.offsetHeight - STRIP, moved: false };
    event.target.setPointerCapture?.(event.pointerId);
  }, { signal: on });
  content.addEventListener('pointermove', event => {
    if (!swipe) return;
    const dy = event.clientY - swipe.y;
    if (Math.abs(dy) > 6 && !swipe.moved) { swipe.moved = true; bar.classList.add('is-dragging'); }
    if (swipe.moved) layout(Math.min(swipe.max, Math.max(0, swipe.base + dy)));
  }, { signal: on });
  const release = event => {
    if (!swipe) return;
    const s = swipe;
    swipe = null;
    bar.classList.remove('is-dragging');
    if (!s.moved) return;
    swiped = performance.now();
    const dy = event.clientY - s.y, fast = Math.abs(dy) > 160 && Math.abs(dy) / (swiped - s.t) > 1.2;
    let i = SNAPS.indexOf(snap);
    if (dy > 40) i = fast ? 2 : Math.min(2, i + 1);
    else if (dy < -40) i = fast ? 0 : Math.max(0, i - 1);
    setSnap(SNAPS[i]);
  };
  content.addEventListener('pointerup', release, { signal: on });
  content.addEventListener('pointercancel', release, { signal: on });

  // Points are centred in the part of the map the bar leaves free. On a phone an open sheet drops to half first.
  function centerOn(latlng, zoom) {
    if (!map) return;
    if (!wide() && snap === 'open') setSnap('half');
    const point = map.project(latlng, zoom).add([shown[0] / 2, shown[1] / 2]);
    map.setView(map.unproject(point, zoom), zoom);
  }
  function visibleCenter() {
    const size = map.getSize();
    return map.containerPointToLatLng([(size.x - shown[0]) / 2, (size.y - shown[1]) / 2]);
  }
  // The bar's size changes with its content and the window: keep it in place (without sliding when the window changes).
  const sized = new ResizeObserver(() => { if (!swipe) layout(); });
  sized.observe(bar);
  sized.observe(half);

  function showModes() {
    modes.replaceChildren(...[['now', 'Bây giờ'], ['timeline', 'Timeline']].map(([id, label]) => {
      const b = button(label, 'location-mode', () => { if (mode !== id) { mode = id; fitted = false; showModes(); render(); refresh(); } });
      b.setAttribute('aria-pressed', String(mode === id));
      return b;
    }));
  }

  // ----- map -----
  function pin(id, person) {
    const box = el('div', 'location-pin');
    box.style.setProperty('--profile-accent', accent(id));
    if (person.note) box.append(el('span', 'location-bubble', person.note.text));
    box.append(avatarNode(profiles[id] ?? { id }, nameOf(id)), el('span', 'location-pin-line', personLine(person, now)));
    return L.marker([person.lat, person.lng], {
      icon: L.divIcon({ className: 'location-pin-icon', html: box, iconSize: [52, 52], iconAnchor: [26, 26] }),
      title: nameOf(id), keyboard: false,
    });
  }

  function placeMarker(stop, index) {
    const dot = el('span', 'location-place-dot', String(index + 1));
    return L.marker([stop.lat, stop.lng], {
      icon: L.divIcon({ className: 'location-place-icon', html: dot, iconSize: [28, 28], iconAnchor: [14, 14] }),
      title: stop.name ?? 'Chưa đặt tên', keyboard: false,
    });
  }

  function drawMap() {
    if (!map) return;
    layer.clearLayers();
    const points = [];
    if (mode === 'now' && people) {
      for (const { id } of PEOPLE) {
        const person = people[id];
        if (person.lat === undefined) continue;
        pin(id, person).addTo(layer);
        points.push([person.lat, person.lng]);
      }
    }
    if (mode === 'timeline' && day) {
      day.stops.forEach((s, i) => { placeMarker(s, i).addTo(layer); points.push([s.lat, s.lng]); });
      for (const leg of day.legs) {
        const a = day.stops.find(s => s.placeId === leg.from), b = day.stops.find(s => s.placeId === leg.to);
        const line = leg.route ? leg.route.path : [[a.lat, a.lng], [b.lat, b.lng]];
        L.polyline(line, { className: leg.route ? 'location-route' : 'location-route location-route-straight', color: accent(day.user), weight: 4, dashArray: leg.route ? null : '6 8' }).addTo(layer);
      }
    }
    if (!fitted && points.length) {
      fitted = true;
      if (points.length === 1) centerOn(points[0], 15);
      else {
        map.fitBounds(points, { paddingTopLeft: [60, 100], paddingBottomRight: [shown[0] + 60, shown[1] + 60], maxZoom: 16 });
      }
    }
  }

  async function startMap() {
    loadLeafletCss();
    L = await import(new URL('../../../assets/vendor/leaflet.js', import.meta.url).href);
    if (on.aborted) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    map = L.map(mapEl, { zoomControl: false, attributionControl: true, zoomAnimation: !still, fadeAnimation: !still, markerZoomAnimation: !still, inertia: !still }).setView(CENTER, 13);
    // Bottom right, beside or above the bar (--bar-x, --bar-y).
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Phóng to', zoomOutTitle: 'Thu nhỏ' }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    const key = config.ESRI_BASEMAP_KEY ?? '';
    if (key) {
      L.tileLayer(`${TILES}?token=${encodeURIComponent(key)}`, { tileSize: 512, zoomOffset: -1, maxZoom: 19,
        attribution: 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>' }).addTo(map);
    } else {
      mapNote.hidden = false;
      mapNote.textContent = 'Chưa cài khóa bản đồ Esri nên chưa hiện nền bản đồ.';
    }
    layer = L.layerGroup().addTo(map);
    // A long press (or right click) on the map adds a place right there.
    map.on('contextmenu', event => { if (mode === 'timeline') showAddPlace(event.latlng); });
    drawMap();
  }

  // ----- panel: now -----
  /** Folded: one chip per person; a chip with a position moves the map there. */
  function chips() {
    half.replaceChildren(...PEOPLE.map(({ id }) => {
      const person = people[id];
      const chip = el(person.lat === undefined ? 'div' : 'button', 'location-chip');
      chip.style.setProperty('--profile-accent', accent(id));
      const text = el('span', 'location-chip-text');
      text.append(el('strong', '', nameOf(id)), el('span', 'location-chip-line', person.note ? `“${person.note.text}”` : personLine(person, now)));
      chip.append(avatarNode(profiles[id] ?? { id }, nameOf(id)), text);
      if (person.lat !== undefined) {
        chip.type = 'button';
        chip.dataset.key = `chip-${id}`;
        chip.addEventListener('click', () => centerOn([person.lat, person.lng], 16), { signal: on });
      }
      return chip;
    }));
  }

  function showNow() {
    chips();
    if (!nowParts || !panel.contains(nowParts.list)) {
      nowParts = { list: el('ul', 'location-people'), note: el('div') };
      noteShown = undefined;
      panel.replaceChildren(nowParts.list, nowParts.note, sharing.root);
    }
    const list = nowParts.list;
    list.replaceChildren();
    for (const { id } of PEOPLE) {
      const person = people[id];
      const item = el('li', 'location-person');
      item.style.setProperty('--profile-accent', accent(id));
      const text = el('div', 'location-person-text');
      text.append(el('strong', '', nameOf(id)), el('span', 'location-person-line', personLine(person, now)));
      if (person.place) text.append(el('span', 'location-person-place', `Đang ở ${person.place.name ?? 'một chỗ chưa đặt tên'}`));
      if (person.note) text.append(el('span', 'location-person-note', `“${person.note.text}” · đến ${clock(person.note.expiresAt)}`));
      item.append(avatarNode(profiles[id] ?? { id }, nameOf(id)), text);
      if (person.lat !== undefined) {
        item.append(button('Xem', 'secondary-button', () => centerOn([person.lat, person.lng], 16)));
        item.lastChild.setAttribute('aria-label', `Xem ${nameOf(id)} trên bản đồ`);
      }
      list.append(item);
    }
    const note = people[getUser()?.id]?.note ?? null;
    const key = note ? `${note.text}|${note.expiresAt}` : '';
    if (key !== noteShown) { noteShown = key; nowParts.note.replaceChildren(noteForm()); }
  }

  function noteForm() {
    const mine = people[getUser()?.id]?.note;
    const form = el('form', 'location-note');
    const label = el('label', '', 'Note của bạn');
    label.htmlFor = 'location-note-text';
    const input = el('input');
    input.id = 'location-note-text';
    input.maxLength = 60;
    input.placeholder = 'Đang làm gì nè…';
    input.autocomplete = 'off';
    const hours = el('select');
    hours.setAttribute('aria-label', 'Giữ note trong');
    for (const h of [1, 4, 24]) { const o = el('option', '', `${h} giờ`); o.value = String(h); hours.append(o); }
    const send = el('button', 'primary-button', 'Đăng');
    send.type = 'submit';
    const row = el('div', 'location-note-row');
    row.append(input, hours, send);
    form.append(label, row);
    if (mine) form.append(button('Xóa note', 'secondary-button', () => saveNote(null, form)));
    form.addEventListener('submit', event => { event.preventDefault(); saveNote({ text: input.value, hours: Number(hours.value) }, form); }, { signal: on });
    return form;
  }

  async function saveNote(note, form) {
    if (note && !note.text.trim()) { status.textContent = 'Viết vài chữ cho note nhé.'; return; }
    for (const control of form.elements) control.disabled = true;
    status.textContent = note ? 'Đang đăng…' : 'Đang xóa…';
    try {
      const result = await apiRequest('/api/location/note', note ? { method: 'PUT', body: note, signal: on } : { method: 'DELETE', signal: on });
      if (on.aborted) return;
      people = result.people;
      now = result.now;
      status.textContent = note ? 'Đã đăng note.' : 'Đã xóa note.';
      render();
    } catch (error) {
      if (on.aborted) return;
      status.textContent = error.status === 400 ? 'Note là một dòng, tối đa 60 ký tự.' : 'Chưa lưu được note. Thử lại nhé.';
      for (const control of form.elements) control.disabled = false;
    }
  }

  // ----- panel: timeline -----
  function showTimeline() {
    const controls = el('div', 'location-day');
    const who = el('div', 'location-who');
    who.setAttribute('role', 'group');
    who.setAttribute('aria-label', 'Timeline của');
    for (const { id } of PEOPLE) {
      const b = button(short(id), 'location-mode', () => { timelineUser = id; day = null; fitted = false; render(); refresh(); });
      b.setAttribute('aria-pressed', String(timelineUser === id));
      who.append(b);
    }
    const date = el('input');
    date.type = 'date';
    date.value = timelineDate;
    date.max = localDay(Date.now());
    date.setAttribute('aria-label', 'Ngày');
    date.addEventListener('change', () => { if (date.value) { timelineDate = date.value; day = null; fitted = false; render(); refresh(); } }, { signal: on });
    controls.append(who, date);
    if (day) {
      const moves = day.stops.filter((s, i) => i && day.stops[i - 1].placeId !== s.placeId).length;
      controls.append(el('span', 'location-hint', `${day.stops.length} lần ghé · ${moves} lần di chuyển`));
    }
    half.replaceChildren(controls);
    const list = el('ol', 'location-stops');
    if (day && !day.stops.length) list.append(el('li', 'location-hint', 'Ngày này chưa ghé địa điểm nào.'));
    day?.stops.forEach((s, i) => {
      if (i) {
        const leg = day.legs.find(l => l.from === day.stops[i - 1].placeId && l.to === s.placeId);
        const gap = leg?.route?.minutes ?? Math.round((s.arrivedAt - (day.stops[i - 1].leftAt ?? s.arrivedAt)) / 60000);
        if (day.stops[i - 1].placeId !== s.placeId) list.append(el('li', 'location-move', `Di chuyển ${duration(Math.max(1, gap) * 60000)}${leg?.route ? ` · ${leg.route.km} km` : ''}`));
      }
      list.append(stopItem(s, i));
    });
    const add = el('div', 'location-add');
    const addBox = el('div', 'location-add-box');
    addBox.append(button('Thêm địa điểm ở đây', 'secondary-button location-add-here', () => showAddPlace()), add);
    panel.replaceChildren(list, addBox);
    cross.hidden = true;
  }

  function stopItem(s, index) {
    const item = el('li', 'location-stop');
    const title = el('strong', '', `${index + 1}. ${s.name ?? 'Chưa đặt tên'}`);
    const time = el('span', 'location-stop-time', `${clock(s.arrivedAt)} – ${s.leftAt ? clock(s.leftAt) : 'bây giờ'} · ${duration((s.leftAt ?? now) - s.arrivedAt)}`);
    item.append(title, time);
    const actions = el('div', 'location-stop-actions');
    actions.append(button('Xem', 'secondary-button', () => centerOn([s.lat, s.lng], 16)));
    actions.lastChild.setAttribute('aria-label', `Xem ${s.name ?? 'chỗ chưa đặt tên'} trên bản đồ`);
    actions.append(button(s.name ? 'Đổi tên' : 'Đặt tên', 'secondary-button', () => nameForm(item, s.name ?? '', name =>
      apiRequest(`/api/places/${s.placeId}`, { method: 'PUT', body: { name }, signal: on }))));
    const remove = button('Xóa', 'secondary-button', () => confirmDelete(item, s));
    remove.dataset.action = 'place-delete';
    remove.setAttribute('aria-label', `Xóa ${s.name ?? 'chỗ chưa đặt tên'}`);
    actions.append(remove);
    item.append(actions);
    return item;
  }

  /** Deleting a place means never recording that spot again; its stops leave every timeline. */
  function confirmDelete(item, s) {
    item.querySelector('form,[role=alertdialog]')?.remove();
    const box = el('div', 'location-warning');
    box.setAttribute('role', 'alertdialog');
    const id = `location-delete-${s.placeId}`;
    box.setAttribute('aria-labelledby', id);
    const question = el('p', '', 'Không ghi nhận chỗ này nữa? Các lần ghé ở đây sẽ ẩn khỏi timeline.');
    question.id = id;
    const row = el('div', 'form-actions');
    const keep = button('Giữ lại', 'secondary-button', () => { box.remove(); item.querySelector('[data-action=place-delete]')?.focus(); });
    const yes = button('Xóa', 'primary-button', async () => {
      yes.disabled = keep.disabled = true;
      try {
        await apiRequest(`/api/places/${s.placeId}`, { method: 'DELETE', signal: on });
        if (on.aborted) return;
        status.textContent = 'Đã xóa địa điểm.';
        refresh();
      } catch {
        if (on.aborted) return;
        status.textContent = 'Chưa xóa được. Thử lại nhé.';
        yes.disabled = keep.disabled = false;
      }
    });
    row.append(yes, keep);
    box.append(question, row);
    item.append(box);
    keep.focus();
  }

  /** An inline name box in host; save(name) is the request. Refreshes on success. onCancel replaces the plain removal. */
  function nameForm(host, value, save, onCancel) {
    host.querySelector('form')?.remove();
    const form = el('form', 'location-name');
    const input = el('input');
    input.maxLength = 40;
    input.value = value;
    input.setAttribute('aria-label', 'Tên địa điểm');
    const ok = el('button', 'primary-button', 'Lưu');
    ok.type = 'submit';
    form.append(input, ok, button('Hủy', 'secondary-button', () => (onCancel ? onCancel() : form.remove())));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!input.value.trim()) { status.textContent = 'Đặt một cái tên nhé.'; return; }
      ok.disabled = true;
      try {
        await save(input.value);
        if (on.aborted) return;
        status.textContent = 'Đã lưu tên địa điểm.';
        refresh();
      } catch {
        if (on.aborted) return;
        status.textContent = 'Chưa lưu được tên. Thử lại nhé.';
        ok.disabled = false;
      }
    }, { signal: on });
    host.append(form);
    input.focus();
  }

  /** latlng from a long press; without one, the + over the map marks the spot, read when saving. */
  function showAddPlace(latlng) {
    const host = panel.querySelector('.location-add');
    if (!host || !map) return;
    if (wide()) closed = false; else snap = 'open';
    layout();
    cross.hidden = Boolean(latlng);
    host.replaceChildren(el('p', 'location-hint', latlng ? 'Đặt tên cho chỗ bạn vừa giữ trên bản đồ:' : 'Kéo bản đồ để dấu + nằm đúng chỗ, rồi đặt tên:'));
    nameForm(host, '', name => {
      const at = latlng ?? visibleCenter();
      return apiRequest('/api/places', { method: 'POST', body: { name, lat: at.lat, lng: at.lng }, signal: on });
    }, () => { cross.hidden = true; host.replaceChildren(); });
  }

  // ----- data -----
  function render() {
    if (on.aborted) return;
    if (mode === 'now' && people) showNow();
    if (mode === 'timeline') showTimeline();
    layout();
    drawMap();
  }

  // Only the newest request may draw: quick taps on Minh/Yến or a date must not show an older answer.
  let latest = 0, failed = false;
  async function refresh() {
    clearTimeout(timer);
    const mine = ++latest;
    try {
      if (mode === 'now') {
        const result = await apiRequest('/api/location', { signal: on });
        if (on.aborted || mine !== latest) return;
        people = result.people;
        now = result.now;
      } else {
        const result = await apiRequest(`/api/timeline?user=${timelineUser}&date=${timelineDate}`, { signal: on });
        if (on.aborted || mine !== latest) return;
        day = result;
        now = Date.now();
      }
      if (failed) { failed = false; status.textContent = ''; }
      // A refresh rebuilds the lists; keep keyboard focus on the same button.
      const active = bar.contains(document.activeElement) ? document.activeElement : null;
      const focused = active?.getAttribute('aria-label') ? `[aria-label="${CSS.escape(active.getAttribute('aria-label'))}"]`
        : active?.dataset.key ? `[data-key="${CSS.escape(active.dataset.key)}"]` : null;
      render();
      if (focused) bar.querySelector(focused)?.focus();
    } catch (error) {
      if (on.aborted || mine !== latest) return;
      failed = true;
      status.textContent = error.status === 401 ? 'Phiên đã hết hạn. Hãy đăng nhập lại.' : 'Chưa tải được vị trí. Sẽ thử lại sau.';
    }
    // Only the live view refreshes itself; a timeline is a past day and stays still while a name is typed.
    if (!on.aborted && mode === 'now' && document.visibilityState !== 'hidden') timer = setTimeout(refresh, REFRESH_MS);
  }

  // Coming back refreshes the live view only; a timeline being edited stays as it is.
  document.addEventListener('visibilitychange', () => { if (!on.aborted && mode === 'now' && document.visibilityState === 'visible') refresh(); }, { signal: on });
  showModes();
  // First placement without sliding in.
  bar.classList.add('is-dragging');
  layout();
  requestAnimationFrame(() => bar.classList.remove('is-dragging'));
  sharing = mountSharing({ signal: on, onChange: refresh });
  Promise.all(PEOPLE.map(({ id }) => apiRequest(`/api/profiles/${id}`, { signal: on }).then(r => { profiles[id] = r.profile; }, () => {})))
    .then(() => { if (!on.aborted) render(); });
  startMap().catch(() => { if (!on.aborted) { mapNote.hidden = false; mapNote.textContent = 'Chưa mở được bản đồ.'; } });
  refresh();

  return () => {
    stop();
    signal.removeEventListener('abort', stop);
    clearTimeout(timer);
    sized.disconnect();
    sharing?.cleanup();
    map?.remove();
    map = null;
    page.remove();
  };
}
