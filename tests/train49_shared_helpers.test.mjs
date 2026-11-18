import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = () => readFileSync(new URL('./reader_compose_native.mjs', import.meta.url), 'utf8');
function opening(delayed = false) {
  const s = source(), begin = s.indexOf('async function open('), end = s.indexOf('// The keyboard comes up', begin);
  assert.ok(begin > 0 && end > begin);
  const reader = { open: false }, card = { classList: { contains: () => lit } }, body = { textContent: 'Second agent' };
  let lit = false, taps = 0, pendingOpen = false;
  const document = { querySelector: s => s === '#reader' ? reader : s === '#source-body' ? body : card, getAnimations: () => [] };
  const evaluate = (fn, arg) => vm.runInNewContext(`(${fn})(arg)`, { document, arg });
  const until = async (p, fn, label, arg) => {
    if (await evaluate(fn, arg)) return;
    if (pendingOpen) { reader.open = true; pendingOpen = false; }
    assert.ok(await evaluate(fn, arg), label);
  };
  const open = new Function('first', 'until', 'picture', `${s.slice(begin, end)}; return open;`)('first', until, async () => {});
  const p = { touch: true, evaluate, locator: () => ({ scrollIntoViewIfNeeded: async () => {}, boundingBox: async () => ({ x: 0, y: 0, width: 300, height: 100 }) }),
    touchscreen: { tap: async () => { assert.equal(reader.open, false, 'no tap through an already-open dialog'); taps++; if (lit) { if (delayed) pendingOpen = true; else reader.open = true; } else lit = true; } } };
  return { open, p, setLit: value => { lit = value; }, taps: () => taps };
}
for (const lit of [false, true]) test(`phone open observes first native tap, initially lit=${lit}`, async () => {
  const h = opening(); h.setLit(lit);
  const saved = 'Kept through Escape.'; h.p.writing = saved;
  await h.open(h.p, 'second');
  assert.equal(h.taps(), lit ? 1 : 2);
  assert.equal(h.p.writing, saved);
  assert.ok(source().includes("'the writing is there on reopening'"), 'original saved-writing assertion retained');
});
function traversal(ids, engine = 'chromium') {
  let index = 0; const keys = [], measured = [];
  const parent = { id: 'controls', tagName: 'DIV', parentElement: null, children: [] };
  const nodes = ids.map(id => ({ id, tagName: 'BUTTON', parentElement: parent })); parent.children = nodes;
  const node = n => nodes[n];
  const p = { shape: 'stacked', scheme: 'light', keyboard: { press: async key => { keys.push(key); index = (index + (key.includes('Shift+') ? ids.length - 1 : 1)) % ids.length; } },
    evaluate: async fn => vm.runInNewContext(`(${fn})()`, { document: { activeElement: node(index) } }) };
  const s = source(); let run;
  if (s.includes('async function tabToNative(')) {
    const begin = s.indexOf('async function tabToNative('), end = s.indexOf('// The keyboard comes up', begin);
    run = new Function('assert', 'engine', 'measured', `${s.slice(begin, end)};return tabToNative;`)(assert, engine, measured);
  } else {
    const row = s.split('\n').find(x => x.includes('const tabTo = async'));
    const tabRow = s.split('\n').find(x => x.includes('const tab = back'));
    run = new Function('assert', 'focused', 'p', 'engine', `${tabRow};${row};return (_p,id,back)=>tabTo(id,back);`)(assert, async () => ids[index], p, engine);
  }
  return { run: (id, back = false) => run(p, id, back), p, keys, measured };
}
test('Tab reaches plus after more than twelve native transitions and retains actual order', async () => {
  const ids = Array.from({ length: 19 }, (_, n) => `control-${n}`).concat('plus-button');
  const h = traversal(ids); await h.run('plus-button');
  assert.equal(h.keys.length, 19); assert.ok(h.keys.every(k => k === 'Tab'));
  assert.deepEqual(h.measured[0].states.map(s => s.id), ids);
  assert.equal(h.measured[0].reason, 'target');
});
test('unreachable plus refuses on actual repeated state, including unnamed controls', async () => {
  const h = traversal(['who-chip', '', 'send-reply']);
  await assert.rejects(h.run('plus-button'), /Tab reaches #plus-button/);
  assert.equal(h.keys.length, 3); assert.equal(h.measured[0].reason, 'repeat');
  assert.deepEqual(h.measured[0].states.map(s => s.id), ['who-chip', '', 'send-reply', 'who-chip']);
});
test('WebKit traversal retains native Alt-Tab', async () => {
  const h = traversal(['who-chip', 'plus-button'], 'webkit'); await h.run('plus-button');
  assert.deepEqual(h.keys, ['Alt+Tab']);
});

test('different unnamed controls have different recorded focus identities', async () => {
  const h = traversal(['who-chip', '', '', 'plus-button']); await h.run('plus-button');
  assert.equal(h.keys.length, 3); assert.notEqual(h.measured[0].states[1].path, h.measured[0].states[2].path);
});
test('nonrepeating instability refuses at finite safety bound with its whole trace', async () => {
  const h = traversal(Array.from({ length: 514 }, (_, n) => `control-${n}`));
  await assert.rejects(h.run('plus-button'), /Tab reaches #plus-button; safety-bound/);
  assert.equal(h.keys.length, 512); assert.equal(h.measured[0].states.length, 513);
});
test('Shift-Tab keeps direction and stops on the actual target', async () => {
  const h = traversal(['who-chip', 'send-reply', 'plus-button'], 'webkit'); await h.run('plus-button', true);
  assert.deepEqual(h.keys, ['Alt+Shift+Tab']); assert.equal(h.measured[0].back, true);
});

test('already-lit phone waits for the first tap opening instead of reusing its old light', async () => {
  const h = opening(true); h.setLit(true); await h.open(h.p, 'second'); assert.equal(h.taps(), 1);
});
