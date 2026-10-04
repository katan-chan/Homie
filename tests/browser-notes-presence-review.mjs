import assert from 'node:assert/strict';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

const fixture=await createNotesFixture();
try {
  await withBrowser(async evaluate=> {
    const wait=expression=>evaluate(`(async()=>{const end=Date.now()+7000;while(!(${expression})){if(Date.now()>end)throw Error('Timed out '+${JSON.stringify(expression)});await new Promise(r=>setTimeout(r,20));}return true;})()`);
    await evaluate(`(async()=>{
      const auth=await import('/js/auth.js');await auth.login('minhle',${JSON.stringify(fixturePasswords.minhle)});
      const {openBoardClient}=await import('/js/notes/client.js');const {mountBoardPresence}=await import('/js/notes/editor.js');
      window.client=await openBoardClient({boardId:crypto.randomUUID(),accountId:'minhle'});
      await client.command({type:'board.create',baseRevision:0,payload:{name:'Kiểm chứng ownership presence'}});
      window.calls=[];window.holdNext=true;window.resume=null;const publish=client.publishPresence;
      client.publishPresence=async value=>{const held=holdNext;holdNext=false;calls.push(structuredClone(value));const result=await publish(value);if(held)await new Promise(resolve=>resume=resolve);return result;};
      window.mount=()=>{const viewport=document.createElement('div');const world=document.createElement('div');world.className='notes-world';viewport.append(world);document.body.append(viewport);const stop=mountBoardPresence(viewport,{client,worldPoint:(x,y)=>({x,y})});return {viewport,stop:()=>{stop();viewport.remove();}};};
      window.move=(record,x)=>record.viewport.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:20,bubbles:true}));
      window.first=mount();move(first,10);
    })()`);
    await wait('resume!==null');
    await evaluate('first.stop();window.second=mount();move(second,30)');
    await new Promise(resolve=>setTimeout(resolve,80));
    await evaluate('resume();resume=null');
    await wait('calls.some(call=>call.pointer?.x===30)');
    await new Promise(resolve=>setTimeout(resolve,80));
    assert.equal(await evaluate('calls.some(call=>call.pointer===null)'),false,'Old send completion cannot withdraw the newly mounted owner');
    await wait('client.getState().presence.find(peer=>peer.clientId===client.clientId)?.pointer?.x===30');
    // A withdrawal is asynchronous too: retain serialization if another owner mounts during it.
    await evaluate('holdNext=true;second.stop()');await wait('resume!==null');
    await evaluate('window.third=mount();move(third,50)');
    await new Promise(resolve=>setTimeout(resolve,80));
    await evaluate('resume();resume=null');
    await wait('client.getState().presence.find(peer=>peer.clientId===client.clientId)?.pointer?.x===50');
    assert.equal(await evaluate('calls.at(-1).pointer.x'),50,'Pending old withdrawal settles before the newly mounted publication');
    await evaluate('third.stop();third.stop()');
    await wait('calls.at(-1).pointer===null');
    await wait('client.getState().presence.find(peer=>peer.clientId===client.clientId)?.pointer===null');
    assert.equal(await evaluate('client.getState().writable'),true,'Final true cleanup withdraws presence with client still open');
    await evaluate('client.close()');
  },undefined,{origin:fixture.origin});
  console.log('PASS same-client remount serializes pending send/withdrawal and final cleanup');
} finally {await fixture.close();}
