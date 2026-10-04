import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

const fixture = await createNotesFixture({ app: true });
try {
  await withBrowser(async (evaluate, { call }) => {
    const wait = expression => evaluate(`(async()=>{const end=Date.now()+7000;while(!(${expression})){if(Date.now()>end)throw Error('Timed out: '+${JSON.stringify(expression)}+' / '+document.querySelector('.notes-error')?.textContent+' / '+document.querySelector('.notes-durability')?.textContent);await new Promise(r=>setTimeout(r,30));}return true;})()`);
    await evaluate("location.hash='dashboard'");
    await wait("document.querySelector('#panel-dashboard:not([aria-busy])')");
    assert.equal(await evaluate("!!document.querySelector('.notes-dashboard')"), true, 'Guest opens public board dashboard');
    assert.equal(await evaluate("document.querySelectorAll('[data-mutation]').length"), 0);
    await evaluate("document.querySelector('.menu-toggle').click();document.querySelector('#account-controls button').click()");
    await wait("document.querySelector('#login-account')");
    await evaluate(`document.querySelector('#login-account').value='minhle';document.querySelector('#login-password').value=${JSON.stringify(fixturePasswords.minhle)};document.querySelector('.login-form').requestSubmit()`);
    await wait("document.querySelector('[data-action=board-new]')");
    assert.equal(await evaluate("document.querySelector('#sidebar').open"),true,'Login keeps sidebar open');
    // Board creation lives in a "+" after the tablist, shown even before any board exists; the header has no create button.
    assert.deepEqual(await evaluate("(()=>{const plus=document.querySelector('[data-action=board-new]');return{tabs:document.querySelectorAll('.notes-board-tab').length,label:plus.getAttribute('aria-label'),text:plus.textContent,role:plus.getAttribute('role'),inStrip:plus.parentElement.classList.contains('notes-tab-strip'),last:plus===plus.parentElement.lastElementChild,inTablist:!!plus.closest('[role=tablist]'),header:[...document.querySelectorAll('.notes-heading button')].some(b=>b.textContent.includes('Bảng mới')||b.dataset.action==='board-new')}})()"),{tabs:0,label:'Tạo bảng mới',text:'+',role:null,inStrip:true,last:true,inTablist:false,header:false});
    // With no boards the frame is one big "+" and the tab "+" hides; the big one opens the same name dialog.
    await wait("document.querySelector('.notes-catalog-status [data-action=board-new-empty]')");
    assert.deepEqual(await evaluate("[getComputedStyle(document.querySelector('.notes-tab-new')).display,getComputedStyle(document.querySelector('.notes-empty-create')).display,document.querySelector('.notes-empty-create').getAttribute('aria-label')]"),['none','flex','Tạo bảng mới'],'Empty state swaps the tab + for the big +');
    await evaluate("document.querySelector('.menu-close').click();document.querySelector('[data-action=board-new-empty]').click()");
    await wait("document.querySelector('.notes-name-form')");
    await evaluate("document.querySelector('.notes-name-form input').value='Những ngày bình yên';document.querySelector('.notes-name-form').requestSubmit()");
    await wait("document.querySelector('.notes-viewport') && document.querySelector('.notes-durability').dataset.durability==='saved'");
    assert.equal(await evaluate("document.querySelectorAll('.paper-note').length"),0,'New boards are empty');
    await evaluate("window.boardId=document.querySelector('[data-board-id]').dataset.boardId;document.querySelector('[data-action=note-new]').click()");
    await wait("document.querySelector('.paper-note')");
    assert.equal(await evaluate("document.querySelector('.note-author').textContent"),'Minh Lê');
    assert.deepEqual(await evaluate("[document.querySelectorAll('.notes-board-tab').length,document.querySelector('.notes-board-tab').getAttribute('aria-selected'),document.querySelector('.notes-board-tab').dataset.boardTab===boardId]"),[1,'true',true],'The + tab creates and selects a board');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.notes-tab-new')).display!=='none'&&!document.querySelector('.notes-empty-create')"),true,'Once a board exists the tab + returns and the big + is gone');
    assert.deepEqual(await evaluate("[parseFloat(document.querySelector('.paper-note').style.width),parseFloat(document.querySelector('.paper-note').style.height)]"),[360,320],'New notes are 360x320');
    // Clicking empty note body (well below the text) starts editing, caret at the end.
    await wait("document.querySelector('.paper-note .note-text[data-editor-state=ready]')");
    const blank=await evaluate("(()=>{document.querySelector('.paper-note .note-text').scrollIntoView({block:'center'});const r=document.querySelector('.paper-note .note-text').getBoundingClientRect(),t=document.querySelector('.paper-note .tiptap').getBoundingClientRect();const x=r.left+r.width/2,y=r.bottom-20;return {x,y,below:y>t.bottom,hit:document.elementFromPoint(x,y)?.className}})()");
    assert.deepEqual([blank.below,blank.hit],[true,'note-text'],'Click target is the empty note body');
    for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,x:blank.x,y:blank.y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});
    await wait("document.activeElement?.classList.contains('tiptap')&&document.activeElement.closest('.paper-note')");
    await call('Input.insertText',{text:'Chạm là viết'});
    await wait("document.querySelector('.paper-note .tiptap').textContent.includes('Chạm là viết')");
    // Content centre within 3px of the viewport centre, measured on rendered rects.
    const centred=`(root=>{const v=root.querySelector('.notes-viewport').getBoundingClientRect(),r=[...root.querySelectorAll('.paper-note,.paper-column')].map(e=>e.getBoundingClientRect()),x=(Math.min(...r.map(b=>b.left))+Math.max(...r.map(b=>b.right)))/2,y=(Math.min(...r.map(b=>b.top))+Math.max(...r.map(b=>b.bottom)))/2;return Math.abs(x-(v.left+v.width/2))<3&&Math.abs(y-(v.top+v.height/2))<3;})`;
    await wait(`${centred}(document)`);
    await evaluate("document.querySelector('[data-action=column-new]').click();document.querySelector('.notes-name-form input').value='Kỷ niệm';document.querySelector('.notes-name-form').requestSubmit()");
    await wait("document.querySelector('.paper-column')");
    await evaluate("document.querySelector('[data-action=zoom-out]').click();document.querySelector('[data-action=fit]').click()");
    assert.equal(await evaluate(`${centred}(document)`),true,'Fit centres the content bounding box');
    const ids=await evaluate("({board:boardId,note:document.querySelector('.paper-note').dataset.noteId,column:document.querySelector('.paper-column').dataset.columnId})");
    await evaluate("document.querySelector('.note-handle').click()");
    await wait("document.querySelector('[data-action=object-column]')");
    await evaluate(`const select=document.querySelector('[data-action=object-column]');select.value='${ids.column}';select.dispatchEvent(new Event('change',{bubbles:true}))`);
    await wait(`document.querySelector('.paper-note').dataset.columnId==='${ids.column}'`);
    const before=await evaluate("({x:parseFloat(document.querySelector('.paper-note').style.left),y:parseFloat(document.querySelector('.paper-note').style.top)})");
    await evaluate("document.querySelector('.column-handle').click();document.querySelector('[data-action=move-right]').click()");
    await wait(`parseFloat(document.querySelector('.paper-note').style.left)===${before.x+10}`);
    assert.equal(await evaluate("parseFloat(document.querySelector('.paper-note').style.top)"),before.y);
    // Focus remains on keyed controls across state updates and controls work without dragging.
    await evaluate("document.querySelector('.note-handle').focus();document.querySelector('.note-handle').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
    await wait(`Math.abs(parseFloat(document.querySelector('.paper-note').style.top)-(${before.y+10}))<.01`);
    assert.equal(await evaluate("document.activeElement.classList.contains('note-handle')"),true);
    await evaluate("{const width=document.querySelector('[name=width]');width.value='10';width.dispatchEvent(new Event('change',{bubbles:true}));}");
    await wait("parseFloat(document.querySelector('.paper-note').style.width)===180");
    await evaluate("{const width=document.querySelector('[name=width]');width.value='260';width.dispatchEvent(new Event('change',{bubbles:true}));}");
    await wait("parseFloat(document.querySelector('.paper-note').style.width)===260 && document.querySelector('.notes-durability').dataset.durability==='saved'");
    assert.equal(await evaluate("document.querySelector('.notes-board').dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))"),false,'Save shortcut prevents browser Save Page');
    for(const [width,height] of [[320,740],[390,844],[768,1024],[1440,1000],[844,390]]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await evaluate('scrollTo(0,0)');
      const layout=await evaluate(`({fitBottom:document.querySelector('[data-action=fit]').getBoundingClientRect().bottom,overflow:document.documentElement.scrollWidth>innerWidth,verticalScroll:document.documentElement.scrollHeight-innerHeight,dashboardOverflow:[...document.querySelectorAll('.notes-dashboard,.notes-dashboard *')].filter(e=>e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflowX!=='hidden'&&!e.closest('.notes-viewport')).map(e=>e.className),viewport:document.querySelector('.notes-viewport').getBoundingClientRect().width,small:[...document.querySelectorAll('.notes-dashboard button')].filter(e=>!e.closest('.notes-world')&&e.getClientRects().length&&e.getBoundingClientRect().width<43).map(e=>e.className+':'+e.dataset.action)})`);
      if(width===390 || width===1440) { const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/task-5-${width}.png`,Buffer.from(screenshot.data,'base64')); }
      assert.equal(layout.overflow,false,`${width}: no page overflow`);if(width>600&&height>500)assert.ok(layout.verticalScroll<=1,`${width}: desktop/tablet dashboard fits the screen without a vertical page scrollbar (${layout.verticalScroll}px)`);assert.deepEqual(layout.dashboardOverflow,[],`${width}: no horizontal scroller in the dashboard`);assert.ok(layout.viewport>200);assert.deepEqual(layout.small,[],`${width}: 44px targets outside the zoomable world`);if(width<=390 || height<500)assert.ok(layout.fitBottom<=height,`${width}: camera/fit controls visible without page scrolling`);
    }
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    // Board switching is local to the dashboard, and renamed/trash catalog entries stay live.
    await evaluate("document.querySelector('[data-action=board-new]').click();document.querySelector('.notes-name-form input').value='Bảng thứ hai';document.querySelector('.notes-name-form').requestSubmit()");
    await wait("document.querySelectorAll('.notes-board-tab').length===2 && document.querySelector('.notes-durability')?.dataset.durability==='saved'");
    assert.equal(await evaluate("document.querySelectorAll('.paper-note').length"),0);
    // Arrow keys move only between board tabs; the + is not part of the tab set.
    assert.deepEqual(await evaluate("(()=>{const t=[...document.querySelectorAll('.notes-board-tab')],key=k=>{document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true}));return document.activeElement.dataset.boardTab;};t[0].focus();return[key('ArrowRight')===t[1].dataset.boardTab,key('ArrowRight')===t[0].dataset.boardTab,key('End')===t[1].dataset.boardTab];})()"),[true,true,true]);
    await wait("document.querySelector('.notes-durability')?.dataset.durability==='saved'");
    const secondBoard=await evaluate("document.querySelector('[data-board-id]').dataset.boardId");
    await evaluate("document.querySelector('[data-action=board-rename]').click();document.querySelector('.notes-name-form input').value='Bảng đổi tên';document.querySelector('.notes-name-form').requestSubmit()");
    await wait(`document.querySelector('[data-board-tab="${secondBoard}"]').textContent==='Bảng đổi tên'`);
    await evaluate("document.querySelector('[data-action=board-trash]').click()");
    await wait(`!document.querySelector('[data-board-tab="${secondBoard}"]') && document.querySelector('[data-board-id]')?.dataset.boardId==='${ids.board}'`);
    await evaluate("document.querySelector('[data-action=boards-trash]').click()");
    await wait("document.querySelector('.notes-board-trash [data-action=trash-open]')");
    await evaluate("document.querySelector('.notes-board-trash [data-action=trash-open]').click()");
    await wait(`document.querySelector('[data-board-id]')?.dataset.boardId==='${secondBoard}' && document.querySelector('.notes-durability').dataset.durability==='saved'`);
    await evaluate("document.querySelector('[data-action=trash]').click();document.querySelector('.notes-trash [data-action=restore]').click()");
    await wait(`document.querySelector('[data-board-tab="${secondBoard}"]') && document.querySelector('.notes-durability').dataset.durability==='saved'`);
    await evaluate("document.querySelector('.notes-trash [data-action=close]').click()");
    await evaluate(`document.querySelector('[data-board-tab="${ids.board}"]').click()`);
    await wait("document.querySelector('.paper-note')");
    assert.equal(await evaluate("location.hash"),'#dashboard');
    await evaluate("document.querySelector('.paper-note .note-handle').click();document.querySelector('[data-action=object-trash]').click()");
    await wait("!document.querySelector('.paper-note')");
    await evaluate("document.querySelector('[data-action=trash]').click()");
    await wait("document.querySelector('.notes-trash [data-action=restore]')");
    await evaluate("document.querySelector('.notes-trash [data-action=restore]').click()");
    await wait("document.querySelector('.paper-note') && document.querySelector('.notes-durability').dataset.durability==='saved'");
    await evaluate("document.querySelector('.notes-trash [data-action=close]').click()");
    // A restored child stays hidden until its independently deleted parent is restored.
    await evaluate("document.querySelector('.note-handle').click();document.querySelector('[data-action=object-trash]').click()");
    await wait("!document.querySelector('.paper-note') && document.querySelector('.notes-durability').dataset.durability==='saved'");
    await evaluate("document.querySelector('.column-handle').click();document.querySelector('[data-action=object-trash]').click()");
    await wait("!document.querySelector('.paper-column') && document.querySelector('.notes-durability').dataset.durability==='saved'");
    await evaluate("document.querySelector('[data-action=trash]').click();[...document.querySelectorAll('.notes-trash-row')].find(r=>r.textContent.includes('Ghi chú')).querySelector('button').click()");
    await wait("document.querySelector('.notes-durability').dataset.durability==='saved' && document.querySelectorAll('.notes-trash-row').length===1");
    assert.equal(await evaluate("document.querySelectorAll('.paper-note').length"),0,'Restoring a child never implicitly restores its parent');
    await evaluate("document.querySelector('.notes-trash-row button').click()");
    await wait("document.querySelector('.paper-note') && document.querySelector('.paper-column') && document.querySelector('.notes-durability').dataset.durability==='saved'");
    await evaluate("document.querySelector('.notes-trash [data-action=close]').click()");
    await evaluate("document.querySelector('.menu-toggle').click();document.querySelector('#tab-garden').click()");
    await wait("document.body.dataset.tab==='garden'");
    assert.equal(await evaluate("document.querySelector('#sidebar').open"),true);
    await evaluate("history.back()");await wait("document.querySelector('.notes-viewport')");
    assert.equal(await evaluate("document.querySelector('[data-board-id]').dataset.boardId"),ids.board);
    await evaluate("history.forward()");await wait("document.body.dataset.tab==='garden'");
    await evaluate("history.back()");await wait("document.querySelector('.notes-viewport')");
    await evaluate("document.querySelector('#tab-dashboard').focus();document.querySelector('#tab-dashboard').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))");
    assert.equal(await evaluate("document.activeElement.id"),'tab-haiyen');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#sidebar')).backdropFilter"),'none','Sidebar does not blur the garden');
    await evaluate("document.querySelector('#tab-dashboard').click()");await wait("document.querySelector('.notes-viewport')");
    await evaluate("document.querySelector('.logout-button').click()");
    await wait("document.querySelector('.notes-viewport') && !document.querySelector('[data-mutation]')");
    const initialCamera=await evaluate("document.querySelector('.notes-world').style.transform");
    await evaluate("document.querySelector('.menu-close').click();document.querySelector('[data-action=zoom-in]').click()");
    assert.notEqual(await evaluate("document.querySelector('.notes-world').style.transform"),initialCamera,'Guests can use camera');
    assert.equal(await evaluate("document.querySelectorAll('[contenteditable=true]').length"),0);
    const guestCamera=await evaluate("document.querySelector('.notes-world').style.transform");
    await evaluate(`document.querySelector('[data-board-tab="${secondBoard}"]').click()`);await wait(`document.querySelector('[data-board-id]')?.dataset.boardId==='${secondBoard}'`);
    assert.equal(await evaluate("document.querySelectorAll('[data-mutation]').length"),0,'Guests switch boards without mutation controls');
    await evaluate(`document.querySelector('[data-board-tab="${ids.board}"]').click()`);await wait("document.querySelector('.paper-note')");
    assert.equal(await evaluate("document.querySelector('.notes-world').style.transform"),guestCamera,'Device camera is remembered per board');
    const fallbackId=await evaluate("document.querySelector('.notes-board-tab').dataset.boardTab");
    await evaluate("localStorage.setItem('homie-notes:last-board',JSON.stringify('missing-board'));location.hash='garden'");await wait("document.body.dataset.tab==='garden'");
    await evaluate("location.hash='dashboard'");await wait("document.querySelector('.notes-viewport')");
    assert.equal(await evaluate("document.querySelector('[data-board-id]').dataset.boardId"),fallbackId,'Missing remembered board falls back to the active catalog');
    // Isolated mount uses the real client/server with editor/media boundaries only injected.
    await evaluate(`(async()=>{
      await import('/js/auth.js').then(m=>m.login('haiyen',${JSON.stringify(fixturePasswords.haiyen)}));
      const {openBoardClient}=await import('/js/notes/client.js');const {mountBoard}=await import('/js/notes/board.js');
      window.testClient=await openBoardClient({boardId:'${ids.board}',accountId:'haiyen'});
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('connect timeout')),5000);const stop=testClient.subscribe(s=>{if(s.connection==='online' && s.snapshot?.notes.some(n=>!n.deletedAt)){clearTimeout(timer);queueMicrotask(stop);resolve();}})});
      location.hash='garden';await new Promise(r=>setTimeout(r,100));
      window.mountAbort=new AbortController();window.mountCounts={editor:0,media:0,cleaned:0};
      const host=document.createElement('main');host.id='board-test-host';host.style.cssText='position:relative;z-index:9;margin:100px 20px 0';document.body.append(host);
      window.cleanupBoard=mountBoard(host,{client:testClient,signal:mountAbort.signal,
        mountEditor:(el)=>{mountCounts.editor++;el.textContent='Nội dung có thể cuộn\\n'.repeat(80);el.setAttribute('contenteditable','true');return()=>{mountCounts.cleaned++;el.replaceChildren();}},
        mountMedia:()=>{mountCounts.media++;return()=>{mountCounts.cleaned++;}}});
      document.querySelector('#board-test-host [data-action=fit]').click();
    })()`);
    const counts=await evaluate('({...mountCounts})');
    // Resizing re-fits while the camera follows fit, and keeps the user's camera after a manual pan.
    const frames="new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))";
    assert.equal(await evaluate(`${centred}(document.querySelector('#board-test-host'))`),true,'Isolated fit centres content');
    await evaluate(`document.querySelector('#board-test-host').style.width='560px';${frames}`);
    assert.equal(await evaluate(`${centred}(document.querySelector('#board-test-host'))`),true,'Resize re-fits an untouched camera');
    await evaluate("const v=document.querySelector('#board-test-host .notes-viewport');v.focus();v.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");
    const panned=await evaluate("document.querySelector('#board-test-host .notes-world').style.transform");
    await evaluate(`document.querySelector('#board-test-host').style.width='';${frames}`);
    assert.equal(await evaluate("document.querySelector('#board-test-host .notes-world').style.transform"),panned,'Resize respects a manually panned camera');
    await evaluate(`testClient.command({type:'note.update',payload:{id:'${ids.note}',color:'#deead9'}})`);
    assert.deepEqual(await evaluate('({...mountCounts})'),counts,'Metadata updates preserve editor/media slots');
    // Text wheel is not consumed by the board; background wheel keeps the point under cursor.
    const cameraCheck=await evaluate(`(()=>{const root=document.querySelector('#board-test-host'),v=root.querySelector('.notes-viewport'),text=root.querySelector('.note-text'),w=root.querySelector('.notes-world');const initial=w.style.transform;
      text.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true}));const afterText=w.style.transform;
      const r=v.getBoundingClientRect(),x=r.left+120,y=r.top+160,before=new DOMMatrix(getComputedStyle(w).transform),worldX=(120-before.e)/before.a,worldY=(160-before.f)/before.a;
      v.dispatchEvent(new WheelEvent('wheel',{deltaY:-80,clientX:x,clientY:y,bubbles:true,cancelable:true}));const after=new DOMMatrix(getComputedStyle(w).transform);
      return{initial,afterText,anchorX:worldX*after.a+after.e,anchorY:worldY*after.a+after.f};})()`);
    assert.equal(cameraCheck.initial,cameraCheck.afterText);assert.ok(Math.abs(cameraCheck.anchorX-120)<.01);assert.ok(Math.abs(cameraCheck.anchorY-160)<.01);
    await evaluate("document.querySelector('#board-test-host .notes-viewport').scrollIntoView({block:'center'})");
    const mouse=async(type,x,y,button='left',buttons=1)=>call('Input.dispatchMouseEvent',{type,x,y,button,buttons,clickCount:type==='mousePressed'||type==='mouseReleased'?1:0});
    const dragPoint=await evaluate("(()=>{const h=document.querySelector('#board-test-host .note-handle');h.addEventListener('pointerdown',e=>window.lastPointer=e.pointerId);const r=h.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+20,original:parseFloat(h.parentElement.style.left)};})()");
    await mouse('mousePressed',dragPoint.x,dragPoint.y);
    await wait("testClient.getState().leaseState==='held'");
    await mouse('mouseMoved',dragPoint.x+60,dragPoint.y+20);
    assert.notEqual(await evaluate("parseFloat(document.querySelector('#board-test-host .paper-note').style.left)"),dragPoint.original);
    await evaluate("document.querySelector('#board-test-host .notes-viewport').dispatchEvent(new PointerEvent('pointercancel',{pointerId:lastPointer,bubbles:true}))");
    assert.equal(await evaluate("parseFloat(document.querySelector('#board-test-host .paper-note').style.left)"),dragPoint.original,'Pointer cancellation restores authoritative geometry');
    await mouse('mouseReleased',dragPoint.x+60,dragPoint.y+20,'left',0);
    await wait("testClient.getState().leaseState!=='held'");
    await mouse('mousePressed',dragPoint.x,dragPoint.y);await wait("testClient.getState().leaseState==='held'");await mouse('mouseMoved',dragPoint.x+70,dragPoint.y+10);
    await evaluate('testClient.reconnect()');
    assert.equal(await evaluate("parseFloat(document.querySelector('#board-test-host .paper-note').style.left)"),dragPoint.original,'Lease loss restores geometry');
    await mouse('mouseReleased',dragPoint.x+70,dragPoint.y+10,'left',0);await wait("testClient.getState().connection==='online'");
    // Right-button camera pan is available independently of note mutation.
    const pan=await evaluate("(()=>{const v=document.querySelector('#board-test-host .notes-viewport'),r=v.getBoundingClientRect();return{x:r.left+40,y:r.top+40,before:document.querySelector('#board-test-host .notes-world').style.transform}})()");
    await mouse('mousePressed',pan.x,pan.y,'right',2);await mouse('mouseMoved',pan.x+40,pan.y+30,'right',2);await mouse('mouseReleased',pan.x+40,pan.y+30,'right',0);
    assert.notEqual(await evaluate("document.querySelector('#board-test-host .notes-world').style.transform"),pan.before);
    // Native touch sequence: two background fingers pan and pinch; a text tap does not drag paper.
    await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    const touchBefore=await evaluate("document.querySelector('#board-test-host .notes-world').style.transform");
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pan.x,y:pan.y,id:1},{x:pan.x+80,y:pan.y,id:2}]});
    await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:pan.x+20,y:pan.y+20,id:1},{x:pan.x+130,y:pan.y+20,id:2}]});
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert.notEqual(await evaluate("document.querySelector('#board-test-host .notes-world').style.transform"),touchBefore);
    const noteBeforeTap=await evaluate("document.querySelector('#board-test-host .paper-note').style.cssText");
    await evaluate("const text=document.querySelector('#board-test-host .note-text');text.dispatchEvent(new PointerEvent('pointerdown',{pointerId:19,pointerType:'touch',button:0,bubbles:true}));text.focus()");
    await call('Input.insertText',{text:'Gõ trên điện thoại'});
    assert.ok(await evaluate("document.querySelector('#board-test-host .note-text').textContent.includes('Gõ trên điện thoại')"));
    assert.equal(await evaluate("document.querySelector('#board-test-host .paper-note').style.cssText"),noteBeforeTap);
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#board-test-host .notes-button')).transitionDuration"),'0s');
    // Auth downgrade tears down private hook resources synchronously; cleanup is repeatable.
    await evaluate("import('/js/auth.js').then(m=>m.logout())");
    await wait("!document.querySelector('#board-test-host [contenteditable=true]')");
    assert.ok((await evaluate('mountCounts.cleaned'))>=2);
    await evaluate('mountAbort.abort();cleanupBoard();cleanupBoard();testClient.close()');
    assert.equal(await evaluate("document.querySelector('#board-test-host').childElementCount"),0);
    console.log('PASS board shell: public/login, empty creation, authors, reparent/group movement, keyboard/resize/save, five viewports, sidebar/back/forward, guest camera/last-viewed fallback, board/child trash ancestry, pointer cancel/lease loss, right-pan/pinch/text input, keyed hooks/reduced-motion/idempotent cleanup');
  },undefined,{origin:fixture.origin});
} finally {await fixture.close();}
