// Pure parts of Hũ: words, dates, jar shapes and ball packing. No DOM, so node:test covers them.
import { hash } from './colors.js';

export const KINDS = ['kiss', 'sorry', 'mood'];
export const NAME = { minhle: 'Minh', haiyen: 'Yến' };
export const other = id => id === 'minhle' ? 'haiyen' : 'minhle';
export const JAR_NAME = { kiss: 'Bình nụ hôn', sorry: 'Bình xin lỗi', mood: 'Bình cảm xúc' };
export const TAG = { kiss: 'Nụ hôn', sorry: 'Xin lỗi', mood: 'Cảm xúc' };
export const KIND_NAME = { kiss: 'Nụ hôn', sorry: 'Lời xin lỗi', mood: 'Cảm xúc' };
export const RANGES = [[7, '7 ngày'], [30, '30 ngày'], [0, 'Mọi lúc']];
export const RANGE_NAME = { 7: '7 ngày qua', 30: '30 ngày qua', 0: 'mọi lúc' };
export const CAP = 160;

export const quadrant = (v, e) => e >= 0.5 ? (v >= 0 ? 'Hào hứng' : 'Căng thẳng') : (v >= 0 ? 'Bình yên' : 'Buồn, mệt');
export const SUGG = { 'Hào hứng': ['Vui', 'Hào hứng', 'Biết ơn', 'Tự hào'], 'Bình yên': ['Bình yên', 'Thư thả', 'Ấm áp', 'Mãn nguyện'], 'Buồn, mệt': ['Buồn', 'Mệt', 'Nhớ', 'Chán'], 'Căng thẳng': ['Lo lắng', 'Bực', 'Ngộp', 'Hồi hộp'] };
export const valenceWord = v => v <= -0.6 ? 'Rất khó chịu' : v <= -0.2 ? 'Hơi khó chịu' : v < 0.2 ? 'Bình thường' : v < 0.6 ? 'Khá dễ chịu' : 'Rất dễ chịu';
export const energyWord = e => e < 0.2 ? 'Rất uể oải' : e < 0.4 ? 'Hơi mệt' : e < 0.6 ? 'Vừa phải' : e < 0.8 ? 'Khá hăng hái' : 'Tràn năng lượng';
export const moodName = item => item.label || quadrant(item.valence, item.energy);

const zoneDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' });
const zoneTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const localDate = (iso = new Date().toISOString()) => zoneDate.format(new Date(iso));
export const localTime = iso => zoneTime.format(new Date(iso));
export function addDays(date, n) { const t = new Date(`${date}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
export const vnDate = date => { const [y, m, d] = date.split('-'); return `${+d}/${+m}/${y}`; };
export function dayHeading(date, today) { return date === today ? 'Hôm nay' : date === addDays(today, -1) ? 'Hôm qua' : vnDate(date); }

/** Query for a range chip; 0 is "Mọi lúc" (no range). */
export function rangeQuery(days, today = localDate()) {
  return days ? `?from=${addDays(today, -(days - 1))}&to=${today}` : '';
}

export function ballLabel(item) {
  const when = `${vnDate(item.localDate)} lúc ${item.time}`;
  if (item.kind === 'mood') return `Cảm xúc của ${NAME[item.ownerId]}: ${moodName(item)}, ${valenceWord(item.valence).toLowerCase()}, năng lượng ${energyWord(item.energy).toLowerCase()}, ${when}${item.pending ? ', đang gửi' : ''}`;
  return `${KIND_NAME[item.kind]}, ${NAME[item.ownerId]} gửi ${NAME[other(item.ownerId)]}, ${when}${item.pending ? ', đang gửi' : ''}`;
}

export const byTime = (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id);

// Three silhouettes so the jars read apart without colour: round belly for kisses, tall and slim for apologies,
// wide mason jar for feelings. Units are a 320 x 400 box.
export const SHAPES = {
  kiss: { L: 40, R: 280, F: 377, top: 124, cr: 96, nl: 106, nr: 214, sh: 122 },
  sorry: { L: 76, R: 244, F: 377, top: 134, cr: 30, nl: 116, nr: 204, sh: 132 },
  mood: { L: 37, R: 283, F: 377, top: 120, cr: 41, nl: 100, nr: 220, sh: 118 },
};
export function jarPath(s) {
  const x0 = s.L - 3, x1 = s.R + 3, yb = s.F + 3, r = s.cr + 3;
  return `M${s.nl} 50 L${s.nl} 66 C${s.nl} 86 ${x0} ${s.sh - 34} ${x0} ${s.sh} L${x0} ${yb - r} Q${x0} ${yb} ${x0 + r} ${yb} L${x1 - r} ${yb} Q${x1} ${yb} ${x1} ${yb - r} L${x1} ${s.sh} C${x1} ${s.sh - 34} ${s.nr} 86 ${s.nr} 66 L${s.nr} 50 Z`;
}

export const radius = item => item.kind === 'mood' ? 12 + 10 * item.energy : 14;
function floorAt(s, x, r) {
  let y = s.F - r;
  const lim = s.cr - r, cl = s.L + s.cr, cr = s.R - s.cr, cy = s.F - s.cr;
  if (x < cl) { const dx = cl - x; y = Math.min(y, cy + Math.sqrt(Math.max(0, lim * lim - dx * dx))); }
  if (x > cr) { const dx = x - cr; y = Math.min(y, cy + Math.sqrt(Math.max(0, lim * lim - dx * dx))); }
  return y;
}
function settleAll(s, list, k) {
  const out = [];
  for (const item of list) {
    const r = radius(item) * k, w = s.R - s.L - 2 * r, pref = s.L + r + w * ((hash(item.id) % 997) / 997);
    let best = null;
    for (let i = 0; i <= 40; i++) {
      const x = s.L + r + w * i / 40;
      let y = floorAt(s, x, r);
      for (const p of out) { const dx = x - p.x, d = r + p.r; if (Math.abs(dx) < d) y = Math.min(y, p.y - Math.sqrt(d * d - dx * dx)); }
      const score = y - Math.abs(x - pref) * 0.15;
      if (!best || score > best.s) best = { x, y, s: score };
    }
    out.push({ x: best.x, y: best.y, r });
  }
  return out;
}
/**
 * Balls drop oldest first, each straight down to its lowest free spot inside the jar. Deterministic, so old balls
 * keep their place when one is added, until the jar passes about half full and every ball shrinks evenly (k).
 * ponytail: O(n² · 41) per pack, fine for CAP = 160; use a spatial grid if CAP grows.
 */
export function pack(kind, list) {
  const s = SHAPES[kind];
  const area = (s.R - s.L) * (s.F - s.top) - (4 - Math.PI) * s.cr ** 2 / 2, sum = list.reduce((t, item) => t + Math.PI * radius(item) ** 2, 0);
  let k = Math.min(1, Math.sqrt(0.5 * area / (sum || 1))), pos;
  for (let i = 0; i < 8; i++) { pos = settleAll(s, list, k); if (pos.every(p => p.y - p.r > s.top - 6)) break; k *= 0.92; }
  return { pos, k };
}
