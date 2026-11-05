import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Editor, restoreEditor } from '../web/editor.mjs';
import { EditorSession, RuntimeAuthority, PRIOR_PUBLICATION_NOTICE } from '../web/session.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { TopicNavigation } from '../web/topic-navigation.mjs';

const copy = value => structuredClone(value);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function journal() {
  const rows = new Map();
  return new RecoveryJournal({
    put: async row => rows.set(row.id, copy(row)),
    get: async id => copy(rows.get(id)),
    forEditor: async key => [...rows.values()].filter(row => row.editorKey === key).map(copy),
    currentCandidates: async (key, ids) => ids.map(id => rows.get(id)).filter(row => row?.editorKey === key).map(copy),
    removeExact: async (id, stamp) => { if (rows.get(id)?.stamp === stamp) rows.delete(id); },
  }, 'fixture-tab');
}
async function fixture(t) {
  const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_store.py'], { cwd: new URL('..', import.meta.url) });
  const pending = new Map();
  let serial = 0, errors = '';
  child.stderr.on('data', data => { errors += data; });
  createInterface({ input: child.stdout }).on('line', line => {
    const data = JSON.parse(line), waiter = pending.get(data.id);
    pending.delete(data.id);
    if (data.failure) waiter.reject(new Error(data.failure)); else waiter.resolve(data.answer);
  });
  const exited = new Promise(resolve => child.on('exit', code => {
    for (const waiter of pending.values()) waiter.reject(new Error(`Store fixture exited ${code}: ${errors}`));
    resolve(code);
  }));
  t.after(async () => { child.stdin.end(); assert.equal(await exited, 0, errors); });
  const rpc = data => new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ ...data, id }) + '\n');
  });
  const api = {
    command: envelope => rpc({ method: 'command', envelope }),
    view: (name, args) => rpc({ method: 'view', name, args }),
  };
  const authority = copy((await api.view('capabilities', {})).authority);
  const pin = () => ({ authority_id: authority.authority_id, authority_epoch: authority.authority_epoch });
  // Fixture acts explicitly capture the facts read above; transport never fills
  // a missing pin or rewrites a retry's envelope.
  const command = (kind, id, args, target = {}, expected = {}) => ({
    v: 1, instance_id: 'ux-fixture', operation_id: id, kind, target, expected: { ...expected, authority: pin() }, args,
  });
  const sent = async envelope => {
    const receipt = await api.command(envelope);
    assert.equal(receipt.status, 'committed', JSON.stringify(receipt)); return receipt;
  };
  await sent(command('workspace.create', 'workspace', { id: 'w1', title: 'Isolated reader', team: [] }));
  const openingSource = { kind: 'new_topic', id: 'opening', workspace_id: 'w1' };
  await sent(command('draft.save', 'opening-save', { source_ref: openingSource, topic_id: 't1', generation: 'g0', body: 'Source words',
    opening: { workspace_id: 'w1', title: 'Read here', participants: [] } }, { draft_id: 'd0' }, { draft_revision: 0 }));
  await sent(command('submission.prepare', 'opening-prepare', { draft_id: 'd0', submission_id: 's0', send_operation_id: 'opening-send' }, { topic_id: 't1' }, { draft_revision: 1 }));
  const opened = await sent(command('topic.create_and_send', 'opening-send', { submission_id: 's0' }, { topic_id: 't1' }));
  const sourceRef = { kind: 'message', id: opened.result.message_id };
  const context = { instanceId: 'ux-fixture', actor: 'fixture-person', sourceRef, topicId: 't1', kind: 'reply' };
  const editor = new Editor(context, { id: 'reply-draft', revision: 0, generation: 'gA', body: '' });
  const storage = journal(), calls = [];
  const transport = {
    command: envelope => { calls.push(copy(envelope)); return api.command(envelope); },
    view: api.view,
    bootstrap: async () => api.view('capabilities', {}),
  };
  const runtime = new RuntimeAuthority({ api: transport, instanceId: context.instanceId, authority });
  const session = new EditorSession(editor, { api: transport, journal: storage, authority, runtime, id: () => `ux-${++serial}` });
  const state = () => api.view('editor_state', { source_ref: sourceRef, topic_id: 't1' });
  const advance = async (options = {}) => {
    const facts = await rpc({ method: 'epoch', ...options });
    Object.assign(authority, facts.authority); return facts;
  };
  return { api, transport, calls, editor, session, storage, context, state, authority, advance, command, pin, runtime };
}

test('send drains the in-flight A save, prepares exact A and lets B save while public send waits', async t => {
  const f = await fixture(t), saved = deferred(), releaseSave = deferred(), sending = deferred(), releaseSend = deferred();
  let held = false;
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    const durable = (await f.storage.own(f.editor.key)).snapshot;
    assert.deepEqual(durable.attempts.find(item => item.envelope.operation_id === envelope.operation_id).envelope, envelope, 'exact envelope is journaled before dispatch');
    if (envelope.kind === 'message.send') { sending.resolve(); await releaseSend.promise; }
    const receipt = await f.api.command(envelope);
    if (envelope.kind === 'draft.save' && !held) { held = true; saved.resolve(); await releaseSave.promise; }
    return receipt;
  };
  f.editor.edit({ body: 'Earlier A' });
  const saving = f.session.save(); await saved.promise;
  f.editor.edit({ body: 'Exact A to publish', quotes: [{ source: f.context.sourceRef, excerpt: 'Source' }] });
  const submitting = f.session.send();
  f.editor.edit({ body: 'B while A prepares' });
  assert.equal(f.editor.submissions[0].snapshot.body, 'Exact A to publish');
  releaseSave.resolve(); await saving; await sending.promise;
  await f.session.save();
  assert.equal((await f.state()).draft.body, 'B while A prepares', 'public network wait cannot block private B save');
  releaseSend.resolve(); await submitting;
  const receipt = f.editor.submissions[0].receipt;
  assert.equal(receipt.status, 'committed');
  const source = await f.api.view('source', { kind: 'message', id: receipt.result.message_id });
  assert.equal(source.body, 'Exact A to publish');
  assert.deepEqual(source.quotes, [{ source: f.context.sourceRef, excerpt: 'Source' }]);
  assert.equal(f.editor.draft.body, 'B while A prepares');
  assert.equal(f.calls.filter(item => item.kind === 'message.send').length, 1);
});

test('lost preparation reply reloads original receipt and keeps unsaved B without preparing again', async t => {
  const f = await fixture(t);
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    const receipt = await f.api.command(envelope);
    if (envelope.kind === 'submission.prepare') throw new Error('connection lost after commit');
    return receipt;
  };
  f.editor.edit({ body: 'A survives reload' });
  await f.session.send();
  f.editor.edit({ body: 'B not on server yet', caret: { start: 5, end: 5 } });
  await f.session.persist();
  const saved = (await f.storage.own(f.editor.key)).snapshot;
  const server = await f.state();
  const restored = restoreEditor(f.context, server.draft, saved);
  const session = new EditorSession(restored, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage, snapshot: saved });
  await session.reconcile();
  assert.equal(restored.submissions[0].status, 'prepared');
  assert.equal(restored.draft.generation, server.draft.generation);
  assert.equal(restored.draft.body, 'B not on server yet');
  assert.equal(restored.dirty, true);
  assert.equal(f.calls.filter(item => item.kind === 'submission.prepare').length, 1);
  assert.equal(f.calls.filter(item => item.kind === 'message.send').length, 0, 'checking confirmation cannot publish');
  await session.sendPrepared(restored.submissions[0]);
  assert.equal(restored.submissions[0].status, 'confirmed');
});

test('lost send reply reconciles exactly one public message and cannot replace B', async t => {
  const f = await fixture(t);
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    const receipt = await f.api.command(envelope);
    if (envelope.kind === 'message.send') {
      f.editor.edit({ body: 'B after pressing Send' });
      throw new Error('lost response');
    }
    return receipt;
  };
  f.editor.edit({ body: 'A committed once' });
  await f.session.send();
  assert.equal(f.editor.submissions[0].status, 'prepared');
  await f.session.reconcile();
  assert.equal(f.editor.submissions[0].status, 'confirmed');
  assert.equal(f.editor.draft.body, 'B after pressing Send');
  assert.equal(f.calls.filter(item => item.kind === 'message.send').length, 1);
  const messages = await f.api.view('topic_messages', { topic_id: 't1' });
  assert.equal(messages.items.length, 2, 'only source plus A');
});

test('recorded prepare conflict keeps A and B without manufacturing a send refusal or overwriting remote', async t => {
  const f = await fixture(t);
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    if (envelope.kind === 'submission.prepare') {
      const saved = (await f.state()).draft;
      await f.api.command(f.command('draft.save', 'other-tab', { ...saved, source_ref: f.context.sourceRef, topic_id: 't1', body: 'Other tab writing' }, { draft_id: saved.id }, { draft_revision: saved.revision }));
    }
    return f.api.command(envelope);
  };
  f.editor.edit({ body: 'A intended' });
  const sending = f.session.send();
  f.editor.edit({ body: 'B next paragraph' });
  await sending;
  assert.equal(f.editor.submissions[0].status, 'refused');
  assert.equal(f.editor.submissions[0].receipt.kind, 'submission.prepare');
  assert.equal(f.editor.submissions[0].snapshot.body, 'A intended');
  assert.equal(f.editor.draft.body, 'B next paragraph');
  assert.equal((await f.state()).draft.body, 'Other tab writing');
  assert.equal(f.calls.filter(item => item.kind === 'message.send').length, 0);
});

test('journal failure blocks dispatch and keeps frozen A plus B recoverable in memory', async t => {
  const f = await fixture(t);
  f.storage.backend.put = async () => { throw new Error('disk full'); };
  f.editor.edit({ body: 'Do not lose A' });
  const sending = f.session.send();
  f.editor.edit({ body: 'Do not lose B' });
  await assert.rejects(sending, /disk full/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.editor.submissions[0].snapshot.body, 'Do not lose A');
  assert.equal(f.editor.draft.body, 'Do not lose B');
  assert.ok(f.editor.journalError);
});

test('an unknown lookup and a nonretryable attempt never cause automatic replay', async t => {
  const f = await fixture(t);
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    return { instance_id: 'ux-fixture', operation_id: envelope.operation_id, kind: envelope.kind,
      status: 'rejected', recorded: false, error: { code: 'INTERNAL_ERROR', retryable: false } };
  };
  f.editor.edit({ body: 'Unknown save outcome' });
  await f.session.save();
  await f.session.reconcile();
  await f.session.save();
  assert.equal(f.calls.length, 1);
  assert.equal(f.editor.dirty, true);
  assert.equal(f.session.attempts[0].receipt, null);
  assert.equal(f.session.attempts[0].error.code, 'INTERNAL_ERROR');
});

