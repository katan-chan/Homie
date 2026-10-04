import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';
import { mediaBytes } from './helpers/media-fixture.mjs';

// Task 8 regressions as real user paths: error/retry draft, rapid switch during fetch/upload, native dialog focus, absent backend.
const fixture = await createNotesFixture({ app: true, ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg', ffprobePath: process.env.FFPROBE_PATH || 'ffprobe' });
// A failing backend answers 503 like a gateway in front of a crashed/restarting process.
const [handler] = fixture.backend.listeners('request'); let failing = false;
fixture.backend.removeAllListeners('request');
fixture.backend.on('request', (req, res) => { if (!failing) return handler(req, res); req.resume(); res.writeHead(503, { 'Content-Type': 'application/json' }).end('{"error":"Máy chủ tạm ngừng"}'); });
const publicBoard = async id => (await (await fetch(`${fixture.origin}/api/boards/${id}`)).json()).board;
const mp4 = (await mediaBytes('mp4')).toString('base64');
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
async function section(name, run) { try { await run(); } catch (error) { failures.push(`${name}: ${(error.message.match(/(?:Error: )?(Timed out[^\n]*)/)?.[1] || error.message).slice(0, 600)}`); } }
try {
  await withBrowser(async (evaluate, { call }) => {
    await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await call('Page.addScriptToEvaluateOnNewDocument', { source: "window.__errors=[];addEventListener('error',e=>__errors.push('error: '+e.message));addEventListener('unhandledrejection',e=>__errors.push('rejection: '+(e.reason?.stack||e.reason)));{const original=console.error;console.error=(...a)=>{__errors.push('console: '+a.map(String).join(' '));original(...a);};}" });
    await call('Page.reload'); await new Promise(r => setTimeout(r, 300));
    const wait = (expression, ms = 8000) => evaluate(`(async()=>{const end=Date.now()+${ms};while(!(${expression})){if(Date.now()>end)throw Error('Timed out: '+${JSON.stringify(expression)}+' / '+document.querySelector('.notes-catalog-status')?.textContent+' / '+document.querySelector('.notes-durability')?.textContent+' / '+document.querySelector('.notes-error')?.textContent);await new Promise(r=>setTimeout(r,30));}return true;})()`);
    const eventually = (expression, ms = 8000) => evaluate(`(async()=>{const end=Date.now()+${ms};while(Date.now()<end){if(${expression})return true;await new Promise(r=>setTimeout(r,50));}return false;})()`);
    const errors = async label => { const list = await evaluate('window.__errors.splice(0)'); check(!list.length, `${label}: uncaught errors ${JSON.stringify(list)}`); };
    const escape = async () => { for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); };
    const active = "(document.activeElement?.dataset?.action||document.activeElement?.dataset?.format||document.activeElement?.tagName)";
    // Samples the durability line; a claim of "Đã lưu" (server-saved) while work is unsaved is a fake save.
    const neverSaved = ms => evaluate(`(async()=>{const seen=new Set(),end=Date.now()+${ms};while(Date.now()<end){const d=document.querySelector('.notes-durability');if(d&&(d.dataset.durability==='saved'||/^Đã lưu(?! trên thiết bị)/.test(d.textContent)))seen.add(d.dataset.durability+':'+d.textContent);await new Promise(r=>setTimeout(r,40));}return [...seen];})()`);
    const english = /failed|fetch|network|typeerror|error|load/i;

    await evaluate("location.hash='dashboard'"); await wait("document.querySelector('.notes-dashboard')");
    await evaluate(`(async()=>{await (await import('/js/auth.js')).login('minhle',${JSON.stringify(fixturePasswords.minhle)});})()`);
    await wait("document.querySelector('[data-action=board-new]')");
    let boardA, boardB;

    // 3. Native dialog focus: open moves focus inside, Escape/close returns it to the opener.
    await section('3 dialog focus', async () => {
      async function dialog(name, opener, kind, { close = false } = {}) {
        await evaluate(`{const b=document.querySelector(${JSON.stringify(opener)});b.focus();b.click();}`);
        await wait(`document.querySelector('dialog[open]${kind}')`);
        check(await evaluate(`document.querySelector('dialog[open]').contains(document.activeElement)`), `${name}: opening must move focus inside the dialog (focus on ${await evaluate(active)})`);
        if (close) await evaluate(`document.querySelector('dialog[open] ${close}').click()`); else await escape();
        await wait("!document.querySelector('dialog.notes-dialog')");
        check(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(opener)})`), `${name}: ${close ? 'Đóng' : 'Escape'} must return focus to its opener (focus on ${await evaluate(active)})`);
      }
      // No boards yet: the visible opener is the big "+" in the empty frame (the tab "+" is hidden then).
      await dialog('board name big "+"', '[data-action=board-new-empty]', ':has(.notes-name-form)');
      for (const name of ['Bảng A', 'Bảng B']) {
        await evaluate(`(document.querySelector('[data-action=board-new-empty]')||document.querySelector('[data-action=board-new]')).click();document.querySelector('dialog[open] .notes-name-form input').value=${JSON.stringify(name)};document.querySelector('dialog[open] .notes-name-form').requestSubmit()`);
        await wait(`[...document.querySelectorAll('.notes-board-tab')].some(t=>t.textContent===${JSON.stringify(name)}&&t.getAttribute('aria-selected')==='true') && document.querySelector('.notes-durability')?.dataset.durability==='saved'`);
        if (name === 'Bảng A') { await evaluate("document.querySelector('[data-action=note-new]').click()"); await wait("document.querySelector('.paper-note .note-text[data-editor-state=ready]') && document.querySelector('.notes-durability').dataset.durability==='saved'"); boardA = await evaluate("document.querySelector('[data-board-id]').dataset.boardId"); }
        else boardB = await evaluate("document.querySelector('[data-board-id]').dataset.boardId");
      }
      await evaluate(`document.querySelector('[data-board-tab="${boardA}"]').click()`); await wait(`document.querySelector('[data-board-id="${boardA}"] .paper-note .note-text[data-editor-state=ready]')`);
      await dialog('board name tab "+"', '[data-action=board-new]', ':has(.notes-name-form)');
      await dialog('rename', '[data-action=board-rename]', ':has(.notes-name-form)');
      // Submitting rename triggers state updates; the re-rendered toolbar must keep focus on its opener.
      await evaluate("{const b=document.querySelector('[data-action=board-rename]');b.focus();b.click();}"); await wait("document.querySelector('dialog[open] .notes-name-form')");
      await evaluate("document.querySelector('dialog[open] .notes-name-form input').value='Bảng A';document.querySelector('dialog[open] .notes-name-form').requestSubmit()");
      await wait("!document.querySelector('dialog.notes-dialog') && document.querySelector('.notes-durability').dataset.durability==='saved'"); await new Promise(r => setTimeout(r, 300));
      check(await evaluate("document.activeElement===document.querySelector('[data-action=board-rename]')"), `rename submit: focus must stay on "Đổi tên bảng" after the board re-renders (focus on ${await evaluate(active)})`);
      await dialog('board trash "Thùng rác"', '[data-action=trash]', '.notes-trash');
      await dialog('board trash "Thùng rác" close button', '[data-action=trash]', '.notes-trash', { close: '[data-action=close]' });
      await dialog('"Bảng đã xóa"', '[data-action=boards-trash]', '.notes-board-trash');
      await dialog('"Thư viện hình"', '[data-action=library-open]', '.note-library');
      await dialog('"Thư viện hình" close button', '[data-action=library-open]', '.note-library', { close: '[data-action=library-close]' });
      await evaluate("document.querySelector('.paper-note .tiptap').editor.view.focus()"); await wait("!document.querySelector('.notes-format-row [data-format=image]').disabled");
      await dialog('image picker "Chèn hình"', '.notes-format-row [data-format=image]', '.note-asset-picker');
      await errors('3 dialog focus');
    });

    // 2. Rapid switching while a board fetch or a media upload is in flight.
    await section('2 rapid switch', async () => {
      await evaluate(`['${boardB}','${boardA}','${boardB}','${boardA}','${boardB}'].forEach(id=>document.querySelector('[data-board-tab="'+id+'"]').click())`);
      await wait(`document.querySelector('[data-board-id="${boardB}"] .notes-durability')?.dataset.durability==='saved'`);
      await new Promise(r => setTimeout(r, 600));
      check(await evaluate(`document.querySelectorAll('.notes-board').length===1 && document.querySelector('.notes-board').dataset.boardId==='${boardB}' && !document.querySelector('.paper-note')`), 'board fetch: only the last selected (empty) board B may render, no stale board A DOM');
      // Leaving the dashboard tab and returning immediately mounts exactly one dashboard on the last board.
      await evaluate("location.hash='garden';setTimeout(()=>location.hash='dashboard',0)");
      await wait(`document.querySelector('.notes-board')?.dataset.boardId==='${boardB}' && document.querySelector('.notes-durability')?.dataset.durability==='saved'`);
      check(await evaluate("document.querySelectorAll('.notes-dashboard').length===1 && document.querySelectorAll('.notes-board').length===1"), 'tab leave/return: one dashboard and one board');
      // Hold the converter response so the switch deterministically happens mid-upload.
      await evaluate("window.nativeFetch=fetch;window.fetch=async(...args)=>{const response=await nativeFetch(...args);if(String(args[0]).includes('/api/note-assets?preview=1'))return new Promise(resolve=>{window.releasePreview=()=>resolve(response);});return response;}");
      await evaluate(`document.querySelector('[data-board-tab="${boardA}"]').click()`); await wait(`document.querySelector('[data-board-id="${boardA}"] .notes-durability')?.dataset.durability==='saved'`);
      await evaluate("document.querySelector('[data-action=library-open]').click()"); await wait("document.querySelector('.note-library')");
      await evaluate(`{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob('${mp4}'),c=>c.charCodeAt(0))],'in-flight.mp4',{type:'video/mp4'}));const input=document.querySelector('.note-library input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);
      await wait('window.releasePreview', 15000);
      await evaluate(`document.querySelector('[data-board-tab="${boardB}"]').click();releasePreview();window.fetch=nativeFetch;`);
      await wait(`document.querySelector('.notes-board')?.dataset.boardId==='${boardB}'`);
      await new Promise(r => setTimeout(r, 500));
      check(await evaluate(`!document.querySelector('.note-library') && !document.querySelector('.note-media-preview *') && document.querySelectorAll('.notes-board').length===1 && document.querySelector('.notes-board').dataset.boardId==='${boardB}'`), 'upload: switching boards must not leave the old library/preview DOM');
      await evaluate(`document.querySelector('[data-board-tab="${boardA}"]').click()`); await wait(`document.querySelector('.notes-board')?.dataset.boardId==='${boardA}'`);
      await evaluate("document.querySelector('[data-action=library-open]').click()"); await wait("document.querySelector('.note-library')");
      check(await eventually("document.querySelector('.note-media-preview video,.note-media-preview img') && !document.querySelector('[data-action=media-publish]').disabled || /in-flight\\.mp4/.test(document.querySelector('.note-library').textContent)", 15000), `upload: interrupted upload must be resumable or reported on return, got "${await evaluate("document.querySelector('.note-library')?.textContent")}"`);
      await evaluate("document.querySelector('[data-action=media-discard]')?.click()"); await wait("!document.querySelector('.note-media-preview *')");
      await evaluate("document.querySelector('[data-action=library-close]').click()"); await wait("!document.querySelector('.note-library')");
      await errors('2 rapid switch');
    });

    // 1. A text edit and a metadata move made while the backend fails stay local, never "Đã lưu", and persist after a retry.
    await section('1 error retry', async () => {
      await evaluate(`document.querySelector('[data-board-tab="${boardA}"]').click()`);
      await wait(`document.querySelector('[data-board-id="${boardA}"] .paper-note .note-text[data-editor-state=ready]') && document.querySelector('.notes-durability').dataset.durability==='saved'`);
      const x = await evaluate("parseFloat(document.querySelector('.paper-note').style.left)");
      failing = true; fixture.backend.closeAllConnections();
      await wait("document.querySelector('.notes-durability').textContent.includes('Ngoại tuyến')");
      await evaluate("document.querySelector('.paper-note .tiptap').editor.view.focus()");
      await call('Input.insertText', { text: 'Nháp khi máy chủ lỗi' });
      await evaluate("document.querySelector('.note-handle').click();document.querySelector('[data-action=move-right]').click()");
      const fake = await neverSaved(1500);
      check(!fake.length, `while failing the UI must not claim saved: ${JSON.stringify(fake)}`);
      check(await evaluate("document.querySelector('.paper-note .tiptap').textContent.includes('Nháp khi máy chủ lỗi')"), 'text draft stays visible while failing');
      check(await evaluate(`Math.abs(parseFloat(document.querySelector('.paper-note').style.left)-(${x + 10}))<.01`), 'metadata move stays visible while failing');
      failing = false;
      await evaluate("document.querySelector('[data-action=save]').click()");
      const deadline = Date.now() + 8000; let board;
      while (Date.now() < deadline) { board = await publicBoard(boardA); if (board?.notes[0]?.x === x + 10 && JSON.stringify(board.notes[0].content).includes('Nháp khi máy chủ lỗi')) break; await new Promise(r => setTimeout(r, 100)); }
      check(board?.notes[0]?.x === x + 10, `after recovery the retry ("Lưu" + heartbeat) must persist the move (server x=${board?.notes[0]?.x}, expected ${x + 10}; UI: ${await evaluate("document.querySelector('.notes-durability').textContent")})`);
      check(JSON.stringify(board?.notes[0]?.content ?? '').includes('Nháp khi máy chủ lỗi'), 'after recovery the retry ("Lưu" + heartbeat) must persist the text draft');
      check(await eventually("document.querySelector('.notes-durability').dataset.durability==='saved'"), 'durability returns to saved after the retry succeeds');
      // The catalog stream must reopen after the 503: a board the other account creates afterwards shows up as a tab.
      const headers = { Origin: fixture.origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' };
      const cookie = (await fetch(fixture.origin + '/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ accountId: 'haiyen', password: fixturePasswords.haiyen }) })).headers.get('set-cookie').split(';')[0];
      const peerBoard = randomUUID();
      const created = await fetch(fixture.origin + '/api/boards/commands', { method: 'POST', headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ clientId: randomUUID(), command: { operationId: randomUUID(), accountId: 'haiyen', boardId: peerBoard, baseRevision: 0, type: 'board.create', payload: { name: 'Bảng của Yến' } } }) });
      check(created.status === 200, `peer board.create status ${created.status}`);
      check(await eventually(`!!document.querySelector('[data-board-tab="${peerBoard}"]')`), 'board catalog stream reconnects after the 503: a peer-created board appears as a tab');
      check(!(await evaluate("document.querySelector('.notes-dashboard').textContent.includes('Chưa kết nối được danh sách bảng')")), 'the catalog error clears once the stream is back');
      await errors('1 error retry');
    });

    // 4. Backend unreachable (dead origin): clear Vietnamese message, never a fake "Đã lưu".
    await section('4 backend absent', async () => {
      await wait(`document.querySelector('[data-board-id="${boardA}"] .paper-note .note-text[data-editor-state=ready]') && document.querySelector('.notes-durability').dataset.durability==='saved'`);
      await call('Network.enable'); await call('Network.setBlockedURLs', { urls: ['*/api/*'] }); fixture.backend.closeAllConnections();
      await wait("document.querySelector('.notes-durability').textContent.includes('Ngoại tuyến')");
      await evaluate("document.querySelector('.paper-note .tiptap').editor.view.focus()");
      await call('Input.insertText', { text: ' · khi vắng máy chủ' });
      const fake = await neverSaved(1500);
      check(!fake.length, `mid-session: edits must not claim saved: ${JSON.stringify(fake)}`);
      const shown = await evaluate("({durability:document.querySelector('.notes-durability').textContent,error:document.querySelector('.notes-error').textContent,catalog:document.querySelector('.notes-catalog-status').textContent})");
      check(/Chờ đồng bộ|Chưa lưu/.test(shown.durability) && shown.durability.includes('Ngoại tuyến'), `mid-session: durability must say not synced/offline, got ${JSON.stringify(shown)}`);
      check(!english.test(shown.error) && !english.test(shown.catalog), `mid-session: messages must be Vietnamese, got ${JSON.stringify(shown)}`);
      await call('Page.reload'); await new Promise(r => setTimeout(r, 300));
      await wait("document.querySelector('.notes-dashboard') && document.querySelector('.notes-catalog-status')?.textContent.trim()");
      await wait("/kết nối|máy chủ/.test(document.querySelector('.notes-dashboard').textContent)");
      const cold = await evaluate("document.querySelector('.notes-dashboard').textContent");
      check(!/Đã lưu(?! trên thiết bị)/.test(cold) && !english.test(cold), `reload without backend: clear Vietnamese message and no fake save, got "${cold}"`);
      await call('Network.setBlockedURLs', { urls: [] });
      await call('Page.reload'); await new Promise(r => setTimeout(r, 300));
      check(await eventually(`fetch('/api/boards/${boardA}').then(r=>r.json()).then(v=>JSON.stringify(v.board.notes[0].content).includes('khi vắng máy chủ'))`, 10000), 'draft typed while backend was absent persists once it returns');
      await errors('4 backend absent');
    });
  }, undefined, { origin: fixture.origin });
  for (const failure of failures) console.error('FAIL', failure);
  assert.equal(failures.length, 0, `${failures.length} regression check(s) failed`);
  console.log('PASS Task8 regressions: error retry keeps draft, rapid switch during fetch/upload, native dialog focus, backend absent message');
} finally { await fixture.close(); }
