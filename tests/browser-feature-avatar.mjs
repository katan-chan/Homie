// Ảnh đại diện in a real browser against a temp backend: guests see the initial, the owner picks a picture, cuts it,
// saves it and keeps it across a text edit; an unsupported file is refused; leaving mid-cut sends nothing; the other
// member only sees it; deleting returns to the initial; phone widths do not scroll sideways.
import assert from 'node:assert/strict';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

const fixture = await createNotesFixture();
try {
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
    let checks = 0;
    async function check(name, expression) { assert.equal(await ev(expression), true, name); checks++; }
    const viewport = (width, height) => call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const clickText = text => ev(`[...document.querySelectorAll(".profile-page button")].find(b=>b.getClientRects().length&&b.textContent.trim()===${JSON.stringify(text)}).click()`);
    const login = id => ev(`await window.auth.logout();await window.auth.login(${JSON.stringify(id)},${JSON.stringify(fixturePasswords[id])})`);
    const mount = () => ev(`window.cleanup?.();window.controller?.abort();window.controller=new AbortController();
      window.cleanup=window.tab.render(document.querySelector("#host"),{signal:controller.signal})`);
    // A picture as a File, put into the avatar file input.
    const pick = (type = 'image/png') => ev(`const c=document.createElement("canvas");c.width=900;c.height=600;const x=c.getContext("2d");
      x.fillStyle="#985a74";x.fillRect(0,0,900,600);x.fillStyle="#fff";x.fillRect(300,150,300,300);
      const blob=await new Promise(r=>c.toBlob(r,"image/png"));const dt=new DataTransfer();dt.items.add(new File([blob],"a.png",{type:${JSON.stringify(type)}}));
      const input=document.querySelector(".avatar-editor input[type=file]");input.files=dt.files;input.dispatchEvent(new Event("change"))`);
    const status = '(document.querySelector(".avatar-status")?.textContent??"")';
    const fits = '(()=>{const w=document.documentElement.clientWidth;return document.documentElement.scrollWidth<=w&&[...document.querySelectorAll(".profile-actions button,.profile-avatar-edit button,.profile-avatar-edit input[type=range],.profile-edit-form button")].filter(b=>b.getClientRects().length).every(b=>{const r=b.getBoundingClientRect();return r.height>=44&&r.width>=44;})})()';

    await call('Network.enable'); await call('Network.clearBrowserCookies');
    await viewport(1440, 1000);
    await ev(`window.__errors=[];addEventListener("error",e=>__errors.push(e.message));addEventListener("unhandledrejection",e=>__errors.push(String(e.reason)));
      window.__puts=0;const f=window.fetch;window.fetch=(u,o)=>{if(String(u).includes("/avatar")&&o?.method==="PUT")__puts++;return f(u,o);};
      for(const href of ["/styles.css"]){const l=document.createElement("link");l.rel="stylesheet";l.href=href;document.head.append(l);await new Promise(r=>l.onload=r);}
      const host=document.createElement("main");host.id="host";document.body.append(host);
      window.auth=await import("/js/auth.js");window.tab=await import("/js/tabs/minhle.js")`);
    await mount();
    await until('document.querySelector(".profile-name").textContent==="Minh Lê"');
    await check('guests see the initial and no change button', 'document.querySelector(".profile-avatar-initial")?.textContent==="M"&&!document.querySelector(".avatar-editor")');

    await login('minhle');
    await until('[...document.querySelectorAll(".profile-actions button")].some(b=>b.textContent==="Edit")');
    await clickText('Edit');
    await until('document.querySelector(".avatar-editor")');
    await check('editor offers a change button and no delete without a picture', `[...document.querySelectorAll(".avatar-editor button")].map(b=>b.textContent).join("|")==="Đổi ảnh"`);

    await pick('image/heic');
    await until(`${status}==="Chỉ nhận ảnh JPG, PNG hoặc WebP."`);
    await check('unsupported file opens no cutter', '!document.querySelector(".avatar-crop")');

    await pick();
    await until('document.querySelector(".avatar-crop img")?.complete');
    await check('zoom slider is labelled', 'document.querySelector(".avatar-crop input[type=range]").getAttribute("aria-label")==="Phóng to"');
    await check('arrow keys move the picture', `const frame=document.querySelector(".avatar-crop-frame"),img=frame.querySelector("img"),before=img.style.transform;
      const range=document.querySelector(".avatar-crop input[type=range]");range.value="2";range.dispatchEvent(new Event("input",{bubbles:true}));
      const zoomed=img.style.transform;frame.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}));
      return zoomed!==before&&img.style.transform!==zoomed`);
    await clickText('Lưu ảnh');
    await until(`${status}==="Đã lưu ảnh."`);
    await until('(()=>{const i=document.querySelector("img.profile-avatar");return i&&i.src.includes("?v=1")&&i.complete&&i.naturalWidth===512})()');
    await check('cutter closes after saving', '!document.querySelector(".avatar-crop")');
    await check('the image has a name', 'document.querySelector("img.profile-avatar").alt==="Ảnh đại diện của Minh Lê"');

    await ev('const f=document.querySelector(".profile-edit-form");f.elements.bio.value="Thích trà";f.requestSubmit()');
    await until('document.querySelector(".profile-bio").textContent==="Thích trà"');
    await check('a text edit keeps the picture', 'document.querySelector("img.profile-avatar").src.includes("?v=1")');

    // Leaving the page in the middle of a cut sends nothing and leaves nothing behind.
    await clickText('Edit');
    await until('document.querySelector(".avatar-editor")');
    await pick();
    await until('document.querySelector(".avatar-crop")');
    const puts = await ev('__puts');
    await ev('window.cleanup();window.controller.abort()');
    await new Promise(r => setTimeout(r, 300));
    await check('nothing sent after leaving', `__puts===${puts}&&!document.querySelector(".avatar-crop")`);
    await mount();
    await until('document.querySelector("img.profile-avatar")');
    await check('coming back shows no cutter', '!document.querySelector(".avatar-crop")');

    await login('haiyen');
    await mount();
    await until('document.querySelector("img.profile-avatar")?.complete');
    await check('the other member sees the picture but cannot change it', '![...document.querySelectorAll(".profile-actions button")].some(b=>b.textContent==="Edit")&&!document.querySelector(".avatar-editor")');

    await login('minhle');
    await mount();
    await until('[...document.querySelectorAll(".profile-actions button")].some(b=>b.textContent==="Edit")');
    await clickText('Edit');
    await until('[...document.querySelectorAll(".avatar-editor button")].some(b=>b.textContent==="Xóa ảnh")');
    await clickText('Xóa ảnh');
    await until('document.querySelector(".avatar-editor [role=alertdialog]")');
    await check('confirm asks plainly', 'document.querySelector(".avatar-editor [role=alertdialog]").textContent.includes("Xóa ảnh đại diện?")');
    await clickText('Xóa');
    await until('document.querySelector(".profile-avatar-initial")?.textContent==="M"');
    await check('picture gone after delete', '!document.querySelector("img.profile-avatar")');

    for (const [w, h] of [[320, 740], [390, 844], [768, 1024], [844, 390]]) {
      await viewport(w, h);
      await pick();
      await until('document.querySelector(".avatar-crop img")?.complete');
      await check(`no sideways scroll and 44px targets at ${w}×${h}`, fits);
      await clickText('Hủy');
      await until('!document.querySelector(".avatar-crop")');
    }

    await check('cleanup twice is safe', 'window.cleanup();window.cleanup();window.controller.abort();return !document.querySelector(".profile-page")');
    assert.deepEqual(await ev('__errors'), [], 'No page errors');
    console.log(`Ảnh đại diện browser checks passed: ${checks + 1}`);
  }, undefined, { origin: fixture.origin });
} finally {
  await fixture.close();
}
