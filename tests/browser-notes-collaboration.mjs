import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

const fixture = await createNotesFixture();
const wait = (evaluate, expression) => evaluate(`(async()=>{const end=Date.now()+10000;while(!(${expression})){if(Date.now()>end)throw Error('Timed out: '+${JSON.stringify(expression)}+' / '+document.querySelector('.notes-error')?.textContent);await new Promise(r=>setTimeout(r,30));}return true;})()`);
async function prepare(evaluate, account, boardId) {
  await evaluate(`(async()=>{
    window.auth=await import('/js/auth.js'); await auth.login('${account}',${JSON.stringify(fixturePasswords[account])});
    const {openBoardClient}=await import('/js/notes/client.js');
    const {mountBoard}=await import('/js/notes/board.js');
    const {mountBoardNoteEditor}=await import('/js/notes/editor.js');
    window.boardId=${boardId ? JSON.stringify(boardId) : 'crypto.randomUUID()'};
    window.client=await openBoardClient({boardId,accountId:'${account}'});
    if(!${!!boardId})await client.command({type:'board.create',baseRevision:0,payload:{name:'Kiểm chứng văn bản',visibility:'public'}});
    for(const href of ['/styles/notes.css','/styles/notes-format.css']){const css=document.createElement('link');css.rel='stylesheet';css.href=href;document.head.append(css);}
    document.body.className='notes-dashboard';window.host=document.createElement('div');document.body.append(host);
    window.stop=mountBoard(host,{client,mountEditor:mountBoardNoteEditor});
  })()`);
  await wait(evaluate,"client.getState().connection==='online'");
}
try {
  await withBrowser(async (a, ca) => {
    // Two headless pages run side by side; emulate page focus so real focusin events reach the editors.
    await ca.call('Emulation.setFocusEmulationEnabled',{enabled:true});
    await prepare(a,'minhle');
    await a("client.command({type:'note.create',payload:{id:crypto.randomUUID(),columnId:null,x:30,y:30,width:520,height:450,color:'#fff0b8'}})");
    await wait(a,"document.querySelector('.tiptap[contenteditable=true]')");
    const ids=await a("({board:boardId,note:document.querySelector('.paper-note').dataset.noteId})");
    await withBrowser(async (b, cb) => {
      await cb.call('Emulation.setFocusEmulationEnabled',{enabled:true});
      await prepare(b,'haiyen',ids.board);
      await wait(b,"document.querySelector('.tiptap[contenteditable=true]')");
      await wait(b,"client.getState().presence.find(peer=>peer.clientId===client.clientId)?.editors.length===0");
      assert.deepEqual(await b("({rows:document.querySelectorAll('.notes-format-row').length,perNote:document.querySelectorAll('.note-text .note-format-tools,.note-text .notes-format-button').length,hint:!document.querySelector('.notes-format-hint').hidden,disabled:[...document.querySelectorAll('.notes-format-row > button')].every(node=>node.disabled)})"),{rows:1,perNote:0,hint:true,disabled:true},'One shared format row stays disabled until a note is focused');
      await b(`(async()=>{
        window.boundedWire=[];const publish=client.publishPresence;client.publishPresence=value=>{boundedWire.push(value.editors.map(editor=>editor.noteId));return publish(value)};
        window.extraNotes=[];
        for(let i=0;i<17;i++){const id=crypto.randomUUID();extraNotes.push(id);await client.command({type:'note.create',payload:{id,columnId:null,x:1200+i*10,y:100,width:260,height:240,color:'#fff0b8'}});}
        const end=Date.now()+7000;while(document.querySelectorAll('.tiptap').length<18){if(Date.now()>end)throw Error('Missing editors');await new Promise(r=>setTimeout(r,30));}
        await client.flush();window.editor=document.querySelector('.tiptap').editor;editor.commands.focus('end');await new Promise(r=>setTimeout(r,60));
        const {Y}=await import('/assets/vendor/notes.js');window.staleCursors=0;
        for(const id of extraNotes){const doc=await client.getDocument(id);const awareness=await client.getAwareness(id);const cursor=Y.createRelativePositionFromTypeIndex(doc.getXmlFragment('body'),0);awareness.setLocalStateField('cursor',{anchor:cursor,head:cursor});if(awareness.getLocalState()?.cursor)staleCursors++;}
        window.boundStart=boundedWire.length;document.querySelector('.notes-viewport').dispatchEvent(new PointerEvent('pointermove',{clientX:200,clientY:200,bubbles:true}));
      })()`);
      assert.equal(await b('staleCursors'),17,'Actual inactive Awareness records retain non-null relative cursors');
      await wait(b,'boundedWire.length>boundStart');
      assert.deepEqual(await b('boundedWire.at(-1)'),[ids.note],'Wire itself contains only the focused note despite 17 stale cursor records');
      await wait(b,"client.getState().presence.find(peer=>peer.clientId===client.clientId)?.editors.length===1");
      assert.equal(await b("client.getState().presence.find(peer=>peer.clientId===client.clientId).editors[0].noteId"),ids.note,'Only the focused note uses a bounded wire caret slot');
      assert.equal(await b("document.querySelectorAll('.notes-format-row').length"),1,'Eighteen notes still share exactly one format row');
      await b(`(async()=>{
        window.target=[...document.querySelectorAll('.tiptap')].find(node=>node.closest('.paper-note').dataset.noteId===extraNotes[3]).editor;
        target.view.focus();target.commands.insertContent('Đậm riêng');target.commands.selectAll();
        document.querySelector('.note-handle').focus();
        document.querySelector('.notes-format-row [data-format=toggleBold]').click();await client.flush();
      })()`);
      assert.equal(await b("JSON.stringify(target.getJSON()).includes('bold')"),true,'Bold applies to the most recently focused note after blur');
      assert.equal(await b("JSON.stringify(editor.getJSON()).includes('bold')"),false,'Other notes are untouched');
      assert.equal(await b("document.querySelector('.notes-format-row [data-format=toggleBold]').getAttribute('aria-pressed')"),'true','aria-pressed follows the active editor');
      await b("(async()=>{for(const id of extraNotes)await client.command({type:'note.trash',payload:{id}});await client.flush()})()");
      await wait(b,"document.querySelector('.notes-format-row [data-format=toggleBold]').disabled && !document.querySelector('.notes-format-hint').hidden");
      await a("window.editor=document.querySelector('.tiptap').editor;editor.commands.insertContentAt(1,'Minh Lê: ')");
      await b("window.editor=document.querySelector('.tiptap').editor;editor.commands.insertContentAt(1,'Hải Yến: ')");
      await wait(a,"editor.getText().includes('Hải Yến')");await wait(b,"editor.getText().includes('Minh Lê')");
      assert.deepEqual(await a('editor.getJSON()'),await b('editor.getJSON()'),'Two authenticated editors converge');
      await a("editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));client.flush()");await wait(b,"!editor.getText().includes('Minh Lê')");
      assert.equal(await a("editor.getText().includes('Hải Yến')"),true,'Own undo preserves peer insertion');
      await a("editor.commands.redo();client.flush()");await wait(b,"editor.getText().includes('Minh Lê')");
      await a("editor.chain().setTextSelection({from:1,to:5}).setBold().setUnderline().setColor('#9a3456').run();editor.commands.toggleTaskList();client.flush()");
      await wait(b,"editor.getJSON().content[0].type==='taskList'");
      assert.deepEqual(await a('editor.getJSON()'),await b('editor.getJSON()'));
      assert.ok(JSON.stringify(await b('editor.getJSON()')).includes('underline'));
      const colorAt=`(()=>{const marks=editor.getJSON().content[0].content[0].content[0].content[0].marks||[];return marks.find(mark=>mark.type==='textStyle')?.attrs.color;})()`;
      await a("editor.view.focus();editor.commands.setTextSelection({from:3,to:7});document.querySelector('.notes-format-row [data-format=color]').click()");
      assert.equal(await a("!document.querySelector('.notes-color-panel').hidden && !!document.activeElement.closest('.notes-color-panel')"),true,'Colour panel opens with focus inside');
      await a("document.querySelector('[data-color-mode=rgb]').click();for(const [channel,value] of [['R',18],['G',52],['B',86]]){const input=document.querySelector(`input[type=number][data-channel=${channel}]`);input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));}");
      assert.equal(await a("document.querySelector('.notes-color-hex').value"),'#123456');
      await a("document.querySelector('[data-color-action=apply]').click();client.flush()");
      assert.equal(await a(colorAt),'#123456','RGB mode applies lowercase #rrggbb');
      await wait(b,`${colorAt}==='#123456'`);
      // Font size: typed number applies live, steppers and Word-style shortcuts adjust, and peers render it.
      const sizeAt=colorAt.replace('attrs.color','attrs.fontSize'),sizeField="document.querySelector('.notes-format-row input[data-format=fontSize]')";
      await a(`editor.commands.setTextSelection({from:3,to:7});${sizeField}.focus();${sizeField}.value='34';${sizeField}.dispatchEvent(new Event('input',{bubbles:true}));client.flush()`);
      assert.equal(await a(sizeAt),'34px','Typed size applies textStyle fontSize');
      assert.equal(await a("document.activeElement.dataset.format"),'fontSize','Typing keeps focus in the size field');
      await wait(b,`${sizeAt}==='34px'`);
      assert.equal(await b(`getComputedStyle(editor.view.dom.querySelector('span[style*=font-size]')).fontSize`),'34px','Peer renders the size');
      await a(`${sizeField}.value='500';${sizeField}.dispatchEvent(new Event('change'))`);
      assert.deepEqual([await a(sizeAt),await a(`${sizeField}.value`)],['72px','72'],'Out-of-range input clamps to 72');
      await a("editor.commands.setTextSelection({from:3,to:7});document.querySelector('.notes-format-row [data-format=fontSizeDown]').click()");
      assert.equal(await a(sizeAt),'71px','Minus steps down by 1');
      const mod="(/Mac/.test(navigator.platform)?{metaKey:true}:{ctrlKey:true})";
      await a(`editor.view.focus();editor.commands.setTextSelection({from:3,to:7});editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'[',bubbles:true,cancelable:true,...${mod}}))`);
      assert.equal(await a(sizeAt),'70px','Mod+[ steps down by 1');
      await a(`editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'<',shiftKey:true,bubbles:true,cancelable:true,...${mod}}))`);
      assert.equal(await a(sizeAt),'68px','Mod+Shift+< steps down by 2');
      assert.equal(await a(`${sizeField}.value`),'68','Field follows shortcut changes');
      await a("editor.commands.setTextSelection(3);document.querySelector('.notes-format-row [data-format=fontSizeUp]').click()");
      assert.deepEqual(await a("(()=>{const sizes=[];editor.state.doc.descendants(node=>{if(node.isText)sizes.push(node.marks.find(mark=>mark.type.name==='textStyle')?.attrs.fontSize);});return [new Set(sizes).size,sizes[0],editor.state.selection.empty,editor.state.selection.from]})()"),[1,'69px',true,3],'Caret-only + resizes the whole note and keeps the caret');
      assert.equal(await a(colorAt),'#123456','Size keeps the colour');
      await a("editor.commands.setTextSelection({from:3,to:7});document.querySelector('.notes-format-row [data-format=color]').click();document.querySelector('[data-color-mode=wheel]').click();{const light=document.querySelector('.notes-color-light input');light.value='100';light.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('.notes-color-wheel').scrollIntoView({block:'center'})");
      const wheel=await a("(()=>{const r=document.querySelector('.notes-color-wheel').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,r:r.width/2};})()");
      await ca.call('Input.dispatchMouseEvent',{type:'mousePressed',x:wheel.x,y:wheel.y,button:'left',buttons:1,clickCount:1});
      await ca.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:wheel.x+wheel.r+30,y:wheel.y,button:'left',buttons:1});
      await ca.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:wheel.x+wheel.r+30,y:wheel.y,button:'left',buttons:0,clickCount:1});
      assert.equal(await a("document.querySelector('.notes-color-hex').value"),'#80ff00','Wheel drag picks hue by angle and saturation by distance');
      await a("for(let i=0;i<6;i++)document.querySelector('.notes-color-wheel').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}))");
      assert.equal(await a("document.querySelector('.notes-color-hex').value"),'#ffff00','Arrow keys on the wheel adjust hue');
      await a("document.querySelector('[data-color-action=apply]').click();client.flush()");
      assert.equal(await a(colorAt),'#ffff00','Wheel mode applies lowercase #rrggbb');
      await a("document.querySelector('.notes-format-row [data-format=color]').click();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
      assert.equal(await a("document.querySelector('.notes-color-panel').hidden && document.activeElement.dataset.format==='color'"),true,'Escape closes the colour panel and returns focus to its trigger');
      await b("editor.commands.focus('end')");
      await wait(a,"document.querySelector('.collaboration-carets__label')?.textContent==='Hải Yến'");
      await b("window.presenceTimes=[];const publish=client.publishPresence;client.publishPresence=value=>{presenceTimes.push(performance.now());return publish(value)};for(let i=0;i<80;i++)document.querySelector('.notes-viewport').dispatchEvent(new PointerEvent('pointermove',{clientX:200+i,clientY:250,bubbles:true}));");
      await wait(a,"document.querySelector('.notes-peer-pointer')?.textContent==='Hải Yến'");
      await wait(b,'presenceTimes.length>=1');
      await b("for(let i=0;i<80;i++)document.querySelector('.notes-viewport').dispatchEvent(new PointerEvent('pointermove',{clientX:220+i,clientY:260,bubbles:true}))");
      await wait(b,'presenceTimes.length>=2');
      assert.equal(await b('presenceTimes.slice(1).every((time,index)=>time-presenceTimes[index]>=48)'),true,'Pointer/caret coordinator publishes at most 20Hz');
      await b("window.boundStart=boundedWire.length;document.querySelector('.note-handle').focus();document.querySelector('.notes-viewport').dispatchEvent(new PointerEvent('pointermove',{clientX:230,clientY:260,bubbles:true}))");
      await wait(b,'boundedWire.length>boundStart');
      assert.deepEqual(await b('boundedWire.at(-1)'),[],'Board focus sends no editor caret even when Awareness retains its last cursor');
      await b("editor.commands.focus('end')");
      const save=await a("editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}))");assert.equal(save,false,'Ctrl+S prevents browser Save Page');
      await a("window.originalEditor=editor;document.querySelector('.note-handle').click();document.querySelector('[data-action=move-right]').click()");
      await wait(a,"parseFloat(document.querySelector('.paper-note').style.left)===40");
      await wait(a,"client.getState().pending.total===0 && client.getState().durability==='saved'");
      assert.equal(await a("originalEditor===document.querySelector('.tiptap').editor"),true,'Geometry preserves editor instance');
      await a("document.querySelector('.note-handle').focus();document.querySelector('.note-handle').dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))");
      await wait(a,"parseFloat(document.querySelector('.paper-note').style.left)===30");
      assert.equal(await a("editor.getText().includes('Hải Yến')"),true,'Geometry undo leaves shared text');
      await b("editor.commands.focus('end')");
      await cb.call('Input.imeSetComposition',{text:'Tie',selectionStart:3,selectionEnd:3});
      await a("editor.commands.insertContentAt(1,'Bạn: ')");
      await cb.call('Input.imeSetComposition',{text:'Tiếng Việt Ắ ệ ỗ',selectionStart:15,selectionEnd:15});
      await cb.call('Input.insertText',{text:'Tiếng Việt Ắ ệ ỗ'});
      await cb.call('Input.insertText',{text:'!'});
      await wait(a,"editor.getText().includes('Tiếng Việt Ắ ệ ỗ!')");
      assert.equal(await b("editor.getText().includes('Bạn: ')"),true,'Peer insert survives native Vietnamese composition');
      assert.deepEqual(await a('editor.getJSON()'),await b('editor.getJSON()'),'IME and peer edits converge');
      await b("editor.commands.selectAll();editor.commands.setItalic();editor.commands.toggleBulletList();client.flush()");
      await wait(a,"editor.getJSON().content[0].type==='bulletList'");
      await b("editor.commands.toggleOrderedList();client.flush()");
      await wait(a,"editor.getJSON().content[0].type==='orderedList'");
      await b("editor.commands.toggleTaskList();client.flush()");
      await wait(a,"editor.getJSON().content[0].type==='taskList'");
      await b("document.querySelector('.tiptap input[type=checkbox]').click();client.flush()");
      await wait(a,"editor.getJSON().content[0].content[0].attrs.checked===true");
      assert.ok(JSON.stringify(await a('editor.getJSON()')).includes('italic'));
      await b(`{editor.commands.focus('end');window.pasteExecuted=false;const clipboard=new DataTransfer();clipboard.setData('text/html','<p><strong>Văn bản dán</strong><script>window.pasteExecuted=true</script><img src=x onerror="window.pasteExecuted=true"><a href="javascript:window.pasteExecuted=true">Liên kết</a></p>');clipboard.setData('text/plain','Văn bản dán Liên kết');editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));}`);
      await wait(a,"editor.getText().includes('Văn bản dán')");
      assert.equal(await b('pasteExecuted'),false,'Pasted script never executes');
      assert.equal(await b("!!editor.view.dom.querySelector('script,img,a,[onclick],[onerror]')"),false,'Restricted schema strips executable paste');
      await a("client.flush()");await b("client.flush()");
      await wait(a,"client.getState().pending.total===0");await wait(b,"client.getState().pending.total===0");
      const font=await a("(async()=>{await document.fonts.load('23px \"Homie Patrick Hand\"','Tiếng Việt Ắ ệ ỗ');await document.fonts.ready;return {loaded:document.fonts.check('23px \"Homie Patrick Hand\"'),family:getComputedStyle(editor.view.dom).fontFamily}})()");
      assert.equal(font.loaded,true);assert.match(font.family,/Homie Patrick Hand/);
      assert.equal(await a("[...document.querySelectorAll('.notes-format-row button')].filter(node=>node.getClientRects().length).every(node=>node.getBoundingClientRect().width>=44 && node.getBoundingClientRect().height>=44)"),true,'Formatting targets are at least 44px');
      assert.equal(await a("getComputedStyle(document.querySelector('.tiptap li[data-checked]')).display"),'flex','Checklist checkbox stays beside its text');
      await withBrowser(async guest=>{
        await guest(`(async()=>{const {openBoardClient}=await import('/js/notes/client.js');const {mountBoard}=await import('/js/notes/board.js');const {mountBoardNoteEditor}=await import('/js/notes/editor.js');window.client=await openBoardClient({boardId:'${ids.board}'});window.privateCalls=0;for(const name of ['getDocument','getAwareness','getPending'])client[name]=()=>{privateCalls++;throw Error('Guest private call')};window.host=document.createElement('div');document.body.append(host);window.stop=mountBoard(host,{client,mountEditor:mountBoardNoteEditor});})()`);
        await wait(guest,"document.querySelector('.tiptap')?.textContent.includes('Tiếng Việt')");
        assert.equal(await guest("document.querySelectorAll('[contenteditable=true],.note-format-tools,.notes-format-row button,.collaboration-carets__label,.notes-peer-pointer,[data-mutation]').length"),0,'Guest has no mutation or private presence DOM');
        assert.equal(await guest("document.querySelector('.notes-format-row').hidden"),true,'Read-only board hides the shared format row');
        assert.equal(await guest('privateCalls'),0,'Guest renderer never requests private documents/awareness/queue');
        assert.equal(await guest("[...document.querySelectorAll('input[type=checkbox]')].every(input=>input.disabled)"),true);
        assert.deepEqual(await guest('client.getState().presence'),[]);
        await guest('stop();client.close()');
      },undefined,{origin:fixture.origin});
      for(const width of [1440,390,320]) {
        await ca.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        if(width===320){
          await a("editor.view.focus();document.querySelector('.notes-format-row [data-format=color]').click();document.querySelector('[data-color-mode=wheel]').click()");
          for(const colorMode of ['rgb','wheel']){
            await a(`document.querySelector('[data-color-mode=${colorMode}]').click()`);
            const fit=await a("(()=>{const row=document.querySelector('.notes-format-row'),panel=row.querySelector('.notes-color-panel').getBoundingClientRect();return {doneVisible:row.querySelector('.notes-format-done').getBoundingClientRect().right<=innerWidth,panelInside:panel.left>=0&&panel.right<=innerWidth,small:[...row.querySelectorAll('button,input')].filter(node=>node.getClientRects().length&&node.getBoundingClientRect().height<44||node.tagName==='BUTTON'&&node.getClientRects().length&&node.getBoundingClientRect().width<44).length,pageScroll:document.documentElement.scrollWidth>innerWidth};})()");
            // Phones scroll the format strip sideways; Xong stays pinned on screen.
            assert.deepEqual(fit,{doneVisible:true,panelInside:true,small:0,pageScroll:false},`320px ${colorMode} panel fits on screen`);
          }
          const shot=await ca.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('/private/tmp/task-format-320.png',Buffer.from(shot.data,'base64'));
          await a("document.querySelector('[data-color-action=close]').click()");
        }
        if(width===390){await a("{const input=document.querySelector('[name=width]');input.value='260';input.dispatchEvent(new Event('change',{bubbles:true}));}");await wait(a,"parseFloat(document.querySelector('.paper-note').style.width)===260");}
        assert.equal(await a('document.documentElement.scrollWidth>innerWidth'),false,'No page overflow');
        const shot=await ca.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`/private/tmp/task-6-${width}.png`,Buffer.from(shot.data,'base64'));
      }
      await b('stop();stop()');
      await wait(a,"!document.querySelector('.collaboration-carets__label')");
      await b('client.close()');
    },undefined,{origin:fixture.origin});
    await a('stop();stop();client.close()');
  },undefined,{origin:fixture.origin});
  console.log('PASS real two-client rich text, own undo, presence, save and stable geometry');
} finally {await fixture.close();}

