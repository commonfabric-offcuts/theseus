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

const copy = value => structuredClone(value);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

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
    const note = f.registry.setMode('note');
    assert.equal(note.source, x.source); assert.equal(note.mode, 'note');
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
    removeExact: async (id, stamp) => { if (rows.get(id)?.stamp === stamp) rows.delete(id); },
  };
  const journal = new RecoveryJournal(backend, 'fixture-document');
  const transport = {
    bootstrap: () => api.bootstrap(),
    view: (name, args) => { calls.push({ type: 'view', name, args: copy(args) }); return api.view(name, args); },
    command: envelope => { calls.push({ type: 'command', envelope: copy(envelope) }); return api.command(envelope); },
  };
  const bootstrap = await api.bootstrap();
  registry = new EditorRegistry({ api: transport, bootstrap, journal,
    present: presentation => shown.push(presentation), closed: presentation => closed.push(presentation),
    changed: editor => changes.push(editor.key), saveDelayMs: 30000, maxSaveDelayMs: 60000, ...options });
  const open = (index = 0) => registry.open(facts.sources[index], { topicId: facts.topic_id });
  const state = index => api.view('editor_state', { source_ref: facts.sources[index], topic_id: facts.topic_id });
  return { registry, api, transport, bootstrap, journal, backend, rows, calls, shown, closed, changes, facts, open, state, control };
}

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
