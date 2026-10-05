// Gợi ý chủ đề seminar: the shared roulette page for seminar topics.
import { mountRoulette } from '../features/roulette/page.js';

export const render = (container, { signal }) => mountRoulette(container, { kind: 'seminar', signal });
