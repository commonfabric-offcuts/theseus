import test from 'node:test';
import assert from 'node:assert/strict';
import { pencilKey } from '../web/pencil-keys.mjs';

function fixture() {
  const calls = [], outside = { closest: () => null };
  const field = { closest: () => field, selectionStart: 2, selectionEnd: 5, selectionDirection: 'backward',
    focus() { doc.activeElement = field; }, setSelectionRange(start, end, direction) { Object.assign(field, { selectionStart: start, selectionEnd: end, selectionDirection: direction }); } };
  const pills = { message: { closest: () => null }, 'note-card': { closest: () => null } };
  const doc = { activeElement: field, querySelector: () => null };
  const composer = { root: { ownerDocument: doc, hidden: false, isConnected: true, contains: node => node === field || Object.values(pills).includes(node) },
    sheet: { open: false, classList: { contains: () => false } }, field, callbacks: { notebook: { mayWrite: true } },
    kinds: ['message', 'note-card'], $: name => pills[name.replace('kind-', '')],
    admits: () => true, pageBusy: () => false, kind: 'message', noteTarget: 'kept-page',
    pop() { calls.push('pop'); composer.sheet.open = true; composer.noteTarget = ''; field.setSelectionRange(99, 99, 'none'); },
    chooseKind(kind) { calls.push(kind); composer.kind = kind; return true; }, send() { calls.push('send'); } };
  function press(extra = {}) {
    const event = { key: 'Enter', code: 'Enter', target: doc.activeElement, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    return { used: pencilKey(event, composer), event };
  }
  return { calls, composer, field, pills, doc, outside, press };
}

test('1023 physical Option-M opens the Message sheet and keeps selection/destination', () => {
  const f = fixture();
  const { used, event } = f.press({ key: 'µ', code: 'KeyM', altKey: true });
  assert.equal(used, true); assert.equal(event.defaultPrevented, true);
  assert.equal(f.composer.sheet.open, true); assert.deepEqual(f.calls, ['pop', 'message']);
  assert.equal(f.composer.noteTarget, 'kept-page');
  assert.deepEqual([f.field.selectionStart, f.field.selectionEnd, f.field.selectionDirection], [2, 5, 'backward']);
});

for (const [name, change] of Object.entries({
  busy: f => { f.composer.pageBusy = () => true; },
  unavailable: f => { f.composer.admits = () => false; },
  anotherDialog: f => { f.doc.querySelector = () => ({}); },
  notePermission: f => { f.composer.callbacks.notebook.mayWrite = false; },
})) test(`1023 a held ${name} Note shortcut cannot fall through into owned writing`, () => {
  const f = fixture(); change(f);
  const { used, event } = f.press({ key: 'Dead', code: 'KeyN', altKey: true });
  assert.equal(used, true); assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
  assert.deepEqual(f.calls, [], 'the mode/admission guard still holds');
});

for (const kind of ['message', 'note-card']) test(`1023 Command-Return on the ${kind} pill routes once to Send`, () => {
  const f = fixture(); f.doc.activeElement = f.pills[kind];
  assert.equal(f.press({ metaKey: true }).used, true); assert.deepEqual(f.calls, ['send']);
  assert.equal(f.press({ metaKey: true, repeat: true }).used, true); assert.deepEqual(f.calls, ['send']);
});

test('1023 text newline and field Command-Return retain their existing owners', () => {
  const f = fixture();
  assert.equal(f.press().used, false); assert.equal(f.press({ metaKey: true }).used, false);
  assert.deepEqual(f.calls, []);
});

test('1023 an unrelated dialog keeps its Alt key when the pencil does not own the field', () => {
  const f = fixture(); f.doc.activeElement = f.outside; f.doc.querySelector = () => ({});
  const { used, event } = f.press({ key: 'µ', code: 'KeyM', altKey: true });
  assert.equal(used, false); assert.equal(event.defaultPrevented, undefined); assert.deepEqual(f.calls, []);
});

for (const extra of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) test(`1023 composition/already-owned events remain untouched ${JSON.stringify(extra)}`, () => {
  const f = fixture(); const { used } = f.press({ key: 'Dead', code: 'KeyN', altKey: true, ...extra });
  assert.equal(used, false); assert.deepEqual(f.calls, []);
});
