// Hũ: three jars (kisses, apologies, feelings). The page lives in js/features/jar/.
import { mountJar } from '../features/jar/page.js';

export function render(container, { signal }) {
  if (signal.aborted) return () => {};
  return mountJar(container, { signal });
}
