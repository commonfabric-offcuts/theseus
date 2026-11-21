// Deterministic targeting/order checks only. The native caret control remains
// in reader_native.mjs and must still run on the corrected source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { quoteSelectionBlock } from './reader_quote_mutation.mjs';

const source = readFileSync(new URL('../web/reader.mjs', import.meta.url), 'utf8');
const methodOf = text => text.match(/^  quoteInto\([^\n]*\) \{\n[\s\S]*?^  \}\n/m)[0];
const hash = text => createHash('sha256').update(text).digest('hex');
function quote(text) {
  const selection = { type: 'Range', removeAllRanges() { this.type = 'None'; } };
  const calls = [], editor = { draft: { body: '', quotes: [] }, edit(patch) { Object.assign(this.draft, patch); } };
  const field = { value: '', scrollHeight: 100, focus(options) { calls.push(['focus', options]); selection.type = 'Caret'; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } };
  const reader = { mode: 'reply', sessions: { reply: editor }, writes: () => true, narrow: { matches: false },
    layout: { mode: 'stacked', setMode(mode) { this.mode = mode; } }, applyLayout() {}, source: {}, field,
    insertText(text) { field.value += text; }, compose: { fit() {} }, disarm() {}, keepAbove() {} };
  const method = vm.runInNewContext('({' + methodOf(text) + '}).quoteInto', {
    window: { getSelection: () => selection }, recoveryReadOnly: () => false, quoteSource: () => ({ kind: 'message', id: 'fixture' }),
  });
  method.call(reader, 'Exact words', null);
  assert.equal(field.value, '> Exact words\n\n');
  assert.deepEqual([field.selectionStart, field.selectionEnd], [field.value.length, field.value.length]);
  assert.equal(calls.length, 1); assert.equal(calls[0][1].preventScroll, true);
  assert.equal(reader.layout.mode, 'stacked');
  assert.equal(reader.temporaryWide, true);
  assert.equal(selection.type, 'Caret', "the document's selection is the field's caret");
}

test('the actual quote mutant applies once, breaks selection order, and restores its control', () => {
  const block = quoteSelectionBlock(source);
  assert.equal(source.split(block).length - 1, 1, 'actual approved source target occurs once');
  const clear = '    window.getSelection()?.removeAllRanges();\n';
  const replacement = block.replace(clear, '') + clear;
  const mutant = source.replace(block, replacement);
  assert.notEqual(mutant, source); assert.equal(mutant.split(replacement).length - 1, 1);
  quote(source);
  assert.throws(() => quote(mutant), /the document's selection is the field's caret/);
  const restored = mutant.replace(replacement, block);
  assert.equal(restored, source); quote(restored);
  console.log(JSON.stringify({ controlHash: hash(source), mutantHash: hash(mutant), restoredHash: hash(restored), applied: 1, caught: true, native: false }));
});

test('quote targeting stays in its method and rejects absent or ambiguous targets', () => {
  const block = quoteSelectionBlock(source);
  assert.equal(quoteSelectionBlock(source + '\n  unrelated() {\n    this.field.focus();\n  }\n'), block);
  assert.throws(() => quoteSelectionBlock(source.replace(methodOf(source), '')), /one quoteInto method/);
  assert.throws(() => quoteSelectionBlock(source + methodOf(source)), /one quoteInto method/);
  assert.throws(() => quoteSelectionBlock(source.replace('    this.field.scrollTop = this.field.scrollHeight;', '    void this.field;')), /one nonempty quote/);
});
