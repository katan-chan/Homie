// Who may view and labels, through the real UI: a private note and its labels, the label filter, and what the partner/guests get.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';
const fixture = await createNotesFixture({ app: true });
const headers = { Origin: fixture.origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' };
const login = async accountId => (await fetch(fixture.origin + '/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ accountId, password: fixturePasswords[accountId] }) })).headers.get('set-cookie').split(';')[0];
const board = async (id, cookie) => { const response = await fetch(`${fixture.origin}/api/boards/${id}${cookie ? '/collaboration' : ''}`, { headers: cookie ? { Cookie: cookie } : {} }); return response.ok ? (await response.json()).board : response.status; };
try {
  await withBrowser(async (evaluate, { call }) => {
    const wait = e => evaluate(`(async()=>{const end=Date.now()+15000;while(!(${e})){if(Date.now()>end)throw Error('timeout '+${JSON.stringify(e)}+' / '+document.querySelector('.notes-error')?.textContent);await new Promise(r=>setTimeout(r,50));}return true;})()`);
    const saved = "document.querySelector('.notes-durability')?.dataset.durability==='saved'";
    const choose = (selector, value) => evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate("location.hash='dashboard'"); await wait("document.querySelector('.notes-dashboard')");
    await evaluate(`(async()=>{await (await import('/js/auth.js')).login('minhle',${JSON.stringify(fixturePasswords.minhle)});})()`); await wait("document.querySelector('[data-action=board-new-empty]')");
    await evaluate("document.querySelector('[data-action=board-new-empty]').click()"); await wait("document.querySelector('.notes-name-form')");
    await evaluate("document.querySelector('.notes-name-form input').value='Kỷ niệm của mình';document.querySelector('.notes-name-form').requestSubmit()"); await wait(saved);
    const boardId = await evaluate("document.querySelector('[data-board-id]').dataset.boardId");
    const [minh, yen] = [await login('minhle'), await login('haiyen')];
    assert.deepEqual([await board(boardId, yen), await board(boardId)], [404, 404], 'A new board is only visible to its author');
    await wait("document.querySelector('[data-action=board-visibility] option[value=shared]')");
    await choose('[data-action=board-visibility]', 'shared'); await wait(`document.querySelector('.notes-board-tab[aria-selected=true]').dataset.visibility==='shared' && ${saved}`);
    assert.equal(typeof await board(boardId, yen), 'object', 'Shared boards open for the partner');
    // Two notes: the first becomes a private memory, the second stays with the board.
    for (let i = 0; i < 2; i++) { await evaluate("document.querySelector('[data-action=note-new]').click()"); await wait(`document.querySelectorAll('.paper-note').length===${i + 1} && ${saved}`); }
    const [first, second] = await evaluate("[...document.querySelectorAll('.paper-note')].map(n=>n.dataset.noteId)");
    await evaluate(`document.querySelector('[data-note-id="${first}"] .note-handle').click()`); await wait("document.querySelector('[data-action=note-visibility]')");
    // Every note shows who can see it: here it follows the shared board.
    assert.deepEqual(await evaluate(`[document.querySelector('[data-note-id="${first}"] .note-view').textContent,document.querySelector('[data-action=note-visibility] option[value=""]').textContent]`), ['Hai đứa mình', 'Theo bảng (Hai đứa mình)']);
    await choose('[data-action=note-visibility]', 'minhle'); await wait(`document.querySelector('[data-note-id="${first}"] .note-view')?.textContent==='Chỉ mình tôi' && ${saved}`);
    await evaluate("document.querySelector('[data-action=label-memory]').click()"); await wait(`document.querySelector('[data-note-id="${first}"] .note-label.is-memory') && ${saved}`);
    await evaluate("{const i=document.querySelector('.notes-inspector [name=label]');i.focus();i.value='  Du   lịch ';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))}");
    await wait(`[...document.querySelectorAll('[data-note-id="${first}"] .note-label')].map(l=>l.textContent).join()==='Kỷ niệm,Du lịch' && ${saved}`);
    assert.equal(await evaluate("document.activeElement?.name"), 'label', 'Typing labels keeps focus in the label input');
    // A differently cased label reuses the board's spelling.
    await evaluate(`document.querySelector('[data-note-id="${second}"] .note-handle').click()`); await wait("document.querySelector('[data-action=label-add]') && !document.querySelector('[data-action=note-visibility]')?.value");
    await evaluate("{const i=document.querySelector('.notes-inspector [name=label]');i.value='kỷ niệm';document.querySelector('[data-action=label-add]').click()}");
    await wait(`document.querySelector('[data-note-id="${second}"] .note-label')?.textContent==='Kỷ niệm' && ${saved}`);
    await evaluate("document.querySelector('[data-action=label-remove]').click()"); await wait(`!document.querySelector('[data-note-id="${second}"] .note-label') && ${saved}`);
    // The label filter dims notes without that label.
    await wait("[...document.querySelectorAll('.notes-label-filter option')].map(o=>o.value).join()===',Kỷ niệm,Du lịch'");
    await choose('.notes-label-filter', 'Du lịch');
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.paper-note')].map(n=>n.classList.contains('is-filtered'))"), [false, true]);
    await choose('.notes-label-filter', ''); assert.equal(await evaluate("document.querySelectorAll('.paper-note.is-filtered').length"), 0);
    // The server shows the private note to its author only; the partner sees the other note, guests see nothing.
    const mine = await board(boardId, minh), theirs = await board(boardId, yen);
    assert.deepEqual(mine.notes.find(n => n.id === first).labels, ['Kỷ niệm', 'Du lịch']);
    assert.deepEqual([theirs.notes.map(n => n.id), Object.keys(theirs.texts)], [[second], [second]]);
    const write = await fetch(fixture.origin + '/api/boards/commands', { method: 'POST', headers: { ...headers, Cookie: yen }, body: JSON.stringify({ clientId: randomUUID(), command: { operationId: randomUUID(), accountId: 'haiyen', boardId, baseRevision: 0, type: 'note.trash', payload: { id: first } } }) });
    assert.equal(write.status, 404, 'The partner cannot touch a note hidden from them');
    assert.equal(await board(boardId), 404);
    await choose('[data-action=board-visibility]', 'public'); await wait(`document.querySelector('.notes-board-tab[aria-selected=true]').dataset.visibility==='public' && ${saved}`);
    assert.deepEqual((await board(boardId)).notes.map(n => n.id), [second], 'Guests never see a note narrowed to its author');
  }, undefined, { origin: fixture.origin });
  console.log('PASS who-can-view: private board by default, shared/public boards, private notes, labels and label filter');
} finally { await fixture.close(); }
