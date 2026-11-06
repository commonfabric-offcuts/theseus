// Select All (⌘A on a Mac, Ctrl-A elsewhere) takes the message and nothing
// else. In a writing field the browser already selects only the field's own
// text, so nothing here may take the key from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WritingInput } from '../web/writing-input.mjs';

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
