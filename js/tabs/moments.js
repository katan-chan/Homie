// Khoảnh khắc: photobooth on desktop, a Locket-style camera on phones, one shared album. The page lives in js/features/moments/.
import { mountMoments } from '../features/moments/page.js';

export function render(container, { signal }) {
  if (signal.aborted) return () => {};
  return mountMoments(container, { signal });
}
