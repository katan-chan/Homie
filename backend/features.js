// Feature APIs dispatched by server.js before the core routes. Each module exports
// route(path) -> boolean and create(deps) -> { handle(req, res), close?() } (create may return a Promise).
// deps = { auth, allowedOrigins, dataDir, remote, push, notesStore, profiles }; notesStore() resolves to the running notes
// store, push is the phone notification sender (backend/push.js), profiles the profile store (backend/profiles.js).
import * as jar from './jar-api.js';
import * as calendar from './calendar-api.js';
import * as ideas from './ideas-api.js';
import * as rules from './rules-api.js';
import * as garden from './garden-api.js';
import * as pushDevices from './push-api.js';
import * as psi from './psi-api.js';
import * as moments from './moments-api.js';
import * as avatar from './avatar-api.js';
import * as location from './location-api.js';

export const features = [jar, calendar, ideas, rules, garden, pushDevices, psi, moments, avatar, location];
