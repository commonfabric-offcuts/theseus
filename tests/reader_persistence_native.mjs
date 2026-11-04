// Real isolated HTTP/Store and browser IDB/Web Locks. CDP owns only its CFT
// profile and closes the browser over its socket; no signals, origin sweeps,
// application hooks, or other member's identity.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [chromePath, evidencePath, mode = '--journal', caseFilter] = process.argv.slice(2);
assert.ok(chromePath?.endsWith('/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
assert.ok(evidencePath && path.isAbsolute(evidencePath));
assert.ok(['--journal', '--connected'].includes(mode));
await mkdir(evidencePath, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(probe, description, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await sleep(25); }
  throw Error(`Timed out: ${description}`);
}
const fixture = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py'], { cwd: root });
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
  const id = ++fixtureSerial; requests.set(id, { resolve, reject });
  fixture.stdin.write(JSON.stringify({ ...data, id }) + '\n');
});
const results = [], hashes = {};
for (const filename of ['web/journal.mjs', 'web/app-session.mjs', 'web/app.mjs', 'web/reader.mjs', 'web/index.html', 'web/aim.css', 'tests/fixtures/ui_http.py', 'tests/reader_persistence_native.mjs']) {
  hashes[filename] = createHash('sha256').update(await readFile(path.join(root, filename))).digest('hex');
}
const profile = await mkdtemp(path.join(os.tmpdir(), 'aim-reader-persistence-'));
let chrome, chromeExit, socket, cdp, facts;
const pages = new Set();
try {
  facts = await control({ method: 'ready' });
  chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
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
    if (!packet.id) { listeners.get(packet.sessionId)?.(packet); return; }
    const waiter = waiting.get(packet.id); waiting.delete(packet.id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    if (packet.error) waiter.reject(Error(JSON.stringify(packet.error))); else waiter.resolve(packet.result);
  });
  cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { waiting.delete(id); reject(Error(`CDP timed out: ${method}`)); }, 10000);
    waiting.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const page = async (suffix, hint, connected = false) => {
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' }); pages.add(targetId);
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp(method, params, sessionId);
    const evaluate = async expression => {
      const answer = await send('Runtime.evaluate', { expression: `(async()=>(${expression}))()`, returnByValue: true, awaitPromise: true });
      if (answer.exceptionDetails) throw Error(JSON.stringify(answer.exceptionDetails));
      return answer.result.value;
    };
    const errors = [], calls = [], held = [];
    let intercept = null;
    listeners.set(sessionId, packet => {
      if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails);
      if (packet.method === 'Fetch.requestPaused') {
        const event = packet.params;
        const handle = async () => {
          let payload; try { payload = JSON.parse(event.request.postData); } catch { payload = null; }
          calls.push({ url: event.request.url, payload });
          if (intercept?.(payload, event)) { held.push({ event, payload }); return; }
          await send('Fetch.continueResponse', { requestId: event.requestId });
        }; handle().catch(error => errors.push({ message: error.message }));
      }
    });
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const box = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}})()`);
    const point = async (selector, kind = 'click') => {
      const bounds = await box(selector); assert.ok(bounds && bounds.width > 0 && bounds.height > 0, `visible target ${selector}`);
      const x = bounds.x + Math.min(12, bounds.width / 2), y = bounds.y + Math.min(12, bounds.height / 2);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      if (kind === 'click') {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      }
    };
    const key = async (name, modifiers = 0) => {
      const code = { Enter: 13, Escape: 27, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[name] ?? name.toUpperCase().charCodeAt(0);
      const data = { key: name, code: name.length === 1 ? `Key${name.toUpperCase()}` : name, windowsVirtualKeyCode: code, modifiers };
      await send('Input.dispatchKeyEvent', { type: name === 'Enter' && !modifiers ? 'keyDown' : 'rawKeyDown', ...data,
        ...(modifiers === 4 && ['a','z'].includes(name) ? { commands: [name === 'a' ? 'selectAll' : 'undo'] } : {}),
        ...(name === 'Enter' && !modifiers ? { text: '\r', unmodifiedText: '\r' } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...data });
    };
    const close = async () => { if (pages.delete(targetId)) await cdp('Target.closeTarget', { targetId }); listeners.delete(sessionId); };
    if (connected) {
      await send('Page.navigate', { url: facts.origin + '/?topic=t1' });
      await until(() => evaluate('document.body?.dataset.ready === "true" || Boolean(document.querySelector("#app-status") && !document.querySelector("#app-status").hidden)'), 'application bootstrap');
      assert.equal(await evaluate('document.body.dataset.ready'), 'true', await evaluate('document.querySelector("#app-status").textContent'));
      await send('Fetch.enable', { patterns: [{ urlPattern: facts.origin + '/api/*', requestStage: 'Response' }] });
      return { targetId, send, evaluate, close, box, point, key, calls, held, errors,
        intercept: handler => { intercept = handler; },
        release: entry => send('Fetch.continueResponse', { requestId: entry.event.requestId }),
        fail: entry => send('Fetch.failRequest', { requestId: entry.event.requestId, errorReason: 'ConnectionClosed' }),
        open: async index => {
          await point(`#messages [data-id="${facts.sources[index].id}"]`);
          await until(() => evaluate(`document.querySelector('#reader').open && document.querySelector('#source-body').textContent.startsWith('Source ${index} ')`), 'selected full source');
          await until(() => evaluate("document.getAnimations().every(animation=>animation.playState!=='running')"), 'settled reader');
        },
      };
    }
    // A text document at this origin permits testing the real imported journal
    // without silently starting app.mjs. This is not a connected-UI claim.
    await send('Page.navigate', { url: facts.origin + '/journal.mjs' });
    await until(() => evaluate(`location.origin === ${JSON.stringify(facts.origin)} && document.readyState === 'complete'`), 'owned document');
    await evaluate(`(async()=>{
      window.context = ${JSON.stringify({ instanceId: 'ux-http-fixture', actor: 'fixture-person', sourceRef: { kind: 'message', id: 'journal-' }, topicId: 't1', kind: 'reply' })};
      context.sourceRef.id += ${JSON.stringify(suffix)};
      const {Editor} = await import('/editor.mjs');
      window.editor = new Editor(context, {id:'private', generation:'original', revision:0});
      editor.edit({body:'Private writing ' + ${JSON.stringify(suffix)}});
      window.snapshot = editor.snapshot();
      window.durability = [];
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(...args) {
        const tx = transaction.apply(this,args);
        if(args[1]==='readwrite') durability.push({requested:args[2]?.durability,actual:tx.durability});
        return tx;
      };
      ${hint ? `sessionStorage.setItem('aim-next-recovery-tab', ${JSON.stringify(hint)});sessionStorage.setItem('aim-next-recovery-hint:'+JSON.stringify([context.instanceId,context.actor]),${JSON.stringify(hint)});` : ''}
      window.j = await (await import('/journal.mjs')).openJournal({instanceId:context.instanceId,actor:context.actor});
      window.readRow = id => new Promise((resolve,reject)=>{
        const request=indexedDB.open('aim-next-pending');request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{const db=request.result,tx=db.transaction('editors');
          tx.objectStore('editors').get(id).onsuccess=e=>resolve(e.target.result??null);tx.oncomplete=()=>db.close();};
      });
      window.putRow = row => new Promise((resolve,reject)=>{
        const request=indexedDB.open('aim-next-pending');request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{const db=request.result,tx=db.transaction('editors','readwrite',{durability:'strict'});
          tx.objectStore('editors').put(row);tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>{db.close();reject(tx.error)};};
      });
    })()`);
    return { targetId, send, evaluate, close };
  };
  const check = async (name, action) => {
    if (caseFilter && !new RegExp(caseFilter).test(name)) return;
    try { await action(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.stack }); }
    finally { for (const targetId of pages) await cdp('Target.closeTarget', { targetId }); pages.clear(); listeners.clear(); }
    process.stdout.write(JSON.stringify(results.at(-1)) + '\n');
  };

  if (mode === '--journal') {
  await check('duplicated session hint never shares a live document writer', async () => {
    const a = await page('duplicate'), id = await a.evaluate('j.writerId');
    await a.evaluate('j.save(snapshot)');
    const b = await page('duplicate', id);
    assert.notEqual(await b.evaluate('j.writerId'), id, 'every document must mint a fresh writer despite an inherited hint');
    assert.equal(await b.evaluate('j.previousWriter'), id, 'the inherited hint exists but grants no ownership');
    assert.equal(await b.evaluate('(await j.own(editor.key)) ?? null'), null, 'the new writer owns no old pending attempts');
    const locked = await b.evaluate('j.candidates(editor.key)');
    assert.equal(locked.items[0].availability, 'open-in-another-tab');
    assert.equal(Object.hasOwn(locked.items[0], 'snapshot'), false, 'a live writer must not disclose adoptable attempts');
    const refusal = await b.evaluate('(async()=>{try{await j.adopt(editor.key,{id:' + JSON.stringify(JSON.stringify([await a.evaluate('editor.key'), id])) + ',stamp:(await j.candidates(editor.key)).items[0].stamp});return null}catch(e){return e.message}})()');
    assert.match(refusal, /another tab/i);
  });

  await check('device recovery writes request and observe strict durability', async () => {
    const a = await page('durability'); await a.evaluate('j.save(snapshot)');
    const observed = await a.evaluate('durability'); assert.ok(observed.length > 0);
    assert.ok(observed.every(tx => tx.requested === 'strict' && tx.actual === 'strict'), JSON.stringify(observed));
  });

  await check('candidate discovery never exposes a foreign actor with a forged editor key', async () => {
    const a = await page('scope');
    await a.evaluate(`putRow({id:JSON.stringify([editor.key,'foreign']),editorKey:editor.key,writerId:'foreign',scope:JSON.stringify([context.instanceId,'another-person']),stamp:'foreign-stamp',active:1,snapshot:{...snapshot,context:{...context,actor:'another-person'},draft:{...snapshot.draft,body:'FOREIGN SECRET'}}})`);
    await a.evaluate(`putRow({id:JSON.stringify([editor.key,'forged']),editorKey:editor.key,writerId:'forged',scope:JSON.stringify([context.instanceId,context.actor]),stamp:'forged-stamp',active:1,snapshot:{...snapshot,context:{...context,actor:'another-person'},draft:{...snapshot.draft,body:'FORGED SECRET'}}})`);
    const candidates = await a.evaluate('j.candidates(editor.key)');
    assert.equal(JSON.stringify(candidates).includes('FOREIGN SECRET'), false, 'foreign writing cannot reach a recovery comparison');
    assert.equal(JSON.stringify(candidates).includes('foreign-stamp'), false, 'foreign row identity is not a candidate');
    assert.equal(JSON.stringify(candidates).includes('FORGED SECRET'), false, 'the scoped index alone does not authorize a forged snapshot');
  });

  await check('explicit adoption keeps source history, both lifetime locks, and one descendant', async () => {
    const a = await page('adoption');
    const original = await a.evaluate(`(async()=>{await j.save({...snapshot,attempts:[{envelope:{operation_id:'original-operation',expected:{authority:{authority_epoch:1}}}}]});return j.own(editor.key)})()`);
    await a.close();
    const b = await page('adoption'), idB = await b.evaluate('j.writerId');
    assert.equal(await b.evaluate('typeof j.adopt'), 'function', 'explicit adoption interface must exist');
    const adopted = await b.evaluate(`j.adopt(editor.key,${JSON.stringify({ id: original.id, stamp: original.stamp })})`);
    assert.deepEqual(adopted.snapshot, original.snapshot, 'retain exact frozen attempts and pins');
    assert.equal(adopted.writerId, idB);
    const history = await b.evaluate(`readRow(${JSON.stringify(original.id)})`);
    assert.equal(history.superseded_by, idB); assert.notEqual(history.stamp, original.stamp);
    assert.deepEqual(history.snapshot, original.snapshot);
    const held = await b.evaluate('(await navigator.locks.query()).held.map(lock=>lock.name)');
    assert.ok(held.some(name => name.includes(original.writerId)), 'source ownership lasts after copy');
    assert.ok(held.some(name => name.includes(idB)), 'new document also keeps its own lock');
    await b.close();
    const c = await page('adoption');
    const candidates = await c.evaluate('j.candidates(editor.key)');
    assert.equal(candidates.items.length, 1); assert.equal(candidates.items[0].writerId, idB);
    assert.deepEqual(candidates.items[0].snapshot, original.snapshot);
    assert.equal((await c.evaluate('j.history(editor.key)')).items.length, 1);
  });

  await check('stale cleanup and foreign cleanup cannot remove a row', async () => {
    const a = await page('cleanup');
    const old = await a.evaluate('j.save(snapshot)');
    const latest = await a.evaluate(`j.save({...snapshot,draft:{...snapshot.draft,body:'Newer writing'}})`);
    await a.evaluate(`j.removeExact(editor.key,${JSON.stringify(old)})`);
    assert.equal((await a.evaluate('j.own(editor.key)')).stamp, latest);
    await a.evaluate(`(async()=>{const row=await j.own(editor.key);row.scope=JSON.stringify([context.instanceId,'another-person']);await putRow(row)})()`);
    await a.evaluate(`j.removeExact(editor.key,${JSON.stringify(latest)}).catch(()=>{})`);
    assert.notEqual(await a.evaluate('readRow(j.id(editor.key))'), null, 'mismatched actor row survives even exact stamp cleanup');
  });

  await check('adoption abort is atomic and never overwrites current writer work', async () => {
    const a = await page('abort'), original = await a.evaluate('(async()=>{await j.save(snapshot);return j.own(editor.key)})()');
    await a.close(); const b = await page('abort');
    assert.equal(await b.evaluate('typeof j.adopt'), 'function', 'explicit adoption interface must exist');
    await b.evaluate('j.save({...snapshot,draft:{...snapshot.draft,body:"B already exists"}})');
    const refused = await b.evaluate(`(async()=>{try{await j.adopt(editor.key,${JSON.stringify({ id: original.id, stamp: original.stamp })});return false}catch{return true}})()`);
    assert.equal(refused, true); assert.equal((await b.evaluate('j.own(editor.key)')).snapshot.draft.body, 'B already exists');
    assert.equal((await b.evaluate(`readRow(${JSON.stringify(original.id)})`)).superseded_by, undefined);
    await b.evaluate(`(async()=>{const row=await j.own(editor.key);await j.removeExact(editor.key,row.stamp);
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(row,...rest){if(row.superseded_by){this.transaction.abort();}return put.call(this,row,...rest)};
    })()`);
    const aborted = await b.evaluate(`(async()=>{try{await j.adopt(editor.key,${JSON.stringify({ id: original.id, stamp: original.stamp })});return false}catch{return true}})()`);
    assert.equal(aborted, true); assert.equal(await b.evaluate('j.own(editor.key)'), null);
    const retained = await b.evaluate(`readRow(${JSON.stringify(original.id)})`);
    assert.equal(retained.stamp, original.stamp); assert.equal(retained.superseded_by, undefined);
  });

  await check('scoped candidate pages are bounded and cleaned descendant does not resurrect history', async () => {
    const a = await page('pages');
    assert.equal(await a.evaluate('typeof j.adopt'), 'function', 'explicit adoption interface must exist');
    await a.evaluate(`(async()=>{for(let n=0;n<5;n++){const writerId='past-'+n;await putRow({id:JSON.stringify([editor.key,writerId]),editorKey:editor.key,writerId,scope:JSON.stringify([context.instanceId,context.actor]),active:1,stamp:'stamp-'+n,snapshot})}})()`);
    await a.evaluate(`(()=>{window.actualPageSizes=[];const getAll=IDBIndex.prototype.getAll;IDBIndex.prototype.getAll=function(...args){const request=getAll.apply(this,args);request.addEventListener('success',()=>actualPageSizes.push(request.result.length));return request}})()`);
    const first = await a.evaluate('j.candidates(editor.key,{limit:2})');
    assert.equal(first.items.length, 2); assert.ok(first.nextCursor);
    const next = await a.evaluate(`j.candidates(editor.key,{limit:2,cursor:${JSON.stringify(first.nextCursor)}})`);
    assert.equal(next.items.length, 2); assert.notEqual(next.items[0].id, first.items[0].id);
    assert.ok((await a.evaluate('actualPageSizes')).every(size=>size<=3), 'actual IDB results are bounded to this page plus one lookahead');
    const chosen = first.items[0];
    const own = await a.evaluate(`j.adopt(editor.key,${JSON.stringify({ id: chosen.id, stamp: chosen.stamp })})`);
    await a.evaluate(`j.removeExact(editor.key,${JSON.stringify(own.stamp)})`);
    assert.equal((await a.evaluate('j.candidates(editor.key,{limit:20})')).items.length, 4, 'superseded source is never offered again');
    const history = await a.evaluate('j.history(editor.key)');
    assert.equal(history.items[0].id, chosen.id);
    const held = await a.evaluate('(await navigator.locks.query()).held.map(lock=>lock.name)');
    assert.ok(held.some(name => name.includes(chosen.writerId)), 'cleanup does not release adopted ownership');
  });

  await check('unavailable strict durability refuses a device recovery claim', async () => {
    const a = await page('unsupported');
    await a.evaluate(`(()=>{const tx=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const result=tx.apply(this,args);if(args[1]==='readwrite')Object.defineProperty(result,'durability',{value:'relaxed'});return result}})()`);
    const refused = await a.evaluate('(async()=>{try{await j.save(snapshot);return null}catch(e){return e.message}})()');
    assert.match(refused ?? '', /strict|durab/i);
    assert.equal(await a.evaluate('j.own(editor.key)'), null, 'unsupported write does not commit a pretend recovery copy');
  });
  } else {
    const view = async (name, args) => (await fetch(facts.origin + '/api/view', { method: 'POST', headers: {
      Authorization: `Bearer ${facts.token}`, Origin: facts.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) })).json();
    const field = page => page.evaluate('document.querySelector("#writing-body").value');
    const replace = async (page, text) => {
      await page.point('#writing-body'); await page.key('a', 4);
      assert.equal(await page.evaluate("document.querySelector('#writing-body').selectionEnd-document.querySelector('#writing-body').selectionStart"), (await field(page)).length, 'native select-all instrument');
      await page.send('Input.insertText', { text }); assert.equal(await field(page), text);
    };
    const privateState = () => view('editor_state', { source_ref: facts.sources[1], topic_id: 't1' });
    const shot = async (page, name) => {
      const image = await page.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(evidencePath, name + '.png'), Buffer.from(image.data, 'base64'));
    };
    await check('connected quote, newline, private note, focus, autosave geometry and touch boundary', async () => {
      const p = await page('connected', null, true); await p.open(1);
      assert.ok((await p.evaluate('document.querySelector("#source-body").textContent')).length > 1024);
      await p.point('#source-body [data-start="0"]', 'move'); await p.key('Enter');
      assert.equal(await field(p), '> Source 1 exact passage. \n\n');
      await p.send('Input.insertText', { text: 'Connected response' }); await p.key('Enter');
      assert.equal(await field(p), '> Source 1 exact passage. \n\nConnected response\n');
      assert.equal(p.calls.filter(call => call.payload?.kind === 'message.send').length, 0);
      await until(async () => (await privateState()).draft?.body === await field(p), 'actual draft save');
      assert.equal(await p.evaluate('document.querySelector("#save-state").textContent'), 'Saved to Theseus');
      const reply = await field(p);
      await p.point('#toggle-note'); await p.send('Input.insertText', { text: 'Private native note' }); await p.key('Enter', 4);
      await until(() => p.evaluate('!document.querySelector("#reader").open'), 'confirmed note close');
      assert.equal((await privateState()).note.body, 'Private native note'); assert.equal((await privateState()).draft.body, reply);
      assert.equal(await p.evaluate('document.activeElement.dataset.id'), facts.sources[1].id);
      await p.open(1); assert.equal(await field(p), reply);
      await p.point('#reader-layout');
      const wide = await p.box('.writing-pane'), dialog = await p.box('#reader');
      assert.ok(wide.height > dialog.height * .94, 'writing keeps the full wide column');
      await p.point('#writing-body'); await p.send('Input.insertText', { text: ' Undo tail' });
      const withTail = await field(p);
      await until(async () => (await privateState()).draft.body === withTail, 'autosave of native edit');
      await p.key('z', 4); assert.equal(await field(p), reply, 'native Undo survives a real server acknowledgement');
      await p.evaluate("(()=>{const field=document.querySelector('#writing-body');field.setSelectionRange(2,8);document.querySelector('#source-body').scrollTop=350})()");
      const before = await p.evaluate("(()=>{const e=document.querySelector('#source-body');const r=document.createRange();r.setStart(e.children[4].firstChild,0);r.setEnd(e.children[5].firstChild,8);const s=getSelection();s.removeAllRanges();s.addRange(r);return {text:s.toString(),scroll:e.scrollTop,caret:[document.querySelector('#writing-body').selectionStart,document.querySelector('#writing-body').selectionEnd]}})()");
      await until(() => p.evaluate('document.querySelector("#save-state").textContent === "Saved to Theseus"'), 'undo saved');
      const after = await p.evaluate("({text:getSelection().toString(),scroll:document.querySelector('#source-body').scrollTop,caret:[document.querySelector('#writing-body').selectionStart,document.querySelector('#writing-body').selectionEnd]})");
      assert.deepEqual(after, before, 'status repaint preserves source selection, place and caret');
      const grip = await p.box('#reader-divider'), x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
      const writingBefore = await p.box('.writing-pane');
      await p.point('#reader-divider');
      assert.ok(Math.abs((await p.box('.writing-pane')).width - writingBefore.width) < 2, 'divider near-action click does not resize');
      await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      for (let step = 1; step <= 6; step++) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - step * 10, y, button: 'left', buttons: 1 });
      await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x - 60, y, button: 'left', buttons: 0, clickCount: 1 });
      assert.ok((await p.box('.writing-pane')).width > writingBefore.width + 40, 'actual browser drag expands wide writing');
      assert.equal(await field(p), reply); assert.equal(await p.evaluate('getSelection().toString()'), before.text);
      await p.key('Escape'); assert.equal(await p.evaluate('document.querySelector("#reader").open'), true);
      await p.key('Escape'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'reader escape');
      await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await p.open(1); const source = await p.box('#source-body');
      const touch = { x: source.x + 10, y: source.y + 10 };
      await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
      await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.equal(await field(p), reply, 'plain touch does not quote or send');
      assert.equal(p.calls.filter(call => call.payload?.kind === 'message.send').length, 0);
      await shot(p, 'phone-reader'); assert.deepEqual(p.errors, []);
    });

    await check('held real preparation keeps new B editable and cannot close or refocus Y', async () => {
      const p = await page('race', null, true); await p.open(1); await replace(p, 'Native delayed A');
      let once = false;
      p.intercept(payload => payload?.kind === 'submission.prepare' && !once && (once = true));
      await p.key('Enter', 4);
      assert.equal(await field(p), '', 'new B is visible immediately after the send act');
      await p.send('Input.insertText', { text: 'Native delayed B' });
      await until(() => p.held[0], 'held real prepare response');
      await p.point('#source-body'); await p.key('ArrowLeft', 4);
      await until(() => p.evaluate('document.querySelector("#source-body").textContent.startsWith("Source 0 ")'), 'neighbor Y');
      await p.point('#source-body'); const focused = await p.evaluate('document.activeElement.id');
      const original = p.held[0].payload; await p.release(p.held[0]);
      await until(async () => (await view('operation', { operation_id: original.args.send_operation_id })).status === 'committed', 'one public A');
      assert.equal(await p.evaluate('document.querySelector("#reader").open'), true);
      assert.equal(await p.evaluate('document.activeElement.id'), focused);
      assert.ok((await p.evaluate('document.querySelector("#source-body").textContent')).startsWith('Source 0 '));
      await p.point('#reader-close'); await until(() => p.evaluate('!document.querySelector("#reader").open'), 'close Y');
      await p.open(1); assert.equal(await field(p), 'Native delayed B');
      await shot(p, 'after-delayed-send'); assert.deepEqual(p.errors, []);
    });

    await check('lost public answer, real reload, explicit device recovery and lookup retain one A plus B', async () => {
      const p = await page('lost', null, true); await p.open(1); await replace(p, 'Native lost-answer A');
      p.intercept(payload => payload?.kind === 'message.send');
      await p.key('Enter', 12); assert.equal(await field(p), '');
      await p.send('Input.insertText', { text: 'Native reload B' });
      const held = await until(() => p.held[0], 'committed public response held');
      const receipt = await view('operation', { operation_id: held.payload.operation_id }); assert.equal(receipt.status, 'committed');
      await p.fail(held);
      await until(async () => (await privateState()).draft?.body === 'Native reload B', 'B independently saved');
      await p.close();
      const q = await page('reload', null, true); await q.open(1);
      await until(() => q.evaluate('!document.querySelector("#review-versions").hidden'), 'discoverable recovery');
      await q.point('#review-versions');
      await until(() => q.evaluate('document.querySelector("#version-review").textContent.includes("Native reload B")'), 'actual IDB recovery comparison');
      const selector = await until(() => q.evaluate(`(()=>{const section=[...document.querySelectorAll('#review-content section')].find(e=>e.querySelector('pre')?.textContent==='Native reload B'&&[...e.querySelectorAll('button')].some(b=>b.textContent==='Recover this version'));if(!section)return null;section.id='chosen-native-recovery';return '#chosen-native-recovery button'})()`), 'candidate discovery finished');
      assert.ok(selector, 'explicit candidate for retained B and original A'); await q.point(selector);
      await until(() => q.evaluate('!document.querySelector("#version-review").open'), 'adoption confirmed');
      assert.equal(await field(q), 'Native reload B');
      await q.point('#pending-submissions button');
      const card = `#review-content [data-id="${held.payload.args.submission_id}"]`;
      await until(() => q.evaluate(`Boolean(document.querySelector(${JSON.stringify(card)}))`), 'original frozen A card');
      assert.ok((await q.evaluate(`document.querySelector(${JSON.stringify(card)}).textContent`)).includes('Native lost-answer A'));
      await q.point(card + ' button');
      await until(() => q.evaluate(`document.querySelector(${JSON.stringify(card)}).textContent.includes('Sent to Theseus')`), 'original operation confirmation');
      const messages = await view('topic_messages', { topic_id: 't1', limit: 100 });
      assert.equal(messages.items.filter(item => item.body === 'Native lost-answer A').length, 1);
      assert.equal(q.calls.filter(call => ['message.send','submission.prepare'].includes(call.payload?.kind)).length, 0, 'recovery and check do not replay publication');
      await q.key('Escape'); assert.equal(await field(q), 'Native reload B'); await shot(q, 'recovered-reader'); assert.deepEqual(q.errors, []);
    });

    await check('epoch recovery comparison preserves writing height and needs an explicit private choice', async () => {
      const p = await page('epoch', null, true); await p.open(1); await replace(p, 'Before fixture epoch');
      await until(async () => (await privateState()).draft?.body === 'Before fixture epoch', 'E1 private acknowledgement');
      await p.evaluate(`(()=>{window.readOwnRecovery=()=>new Promise((resolve,reject)=>{const request=indexedDB.open('aim-next-pending');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('editors'),key=JSON.stringify([${JSON.stringify(facts.instance_id)},${JSON.stringify(facts.actor)},'reply','message',${JSON.stringify(facts.sources[1].id)},'t1']),writer=sessionStorage.getItem('aim-next-recovery-hint:'+JSON.stringify([${JSON.stringify(facts.instance_id)},${JSON.stringify(facts.actor)}]));tx.objectStore('editors').get(JSON.stringify([key,writer])).onsuccess=e=>resolve(e.target.result?.snapshot);tx.oncomplete=()=>db.close();}})})()`);
      const originalEnvelopes = (await p.evaluate('readOwnRecovery()')).attempts.map(attempt => attempt.envelope);
      await control({ method: 'epoch', epoch: 'native-epoch-2', complete: false, drop_private: true });
      await replace(p, 'Keep this after epoch');
      await until(() => p.evaluate('document.querySelector("#save-state").textContent.includes("Runtime changed")'), 'explicit authority recovery status');
      const geometry = await p.box('#writing-body');
      await p.point('#review-versions');
      await until(() => p.evaluate('document.querySelector("#review-content").textContent.includes("No saved version here")'), 'missing current private version');
      assert.equal(await p.evaluate('document.activeElement.id'), 'review-title', 'comparison never focuses its write action');
      await p.point('#review-keep'); await until(() => p.evaluate('!document.querySelector("#version-review").open'), 'Keep both closes comparison');
      assert.equal(await field(p), 'Keep this after epoch');
      assert.equal((await p.box('#writing-body')).height, geometry.height);
      assert.equal((await privateState()).draft, null, 'Keep both makes no private write');
      await p.point('#review-versions');
      let heldOnce = false;
      p.intercept(payload => payload?.name === 'editor_state' && !heldOnce && (heldOnce = true));
      await p.point('#review-retry');
      const failedRead = await until(() => p.held[0], 'held recovery state read'); await p.fail(failedRead);
      await until(() => p.evaluate('document.querySelector("#review-status").textContent.includes("Could not read")'), 'specific failed recovery read');
      assert.equal(await p.evaluate('document.querySelector("#review-save").disabled'), true);
      heldOnce = false;
      await p.point('#review-retry');
      const delayedRead = await until(() => p.held[1], 'second recovery state read held');
      await p.key('Escape');
      assert.equal(await p.evaluate('document.activeElement.id'), 'review-versions');
      await replace(p, 'Typed while recovery read was held');
      await p.release(delayedRead);
      await until(() => p.evaluate('(await readOwnRecovery()).authorityRecovery?.phase === "ready"'), 'current review durably settled after held read');
      await p.point('#review-versions');
      await until(() => p.evaluate('document.querySelector("#review-content").textContent.includes("Typed while recovery read was held")'), 'current writing comparison refreshed');
      await until(() => p.evaluate('!document.querySelector("#review-save").disabled'), 'explicit private choice ready');
      await p.point('#review-save');
      await until(async () => (await privateState()).draft?.body === 'Typed while recovery read was held', 'private resume with new authority');
      await until(() => p.evaluate('!document.querySelector("#version-review").open'), 'confirmed private comparison close');
      assert.equal(await field(p), 'Typed while recovery read was held');
      assert.equal(p.calls.filter(call => ['message.send','submission.prepare'].includes(call.payload?.kind)).length, 0);
      const pinned = p.calls.filter(call => call.payload?.kind === 'draft.save').map(call => call.payload.expected.authority.authority_epoch);
      assert.ok(pinned.includes('native-epoch-2')); assert.ok(pinned.some(epoch => epoch !== 'native-epoch-2'));
      const retained = await p.evaluate('readOwnRecovery()');
      for (const envelope of originalEnvelopes) assert.deepEqual(retained.attempts.find(attempt=>attempt.envelope.operation_id===envelope.operation_id).envelope,envelope,'original operation and authority pin survive the private choice');
      await shot(p, 'epoch-recovered'); assert.deepEqual(p.errors, []);
    });

    await check('actual IDB write failure blocks reader close and preserves editable writing', async () => {
      const p = await page('quota', null, true); await p.open(0);
      await p.evaluate(`(()=>{const transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('Fixture quota failure','QuotaExceededError');return transaction.apply(this,args)}})()`);
      await replace(p, 'Keep unjournaled text in this page');
      await until(() => p.evaluate('document.querySelector("#save-state").textContent.includes("Recovery copy unavailable")'), 'visible IDB failure');
      await p.point('#reader-close');
      assert.equal(await p.evaluate('document.querySelector("#reader").open'), true);
      assert.equal(await field(p), 'Keep unjournaled text in this page');
      await p.point('#writing-body'); await p.send('Input.insertText', { text: ' still editable' });
      assert.ok((await field(p)).includes('still editable'));
      assert.equal(p.calls.filter(call => call.payload?.kind).length, 0, 'an unjournaled act never dispatches');
      await shot(p, 'idb-failure'); assert.deepEqual(p.errors, []);
    });
  }
} finally {
  if (cdp && socket?.readyState === WebSocket.OPEN) { await cdp('Browser.close'); await chromeExit; socket.close(); }
  fixture.stdin.end();
  assert.equal(await fixtureExit, 0, fixtureErrors);
  // Every origin/key here belongs to this unique disposable profile; no keys
  // or prefixes are ever removed from a person's browser.
  if (!chrome || chrome.exitCode !== null) await rm(profile, { recursive: true, force: true });
  await writeFile(path.join(evidencePath, 'native.json'), JSON.stringify({ mode, hashes, results, fixtureErrors, browserClosed: chrome?.exitCode !== null }, null, 2));
}
assert.ok(results.length && results.every(result => result.passed), 'see native.json for exact failing assertions');
