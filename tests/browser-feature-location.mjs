// Vị trí in a real browser against a temp backend (no Esri key, so no map tiles are fetched): Yến's phone data is posted
// from here; Minh sees her pin, picture, note and "x phút trước", posts and deletes his own note, reads Yến's timeline,
// names a stop and adds a place; the web has no sharing switch; leaving stops refreshing; no sideways scroll.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';
import { tabs } from '../js/tabs.js';
import { steadyClock } from './helpers/vn-clock.mjs';

const MIN = 60000;
// The backend runs in this process; its clock (and the points below) stay clear of Vietnam midnight.
const day = new Date(steadyClock()).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
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
      const end = performance.now() + timeout; let last;
      while (performance.now() < end) {
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
    const fits = '(()=>{const w=document.documentElement.clientWidth;return document.documentElement.scrollWidth<=w&&[...document.querySelectorAll(".location-bar button,.location-bar input,.location-bar select,.leaflet-bar a")].filter(b=>b.getClientRects().length).every(b=>{const r=b.getBoundingClientRect();return r.height>=43.5&&r.width>=43.5;})})()';
    const rect = selector => `document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()`;
    // The map covers the whole window. Wider than 900 px the bar is fixed to the right edge, full height, the zoom
    // buttons left of it; narrower it is a sheet on the bottom edge with the zoom buttons above it.
    const fullMap = `(()=>{const m=${rect('.location-map')},b=${rect('.location-bar')},z=${rect('.leaflet-control-zoom')},W=innerWidth,H=innerHeight;if(!(m.left<=0&&m.top<=0&&m.right>=W&&m.bottom>=H))return false;return W>900?Math.abs(b.right-W)<=1&&b.top<=0&&b.bottom>=H&&b.width>=360&&b.width<=400&&z.right<=b.left:b.left<=0&&b.right>=W&&b.top<H&&b.bottom>=H-1&&z.bottom<=b.top})()`;
    const shown = selector => `(document.querySelector(${JSON.stringify(selector)})?.getClientRects().length>0)`;
    const onScreen = selector => `(()=>{const r=${rect(selector)};return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()`;
    const handle = 'document.querySelector(".location-handle")';
    const grip = 'document.querySelector(".location-grip")';
    // A finger on the grip moved by dy pixels, in steps, then lifted.
    async function swipe(dy) {
      const g = await ev(`(()=>{const r=${rect('.location-grip')};return [r.left+r.width/2,r.top+r.height/2]})()`);
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: g[0], y: g[1], button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 6; i++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g[0], y: g[1] + dy * i / 6, button: 'left', buttons: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g[0], y: g[1] + dy, button: 'left', buttons: 0, clickCount: 1 });
    }
    // Joins conditions into one expression (ev runs anything with a ";" not starting "(()=>" as statements).
    const all = (...parts) => `(()=>(${parts.join("&&")}))()`;
    const snapIs = name => `${grip}.getAttribute("aria-label").endsWith(${JSON.stringify({ open: 'mở hết', half: 'mở một nửa', hidden: 'ẩn' }[name])})`;

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
    await check('focus on a mode button is not clipped', '(()=>{const b=document.querySelector(".location-mode");return getComputedStyle(b.parentElement).overflow==="visible"})()');
    await check('without a key the map says so', `${text}.includes("Chưa cài khóa bản đồ Esri")`);
    await check('the web has no sharing switch', `!${text}.includes("Bật chia sẻ")&&${text}.includes("chỉ bật được trong app Android")`);
    await check('the map fills the window beside the bar on the right', fullMap);
    await check("a wide bar shows title, modes, people and note at once", all(onScreen(".location-title"), onScreen(".location-modes"), onScreen(".location-people"), onScreen(".location-note")));
    // The handle slides the bar out (only the map and the handle stay) and back.
    await ev(`${handle}.click()`);
    await until(`(()=>{const b=${rect('.location-bar')},h=${rect('.location-handle')},z=${rect('.leaflet-control-zoom')};return b.left>=innerWidth-1&&h.right<=innerWidth&&h.left>=innerWidth-49&&h.height>=88&&innerWidth-z.right<=24})()`);
    await check('the slid-out bar says how to bring it back and cannot be tabbed into', `${handle}.getAttribute("aria-expanded")==="false"&&${handle}.textContent==="Hiện"&&document.querySelector(".location-bar-content").inert`);
    await ev(`${handle}.click()`);
    await until(all(fullMap, `${handle}.textContent==="Ẩn"`));
    checks++;

    await type('.location-note input', 'Đi học');
    await ev('const s=document.querySelector(".location-note select");s.value="4";s.dispatchEvent(new Event("change",{bubbles:true}))');
    await clickText('Đăng');
    await until('[...document.querySelectorAll(".location-person")].some(p=>p.textContent.includes("Minh")&&p.textContent.includes("Đi học"))');
    await clickText('Xóa note');
    await until('![...document.querySelectorAll(".location-person")].some(p=>p.textContent.includes("Đi học"))');
    await check('a too long note cannot be typed', 'document.querySelector(".location-note input").maxLength===60');

    await clickText('Timeline');
    await clickText('Yến');
    // The browser's own clock may be on the next day; read the backend's.
    await ev(`const d=document.querySelector(".location-day input");if(d.value!==${JSON.stringify(day)}){d.value=${JSON.stringify(day)};d.dispatchEvent(new Event("change",{bubbles:true}))}`);
    await until('document.querySelectorAll(".location-stop").length===2');
    await check('the folded timeline line counts the day', `${shown('.location-stop')}&&${text}.includes("2 lần ghé · 1 lần di chuyển")`);
    await check('stops are listed with a move between them', `${text}.includes("Chưa đặt tên")&&${text}.includes("Di chuyển")`);
    await check('a leg without a road route is drawn straight', 'document.querySelectorAll(".location-route-straight").length===1');
    await ev('[...document.querySelectorAll(".location-stop button")].find(b=>b.textContent==="Đặt tên").click()');
    await until('document.querySelector(".location-stop input")');
    await type('.location-stop input', 'Nhà');
    await clickText('Lưu');
    await until('document.querySelector(".location-stop")?.textContent.includes("Nhà")');

    // Deleting a place means "never record this spot": its stop leaves the timeline.
    await ev('[...document.querySelectorAll(".location-stop")][1].querySelector("button[data-action=place-delete]").click()');
    await until('document.querySelector(".location-stop [role=alertdialog]")?.textContent.includes("Không ghi nhận chỗ này nữa?")');
    await ev('[...document.querySelectorAll(".location-stop [role=alertdialog] button")].find(b=>b.textContent==="Xóa").click()');
    await until('document.querySelectorAll(".location-stop").length===1');
    await check('the named place stays', 'document.querySelector(".location-stop").textContent.includes("Nhà")');

    await clickText('Thêm địa điểm ở đây');
    await until('document.querySelector(".location-add input")');
    await type('.location-add input', 'Quán cà phê');
    await clickText('Lưu');
    await until('fetch("/api/places",{credentials:"include"}).then(r=>r.json()).then(d=>d.places.some(p=>p.name==="Quán cà phê"))');
    checks++;

    // Coming back to the app does not wipe a name being typed in the timeline. Saving the place redraws the timeline
    // first; wait for that, or the redraw takes the name box away.
    await until('!document.querySelector(".location-add input")');
    await ev('[...document.querySelectorAll(".location-stop button")].find(b=>b.textContent==="Đổi tên").click()');
    await until('document.querySelector(".location-stop input")');
    await type('.location-stop input', 'Nhà mình');
    await ev('document.dispatchEvent(new Event("visibilitychange"))');
    await new Promise(r => setTimeout(r, 600));
    await check('a typed name survives returning to the app', 'document.querySelector(".location-stop input")?.value==="Nhà mình"');
    await clickText('Hủy');

    // Quick taps: a slow answer for Minh never replaces Yến's.
    await ev(`window.__slow=true;const f=window.fetch;window.fetch=async(u,o)=>{if(__slow&&String(u).includes("user=minhle"))await new Promise(r=>setTimeout(r,800));return f(u,o)};`);
    await clickText('Minh');
    await clickText('Yến');
    await new Promise(r => setTimeout(r, 1300));
    await check('the pressed person’s timeline is shown', '[...document.querySelectorAll(".location-who button")].find(b=>b.getAttribute("aria-pressed")==="true").textContent==="Yến"&&document.querySelectorAll(".location-stop").length===1');
    await ev('window.__slow=false');

    await clickText('Bây giờ');
    await until('document.querySelectorAll(".location-pin").length===1');
    // A failed refresh says so; the next good one clears it.
    await ev(`window.__fail=1;const g=window.fetch;window.fetch=async(u,o)=>{if(__fail&&String(u).endsWith("/api/location")){__fail--;throw new TypeError("offline")}return g(u,o)};document.dispatchEvent(new Event("visibilitychange"))`);
    await until('document.querySelector(".location-status").textContent.includes("Chưa tải được")');
    await ev('document.dispatchEvent(new Event("visibilitychange"))');
    await until('!document.querySelector(".location-status").textContent.includes("Chưa tải được")');
    // A refresh keeps keyboard focus on the button it was on.
    await ev('document.querySelector(".location-person button").focus();document.dispatchEvent(new Event("visibilitychange"))');
    await new Promise(r => setTimeout(r, 600));
    await check('focus stays on "Xem" across a refresh', 'document.activeElement?.getAttribute("aria-label")==="Xem Hải Yến trên bản đồ"');
    // Phone: no handle; the sheet starts half open (both people in view, the rest below the edge) and is swiped.
    await viewport(390, 844);
    await until(all(fullMap, snapIs("half"), `!${shown(".location-handle")}`));
    // Once it has slid into place: the two people in view, the rest below the edge.
    await until(all(onScreen(".location-chip"), `${rect(".location-panel")}.top>=innerHeight-1`, `document.querySelector(".location-panel").inert`));
    checks++;
    await swipe(160);
    await until(all(snapIs("hidden"), `${rect(".location-bar")}.top>=innerHeight-47`, fullMap));
    await check("swiped down, only the map and the grip strip are left", all(`document.querySelector(".location-half").inert`, onScreen(".location-grip")));
    await swipe(-120);
    await until(all(snapIs("half"), onScreen(".location-chip")));
    await swipe(-200);
    await until(all(snapIs("open"), onScreen(".location-note"), `!document.querySelector(".location-panel").inert`, fullMap));
    checks++;
    // Two swipes down from open: map only.
    await swipe(120); await until(snapIs('half'));
    await swipe(120); await until(snapIs('hidden'));
    // The click that ends a swipe is ignored for 300 ms, so a swipe never also counts as a tap.
    await new Promise(r => setTimeout(r, 350));
    // A tap on the grip (or Enter) steps up without a swipe.
    await ev(`${grip}.click()`);
    await until(snapIs('half'));
    await ev(`${grip}.click()`);
    await check('a tap on the grip opens the sheet', snapIs('open'));
    await ev(`${grip}.click()`);
    for (const [w, h] of [[320, 740], [390, 844], [768, 1024], [1440, 1000], [844, 390]]) {
      await viewport(w, h);
      await new Promise(r => setTimeout(r, 150));
      await check(`no sideways scroll and 44px targets at ${w}×${h}`, fits);
      await until(fullMap);
      checks++;
      // LOCATION_SHOTS=<dir> saves a screenshot per width for a visual check.
      if (process.env.LOCATION_SHOTS) {
        const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        await writeFile(join(process.env.LOCATION_SHOTS, `location-${w}.png`), Buffer.from(data, 'base64'));
      }
    }

    // The phone's switch, with a fake LocationShare plugin: notifications denied blocks it with a reason that stays.
    await ev(`window.__started=0;window.__perm={location:"granted",notifications:"denied"};window.Capacitor={isNativePlatform:()=>true,Plugins:{LocationShare:{
      status:async()=>({running:window.__started>0,permission:"granted",battery:80,charging:false,ignoringBatteryOptimizations:true,manufacturer:"Xiaomi",sdk:34}),
      requestPermissions:async()=>window.__perm,start:async()=>{window.__started++},stop:async()=>{window.__started=0},openBatterySettings:async()=>{},openAppSettings:async()=>{}}}};
      window.cleanup();window.controller.abort();window.controller=new AbortController();
      window.cleanup=(await import("/js/tabs/location.js")).render(document.querySelector("#host"),{signal:controller.signal})`);
    await until('[...document.querySelectorAll(".location-share button")].some(b=>b.textContent==="Bật chia sẻ")');
    await ev('[...document.querySelectorAll(".location-share button")].find(b=>b.textContent==="Bật chia sẻ").click()');
    await until('[...document.querySelectorAll(".location-share button")].some(b=>b.textContent==="Đồng ý, bật")');
    await ev('[...document.querySelectorAll(".location-share button")].find(b=>b.textContent==="Đồng ý, bật").click()');
    await new Promise(r => setTimeout(r, 500));
    await check('denied notifications block sharing and say why', '__started===0&&document.querySelector(".location-share p").textContent.includes("quyền thông báo")');
    await ev('window.__perm={location:"granted",notifications:"granted"};[...document.querySelectorAll(".location-share button")].find(b=>b.textContent==="Bật chia sẻ").click()');
    await until('__started===1&&document.querySelector(".location-share").textContent.includes("Đang chia sẻ")');
    await check('Poco tips after starting', 'document.querySelector(".location-share").textContent.includes("Tự khởi chạy")');

    await check('leaving stops refreshing', 'window.cleanup();window.cleanup();window.controller.abort();const before=__locationCalls;document.dispatchEvent(new Event("visibilitychange"));await new Promise(r=>setTimeout(r,300));return __locationCalls===before&&!document.querySelector(".location-page")');
    assert.deepEqual(await ev('__errors'), [], 'No page errors');
    console.log(`Vị trí browser checks passed: ${checks}`);
  }, undefined, { origin: fixture.origin });
} finally {
  await fixture.close();
}
