// Stub owned by part B (Lịch, dịp, chu kỳ). Replace route/create with the real API; keep the export names.
import { handleErrors, httpError } from './http.js';

export const route = path => /^\/api\/(?:calendar|cycles)(?:\/|$)/.test(path);

export function create(deps) {
  return {
    handle: (req, res) => handleErrors(res, () => { throw httpError(404, 'not_implemented', 'Not implemented'); }),
    close() {},
  };
}
