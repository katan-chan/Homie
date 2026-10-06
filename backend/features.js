// Feature APIs dispatched by server.js before the core routes. Each module exports
// route(path) -> boolean and create(deps) -> { handle(req, res), close?() } (create may return a Promise).
// deps = { auth, allowedOrigins, dataDir, remote, push, notesStore }; notesStore() resolves to the running notes store,
// push is the phone notification sender (backend/push.js).
import * as jar from './jar-api.js';
import * as calendar from './calendar-api.js';
import * as ideas from './ideas-api.js';
import * as rules from './rules-api.js';
import * as garden from './garden-api.js';
import * as pushDevices from './push-api.js';

export const features = [jar, calendar, ideas, rules, garden, pushDevices];
