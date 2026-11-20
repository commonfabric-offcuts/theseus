import test from 'node:test';
import assert from 'node:assert/strict';
import { renderer799 } from './fixtures/renderer799.mjs';
import { configureCoverRefresh, messageUpdateActivity, refreshRequest } from '../web/cover-refresh.mjs';
import { coverSheet } from '../web/dossier-cover.mjs';
import { clock } from '../web/times.mjs';
import { Reader } from '../web/reader.mjs';

let serial = 0;
const at = new Date(2026, 10, 19, 17, 20).getTime();
const pending = { request_id: 'rq-fixture', operation_id: 'request-fixture', state: 'pending', by: 'owner',
  recipient: 'writer', root_id: 'root', observed_revision: 1, at_ms: at, completed_revision: null };
const done = { ...pending, state: 'completed', completed_by: 'writer', completed_ms: at + 60000, completed_revision: 2 };
function fixture(t, viewer = 'owner') {
  const r = renderer799(viewer), doc = r.list.ownerDocument, kept = new Map(), sent = [];
  const now = clock.now; clock.now = () => at; t.after(() => { clock.now = now; configureCoverRefresh(null); });
  doc.defaultView = { localStorage: { getItem: key => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value), removeItem: key => kept.delete(key) } };
  doc.querySelectorAll = selector => r.list.querySelectorAll(selector);
  const response = { run: async () => { throw Error('fixture interrupted'); } };
  // One binding per fixture; distinct fixtures never share the module's journal.
  const instance = `requests829-${++serial}`;
  configureCoverRefresh(() => ({ bootstrap: { instance_id: instance, actor: viewer, authority: { authority_id: 'a', authority_epoch: 'e' } },
    api: { command: async envelope => { sent.push(envelope); return response.run(envelope); } }, changed() {} }));
  const context = { viewer, nameOf: id => ({ owner: 'Tony', writer: 'warp' })[id] ?? id, topicId: 't1', rootId: 'root' };
  return { ...r, doc, kept, sent, response, context };
}
const cover = refresh => ({ root_id: 'root', revision: refresh.state === 'pending' ? 1 : 2, stands: 'Facts stay', waiting: [],
  payload: null, owner: 'owner', refresh, refresh_revision: refresh.state === 'pending' ? 1 : 2 });
const item = refresh => ({ id: 'answer', author_id: 'writer', author_kind: 'agent', topic_id: 't1', revision: refresh.state === 'pending' ? 1 : 2,
  acts: { message_refresh: refresh, message_refresh_revision: refresh.state === 'pending' ? 1 : 2 } });

test('829 cover shows one timed request line and replaces it with the qualifying write time', t => {
  const f = fixture(t); let sheet;
  assert.doesNotThrow(() => { sheet = coverSheet(f.doc, cover(pending), f.context); }, 'typed request needs no fabricated message link');
  assert.equal(sheet.querySelectorAll('.refresh-request-line').length, 1);
  const line = sheet.querySelector('.refresh-request-line');
  assert.match(line.text, /Tony asked warp to refresh the cover · 5:20 PM/);
  assert.equal(line.querySelector('time').dataset.ms, String(at));
  assert.equal(sheet.querySelector('.cover-refresh-glyph').tag, 'span', 'a typed request is no fabricated message link');
  const completed = coverSheet(f.doc, cover(done), f.context);
  assert.equal(completed.querySelectorAll('.refresh-request-line').length, 1);
  assert.match(completed.querySelector('.refresh-request-line').text, /warp refreshed the cover · 5:21 PM/);
  assert.equal(completed.querySelector('.refresh-request-line').querySelector('time').dataset.ms, String(at + 60000));
  assert.ok(!completed.text.includes('Please rewrite'));
});

test('829 message update line stays visible to its recipient and completion never becomes a pending line on stale read', t => {
  const f = fixture(t, 'writer');
  const first = messageUpdateActivity(f.doc, item(pending), f.context);
  assert.ok(first, 'the recipient sees the request line even though it cannot ask itself');
  assert.match(first.text, /Tony asked warp to update this message · 5:20 PM/);
  const completed = messageUpdateActivity(f.doc, item(done), f.context);
  assert.match(completed.text, /warp updated this message · 5:21 PM/);
  assert.equal(completed.hidden, false);
  const stale = messageUpdateActivity(f.doc, item(pending), f.context);
  assert.match(stale.text, /warp updated this message/);
  assert.ok(!stale.text.includes('Tony asked'));
});

