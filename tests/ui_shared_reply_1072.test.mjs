import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Api } from '../web/api.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
import { fixtureControl } from './fixture_control.mjs';

const copy = value => structuredClone(value);
async function fixture(t) {
  const process = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness', '--media']);
  const { control, exit, errors } = fixtureControl(process), registries = [], reads = [];
  t.after(async () => {
    for (const registry of registries) registry.dispose();
    process.stdin.end(); assert.deepEqual(await exit, { code: 0, signal: null }); assert.equal(errors(), '');
  });
  const facts = await control({ method: 'ready' });
  const api = new Api(facts.token, (url, init) => fetch(new URL(url, facts.origin), { ...init, headers: { ...init.headers, Origin: facts.origin } }));
  const bootstrap = await api.bootstrap(), source = facts.sources[0];
  const reader = async (name, args) => { reads.push({ name, args: copy(args) }); return name === 'bootstrap' ? api.bootstrap() : api.view(name, args); };
  const tab = async (name, ref = source) => {
    const rows = new Map(), storage = { fail: false };
    const journal = new RecoveryJournal({
      put: async row => { if (storage.fail) throw Error('1072 scratch disk refused'); await storage.beforePut?.(row); rows.set(row.id, copy(row)); },
      get: async id => copy(rows.get(id)),
      forEditor: async () => ({ items: [], nextCursor: null }),
      currentCandidates: async () => [], removeExact: async (id, stamp) => { if (rows.get(id)?.stamp === stamp) rows.delete(id); },
    }, name);
    const registry = new EditorRegistry({ api, bootstrap, journal, saveDelayMs: 30000, maxSaveDelayMs: 60000 });
    registries.push(registry);
    const p = await registry.initializeCard(ref, { id: 't1' }), editor = p.editors.reply;
    return { registry, p, editor, session: registry.sessionFor(editor), journal, rows, storage };
  };
  const a = await tab('A'); a.editor.edit({ body: '1072 exact shared writing' }); await a.registry.flush(a.editor);
  const b = await tab('B');
  assert.deepEqual(b.editor.draft, a.editor.draft);
  const state = ref => api.view('editor_state', { source_ref: ref ?? source, topic_id: 't1' });
  const refresh = (read = reader, current = () => true) => b.registry.refreshSharedReply(source.id, read, current);
  const send = async () => { const item = await a.session.send(); assert.equal(item.receipt.status, 'committed'); return item; };
  return { api, facts, source, bootstrap, a, b, tab, state, refresh, send, reads, reader };
}

test('1072 real Core sent generation retires only the shared clean card writing and keeps its successor', async t => {
  const f = await fixture(t), old = copy(f.b.editor.draft); await f.send();
  const core = await f.state(), result = await f.refresh();
  assert.equal(result.retired, true); assert.equal(result.presentation, f.b.p);
  assert.equal(f.b.editor.draft.id, old.id); assert.notEqual(f.b.editor.draft.generation, old.generation);
  assert.equal(f.b.editor.draft.body, ''); assert.equal(f.b.editor.dirty, false);
  assert.deepEqual((await f.b.journal.own(f.b.editor.key)).snapshot.draft, f.b.editor.draft);
  assert.equal(f.b.editor.draft.generation, core.draft.generation);
  assert.ok(f.reads.filter(r => r.name === 'submissions').every(r => r.args.source_ref.id === f.source.id && r.args.limit === 20));
});

test('1072 never-sent shared writing stays in both sessions with no submission search', async t => {
  const f = await fixture(t), before = copy(f.b.editor.draft);
  await f.refresh(); assert.deepEqual(f.b.editor.draft, before); assert.deepEqual(f.a.editor.draft, before);
  assert.equal(f.reads.some(r => r.name === 'submissions'), false);
});

test('1072 prepared but unsent is not a committed send', async t => {
  const f = await fixture(t), before = copy(f.b.editor.draft), held = {};
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const command = f.api.command.bind(f.api);
  f.api.command = async envelope => {
    if (envelope.kind === 'message.send') { held.envelope = envelope; await waiting; }
    return command(envelope);
  };
  const sending = f.a.session.send();
  while (!held.envelope) await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal((await f.state()).draft.body, '');
    await f.refresh(); assert.deepEqual(f.b.editor.draft, before);
  } finally { release(); await sending; }
  assert.equal((await f.refresh()).retired, true);
});

test('1072 newer local B words survive a committed send in A', async t => {
  const f = await fixture(t); f.b.editor.edit({ body: 'Newer B words while A sends' });
  const before = f.b.editor.snapshot(); await f.send(); await f.refresh();
  assert.deepEqual(f.b.editor.snapshot(), before); assert.equal(f.b.editor.dirty, true);
});

test('1072 newer B input during the exact submission read fences out retirement', async t => {
  const f = await fixture(t); await f.send();
  const result = await f.refresh(async (name, args) => {
    const answer = await f.reader(name, args);
    if (name === 'submission') f.b.editor.edit({ body: 'Native-time newer writing' });
    return answer;
  });
  assert.notEqual(result?.retired, true); assert.equal(f.b.editor.draft.body, 'Native-time newer writing');
});

test('1072 a later Core writing cycle stays visible after the old sent one retires', async t => {
  const f = await fixture(t); await f.send(); f.a.editor.edit({ body: 'New remote unsent successor' }); await f.a.registry.flush(f.a.editor);
  assert.equal((await f.refresh()).retired, true); assert.equal(f.b.editor.draft.body, 'New remote unsent successor');
  assert.equal(f.b.editor.dirty, false); assert.equal((await f.state()).draft.body, 'New remote unsent successor');
});

