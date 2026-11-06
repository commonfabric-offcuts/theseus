// One isolated Chrome for Testing, actual CDP input, graceful Browser.close.
// This fixture proves UI interactions only; it has no Store or HTTP adapter.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const [chromePath, evidencePath, mode] = process.argv.slice(2);
assert.ok(mode === undefined || ['--mutations', '--review-gaps', '--anchor-control', '--keyboard'].includes(mode), 'only explicit evidence modes are accepted');
assert.ok(chromePath?.endsWith('/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), 'explicit Chrome for Testing required');
assert.ok(evidencePath && path.isAbsolute(evidencePath), 'an absolute evidence directory is required');
await mkdir(evidencePath, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(probe, description, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await sleep(25); }
  throw new Error(`Timed out: ${description}`);
}
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://fixture').pathname;
    let filename;
    if (pathname === '/fixture.mjs') filename = path.join(root, 'tests/fixtures/reader.mjs');
    else if (pathname === '/') filename = path.join(root, 'web/index.html');
    else if (/^\/[a-z-]+\.(?:mjs|css)$/.test(pathname)) filename = path.join(root, 'web', pathname.slice(1));
    else { response.writeHead(404).end(); return; }
    let body = await readFile(filename);
    if (pathname === '/') body = Buffer.from(body.toString().replace('src="/app.mjs"', 'src="/fixture.mjs"'));
    response.writeHead(200, { 'Content-Type': pathname.endsWith('.mjs') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), 'aim-reader-native-'));
let chrome, socket, cdp, exitPromise;
const results = [], pageErrors = [];
const mutations = [], sourceHashes = {};
const hash = text => createHash('sha256').update(text).digest('hex');
for (const filename of ['web/index.html', 'web/aim.css', 'web/reader.mjs', 'web/writing-helpers.mjs', 'web/upload-state.mjs', 'web/layout.mjs', 'web/editor.mjs', 'tests/fixtures/reader.mjs', 'tests/reader_native.mjs']) {
  sourceHashes[filename] = hash(await readFile(path.join(root, filename)));
}
try {
  chrome = spawn(chromePath, ['--headless=new', '--use-mock-keychain', '--password-store=basic', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  exitPromise = new Promise(resolve => chrome.once('exit', resolve));
  const active = await until(async () => { try { return await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); } catch { return null; } }, 'Chrome DevTools endpoint');
  const [port, endpoint] = active.trim().split('\n');
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let serial = 0;
  const waiting = new Map();
  socket.addEventListener('message', event => {
    const packet = JSON.parse(event.data);
    if (packet.id) {
      const waiter = waiting.get(packet.id); waiting.delete(packet.id);
      if (packet.error) waiter?.reject(new Error(JSON.stringify(packet.error))); else waiter?.resolve(packet.result);
    } else if (packet.method === 'Runtime.exceptionThrown') pageErrors.push(packet.params.exceptionDetails);
  });
  cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial; waiting.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp(method, params, sessionId);
  const evaluate = async expression => {
    const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails));
    return answer.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const box = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}})()`);
  const point = async (selector, kind = 'click') => {
    const b = await box(selector); assert.ok(b && b.width > 0 && b.height > 0, `visible target ${selector}`);
    const x = b.x + Math.min(12, b.width / 2), y = b.y + Math.min(12, b.height / 2);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    if (kind === 'click') {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
  };
  const key = async (name, modifiers = 0, extra = {}) => {
    const code = { Enter: 13, Escape: 27, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[name] ?? name.toUpperCase().charCodeAt(0);
    const data = { key: name, code: name.length === 1 ? `Key${name.toUpperCase()}` : name, windowsVirtualKeyCode: code, modifiers, ...extra };
    await send('Input.dispatchKeyEvent', { type: name === 'Enter' && !modifiers ? 'keyDown' : 'rawKeyDown', ...data,
      ...(name === 'Enter' && !modifiers ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...data });
  };
  const snapshot = () => evaluate('window.fixtureSnapshot()');
  const share = () => evaluate('Number(document.querySelector("#reader-divider").getAttribute("aria-valuenow"))');
  const dragDivider = async (dx, dy) => {
    const grip = await box('#reader-divider');
    const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 8; step++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * step / 8, y: y + dy * step / 8, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', buttons: 0, clickCount: 1 });
  };
  const doubleClickDivider = async () => {
    const grip = await box('#reader-divider'), x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (const clickCount of [1, 2]) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
    }
  };
  const reset = async () => {
    const caseId = String(results.length);
    await send('Page.navigate', { url: origin + '/?case=' + caseId });
    await until(() => evaluate(`document.body?.dataset.fixtureReady === "true" && document.body.dataset.fixtureCase === ${JSON.stringify(caseId)}`), 'new fixture document');
    await point('#open-fixture');
    await until(() => evaluate('document.querySelector("#reader").open'), 'open reader');
    let previous;
    await until(async () => {
      const current = await evaluate(`(()=>{const dialog=document.querySelector('#reader'), b=dialog.getBoundingClientRect();
        return {box:[b.x,b.y,b.width,b.height],ready:getComputedStyle(dialog).opacity==='1' && b.width>0 && b.height>0 &&
          document.getAnimations().every(animation=>animation.playState!=='running')}})()`);
      const stable = current.ready && previous && current.box.every((number, index) => Math.abs(number - previous[index]) < .1);
      previous = current.box;
      return stable;
    }, 'visible settled dialog geometry before native input');
  };
  const cases = [];
  const check = (name, action) => cases.push({ name, action });
  let phase = 'green';
  let observations = [];
  const runCase = async ({ name, action }) => {
    observations = [];
    try {
      await reset(); await action();
      assert.equal(pageErrors.length, 0, 'no browser exceptions');
      results.push({ phase, name, passed: true, observations });
    } catch (error) { results.push({ phase, name, passed: false, error: error.stack, observations }); }
    await until(() => evaluate('document.getAnimations().every(animation => animation.playState !== "running")'), 'settled screenshot');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(evidencePath, `${results.length}.png`), Buffer.from(shot.data, 'base64'));
  };

  await check('hover Return quotes exact words and composer Return stays a newline', async () => {
    await point('#source-body [data-start="0"]', 'move');
    await key('Enter');
    let state = await snapshot();
    assert.equal(state.reply.draft.body, '> The first passage is for an exact quote. \n\n');
    assert.equal(await evaluate('document.activeElement.id'), 'writing-body');
    await send('Input.insertText', { text: 'My response' });
    await point('#source-body [data-start="0"]', 'move');
    await key('Enter');
    state = await snapshot();
    assert.ok(state.reply.draft.body.endsWith('My response\n'));
    assert.equal(state.events.filter(event => event.type === 'send').length, 0);
    await key('Enter', 4);
    assert.equal((await snapshot()).events.filter(event => event.type === 'send').length, 1);
  });

  await check('note Cmd-Return saves only the note and restores opener focus', async () => {
    await point('#writing-body'); await send('Input.insertText', { text: 'Unsent reply' });
    await point('#toggle-note'); await send('Input.insertText', { text: 'Private thought' });
    await key('Enter', 4);
    const state = await snapshot();
    assert.equal(state.reply.draft.body, 'Unsent reply');
    assert.equal(state.note.draft.body, 'Private thought');
    assert.equal(state.events.filter(event => event.type === 'send').length, 0);
    assert.equal(state.events.filter(event => event.type === 'note').length, 1);
    assert.equal(await evaluate('document.querySelector("#reader").open'), false);
    assert.equal(await evaluate('document.activeElement.id'), 'open-fixture');
  });

  await check('default stacks, wide keeps writing full height, layout switch preserves typing', async () => {
    const source = await box('.reading-pane'), writing = await box('.writing-pane');
    assert.ok(writing.y >= source.y + source.height - 2, 'default reading pane must be above writing');
    await point('#writing-body'); await send('Input.insertText', { text: 'Keep my writing' });
    await point('#reader-layout');
    const dialog = await box('#reader'), wide = await box('.writing-pane'), field = await box('#writing-body');
    assert.ok(wide.x > (await box('.reading-pane')).x);
    assert.ok(Math.abs(wide.y - dialog.y) < 3, 'source header cannot shorten the wide writing column');
    assert.ok(wide.height > dialog.height * .94);
    assert.ok(field.height > dialog.height * .5, 'full-height column must leave useful writing space');
    assert.equal((await snapshot()).reply.draft.body, 'Keep my writing');
    await point('#reader-layout');
    assert.equal((await snapshot()).reply.draft.body, 'Keep my writing');
  });

  await check('empty Shift-Cmd-Return returns to gallery without Send', async () => {
    await point('#writing-body'); await key('Enter', 12);
    const state = await snapshot();
    assert.equal(state.events.filter(event => event.type === 'send').length, 0, 'empty Shift-Cmd-Return sends nothing');
    assert.equal(await evaluate('document.querySelector("#reader").open'), false, 'empty Shift-Cmd-Return returns to the gallery');
    assert.equal(state.events.find(event => event.type === 'close')?.reason, 'gallery');
  });

  await check('divider click is inert, native drag changes proportions and preserves typing', async () => {
    await point('#writing-body'); await send('Input.insertText', { text: 'Keep the paragraph through resize' });
    const before = await box('.writing-pane');
    await point('#reader-divider');
    assert.ok(Math.abs((await box('.writing-pane')).height - before.height) < 2, 'bare click cannot move split');
    const grip = await box('#reader-divider');
    const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 8; step++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y - step * 10, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: y - 80, button: 'left', buttons: 0, clickCount: 1 });
    assert.ok((await box('.writing-pane')).height > before.height + 40, 'native drag expands writing');
    assert.equal((await snapshot()).reply.draft.body, 'Keep the paragraph through resize');
    assert.equal((await snapshot()).events.filter(event => event.type === 'send').length, 0);
  });

  await check('nonempty send-and-stay shortcuts each send once and keep the reader open', async () => {
    const body = 'A complete reply stays beside the source.';
    await point('#writing-body'); await send('Input.insertText', { text: body });
    await key('Enter', 12);
    let events = (await snapshot()).events.filter(event => event.type === 'send');
    assert.equal(events.length, 1, 'nonempty Shift-Cmd-Return sends exactly once');
    assert.deepEqual(events[0], { type: 'send', body, stay: true });
    assert.equal(await evaluate('document.querySelector("#reader").open'), true);
    await key('Enter', 1);
    events = (await snapshot()).events.filter(event => event.type === 'send');
    assert.equal(events.length, 2, 'Option-Return sends exactly once');
    assert.deepEqual(events[1], { type: 'send', body, stay: true });
    assert.equal(await evaluate('document.querySelector("#reader").open'), true);
  });

  await check('wide pointer, both-axis keyboard steps and double-click reset preserve writing', async () => {
    const body = 'Keep this text through every kind of divider movement.';
    await point('#writing-body'); await send('Input.insertText', { text: body });
    await point('#reader-layout');
    const before = await box('.writing-pane');
    await dragDivider(-80, 0);
    assert.ok((await box('.writing-pane')).width > before.width + 60, 'wide native drag expands writing');
    const afterDrag = await share();
    await key('ArrowLeft'); assert.equal(await share(), afterDrag + 2, 'wide arrow changes share two points');
    await key('ArrowRight', 8); assert.equal(await share(), afterDrag - 8, 'wide Shift arrow changes share ten points');
    const beforeWrongAxis = await share();
    await key('ArrowUp'); assert.equal(await share(), beforeWrongAxis, 'wrong-axis arrow is inert');
    assert.equal((await snapshot()).reply.draft.body, body);
    await doubleClickDivider();
    assert.equal(await share(), 45, 'wide double-click resets its share');
    assert.ok(Math.abs((await box('.writing-pane')).width - before.width) < 1);
    await point('#reader-layout');
    await point('#reader-divider');
    await key('ArrowUp'); assert.equal(await share(), 50, 'stacked arrow changes share two points');
    await key('ArrowDown', 8); assert.equal(await share(), 40, 'stacked Shift arrow changes share ten points');
    await key('ArrowLeft'); assert.equal(await share(), 40, 'stacked wrong-axis arrow is inert');
    await doubleClickDivider(); assert.equal(await share(), 48, 'stacked double-click resets its share');
    assert.equal((await snapshot()).reply.draft.body, body);
    assert.equal((await snapshot()).events.filter(event => event.type === 'send').length, 0);
  });

  await check('layout switches and both native drags preserve the actual field selection and source anchor', async () => {
    const anchoring = await evaluate('getComputedStyle(document.querySelector("#source-body")).overflowAnchor');
    observations.push({ label: 'computed source anchoring', overflowAnchor: anchoring });
    assert.equal(anchoring, 'none', 'explicit source-place restoration owns layout changes');
    const source = await box('#source-body');
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: source.x + 30, y: source.y + 50 });
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: source.x + 30, y: source.y + 50, deltaX: 0, deltaY: 680 });
    let lastScroll = -1;
    await until(async () => {
      const top = await evaluate('document.querySelector("#source-body").scrollTop');
      const settled = top > 400 && Math.abs(top - lastScroll) < .1;
      lastScroll = top; return settled;
    }, 'native source wheel settles away from the beginning');
    await point('#writing-body'); await send('Input.insertText', { text: 'Keep this selected phrase while the panes change.' });
    for (let count = 0; count < 5; count++) await key('ArrowLeft');
    for (let count = 0; count < 7; count++) await key('ArrowLeft', 8);
    const place = () => evaluate(`(()=>{const field=document.querySelector('#writing-body'), source=document.querySelector('#source-body');
      const top=source.getBoundingClientRect().top, span=[...source.children].find(part=>part.getBoundingClientRect().bottom>top);
      return {selection:[field.selectionStart,field.selectionEnd],body:field.value,anchor:span?.dataset.start,offset:span?.getBoundingClientRect().top-top,scrollTop:source.scrollTop}})()`);
    const original = await place();
    observations.push({ label: 'before', ...original });
    assert.equal(original.selection[1] - original.selection[0], 7, 'native Shift-arrow made a real selection');
    assert.ok(Number(original.anchor) > 0, 'source starts at a distinguishable scrolled passage');
    const preserved = async label => {
      const current = await place();
      observations.push({ label, ...current });
      assert.deepEqual(current.selection, original.selection, `${label}: field selection is preserved`);
      assert.equal(current.body, original.body);
      assert.equal(current.anchor, original.anchor, `${label}: visible source anchor is preserved`);
      assert.ok(Math.abs(current.offset - original.offset) < 1, `${label}: source anchor offset is preserved`);
    };
    await point('#reader-layout'); await preserved('switch to wide');
    await dragDivider(-70, 0); await preserved('wide drag');
    await point('#reader-layout'); await preserved('switch to stacked');
    await dragDivider(0, -60); await preserved('stacked drag');
  });

  const selectedCases = mode === '--keyboard' ? cases.slice(0, 1) : mode === '--anchor-control' ? cases.slice(7) : mode === '--review-gaps' ? cases.slice(5) : cases.slice(0, 5);
  for (const item of selectedCases) await runCase(item);
  if (['--mutations', '--review-gaps', '--anchor-control'].includes(mode) && results.every(result => result.passed)) {
    const definitions = mode === '--mutations' ? [
      { name: 'empty-gallery-falls-through-to-send', file: 'web/editor.mjs', index: 3,
        from: "if (event.metaKey && event.shiftKey && writingEmpty && ['reader', 'reply'].includes(context)) return 'return-gallery';",
        // Falling through to Send: an empty draft is not sent (Reader.send
        // refuses it), so what fails is that the Reader stays open.
        to: "if (false) return 'return-gallery';", expected: /empty Shift-Cmd-Return returns to the gallery/ },
      { name: 'divider-ignores-real-pointer-movement', file: 'web/reader.mjs', index: 4,
        from: 'this.layout.setShare(drag.share + delta / drag.extent, drag.shape);',
        to: 'this.layout.setShare(drag.share, drag.shape);', expected: /native drag expands writing/ },
    ] : [
      { name: 'nonempty-reply-misread-as-empty', file: 'web/reader.mjs', index: 5,
        from: 'writingEmpty: !reply.body.trim() && !reply.attachments.length', to: 'writingEmpty: true', expected: /nonempty Shift-Cmd-Return sends exactly once/ },
      { name: 'wide-divider-sign-reversed', file: 'web/reader.mjs', index: 6,
        from: 'drag.x - event.clientX', to: 'event.clientX - drag.x', expected: /wide native drag expands writing/ },
      { name: 'keyboard-large-step-ignored', file: 'web/reader.mjs', index: 6,
        from: 'direction * (event.shiftKey ? .1 : .02)', to: 'direction * .02', expected: /wide Shift arrow changes share ten points/ },
      { name: 'double-click-keeps-custom-share', file: 'web/reader.mjs', index: 6,
        from: 'this.layout.resetShare(this.layoutShape);', to: 'this.layout.share(this.layoutShape);', expected: /wide double-click resets its share/ },
      { name: 'layout-loses-field-selection', file: 'web/reader.mjs', index: 7,
        from: 'this.restoreVisiblePlace(place);', to: 'this.restoreVisiblePlace(place); this.field.setSelectionRange(0, 0);', expected: /field selection is preserved/ },
      { name: 'layout-does-not-restore-reading-anchor', file: 'web/reader.mjs', index: 7,
        from: 'this.restoreVisiblePlace(place);', to: 'void place;', expected: /source anchor(?: offset)? is preserved/ },
    ];
    for (const mutant of mode === '--anchor-control' ? definitions.slice(-1) : definitions) {
      const file = path.join(root, mutant.file), original = await readFile(file, 'utf8');
      assert.equal(original.split(mutant.from).length, 2, `unique mutation target: ${mutant.name}`);
      const changed = original.replace(mutant.from, mutant.to); assert.notEqual(changed, original);
      try {
        await writeFile(file, changed); assert.equal(await readFile(file, 'utf8'), changed);
        phase = mutant.name;
        await runCase(cases[mutant.index]);
        const result = results.at(-1);
        result.expectedFailure = true;
        result.mutationCaught = !result.passed && mutant.expected.test(result.error) && pageErrors.length === 0;
        mutations.push({ name: mutant.name, file: mutant.file, originalHash: hash(original), mutantHash: hash(changed), caught: result.mutationCaught });
      } finally {
        await writeFile(file, original); assert.equal(await readFile(file, 'utf8'), original);
      }
    }
    phase = 'restored';
    for (const item of selectedCases) await runCase(item);
  }
} finally {
  let closed = false;
  if (cdp) {
    try { await Promise.race([cdp('Browser.close'), sleep(2000)]); } catch { /* socket can close with its browser */ }
    if (chrome) {
      closed = await Promise.race([exitPromise.then(() => true), sleep(5000).then(() => false)]);
    }
  }
  // Never signal a Chrome. An unexpected launch/close failure leaves the owned
  // profile named in evidence for an explicit graceful-cleanup follow-up.
  if (socket) socket.close();
  await new Promise(resolve => server.close(resolve));
  if (closed) await rm(profile, { recursive: true, force: true });
  await writeFile(path.join(evidencePath, 'results.json'), JSON.stringify({ origin, profile, closed, sourceHashes, mutations, pageErrors, results }, null, 2));
  console.log(JSON.stringify({ closed, results }, null, 2));
  if (!closed || results.some(result => result.expectedFailure ? !result.mutationCaught : !result.passed)) process.exitCode = 1;
}
