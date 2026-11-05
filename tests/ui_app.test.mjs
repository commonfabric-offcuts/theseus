// Authored before application wiring; execution is coordinated with aim-lead.
// Real HTTP/Store outcomes, in-memory journal timing only. Native IDB/Web Locks
// and focus/selection/Undo require the separately assigned browser proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Api } from '../web/api.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { Editor, restoreEditor } from '../web/editor.mjs';

const copy = value => structuredClone(value);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Inline preparation only: written before the selected implementation. Run
// these checks after Core's reviewed topic-context contract and lane handoff.
test('inline initializes only from confirmed topic editor state without a source or note', async t => {
  const f = await fixture(t), topic = (await f.api.view('topic', { topic_id: f.facts.topic_id })).topic;
  assert.equal(typeof f.registry.initializeInline, 'function');
  const entered = deferred(), release = deferred(), read = f.transport.view;
  t.after(() => release.resolve());
  f.transport.view = async (name, args, options) => {
    const answer = await read(name, args, options);
    if (name === 'editor_state' && args.source_ref.kind === 'topic') {
      entered.resolve(); await release.promise;
    }
    return answer;
  };
  const opening = f.registry.initializeInline(topic); await entered.promise;
  assert.equal(f.registry.isCurrent(f.registry.inline), false, 'unconfirmed initialization cannot admit input');
  release.resolve(); const p = await opening;
  assert.equal(p.surface, 'inline'); assert.equal(f.registry.inline, p);
  assert.equal(f.registry.current, null); assert.equal(f.registry.isCurrent(p), true);
  assert.deepEqual(Object.keys(p.editors), ['reply']); assert.equal(p.source, undefined);
  assert.deepEqual(p.editors.reply.context.sourceRef, { kind: 'topic', id: topic.id });
  assert.equal(p.editors.reply.context.topicId, topic.id);
  assert.equal(f.registry.sessions.size, 1, 'one registered owner for the topic composer');
  assert.equal(f.calls.some(c => c.type === 'view' && c.name === 'source'), false);
  assert.equal(f.calls.some(c => c.type === 'command'), false, 'opening the composer is read-only');
});

test('inline admission suspends synchronously and resumes after failed or closed modal opens', async t => {
  const f = await fixture(t), topic = (await f.api.view('topic', { topic_id: f.facts.topic_id })).topic;
  const inline = await f.registry.initializeInline(topic), editor = inline.editors.reply;
  const uploads = f.registry.sessionFor(editor).uploads;
  editor.edit({ body: 'Inline writing remains mine', caret: { start: 7, end: 7 } });
  const entered = deferred(), release = deferred(), put = f.backend.put, read = f.transport.view;
  t.after(() => { release.resolve(); f.backend.put = put; f.transport.view = read; });
  f.backend.put = async row => { entered.resolve(); await release.promise; return put(row); };
  f.transport.view = async (name, args, options) => {
    if (name === 'source') throw Error('Expected source-read refusal');
    return read(name, args, options);
  };
  const opening = f.open(0).then(value => ({ value }), error => ({ error }));
  assert.equal(f.registry.isCurrent(inline, editor), false, 'input stops before the first awaited preservation');
  assert.throws(() => uploads.reserve(inline));
  assert.equal(uploads.valid(), true, 'already-admitted upload completion keeps its registered editor');
  assert.equal(await Promise.race([entered.promise.then(() => true), opening.then(() => false)]), true,
    'opening must wait for inline local preservation before reading its source');
  release.resolve();
  assert.match((await opening).error.message, /Expected source-read refusal/);
  assert.equal(f.registry.isCurrent(inline, editor), true, 'failed opening resumes the same composer');
  assert.equal((await f.journal.own(editor.key)).snapshot.draft.body, 'Inline writing remains mine');
  f.backend.put = put; f.transport.view = read;
  const modal = await f.open(0);
  assert.equal(f.registry.isCurrent(inline, editor), false);
  assert.equal(f.registry.isCurrent(modal, editor), false, 'a current modal cannot admit another surface editor');
  assert.equal(f.registry.isCurrent(modal, modal.editors.reply), true);
  assert.equal(uploads.valid(), true, 'suspension is not disposal');
  const note = f.registry.setMode('note');
  assert.equal(f.registry.isCurrent(modal, modal.editors.reply), false, 'stale presentation callbacks stay stale');
  assert.equal(await f.registry.close(note, { explicit: true }), true);
  assert.equal(f.registry.inline, inline); assert.equal(f.registry.isCurrent(inline, editor), true);
  assert.deepEqual(editor.draft.caret, { start: 7, end: 7 });
  assert.equal(f.registry.isCurrent(inline, new Editor(editor.context, editor.draft)), false, 'same key does not register a replacement editor');
  f.registry.dispose(); assert.equal(f.registry.isCurrent(inline, editor), false);
});

test('inline explicit saved-copy adoption repaints inline and never manufactures a modal', async t => {
  const f = await fixture(t), topic = (await f.api.view('topic', { topic_id: f.facts.topic_id })).topic;
  const inline = await f.registry.initializeInline(topic), original = inline.editors.reply;
  const old = new Editor(original.context, original.draft); old.edit({ body: 'Retained inline writing' });
  const other = new RecoveryJournal(f.backend, 'closed-inline-document'); await other.save(old.snapshot());
  const row = await other.own(old.key);
  // Memory-only journal timing fixture. This proves presentation routing, not
  // native IDB durability or Web Lock behavior.
  f.backend.adopt = async (key, candidate, guard) => {
    assert.equal(guard(), true);
    const current = f.rows.get(candidate.id); assert.equal(current.stamp, candidate.stamp);
    const adopted = { ...copy(current), id: f.journal.id(key), writerId: f.journal.writerId, stamp: 'adopted-inline' };
    f.rows.set(adopted.id, adopted); return copy(adopted);
  };
  const restored = await f.registry.adoptCandidate(original, row, inline);
  assert.notEqual(restored, original); assert.equal(restored.draft.body, 'Retained inline writing');
  assert.equal(inline.editors.reply, restored); assert.equal(f.registry.current, null);
  assert.equal(f.shown.at(-1), inline); assert.equal(f.registry.isCurrent(inline, restored), true);
  assert.equal(f.registry.isCurrent(inline, original), false, 'a captured callback cannot edit the replaced owner');
});

test('inline restore retains malformed topic writing but blocks save and preparation', () => {
  const context = { instanceId: 'inline-restore', actor: 'fixture-person', kind: 'reply', topicId: 't1', sourceRef: { kind: 'topic', id: 't1' } };
  const remote = { id: 'topic-draft', generation: 'original', revision: 1, source_ref: context.sourceRef, topic_id: 't1' };
  const original = new Editor(context, remote); original.edit({ body: 'Retain every byte', caret: { start: 4, end: 8 } });
  const controls = restoreEditor(context, remote, original.snapshot());
  assert.ok(controls.saveTicket('valid-control'), 'canonical retained writing remains saveable');
  for (const corrupt of [
    s => { s.sourceRef.id = 'elsewhere'; },
    s => { s.sourceRef.revision = 1; },
    s => { s.draft.source_ref = { kind: 'topic', id: 'elsewhere' }; },
    s => { s.draft.topic_id = 'elsewhere'; },
    s => { s.draft.reply_to = null; },
    s => { s.draft.opening = null; },
    s => { s.draft.exchange_id = null; },
    s => { s.draft.quotes = [{ source_ref: { kind: 'message', id: 'm1' }, text: 'retained quote' }]; },
  ]) {
    const retained = original.snapshot(); corrupt(retained); const before = copy(retained);
    const restored = restoreEditor(context, remote, retained);
    assert.deepEqual(retained, before, 'validation cannot rewrite its recovery input');
    assert.deepEqual(restored.draft, retained.draft, 'bad fields remain reviewable, never silently dropped');
    assert.deepEqual(restored.sourceRef, retained.sourceRef);
    assert.equal(restored.saveTicket('must-not-save'), null, 'malformed retained payload cannot be enabled for save');
    assert.throws(() => restored.beginPrepare({ prepareOperationId: 'p', sendOperationId: 's', submissionId: 'i' }));
    assert.deepEqual(restored.draft, retained.draft, 'blocked send cannot rotate or erase the retained draft');
  }
});

test('source lifetime survives modes but rejects a new open, close and disposal', async t => {
  const f = await fixture(t), x = await f.open(0);
  assert.equal(typeof f.registry.isSourceCurrent, 'function');
  for (const mode of ['note', 'reply']) {
    const current = f.registry.setMode(mode);
    assert.notEqual(current, x); assert.equal(current.source, x.source);
    assert.equal(f.registry.isCurrent(x), false);
    assert.equal(f.registry.isSourceCurrent(x), true);
  }
  const y = await f.open(1);
  assert.equal(f.registry.isSourceCurrent(x), false);
  await f.registry.close(y, { explicit: true });
  assert.equal(f.registry.isSourceCurrent(y), false);
  const reopened = await f.open(0);
  assert.notEqual(reopened.source, x.source);
  assert.equal(f.registry.isSourceCurrent(x), false, 'equal source IDs do not share an open lifetime');
  f.registry.dispose(); assert.equal(f.registry.isSourceCurrent(reopened), false);
});

