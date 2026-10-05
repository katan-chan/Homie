// Memory flowers in the real garden at 1440 and 390: a member sees the memories planted through the notes API, a tap opens
// the memory sheet, "Mở trong Góc ghi chép" lands on the note, guests see none. GARDEN_SHOTS=<dir> also saves screenshots.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import * as Y from 'yjs';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

const fixture = await createNotesFixture({ app: true });
const headers = { Origin: fixture.origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' };
const login = async accountId => (await fetch(fixture.origin + '/api/auth/login', { method: 'POST', headers,
  body: JSON.stringify({ accountId, password: fixturePasswords[accountId] }) })).headers.get('set-cookie').split(';')[0];
const cookies = { minhle: await login('minhle'), haiyen: await login('haiyen') };
const post = async (accountId, path, body) => {
  const response = await fetch(fixture.origin + path, { method: 'POST', headers: { ...headers, Cookie: cookies[accountId] }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
};
const command = (accountId, boardId, type, payload) => post(accountId, '/api/boards/commands',
  { clientId: randomUUID(), command: { operationId: randomUUID(), accountId, boardId, baseRevision: 0, type, payload } });
function textUpdate(lines) {
  const doc = new Y.Doc();
  doc.getXmlFragment('body').insert(0, lines.map(line => { const p = new Y.XmlElement('paragraph'), t = new Y.XmlText(); t.insert(0, line); p.insert(0, [t]); return p; }));
  const update = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'); doc.destroy(); return update;
}
const note = async (accountId, boardId, lines, extra) => {
  const id = randomUUID();
  await command(accountId, boardId, 'note.create', { id, columnId: null, x: 40, y: 40, width: 220, height: 180, color: '#f9dbe5', ...extra });
  await post(accountId, `/api/notes/${id}/text`, { accountId, operationId: randomUUID(), update: textUpdate(lines) });
  return id;
};

const [home, journal] = [randomUUID(), randomUUID()];
await command('minhle', home, 'board.create', { name: 'Vườn nhà mình', visibility: 'shared' });
await command('haiyen', journal, 'board.create', { name: 'Nhật ký của Yến', visibility: 'shared', noteDefault: 'private' });
const memory = { labels: ['Kỷ niệm'], garden: true };
const sea = await note('minhle', home, ['Đi biển Vũng Tàu', 'Gió to, cát bay vào cơm.'], { ...memory, memoryDate: '2026-10-12', gardenFlower: 'poppy' });
const meal = await note('haiyen', home, ['Bữa cơm đầu tiên ở nhà mới'], { ...memory, memoryDate: '2026-10-01', gardenFlower: 'daisy' });
await note('haiyen', journal, ['Bí mật của Yến'], { ...memory, memoryDate: '2026-09-01', visibility: 'haiyen' });
const later = await note('minhle', home, ['Chưa trồng'], { labels: ['Kỷ niệm'], memoryDate: '2026-09-20', garden: false });
const extra = [], kinds = ['lavender', 'allium', null, 'cosmos'];
for (let i = 0; i < 4; i++) extra.push(await note('minhle', home, [`Kỷ niệm số ${i + 1}`], { ...memory, memoryDate: `2026-08-0${i + 1}`, gardenFlower: kinds[i] }));

const errors = `window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));`;
try {
  await withBrowser(async (evaluate, { call }) => {
    const wait = e => evaluate(`(async()=>{const end=Date.now()+15000;while(!(${e})){if(Date.now()>end)throw Error('timeout '+${JSON.stringify(e)});await new Promise(r=>setTimeout(r,50));}return true;})()`);
    const size = async (width, height) => { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 600 }); await wait(`innerWidth===${width}`); };
    const shot = async name => {
      if (!process.env.GARDEN_SHOTS) return;
      await new Promise(r => setTimeout(r, 1200)); // let the shell canvas finish drawing
      const { data } = await call('Page.captureScreenshot', { format: 'png' });
      await writeFile(`${process.env.GARDEN_SHOTS}/garden-${name}.png`, Buffer.from(data, 'base64'));
    };
    const flowers = "document.querySelectorAll('.memory-flower')";
    // Every flower: ≥ 44 px, fully on screen, below the lettering and not on top of another flower; no page overflow.
    const layout = `(()=>{const r=[...${flowers}].map(f=>f.getBoundingClientRect()),t=document.querySelector('.garden-title').getBoundingClientRect();
      return {overflow:document.documentElement.scrollWidth>innerWidth,small:r.filter(b=>b.width<44||b.height<44).length,
        off:r.filter(b=>b.left<0||b.right>innerWidth||b.top<0||b.bottom>innerHeight+1).length,title:r.filter(b=>b.top<t.bottom-8&&b.right>t.left&&b.left<t.right).length,
        overlap:r.filter((a,i)=>r.some((b,j)=>j>i&&a.left<b.right-8&&b.left<a.right-8&&a.top<b.bottom-8&&b.top<a.bottom-8)).length}})()`;
    const clean = { overflow: false, small: 0, off: 0, title: 0, overlap: 0 };
    const open = async label => {
      await evaluate(`[...${flowers}].find(f=>f.getAttribute('aria-label')===${JSON.stringify(label)}).click()`);
      await wait("document.querySelector('dialog.memory-sheet[open]')");
    };

    await call('Page.addScriptToEvaluateOnNewDocument', { source: errors });
    await evaluate(`(async()=>{await (await import('/js/auth.js')).login('minhle',${JSON.stringify(fixturePasswords.minhle)});})()`);
    await size(1440, 1000);
    await evaluate("location.hash='garden';location.reload()");
    await wait(`${flowers}.length===6`);
    const labels = await evaluate(`[...${flowers}].map(f=>f.getAttribute('aria-label')).sort()`);
    assert.deepEqual(labels, ['Hoa kỷ niệm: Bữa cơm đầu tiên ở nhà mới', 'Hoa kỷ niệm: Đi biển Vũng Tàu',
      ...extra.map((_, i) => `Hoa kỷ niệm: Kỷ niệm số ${i + 1}`)].sort(), 'Only visible planted memories; no private page, no unplanted memory');
    assert.equal(await evaluate("!!document.querySelector('.garden-content ul,.garden-content ol')"), false, 'No memory list');
    assert.deepEqual(await evaluate(layout), clean, '1440 layout');
    const species = `Object.fromEntries([...${flowers}].map(f=>[f.getAttribute('aria-label').slice(13),f.dataset.flower+(f.querySelector('.memory-ribbon')?'+ribbon':'')+(f.querySelector('img').getAttribute('src').includes('memory-'+f.dataset.flower+'.webp')?'':'!img')]))`;
    assert.deepEqual(await evaluate(species), { 'Đi biển Vũng Tàu': 'poppy+ribbon', 'Bữa cơm đầu tiên ở nhà mới': 'daisy+ribbon', 'Kỷ niệm số 1': 'lavender+ribbon',
      'Kỷ niệm số 2': 'allium+ribbon', 'Kỷ niệm số 3': 'cosmos+ribbon', 'Kỷ niệm số 4': 'cosmos+ribbon' }, 'Each memory grows its chosen flower (null: the default) with a ribbon');
    await wait(`[...document.querySelectorAll('.memory-flower img')].every(i=>i.complete&&i.naturalWidth>0)`); // every species image loads
    const sway = "getComputedStyle(document.querySelector('.memory-plant')).animationName";
    assert.equal(await evaluate(sway), 'memory-sway');
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await evaluate(sway), 'none', 'Reduced motion: flowers stand still');
    await call('Emulation.setEmulatedMedia', { features: [] });
    const spots = await evaluate(`[...${flowers}].map(f=>f.getAttribute('aria-label')+f.style.cssText).sort().join()`);
    await shot('1440');

    await open('Hoa kỷ niệm: Đi biển Vũng Tàu');
    assert.deepEqual(await evaluate(`(()=>{const d=document.querySelector('dialog[open]');return [d.querySelector('h2').textContent,d.querySelector('.memory-meta').textContent,d.querySelector('.memory-body').textContent,document.activeElement.closest('dialog')===d]})()`),
      ['Đi biển Vũng Tàu', '12/10/2026 · Minh viết · bảng Vườn nhà mình', 'Gió to, cát bay vào cơm.', true]);
    assert.equal(await evaluate("(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return r.width<=580&&Math.abs(r.left+r.width/2-innerWidth/2)<2&&r.bottom<innerHeight})()"), true, '1440: centred modal');
    assert.equal(await evaluate("[...document.querySelectorAll('dialog[open] button')].every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44})"), true);
    await shot('1440-sheet');
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait("!document.querySelector('dialog[open]')");
    await wait("document.activeElement.getAttribute('aria-label')==='Hoa kỷ niệm: Đi biển Vũng Tàu'"); // focus returns to the flower

    // Same ids, same spots after a reload.
    await evaluate('location.reload()'); await wait(`${flowers}.length===6`);
    assert.equal(await evaluate(`[...${flowers}].map(f=>f.getAttribute('aria-label')+f.style.cssText).sort().join()`), spots, 'Deterministic placement');

    // Open in board: the dashboard selects the board and highlights the note.
    await open('Hoa kỷ niệm: Bữa cơm đầu tiên ở nhà mới');
    assert.equal(await evaluate("document.querySelector('dialog[open] .memory-meta').textContent"), '1/10/2026 · Yến viết · bảng Vườn nhà mình');
    await evaluate("[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Mở trong Góc ghi chép').click()");
    await wait(`location.hash==='#dashboard'&&document.querySelector('[data-note-id="${meal}"].is-focused')`);
    assert.equal(await evaluate("sessionStorage.getItem('homie-notes:focus')"), null, 'Handoff consumed');

    // Plant from the board: "🌱 Trồng vào vườn" asks for a flower; the garden grows that species with a ribbon.
    const saved = "document.querySelector('.notes-durability')?.dataset.durability==='saved'";
    const board = async () => {
      await evaluate(`sessionStorage.setItem('homie-notes:focus',JSON.stringify({boardId:${JSON.stringify(home)},noteId:${JSON.stringify(later)}}));location.hash='garden'`);
      await wait("document.querySelector('.garden-title')"); await evaluate("location.hash='dashboard'");
      await wait(`document.querySelector('[data-note-id="${later}"].is-focused')`);
      await evaluate(`document.querySelector('[data-note-id="${later}"] .note-handle').click()`);
      await wait("document.querySelector('[data-action^=note-garden]')");
    };
    const openPicker = async () => {
      await evaluate("document.querySelector('[data-action=note-garden-pick]').click()"); await wait("document.querySelector('dialog.notes-flower-dialog[open]')");
    };
    const pick = async (id, name) => {
      await openPicker();
      await evaluate(`document.querySelector('dialog[open] input[value=${id}]').click()`);
      if (name) await shot(name);
      await evaluate("document.querySelector('dialog[open] form').requestSubmit()");
      await wait(`document.querySelector('[data-action=note-garden-remove]')&&${saved}`);
    };
    const grown = `[...${flowers}].find(f=>f.getAttribute('aria-label')==='Hoa kỷ niệm: Chưa trồng')`;
    await board(); await openPicker();
    assert.deepEqual(await evaluate(`(()=>{const d=document.querySelector('dialog[open]');return [d.querySelector('legend').textContent,[...d.querySelectorAll('.notes-flower-option')].map(o=>o.textContent+(o.querySelector('input').checked?'*':'')).join(),
      [...d.querySelectorAll('.notes-flower-option')].every(o=>{const r=o.getBoundingClientRect();return r.width>=44&&r.height>=44}),document.activeElement.name]})()`),
      ['Chọn hoa để trồng vào vườn', 'Cánh bướm hồng*,Cúc họa mi,Anh túc cam,Oải hương,Cầu tím', true, 'flower'], 'Picker: radio group of every species, the default chosen and focused');
    assert.equal(await evaluate("(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return r.width<=540&&Math.abs(r.left+r.width/2-innerWidth/2)<2})()"), true, '1440: picker is a centred modal');
    await evaluate("document.querySelector('dialog[open] [data-action=flower-cancel]').click()"); await wait("!document.querySelector('dialog[open]')");
    await pick('lavender', 'picker-1440');
    assert.equal(await evaluate("document.querySelector('.notes-garden-flower').textContent"), '🌱 Oải hương');
    assert.equal(await evaluate(`document.querySelector('[data-note-id="${later}"] .note-label.is-garden').textContent`), '🌱 Oải hương');
    await evaluate("location.hash='garden'"); await wait(`${grown}?.dataset.flower==='lavender'&&${grown}.querySelector('.memory-ribbon')`);
    // Đổi hoa, then Nhổ khỏi vườn.
    await board(); await pick('allium');
    await evaluate("location.hash='garden'"); await wait(`${grown}?.dataset.flower==='allium'`);
    await board(); await evaluate("document.querySelector('[data-action=note-garden-remove]').click()");
    await wait(`document.querySelector('[data-action=note-garden-pick]')&&${saved}`);
    await evaluate("location.hash='garden'"); await wait(`${flowers}.length===6&&!${grown}`);

    // Phone.
    await size(390, 844);
    await evaluate("location.hash='garden'"); await wait(`${flowers}.length===6`);
    assert.deepEqual(await evaluate(layout), clean, '390 layout');
    await shot('390');
    await open('Hoa kỷ niệm: Đi biển Vũng Tàu');
    assert.equal(await evaluate("(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return Math.abs(r.bottom-innerHeight)<2&&Math.abs(r.width-innerWidth)<2})()"), true, '390: bottom sheet');
    await shot('390-sheet');
    await evaluate("document.querySelector('dialog[open] .memory-close').click()"); await wait("!document.querySelector('dialog[open]')");
    await board(); await openPicker();
    assert.equal(await evaluate("(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return Math.abs(r.bottom-innerHeight)<2&&Math.abs(r.width-innerWidth)<2&&document.documentElement.scrollWidth<=innerWidth})()"), true, '390: picker is a bottom sheet');
    assert.equal(await evaluate("[...document.querySelectorAll('dialog[open] .notes-flower-option,dialog[open] button')].every(o=>{const r=o.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.right<=innerWidth})"), true, '390: picker targets');
    await evaluate("document.querySelector('dialog[open] input[value=poppy]').click()"); await shot('picker-390');
    await evaluate("document.querySelector('dialog[open] [data-action=flower-cancel]').click()"); await wait("!document.querySelector('dialog[open]')");
    await evaluate("location.hash='garden'"); await wait(`${flowers}.length===6`);
    for (const [w, h] of [[320, 740], [768, 1024], [844, 390]]) {
      await size(w, h);
      assert.deepEqual(await evaluate(layout), clean, `${w}x${h} layout`);
      await shot(`${w}x${h}`);
    }
    await size(390, 844);

    // Logout with a sheet open: the memory and every flower go at once. Guests never get flowers.
    await open('Hoa kỷ niệm: Đi biển Vũng Tàu');
    await evaluate("(async()=>{await (await import('/js/auth.js')).logout();})()");
    await wait(`${flowers}.length===0&&!document.querySelector('dialog[open]')`);
    await evaluate('location.reload()'); await wait("document.querySelector('.garden-title')");
    await new Promise(r => setTimeout(r, 800));
    assert.equal(await evaluate(`${flowers}.length`), 0, 'Guest sees the original garden');
    // Account switch shows the new viewer's flowers (Yến also sees her private journal page).
    await evaluate(`(async()=>{await (await import('/js/auth.js')).login('haiyen',${JSON.stringify(fixturePasswords.haiyen)});})()`);
    await wait(`${flowers}.length===7`);
    // Leaving the tab removes the layer; coming back works.
    await evaluate("location.hash='calendar'"); await wait(`${flowers}.length===0`);
    await evaluate("location.hash='garden'"); await wait(`${flowers}.length===7`);
    assert.deepEqual(await evaluate('window.__errors'), [], 'No page errors');
    console.log(`PASS garden memory flowers (${sea.slice(0, 8)}…): member flowers, sheet, open in board, phone, guest, account switch`);
  }, undefined, { origin: fixture.origin });
} finally {
  await fixture.close();
}
