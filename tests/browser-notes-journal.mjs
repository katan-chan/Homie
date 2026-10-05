// Journals, memories, opening a note from elsewhere and the Nội quy tab, through the real UI.
import assert from 'node:assert/strict';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';
const fixture = await createNotesFixture({ app: true });
const headers = { Origin: fixture.origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' };
const login = async accountId => (await fetch(fixture.origin + '/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ accountId, password: fixturePasswords[accountId] }) })).headers.get('set-cookie').split(';')[0];
const board = async (id, cookie) => (await (await fetch(`${fixture.origin}/api/boards/${id}/collaboration`, { headers: { Cookie: cookie } })).json()).board;
try {
  await withBrowser(async (evaluate, { call }) => {
    const wait = e => evaluate(`(async()=>{const end=Date.now()+15000;while(!(${e})){if(Date.now()>end)throw Error('timeout '+${JSON.stringify(e)}+' / '+document.querySelector('.notes-error')?.textContent);await new Promise(r=>setTimeout(r,50));}return true;})()`);
    const saved = "document.querySelector('.notes-durability')?.dataset.durability==='saved'";
    const choose = (selector, value) => evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate("location.hash='dashboard'"); await wait("document.querySelector('.notes-dashboard')");
    assert.equal(await evaluate("!!document.querySelector('[data-board-tab=rules]')"), false, 'Guests do not get the Nội quy tab');
    await evaluate(`(async()=>{await (await import('/js/auth.js')).login('minhle',${JSON.stringify(fixturePasswords.minhle)});})()`); await wait("document.querySelector('[data-action=board-new-empty]')");
    // A journal board: new notes start as "only me".
    await evaluate("document.querySelector('[data-action=board-new-empty]').click()"); await wait("document.querySelector('.notes-name-option input')");
    await evaluate("document.querySelector('.notes-name-form input').value='Nhật ký của Minh';document.querySelector('.notes-name-option input').checked=true;document.querySelector('.notes-name-form').requestSubmit()"); await wait(saved);
    const boardId = await evaluate("document.querySelector('[data-board-id]').dataset.boardId"), minh = await login('minhle'), yen = await login('haiyen');
    assert.equal((await board(boardId, minh)).noteDefault, 'private');
    await wait("document.querySelector('[data-action=board-note-default]')?.checked===true");
    await wait("document.querySelector('[data-action=board-visibility] option[value=shared]')");
    await choose('[data-action=board-visibility]', 'shared'); await wait(`document.querySelector('.notes-board-tab[aria-selected=true]').dataset.visibility==='shared' && ${saved}`);
    for (let i = 0; i < 2; i++) { await evaluate("document.querySelector('[data-action=note-new]').click()"); await wait(`document.querySelectorAll('.paper-note').length===${i + 1} && ${saved}`); }
    const [first, second] = await evaluate("[...document.querySelectorAll('.paper-note')].map(n=>n.dataset.noteId)");
    assert.deepEqual((await board(boardId, minh)).notes.map(n => n.visibility), ['minhle', 'minhle']);
    assert.deepEqual((await board(boardId, yen)).notes, [], 'The partner sees no page until one is shared');
    // A memory: "+ Kỷ niệm" dates it today, then it can be planted in (and pulled out of) the garden.
    await evaluate(`document.querySelector('[data-note-id="${first}"] .note-handle').click()`); await wait("document.querySelector('[data-action=label-memory]')");
    await evaluate("document.querySelector('[data-action=label-memory]').click()"); await wait(`document.querySelector('[data-action=note-garden-pick]') && ${saved}`);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
    assert.equal((await board(boardId, minh)).notes.find(n => n.id === first).memoryDate, today);
    // Planting asks which flower grows for this memory.
    await evaluate("document.querySelector('[data-action=note-garden-pick]').click()"); await wait("document.querySelector('dialog.notes-flower-dialog[open]')");
    await evaluate("document.querySelector('dialog[open] input[value=poppy]').click();document.querySelector('dialog[open] form').requestSubmit()");
    await wait(`document.querySelector('[data-action=note-garden-remove]') && ${saved}`);
    assert.equal(await evaluate("document.querySelector('.notes-garden-flower').textContent"), '🌱 Poppy');
    await evaluate("{const i=document.querySelector('[data-action=note-memory-date]');i.value='2026-10-12';i.dispatchEvent(new Event('change',{bubbles:true}))}");
    await wait(`[...document.querySelectorAll('[data-note-id="${first}"] .note-label')].map(l=>l.textContent).join()==='Kỷ niệm,12/10/2026,🌱 Poppy' && ${saved}`);
    assert.deepEqual(await board(boardId, minh).then(b => b.notes.find(n => n.id === first)).then(n => [n.labels, n.memoryDate, n.garden, n.gardenFlower]), [['Kỷ niệm'], '2026-10-12', true, 'poppy']);
    await evaluate("document.querySelector('[data-action=label-remove]').click()"); await wait(`!document.querySelector('[data-action^=note-garden]') && ${saved}`);
    assert.equal((await board(boardId, minh)).notes.find(n => n.id === first).garden, false, 'Dropping the label pulls the flower');
    // Opening a note from elsewhere: another page writes the handoff and goes to the dashboard.
    await evaluate("document.querySelector('[data-action=inspector-close]')?.click()");
    await evaluate(`sessionStorage.setItem('homie-notes:focus',JSON.stringify({boardId:${JSON.stringify(boardId)},noteId:${JSON.stringify(second)}}));location.hash='garden'`);
    await wait("!document.querySelector('.notes-dashboard')"); await evaluate("location.hash='dashboard'");
    await wait(`document.querySelector('[data-note-id="${second}"].is-focused')`);
    assert.equal(await evaluate("sessionStorage.getItem('homie-notes:focus')"), null, 'The handoff is read once');
    assert.equal(await evaluate(`(()=>{const v=document.querySelector('.notes-viewport').getBoundingClientRect(),n=document.querySelector('[data-note-id="${second}"]').getBoundingClientRect();return n.left>=v.left&&n.right<=v.right&&n.top>=v.top&&n.bottom<=v.bottom;})()`), true, 'The note is in view');
    // Nội quy: a members-only tab that mounts the rules panel instead of a board.
    await evaluate("document.querySelector('[data-board-tab=rules]').click()");
    await wait("!document.querySelector('.notes-board') && !!document.querySelector('#notes-selected-board .rules-panel')");
    assert.equal(await evaluate("document.querySelector('[data-board-tab=rules]').getAttribute('aria-selected')"), 'true');
    await evaluate("(async()=>{await (await import('/js/auth.js')).logout();})()"); await wait("!document.querySelector('[data-board-tab=rules]') && !document.querySelector('#notes-selected-board')?.textContent.includes('Nội quy')");
  }, undefined, { origin: fixture.origin });
  console.log('PASS journals and memories: journal default, memory date and garden, focus handoff, Nội quy tab for members only');
} finally { await fixture.close(); }
