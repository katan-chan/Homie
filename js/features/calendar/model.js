// Pure month and day logic for the calendar tab. Dates are 'YYYY-MM-DD' in Asia/Ho_Chi_Minh; months 'YYYY-MM'.
export const ZONE = 'Asia/Ho_Chi_Minh';
export const MEMBERS = ['minhle', 'haiyen'];
export const SHORT_NAME = { minhle: 'Minh', haiyen: 'Yến' };
const DAY_MS = 86400000;
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Local date of an ISO instant (or Date) in ZONE. */
export const localDate = instant => dateFormat.format(new Date(instant));
export const todayLocal = (now = new Date()) => localDate(now);

export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export function shiftMonth(month, n) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** 42 dates (six weeks) covering month, Monday first. */
export function monthGrid(month) {
  const first = `${month}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export const vnDate = date => { const [y, m, d] = date.split('-'); return `${+d}/${+m}/${y}`; };
export const monthTitle = month => { const [y, m] = month.split('-'); return `Tháng ${+m}, ${y}`; };

const emptyDay = () => ({ kiss: 0, sorry: 0, mood: { minhle: null, haiyen: null }, moods: { minhle: [], haiyen: [] },
  events: [], memories: [], activities: [], cycle: false });

/**
 * Groups sources by local day for viewerId. Partner moods count only when shared, archived items never;
 * cycles count only for Hải Yến and are shaded from start to end (or today while ongoing), within [from, to].
 * jar: /api/jar items; events: occasions; memories: {noteId, boardId, title, memoryDate};
 * activities: {id, kind: 'seminar'|'activity', title, date}; cycles: /api/cycles records.
 * Returns day(date) -> summary (an empty summary for quiet days).
 */
export function aggregateDays({ viewerId, today, from, to, jar = [], events = [], memories = [], activities = [], cycles = [] }) {
  const days = new Map();
  const at = date => { if (!days.has(date)) days.set(date, emptyDay()); return days.get(date); };
  const valences = { minhle: new Map(), haiyen: new Map() };

  for (const item of jar) {
    if (item.archivedAt) continue;
    const date = item.localDate ?? localDate(item.occurredAt);
    if (item.kind === 'kiss') at(date).kiss++;
    else if (item.kind === 'sorry') at(date).sorry++;
    else if (item.kind === 'mood' && MEMBERS.includes(item.ownerId) && Number.isFinite(item.valence)
      && (item.ownerId === viewerId || item.visibility === 'shared')) {
      const list = valences[item.ownerId].get(date) ?? [];
      list.push(item.valence);
      valences[item.ownerId].set(date, list);
      at(date).moods[item.ownerId].push(item.label || 'cảm xúc');
    }
  }
  for (const [owner, byDate] of Object.entries(valences)) {
    for (const [date, list] of byDate) at(date).mood[owner] = list.reduce((sum, v) => sum + v, 0) / list.length;
  }
  for (const event of events) if (!event.archivedAt) at(event.date).events.push(event);
  for (const memory of memories) at(memory.memoryDate).memories.push(memory);
  for (const activity of activities) at(activity.date).activities.push(activity);
  if (viewerId === 'haiyen') {
    for (const cycle of cycles) {
      if (cycle.archivedAt) continue;
      const last = [cycle.end ?? today, to].sort()[0];
      for (let date = [cycle.start, from].sort()[1]; date <= last; date = addDays(date, 1)) at(date).cycle = true;
    }
  }
  return date => days.get(date) ?? emptyDay();
}

/** Screen reader summary for a day cell; colour is never the only signal. */
export function dayLabel(date, day) {
  const parts = [
    day.kiss && `${day.kiss} nụ hôn`,
    day.sorry && `${day.sorry} lời xin lỗi`,
    day.mood.minhle !== null && 'có cảm xúc của Minh',
    day.mood.haiyen !== null && 'có cảm xúc của Yến',
    day.events.length && `${day.events.length} dịp`,
    day.memories.length && `${day.memories.length} kỷ niệm`,
    day.activities.length && `${day.activities.length} hoạt động`,
    day.cycle && 'trong kỳ',
  ].filter(Boolean);
  return `${vnDate(date)}: ${parts.join(', ') || 'không có mục'}`;
}
