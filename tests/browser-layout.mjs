import assert from 'node:assert/strict';
import fs from 'node:fs';
const targets=await(await fetch('http://127.0.0.1:9333/json/list')).json();
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let n=0;const pending=new Map();
let injectedRegistry = null;
ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result)}else if(d.method==='Fetch.requestPaused'){call('Fetch.fulfillRequest',{requestId:d.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(injectedRegistry).toString('base64')})}});
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++n;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value}
async function until(expression){for(let i=0;i<160;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out')}
let checks=0;
try {
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 for(const id of ['minhle','haiyen']){
  await call('Page.navigate',{url:'http://127.0.0.1:8000/?layout='+Date.now()+'#'+id});
  await until('!!document.querySelector(".profile-page")');
  assert.equal(await ev('document.querySelectorAll("#app-background canvas").length'),2,'shell supplies the default background');
  checks++;
  await until('!!document.querySelector(".garden-status[hidden]")');
  for(const [width,height] of [[320,740],[390,844],[768,1024],[1440,900],[2048,1236],[844,390]]){
   await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
   try { await until('document.querySelector("canvas").width===document.documentElement.clientWidth&&document.querySelector("canvas").height===innerHeight'); }
   catch(error){console.log(JSON.stringify(await ev('({viewport:[innerWidth,innerHeight,devicePixelRatio],canvases:[...document.querySelectorAll("canvas")].map(c=>({buffer:[c.width,c.height],rect:c.getBoundingClientRect().toJSON()}))})')));throw error}
   assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true,'overflow '+id+' '+width);checks++;
   assert.equal(await ev('[...document.querySelectorAll("canvas")].every(c=>{const r=c.getBoundingClientRect();return r.width===document.documentElement.clientWidth&&r.height===innerHeight&&r.x===0&&r.y===0})'),true,'canvas follows viewport '+width);checks++;
   assert.equal(await ev('(()=>{const r=document.querySelector(".account-card").getBoundingClientRect();return r.x>=0&&r.right<=innerWidth})()'),true,'card fits '+width);checks++;
   assert.equal(await ev('document.querySelectorAll("h1").length===1'),true,'single profile heading');checks++;
   if(id==='haiyen'&&[390,1440,844].includes(width)){
    await ev('document.activeElement?.blur()');
    const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/private/tmp/homie-profile-'+width+'.png',Buffer.from(shot.data,'base64'));
   }
  }
 }
 await ev('location.hash="garden"');await until('!!document.querySelector(".garden-title")&&!!document.querySelector(".garden-status[hidden]")');
 assert.equal(await ev('!document.querySelector(".profile-page")&&document.querySelectorAll("canvas").length===2'),true,'profile backdrop cleaned on route exit');checks++;
 injectedRegistry=fs.readFileSync('js/tabs.js','utf8')+'\ntabs.push({id:"future-tab",label:"Test tab",enabled:true,load:async()=>({render(container){const title=document.createElement("h1");title.textContent="New tab probe";container.append(title);return()=>title.remove()}})});';
 await call('Fetch.enable',{patterns:[{urlPattern:'*/js/tabs.js',requestStage:'Request'}]});
 await call('Page.navigate',{url:'http://127.0.0.1:8000/?new-tab='+Date.now()+'#future-tab'});
 await until('!!document.querySelector("#panel-future-tab h1")&&!!document.querySelector("#app-background .garden-status[hidden]")');
 assert.equal(await ev('document.querySelectorAll("#app-background canvas").length===2'),true,'new registry tab inherits background without declaring it');checks++;
 await ev('window.backgroundReference=document.querySelector("#app-background canvas");location.hash="dashboard"');
 await until('!!document.querySelector(".login-form")');
 assert.equal(await ev('backgroundReference===document.querySelector("#app-background canvas")'),true,'login uses the same persistent shell background');checks++;
 await ev('location.hash="haiyen"');await until('!!document.querySelector(".profile-page")');
 assert.equal(await ev('backgroundReference===document.querySelector("#app-background canvas")'),true,'profile uses the same persistent shell background');checks++;
 await call('Fetch.disable');
 await call('Page.navigate',{url:'http://127.0.0.1:8000/?layout-finished='+Date.now()+'#garden'});
 console.log(JSON.stringify({passed:checks}));
} finally {ws.close()}
