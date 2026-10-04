import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture } from './helpers/notes-fixture.mjs';

// Self-contained: headless Chrome + local app origin; screenshots are best-effort under os.tmpdir().
const fixture = await createNotesFixture({ app: true });
try {
  await withBrowser(async (evaluate, { call }) => {
    async function until(expression, timeout = 8000) {
      const end = Date.now() + timeout; let last;
      while (Date.now() < end) {
        try { if (await evaluate(expression)) return; } catch (error) { last = error; }
        await new Promise(r => setTimeout(r, 50));
      }
      throw Error(`Timed out: ${expression}${last ? ` (${last.message})` : ''}`);
    }
    let checks = 0;
    const check = async (name, expression) => { assert.equal(await evaluate(expression), true, name); checks++; };
    const shots = [];
    await call('Runtime.enable'); await call('Network.enable'); await call('Network.setCacheDisabled', { cacheDisabled: true });
    for (const id of ['minhle', 'haiyen']) {
      // Fresh boot on a deep link: set the hash, then reload.
      await evaluate(`location.hash=${JSON.stringify(id)}`); await call('Page.reload', { ignoreCache: true });
      await until(`!!document.querySelector("[data-profile-id=${id}]")`);
      await check('shell supplies the default background', 'document.querySelectorAll("#app-background canvas").length===2');
      await until('!!document.querySelector("#app-background .garden-status[hidden]")');
      await check('shell assets load without HTTP errors ' + id, 'performance.getEntriesByType("resource").every(e=>new URL(e.name).pathname.startsWith("/api/")||!(e.responseStatus>=400))');
      for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1440, 900], [2048, 1236], [844, 390]]) {
        await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
        try { await until('document.querySelector("canvas").width===document.documentElement.clientWidth&&document.querySelector("canvas").height===innerHeight'); }
        catch (error) { console.log(JSON.stringify(await evaluate('({viewport:[innerWidth,innerHeight,devicePixelRatio],canvases:[...document.querySelectorAll("canvas")].map(c=>({buffer:[c.width,c.height],rect:c.getBoundingClientRect().toJSON()}))})'))); throw error; }
        await check('overflow ' + id + ' ' + width, 'document.documentElement.scrollWidth<=innerWidth');
        await check('canvas follows viewport ' + width, '[...document.querySelectorAll("canvas")].every(c=>{const r=c.getBoundingClientRect();return r.width===document.documentElement.clientWidth&&r.height===innerHeight&&r.x===0&&r.y===0})');
        await check('card fits ' + width, '(()=>{const r=document.querySelector(".account-card").getBoundingClientRect();return r.x>=0&&r.right<=innerWidth})()');
        await check('single profile heading', 'document.querySelectorAll("h1").length===1');
        if (id === 'haiyen' && [390, 1440, 844].includes(width)) {
          await evaluate('document.activeElement?.blur()');
          const shot = await call('Page.captureScreenshot', { format: 'png' });
          const file = join(tmpdir(), `homie-profile-${width}.png`);
          try { await writeFile(file, Buffer.from(shot.data, 'base64')); shots.push(file); } catch { /* Screenshots are optional. */ }
        }
      }
    }
    await evaluate('location.hash="garden"');
    await until('!!document.querySelector(".garden-title")&&!!document.querySelector(".garden-status[hidden]")');
    await check('profile backdrop cleaned on route exit', '!document.querySelector(".profile-page")&&document.querySelectorAll("canvas").length===2');

    // A tab added to the live registry renders through the router without declaring a background.
    // ponytail: registry mutated after boot (withBrowser exposes no CDP events for Fetch interception).
    await evaluate('import("/js/tabs.js").then(({tabs})=>{tabs.push({id:"future-tab",label:"Test tab",enabled:true,load:async()=>({render(container){const title=document.createElement("h1");title.textContent="New tab probe";container.append(title);return()=>title.remove()}})});window.backgroundReference=document.querySelector("#app-background canvas");location.hash="future-tab"})');
    await until('!!document.querySelector("#panel-future-tab h1")&&!!document.querySelector("#app-background .garden-status[hidden]")');
    await check('new registry tab inherits background without declaring it', 'document.querySelectorAll("#app-background canvas").length===2&&backgroundReference===document.querySelector("#app-background canvas")&&document.querySelector(".garden-page").getAttribute("aria-label")==="Khung cảnh vườn hoa"');
    await evaluate('location.hash="dashboard"');
    await until('!!document.querySelector("#panel-dashboard:not([aria-busy]) .notes-dashboard")');
    await check('public dashboard uses the same persistent shell background', 'backgroundReference===document.querySelector("#app-background canvas")');
    await evaluate('document.querySelector(".menu-toggle").click();document.querySelector("#account-controls button").click()');
    await until('!!document.querySelector("dialog.shell-login[open] .login-form")');
    await check('login uses the same persistent shell background', 'backgroundReference===document.querySelector("#app-background canvas")&&document.querySelectorAll("#app-background canvas").length===2');
    await evaluate('document.querySelector("dialog.shell-login").close();document.querySelector("#sidebar").close();location.hash="haiyen"');
    await until('!!document.querySelector(".profile-page")');
    await check('profile uses the same persistent shell background', 'backgroundReference===document.querySelector("#app-background canvas")');
    console.log(`PASS browser layout: ${checks} checks (profiles x6 viewports, canvas sizing, route cleanup, registry background inheritance)${shots.length ? `; screenshots: ${shots.join(', ')}` : ''}`);
  }, undefined, { origin: fixture.origin });
} finally { await fixture.close(); }
