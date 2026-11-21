import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PENCIL_STATES, PENCIL_LATE_IMAGES } from './pencil-states.mjs';
import { assertPencilPlace } from './pencil-layout.mjs';
const native = readFileSync(new URL('./reader_compose_native.mjs', import.meta.url), 'utf8');
const body = native.slice(native.indexOf('async function runPencil()'), native.indexOf('// Break one production rule'));
const names = [];
await vm.runInNewContext(body + '\nrunPencil()', {
  PENCIL_SHAPES: ['phone-320','phone-375','phone-390','laptop-stacked'],
  PENCIL_STATES, PENCIL_LATE_IMAGES, check: async name => names.push(name),
});
test('item 673 B1: measured feed positions use named tolerance with exact card identities', () => {
  assert.ok(!body.includes('assert.deepEqual(await p.evaluate(() => ({ scroll:scrollY'), 'measured positions cannot use exact equality');
  assert.ok(body.includes('assertPencilPlace('), 'the real floating case uses the tolerant measured comparison');
});
test('item 673 B3: every ledger selector binds to actual cases including both send gestures', () => {
  const acts = JSON.parse(readFileSync(new URL('./acts.json', import.meta.url))).acts.filter(a => [673,670,671,672].includes(a.item));
  for (const act of acts) {
    const parts = act.check.case.split('|');
    for (const part of parts) assert.ok(names.some(n => n.includes(part)), `no native case for ${part}`);
  }
  const send = acts.find(a => a.item === 673 && a.check.case.includes('sends once'));
  for (const way of ['Send','Cmd-Return']) assert.ok(send.check.case.includes(`: ${way} sends once`), `${way} is promised by the ledger`);
});
test('item 673 B4: real native registration contains separate publication/access/save states', () => {
  for (const state of ['publication pending','publication rejected','publication unknown','loaded access visible','loaded access checking','loaded access recovered','local saving','server saving','device-only','journal attention'])
    for (const shape of ['phone-320','phone-375','phone-390','laptop-stacked'])
      for (const scheme of ['light','dark']) for (const surface of ['topic','conversation'])
        assert.ok(names.includes(`item 673 ${surface} ${shape} ${scheme}: ${state}`), `missing ${state} at ${surface}/${shape}/${scheme}`);
});

test('item 673 B1: engine fractional differences pass but actual displacement and changed card identity fail', () => {
  const positionTolerancePx = 2;
  const before={scroll:100,cards:[['a',10],['b',90.25]]};
  assertPencilPlace(before,{scroll:101.5,cards:[['a',11.5],['b',89.25]]},positionTolerancePx);
  assert.throws(()=>assertPencilPlace(before,{scroll:100,cards:[['a',22],['b',102.25]]},positionTolerancePx),/moves no feed card/);
  assert.throws(()=>assertPencilPlace(before,{scroll:100,cards:[['other',10],['b',90.25]]},positionTolerancePx),/exact card identities/);
  assert.throws(()=>assertPencilPlace(before,{scroll:112,cards:before.cards},positionTolerancePx),/page scroll/);
});
test('item 673 B4: every explicit branch and successor image gesture is registered across the entire matrix', () => {
  for(const shape of ['phone-320','phone-375','phone-390','laptop-stacked'])for(const theme of ['light','dark'])for(const surface of ['topic','conversation']) {
    const prefix=`item 673 ${surface} ${shape} ${theme}: `;
    for(const state of PENCIL_STATES)assert.ok(names.includes(prefix+state));
    for(const mode of PENCIL_LATE_IMAGES)for(const way of ['Send','Cmd-Return'])assert.ok(names.includes(prefix+`${way} late confirmation keeps newer ${mode} image writing`));
  }
});