test('private note save cannot send the reply beneath it', async t => {
  const f = await fixture(t);
  const note = new Editor({ ...f.context, kind: 'note' }, { id: 'note1', revision: 0, body: '' });
  const session = new EditorSession(note, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage });
  note.edit({ body: 'Only the fixture person sees this' });
  await session.save();
  assert.equal(note.dirty, false);
  assert.equal((await f.state()).note.body, note.draft.body);
  assert.throws(() => session.send(), /note/i);
  assert.deepEqual(f.calls.map(item => item.kind), ['note.save']);
});

test('lost own save receipt resolves only its matching recovery conflict and keeps later writing dirty', async t => {
  const f = await fixture(t);
  // The connection stays down through the automatic receipt lookup. Without
  // this, private-save recovery already reconciles A before there is a reload.
  f.transport.view = async () => { throw new Error('still disconnected'); };
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope)); await f.api.command(envelope);
    throw new Error('save reply lost');
  };
  f.editor.edit({ body: 'Saved A before disconnect' });
  await f.session.save();
  f.editor.edit({ body: 'B still local' }); await f.session.persist();
  f.transport.view = f.api.view;
  const snapshot = (await f.storage.own(f.editor.key)).snapshot;
  const state = await f.state();
  const editor = restoreEditor(f.context, state.draft, snapshot);
  assert.ok(editor.conflict);
  const session = new EditorSession(editor, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage, snapshot });
  await session.reconcile();
  assert.equal(editor.conflict, null, 'own exact save receipt explains the remote revision');
  assert.equal(editor.draft.body, 'B still local');
  assert.equal(editor.dirty, true);
  // A later remote write has a different revision and must retain its conflict.
  const remote = { ...state.draft, revision: state.draft.revision + 1, body: 'Other tab' };
  const other = restoreEditor(f.context, remote, snapshot);
  await new EditorSession(other, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage, snapshot }).reconcile();
  assert.equal(other.conflict.remote.body, 'Other tab');
  const newerSameText = restoreEditor(f.context, { ...state.draft, revision: state.draft.revision + 1 }, snapshot);
  await new EditorSession(newerSameText, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage, snapshot }).reconcile();
  assert.ok(newerSameText.conflict, 'same words at a newer remote revision still require review');
});

test('corrected prepare requires explicit matching remote review, uses fresh operation IDs and leaves B alone', async t => {
  const f = await fixture(t);
  let conflictOnce = true;
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    if (envelope.kind === 'submission.prepare' && conflictOnce) {
      conflictOnce = false;
      const saved = (await f.state()).draft;
      await f.api.command(f.command('draft.save', 'other-editor-write', { ...saved, source_ref: f.context.sourceRef, topic_id: 't1', body: 'Other editor version' }, { draft_id: saved.id }, { draft_revision: saved.revision }));
    }
    return f.api.command(envelope);
  };
  f.editor.edit({ body: 'A to deliberately recover' });
  const sending = f.session.send(); f.editor.edit({ body: 'B stays in composer' }); await sending;
  const refused = f.editor.submissions[0];
  const reviewed = (await f.state()).draft;
  const version = f.editor.localVersion;
  await assert.rejects(f.session.correctPreparation(refused, { ...reviewed, revision: reviewed.revision - 1 }, version), /changed/i);
  assert.equal((await f.state()).draft.body, 'Other editor version');
  const corrected = await f.session.correctPreparation(refused, reviewed, version);
  assert.equal(refused.status, 'refused', 'original refusal remains settled history');
  assert.equal(corrected.status, 'confirmed');
  assert.notEqual(corrected.prepareOperationId, refused.prepareOperationId);
  assert.equal(f.editor.draft.body, 'B stays in composer');
  assert.equal(f.editor.dirty, true);
  await f.session.save();
  assert.equal((await f.state()).draft.body, 'B stays in composer');
  const messages = await f.api.view('topic_messages', { topic_id: 't1' });
  assert.equal(messages.items.length, 2);
  assert.equal(messages.items[1].body, 'A to deliberately recover');
});

async function correctionDepartureFixture(t) {
  const f = await fixture(t); let conflict = true;
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    if (envelope.kind === 'submission.prepare' && conflict) {
      conflict = false; const draft = (await f.state()).draft;
      const receipt = await f.api.command(f.command('draft.save', 'correction-other-writer',
        { ...draft, topic_id: 't1', body: 'Other reviewed writing' }, { draft_id: draft.id }, { draft_revision: draft.revision }));
      assert.equal(receipt.status, 'committed');
    }
    return f.api.command(envelope);
  };
  f.editor.edit({ body: 'Exact correction original' }); await f.session.send();
  const refused = f.editor.submissions[0]; assert.equal(refused.status, 'refused');
  assert.equal(refused.receipt.error.code, 'REVISION_CONFLICT');
  const registry = Object.create(EditorRegistry.prototype);
  Object.assign(registry, { sessions: new Map([[f.editor.key, f.session]]), localWrites: new Map(),
    inline: { editors: { reply: f.editor } }, current: null, disposed: false,
    flush: () => f.session.save(), keepEditorsLocal: () => f.session.persist() });
  const visits = [], navigation = new TopicNavigation({ registry, topicId: 't1', navigate: id => visits.push(id) });
  return { ...f, registry, visits, navigation, refused, reviewed: (await f.state()).draft };
}

test('correction departure protects synchronous validation prepare and publication then removes only its marker', async t => {
  const f = await correctionDepartureFixture(t), validation = deferred(), prepare = deferred(), publication = deferred();
  const releaseValidation = deferred(), releasePrepare = deferred(), releasePublication = deferred();
  const originalReceipt = copy(f.refused.receipt), bootstrap = f.transport.bootstrap;
  f.transport.bootstrap = async () => { validation.resolve(); await releaseValidation.promise; return bootstrap(); };
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    if (envelope.kind === 'submission.prepare') { prepare.resolve(); await releasePrepare.promise; }
    if (envelope.kind === 'message.send') { publication.resolve(); await releasePublication.promise; }
    return f.api.command(envelope);
  };
  const correction = f.session.correctPreparation(f.refused, f.reviewed, f.editor.localVersion);
  try {
    assert.ok([...f.session.sends.values()].includes(correction), 'whole returned chain is registered synchronously');
    for (const [stage, release] of [[validation,releaseValidation],[prepare,releasePrepare],[publication,releasePublication]]) {
      await stage.promise;
      assert.equal(f.registry.hasInFlightSend, true); assert.equal(f.registry.hasUnprotectedWriting, true);
      await assert.rejects(f.navigation.open('t2'), /Wait for the send/); assert.deepEqual(f.visits, []);
      if (stage !== publication) release.resolve();
    }
    const unrelated = Promise.resolve('another send'); f.session.sends.set(f.refused.id, unrelated);
    releasePublication.resolve(); const result = await correction;
    assert.equal(result.status, 'confirmed'); assert.deepEqual(f.refused.receipt, originalReceipt);
    assert.deepEqual([...f.session.sends], [[f.refused.id, unrelated]], 'only the correction marker is removed');
    f.session.sends.delete(f.refused.id); assert.equal(f.registry.hasUnprotectedWriting, false);
    assert.equal(await f.navigation.open('t2'), true); assert.deepEqual(f.visits, ['t2']);
    const messages = await f.api.view('topic_messages', { topic_id: 't1' });
    assert.equal(messages.items.filter(m => m.body === 'Exact correction original').length, 1);
    assert.equal(f.calls.filter(c => c.kind === 'message.send').length, 1);
  } finally {
    releaseValidation.resolve(); releasePrepare.resolve(); releasePublication.resolve();
    await correction.catch(() => {});
  }
});

test('correction departure rejection preserves original error and unrelated send marker', async t => {
  const f = await correctionDepartureFixture(t), unrelated = Promise.resolve('unrelated');
  f.session.sends.set(f.refused.id, unrelated);
  const count = f.calls.length, receipt = copy(f.refused.receipt);
  const correction = f.session.correctPreparation(f.refused, { ...f.reviewed, revision: -1 }, f.editor.localVersion);
  const rejection = assert.rejects(correction, /Writing changed since it was reviewed/);
  try {
    assert.equal(f.session.sends.size, 2, 'correction is distinct from the original item id');
  } finally { await rejection; }
  assert.deepEqual([...f.session.sends], [[f.refused.id, unrelated]]);
  assert.equal(f.calls.length, count); assert.deepEqual(f.refused.receipt, receipt);
});

test('wrong instance or operation receipt cannot acknowledge a save or authorize preparation', async t => {
  const f = await fixture(t);
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    const receipt = await f.api.command(envelope);
    return { ...receipt, instance_id: 'another-instance', operation_id: 'different-operation' };
  };
  f.editor.edit({ body: 'Stay pending' });
  await f.session.send();
  assert.equal(f.editor.submissions[0].preparationConfirmed, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.session.attempts[0].receipt, null);
});

test('new keystrokes after Send never become the frozen public message', async t => {
  const f = await fixture(t);
  f.editor.edit({ body: 'A only' });
  const sending = f.session.send();
  f.editor.edit({ body: 'B only' });
  await sending;
  const a = f.editor.submissions[0];
  assert.equal(a.status, 'confirmed');
  const source = await f.api.view('source', { kind: 'message', id: a.receipt.result.message_id });
  assert.equal(source.body, 'A only');
  assert.equal(f.editor.draft.body, 'B only');
});

test('failure to persist recorded preparation prevents navigation and public send', async t => {
  const f = await fixture(t);
  let navigations = 0;
  f.session.prepared = () => { navigations++; };
  const put = f.storage.backend.put;
  f.storage.backend.put = async row => {
    if (row.snapshot.submissions.some(item => item.preparationConfirmed)) throw new Error('journal stopped after preparation');
    return put(row);
  };
  f.editor.edit({ body: 'Prepared A' });
  const sending = f.session.send(); f.editor.edit({ body: 'B stays' });
  await assert.rejects(sending, /journal stopped/);
  assert.equal(navigations, 0);
  assert.equal(f.calls.filter(item => item.kind === 'message.send').length, 0);
  assert.equal(f.editor.draft.body, 'B stays');
  const stored = (await f.storage.own(f.editor.key)).snapshot;
  assert.equal(stored.submissions[0].preparationConfirmed, false);
  assert.equal(stored.attempts.at(-1).envelope.kind, 'submission.prepare');
});

test('each private save journals its exact operation before invoking the API', async t => {
  const f = await fixture(t);
  f.transport.command = async envelope => {
    const row = await f.storage.own(f.editor.key);
    assert.deepEqual(row.snapshot.attempts.at(-1)?.envelope, envelope);
    return f.api.command(envelope);
  };
  f.editor.edit({ body: 'Private autosave' });
  await f.session.save();
  assert.equal(f.editor.dirty, false);
});