async function holdSource(f, lateFailure = false) {
  const entered = deferred(), release = deferred(), original = f.transport.view;
  f.transport.view = async (name, args) => {
    const answer = await original(name, args);
    if (name === 'source' && args.id === f.facts.sources[1].id) {
      entered.resolve(); await release.promise;
      if (lateFailure) throw Error('Late source refusal');
    }
    return answer;
  };
  const opening = f.open(1).then(value => ({ value }), error => ({ error }));
  await entered.promise;
  return { release, opening };
}

for (const lateFailure of [false, true]) {
  test(`explicit close cancels a held source read (${lateFailure})`, async t => {
    const f = await fixture(t), x = await f.open(0), held = await holdSource(f, lateFailure);
    t.after(() => held.release.resolve());
    x.editors.reply.edit({ body: 'Newest X while Y reads' });
    await f.registry.edited(x.editors.reply);
    assert.equal(await f.registry.close(x, { explicit: true }), true);
    assert.equal(f.registry.current, null); assert.equal(f.registry.pendingOpen, null);
    assert.deepEqual(f.closed, [x]);
    assert.equal((await f.journal.own(x.editors.reply.key)).snapshot.draft.body, 'Newest X while Y reads');
    held.release.resolve(); const settled = await held.opening;
    assert.equal(settled.error, undefined, 'cancelled read cannot report a late error');
    assert.equal(settled.value, null); assert.deepEqual(f.shown, [x]);
  });
  test(`mode cancels a held source read without reviving its error (${lateFailure})`, async t => {
    const f = await fixture(t), x = await f.open(0), held = await holdSource(f, lateFailure);
    t.after(() => held.release.resolve());
    assert.equal(f.registry.isSourceCurrent(x), false, 'X source results are refused while Y is pending');
    const note = f.registry.setMode('note');
    assert.equal(note.source, x.source); assert.equal(note.mode, 'note');
    assert.equal(f.registry.isSourceCurrent(x), true, 'mode cancellation deliberately restores X source lifetime');
    assert.equal(f.registry.pendingOpen, null); assert.equal(f.registry.isCurrent(x), false);
    held.release.resolve(); const settled = await held.opening;
    assert.equal(settled.error, undefined, 'cancelled mode navigation cannot report a late error');
    assert.equal(settled.value, null); assert.equal(f.registry.current, note);
    assert.deepEqual(f.shown, [x]);
  });
}

test('failed explicit close still cancels navigation and permits a fresh step', async t => {
  const f = await fixture(t), x = await f.open(0), held = await holdSource(f);
  const put = f.backend.put; t.after(() => { held.release.resolve(); f.backend.put = put; });
  f.backend.put = async () => { throw Error('Injected recovery quota failure'); };
  x.editors.reply.edit({ body: 'Unjournaled X' });
  assert.equal(await f.registry.close(x, { explicit: true }), false);
  assert.equal(f.registry.current, x); assert.equal(f.registry.pendingOpen, null);
  assert.match(f.registry.status(x.editors.reply), /Recovery copy unavailable/);
  x.editors.reply.edit({ body: 'Still editable X' });
  held.release.resolve(); assert.equal((await held.opening).value, null);
  assert.deepEqual(f.shown, [x]);
  f.backend.put = put;
  const y = await f.open(1); assert.equal(f.registry.current, y);
  assert.equal((await f.journal.own(x.editors.reply.key)).snapshot.draft.body, 'Still editable X');
});

test('newer open wins over explicit close awaiting local preservation', async t => {
  const f = await fixture(t), x = await f.open(0), entered = deferred(), release = deferred(), put = f.backend.put;
  t.after(() => { release.resolve(); f.backend.put = put; });
  f.backend.put = async row => { entered.resolve(); await release.promise; return put(row); };
  x.editors.reply.edit({ body: 'X close local preservation' });
  const closing = f.registry.close(x, { explicit: true }); await entered.promise;
  const opening = f.open(1); release.resolve();
  assert.equal(await closing, false); const y = await opening;
  assert.equal(f.registry.current, y); assert.deepEqual(f.closed, []);
});

for (const action of ['note', 'send']) {
  test(`automatic ${action} completion never cancels a pending user open`, async t => {
    const f = await fixture(t), x = await f.open(0);
    if (action === 'note') f.registry.setMode('note');
    const p = f.registry.current, editor = p.editors[action === 'note' ? 'note' : 'reply'];
    const entered = deferred(), release = deferred(); t.after(() => release.resolve());
    f.transport.command = async envelope => {
      const answer = await f.api.command(envelope);
      if (envelope.kind === (action === 'note' ? 'note.save' : 'submission.prepare')) { entered.resolve(); await release.promise; }
      return answer;
    };
    editor.edit({ body: 'Automatic completion while navigating' }); await f.registry.edited(editor);
    const completion = action === 'note' ? f.registry.saveNote(editor, p) : f.registry.send(editor, { stay: false, presentation: p });
    await entered.promise;
    const held = await holdSource(f); t.after(() => held.release.resolve());
    const token = f.registry.pendingOpen; assert.ok(token);
    release.resolve(); await completion;
    assert.equal(f.registry.pendingOpen, token); assert.equal(f.registry.current, p); assert.deepEqual(f.closed, []);
    held.release.resolve(); const y = (await held.opening).value; assert.equal(f.registry.current, y);
  });
}

test('stepping uses reader eligibility and enables the final neighbor even without a continuation', async t => {
  const f = await fixture(t), p = await f.open(0);
  assert.equal(typeof f.registry.neighbors, 'function', 'bounded neighbor lookup must be implemented');
  const neighbors = await f.registry.neighbors(p);
  assert.equal(neighbors.previous, null); assert.deepEqual(neighbors.next, f.facts.sources[1]);
  const reads = f.calls.filter(call => call.name === 'topic_messages');
  assert.equal(reads.length, 2);
  assert.ok(reads.every(call => call.args.audience === 'reader' && call.args.limit === 1 && call.args.cursor === p.source.seq));
  assert.equal((await f.api.view('topic_messages', reads.find(call => call.args.direction === 'after').args)).next_cursor, null);
});

test('freshness neighbors read sequentially and discard an older answer after a newer request', async t => {
  const f = await fixture(t), p = await f.open(0), entered = deferred(), release = deferred(), calls = [];
  t.after(() => release.resolve());
  const read = async (name, args) => {
    calls.push(args.direction);
    const answer = await f.api.view(name, args);
    if (args.direction === 'before') { entered.resolve(); await release.promise; }
    return answer;
  };
  const old = f.registry.neighbors(p, { read }); await entered.promise;
  assert.deepEqual(calls, ['before'], 'a background pair occupies only one read at a time');
  const current = await f.registry.neighbors(p);
  release.resolve(); assert.equal(await old, null);
  assert.deepEqual(current.next, f.facts.sources[1]);
  assert.equal(f.registry.current, p); assert.deepEqual(f.shown, [p]);
});

test('freshness authority park gates all existing editors before local persistence settles', async t => {
  const f = await fixture(t), p = await f.open(0), entered = deferred(), release = deferred();
  const put = f.backend.put; t.after(() => { release.resolve(); f.backend.put = put; });
  for (const editor of Object.values(p.editors)) {
    editor.edit({ body: 'Exact private ' + editor.context.kind }); await f.registry.edited(editor);
  }
  f.backend.put = async row => { entered.resolve(); await release.promise; return put(row); };
  const commands = f.calls.filter(c => c.type === 'command').length, reads = f.calls.length;
  const parking = f.registry.parkAuthority({ instance_id: f.bootstrap.instance_id, actor_id: f.bootstrap.actor,
    authority_id: f.bootstrap.authority.authority_id, authority_epoch: f.bootstrap.authority.authority_epoch }, 'INVALID_BINDING');
  for (const editor of Object.values(p.editors)) {
    assert.equal(editor.authorityRecovery.phase, 'parked');
    assert.equal(f.registry.scheduled.has(editor.key), false);
  }
  await entered.promise;
  assert.equal(f.calls.length, reads, 'parking does not probe, read a new private state, or send');
  release.resolve(); await parking;
  for (const editor of Object.values(p.editors)) {
    const row = await f.journal.own(editor.key);
    assert.equal(row.snapshot.draft.body, 'Exact private ' + editor.context.kind);
    assert.equal(row.snapshot.authorityRecovery.phase, 'parked');
  }
  assert.equal(f.calls.filter(c => c.type === 'command').length, commands);
  assert.equal(f.registry.current, p);
});

