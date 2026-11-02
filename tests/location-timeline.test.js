import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, home, work, walk, MIN } from './helpers/location-fixture.mjs';
import { monthsOf } from '../backend/location-api.js';
import { steadyClock } from './helpers/vn-clock.mjs';

steadyClock();

// Esri routing is faked by intercepting fetch to its host; everything else (the test's own HTTP calls) goes through.
const realFetch = globalThis.fetch;
let esri = { calls: 0, fail: false };
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://route-api.arcgis.com/')) return realFetch(url, options);
  esri.calls++;
  esri.last = String(url);
  if (esri.delay) await new Promise(r => setTimeout(r, esri.delay));
  if (esri.fail) return new Response('{"error":{"code":498}}', { status: 200, headers: { 'content-type': 'application/json' } });
  return Response.json({ routes: { features: [{ attributes: { Total_TravelTime: 12.4, Total_Kilometers: 3.21 },
    geometry: { paths: [[[home.lng, home.lat], [105.845123456, 21.031234567], [work.lng, work.lat]]] } }] } });
};
afterEach(() => { esri = { calls: 0, fail: false }; process.env.ESRI_ROUTE_KEY = 'test-route-key'; });
process.env.ESRI_ROUTE_KEY = 'test-route-key';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

async function homeThenWork(call, cookie) {
  await call('PUT', '/api/location/sharing', { on: true }, cookie);
  await walk(call, cookie, home, [60, 50, 40]);
  await walk(call, cookie, work, [30, 20, 10]);
  await call('PUT', '/api/location/sharing', { on: false }, cookie);
}

test('places: members add, rename and delete; names are checked', async t => {
  const { call, minh, yen } = await fixture(t);
  assert.equal((await call('POST', '/api/places', { name: '', ...home }, minh)).body.code, 'invalid_place');
  assert.equal((await call('POST', '/api/places', { name: 'x'.repeat(41), ...home }, minh)).body.code, 'invalid_place');
  assert.equal((await call('POST', '/api/places', { name: 'Nhà', lat: 99, lng: 0 }, minh)).body.code, 'invalid_place');
  const made = await call('POST', '/api/places', { name: ' Nhà ', ...home }, minh);
  assert.equal(made.status, 201);
  assert.equal(made.body.place.name, 'Nhà');
  const id = made.body.place.id;
  assert.equal((await call('PUT', `/api/places/${id}`, { name: 'Nhà mình' }, yen)).body.place.name, 'Nhà mình');
  assert.equal((await call('PUT', '/api/places/nope', { name: 'x' }, yen)).status, 404);
  assert.equal((await call('DELETE', `/api/places/${id}`, undefined, yen)).status, 200);
  assert.deepEqual((await call('GET', '/api/places', undefined, minh)).body.places, []);
});

test('timeline lists the day by place with a cached road route between them', async t => {
  const { call, minh, yen } = await fixture(t);
  await homeThenWork(call, minh);
  const places = (await call('GET', '/api/places', undefined, minh)).body.places;
  assert.equal(places.length, 2);
  const homeId = places.find(p => Math.abs(p.lat - home.lat) < 1e-6).id;
  await call('PUT', `/api/places/${homeId}`, { name: 'Nhà' }, minh);

  const first = await call('GET', `/api/timeline?user=minhle&date=${today()}`, undefined, yen);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.stops.map(s => s.name), ['Nhà', null]);
  assert.ok(first.body.stops.every(s => s.arrivedAt < s.leftAt));
  assert.equal(first.body.legs.length, 1);
  assert.deepEqual(first.body.legs[0].route, { path: [[home.lat, home.lng], [21.03123, 105.84512], [work.lat, work.lng]], minutes: 12, km: 3.21 });
  assert.match(esri.last, /token=test-route-key/);
  // Pinned so the totals are always Total_TravelTime (minutes) and Total_Kilometers, whatever the account's defaults.
  assert.match(esri.last, /impedanceAttributeName=TravelTime/);
  assert.match(esri.last, /accumulateAttributeNames=Kilometers/);
  assert.match(esri.last, new RegExp(`stops=${home.lng}%2C${home.lat}%3B${work.lng}%2C${work.lat}`));
  await call('GET', `/api/timeline?user=minhle&date=${today()}`, undefined, yen);
  assert.equal(esri.calls, 1, 'the second timeline uses the cached route');
});

test('a failed route is drawn straight and asked again next time', async t => {
  const { call, minh } = await fixture(t);
  await homeThenWork(call, minh);
  esri.fail = true;
  assert.equal((await call('GET', `/api/timeline?user=minhle&date=${today()}`, undefined, minh)).body.legs[0].route, null);
  esri.fail = false;
  assert.ok((await call('GET', `/api/timeline?user=minhle&date=${today()}`, undefined, minh)).body.legs[0].route);
  assert.equal(esri.calls, 2);
});

test('without a route key nothing is asked', async t => {
  const { call, minh } = await fixture(t);
  delete process.env.ESRI_ROUTE_KEY;
  await homeThenWork(call, minh);
  assert.equal((await call('GET', `/api/timeline?user=minhle&date=${today()}`, undefined, minh)).body.legs[0].route, null);
  assert.equal(esri.calls, 0);
});

