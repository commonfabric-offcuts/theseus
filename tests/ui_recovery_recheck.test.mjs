import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EditorRegistry } from '../web/app-session.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
import { Api } from '../web/api.mjs';

// A recheck of deferred saved copies, through the real registry and cleanup,
// applies what the journal holds when the recheck runs: a copy that was
// adopted, changed or retired since its deferral is never written back.
const copy = structuredClone;
const tick = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
const OWN = 'fixture-writer';

// Candidate listing, image retirement, image changes and adoption follow the
// IndexedDB backend's matching rules: superseded or inactive rows never match.
function backendFor(rows) {
  const listedNow = r => r && r.active === 1 && !r.superseded_by && r.writerId !== OWN && r.kind !== 'upload-bytes-v1';
  const backend = {
    put: async row => { rows.set(row.id, copy(row)); },
    get: async id => copy(rows.get(id)),
    forEditor: async key => ({ items: [...rows.values()].filter(r => r.editorKey === key && listedNow(r)).map(r => ({ ...copy(r), availability: 'available' })), nextCursor: backend.next ?? null }),
    currentCandidates: async (key, ids) => ids.map(id => rows.get(id)).filter(r => r?.editorKey === key && listedNow(r)).map(r => ({ ...copy(r), availability: 'available' })),
    history: async () => ({ items: [], nextCursor: null }),
    capture: async (row, bytes) => { rows.set(bytes.id, copy(bytes)); rows.set(row.id, copy(row)); },
    readBytes: async (_editorId, id) => copy(rows.get(id)),
    releaseBytes: async (row, stamp, ids) => { if (rows.get(row.id)?.stamp !== stamp) return false; for (const id of ids) rows.delete(id); rows.set(row.id, copy(row)); return true; },
    removeExact: async (id, stamp) => { const row = rows.get(id); if (row?.stamp !== stamp) return false; return rows.delete(id); },
    retireAcknowledged: async () => false,
    retireImageCandidate: async (key, candidate, prove) => {
      const matches = row => row?.editorKey === key && row.snapshot.format === 2 && listedNow(row) && row.id === candidate.id && row.stamp === candidate.stamp;
      if (!matches(rows.get(candidate.id))) return null;
      const proof = await prove(copy(rows.get(candidate.id)));
      if (!proof || !matches(rows.get(candidate.id))) return null;
      if (proof.retire) { rows.delete(candidate.id); return { retired: true }; }
      if (proof.ids.length) { for (const id of proof.ids) rows.delete(id); rows.set(candidate.id, copy(proof.next)); }
      return { row: proof.next };
    },
    changeCandidateImages: async (key, candidate) => {
      const row = rows.get(candidate.id);
      if (row?.stamp !== candidate.stamp) throw Error('This saved copy changed. Review it again.');
      for (const e of row.snapshot.uploadState.entries) e.selected = false;
      row.stamp = candidate.stamp + '-removed';
      return copy(row);
    },
    adopt: async (key, { id, stamp }, guard) => {
      const current = rows.get(id);
      if (!current || current.stamp !== stamp || current.superseded_by || current.writerId === OWN || !guard()) throw Error('This recovery version changed. Review it again.');
      const ownId = JSON.stringify([key, OWN]);
      rows.set(ownId, { ...copy(current), id: ownId, writerId: OWN, stamp: 'adopted', active: 1 });
      rows.set(id, { ...copy(current), stamp: 'superseded', active: 0, superseded_by: OWN });
      return rows.get(ownId);
    },
  };
  return backend;
}

async function fixture(t) {
  const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py'], { cwd: new URL('..', import.meta.url) });
  const waiting = new Map(); let serial = 0, errors = '';
  child.stderr.on('data', bytes => { errors += bytes; });
  createInterface({ input: child.stdout }).on('line', line => { const r = JSON.parse(line), w = waiting.get(r.id); waiting.delete(r.id); r.failure ? w.reject(Error(r.failure)) : w.resolve(r.answer); });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const control = data => new Promise((resolve, reject) => { const id = ++serial; waiting.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ ...data, id }) + '\n'); });
  const facts = await control({ method: 'ready' });
  const api = new Api(facts.token, (url, init) => fetch(new URL(url, facts.origin), { ...init, headers: { ...init.headers, Origin: facts.origin } }));
  const rows = new Map(), backend = backendFor(rows);
  const journal = new RecoveryJournal(backend, OWN), bootstrap = await api.bootstrap();
  const registry = new EditorRegistry({ api, journal, bootstrap, saveDelayMs: 30000, maxSaveDelayMs: 60000 });
  t.after(async () => { registry.dispose(); child.stdin.end(); assert.equal(await exited, 0, errors); });
  const p = await registry.open(facts.sources[1], { topicId: facts.topic_id });
  const editor = p.editors.reply;
  // A real format-2 copy with a selected image, relabelled as other tabs' copies.
  const image = new File([await readFile(new URL('./fixtures/media/screen.png', import.meta.url))], 'image.png', { type: 'image/png' });
  await registry.sessionFor(editor).uploads.add(image, { start: false }); await registry.flush(editor);
  const ownId = journal.id(editor.key), own = rows.get(ownId);
  assert.equal(own.snapshot.format, 2);
  const other = (writer, stamp, selected = true) => {
    const row = { ...copy(own), id: JSON.stringify([editor.key, writer]), writerId: writer, stamp };
    if (!selected) for (const e of row.snapshot.uploadState.entries) e.selected = false;
    rows.set(row.id, row); return row;
  };
  rows.delete(ownId); registry.cancelSave(editor); registry.sessions.delete(editor.key);
  const remote = (await api.view('editor_state', { source_ref: editor.sourceRef, topic_id: editor.context.topicId })).draft;
  // While busy, every background confirmation answers SERVER_BUSY, so checks are deferred.
  const realBootstrap = api.bootstrap.bind(api), server = { busy: false };
  api.bootstrap = async (...args) => server.busy ? { error: { code: 'SERVER_BUSY', message: 'busy' } } : realBootstrap(...args);
  // The app's listener: rechecked rows patch the editor the registry holds.
  const applied = [];
  registry.cleanup.resumeListeners.add((session, ids, page) => { const validated = registry.applyRecheck(session.editor, ids, page); applied.push({ ids, items: page.items.map(r => [r.id, r.stamp]), held: Boolean(validated) }); });
  const register = async () => { const e = await registry.register(editor.context, remote); registry.current.editors.reply = e; return e; };
  const settle = async key => { await tick(); await registry.cleanup.idle(key); await tick(); };
  return { api, rows, backend, journal, registry, other, register, server, applied, settle };
}

