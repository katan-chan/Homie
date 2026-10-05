// temporary copy until jar colors.js merges (js/features/jar/colors.js, part A); M1 swaps the imports.
// Mood colour runs lavender (unpleasant), sand (neutral), honey gold (pleasant).
export const moodColor = v => v < 0
  ? `hsl(262 ${12 + 40 * -v}% ${80 - 16 * -v}%)`
  : `hsl(${30 + 12 * v} ${30 + 58 * v}% ${80 - 18 * v}%)`;

export const SAMPLE = { kiss: 'hsl(342 72% 70%)', sorry: 'hsl(160 42% 64%)', mood: moodColor(0.6) };

/** A small decorative ball: <i class="skin k-<kind>"> coloured by --c. */
export function mini(kind, color) {
  const ball = document.createElement('i');
  ball.className = `skin k-${kind}`;
  ball.style.setProperty('--c', color);
  ball.setAttribute('aria-hidden', 'true');
  return ball;
}
