// Feature APIs dispatched by server.js before the core routes. Each module exports
// route(path) -> boolean and create(deps) -> { handle(req, res), close?() } (create may return a Promise).
// deps = { auth, allowedOrigins, dataDir, remote, notesStore }; notesStore() resolves to the running notes store.
import * as jar from './jar-api.js';
import * as calendar from './calendar-api.js';
import * as ideas from './ideas-api.js';
import * as rules from './rules-api.js';
import * as garden from './garden-api.js';

export const features = [jar, calendar, ideas, rules, garden];
