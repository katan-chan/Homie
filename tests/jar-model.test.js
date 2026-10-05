import test from 'node:test';
import assert from 'node:assert/strict';
import { ballColor, moodColor, SAMPLE } from '../js/features/jar/colors.js';
import { SHAPES, ballLabel, dayHeading, localDate, pack, quadrant, rangeQuery, valenceWord } from '../js/features/jar/model.js';

const kisses = n => Array.from({ length: n }, (_, i) => ({ id: `k-${i}`, kind: 'kiss' }));

test('packing is deterministic, keeps old balls in place and stays inside the jar', () => {
  const few = kisses(10), more = kisses(11);
  const a = pack('kiss', few), b = pack('kiss', more);
  assert.deepEqual(pack('kiss', few), a);
  assert.equal(a.k, 1);
  assert.equal(b.k, 1);
  assert.deepEqual(b.pos.slice(0, 10), a.pos, 'adding a ball moves nothing while the jar is under half full');
  for (const kind of ['kiss', 'sorry', 'mood']) {
    const s = SHAPES[kind];
    const list = Array.from({ length: 160 }, (_, i) => ({ id: `${kind}-${i}`, kind, valence: 0, energy: (i % 10) / 10 }));
    const { pos, k } = pack(kind, list);
    assert.ok(k < 1, `${kind}: a full jar shrinks every ball`);
    for (const p of pos) {
      assert.ok(p.x - p.r >= s.L - 0.01 && p.x + p.r <= s.R + 0.01 && p.y + p.r <= s.F + 0.01, `${kind}: ball inside the walls`);
    }
  }
});

test('colours: kisses rose, apologies mint, fixed per id; feelings by valence', () => {
  const hue = color => +color.match(/^hsl\((\d+)/)[1];
  for (let i = 0; i < 50; i++) {
    const kiss = ballColor({ id: `id-${i}`, kind: 'kiss' }), sorry = ballColor({ id: `id-${i}`, kind: 'sorry' });
    assert.ok(hue(kiss) >= 335 && hue(kiss) <= 357);
    assert.ok(hue(sorry) >= 150 && hue(sorry) <= 182);
    assert.equal(ballColor({ id: `id-${i}`, kind: 'kiss' }), kiss);
  }
  assert.equal(hue(moodColor(-1)), 262);
  assert.equal(ballColor({ id: 'x', kind: 'mood', valence: 0.6 }), SAMPLE.mood);
});

test('words, labels and ranges', () => {
  assert.equal(quadrant(0.5, 0.9), 'Hào hứng');
  assert.equal(quadrant(-0.5, 0.1), 'Buồn, mệt');
  assert.equal(valenceWord(-1), 'Rất khó chịu');
  assert.equal(valenceWord(0), 'Bình thường');
  assert.equal(ballLabel({ kind: 'kiss', ownerId: 'haiyen', localDate: '2026-10-05', time: '20:41' }), 'Nụ hôn, Yến gửi Minh, 5/10/2026 lúc 20:41');
  assert.equal(ballLabel({ kind: 'mood', ownerId: 'minhle', label: '', valence: 0.4, energy: 0.1, localDate: '2026-10-05', time: '07:05' }),
    'Cảm xúc của Minh: Bình yên, khá dễ chịu, năng lượng rất uể oải, 5/10/2026 lúc 07:05');
  assert.equal(rangeQuery(7, '2026-10-06'), '?from=2026-09-30&to=2026-10-06');
  assert.equal(rangeQuery(0, '2026-10-06'), '');
  assert.equal(dayHeading('2026-10-05', '2026-10-06'), 'Hôm qua');
  // 17:30 UTC is already the next day in Asia/Ho_Chi_Minh.
  assert.equal(localDate('2026-10-05T17:30:00.000Z'), '2026-10-06');
});