test('a visit across midnight shows on both days; an open visit shows too', async t => {
  const { call, remote, minh } = await fixture(t);
  await call('POST', '/api/places', { name: 'Nhà', ...home }, minh);
  const placeId = (await call('GET', '/api/places', undefined, minh)).body.places[0].id;
  // 23:00 on 31/10 to 01:00 on 1/11, Vietnam time.
  remote.docs.set('visits-2026-10', { items: [{ id: 'v1', user: 'minhle', placeId, arrivedAt: Date.UTC(2026, 9, 31, 16), leftAt: Date.UTC(2026, 9, 31, 18) }] });
  for (const date of ['2026-10-31', '2026-11-01']) {
    const stops = (await call('GET', `/api/timeline?user=minhle&date=${date}`, undefined, minh)).body.stops;
    assert.deepEqual(stops.map(s => s.name), ['Nhà'], date);
  }
  assert.deepEqual((await call('GET', '/api/timeline?user=minhle&date=2026-11-02', undefined, minh)).body.stops, []);

  await call('PUT', '/api/location/sharing', { on: true }, minh);
  await walk(call, minh, home, [20, 14, 8]);
  const open = (await call('GET', `/api/timeline?user=minhle&date=${today()}`, undefined, minh)).body.stops;
  assert.equal(open.at(-1).leftAt, null);
  assert.equal(open.at(-1).name, 'Nhà');
});

test('visits at a deleted place are hidden; bad queries are refused', async t => {
  const { call, minh } = await fixture(t);
  await homeThenWork(call, minh);
  const places = (await call('GET', '/api/places', undefined, minh)).body.places;
  await call('DELETE', `/api/places/${places[0].id}`, undefined, minh);
  const body = (await call('GET', `/api/timeline?user=minhle&date=${today()}`, undefined, minh)).body;
  assert.equal(body.stops.length, 1);
  assert.deepEqual(body.legs, []);
  assert.equal((await call('GET', '/api/timeline?user=bob&date=2026-11-02', undefined, minh)).body.code, 'invalid_query');
  assert.equal((await call('GET', '/api/timeline?user=minhle&date=2026-02-30', undefined, minh)).body.code, 'invalid_query');
});

test('an open stop with no point for over 30 minutes ends at its last point', async t => {
  const { call, minh } = await fixture(t);
  await call('PUT', '/api/location/sharing', { on: true }, minh);
  await walk(call, minh, home, [60, 50, 40]);
  const stops = (await call('GET', `/api/timeline?user=minhle&date=${today()}`, undefined, minh)).body.stops;
  assert.equal(stops.length, 1);
  assert.ok(stops[0].leftAt && Date.now() - stops[0].leftAt >= 40 * MIN - 5000, 'left at the last point, not "bây giờ"');
});

test('a visit is filed under every month it touches', () => {
  // 30/10 20:00 to 2/11 08:00 Vietnam time.
  assert.deepEqual(monthsOf(Date.UTC(2026, 9, 30, 13), Date.UTC(2026, 10, 2, 1)), ['2026-10', '2026-11']);
  assert.deepEqual(monthsOf(Date.UTC(2026, 10, 2, 1), Date.UTC(2026, 10, 2, 3)), ['2026-11']);
  // 31/12 23:00 to 1/1 01:00.
  assert.deepEqual(monthsOf(Date.UTC(2026, 11, 31, 16), Date.UTC(2026, 11, 31, 18)), ['2026-12', '2027-01']);
});

test('a visit spanning several days and a month boundary shows on each day, once', async t => {
  const { call, remote, minh } = await fixture(t);
  await call('POST', '/api/places', { name: 'Nhà', ...home }, minh);
  const placeId = (await call('GET', '/api/places', undefined, minh)).body.places[0].id;
  const visit = { id: 'v1', user: 'minhle', placeId, arrivedAt: Date.UTC(2026, 9, 30, 13), leftAt: Date.UTC(2026, 10, 2, 1) };
  remote.docs.set('visits-2026-10', { items: [visit] });
  remote.docs.set('visits-2026-11', { items: [visit] });
  for (const date of ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']) {
    const stops = (await call('GET', `/api/timeline?user=minhle&date=${date}`, undefined, minh)).body.stops;
    assert.deepEqual(stops.map(s => s.name), ['Nhà'], date);
  }
});

test('a body of null is a bad request, not a crash', async t => {
  const { call, minh } = await fixture(t);
  assert.deepEqual([(await call('POST', '/api/places', null, minh)).status], [400]);
  assert.deepEqual([(await call('PUT', '/api/location/note', null, minh)).status], [400]);
  assert.deepEqual([(await call('POST', '/api/location/point', null, minh)).status], [400]);
});

test('routes for a day are asked together, not one after another', async t => {
  const { call, minh } = await fixture(t);
  const cafe = { lat: 21.0405, lng: 105.8442 };
  await call('PUT', '/api/location/sharing', { on: true }, minh);
  await walk(call, minh, home, [90, 80, 70]);
  await walk(call, minh, work, [60, 50, 40]);
  await walk(call, minh, cafe, [30, 20, 10]);
  esri.delay = 300;
  const started = performance.now();
  const legs = (await call('GET', `/api/timeline?user=minhle&date=${today()}`, undefined, minh)).body.legs;
  assert.equal(legs.length, 2);
  const took = performance.now() - started;
  assert.ok(took < 550, `took ${took} ms`);
});
