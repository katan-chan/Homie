import assert from 'node:assert/strict';
const password = process.env.AUTH_TEST_PASSWORD;
const targets=await(await fetch('http://127.0.0.1:9333/json/list')).json();
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let serial=0;const pending=new Map();
ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result)}});
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const wrapped=expression.includes(';')?'(async()=>{'+expression+'})()':'(async()=>('+expression+'))()';const r=await call('Runtime.evaluate',{expression:wrapped,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value}
async function until(expression){for(let i=0;i<200;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out: '+expression)}
let checks=0;
async function check(name,expression){assert.equal(await ev(expression),true,name);checks++}
async function select(id){await ev('document.querySelector(".menu-toggle").click();document.querySelector("#tab-'+id+'").click();document.querySelector(".menu-close").click()')}
async function signIn(id,value){await until('!!document.querySelector(".login-form")');await ev('document.querySelector("[name=accountId]").value='+JSON.stringify(id)+';document.querySelector("[name=password]").value='+JSON.stringify(value)+';document.querySelector(".login-form").requestSubmit()')}
try {
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});await call('Network.clearBrowserCookies');
 await call('Page.navigate',{url:'http://127.0.0.1:8000/?auth-check='+Date.now()+'#garden'});await until('!!document.querySelector("#tab-garden")');
 await check('two separate public profile tabs', '!!document.querySelector("#tab-minhle")&&!!document.querySelector("#tab-haiyen")');
 assert.ok(password,'Set AUTH_TEST_PASSWORD for the local test, never commit real credentials');
 await select('minhle');await until('!!document.querySelector("[data-profile-id=minhle]")');
 await check('profile public without login','!document.querySelector(".login-form")&&document.querySelector(".profile-name").textContent.length>0');
 await check('public profile has no edit form','!document.querySelector(".profile-edit-form")');
 await select('dashboard');await until('!!document.querySelector(".login-form")');
 await check('dashboard requires login','!document.querySelector(".dashboard")&&location.hash==="#dashboard"');
 await signIn('minhle','incorrect-fixture');await until('!!document.querySelector(".login-error").textContent');
 await check('incorrect password retains login','!!document.querySelector(".login-form")&&!document.querySelector(".dashboard")');
 await signIn('minhle',password);await until('!!document.querySelector(".dashboard")');
 await check('login continues selected tab','location.hash==="#dashboard"&&document.querySelector(".account-name").textContent.includes("Minh")');
 await select('haiyen');await until('!!document.querySelector("[data-profile-id=haiyen]")');
 await check('cannot edit another profile','!document.querySelector("[data-action=edit-profile]")');
 await select('minhle');await until('!!document.querySelector("[data-action=edit-profile]")');
 await ev('window.originalProfile=await (await fetch("http://127.0.0.1:3001/api/profiles/minhle",{credentials:"include"})).json()');
 await ev('document.querySelector("[data-action=edit-profile]").click()');
 await until('!!document.querySelector(".profile-edit-form")');
 await ev('document.querySelector("#profile-bio").value="Browser verification";document.querySelector(".profile-edit-form").requestSubmit()');
 await until('document.querySelector(".profile-bio").textContent==="Browser verification"&&!document.querySelector(".profile-edit-form")');
 await check('profile text persisted','(await (await fetch("http://127.0.0.1:3001/api/profiles/minhle")).json()).profile.bio==="Browser verification"');
 await check('other account edit rejected','(await fetch("http://127.0.0.1:3001/api/profiles/haiyen",{method:"PUT",credentials:"include",headers:{"Content-Type":"application/json","X-Requested-With":"Homie"},body:JSON.stringify({displayName:"blocked",bio:""})})).status===403');
 await ev('await fetch("http://127.0.0.1:3001/api/profiles/minhle",{method:"PUT",credentials:"include",headers:{"Content-Type":"application/json","X-Requested-With":"Homie"},body:JSON.stringify({displayName:originalProfile.profile.displayName,bio:originalProfile.profile.bio})})');
 await ev('document.querySelector("[data-action=edit-profile]").click();document.querySelector("#profile-bio").value="Draft after expiry";await fetch("http://127.0.0.1:3001/api/auth/logout",{method:"POST",credentials:"include",headers:{"X-Requested-With":"Homie"}});document.querySelector(".profile-edit-form").requestSubmit()');
 await until('document.querySelector(".profile-status").textContent.includes("Phiên đã hết hạn")');
 await check('session expiry preserves draft','document.querySelector("#profile-bio")?.value==="Draft after expiry"');
 await ev('document.querySelector(".profile-actions button").click()');await signIn('minhle',password);await until('!!document.querySelector(".profile-edit-form")');
 await check('same owner re-login restores draft','document.querySelector("#profile-bio").value==="Draft after expiry"');
 await ev('document.querySelector("[data-action=cancel-edit]").click()');
 await call('Page.reload');await until('!!document.querySelector("[data-action=edit-profile]")');
 await check('session survives refresh','document.querySelector(".account-name").textContent.includes("Minh")');
 await ev('document.querySelector(".menu-toggle").click();document.querySelector(".logout-button").click()');
 await until('!document.querySelector(".logout-button")');
 await check('logout keeps profile public','!!document.querySelector("[data-profile-id=minhle]")&&!document.querySelector("[data-action=edit-profile]")');
 await ev('document.querySelector("#tab-dashboard").click();document.querySelector(".menu-close").click()');await signIn('haiyen',password);await until('!!document.querySelector(".dashboard")');
 await select('haiyen');await until('!!document.querySelector("[data-action=edit-profile]")');
 await check('second account edits own profile','!!document.querySelector("[data-profile-id=haiyen]")');
 for(const [width,height] of [[320,740],[390,844],[1440,1000]]){
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  await check('profile no overflow '+width,'document.documentElement.scrollWidth<=innerWidth');
 }
 await ev('document.querySelector(".menu-toggle").click();document.querySelector(".logout-button").click()');await until('!document.querySelector(".logout-button")');
 await ev('document.querySelector("#tab-garden").click();document.querySelector(".menu-close").click()');await until('!!document.querySelector(".garden-status[hidden]")');
 await check('garden still public','!!document.querySelector("canvas")&&!document.querySelector(".login-form")');
 console.log(JSON.stringify({passed:checks}));
} finally {ws.close()}