for (const failure of ['busy', 'dropped']) for (const stage of ['autosave', 'send-save']) {
  test(`${failure} ${stage} retries the original private operation and saves B after one message`, async t => {
    const f = await fixture(t);
    let once = true;
    const lookups = [];
    f.transport.view = (name, args) => { lookups.push({ name, args: copy(args) }); return f.api.view(name, args); };
    f.transport.command = async envelope => {
      f.calls.push(copy(envelope));
      if (once && envelope.kind === 'draft.save') {
        once = false;
        if (failure === 'dropped') throw new Error('request dropped before commit');
        return { instance_id: 'ux-fixture', operation_id: envelope.operation_id, kind: envelope.kind,
          recorded: false, status: 'retryable', error: { code: 'DATABASE_BUSY', retryable: true, message: 'Try this operation again.' } };
      }
      return f.api.command(envelope);
    };
    f.editor.edit({ body: 'A to send once' });
    if (stage === 'autosave') {
      await f.session.save();
      assert.equal(f.editor.dirty, false, 'transient private-save failure must recover');
    }
    const sending = f.session.send(); f.editor.edit({ body: 'B typed during send' }); await sending;
    assert.equal(f.editor.submissions[0].status, 'confirmed');
    const saves = f.calls.filter(item => item.kind === 'draft.save');
    assert.equal(saves.length, 2);
    assert.deepEqual(saves[0], saves[1], 'retry keeps the entire operation and exact A');
    assert.ok(lookups.some(view => view.name === 'operation' && view.args.operation_id === saves[0].operation_id));
    await f.session.save();
    assert.equal((await f.state()).draft.body, 'B typed during send');
    assert.equal((await f.api.view('topic_messages', { topic_id: 't1' })).items.length, 2);
  });
}

test('exhausted private retry exposes its block and a later Send resumes A without freezing B', async t => {
  const f = await fixture(t);
  let busy = true;
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    if (busy) return { instance_id: 'ux-fixture', operation_id: envelope.operation_id, kind: envelope.kind,
      recorded: false, status: 'retryable', error: { code: 'AUTHORITY_BUSY', retryable: true, message: 'Authority is busy.' } };
    return f.api.command(envelope);
  };
  f.editor.edit({ body: 'A kept pending' });
  const sending = f.session.send(); f.editor.edit({ body: 'B is separate' }); await sending;
  const a = f.editor.submissions[0];
  assert.match(a.blocked.message, /busy/);
  assert.equal(a.blocked.phase, 'draft.save');
  assert.ok(f.calls.length <= 2, 'no unbounded retry loop');
  busy = false;
  await f.session.send();
  assert.equal(f.editor.submissions.length, 1);
  assert.equal(a.status, 'confirmed');
  assert.equal(f.editor.draft.body, 'B is separate');
});

test('a current-epoch private retry journals the exact captured envelope pin even with incomplete continuity', async t => {
  const f = await fixture(t);
  await f.advance({ complete: false });
  let busy = true;
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    const entry = (await f.storage.own(f.editor.key)).snapshot.attempts.find(item => item.envelope.operation_id === envelope.operation_id);
    assert.deepEqual(entry.envelope, envelope, 'pin is journaled before the first dispatch');
    assert.deepEqual(envelope.expected.authority, f.pin());
    if (busy) { busy = false; return { instance_id: 'ux-fixture', operation_id: envelope.operation_id, kind: envelope.kind,
      status: 'retryable', recorded: false, error: { code: 'DATABASE_BUSY', retryable: true } }; }
    return f.api.command(envelope);
  };
  f.editor.edit({ body: 'New writing after recovery' }); await f.session.save();
  assert.equal(f.editor.dirty, false);
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[0], f.calls[1]);
});

test('authority changes after the journal are refused by the real Store before a record is written', async t => {
  const f = await fixture(t), captured = f.pin(), put = f.storage.backend.put;
  let moved = false;
  f.storage.backend.put = async row => {
    const result = await put(row);
    if (!moved && row.snapshot.attempts.length) { moved = true; await f.advance({ epoch: 'epoch-two' }); }
    return result;
  };
  f.editor.edit({ body: 'Preserve this writing across the boundary' }); await f.session.save();
  assert.equal(f.calls.length, 1, 'atomic authority comparison is in the Store, not a preflight');
  const entry = f.session.attempts[0];
  assert.deepEqual(entry.envelope.expected.authority, captured);
  assert.equal(entry.error.code, 'AUTHORITY_CHANGED');
  assert.equal((await f.api.view('operation', { operation_id: entry.envelope.operation_id })).status, 'unknown');
  assert.equal((await f.state()).draft, null);
  assert.equal(f.editor.dirty, true);
});

test('a never-dispatched recovered envelope without a pin cannot inherit metadata or the current binding', async t => {
  const f = await fixture(t);
  f.editor.edit({ body: 'Legacy unconfirmed writing' });
  const ticket = f.editor.saveTicket('legacy-save');
  f.session.attempt(f.session.saveEnvelope(ticket), { ticket });
  await f.session.persist();
  const saved = (await f.storage.own(f.editor.key)).snapshot;
  for (const attempt of saved.attempts) { delete attempt.envelope.expected.authority; attempt.authority = f.pin(); }
  const restored = restoreEditor(f.context, null, saved);
  const session = new EditorSession(restored, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage, snapshot: saved });
  await session.save();
  assert.equal(f.calls.length, 0);
  assert.equal(session.attempts[0].error.code, 'RECOVERY_RECONCILIATION_REQUIRED');
  assert.equal(restored.dirty, true);
});

test('unreachable bootstrap cannot block writing already bound to a valid current pair', async t => {
  const f = await fixture(t);
  let bootstraps = 0;
  f.transport.bootstrap = async () => { bootstraps++; throw Error('Background reads unavailable'); };
  f.editor.edit({ body: 'Known-pair writing does not need a preflight' }); await f.session.save();
  assert.equal(f.editor.dirty, false);
  assert.equal(bootstraps, 0);
  assert.equal((await f.state()).draft.body, f.editor.draft.body);
});

test('session construction requires complete valid bootstrap authority before any attempt exists', async t => {
  const f = await fixture(t);
  for (const authority of [undefined, null, {}, { authority_id: 'a', authority_epoch: '' },
    { authority_id: 'a', authority_epoch: 'e' }, { authority_id: 'a', authority_epoch: 'e', continuity: 'guessed' }]) {
    assert.throws(() => new EditorSession(f.editor, { api: f.transport, journal: f.storage, authority, runtime: f.runtime }), /authority/i);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(await f.storage.own(f.editor.key), undefined);
});

test('frozen A retains its authority when the session learns a new epoch before preparing', async t => {
  const f = await fixture(t), captured = f.pin(), gate = deferred();
  f.session.enqueue(() => gate.promise);
  f.editor.edit({ body: 'A captured in epoch one' });
  const sending = f.session.send(); f.editor.edit({ body: 'B is kept too' });
  await f.advance({ epoch: 'epoch-two' }); f.session.authority = copy(f.authority);
  gate.resolve(); await sending;
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.editor.submissions[0].authority, captured);
  assert.equal(f.editor.submissions[0].blocked.code, 'RECOVERY_RECONCILIATION_REQUIRED');
  assert.equal(f.editor.draft.body, 'B is kept too');
});

test('a busy private note retries its own operation without sending', async t => {
  const f = await fixture(t);
  const note = new Editor({ ...f.context, kind: 'note' }, { id: 'retry-note', revision: 0, body: '' });
  let busy = true;
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    if (busy) { busy = false; return { instance_id: 'ux-fixture', operation_id: envelope.operation_id, kind: envelope.kind,
      status: 'retryable', recorded: false, error: { code: 'DATABASE_BUSY', retryable: true } }; }
    return f.api.command(envelope);
  };
  note.edit({ body: 'Keep this private' });
  await new EditorSession(note, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage }).save();
  assert.equal(note.dirty, false);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0], f.calls[1]);
  assert.equal(f.calls[0].kind, 'note.save');
});

test('explicit continuation reconciles a busy preparation under its original operation', async t => {
  const f = await fixture(t);
  let busy = true;
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    if (busy && envelope.kind === 'submission.prepare') {
      busy = false; return { instance_id: 'ux-fixture', operation_id: envelope.operation_id, kind: envelope.kind,
        status: 'retryable', recorded: false, error: { code: 'DATABASE_BUSY', retryable: true, message: 'Preparation is busy.' } };
    }
    return f.api.command(envelope);
  };
  f.editor.edit({ body: 'A initially busy' });
  const sending = f.session.send(); f.editor.edit({ body: 'B stays separate' }); await sending;
  assert.equal(f.editor.submissions[0].blocked.phase, 'submission.prepare');
  await f.session.send();
  assert.equal(f.editor.submissions[0].status, 'confirmed');
  assert.equal(f.editor.draft.body, 'B stays separate');
  const prepares = f.calls.filter(item => item.kind === 'submission.prepare');
  assert.equal(prepares.length, 2); assert.deepEqual(prepares[0], prepares[1]);
});

test('authority change opens one review conflict and preserves later typing until an explicit new private save', async t => {
  const f = await fixture(t);
  let probes = 0;
  f.transport.bootstrap = async () => { probes++; return f.api.view('capabilities', {}); };
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'B before the conflict' }); await f.session.save();
  assert.equal(f.session.recovery?.phase, 'ready');
  assert.equal(probes, 1);
  const old = copy(f.session.attempts[0].envelope);
  assert.equal(f.session.recovery.remote, null, 'missing draft is a create case');
  f.editor.edit({ body: 'B with the later paragraph' }); await f.session.save();
  assert.equal(probes, 1, 'typing does not repeat the probe');
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  assert.equal((await f.state()).draft.body, 'B with the later paragraph');
  assert.equal(f.editor.dirty, false);
  assert.deepEqual(f.session.attempts[0].envelope, old);
  assert.equal(f.session.attempts[0].detached, true);
  assert.equal(f.calls.filter(call => call.operation_id === old.operation_id).length, 1);
  assert.notEqual(f.calls.at(-1).operation_id, old.operation_id);
  assert.deepEqual(f.calls.at(-1).expected.authority, f.pin());
  assert.equal(f.calls.at(-1).expected.draft_revision, 0);
});

test('failed authority probe is latched through more typing and only explicit Retry refreshes it', async t => {
  const f = await fixture(t);
  let probes = 0, unavailable = true;
  f.transport.bootstrap = async () => { probes++; if (unavailable) throw Error('Offline'); return f.api.view('capabilities', {}); };
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Keep through offline recovery' }); await f.session.save();
  assert.equal(f.session.recovery?.phase, 'error');
  f.editor.edit({ body: 'Keep these newer words too' }); await f.session.save(); await f.session.save();
  assert.equal(probes, 1); assert.equal(f.calls.length, 1);
  unavailable = false; await f.session.retryAuthority();
  assert.equal(f.session.recovery.phase, 'ready'); assert.equal(probes, 2);
  assert.equal(f.editor.draft.body, 'Keep these newer words too');
});