test('server-only pending details are fetched explicitly and confirmation performs no command', async t => {
  const f = await fixture(t), p = await f.open(0), editor = p.editors.reply;
  const item = f.registry.pending(editor).items[0];
  assert.ok(item); assert.equal(f.calls.filter(call => call.name === 'submission').length, 0);
  assert.equal(typeof f.registry.inspectPending, 'function', 'explicit snapshot inspection must be implemented');
  const full = await f.registry.inspectPending(editor, item.id);
  assert.ok(full.body.length > 1024); assert.equal(full.id, item.id);
  await f.registry.checkPending(editor, item.id);
  assert.equal(f.calls.filter(call => call.type === 'command').length, 0);
  assert.equal(f.registry.pending(editor).items[0].send_status, 'committed');
});

test('pending detail mismatch cannot disclose another source snapshot', async t => {
  const f = await fixture(t), p = await f.open(0), editor = p.editors.reply;
  const item = f.registry.pending(editor).items[0];
  const real = f.transport.view;
  f.transport.view = async (name, args) => {
    const answer = await real(name, args); if (name === 'submission') answer.source_ref = f.facts.sources[1]; return answer;
  };
  assert.equal(typeof f.registry.inspectPending, 'function');
  await assert.rejects(f.registry.inspectPending(editor, item.id), /identity|source|match/i);
});

test('failed navigation leaves the displayed reader usable and closable', async t => {
  const f = await fixture(t), x = await f.open(0);
  f.transport.view = async () => { throw Error('temporary read failure'); };
  await assert.rejects(f.open(1), /temporary read failure/);
  assert.equal(f.registry.current, x);
  assert.equal(await f.registry.close(x), true, 'a failed open must not strand the prior reader token');
});

test('explicit note close recognizes an already confirmed current autosave', async t => {
  const f = await fixture(t), p = await f.open(1);
  f.registry.setMode('note');
  const note = p.editors.note; note.edit({ body: 'Already autosaved private note' });
  await f.registry.edited(note); const receipt = await f.registry.flush(note);
  assert.equal(receipt.status, 'committed');
  assert.equal(await f.registry.saveNote(note), true);
  assert.equal(f.registry.current, null);
  assert.equal(f.calls.filter(call => call.type === 'command' && call.envelope.kind === 'message.send').length, 0);
});

async function fixture(t, options = {}) {
  const { noReadAdmission = false, ...registryOptions } = options;
  const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py'], { cwd: new URL('..', import.meta.url) });
  let serial = 0, errors = '';
  const pending = new Map(), rows = new Map(), calls = [], shown = [], closed = [], changes = [];
  child.stderr.on('data', data => { errors += data; });
  createInterface({ input: child.stdout }).on('line', line => {
    const result = JSON.parse(line), waiter = pending.get(result.id);
    pending.delete(result.id);
    if (result.failure) waiter.reject(Error(result.failure)); else waiter.resolve(result.answer);
  });
  const exited = new Promise(resolve => child.once('exit', code => {
    for (const waiter of pending.values()) waiter.reject(Error(`HTTP fixture exited ${code}: ${errors}`));
    resolve(code);
  }));
  const control = data => new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ ...data, id }) + '\n');
  });
  let registry;
  t.after(async () => {
    registry?.dispose();
    child.stdin.end();
    assert.equal(await exited, 0, errors);
  });
  const facts = await control({ method: 'ready' });
  const api = new Api(facts.token, (url, init) => fetch(new URL(url, facts.origin), {
    ...init, headers: { ...init.headers, Origin: facts.origin },
  }));
  const backend = {
    put: async row => { rows.set(row.id, copy(row)); },
    get: async id => copy(rows.get(id)),
    forEditor: async key => [...rows.values()].filter(row => row.editorKey === key).map(copy),
    removeExact: async (id, stamp) => rows.get(id)?.stamp === stamp ? rows.delete(id) : false,
  };
  const journal = new RecoveryJournal(backend, 'fixture-document');
  const transport = {
    bootstrap: async options => {
      const answer = await api.bootstrap(options);
      // Local old-capability arbitration, over the real HTTP fixture. This
      // does not claim to measure the historical server's transport budget.
      if (noReadAdmission) delete answer.transport.read_admission;
      return answer;
    },
    view: (name, args, options) => { calls.push({ type: 'view', name, args: copy(args) }); return api.view(name, args, options); },
    command: envelope => { calls.push({ type: 'command', envelope: copy(envelope) }); return api.command(envelope); },
  };
  const bootstrap = await transport.bootstrap();
  registry = new EditorRegistry({ api: transport, bootstrap, journal,
    present: presentation => shown.push(presentation), closed: presentation => closed.push(presentation),
    changed: editor => changes.push(editor.key), saveDelayMs: 30000, maxSaveDelayMs: 60000, ...registryOptions });
  const open = (index = 0) => registry.open(facts.sources[index], { topicId: facts.topic_id });
  const state = index => api.view('editor_state', { source_ref: facts.sources[index], topic_id: facts.topic_id });
  return { registry, api, transport, bootstrap, journal, backend, rows, calls, shown, closed, changes, facts, open, state, control };
}

async function cleanupSettled(f, editor) { await f.registry.cleanup?.idle(editor.key); }

test('cleanup retires exact real private acknowledgements without recreating on close or caret movement', async t => {
  const f = await fixture(t), p = await f.open(1);
  for (const editor of Object.values(p.editors)) {
    editor.edit({ body: 'Canonical ' + editor.context.kind });
    await f.registry.edited(editor); await f.registry.flush(editor); await cleanupSettled(f, editor);
    assert.equal(await f.journal.own(editor.key), undefined, 'acknowledged own recovery row retired');
    const before = copy(editor.snapshot()), commands = f.calls.filter(c => c.type === 'command').length;
    const put = f.backend.put; let writes = 0;
    f.backend.put = async row => { ++writes; return put(row); };
    editor.draft.caret = { start: 3, end: 3 };
    await f.registry.persistLocal(editor); await f.registry.flush(editor); await cleanupSettled(f, editor);
    assert.equal(await f.journal.own(editor.key), undefined, 'caret-only close/save does not recreate acknowledged work');
    assert.equal(writes, 0, 'unchanged acknowledged snapshot never rewrites the IDB row');
    f.backend.put = put;
    assert.equal(f.calls.filter(c => c.type === 'command').length, commands, 'cleanup never writes to server');
    assert.deepEqual(editor.snapshot(), { ...before, draft: { ...before.draft, caret: { start: 3, end: 3 } } });
    editor.edit({ body: 'New recoverable ' + editor.context.kind }); await f.registry.edited(editor);
    assert.equal((await f.journal.own(editor.key)).snapshot.draft.body, 'New recoverable ' + editor.context.kind);
    f.registry.cancelSave(editor);
  }
});

test('cleanup exact send successor retires while canonical submission stays discoverable', async t => {
  const f = await fixture(t), p = await f.open(1), editor = p.editors.reply;
  editor.edit({ body: 'An immutable real publication' }); await f.registry.edited(editor);
  const item = await f.registry.send(editor, { stay: true }); await cleanupSettled(f, editor);
  assert.equal(item.status, 'confirmed');
  assert.equal(await f.journal.own(editor.key), undefined, 'exact canonical successor and every act acknowledged');
  editor.draft.caret = { start: 0, end: 0 }; await f.registry.close(p, { explicit: true });
  assert.equal(await f.journal.own(editor.key), undefined, 'empty successor close does not recreate a row');
  assert.equal((await f.api.view('submission', { submission_id: item.id })).body, 'An immutable real publication');
});

async function retainedAcknowledgement(t, kind = 'reply', send = false, options = {}) {
  const f = await fixture(t, options), p = await f.open(1), editor = p.editors[kind], session = f.registry.sessionFor(editor);
  const read = f.transport.view;
  f.transport.view = async (name, args) => {
    const answer = await read(name, args);
    return name === 'editor_state' ? { ...answer, draft: null, note: null } : answer;
  };
  editor.edit({ body: 'Exact retained acknowledgement' }); await f.registry.edited(editor);
  if (send) await f.registry.send(editor, { stay: true }); else await f.registry.flush(editor);
  await cleanupSettled(f, editor); f.transport.view = read;
  const row = await f.journal.own(editor.key); assert.ok(row);
  return { ...f, editor, session, row, read };
}

