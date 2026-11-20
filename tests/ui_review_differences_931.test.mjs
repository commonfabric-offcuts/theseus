import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDifferences } from '../web/review-differences.mjs';
import { RecoveryCleanup } from '../web/cleanup.mjs';
const draft = () => ({ id: 'd', generation: 'g', revision: 3, body: 'Words', attachments: [], quotes: [], addressees: [], intent: null, whisper: null });
const editor = () => ({ key: 'key', draft: draft(), clientCycleId: 'current', uploadState: { entries: [] } });
const row = () => ({ id: 'old', stamp: 's', availability: 'available', snapshot: { format: 2, draft: draft(), clientCycleId: 'old', localVersion: 1, ackVersion: 0, submissions: [], uploadState: { entries: [] } } });
const selected = (sha256, id) => ({ selected: true, owner: { kind: 'cycle', id }, file: { name: 'same-name.png', size: 25, type: 'image/png', ...(sha256 ? { sha256 } : {}) } });
test('931 known image bytes differ despite matching words and names; unknown bytes are not guessed', () => {
  const e = editor(), r = row(); e.uploadState.entries = [selected('a'.repeat(64), 'current')];
  r.snapshot.uploadState.entries = [selected(null, 'old')]; assert.equal(reviewDifferences(e, [r]).length, 0);
  r.snapshot.uploadState.entries[0].file.sha256 = 'b'.repeat(64); assert.equal(reviewDifferences(e, [r]).length, 1);
  r.snapshot.uploadState.entries[0].file.sha256 = 'a'.repeat(64); assert.equal(reviewDifferences(e, [r]).length, 0);
});
test('931 a selected image not in an older acknowledged draft still differs', () => {
  const e = editor(), r = row(); r.snapshot.localVersion = r.snapshot.ackVersion;
  r.snapshot.uploadState.entries = [selected('a'.repeat(64), 'old')]; assert.equal(reviewDifferences(e, [r]).length, 1);
});
test('931 recipient, quote and delivery choices remain meaningful differences', () => {
  for (const [key, value] of [['addressees', ['someone']], ['quotes', [{ id: 'source', excerpt: 'quote' }]], ['whisper', true], ['intent', 'ask']]) {
    const e = editor(), r = row(); r.snapshot.draft[key] = value; assert.equal(reviewDifferences(e, [r]).length, 1, key);
  }
});
test('931 confirmed and corrected refusal history is silent when its draft is identical', () => {
  for (const extra of [{ status: 'confirmed' }, { status: 'refused', correctedBy: 'successor' }, { status: 'refused', detached: true }]) {
    const e = editor(), r = row(); r.snapshot.submissions = [{ ...extra, snapshot: { ...draft(), body: 'old' }, receipt: { kind: 'submission.prepare' } }];
    assert.equal(reviewDifferences(e, [r]).length, 0);
  }
});
test('931 proven retained-byte release preserves the choice while other stamp changes invalidate it', () => {
  const r = row(); r.reviewChoice = { stamp: r.stamp, writing: draft() };
  r.snapshot.uploadState.revision = 1; r.snapshot.uploadState.entries = [{ bytes_ref: 'bytes', version: 1 }];
  const next = RecoveryCleanup.prototype.releasedRow.call({}, r, ['bytes']);
  assert.notEqual(next.stamp, r.stamp); assert.equal(next.reviewChoice.stamp, next.stamp);
  assert.deepEqual(next.snapshot.draft, r.snapshot.draft); assert.deepEqual(next.snapshot.submissions, r.snapshot.submissions);
  r.reviewChoice.stamp = 'older'; const stale = RecoveryCleanup.prototype.releasedRow.call({}, r, ['bytes']);
  assert.notEqual(stale.reviewChoice.stamp, stale.stamp, 'cleanup cannot resurrect a stale choice');
});