test('review binds the authority and remote version together when a second epoch arrives', async t => {
  const f = await fixture(t);
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Keep B across two changes' }); await f.session.save();
  const review = copy(f.session.recovery);
  await f.advance({ epoch: 'epoch-three' });
  await assert.rejects(f.session.resumePrivate(review, f.editor.localVersion), /review/i);
  assert.equal(f.calls.length, 1, 'a fresh pair cannot be combined with the older reviewed snapshot');
  assert.equal(f.session.recovery.authority.authority_epoch, 'epoch-three');
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  assert.equal((await f.state()).draft.body, 'Keep B across two changes');
  assert.equal(f.calls.at(-1).expected.authority.authority_epoch, 'epoch-three');
});

test('reply and private note share one authority probe but read their own state and missing note creates privately', async t => {
  const f = await fixture(t), started = deferred(), release = deferred();
  const note = new Editor({ ...f.context, kind: 'note' }, { id: 'missing-note', revision: 0, body: '' });
  const session = new EditorSession(note, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage });
  note.edit({ body: 'Previously saved private note' }); await session.save();
  let probes = 0, reads = 0;
  f.transport.bootstrap = async () => { probes++; started.resolve(); await release.promise; return f.api.view('capabilities', {}); };
  f.transport.view = async (name, args) => { if (name === 'editor_state') reads++; return f.api.view(name, args); };
  await f.advance({ epoch: 'epoch-two', drop_private: true });
  f.editor.edit({ body: 'Reply retained' }); note.edit({ body: 'Private words retained' });
  const saving = Promise.all([f.session.save(), session.save()]);
  await started.promise;
  // Both Store commands have completed before releasing the common bootstrap.
  await session.persist(); await f.session.persist();
  release.resolve(); await saving;
  assert.equal(probes, 1); assert.equal(reads, 2);
  assert.equal(f.session.recovery.phase, 'ready'); assert.equal(session.recovery.phase, 'ready');
  await session.resumePrivate(copy(session.recovery), note.localVersion);
  assert.equal((await f.state()).note.body, 'Private words retained');
  assert.equal(note.dirty, false); assert.equal(f.calls.at(-1).expected.note_revision, 0);
  assert.equal(f.calls.filter(call => ['message.send', 'submission.prepare'].includes(call.kind)).length, 0);
});

test('typing during async review validation invalidates the choice and journals the newer writing', async t => {
  const f = await fixture(t), started = deferred(), release = deferred();
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Reviewed words' }); await f.session.save();
  f.transport.view = async (name, args) => {
    const value = await f.api.view(name, args);
    if (name === 'editor_state') { started.resolve(); await release.promise; }
    return value;
  };
  const choosing = f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  await started.promise; f.editor.edit({ body: 'New words during validation' }); release.resolve();
  await assert.rejects(choosing, /review/i);
  assert.equal(f.calls.length, 1); assert.equal(f.editor.dirty, true);
  assert.equal((await f.storage.own(f.editor.key)).snapshot.draft.body, 'New words during validation');
});

test('typing after validation stays dirty while the chosen snapshot saves', async t => {
  const f = await fixture(t), started = deferred(), release = deferred();
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Chosen words' }); await f.session.save();
  const put = f.storage.backend.put; let held = false;
  f.storage.backend.put = async row => {
    if (!held && row.snapshot.authorityRecovery === null && row.snapshot.activeAuthority.authority_epoch === 'epoch-two') {
      held = true; started.resolve(); await release.promise;
    }
    return put(row);
  };
  const choosing = f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  await started.promise; f.editor.edit({ body: 'New words after validation' }); release.resolve(); await choosing;
  assert.equal((await f.state()).draft.body, 'Chosen words');
  assert.equal(f.editor.draft.body, 'New words after validation'); assert.equal(f.editor.dirty, true);
  await f.session.save(); assert.equal((await f.state()).draft.body, 'New words after validation');
});

test('remote writing changed after review requires renewed review without overwrite', async t => {
  const f = await fixture(t);
  f.editor.edit({ body: 'Earlier saved version' }); await f.session.save();
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Local retained version' }); await f.session.save();
  const review = copy(f.session.recovery), remote = review.remote;
  const changed = await f.api.command(f.command('draft.save', 'other-edit', { ...remote, topic_id: 't1', body: 'Other editor latest' },
    { draft_id: remote.id }, { draft_revision: remote.revision }));
  assert.equal(changed.status, 'committed');
  await assert.rejects(f.session.resumePrivate(review, f.editor.localVersion), /review/i);
  assert.equal((await f.state()).draft.body, 'Other editor latest');
  assert.equal(f.editor.draft.body, 'Local retained version'); assert.equal(f.editor.dirty, true);
  assert.equal(f.session.recovery.remote.body, 'Other editor latest');
});

for (const invalid of ['source_available', 'destination_available', 'source_ref', 'destination']) {
  test(`authority review blocks an invalid ${invalid} without losing writing`, async t => {
    const f = await fixture(t);
    // Deliberately invalid adapter response, not a claim about a Core endpoint.
    f.transport.view = async (name, args) => {
      const answer = await f.api.view(name, args);
      if (name === 'editor_state') answer[invalid] = invalid.endsWith('_available') ? false : { id: 'wrong', topic_id: 'wrong' };
      return answer;
    };
    await f.advance({ epoch: 'epoch-two', drop_private: true });
    f.editor.edit({ body: 'Keep local text' }); await f.session.save();
    assert.equal(f.session.recovery.phase, 'blocked');
    await assert.rejects(f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion), /review/i);
    assert.equal(f.editor.draft.body, 'Keep local text'); assert.equal(f.calls.length, 1);
  });
}

test('a further activation at chosen save opens one new conflict without an automatic save loop', async t => {
  const f = await fixture(t); let probes = 0, change = true;
  f.transport.bootstrap = async () => { probes++; return f.api.view('capabilities', {}); };
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Retained through another activation' }); await f.session.save();
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    if (change) { change = false; await f.advance({ epoch: 'epoch-three' }); }
    return f.api.command(envelope);
  };
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  assert.equal(f.session.recovery.phase, 'ready'); assert.equal(f.session.recovery.authority.authority_epoch, 'epoch-three');
  assert.equal(probes, 3); assert.equal(f.calls.length, 2); assert.equal((await f.state()).draft, null);
  f.editor.edit({ body: 'Still writing' }); await f.session.save();
  assert.equal(probes, 3); assert.equal(f.calls.length, 2); assert.equal(f.editor.dirty, true);
});

test('reloaded failed recovery stays latched until explicit retry', async t => {
  const f = await fixture(t); let probes = 0;
  f.transport.bootstrap = async () => { probes++; throw Error('Offline'); };
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Recover me' }); await f.session.save();
  const saved = (await f.storage.own(f.editor.key)).snapshot;
  const editor = restoreEditor(f.context, null, saved);
  const session = new EditorSession(editor, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage, snapshot: saved });
  editor.edit({ body: 'More after reload' }); await session.save();
  assert.equal(session.recovery.phase, 'error'); assert.equal(probes, 1); assert.equal(f.calls.length, 1);
  assert.equal((await f.storage.own(editor.key)).snapshot.draft.body, 'More after reload');
});

test('late old save receipt cannot acknowledge colliding new-epoch B or clear its conflict', async t => {
  const f = await fixture(t);
  f.editor.edit({ body: 'Base' }); await f.session.save();
  const base = (await f.state()).draft;
  f.editor.edit({ body: 'Old saved once' }); await f.session.save();
  f.editor.edit({ body: 'Old receipt held back' });
  const ticket = f.editor.saveTicket('old-delayed-save');
  const entry = f.session.attempt(f.session.saveEnvelope(ticket), { ticket, dispatched: true });
  const oldEnvelope = copy(entry.envelope);
  const receipt = await f.api.command(entry.envelope); assert.equal(receipt.status, 'committed');
  await f.advance({ epoch: 'epoch-two', restore_draft: base });
  entry.error = (await f.api.command(entry.envelope)).error;
  await f.session.authorityChanged(entry);
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  assert.equal(f.editor.draft.id, ticket.draft.id); assert.equal(f.editor.draft.generation, ticket.draft.generation);
  assert.equal(f.editor.draft.revision, 2); assert.equal(receipt.result.draft_revision, 3);
  f.editor.edit({ body: 'New B still dirty' });
  f.editor.conflict = { remote: copy(ticket.draft), attempted: copy(f.editor.draft) };
  const before = f.editor.snapshot(), calls = f.calls.length;
  assert.equal(await f.session.apply(entry, receipt), true);
  assert.deepEqual(f.editor.snapshot(), before); assert.equal(f.calls.length, calls);
  assert.deepEqual(entry.receipt, receipt); assert.deepEqual(entry.envelope, oldEnvelope);
});

test('late old preparation settles A without rebinding colliding new-epoch B or navigating', async t => {
  const f = await fixture(t); let navigation = 0;
  f.session.prepared = () => navigation++;
  f.editor.edit({ body: 'Old frozen A' }); await f.session.save();
  const base = (await f.state()).draft;
  const item = f.editor.beginPrepare({ prepareOperationId: 'late-prepare', sendOperationId: 'late-send', submissionId: 'late-A' });
  item.authority = f.pin();
  const envelope = f.session.envelope('submission.prepare', item.prepareOperationId, { topic_id: 't1' }, { draft_revision: base.revision },
    { draft_id: base.id, submission_id: item.id, send_operation_id: item.sendOperationId }, item.authority);
  const entry = f.session.attempt(envelope, { submissionId: item.id, dispatched: true });
  const receipt = await f.api.command(envelope); assert.equal(receipt.status, 'committed');
  await f.advance({ epoch: 'epoch-two', restore_draft: base });
  entry.error = (await f.api.command(envelope)).error;
  await f.session.authorityChanged(entry); f.editor.edit({ body: 'Chosen new B' });
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  assert.equal(f.editor.dirty, false, 'detached old preparing A must not absorb new B save');
  f.editor.edit({ body: 'Newer B remains dirty' });
  f.editor.conflict = { remote: { body: 'Unrelated current conflict' } };
  const before = { draft: copy(f.editor.draft), source: copy(f.editor.sourceRef), ack: f.editor.ackVersion, conflict: copy(f.editor.conflict) };
  const calls = f.calls.length;
  assert.equal(await f.session.apply(entry, receipt), true);
  assert.deepEqual({ draft: f.editor.draft, source: f.editor.sourceRef, ack: f.editor.ackVersion, conflict: f.editor.conflict }, before);
  assert.equal(item.status, 'prepared'); assert.equal(navigation, 0); assert.equal(f.calls.length, calls);
  assert.equal(f.editor.canNavigateAfterSend, false, 'historical preparation cannot authorize navigation');
  await f.session.sendPrepared(item); assert.equal(f.calls.length, calls, 'old prepared A remains lookup-only');
});

