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
    currentCandidates: async (key, ids) => {
      const found = [], seen = new Set();
      const read = id => {
        if (seen.has(id)) return;
        seen.add(id);
        const r = rows.get(id);
        if (r?.editorKey === key && r.active === 0 && r.superseded_by) read(JSON.stringify([key, r.superseded_by]));
        else if (r?.editorKey === key && listedNow(r)) found.push({ ...copy(r), availability: 'available' });
      };
      for (const id of ids) read(id);
      return found;
    },
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
  const applied = [], settling = [];
  registry.cleanup.resumeListeners.add((session, ids, page) => {
    const validated = registry.applyRecheck(session.editor, ids, page);
    applied.push({ ids, items: page.items.map(r => [r.id, r.stamp]), held: Boolean(validated) });
    if (validated) settling.push(validated);
  });
  const register = async (draft = remote) => { const e = await registry.register(editor.context, draft); registry.current.editors.reply = e; return e; };
  const settle = async key => { await tick(); await registry.cleanup.idle(key); await Promise.all(settling); await tick(); };
  return { api, rows, backend, journal, registry, other, register, server, applied, settle, sourceRef: editor.sourceRef, note: p.editors.note };
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

test('image changes wait for the editor\'s cleanup task, so a recheck never lands between a change and its effect', async t => {
  const f = await fixture(t);
  const r1 = f.other('old-writer', 's1');
  const editor = await f.register();
  let release, changes = 0;
  const held = new Promise(resolve => { release = resolve; });
  f.registry.cleanup.enqueue(editor.key, () => held);
  const change = f.backend.changeCandidateImages;
  f.backend.changeCandidateImages = (...args) => { changes++; return change(...args); };
  const changing = f.registry.changeCandidateImages(editor, editor.imageCopies.get(r1.id), { kind: 'remove' });
  await tick();
  assert.equal(changes, 0, 'the change waits behind the running cleanup task');
  release(); await changing;
  assert.equal(changes, 1);
  assert.equal(editor.imageCopies.get(r1.id).stamp, 's1-removed');
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

test('a deferred copy another tab recovered is followed to where it moved, so it still holds the reply', async t => {
  const f = await fixture(t);
  const r1 = f.other('old-writer', 's1');
  f.server.busy = true;
  const editor = await f.register();
  assert.equal(editor.recoveryDiscovery, true);
  // Tab Y recovers r1: the writing moves under Y's own ID and r1 becomes history.
  const moved = { ...copy(r1), id: JSON.stringify([editor.key, 'tab-y']), writerId: 'tab-y', stamp: 'y1' };
  f.rows.set(moved.id, moved);
  f.rows.set(r1.id, { ...copy(r1), stamp: 'h1', active: 0, superseded_by: 'tab-y' });
  f.server.busy = false;
  f.registry.cleanup.foreground().release(); await f.settle(editor.key);
  assert.deepEqual(f.applied.map(a => a.items), [[[moved.id, 'y1']]]);
  assert.deepEqual([...editor.imageCopies.keys()], [moved.id]);
  assert.equal(editor.recoveryDiscovery, true, 'the moved copy holds the reply as a fresh discovery would');
});

test('a recheck that finds a refusal reads the server draft again, so a refusal at a later revision holds the reply', async t => {
  const f = await fixture(t);
  const r1 = f.other('old-writer', 's1', false);
  f.server.busy = true;
  // The reply's server draft, as another device saved it.
  const before = { id: 'reply-draft', generation: 'reply-generation', revision: 1, source_ref: copy(f.sourceRef), topic_id: 't1', body: 'Saved elsewhere', attachments: [] };
  const editor = await f.register(before);
  assert.equal(editor.recoveryServerDraft?.revision, 1);
  assert.equal(editor.recoveryDiscovery, false, 'a copy with no selected image does not hold the reply');
  // That device saves again, and another tab's send of r1 is refused at the new revision.
  const later = { ...copy(before), revision: 2 };
  const view = f.api.view.bind(f.api);
  f.api.view = async (name, args) => { const answer = await view(name, args); return name === 'editor_state' ? { ...answer, draft: copy(later) } : answer; };
  const refused = copy(r1);
  refused.stamp = 's2';
  refused.snapshot.submissions = [{ id: 'refused-a', status: 'refused', snapshot: copy(later), receipt: { kind: 'submission.prepare' } }];
  f.rows.set(r1.id, refused);
  f.server.busy = false;
  f.registry.cleanup.foreground().release(); await f.settle(editor.key);
  const shown = editor.imageCopies.get(r1.id);
  assert.equal(shown?.stamp, f.rows.get(r1.id).stamp, 'the copy shown is the one the journal holds');
  assert.equal(shown.snapshot.submissions[0].status, 'refused');
  assert.equal(editor.recoveryServerDraft?.revision, later.revision, 'the server draft was read again');
  assert.equal(editor.recoveryDiscovery, true, 'the refusal at the current revision holds the reply');
});

// The reply's server draft at two revisions, a copy refused at the later one,
// and editor_state answers the test releases one by one.
async function refusalAtLaterRevision(t) {
  const f = await fixture(t);
  const before = { id: 'reply-draft', generation: 'reply-generation', revision: 1, source_ref: copy(f.sourceRef), topic_id: 't1', body: 'Saved elsewhere', attachments: [] };
  const later = { ...copy(before), revision: 2 };
  const r1 = f.other('old-writer', 's1', false);
  r1.snapshot.submissions = [{ id: 'refused-a', status: 'refused', snapshot: copy(later), receipt: { kind: 'submission.prepare' } }];
  f.rows.set(r1.id, copy(r1));
  const view = f.api.view.bind(f.api), held = [], arrivals = [];
  let gated = false;
  f.api.view = async (name, args) => {
    if (name !== 'editor_state') return view(name, args);
    if (!gated) return { ...await view(name, args), draft: copy(before) };
    return new Promise((resolve, reject) => {
      held.push({ serve: async draft => resolve({ ...await view(name, args), draft: copy(draft) }), fail: () => reject(Error('busy')) });
      arrivals.shift()?.();
    });
  };
  // Resolves once n reads are held.
  const reads = n => held.length >= n ? Promise.resolve() : new Promise(resolve => arrivals.push(resolve)).then(() => reads(n));
  const editor = await f.register(before);
  assert.equal(editor.recoveryDiscovery, false, 'a refusal at a revision the server draft is not at does not hold the reply');
  gated = true;
  return { f, editor, before, later, held, reads };
}

for (const order of ['newer first', 'older first']) test(`only the latest settle's server-draft read counts (${order})`, async t => {
  const { f, editor, before, later, held, reads } = await refusalAtLaterRevision(t);
  const older = f.registry.recoveryCandidates(editor);
  await reads(1);
  const newer = f.registry.recoveryCandidates(editor);
  await reads(2);
  assert.equal(editor.recoveryDiscovery, true, 'held while the reads are out');
  if (order === 'newer first') {
    held[1].serve(later); await newer;
    held[0].serve(before); await older;
  } else {
    await held[0].serve(before);
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(editor.recoveryDiscovery, true, 'the older answer does not lower the barrier while the newer read is out');
    assert.equal(editor.recoveryServerDraft, undefined);
    held[1].serve(later); await newer; await older;
  }
  assert.equal(editor.recoveryServerDraft?.revision, 2, 'the newer read is the server draft');
  assert.equal(editor.recoveryDiscovery, true, 'the refusal at that revision holds the reply');
});

test('a recheck that brings in a refusal holds the reply at once, and still after its read fails', async t => {
  const { f, editor, held, reads } = await refusalAtLaterRevision(t);
  const [r1] = editor.imageCopies.keys();
  const validated = f.registry.applyRecheck(editor, [r1], { items: [editor.imageCopies.get(r1)], nextCursor: null });
  assert.equal(editor.recoveryDiscovery, true, 'held before the read answers');
  assert.equal(editor.recoveryServerDraft, undefined, 'the old server draft no longer dismisses the refusal');
  await reads(1);
  held[0].fail();
  await assert.rejects(validated, /busy/);
  assert.equal(editor.recoveryDiscovery, true, 'a failed read leaves the reply held');
  assert.equal(editor.recoveryServerDraft, undefined);
});

test('More versions continues the list from its own cursor, and a page from a replaced list is refused and changes nothing', async t => {
  const f = await fixture(t);
  const wb = f.other('w-b', 's-b', false);
  f.backend.next = 'cursor-b';
  const editor = await f.register();
  assert.equal(editor.recoveryDiscovery, true, 'an unread page holds the reply');
  // A fresh discovery replaces the list; it now continues from cursor-c.
  f.backend.next = 'cursor-c';
  const listed = [];
  const list = (page, continued) => listed.push([continued, page.items.map(row => row.id)]);
  await f.registry.recoveryCandidates(editor, { limit: 10 }, list);
  const copies = [...editor.imageCopies.keys()];
  // A page from the old list's cursor lands after it, and is refused.
  f.backend.next = null;
  await assert.rejects(f.registry.recoveryCandidates(editor, { cursor: 'cursor-b', limit: 10 }, list), /changed/);
  assert.deepEqual(listed.map(([continued]) => continued), [false], 'the stale page is not shown');
  assert.deepEqual([...editor.imageCopies.keys()], copies);
  assert.equal(editor.imageCopiesNext, 'cursor-c', 'the stale page leaves the list\'s own cursor');
  // The fresh list's own continuation still applies, and reading its last page lifts the hold.
  const wc = f.other('w-c', 's-c', false);
  await f.registry.recoveryCandidates(editor, { cursor: 'cursor-c', limit: 10 }, list);
  assert.deepEqual(listed.at(-1), [true, [wb.id, wc.id]]);
  assert.ok(editor.imageCopies.has(wc.id));
  assert.equal(editor.imageCopiesNext, null);
  assert.equal(editor.recoveryDiscovery, false, 'no unread page and no selected image is left');
});

test('a note\'s More versions page continues its list', async t => {
  const f = await fixture(t);
  f.backend.next = 'note-cursor';
  const listed = [];
  const list = (page, continued) => listed.push(continued);
  await f.registry.recoveryCandidates(f.note, { limit: 10 }, list);
  f.backend.next = null;
  await f.registry.recoveryCandidates(f.note, { cursor: 'note-cursor', limit: 10 }, list);
  assert.deepEqual(listed, [false, true]);
});

test('a note\'s More versions page from a replaced list is refused and changes nothing', async t => {
  const f = await fixture(t);
  const listed = [];
  const list = (page, continued) => listed.push(continued);
  f.backend.next = 'note-1';
  await f.registry.recoveryCandidates(f.note, { limit: 10 }, list);
  f.backend.next = 'note-2';
  await f.registry.recoveryCandidates(f.note, { limit: 10 }, list);
  f.backend.next = null;
  await assert.rejects(f.registry.recoveryCandidates(f.note, { cursor: 'note-1', limit: 10 }, list), /changed/);
  assert.deepEqual(listed, [false, false], 'the stale page is not shown');
  assert.equal(f.note.candidatesNext, 'note-2', 'the list keeps its own cursor');
});

test('a settle whose read is superseded finishes with the latest settle, whether its own read answered or failed', async t => {
  for (const older of ['answered', 'failed']) {
    const { f, editor, before, later, held, reads } = await refusalAtLaterRevision(t);
    const first = f.registry.recoveryCandidates(editor);
    await reads(1);
    const [r1] = editor.imageCopies.keys();
    const second = f.registry.applyRecheck(editor, [r1], { items: [editor.imageCopies.get(r1)], nextCursor: null });
    await reads(2);
    let done = false;
    const firstDone = first.then(() => { done = true; });
    if (older === 'answered') await held[0].serve(before); else held[0].fail();
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(done, false, `the older caller waits for the newer read (${older})`);
    held[1].serve(later);
    await firstDone; await second;
    assert.equal(editor.recoveryServerDraft?.revision, 2, 'when the older caller finishes, the server draft is known');
    assert.equal(editor.recoveryDiscovery, true);
  }
});

test('a settle overtaken with no read of its own, or after its read, finishes only when the latest settle has', async t => {
  for (const overtaken of ['with no read', 'after its read']) {
    const { f, editor, before, later, held, reads } = await refusalAtLaterRevision(t);
    const [r1] = editor.imageCopies.keys(), row = editor.imageCopies.get(r1);
    const uploads = f.registry.sessionFor(editor).uploads, validate = uploads.validateRetained.bind(uploads);
    let first, entered, open;
    const inside = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { open = resolve; });
    uploads.validateRetained = async () => { if (entered) { const e = entered; entered = null; e(); await gate; } return validate(); };
    if (overtaken === 'with no read') {
      // Dropping the refused copy needs no read; the next recheck brings it back.
      first = f.registry.applyRecheck(editor, [r1], { items: [], nextCursor: null });
    } else {
      first = f.registry.recoveryCandidates(editor);
      await reads(1); await held[0].serve(before);
    }
    await inside;
    const latest = f.registry.applyRecheck(editor, [r1], { items: [row], nextCursor: null });
    await reads(overtaken === 'with no read' ? 1 : 2);
    let done = false;
    const firstDone = first.then(() => { done = true; });
    open(); await tick();
    assert.equal(done, false, `a settle overtaken ${overtaken} waits for the latest read`);
    held.at(-1).serve(later);
    await firstDone; await latest;
    assert.equal(editor.recoveryServerDraft?.revision, 2, 'when it finishes, the server draft is known');
    assert.equal(editor.recoveryDiscovery, true);
  }
});

test('a later settle\'s failure is reported to its own caller, and an overtaken settle finishes quietly with the reply held', async t => {
  const { f, editor, before, held, reads } = await refusalAtLaterRevision(t);
  const first = f.registry.recoveryCandidates(editor);
  await reads(1);
  const [r1] = editor.imageCopies.keys();
  const second = f.registry.applyRecheck(editor, [r1], { items: [editor.imageCopies.get(r1)], nextCursor: null });
  await reads(2);
  await held[0].serve(before); held[1].fail();
  await first;
  await assert.rejects(second, /busy/);
  assert.equal(editor.recoveryDiscovery, true, 'the failed latest read leaves the reply held');
  assert.equal(editor.recoveryServerDraft, undefined);
});
