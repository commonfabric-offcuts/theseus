import test from 'node:test';
import assert from 'node:assert/strict';
import { pencilKey } from '../web/pencil-keys.mjs';

function fixture({ modal = false, text = false } = {}) {
  const outside = { closest: () => null }, field = { selectionStart: 2, selectionEnd: 6, selectionDirection: 'forward',
    closest: selector => selector.includes('textarea') ? field : null,
    focus() { doc.activeElement = field; }, setSelectionRange(start, end, direction) { Object.assign(field, { selectionStart: start, selectionEnd: end, selectionDirection: direction }); } };
  const button = { closest: () => null }, doc = { activeElement: text ? field : button, querySelector: () => null };
  const calls = [], composer = { root: { ownerDocument: doc, hidden: false, isConnected: true, contains: at => at === field || at === button },
    sheet: { open: modal, classList: { contains: () => false } }, field, callbacks: { notebook: { mayWrite: true } },
    kind: 'message', admits: () => true, pageBusy: () => false,
    pop() { calls.push('pop'); composer.sheet.open = true; composer.noteTarget = ''; field.setSelectionRange(20, 20, 'none'); },
    chooseKind(kind) { calls.push(kind); composer.kind = kind; return true; }, send() { calls.push('send'); } };
  const press = extra => {
    const event = { key: 'Enter', code: 'Enter', target: doc.activeElement, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    return { used: pencilKey(event, composer), event };
  };
  return { composer, calls, field, doc, outside, press };
}
for (const [key, code, kind] of [['Dead', 'KeyN', 'note-card'], ['µ', 'KeyM', 'message']]) test(`1018 physical ${code} handles the Mac ${key} spelling while typing`, () => {
  const f = fixture({ text: true }); const result = f.press({ key, code, altKey: true });
  assert.equal(result.used, true); assert.equal(result.event.defaultPrevented, true); assert.equal(f.composer.kind, kind);
  assert.deepEqual([f.field.selectionStart, f.field.selectionEnd, f.field.selectionDirection], [2, 6, 'forward']);
  assert.equal(f.calls.includes('pop'), true, '1023 opens the sheet for either mode');
});
test('1018 plain Return on Note uses Send once; held Return does not send twice', () => {
  const f = fixture(); assert.equal(f.press({}).used, true); assert.deepEqual(f.calls, ['send']);
  assert.equal(f.press({ repeat: true }).used, true); assert.deepEqual(f.calls, ['send']);
});
test('1018 a held Option key is consumed without resetting the opening or selection', () => {
  const f = fixture({ text: true }); const result = f.press({ key: 'Dead', code: 'KeyN', altKey: true, repeat: true });
  assert.equal(result.used, true); assert.deepEqual(f.calls, []);
});
test('1018 opening an inline Note keeps the selected Notebook destination', () => {
  const f = fixture({ text: true }); f.composer.kind = 'note-card'; f.composer.noteTarget = 'chosen-page';
  assert.equal(f.press({ key: 'Dead', code: 'KeyN', altKey: true }).used, true); assert.equal(f.composer.noteTarget, 'chosen-page');
});
for (const extra of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) test('1018 composition and other key chords retain their owner ' + JSON.stringify(extra), () => {
  const f = fixture({ text: true }); assert.equal(f.press({ key: 'Dead', code: extra.isComposing || extra.keyCode === 229 ? 'KeyA' : 'KeyN', altKey: true, ...extra }).used, false); assert.deepEqual(f.calls, []);
});
for (const modal of [false, true]) test(`1018 text Return stays a newline, Command-Return stays with the field, modal=${modal}`, () => {
  const f = fixture({ modal, text: true }); assert.equal(f.press({}).used, false); assert.equal(f.press({ metaKey: true }).used, false); assert.deepEqual(f.calls, []);
});
test('1018 Return outside the inline composer does not send its retained writing', () => {
  const f = fixture(); f.doc.activeElement = f.outside; assert.equal(f.press({}).used, false); assert.deepEqual(f.calls, []);
  f.composer.sheet.open = true; assert.equal(f.press({}).used, true); assert.deepEqual(f.calls, ['send']);
});
for (const [name, change] of Object.entries({
  detached: f => { f.composer.root.isConnected = false; }, hidden: f => { f.composer.root.hidden = true; },
  disposed: f => { f.composer.disposed = true; }, otherComposer: f => { f.composer.cardReply = true; },
  unavailable: f => { f.composer.admits = () => false; }, notebook: f => { f.composer.sheet.classList.contains = () => true; },
  nestedNaming: f => { f.doc.querySelector = () => ({}); },
})) test(`1018 ${name} keeps its keys`, () => {
  const f = fixture({ modal: true }); change(f); assert.equal(f.press({}).used, false); assert.equal(f.press({ key: 'Dead', code: 'KeyN', altKey: true }).used, false); assert.deepEqual(f.calls, []);
});
for (const [name, change] of Object.entries({ busy: f => { f.composer.pageBusy = () => true; }, noNotePermission: f => { f.composer.callbacks.notebook.mayWrite = false; } })) test(`1018 ${name} cannot open a Note`, () => {
  const f = fixture(); change(f); assert.equal(f.press({ key: 'Dead', code: 'KeyN', altKey: true }).used, false); assert.deepEqual(f.calls, []);
});