test('unchanged bootstrap after an authority refusal cannot authorize detaching into the same pair', async t => {
  const f = await fixture(t), oldAuthority = copy(f.authority);
  f.transport.bootstrap = async () => ({ instance_id: 'ux-fixture', authority: oldAuthority });
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Keep while adapter is stale' }); await f.session.save();
  assert.equal(f.session.recovery.phase, 'blocked');
  await assert.rejects(f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion), /review/i);
  assert.equal(f.session.attempts[0].detached, undefined); assert.equal(f.calls.length, 1);
});

test('deliberate re-prepare of old unknown publication requires disclosure and never replays its envelope', async t => {
  const f = await fixture(t);
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    if (envelope.kind === 'message.send') throw Error('No confirmation');
    return f.api.command(envelope);
  };
  f.editor.edit({ body: 'Exact old A' }); await f.session.send();
  const old = f.editor.submissions[0], original = copy(f.session.attempts.map(item => item.envelope));
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Current private B' }); await f.session.save();
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  const remote = (await f.state()).draft, count = f.calls.length;
  await f.session.reconcile(); assert.equal(old.receipt, null);
  await assert.rejects(f.session.correctPreparation(old, remote, f.editor.localVersion), error => error.message === PRIOR_PUBLICATION_NOTICE);
  assert.equal(f.calls.length, count);
  f.transport.command = envelope => { f.calls.push(copy(envelope)); return f.api.command(envelope); };
  const replacement = await f.session.correctPreparation(old, remote, f.editor.localVersion, { acknowledgePossiblePriorPublication: true });
  assert.equal(replacement.status, 'confirmed'); assert.notEqual(replacement.id, old.id);
  assert.equal((await f.api.view('source', { kind: 'message', id: replacement.receipt.result.message_id })).body, 'Exact old A');
  assert.equal(f.editor.draft.body, 'Current private B');
  assert.deepEqual(f.session.attempts.slice(0, original.length).map(item => item.envelope), original);
  assert.equal(f.calls.filter(call => call.operation_id === old.sendOperationId).length, 1);
});

test('re-prepare discovering another epoch cannot repin current B or publish', async t => {
  const f = await fixture(t);
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    if (envelope.kind === 'submission.prepare') {
      const draft = (await f.state()).draft;
      await f.api.command(f.command('draft.save', 'make-conflict', { ...draft, topic_id: 't1', body: 'Other words' },
        { draft_id: draft.id }, { draft_revision: draft.revision }));
    }
    return f.api.command(envelope);
  };
  f.editor.edit({ body: 'A' }); await f.session.send();
  const old = f.editor.submissions[0], authority = copy(f.session.authority), remote = (await f.state()).draft;
  await f.advance({ epoch: 'epoch-two' });
  const count = f.calls.length;
  await assert.rejects(f.session.correctPreparation(old, remote, f.editor.localVersion, { acknowledgePossiblePriorPublication: true }), /review/i);
  assert.deepEqual(f.session.authority, authority); assert.equal(f.calls.length, count);
  assert.equal(f.session.recovery.phase, 'ready');
});

test('missing saved draft creates a new slot without its obsolete revision', async t => {
  const f = await fixture(t);
  f.editor.edit({ body: 'Previously saved draft' }); await f.session.save();
  const original = copy(f.editor.draft);
  await f.advance({ epoch: 'epoch-two', drop_private: true });
  f.editor.edit({ body: 'Latest writing after missing draft' }); await f.session.save();
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  assert.equal(f.calls.at(-1).expected.draft_revision, 0);
  assert.notEqual(f.calls.at(-1).target.draft_id, original.id);
  assert.equal((await f.state()).draft.body, 'Latest writing after missing draft'); assert.equal(f.editor.dirty, false);
});

test('malformed late historical confirmation stays unconfirmed without altering current writing', async t => {
  const f = await fixture(t);
  f.editor.edit({ body: 'Old pending text' });
  const ticket = f.editor.saveTicket('unconfirmed-old');
  const entry = f.session.attempt(f.session.saveEnvelope(ticket), { ticket });
  const receipt = await f.api.command(entry.envelope);
  await f.advance({ epoch: 'epoch-two' });
  entry.error = (await f.api.command(entry.envelope)).error; await f.session.authorityChanged(entry);
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  const before = f.editor.snapshot();
  assert.equal(await f.session.apply(entry, { ...receipt, result: { ...receipt.result, generation: 'wrong' } }), false);
  assert.equal(entry.receipt, null); assert.equal(entry.error.code, 'RECEIPT_MISMATCH');
  assert.deepEqual(f.editor.snapshot(), before);
});

for (const stage of ['bootstrap', 'editor_state']) {
  test(`a stalled recovery ${stage} ends visibly and a late answer cannot replace a newer review`, async t => {
    const f = await fixture(t), release = deferred();
    f.runtime.readTimeoutMs = 20;
    await f.advance({ epoch: 'epoch-two' });
    const oldAnswer = stage === 'bootstrap' ? await f.api.view('capabilities', {}) : await f.state();
    let held = true;
    if (stage === 'bootstrap') f.transport.bootstrap = async () => held ? release.promise : f.api.view('capabilities', {});
    else f.transport.view = async (name, args) => name === 'editor_state' && held ? release.promise : f.api.view(name, args);
    f.editor.edit({ body: 'Kept through stalled recovery' });
    const saving = f.session.save();
    try {
      await Promise.race([saving, new Promise(resolve => setTimeout(resolve, 150))]);
      assert.equal(f.session.recovery.phase, 'error');
      assert.equal(f.session.recovery.error, 'RECOVERY_READ_TIMEOUT');
      await f.advance({ epoch: 'epoch-three' }); held = false;
      await f.session.retryAuthority();
      const latest = copy(f.session.recovery);
      release.resolve(oldAnswer); await saving; await Promise.resolve();
      assert.deepEqual(f.session.recovery, latest); assert.equal(latest.authority.authority_epoch, 'epoch-three');
      assert.equal(f.editor.draft.body, 'Kept through stalled recovery');
    } finally { release.resolve(oldAnswer); await saving; }
  });
}

// c13 review corrections: retain the public/private boundary through recovery.
for (const kind of ['message.send']) {
  test(`confirmed historical ${kind} cannot be prepared again`, async t => {
    const f = await fixture(t);
    const editor = f.editor, session = f.session;
    editor.edit({ body: 'Known published A' }); await session.send();
    const item = editor.submissions[0];
    assert.equal(item.status, 'confirmed'); assert.equal(item.receipt.kind, kind);
    await f.advance({ epoch: 'epoch-two', complete: true });
    editor.edit({ body: 'Private B' }); await session.save();
    await session.resumePrivate(copy(session.recovery), editor.localVersion);
    const remote = (await f.api.view('editor_state', { source_ref: editor.sourceRef, topic_id: editor.context.topicId })).draft;
    const before = editor.snapshot(), count = f.calls.length;
    await assert.rejects(session.correctPreparation(item, remote, editor.localVersion,
      { acknowledgePossiblePriorPublication: true }), /already.*(sent|published)|confirmed/i);
    assert.equal(f.calls.length, count); assert.deepEqual(editor.snapshot(), before);
  });
}

test('send confirmation arriving during correction validation prevents a new public act', async t => {
  const f = await fixture(t); let committed;
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope)); const receipt = await f.api.command(envelope);
    if (envelope.kind === 'message.send') { committed = receipt; throw Error('Lost send answer'); }
    return receipt;
  };
  f.editor.edit({ body: 'A sent once' }); await f.session.send();
  const item = f.editor.submissions[0], send = f.session.attempts.find(x => x.envelope.kind === 'message.send');
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Private B' }); await f.session.save();
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  const remote = (await f.state()).draft, before = copy(f.editor.draft), count = f.calls.length;
  let validationReads = 0;
  f.transport.view = async (name, args) => {
    // Keep this control at private validation: the already-committed receipt
    // arrives locally after an absent lookup snapshot, not a new E1 commit.
    if (name === 'operation') return { instance_id: f.context.instanceId, operation_id: args.operation_id, status: 'unknown', recorded: false };
    const value = await f.api.view(name, args);
    if (name === 'editor_state') { validationReads++; assert.equal(await f.session.apply(send, committed), true); }
    return value;
  };
  await assert.rejects(f.session.correctPreparation(item, remote, f.editor.localVersion,
    { acknowledgePossiblePriorPublication: true }), /already.*(sent|published)|confirmed/i);
  assert.equal(validationReads, 1, 'the original publication lookup must not mask this later validation guard');
  assert.equal(item.status, 'confirmed'); assert.deepEqual(item.receipt, committed);
  assert.deepEqual(f.editor.draft, before); assert.equal(f.calls.length, count);
});

for (const result of ['answer', 'failure', 'timeout']) {
  for (const phase of ['review', 'resumed', 'further-activation']) {
    test(`owned recovery ignores old ${result} after ${phase}`, async t => {
      const f = await fixture(t), started = deferred(), release = deferred();
      f.runtime.readTimeoutMs = result === 'timeout' ? 150 : 2000;
      let first = true, stale;
      f.transport.command = async envelope => {
        f.calls.push(copy(envelope));
        if (envelope.kind === 'message.send') await f.advance({ epoch: 'epoch-two' });
        return f.api.command(envelope);
      };
      f.transport.view = async (name, args) => {
        const value = await f.api.view(name, args);
        if (name === 'editor_state' && first) {
          first = false; stale = value; started.resolve(); return release.promise;
        }
        return value;
      };
      f.editor.edit({ body: 'Frozen old A' });
      const sending = f.session.send(); const finished = sending.then(() => null, error => error);
      await started.promise;
      try {
        const failedPair = copy(f.session.recovery.failedPair);
        f.editor.edit({ body: 'Private newer B' });
        const remote = stale.draft;
        assert.equal((await f.api.command(f.command('draft.save', 'new-remote-for-review',
          { ...remote, topic_id: 't1', body: 'New remote after old read' },
          { draft_id: remote.id }, { draft_revision: remote.revision }))).status, 'committed');
        // Exercise the ownership seam independently of the loading-Retry guard.
        await f.session.refreshRecovery(failedPair, true);
        if (phase !== 'review') await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
        if (phase === 'further-activation') {
          await f.advance({ epoch: 'epoch-three' }); f.editor.edit({ body: 'Still newer B' }); await f.session.save();
        }
        const before = copy(f.session.recovery), writing = f.editor.snapshot(), count = f.calls.length;
        const stamp = (await f.storage.own(f.editor.key)).stamp;
        if (result === 'answer') release.resolve(stale);
        if (result === 'failure') release.reject(Error('Old read failed'));
        assert.equal(await finished, null, 'old public-send completion must not throw through cleared recovery');
        assert.deepEqual(f.session.recovery, before);
        assert.deepEqual((await f.storage.own(f.editor.key)).snapshot.authorityRecovery, before);
        assert.equal((await f.storage.own(f.editor.key)).stamp, stamp, 'obsolete refresh must not journal another completion');
        assert.deepEqual(f.editor.snapshot(), writing); assert.equal(f.calls.length, count);
      } finally { release.resolve(stale); await finished; }
    });
  }
}