test('read-only opening ownership prevents cleanup of otherwise acknowledged own and candidate rows',async t=>{
  const f=await retainedAcknowledgement(t),{editor,session,row}=f;
  // The ownership marker is set before discovery by initializeOpening. Keep a
  // canonically acknowledged row so removing the guard really would delete it.
  editor.openingReadOnly=true;
  await f.registry.cleanup.own(session);assert.deepEqual(await f.journal.own(editor.key),row);
  let attempts=0;f.backend.retireAcknowledged=async()=>{attempts++;return true;};
  f.backend.retireImageCandidate=async()=>{attempts++;return {retired:true};};
  const candidate={...copy(row),id:JSON.stringify([editor.key,'other-writer']),writerId:'other-writer',availability:'available'};
  const page={items:[candidate],nextCursor:null};
  assert.deepEqual(await f.registry.cleanup.candidates(session,page),page);assert.equal(attempts,0);
  editor.openingReadOnly=false;await f.registry.cleanup.own(session);
  assert.equal(await f.journal.own(editor.key),undefined,'same acknowledged row is cleanable when its owner is writable');
  assert.deepEqual((await f.registry.cleanup.candidates(session,page)).items,[]);assert.equal(attempts,1,'the candidate instrument observes a writable cleanup');
});

test('cleanup canonical identity payload and authority mismatches retain complete exact rows', async t => {
  const f = await retainedAcknowledgement(t), { editor, session, row } = f;
  const corruptions = [
    a => { a.instance_id = 'foreign'; }, a => { a.source_ref = { ...a.source_ref, revision: 99 }; },
    a => { a.destination.topic_id = 'elsewhere'; }, a => { a.draft.id = 'other'; },
    a => { a.draft.generation = 'other'; }, a => { ++a.draft.revision; },
    a => { a.draft.attachments = [{ id: 'other' }]; }, a => { a.draft.quotes = [{ text: 'other' }]; },
    a => { a.draft.addressees = ['other']; }, a => { a.draft.body += 'new'; },
    a => { a.draft.source_ref = { ...a.draft.source_ref, revision: 8 }; },
  ];
  for (const corrupt of corruptions) {
    f.transport.view = async (name, args) => { const answer = await f.read(name, args); if (name === 'editor_state') corrupt(answer); return answer; };
    await f.registry.cleanup.own(session); assert.deepEqual(await f.journal.own(editor.key), row);
  }
  f.transport.view = f.read;
  const bootstrap = f.transport.bootstrap;
  for (const change of ['actor', 'pair', 'between']) {
    let reads = 0;
    f.transport.bootstrap = async () => {
      const answer = await bootstrap(); ++reads;
      if (change === 'actor') answer.actor = 'someone-else';
      if (change === 'pair' || change === 'between' && reads === 2) answer.authority.authority_epoch = 'E2';
      return answer;
    };
    await f.registry.cleanup.own(session); assert.deepEqual(await f.journal.own(editor.key), row);
    assert.equal(session.acknowledgedSnapshot ?? null, null, 'no cleanup token across unknown authority');
  }
  f.transport.bootstrap = bootstrap;
  editor.draft.caret = { start: 9, end: 9 };
  await f.registry.cleanup.own(session);
  assert.equal(await f.journal.own(editor.key), undefined, 'only current caret differs; original tickets stay exact');
});

test('cleanup false unknown and mismatched original operation outcomes retain the exact row', async t => {
  const f = await retainedAcknowledgement(t);
  for (const mutate of [a => { a.recorded = false; }, a => { a.status = 'unknown'; }, a => { a.operation_id = 'wrong'; }, a => { ++a.result.draft_revision; }]) {
    f.transport.view = async (name, args) => { const answer = await f.read(name, args); if (name === 'operation') mutate(answer); return answer; };
    await f.registry.cleanup.own(f.session); assert.deepEqual(await f.journal.own(f.editor.key), f.row);
  }
  f.transport.view = f.read; await f.registry.cleanup.own(f.session);
  assert.equal(await f.journal.own(f.editor.key), undefined);
});

test('cleanup retains unsupported writing in notes and frozen snapshots', async t => {
  const note = await retainedAcknowledgement(t, 'note');
  for (const field of ['reply_to', 'exchange_id', 'opening']) {
    await t.test('note ' + field, async () => {
      const row = copy(note.row); row.snapshot.draft[field] = 'unconfirmed';
      assert.equal(await note.registry.cleanup.confirm(row, note.editor.context), false, 'note metadata stays recoverable: ' + field);
    });
  }
  const reply = await retainedAcknowledgement(t, 'reply', true);
  for (const kind of ['ticket', 'submission']) {
    await t.test('frozen ' + kind, async () => {
      const row = copy(reply.row);
      const draft = kind === 'ticket' ? row.snapshot.attempts.find(a => a.ticket).ticket.draft : row.snapshot.submissions[0].snapshot;
      draft.futureWriting = 'unconfirmed';
      assert.equal(await reply.registry.cleanup.confirm(row, reply.editor.context), false, 'frozen writing stays recoverable: ' + kind);
    });
  }
});

test('cleanup correction keeps stored wrong-typed frozen collections whole before projection', async t => {
  const install = async (f, mutate) => {
    const snapshot = copy(f.row.snapshot); mutate(snapshot);
    f.session.attempts = copy(snapshot.attempts);
    f.editor.submissions = copy(snapshot.submissions);
    f.session.acknowledgedSnapshot = null;
    await f.journal.save(snapshot);
    return f.journal.own(f.editor.key);
  };
  const note = await retainedAcknowledgement(t, 'note');
  for (const field of ['attachments', 'quotes', 'addressees']) {
    for (const value of [{ kept: 'x' }, { length: 0 }, null, 7]) {
      await t.test(`note ${field} ${JSON.stringify(value)}`, async () => {
        const row = await install(note, s => { s.attempts.find(a => a.ticket).ticket.draft[field] = copy(value); });
        await note.registry.cleanup.own(note.session);
        assert.deepEqual(await note.journal.own(note.editor.key), row, 'wrong-typed note ticket keeps the entire stored row');
        assert.equal(note.session.acknowledgedSnapshot, null);
      });
    }
  }
  const reply = await retainedAcknowledgement(t, 'reply', true);
  for (const kind of ['ticket', 'submission']) {
    await t.test('reply ' + kind, async () => {
      const row = await install(reply, s => {
        if (kind === 'ticket') {
          const attempt = s.attempts.find(a => a.ticket);
          attempt.ticket.draft.quotes = { kept: 'x' };
          attempt.envelope.args.quotes = { kept: 'x' };
        } else s.submissions[0].snapshot.quotes = { kept: 'x' };
      });
      const before = reply.calls.filter(c => c.name === 'submission').length;
      await reply.registry.cleanup.own(reply.session);
      assert.deepEqual(await reply.journal.own(reply.editor.key), row, 'wrong-typed reply history keeps the entire stored row');
      assert.equal(reply.session.acknowledgedSnapshot, null);
      if (kind === 'submission') assert.equal(reply.calls.filter(c => c.name === 'submission').length, before,
        'malformed frozen submission refuses before projection and canonical lookup');
    });
  }
  for (const f of [note, reply]) {
    assert.equal(f.row.snapshot.attempts.find(a => a.ticket).ticket.draft.revision, 0, 'first-save ticket remains revision zero');
    await install(f, () => {}); await f.registry.cleanup.own(f.session);
    assert.equal(await f.journal.own(f.editor.key), undefined, 'original valid history still retires');
  }
});

test('cleanup pending refused detached and missing-pin histories retain original envelopes', async t => {
  const f = await retainedAcknowledgement(t, 'reply', true), snapshot = copy(f.row.snapshot);
  for (const mutate of [
    s => { s.attempts[0].receipt = null; }, s => { s.attempts[0].receipt.status = 'rejected'; },
    s => { s.attempts[0].detached = true; }, s => { delete s.attempts[0].envelope.expected.authority; },
    s => { s.attempts[0].envelope.expected.authority.authority_epoch = 'historical'; },
    s => { s.submissions[0].status = 'prepared'; }, s => { s.submissions[0].status = 'refused'; },
    s => { s.submissions[0].detached = true; }, s => { delete s.submissions[0].authority; },
    s => { s.submissions[0].snapshot.quotes.push({ text: 'unconfirmed' }); },
  ]) {
    const altered = copy(snapshot); mutate(altered);
    await f.journal.save(altered); const row = await f.journal.own(f.editor.key);
    assert.equal(await f.registry.cleanup.confirm(row, f.editor.context), false);
    assert.deepEqual(await f.journal.own(f.editor.key), row, 'whole row and exact retained envelope survive');
  }
  await f.journal.save(snapshot); await f.registry.cleanup.own(f.session);
  assert.equal(await f.journal.own(f.editor.key), undefined);
});