test('item 673 B1: row measurement checks adjacent rows with the named position tolerance', async () => {
  const geometry = native.slice(native.indexOf('const sized ='), native.indexOf('async function runSizes()'));
  const box = (top, bottom, left = 0) => ({ top, bottom, left, right: 100, width: 100 - left, height: bottom - top });
  const element = (name, bounds) => ({
    id: name, tagName: 'DIV', className: name, scrollHeight: 20, clientHeight: 20,
    scrollTop: 0, hidden: false, getClientRects: () => [bounds], getBoundingClientRect: () => bounds,
    matches: selector => selector === '.notice, #inline-retry, .compose-head, .compose-panel, .image-strip, .plus-button, .field-box, .compose-send, #thumb-source',
  });
  const notice = element('notice', box(50, 80)), retry = element('inline-retry', box(70, 100));
  const field = element('field', box(120, 140, -1.75)), head = element('head', box(0, 20));
  const absent = { hidden: true, getClientRects: () => [] };
  const composer = Object.assign(element('composer', box(20, 200)), {
    children: [notice, retry], dataset: { compose: 'writing' }, contains: () => false,
    querySelector: selector => selector === 'textarea' ? field : selector === '.compose-send' || selector === '.taller-field' ? absent : null,
    querySelectorAll: selector => selector.startsWith('button,') ? [field] : [],
  });
  const dialog = Object.assign(element('dialog', box(0, 300)), { open: true, querySelector: () => head });
  field.parentElement = composer; notice.parentElement = composer; retry.parentElement = composer;
  const measure = vm.runInNewContext(geometry + '\nsized', {
    document: { querySelector: selector => selector === '#new-message-sheet' ? dialog : composer,
      documentElement: { scrollWidth: 320 }, activeElement: null },
    getComputedStyle: () => ({ visibility: 'visible', overflowY: 'visible', position: 'static', minHeight: '20' }),
    innerWidth: 320, innerHeight: 400, visualViewport: { offsetTop: 0, height: 400, width: 320 },
  });
  const tolerance = { positionPx: 2, overflowPx: 4 };
  const p = { evaluate: (fn, args) => fn(args) };
  let measured = await measure(p, 'sheet', tolerance);
  assert.deepEqual(Array.from(measured.over), ['notice / inline-retry'], 'a 10px adjacent-row overlap must fail the real measurement');
  assert.deepEqual(Array.from(measured.past), [], 'the left edge uses the same named 2px position tolerance');
  retry.getBoundingClientRect = () => box(78.5, 100);
  measured = await measure(p, 'sheet', tolerance);
  assert.deepEqual(Array.from(measured.over), [], 'a 1.5px fractional overlap is within the named 2px tolerance');
  retry.getBoundingClientRect = () => box(77, 100);
  measured = await measure(p, 'sheet', tolerance);
  assert.deepEqual(Array.from(measured.over), ['notice / inline-retry'], 'a 3px overlap remains outside the named 2px tolerance');
});

test('item 673 image writing: Remove occupies its own inline row slot instead of the thumbnail opener target', () => {
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  // A 44px corner target at right:-16/top:-16 covers the center of a
  // 44px thumbnail. The sheet must place Remove in flow on every pointer.
  assert.ok(css.includes('#inline-composer .image-choice>button[data-method=remove]{position:static;'), 'inline Remove must have its own flow slot');
  assert.ok(css.includes('@media(max-width:760px){#inline-composer :is('), 'phone width retains the 44px floor after a chooser changes pointer mode');
});


test('item 673 setup reuses the recorded coordinator result and seeds its context once', async () => {
  const setup=native.slice(native.indexOf('let pencilContextPromise'),native.indexOf('// Cleanup must never'));
  const calls=[];
  const context=vm.createContext({assert,control:async request=>{calls.push(request);return {}}});
  await vm.runInContext(setup+"\npencilConversation={topic_id:'conversation-topic'};pencilContext()",context);
  await vm.runInContext('pencilContext()',context);
  assert.equal(calls.length,1,'the cached context never repeats a coordinator operation with a different revision');
  assert.equal(calls[0].method,'agent_message');assert.equal(calls[0].topic_id,'conversation-topic');
});

test('item 673 cleanup preserves the primary failure separately from cleanup failure', async () => {
  const helper=native.slice(native.indexOf('async function pencilCleanup('),native.indexOf('// Reach the opener'));
  const records=[];
  const cleanup=vm.runInNewContext(helper+'\npencilCleanup',{pencilCleanupEvidence:records,engine:'fixture'});
  await assert.rejects(()=>cleanup('image',async()=>{throw Error('primary image fault')},async()=>{throw Error('cleanup upload fault')}),error=>{
    assert.match(error.primaryError,/primary image fault/);assert.match(error.cleanupErrors[0],/cleanup upload fault/);return true;
  });
  assert.equal(records.length,1);assert.match(records[0].primary,/primary image fault/);assert.equal(records[0].cleanup.length,1);
});
