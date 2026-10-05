// Instants are stored as ISO UTC; local dates/times are derived in the display zone.
import { httpError } from './http.js';

export const ZONE = 'Asia/Ho_Chi_Minh';
const DAY_MS = 86400000;
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** 'YYYY-MM-DD' in ZONE for an ISO instant. */
export const localDate = isoInstant => dateFormat.format(new Date(isoInstant));

/** 'HH:MM' in ZONE for an ISO instant. */
export const localTime = isoInstant => timeFormat.format(new Date(isoInstant));

const dayNumber = date => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const time = Date.parse(`${date}T00:00:00Z`);
  // Date.parse accepts 2026-02-30; the round trip rejects it.
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(date) ? time / DAY_MS : NaN;
};

export const isDate = date => Number.isFinite(dayNumber(date));

/** Calendar arithmetic on 'YYYY-MM-DD'. */
export function addDays(date, n) {
  const day = dayNumber(date);
  if (!Number.isFinite(day) || !Number.isInteger(n)) throw new RangeError('Invalid date');
  return new Date((day + n) * DAY_MS).toISOString().slice(0, 10);
}

/** Validates an inclusive date range from query strings; 400 invalid_range when malformed, reversed or longer than maxDays. */
export function parseRange(from, to, { maxDays = 400 } = {}) {
  const start = dayNumber(from), end = dayNumber(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start + 1 > maxDays) {
    throw httpError(400, 'invalid_range', 'Invalid date range');
  }
  return { from, to };
}
