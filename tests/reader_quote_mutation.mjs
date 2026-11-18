import assert from 'node:assert/strict';

// Stay inside quoteInto: another focus or selection clear elsewhere in the
// Reader must never become this mutant's target. Focus options may evolve.
export function quoteSelectionBlock(source) {
  const methods = [...source.matchAll(/^  quoteInto\([^\n]*\) \{\n[\s\S]*?^  \}\n/gm)];
  assert.equal(methods.length, 1, 'one quoteInto method for the quote-selection mutant');
  const method = methods[0][0];
  const blocks = [...method.matchAll(/^    window\.getSelection\(\)\?\.removeAllRanges\(\);\n[\s\S]*?^    this\.field\.scrollTop = this\.field\.scrollHeight;\n/gm)];
  assert.equal(blocks.length, 1, 'one nonempty quote selection-to-scroll block');
  const block = blocks[0][0];
  assert.equal((block.match(/^    this\.field\.focus\([^;\n]*\);$/gm) ?? []).length, 1, 'the quote block focuses its field once');
  assert.equal(source.split(block).length, 2, 'unique quote-selection mutation target');
  return block;
}
