// Lịch in the real app: month grid and day panel at 1440 and 390, occasion add/edit, cycles visible to Hải Yến only,
// identity switch clearing cycles. /api/jar and /api/ideas* are stubbed in the page per their contracts (parts A and C).
import assert from 'node:assert/strict';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const at = `${today}T03:00:00.000Z`; // 10:00 local, same local day
const jar = [
  { id: 'k1', kind: 'kiss', ownerId: 'minhle', occurredAt: at, localDate: today, time: '10:00', visibility: 'shared' },
  { id: 'k2', kind: 'kiss', ownerId: 'haiyen', occurredAt: at, localDate: today, time: '10:00', visibility: 'shared' },
  { id: 's1', kind: 'sorry', ownerId: 'minhle', occurredAt: at, localDate: today, time: '10:00', visibility: 'shared' },
  { id: 'm1', kind: 'mood', ownerId: 'minhle', occurredAt: at, localDate: today, time: '10:00', valence: 0.6, energy: 0.5, label: 'Vui', visibility: 'private' },
  // Contract says the server never sends this; the page must still ignore a partner's private mood.
  { id: 'm2', kind: 'mood', ownerId: 'haiyen', occurredAt: at, localDate: today, time: '10:00', valence: -0.6, energy: 0.2, label: 'Bí mật', visibility: 'private' },
];
const stub = `(() => {
  const real = window.fetch.bind(window);
  window.__calls = [];
  const json = body => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    window.__calls.push(url.pathname);
    if (url.pathname === '/api/jar') return json({ items: ${JSON.stringify(jar)} });
    if (url.pathname === '/api/ideas/sessions') return json({ items: url.searchParams.get('kind') === 'seminar'
      ? [{ id: 'x1', ideaId: 'i2', byId: 'minhle', date: '${today}', text: '', ratings: {} }] : [], nextCursor: null });
    if (url.pathname === '/api/ideas') return json({ ideas: [{ id: 'i2', kind: 'seminar', title: 'Cách cây quang hợp' }], pick: null, eligibleCount: 1, exhausted: { recent: false, skipped: false } });
    return real(input, init);
  };
})();`;

