import assert from 'node:assert/strict';

// Both the native DOM and the focused real-renderer check supply this shape.
// Text comparisons are exact strings; no measured positions are compared.
export function assertPassagePresentation(actual, body, kind, reason) {
  assert.equal(actual.raw, body, 'rendered surface retains exact raw Markdown');
  assert.equal(actual.quoteCount, 1, 'inserted passage or reason is one visible Markdown quote');
  assert.equal(actual.quote, kind === 'quoted' ? '  Keep these words 🪴' : reason,
    'the quote displays the selected words or the caller’s explicit reason');
  assert.ok(actual.text.includes(kind === 'quoted' ? 'The corrected reply is in the same dossier.' : 'Reply without a quote:'),
    'the reply body and exception heading remain readable');
  if (kind === 'quoted') assert.equal(actual.bold, 'Keep these words', 'selected Markdown is rendered as bold');
}