test('cleanup held canonical read cannot retire newer writing or a newer exact stamp', async t => {
  const f = await retainedAcknowledgement(t), entered = deferred(), release = deferred();
  f.transport.view = async (name, args) => { const answer = await f.read(name, args); if (name === 'editor_state') { entered.resolve(); await release.promise; } return answer; };
  const cleaning = f.registry.cleanup.own(f.session); await entered.promise;
  f.editor.edit({ body: 'Newer B survives late cleanup' }); await f.registry.edited(f.editor); f.registry.cancelSave(f.editor);
  const newer = await f.journal.own(f.editor.key); release.resolve(); await cleaning; await cleanupSettled(f, f.editor);
  assert.deepEqual(await f.journal.own(f.editor.key), newer); assert.equal(f.editor.dirty, true);
  assert.equal(f.session.acknowledgedSnapshot ?? null, null);
  f.transport.view = f.read;
  await f.registry.flush(f.editor); await cleanupSettled(f, f.editor);
  assert.equal(await f.journal.own(f.editor.key), undefined);
});

test('cleanup deletion failure preserves acknowledged outcome and reports separate cleanup status', async t => {
  const f = await retainedAcknowledgement(t);
  f.backend.removeExact = async () => { throw Error('strict cleanup transaction aborted'); };
  await f.registry.cleanup.own(f.session);
  assert.deepEqual(await f.journal.own(f.editor.key), f.row);
  assert.equal(f.editor.dirty, false); assert.equal(f.editor.journalError, null);
  assert.match(f.registry.status(f.editor), /cleanup.*could not finish/i);
  assert.equal(f.session.acknowledgedSnapshot ?? null, null);
});

test('cleanup newer unpersisted edit and same-snapshot newer stamp each defeat captured retirement', async t => {
  for (const change of ['edit', 'stamp']) {
    const f = await retainedAcknowledgement(t), entered = deferred(), release = deferred();
    f.transport.view = async (name, args) => { const answer = await f.read(name, args); if (name === 'editor_state') { entered.resolve(); await release.promise; } return answer; };
    const cleaning = f.registry.cleanup.own(f.session); await entered.promise;
    if (change === 'edit') f.editor.edit({ body: 'Newer version before persistence' });
    else await f.journal.save(f.row.snapshot);
    const latest = await f.journal.own(f.editor.key); release.resolve(); await cleaning;
    assert.deepEqual(await f.journal.own(f.editor.key), latest, change + ' invalidates the captured retirement');
    assert.equal(f.session.acknowledgedSnapshot ?? null, null);
  }
});

test('cleanup row scope source revision and malformed history fail closed before canonical reads', async t => {
  const f = await retainedAcknowledgement(t), original = f.row;
  for (const mutate of [
    r => { r.scope = JSON.stringify(['foreign', f.bootstrap.actor]); },
    r => { r.snapshot.context.actor = 'foreign'; }, r => { r.snapshot.sourceRef.revision = 23; },
    r => { r.snapshot.context.topicId = 'wrong'; }, r => { r.active = 0; r.superseded_by = 'descendant'; },
    r => { r.snapshot.attempts[0].ticket.key = 'wrong'; },
    r => { r.snapshot.attempts[0].ticket.draft.body = 'changed original ticket'; },
  ]) {
    const row = copy(original); mutate(row);
    assert.equal(await f.registry.cleanup.confirm(row, f.editor.context), false);
    assert.deepEqual(await f.journal.own(f.editor.key), original);
  }
});

test('cleanup confirmations yield every ten exact reads and candidate cleanup considers only the loaded page', async t => {
  const f = await retainedAcknowledgement(t), { editor, session } = f;
  f.transport.view = async (name, args) => { const answer = await f.read(name, args); return name === 'editor_state' ? { ...answer, draft: null } : answer; };
  for (let i = 0; i < 21; ++i) { editor.edit({ body: 'Acknowledged ' + i }); await f.registry.flush(editor); }
  await cleanupSettled(f, editor);
  let confirmations = 0, batches = [], commands = 0;
  f.registry.cleanup.yieldBatch = async () => { batches.push(confirmations); };
  f.transport.view = async (name, args) => { if (name === 'operation') ++confirmations; return f.read(name, args); };
  const command = f.transport.command; f.transport.command = (...args) => { ++commands; return command(...args); };
  const row = await f.journal.own(editor.key);
  await f.registry.cleanup.own(session);
  assert.equal(await f.journal.own(editor.key), undefined);
  assert.equal(confirmations, 22); assert.deepEqual(batches, [10, 20]); assert.equal(commands, 0);
  const all = Array.from({ length: 12 }, (_, n) => ({ ...copy(row), writerId: 'closed-' + n,
    id: JSON.stringify([editor.key, 'closed-' + n]), availability: 'available' }));
  const retired = [], pages = [];
  f.backend.forEditor = async (key, options) => { pages.push({ key, ...options }); return { items: all.slice(0, 10), nextCursor: 'next-page' }; };
  f.backend.retireAcknowledged = async (key, candidate, confirm) => { assert.equal(key, editor.key); if (!await confirm(candidate)) return false; retired.push(candidate.id); return true; };
  const page = await f.registry.recoveryCandidates(editor, { limit: 10 });
  assert.equal(page.items.length, 0); assert.equal(page.nextCursor, 'next-page');
  assert.equal(pages.length, 1); assert.deepEqual(retired, all.slice(0, 10).map(r => r.id));
  assert.equal(commands, 0);
});

test('cleanup retirement token cannot suppress recovery after another editor learns a new authority', async t => {
  const f = await fixture(t), p = await f.open(1), editor = p.editors.reply;
  editor.edit({ body: 'Previously acknowledged in E1' }); await f.registry.flush(editor); await cleanupSettled(f, editor);
  assert.equal(await f.journal.own(editor.key), undefined);
  f.registry.runtime.current = { ...f.registry.runtime.current, authority_epoch: 'E2' };
  await f.registry.persistLocal(editor); await cleanupSettled(f, editor);
  assert.equal((await f.journal.own(editor.key))?.snapshot.draft.body, 'Previously acknowledged in E1', 'changed shared authority invalidates acknowledgement token');
});

test('cleanup malformed unrecognized writing cannot be silently omitted from acknowledgement', async t => {
  const f = await retainedAcknowledgement(t);
  const row = copy(f.row); row.snapshot.draft.unrecognizedWriting = 'keep exact recovery';
  assert.equal(await f.registry.cleanup.confirm(row, f.editor.context), false, 'unknown writing is retained');
});

test('without admission capability cleanup-first read drains before foreground pair while local persistence stays independent', async t => {
  const f = await retainedAcknowledgement(t, 'reply', false, { noReadAdmission: true }), entered = deferred(), release = deferred();
  const bootstrap = f.transport.bootstrap; let held = true, overlapped = 0;
  f.transport.bootstrap = async options => { const answer = await bootstrap(options); entered.resolve(); await release.promise; return answer; };
  f.transport.view = (...args) => { if (held && ['source', 'editor_state'].includes(args[0])) ++overlapped; return f.read(...args); };
  const cleaning = f.registry.cleanup.own(f.session); await entered.promise;
  const opening = f.open(0).then(value => ({ value }), error => ({ error }));
  f.editor.edit({ body: 'B journals while cleanup is held' }); await f.registry.edited(f.editor); f.registry.cancelSave(f.editor);
  assert.equal((await f.journal.own(f.editor.key)).snapshot.draft.body, 'B journals while cleanup is held');
  assert.equal((await f.registry.flush(f.editor)).status, 'committed', 'private command proceeds while cleanup is held');
  await new Promise(resolve => setTimeout(resolve, 20));
  const observed = overlapped; held = false; release.resolve(); await cleaning; const result = await opening;
  assert.equal(observed, 0, 'foreground pair cannot overlap the in-flight cleanup read');
  assert.equal(result.error, undefined); assert.deepEqual(result.value.source.source_ref, f.facts.sources[0]);
});

test('foreground-first pair excludes new cleanup reads without retrying or deleting', async t => {
  const f = await retainedAcknowledgement(t), entered = deferred(), release = deferred();
  let reads = 0, cleanupReads = 0;
  const bootstrap = f.transport.bootstrap;
  f.transport.bootstrap = options => { ++cleanupReads; return bootstrap(options); };
  f.transport.view = async (name, args, options) => {
    const answer = await f.read(name, args, options);
    if ((name === 'source' ? args.id : args.source_ref?.id) === f.facts.sources[0].id) {
      if (++reads === 2) entered.resolve(); await release.promise;
    }
    return answer;
  };
  const opening = f.open(0).then(value => ({ value }), error => ({ error })); await entered.promise;
  await f.registry.cleanup.own(f.session);
  const observed = cleanupReads; release.resolve(); const result = await opening;
  assert.equal(observed, 0, 'foreground reservation prevents new cleanup confirmations');
  assert.equal(result.error, undefined); assert.ok(await f.journal.own(f.editor.key));
});

