import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';
import { addDays, localDate } from '../backend/dates.js';

// Self-contained: headless Chrome mounts the real Minh Lê profile (with its PSI sheet) against a temp backend.
const fixture = await createNotesFixture();
const today = localDate(new Date().toISOString()), yesterday = addDays(today, -1);
// A sheet from yesterday, written before the backend first reads the document.
await writeFile(join(fixture.dataDir, 'psi.json'), JSON.stringify({ sheets: { [yesterday]: {
  likes: 'Mình thích sự tò mò của mình.', dislikes: 'Mình không thích lúc mình thất hứa.', weaknesses: 'Dễ cáu khi mệt', strengths: 'Kiên nhẫn', savedAt: `${yesterday}T14:10:00.000Z` } } }));

try {
  await withBrowser(async (evaluate, { call }) => {
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
    const panelText = '(document.querySelector(".psi-panel")?.textContent??"")';
    const clickText = text => ev(`[...document.querySelectorAll(".psi-panel button")].find(b=>b.textContent.startsWith(${JSON.stringify(text)})).click()`);
    const type = (key, value) => ev(`const t=document.querySelector("#psi-${key}");t.value=${JSON.stringify(value)};t.dispatchEvent(new Event("input"))`);
    const fits = '(()=>{const w=document.documentElement.clientWidth;return document.documentElement.scrollWidth<=w&&[...document.querySelectorAll(".psi-panel button,.psi-panel select")].filter(b=>b.getClientRects().length).every(b=>{const r=b.getBoundingClientRect();return r.height>=44&&r.width>=44;})})()';
    const login = id => ev(`await window.auth.login(${JSON.stringify(id)},${JSON.stringify(fixturePasswords[id] ?? '')})`);

    await call('Network.enable'); await call('Network.clearBrowserCookies');
    await viewport(1440, 1000);
    await ev(`for(const href of ["/styles.css","/styles/psi.css"]){const l=document.createElement("link");l.rel="stylesheet";l.href=href;document.head.append(l);await new Promise(r=>l.onload=r);}
      const host=document.createElement("main");host.id="host";document.body.append(host);
      window.auth=await import("/js/auth.js");const {render}=await import("/js/tabs/minhle.js");
      window.controller=new AbortController();window.cleanup=render(host,{signal:controller.signal})`);
    await until('document.querySelector(".profile-name").textContent==="Minh Lê"');
    await check('guests see the profile but no PSI sheet', '!document.querySelector(".psi-panel")');

    await login('minhle');
    await until('document.querySelectorAll(".psi-panel textarea").length===4');
    await check('owner gets four labelled boxes about himself', `["thích ở bản thân","không thích ở bản thân","điểm yếu của mình","điểm mạnh của mình"].every((label,i)=>document.querySelectorAll(".psi-chip")[i].textContent===label&&document.querySelectorAll(".psi-chip")[i].control===document.querySelectorAll(".psi-panel textarea")[i])`);
    await check('today is selected and the copy button names yesterday', `${panelText}.includes("(hôm nay)")&&[...document.querySelectorAll(".psi-panel button")].some(b=>b.textContent.startsWith("Chép từ tờ"))`);

    await clickText('Lưu tờ hôm nay');
    await check('an empty sheet is not sent', `${panelText}.includes("Viết ít nhất một ô")`);

    await clickText('Chép từ tờ');
    await check('copying fills the boxes and focuses the first', 'document.querySelector("#psi-likes").value==="Mình thích sự tò mò của mình."&&document.activeElement.id==="psi-likes"');
    const long = 'Mình thích việc mình chịu học lại từ đầu, vì mỗi lần hiểu ra một thứ mình thấy quý bản thân hơn.\n'.repeat(30);
    await type('likes', long);
    await clickText('Lưu tờ hôm nay');
    await until(`${panelText}.includes("Đã lưu lúc")`);
    await check('saved: button says save changes and keeps focus', 'document.activeElement.textContent==="Lưu thay đổi"');
    await check('long text scrolls inside its own fixed-height box', '(()=>{const t=document.querySelector("#psi-likes"),q=t.closest(".psi-quad");return t.scrollHeight>t.clientHeight+50&&q.offsetHeight===340&&document.querySelectorAll(".psi-quad").length===4})()');
    await check('2x2 grid: two columns', '(()=>{const q=[...document.querySelectorAll(".psi-quad")];return q[0].offsetTop===q[1].offsetTop&&q[2].offsetTop===q[3].offsetTop&&q[0].offsetLeft===q[2].offsetLeft&&q[1].offsetLeft>q[0].offsetLeft})()');

    // Past sheets are read-only for the owner too.
    await ev('document.querySelector(".psi-arrow").click()');
    await until(`${panelText}.includes("Tờ ngày cũ chỉ để xem lại")`);
    await check('yesterday shows read-only text, no editor', `!document.querySelector(".psi-panel textarea")&&${panelText}.includes("Mình không thích lúc mình thất hứa.")&&document.activeElement.id==="psi-day"`);
    await clickText('Hôm nay');
    await until('document.querySelectorAll(".psi-panel textarea").length===4');

    for (const [w, h] of [[320, 740], [390, 844], [768, 1024], [844, 390]]) {
      await viewport(w, h);
      await check(`fits at ${w}x${h} with 44 px controls`, `(()=>innerWidth===${w}&&${fits})()`);
    }
    await viewport(390, 844);
    await check('phone keeps 2x2 with shorter boxes', '(()=>{const q=[...document.querySelectorAll(".psi-quad")];return q[0].offsetTop===q[1].offsetTop&&q[1].offsetLeft>q[0].offsetLeft&&q[0].offsetHeight<340})()');
    await viewport(1440, 1000);

    // Yến reads the same sheet and cannot edit it.
    await ev('await window.auth.logout()');
    await until('!document.querySelector(".psi-panel")');
    await login('haiyen');
    await until(`${panelText}.includes("Minh tự viết về mình")`);
    await check('partner sees today\'s sheet read-only', `!document.querySelector(".psi-panel textarea")&&!document.querySelector(".psi-panel .primary-button")&&${panelText}.includes("chịu học lại từ đầu")`);
    await check('partner write is refused by the server', `(await fetch("/api/psi/today",{method:"PUT",credentials:"include",headers:{"Content-Type":"application/json","X-Requested-With":"Homie"},body:JSON.stringify({likes:"x"})})).status===403`);

    await check('cleanup twice is safe', 'window.cleanup();window.cleanup();window.controller.abort();return !document.querySelector(".psi-panel")');
    console.log(`PSI browser checks passed: ${checks}`);
  }, undefined, { origin: fixture.origin });
} finally {
  await fixture.close();
}