const fixture = await createNotesFixture({ app: true });
try {
  await withBrowser(async (evaluate, { call }) => {
    const wait = e => evaluate(`(async()=>{const end=Date.now()+15000;while(!(${e})){if(Date.now()>end)throw Error('timeout '+${JSON.stringify(e)});await new Promise(r=>setTimeout(r,50));}return true;})()`);
    const ready = "document.querySelector('.cal-grid[aria-busy=false]')";
    const cell = `document.querySelector('.cal-day[data-date="${today}"]')`;
    const size = async (width, height) => { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 600 }); await wait(`innerWidth===${width}`); };
    const layout = () => evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,small:[...document.querySelectorAll('.cal-page button')].filter(e=>e.getClientRects().length&&(e.getBoundingClientRect().width<44||e.getBoundingClientRect().height<44)).map(e=>e.className+':'+e.textContent),spill:[...document.querySelectorAll('.cal-page .cal-head,.cal-page .cal-panel,.cal-page .cal-grid')].filter(e=>e.getBoundingClientRect().right>innerWidth+0.5).length})`);
    const switchTo = async account => evaluate(`(async()=>{const a=await import('/js/auth.js');await a.logout();await a.login('${account}',${JSON.stringify(fixturePasswords[account])});})()`);
    const text = selector => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map(e=>e.textContent)`);

    await call('Page.addScriptToEvaluateOnNewDocument', { source: stub });
    await evaluate(`(async()=>{await (await import('/js/auth.js')).login('minhle',${JSON.stringify(fixturePasswords.minhle)});})()`);
    await size(1440, 1000);
    await evaluate("location.hash='calendar';location.reload()");
    await wait(ready);

    // Minh: counts, his own mood dot only, the seminar title from /api/ideas, and no trace of cycles.
    const label = await evaluate(`${cell}.getAttribute('aria-label')`);
    assert.match(label, /2 nụ hôn, 1 lời xin lỗi, có cảm xúc của Minh, 1 hoạt động$/);
    assert.equal(await evaluate(`${cell}.querySelectorAll('.cal-dots i').length`), 1, 'Partner private mood has no dot');
    assert.deepEqual(await text('.cal-panel .cal-who'), ['Minh: Vui', 'Yến: chưa có cảm xúc được chia sẻ']);
    assert.deepEqual(await text('.cal-panel .cal-item .cal-t'), ['Cách cây quang hợp']);
    assert.equal(await evaluate("document.querySelectorAll('.cal-grid > .cal-day').length"), 42);
    assert.equal(await evaluate("document.querySelector('.cal-dow').textContent"), 'T2', 'Weeks start on Monday');
    const cycleTrace = "[document.querySelectorAll('.cal-day.cycle').length,[...document.querySelectorAll('.cal-page button')].some(b=>b.textContent==='Ghi kỳ mới'),document.querySelector('.cal-page').textContent.includes('Nền tím'),window.__calls.some(p=>p.startsWith('/api/cycles'))]";
    assert.deepEqual(await evaluate(cycleTrace), [0, false, false, false], 'Minh never requests or sees cycles');
    assert.deepEqual(await layout(), { overflow: false, small: [], spill: 0 }, '1440 layout');

    // Keyboard: the selected day is the single tab stop; arrows move it.
    await evaluate(`${cell}.focus()`);
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await wait("document.activeElement?.classList.contains('cal-day') && document.activeElement.getAttribute('aria-pressed')==='true' && document.activeElement.dataset.date!=='" + today + "'");
    await evaluate("[...document.querySelectorAll('.cal-head button')].find(b=>b.textContent==='Hôm nay').click()");

    // Add an occasion, then edit it.
    await evaluate("[...document.querySelectorAll('.cal-head button')].find(b=>b.textContent==='Thêm dịp').click()");
    await wait("document.querySelector('dialog.cal-sheet[open] input[name=title]')");
    await evaluate("{const f=document.querySelector('dialog.cal-sheet form');f.title.value='Ngày đầu đi Đà Lạt';f.requestSubmit()}");
    await wait(`!document.querySelector('dialog.cal-sheet') && document.querySelector('.cal-toast:not([hidden])')?.textContent==='Đã thêm vào lịch' && ${ready}`);
    await wait("[...document.querySelectorAll('.cal-panel .cal-t')].some(e=>e.textContent==='Ngày đầu đi Đà Lạt')");
    assert.match(await evaluate(`${cell}.getAttribute('aria-label')`), /1 dịp/);
    await evaluate("[...document.querySelectorAll('.cal-panel .cal-item')].find(e=>e.textContent.includes('Đà Lạt')).click()");
    await wait("[...document.querySelectorAll('dialog.cal-sheet[open] button')].some(b=>b.textContent==='Sửa')");
    await evaluate("[...document.querySelectorAll('dialog.cal-sheet[open] button')].find(b=>b.textContent==='Sửa').click()");
    await wait("document.querySelector('dialog.cal-sheet[open] form')?.title.value==='Ngày đầu đi Đà Lạt'");
    await evaluate("{const f=document.querySelector('dialog.cal-sheet form');f.title.value='Đi Đà Lạt';f.requestSubmit()}");
    await wait(`!document.querySelector('dialog.cal-sheet') && ${ready} && [...document.querySelectorAll('.cal-panel .cal-t')].some(e=>e.textContent==='Đi Đà Lạt')`);

    // Phone.
    await size(390, 844);
    await wait(ready);
    assert.deepEqual(await layout(), { overflow: false, small: [], spill: 0 }, '390 layout');

    // Yến: shading, "Ghi kỳ mới", list of cycles; and she still sees Minh's occasion but not his private mood.
    await switchTo('haiyen');
    await wait(`${ready} && [...document.querySelectorAll('.cal-head button')].some(b=>b.textContent==='Ghi kỳ mới')`);
    assert.deepEqual(await text('.cal-panel .cal-who'), ['Minh: chưa có cảm xúc được chia sẻ', 'Yến: Bí mật']);
    await evaluate("[...document.querySelectorAll('.cal-head button')].find(b=>b.textContent==='Ghi kỳ mới').click()");
    await wait("document.querySelector('dialog.cal-sheet[open] input[name=start]')");
    await evaluate("{const f=document.querySelector('dialog.cal-sheet form');f.end.value='2000-01-01';f.requestSubmit()}");
    await wait("document.querySelector('dialog.cal-sheet[open] .cal-alert:not([hidden])')?.textContent==='Ngày kết thúc phải sau ngày bắt đầu.'");
    await evaluate("{const f=document.querySelector('dialog.cal-sheet form');f.end.value='';f.requestSubmit()}");
    await wait(`!document.querySelector('dialog.cal-sheet') && ${ready} && ${cell}.classList.contains('cycle')`);
    assert.match(await evaluate(`${cell}.getAttribute('aria-label')`), /trong kỳ$/);
    assert.equal(await evaluate("document.querySelector('.cal-page').textContent.includes('Nền tím nhạt')"), true);
    assert.deepEqual(await layout(), { overflow: false, small: [], spill: 0 }, '390 layout with cycle');
    await evaluate("[...document.querySelectorAll('.cal-panel button')].find(b=>b.textContent==='Xem các kỳ').click()");
    await wait("document.querySelector('dialog.cal-sheet[open]')?.textContent.includes('đang diễn ra')");
    await evaluate("[...document.querySelectorAll('dialog.cal-sheet[open] button')].find(b=>b.textContent==='Đóng'||b.getAttribute('aria-label')==='Đóng').click()");
    await wait("!document.querySelector('dialog.cal-sheet')");

    // Back to Minh in the same mounted tab: the cycle disappears without a reload.
    await switchTo('minhle');
    await wait(`${ready} && ![...document.querySelectorAll('.cal-head button')].some(b=>b.textContent==='Ghi kỳ mới')`);
    assert.equal(await evaluate("document.querySelectorAll('.cal-day.cycle').length"), 0);
    assert.equal(await evaluate("document.querySelector('.cal-page').textContent.includes('Trong kỳ')"), false);
    const direct = await evaluate(`(async()=>{const r=await fetch('/api/cycles?from=${today}&to=${today}',{credentials:'include'});return [r.status,(await r.json()).code];})()`);
    assert.deepEqual(direct, [404, 'not_found'], 'Minh gets 404 from the cycles API');
  }, undefined, { origin: fixture.origin });
} finally { await fixture.close(); }
console.log('Calendar: grid, day panel, occasions, Yến-only cycles, identity switch, 390 and 1440 layout passed.');
