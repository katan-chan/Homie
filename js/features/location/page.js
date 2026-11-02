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

  const page = el('section', 'location-page');
  const head = el('div', 'location-head');
  head.append(el('h1', 'location-title', 'Vị trí'));
  const modes = el('div', 'location-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Chế độ xem');
  head.append(modes);
  const body = el('div', 'location-body');
  const mapBox = el('div', 'location-map-box');
  const mapEl = el('div', 'location-map');
  mapEl.setAttribute('role', 'application');
  mapEl.setAttribute('aria-label', 'Bản đồ vị trí');
  const mapNote = el('p', 'location-map-note');
  mapNote.hidden = true;
  mapBox.append(mapEl, mapNote);
  const panel = el('div', 'location-panel');
  const status = el('p', 'location-status form-message');
  status.setAttribute('role', 'status');
  body.append(mapBox, panel);
  page.append(head, body, status);
  container.replaceChildren(page);

  let L = null, map = null, layer = null;
  let mode = 'now', people = null, profiles = {}, now = Date.now();
  let timelineUser = getUser()?.id === 'minhle' ? 'haiyen' : 'minhle', timelineDate = localDay(Date.now()), day = null;
  let sharing = null, timer = null, fitted = false;
  // The note box is rebuilt only when the note itself changes, so a refresh never wipes what is being typed.
  let nowParts = null, noteShown;

  const nameOf = id => profiles[id]?.displayName ?? (id === 'minhle' ? 'Minh Lê' : 'Hải Yến');
  const short = id => PEOPLE.find(p => p.id === id).short;
  const accent = id => PEOPLE.find(p => p.id === id).accent;

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
      if (points.length === 1) map.setView(points[0], 15);
      else map.fitBounds(points, { padding: [60, 60], maxZoom: 16 });
    }
  }

  async function startMap() {
    loadLeafletCss();
    L = await import(new URL('../../../assets/vendor/leaflet.js', import.meta.url).href);
    if (on.aborted) return;
    map = L.map(mapEl, { zoomControl: true, attributionControl: true }).setView(CENTER, 13);
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
  function showNow() {
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
        item.append(button('Xem', 'secondary-button', () => map?.setView([person.lat, person.lng], 16)));
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
    panel.replaceChildren(controls, list, button('Thêm địa điểm ở đây', 'secondary-button location-add-here', () => showAddPlace(map?.getCenter())));
    const add = el('div', 'location-add');
    panel.append(add);
  }

  function stopItem(s, index) {
    const item = el('li', 'location-stop');
    const title = el('strong', '', `${index + 1}. ${s.name ?? 'Chưa đặt tên'}`);
    const time = el('span', 'location-stop-time', `${clock(s.arrivedAt)} – ${s.leftAt ? clock(s.leftAt) : 'bây giờ'} · ${duration((s.leftAt ?? now) - s.arrivedAt)}`);
    item.append(title, time);
    const actions = el('div', 'location-stop-actions');
    actions.append(button('Xem', 'secondary-button', () => map?.setView([s.lat, s.lng], 16)));
    actions.lastChild.setAttribute('aria-label', `Xem ${s.name ?? 'chỗ chưa đặt tên'} trên bản đồ`);
    actions.append(button(s.name ? 'Đổi tên' : 'Đặt tên', 'secondary-button', () => nameForm(item, s.name ?? '', name =>
      apiRequest(`/api/places/${s.placeId}`, { method: 'PUT', body: { name }, signal: on }))));
    item.append(actions);
    return item;
  }

  /** An inline name box in host; save(name) is the request. Refreshes on success. */
  function nameForm(host, value, save) {
    host.querySelector('form')?.remove();
    const form = el('form', 'location-name');
    const input = el('input');
    input.maxLength = 40;
    input.value = value;
    input.setAttribute('aria-label', 'Tên địa điểm');
    const ok = el('button', 'primary-button', 'Lưu');
    ok.type = 'submit';
    form.append(input, ok, button('Hủy', 'secondary-button', () => form.remove()));
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

  function showAddPlace(latlng) {
    const host = panel.querySelector('.location-add');
    if (!host || !latlng) return;
    host.replaceChildren(el('p', 'location-hint', 'Đặt tên cho chỗ đang ở giữa bản đồ:'));
    nameForm(host, '', name => apiRequest('/api/places', { method: 'POST', body: { name, lat: latlng.lat, lng: latlng.lng }, signal: on }));
  }

  // ----- data -----
  function render() {
    if (on.aborted) return;
    if (mode === 'now' && people) showNow();
    if (mode === 'timeline') showTimeline();
    drawMap();
  }

  async function refresh() {
    clearTimeout(timer);
    try {
      if (mode === 'now') {
        const result = await apiRequest('/api/location', { signal: on });
        if (on.aborted) return;
        people = result.people;
        now = result.now;
      } else {
        const result = await apiRequest(`/api/timeline?user=${timelineUser}&date=${timelineDate}`, { signal: on });
        if (on.aborted) return;
        day = result;
        now = Date.now();
      }
      render();
    } catch (error) {
      if (on.aborted) return;
      status.textContent = error.status === 401 ? 'Phiên đã hết hạn. Hãy đăng nhập lại.' : 'Chưa tải được vị trí. Sẽ thử lại sau.';
    }
    // Only the live view refreshes itself; a timeline is a past day and stays still while a name is typed.
    if (!on.aborted && mode === 'now' && document.visibilityState !== 'hidden') timer = setTimeout(refresh, REFRESH_MS);
  }

  document.addEventListener('visibilitychange', () => { if (!on.aborted && document.visibilityState === 'visible') refresh(); }, { signal: on });
  showModes();
  sharing = mountSharing({ signal: on, onChange: refresh });
  Promise.all(PEOPLE.map(({ id }) => apiRequest(`/api/profiles/${id}`, { signal: on }).then(r => { profiles[id] = r.profile; }, () => {})))
    .then(() => { if (!on.aborted) render(); });
  startMap().catch(() => { if (!on.aborted) { mapNote.hidden = false; mapNote.textContent = 'Chưa mở được bản đồ.'; } });
  refresh();

  return () => {
    stop();
    signal.removeEventListener('abort', stop);
    clearTimeout(timer);
    sharing?.cleanup();
    map?.remove();
    map = null;
    page.remove();
  };
}
