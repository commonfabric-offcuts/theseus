// New topic from an outcome page, against the real HTTP adapter and Core
// opening commands (tests/fixtures/ui_http.py), in one isolated headless
// Chrome for Testing. Every act is a CDP Input event (mouse, key, touch or
// insertText); no handler is invoked directly. The browser closes through
// Browser.close and the fixture through stdin EOF.
//
//   node tests/reader_openings_native.mjs \
//     "/…/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" /absolute/evidence/dir [case-regex]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [chromePath, evidencePath, caseFilter] = process.argv.slice(2);
assert.ok(chromePath?.endsWith('/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), 'explicit Chrome for Testing required');
assert.ok(evidencePath && path.isAbsolute(evidencePath), 'an absolute evidence directory is required');
await mkdir(evidencePath, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const trace = process.env.AIM_NATIVE_TRACE ? (...parts) => process.stderr.write(`[trace ${new Date().toISOString()}] ${parts.join(' ')}\n`) : () => {};
async function until(probe, description, timeout = 8000) {
  trace('until', description);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await sleep(25); }
  throw Error(`Timed out: ${description}`);
}

// The fixture: actual Store and HTTP adapter; stdin is its private control channel.
const fixture = spawn('/usr/bin/python3', ['-I', '-B', 'tests/fixtures/ui_http.py', '--freshness', '--live'], { cwd: root });
let fixtureSerial = 0, fixtureErrors = '';
const requests = new Map();
fixture.stderr.on('data', data => { fixtureErrors += data; });
createInterface({ input: fixture.stdout }).on('line', line => {
  const result = JSON.parse(line), request = requests.get(result.id); requests.delete(result.id);
  if (result.failure) request.reject(Error(result.failure)); else request.resolve(result.answer);
});
const fixtureExit = new Promise(resolve => fixture.once('exit', code => {
  for (const request of requests.values()) request.reject(Error(`Fixture exited ${code}: ${fixtureErrors}`));
  resolve(code);
}));
const control = data => new Promise((resolve, reject) => {
  trace('control', data.method);
  const id = ++fixtureSerial; requests.set(id, { resolve, reject });
  fixture.stdin.write(JSON.stringify({ ...data, id }) + '\n');
});

const hashes = {};
for (const filename of ['web/app.mjs', 'web/opening.mjs', 'web/opening-view.mjs', 'web/opening-store.mjs', 'web/topic-navigation.mjs',
  'web/index.html', 'web/aim.css', 'aim_next/openings.py', 'aim_next/server.py', 'tests/fixtures/ui_http.py', 'tests/reader_openings_native.mjs']) {
  hashes[filename] = createHash('sha256').update(await readFile(path.join(root, filename))).digest('hex');
}
const results = [], observations = [], tapSpacing = [];
const profile = await mkdtemp(path.join(os.tmpdir(), 'aim-reader-openings-'));
let chrome, chromeExit, socket, cdp, facts, chromeVersion, fixtureExitCode, finalHealth;
const pages = new Set();
try {
  facts = await control({ method: 'ready' });
  chrome = spawn(chromePath, ['--headless=new', '--use-mock-keychain', '--password-store=basic', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  chromeExit = new Promise(resolve => chrome.once('exit', resolve));
  const active = await until(async () => { try { return await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); } catch { return null; } }, 'CFT DevTools endpoint');
  const [port, endpoint] = active.trim().split('\n');
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let serial = 0;
  const waiting = new Map(), listeners = new Map();
  socket.addEventListener('message', event => {
    const packet = JSON.parse(event.data);
    if (!packet.id) {
      if (packet.method === 'Target.targetDestroyed') pages.delete(packet.params.targetId);
      listeners.get(packet.sessionId)?.(packet); return;
    }
    const waiter = waiting.get(packet.id); waiting.delete(packet.id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    if (packet.error) waiter.reject(Error(JSON.stringify(packet.error))); else waiter.resolve(packet.result);
  });
  cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial; trace('cdp', method);
    const timer = setTimeout(() => { waiting.delete(id); reject(Error(`CDP timed out: ${method}`)); }, 10000);
    waiting.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  chromeVersion = (await cdp('Browser.getVersion')).product;

  const view = async (name, args) => (await fetch(facts.origin + '/api/view', { method: 'POST', headers: {
    Authorization: `Bearer ${facts.token}`, Origin: facts.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) })).json();

  let context = null;
  const page = async (label, { browserContextId = context, mobile = false } = {}) => {
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', ...(browserContextId ? { browserContextId } : {}) }); pages.add(targetId);
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp(method, params, sessionId);
    const errors = [], dialogs = [], calls = [];
    listeners.set(sessionId, packet => {
      if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails);
      if (packet.method === 'Page.javascriptDialogOpening') { dialogs.push(packet.params); send('Page.handleJavaScriptDialog', { accept: false }).catch(error => errors.push({ message: error.message })); }
      if (packet.method === 'Network.requestWillBeSent' && packet.params.request.url.startsWith(facts.origin + '/api/')) {
        let payload = null; try { payload = JSON.parse(packet.params.request.postData); } catch {}
        calls.push({ url: packet.params.request.url, kind: payload?.kind ?? null, name: payload?.name ?? null, operation_id: payload?.operation_id ?? null, payload });
      }
    });
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    // Passive record of trusted input reaching the page, for failure evidence only.
    if (!process.env.AIM_NATIVE_NO_INPUT_RECORD) await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__inputs=[];for(const t of ['pointerdown','pointerup','touchstart','touchend','click'])document.addEventListener(t,e=>{__inputs.push([t,e.target.className||e.target.id,e.isTrusted,Math.round(e.clientX??e.changedTouches?.[0]?.clientX??-1),Math.round(e.clientY??e.changedTouches?.[0]?.clientY??-1),Math.round(performance.now())]);if(__inputs.length>40)__inputs.shift();},true);` });
    const evaluate = async expression => {
      const answer = await send('Runtime.evaluate', { expression: `(async()=>(${expression}))()`, returnByValue: true, awaitPromise: true });
      if (answer.exceptionDetails) throw Error(JSON.stringify(answer.exceptionDetails));
      return answer.result.value;
    };
    const metrics = async small => {
      await send('Emulation.setDeviceMetricsOverride', small ? { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setTouchEmulationEnabled', { enabled: small });
    };
    await metrics(mobile);
    const box = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest'});const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,viewportWidth:innerWidth,viewportHeight:innerHeight}})()`);
    let lastPoint = null;
    const target = async selector => {
      const b = await box(selector);
      assert.ok(b && b.width > 0 && b.height > 0, `visible target ${selector}`);
      const x = b.x + Math.min(12, b.width / 2), y = b.y + b.height / 2;
      assert.ok(x >= 0 && y >= 0 && x < b.viewportWidth && y < b.viewportHeight, `target ${selector} is inside the viewport`);
      // The point actually hits the target (or its descendant), not a covering element.
      assert.equal(await evaluate(`(()=>{const t=document.querySelector(${JSON.stringify(selector)}),h=document.elementFromPoint(${x},${y});return Boolean(h&&(t===h||t.contains(h)||h.contains(t)&&h.tagName==='LABEL'))})()`), true, `pointer reaches ${selector}`);
      lastPoint = { selector, x, y, box: b, at: Date.now() };
      return { x, y };
    };
    const click = async selector => {
      const { x, y } = await target(selector);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    };
    // Chrome classifies a second tap near the first within its double-tap
    // window as a double tap, not a click. Block-centred targets on successive
    // pages share a point, so a tap there waits out that window, as a person's would.
    let lastTap = null;
    const tap = async selector => {
      const { x, y } = await target(selector);
      if (lastTap && Math.hypot(x - lastTap.x, y - lastTap.y) < 60 && !process.env.AIM_NATIVE_NO_TAP_SPACING) {
        const wait = 500 - (Date.now() - lastTap.at);
        if (wait > 0) { tapSpacing.push({ page: label, selector, waitedMs: wait }); await sleep(wait); }
      }
      lastTap = { x, y, at: Date.now() };
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const key = async (name, modifiers = 0) => {
      const code = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8 }[name] ?? name.toUpperCase().charCodeAt(0);
      const data = { key: name, code: name.length === 1 ? `Key${name.toUpperCase()}` : name, windowsVirtualKeyCode: code, modifiers };
      const text = name === 'Enter' && !modifiers ? '\r' : null;
      await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...data, ...(text ? { text, unmodifiedText: text } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...data });
    };
    // Real per-character key events for short text: keydown, keypress/input, keyup.
    const typeKeys = async text => {
      for (const ch of text) {
        const space = ch === ' ';
        const data = { key: ch, code: space ? 'Space' : /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : /[0-9]/.test(ch) ? `Digit${ch}` : '', windowsVirtualKeyCode: space ? 32 : ch.toUpperCase().charCodeAt(0), modifiers: /[A-Z]/.test(ch) ? 8 : 0 };
        await send('Input.dispatchKeyEvent', { type: 'keyDown', ...data, text: ch, unmodifiedText: ch.toLowerCase() });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...data });
      }
    };
    const insert = text => send('Input.insertText', { text });
    const shot = async name => {
      const image = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(evidencePath, name + '.png'), Buffer.from(image.data, 'base64'));
    };
    const goto = async url => {
      await send('Page.navigate', { url });
      await ready();
    };
    const ready = () => until(() => evaluate('document.readyState!=="loading" && (document.body?.dataset.ready==="true" || Boolean(document.querySelector("#app-status") && !document.querySelector("#app-status").hidden && document.querySelector("#app-status").textContent))').catch(() => false), 'application ready ' + label);
    // A page whose browser context was already disposed is gone; only that answer is accepted here.
    const close = async () => {
      if (pages.delete(targetId)) await cdp('Target.closeTarget', { targetId }).catch(error => { if (!/No target with given id/.test(error.message)) throw error; });
      listeners.delete(sessionId);
    };
    return { label, get lastPoint() { return lastPoint; }, targetId, send, evaluate, metrics, box, click, tap, key, typeKeys, insert, shot, goto, ready, close, errors, dialogs, calls };
  };

  const check = async (name, action) => {
    if (caseFilter && !new RegExp(caseFilter).test(name)) return;
    const started = Date.now();
    context = (await cdp('Target.createBrowserContext')).browserContextId;
    const created = [];
    const own = async (...args) => { const p = await page(...args); created.push(p); return p; };
    try {
      await action(own);
      for (const p of created) {
        assert.deepEqual(p.errors, [], `no browser exceptions on ${p.label}`);
        assert.deepEqual(p.dialogs, [], `no dialog on ${p.label}`);
      }
      results.push({ name, passed: true, ms: Date.now() - started });
    } catch (error) {
      const diagnostics = [];
      for (const p of created) {
        let state;
        try { state = await p.evaluate('({url:location.href,ready:document.body?.dataset.ready,status:document.querySelector("#opening-save-state")?.textContent,notice:document.querySelector("#opening-notice")?.textContent,app:document.querySelector("#app-status")?.textContent,nav:document.querySelector("#topic-navigation-status")?.textContent,outcome:document.querySelector("#opening-outcome")?.textContent,unfinished:document.querySelector("#unfinished-work")?.textContent,readerOpen:document.querySelector("#reader")?.open,inputs:window.__inputs,now:Math.round(performance.now()),source:document.querySelector("#source-body")?.textContent,messages:[...document.querySelectorAll("#messages [data-id]")].map(m=>m.dataset.id),focus:document.activeElement?.id||document.activeElement?.className})'); }
        catch (e) { state = { diagnosticError: e.message }; }
        let point = null;
        try { const l = p.lastPoint; point = l && { ...l, now: await p.evaluate(`(()=>{const t=document.querySelector(${JSON.stringify(l.selector)}),b=t?.getBoundingClientRect(),h=document.elementFromPoint(${l.x},${l.y});return {box:b&&[b.x,b.y,b.width,b.height],scrollY,hit:h&&(h.id||h.className||h.tagName),inside:Boolean(t&&h&&(t===h||t.contains(h)))}})()`) }; } catch (e) { point = { error: e.message }; }
        diagnostics.push({ page: p.label, point, state, errors: p.errors, dialogs: p.dialogs, calls: p.calls });
        try { await p.shot('failed-' + results.length + '-' + p.label); } catch {}
      }
      results.push({ name, passed: false, error: error.stack, diagnostics, ms: Date.now() - started });
    } finally {
      for (const p of created) {
        observations.push({ case: name, page: p.label, commands: p.calls.filter(c => c.kind).map(c => c.kind) });
        await p.close();
      }
      await cdp('Target.disposeBrowserContext', { browserContextId: context }); context = null;
    }
    process.stdout.write(JSON.stringify({ name, passed: results.at(-1).passed, ...(results.at(-1).passed ? {} : { error: results.at(-1).error }) }) + '\n');
  };

  // Shared helpers over one page.
  const route = p => p.evaluate('Object.fromEntries(new URL(location.href).searchParams)');
  const status = p => p.evaluate('document.querySelector("#opening-save-state").textContent');
  const fields = p => p.evaluate('({title:document.querySelector("#opening-title-input").value,body:document.querySelector("#opening-body").value,checked:[...document.querySelectorAll("#opening-members button[data-key][aria-pressed=true]")].map(b=>b.dataset.key),chips:[...document.querySelectorAll("#opening-members [data-key][aria-pressed=true]")].map(c=>c.dataset.key)})');
  const deviceRows = p => p.evaluate(`(async()=>{
    if(!(await indexedDB.databases()).some(d=>d.name==='aim-next-openings'))return [];
    return await new Promise((resolve,reject)=>{const r=indexedDB.open('aim-next-openings');r.onerror=()=>reject(r.error);
      r.onsuccess=()=>{const d=r.result,t=d.transaction('openings');t.objectStore('openings').getAll().onsuccess=e=>resolve(e.target.result);t.oncomplete=()=>d.close();};});
  })()`);
  const outcomeReady = (p, workspace) => until(() => p.evaluate(`document.body.dataset.ready==="true" && new URL(location.href).searchParams.get("workspace")===${JSON.stringify(workspace)} && !new URL(location.href).searchParams.has("opening") && !document.querySelector("#new-topic").disabled`).catch(() => false), 'outcome page ' + workspace);
  const openingReady = p => until(() => p.evaluate('document.body.dataset.ready==="true" && new URL(location.href).searchParams.has("opening") && Boolean(document.querySelector("#opening-title-input"))').catch(() => false), 'opening page');
  const membersReady = (p, agent) => until(() => p.evaluate(`Boolean(document.querySelector('#opening-members button[data-key=${JSON.stringify(agent)}]'))`), 'outcome member choices');
  // New topic is one title line now; the full opening page is where a topic
  // started before is resumed, reached by its link, as Resume reaches it.
  const newOpening = async (p, workspace) => {
    const ids = { workspace, opening: randomUUID(), opening_topic: randomUUID() };
    await p.goto(facts.origin + '/?' + new URLSearchParams(ids)); await openingReady(p);
    return ids;
  };
  const saved = p => until(async () => (await status(p)) === 'Saved', 'status reaches Saved', 10000);
  const topicOpened = async (p, topicId, title, body) => {
    await until(() => p.evaluate(`document.body.dataset.ready==="true" && new URL(location.href).searchParams.get("topic")===${JSON.stringify(topicId)}`).catch(() => false), 'new topic page');
    assert.equal(await p.evaluate('document.querySelector("#topic-title").textContent'), title, 'topic header shows the opening title');
    const message = await until(() => p.evaluate(`(()=>{const m=[...document.querySelectorAll('#messages [data-id]')].find(e=>e.textContent.includes(${JSON.stringify(body.split('\n')[0])}));return m?m.dataset.id:null})()`), 'the opening message in the topic');
    await p[p.touch ? 'tap' : 'click'](`#messages [data-id="${message}"]`);
    await until(() => p.evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent===${JSON.stringify(body)}`), 'Reader shows the exact opening message');
    await until(() => p.evaluate("document.getAnimations().every(animation=>animation.playState!=='running')"), 'settled Reader');
    return message;
  };
  const agent = 'fixture-notebook-agent';
  const outcome = async id => {
    const [answer] = await control({ method: 'navigation_workspaces', workspaces: [{ id, title: 'Openings outcome ' + id, purpose: 'Native opening proof', team: [agent] }] });
    assert.equal(answer.status, 'committed');
    return id;
  };

  await check('openings New topic is one title line: Return starts the topic once, with the reader in it and no message yet', async own => {
    const workspace = await outcome('openings-line');
    const a = await own('line-desktop');
    await a.goto(facts.origin + '/?workspace=' + workspace); await outcomeReady(a, workspace);
    await a.click('#new-topic');
    await until(() => a.evaluate('document.activeElement?.id==="new-topic-title"'), 'one title line, focused');
    assert.equal(await a.evaluate('new URL(location.href).searchParams.has("opening")'), false, 'no opening page');
    assert.equal(await a.evaluate('document.querySelector("#new-topic").getAttribute("aria-expanded")'), 'true');
    await a.key('Escape');
    await until(() => a.evaluate('!document.querySelector("#new-topic-title") && document.activeElement?.id==="new-topic"'), 'Escape closes the line and gives the focus back');
    await a.click('#new-topic');
    await until(() => a.evaluate('document.activeElement?.id==="new-topic-title"'), 'the line again');
    await a.typeKeys('Which weekend works'); await a.key('Enter');
    await until(() => a.evaluate('document.body.dataset.ready==="true" && new URL(location.href).searchParams.has("topic")').catch(() => false), 'the new topic opens');
    const topicId = await a.evaluate('new URL(location.href).searchParams.get("topic")');
    assert.equal(await a.evaluate('document.querySelector("#topic-title").textContent'), 'Which weekend works');
    assert.deepEqual([a.calls.filter(c => c.kind === 'opening.save').length, a.calls.filter(c => c.kind === 'opening.publish').length], [1, 1], 'one save, one publish');
    const save = a.calls.find(c => c.kind === 'opening.save').payload;
    assert.deepEqual([save.args.title, save.args.body, save.args.participants, save.args.attachments], ['Which weekend works', '', [], []]);
    const topic = await view('topic', { topic_id: topicId });
    assert.deepEqual(topic.participants.map(x => x.actor_id), [facts.actor], 'the reader is in it; people are added there');
    const messages = await view('topic_messages', { topic_id: topicId, limit: 5 });
    assert.deepEqual([messages.error ?? null, messages.items], [null, []], 'no message yet');
    assert.equal(await a.evaluate('document.querySelector("#participants .add-chip") !== null'), true, 'its people are added on its page, with "+ Add"');
    await a.shot('line-topic-started');

    const p = await own('line-touch', { mobile: true }); p.touch = true;
    await p.goto(facts.origin + '/?workspace=' + workspace); await outcomeReady(p, workspace);
    await p.tap('#new-topic');
    await until(() => p.evaluate('document.activeElement?.id==="new-topic-title"'), 'one title line on a phone, focused');
    assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth'), true, 'no sideways scroll');
    await p.insert('Started on a phone'); await p.key('Enter');
    await until(() => p.evaluate('document.body.dataset.ready==="true" && document.querySelector("#topic-title")?.textContent==="Started on a phone"').catch(() => false), 'the phone opens its new topic');
    assert.equal(p.calls.filter(c => c.kind === 'opening.publish').length, 1);
    await p.shot('line-touch-started');
  });

  await check('openings desktop an opening saves restores across reload and device, sends by shortcut, resumes, sends by button and discards', async own => {
    const workspace = await outcome('openings-desktop');
    const a = await own('device-a');
    await a.goto(facts.origin + '/?workspace=' + workspace); await outcomeReady(a, workspace);
    await until(() => a.evaluate('/No unfinished topics/.test(document.querySelector("#unfinished-work").textContent)'), 'empty unfinished list');
    await a.shot('desktop-outcome-before');

    // 1. New topic, typed title and body, one participant, Saved.
    const first = await newOpening(a, workspace);
    assert.deepEqual(await route(a), first, 'the opening link stays as it was opened');
    assert.equal(await a.evaluate('document.activeElement.id'), 'opening-title-input', 'the title has focus');
    assert.equal(await status(a), 'Not saved yet');
    const title1 = 'Shortcut topic';
    await a.typeKeys(title1);
    await a.click('#opening-body');
    const body1 = 'First line from the keyboard\nSecond line after plain Enter';
    await a.insert('First line from the keyboard'); await a.key('Enter'); await a.insert('Second line after plain Enter');
    assert.equal((await fields(a)).body, body1, 'plain Enter writes a newline, it does not send');
    await membersReady(a, agent);
    await a.click(`#opening-members [data-key="${agent}"]`);
    await until(async () => (await fields(a)).chips.includes(agent), 'participant chip');
    await saved(a);
    const core1 = await view('opening', { opening_id: first.opening });
    assert.equal(core1.opening.state, 'open'); assert.equal(core1.opening.title, title1); assert.equal(core1.opening.body, body1);
    assert.deepEqual(core1.opening.participants, [agent]);
    assert.equal(a.calls.some(c => c.kind === 'opening.publish'), false, 'nothing published yet');
    observations.push({ name: 'saved revision', revision: core1.opening.revision });
    await a.shot('desktop-opening-saved');

    // 2. Reload: the writing comes back from Core (no device copy is held).
    assert.deepEqual(await deviceRows(a), [], 'a Saved opening keeps no device copy');
    const before = await a.evaluate('performance.timeOrigin');
    await a.send('Page.reload', {});
    await until(() => a.evaluate(`performance.timeOrigin!==${before}`).catch(() => false), 'a new document after reload');
    await openingReady(a);
    await until(async () => (await fields(a)).title === title1, 'restored after reload');
    assert.deepEqual(await fields(a), { title: title1, body: body1, checked: [agent], chips: [facts.actor, agent] });
    assert.equal(await status(a), 'Saved');

    // 3. The same link on another device (separate storage) shows the saved writing.
    const deviceB = (await cdp('Target.createBrowserContext')).browserContextId;
    try {
      const b = await own('device-b', { browserContextId: deviceB });
      await b.goto(facts.origin + '/?' + new URLSearchParams(first)); await openingReady(b);
      await until(async () => (await fields(b)).title === title1, 'other device read');
      assert.deepEqual(await fields(b), { title: title1, body: body1, checked: [agent], chips: [facts.actor, agent] });
      assert.equal(await status(b), 'Saved');
      assert.deepEqual(await deviceRows(b), [], 'the other device had no local copy to restore from');
      await b.shot('desktop-opening-other-device');

      // 4. Send with Cmd+Return from the message field on device A.
      await a.click('#opening-body'); await a.key('Enter', 4);
      const message1 = await topicOpened(a, first.opening_topic, title1, body1);
      assert.equal(a.calls.filter(c => c.kind === 'opening.publish').length, 1, 'exactly one publish');
      const published = await view('opening', { opening_id: first.opening });
      assert.equal(published.opening.state, 'published'); assert.equal(published.opening.message_id, message1);
      const topic = await view('topic', { topic_id: first.opening_topic });
      assert.deepEqual(topic.participants.map(x => x.actor_id ?? x.id ?? x).sort(), [agent, facts.actor].sort(), 'the participant joined the topic');
      await a.shot('desktop-topic-after-shortcut');

      // Device B learns the outcome from the send's commit, with nothing
      // pressed there, and links to the topic.
      await until(() => b.evaluate('/Topic created/.test(document.querySelector("#opening-outcome").textContent) && !document.querySelector("#opening-outcome").hidden'), 'other device sees the topic was created');
      assert.equal(await b.evaluate('document.querySelector("#opening-send").hidden'), true);
      await b.close();
    } finally { await cdp('Target.disposeBrowserContext', { browserContextId: deviceB }); }

    // 5. A second opening left with Later appears in the unfinished list; Resume and Send by button.
    await a.goto(facts.origin + '/?workspace=' + workspace); await outcomeReady(a, workspace);
    const second = await newOpening(a, workspace);
    assert.notEqual(second.opening, first.opening); assert.notEqual(second.opening_topic, first.opening_topic);
    const title2 = 'Button topic', body2 = 'Sent with the Send button';
    await a.typeKeys(title2); await a.click('#opening-body'); await a.insert(body2);
    await saved(a);
    await a.click('#opening-later'); await outcomeReady(a, workspace);
    const resume2 = `#unfinished-work a[data-opening-id="${second.opening}"]`;
    await until(() => a.evaluate(`Boolean(document.querySelector(${JSON.stringify(resume2)}))`), 'unsent opening listed');
    assert.equal(await a.evaluate(`document.querySelector(${JSON.stringify(resume2)}).textContent`), 'Resume ' + title2);
    assert.equal(await a.evaluate(`Boolean(document.querySelector('#unfinished-work a[data-opening-id="${first.opening}"]'))`), false, 'a published opening is not unfinished');
    await a.shot('desktop-outcome-unfinished');
    await a.click(resume2); await openingReady(a);
    assert.deepEqual(await route(a), second, 'Resume opens the same opening link');
    await until(async () => (await fields(a)).body === body2, 'resumed writing');
    assert.equal((await fields(a)).title, title2);
    await a.click('#opening-send');
    await topicOpened(a, second.opening_topic, title2, body2);
    assert.equal((await view('opening', { opening_id: second.opening })).opening.state, 'published');

    // 6. A third opening is discarded from the page Resume opens.
    await a.goto(facts.origin + '/?workspace=' + workspace); await outcomeReady(a, workspace);
    const third = await newOpening(a, workspace);
    const title3 = 'Discarded topic';
    await a.typeKeys(title3); await a.click('#opening-body'); await a.insert('This will be discarded');
    await saved(a);
    await a.click('#opening-later'); await outcomeReady(a, workspace);
    const resume3 = `#unfinished-work a[data-opening-id="${third.opening}"]`;
    await until(() => a.evaluate(`Boolean(document.querySelector(${JSON.stringify(resume3)}))`), 'third opening listed');
    assert.equal(await a.evaluate(`Boolean(document.querySelector('#unfinished-work a[data-opening-id="${second.opening}"]'))`), false, 'the sent opening left the list');
    await a.click(resume3); await openingReady(a);
    await until(async () => (await fields(a)).title === title3, 'resumed third opening');
    await a.click('#opening-discard');
    await until(() => a.evaluate('!document.querySelector("#opening-discard-confirm").hidden && document.activeElement.id==="opening-discard-confirm"'), 'discard confirmation focused');
    assert.equal((await view('opening', { opening_id: third.opening })).opening.state, 'open', 'Discard… alone changes nothing');
    await a.click('#opening-discard-confirm');
    await until(() => a.evaluate('/This opening was discarded/.test(document.querySelector("#opening-outcome").textContent)'), 'discarded');
    assert.equal((await view('opening', { opening_id: third.opening })).opening.state, 'discarded');
    assert.equal(a.calls.filter(c => c.kind === 'opening.discard').length, 1);
    assert.equal(await a.evaluate('document.querySelector("#opening-later").textContent'), 'Back to outcome');
    await a.click('#opening-later'); await outcomeReady(a, workspace);
    await until(() => a.evaluate('/No unfinished topics/.test(document.querySelector("#unfinished-work").textContent)'), 'Discard removed it from the unfinished list');
    assert.equal(await a.evaluate(`Boolean(document.querySelector(${JSON.stringify(resume3)}))`), false);
    const listed = await view('openings', { workspace_id: workspace, limit: 20 });
    assert.deepEqual(listed.items, [], 'Core lists no unfinished openings');
    await a.shot('desktop-outcome-after-discard');
  });

  await check('openings 390px touch an opening types adds a participant saves and sends by tap', async own => {
    const workspace = await outcome('openings-touch');
    const p = await own('touch', { mobile: true }); p.touch = true;
    await p.goto(facts.origin + '/?workspace=' + workspace); await outcomeReady(p, workspace);
    assert.equal(await p.evaluate('innerWidth'), 390);
    await p.shot('touch-outcome');
    const r = await newOpening(p, workspace);
    assert.equal(await p.evaluate('document.documentElement.scrollWidth<=innerWidth'), true, 'no horizontal page scroll on the opening page');
    const title = 'Touch topic', body = 'Written on a phone';
    await p.tap('#opening-title-input');
    assert.equal(await p.evaluate('document.activeElement.id'), 'opening-title-input');
    await p.insert(title);
    await p.tap('#opening-body'); assert.equal(await p.evaluate('document.activeElement.id'), 'opening-body');
    await p.insert(body);
    await membersReady(p, agent);
    await p.tap(`#opening-members [data-key="${agent}"]`);
    await until(async () => (await fields(p)).chips.includes(agent), 'participant chip by tap');
    await saved(p);
    const core = await view('opening', { opening_id: r.opening });
    assert.deepEqual({ title: core.opening.title, body: core.opening.body, participants: core.opening.participants }, { title, body, participants: [agent] });
    for (const selector of ['#opening-send', '#opening-later', '#opening-discard', `#opening-members [data-key="${agent}"]`]) {
      const b = await p.box(selector);
      assert.ok(b.x >= 0 && b.x + b.width <= 390, `${selector} fits the 390px viewport`);
    }
    await p.shot('touch-opening-saved');
    await p.tap('#opening-send');
    await topicOpened(p, r.opening_topic, title, body);
    assert.equal(p.calls.filter(c => c.kind === 'opening.publish').length, 1);
    assert.equal((await view('opening', { opening_id: r.opening })).opening.state, 'published');
    await p.shot('touch-topic-reader');
  });
} finally {
  if (cdp && socket?.readyState === WebSocket.OPEN) { await cdp('Browser.close'); await chromeExit; socket.close(); }
  // Only when DevTools never came up is there no Browser.close to send: stop the
  // exact process this run started, so a failed start leaves nothing behind.
  else if (chrome && chrome.exitCode === null && chrome.signalCode === null) { chrome.kill('SIGTERM'); await chromeExit; }
  if (fixture.exitCode === null) { try { finalHealth = await control({ method: 'admission_events' }); finalHealth = { fatal: finalHealth.fatal, next: finalHealth.next }; } catch (error) { finalHealth = { error: error.message }; } }
  fixture.stdin.end();
  fixtureExitCode = await fixtureExit;
  // This profile directory is unique to this run; nothing of a person's browser is touched.
  if (!chrome || chrome.exitCode !== null) await rm(profile, { recursive: true, force: true });
  await writeFile(path.join(evidencePath, 'native.json'), JSON.stringify({ chromeVersion, hashes, results, observations, tapSpacing, finalHealth, fixtureExitCode, fixtureErrors, browserClosed: chrome?.exitCode !== null }, null, 2));
  assert.equal(fixtureExitCode, 0, fixtureErrors);
  assert.equal(fixtureErrors, '', 'owned fixture stderr is clean');
}
assert.ok(results.length && results.every(result => result.passed), 'see native.json for exact failing assertions');