for (const boundary of ['initial-journal', 'bootstrap', 'terminal-journal']) {
  test(`owned recovery stops after supersession at ${boundary}`, async t => {
    const f = await fixture(t), started = deferred(), release = deferred();
    const failedPair = copy(f.session.authority);
    await f.advance({ epoch: 'epoch-two' });
    let probes = 0, probeCalls = 0, reads = 0, held = false;
    const probe = f.runtime.probe.bind(f.runtime);
    f.runtime.probe = (...args) => { probeCalls++; return probe(...args); };
    const put = f.storage.backend.put;
    f.storage.backend.put = async row => {
      const phase = row.snapshot.authorityRecovery?.phase;
      if (!held && ((boundary === 'initial-journal' && phase === 'loading') || (boundary === 'terminal-journal' && phase === 'ready'))) {
        held = true; started.resolve(); await release.promise;
      }
      return put(row);
    };
    f.transport.bootstrap = async () => {
      probes++;
      if (boundary === 'bootstrap' && !held) { held = true; started.resolve(); await release.promise; }
      return f.api.view('capabilities', {});
    };
    f.transport.view = (name, args) => { if (name === 'editor_state') reads++; return f.api.view(name, args); };
    const first = f.session.refreshRecovery(failedPair); await started.promise;
    const second = f.session.refreshRecovery(failedPair);
    release.resolve();
    const [obsolete, current] = await Promise.all([first, second]);
    assert.equal(obsolete, null, 'a superseded refresh cannot return an authorizing review');
    assert.equal(current, f.session.recovery); assert.equal(probes, 1);
    assert.equal(probeCalls, boundary === 'initial-journal' ? 1 : 2);
    assert.equal(reads, boundary === 'terminal-journal' ? 2 : 1);
    assert.deepEqual((await f.storage.own(f.editor.key)).snapshot.authorityRecovery, current);
  });
}

test('loading Retry refuses immediately even while the editor queue is occupied', async t => {
  const f = await fixture(t), started = deferred(), releaseRead = deferred(), releaseQueue = deferred();
  await f.advance({ epoch: 'epoch-two' }); let reads = 0;
  f.transport.view = async (name, args) => {
    if (name === 'editor_state') { reads++; started.resolve(); await releaseRead.promise; }
    return f.api.view(name, args);
  };
  const reading = f.session.refreshRecovery(f.pin()); await started.promise;
  const review = f.session.recovery;
  const busy = f.session.enqueue(() => releaseQueue.promise);
  let outcome = 'pending';
  const retry = Promise.resolve().then(() => f.session.retryAuthority()).then(() => { outcome = 'accepted'; }, () => { outcome = 'refused'; });
  await new Promise(resolve => setImmediate(resolve));
  const immediate = outcome;
  releaseRead.resolve(); releaseQueue.resolve(); await Promise.all([reading, busy, retry]);
  assert.equal(immediate, 'refused'); assert.equal(reads, 1); assert.equal(f.session.recovery, review);
});

test('queued Retry refuses if another recovery starts before it executes', async t => {
  const f = await fixture(t), releaseQueue = deferred(), releaseRead = deferred(), started = deferred();
  await f.advance({ epoch: 'epoch-two' }); await f.session.refreshRecovery(f.pin());
  const busy = f.session.enqueue(() => releaseQueue.promise);
  const retry = f.session.retryAuthority().then(() => 'accepted', () => 'refused');
  let reads = 0;
  f.transport.view = async (name, args) => {
    if (name === 'editor_state') { reads++; started.resolve(); await releaseRead.promise; }
    return f.api.view(name, args);
  };
  const reading = f.session.refreshRecovery(f.pin(), true); await started.promise;
  const review = f.session.recovery;
  releaseQueue.resolve(); await busy;
  // Let the queued action run while the read remains in flight.
  await new Promise(resolve => setImmediate(resolve)); releaseRead.resolve();
  assert.equal(await retry, 'refused'); await reading;
  assert.equal(reads, 1); assert.equal(f.session.recovery, review);
});

test('private choice refuses a review superseded during its terminal journal await', async t => {
  const f = await fixture(t), started = deferred(), release = deferred();
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Chosen private words' }); await f.session.save();
  const put = f.storage.backend.put; let held = false;
  f.storage.backend.put = async row => {
    if (!held && row.snapshot.authorityRecovery?.phase === 'ready') {
      held = true; started.resolve(); await release.promise;
    }
    return put(row);
  };
  const failedPair = copy(f.session.recovery.failedPair), count = f.calls.length;
  const choosing = f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  const checked = assert.rejects(choosing, /review/i);
  await started.promise;
  const replacement = f.session.refreshRecovery(failedPair, true);
  release.resolve(); await checked; await replacement;
  assert.equal(f.session.recovery.phase, 'ready'); assert.equal(f.calls.length, count);
  assert.equal(f.editor.draft.body, 'Chosen private words'); assert.equal(f.editor.dirty, true);
});

test('interrupted loading restores as an error through two reloads until deliberate Retry', async t => {
  const f = await fixture(t), started = deferred(), release = deferred();
  f.transport.bootstrap = async () => { started.resolve(); await release.promise; throw Error('Original page closed'); };
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Writing at interrupted read' }); const saving = f.session.save(); await started.promise;
  const saved = (await f.storage.own(f.editor.key)).snapshot;
  assert.equal(saved.authorityRecovery.phase, 'loading'); release.resolve(); await saving;
  let probes = 0, writes = 0;
  const api = { ...f.transport, bootstrap: async () => { probes++; return f.api.view('capabilities', {}); },
    command: envelope => { writes++; return f.api.command(envelope); } };
  const fresh = snapshot => {
    const runtime = new RuntimeAuthority({ api, instanceId: f.context.instanceId, authority: f.authority });
    const editor = restoreEditor(f.context, null, snapshot);
    return new EditorSession(editor, { api, runtime, authority: f.authority, journal: f.storage, snapshot });
  };
  let session = fresh(saved);
  for (let reload = 0; reload < 2; reload++) {
    assert.equal(session.recovery.phase, 'error'); assert.equal(session.recovery.error, 'RECOVERY_READ_INTERRUPTED');
    assert.equal(session.recovery.message, 'The recovery read was interrupted. Your writing is kept. Retry when ready.');
    session.editor.edit({ body: `Writing after reload ${reload}` }); await session.save();
    assert.throws(() => session.send(), /review/i); assert.equal(probes, 0); assert.equal(writes, 0);
    const row = (await f.storage.own(session.editor.key)).snapshot;
    assert.equal(row.draft.body, `Writing after reload ${reload}`);
    session = fresh(row);
  }
  await session.retryAuthority(); assert.equal(session.recovery.phase, 'ready'); assert.equal(probes, 1);
  await session.resumePrivate(copy(session.recovery), session.editor.localVersion);
  assert.equal((await f.state()).draft.body, 'Writing after reload 1'); assert.equal(writes, 1);
});

for (const topicId of ['t1', undefined, 'inaccessible-topic']) {
  test(`private note recovers independently of destination ${topicId ?? 'none'}`, async t => {
    const f = await fixture(t);
    const note = new Editor({ ...f.context, kind: 'note', topicId }, { id: 'independent-note', revision: 0, body: '' });
    const session = new EditorSession(note, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage });
    note.edit({ body: 'Earlier note' }); await session.save();
    await f.advance({ epoch: 'epoch-two' }); note.edit({ body: 'Retained private words' }); await session.save();
    assert.equal(session.recovery.phase, 'ready');
    await session.resumePrivate(copy(session.recovery), note.localVersion);
    assert.equal((await f.state()).note.body, 'Retained private words'); assert.equal(note.dirty, false);
    assert.ok(f.calls.every(call => call.kind === 'note.save'));
  });
}

// Adapted from Fable's independently reproduced review probes.
// P1: a second editor's later AUTHORITY_CHANGED reuses the session's one probe.
test('review gap 1 sequential editors share one bootstrap', async t => {
  const f = await fixture(t);
  const note = new Editor({ ...f.context, kind: 'note' }, { id: 'p1-note', revision: 0, body: '' });
  const session = new EditorSession(note, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage });
  let probes = 0;
  f.transport.bootstrap = async () => { probes++; return f.api.view('capabilities', {}); };
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'reply first' }); await f.session.save();
  assert.equal(f.session.recovery.phase, 'ready');
  note.edit({ body: 'note later' }); await session.save();
  assert.equal(session.recovery.phase, 'ready');
  assert.equal(probes, 1, 'one bootstrap per session across open editors');
  note.edit({ body: 'Note typed again' }); await session.save();
  f.editor.edit({ body: 'Reply typed again' }); await f.session.save();
  assert.equal(probes, 1, 'typing keeps both reviews latched');
  await session.retryAuthority(); assert.equal(probes, 2);
});

// P1b: a failed probe stays latched for a second editor too.
test('review gap 1b failed probe latches across editors', async t => {
  const f = await fixture(t);
  const note = new Editor({ ...f.context, kind: 'note' }, { id: 'p1b-note', revision: 0, body: '' });
  const session = new EditorSession(note, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage });
  let probes = 0, offline = true;
  f.transport.bootstrap = async () => { probes++; if (offline) throw Error('Offline'); return f.api.view('capabilities', {}); };
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'reply first' }); await f.session.save();
  note.edit({ body: 'note later' }); await session.save();
  assert.equal(session.recovery.phase, 'error');
  assert.equal(probes, 1);
  note.edit({ body: 'Later private words' }); await session.save(); assert.equal(probes, 1);
  offline = false; await session.retryAuthority(); assert.equal(probes, 2); assert.equal(session.recovery.phase, 'ready');
});

