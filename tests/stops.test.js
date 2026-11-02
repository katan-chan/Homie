import test from 'node:test';
import assert from 'node:assert/strict';
import { STOP, advance, distance, end } from '../backend/stops.js';

const MIN = 60000;
const home = { lat: 21.0285, lng: 105.8542 };
// About 300 m north of home.
const away = { lat: 21.0312, lng: 105.8542 };
const at = (place, minutes, extra = {}) => ({ ...place, accuracy: 20, at: Date.UTC(2026, 10, 2, 1) + minutes * MIN, ...extra });

/** Feeds points one after another; returns the final stop, every closed visit and every new place. */
function run(points, places = []) {
  let stop = null;
  const closed = [], created = [];
  for (const point of points) {
    const result = advance(stop, point, places);
    stop = result.stop;
    if (result.closed) closed.push(result.closed);
    if (result.place) { created.push(result.place); places.push(result.place); }
  }
  return { stop, closed, created };
}

test('distance is about right', () => {
  assert.ok(Math.abs(distance(home, away) - 300) < 10);
  assert.equal(distance(home, home), 0);
});

test('staying 10 minutes opens a visit at a new unnamed place', () => {
  const nine = run([at(home, 0), at(home, 2), at(home, 9)]);
  assert.equal(nine.stop.placeId, null);
  assert.equal(nine.created.length, 0);
  const ten = run([at(home, 0), at(home, 2), at(home, 10)]);
  assert.equal(ten.created.length, 1);
  assert.equal(ten.created[0].name, null);
  assert.equal(ten.created[0].radius, STOP.radius);
  assert.equal(ten.stop.placeId, ten.created[0].id);
  assert.equal(ten.stop.since, at(home, 0).at);
});

test('a known place is reused', () => {
  const places = [{ id: 'p-home', name: 'Nhà', lat: home.lat + 0.0003, lng: home.lng, radius: 100 }];
  const result = run([at(home, 0), at(home, 12)], places);
  assert.equal(result.created.length, 0);
  assert.equal(result.stop.placeId, 'p-home');
});

test('moving away closes the visit at the last point inside', () => {
  const result = run([at(home, 0), at(home, 12), at(home, 20), at(away, 26)]);
  assert.deepEqual(result.closed, [{ placeId: result.created[0].id, arrivedAt: at(home, 0).at, leftAt: at(home, 20).at }]);
  assert.equal(result.stop.lat, away.lat);
  assert.equal(result.stop.placeId, null);
});

test('a gap over 30 minutes closes the visit', () => {
  const result = run([at(home, 0), at(home, 12), at(home, 43)]);
  assert.equal(result.closed.length, 1);
  assert.equal(result.closed[0].leftAt, at(home, 12).at);
  assert.equal(result.stop.since, at(home, 43).at);
});

test('an out of order or repeated point changes nothing', () => {
  const before = run([at(home, 0), at(home, 12)]).stop;
  assert.deepEqual(advance(before, at(away, 5), []), { stop: before, closed: null, place: null });
  assert.deepEqual(advance(before, at(away, 12), []), { stop: before, closed: null, place: null });
});

test('an ignored place is never recorded or recreated', () => {
  const places = [{ id: 'p-lot', name: null, lat: home.lat, lng: home.lng, radius: 100, ignored: true }];
  const result = run([at(home, 0), at(home, 12), at(home, 20), at(away, 26)], places);
  assert.equal(result.created.length, 0);
  assert.deepEqual(result.closed, []);
});

test('end closes an open visit and ignores a short stop', () => {
  const open = run([at(home, 0), at(home, 15)]);
  assert.deepEqual(end(open.stop), { placeId: open.created[0].id, arrivedAt: at(home, 0).at, leftAt: at(home, 15).at });
  assert.equal(end(run([at(home, 0), at(home, 4)]).stop), null);
  assert.equal(end(null), null);
});