test('cleanup busy reply retains exact row and never retries', async t => {
  const f = await retainedAcknowledgement(t), bootstrap = f.transport.bootstrap; let calls = 0;
  f.transport.bootstrap = async () => { ++calls; throw Object.assign(Error('busy'), { status: 503, details: { recorded: false, error: { code: 'SERVER_BUSY', retryable: true } } }); };
  await f.registry.cleanup.own(f.session);
  assert.equal(calls, 1); assert.deepEqual(await f.journal.own(f.editor.key), f.row);
  assert.equal(f.session.acknowledgedSnapshot ?? null, null);
  f.transport.bootstrap = bootstrap; await f.registry.cleanup.own(f.session);
  assert.equal(await f.journal.own(f.editor.key), undefined);
});

test('without admission capability cleanup stalled transport aborts after budget and timed-out foreground never dispatches late', async t => {
  const f = await retainedAcknowledgement(t, 'reply', false, { noReadAdmission: true }), entered = deferred(), bootstrap = f.transport.bootstrap;
  let aborted = false, sourceReads = 0, rescued = false;
  f.registry.runtime.readTimeoutMs = 100;
  f.transport.bootstrap = async options => {
    const answer = await bootstrap(options); entered.resolve();
    if (!options?.signal) return answer; // baseline reports the missing abort below rather than hanging its fixture
    return new Promise((resolve, reject) => {
      const rescue = setTimeout(() => { rescued = true; resolve(answer); }, 250);
      options.signal.addEventListener('abort', () => { clearTimeout(rescue); aborted = true; reject(Error('fixture response aborted')); }, { once: true });
    });
  };
  f.transport.view = (...args) => { if (args[0] === 'source') ++sourceReads; return f.read(...args); };
  const cleaning = f.registry.cleanup.own(f.session); await entered.promise;
  f.registry.runtime.readTimeoutMs = 20;
  const result = await f.open(0).then(value => ({ value }), error => ({ error }));
  const issued = sourceReads;
  await cleaning;
  assert.ok(result.error, 'foreground drain has a finite failure result');
  assert.equal(issued, 0, 'expired drain starts no source request');
  assert.equal(aborted, true, 'cleanup aborts its own never-arriving response');
  assert.equal(rescued, false, 'instrument rescue never supplies successful cleanup settlement');
  assert.equal(sourceReads, 0, 'late settlement cannot dispatch the expired foreground pair');
  assert.equal((await f.journal.own(f.editor.key)).snapshot.draft.body, f.row.snapshot.draft.body);
  f.transport.bootstrap = bootstrap; f.registry.runtime.readTimeoutMs = 5000;
  assert.deepEqual((await f.open(0)).source.source_ref, f.facts.sources[0]);
});

test('cleanup serializes actual transport across reply and note editors', async t => {
  const f = await retainedAcknowledgement(t), note = f.registry.current.editors.note;
  f.transport.view = async (name, args, options) => {
    const answer = await f.read(name, args, options); return name === 'editor_state' ? { ...answer, note: null } : answer;
  };
  note.edit({ body: 'Canonical note for transport isolation' }); await f.registry.flush(note); await cleanupSettled(f, note);
  f.transport.view = f.read;
  const bootstrap = f.transport.bootstrap, release = deferred(), entered = deferred();
  let active = 0, maximum = 0;
  f.transport.bootstrap = async options => {
    ++active; maximum = Math.max(maximum, active); entered.resolve();
    try { const answer = await bootstrap(options); await release.promise; return answer; }
    finally { --active; }
  };
  const a = f.registry.cleanup.own(f.session); await entered.promise;
  const b = f.registry.cleanup.own(f.registry.sessionFor(note));
  await new Promise(resolve => setTimeout(resolve, 20)); release.resolve(); await Promise.all([a, b]);
  assert.equal(maximum, 1, 'only one cleanup transport may be in flight in this registry');
  assert.equal(await f.journal.own(f.editor.key), undefined); assert.equal(await f.journal.own(note.key), undefined);
});

test('cleanup correction resumes after a foreground response settles beyond its deadline', async t => {
  const f = await retainedAcknowledgement(t), entered = deferred(), release = deferred(), settled = deferred();
  t.after(() => release.resolve());
  const bootstrap = f.transport.bootstrap; let dispatched = 0;
  f.transport.bootstrap = options => { ++dispatched; return bootstrap(options); };
  f.registry.runtime.readTimeoutMs = 50;
  // This is a client-side hold after Store/HTTP completion, not held server work.
  f.transport.view = async (name, args, options) => {
    if (name !== 'source') return f.read(name, args, options);
    const answer = await f.read(name, args); // deliberately ignores AbortSignal
    entered.resolve(); await release.promise; settled.resolve(); return answer;
  };
  const opening = f.open(0).then(value => ({ value }), error => ({ error }));
  await entered.promise; const result = await opening;
  assert.match(result.error?.message ?? '', /timed out/);
  await cleanupSettled(f, f.editor);
  await f.registry.cleanup.own(f.session);
  assert.equal(dispatched, 0, 'unsettled foreground response still excludes cleanup dispatch');
  t.diagnostic('reservation before late settlement: ' + f.registry.cleanup.foregroundCount);
  release.resolve(); await settled.promise;
  await new Promise(resolve => setImmediate(resolve));
  t.diagnostic('reservation after late settlement: ' + f.registry.cleanup.foregroundCount);
  f.transport.view = f.read; f.registry.runtime.readTimeoutMs = 5000;
  await f.registry.cleanup.own(f.session);
  assert.equal(await f.journal.own(f.editor.key), undefined, 'cleanup retires acknowledged writing after late foreground settlement');
});

test('without admission capability cleanup correction resumes after a foreground drain times out without dispatching', async t => {
  const f = await retainedAcknowledgement(t, 'reply', false, { noReadAdmission: true }), entered = deferred(), release = deferred();
  t.after(() => release.resolve());
  const bootstrap = f.transport.bootstrap;
  f.transport.bootstrap = async options => {
    const answer = await bootstrap(options); entered.resolve(); await release.promise; return answer;
  };
  let sourceReads = 0;
  f.transport.view = (...args) => { if (args[0] === 'source') ++sourceReads; return f.read(...args); };
  const cleaning = f.registry.cleanup.own(f.session); await entered.promise;
  f.registry.runtime.readTimeoutMs = 50;
  const result = await f.open(0).then(value => ({ value }), error => ({ error }));
  assert.match(result.error?.message ?? '', /timed out/);
  assert.equal(sourceReads, 0, 'expired foreground drain dispatches no source pair');
  t.diagnostic('reservation after drain timeout: ' + f.registry.cleanup.foregroundCount);
  f.registry.runtime.readTimeoutMs = 5000; release.resolve(); await cleaning;
  await cleanupSettled(f, f.editor);
  assert.equal(sourceReads, 0, 'late cleanup settlement never dispatches the expired foreground');
  assert.equal(await f.journal.own(f.editor.key), undefined, 'cleanup retires acknowledged writing after foreground drain timeout');
});

test('cleanup correction rechecks a queued read when foreground reserves after enqueue', async t => {
  const f = await retainedAcknowledgement(t), note = f.registry.current.editors.note;
  f.transport.view = async (...args) => {
    const answer = await f.read(...args); return args[0] === 'editor_state' ? { ...answer, note: null } : answer;
  };
  note.edit({ body: 'Acknowledged note queued behind reply' });
  await f.registry.flush(note); await cleanupSettled(f, note); f.transport.view = f.read;
  const entered = deferred(), queued = deferred(), release = deferred(), foreground = deferred(), finish = deferred();
  t.after(() => { release.resolve(); finish.resolve(); });
  const bootstrap = f.transport.bootstrap; let bootstraps = 0;
  f.transport.bootstrap = async options => {
    ++bootstraps; const answer = await bootstrap(options);
    if (bootstraps === 1) { entered.resolve(); await release.promise; }
    return answer;
  };
  const read = f.registry.cleanup.read.bind(f.registry.cleanup); let requests = 0;
  f.registry.cleanup.read = operation => {
    const promise = read(operation); if (++requests === 2) queued.resolve(); return promise;
  };
  let pairReads = 0;
  f.transport.view = async (name, args, options) => {
    const answer = await f.read(name, args, options);
    if ((name === 'source' ? args.id : args.source_ref?.id) === f.facts.sources[0].id) {
      if (++pairReads === 2) foreground.resolve(); await finish.promise;
    }
    return answer;
  };
  const a = f.registry.cleanup.own(f.session); await entered.promise;
  const b = f.registry.cleanup.own(f.registry.sessionFor(note)); await queued.promise;
  const opening = f.open(0).then(value => ({ value }), error => ({ error }));
  release.resolve(); await foreground.promise; await Promise.all([a, b]);
  assert.equal(bootstraps, 1, 'already queued cleanup cannot dispatch after foreground reserves');
  assert.ok(await f.journal.own(note.key));
  finish.resolve(); assert.equal((await opening).error, undefined);
  await f.registry.cleanup.own(f.registry.sessionFor(note));
  assert.equal(await f.journal.own(note.key), undefined, 'deferred acknowledged note retires on explicit later cleanup');
});

