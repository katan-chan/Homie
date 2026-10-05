// Hoạt động chung: the shared roulette page for activities, with category chips.
import { mountRoulette } from '../features/roulette/page.js';

export const render = (container, { signal }) => mountRoulette(container, { kind: 'activity', signal });
