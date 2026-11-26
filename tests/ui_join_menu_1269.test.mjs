import test from 'node:test';
import assert from 'node:assert/strict';
import { cardIn } from '../web/fold.mjs';
import { joinFixture } from './fixtures/join1269.mjs';

const key = (menu, value) => menu.root.listeners.keydown({ key: value, preventDefault() {}, stopPropagation() {} });
for (const phone of [false, true]) for (const dismissal of ['Cancel', 'Escape', 'Tab', 'outside pointer', 'anchor scroll']) test(`1269 ${dismissal} phone=${phone} keeps dossier facts and blocks a stale activation`, async t => {
  const f = joinFixture({ phone }); t.after(f.close);
  const facts = JSON.stringify([...f.messages]), order = f.feed.state.stacks.map(s => s.id);
  const m = f.key(), confirm = m.root.querySelectorAll('button')[1], activate = confirm.onclick;
  assert.equal(f.calls.length, 0); assert.equal(f.doc.activeElement.text, 'Cancel');
  if (dismissal === 'Cancel') f.click(m.root.querySelectorAll('button')[0]);
  if (dismissal === 'Escape' || dismissal === 'Tab') key(m, dismissal);
  if (dismissal === 'outside pointer') f.listeners.find(x => x.type === 'pointerdown').fn({ target: f.doc.body });
  if (dismissal === 'anchor scroll') {
    m.anchor.getBoundingClientRect = () => ({ top: 120, left: 50, right: 100, bottom: 160 });
    f.listeners.find(x => x.type === 'scroll').fn({ target: f.list });
  }
  assert.equal(m.root.isConnected, false); activate({ stopPropagation() {} }); await f.feed.chain;
  assert.equal(f.calls.length, 0); assert.equal(JSON.stringify([...f.messages]), facts);
  assert.deepEqual(f.feed.state.stacks.map(s => s.id), order); assert.equal(f.listeners.length, 0);
  if (!['outside pointer'].includes(dismissal)) assert.equal(f.doc.activeElement, cardIn(f.entry()));
});
for (const phone of [false, true]) test('1269 arrows focus the explicit choice without committing; pointer/touch click confirms once phone=' + phone, async t => {
  const f = joinFixture({ phone }); t.after(f.close); const m = f.key();
  assert.equal(m.root.classList.contains('menu-sheet'), phone);
  key(m, 'ArrowDown'); assert.match(f.doc.activeElement.text, /^Join “source dossier” into “above dossier”/);
  assert.equal(f.calls.length, 0); key(m, 'Home'); assert.equal(f.doc.activeElement.text, 'Cancel');
  key(m, 'End'); const chosen = f.doc.activeElement; f.click(chosen); f.click(chosen); await f.feed.chain;
  assert.equal(f.calls.length, 1); assert.equal(m.root.isConnected, false); assert.equal(f.listeners.length, 0);
});
test('1269 repeated shortcut replaces or dismisses the choice without making a join', async t => {
  const f = joinFixture(); t.after(f.close); f.key(); f.key(); await f.feed.chain;
  assert.equal(f.calls.length, 0); assert.equal(f.menu(), null); assert.equal(f.listeners.length, 0);
});
test('1269 keyboard while the menu owns focus cannot send a hidden join', async t => {
  const f = joinFixture(); t.after(f.close); f.key();
  const at = f.doc.activeElement;
  f.feed.key({ key: 'ArrowUp', metaKey: true, shiftKey: true, target: at, preventDefault() { throw Error('Menu owns its keys'); } });
  await f.feed.chain; assert.equal(f.calls.length, 0);
});