// P2: validPrivateState's own checks on instance and remote provenance.
for (const bad of ['instance_id', 'outer_source_ref', 'remote_source_ref', 'remote_revision', 'zero_revision']) {
  test(`review gap 2 review blocks an invalid ${bad}`, async t => {
    const f = await fixture(t);
    f.editor.edit({ body: 'saved earlier' }); await f.session.save();
    f.transport.view = async (name, args) => {
      const answer = await f.api.view(name, args);
      if (name === 'editor_state') {
        if (bad === 'instance_id') answer.instance_id = 'another-instance';
        if (bad === 'outer_source_ref') answer.source_ref = { kind: 'message', id: 'other-source' };
        if (bad === 'remote_source_ref') answer.draft.source_ref = { kind: 'message', id: 'other-source' };
        if (bad === 'remote_revision') answer.draft.revision = '2';
        if (bad === 'zero_revision') answer.draft.revision = 0;
      }
      return answer;
    };
    await f.advance({ epoch: 'epoch-two' });
    f.editor.edit({ body: 'Keep local text' }); await f.session.save();
    assert.equal(f.session.recovery.phase, 'blocked');
  });
}

// P3: Retry from a blocked review refreshes the remote snapshot, not only the pair.
test('review gap 3 Retry after a stale-bootstrap block refreshes the remote snapshot too', async t => {
  const f = await fixture(t), oldAuthority = copy(f.authority);
  f.editor.edit({ body: 'Remote X' }); await f.session.save();
  let stale = true;
  f.transport.bootstrap = async () => stale ? { instance_id: 'ux-fixture', authority: oldAuthority } : f.api.view('capabilities', {});
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'local' }); await f.session.save();
  assert.equal(f.session.recovery.phase, 'blocked');
  assert.equal(f.session.recovery.remote.body, 'Remote X');
  const remote = (await f.state()).draft;
  const changed = await f.api.command(f.command('draft.save', 'p3-other', { ...remote, topic_id: 't1', body: 'Remote Y' },
    { draft_id: remote.id }, { draft_revision: remote.revision }));
  assert.equal(changed.status, 'committed');
  stale = false; await f.session.retryAuthority();
  assert.equal(f.session.recovery.phase, 'ready');
  assert.equal(f.session.recovery.remote.body, 'Remote Y', 'Retry shows the fresh pair with its fresh snapshot');
});

// P4: a late recorded REFUSAL of an old-epoch save settles only history.
test('review gap 4 late rejected old save settles history without touching B', async t => {
  const f = await fixture(t);
  f.editor.edit({ body: 'Base' }); await f.session.save();
  const base = (await f.state()).draft;
  f.editor.edit({ body: 'Second' }); await f.session.save();
  f.editor.edit({ body: 'Stale save' });
  const ticket = f.editor.saveTicket('old-rejected-save'); ticket.draft.revision = base.revision;
  const entry = f.session.attempt(f.session.saveEnvelope(ticket), { ticket, dispatched: true });
  const receipt = await f.api.command(entry.envelope);
  assert.equal(receipt.status, 'rejected'); assert.equal(receipt.recorded, true);
  await f.advance({ epoch: 'epoch-two', restore_draft: base });
  entry.error = (await f.api.command(entry.envelope)).error;
  await f.session.authorityChanged(entry);
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  f.editor.edit({ body: 'New B' }); await f.session.save(); f.editor.edit({ body: 'New B dirty' });
  const before = f.editor.snapshot();
  assert.equal(await f.session.apply(entry, receipt), true, 'a recorded historical refusal settles its attempt');
  assert.deepEqual(entry.receipt, receipt);
  assert.deepEqual(f.editor.snapshot(), before, 'B gains no conflict from an old refusal');
  f.editor.edit({ body: 'B saves on' }); await f.session.save();
  assert.equal((await f.state()).draft.body, 'B saves on');
});

// P5: a late recorded REFUSAL of an old-epoch preparation cannot rebind B.
test('review gap 5 late rejected old preparation leaves colliding B binding alone', async t => {
  const f = await fixture(t);
  f.editor.edit({ body: 'Base' }); await f.session.save();
  const base = (await f.state()).draft;
  f.editor.edit({ body: 'Second' }); await f.session.save();
  const item = f.editor.beginPrepare({ prepareOperationId: 'p5-prepare', sendOperationId: 'p5-send', submissionId: 'p5-A' });
  item.authority = f.pin();
  const envelope = f.session.envelope('submission.prepare', item.prepareOperationId, { topic_id: 't1' }, { draft_revision: base.revision },
    { draft_id: item.snapshot.id, submission_id: item.id, send_operation_id: item.sendOperationId }, item.authority);
  const entry = f.session.attempt(envelope, { submissionId: item.id, dispatched: true });
  const receipt = await f.api.command(envelope);
  assert.equal(receipt.status, 'rejected'); assert.equal(receipt.recorded, true);
  await f.advance({ epoch: 'epoch-two', restore_draft: base });
  entry.error = (await f.api.command(envelope)).error;
  await f.session.authorityChanged(entry); f.editor.edit({ body: 'Chosen B' });
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  f.editor.edit({ body: 'B again' }); await f.session.save();
  f.editor.edit({ body: 'B dirty' });
  f.editor.conflict = { remote: { body: 'Current conflict' } };
  const live = () => copy({ draft: f.editor.draft, ack: f.editor.ackVersion, conflict: f.editor.conflict, dirty: f.editor.dirty });
  const before = live();
  assert.notEqual(before.draft.revision, item.snapshot.revision, 'B and A differ in revision so a rebind is visible');
  assert.equal(await f.session.apply(entry, receipt), true);
  assert.equal(item.status, 'refused');
  assert.deepEqual(item.receipt, receipt); assert.deepEqual(entry.receipt, receipt);
  assert.deepEqual(live(), before);
});

// P6: lookup of an old-epoch send whose reply was lost settles its historical A.
test('review gap 6 late old send receipt settles historical A only', async t => {
  const f = await fixture(t);
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    const receipt = await f.api.command(envelope);
    if (envelope.kind === 'message.send') throw Error('reply lost after commit');
    return receipt;
  };
  f.editor.edit({ body: 'A sent once' }); await f.session.send();
  const old = f.editor.submissions[0];
  assert.equal(old.status, 'prepared');
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'B' }); await f.session.save();
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  f.editor.edit({ body: 'Newer B dirty' }); f.editor.conflict = { remote: { body: 'Current remote' } };
  const live = () => copy({ draft: f.editor.draft, ack: f.editor.ackVersion, conflict: f.editor.conflict, dirty: f.editor.dirty });
  const before = live(), count = f.calls.length;
  let navigation = 0; f.session.prepared = () => navigation++;
  await f.session.reconcile();
  assert.equal(old.status, 'confirmed', 'the retained receipt settles historical A');
  assert.equal(old.receipt.status, 'committed'); assert.equal(old.receipt.operation_id, old.sendOperationId);
  assert.deepEqual(live(), before); assert.equal(navigation, 0); assert.equal(f.editor.canNavigateAfterSend, false);
  assert.equal(f.calls.length, count);
});

test('review gap 7 prior-publication notice names the possible earlier send and the new public act', () => {
  assert.match(PRIOR_PUBLICATION_NOTICE, /may already have been sent/);
  assert.match(PRIOR_PUBLICATION_NOTICE, /new public act/);
});

for (const bad of ['instance', 'source', 'unavailable', 'revision']) {
  test(`note recovery still blocks invalid ${bad} independently of destination`, async t => {
    const f = await fixture(t);
    const note = new Editor({ ...f.context, kind: 'note', topicId: 'inaccessible-topic' }, { id: 'private-note', revision: 0 });
    const session = new EditorSession(note, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage });
    note.edit({ body: 'Original private note' }); await session.save();
    f.transport.view = async (name, args) => {
      const state = await f.api.view(name, args);
      if (name === 'editor_state') {
        assert.ok(state.note);
        if (bad === 'instance') state.instance_id = 'wrong-instance';
        if (bad === 'source') state.note.source_ref = { kind: 'message', id: 'wrong-source' };
        if (bad === 'unavailable') state.source_available = false;
        if (bad === 'revision') state.note.revision = 0;
      }
      return state;
    };
    await f.advance({ epoch: 'epoch-two' }); note.edit({ body: 'Latest private note' }); await session.save();
    assert.equal(session.recovery.phase, 'blocked'); const count = f.calls.length;
    await assert.rejects(session.resumePrivate(copy(session.recovery), note.localVersion), /review/i);
    assert.equal(f.calls.length, count); assert.equal(note.draft.body, 'Latest private note');
  });
}

test('missing private note with no topic can be created only after explicit recovery', async t => {
  const f = await fixture(t);
  const note = new Editor({ ...f.context, kind: 'note', topicId: undefined }, { id: 'missing-private-note', revision: 0 });
  const session = new EditorSession(note, { authority: f.authority, runtime: f.runtime, api: f.transport, journal: f.storage });
  note.edit({ body: 'Retained note' }); await f.advance({ epoch: 'epoch-two' }); await session.save();
  assert.equal(session.recovery.phase, 'ready'); assert.equal(session.recovery.remote, null);
  assert.equal((await f.state()).note, null);
  await session.resumePrivate(copy(session.recovery), note.localVersion);
  assert.equal((await f.state()).note.body, 'Retained note'); assert.ok(f.calls.every(call => call.kind === 'note.save'));
});

async function retainedPublication(t, { kind = 'message.send', outcome = 'committed' } = {}) {
  const f = await fixture(t);
  const quoteSource = copy(f.context.sourceRef);
  let originalReceipt;
  f.transport.command = async envelope => {
    f.calls.push(copy(envelope));
    if (envelope.kind === kind && outcome === 'absent') throw Error('Original send never arrived');
    const receipt = await f.api.command(envelope);
    if (envelope.kind === kind) { originalReceipt = receipt; throw Error('Original send answer lost'); }
    return receipt;
  };
  f.editor.edit({ body: 'A sent once', ...(outcome === 'rejected'
    ? { quotes: [{ source: quoteSource, excerpt: 'These words do not occur in the source' }] } : {}) });
  await f.session.send();
  const item = f.editor.submissions[0]; assert.equal(item.status, 'prepared'); assert.equal(item.receipt, null);
  if (outcome !== 'absent') assert.equal(originalReceipt.status, outcome);
  await f.advance({ epoch: 'epoch-two' });
  f.editor.edit({ body: 'Private B retained' }); await f.session.save();
  await f.session.resumePrivate(copy(f.session.recovery), f.editor.localVersion);
  f.transport.command = envelope => { f.calls.push(copy(envelope)); return f.api.command(envelope); };
  const remote = (await f.state()).draft;
  return { ...f, item, originalReceipt, remote };
}

const liveWriting = f => copy({ draft: f.editor.draft, sourceRef: f.editor.sourceRef, localVersion: f.editor.localVersion,
  ackVersion: f.editor.ackVersion, conflict: f.editor.conflict, authority: f.session.authority });

