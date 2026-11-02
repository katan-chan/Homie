// Turns the phone's points (about one every 2 minutes) into visits at places: staying within 100 m for 10 minutes opens
// a visit at the nearest known place, or at a new unnamed one; moving away or a 30-minute gap closes it. Only the
// current stop is kept, never the points themselves.
import { randomUUID } from 'node:crypto';

export const STOP = Object.freeze({ radius: 100, dwellMs: 10 * 60000, gapMs: 30 * 60000 });

const rad = degrees => degrees * Math.PI / 180;
/** Great-circle distance in metres between two { lat, lng }. */
export function distance(a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const visitOf = stop => (stop?.placeId ? { placeId: stop.placeId, arrivedAt: stop.since, leftAt: stop.lastAt } : null);
const startAt = point => ({ lat: point.lat, lng: point.lng, since: point.at, lastAt: point.at, placeId: null });

/** The nearest place whose circle holds the point, ignored ones included. */
function nearest(places, point) {
  let best = null, bestDistance = Infinity;
  for (const place of places) {
    const d = distance(place, point);
    if (d <= (place.radius ?? STOP.radius) && d < bestDistance) { best = place; bestDistance = d; }
  }
  return best;
}

/**
 * Next stop after one point. Returns { stop, closed: { placeId, arrivedAt, leftAt } | null, place: new place | null }.
 * A point no newer than the last one changes nothing. A stop at an ignored place never records a visit.
 */
export function advance(stop, point, places) {
  if (stop && point.at <= stop.lastAt) return { stop, closed: null, place: null };
  if (!stop || point.at - stop.lastAt > STOP.gapMs || distance(stop, point) > STOP.radius) {
    return { stop: startAt(point), closed: visitOf(stop), place: null };
  }
  const next = { ...stop, lastAt: point.at };
  if (next.placeId || next.ignored || next.lastAt - next.since < STOP.dwellMs) return { stop: next, closed: null, place: null };
  const known = nearest(places, next);
  if (known?.ignored) return { stop: { ...next, ignored: true }, closed: null, place: null };
  if (known) return { stop: { ...next, placeId: known.id }, closed: null, place: null };
  const place = { id: randomUUID(), name: null, lat: next.lat, lng: next.lng, radius: STOP.radius, createdBy: null, createdAt: point.at };
  return { stop: { ...next, placeId: place.id }, closed: null, place };
}

/** The visit to record when sharing stops, or null. */
export const end = stop => visitOf(stop);
