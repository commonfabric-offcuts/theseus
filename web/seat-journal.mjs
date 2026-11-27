import { validActorId } from './creation.mjs';

const copy = structuredClone;
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const template = value => typeof value === 'string' && /^template-[0-9a-f]{64}$/.test(value);
export const seatModels = new Map([['gpt-6.2-sol', 'GPT-6.2 Sol'], ['gpt-6.1-terra', 'GPT-6.1 Terra']]);
export const seatEfforts = ['low', 'medium', 'high', 'xhigh'];
const choice = args => (!Object.hasOwn(args, 'template_id') || template(args.template_id)) &&
  (!Object.hasOwn(args, 'model') || seatModels.has(args.model)) &&
  (!Object.hasOwn(args, 'reasoning_effort') || seatEfforts.includes(args.reasoning_effort));

// One private draft/request per actor, authority and outcome. No prefix clearing,
// background sending, account adoption or scan of another form's records.
export async function openSeatJournal(bootstrap, workspace, indexed = globalThis.indexedDB) {
  const authority = { authority_id: bootstrap.authority?.authority_id, authority_epoch: bootstrap.authority?.authority_epoch };
  const values = [bootstrap.instance_id, bootstrap.actor, authority.authority_id, authority.authority_epoch, workspace];
  if (!values.every(validActorId) || !indexed) throw Error('This device cannot keep an Add request safely.');
  const key = JSON.stringify(values);
  let closed = false;
  const database = await new Promise((resolve, reject) => {
    const request = indexed.open('theseus-seat-add', 1); let failed = false;
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' });
    request.onsuccess = () => { if (failed) request.result.close(); else resolve(request.result); };
    request.onerror = () => { failed = true; reject(request.error ?? Error('Add storage could not be opened.')); };
    request.onblocked = () => { failed = true; reject(Error('Another tab is blocking Add storage. Your writing is kept here.')); };
  });
  database.onversionchange = () => { closed = true; database.close(); };
  function valid(row) {
    if (!row || row.v !== 1 || row.key !== key || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
        typeof row.form?.name !== 'string' || typeof row.form?.role !== 'string' || !choice(row.form) || bytes(row) > 262144 ||
        !(row.lastSeatId === null || validActorId(row.lastSeatId))) return false;
    const request = row.request;
    if (request === null) return true;
    if (request.v !== 1 || request.instance_id !== bootstrap.instance_id || !validActorId(request.operation_id) ||
        !same(request.expected?.authority, authority) || request.target?.workspace_id !== workspace) return false;
    if (request.kind === 'workspace.hosted_seat_add') return same(request.target, { workspace_id: workspace }) &&
      Number.isSafeInteger(request.expected.workspace_revision) && request.expected.workspace_revision >= 0 &&
      request.args && choice(request.args) &&
      Object.keys(request.args).every(key => ['name', 'role', 'template_id', 'model', 'reasoning_effort'].includes(key)) &&
      typeof request.args.name === 'string' && typeof request.args.role === 'string';
    return ['workspace.hosted_seat_retry', 'workspace.hosted_seat_end'].includes(request.kind) && Object.keys(request.target).length === 2 &&
      validActorId(request.target.seat_request_id) && (Object.keys(request.args ?? {}).length === 0 ||
        request.kind === 'workspace.hosted_seat_retry' && Object.keys(request.args).length === 1 && template(request.args.template_id)) &&
      Number.isSafeInteger(request.expected.seat_revision) && request.expected.seat_revision >= 0;
  }
  const publicRow = row => { if (!row) return null; const { key: unusedKey, v: unusedV, ...value } = row; return copy(value); };
  const transaction = (mode, action) => new Promise((resolve, reject) => {
    if (closed) { reject(Error('Add storage is closed. Your writing is kept here.')); return; }
    let result, failure, tx;
    const fail = error => { failure = error; try { tx.abort(); } catch { reject(error); } };
    try {
      tx = database.transaction('drafts', mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
      tx.oncomplete = () => resolve(result ?? null);
      tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? Error('This device could not keep the Add request.'));
      if (mode === 'readwrite' && tx.durability !== 'strict') throw Error('This device cannot confirm durable Add storage.');
      action(tx.objectStore('drafts'), value => { result = value; }, fail);
    } catch (error) { if (tx) fail(error); else reject(error); }
  });
  return {
    get: () => transaction('readonly', (store, finish, fail) => {
      store.get(key).onsuccess = event => {
        const row = event.target.result;
        if (row && !valid(row)) fail(Error('This saved Add request does not match this account. It has been kept.'));
        else finish(publicRow(row));
      };
    }),
    put(value, expected) {
      const row = { ...copy(value), v: 1, key, revision: expected + 1 };
      if (!Number.isSafeInteger(expected) || expected < 0 || !valid(row)) return Promise.reject(Error('The Add draft is too large or its identity changed. Your writing is kept here.'));
      return transaction('readwrite', (store, finish, fail) => {
        store.get(key).onsuccess = event => {
          const previous = event.target.result;
          if (previous && !valid(previous)) { fail(Error('The saved Add request cannot be replaced safely.')); return; }
          if ((previous?.revision ?? 0) !== expected) { fail(Error('This Add draft changed in another tab. Reload to read it; your writing is still here.')); return; }
          store.put(row); finish(publicRow(row));
        };
      });
    },
    close() { closed = true; database.close(); },
  };
}
