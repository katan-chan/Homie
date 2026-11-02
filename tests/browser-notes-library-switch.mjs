// The shared picture library, opened before any board is open, stays open when a board gets selected. On Supabase the
// board list arrives seconds after login and selects the first board; that used to close a library just opened.
import assert from 'node:assert/strict';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

const fixture = await createNotesFixture({ app: true });
try {
  await withBrowser(async (evaluate, { call }) => {
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    const wait = (expression, ms = 10000) => evaluate(`(async()=>{const end=Date.now()+${ms};while(!(${expression})){if(Date.now()>end)throw Error('Timed out: '+${JSON.stringify(expression)});await new Promise(r=>setTimeout(r,30));}return true;})()`);
    await evaluate("location.hash='dashboard'");
    await wait("document.querySelector('.notes-dashboard')");
    await evaluate(`(async()=>{await (await import('/js/auth.js')).login('minhle',${JSON.stringify(fixturePasswords.minhle)});})()`);
    await wait("document.querySelector('[data-action=board-new-empty]')");
    // No board is open yet: the library gets its own connection.
    await evaluate("document.querySelector('[data-action=library-open]').click()");
    await wait("document.querySelector('.note-library')");
    // A board becomes selected while the library is open (what the late board list does on Supabase).
    await evaluate("document.querySelector('.notes-board-tab[data-board-tab=rules]').click()");
    await wait("document.querySelector('.notes-board-tab[data-board-tab=rules]')?.getAttribute('aria-selected')==='true'");
    await new Promise(r => setTimeout(r, 300));
    assert.ok(await evaluate("Boolean(document.querySelector('.note-library'))"), 'library stays open when the first board is selected');

    // Logging out still closes it.
    await evaluate("(async()=>{await (await import('/js/auth.js')).logout();})()");
    await wait("!document.querySelector('.note-library')");
    console.log('Library opened before any board stays open when one is selected, and closes on logout: passed');
  }, undefined, { origin: fixture.origin });
} finally {
  await fixture.close();
}
