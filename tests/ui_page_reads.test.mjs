// Opening a Notebook page reads it: the exact revision shown goes to Core,
// and the revision read before, when older, is where what changed begins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PageReads } from '../web/page-reads.mjs';

const page = revision => ({ source_ref: { kind: 'memory', id: 'p1', revision } });
function fixture(answer) {
  const sent = [], recorded = [];
  const reads = new PageReads({ send: async (...args) => { sent.push(args); return typeof answer === 'function' ? answer() : answer; },
    recorded: () => recorded.push(true) });
  return { reads, sent, recorded };
}
const committed = previous => ({ status: 'committed', recorded: true, result: { item_id: 'p1', previous_revision: previous, read_revision: 3, current_revision: 3, changed: true } });

test('opening a page sends the exact revision shown and answers the older revision read before', async () => {
  const f = fixture(committed(1));
  assert.equal(await f.reads.opened(page(3)), 1);
  assert.deepEqual(f.sent, [['p1', 3]]);
  assert.equal(f.recorded.length, 1, 'a recorded read redraws what Core holds');
});

test('a page never read, or read as it stands, has no earlier revision to show changes from', async () => {
  for (const previous of [0, 3, 4]) {
    const f = fixture(committed(previous));
    assert.equal(await f.reads.opened(page(3)), null, String(previous));
  }
});

test('a read Core did not record says so, and that the page may still show as changed', async () => {
  for (const answer of [{ status: 'rejected', recorded: true, error: { code: 'FORBIDDEN', message: 'No readable Notebook revision' } },
    { status: 'retryable', recorded: false }, () => { throw Error('offline'); }]) {
    const f = fixture(answer);
    await assert.rejects(f.reads.opened(page(3)), /may still show as changed/);
    assert.equal(f.recorded.length, 0);
  }
});

test('only an exact Notebook revision is read', async () => {
  const f = fixture(committed(0));
  for (const source of [{ source_ref: { kind: 'message', id: 'm1' } }, page(0), page('2'), null]) {
    await assert.rejects(f.reads.opened(source), /exact Notebook revision/);
  }
  assert.deepEqual(f.sent, []);
});

test('a page shown again at the same revision shows the same changes, though Core now has it read', async () => {
  let previous = 1;
  const f = fixture(() => committed(previous));
  assert.equal(await f.reads.opened(page(3)), 1);
  previous = 3;
  assert.equal(await f.reads.opened(page(3)), 1, 'shown again, what changed since revision 1 is still what changed');
  assert.equal(await f.reads.opened({ source_ref: { kind: 'memory', id: 'p2', revision: 3 } }), null, 'another page has its own');
  previous = 3;
  assert.equal(await f.reads.opened(page(4)), 3, 'a newer revision compares with the one read before it');
  previous = 4;
  assert.equal(await f.reads.opened(page(4)), 3);
  assert.equal(await f.reads.opened(page(3)), null, 'an older revision shown again has nothing to compare');
  assert.equal(f.sent.length, 6, 'each showing is still sent');
});
