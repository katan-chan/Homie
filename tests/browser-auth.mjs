import assert from 'node:assert/strict';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

// Self-contained: headless Chrome + local app origin proxying a temp backend with fixture credentials.
const fixture = await createNotesFixture({ app: true });
try {
  await withBrowser(async (evaluate, { call }) => {
    const ev = expression => evaluate(expression.includes(';') ? `(async()=>{${expression}})()` : `(async()=>(${expression}))()`);
    // Node-side polling survives reloads (context destroyed) between attempts.
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
    const sidebarOpen = 'if(!document.querySelector("#sidebar").open)document.querySelector(".menu-toggle").click()';
    async function select(id) { await ev(`${sidebarOpen};document.querySelector("#tab-${id}").click();document.querySelector(".menu-close").click()`); }
    const profileLoaded = id => `document.querySelector("[data-profile-id=${id}] .profile-status")?.textContent===""`;
    async function signIn(id, value) {
      await until('!!document.querySelector(".login-form")');
      await ev(`document.querySelector("[name=accountId]").value=${JSON.stringify(id)};document.querySelector("[name=password]").value=${JSON.stringify(value)};document.querySelector(".login-form").requestSubmit()`);
    }
    async function shellSignIn(id, value) {
      await ev(`${sidebarOpen};document.querySelector("#account-controls button").click()`);
      await until('!!document.querySelector("dialog.shell-login[open] .login-form")');
      await signIn(id, value);
    }
    const put = (id, body) => `fetch("/api/profiles/${id}",{method:"PUT",credentials:"include",headers:{"Content-Type":"application/json","X-Requested-With":"Homie"},body:JSON.stringify(${body})})`;

    await call('Runtime.enable'); await call('Network.enable');
    await call('Network.setCacheDisabled', { cacheDisabled: true }); await call('Network.clearBrowserCookies');
    await ev('location.hash="garden"'); await until('!!document.querySelector("#tab-garden")');
    await check('two separate public profile tabs', '!!document.querySelector("#tab-minhle")&&!!document.querySelector("#tab-haiyen")');

    await select('minhle'); await until(profileLoaded('minhle'));
    await check('profile public without login', '!document.querySelector(".login-form")&&document.querySelector(".profile-name").textContent.length>0');
    await check('public profile has no edit form', '!document.querySelector(".profile-edit-form")&&!document.querySelector("[data-action=edit-profile]")');

    // Dashboard is public read-only for guests (js/tabs.js has no requiresAuth; dashboard.js renderActions returns early without an account).
    await select('dashboard'); await until('!!document.querySelector("#panel-dashboard:not([aria-busy]) .notes-dashboard")');
    await until('document.querySelector(".notes-catalog-status").textContent.includes("ghé lại xem")');
    await check('guest sees public dashboard without mutation controls', 'location.hash==="#dashboard"&&!document.querySelector(".login-form")&&document.querySelectorAll("[data-mutation]").length===0&&!document.querySelector("[contenteditable=true]")');
    await check('guest empty state offers sign-in', 'document.querySelectorAll(".notes-dashboard [data-action=login]").length>=1&&getComputedStyle(document.querySelector(".notes-catalog-actions .notes-login")).display==="none"');
    await ev('const b=document.querySelector(".notes-catalog-status .notes-login");b.focus();b.click()'); await until('!!document.querySelector("dialog.shell-login[open] .login-form")');
    await check('dashboard sign-in opens the shell login dialog', 'document.activeElement?.closest("dialog.shell-login")!==null');
    await ev('document.querySelector("dialog.shell-login .secondary-button").click()'); await until('!document.querySelector("dialog.shell-login")');
    await check('closing it returns focus to the sign-in button', 'document.activeElement?.dataset.action==="login"');

    await shellSignIn('minhle', 'incorrect-fixture'); await until('!!document.querySelector(".login-error").textContent');
    await check('incorrect password retains login', '!!document.querySelector("dialog.shell-login[open] .login-form")&&!document.querySelector(".account-name")&&document.querySelectorAll(".notes-dashboard [data-mutation]").length===0');
    // Login dispatches the auth change before the dialog's async close/removal, so wait for both.
    await signIn('minhle', fixturePasswords.minhle); await until('!!document.querySelector("[data-action=board-new]")&&!document.querySelector("dialog.shell-login")');
    await check('login continues selected tab and enables editing', 'location.hash==="#dashboard"&&!document.querySelector("dialog.shell-login")&&document.querySelector("#sidebar").open&&document.querySelector(".account-name").textContent.includes("Minh")&&document.querySelectorAll(".notes-dashboard [data-mutation]").length>0');

    await select('haiyen'); await until(profileLoaded('haiyen'));
    await check('cannot edit another profile', '!document.querySelector("[data-action=edit-profile]")&&!document.querySelector(".profile-actions button")');
    await select('minhle'); await until('!!document.querySelector("[data-action=edit-profile]")');
    await ev('window.originalProfile=await (await fetch("/api/profiles/minhle",{credentials:"include"})).json()');
    await ev('document.querySelector("[data-action=edit-profile]").click()');
    await until('!!document.querySelector(".profile-edit-form")');
    await ev('document.querySelector("#profile-bio").value="Browser verification";document.querySelector(".profile-edit-form").requestSubmit()');
    await until('document.querySelector(".profile-bio").textContent==="Browser verification"&&!document.querySelector(".profile-edit-form")');
    await check('profile text persisted', '(await (await fetch("/api/profiles/minhle")).json()).profile.bio==="Browser verification"');
    await check('other account edit rejected', `const r=await ${put('haiyen', '{displayName:"blocked",bio:""}')};return r.status===403&&(await r.json()).error.includes("owner")`);
    await ev(`await ${put('minhle', '{displayName:originalProfile.profile.displayName,bio:originalProfile.profile.bio}')}`);

    await ev('document.querySelector("[data-action=edit-profile]").click();document.querySelector("#profile-bio").value="Draft after expiry";await fetch("/api/auth/logout",{method:"POST",credentials:"include",headers:{"X-Requested-With":"Homie"}});document.querySelector(".profile-edit-form").requestSubmit()');
    await until('document.querySelector(".profile-status").textContent.includes("Phiên đã hết hạn")');
    await check('session expiry preserves draft', 'document.querySelector("#profile-bio")?.value==="Draft after expiry"');
    await ev('document.querySelector(".profile-actions button").click()'); await signIn('minhle', fixturePasswords.minhle);
    await until('!!document.querySelector(".profile-edit-form")');
    await check('same owner re-login restores draft', 'document.querySelector("#profile-bio").value==="Draft after expiry"');
    await ev('document.querySelector("[data-action=cancel-edit]").click()');

    await call('Page.reload'); await until('!!document.querySelector("[data-action=edit-profile]")');
    await check('session survives refresh', 'document.querySelector(".account-name").textContent.includes("Minh")');
    await ev(`${sidebarOpen};document.querySelector(".logout-button").click()`);
    await until('!document.querySelector(".logout-button")');
    await check('logout keeps profile public', '!!document.querySelector("[data-profile-id=minhle]")&&!document.querySelector("[data-action=edit-profile]")');

    await ev('document.querySelector("#tab-dashboard").click()'); await until('!!document.querySelector("#panel-dashboard:not([aria-busy]) .notes-dashboard")');
    await shellSignIn('haiyen', fixturePasswords.haiyen); await until('!!document.querySelector("[data-action=board-new]")');
    await check('second account can edit dashboard', 'location.hash==="#dashboard"&&document.querySelector(".account-name").textContent.includes("Hải Yến")');
    await select('haiyen'); await until('!!document.querySelector("[data-action=edit-profile]")');
    await check('second account edits own profile', '!!document.querySelector("[data-profile-id=haiyen]")');
    for (const [width, height] of [[320, 740], [390, 844], [1440, 1000]]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await until(`innerWidth===${width}`);
      await check('profile no overflow ' + width, 'document.documentElement.scrollWidth<=innerWidth');
    }

    await select('dashboard'); await until('!!document.querySelector("[data-action=board-new]")');
    await ev(`${sidebarOpen};document.querySelector(".logout-button").click()`); await until('!document.querySelector(".logout-button")');
    await until('document.querySelectorAll("[data-mutation]").length===0');
    await check('logout returns dashboard to public read-only', '!!document.querySelector(".notes-dashboard")&&!document.querySelector(".login-form")');
    await ev('document.querySelector("#tab-garden").click();document.querySelector(".menu-close").click()');
    await until('!!document.querySelector(".garden-title")&&!!document.querySelector("#app-background .garden-status[hidden]")');
    await check('garden still public', '!!document.querySelector("canvas")&&!document.querySelector(".login-form")');
    console.log(`PASS browser auth: ${checks} checks (public profiles/dashboard, shell login, owner-only edit, expiry draft, refresh, logout, viewports)`);
  }, undefined, { origin: fixture.origin });
} finally { await fixture.close(); }