test('1072 an unrelated source draft is preserved byte for byte', async t => {
  const f = await fixture(t), other = await f.tab('B-other', f.facts.sources[1]);
  other.editor.edit({ body: 'Unrelated never-sent draft' }); await other.registry.flush(other.editor);
  const before = other.editor.snapshot(); await f.send(); await f.refresh();
  assert.deepEqual(other.editor.snapshot(), before); assert.equal((await f.state(f.facts.sources[1])).draft.body, 'Unrelated never-sent draft');
});

test('1072 selected or unresolved image work never retires with remote text', async t => {
  const f = await fixture(t); f.b.editor.imageBusy = 1; const before = f.b.editor.snapshot();
  await f.send(); await f.refresh(); assert.deepEqual(f.b.editor.snapshot(), before);
});

test('1072 changed authority and stale freshness keep exact writing', async t => {
  const f = await fixture(t), before = f.b.editor.snapshot(); await f.send();
  await f.refresh(async (name, args) => { const value = await f.reader(name, args); return name === 'bootstrap' ? { ...value, authority: { ...value.authority, authority_epoch: 'another-epoch' } } : value; });
  assert.deepEqual(f.b.editor.snapshot(), before);
  assert.notEqual((await f.refresh(f.reader, () => false))?.retired, true); assert.deepEqual(f.b.editor.snapshot(), before);
});

test('1072 a mismatched source or committed receipt cannot retire another draft', async t => {
  const f = await fixture(t), before = f.b.editor.snapshot(); await f.send();
  await f.refresh(async (name, args) => {
    const answer = await f.reader(name, args);
    return name === 'submission' ? { ...answer, source_ref: f.facts.sources[1] } : answer;
  });
  assert.deepEqual(f.b.editor.snapshot(), before);
  await f.refresh(async (name, args) => {
    const answer = await f.reader(name, args);
    return name === 'submission' ? { ...answer, send_receipt: { ...answer.send_receipt, operation_id: 'wrong-operation' } } : answer;
  });
  assert.deepEqual(f.b.editor.snapshot(), before);
});

test('1072 failed journal keep restores exact old writing; later retry retires it', async t => {
  const f = await fixture(t), before = f.b.editor.snapshot(); await f.send(); f.b.storage.fail = true;
  await assert.rejects(f.refresh(), /1072 scratch disk refused/);
  assert.deepEqual(f.b.editor.snapshot(), before);
  f.b.storage.fail = false; assert.equal((await f.refresh()).retired, true);
});

test('1072 registration watermark skips already prepared source history', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 22; i++) {
    await f.a.session.send(); f.a.editor.edit({ body: 'Next shared cycle ' + i }); await f.a.registry.flush(f.a.editor);
  }
  const next = await f.tab('later-B'), through = next.session.sharedThrough;
  assert.ok(through >= 22); await f.send();
  const result = await next.registry.refreshSharedReply(f.source.id, f.reader, () => true);
  assert.equal(result.retired, true);
  assert.ok(f.reads.filter(r => r.name === 'submissions').every(r => r.args.cursor >= through && r.args.limit === 20));
});

test('1072 unknown continuity retains writing without a retirement read', async t => {
  const f = await fixture(t), before = copy(f.b.editor.draft); await f.send();
  f.b.registry.runtime.current.continuity = 'unknown'; await f.refresh();
  assert.deepEqual(f.b.editor.draft, before); assert.equal(f.reads.length, 0);
});

test('1072 passive canonical images retire with their sent writing without touching another row', async t => {
  const f = await fixture(t);
  f.a.editor.edit({ attachments: [{ id: f.facts.media[0].id }] }); await f.a.session.uploads.validateRetained(); await f.a.registry.flush(f.a.editor);
  const b = await f.tab('B-canonical-image'); await b.session.uploads.validateRetained();
  assert.equal(b.editor.passiveImages, true); assert.equal(b.editor.uploadState.entries[0].retained_ref.id, f.facts.media[0].id);
  const other = { id: 'another-journal-row', words: 'Keep this private copy' }; b.rows.set(other.id, copy(other));
  const sent = await f.send(); const submission = await f.api.view('submission', { submission_id: sent.id });
  assert.equal(submission.attachments[0].id, f.facts.media[0].id);
  assert.equal((await b.registry.refreshSharedReply(f.source.id, f.reader, () => true)).retired, true);
  assert.equal(b.editor.draft.attachments.length, 0); assert.equal(b.editor.uploadState.entries.length, 0);
  assert.equal(b.editor.uploadState.client_cycle_id, b.editor.clientCycleId); assert.deepEqual(b.rows.get(other.id), other);
});

test('1072 input arriving during journal keep is persisted and never folded', async t => {
  const f = await fixture(t); await f.send(); let later;
  f.b.storage.beforePut = async () => {
    delete f.b.storage.beforePut;
    f.b.editor.edit({ body: 'New B input while keeping the replacement' });
    later = f.b.registry.edited(f.b.editor);
  };
  assert.notEqual((await f.refresh())?.retired, true); await later;
  assert.equal(f.b.editor.draft.body, 'New B input while keeping the replacement');
  assert.equal((await f.b.journal.own(f.b.editor.key)).snapshot.draft.body, f.b.editor.draft.body);
  assert.equal(f.b.editor.dirty, true);
});