test('a copy the replaced editor deferred and that was since adopted is not written into the new editor', async t => {
  const f = await fixture(t);
  const r1 = f.other('old-writer', 's1');
  f.other('other-writer', 's2', false);
  f.server.busy = true;
  const editor1 = await f.register();
  assert.ok(editor1.imageCopies.has(r1.id));
  // The person adopts r1 while a foreground read is in flight, so the new editor's checks are deferred too.
  const fg = f.registry.cleanup.foreground();
  f.server.busy = false;
  const editor2 = await f.registry.adoptCandidate(editor1, editor1.imageCopies.get(r1.id), f.registry.current);
  assert.notEqual(editor2, editor1);
  const barrier = editor2.recoveryDiscovery;
  fg.release(); await f.settle(editor2.key);
  assert.equal(editor2.imageCopies.has(r1.id), false, 'the adopted copy is the editor\'s own writing now');
  assert.equal(editor2.recoveryDiscovery, barrier, 'the old editor\'s deferral does not change the send barrier');
  assert.ok(f.applied.every(a => !a.ids.includes(r1.id)), 'r1 is never rechecked for the new editor');
});

test('a recheck after Remove saved image selections keeps the changed copy, not the one deferred', async t => {
  const f = await fixture(t);
  const r1 = f.other('old-writer', 's1');
  f.server.busy = true;
  const editor = await f.register();
  assert.equal(editor.recoveryDiscovery, true);
  const changed = await f.registry.changeCandidateImages(editor, editor.imageCopies.get(r1.id), { kind: 'remove' });
  assert.equal(editor.imageCopies.get(r1.id).stamp, changed.stamp);
  assert.equal(editor.recoveryDiscovery, false, 'no selection is left to review');
  f.server.busy = false;
  f.registry.cleanup.foreground().release(); await f.settle(editor.key);
  assert.deepEqual(f.applied.map(a => a.ids), [[r1.id]], 'the deferral was rechecked');
  assert.equal(editor.imageCopies.get(r1.id)?.stamp, f.rows.get(r1.id)?.stamp, 'the copy shown is the one the journal holds');
  assert.notEqual(f.rows.get(r1.id)?.stamp, 's1');
  assert.equal(editor.recoveryDiscovery, false, 'the removed selection does not come back');
});

test('a deferred copy that another tab retired is dropped from the image copies, lifting its barrier', async t => {
  const f = await fixture(t);
  const r1 = f.other('old-writer', 's1');
  f.server.busy = true;
  const editor = await f.register();
  assert.equal(editor.recoveryDiscovery, true);
  f.rows.delete(r1.id);
  f.server.busy = false;
  f.registry.cleanup.foreground().release(); await f.settle(editor.key);
  assert.deepEqual(f.applied, [{ ids: [r1.id], items: [], held: true }]);
  assert.equal(editor.imageCopies.has(r1.id), false);
  assert.equal(editor.recoveryDiscovery, false, 'the barrier is recomputed when the last copy leaves');
});

test('a recheck keeps the continuation page and its barrier', async t => {
  const f = await fixture(t);
  const r1 = f.other('old-writer', 's1');
  f.backend.next = 'page-two';
  f.server.busy = true;
  const editor = await f.register();
  assert.equal(editor.imageCopiesNext, 'page-two');
  f.rows.delete(r1.id);
  f.server.busy = false;
  f.registry.cleanup.foreground().release(); await f.settle(editor.key);
  assert.equal(editor.imageCopies.has(r1.id), false);
  assert.equal(editor.imageCopiesNext, 'page-two');
  assert.equal(editor.recoveryDiscovery, true, 'the unread page still holds the reply');
});