const lifecycle = await createNotesFixture({app:true,sessionTtlMs:5000});
try {
  await withBrowser(async (evaluate,{call})=> {
    await evaluate(`(async()=>{window.auth=await import('/js/auth.js');await auth.login('minhle',${JSON.stringify(fixturePasswords.minhle)});location.hash='dashboard';})()`);
    await wait(evaluate,"document.querySelector('[data-action=board-new]')");
    await evaluate("document.querySelector('[data-action=board-new]').click();document.querySelector('.notes-name-form input').value='Vòng đời editor';document.querySelector('.notes-name-form').requestSubmit()");
    await wait(evaluate,"document.querySelector('[data-action=note-new]') && document.querySelector('.notes-durability')?.dataset.durability==='saved'");
    await wait(evaluate,"document.querySelector('[data-action=board-visibility] option[value=public]')");
    await evaluate("(()=>{const s=document.querySelector('[data-action=board-visibility]');s.value='public';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await wait(evaluate,"document.querySelector('.notes-board-tab[aria-selected=true]')?.dataset.visibility==='public' && document.querySelector('.notes-durability')?.dataset.durability==='saved'");
    await evaluate("document.querySelector('[data-action=note-new]').click()");
    await wait(evaluate,"document.querySelector('.tiptap[contenteditable=true]')");
    await evaluate("window.editor=document.querySelector('.tiptap').editor;editor.commands.insertContentAt(1,'Trang công khai');");
    await wait(evaluate,"document.querySelector('.notes-durability')?.dataset.durability==='saved'");
    await evaluate("window.previous=editor;location.hash='garden'");
    await wait(evaluate,"document.body.dataset.tab==='garden'");
    assert.equal(await evaluate('previous.isDestroyed'),true,'Actual dashboard tab cleanup destroys editor');
    await evaluate("location.hash='dashboard'");await wait(evaluate,"document.querySelector('.tiptap[contenteditable=true]')");
    await evaluate("window.previous=document.querySelector('.tiptap').editor;location.hash='garden';location.hash='dashboard';location.hash='garden'");
    await wait(evaluate,"document.body.dataset.tab==='garden'");
    assert.equal(await evaluate("document.querySelectorAll('.tiptap').length"),0,'Rapid tabs leave no private editor DOM');
    assert.equal(await evaluate('previous.isDestroyed'),true);
    await evaluate("location.hash='dashboard'");await wait(evaluate,"document.querySelector('.tiptap[contenteditable=true]')");
    await evaluate('auth.logout()');await wait(evaluate,"document.querySelector('.tiptap[contenteditable=false]')");
    assert.equal(await evaluate("document.querySelectorAll('.note-format-tools,.notes-format-row button,[data-mutation],.collaboration-carets__label').length"),0,'Explicit logout replaces private editor with public mode');
    assert.equal(await evaluate("document.querySelector('.tiptap').textContent"),'Trang công khai');
    await evaluate(`auth.login('minhle',${JSON.stringify(fixturePasswords.minhle)})`);
    await wait(evaluate,"document.querySelector('.tiptap[contenteditable=true]')");
    await call('Network.enable');await call('Network.setBlockedURLs',{urls:['*/api/*']});
    await evaluate("window.privateEditor=document.querySelector('.tiptap').editor;privateEditor.commands.focus('end');privateEditor.commands.insertContent(' NHÁP RIÊNG CHƯA ACK')");
    await wait(evaluate,"document.querySelector('.notes-durability')?.dataset.durability==='local'");
    await new Promise(resolve=>setTimeout(resolve,5200));
    await call('Network.setBlockedURLs',{urls:[]});
    await evaluate("document.querySelector('[data-action=save]')?.click();auth.refreshSession()");
    await wait(evaluate,"document.querySelector('.tiptap[contenteditable=false]')");
    assert.equal(await evaluate('privateEditor.isDestroyed'),true,'Expired session destroys private editor');
    assert.equal(await evaluate("document.querySelectorAll('.note-format-tools,.notes-format-row button,[data-mutation],.notes-peer-pointer').length"),0);
    assert.equal(await evaluate("document.body.textContent.includes('NHÁP RIÊNG CHƯA ACK')"),false,'Expiry clears unacknowledged private draft from DOM');
    assert.equal(await evaluate("document.querySelector('.tiptap').textContent"),'Trang công khai','Expiry renders only committed public projection');
  },undefined,{origin:lifecycle.origin});
  console.log('PASS actual dashboard tab/logout/session expiry with retained private draft excluded from DOM');
} finally {await lifecycle.close();}
