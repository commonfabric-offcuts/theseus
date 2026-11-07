import { editorKey } from './editor.mjs';
import { uploadProof } from './upload-cleanup.mjs';
import { supportsAdmission } from './freshness.mjs';

const copy = value => structuredClone(value);
export const same = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
};
const pair = a => a && typeof a.authority_id === 'string' && a.authority_id && typeof a.authority_epoch === 'string' && a.authority_epoch
  ? { authority_id: a.authority_id, authority_epoch: a.authority_epoch } : null;
const fields = ['body', 'attachments', 'quotes', 'addressees', 'intent', 'whisper', 'reply_to', 'exchange_id', 'caret'];
const recognizedDraft = (draft, note = false) => {
  const allowed = note ? ['body', 'caret', 'attachments', 'quotes', 'addressees'] : [...fields, 'generation'];
  return draft && Object.keys(draft).every(key => [...allowed, 'id', 'revision', 'source_ref'].includes(key)) &&
    (!Object.hasOwn(draft, 'intent') || [null, 'ask', 'tell'].includes(draft.intent)) &&
    (!Object.hasOwn(draft, 'whisper') || [null, true, false].includes(draft.whisper)) &&
    ['attachments', 'quotes', 'addressees'].every(key => !Object.hasOwn(draft, key) ||
      Array.isArray(draft[key]) && (!note || draft[key].length === 0));
};
const writing = (draft, note = false) => Object.fromEntries((note ? ['body', 'caret'] : fields)
  .filter(key => Object.hasOwn(draft, key)).map(key => [key, copy(draft[key])]));
const withoutCaret = value => { const result = copy(value); delete result.caret; return result; };

// Only the current caret is a restoration hint. Frozen tickets and attempts
// remain exact, including their original caret and every authority pin.
export function meaningfulSnapshot(snapshot) {
  const result = copy(snapshot); delete result.draft.caret; return result;
}

export function eligible(row, context) {
  try {
    const s = row.snapshot, key = editorKey(context), a = pair(s.activeAuthority);
    return row.active === 1 && !row.superseded_by && typeof row.writerId === 'string' && Boolean(row.writerId) &&
      typeof row.stamp === 'string' && Boolean(row.stamp) && row.id === JSON.stringify([key, row.writerId]) &&
      row.scope === JSON.stringify([context.instanceId, context.actor]) && row.editorKey === key &&
      s.format === 1 && s.key === key && editorKey(s.context) === key && same(s.context, context) &&
      same(s.sourceRef, context.sourceRef) && (!s.draft.source_ref || same(s.draft.source_ref, s.sourceRef)) &&
      ['reply', 'note'].includes(context.kind) && typeof s.draft.id === 'string' && Boolean(s.draft.id) &&
      Number.isInteger(s.draft.revision) && s.draft.revision > 0 &&
      recognizedDraft(s.draft, context.kind === 'note') &&
      typeof s.draft.body === 'string' && ['attachments', 'quotes', 'addressees'].every(key => Array.isArray(s.draft[key])) &&
      (context.kind === 'note' || typeof s.draft.generation === 'string' && Boolean(s.draft.generation)) &&
      Number.isInteger(s.localVersion) && s.localVersion >= 0 && s.localVersion === s.ackVersion &&
      !s.conflict && !s.authorityRecovery && a && ['initial', 'complete', 'incomplete', 'unknown'].includes(s.activeAuthority.continuity) &&
      Array.isArray(s.attempts) && Array.isArray(s.submissions) &&
      s.attempts.every(e => !e.detached && !e.error && e.dispatched === true && e.receipt?.status === 'committed' &&
        same(e.envelope?.expected?.authority, a)) &&
      s.submissions.every(item => !item.detached && !item.blocked && !item.saveConflict && item.status === 'confirmed' &&
        item.preparationConfirmed === true && same(item.authority, a) && item.receipt?.status === 'committed');
  } catch { return false; }
}

