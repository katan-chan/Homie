// Vị trí in a real browser against a temp backend (no Esri key, so no map tiles are fetched): Yến's phone data is posted
// from here; Minh sees her pin, picture, note and "x phút trước", posts and deletes his own note, reads Yến's timeline,
// names a stop and adds a place; the web has no sharing switch; leaving stops refreshing; no sideways scroll.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';
import { tabs } from '../js/tabs.js';

const MIN = 60000;
const home = { lat: 21.0285, lng: 105.8542 }, work = { lat: 21.0365, lng: 105.8342 };
const entry = tabs.find(tab => tab.id === 'location');
assert.ok(entry && entry.requiresAuth && entry.label === 'Vị trí', 'Vị trí is a members-only tab');

const fixture = await createNotesFixture();
// Yến's phone, talking to the same backend through the fixture's origin.
async function yen() {
  const headers = { Origin: fixture.origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' };
  const login = await fetch(`${fixture.origin}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ accountId: 'haiyen', password: fixturePasswords.haiyen }) });
  headers.Cookie = login.headers.get('set-cookie').split(';')[0];
  return async (method, path, body) => {
    const response = await fetch(fixture.origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(response.ok, `${method} ${path} → ${response.status}`);
  };
}

try {
  const phone = await yen();
  await phone('PUT', '/api/location/sharing', { on: true });
  for (const [place, minutes] of [[home, 60], [home, 50], [home, 40], [work, 30], [work, 20], [work, 10], [work, 3]]) {
    await phone('POST', '/api/location/point', { ...place, accuracy: 10, at: Date.now() - minutes * MIN });
  }
  await phone('PUT', '/api/location/note', { text: 'đang ăn bún chả 🍜', hours: 1 });

  await withBrowser(async (evaluate, { call }) => {
    const ev = expression => evaluate(expression.includes(';') && !expression.startsWith('(()=>') ? `(async()=>{${expression}})()` : `(async()=>(${expression}))()`);
    async function until(expression, timeout = 8000) {
      const end = Date.now() + timeout; let last;
      while (Date.now() < end) {
        try { if (await ev(expression)) return; } catch (error) { last = error; }
        await new Promise(r => setTimeout(r, 50));
      }
      throw Error(`Timed out: ${expression}${last ? ` (${last.message})` : ''}`);
    }
    let checks = 1;
    async function check(name, expression) { assert.equal(await ev(expression), true, name); checks++; }
    const viewport = (width, height) => call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const clickText = text => ev(`[...document.querySelectorAll(".location-page button")].find(b=>b.getClientRects().length&&b.textContent.trim()===${JSON.stringify(text)}).click()`).catch(error => { throw Error(`no button ${text}: ${error.message}`); });
    const text = '(document.querySelector(".location-page")?.textContent??"")';
    const type = (selector, value) => ev(`const i=document.querySelector(${JSON.stringify(selector)});i.value=${JSON.stringify(value)};i.dispatchEvent(new Event("input",{bubbles:true}))`);
    const fits = '(()=>{const w=document.documentElement.clientWidth;return document.documentElement.scrollWidth<=w&&[...document.querySelectorAll(".location-panel button,.location-panel input,.location-panel select,.location-modes button")].filter(b=>b.getClientRects().length).every(b=>{const r=b.getBoundingClientRect();return r.height>=44&&r.width>=44;})})()';

    await call('Network.enable'); await call('Network.clearBrowserCookies');
    await viewport(1440, 1000);
    await ev(`window.__errors=[];addEventListener("error",e=>__errors.push(e.message));addEventListener("unhandledrejection",e=>__errors.push(String(e.reason)));
      window.__locationCalls=0;const f=window.fetch;window.fetch=(u,o)=>{if(String(u).endsWith("/api/location"))__locationCalls++;return f(u,o);};
      for(const href of ["/styles.css","/styles/location.css"]){const l=document.createElement("link");l.rel="stylesheet";l.href=href;document.head.append(l);await new Promise(r=>l.onload=r);}
      const host=document.createElement("main");host.id="host";document.body.append(host);
      window.auth=await import("/js/auth.js");await auth.login("minhle",${JSON.stringify(fixturePasswords.minhle)});
      const {render}=await import("/js/tabs/location.js");window.controller=new AbortController();window.cleanup=render(host,{signal:controller.signal})`);

    await until('document.querySelectorAll(".location-pin").length===1');
    await check('Yến’s pin shows her note and how long ago', '(()=>{const p=document.querySelector(".location-pin");return p.textContent.includes("đang ăn bún chả 🍜")&&p.textContent.includes("3 phút trước")})()');
    await check('the pin carries her initial without a picture', 'document.querySelector(".location-pin .profile-avatar-initial")?.textContent==="H"');
    await check('Minh, who never shared, is listed without a pin', `${text}.includes("Chưa chia sẻ vị trí")`);
    await check('without a key the map says so', `${text}.includes("Chưa cài khóa bản đồ Esri")`);
    await check('the web has no sharing switch', `!${text}.includes("Bật chia sẻ")&&${text}.includes("chỉ bật được trong app Android")`);

    await type('.location-note input', 'Đi học');
    await ev('const s=document.querySelector(".location-note select");s.value="4";s.dispatchEvent(new Event("change",{bubbles:true}))');
    await clickText('Đăng');
    await until('[...document.querySelectorAll(".location-person")].some(p=>p.textContent.includes("Minh")&&p.textContent.includes("Đi học"))');
    await clickText('Xóa note');
    await until('![...document.querySelectorAll(".location-person")].some(p=>p.textContent.includes("Đi học"))');
    await check('a too long note cannot be typed', 'document.querySelector(".location-note input").maxLength===60');

    await clickText('Timeline');
    await clickText('Yến');
    await until('document.querySelectorAll(".location-stop").length===2');
    await check('stops are listed with a move between them', `${text}.includes("Chưa đặt tên")&&${text}.includes("Di chuyển")`);
    await check('a leg without a road route is drawn straight', 'document.querySelectorAll(".location-route-straight").length===1');
    await ev('[...document.querySelectorAll(".location-stop button")].find(b=>b.textContent==="Đặt tên").click()');
    await until('document.querySelector(".location-stop input")');
    await type('.location-stop input', 'Nhà');
    await clickText('Lưu');
    await until('document.querySelector(".location-stop")?.textContent.includes("Nhà")');

    await clickText('Thêm địa điểm ở đây');
    await until('document.querySelector(".location-add input")');
    await type('.location-add input', 'Quán cà phê');
    await clickText('Lưu');
    await until('fetch("/api/places",{credentials:"include"}).then(r=>r.json()).then(d=>d.places.some(p=>p.name==="Quán cà phê"))');
    checks++;

    await clickText('Bây giờ');
    await until('document.querySelectorAll(".location-pin").length===1');
    for (const [w, h] of [[320, 740], [390, 844], [768, 1024], [1440, 1000], [844, 390]]) {
      await viewport(w, h);
      await new Promise(r => setTimeout(r, 150));
      await check(`no sideways scroll and 44px targets at ${w}×${h}`, fits);
      // LOCATION_SHOTS=<dir> saves a screenshot per width for a visual check.
      if (process.env.LOCATION_SHOTS) {
        const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        await writeFile(join(process.env.LOCATION_SHOTS, `location-${w}.png`), Buffer.from(data, 'base64'));
      }
    }

    await check('leaving stops refreshing', 'window.cleanup();window.cleanup();window.controller.abort();const before=__locationCalls;document.dispatchEvent(new Event("visibilitychange"));await new Promise(r=>setTimeout(r,300));return __locationCalls===before&&!document.querySelector(".location-page")');
    assert.deepEqual(await ev('__errors'), [], 'No page errors');
    console.log(`Vị trí browser checks passed: ${checks}`);
  }, undefined, { origin: fixture.origin });
} finally {
  await fixture.close();
}