test('cleanup correction keeps the row when authority changes after confirmation before deletion', async t => {
  const f = await retainedAcknowledgement(t), remove = f.journal.removeExact.bind(f.journal);
  f.journal.removeExact = (...args) => {
    f.registry.runtime.current = { ...f.registry.runtime.current, authority_epoch: 'E2-at-deletion' };
    return remove(...args);
  };
  await f.registry.cleanup.own(f.session);
  assert.deepEqual(await f.journal.own(f.editor.key), f.row, 'post-confirm authority change keeps the exact stored row');
  assert.equal(f.session.acknowledgedSnapshot, null, 'post-confirm authority change issues no retirement token');
});

test('registry opens full source and separately keyed note/reply with one runtime', async t => {
  const f = await fixture(t), p = await f.open();
  const page = await f.api.view('topic_messages', { topic_id: f.facts.topic_id, limit: 1 });
  assert.equal(page.items[0].preview, true);
  assert.ok(p.source.body.length > page.items[0].body.length);
  assert.deepEqual(p.source.source_ref, f.facts.sources[0]);
  assert.notEqual(p.editors.reply.key, p.editors.note.key);
  assert.equal(p.editors.reply.context.actor, f.bootstrap.actor);
  assert.equal(p.editors.note.context.instanceId, f.bootstrap.instance_id);
  assert.equal(f.registry.sessionFor(p.editors.reply).runtime, f.registry.sessionFor(p.editors.note).runtime);
  assert.deepEqual(f.calls.filter(call => call.type === 'command'), []);
});

test('late X source cannot replace Y or create another set of editors', async t => {
  const f = await fixture(t), held = deferred(), entered = deferred();
  f.transport.view = async (name, args) => {
    const answer = await f.api.view(name, args);
    if (name === 'source' && (args.source_ref ?? args).id === f.facts.sources[0].id) { entered.resolve(); await held.promise; }
    return answer;
  };
  const openingX = f.open(0); await entered.promise;
  const y = await f.open(1);
  held.resolve(); await openingX;
  assert.equal(f.registry.current, y); assert.deepEqual(f.shown, [y]);
  const again = await f.open(1);
  assert.equal(again.editors.reply, y.editors.reply);
  assert.equal(again.editors.note, y.editors.note);
});

for (const bad of ['source instance', 'source identity', 'state instance', 'state source', 'destination']) {
  test(`open refuses mismatched ${bad} without showing or writing`, async t => {
    const f = await fixture(t);
    f.transport.view = async (name, args) => {
      const answer = await f.api.view(name, args);
      if (name === 'source' && bad === 'source instance') answer.instance_id = 'other-instance';
      if (name === 'source' && bad === 'source identity') answer.source_ref = f.facts.sources[1];
      if (name === 'editor_state' && bad === 'state instance') answer.instance_id = 'other-instance';
      if (name === 'editor_state' && bad === 'state source') answer.source_ref = f.facts.sources[1];
      if (name === 'editor_state' && bad === 'destination') answer.destination.topic_id = 'other-topic';
      return answer;
    };
    await assert.rejects(f.open(), /identity|instance|source|destination|match/i);
    assert.equal(f.shown.length, 0); assert.equal(f.rows.size, 0);
    assert.equal(f.calls.filter(call => call.type === 'command').length, 0);
  });
}

test('typing journals exact B while an earlier real save response is held', async t => {
  const f = await fixture(t), p = await f.open(), editor = p.editors.reply;
  const entered = deferred(), release = deferred();
  f.transport.command = async envelope => {
    const answer = await f.api.command(envelope);
    if (envelope.kind === 'draft.save') { entered.resolve(); await release.promise; }
    return answer;
  };
  editor.edit({ body: 'Earlier writing' }); await f.registry.edited(editor);
  const saving = f.registry.flush(editor); await entered.promise;
  editor.edit({ body: 'Newer B while network waits', caret: { start: 7, end: 7 } });
  const journaling = f.registry.edited(editor);
  await new Promise(resolve => setImmediate(resolve));
  const row = await f.journal.own(editor.key);
  assert.equal(row.snapshot.draft.body, 'Newer B while network waits');
  await journaling;
  assert.deepEqual(row.snapshot.draft.caret, { start: 7, end: 7 });
  assert.match(f.registry.status(editor), /device|not yet saved/i);
  release.resolve(); await saving;
  assert.equal(editor.draft.body, 'Newer B while network waits'); assert.equal(editor.dirty, true);
  assert.doesNotMatch(f.registry.status(editor), /^Saved to Theseus$/);
});

test('local recovery success alone never claims a server acknowledgement', async t => {
  const f = await fixture(t), p = await f.open(), editor = p.editors.note;
  f.transport.command = async () => { throw Error('Offline fixture'); };
  editor.edit({ body: 'Private local note' }); await f.registry.edited(editor);
  assert.equal((await f.journal.own(editor.key)).snapshot.draft.body, 'Private local note');
  assert.match(f.registry.status(editor), /device|not yet saved/i);
  await f.registry.flush(editor);
  assert.equal((await f.state(0)).note, null);
  assert.equal(editor.dirty, true); assert.doesNotMatch(f.registry.status(editor), /^Saved to Theseus$/);
});

test('late close after another source opened does not close the new presentation', async t => {
  const f = await fixture(t), x = await f.open(), entered = deferred(), release = deferred();
  const put = f.backend.put;
  f.backend.put = async row => {
    if (row.editorKey === x.editors.reply.key) { entered.resolve(); await release.promise; }
    return put(row);
  };
  x.editors.reply.edit({ body: 'Retain X before closing' });
  const journaled = f.registry.edited(x.editors.reply); await entered.promise;
  const closing = f.registry.close(x);
  const openingY = f.open(1);
  release.resolve(); await journaled;
  const y = await openingY; await closing;
  assert.equal(f.registry.current, y); assert.equal(f.closed.length, 0);
  assert.equal((await f.journal.own(x.editors.reply.key)).snapshot.draft.body, 'Retain X before closing');
});

test('failed recovery write blocks close while keeping writing editable', async t => {
  const f = await fixture(t), p = await f.open(), editor = p.editors.reply;
  f.backend.put = async () => { throw Error('Injected recovery quota failure'); };
  editor.edit({ body: 'Unjournaled exact writing' });
  await assert.rejects(f.registry.edited(editor), /quota|recovery/i);
  assert.equal(await f.registry.close(p), false);
  assert.equal(f.registry.current, p); assert.equal(f.closed.length, 0);
  assert.equal(editor.draft.body, 'Unjournaled exact writing');
  assert.match(f.registry.status(editor), /Recovery copy unavailable/);
  editor.edit({ body: 'Still editable' }); assert.equal(editor.draft.body, 'Still editable');
});

test('confirmed local recovery allows close while private server save is offline', async t => {
  const f = await fixture(t), p = await f.open(), editor = p.editors.reply;
  f.transport.command = async () => { throw Error('Offline fixture'); };
  editor.edit({ body: 'Recover this after closing' }); await f.registry.edited(editor);
  await f.registry.flush(editor);
  assert.equal(await f.registry.close(p), true);
  assert.deepEqual(f.closed, [p]);
  assert.equal((await f.journal.own(editor.key)).snapshot.draft.body, 'Recover this after closing');
});

test('send freezes A at the input before a journal wait and preserves B', async t => {
  const f = await fixture(t), p = await f.open(), editor = p.editors.reply;
  editor.edit({ body: 'Exact A' }); await f.registry.edited(editor);
  const entered = deferred(), release = deferred(), put = f.backend.put;
  f.backend.put = async row => { entered.resolve(); await release.promise; return put(row); };
  const sending = f.registry.send(editor, { stay: true, presentation: p });
  assert.equal(editor.submissions.at(-1).snapshot.body, 'Exact A');
  assert.equal(editor.draft.body, '');
  editor.edit({ body: 'Newer B' }); const journaled = f.registry.edited(editor);
  await entered.promise; release.resolve(); await sending; await journaled;
  const item = editor.submissions.at(-1); assert.equal(item.status, 'confirmed');
  const source = await f.api.view('source', { kind: 'message', id: item.receipt.result.message_id });
  assert.equal(source.body, 'Exact A'); assert.equal(editor.draft.body, 'Newer B');
  assert.equal(f.closed.length, 0);
});

