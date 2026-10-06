// Lịch: month grid of kisses, apologies, mood dots, occasions, memories and activities; cycles for Hải Yến only.
// Reads /api/calendar, /api/jar and /api/ideas/sessions; /api/cycles is only requested for haiyen.
import { apiRequest, authEvents, getUser } from '../auth.js';
import { aggregateDays, addDays, monthGrid, shiftMonth, todayLocal } from '../features/calendar/model.js';
import { el, button, renderHead, renderGrid, renderPanel, renderLegend } from '../features/calendar/view.js';
import { openSheet, eventForm, eventView, cycleForm, cycleList } from '../features/calendar/sheets.js';
import { vnDate } from '../features/calendar/model.js';

const FOCUS_KEY = 'homie-notes:focus';
// On phones the day panel opens as a popup sheet instead of sitting under the grid.
const phone = matchMedia('(max-width:600px)');
const emptyData = () => ({ events: [], memories: [], jar: [], activities: [], cycles: [] });

async function sessions(kind, query, options) {
  const items = [];
  let cursor = null;
  // ponytail: at most 10 pages per month view; enough for two people, raise if a month ever holds more.
  for (let page = 0; page < 10; page++) {
    const result = await apiRequest(`/api/ideas/sessions?kind=${kind}&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, options);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  let titles = null;
  if (items.some(item => !item.title)) {
    const { ideas } = await apiRequest(`/api/ideas?kind=${kind}`, options);
    titles = new Map(ideas.map(idea => [idea.id, idea.title]));
  }
  const fallback = kind === 'seminar' ? 'Seminar' : 'Hoạt động';
  return items.map(item => ({ id: item.id, kind, date: item.date, title: item.title ?? titles?.get(item.ideaId) ?? fallback }));
}

export function render(container, { signal }) {
  if (signal.aborted) return () => {};
  let today = todayLocal();
  let viewerId = getUser()?.id ?? null;
  let month = today.slice(0, 7), selected = today, data = emptyData(), state = 'loading', partial = false;
  let generation = 0, loader = null, toastTimer = 0, disposed = false, daySheet = null;

  const root = el('section', 'cal-page');
  const body = el('div', 'cal-body');
  const toast = el('div', 'cal-toast');
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  root.append(el('h1', 'cal-title', 'Lịch'), body, toast);
  container.replaceChildren(root);

  const range = () => { const grid = monthGrid(month); return { from: grid[0], to: grid[41] }; };

  function say(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  async function load() {
    loader?.abort();
    loader = new AbortController();
    const request = ++generation, options = { signal: loader.signal };
    const { from, to } = range(), query = `from=${from}&to=${to}`;
    let missing = false;
    // Optional sources fail soft: the page says something is missing instead of showing a false zero.
    const optional = promise => promise.catch(error => { if (error.name === 'AbortError') throw error; missing = true; return null; });
    state = 'loading';
    draw();
    try {
      const [calendar, jar, seminars, activities, cycles] = await Promise.all([
        apiRequest(`/api/calendar?${query}`, options),
        optional(apiRequest(`/api/jar?${query}`, options)),
        optional(sessions('seminar', query, options)),
        optional(sessions('activity', query, options)),
        viewerId === 'haiyen' ? optional(apiRequest(`/api/cycles?${query}`, options)) : null,
      ]);
      if (disposed || request !== generation) return;
      data = { events: calendar.events, memories: calendar.memories, jar: jar?.items ?? [],
        activities: [...seminars ?? [], ...activities ?? []], cycles: cycles?.cycles ?? [] };
      state = 'ready';
      partial = missing;
    } catch (error) {
      if (disposed || request !== generation || error.name === 'AbortError') return;
      state = 'error';
    }
    draw();
  }

  function goTo(date) {
    selected = date;
    if (date.slice(0, 7) !== month) {
      month = date.slice(0, 7);
      data = emptyData();
      load();
    }
  }

  const on = {
    month: n => { month = shiftMonth(month, n); selected = month === today.slice(0, 7) ? today : `${month}-01`; data = emptyData(); load(); },
    today: () => { goTo(today); draw(); },
    select: (date, { focus = false } = {}) => {
      goTo(date);
      draw();
      if (focus) root.querySelector(`.cal-day[data-date="${date}"]`)?.focus();
      else if (phone.matches) openDay(date);
    },
    addEvent: () => eventForm(root, { date: selected, signal, save: saveEvent(crypto.randomUUID()) }),
    openEvent: event => eventView(root, { event, viewerId, signal, onEdit: editEvent, onArchive: archiveEvent }),
    openMemory: memory => {
      try { sessionStorage.setItem(FOCUS_KEY, JSON.stringify({ boardId: memory.boardId, noteId: memory.noteId })); } catch {}
      location.hash = 'dashboard';
    },
    openActivity: activity => { location.hash = activity.kind; },
    addCycle: () => cycleForm(root, { today, signal, save: saveCycle(crypto.randomUUID()) }),
    openCycles: () => openCycles(),
  };

  /** After a write: show the record's day and refresh the month. */
  function saved(date, text) {
    if (disposed) return;
    selected = date;
    month = date.slice(0, 7);
    load();
    say(text);
  }
  const post = (path, body, method = 'POST') => apiRequest(path, { method, body });

  const saveEvent = requestId => async values => {
    const { event } = await post('/api/calendar/events', { requestId, ...values });
    saved(event.date, 'Đã thêm vào lịch');
  };
  async function freshEvent(id, near) {
    const { events } = await apiRequest(`/api/calendar?from=${addDays(near, -199)}&to=${addDays(near, 200)}`);
    const event = events.find(item => item.id === id);
    if (!event) throw new Error('missing');
    return event;
  }
  function editEvent(event) {
    eventForm(root, { event, signal, reload: () => freshEvent(event.id, event.date),
      save: async (values, version) => {
        const { event: next } = await post(`/api/calendar/events/${encodeURIComponent(event.id)}`, { ...values, version }, 'PUT');
        saved(next.date, 'Đã lưu');
      } });
  }
  async function act(run, done) {
    try { await run(); if (!disposed) { load(); say(done); } }
    catch (error) {
      if (!disposed) say(error.status === 409 ? 'Mục này vừa được sửa ở nơi khác. Mở lại để xem bản mới.' : 'Chưa lưu được. Thử lại nhé.');
      if (error.status === 409 && !disposed) load();
    }
  }
  const archiveEvent = event => act(() => post(`/api/calendar/events/${encodeURIComponent(event.id)}/archive`, { version: event.version }), 'Đã lưu trữ dịp');

  const cycleWindow = () => `from=${addDays(today, -365)}&to=${addDays(today, 34)}`;
  const saveCycle = requestId => async values => {
    const { cycle } = await post('/api/cycles', { requestId, ...values });
    saved(cycle.start, 'Đã lưu');
  };
  async function freshCycle(id) {
    const { cycles } = await apiRequest(`/api/cycles?${cycleWindow()}`);
    const cycle = cycles.find(item => item.id === id);
    if (!cycle) throw new Error('missing');
    return cycle;
  }
  async function openCycles() {
    try {
      const { cycles } = await apiRequest(`/api/cycles?${cycleWindow()}`);
      if (disposed || viewerId !== 'haiyen') return;
      cycleList(root, { cycles, signal,
        onEnd: cycle => act(() => post(`/api/cycles/${encodeURIComponent(cycle.id)}/end`, { version: cycle.version }), 'Đã ghi kết thúc hôm nay'),
        onArchive: cycle => act(() => post(`/api/cycles/${encodeURIComponent(cycle.id)}/archive`, { version: cycle.version }), 'Đã lưu trữ'),
        onEdit: cycle => cycleForm(root, { cycle, today, signal, reload: () => freshCycle(cycle.id),
          save: async (values, version) => {
            const { cycle: next } = await post(`/api/cycles/${encodeURIComponent(cycle.id)}`, { ...values, version }, 'PUT');
            saved(next.start, 'Đã lưu');
          } }),
      });
    } catch { if (!disposed) say('Chưa tải được các kỳ. Thử lại nhé.'); }
  }

  function openDay(date) {
    const sheet = openSheet(root, vnDate(date), { signal });
    daySheet = { ...sheet, date };
    sheet.dialog.classList.add('cal-day-sheet');
    sheet.dialog.addEventListener('close', () => { if (daySheet?.dialog === sheet.dialog) daySheet = null; });
    draw();
  }

  function draw() {
    if (disposed) return;
    const { from, to } = range();
    const day = aggregateDays({ viewerId, today, from, to, ...data });
    const focused = root.querySelector('.cal-day:focus') !== null;
    const grid = renderGrid({ month, selected, today, day, on });
    grid.setAttribute('aria-busy', String(state === 'loading'));
    const split = el('div', 'cal-split');
    split.append(grid, renderPanel({ date: selected, day: day(selected), viewerId, on }));
    const parts = [renderHead({ month, viewerId, on })];
    if (state === 'error') {
      const alert = el('div', 'cal-alert');
      alert.setAttribute('role', 'alert');
      alert.append(el('span', '', 'Chưa tải được lịch tháng này.'), button('Thử lại', 'cal-btn small', load));
      parts.push(alert);
    } else if (state === 'ready' && partial) {
      parts.push(el('p', 'cal-note cal-partial', 'Một vài mục (hũ hoặc hoạt động) chưa tải được, nên số đếm có thể thiếu.'));
    }
    parts.push(split, renderLegend(viewerId));
    body.replaceChildren(...parts);
    // The open day popup follows reloads, so an edit or archive made from it shows up at once.
    if (daySheet) daySheet.body.replaceChildren(daySheet.body.firstChild, renderPanel({ date: daySheet.date, day: day(daySheet.date), viewerId, on }));
    if (focused) root.querySelector(`.cal-day[data-date="${selected}"]`)?.focus();
  }

  function authChanged() {
    const next = getUser()?.id ?? null;
    if (next === viewerId) return;
    // A different person must not see the previous viewer's moods or cycles, not even in an open sheet.
    for (const dialog of root.querySelectorAll('dialog')) dialog.close();
    viewerId = next;
    data = emptyData();
    loader?.abort();
    generation++;
    if (viewerId) load();
    else body.replaceChildren(el('p', 'cal-note', 'Đăng nhập để xem lịch.'));
  }
  authEvents.addEventListener('change', authChanged);

  // A page left open past midnight (or woken on a phone) moves "today" forward; a selected old today follows it.
  function rollDay() {
    const now = todayLocal();
    if (disposed || now === today) return;
    if (selected === today) { selected = now; month = now.slice(0, 7); }
    today = now;
    if (viewerId) load();
  }
  const dayTimer = setInterval(rollDay, 60_000);
  document.addEventListener('visibilitychange', rollDay, { signal });

  function cleanup() {
    if (disposed) return;
    disposed = true;
    loader?.abort();
    clearTimeout(toastTimer);
    clearInterval(dayTimer);
    authEvents.removeEventListener('change', authChanged);
    signal.removeEventListener('abort', cleanup);
    root.remove();
  }
  signal.addEventListener('abort', cleanup, { once: true });
  load();
  return cleanup;
}
