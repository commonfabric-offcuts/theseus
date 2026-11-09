import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorRegistry } from '../web/app-session.mjs';

// Item 54: a send confirmed under an earlier runtime (a recovery copy kept
// from before the database was restored, or one set aside by a runtime
// review) names a topic version this runtime may never reach. The page waits
// for a topic version its own sends reached, so only sends confirmed in this
// runtime may name one; otherwise topic updates wait for ever on a version
// that is not coming.
const current = { authority_id: 'a2', authority_epoch: 'e2', continuity: 'initial' };
const registry = () => new EditorRegistry({ api: {}, journal: {}, bootstrap: { actor: 'person', instance_id: 'i1', authority: current } });
const sent = (version, authority, extra = {}) => ({ status: 'confirmed', authority, receipt: { status: 'committed', result: { topic: { version } } }, ...extra });

test('only sends confirmed in this runtime name the topic version the page waits for', () => {
  const r = registry(), now = { authority_id: 'a2', authority_epoch: 'e2' }, before = { authority_id: 'a1', authority_epoch: 'e1' };
  assert.equal(r.localTopicVersion({ submissions: [sent(7, now)] }), 7, 'a send in this runtime names its version');
  assert.equal(r.localTopicVersion({ submissions: [sent(90, before), sent(7, now)] }), 7, 'an earlier runtime\'s higher version is not waited for');
  assert.equal(r.localTopicVersion({ submissions: [sent(90, before)] }), 0, 'an earlier runtime\'s send alone names none');
  assert.equal(r.localTopicVersion({ submissions: [sent(90, now, { detached: true })] }), 0, 'a send set aside by a runtime review names none');
  assert.equal(r.localTopicVersion({ submissions: [{ ...sent(9, now), status: 'prepared' }] }), 0, 'an unconfirmed send names none');
});
