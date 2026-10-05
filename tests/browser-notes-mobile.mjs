// Phone layout (≤600px): list mode by default and remembered per board, bottom dock, ⋯ sheet, inspector sheet, format strip, switcher sheet and guest dock.
import assert from 'node:assert/strict';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';
const fixture = await createNotesFixture({ app: true });
try {
  await withBrowser(async (evaluate, { call }) => {
    const wait = e => evaluate(`(async()=>{const end=Date.now()+15000;while(!(${e})){if(Date.now()>end)throw Error('timeout '+${JSON.stringify(e)}+' / '+document.querySelector('.notes-error')?.textContent);await new Promise(r=>setTimeout(r,50));}return true;})()`);
    const saved = "document.querySelector('.notes-durability')?.dataset.durability==='saved'";
    const shown = selector => `[...document.querySelectorAll(${JSON.stringify(selector)})].some(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden')`;
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    // The dashboard follows the visual viewport height after the resize event.
    const size = async (width, height) => { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 600 }); await wait(`innerWidth===${width} && (!document.querySelector('.notes-dashboard') || document.querySelector('.notes-dashboard').style.getPropertyValue('--notes-vh')===visualViewport.height+'px')`); };
    // Visible buttons outside the notes themselves must be 44px touch targets, and nothing may scroll sideways.
    const layout = () => evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,pageScroll:document.documentElement.scrollHeight-innerHeight,small:[...document.querySelectorAll('.notes-dashboard button,.notes-dock-filter')].filter(e=>!e.closest('.notes-world')&&e.getClientRects().length&&(e.getBoundingClientRect().width<43||e.getBoundingClientRect().height<43)).map(e=>e.className+':'+(e.dataset.action||e.textContent))})`);
    await size(390, 844);
    await evaluate("location.hash='dashboard'"); await wait("document.querySelector('.notes-dashboard')");
    await evaluate(`(async()=>{await (await import('/js/auth.js')).login('minhle',${JSON.stringify(fixturePasswords.minhle)});})()`); await wait("document.querySelector('[data-action=board-new-empty]')");
    await click('[data-action=board-new-empty]'); await wait("document.querySelector('.notes-name-form')");
    await evaluate("document.querySelector('.notes-name-form input').value='Chuyến đi';document.querySelector('.notes-name-form').requestSubmit()"); await wait(`document.querySelector('.notes-board') && ${saved}`);
    const boardId = await evaluate("document.querySelector('[data-board-id]').dataset.boardId");
    assert.equal(await evaluate("document.querySelector('.notes-board').classList.contains('is-list')"), true, 'List is the phone default');
    assert.equal(await evaluate("document.querySelector('.notes-switcher-name').textContent"), 'Chuyến đi');
    assert.deepEqual(await evaluate(`[${shown('.notes-dock')},${shown('.notes-tools')},${shown('.brand')},${shown('.notes-catalog-bar')},${shown('.notes-durability')}]`), [true, false, false, false, true], 'Dock and save dot show; toolbar, brand and tabs wait in sheets');
    assert.deepEqual(await layout(), { overflow: false, pageScroll: 0, small: [] }, '390: the dashboard fits the screen');

    // A column, a note inside it (column selected first) and a loose note; the list groups them.
    await click('.notes-dock [data-action=column-new]'); await wait("document.querySelector('.notes-name-form')");
    await evaluate("document.querySelector('.notes-name-form input').value='Lịch trình';document.querySelector('.notes-name-form').requestSubmit()"); await wait(`document.querySelector('.paper-column') && ${saved}`);
    await click('.column-handle'); await wait("document.querySelector('.paper-column.is-selected')");
    await click('.notes-dock [data-action=note-new]'); await wait(`document.querySelectorAll('.paper-note').length===1 && ${saved}`);
    await click('[data-action=inspector-close]'); await wait("!document.querySelector('.is-selected') && document.querySelector('.notes-inspector').hidden");
    await click('.notes-dock [data-action=note-new]'); await wait(`document.querySelectorAll('.paper-note').length===2 && ${saved}`);
    const order = await evaluate("[...document.querySelectorAll('.paper-column,.paper-note,.notes-list-outside')].sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top).map(e=>e.classList.contains('paper-column')?'column':e.classList.contains('notes-list-outside')?'outside':e.dataset.columnId?'in-column':'loose')");
    assert.deepEqual(order, ['column', 'in-column', 'outside', 'loose'], 'List groups notes under their column, then outside any column');
    const [inColumn, loose] = await evaluate("['.paper-note[data-column-id]:not([data-column-id=\"\"])','.paper-note[data-column-id=\"\"]'].map(s=>document.querySelector(s).dataset.noteId)");

    // Writing in the list: the format strip takes the dock's place; Xong returns the dock.
    await wait(`document.querySelector('[data-note-id="${loose}"] .note-text[data-editor-state=ready]')`);
    await evaluate(`document.querySelector('[data-note-id="${loose}"] .tiptap').focus()`); await call('Input.insertText', { text: 'Mang áo ấm' });
    await wait(`document.querySelector('[data-note-id="${loose}"] .tiptap').textContent.includes('Mang áo ấm') && document.querySelector('.notes-board.is-writing')`);
    assert.deepEqual(await evaluate(`[${shown('.notes-format-row')},${shown('.notes-dock')},${shown('.notes-format-done')},${shown('.notes-inspector')}]`), [true, false, true, false], 'Format strip replaces the dock while writing');
    assert.equal(await evaluate("(()=>{const r=document.querySelector('.notes-format-done').getBoundingClientRect();return r.right<=innerWidth&&r.left>=0})()"), true, 'Xong stays on screen');
    await click('.notes-format-done'); await wait(`!document.querySelector('.notes-board.is-writing') && ${shown('.notes-dock')} && document.querySelector('.notes-inspector').hidden && ${saved}`);

    // Inspector sheet: collapsed shows paper colours, ⌃ shows the rest, ✕ deselects.
    await click(`[data-note-id="${inColumn}"] .note-handle`); await wait(shown('[data-action=note-color]'));
    assert.equal(await evaluate(shown('[data-action=object-trash]')), false, 'Collapsed inspector hides the full tools');
    await click('[data-action=inspector-expand]'); await wait(shown('[data-action=object-trash]') + '&&' + shown('[data-action=label-memory]'));
    await click('[data-action=label-memory]'); await wait(`document.querySelector('[data-note-id="${inColumn}"] .note-label.is-memory') && ${saved}`);
    assert.equal(await evaluate(shown('[data-action=object-trash]')), true, 'Inspector stays expanded after an edit');
    assert.deepEqual(await layout(), { overflow: false, pageScroll: 0, small: [] }, 'Expanded inspector fits');
    await click('[data-action=inspector-close]'); await wait("document.querySelector('.notes-inspector').hidden");

    // Filter from the dock hides other notes in the list.
    await evaluate("{const s=document.querySelector('.notes-dock-filter select');s.value='Kỷ niệm';s.dispatchEvent(new Event('change',{bubbles:true}))}");
    assert.deepEqual(await evaluate(`[${shown(`[data-note-id="${loose}"]`)},${shown(`[data-note-id="${inColumn}"]`)},document.querySelector('.notes-dock-filter').textContent.startsWith('Kỷ niệm'),document.querySelector('.notes-label-filter').value]`), [false, true, true, 'Kỷ niệm']);
    await evaluate("{const s=document.querySelector('.notes-dock-filter select');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}))}");

    // ⋯ sheet holds the board tools; Escape and the backdrop close it.
    await click('.notes-dock [data-action=more]'); await wait("document.querySelector('.notes-board.is-more')");
    for (const action of ['fit', 'zoom-in', 'zoom-out', 'undo', 'redo', 'board-rename', 'trash', 'save', 'board-trash']) assert.equal(await evaluate(shown(`.notes-toolbar [data-action=${action}]`)), true, `⋯ sheet shows ${action}`);
    assert.equal(await evaluate("(()=>{const r=document.querySelector('.notes-toolbar').getBoundingClientRect();return r.bottom<=innerHeight+1&&r.top>=0})()"), true, '⋯ sheet is on screen');
    await evaluate("document.querySelector('.notes-board').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await wait("!document.querySelector('.notes-board.is-more')");
    await click('.notes-durability'); await wait("document.querySelector('.notes-board.is-more')");
    await click('.notes-board'); await wait("!document.querySelector('.notes-board.is-more')");

    // Board mode is remembered per board after a reload; "Xem trên bảng" zooms to the note.
    await click('.notes-dock [data-action=view-toggle]'); await wait("!document.querySelector('.notes-board.is-list')");
    assert.equal(await evaluate(`localStorage.getItem('homie-notes:view:${boardId}')`), 'board');
    await evaluate('location.reload()'); await new Promise(r => setTimeout(r, 500)); await wait(`document.querySelectorAll('.paper-note').length===2 && ${saved}`);
    assert.equal(await evaluate("document.querySelector('.notes-board').classList.contains('is-list')"), false, 'Board mode survives a reload');
    await click('.notes-dock [data-action=view-toggle]'); await wait("document.querySelector('.notes-board.is-list')");
    await click(`[data-note-id="${loose}"] .note-locate`); await wait("!document.querySelector('.notes-board.is-list')");
    assert.equal(await evaluate(`(()=>{const n=document.querySelector('[data-note-id="${loose}"]').getBoundingClientRect(),v=document.querySelector('.notes-viewport').getBoundingClientRect();return Math.abs(n.width-(v.width-24))<2&&n.left>=v.left})()`), true, 'Xem trên bảng fits the note to the screen width');

    // Switcher sheet: board list and board actions; picking one closes it.
    await click('.notes-switcher'); await wait(shown('.notes-catalog-bar') + '&&' + shown('[data-action=library-open]') + '&&' + shown('[data-action=boards-trash]'));
    assert.deepEqual(await layout(), { overflow: false, pageScroll: 0, small: [] }, 'Switcher sheet fits');
    await click('.notes-board-tab'); await wait(`!document.querySelector('.notes-dashboard.is-switching') && document.activeElement===document.querySelector('.notes-switcher')`);

    await size(320, 740); assert.deepEqual(await layout(), { overflow: false, pageScroll: 0, small: [] }, '320: the dashboard fits the screen');
    await size(1440, 900);
    assert.deepEqual(await evaluate(`[${shown('.notes-dock')},${shown('.notes-switcher')},${shown('[data-action=fit]')},${shown('.notes-board-tab')}]`), [false, false, true, true], 'Desktop keeps the toolbar and tabs');

    // Guests get filter, view toggle and sign-in; no mutation controls.
    await size(390, 844);
    await evaluate("{const s=document.querySelector('[data-action=board-visibility]');s.value='public';s.dispatchEvent(new Event('change',{bubbles:true}))}"); await wait(`document.querySelector('.notes-switcher-pill').textContent==='công khai' && ${saved}`);
    await evaluate("(async()=>{await (await import('/js/auth.js')).logout();})()"); await wait("!document.querySelector('[data-mutation]') && document.querySelector('.notes-dock')");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.notes-dock > *')].filter(e=>e.getClientRects().length).map(e=>e.dataset.action||e.className)"), ['notes-dock-filter', 'view-toggle', 'login']);
  }, undefined, { origin: fixture.origin });
} finally { await fixture.close(); }
console.log('Phone notes: list default and memory, dock, ⋯ sheet, inspector sheet, format strip, switcher and guest dock passed.');
