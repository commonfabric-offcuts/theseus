import test from 'node:test';
import assert from 'node:assert/strict';
import { ThingsRail } from '../web/things-rail.mjs';
import { routeKey } from '../web/topic-navigation.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

// 788 retires the right-rail Starred list, not the shared cross-topic link
// route or the dossier's paging/presentation checks below.
test('item 655 shared rail message link retains the valid cross-topic route after 788 removes Starred', () => {
  const targets = [];
  const rail = { doc: miniDocument(), handles: { open: target => targets.push(target) }, wide: { matches: true } };
  const link = ThingsRail.prototype.placeLink.call(rail, { kind: 'topic', id: 'second-topic', message: 'reply' }, 'Reply');
  assert.equal(link.href, '?topic=second-topic&message=reply');
  link.onclick({ target: link, button: 0, preventDefault() {} });
  assert.equal(targets.length, 1);
  assert.doesNotThrow(() => routeKey(targets[0]));
  assert.deepEqual(targets[0], { kind: 'topic', id: 'second-topic', message: 'reply' });
});

test('item 655 returning to an old dossier preserves the paging gap and merges each message once when it loads', () => {
  const views = new TopicViews({ instanceId: 'i', topicId: 't' });
  const item = seq => ({ id: 'm' + seq, seq, topic_id: 't', body: 'Message ' + seq, author_id: 'agent' });
  const page = (seqs, next) => ({ instance_id: 'i', items: seqs.map(item), next_cursor: next, relevant_versions: { topic: 1 } });
  views.messagesPage(page([30, 31], 30), { initial: true });
  assert.equal(views.messagesPage(page([3, 4], 3), { anchored: true, cursor: 5 }), true);
  assert.deepEqual([views.olderCursor, views.newest], [30, 31], 'a return never skips the unloaded messages between the dossier and the newest page');
  assert.notEqual(views.runOf('m3'), views.runOf('m30'), 'the gap stays a gap');
  views.messagesPage(page(Array.from({ length: 27 }, (_, n) => n + 3), 3), { cursor: 30 });
  assert.equal(views.messages.size, 29);
  assert.equal(views.runOf('m3'), views.runOf('m30'), 'the overlapping earlier page joins the two runs');
});

// Exercise the real registry open contract without a browser or another test process.
import { EditorRegistry } from '../web/app-session.mjs';
const gate655 = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function opening655(present) {
  const ref = { kind: 'message', id: 'source' }, source = { instance_id: 'i', source_ref: ref, topic_id: 't' };
  const registry = Object.create(EditorRegistry.prototype);
  Object.assign(registry, { generation: 0, disposed: false, bootstrap: { instance_id: 'i', actor: 'reader' }, activity() {},
    cleanup: { foreground: () => ({ read: work => work({}), release() {} }) },
    keepBeforeStep: async () => {}, api: { view: async name => name === 'source' ? source : { submissions: [], destination_available: true } },
    validateState() {}, setPending() {}, register: async () => ({ read() {} }),
    // Real registered editors have a session; this presentation-only fixture
    // does not construct them.800 reads the note's session before presenting.
    sessionFor: () => ({ unsettledSave: () => false }), present });
  return { registry, open: () => registry.open(ref, { topicId: 't' }) };
}
test('item 655 B3 open waits for presentation and reports a presentation failure', async () => {
  const entered = gate655(), release = gate655();
  const f = opening655(async () => { entered.resolve(); await release.promise; throw Error('Dossier lookup refused'); });
  let settled = false;
  const result = f.open().then(value => ({ value }), error => ({ error })).then(answer => { settled = true; return answer; });
  await entered.promise;
  await new Promise(resolve => setImmediate(resolve));
  const reportedEarly = settled;
  release.resolve();
  const answer = await result;
  assert.equal(reportedEarly, false, 'open must not report success before presentation has completed');
  assert.match(answer.error?.message ?? '', /Dossier lookup refused/, 'the caller receives the failure instead of an unhandled rejection');
});


test('item 655 B3 an open superseded during presentation never reports success for the abandoned source', async () => {
  const entered = gate655(), release = gate655();
  let count = 0;
  const f = opening655(async () => { if (++count === 1) { entered.resolve(); await release.promise; } });
  const old = f.open();
  await entered.promise;
  const newer = await f.open();
  release.resolve();
  assert.equal(await old, null, 'the late presentation result is abandoned');
  assert.equal(f.registry.current, newer, 'the newer presentation stays current');
});
