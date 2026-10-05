import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

// Self-contained: headless Chrome is Minh (then Yến); the other person acts through the same API from Node.
const fixture = await createNotesFixture({ app: true });
const cookies = {};
for (const id of ['minhle', 'haiyen']) {
  const response = await fetch(`${fixture.origin}/api/auth/login`, { method: 'POST', headers: { Origin: fixture.origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: id, password: fixturePasswords[id] }) });
  cookies[id] = response.headers.get('set-cookie').split(';')[0];
}
async function api(who, path, method = 'GET', body) {
  const headers = { Cookie: cookies[who], ...(method === 'GET' ? {} : { Origin: fixture.origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' }) };
  const response = await fetch(fixture.origin + path, { method, headers, body: body && JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}
const idea = (who, kind, title, category) => api(who, '/api/ideas', 'POST', { requestId: randomUUID(), kind, title, category, desc: `Mô tả của ${title}` });

await idea('haiyen', 'seminar', 'Nếu con người sống 500 năm?');
await idea('minhle', 'seminar', 'Cách cây quang hợp');
await idea('haiyen', 'activity', 'Đi bộ quanh hồ', 'Khám phá');
await idea('minhle', 'activity', 'Chơi cờ cá ngựa', 'Chơi');
await idea('haiyen', 'activity', 'Viết thư tay cho nhau', 'Tụi mình');
// Three finished activities by Yến, so the history needs "Xem thêm"; then Yến leaves a pick for both to see.
const yen = await idea('haiyen', 'activity', 'Nấu một món mới', 'Tự làm');
for (let i = 0; i < 3; i++) {
  await api('haiyen', '/api/ideas/relax', 'POST', { kind: 'activity' });
  const { pick } = await api('haiyen', '/api/ideas/pick', 'POST', { kind: 'activity', category: 'Tự làm', requestId: randomUUID() });
  await api('haiyen', '/api/ideas/done', 'POST', { kind: 'activity', pickId: pick.id, date: `2026-0${i + 1}-15`, text: `Lần ${i + 1}`, requestId: randomUUID() });
}
await api('haiyen', '/api/ideas/pick', 'POST', { kind: 'activity', category: 'Khám phá', requestId: randomUUID() });

try {
  await withBrowser(async (evaluate, { call }) => {
    const ev = expression => evaluate(expression.includes(';') ? `(async()=>{${expression}})()` : `(async()=>(${expression}))()`);
    async function until(expression, timeout = 8000) {
      const end = Date.now() + timeout; let last;
      while (Date.now() < end) {
        try { if (await ev(expression)) return; } catch (error) { last = error; }
        await new Promise(r => setTimeout(r, 50));
      }
      throw Error(`Timed out: ${expression}${last ? ` (${last.message})` : ''}`);
    }
    let checks = 0;
    async function check(name, expression) { assert.equal(await ev(expression), true, name); checks++; }
    const text = selector => `(document.querySelector(${JSON.stringify(selector)})?.textContent??"")`;
    const clickText = (label, scope = '.roulette') => ev(`[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
    const hasButton = (label, scope = '.roulette') => `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].some(b=>b.textContent===${JSON.stringify(label)})`;
    const pickNote = '.roulette-pick .roulette-note';
    async function viewport(width, height) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await until(`innerWidth===${width}`);
    }
    async function signIn(id) {
      await until('!!document.querySelector(".login-form")');
      await ev(`document.querySelector("[name=accountId]").value=${JSON.stringify(id)};document.querySelector("[name=password]").value=${JSON.stringify(fixturePasswords[id])};document.querySelector(".login-form").requestSubmit()`);
    }
    async function open(hash) {
      await ev(`location.hash=${JSON.stringify(hash)}`);
      await until(`!!document.querySelector(".roulette--${hash}")&&!${text(pickNote)}.startsWith("Đang tải")`);
    }
    const noOverflow = 'document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll(".roulette button:not(.roulette-chip),.roulette h1,.roulette h2,.roulette-chips")].every(n=>(r=>r.width===0||(r.left>=-1&&r.right<=innerWidth+1))(n.getBoundingClientRect()))';

    await call('Runtime.enable'); await call('Network.enable'); await call('Network.clearBrowserCookies');
    await viewport(1440, 1000);
    await ev('location.hash="seminar"');
    await signIn('minhle');
    await open('seminar');
    await check('seminar page title and copy', `${text('.roulette-title')}==="Gợi ý chủ đề seminar"&&${text(pickNote)}==="2 mục có thể bốc"&&${hasButton('🌱 Gieo một hạt')}`);
    await check('desktop pool opens as a board with both papers', 'document.querySelectorAll(".roulette-world .roulette-paper").length===2&&document.querySelector(".roulette-seg [aria-pressed=true]").textContent==="Mặt bảng"');
    await check('only the author can edit or archive a paper', '[...document.querySelectorAll(".roulette-paper")].every(p=>!!p.querySelector(".roulette-actions")===(p.querySelector("b").textContent==="Minh"))');

    // Pick: the server chooses; Yến sees the same shared pick.
    await clickText('🌱 Gieo một hạt');
    await until(`${text(pickNote)}==="Bạn đã chọn cho tụi mình"`);
    const shown = await ev(text('.roulette-pick-title'));
    const seenByYen = await api('haiyen', '/api/ideas?kind=seminar');
    assert.equal(seenByYen.pick.byId, 'minhle');
    assert.equal(seenByYen.ideas.find(i => i.id === seenByYen.pick.ideaId).title, shown);
    checks++;
    await check('picked paper is highlighted', `document.querySelector(".roulette-paper.is-picked h3").textContent===${JSON.stringify(shown)}`);

    await clickText('Bỏ qua');
    await until(`${text(pickNote)}==="1 mục có thể bốc"`);
    await check('focus stays in the pick panel after skip', '!!document.activeElement.closest(".roulette-pick")');
    await clickText('🌱 Gieo một hạt');
    await until(`${text(pickNote)}==="Bạn đã chọn cho tụi mình"`);
    await check('a skipped idea is not picked again this round', `${text('.roulette-pick-title')}!==${JSON.stringify(shown)}`);
    const doneTitle = await ev(text('.roulette-pick-title'));

    await clickText('Xong rồi');
    await until('!!document.querySelector("dialog.roulette-sheet[open]")');
    await check('done sheet: date today, note, own rating', `${text('dialog.roulette-sheet h2')}==="Xong rồi!"&&!!document.querySelector("dialog [name=date]").value&&${text('dialog .roulette-field:last-of-type span')}==="Minh thích mức (không bắt buộc)"`);
    await ev('document.querySelector("dialog [name=text]").value="Yến vẽ lá đẹp hơn";document.querySelector("dialog [name=rating]").value="4";document.querySelector("dialog form").requestSubmit()');
    await until(`!document.querySelector("dialog.roulette-sheet")&&${text('.roulette-session')}.includes(${JSON.stringify(doneTitle)})`);
    await check('history shows note and per-person ratings', `${text('.roulette-session')}.includes("Minh: Yến vẽ lá đẹp hơn")&&${text('.roulette-session')}.includes("Minh thích mức 4/5 · Yến chưa chấm")`);
    await check('done toast', `${text('.roulette-toast')}==="Đã ghi lại, có trong lịch. Vui quá!"`);

    // Exhausted: one done recently, the other skipped.
    await until(`${text(pickNote)}==="1 mục có thể bốc"`);
    await clickText('🌱 Gieo một hạt'); await until(hasButton('Bỏ qua'));
    await clickText('Bỏ qua');
    await until(`${text('.roulette-pick')}.startsWith("Chưa còn gì để bốc: 1 mục vừa làm trong 14 ngày qua, 1 mục đã bỏ qua lượt này.")`);
    await check('exhausted state offers both ways out', `${hasButton('Đặt lại các mục đã bỏ qua')}&&${hasButton('Cho bốc cả mục vừa làm')}`);
    await clickText('Đặt lại các mục đã bỏ qua');
    await until(`${text(pickNote)}==="1 mục có thể bốc"`);
    await clickText('🌱 Gieo một hạt'); await until(hasButton('Bỏ qua'));
    await clickText('Bỏ qua'); await until(hasButton('Cho bốc cả mục vừa làm'));
    await clickText('Cho bốc cả mục vừa làm');
    await until(`${text(pickNote)}==="1 mục có thể bốc (gồm cả mục vừa làm)"`);
    checks++;

    // Rate: each person rates their own enjoyment.
    await clickText('Mình thích mức…');
    await until('!!document.querySelector("dialog.roulette-sheet[open] .roulette-star")');
    await check('rate sheet marks the current rating', 'document.querySelector(".roulette-star[aria-pressed=true]").textContent==="4"');
    await ev('document.querySelectorAll(".roulette-star")[4].click()');
    await until(`!document.querySelector("dialog.roulette-sheet")&&${text('.roulette-session')}.includes("Minh thích mức 5/5")`);
    checks++;

    // New idea through the sheet, then list mode, then a drag that saves x/y.
    await clickText('+ Chủ đề');
    await until('!!document.querySelector("dialog.roulette-sheet[open] [name=title]")');
    await check('idea sheet: seminar category is fixed', `${text('dialog.roulette-sheet h2')}==="Chủ đề seminar mới"&&document.querySelector("dialog [name=category]").options.length===1`);
    await ev('document.querySelector("dialog [name=title]").value="Vì sao mình hay quên giấc mơ?";document.querySelector("dialog [name=minutes]").value="30";document.querySelector("dialog form").requestSubmit()');
    await until('document.querySelectorAll(".roulette-paper").length===3');
    await clickText('Danh sách');
    await check('list mode', 'document.querySelectorAll(".roulette-list .roulette-paper").length===3&&!document.querySelector(".roulette-surface")');
    await clickText('Mặt bảng');
    const paper = 'document.querySelector(".roulette-world .roulette-paper:last-child")';
    const id = await ev(`${paper}.dataset.id`);
    await ev(`${paper}.scrollIntoView({block:"center"})`);
    const before = (await api('haiyen', '/api/ideas?kind=seminar')).ideas.find(i => i.id === id);
    const head = await evaluate(`(()=>{const r=${paper}.querySelector(".roulette-paper-head").getBoundingClientRect();return {x:r.left+120,y:r.top+20}})()`);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: head.x, y: head.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 5; step++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: head.x + step * 20, y: head.y + step * 10, button: 'left', buttons: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: head.x + 100, y: head.y + 50, button: 'left', clickCount: 1 });
    let moved;
    for (let i = 0; i < 40; i++) {
      moved = (await api('haiyen', '/api/ideas?kind=seminar')).ideas.find(item => item.id === id);
      if (moved.x !== before.x) break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.deepEqual([moved.x, moved.y], [before.x + 100, before.y + 50], 'drag saves x/y');
    assert.equal(moved.version, 1, 'moving does not bump the version');
    checks++;
    await check('seminar has no overflow at 1440', noOverflow);

    // Activity page: Yến's shared pick, category chips, history paging.
    await open('activity');
    await check('activity page shows the pick Yến made', `${text(pickNote)}==="Yến đã chọn cho tụi mình"&&${text('.roulette-pick-title')}==="Đi bộ quanh hồ"`);
    await check('activity history starts short with Xem thêm', `document.querySelectorAll(".roulette-session").length===2&&${hasButton('Xem thêm')}`);
    await clickText('Xem thêm');
    await until('document.querySelectorAll(".roulette-session").length===3');
    await check('history ends', `!${hasButton('Xem thêm')}&&${text('.roulette-history')}.includes("Yến: Lần 1")`);
    await clickText('Chơi');
    await until('document.querySelectorAll(".roulette-paper").length===1');
    await check('category chip filters the pool', `document.querySelector(".roulette-chip[aria-pressed=true]").textContent==="Chơi"&&${text('.roulette-paper h3')}==="Chơi cờ cá ngựa"`);
    await clickText('Tất cả');
    await until('document.querySelectorAll(".roulette-paper").length===4');
    await check('activity has no overflow at 1440', noOverflow);

    await viewport(390, 844);
    await open('seminar');
    await check('phone opens the pool as a list', '!!document.querySelector(".roulette-list")');
    await check('seminar has no overflow at 390', noOverflow);
    await clickText('🌱 Gieo một hạt'); await until(hasButton('Xong rồi'));
    await clickText('Xong rồi'); await until('!!document.querySelector("dialog.roulette-sheet[open]")');
    await check('phone sheet fits the screen', '(r=>r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight+1)(document.querySelector("dialog.roulette-sheet").getBoundingClientRect())');
    await ev('document.querySelector("dialog.roulette-sheet").close()');
    await open('activity');
    await check('activity has no overflow at 390', noOverflow);

    // Yến signs in on this browser and sees the seminar pick Minh left.
    await ev('if(!document.querySelector("#sidebar").open)document.querySelector(".menu-toggle").click();document.querySelector(".logout-button").click()');
    await until('!document.querySelector(".roulette")&&!!document.querySelector(".login-form")');
    checks++;
    await ev('location.hash="seminar"');
    await signIn('haiyen');
    await open('seminar');
    await check('Yến sees the shared pick by Minh', `${text(pickNote)}==="Minh đã chọn cho tụi mình"`);
    await check('Yến rates only her own enjoyment', `${text('.roulette-session')}.includes("Minh thích mức 5/5 · Yến chưa chấm")`);
    console.log(`PASS browser roulette: ${checks} checks (shared pick, skip, done, exhausted, rate, history, idea sheet, board/list, drag, chips, 390/1440, two accounts)`);
  }, undefined, { origin: fixture.origin });
} finally { await fixture.close(); }
