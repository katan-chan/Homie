// Vị trí: live map, notes and the day timeline. The page lives in js/features/location/.
import { mountLocation } from '../features/location/page.js';

export function render(container, { signal }) {
  if (signal.aborted) return () => {};
  return mountLocation(container, { signal });
}
