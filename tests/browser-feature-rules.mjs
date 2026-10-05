import assert from 'node:assert/strict';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

// Self-contained: headless Chrome mounts the real Nội quy panel on a blank harness page against a temp backend.
// Minh uses the browser; Yến acts through the API with her own session, so both accounts really agree.
const fixture = await createNotesFixture();
const api = async (path, body, cookie) => {
  const response = await fetch(fixture.origin + path, body === undefined ? { headers: { Cookie: cookie } } : {
    method: 'POST', body: JSON.stringify(body),
    headers: { Cookie: cookie, Origin: fixture.origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' },
  });
  const data = await response.json();
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
};
const yenLogin = await fetch(`${fixture.origin}/api/auth/login`, { method: 'POST', body: JSON.stringify({ accountId: 'haiyen', password: fixturePasswords.haiyen }),
  headers: { Origin: fixture.origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' } });
const yen = yenLogin.headers.get('set-cookie').split(';')[0];
const yenDo = async (action, rule, body = {}) => (await api(`/api/rules/${rule.id}/${action}`, { requestId: crypto.randomUUID(), version: rule.version, ...body }, yen)).rule;
const latest = async () => (await api('/api/rules', undefined, yen)).rules;

try {
  await withBrowser(async (evaluate, { call }) => {
    // Statements run in a block; plain expressions (and IIFEs) are returned.
    const ev = expression => evaluate(expression.includes(';') && !expression.startsWith('(()=>') ? `(async()=>{${expression}})()` : `(async()=>(${expression}))()`);
    async function until(expression, timeout = 7000) {
      const end = Date.now() + timeout; let last;
      while (Date.now() < end) {
        try { if (await ev(expression)) return; } catch (error) { last = error; }
        await new Promise(r => setTimeout(r, 50));
      }
      throw Error(`Timed out: ${expression}${last ? ` (${last.message})` : ''}`);
    }
    let checks = 0;
    async function check(name, expression) { assert.equal(await ev(expression), true, name); checks++; }
    const viewport = (width, height) => call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const clickText = (text, scope = '.rules-panel') => ev(`[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
    const hasButton = (text, scope = '.rules-panel') => `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].some(b=>b.textContent===${JSON.stringify(text)})`;
    const panelText = 'document.querySelector(".rules-panel").textContent';
    const refresh = () => ev('document.dispatchEvent(new Event("visibilitychange"))');
    const fill = values => ev(`const f=document.querySelector("dialog.rules-dialog[open] form");${Object.entries(values).map(([k, v]) => `f.elements.${k}.value=${JSON.stringify(v)};f.elements.${k}.dispatchEvent(new Event("input"));`).join('')}`);
    const submit = () => ev('document.querySelector("dialog.rules-dialog[open] form").requestSubmit()');
    // No horizontal overflow and every visible button is at least 44 px.
    const fits = '(()=>{const w=document.documentElement.clientWidth;const all=[...document.querySelectorAll(".rules-panel *")].filter(e=>e.getClientRects().length);return document.documentElement.scrollWidth<=w&&all.every(e=>e.getBoundingClientRect().right<=w+0.5)&&[...document.querySelectorAll(".rules-panel button")].filter(b=>b.getClientRects().length).every(b=>{const r=b.getBoundingClientRect();return r.height>=44&&r.width>=44;})})()';

    await call('Network.enable'); await call('Network.clearBrowserCookies');
    await viewport(1440, 1000);
    await ev(`const l=document.createElement("link");l.rel="stylesheet";l.href="/styles/rules.css";document.head.append(l);await new Promise(r=>l.onload=r);
      document.body.style.margin="0";const host=document.createElement("main");host.id="host";document.body.append(host);
      const auth=await import("/js/auth.js");await auth.login("minhle",${JSON.stringify(fixturePasswords.minhle)});
      const {mountRulesPanel}=await import("/js/notes/rules-panel.js");window.auth=auth;window.mountRulesPanel=mountRulesPanel;
      window.controller=new AbortController();window.cleanup=mountRulesPanel(host,{signal:controller.signal})`);
    await until(`${panelText}.includes("Chưa có nội quy nào.")`);
    await check('empty state, propose button and hint', `${hasButton('+ Đề xuất nội quy')}&&${panelText}.includes("Hai đứa mình")&&${panelText}.includes("chỉ có hiệu lực khi cả hai")`);

    // Propose: Minh counts as agreeing; the rule is not active yet.
    await clickText('+ Đề xuất nội quy'); await until('!!document.querySelector("dialog.rules-dialog[open]")');
    await check('form dialog is labelled and focuses the title', 'document.activeElement.name==="title"&&document.querySelector("dialog[open] h2").textContent==="Đề xuất nội quy"');
    await fill({ title: 'Nói ra khi buồn', text: 'Khi buồn vì nhau, mình nói ra trong ngày.' }); await submit();
    await until('!document.querySelector("dialog[open]")&&!!document.querySelector(".rule-card")');
    await check('pending rule shows who agreed', `${panelText}.includes("Đang chờ cả hai đồng ý")&&${panelText}.includes("Minh đã đồng ý ✓")&&${panelText}.includes("Yến chưa đồng ý")&&!${hasButton('Mình đồng ý với bản này')}`);
    await check('focus lands on the new card', 'document.activeElement===document.querySelector(".rule-card h3")');

    // Yến agrees through her own session; the panel picks it up when it comes back to the foreground.
    let [rule] = await latest();
    rule = await yenDo('agree', rule, { n: 1 });
    await refresh(); await until(`${panelText}.includes("Đang áp dụng · bản 1")`);
    await check('both agreed: active revision, no pending block', '!document.querySelector(".rule-rev.is-pending")');

    // Minh proposes a revision: bản 1 stays active.
    await clickText('Đề xuất sửa'); await until('!!document.querySelector("dialog[open] form")');
    await check('revision form is prefilled from the active wording', 'document.querySelector("dialog[open] form").elements.text.value.startsWith("Khi buồn")&&!!document.querySelector("dialog[open] form").elements.reason');
    await fill({ text: 'Bản hai của Minh.', reason: 'Rõ hơn.' }); await submit();
    await until(`${panelText}.includes("Đề xuất bản 2 của Minh")`);
    await check('active wording kept while revision waits', `${panelText}.includes("Đang áp dụng · bản 1")&&${panelText}.includes("Lý do: Rõ hơn.")&&!${hasButton('Mình đồng ý với bản này')}`);

    // Yến replaces the pending proposal; Minh agrees and it takes effect.
    [rule] = await latest();
    rule = await yenDo('revisions', rule, { title: 'Nói ra khi buồn', text: 'Bản ba của Yến.', reason: 'Gọn hơn.' });
    await refresh(); await until(`${panelText}.includes("Đề xuất bản 3 của Yến")`);
    await check('the newer proposal replaced bản 2', `!${panelText}.includes("Bản hai của Minh.")&&${hasButton('Mình đồng ý với bản này')}`);
    await clickText('Mình đồng ý với bản này');
    await until(`${panelText}.includes("Đang áp dụng · bản 3")`);
    await check('agreement announced', `document.querySelector(".rules-status").textContent.includes("Cả hai đã đồng ý")&&!document.querySelector(".rule-rev.is-pending")`);

    // History lists every revision, newest first.
    await clickText('Xem lịch sử'); await until('!!document.querySelector("dialog[open] .rules-history")');
    await check('history shows three revisions with states', '(()=>{const items=[...document.querySelectorAll("dialog[open] .rules-history li")];return items.length===3&&items[0].textContent.includes("Đang áp dụng")&&items[1].textContent.includes("Bản cũ")&&items[1].textContent.includes("Lý do: Rõ hơn.")})()');
    await ev('document.querySelector("dialog[open] .rules-icon-button").click()'); await until('!document.querySelector("dialog")');

    // 409: Yến edits while Minh is writing; Minh's draft survives and can be sent again.
    await clickText('Đề xuất sửa'); await until('!!document.querySelector("dialog[open] form")');
    await fill({ title: 'Nói ra khi buồn', text: 'Bản nháp của Minh.', reason: 'Thử.' });
    [rule] = await latest();
    rule = await yenDo('revisions', rule, { title: 'Nói ra khi buồn', text: 'Yến sửa chen.', reason: '' });
    await submit(); await until('!!document.querySelector("dialog[open] .rules-conflict:not([hidden])")');
    await check('conflict keeps the draft', 'document.querySelector("dialog[open] form").elements.text.value==="Bản nháp của Minh."&&document.querySelector("dialog[open] .rules-conflict").textContent.includes("vẫn còn nguyên")');
    await clickText('Giữ bản của mình để sửa tiếp', 'dialog[open]'); await submit();
    await until(`!document.querySelector("dialog")&&${panelText}.includes("Bản nháp của Minh.")`);
    await check('resubmitted draft is now the pending proposal', `${panelText}.includes("Đề xuất bản 5 của Minh")&&!${panelText}.includes("Yến sửa chen.")`);

    // Layout at phone and desktop widths, including the sheet.
    await viewport(390, 844); await check('390: no overflow, targets ≥ 44 px', fits);
    await clickText('Đề xuất sửa'); await until('!!document.querySelector("dialog[open] form")');
    await check('390: form opens as a bottom sheet', '(()=>{const r=document.querySelector("dialog[open]").getBoundingClientRect();return Math.abs(r.bottom-innerHeight)<2&&Math.abs(r.width-innerWidth)<2})()');
    await ev('document.querySelector("dialog[open] form button[type=button]:not([class*=icon])").click()');
    await viewport(1440, 1000); await check('1440: no overflow, targets ≥ 44 px', fits);
    await clickText('Xem lịch sử'); await until('!!document.querySelector("dialog[open]")');
    await check('1440: dialog is a centred modal', '(()=>{const r=document.querySelector("dialog[open]").getBoundingClientRect();return r.width<=580&&Math.abs(r.left+r.width/2-innerWidth/2)<2&&r.bottom<innerHeight})()');
    await ev('document.querySelector("dialog[open]").close()');

    // Archive: Minh requests, only Yến can confirm.
    await clickText('Đề nghị lưu trữ'); await until('!!document.querySelector("dialog[open]")');
    await check('request explains it stays active', 'document.querySelector("dialog[open]").textContent.includes("Nội quy vẫn áp dụng tới khi Yến xác nhận.")');
    await clickText('Gửi đề nghị', 'dialog[open]'); await until(`${panelText}.includes("Minh đề nghị lưu trữ")`);
    await check('requester can withdraw but not confirm', `${hasButton('Rút đề nghị lưu trữ')}&&!${hasButton('Xác nhận lưu trữ')}`);
    [rule] = await latest();
    await yenDo('archive-confirm', rule);
    await refresh(); await until(`${panelText}.includes("Chưa có nội quy nào.")`);
    checks++;

    // Yến requests on her rule; Minh confirms from the panel.
    let second = (await api('/api/rules', { requestId: crypto.randomUUID(), title: 'Ôm trước khi ngủ', text: 'Mỗi tối.' }, yen)).rule;
    second = await yenDo('archive-request', second);
    await refresh(); await until(`${panelText}.includes("Yến đề nghị lưu trữ")`);
    await check('partner sees confirm and keep', `${hasButton('Xác nhận lưu trữ')}&&${hasButton('Giữ lại')}&&${hasButton('Mình đồng ý với bản này')}`);
    await clickText('Xác nhận lưu trữ'); await until(`${panelText}.includes("Chưa có nội quy nào.")`);
    await check('archived rules stay in storage for members', `${(await latest()).every(item => item.archivedAt)}`);

    // Logout clears the view; cleanup is idempotent and removes the panel.
    await ev('await window.auth.logout()'); await until(`${panelText}.includes("Đăng nhập để xem nội quy.")`);
    await check('cleanup twice is safe', 'window.cleanup();window.cleanup();window.controller.abort();return !document.querySelector(".rules-panel")');
    console.log(`Rules browser checks passed: ${checks}`);
  }, undefined, { origin: fixture.origin });
} finally {
  await fixture.close();
}
