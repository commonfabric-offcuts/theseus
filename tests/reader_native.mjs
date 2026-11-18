// One isolated Chrome for Testing, actual CDP input, graceful Browser.close.
// This fixture proves UI interactions only; it has no Store or HTTP adapter.
import assert from 'node:assert/strict';
import { reachWith } from './compose-reach.mjs';
import { quoteSelectionBlock } from './reader_quote_mutation.mjs';
import { devtoolsControl, endRun } from './devtools_control.mjs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const [chromePath, evidencePath, mode] = process.argv.slice(2);
assert.ok(mode === undefined || ['--mutations', '--review-gaps', '--anchor-control', '--keyboard', '--finished'].includes(mode), 'only explicit evidence modes are accepted');
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
for (const filename of ['web/index.html', 'web/aim.css', 'web/reader.mjs', 'web/lines.mjs', 'web/api.mjs', 'web/writing-helpers.mjs', 'web/upload-state.mjs', 'web/layout.mjs', 'web/editor.mjs', 'web/app-session.mjs', 'web/message-menu.mjs', 'web/glyphs.mjs', 'tests/fixtures/reader.mjs', 'tests/reader_native.mjs', 'tests/reader_quote_mutation.mjs', 'tests/devtools_control.mjs']) {
  sourceHashes[filename] = hash(await readFile(path.join(root, filename)));
}
try {
  chrome = spawn(chromePath, ['--headless=new', '--use-mock-keychain', '--password-store=basic', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  exitPromise = new Promise(resolve => chrome.once('exit', (code, signal) => resolve({ code, signal })));
  const active = await until(async () => { try { return await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); } catch { return null; } }, 'Chrome DevTools endpoint');
  const [port, endpoint] = active.trim().split('\n');
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  // Each command is bounded, and refused at once when the socket, the page or this Chrome goes (devtools_control.mjs).
  const control = devtoolsControl(socket, { event: packet => { if (packet.method === 'Runtime.exceptionThrown') pageErrors.push(packet.params.exceptionDetails); } });
  cdp = control.cdp;
  exitPromise.then(({ code, signal }) => control.end(`Chrome exited ${code ?? signal}`));
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp(method, params, sessionId);
  const evaluate = async expression => {
    const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (answer.exceptionDetails) throw new Error(JSON.stringify(answer.exceptionDetails));
    return answer.result.value;
  };
  // Inspector reports the page's crash on its session.
  await send('Page.enable'); await send('Runtime.enable'); await send('Inspector.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const box = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}})()`);
  const point = async (selector, kind = 'click') => {
    if (kind === 'click' && await reach(selector)) return;
    const b = await box(selector); assert.ok(b && b.width > 0 && b.height > 0, `visible target ${selector}`);
    const x = b.x + Math.min(12, b.width / 2), y = b.y + Math.min(12, b.height / 2);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    if (kind === 'click') {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
  };
  // A control the composer or the ⋯ keeps out of sight is reached first, as a person does (compose-reach.mjs).
  const reach = reachWith({ evaluate, point: selector => point(selector), until });
  const key = async (name, modifiers = 0, extra = {}) => {
    const code = { Enter: 13, Escape: 27, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[name] ?? name.toUpperCase().charCodeAt(0);
    const data = { key: name, code: name.length === 1 ? `Key${name.toUpperCase()}` : name, windowsVirtualKeyCode: code, modifiers, ...extra };
    await send('Input.dispatchKeyEvent', { type: name === 'Enter' && !modifiers ? 'keyDown' : 'rawKeyDown', ...data,
      ...(name === 'Enter' && !modifiers ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...data });
  };
  // The Reader's ⋯ menu is placed against the window; while the dialog's
  // opening animation still moves the dialog it would sit outside it, and a
  // press on its item would be a press outside the Reader. Native input on it
  // waits for the dialog to settle, as reset() does.
  const settled = () => until(() => evaluate('document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(animation => animation.playState !== "running")'), 'settled reader');
  // Wide or Stacked is an item in the Reader's ⋯ (docs/links.md): a native
  // press on the ⋯, then on the item it lists.
  const switchLayout = async () => {
    await settled();
    await point('#reader-menu');
    const label = await until(() => evaluate(`document.querySelector('.message-menu-list [role=menuitem]')?.textContent`), "the Reader's menu");
    assert.match(label, /^(Wide|Stacked) layout$/);
    await point('.message-menu-list [role=menuitem]');
    await until(() => evaluate(`!document.querySelector('.message-menu-list')`), 'the menu closed');
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
          document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(animation=>animation.playState!=='running')}})()`);
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
    // One line per case as it ends, so a log cut short names the last case that ran.
    console.log(JSON.stringify({ phase, case: name, passed: results.at(-1).passed }));
    await until(() => evaluate('document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(animation => animation.playState !== "running")'), 'settled screenshot');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(evidencePath, `${results.length}.png`), Buffer.from(shot.data, 'base64'));
  };

  // What the page holds when the Return that quotes has finished: a listener
  // on the window hears the keydown after the Reader's own. The writing field
  // must be focused with a caret at the end of its text; a browser draws the
  // caret from the document's selection, so a selection cleared after the
  // field took focus leaves no caret until the window is focused again.
  const watchReturn = () => evaluate(`window.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    const field = document.querySelector('#writing-body'), selection = getSelection();
    window.returnEnd = { active: document.activeElement.id, selection: selection.type, start: field.selectionStart, end: field.selectionEnd, length: field.value.length };
  }, { once: true })`);
  const caretAfterQuote = async label => {
    const end = await evaluate('window.returnEnd');
    observations.push({ label, ...end });
    assert.equal(end.active, 'writing-body', `${label}: the field is focused when Return has finished`);
    assert.equal(end.selection, 'Caret', `${label}: the document's selection is the field's caret when Return has finished`);
    assert.deepEqual([end.start, end.end], [end.length, end.length], `${label}: the caret is at the end of the writing`);
    const after = await evaluate(`(()=>{const f=document.querySelector('#writing-body');return {active:document.activeElement.id,selection:getSelection().type,start:f.selectionStart,length:f.value.length}})()`);
    assert.deepEqual(after, { active: 'writing-body', selection: 'Caret', start: end.length, length: end.length }, `${label}: nothing after Return moves focus or the caret`);
  };

  await check('hover Return quotes exact words and composer Return stays a newline', async () => {
    await point('#source-body [data-start="0"]', 'move');
    await watchReturn();
    await key('Enter');
    let state = await snapshot();
    assert.equal(state.reply.draft.body, '> The first passage is for an exact quote. \n\n');
    await caretAfterQuote('hover Return');
    await send('Input.insertText', { text: 'My response' });
    await point('#source-body [data-start="0"]', 'move');
    await key('Enter');
    state = await snapshot();
    assert.ok(state.reply.draft.body.endsWith('My response\n'));
    assert.equal(state.events.filter(event => event.type === 'send').length, 0);
    await key('Enter', 4);
    assert.equal((await snapshot()).events.filter(event => event.type === 'send').length, 1);
    // A passage dragged over, then Return: the caret waits after the quote.
    const words = await box('#source-body [data-start="0"]'), y = words.y + words.height / 2;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: words.x + 2, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: words.x + 2, y, button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 6; step++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: words.x + 2 + step * 25, y, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: words.x + 152, y, button: 'left', buttons: 0, clickCount: 1 });
    const dragged = await evaluate('getSelection().toString()');
    assert.ok(dragged.length > 5 && await evaluate('document.activeElement.id') === 'source-body', 'a native drag selected words of the message');
    await watchReturn();
    await key('Enter');
    assert.ok((await snapshot()).reply.draft.body.endsWith(`> ${dragged}\n\n`));
    await caretAfterQuote('dragged Return');
    await send('Input.insertText', { text: 'Typed after' });
    assert.ok((await snapshot()).reply.draft.body.endsWith(`> ${dragged}\n\nTyped after`));
  });

  await check('note Cmd-Return saves only the note and keeps the Reader open on the reply', async () => {
    await point('#writing-body'); await send('Input.insertText', { text: 'Unsent reply' });
    await point('#toggle-note'); await send('Input.insertText', { text: 'Private thought' });
    await key('Enter', 4);
    await until(() => evaluate("document.querySelector('#toggle-note').textContent === 'Show note'"), 'the saved note hands back to the reply');
    const state = await snapshot();
    assert.equal(state.reply.draft.body, 'Unsent reply');
    assert.equal(state.note.draft.body, 'Private thought');
    assert.equal(state.events.filter(event => event.type === 'send').length, 0);
    assert.equal(state.events.filter(event => event.type === 'note').length, 1);
    assert.equal(state.events.filter(event => event.type === 'close').length, 0, 'saving the note closes nothing');
    assert.equal(await evaluate('document.querySelector("#reader").open'), true, 'the Reader stays open');
    const field = await evaluate(`(()=>{const f=document.querySelector('#writing-body');return {active:document.activeElement.id,value:f.value,caret:[f.selectionStart,f.selectionEnd]}})()`);
    assert.deepEqual(field, { active: 'writing-body', value: 'Unsent reply', caret: [12, 12] }, 'back on the reply as it was, the cursor where it was');
  });

  await check('default stacks, wide keeps writing full height, layout switch preserves typing', async () => {
    const source = await box('.reading-pane'), writing = await box('.writing-pane');
    assert.ok(writing.y >= source.y + source.height - 2, 'default reading pane must be above writing');
    await point('#writing-body'); await send('Input.insertText', { text: 'Keep my writing' });
    await switchLayout();
    const dialog = await box('#reader'), wide = await box('.writing-pane'), field = await box('#writing-body');
    assert.ok(wide.x > (await box('.reading-pane')).x);
    assert.ok(Math.abs(wide.y - dialog.y) < 3, 'source header cannot shorten the wide writing column');
    assert.ok(wide.height > dialog.height * .94);
    assert.ok(field.height > dialog.height * .5, 'full-height column must leave useful writing space');
    assert.equal((await snapshot()).reply.draft.body, 'Keep my writing');
    await switchLayout();
    assert.equal((await snapshot()).reply.draft.body, 'Keep my writing');
  });

  await check('empty Shift-Cmd-Return returns to gallery without Send', async () => {
    await point('#writing-body'); await key('Enter', 12);
    const state = await snapshot();
    assert.equal(state.events.filter(event => event.type === 'send').length, 0, 'empty Shift-Cmd-Return sends nothing');
    assert.equal(await evaluate('document.querySelector("#reader").open'), false, 'empty Shift-Cmd-Return returns to the gallery');
    assert.equal(state.events.find(event => event.type === 'close')?.reason, 'gallery');
  });

  // Stacked, the reply is as tall as its writing and the message takes the
  // rest (docs/reader.md): there is no divider to drag.
  await check('stacked has no divider: the message takes all the room the reply does not, and writing grows the reply only to its field\'s height', async () => {
    const panes = async () => ({ reading: await box('.reading-pane'), writing: await box('.writing-pane'), dialog: await box('#reader'),
      divider: await evaluate('document.querySelector("#reader-divider").getClientRects().length') });
    const line = await panes();
    observations.push({ label: 'reading', ...line });
    assert.equal(line.divider, 0, 'no divider in the stacked Reader');
    assert.ok(Math.abs(line.reading.y + line.reading.height - line.writing.y) < 2, 'the message runs down to the reply');
    assert.ok(line.writing.height < 90, `reading, the reply is its one line (${line.writing.height}px)`);
    await point('#writing-body'); await send('Input.insertText', { text: Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of the reply`).join('\n') });
    const writing = await panes();
    observations.push({ label: 'writing twelve lines', ...writing });
    assert.ok(writing.writing.height > line.writing.height, 'writing grows the reply');
    assert.ok(writing.writing.height < writing.dialog.height * .45, `the reply stops at its field's height and the message keeps the rest (${writing.writing.height}px of ${writing.dialog.height}px)`);
    assert.ok(Math.abs(writing.reading.y + writing.reading.height - writing.writing.y) < 2, 'the message still runs down to the reply');
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

  await check('wide pointer, keyboard steps and double-click reset preserve writing', async () => {
    const body = 'Keep this text through every kind of divider movement.';
    await point('#writing-body'); await send('Input.insertText', { text: body });
    await switchLayout();
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
    assert.equal((await snapshot()).reply.draft.body, body);
    assert.equal((await snapshot()).events.filter(event => event.type === 'send').length, 0);
  });

  await check('layout switches and the wide drag preserve the actual field selection and source anchor', async () => {
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
    await switchLayout(); await preserved('switch to wide');
    await dragDivider(-70, 0); await preserved('wide drag');
    await switchLayout(); await preserved('switch to stacked');
  });

  // The Reader and reply box, finished (--finished): what the page shows and
  // what real presses and keys do. Each case is broken below by a mutant.
  await check('finished heading is the topic name and goes back to it; no Reply row; the quote pill says what Shift-click and Return do', async () => {
    const page = await evaluate(`(()=>{const h=document.querySelector('#reader-title'),back=document.querySelector('#reader-parent');
      return {heading:h.textContent,button:h.querySelector('button')?.textContent??null,origin:document.querySelector('#reader-origin').textContent,
        back:back.textContent,backName:back.getAttribute('aria-label'),hint:document.querySelector('#quote-selection').title,
        placeholder:document.querySelector('#writing-body').placeholder,
        writingWords:[...document.querySelectorAll('.writing-pane h3,.writing-pane .writing-heading')].map(e=>e.textContent)}})()`);
    observations.push({ label: 'page', ...page });
    assert.deepEqual(page, { heading: 'Fixture topic', button: 'Fixture topic', origin: 'Fixture writer', back: '←', backName: 'Back to the topic',
      hint: 'Shift-click extends the lit passage · Return inserts it as a quote', placeholder: 'Reply…', writingWords: [] },
    'the topic\'s name heads the message, with no "Message" or "Topic" words and no Reply row');
    await point('#reader-title button');
    await until(() => evaluate('!document.querySelector("#reader").open'), 'a press on the heading closes the Reader');
    assert.deepEqual((await snapshot()).events.filter(event => event.type === 'close').map(event => event.reason), ['parent'], 'the heading goes back to the topic, as the arrow does');
  });

  await check('finished the message wears no ring when the Reader focuses it, and shows one when Tabbed onto', async () => {
    const ring = () => evaluate(`(()=>{const s=document.querySelector('#source-body'),c=getComputedStyle(s);return {active:document.activeElement.id,ring:c.outlineStyle,visible:s.matches(':focus-visible')}})()`);
    // Opened from the keyboard, as a card is, so the browser would draw a ring.
    await key('Escape');
    await until(() => evaluate('!document.querySelector("#reader").open && document.activeElement.id === "open-fixture"'), 'closed, focus back on the opener');
    await key('Enter');
    await until(() => evaluate('document.querySelector("#reader").open && document.activeElement.id === "source-body"'), 'opened from the keyboard, focus on the message');
    const opened = await ring();
    observations.push({ label: 'opened by keyboard', ...opened });
    assert.equal(opened.visible, true, 'the browser takes this focus as one to show');
    assert.equal(opened.ring, 'none', 'the message wears no ring when the Reader puts focus on it');
    // A pointer press on the header, which leaves focus on the Reader's ⋯ (the
    // menu gives it back to what opened it), so the browser would show no ring.
    await switchLayout(); await switchLayout();
    await key('Tab'); await key('Tab');
    const tabbed = await ring();
    observations.push({ label: 'tabbed', ...tabbed });
    assert.deepEqual([tabbed.active, tabbed.ring], ['source-body', 'solid'], 'a keyboard user who Tabs onto the message sees the ring');
  });

  await check('finished + holds Add note after Add image, looking like it; Done keeps the Reader open; a note shows in yellow, light and dark', async () => {
    const look = selector => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),c=getComputedStyle(e),b=e.getBoundingClientRect();
      return {text:e.textContent,x:b.x,right:b.right,y:Math.round(b.y),height:Math.round(b.height),font:c.fontSize+' '+c.fontWeight+' '+c.fontFamily,
        padding:c.padding,border:c.borderTopWidth+' '+c.borderTopStyle,radius:c.borderRadius,background:c.backgroundColor,borderColor:c.borderTopColor}})()`);
    const plusOpen = async () => { if (await evaluate('document.querySelector("#plus-panel").hidden')) await point('#plus-button'); await until(() => evaluate('!document.querySelector("#plus-panel").hidden'), 'the + panel'); };
    // The Mac's own scheme can be either; each look says which it measures.
    const scheme = value => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
    await scheme('light');
    await plusOpen();
    const plain = await look('#toggle-note'), image = await look('#add-image');
    observations.push({ label: 'no note', plain, image });
    assert.equal(plain.text, 'Add note');
    assert.ok(image.right <= plain.x && plain.x - image.right < 16 && plain.y === image.y, 'Add note sits just after Add image');
    for (const property of ['y', 'height', 'font', 'padding', 'border', 'radius', 'background', 'borderColor']) assert.equal(plain[property], image[property], `Add note has Add image's ${property}`);
    await point('#toggle-note');
    await until(() => evaluate('document.querySelector("#plus-panel").hidden && document.activeElement.id === "writing-body"'), 'the note tile puts + away, the writing focused');
    await send('Input.insertText', { text: 'Ask about the deploy' });
    assert.equal(await evaluate("document.querySelector('#send-reply').textContent"), 'Done');
    await point('#send-reply');
    await until(() => evaluate("document.querySelector('#toggle-note').textContent === 'Show note'"), 'Done goes back to the reply');
    assert.equal(await evaluate('document.querySelector("#reader").open'), true, 'Done keeps the Reader open');
    await plusOpen();
    const light = await look('#toggle-note');
    await scheme('dark');
    const dark = await look('#toggle-note'), darkImage = await look('#add-image');
    await scheme('light');
    observations.push({ label: 'with a note', light, dark, darkImage });
    assert.equal(light.background, 'rgb(252, 239, 181)', 'a soft yellow in light');
    assert.equal(dark.background, 'rgb(85, 74, 28)', 'a dim yellow in dark');
    assert.notEqual(dark.background, darkImage.background, 'in dark it still stands apart from Add image');
    for (const property of ['y', 'height', 'font', 'padding', 'radius']) assert.equal(light[property], image[property], `Show note keeps Add image's ${property}`);
    await point('#toggle-note'); await key('a', 4, { commands: ['selectAll'] }); await key('Backspace', 0, { code: 'Backspace', windowsVirtualKeyCode: 8 });
    assert.equal(await evaluate("document.querySelector('#writing-body').value"), '', 'the note is emptied');
    await point('#send-reply');
    await until(() => evaluate("document.querySelector('#toggle-note').textContent === 'Add note'"), 'an emptied note brings back Add note');
    await plusOpen();
    assert.equal((await look('#toggle-note')).background, image.background, 'and its plain look');
    assert.equal((await snapshot()).events.filter(event => event.type === 'close').length, 0, 'nothing closed the Reader');
    await send('Emulation.setEmulatedMedia', { features: [] });
  });

  await check('finished the arrows go up and down as the page does, by button and by key', async () => {
    const arrows = await evaluate(`[...document.querySelectorAll('#reader-stepping button')].map(b=>({id:b.id,text:b.textContent,label:b.getAttribute('aria-label'),title:b.title,x:b.getBoundingClientRect().x}))`);
    observations.push({ label: 'arrows', arrows });
    assert.deepEqual(arrows.map(arrow => [arrow.id, arrow.text, arrow.label, arrow.title]),
      [['next-message', '↑', 'Previous message (above)', 'Previous message (above)'], ['previous-message', '↓', 'Next message (below)', 'Next message (below)']], 'up is the message above, and comes first');
    assert.ok(arrows[0].x < arrows[1].x, 'up sits before down');
    await point('#next-message'); await point('#previous-message');
    await point('#source-body'); await key('ArrowUp', 4); await key('ArrowDown', 4); await key('ArrowLeft', 4); await key('ArrowRight', 4);
    assert.deepEqual((await snapshot()).events.filter(event => event.type === 'step').map(event => event.direction), [1, -1, 1, -1],
      '↑ and ⌘↑ open the newer message, ↓ and ⌘↓ the older; ⌘← and ⌘→ do nothing');
  });

  // The save status beside the buttons, wherever the writing column is
  // narrow: a narrow window in either layout, the Wide layout with its divider
  // anywhere, a phone, and the topic's new-message composer. The status is one
  // line whatever it says, so its words are never measured against a guess:
  // these are the longest it says today, words built elsewhere (an image's
  // file name, the cleanup error) and words no status says yet. The writing
  // and the buttons stay still for every one of them, "Saved to Theseus" reads
  // whole wherever the footer has room to read in, and a tap on a status too
  // long for its line shows all of it.
  await check('finished the save status is one line whatever it says: no words move the writing, "Saved to Theseus" reads whole at every width and layout, and a tap shows all of a long status', async () => {
    const long = 'Finish or remove the image Screenshot 2026-11-07 at 10.32.15 AM.png before sending.';
    const words = ['Saved to Theseus', 'Saved', 'Source or destination unavailable — writing kept on this device',
      'The image change is not saved on this device. Retry before sending.', 'Saved; recovery-copy cleanup could not finish. Retry from Review versions.',
      long, `Finish or remove the image ${'IMG_0001-'.repeat(40)}.png before sending.`, 'Words no status says yet. '.repeat(12)];
    const rem = 16, roomy = 12 * rem, whoWords = 'Tell fixture-notebook-agent, auditor and reviewer · everyone here';
    let opened = 0;
    const measure = surface => evaluate(`(()=>{const at=s=>{const b=document.querySelector(s).getBoundingClientRect();return [b.x,b.y,b.width,b.height].map(n=>Math.round(n*2)/2)};
      const lines=e=>{const r=document.createRange();r.selectNodeContents(e);return new Set([...r.getClientRects()].filter(b=>b.width>0).map(b=>Math.round(b.top))).size};
      const ids=${JSON.stringify(surface)}==='reader'?['#writing-body','#send-reply','#plus-button','#who-chip','#reader .compose-head']:['#inline-writing-body','#inline-send','#inline-plus-button','#inline-who-chip','#inline-composer .compose-head'];
      const status=document.querySelector(${JSON.stringify(surface)}==='reader'?'#save-state':'#inline-save-state'),hint=document.querySelector(${JSON.stringify(surface)}==='reader'?'#writing-hint':'#inline-writing-hint');
      return {boxes:ids.map(at),footer:at(ids.at(-1))[2],status:at('#'+status.id),statusLines:lines(status),whole:status.scrollWidth<=status.clientWidth,hintLines:lines(hint)}})()`);
    const say = (status, text) => evaluate(`document.querySelector(${JSON.stringify(status)}).textContent = ${JSON.stringify(text)}`);
    // The cases after this one run at the harness's own window size.
    try {
      for (const [width, height, mobile = false] of [[1440, 900], [1000, 800], [900, 800], [800, 800], [761, 800], [390, 844, true]]) {
        for (const view of ['stacked', 'wide', 'wide, writing narrowest', 'wide, writing widest', 'composer']) {
          await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
          const caseId = `${results.length}-sweep-${++opened}`;
          await send('Page.navigate', { url: origin + '/?case=' + caseId + (view === 'composer' ? '&composer' : '') });
          await until(() => evaluate(`document.body?.dataset.fixtureReady === "true" && document.body.dataset.fixtureCase === ${JSON.stringify(caseId)} && matchMedia("(max-width: 760px)").matches === ${width <= 760}`), 'fixture at its width');
          const surface = view === 'composer' ? 'composer' : 'reader';
          if (surface === 'reader') {
            await point('#open-fixture'); await until(() => evaluate('document.querySelector("#reader").open'), 'open reader');
            if (view.startsWith('wide')) {
              // Wide is a choice in the Reader's ⋯ only where the window can choose; a phone is always stacked.
              await settled(); await point('#reader-menu');
              const choice = await evaluate(`document.querySelector('.message-menu-list [role=menuitem]')?.textContent ?? null`);
              if (choice === null) continue;
              assert.equal(choice, 'Wide layout', `${width}px: the Reader's ⋯ offers Wide`);
              await point('.message-menu-list [role=menuitem]'); await until(() => evaluate('document.querySelector("#reader").dataset.layout === "wide"'), 'wide layout');
            }
            if (view.includes('writing')) {
              await point('#reader-divider');
              for (let step = 0; step < 4; step++) await key(view.endsWith('narrowest') ? 'ArrowRight' : 'ArrowLeft', 8);
              assert.equal(await share(), view.endsWith('narrowest') ? 20 : 80, `${view}: the divider is at its end`);
            }
          }
          // The status shows in the head row while writing (docs/reader.md).
          await point(surface === 'reader' ? '#writing-body' : '#inline-writing-body');
          await until(() => evaluate('document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(animation => animation.playState !== "running")'), 'settled layout');
          const label = `${width}px ${view}`, status = surface === 'reader' ? '#save-state' : '#inline-save-state';
          // The who chip with the words a reply naming three people gives it
          // (whisper-choice.mjs, chipWords). Were the chip let take the head
          // row, a chip this long leaves the status beside it less room than
          // "Saved to Theseus" in the head rows of several views here (a status
          // without its 3.5rem wraps below the chip, and reads whole there).
          // The fixture's own "Everyone here" is short enough to leave it its
          // room in every view, the Reader growing with the window (item 400).
          const chip = surface === 'reader' ? '#who-chip' : '#inline-who-chip';
          await evaluate(`document.querySelector(${JSON.stringify(chip)}).textContent = ${JSON.stringify(whoWords)}`);
          const shown = [];
          for (const text of words) { await say(status, text); shown.push({ text, ...await measure(surface) }); }
          const first = shown[0];
          assert.equal(await evaluate(`document.querySelector(${JSON.stringify(chip)}).textContent`), whoWords, `${label}: the who chip kept its words while the status changed`);
          observations.push({ label, footer: first.footer, status: first.status, whole: Object.fromEntries(shown.map(item => [item.text.slice(0, 40), item.whole])), hintLines: first.hintLines });
          for (const item of shown) assert.deepEqual(item.boxes, first.boxes, `${label}: "${item.text}" moves nothing: the writing and the buttons stay still`);
          for (const item of shown) assert.equal(item.statusLines, 1, `${label}: "${item.text}" takes one line`);
          if (first.footer < roomy) continue;
          assert.equal(first.whole, true, `${label}: "Saved to Theseus" reads whole beside the who chip`);
          assert.ok(first.hintLines <= 2, `${label}: the hint takes at most two lines`);
          if (width !== 1440 || view !== 'stacked') continue;
          // A tap on a status too long for its line shows all of it, in place;
          // a tap back in the writing returns it to its line.
          // The head row gives the status the width the who chip leaves, so the
          // longest file name stands in for a status too long for it.
          await say(status, words[6]);
          assert.equal((await measure(surface)).whole, false, `${label}: the long status ends in an ellipsis`);
          await point(status);
          const tapped = await measure(surface);
          observations.push({ label: `${label} tapped`, lines: tapped.statusLines, whole: tapped.whole });
          assert.ok(tapped.whole && tapped.statusLines > 1, `${label}: a tap shows all its words`);
          await point('#writing-body');
          assert.deepEqual((await measure(surface)).boxes, first.boxes, `${label}: back in the writing, the status is one line again`);
        }
      }
    } finally { await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); }
  });

  const selectedCases = mode === '--keyboard' ? cases.slice(0, 1) : mode === '--anchor-control' ? cases.slice(7, 8) : mode === '--review-gaps' ? cases.slice(5, 8)
    : mode === '--finished' ? cases.slice(8) : cases.slice(0, 5);
  for (const item of selectedCases) await runCase(item);
  if (['--mutations', '--review-gaps', '--anchor-control', '--finished'].includes(mode) && results.every(result => result.passed)) {
    // Quoting, from letting go of the selection to scrolling the field (web/reader.mjs).
    const quoteBlock = quoteSelectionBlock(await readFile(path.join(root, 'web/reader.mjs'), 'utf8'));
    const definitions = mode === '--mutations' ? [
      { name: 'empty-gallery-falls-through-to-send', file: 'web/editor.mjs', index: 3,
        from: "if (event.metaKey && event.shiftKey && writingEmpty && ['reader', 'reply'].includes(context)) return 'return-gallery';",
        // Falling through to Send: an empty draft is not sent (Reader.send
        // refuses it), so what fails is that the Reader stays open.
        to: "if (false) return 'return-gallery';", expected: /empty Shift-Cmd-Return returns to the gallery/ },
      { name: 'divider-ignores-real-pointer-movement', file: 'web/reader.mjs', index: 6,
        from: "this.layout.setShare(drag.share + delta / drag.extent, 'wide');",
        to: "this.layout.setShare(drag.share, 'wide');", expected: /wide native drag expands writing/ },
      // The stacked Reader as it was: a share of the height for the reply, whatever it holds.
      { name: 'stacked-reply-keeps-a-share', file: 'web/aim.css', index: 4,
        from: 'grid-template-rows:auto minmax(0,1fr) auto;height:100%', to: 'grid-template-rows:auto minmax(0,52fr) minmax(min-content,48fr);height:100%',
        expected: /reading, the reply is its one line/ },
      // The quote as the preview had it when the cursor did not show: the
      // message's selection let go last, after the field had focus and its
      // caret, which clears the caret it was drawing.
      { name: 'quote-lets-go-of-the-selection-last', file: 'web/reader.mjs', index: 0,
        from: quoteBlock, to: quoteBlock.replace('    window.getSelection()?.removeAllRanges();\n', '') + '    window.getSelection()?.removeAllRanges();\n',
        expected: /the document's selection is the field's caret/ },
    ] : mode === '--finished' ? [
      { name: 'heading-stays-message', file: 'web/reader.mjs', index: 8,
        from: 'this.paintTitle(source, topics);', to: "this.$('reader-title').textContent = source.title || 'Message';", expected: /the topic's name heads the message/ },
      { name: 'ring-on-the-readers-own-focus', file: 'web/aim.css', index: 9,
        from: '#source-body:focus-visible:not([data-tabbed]){outline:none}', to: '', expected: /no ring when the Reader puts focus on it/ },
      { name: 'tab-not-told-apart', file: 'web/reader.mjs', index: 9,
        from: 'this.tabbing = true;', to: 'this.tabbing = false;', expected: /Tabs onto the message sees the ring/ },
      { name: 'add-note-unlike-add-image', file: 'web/index.html', index: 10,
        from: '<button id="toggle-note" type="button" class="tile">', to: '<button id="toggle-note" type="button">', expected: /Add note has Add image's/ },
      { name: 'done-closes-the-reader', file: 'web/reader.mjs', index: 10,
        from: "if (saved) { this.notice(''); this.switchMode('reply'); }", to: "if (saved) { this.notice(''); this.finishClose(); }", expected: /Done goes back to the reply/ },
      { name: 'no-yellow-for-a-note', file: 'web/aim.css', index: 10,
        from: '#toggle-note[data-has-note]{background:var(--note);', to: '#toggle-note[data-has-note]{', expected: /a soft yellow in light/ },
      { name: 'arrows-for-a-page-oldest-on-top', file: 'web/reader.mjs', index: 11,
        from: 'const NEWEST_ON_TOP = true;', to: 'const NEWEST_ON_TOP = false;', expected: /up is the message above, and comes first/ },
      // The who chip let take the head row whole, so "Saved to Theseus" is squeezed to a word or two.
      { name: 'who-chip-takes-the-status-room', file: 'web/aim.css', index: 12,
        from: '.compose-head>.note-chip{flex:0 1 auto;min-width:min(35%,9rem);max-width:calc(100% - 8rem)}', to: '.compose-head>.note-chip{flex:0 1 auto;min-width:min(35%,9rem);max-width:100%}',
        expected: /: "Saved to Theseus" reads whole/ },
      // The status's room as the last round had it: as tall as its words, so a
      // long file name or the cleanup error grows the footer.
      { name: 'status-as-tall-as-its-words', file: 'web/aim.css', index: 12,
        from: '.save-status>span{display:block;min-width:0;font-size:.78rem;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        to: '.save-status>span{display:block;min-width:0;font-size:.78rem;color:var(--muted)}',
        expected: /\.png before sending\." moves nothing/ },
      { name: 'tap-shows-nothing-more', file: 'web/aim.css', index: 12,
        from: '.save-status>span:focus{white-space:normal;overflow-wrap:anywhere;outline:none}', to: '',
        expected: /a tap shows all its words/ },
      // The status's room following its words, so a longer status takes room
      // from the who chip and moves it.
      { name: 'status-room-follows-its-words', file: 'web/aim.css', index: 12,
        from: '.compose-head>.save-status{flex:1 1 0;', to: '.compose-head>.save-status{flex:1 1 auto;',
        expected: /moves nothing: the writing and the buttons stay still/ },
    ] : [
      { name: 'nonempty-reply-misread-as-empty', file: 'web/reader.mjs', index: 5,
        from: 'writingEmpty: !written(reply)', to: 'writingEmpty: true', expected: /nonempty Shift-Cmd-Return sends exactly once/ },
      { name: 'wide-divider-sign-reversed', file: 'web/reader.mjs', index: 6,
        from: 'drag.x - event.clientX', to: 'event.clientX - drag.x', expected: /wide native drag expands writing/ },
      { name: 'keyboard-large-step-ignored', file: 'web/reader.mjs', index: 6,
        from: 'direction * (event.shiftKey ? .1 : .02)', to: 'direction * .02', expected: /wide Shift arrow changes share ten points/ },
      { name: 'double-click-keeps-custom-share', file: 'web/reader.mjs', index: 6,
        from: "this.layout.resetShare('wide');", to: "this.layout.share('wide');", expected: /wide double-click resets its share/ },
      { name: 'layout-loses-field-selection', file: 'web/reader.mjs', index: 7,
        from: 'this.restoreVisiblePlace(place);\n    this.compose?.fit();', to: 'this.restoreVisiblePlace(place); this.field.setSelectionRange(0, 0);\n    this.compose?.fit();', expected: /field selection is preserved/ },
      { name: 'layout-does-not-restore-reading-anchor', file: 'web/reader.mjs', index: 7,
        from: 'this.restoreVisiblePlace(place);\n    this.compose?.fit();', to: 'void place;\n    this.compose?.fit();', expected: /source anchor(?: offset)? is preserved/ },
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
  // Browser.close only, never a signal; a Chrome still running after it is
  // recorded as left, and the run still ends (devtools_control.mjs).
  // A run whose Chrome did not close is not closed, and leaves the owned profile
  // named in evidence.
  await endRun({ child: chrome, exited: exitPromise, close: cdp && (() => cdp('Browser.close')), socket, server }, async ({ closed, left }) => {
    if (closed) await rm(profile, { recursive: true, force: true });
    await writeFile(path.join(evidencePath, 'results.json'), JSON.stringify({ origin, profile, closed, left, sourceHashes, mutations, pageErrors, results }, null, 2));
    if (!closed || results.some(result => result.expectedFailure ? !result.mutationCaught : !result.passed)) process.exitCode = 1;
    return JSON.stringify({ closed, results }, null, 2);
  });
}
