// One explicitly admitted Chromium cell, 390x844. Native CDP taps/text, actual
// production markup/styles/ComposeBar. No Safari/software-keyboard claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { devtoolsControl, endRun } from './devtools_control.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
// CSS-pixel measurements may round by one pixel. These allowances cannot
// hide the old keyboard-height panel or the modeled 60px second-scroll bounce.
// Configured viewport, writing, focus/caret and accessibility stay exact.
const TILE_GEOMETRY_TOLERANCE_PX = 1;
const RETAP_SCROLL_TOLERANCE_PX = 1;
const [chromePath, evidence] = process.argv.slice(2);
assert.ok(chromePath?.endsWith('/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
assert.ok(evidence && path.isAbsolute(evidence));
await mkdir(evidence, { recursive: true });
const deadline = Date.now() + 60000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(probe, name, bound = 5000) {
  const end = Math.min(deadline, Date.now() + bound);
  while (Date.now() < end) { const value = await probe(); if (value) return value; await sleep(25); }
  throw Error(`1168 timeout: ${name}`);
}
const requests = [], errors = [], checks = [];
const server = createServer(async (request, response) => {
  const route = new URL(request.url, 'http://fixture').pathname;
  requests.push(route);
  try {
    let file;
    if (route === '/') file = 'web/index.html';
    else if (route === '/fixture1168.mjs') file = 'tests/fixtures/phone_sheet_1168_browser.mjs';
    else if (/^\/web\/[a-z0-9-]+\.mjs$/.test(route)) file = route.slice(1);
    else if (/^\/[a-z0-9-]+\.(css|mjs)$/.test(route)) file = 'web' + route;
    else { response.writeHead(404).end(); return; }
    let body = await readFile(path.join(root, file));
    if (route === '/') body = Buffer.from(body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace('</body>', '<script type="module" src="/fixture1168.mjs"></script></body>'));
    response.writeHead(200, { 'Content-Type': file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch (error) { errors.push({ route, error: String(error) }); response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), 'aim-phone-sheet-1168-'));
let child, exited, socket, cdp, failure;
// A bounded caller may stop this Node owner. Close only our Chrome through
// CDP; neither this fixture nor its caller sends a signal to Chrome.
process.once('SIGTERM', () => {
  failure ??= '1168 caller requested bounded cleanup';
  if (cdp) cdp('Browser.close').catch(() => {});
});
try {
  const args = ['--headless=new', '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'];
  await writeFile(path.join(evidence, 'chrome-argv.json'), JSON.stringify([chromePath, ...args]));
  child = spawn(chromePath, args, { stdio: 'ignore' });
  exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.once('error', error => { failure = String(error); });
  const active = await until(async () => { try { return await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); } catch { return null; } }, 'Chrome endpoint');
  const [port, endpoint] = active.trim().split('\n');
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await Promise.race([new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true });
  }), sleep(5000).then(() => { throw Error('1168 socket open timeout'); })]);
  const control = devtoolsControl(socket, { bound: 5000, event: packet => {
    if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails);
  } });
  cdp = control.cdp; exited.then(result => control.end(JSON.stringify(result)));
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => {
    if (Date.now() >= deadline) throw Error('1168 cell work deadline');
    return cdp(method, params, sessionId);
  };
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Inspector.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await send('Page.navigate', { url: origin });
  await until(() => evaluate('document.body?.dataset.fixture1168 === "ready"'), 'fixture ready');
  const settle = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const tap = async selector => {
    const rect = await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}})()`);
    assert.ok(rect.width > 0 && rect.height > 0, `visible native tap ${selector}`);
    const point = { x: rect.x + rect.width / 2, y: rect.y + Math.min(16, rect.height / 2) };
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await settle();
  };
  await until(() => evaluate('document.getAnimations().filter(x=>x.effect?.getTiming().iterations!==Infinity).every(x=>x.playState!=="running")'), 'sheet settled');
  await tap('#inline-plus-button');
  const tiles = await evaluate(`(()=>{const b=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right}};return {hidden:document.querySelector('#inline-plus-panel').hidden,panel:b('#inline-plus-panel'),head:b('#inline-who-chip'),field:b('#inline-writing-body'),send:b('#inline-send'),tile:b('#inline-add-image'),width:innerWidth,scrollWidth:document.documentElement.scrollWidth}})()`);
  await writeFile(path.join(evidence, 'tiles.json'), JSON.stringify(tiles));
  assert.equal(tiles.hidden, false); assert.equal(tiles.width, 390);
  assert.ok(tiles.panel.top >= tiles.head.bottom - TILE_GEOMETRY_TOLERANCE_PX &&
    tiles.panel.bottom <= tiles.field.top + TILE_GEOMETRY_TOLERANCE_PX, '1168 tiles under header and above writing');
  assert.ok(tiles.panel.height < 140 + TILE_GEOMETRY_TOLERANCE_PX &&
    tiles.tile.height >= 44 - TILE_GEOMETRY_TOLERANCE_PX &&
    tiles.scrollWidth <= 390 + TILE_GEOMETRY_TOLERANCE_PX, '1168 compact tiles fit the phone');
  checks.push('1168 B1 native plus shows compact header tiles');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(evidence, 'tiles.png'), Buffer.from(shot.data, 'base64'));
  await tap('#inline-writing-body');
  await evaluate(`window.heightWrites1168=[];window.watch1168=new MutationObserver(rs=>{for(const r of rs)heightWrites1168.push(r.oldValue)});watch1168.observe(fixture1168.field,{attributes:true,attributeFilter:['style'],attributeOldValue:true})`);
  const chunks = ['Writing stays ', 'under the header. ', 'One more line ', 'keeps the caret ', 'and exact text ', 'without collapse.'];
  let text = '';
  for (const chunk of chunks) {
    await send('Input.insertText', { text: chunk }); text += chunk; await settle();
    const state = await evaluate('({value:fixture1168.field.value,start:fixture1168.field.selectionStart,end:fixture1168.field.selectionEnd,active:document.activeElement.id})');
    assert.deepEqual(state, { value: text, start: text.length, end: text.length, active: 'inline-writing-body' });
  }
  const writes = await evaluate('heightWrites1168'); await writeFile(path.join(evidence, 'height-writes.json'), JSON.stringify(writes));
  assert.ok(writes.length > 0 && !writes.some(value => /(?:^|;)\s*height:\s*0px\b/.test(value ?? '')), '1168 native typing never collapses active height');
  checks.push('1168 B2 native typing retains exact value focus caret and height');
  const before = await evaluate('({page:scrollY,composer:fixture1168.root.scrollTop,value:fixture1168.field.value})');
  await tap('#inline-writing-body');
  const after = await evaluate('({page:scrollY,composer:fixture1168.root.scrollTop,value:fixture1168.field.value})');
  assert.equal(after.value, before.value, '1168 native retap keeps exact writing');
  assert.ok(Math.abs(after.page - before.page) <= RETAP_SCROLL_TOLERANCE_PX &&
    Math.abs(after.composer - before.composer) <= RETAP_SCROLL_TOLERANCE_PX,
    '1168 native retap keeps page and composer positions within one CSS pixel');
  checks.push('1168 B3 native retap preserves page position and writing');
  const twin = await evaluate(`(()=>{const f=fixture1168.field,t=fixture1168.bar.twin;return {count:f.parentNode.querySelectorAll('textarea').length,hidden:t?.getAttribute('aria-hidden'),tab:t?.tabIndex,readOnly:t?.readOnly,id:t?.id,visibility:t&&getComputedStyle(t).visibility,active:document.activeElement===f}})()`);
  assert.deepEqual(twin, { count: 2, hidden: 'true', tab: -1, readOnly: true, id: '', visibility: 'hidden', active: true });
  await evaluate('watch1168.disconnect();fixture1168.bar.dispose();fixture1168.dialog.close()');
  assert.equal(await evaluate('fixture1168.field.parentNode.querySelectorAll("textarea").length'), 1);
  checks.push('1168 B4 native twin stays inaccessible and disposal removes it');
  assert.deepEqual(errors, []);
} catch (error) { failure = error.stack; }
await endRun({ child, exited, close: cdp && (() => cdp('Browser.close')), socket, server, grace: 5000 }, async cleanup => {
  if (!cleanup.closed || cleanup.left) failure ??= '1168 owned Chrome did not close cleanly';
  if (cleanup.closed && !cleanup.left) await rm(profile, { recursive: true, force: true });
  const result = { viewport: [390,844], checks, failure: failure ?? null, cleanup, profile, chromePid: child?.pid, requests, errors,
    limitation: 'Chromium viewport only; no physical iPhone, Safari or software-keyboard proof.' };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  process.exitCode = failure ? 1 : 0; return JSON.stringify(result);
});