test('829 first-cover dossier draws one line outside the title controls and coalesces re-render', t => {
  const f = fixture(t);
  const source = { id: 'root', seq: 1, body: 'Source', author_id: 'owner', topic_id: 't1',
    acts: { cover: null, cover_revision: 0, cover_refresh: { ...pending, observed_revision: 0 }, cover_refresh_revision: 1 } };
  let state;
  assert.doesNotThrow(() => { state = f.add([source]); }, 'first-cover typed request needs no message link');
  let section = state.sections.get('root');
  assert.equal(section.querySelectorAll('.refresh-request-line').length, 1);
  assert.equal(section.querySelector('.stack-tools').querySelectorAll('.refresh-request-line').length, 0);
  f.add([source]); section = state.sections.get('root');
  assert.equal(section.querySelectorAll('.refresh-request-line').length, 1);
});

test('829 old request message link remains unchanged and gets no retroactive line', t => {
  const f = fixture(t), legacy = { ...pending, request_id: undefined, request_message_id: 'old-message' };
  const sheet = coverSheet(f.doc, cover(legacy), f.context);
  assert.equal(sheet.querySelectorAll('.refresh-request-line').length, 0);
  assert.equal(sheet.querySelector('.cover-refresh-glyph').tag, 'a');
  assert.match(sheet.querySelector('.cover-refresh-glyph').href, /message=old-message/);
});

test('829 interrupted request retries its exact envelope and a late pending receipt cannot reverse completion', async t => {
  const f = fixture(t), target = { type: 'message', id: 'answer', revision: 1, refresh_revision: 0 };
  const request = refreshRequest(f.doc, target);
  await request.send();
  assert.equal(f.sent.length, 1); assert.equal(f.kept.size, 1);
  assert.match(request.state().error, /not confirmed/);
  let resolve;
  f.response.run = () => new Promise(done => { resolve = done; });
  const sending = request.send();
  assert.deepEqual(f.sent[1], f.sent[0], 'recovery must resend the exact saved envelope');
  const completed = { ...done, operation_id: f.sent[0].operation_id };
  refreshRequest(f.doc, { ...target, revision: 2, refresh: completed, refresh_revision: 2 });
  resolve({ ...f.sent[0], status: 'committed', recorded: true,
    result: { refresh: { ...pending, operation_id: f.sent[0].operation_id }, refresh_revision: 1 } });
  await sending;
  assert.equal(request.state().pending, false);
  assert.equal(request.state().refresh.state, 'completed');
  assert.equal(f.kept.size, 0);
  const stale = messageUpdateActivity(f.doc, item(pending), f.context);
  assert.match(stale.text, /warp updated this message/);
});

test('829 Reader shows the first-cover request on its bare source without adding a fabricated cover', t => {
  const f = fixture(t), origin = f.doc.createElement('div'), body = f.doc.createElement('div');
  const prior = globalThis.document; globalThis.document = f.doc; t.after(() => { globalThis.document = prior; });
  const reader = { callbacks: { actor: () => 'owner', actorName: f.context.nameOf }, sourceBody: body,
    $: id => { assert.equal(id, 'reader-origin'); return origin; }, paintTone() {} };
  const source = { source_ref: { kind: 'message', id: 'root' }, author: 'owner', author_kind: 'human', topic_id: 't1',
    acts: { cover: null, cover_revision: 0, cover_refresh: { ...pending, observed_revision: 0 }, cover_refresh_revision: 1 } };
  Reader.prototype.paintOrigin.call(reader, source);
  assert.equal(origin.querySelectorAll('.refresh-request-line').length, 1);
  assert.match(origin.querySelector('.refresh-request-line').text, /Tony asked warp to refresh the cover/);
  assert.equal(origin.querySelectorAll('.dossier-cover').length, 0);
});
