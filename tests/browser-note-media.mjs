import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';
import { mediaBytes } from './helpers/media-fixture.mjs';

const fixture=await createNotesFixture({app:true,ffmpegPath:process.env.FFMPEG_PATH || 'ffmpeg',ffprobePath:process.env.FFPROBE_PATH || 'ffprobe'});
try {await withBrowser(async(evaluate,{call})=>{
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  // Headless pages may lack window focus; emulate it so focusin activates the shared format row.
  await call('Emulation.setFocusEmulationEnabled',{enabled:true});
  const wait=expression=>evaluate(`(async()=>{let end=Date.now()+10000;while(!(${expression})){if(Date.now()>end)throw Error('Timed out: '+${JSON.stringify(expression)}+' / '+document.querySelector('.note-library .notes-media-status')?.textContent+' / '+document.querySelector('.notes-durability')?.textContent+' / '+JSON.stringify(document.querySelector('.paper-note')?.getBoundingClientRect())+' / '+document.querySelector('.note-decoration')?.innerHTML+' / '+document.querySelector('.notes-error')?.textContent+' / '+[...document.querySelectorAll('.notes-board-tab')].map(t=>t.textContent+':'+t.dataset.visibility+':'+t.getAttribute('aria-selected')).join());await new Promise(r=>setTimeout(r,30));}return true;})()`);
  await evaluate("location.hash='dashboard'");await wait("document.querySelector('.notes-dashboard')");
  assert.equal(await evaluate("document.querySelectorAll('.note-library,.note-media-add,.notes-format-row button').length"),0);
  await evaluate(`(async()=>{await (await import('/js/auth.js')).login('minhle',${JSON.stringify(fixturePasswords.minhle)});})()`);
  await wait("document.querySelector('[data-action=board-new]')");
  await evaluate("document.querySelector('[data-action=library-open]').click()");await wait("document.querySelector('.note-library')");
  assert.equal(await evaluate("document.querySelectorAll('.note-library-item').length"),0,'library is available before any board exists');
  const emptyPng=await mediaBytes();
  await evaluate(`{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob('${emptyPng.toString('base64')}'),c=>c.charCodeAt(0))],'before-board.png',{type:'image/png'}));const input=document.querySelector('.note-library input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await wait("document.querySelector('.note-media-preview img') && !document.querySelector('[data-action=media-publish]').disabled");
  await evaluate("document.querySelector('[data-action=media-discard]').click();document.querySelector('[data-action=library-close]').click()");
  // The cap covers all native queue namespaces on the device, including retained previews.
  assert.equal(await evaluate(`(async()=>{const {createNotesStorage}=await import('/js/notes/client.js'),s=createNotesStorage(),file=new Blob([new Uint8Array(10*1024*1024)]);try{for(let i=0;i<5;i++)await s.update('cap-test-'+i,()=>({queue:[{kind:'upload',file}]}));try{await s.update('cap-test-extra',()=>({queue:[{kind:'upload',file:new Blob(['x'])}]}));return 'missing-cap';}catch(e){return e.code;}}finally{for(let i=0;i<5;i++)await s.update('cap-test-'+i,()=>({queue:[]}));}})()`),'upload_quota');
  await evaluate("document.querySelector('[data-action=board-new]').click();document.querySelector('.notes-name-form input').value='Media fixture';document.querySelector('.notes-name-form').requestSubmit()");
  await wait("document.querySelector('.notes-viewport') && document.querySelector('.notes-durability').dataset.durability==='saved'");
  // Guests check the published stickers later, so this board is opened to everyone.
  await wait("document.querySelector('[data-action=board-visibility] option[value=public]')");
    await evaluate("(()=>{const s=document.querySelector('[data-action=board-visibility]');s.value='public';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await wait("document.querySelector('.notes-board-tab[aria-selected=true]')?.dataset.visibility==='public' && document.querySelector('.notes-durability').dataset.durability==='saved'");
  await evaluate("document.querySelector('[data-action=note-new]').click()");await wait("document.querySelector('.tiptap[contenteditable=true]')");
  assert.equal(await evaluate("document.querySelectorAll('.note-media-add').length"),0,'no per-note image button');
  assert.equal(await evaluate("document.querySelectorAll('.notes-format-row').length"),1,'one format row per board');
  await evaluate("document.querySelector('.tiptap').editor.view.focus()");await wait("!document.querySelector('.notes-format-row [data-format=image]').disabled");
  await evaluate("document.querySelector('.notes-format-row [data-format=image]').click()");await wait("document.querySelector('.note-asset-picker .notes-media-status')?.textContent.includes('trống')");
  assert.equal(await evaluate("document.querySelector('.note-asset-picker .notes-media-status').textContent"),'Thư viện hình đang trống. Hãy vào mục Thư viện hình ở đầu Góc ghi chép để thêm hình.');
  assert.equal(await evaluate("document.querySelectorAll('.note-asset-picker input,.note-asset-picker [data-action^=media-]').length"),0,'picker is browse-only');
  await evaluate("document.querySelector('[data-action=picker-close]').click()");await wait("!document.querySelector('.note-asset-picker')");
  await evaluate("document.querySelector('[data-action=library-open]').click()");await wait("document.querySelector('.note-library')");
  assert.equal(await evaluate("document.querySelectorAll('.note-library-item').length"),0,'shared library starts empty');
  const bytes=await mediaBytes('mp4');
  await evaluate(`{const file=new File([Uint8Array.from(atob('${bytes.toString('base64')}'),c=>c.charCodeAt(0))],'moving.mp4',{type:'video/mp4'});const transfer=new DataTransfer();transfer.items.add(file);const input=document.querySelector('.note-library input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await wait("document.querySelector('.note-media-preview video') && !document.querySelector('[data-action=media-publish]').disabled");
  assert.equal(await evaluate("(async()=>{const r=await fetch('/api/note-assets');return (await r.json()).assets.length})()"),0,'actual converted preview before publish');
  await evaluate("document.querySelector('[data-action=media-publish]').click()");await wait("document.querySelector('.note-library-item')");
  await evaluate("document.querySelector('[data-action=library-close]').click();document.querySelector('.tiptap').editor.view.focus();document.querySelector('.notes-format-row [data-format=image]').click()");await wait("document.querySelector('.note-picker-item img')");
  await evaluate("document.querySelector('[data-action=picker-insert]').click()");await wait("document.querySelector('.note-decoration') && !document.querySelector('.note-asset-picker')");
  await evaluate("window.decorationId=document.querySelector('.note-decoration').dataset.decorationId;window.noteId=document.querySelector('.paper-note').dataset.noteId;document.querySelector('[data-action=fit]').click()");
  await wait("document.querySelector('.notes-durability').dataset.durability==='saved' && document.querySelector('.note-decoration video')");
  // An inserted sticker follows its note: it rides along while the note is dragged and keeps the offset after saving.
  const follow=await evaluate("(()=>{const h=document.querySelector('.note-handle').getBoundingClientRect(),d=document.querySelector('.note-decoration'),n=document.querySelector('.paper-note');return {x:h.x+h.width/2,y:h.y+h.height/2,noteId:d.dataset.noteId===n.dataset.noteId,offset:parseFloat(d.style.left)-parseFloat(n.style.left),sticker:d.getBoundingClientRect().x,scale:n.getBoundingClientRect().width/n.offsetWidth}})()");
  assert.equal(follow.noteId,true,'Chèn hình attaches the sticker to the writing note');
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:follow.x,y:follow.y,button:'left',buttons:1});
  await new Promise(r=>setTimeout(r,250));
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:follow.x+40*follow.scale,y:follow.y,button:'left',buttons:1});
  assert.ok(Math.abs(await evaluate("document.querySelector('.note-decoration').getBoundingClientRect().x")-(follow.sticker+40*follow.scale))<2,'The sticker rides along during the note drag');
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:follow.x+40*follow.scale,y:follow.y,button:'left',buttons:0});
  await wait(`document.querySelector('.notes-durability').dataset.durability==='saved' && Math.abs(parseFloat(document.querySelector('.note-decoration').style.left)-parseFloat(document.querySelector('.paper-note').style.left)-(${follow.offset}))<0.01 && !document.querySelector('.note-decoration').style.translate`);
  // Selecting a decoration (focus or press) swaps the format row to its tools at the same height; nothing overlays the decoration.
  const rowHeight=await evaluate("document.querySelector('.notes-format-row').getBoundingClientRect().height");
  assert.equal(await evaluate("document.querySelector('.note-decoration').children.length===1&&!document.querySelector('.note-decoration button')"),true,'No handle or block on the decoration');
  await evaluate("document.querySelector('.note-decoration').focus()");await wait("!document.querySelector('.notes-format-row .notes-sticker-tools').hidden && document.querySelector('.note-decoration').classList.contains('is-selected')");
  assert.equal(await evaluate("Math.abs(document.querySelector('.notes-format-row').getBoundingClientRect().height-"+rowHeight+")<2&&getComputedStyle(document.querySelector('.notes-format-row [data-format=toggleBold]')).display==='none'"),true,'Sticker tools replace the text tools without growing the row');
  await evaluate("document.querySelector('[data-action=decoration-right]').click()");
  // New stickers land on the board near the writing note: note.x + 20 (world coordinates); → moves 10px.
  await wait("Math.abs(parseFloat(document.querySelector('.note-decoration').style.left)-(parseFloat(document.querySelector('.paper-note').style.left)+30))<0.01");
  const width=await evaluate("parseFloat(document.querySelector('.note-decoration').style.width)");
  await evaluate("document.querySelector('[data-action=decoration-bigger]').click()");
  await wait(`parseFloat(document.querySelector('.note-decoration').style.width)===${Math.round(width*1.1)}`);
  await evaluate("document.querySelector('[data-action=decoration-rotate-right]').click()");
  await wait("document.querySelector('.note-decoration').style.transform.includes('15deg')");
  await evaluate("document.querySelector('[data-action=decoration-front]').click()");await wait("document.querySelector('.note-decoration').style.zIndex==='1'");await evaluate("document.querySelector('[data-action=decoration-close]').click()");
  await wait("document.querySelector('.notes-sticker-tools').hidden && !document.querySelector('.note-decoration.is-selected')");
  // Holding the right button on a decoration moves it (not the camera). The board may re-fit after geometry edits, so measure once the camera is still.
  const settle=()=>evaluate("(async()=>{let prev='';for(let i=0;i<40;i++){const now=document.querySelector('.notes-world').style.transform;if(now===prev)return true;prev=now;await new Promise(r=>setTimeout(r,150));}return false;})()");
  // A reconnect leaves the client's leaseState 'lost' until a new lease is held; that stale state must not cancel the next drag.
  await evaluate("dispatchEvent(new Event('online'))");await wait("document.querySelector('.notes-durability').dataset.durability==='saved'");
  await settle();
  const handle=await evaluate("(()=>{const d=document.querySelector('.note-decoration').getBoundingClientRect();return {x:d.x+d.width/2,y:d.y+d.height/2,left:parseFloat(document.querySelector('.note-decoration').style.left),world:document.querySelector('.notes-world').style.transform,scale:document.querySelector('.paper-note').getBoundingClientRect().width/document.querySelector('.paper-note').offsetWidth};})()");
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:handle.x,y:handle.y,button:'right',buttons:2});
  await new Promise(r=>setTimeout(r,250));
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x+30*handle.scale,y:handle.y,button:'right',buttons:2});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:handle.x+30*handle.scale,y:handle.y,button:'right',buttons:0});
  await wait(`Math.abs(parseFloat(document.querySelector('.note-decoration').style.left)-(${handle.left+30}))<1 && document.querySelector('.notes-durability').dataset.durability==='saved'`);
  assert.equal(await evaluate("document.querySelector('.notes-world').style.transform"),handle.world,'Right-drag on a decoration does not pan the camera');
  assert.deepEqual(await evaluate("[document.querySelector('.notes-sticker-tools').hidden,!!document.querySelector('.note-decoration-inspector'),document.querySelector('.note-decoration').className]"),[false,false,'note-decoration is-editable is-selected'],'Pressing selects the decoration and shows its tools; no dialog');
  await evaluate("document.querySelector('[data-action=fit]').click()");
  await settle();
  const start=await evaluate("(()=>{const r=document.querySelector('.note-decoration').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,scale:document.querySelector('.paper-note').getBoundingClientRect().width/document.querySelector('.paper-note').offsetWidth};})()");
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:start.x,y:start.y,button:'left',buttons:1});
  await new Promise(r=>setTimeout(r,250));
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+20*start.scale,y:start.y+10*start.scale,button:'left',buttons:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.x+20*start.scale,y:start.y+10*start.scale,button:'left',buttons:0});
  await wait(`Math.abs(parseFloat(document.querySelector('.note-decoration').style.left)-(${handle.left+30+20}))<1 && document.querySelector('.notes-durability').dataset.durability==='saved'`);
  // The selected decoration shows a corner grip; dragging it resizes with the aspect ratio kept.
  await wait("document.querySelector('.note-decoration.is-selected .note-decoration-resize')");
  const grip=await evaluate("(()=>{const g=document.querySelector('.note-decoration-resize').getBoundingClientRect(),d=document.querySelector('.note-decoration');return {x:g.x+g.width/2,y:g.y+g.height/2,w:parseFloat(d.style.width),h:parseFloat(d.style.height),scale:document.querySelector('.paper-note').getBoundingClientRect().width/document.querySelector('.paper-note').offsetWidth};})()");
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:grip.x,y:grip.y,button:'left',buttons:1});
  await new Promise(r=>setTimeout(r,250));
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:grip.x+20*grip.scale,y:grip.y+20*grip.scale,button:'left',buttons:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:grip.x+20*grip.scale,y:grip.y+20*grip.scale,button:'left',buttons:0});
  const k=Math.max((grip.w+20)/grip.w,(grip.h+20)/grip.h);
  await wait(`Math.abs(parseFloat(document.querySelector('.note-decoration').style.width)-${Math.round(grip.w*k)})<1 && Math.abs(parseFloat(document.querySelector('.note-decoration').style.height)-${Math.round(grip.h*k)})<1 && document.querySelector('.notes-durability').dataset.durability==='saved'`);
  await evaluate("document.querySelector('[data-action=decoration-close]').click()");await wait("!document.querySelector('.note-decoration-resize')");
  // Stickers are board objects: drag one well past its note's edge; it stays whole and visible there after saving.
  await settle();
  const out=await evaluate("(()=>{const d=document.querySelector('.note-decoration').getBoundingClientRect(),n=document.querySelector('.paper-note').getBoundingClientRect();return {x:d.x+d.width/2,y:d.y+d.height/2,dx:n.right-d.left+40}})()");
  await call('Input.dispatchMouseEvent',{type:'mousePressed',x:out.x,y:out.y,button:'left',buttons:1});
  await new Promise(r=>setTimeout(r,250));
  for(let i=1;i<=5;i++)await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:out.x+out.dx*i/5,y:out.y,button:'left',buttons:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:out.x+out.dx,y:out.y,button:'left',buttons:0});
  await wait("document.querySelector('.notes-durability').dataset.durability==='saved' && document.querySelector('.note-decoration').getBoundingClientRect().left>document.querySelector('.paper-note').getBoundingClientRect().right");
  assert.equal(await evaluate("(()=>{const d=document.querySelector('.note-decoration'),r=d.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&d.contains(hit)&&!document.querySelector('.paper-note').contains(d)})()"),true,'Outside the note the sticker is still on top and not clipped');
  await wait("document.querySelector('.note-decoration').dataset.noteId===''");
  assert.equal(await evaluate("(async()=>{const r=await fetch('/api/boards/'+document.querySelector('[data-board-id]').dataset.boardId);return (await r.json()).board.decorations[0].noteId})()"),null,'Dropped outside every note and column, the sticker is free on the board');
  // Long text scroll belongs to the editor, while decorations stay paper-local.
  const before=await evaluate("document.querySelector('.note-decoration').getBoundingClientRect().top");
  await evaluate("{const text=document.querySelector('.note-text');text.firstElementChild?.append(document.createTextNode('Long text '.repeat(200)));text.scrollTop=200;}");
  assert.equal(await evaluate("document.querySelector('.note-decoration').getBoundingClientRect().top"),before);
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait("document.querySelector('.note-decoration img') && !document.querySelector('.note-decoration video')");
  assert.match(await evaluate("document.querySelector('.note-decoration img').src"),/\/poster$/);
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await wait("document.querySelector('.note-decoration video')");
  // An off-screen sticker pauses to its poster (each sticker is observed on its own, independent of notes).
  await evaluate("window.mediaVideo=document.querySelector('.note-decoration video');window.stickerLeft=document.querySelector('.note-decoration').style.left;document.querySelector('.note-decoration').style.left='-50000px'");await wait("mediaVideo.paused");
  await evaluate("document.querySelector('.note-decoration').style.left=stickerLeft");
  await evaluate("document.querySelector('[data-action=library-open]').click()");await wait("document.querySelector('.note-library-item')");
  await evaluate("document.querySelector('[data-action=media-rename]').click();document.querySelector('.notes-name-form input').value='Đổi tên';document.querySelector('.notes-name-form').requestSubmit()");await wait("document.querySelector('.note-library-item').textContent.includes('Đổi tên')");
  // An offline selection is a retained preview intent, never an automatic library publication.
  const png=await mediaBytes();
  await call('Network.enable');await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate(`{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob('${png.toString('base64')}'),c=>c.charCodeAt(0))],'pending.png',{type:'image/png'}));const input=document.querySelector('.note-library input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await wait("document.querySelector('.note-library .notes-media-status').textContent.includes('File chờ')");
  assert.equal(await evaluate("document.querySelector('[data-action=media-publish]').disabled"),true);
  assert.notEqual(await evaluate("document.querySelector('.notes-durability').dataset.durability"),'saved');
  await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate("dispatchEvent(new Event('online'))");await wait("document.querySelector('.note-media-preview img') && !document.querySelector('[data-action=media-publish]').disabled");
  assert.equal(await evaluate("(async()=> (await (await fetch('/api/note-assets')).json()).assets.length)()"),1);
  await call('Page.reload');await wait("document.querySelector('.tiptap[contenteditable=true]')");
  await evaluate("document.querySelector('[data-action=library-open]').click()");await wait("document.querySelector('.note-media-preview img') && !document.querySelector('[data-action=media-publish]').disabled");
  assert.equal(await evaluate("document.querySelector('.note-library input[aria-label=\"Tên tài nguyên\"]').value"),'pending.png','native IndexedDB source+receipt survives reload');
  await evaluate("window.realDateNow=Date.now;Date.now=()=>realDateNow()+300001;document.querySelector('[data-action=media-publish]').click()");await wait("document.querySelector('.note-library .notes-media-status').textContent.includes('hết hạn')");
  assert.equal(await evaluate("document.querySelector('[data-action=media-publish]').disabled"),true);
  await evaluate("Date.now=realDateNow;document.querySelector('[data-action=media-preview]').click()");await wait("document.querySelector('.note-media-preview img') && !document.querySelector('[data-action=media-publish]').disabled");
  // Once actual preview was accepted, publication can queue offline and replay for the same account.
  await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate("dispatchEvent(new Event('offline'));document.querySelector('[data-action=media-publish]').click()");await wait("document.querySelector('.note-library .notes-media-status').textContent.includes('Đã xác nhận')");
  await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate("dispatchEvent(new Event('online'))");await wait("document.querySelector('.notes-durability').dataset.durability==='saved'");
  await evaluate("document.querySelector('[data-action=library-close]').click();document.querySelector('[data-action=library-open]').click()");await wait("document.querySelectorAll('.note-library-item').length===2");
  // Fence a completed converter response held until a different account logs in.
  await evaluate("window.nativeFetch=fetch;fetch=async(...args)=>{const response=await nativeFetch(...args);if(String(args[0]).includes('/api/note-assets?preview=1'))return new Promise(resolve=>window.releasePreview=()=>resolve(response));return response;}");
  await evaluate("location.hash='garden'");await wait("!document.querySelector('.notes-dashboard')");
  await evaluate("location.hash='dashboard'");await wait("document.querySelector('.tiptap[contenteditable=true]')");
  await evaluate("document.querySelector('[data-action=library-open]').click()");await wait("document.querySelectorAll('.note-library-item').length===2");
  await evaluate(`{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob('${png.toString('base64')}'),c=>c.charCodeAt(0))],'old-account.png',{type:'image/png'}));const input=document.querySelector('.note-library input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await wait("window.releasePreview");
  await evaluate(`(async()=>{await (await import('/js/auth.js')).login('haiyen',${JSON.stringify(fixturePasswords.haiyen)});releasePreview();fetch=nativeFetch;})()`);
  await wait("document.querySelector('.tiptap[contenteditable=true]') && !document.querySelector('.note-library')");
  await evaluate("document.querySelector('[data-action=library-open]').click()");await wait("document.querySelectorAll('.note-library-item').length===2");
  assert.equal(await evaluate("document.querySelector('.note-media-preview').childElementCount"),0,'late other-account preview never enters new-account DOM');
  assert.equal(await evaluate("document.querySelector('.note-library').textContent.includes('old-account.png')"),false);
  await evaluate(`(async()=>{await (await import('/js/auth.js')).login('minhle',${JSON.stringify(fixturePasswords.minhle)});})()`);
  await wait("document.querySelector('.tiptap[contenteditable=true]') && !document.querySelector('.note-library')");
  await evaluate("document.querySelector('[data-action=library-open]').click()");await wait("document.querySelector('.note-media-preview img') && !document.querySelector('[data-action=media-publish]').disabled");
  await evaluate("document.querySelector('[data-action=media-discard]').click()");await wait("!document.querySelector('.note-media-preview img')");
  for(const [width,height] of [[320,740],[390,844],[768,1024],[1440,1000],[844,390]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth"),false,`${width}: no overflow`);
    assert.equal(await evaluate("(()=>{const row=document.querySelector('.notes-format-row');return row.scrollWidth<=row.clientWidth&&[...row.querySelectorAll('button')].every(e=>!e.getClientRects().length||e.getBoundingClientRect().width>=43&&e.getBoundingClientRect().height>=43);})()"),true,`${width}: format row wraps without scrolling`);
    assert.equal(await evaluate("[...document.querySelectorAll('.note-library button')].filter(e=>e.getClientRects().length&&(e.getBoundingClientRect().width<43||e.getBoundingClientRect().height<43)).length"),0,`${width}: touch targets`);
    if(width===390||width===1440){const screenshot=await call('Page.captureScreenshot',{format:'png'});await writeFile(`/private/tmp/task-7-${width}.png`,Buffer.from(screenshot.data,'base64'));}
  }
  await evaluate("window.assetUrl='/api/note-assets/'+document.querySelector('.note-library-item').dataset.assetId+'/file';document.querySelector('[data-action=media-remove]').click()");await wait("document.querySelectorAll('.note-library-item').length===1");
  await evaluate("(async()=>{document.querySelector('[data-action=library-close]').click();await (await import('/js/auth.js')).logout();})()");
  await wait("!document.querySelector('.notes-format-row button') && document.querySelector('.note-decoration video')");
  assert.equal(await evaluate("(async()=> (await fetch(assetUrl)).status)()"),200,'guest inserted asset survives library removal');
  assert.equal(await evaluate("(async()=> (await fetch('/api/note-assets')).status)()"),401);
  await evaluate("window.lastVideo=document.querySelector('.note-decoration video');location.hash='garden'");await wait("!document.querySelector('.notes-dashboard')");
  assert.equal(await evaluate("lastVideo.paused && !lastVideo.hasAttribute('src')"),true,'unmount stops video and drops source');
},undefined,{origin:fixture.origin});console.log('Media browser: preview, upload, decoration geometry, reduced motion, visibility, library removal, guest and cleanup passed.');}
finally{await fixture.close();}
