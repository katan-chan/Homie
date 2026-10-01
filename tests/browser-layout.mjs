import assert from 'node:assert/strict';
import fs from 'node:fs';
const targets=await(await fetch('http://127.0.0.1:9333/json/list')).json();
const ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let n=0;const pending=new Map();
ws.addEventListener('message',e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);pending.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result)}});
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++n;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value}
async function until(expression){for(let i=0;i<160;i++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out')}
let checks=0;
try {
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 for(const id of ['minhle','haiyen']){
  await call('Page.navigate',{url:'http://127.0.0.1:8000/?layout='+Date.now()+'#'+id});
  await until('!!document.querySelector(".profile-page")');
  assert.equal(await ev('document.querySelectorAll(".profile-garden canvas").length'),2,'profile needs full garden backdrop');
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
 console.log(JSON.stringify({passed:checks}));
} finally {ws.close()}
