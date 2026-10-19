// Khoảnh khắc in a real browser against the real backend, with a fake camera: desktop photobooth (frames, layout,
// countdown, strip), save failure keeps the draft and retries with the same requestId, viewer edit/delete for the owner
// only, phone snap and album, the Lịch deep link, the camera turned off on leaving, and no sideways scroll.
import assert from 'node:assert/strict';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

// Fake camera: a moving canvas stream; every track handed out is kept so the test can see it stopped.
const camera = `(() => {
  window.__tracks = [];
  window.__denyCamera = false;
  const fake = async () => {
    if (window.__denyCamera) throw new DOMException('Permission denied', 'NotAllowedError');
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const ctx = c.getContext('2d'); let t = 0;
    const draw = () => { t = (t + 9) % 360; ctx.fillStyle = 'hsl(' + t + ' 70% 75%)'; ctx.fillRect(0, 0, 640, 480); ctx.fillStyle = '#fff'; ctx.fillRect(60 + t, 140, 160, 160); };
    draw(); setInterval(draw, 80);
    const stream = c.captureStream(15);
    window.__tracks.push(...stream.getTracks());
    return stream;
  };
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = fake;
  else Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: fake } });
})();`;

const fixture = await createNotesFixture({ app: true });
try {
  await withBrowser(async (evaluate, { call }) => {
    const wait = (e, ms = 15000) => evaluate(`(async()=>{const end=Date.now()+${ms};while(!(${e})){if(Date.now()>end)throw Error('timeout '+${JSON.stringify(e)});await new Promise(r=>setTimeout(r,40));}return true;})()`);
    const shown = selector => `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.getClientRects().length).length`;
    const clickText = (selector, text) => evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getClientRects().length&&e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('no button '+${JSON.stringify(text)});b.click();})()`);
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const type = (selector, value) => evaluate(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const size = async (width, height) => { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 640 }); await wait(`innerWidth===${width}`); };
    const layout = () => evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,small:[...document.querySelectorAll('.moments-page button')].filter(e=>e.getClientRects().length&&!e.closest('.moments-cards,.moments-grid')&&(e.getBoundingClientRect().width<44||e.getBoundingClientRect().height<44)).map(e=>e.textContent.trim()||e.getAttribute('aria-label'))})`);
    const login = id => evaluate(`(async()=>{const a=await import('/js/auth.js');await a.logout();await a.login('${id}',${JSON.stringify(fixturePasswords[id])});})()`);
    const cards = shown('.moments-card');
    const open = async ready => { await evaluate("location.hash='garden'"); await wait("!document.querySelector('.moments-page')"); await evaluate("location.hash='moments'"); await wait(ready); };

    await call('Page.addScriptToEvaluateOnNewDocument', { source: camera });
    await evaluate('location.reload()');
    await wait("document.readyState==='complete'");
    await evaluate("window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)))");
    // Record moment POSTs; one switch makes the next one fail like a dropped connection.
    await evaluate("window.__posts=[];window.__failOnce=false;const real=fetch;window.fetch=(url,init={})=>{if(String(url).endsWith('/api/moments')&&init.method==='POST'){__posts.push(JSON.parse(init.body));if(__failOnce){__failOnce=false;return Promise.reject(new TypeError('Failed to fetch'));}}return real(url,init);}");

    // Desktop: photobooth with frame count and layout.
    await size(1440, 1000);
    await login('minhle');
    await open("document.querySelector('.moments-cam video') && document.querySelector('.moments-cam video').readyState>=2");
    assert.equal(await evaluate(cards), 0);
    assert.deepEqual(await layout(), { overflow: false, small: [] }, '1440: no sideways scroll, 44px targets');
    await clickText('.moments-seg button', '3 tấm');
    assert.equal(await evaluate("[...document.querySelectorAll('.moments-seg button')].find(b=>b.textContent==='Lưới 2×2').disabled"), true, 'grid needs 4 frames');
    await clickText('.moments-seg button', '1 tấm');
    assert.equal(await evaluate("[...document.querySelectorAll('.moments-seg button')].filter(b=>['Dọc','Ngang','Lưới 2×2'].includes(b.textContent)).every(b=>b.disabled)"), true, 'one frame has no layout');
    await clickText('.moments-seg button', '2 tấm');
    await clickText('.moments-seg button', 'Ngang');
    assert.equal(await evaluate("document.querySelectorAll('.moments-strip-ph > *').length"), 2);
    await clickText('.moments-page button', '● Chụp 2 tấm');
    await wait("document.querySelector('.moments-shotno')");
    assert.match(await evaluate("document.querySelector('.moments-shotno').textContent"), /^Tấm 1\/2$/);
    await wait("document.querySelector('.moments-review canvas')", 20000);
    assert.equal(await evaluate("document.querySelector('.moments-cam video')?.srcObject?.active ?? false"), false, 'camera stops during review');
    const strip = await evaluate("(({width,height})=>[width,height])(document.querySelector('.moments-review canvas'))");
    assert.deepEqual(strip, [24 * 2 + 2 * 400 + 16, 24 + 300 + 110], 'two frames in a row');
    assert.equal(await evaluate("document.querySelector('#moments-caption').maxLength"), 40);
    await type('#moments-caption', 'Chủ nhật lười');
    assert.equal(await evaluate("document.querySelector('.moments-review .moments-cap').textContent"), 'Chủ nhật lười');

    // Save fails once: the draft stays and the retry reuses the requestId.
    await evaluate('__failOnce=true');
    await clickText('.moments-page button', 'Lưu');
    await wait("document.querySelector('.moments-error')");
    assert.equal(await evaluate("document.querySelector('#moments-caption').value"), 'Chủ nhật lười');
    await clickText('.moments-page button', 'Thử lại');
    await wait(`${cards}===1`);
    const posts = await evaluate('__posts.map(p=>({id:p.requestId,kind:p.kind,head:atob(p.photo.data).slice(0,4),size:atob(p.photo.data).length,thumb:atob(p.thumb.data).length}))');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].id, posts[1].id, 'retry keeps the requestId');
    assert.equal(posts[1].kind, 'booth');
    assert.ok(['RIFF', '\xff\xd8\xff\xe0', '\xff\xd8\xff\xdb'].some(h => posts[1].head.startsWith(h.slice(0, 2))), `image header ${JSON.stringify(posts[1].head)}`);
    assert.ok(posts[1].size <= 300_000 && posts[1].thumb <= 30_000, `sizes ${posts[1].size}/${posts[1].thumb}`);
    await wait("document.querySelector('.moments-cam video')?.srcObject?.active");

    // Viewer: the owner edits the caption.
    await click('.moments-card');
    await wait("document.querySelector('.moments-viewer')");
    assert.equal(await evaluate("document.activeElement.textContent"), '✕');
    await clickText('.moments-viewer button', 'Sửa dòng chữ');
    await type('.moments-viewer input', 'Chủ nhật siêng');
    await clickText('.moments-viewer button', 'Lưu');
    await wait("document.querySelector('.moments-viewer .moments-cap')?.textContent==='Chủ nhật siêng'");
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await wait("!document.querySelector('.moments-viewer')");

    // Yến sees the moment but cannot change it.
    await login('haiyen');
    await open(`${cards}===1`);
    await click('.moments-card');
    await wait("document.querySelector('.moments-viewer')");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.moments-viewer button')].map(b=>b.textContent.trim())").then(list => list.filter(t => ['Sửa dòng chữ', 'Xóa'].includes(t))), []);
    await click('.moments-viewer [aria-label="Đóng"]');

    // Phone: square camera, snap, save, album in both views.
    await login('minhle');
    await size(390, 844);
    await open("document.querySelector('.moments-finder video') && document.querySelector('.moments-finder video').readyState>=2");
    assert.equal(await evaluate("document.querySelector('.moments-booth')"), null, 'no photobooth on the phone');
    assert.deepEqual(await layout(), { overflow: false, small: [] }, '390: no sideways scroll, 44px targets');

    // A picked photo keeps its ratio; "Chọn lại" with no new file brings the camera back.
    await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=400;c.height=300;c.getContext('2d').fillRect(0,0,400,300);
      const blob=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'a.png',{type:'image/png'}));
      const input=document.querySelector('.moments-capture input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change'));})()`);
    await wait("document.querySelector('.moments-review canvas')?.width===400");
    assert.equal(await evaluate("document.querySelector('.moments-review canvas').height"), 300);
    await click('.moments-round[aria-label="Chọn lại"]');
    await wait("document.querySelector('.moments-finder video')?.srcObject?.active", 5000);

    await click('.moments-shutter');
    await wait("document.querySelector('.moments-review canvas')");
    // While a photo waits to be saved, nothing on the page can throw it away.
    assert.deepEqual(await evaluate(`[${shown('.moments-count')},${shown('.moments-swipe')}]`), [0, 0], 'review hides the album shortcuts');
    await evaluate(`(()=>{const t=document.querySelector('.moments-capture');const at=y=>new Touch({identifier:1,target:t,clientX:100,clientY:y});
      t.dispatchEvent(new TouchEvent('touchstart',{touches:[at(600)],changedTouches:[at(600)],bubbles:true}));
      t.dispatchEvent(new TouchEvent('touchend',{touches:[],changedTouches:[at(300)],bubbles:true}));})()`);
    assert.ok(await evaluate("!!document.querySelector('.moments-review canvas')"), 'swipe up keeps the review');
    assert.deepEqual(await evaluate("(({width,height})=>[width,height])(document.querySelector('.moments-review canvas'))"), [1080, 1080]);
    await type('#moments-caption', 'Trà sữa nè');
    assert.equal(await evaluate("document.querySelector('.moments-savebtn').getAttribute('aria-label')"), 'Lưu');
    await click('.moments-savebtn');
    await wait("document.querySelector('.moments-count')?.textContent==='Đã lưu · 2'");
    await click('.moments-count');
    await wait(`${shown('.moments-feed article')}===2`);
    await clickText('.moments-seg button', 'Lưới');
    await wait("document.querySelector('.moments-grid')");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.moments-grid')).gridTemplateColumns.split(' ').length"), 3);
    assert.deepEqual(await layout(), { overflow: false, small: [] }, '390 album');
    await size(320, 740);
    assert.deepEqual(await layout(), { overflow: false, small: [] }, '320 album');

    // Delete from the phone feed, with the in-page confirmation.
    await clickText('.moments-seg button', 'Từng tấm');
    const before = await evaluate(shown('.moments-feed article'));
    await clickText('.moments-feed button', 'Xóa');
    await wait("document.querySelector('.moments-viewer [role=alertdialog]')");
    await clickText('.moments-viewer button', 'Xóa hẳn');
    await wait(`${shown('.moments-feed article')}===${before - 1}`);

    // Lịch deep link: the key opens that moment's viewer.
    const id = await evaluate("fetch('/api/moments',{credentials:'include'}).then(r=>r.json()).then(d=>d.moments[0].id)");
    await evaluate(`sessionStorage.setItem('homie.moments.focus',${JSON.stringify(id)})`);
    const tracksBefore = await evaluate('__tracks.length');
    await open(`document.querySelector('.moments-viewer')?.dataset.id===${JSON.stringify(id)}`);
    assert.equal(await evaluate('__tracks.length'), tracksBefore, 'opening a moment from Lịch does not start the camera');
    assert.equal(await evaluate("sessionStorage.getItem('homie.moments.focus')"), null);

    // Leaving the tab turns every camera track off.
    await evaluate("location.hash='garden'");
    await wait("!document.querySelector('.moments-page')");
    assert.ok(await evaluate("__tracks.length>0 && __tracks.every(t=>t.readyState==='ended')"), 'camera off after leaving');

    // No camera permission: a message, and picking a file still works.
    await evaluate('__denyCamera=true');
    await size(1440, 1000);
    await open("document.querySelector('.moments-nocam')");
    assert.ok(await evaluate("[...document.querySelectorAll('.moments-nocam button')].some(b=>b.textContent==='Chọn ảnh từ máy')"));

    assert.deepEqual(await evaluate('__errors'), [], 'No page errors');
  }, undefined, { origin: fixture.origin });
} finally { await fixture.close(); }
console.log('Khoảnh khắc: photobooth frames and layouts, failed save keeps the draft, owner-only edit/delete, phone snap and album, Lịch deep link, camera off on leave, no-camera message and layout passed');