for (const kind of ['message.send']) {
  for (const acknowledge of [false, true]) {
    test(`original publication lookup prevents duplicate ${kind} with acknowledgement ${acknowledge}`, async t => {
      const f = await retainedPublication(t, { kind });
      f.editor.edit({ body: 'Newer private B', caret: { start: 4, end: 4 } });
      f.editor.conflict = { remote: { body: 'Separate current private conflict' } };
      const before = liveWriting(f), count = f.calls.length, submissions = f.editor.submissions.length;
      let reads = 0, ids = 0, navigation = 0;
      f.session.prepared = () => navigation++;
      const id = f.session.id; f.session.id = () => { ids++; return id(); };
      f.transport.view = (name, args) => {
        if (name === 'operation' && args.operation_id === f.item.sendOperationId) reads++;
        return f.api.view(name, args);
      };
      await assert.rejects(f.session.correctPreparation(f.item, f.remote, f.editor.localVersion,
        { acknowledgePossiblePriorPublication: acknowledge }), /already.*(sent|published)|confirmed/i);
      assert.equal(reads, 1); assert.equal(f.item.status, 'confirmed'); assert.deepEqual(f.item.receipt, f.originalReceipt);
      assert.deepEqual(liveWriting(f), before); assert.equal(f.calls.length, count);
      assert.equal(f.editor.submissions.length, submissions); assert.equal(ids, 0); assert.equal(navigation, 0);
      const entry = f.session.attempts.find(entry => entry.envelope.operation_id === f.item.sendOperationId);
      assert.deepEqual(entry.receipt, f.originalReceipt);
      const row = (await f.storage.own(f.editor.key)).snapshot;
      assert.deepEqual(row.submissions.find(item => item.id === f.item.id).receipt, f.originalReceipt);
      assert.deepEqual(row.draft, before.draft);
      const page = await f.api.view('topic_messages', { topic_id: f.context.topicId, limit: 50 });
      assert.equal(page.items.filter(message => message.body === 'A sent once').length, 1);
    });
  }
}

test('original publication lookup settles recorded rejection without an unknown-history warning', async t => {
  const f = await retainedPublication(t, { outcome: 'rejected' });
  let reads = 0;
  f.transport.view = (name, args) => {
    if (name === 'operation' && args.operation_id === f.item.sendOperationId) reads++;
    return f.api.view(name, args);
  };
  const before = copy(f.editor.draft), original = copy(f.item.snapshot);
  const replacement = await f.session.correctPreparation(f.item, f.remote, f.editor.localVersion);
  assert.equal(reads, 1); assert.equal(f.item.status, 'refused'); assert.deepEqual(f.item.receipt, f.originalReceipt);
  assert.equal(replacement.status, 'refused', 'the same invalid quote is preserved, not silently repaired or dropped');
  assert.equal(replacement.receipt.error.code, 'INVALID_QUOTE'); assert.notEqual(replacement.sendOperationId, f.item.sendOperationId);
  assert.deepEqual(replacement.snapshot.quotes, original.quotes); assert.equal(f.editor.draft.body, before.body);
  const page = await f.api.view('topic_messages', { topic_id: f.context.topicId, limit: 50 });
  assert.equal(page.items.filter(message => message.body === 'A sent once').length, 0);
});

test('original publication lookup retains the explicit warning for a truly absent send', async t => {
  const f = await retainedPublication(t, { outcome: 'absent' });
  const before = liveWriting(f), count = f.calls.length; let reads = 0;
  f.transport.view = (name, args) => {
    if (name === 'operation' && args.operation_id === f.item.sendOperationId) reads++;
    return f.api.view(name, args);
  };
  await assert.rejects(f.session.correctPreparation(f.item, f.remote, f.editor.localVersion), error => error.message === PRIOR_PUBLICATION_NOTICE);
  assert.equal(reads, 1); assert.equal(f.item.receipt, null); assert.equal(f.calls.length, count); assert.deepEqual(liveWriting(f), before);
  const replacement = await f.session.correctPreparation(f.item, f.remote, f.editor.localVersion, { acknowledgePossiblePriorPublication: true });
  assert.equal(reads, 2); assert.equal(replacement.status, 'confirmed'); assert.equal(f.item.receipt, null);
  assert.equal(f.editor.draft.body, before.draft.body); assert.notEqual(replacement.sendOperationId, f.item.sendOperationId);
  const page = await f.api.view('topic_messages', { topic_id: f.context.topicId, limit: 50 });
  assert.equal(page.items.filter(message => message.body === 'A sent once').length, 1);
});

const invalidPublicationAnswers = {
  'wrong instance': answer => ({ ...answer, instance_id: 'other-instance' }),
  'wrong operation': answer => ({ ...answer, operation_id: 'other-operation' }),
  'unknown marked recorded': answer => ({ ...answer, recorded: true }),
  'unknown carrying error': answer => ({ ...answer, error: { code: 'FORBIDDEN' } }),
  'unknown carrying result': answer => ({ ...answer, result: { submission_id: 'invented' } }),
  'missing recorded flag': answer => { const value = { ...answer }; delete value.recorded; return value; },
  'unrecorded rejection': answer => ({ ...answer, status: 'rejected', error: { code: 'AUTHORITY_CHANGED' } }),
  'unknown status': answer => ({ ...answer, status: 'maybe' }),
  'missing answer': () => null,
};
for (const [name, corrupt] of Object.entries(invalidPublicationAnswers)) {
  test(`original publication lookup refuses ${name}`, async t => {
    const f = await retainedPublication(t, { outcome: 'absent' });
    let reads = 0;
    f.transport.view = async (view, args) => {
      const answer = await f.api.view(view, args);
      if (view === 'operation' && args.operation_id === f.item.sendOperationId) { reads++; return corrupt(answer); }
      return answer;
    };
    const before = liveWriting(f), count = f.calls.length;
    await assert.rejects(f.session.correctPreparation(f.item, f.remote, f.editor.localVersion,
      { acknowledgePossiblePriorPublication: true }), /original.*(confirmation|publication)|reconcil/i);
    assert.equal(reads, 1); assert.equal(f.calls.length, count); assert.deepEqual(liveWriting(f), before);
    assert.equal(f.item.receipt, null); assert.equal(f.item.correctedBy, undefined);
  });
}

for (const name of ['wrong instance', 'wrong operation', 'wrong kind', 'wrong submission', 'unrecorded commit', 'invalid status', 'committed with error', 'rejection without error']) {
  test(`original publication lookup refuses recorded ${name}`, async t => {
    const f = await retainedPublication(t);
    f.transport.view = async (view, args) => {
      const answer = await f.api.view(view, args);
      if (view === 'operation' && args.operation_id === f.item.sendOperationId) {
        if (name === 'wrong instance') answer.instance_id = 'wrong-instance';
        if (name === 'wrong operation') answer.operation_id = 'wrong-operation';
        if (name === 'unrecorded commit') answer.recorded = false;
        if (name === 'invalid status') answer.status = 'invalid';
        if (name === 'wrong kind') answer.kind = 'topic.create_and_send';
        if (name === 'wrong submission') answer.result.submission_id = 'wrong-submission';
        if (name === 'committed with error') answer.error = { code: 'UNKNOWN' };
        if (name === 'rejection without error') { answer.status = 'rejected'; answer.result = null; delete answer.error; }
      }
      return answer;
    };
    const before = liveWriting(f), count = f.calls.length;
    await assert.rejects(f.session.correctPreparation(f.item, f.remote, f.editor.localVersion,
      { acknowledgePossiblePriorPublication: true }), /original.*(confirmation|publication)|reconcil/i);
    assert.equal(f.calls.length, count); assert.deepEqual(liveWriting(f), before); assert.equal(f.item.receipt, null);
  });
}

for (const failure of ['throw', 'timeout']) {
  test(`original publication lookup ${failure} refuses without creating another act`, async t => {
    const f = await retainedPublication(t), late = deferred();
    f.runtime.readTimeoutMs = 30;
    f.transport.view = async (name, args) => {
      if (name === 'operation' && args.operation_id === f.item.sendOperationId) {
        if (failure === 'throw') throw Error('Connection lost');
        return late.promise;
      }
      return f.api.view(name, args);
    };
    const before = liveWriting(f), count = f.calls.length;
    await assert.rejects(f.session.correctPreparation(f.item, f.remote, f.editor.localVersion,
      { acknowledgePossiblePriorPublication: true }), /original.*(confirmation|publication)|reconcil/i);
    late.resolve(f.originalReceipt); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, count); assert.deepEqual(liveWriting(f), before);
    assert.equal(f.item.correctedBy, undefined); assert.equal(f.item.receipt, null);
  });
}

for (const missing of ['attempt', 'preparation']) {
  test(`original publication lookup refuses an unacceptably retained ${missing}`, async t => {
    const f = await retainedPublication(t);
    if (missing === 'attempt') f.session.attempts = f.session.attempts.filter(entry => entry.envelope.operation_id !== f.item.sendOperationId);
    else f.item.preparationConfirmed = false;
    const before = liveWriting(f), count = f.calls.length;
    await assert.rejects(f.session.correctPreparation(f.item, f.remote, f.editor.localVersion,
      { acknowledgePossiblePriorPublication: true }), /original.*(confirmation|publication)|reconcil/i);
    assert.equal(f.calls.length, count); assert.deepEqual(liveWriting(f), before);
    assert.equal(f.item.correctedBy, undefined); assert.equal(f.item.receipt, null);
  });
}

test('original publication lookup rechecks a locally arrived confirmation before its warning', async t => {
  const f = await retainedPublication(t);
  const send = f.session.attempts.find(entry => entry.envelope.operation_id === f.item.sendOperationId);
  f.transport.view = async (name, args) => {
    if (name === 'operation') {
      assert.equal(await f.session.apply(send, f.originalReceipt), true);
      return { instance_id: f.context.instanceId, operation_id: args.operation_id, status: 'unknown', recorded: false };
    }
    return f.api.view(name, args);
  };
  const before = liveWriting(f), count = f.calls.length;
  await assert.rejects(f.session.correctPreparation(f.item, f.remote, f.editor.localVersion),
    /^Error: This reply is already confirmed as published/);
  assert.equal(f.item.status, 'confirmed'); assert.equal(f.calls.length, count); assert.deepEqual(liveWriting(f), before);
  assert.equal(f.item.correctedBy, undefined);
});

test('a reply editor refuses a new-topic source; new topics are server-owned openings', () => {
  const context = { instanceId: 'ux-fixture', actor: 'fixture-person', kind: 'reply', sourceRef: { kind: 'new_topic', id: 'opening', workspace_id: 'w1' }, topicId: 'reserved' };
  assert.throws(() => new Editor(context, { id: 'd', revision: 0, generation: 'g', body: 'Opening words' }), /opening/i);
  assert.throws(() => restoreEditor(context, null, { format: 1, key: JSON.stringify(['ux-fixture', 'fixture-person', 'reply', 'new_topic', 'opening', 'reserved']) }), /opening/i);
});
