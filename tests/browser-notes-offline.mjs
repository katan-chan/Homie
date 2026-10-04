import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

const fixture = await createNotesFixture();
const boardId = randomUUID(), noteId = randomUUID();
try {
  await withBrowser(async (evaluate, { call }) => {
    await evaluate(`(async () => {
      const { login } = await import('/js/auth.js');
      await login('minhle', ${JSON.stringify(fixturePasswords.minhle)});
      const m = await import('/js/notes/client.js');
      window.open = () => m.openBoardClient({ boardId: '${boardId}', accountId: 'minhle' });
      window.client = await open();
      const created = await client.command({type:'board.create',baseRevision:0,payload:{name:'Thử offline'}});
      if (created.pending) throw Error('A connected new-board command must receive its persisted ACK');
      await client.command({type:'note.create',payload:{id:'${noteId}',columnId:null,x:0,y:0,width:240,height:200,color:'#ffeeee'}});
      await new Promise((resolve,reject) => {const timer=setTimeout(()=>reject(Error('online timeout')),5000);const stop=client.subscribe(s=>{if(s.connection==='online'){clearTimeout(timer);queueMicrotask(()=>stop());resolve();}});});
      // note.create can queue while board.create reconnects; it must reach the server before the offline phase or the peer trash 404s.
      await client.flush();
      await new Promise((resolve,reject) => {const timer=setTimeout(()=>reject(Error('note.create ACK timeout')),5000);const stop=client.subscribe(s=>{if(s.durability==='saved'){clearTimeout(timer);queueMicrotask(()=>stop());resolve();}});});
    })()`);
    await call('Network.enable');
    await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const offline = await evaluate(`(async()=>{
      await new Promise(r=>setTimeout(r,150));
      const { Y } = await import('/assets/vendor/notes.js');
      const doc = await client.getDocument('${noteId}');
      const p=new Y.XmlElement('paragraph'), t=new Y.XmlText();t.insert(0,'Bản nháp Việt offline');p.insert(0,[t]);doc.getXmlFragment('body').insert(0,[p]);
      await client.flush();return client.getState();
    })()`);
    assert.equal(offline.durability, 'local'); assert.equal(offline.pending.text, 1);
    await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    // Reload static ES modules over HTTP while the API remains unavailable.
    await call('Network.setBlockedURLs', { urls: ['*/api/*'] });
    await evaluate('client.close()');
    await call('Page.reload');
    await new Promise(r => setTimeout(r, 200));
    const reloaded = await evaluate(`(async()=>{
      const { refreshSession }=await import('/js/auth.js');
      // A retained draft is readable offline only with its originating cached identity.
      const session={account:()=> 'minhle',generation:()=>0,subscribe:()=>()=>{}};
      const {openBoardClient}=await import('/js/notes/client.js');
      window.client=await openBoardClient({boardId:'${boardId}',accountId:'minhle',session});
      const doc=await client.getDocument('${noteId}');return {text:doc.getXmlFragment('body').toString(),state:client.getState()};
    })()`);
    assert.match(reloaded.text, /Bản nháp Việt offline/); assert.equal(reloaded.state.pending.text, 1);
    await call('Network.setBlockedURLs', { urls: [] });
    // Another session trashes the note while this client has pending offline text.
    const headers = { Origin: fixture.origin, 'X-Requested-With': 'Homie', 'Content-Type': 'application/json' };
    const login = await fetch(fixture.origin + '/api/auth/login', { method: 'POST', headers, body: JSON.stringify({accountId:'haiyen',password:fixturePasswords.haiyen}) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const trash = await fetch(fixture.origin + '/api/boards/commands', {method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify({clientId:randomUUID(),command:{operationId:randomUUID(),accountId:'haiyen',boardId,baseRevision:0,type:'note.trash',payload:{id:noteId}}})});
    assert.equal(trash.status,200);
    const final = await evaluate(`(async()=>{
      await client.reconnect();await client.flush();
      const limit=Date.now()+5000;while(client.getState().pending.total && Date.now()<limit)await new Promise(r=>setTimeout(r,25));
      const response=await fetch('/api/boards/${boardId}');const publicBoard=(await response.json()).board;
      return {state:client.getState(),publicBoard,privateBoard:client.getState().snapshot};
    })()`);
    assert.equal(final.state.pending.total, 0); assert.equal(final.publicBoard.notes.length, 0);
    assert.ok(final.privateBoard.notes[0].deletedAt);
    await call('Network.setBlockedURLs', { urls: ['*/api/notes/*/text'] });
    const privateDraft = await evaluate(`(async()=>{
      const status=document.createElement('section');status.id='session-state';document.body.append(status);
      client.subscribe(state=>{status.textContent=state.writable && state.snapshot?.texts ? 'private' : 'public';});
      const doc=await client.getDocument('${noteId}');doc.getXmlFragment('body').get(0).get(0).insert(0,'Giữ khi 401: ');
      await client.flush();return client.getState();
    })()`);
    assert.equal(privateDraft.pending.text,1);
    await call('Network.setBlockedURLs', { urls: [] });
    const cookies=await call('Network.getCookies',{urls:[fixture.origin]});
    const sessionCookie=cookies.cookies.find(cookie=>cookie.httpOnly);
    assert.ok(sessionCookie,'The isolated fixture owns an HttpOnly session cookie');
    // The old SSE still captures its live original session. Only this subsequent helper gets 401.
    await call('Network.setCookie',{name:sessionCookie.name,value:'invalid-fixture-session',url:fixture.origin,
      path:sessionCookie.path,httpOnly:true,sameSite:sessionCookie.sameSite});
    const downgraded=await evaluate(`(async()=>{
      let status;try{await client.listTrash();}catch(error){status=error.status;}
      return {status,state:client.getState(),display:document.querySelector('#session-state').textContent};
    })()`);
    assert.equal(downgraded.status,401);assert.equal(downgraded.state.writable,false);
    assert.ok(!downgraded.state.snapshot?.texts);assert.equal(downgraded.state.pending.text,1);assert.equal(downgraded.display,'public');
    await evaluate('client.close()');
  }, undefined, { origin: fixture.origin });
  console.log('PASS real Chromium: IndexedDB offline reload, ACK reconnect, retained text under peer tombstone, same-origin empty API base, helper401 clears private DOM while retaining draft');
} finally { await fixture.close(); }
