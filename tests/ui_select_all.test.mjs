// Select All (⌘A on a Mac, Ctrl-A elsewhere) takes the message and nothing
// else. In a writing field the browser already selects only the field's own
// text, so nothing here may take the key from it. Anywhere else in the Reader,
// such as the message after a click on it, the browser would select the whole
// dialog, its buttons and labels with the message; there the Reader selects
// the message's text alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';
import { WritingInput } from '../web/writing-input.mjs';

const element = (tag, inside = null) => ({ tag, inside, closest(selector) {
  for (let at = this; at; at = at.inside) if (selector.split(',').some(name => name.trim() === at.tag)) return at;
  return null;
} });

function readerFixture({ mac }) {
  const dialog = element('dialog'), pane = element('section', dialog);
  const sourceBody = element('article', pane), field = element('textarea', dialog), recipient = element('input', dialog);
  const close = element('button', dialog), stepping = element('button', pane);
  const selection = { ranges: [], removeAllRanges() { this.ranges = []; }, addRange(range) { this.ranges.push(range); } };
  globalThis.window = { getSelection: () => selection };
  globalThis.document = { createRange: () => ({ selectNodeContents(node) { this.node = node; } }) };
  const reader = Object.assign(Object.create(Reader.prototype), {
    mac, dialog, field, sourceBody, source: { source_ref: { kind: 'message', id: 'm1' }, body: 'The message' }, mode: 'reply',
    sessions: { reply: { draft: { body: 'My reply', attachments: [] } } },
    input: { readOnly: () => false, terminalKey: () => false, writingKey: () => false },
    selectedPassage: () => null,
  });
  const press = (target, chord) => {
    const event = { key: 'a', code: 'KeyA', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...chord, target,
      prevented: false, preventDefault() { this.prevented = true; } };
    selection.ranges = [];
    reader.key(event);
    return { prevented: event.prevented, selected: selection.ranges.map(range => range.node) };
  };
  return { reader, press, sourceBody, field, recipient, close, stepping };
}

for (const [platform, mac, chord, other] of [['on a Mac', true, { metaKey: true }, { ctrlKey: true }], ['off a Mac', false, { ctrlKey: true }, { metaKey: true }]]) {
  test(`Select All in the Reader takes the message alone, ${platform}`, () => {
    const f = readerFixture({ mac });
    for (const [where, target] of [['the message', f.sourceBody], ['a control by the message', f.stepping], ['the close button', f.close]])
      assert.deepEqual(f.press(target, chord), { prevented: true, selected: [f.sourceBody] }, `${where}: only the message is selected`);
    for (const [where, target] of [['the writing field', f.field], ['the recipient field', f.recipient]])
      assert.deepEqual(f.press(target, chord), { prevented: false, selected: [] }, `${where}: the browser selects the field's own text`);
    assert.deepEqual(f.press(f.sourceBody, other), { prevented: false, selected: [] }, 'the other modifier is not Select All here');
    for (const extra of [{ shiftKey: true }, { altKey: true }, { key: 'b', code: 'KeyB' }, { key: 'q', code: 'KeyA' }])
      assert.deepEqual(f.press(f.sourceBody, { ...chord, ...extra }), { prevented: false, selected: [] }, JSON.stringify(extra));
    // The key named A wherever the layout puts it (AZERTY), and on a layout
    // with no Latin letters, the key where A sits (a Russian layout names it ф).
    for (const layout of [{ key: 'a', code: 'KeyQ' }, { key: 'A', code: 'KeyA' }, { key: 'ф', code: 'KeyA' }, { key: 'ش', code: 'KeyA' }])
      assert.deepEqual(f.press(f.sourceBody, { ...chord, ...layout }), { prevented: true, selected: [f.sourceBody] }, JSON.stringify(layout));
  });
}

function writingFixture(mac) {
  const field = { value: 'zero\none two', selectionStart: 9, selectionEnd: 9, readOnly: false, addEventListener() {},
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  const input = new WritingInput({ field, mac, editor: () => ({ draft: { body: field.value } }), admits: () => true });
  return (extra = {}) => {
    const event = { key: 'a', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
    return { taken: input.terminalKey(event), prevented: event.prevented, caret: [field.selectionStart, field.selectionEnd] };
  };
}

test('Ctrl-A in a writing field selects all of it off a Mac, and goes to the line start on a Mac', () => {
  assert.deepEqual(writingFixture(false)(), { taken: false, prevented: false, caret: [9, 9] }, 'off a Mac the browser selects the whole field');
  assert.deepEqual(writingFixture(true)(), { taken: true, prevented: true, caret: [5, 5] }, 'on a Mac Ctrl-A goes to the start of the line');
  assert.deepEqual(writingFixture(false)({ key: 'e' }), { taken: true, prevented: true, caret: [12, 12] }, 'the other line keys are unchanged');
});
