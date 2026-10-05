// Ball colours, shared with Lịch (part B). Kisses rose, apologies mint, a shade fixed per id; feelings by valence.
export const hash = id => { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 100003; return h; };

/** Lavender (unpleasant, v = -1) through sand (neutral) to honey gold (pleasant, v = 1). */
export const moodColor = v => v < 0 ? `hsl(262 ${12 + 40 * -v}% ${80 - 16 * -v}%)` : `hsl(${30 + 12 * v} ${30 + 58 * v}% ${80 - 18 * v}%)`;

/** item: { id, kind, valence? } as returned by GET /api/jar. */
export function ballColor(item) {
  const h = hash(item.id);
  if (item.kind === 'mood') return moodColor(item.valence);
  return item.kind === 'kiss' ? `hsl(${335 + h % 22} ${62 + (h >> 5) % 22}% ${66 + (h >> 9) % 14}%)`
    : `hsl(${150 + h % 32} ${34 + (h >> 5) % 22}% ${62 + (h >> 9) % 14}%)`;
}

export const SAMPLE = { kiss: 'hsl(342 72% 70%)', sorry: 'hsl(160 42% 64%)', mood: moodColor(0.6) };

/** A small decorative candy ball (aria-hidden). Styled by styles/jar.css; size it with your own CSS or cls 'tiny'. */
export function mini(kind, color, cls = '') {
  const ball = document.createElement('i');
  ball.className = `jar-skin k-${kind}${cls ? ` ${cls}` : ''}`;
  ball.style.setProperty('--c', color);
  ball.setAttribute('aria-hidden', 'true');
  return ball;
}
