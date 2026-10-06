// Hũ in a real browser against the real backend: phone shows one jar, desktop three; drop, undo, feeling form,
// ball sheet, kiss back, failure and retry, private feelings, keyboard, reduced motion and no sideways scroll.
import assert from 'node:assert/strict';
import { withBrowser } from './helpers/notes-browser.mjs';
import { createNotesFixture, fixturePasswords } from './helpers/notes-fixture.mjs';

const fixture = await createNotesFixture({ app: true });
try {
  await withBrowser(async (evaluate, { call }) => {
    const wait = e => evaluate(`(async()=>{const end=Date.now()+15000;while(!(${e})){if(Date.now()>end)throw Error('timeout '+${JSON.stringify(e)});await new Promise(r=>setTimeout(r,40));}return true;})()`);
    const shown = selector => `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').length`;
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const clickText = (selector, text) => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`);
    const size = async (width, height) => { await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 640 }); await wait(`innerWidth===${width}`); };
    const layout = () => evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,small:[...document.querySelectorAll('.jar-page button,.jar-toast button')].filter(e=>!e.classList.contains('jar-ball')&&e.getClientRects().length&&(e.getBoundingClientRect().width<44||e.getBoundingClientRect().height<44)).map(e=>e.className+':'+e.textContent)})`);
    const server = query => evaluate(`fetch('/api/jar${query}',{credentials:'include'}).then(r=>r.json()).then(d=>d.items.map(i=>[i.kind,i.ownerId,i.visibility]))`);
    const login = async id => { await evaluate(`(async()=>{await (await import('/js/auth.js')).login('${id}',${JSON.stringify(fixturePasswords[id])});})()`); };
    const ready = "document.querySelector('.jar-act.kiss') && !document.querySelector('.jar-act.kiss').disabled";
    const open = async () => { await evaluate("location.hash='garden'"); await wait("!document.querySelector('.jar-page')"); await evaluate("location.hash='jar'"); await wait(ready); };
    const errors = [];
    await evaluate("window.__errors=[];addEventListener('error',e=>__errors.push(String(e.message)));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)))");
    // One switch to make the next jar writes fail like a dropped connection.
    await evaluate("window.__failJar=false;const real=fetch;window.fetch=(url,init={})=>__failJar&&String(url).includes('/api/jar')&&init.method&&init.method!=='GET'?Promise.reject(new TypeError('Failed to fetch')):real(url,init)");

    // Phone 390: one jar at a time, the tab picks it.
    await size(390, 844);
    await login('minhle');
    await open();
    assert.equal(await evaluate("document.querySelector('.jar-empty:not([hidden])').textContent"), 'Bình còn trống.\nThả viên đầu tiên nhé.');
    assert.deepEqual(await evaluate(`[${shown('.jar-stage')},${shown('.jar-act')}]`), [1, 1], '390: one jar, one button');
    assert.equal(await evaluate("document.querySelector('.jar-tabs').getAttribute('aria-label')"), 'Chọn bình');
    assert.deepEqual(await layout(), { overflow: false, small: [] }, '390: no sideways scroll, 44px targets');
    assert.equal(await evaluate("document.querySelector('.jar-act.kiss').textContent"), 'Hôn Yến');
    // The phone page fits one screen; the list and the time range open in a sheet and go back when it closes.
    for (const [width, height] of [[390, 664], [360, 640], [390, 844]]) {
      await size(width, height);
      await wait(`innerHeight===${height}`);
      assert.ok(await evaluate('document.documentElement.scrollHeight<=innerHeight'), `${width}x${height} has no page scroll`);
    }
    assert.deepEqual(await evaluate(`[${shown('.jar-page>.jar-list')},${shown('.jar-chip')}]`), [0, 0], 'Phone page hides the list and range');
    await click('.jar-list-btn');
    await wait("document.querySelector('dialog.jar-list-sheet[open] .jar-chips') && document.querySelector('dialog.jar-list-sheet .jar-list')");
    assert.equal(await evaluate("document.querySelector('dialog.jar-list-sheet h2').textContent"), 'Trong bình nụ hôn');
    await evaluate("document.querySelector('dialog.jar-list-sheet').close()");
    await wait("!document.querySelector('dialog.jar-list-sheet') && document.querySelector('.jar-page>.jar-list') && document.querySelector('.jar-top>.jar-chips')");

    // Kiss: the ball flies (a ghost appears), lands, the server answer clears "pending", toast offers undo.
    await click('.jar-act.kiss');
    assert.equal(await evaluate("!!document.querySelector('.jar-fly') && document.querySelector('.jar-stage[data-jar=kiss]').classList.contains('open')"), true, 'The ball flies and the lid opens');
    await wait("document.querySelector('.jar-stage[data-jar=kiss] .jar-ball:not(.pending)') && document.querySelector('.jar-toast')");
    assert.equal(await evaluate("document.querySelector('.jar-toast span').textContent"), 'Đã thả một nụ hôn vào bình cho Yến.');
    assert.equal(await evaluate("document.querySelector('.jar-row .t').textContent"), 'Minh hôn Yến');
    assert.match(await evaluate("document.querySelector('.jar-stage[data-jar=kiss] .jar-ball').getAttribute('aria-label')"), /^Nụ hôn, Minh gửi Yến, \d+\/\d+\/\d{4} lúc \d\d:\d\d$/);
    await wait("!document.querySelector('.jar-ball.drop') && !document.querySelector('.jar-fly')");
    // Undo takes it out on the server; undoing that puts it back.
    await click('.jar-toast button');
    await wait("!document.querySelector('.jar-stage[data-jar=kiss] .jar-ball') && document.querySelector('.jar-toast')?.textContent.includes('Đã lấy viên này ra khỏi bình.')");
    assert.deepEqual(await server(''), []);
    await click('.jar-toast button');
    await wait("document.querySelector('.jar-stage[data-jar=kiss] .jar-ball')");
    assert.deepEqual(await server(''), [['kiss', 'minhle', 'shared']]);

    // Failure: the ball shakes away, a red toast retries with the same requestId (no duplicate).
    await clickText('.jar-tab', 'Xin lỗi'); await wait(`${shown('.jar-stage[data-jar=sorry]')}===1`);
    await evaluate('__failJar=true');
    await click('.jar-act.sorry');
    await wait("document.querySelector('.jar-toast.err')");
    assert.equal(await evaluate("document.querySelector('.jar-toast.err span').textContent"), 'Chưa gửi được lời xin lỗi. Kiểm tra mạng rồi thử lại.');
    assert.equal(await evaluate("document.querySelectorAll('.jar-stage[data-jar=sorry] .jar-ball').length"), 0);
    await evaluate('__failJar=false');
    await click('.jar-toast.err button');
    await wait("document.querySelector('.jar-stage[data-jar=sorry] .jar-ball:not(.pending)') && !document.querySelector('.jar-toast.err')");
    assert.equal((await server('?kind=sorry')).length, 1);

    // Feeling form: sliders with words, suggestions follow the quadrant, private by default.
    await clickText('.jar-tab', 'Cảm xúc'); await click('.jar-act.mood');
    await wait("document.querySelector('dialog.jar-sheet[open]')");
    assert.equal(await evaluate("document.querySelector('.jar-sheet h2').textContent"), 'Bạn đang thấy thế nào?');
    assert.equal(await evaluate("document.activeElement.type"), 'range', 'Focus starts on the first slider');
    await evaluate("(()=>{const [v,e]=document.querySelectorAll('.jar-sheet input[type=range]');v.value=-60;v.dispatchEvent(new Event('input',{bubbles:true}));e.value=10;e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.jar-sheet input[type=range]')].map(e=>e.getAttribute('aria-valuetext'))"), ['Rất khó chịu', 'Rất uể oải']);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.jar-sugg button')].map(e=>e.textContent)"), ['Buồn', 'Mệt', 'Nhớ', 'Chán']);
    await clickText('.jar-sugg button', 'Chán');
    await evaluate("document.querySelector('.jar-sheet textarea').value='Ngủ không đủ';document.querySelector('.jar-sheet [name=visibility][value=private]').checked");
    // A failed save reopens the form with everything kept.
    await evaluate('__failJar=true');
    await evaluate("document.querySelector('.jar-sheet form,.jar-sheet .jar-sheet-box').requestSubmit()");
    await wait("document.querySelector('.jar-sheet .jar-alert:not([hidden])')");
    assert.deepEqual(await evaluate("[document.querySelector('.jar-sheet [name=label]').value,document.querySelector('.jar-sheet textarea').value,document.querySelector('.jar-sheet input[type=range]').value]"), ['Chán', 'Ngủ không đủ', '-60']);
    await evaluate('__failJar=false');
    await evaluate("document.querySelector('.jar-sheet .jar-sheet-box').requestSubmit()");
    await wait("!document.querySelector('dialog.jar-sheet') && document.querySelector('.jar-stage[data-jar=mood] .jar-ball:not(.pending)')");
    assert.equal(await evaluate("document.querySelector('.jar-row .t').textContent"), 'Minh · Chán Chỉ mình bạnRất khó chịu, năng lượng rất uể oải');
    assert.deepEqual(await server('?kind=mood'), [['mood', 'minhle', 'private']]);

    // Ball sheet: open from the ball, Esc closes and focus returns to the ball; share with Yến.
    await click('.jar-stage[data-jar=mood] .jar-ball'); await wait("document.querySelector('dialog.jar-sheet[open]')");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.jar-sheet .jar-actions button')].map(e=>e.textContent)"), ['Sửa', 'Cho Yến xem', 'Lấy ra khỏi bình']);
    assert.equal(await evaluate("document.querySelector('.jar-stage[data-jar=mood] .jar-ball').classList.contains('lifted')"), true);
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait("!document.querySelector('dialog.jar-sheet') && document.activeElement?.classList.contains('jar-ball')");
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await call('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter' });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await wait("document.querySelector('dialog.jar-sheet[open]')");
    await clickText('.jar-sheet button', 'Cho Yến xem');
    await wait("document.querySelector('.jar-toast')?.textContent.includes('Yến giờ xem được cảm xúc này.')");
    assert.deepEqual(await server('?kind=mood'), [['mood', 'minhle', 'shared']]);
    // A second, private feeling that Yến must never see.
    await evaluate(`fetch('/api/jar',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Requested-With':'Homie'},body:JSON.stringify({requestId:crypto.randomUUID(),kind:'mood',valence:0.5,energy:0.5,label:'Bí mật'})})`);

    // Session ends while the page is open: the jars leave the screen.
    await evaluate("(async()=>{await (await import('/js/auth.js')).logout();})()");
    await wait("document.querySelector('.jar-gone') || !document.querySelector('.jar-stage')");
    assert.equal(await evaluate("document.body.textContent.includes('Bí mật') || document.body.textContent.includes('Chán')"), false);

    // Yến: sees Minh's kiss, apology and shared feeling, never the private one; kisses back from the sheet.
    await login('haiyen');
    await open();
    assert.deepEqual((await server('')).map(item => item.join(':')).sort(), ['kiss:minhle:shared', 'mood:minhle:shared', 'sorry:minhle:shared']);
    assert.equal(await evaluate("document.body.textContent.includes('Bí mật')"), false, 'Private feeling of the partner never shows');
    await click('.jar-stage[data-jar=kiss] .jar-ball'); await wait("document.querySelector('dialog.jar-sheet[open]')");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.jar-sheet .jar-actions button')].map(e=>e.textContent)"), ['Hôn lại Minh']);
    await clickText('.jar-sheet button', 'Hôn lại Minh');
    await wait("document.querySelectorAll('.jar-stage[data-jar=kiss] .jar-ball:not(.pending)').length===2 && document.querySelector('.jar-toast')?.textContent.includes('cho Minh')");
    // An apology received has no button.
    await clickText('.jar-tab', 'Xin lỗi');
    await click('.jar-stage[data-jar=sorry] .jar-ball'); await wait("document.querySelector('dialog.jar-sheet[open]')");
    assert.equal(await evaluate("document.querySelectorAll('.jar-sheet .jar-actions').length"), 0);
    await evaluate("document.querySelector('dialog.jar-sheet').close()");
    // Swipe on the jar changes jars (sorry -> mood).
    await evaluate("(()=>{const s=document.querySelector('.jar-stage.is-current'),r=s.getBoundingClientRect(),o={bubbles:true,pointerId:1,clientY:r.top+40};s.dispatchEvent(new PointerEvent('pointerdown',{...o,clientX:r.right-20}));s.dispatchEvent(new PointerEvent('pointerup',{...o,clientX:r.left+20}));})()");
    assert.equal(await evaluate("document.querySelector('.jar-stage.is-current').dataset.jar"), 'mood');

    // Keyboard: arrows move through the balls (roving tabindex).
    await clickText('.jar-tab', 'Nụ hôn');
    await evaluate("document.querySelector('.jar-stage[data-jar=kiss] .jar-ball[tabindex=\"0\"]').focus()");
    const key = (k, code) => call('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code });
    await key('End', 35);
    const last = await evaluate('document.activeElement.dataset.id');
    await key('Home', 36);
    const first = await evaluate('document.activeElement.dataset.id');
    await key('ArrowRight', 39);
    assert.notEqual(first, last);
    assert.equal(await evaluate('document.activeElement.dataset.id'), last, 'Arrow moves to the next ball');
    assert.equal(await evaluate("document.querySelectorAll('.jar-stage[data-jar=kiss] .jar-ball[tabindex=\"0\"]').length"), 1);

    // Reduced motion: no flight, no lid; the ball fades in place.
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await click('.jar-act.kiss');
    assert.equal(await evaluate("!document.querySelector('.jar-fly') && !document.querySelector('.jar-stage.open') && document.querySelectorAll('.jar-ball.fadein').length===1"), true);
    await wait("document.querySelectorAll('.jar-stage[data-jar=kiss] .jar-ball:not(.pending)').length===3");
    await call('Emulation.setEmulatedMedia', { features: [] });

    // Desktop 1440: three jars on the shelf; the tabs only pick the list.
    await size(1440, 1000);
    await open();
    assert.deepEqual(await evaluate(`[${shown('.jar-stage')},${shown('.jar-act')},${shown('.jar-list-btn')}]`), [3, 3, 0], '1440: three jars and buttons, list on the page');
    assert.equal(await evaluate("document.querySelector('.jar-tabs').getAttribute('aria-label')"), 'Danh sách của bình');
    await clickText('.jar-tab', 'Xin lỗi');
    assert.equal(await evaluate("document.querySelector('.jar-list h2').textContent"), 'Trong bình xin lỗi');
    assert.equal(await evaluate(shown('.jar-stage')), 3);
    assert.deepEqual(await layout(), { overflow: false, small: [] }, '1440: no sideways scroll, 44px targets');
    // Range chips reload: "7 ngày" still holds today's balls.
    await clickText('.jar-chip', '7 ngày'); await wait(`${ready} && document.querySelector('.jar-chip[aria-pressed=true]').textContent==='7 ngày'`);
    assert.equal(await evaluate("document.querySelectorAll('.jar-stage[data-jar=kiss] .jar-ball').length"), 3);
    await size(320, 740); await wait(ready);
    assert.deepEqual(await layout(), { overflow: false, small: [] }, '320: no sideways scroll');

    errors.push(...await evaluate('__errors'));
    assert.deepEqual(errors, [], 'No page errors');
  }, undefined, { origin: fixture.origin });
} finally { await fixture.close(); }
console.log('Hũ: phone one jar, desktop three, drop and undo, failure retry, feeling form, ball sheet, kiss back, privacy, keyboard, reduced motion and layout passed.');
