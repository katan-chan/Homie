// Regression: right after creating a board (which reconnects and leaves leaseState 'lost'), the first note and column drags must work.
import assert from 'node:assert/strict';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';
const fixture = await createNotesFixture({ app: true });
try {
  await withBrowser(async (evaluate, { call }) => {
    const wait = e => evaluate(`(async()=>{const end=Date.now()+15000;while(!(${e})){if(Date.now()>end)throw Error('timeout '+${JSON.stringify(e)});await new Promise(r=>setTimeout(r,50));}return true;})()`);
    const mouse = (type,x,y,buttons) => call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await call('Emulation.setFocusEmulationEnabled',{enabled:true});
    await evaluate("location.hash='dashboard'"); await wait("document.querySelector('.notes-dashboard')");
    await evaluate(`(async()=>{await (await import('/js/auth.js')).login('minhle',${JSON.stringify(fixturePasswords.minhle)});})()`); await wait("document.querySelector('[data-action=board-new-empty]')");
    await evaluate("document.querySelector('[data-action=board-new-empty]').click()"); await wait("document.querySelector('.notes-name-form')");
    await evaluate("document.querySelector('.notes-name-form input').value='B';document.querySelector('.notes-name-form').requestSubmit()"); await wait("document.querySelector('.notes-durability')?.dataset.durability==='saved'");
    await evaluate("document.querySelector('[data-action=note-new]').click()"); await wait("document.querySelector('.paper-note .note-text[data-editor-state=ready]')");
    await evaluate("document.querySelector('[data-action=column-new]').click()"); await wait("document.querySelector('.notes-name-form')");
    await evaluate("document.querySelector('.notes-name-form input').value='Cột';document.querySelector('.notes-name-form').requestSubmit()"); await wait("document.querySelector('.paper-column')");
    await wait("document.querySelector('.notes-durability')?.dataset.durability==='saved'"); await new Promise(r=>setTimeout(r,800));
    for (const [sel, label] of [['.paper-note .note-handle','note'], ['.paper-column .column-handle','column']]) {
      const before = await evaluate(`(()=>{const h=document.querySelector('${sel}'),b=h.getBoundingClientRect(),n=h.closest('.paper-note,.paper-column');return {x:b.x+b.width/2,y:b.y+b.height/2,left:n.style.left,top:n.style.top,hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.className}})()`);
      await mouse('mouseMoved',before.x,before.y,0); await mouse('mousePressed',before.x,before.y,1);
      for (let i=1;i<=10;i++){ await mouse('mouseMoved',before.x+i*8,before.y+i*5,1); await new Promise(r=>setTimeout(r,30)); }
      const during = await evaluate(`(()=>{const n=document.querySelector('${sel}').closest('.paper-note,.paper-column');return n.style.left+','+n.style.top})()`);
      await mouse('mouseReleased',before.x+80,before.y+50,0); await new Promise(r=>setTimeout(r,1200));
      const after = await evaluate(`(()=>{const n=document.querySelector('${sel}').closest('.paper-note,.paper-column');return n.style.left+','+n.style.top+' err='+document.querySelector('.notes-error')?.textContent})()`);
      assert.equal(before.hit, label === 'note' ? 'note-handle' : 'column-handle', `${label} handle is on top`);
      assert.notEqual(during, before.left+','+before.top, `${label} follows the pointer`);
      assert.ok(after.startsWith(during), `${label} keeps the dropped position (${after})`);
    }
  }, undefined, { origin: fixture.origin });
  console.log('PASS first note/column drag right after board creation');
} finally { await fixture.close(); }
