import assert from 'node:assert/strict';
import test from 'node:test';
import { NotebookQuoteTransfer } from '../web/notebook-quote-transfer.mjs';
import { notebookSourceSpan, notebookSourceParts } from '../web/notebook-passages.mjs';

const bootstrap = { instance_id: 'isolated-instance', actor: 'reader' };
const choice = { source: { kind: 'memory', id: 'page-a', revision: 7 },
  owner_scope: { kind: 'workspace', id: 'outcome-a' }, text: 'An exact **passage**.', start: 25, end: 46 };
const source = { source_ref: choice.source };
function fixture() {
  const data = new Map();
  const storage = { setItem: (k, v) => data.set(k, v), getItem: k => data.get(k) ?? null, removeItem: k => data.delete(k) };
  return { storage, data, transfer: new NotebookQuoteTransfer(bootstrap, storage) };
}
test('962 reload keeps exact page revision, Markdown and destination until that source is actually opened', () => {
  const f = fixture(), kept = f.transfer.keep('conversation-a', choice);
  const resumed = new NotebookQuoteTransfer(bootstrap, f.storage);
  assert.equal(resumed.forSource('another-topic', source), null);
  assert.equal(resumed.forSource('conversation-a', { source_ref: { ...choice.source, id: 'another-page' } }), null);
  assert.equal(resumed.forSource('conversation-a', { source_ref: { ...choice.source, revision: 8 } }), null);
  assert.deepEqual(resumed.forSource('conversation-a', source), kept);
  assert.deepEqual(kept.choice, choice);
  assert.equal(resumed.claim(kept), true);
  assert.equal(resumed.forSource('conversation-a', source), null);
});
test('962 another instance or person cannot take a pending quote from the shared device store', () => {
  const f = fixture(); f.transfer.keep('conversation-a', choice);
  for (const binding of [{ ...bootstrap, actor: 'another-reader' }, { ...bootstrap, instance_id: 'another-instance' }])
    assert.equal(new NotebookQuoteTransfer(binding, f.storage).forSource('conversation-a', source), null);
});
test('962 a late completion cannot erase a newer deliberate selection', () => {
  const f = fixture(), first = f.transfer.keep('conversation-a', choice);
  const second = f.transfer.keep('conversation-a', { ...choice, text: 'A newer passage.' });
  assert.equal(f.transfer.claim(first), false);
  assert.deepEqual(f.transfer.forSource('conversation-a', source), second);
});
test('962 device refusal retains the source action as a failure instead of pretending to hand off', () => {
  const transfer = new NotebookQuoteTransfer(bootstrap, { setItem: () => { throw Error('device unavailable'); } });
  assert.throws(() => transfer.keep('conversation-a', choice), /device unavailable/);
});
test('962 malformed/private-stale source offers no automatic quote', () => {
  const f = fixture();
  for (const source_ref of [{ kind: 'message', id: 'page-a', revision: 7 }, { kind: 'memory', id: 'page-a', revision: 0 }])
    assert.throws(() => f.transfer.keep('conversation-a', { ...choice, source: source_ref }));
  f.storage.setItem(f.transfer.key, '{broken');
  assert.equal(f.transfer.forSource('conversation-a', source), null);
});
test('962 repeated words highlight the selected card occurrence, preserving exact Markdown and CRLF', () => {
  const body = '## First\r\n\r\nSame **words**.\r\n\r\n## Second\r\n\r\nSame **words**. A later phrase.';
  const shown = 'Same **words**. A later phrase.', start = body.indexOf('Same', body.indexOf('## Second'));
  const excerpt = { start: 0, end: 15, text: 'Same **words**.' };
  const span = notebookSourceSpan(body, shown, excerpt, { start, end: body.length });
  assert.equal(span.start, start); assert.equal(body.slice(span.start, span.end), excerpt.text);
});
test('962 omitted private card metadata does not invent a contiguous source highlight', () => {
  const body = 'Above.\n\n<!-- hidden details -->\n\nBelow.', shown = 'Above.\n\nBelow.';
  assert.deepEqual(notebookSourceSpan(body, shown, { start: 0, end: shown.length, text: shown }), { start: -1, end: -1 });
  const parts = notebookSourceParts(body, shown, { start: 0, end: shown.length, text: shown });
  assert.equal(parts.join(''), shown);
  assert.equal(parts.length, 2);
  assert.ok(parts.every(part => body.includes(part)), 'each Core quote preserves an actual source substring');
});

test('962 a refused claim changes no intent; a blocked edit restores only its own claim', () => {
  const f = fixture(), kept = f.transfer.keep('conversation-a', choice);
  const remove = f.storage.removeItem;
  f.storage.removeItem = () => { throw Error('receipt unavailable'); };
  assert.throws(() => f.transfer.claim(kept), /receipt unavailable/);
  assert.deepEqual(f.transfer.forSource('conversation-a', source), kept);
  f.storage.removeItem = remove;
  assert.equal(f.transfer.claim(kept), true);
  f.transfer.restore(kept);
  assert.deepEqual(f.transfer.forSource('conversation-a', source), kept);
  f.transfer.claim(kept);
  const next = f.transfer.keep('conversation-a', { ...choice, text: 'Newer words.' });
  f.transfer.restore(kept);
  assert.deepEqual(f.transfer.forSource('conversation-a', source), next);
});