test('late send-return preparation cannot navigate away from Y', async t => {
  const f = await fixture(t), x = await f.open(), editor = x.editors.reply;
  const entered = deferred(), release = deferred();
  f.transport.command = async envelope => {
    const answer = await f.api.command(envelope);
    if (envelope.kind === 'submission.prepare') { entered.resolve(); await release.promise; }
    return answer;
  };
  editor.edit({ body: 'A from X' }); await f.registry.edited(editor);
  const sending = f.registry.send(editor, { stay: false, presentation: x }); await entered.promise;
  editor.edit({ body: 'B from X' }); await f.registry.edited(editor);
  const y = await f.open(1);
  release.resolve(); await sending;
  assert.equal(f.registry.current, y); assert.equal(f.closed.length, 0);
  assert.equal(editor.submissions.at(-1).status, 'confirmed'); assert.equal(editor.draft.body, 'B from X');
});

test('late note-save after switching to reply cannot close that reply or send it', async t => {
  const f = await fixture(t), p = await f.open();
  f.registry.setMode('note'); const notePresentation = f.registry.current;
  const entered = deferred(), release = deferred();
  f.transport.command = async envelope => {
    f.calls.push({ type: 'command', envelope: copy(envelope) });
    const answer = await f.api.command(envelope);
    if (envelope.kind === 'note.save') { entered.resolve(); await release.promise; }
    return answer;
  };
  p.editors.note.edit({ body: 'Private note only' }); await f.registry.edited(p.editors.note);
  p.editors.reply.edit({ body: 'Unsent hidden reply' }); await f.registry.edited(p.editors.reply);
  const saving = f.registry.saveNote(p.editors.note, notePresentation); await entered.promise;
  f.registry.setMode('reply'); const replyPresentation = f.registry.current;
  release.resolve(); await saving;
  assert.equal(f.registry.current, replyPresentation); assert.equal(f.closed.length, 0);
  assert.equal(p.editors.reply.draft.body, 'Unsent hidden reply');
  assert.equal((await f.state(0)).note.body, 'Private note only');
  assert.ok(f.calls.filter(call => call.type === 'command').every(call => call.envelope.kind === 'note.save'));
});

test('opening retained pending work looks up original operations without replay', async t => {
  const f = await fixture(t), x = await f.open(), editor = x.editors.reply;
  f.transport.command = async envelope => {
    f.calls.push({ type: 'command', envelope: copy(envelope) });
    const answer = await f.api.command(envelope);
    if (envelope.kind === 'message.send') throw Error('Lost HTTP response after commit');
    return answer;
  };
  editor.edit({ body: 'One public A' }); await f.registry.edited(editor);
  await f.registry.send(editor, { stay: true, presentation: x });
  editor.edit({ body: 'Private B' }); await f.registry.edited(editor);
  const count = f.calls.filter(call => call.type === 'command').length;
  await f.open(1); const reopened = await f.open(0);
  await f.registry.checkConfirmation(reopened.editors.reply);
  assert.equal(f.calls.filter(call => call.type === 'command').length, count);
  assert.equal(reopened.editors.reply.submissions.at(-1).status, 'confirmed');
  assert.equal(reopened.editors.reply.draft.body, 'Private B');
  const messages = await f.api.view('topic_messages', { topic_id: f.facts.topic_id, limit: 50 });
  assert.equal(messages.items.filter(message => message.body === 'One public A').length, 1);
});

test('pending continuation is explicit and scoped, and discovery never sends', async t => {
  const f = await fixture(t, { pendingPageSize: 2 });
  const prepared = [];
  for (let index = 0; index < 3; index++) {
    const state = await f.state(0), draft = state.draft;
    const envelope = (kind, args, target, expected = {}) => ({ v: 1, instance_id: f.bootstrap.instance_id,
      operation_id: crypto.randomUUID(), kind, target, args, expected: { ...expected, authority: {
        authority_id: f.bootstrap.authority.authority_id, authority_epoch: f.bootstrap.authority.authority_epoch,
      } } });
    const saved = await f.api.command(envelope('draft.save', {
      source_ref: f.facts.sources[0], topic_id: f.facts.topic_id,
      generation: draft.generation, body: `Previously prepared ${index}`,
    }, { draft_id: draft.id }, { draft_revision: draft.revision }));
    assert.equal(saved.status, 'committed');
    const submission = crypto.randomUUID();
    const receipt = await f.api.command(envelope('submission.prepare', {
      draft_id: draft.id, submission_id: submission, send_operation_id: crypto.randomUUID(),
    }, { topic_id: f.facts.topic_id }, { draft_revision: saved.result.draft_revision }));
    assert.equal(receipt.status, 'committed'); prepared.push(submission);
  }
  const p = await f.open(), reply = p.editors.reply;
  const first = f.registry.pending(reply);
  assert.equal(first.items.length, 2); assert.notEqual(first.next_cursor, null);
  assert.equal(first.items.some(item => item.id === prepared.at(-1)), false);
  assert.equal(f.calls.filter(call => call.type === 'view' && call.name === 'submissions').length, 0);
  await f.registry.morePending(reply);
  const all = f.registry.pending(reply);
  assert.ok(all.items.some(item => item.id === prepared.at(-1)));
  assert.equal(all.next_cursor, null);
  const request = f.calls.find(call => call.type === 'view' && call.name === 'submissions');
  assert.deepEqual(request.args.source_ref, f.facts.sources[0]);
  assert.equal(request.args.topic_id, f.facts.topic_id); assert.equal(request.args.cursor, first.next_cursor);
  assert.equal(request.args.limit, 2);
  assert.equal(f.calls.filter(call => call.type === 'command').length, 0);
  const messages = await f.api.view('topic_messages', { topic_id: f.facts.topic_id, limit: 50 });
  assert.equal(messages.items.length, 2, 'only the two seeded sources were published');
});

test('source access refusal still exposes authorized retained writing without old source text', async t => {
  const f = await fixture(t), first = await f.open(), editor = first.editors.reply;
  editor.edit({ body: 'My retained writing' }); await f.registry.edited(editor); await f.registry.flush(editor);
  await f.open(1);
  // Injection tests the composition boundary, not actual Core revocation.
  f.transport.view = async (name, args) => {
    if (name === 'source' && (args.source_ref ?? args).id === f.facts.sources[0].id) {
      return { instance_id: f.bootstrap.instance_id, recorded: false, error: { code: 'FORBIDDEN', message: 'Source access removed' } };
    }
    const answer = await f.api.view(name, args);
    if (name === 'editor_state' && args.source_ref.id === f.facts.sources[0].id) {
      answer.source_available = false; answer.destination_available = false;
    }
    return answer;
  };
  const restored = await f.open(0);
  assert.equal(restored.sourceUnavailable, true);
  assert.equal(restored.editors.reply.draft.body, 'My retained writing');
  assert.ok(!restored.source.body, 'retained private writing does not authorize redisclosure of cached source text');
  const commands = f.calls.filter(call=>call.type==='command').length;
  restored.editors.reply.edit({body:'Continue private writing while source unavailable'});
  await f.registry.edited(restored.editors.reply); await f.registry.flush(restored.editors.reply);
  assert.equal(f.calls.filter(call=>call.type==='command').length,commands,'unavailable source writing stays local');
  assert.throws(()=>f.registry.send(restored.editors.reply),/unavailable/i);
});

test('continuous typing reaches the maximum save wait without delaying local recovery', async t => {
  let time = 0, timerId = 0;
  const jobs = new Map();
  const timers = {
    now: () => time,
    setTimeout: (action, delay) => { const id = ++timerId; jobs.set(id, { at: time + delay, action }); return id; },
    clearTimeout: id => jobs.delete(id),
    advance: duration => {
      const end = time + duration;
      for (;;) {
        const next = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at; jobs.delete(next[0]); next[1].action();
      }
      time = end;
    },
  };
  const f = await fixture(t, { timers, saveDelayMs: 20, maxSaveDelayMs: 50 });
  const p = await f.open(), editor = p.editors.reply, reached = deferred();
  f.transport.command = async envelope => {
    f.calls.push({ type: 'command', envelope: copy(envelope) });
    const answer = await f.api.command(envelope);
    if (envelope.kind === 'draft.save') reached.resolve();
    return answer;
  };
  for (let version = 0; version < 4; version++) {
    if (version) timers.advance(15);
    editor.edit({ body: `Continuous writing ${version}` }); await f.registry.edited(editor);
    assert.equal((await f.journal.own(editor.key)).snapshot.draft.body, `Continuous writing ${version}`);
    assert.equal(f.calls.filter(call => call.type === 'command').length, 0);
  }
  timers.advance(5); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(call => call.type === 'command').length, 1, 'maximum wait starts the save under continuous typing');
  await reached.promise; await f.registry.flush(editor);
  assert.equal((await f.state(0)).draft.body, 'Continuous writing 3');
  assert.equal(f.calls.filter(call => call.type === 'command').length, 1);
  assert.equal(editor.dirty, false);
});