// This read-only coordinator never joins the private-save or public-send queue.
// Each captured row gets its own bounded confirmation cache and fresh bracket.
export class RecoveryCleanup {
  constructor({ api, bootstrap, journal, runtime, changed, stopped = () => false, yieldBatch = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
    Object.assign(this, { api, bootstrap, journal, runtime, changed, stopped, yieldBatch });
    this.queues = new Map(); this.requested = new Map();
    this.readTail = Promise.resolve(); this.activeRead = null; this.foregroundCount = 0;
    this.partitioned = supportsAdmission(bootstrap); this.readEpoch = 0; this.readController = null;
    this.foregroundListeners = new Set();
    // The row IDs (and own copy) whose check a read deferred, per editor and
    // bound to the session that deferred them. They are checked again once no
    // foreground read remains and the editor's queue has drained; rows deferred
    // only by a busy server wait for the next foreground release. A later check
    // of a row answers for it, and a session that is no longer registered
    // leaves nothing to check.
    this.waiting = new Map(); this.resumeListeners = new Set();
  }
  deferred(cause) { return Object.assign(Error('Background reading is deferred; the recovery copy is retained.'), { code: 'CLEANUP_DEFERRED', ...(cause ? { cause } : {}) }); }
  defer(session, error, row) {
    const key = session.editor.key, held = this.waiting.get(key);
    const entry = held?.session === session ? held : { session, ids: new Set(), own: false, ready: false };
    if (row) entry.ids.add(row.id); else entry.own = true;
    entry.ready ||= !error.cause;
    this.waiting.set(key, entry);
  }
  checking(session, rowId) {
    const key = session.editor.key, entry = this.waiting.get(key);
    if (!entry) return;
    if (rowId === undefined) entry.own = false; else entry.ids.delete(rowId);
    if (!entry.own && !entry.ids.size) this.waiting.delete(key);
  }
  // A recheck of a stopped cleanup does nothing, so only foreground reads hold this.
  resume() {
    if (this.foregroundCount) return;
    for (const [key, entry] of [...this.waiting]) {
      if (entry.session.registered?.() === false) { this.waiting.delete(key); continue; }
      if (!entry.ready || this.queues.has(key)) continue;
      this.waiting.delete(key);
      this.enqueue(key, () => this.recheck(entry)).catch(() => {});
    }
  }
  // Only the deferred rows are checked again, as the journal holds them now: a
  // row that changed is checked at its current stamp, and one that left the
  // journal is absent from the page. Listeners patch what the editor shows for
  // exactly those IDs inside this task, leaving every loaded page in place.
  async recheck({ session, ids, own }) {
    if (own) await this.retireOwn(session);
    if (!ids.size || this.stopped()) return;
    let items;
    try { items = await this.journal.current(session.editor.key, [...ids]); } catch (error) { this.report(session, error); return; }
    const page = await this.check(session, { items, nextCursor: null });
    for (const listener of this.resumeListeners) {
      try { listener(session, [...ids], page); } catch (error) { this.report(session, error); }
    }
  }
  read(operation) {
    if (this.foregroundCount) return Promise.reject(this.deferred());
    const epoch = this.readEpoch;
    const next = this.readTail.then(async () => {
      if (this.foregroundCount || this.stopped() || epoch !== this.readEpoch) throw this.deferred();
      const controller = new AbortController();
      this.readController = controller;
      const timer = setTimeout(() => controller.abort(), this.runtime.readTimeoutMs);
      const transport = Promise.resolve().then(() => operation({ signal: controller.signal, ...(this.partitioned ? { readClass: 'background' } : {}) }));
      this.activeRead = transport;
      try {
        const answer = await transport;
        if (epoch !== this.readEpoch) throw this.deferred();
        if (answer?.error?.code === 'SERVER_BUSY') throw this.deferred(Object.assign(Error(answer.error.message ?? 'Server busy'), { details: answer }));
        return answer;
      } catch (error) {
        if (epoch !== this.readEpoch) throw this.deferred();
        if (error.status === 503) throw this.deferred(error);
        throw error;
      } finally {
        clearTimeout(timer);
        if (this.activeRead === transport) { this.activeRead = null; this.readController = null; }
      }
    });
    // Occupancy follows the actual aborted/settled transport, never a timeout
    // race that could free a slot while its request is still alive.
    this.readTail = next.catch(() => {});
    return next;
  }
  foreground() {
    ++this.foregroundCount;
    if (this.partitioned) {
      ++this.readEpoch; this.readController?.abort();
      for (const listener of this.foregroundListeners) listener();
    }
    const deadline = Date.now() + this.runtime.readTimeoutMs;
    let released = false, inFlight = 0, counted = true;
    const releaseCount = () => { if (released && !inFlight && counted) { counted = false; if (!--this.foregroundCount) { for (const entry of this.waiting.values()) entry.ready = true; this.resume(); } } };
    const bounded = async (promise, controller = null) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) { controller?.abort(); throw Error('Reader request timed out. Your writing is kept.'); }
      let timer;
      try { return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => { controller?.abort(); reject(Error('Reader request timed out. Your writing is kept.')); }, remaining);
      })]); } finally { clearTimeout(timer); }
    };
    return {
      read: async operation => {
        if (!this.partitioned && this.activeRead) await bounded(this.activeRead.catch(() => {}));
        if (released || Date.now() >= deadline) throw Error('Reader request timed out. Your writing is kept.');
        const controller = new AbortController(); ++inFlight;
        const transport = Promise.resolve().then(() => operation({ signal: controller.signal }));
        const done = () => { --inFlight; releaseCount(); };
        transport.then(done, done);
        return bounded(transport, controller);
      },
      release: () => { released = true; releaseCount(); },
    };
  }
  // A read for a list the page shows, which every commit reloads. Where the
  // server keeps the lanes apart, its foreground lane gives the read room, so
  // it neither waits for background reads nor stops them: the freshness pass a
  // commit asks for runs beside that commit's list reloads. Without the
  // partition it waits its turn as any foreground read does.
  async list(operation) {
    if (this.partitioned) return operation({ readClass: 'foreground' });
    const foreground = this.foreground();
    try { return await foreground.read(operation); } finally { foreground.release(); }
  }
  enqueue(key, action) {
    const task = (this.queues.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
    this.queues.set(key, task);
    const done = () => { if (this.queues.get(key) === task) { this.queues.delete(key); this.resume(); } };
    task.then(done, done); return task;
  }
  async idle(key) { while (this.queues.has(key)) await this.queues.get(key); }
  request(session) {
    const key = session.editor.key;
    if (this.requested.has(key)) { this.requested.set(key, session); return; }
    this.requested.set(key, session);
    this.enqueue(key, async () => {
      while (this.requested.has(key) && !this.stopped()) {
        const latest = this.requested.get(key); this.requested.delete(key);
        await this.retireOwn(latest);
      }
      this.requested.delete(key);
    }).catch(() => {});
  }
  own(session) { return this.enqueue(session.editor.key, () => this.retireOwn(session)); }
  // Discovery retires the own copy, reads a page, checks it and applies it in
  // one task, so no recheck runs between the read and what it shows.
  discover(session, readPage, apply) {
    return this.enqueue(session.editor.key, async () => {
      await this.retireOwn(session);
      const page = await this.check(session, await readPage());
      apply(page); return page;
    });
  }
  report(session, error) {
    session.editor.cleanupError = error ? 'Saved; recovery-copy cleanup could not finish. Retry from Review versions.' : null;
    this.changed(session.editor);
  }
  async retireOwn(session) {
    if (this.stopped()) return false;
    this.checking(session);
    try {
      let row = await this.journal.own(session.editor.key), projected;
      if (row?.snapshot.format === 2) {
        if (session.editor.imageBusy || session.editor.imageReservation || session.uploads?.running.size || session.registered?.() === false ||
            !same(meaningfulSnapshot(session.snapshot()), meaningfulSnapshot(row.snapshot))) return false;
        const proof = await uploadProof(row, session.editor.context, { api: this.api, read: fn => this.read(fn), authority: this.runtime.current });
        if (!proof) return false;
        if (proof.release.length) {
          const original = row, next = this.releasedRow(row, proof.release);
          const current = () => !this.stopped() && session.registered?.() !== false && !session.editor.imageBusy && !session.uploads?.running.size &&
            same(meaningfulSnapshot(session.snapshot()), meaningfulSnapshot(original.snapshot));
          if (!await this.journal.releaseExact(original, next, proof.release, current, () => {
            for (const changed of next.snapshot.uploadState.entries) {
              const live = session.editor.uploadState.entries.find(e => e.selection_id === changed.selection_id);
              if (proof.release.includes(live.bytes_ref)) { live.bytes_ref = null; live.bytes_state = 'released'; live.version = changed.version; }
            }
            session.editor.uploadState.revision = next.snapshot.uploadState.revision;
          })) return false;
          row = next;
        }
        projected = proof.projected;
        if (!projected) return false;
      }
      if (!row || !same(meaningfulSnapshot(session.snapshot()), meaningfulSnapshot(row.snapshot)) ||
          !await this.confirm(projected ?? row, session.editor.context)) return false;
      const current = () => !this.stopped() && same(pair(session.authority), pair(this.runtime.current)) && same(meaningfulSnapshot(session.snapshot()), meaningfulSnapshot(row.snapshot));
      const removed = await this.journal.removeExact(session.editor.key, row.stamp, current, () => {
        if (current()) session.acknowledgedSnapshot = meaningfulSnapshot(row.snapshot);
      });
      if (removed) this.report(session, null);
      return removed;
    } catch (error) { if (error.code !== 'CLEANUP_DEFERRED') this.report(session, error); else this.defer(session, error); return false; }
  }
  releasedRow(row, ids) {
    const next = copy(row); next.stamp = crypto.randomUUID();
    for (const e of next.snapshot.uploadState.entries) if (ids.includes(e.bytes_ref)) { e.bytes_ref = null; e.bytes_state = 'released'; e.version++; }
    next.snapshot.uploadState.revision++;
    return next;
  }
  candidates(session, page) { return this.enqueue(session.editor.key, () => this.check(session, page)); }
  async check(session, page) {
    const retained = [];
    for (const row of page.items) {
      this.checking(session, row.id);
      if (row.availability === 'available' && row.snapshot?.format === 2 && this.journal.retireImageCandidate) {
        try {
          const result = await this.journal.retireImageCandidate(session.editor.key, row, async captured => {
            const proof = await uploadProof(captured, session.editor.context, { api: this.api, read: fn => this.read(fn), authority: this.runtime.current });
            if (!proof) return null;
            const next = proof.release.length ? this.releasedRow(captured, proof.release) : captured;
            const retire = proof.projected && await this.confirm(proof.projected, session.editor.context);
            return { next, ids: proof.release, retire };
          });
          if (!result?.retired) retained.push(result?.row ? { ...result.row, availability: 'available' } : row);
        } catch (error) { retained.push(row); if (error.code !== 'CLEANUP_DEFERRED') this.report(session, error); else this.defer(session, error, row); }
        continue;
      }
      if (this.stopped() || row.availability !== 'available' || !row.snapshot || !eligible(row, session.editor.context)) { retained.push(row); continue; }
      try {
        const removed = await this.journal.retireAcknowledged(session.editor.key, row,
          captured => same(captured.snapshot, row.snapshot) && this.confirm(captured, session.editor.context));
        if (!removed) retained.push(row); else this.report(session, null);
      } catch (error) { retained.push(row); if (error.code !== 'CLEANUP_DEFERRED') this.report(session, error); else this.defer(session, error, row); }
    }
    return { ...page, items: retained };
  }
  async confirm(row, context) {
    if (this.stopped() || context.instanceId !== this.bootstrap.instance_id || context.actor !== this.bootstrap.actor || !eligible(row, context)) return false;
    const s = row.snapshot, authority = pair(s.activeAuthority), note = context.kind === 'note';
    const read = fn => this.read(fn);
    const validBootstrap = b => !b?.error && b?.actor === context.actor && b.instance_id === context.instanceId &&
      same(pair(b.authority), authority) && same(pair(this.runtime.current), authority);
    const first = await read(options => this.api.bootstrap(options));
    if (!validBootstrap(first)) return false;
    const state = await read(options => this.api.view('editor_state', { source_ref: s.sourceRef, topic_id: context.topicId ?? null, limit: 1 }, options));
    const remote = note ? state?.note : state?.draft;
    const expected = { ...writing(s.draft, note), source_ref: s.sourceRef, id: s.draft.id, revision: s.draft.revision,
      ...(note ? {} : { generation: s.draft.generation }) };
    if (state?.error || state?.instance_id !== context.instanceId || !same(state.source_ref, s.sourceRef) ||
        !same(state.destination, { topic_id: context.topicId ?? null }) || state.source_available !== true ||
        !note && state.destination_available !== true || !remote || !same(withoutCaret(remote), withoutCaret(expected))) return false;
    if (note && s.submissions.length) return false;
    const operations = new Map(), submissions = new Map(); let reads = 0;
    const exact = async (name, id) => {
      if (reads && reads % 10 === 0) await this.yieldBatch();
      if (this.stopped()) throw Error('Cleanup stopped.');
      ++reads;
      return read(options => this.api.view(name, name === 'operation' ? { operation_id: id } : { submission_id: id }, options));
    };
    for (const entry of s.attempts) {
      const e = entry.envelope, r = entry.receipt;
      if (!e?.operation_id || operations.has(e.operation_id) || e.instance_id !== context.instanceId || e.v !== 1 ||
          !r?.recorded || r.status !== 'committed' || r.error || r.instance_id !== context.instanceId ||
          r.operation_id !== e.operation_id || r.kind !== e.kind) return false;
      if (entry.ticket) {
        const ticket = entry.ticket, kind = note ? 'note.save' : 'draft.save';
        if (!recognizedDraft(ticket.draft, note)) return false;
        const envelope = { v: 1, instance_id: context.instanceId, operation_id: ticket.operationId, kind,
          target: note ? { note_id: ticket.draft.id } : { draft_id: ticket.draft.id },
          expected: { [note ? 'note_revision' : 'draft_revision']: ticket.draft.revision, authority },
          args: { source_ref: ticket.sourceRef, ...writing(ticket.draft, note),
            ...(note ? {} : { topic_id: context.topicId, generation: ticket.draft.generation }) } };
        const result = note ? { note_id: ticket.draft.id, note_revision: ticket.draft.revision + 1 }
          : { draft_id: ticket.draft.id, draft_revision: ticket.draft.revision + 1, generation: ticket.draft.generation };
        if (ticket.key !== s.key || !same(ticket.sourceRef, s.sourceRef) || !same(e, envelope) || !same(r.result, result)) return false;
      } else if (!s.submissions.some(item => entry.submissionId === item.id &&
          (e.operation_id === item.prepareOperationId || e.operation_id === item.sendOperationId))) return false;
      const actual = await exact('operation', e.operation_id);
      if (!same(actual, r)) return false;
      operations.set(e.operation_id, entry);
    }
    for (const item of s.submissions) {
      if (!recognizedDraft(item.snapshot)) return false;
      if (submissions.has(item.id) || !same(item.sourceRef, s.sourceRef) || item.topicId !== context.topicId) return false;
      const prepare = operations.get(item.prepareOperationId), send = operations.get(item.sendOperationId);
      const prepareEnvelope = { v: 1, instance_id: context.instanceId, operation_id: item.prepareOperationId, kind: 'submission.prepare',
        target: { topic_id: context.topicId }, expected: { draft_revision: item.snapshot.revision, authority },
        args: { draft_id: item.snapshot.id, submission_id: item.id, send_operation_id: item.sendOperationId } };
      const sendEnvelope = { v: 1, instance_id: context.instanceId, operation_id: item.sendOperationId,
        kind: 'message.send', target: { topic_id: context.topicId },
        expected: { authority }, args: { submission_id: item.id } };
      const preparation = item.prepareReceipt?.result;
      if (!prepare || !send || !same(prepare.envelope, prepareEnvelope) || !same(send.envelope, sendEnvelope) ||
          !same(prepare.receipt, item.prepareReceipt) || !same(send.receipt, item.receipt) ||
          preparation?.submission_id !== item.id || preparation.send_operation_id !== item.sendOperationId ||
          preparation.draft_id !== item.snapshot.id || preparation.draft_revision !== item.snapshot.revision ||
          preparation.next_draft?.id !== item.snapshot.id || preparation.next_draft.revision !== item.snapshot.revision + 1 ||
          typeof preparation.next_draft.generation !== 'string' || item.receipt.result?.submission_id !== item.id) return false;
      const detail = await exact('submission', item.id);
      const expectedDetail = { ...writing(item.snapshot), source_ref: item.sourceRef, id: item.id, topic_id: item.topicId,
        draft_id: item.snapshot.id, draft_revision: item.snapshot.revision, draft_generation: item.snapshot.generation,
        prepare_operation_id: item.prepareOperationId, send_operation_id: item.sendOperationId, authority,
        instance_id: context.instanceId, send_receipt: item.receipt };
      if (!same(detail, expectedDetail)) return false;
      submissions.set(item.id, item);
    }
    // A locally allocated empty B is acknowledged only by its exact preparation
    // receipt, or a later exact save. Equality of version counters is not proof.
    if (s.attempts.length && !s.attempts.some(({ ticket, receipt }) => ticket && ticket.localVersion === s.ackVersion &&
        ticket.draft.id === s.draft.id && (note || ticket.draft.generation === s.draft.generation) &&
        receipt.result?.[note ? 'note_revision' : 'draft_revision'] === s.draft.revision &&
        same(withoutCaret(writing(ticket.draft, note)), withoutCaret(writing(s.draft, note)))) &&
        !s.submissions.some(item => same(item.prepareReceipt.result.next_draft,
          { id: s.draft.id, revision: s.draft.revision, generation: s.draft.generation }) &&
          same(withoutCaret(writing(s.draft)), { body: '', attachments: [], quotes: [], addressees: [] }))) return false;
    const last = await read(options => this.api.bootstrap(options));
    return !this.stopped() && validBootstrap(last) && same(pair(first.authority), pair(last.authority));
  }
}
