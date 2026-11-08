import assert from 'node:assert/strict';

// The phone check page itself (web/phone-check.mjs), in Safari's engine with
// WebKit's own touch, mouse and keyboard (tests/webkit_native.mjs --device).
// Headless WebKit has no phone keyboard, no picker for a names list, no
// long-press and no system notifications: those are what Tony's phone records.
// This check proves the page records what really happened, step by step, sends
// nothing before the last tap, and posts exactly that as one message, once.
export async function deviceChecks({ check, page, until, view, control, facts, shot, observations }) {
  const tap = async (p, selector) => {
    await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    const b = await p.box(selector); assert.ok(b && b.width > 0 && b.height > 0, `visible ${selector}`);
    const at = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const hit = await p.evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${at.x},${at.y}))`);
    assert.equal(hit, true, `${selector} is not covered where it is tapped`);
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const shown = (p, id) => p.evaluate(`!document.querySelector('#check-${id}').hidden`);
  const posts = p => p.calls.filter(call => call.payload?.kind === 'message.post');

  await check('device the phone check records each step as the phone did it, sends nothing before its last tap, and posts that once', async () => {
    const p = await page('phone-check', null, true, { url: facts.origin + '/?phone-check=' + facts.topic_id });
    assert.equal(await p.evaluate('document.querySelector("#phone-check h1").textContent'), 'Phone check');
    assert.equal(await shown(p, 'names'), false, 'one step at a time: nothing before Start');
    await tap(p, '#check-start');
    await until(() => shown(p, 'names'), 'Start shows the first step');
    assert.match(await p.evaluate('document.querySelector("#phone-check .phone-check-done").textContent'), /first tap by touch/, 'the page saw a touch, not a click');

    // The names list: a name typed in full is recorded as typed, not as picked.
    await tap(p, '#check-name');
    await p.send('Input.insertText', { text: 'aim' });
    assert.equal(await shown(p, 'long-press'), false, 'a value that is no name finishes nothing');
    await p.key('a', 4); await p.send('Input.insertText', { text: 'fable' });
    await until(() => shown(p, 'long-press'), 'the names step finishes on a name');
    assert.match(await p.evaluate('document.querySelector("#check-names .phone-check-done").textContent'), /got fable as asked, by insertText/);

    // Holding to select: WebKit's mouse drag stands in for the hold; the page records the selection and the pointer.
    const span = await p.evaluate(`(()=>{const t=document.querySelector('#check-passage').firstChild,s=t.textContent.indexOf('the harbour lights'),e=s+'the harbour lights'.length-1;
      const box=n=>{const r=document.createRange();r.setStart(t,n);r.setEnd(t,n+1);return r.getBoundingClientRect()};const a=box(s),b=box(e);
      return {from:{x:a.left+1,y:a.top+a.height/2},to:{x:b.right-0.5,y:b.top+b.height/2}}})()`);
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...span.from, button: 'left', clickCount: 1 });
    for (let n = 1; n <= 6; n++) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: span.from.x + (span.to.x - span.from.x) * n / 6, y: span.from.y, button: 'left' });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...span.to, button: 'left', clickCount: 1 });
    assert.equal(await p.evaluate('getSelection().toString()'), 'the harbour lights', 'the native drag selected the asked words');
    await tap(p, '#check-selection');
    await until(() => shown(p, 'keyboard'), 'the selection step finishes on its button');
    assert.match(await p.evaluate('document.querySelector("#check-long-press .phone-check-done").textContent'), /selected "the harbour lights" as asked/);

    // The keyboard: no phone keyboard here, so no resize is seen, and the page says so; the selection is real.
    await tap(p, '#check-writing');
    await p.send('Input.insertText', { text: 'one two three' });
    for (let n = 0; n < 6; n++) await p.key('ArrowLeft');
    for (let n = 0; n < 3; n++) await p.key('ArrowLeft', 8);
    assert.equal(await p.evaluate('(e=>e.value.slice(e.selectionStart,e.selectionEnd))(document.querySelector("#check-writing"))'), 'two');
    await tap(p, '#check-record-keyboard');
    await until(() => shown(p, 'notification'), 'the keyboard step finishes on its button');
    assert.match(await p.evaluate('document.querySelector("#check-keyboard .phone-check-done").textContent'), /\(no resize seen\).*handles selected "two"/);

    // A notification: whatever this browser offers is what is recorded.
    const api = await p.evaluate('typeof Notification === "function" ? "present" : "absent"');
    await tap(p, '#check-notify');
    if (api === 'present') { await until(() => p.evaluate('!document.querySelector(".phone-check-question").hidden'), 'the question follows'); await tap(p, '#check-missed'); }
    await until(() => shown(p, 'colours'), 'the notification step finishes');

    // Reading colours: the page's own cards, measured where they are painted.
    await tap(p, '#check-clear');
    await until(() => shown(p, 'send'), 'the colours step finishes');
    await shot(p, 'phone-check-before-send');
    assert.deepEqual(posts(p), [], 'nothing is sent before the last tap');

    // The first send is lost on the way; the retry is the same operation, recorded once.
    const messagesBefore = (await control({ method: 'counts' })).messages;
    let first = true;
    await p.pw.route('**/api/command', route => { if (first) { first = false; return route.abort('connectionreset'); } return route.continue(); });
    await tap(p, '#check-post');
    await until(() => p.evaluate('/try again/.test(document.querySelector("#check-outcome").textContent) && !document.querySelector("#check-post").disabled'), 'a lost send offers the same send again');
    await tap(p, '#check-post');
    const id = await until(() => p.evaluate('document.querySelector("#phone-check").dataset.sent'), 'the message is recorded');
    assert.equal(await p.evaluate('document.querySelector("#check-outcome").textContent'), 'Sent, and read back from Theseus exactly. Thank you.');
    const sent = posts(p);
    assert.equal(sent.length, 2, 'one lost attempt and one retry');
    assert.equal(sent[0].payload.operation_id, sent[1].payload.operation_id, 'the retry is the same operation');
    assert.deepEqual(sent[1].payload.target, { topic_id: facts.topic_id });
    const message = await view('source', { kind: 'message', id });
    assert.equal(message.body, sent[1].payload.args.body);
    const record = JSON.parse(message.body.split('```json\n')[1].split('\n```')[0]);
    assert.equal(record.page.startPointer, 'touch');
    assert.equal(record.page.actor, facts.actor);
    assert.equal(record.names.value, 'fable'); assert.equal(record.names.inputType, 'insertText');
    assert.equal(record.longPress.selected, 'the harbour lights'); assert.ok(record.longPress.pointerTypes.includes('mouse'), 'the drag was a mouse here, and the record says so');
    assert.deepEqual(record.keyboard.selected, { start: 4, end: 7, text: 'two' }); assert.equal(record.keyboard.resized, false);
    assert.equal(record.notification.api, api);
    assert.equal(record.colours.own.background, 'rgb(0, 0, 0)');
    assert.ok(record.colours.own.contrast >= 4.5 && record.colours.agent.contrast >= 4.5, 'both cards read at 4.5:1 or better');
    assert.equal(record.colours.clear, true);
    assert.equal((await control({ method: 'counts' })).messages, messagesBefore + 1, 'one message, not two');
    observations.push({ name: 'phone check record', record, message: id });
    assert.deepEqual(p.errors, []);
  });

  await check('device at a phone\'s width every phone check control is in reach by touch and nothing scrolls sideways', async () => {
    const p = await page('phone-check-phone', null, true, { url: facts.origin + '/?phone-check=' + facts.topic_id });
    await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    // Every step shown at once, only to measure them.
    await p.evaluate('document.querySelectorAll(".phone-check-step, .phone-check-question").forEach(s => { s.hidden = false; })');
    // The names box is the app's own "Someone else" box, kept as it is so the phone tries the real one;
    // its height is recorded, not held to the rule (docs/experience-guidelines.md lists it as a gap).
    const fit = await p.evaluate(`(()=>{const v=innerWidth,small=[],wide=[];
      for(const e of document.querySelectorAll('#phone-check button, #phone-check input, #phone-check textarea')){const r=e.getBoundingClientRect();if(!r.width)continue;
        if(r.height<44&&e.id!=='check-name')small.push([e.id||e.textContent,Math.round(r.height)]);if(r.left<0||r.right>v+.5)wide.push(e.id||e.textContent)}
      return {sideways:document.scrollingElement.scrollWidth>v,small,wide,names:Math.round(document.querySelector('#check-name').getBoundingClientRect().height)}})()`);
    await shot(p, 'phone-check-phone');
    observations.push({ name: 'phone check at 390', namesBoxHeight: fit.names });
    assert.deepEqual(fit, { sideways: false, small: [], wide: [], names: fit.names }, 'every control at least 44 px tall, inside the width, and no sideways scroll');
    assert.deepEqual(p.errors, []);
  });
}
