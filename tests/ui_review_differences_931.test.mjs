import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDifferences } from '../web/review-differences.mjs';
import { RecoveryCleanup } from '../web/cleanup.mjs';
import { Editor, restoreEditor } from '../web/editor.mjs';
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

test('931 R2 acknowledged history in the same slot stays quiet across generations', () => {
  const e = editor(), r = row(); r.snapshot.localVersion = r.snapshot.ackVersion;
  r.snapshot.draft.body = 'Hello'; e.draft = { ...draft(), generation: 'g2', revision: 4, body: '' };
  assert.equal(reviewDifferences(e, [r]).length, 0);
  r.snapshot.draft.revision = 5; assert.equal(reviewDifferences(e, [r]).length, 1, 'a newer revision still competes');
  r.snapshot.draft.revision = 3; r.snapshot.draft.id = 'different-slot'; assert.equal(reviewDifferences(e, [r]).length, 1);
});
test('931 R2 acknowledged history stays quiet during actual prepare, late save, reload and confirmation', () => {
  const context = { instanceId: 'fixture', actor: 'person', kind: 'reply', sourceRef: { kind: 'message', id: 'source' }, topicId: 'topic' };
  const e = new Editor(context, { ...draft(), body: 'Hello' }), r = row();
  r.snapshot.draft = structuredClone(e.draft); r.snapshot.localVersion = r.snapshot.ackVersion;
  const ticket = e.saveTicket('save');
  e.beginPrepare({ prepareOperationId: 'prepare', sendOperationId: 'send', submissionId: 'submission' });
  assert.equal(e.draft.revision, null); assert.equal(reviewDifferences(e, [r]).length, 0, 'no pill while prepare is pending');
  const receipt = (operation_id, kind, result) => ({ instance_id: 'fixture', recorded: true, status: 'committed', operation_id, kind, result });
  assert.equal(e.acceptSave(ticket, receipt('save', 'draft.save', { draft_id: 'd', generation: 'g', draft_revision: 4 })), true);
  r.snapshot.draft.revision = 4;
  assert.equal(reviewDifferences(e, [r]).length, 0, 'late matching save confirms revision four in the pending snapshot');
  const reloaded = restoreEditor(context, null, e.snapshot());
  assert.equal(reviewDifferences(reloaded, [r]).length, 0, 'pending snapshot carries the last confirmed revision across reload');
  assert.equal(e.acceptPreparation(receipt('prepare', 'submission.prepare', { submission_id: 'submission', send_operation_id: 'send', next_draft: { id: 'd', generation: 'g2', revision: 5 } })), true);
  assert.equal(reviewDifferences(e, [r]).length, 0, 'new generation keeps the history quiet');
  assert.equal(e.acceptSend(receipt('send', 'message.send', { submission_id: 'submission' })), true);
  assert.equal(reviewDifferences(e, [r]).length, 0);
});
test('931 R2 an unnamed public false whisper matches null, while actual whisper and recipients differ', () => {
  const e = editor(), r = row(); e.draft.whisper = false;
  assert.equal(reviewDifferences(e, [r]).length, 0);
  e.draft.whisper = true; assert.equal(reviewDifferences(e, [r]).length, 1);
  e.draft.whisper = false; e.draft.addressees = ['someone']; assert.equal(reviewDifferences(e, [r]).length, 1);
});
test('931 R2 whitespace-only writing against an absent remote is silent', () => {
  const e = editor(); e.draft.body = ' \t\n '; e.conflict = { remote: null };
  assert.equal(reviewDifferences(e).length, 0);
  e.draft.body += 'written'; assert.equal(reviewDifferences(e).length, 1);
  e.draft.body = ' '; e.draft.attachments = [{ id: 'image' }]; assert.equal(reviewDifferences(e).length, 1);
});
