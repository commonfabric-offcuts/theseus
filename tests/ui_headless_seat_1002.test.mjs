import test from 'node:test';
import assert from 'node:assert/strict';
import { SeatAddition, seatWords } from '../web/headless-seat.mjs';

const bootstrap = { instance_id: 'seat-fixture', actor: 'owner', authority: { authority_id: 'a1', authority_epoch: 'e1' } };
const workspace = { id: 'w1', version: 4 };
const form = { name: 'Evidence scribe', role: 'Keep Δ evidence.\n\nExact spaces.  ' };
const clone = structuredClone;
const committed = request => ({ instance_id: request.instance_id, operation_id: request.operation_id, kind: request.kind,
  status: 'committed', recorded: true, result: { workspace_id: 'w1', seat_request_id: 'seat-one',
    agent: { id: 'evidence-scribe', name: request.args.name, kind: 'agent' },
    seat: { id: 'seat-one', workspace_id: 'w1', agent_id: 'evidence-scribe', role: request.args.role, state: 'pending', stage: 'profile', version: 1 } } });

function journal() {
  let row = null, fail = false;
  return {
    get: async () => clone(row),
    async put(value, expected) {
      if (fail) throw Error('device full');
      assert.equal(expected, row?.revision ?? 0, 'the client uses the last confirmed device revision');
      row = { ...clone(value), revision: expected + 1 }; return clone(row);
    },
    row: () => clone(row), fail(value) { fail = value; }, close() {},
  };
}
function setup(answer = committed, saved = journal()) {
  const sent = [], reads = [];
  const api = { bootstrap: async () => clone(bootstrap), command: async request => { sent.push(clone(request)); return answer(request, sent.length); },
    view: async (name, args) => { reads.push({ name, args }); return { instance_id: bootstrap.instance_id,
      operation_id: args.operation_id, status: 'unknown', recorded: false }; } };
  let serial = 0;
  const owner = new SeatAddition({ api, bootstrap, workspace, journal: saved, id: () => `seat-op-${++serial}` });
  return { owner, saved, api, sent, reads };
}

test('one act saves its exact request before dispatch and preserves the role bytes', async () => {
  const saved = journal(); let kept;
  const { owner, sent } = setup(request => { kept = saved.row(); return committed(request); }, saved);
  await owner.load(); await owner.edit(form); const result = await owner.add();
  assert.equal(result.seat_request_id, 'seat-one'); assert.equal(sent.length, 1);
  assert.deepEqual(kept.request, sent[0]);
  assert.deepEqual([sent[0].kind, sent[0].target, sent[0].args, sent[0].expected],
    ['workspace.hosted_seat_add', { workspace_id: 'w1' }, form, { workspace_revision: 4, authority: bootstrap.authority }]);
  assert.equal(owner.row.request, null); assert.deepEqual(owner.row.form, { name: '', role: '' });
});

test('a lost answer reloads the same request and checks its operation before an exact retry', async () => {
  const first = setup(() => { throw Error('lost reply'); });
  await first.owner.load(); await first.owner.edit(form); await assert.rejects(first.owner.add(), /unconfirmed/i);
  const next = setup(committed, first.saved); await next.owner.load(); await next.owner.again();
  assert.deepEqual(next.sent[0], first.sent[0]);
  assert.deepEqual(next.reads, [{ name: 'operation', args: { operation_id: first.sent[0].operation_id } }]);
  assert.equal(next.owner.row.request, null);
});

test('seat settings and the single template stay bound across an unconfirmed Add', async () => {
  const template = { id: 'template-' + '1'.repeat(64), model: 'gpt-6.2-sol', reasoning_effort: 'high' };
  const choices = { model: 'gpt-6.1-terra', reasoning_effort: 'xhigh' };
  const first = setup(() => { throw Error('lost reply'); });
  first.owner.templates = { available: true, items: [template] };
  await first.owner.load();
  await first.owner.edit({ ...form, ...choices });
  await assert.rejects(first.owner.add(), /unconfirmed/i);
  assert.deepEqual(first.saved.row().request.args, { ...form, ...choices, template_id: template.id });
  const next = setup(request => {
    const receipt = committed(request);
    Object.assign(receipt.result.seat, choices, { template_id: template.id });
    return receipt;
  }, first.saved);
  await next.owner.load();
  await next.owner.again();
  assert.deepEqual(next.sent[0], first.sent[0]);
  assert.equal(next.owner.row.request, null);
});

test('a confirmed operation lookup settles without issuing another Add', async () => {
  const state = setup(() => { throw Error('lost reply'); });
  await state.owner.load(); await state.owner.edit(form); await assert.rejects(state.owner.add());
  state.api.view = async () => committed(state.sent[0]);
  await state.owner.again(); assert.equal(state.sent.length, 1);
});

test('a late confirmation leaves newer typed name and role intact', async () => {
  let release;
  const state = setup(request => new Promise(resolve => { release = () => resolve(committed(request)); }));
  await state.owner.load(); await state.owner.edit(form);
  const pending = state.owner.add();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const newer = { name: 'Next seat', role: 'Newer role, kept exactly.\n' };
  await state.owner.edit(newer); release(); await pending;
  assert.deepEqual(state.owner.row.form, newer);
  assert.deepEqual(state.saved.row().form, newer); assert.equal(state.saved.row().request, null);
});

test('a failed strict device write sends nothing and keeps all writing', async () => {
  const state = setup(); await state.owner.load(); await state.owner.edit(form);
  state.saved.fail(true); await assert.rejects(state.owner.add(), /device full/);
  assert.equal(state.sent.length, 0); assert.deepEqual(state.owner.row.form, form);
});

test('typed writing remains unprotected until the actual device transaction finishes', async () => {
  const state = setup(); await state.owner.load(); await state.owner.edit(form);
  const put = state.saved.put.bind(state.saved);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  state.saved.put = (...args) => new Promise((resolve, reject) => {
    release = () => put(...args).then(resolve, reject); entered();
  });
  const newer = { name: 'Next seat', role: 'This writing is still being saved.' };
  const pending = state.owner.edit(newer); await started;
  assert.equal(state.owner.unprotectedWriting, true);
  assert.deepEqual(state.owner.row.form, newer);
  assert.deepEqual(state.saved.row().form, form, 'a concurrent cache read may still see the previous committed form');
  release(); await pending;
  assert.equal(state.owner.unprotectedWriting, false);
  assert.deepEqual(state.saved.row().form, newer);
});

test('a recorded refusal clears only the request and keeps the form for correction', async () => {
  const state = setup(request => ({ ...committed(request), status: 'rejected', result: null,
    error: { code: 'NAME_TAKEN', message: 'That name belongs to someone here.' } }));
  await state.owner.load(); await state.owner.edit(form);
  await assert.rejects(state.owner.add(), /That name/);
  assert.equal(state.owner.row.request, null); assert.deepEqual(state.owner.row.form, form);
});

test('a wrong receipt cannot clear the original request or invite another actor', async () => {
  const state = setup(request => ({ ...committed(request), instance_id: 'other-instance' }));
  await state.owner.load(); await state.owner.edit(form); await assert.rejects(state.owner.add(), /unconfirmed/i);
  assert.deepEqual(state.owner.row.request, state.sent[0]);
  await state.owner.edit({ ...form, role: 'Different next writing' });
  await assert.rejects(state.owner.add(), /previous seat request/i); assert.equal(state.sent.length, 1);
});

test('the hosted status distinguishes ready from an actual hello and names uncertain creation', () => {
  assert.match(seatWords({ state: 'pending', stage: 'profile' }), /Preparing/);
  assert.match(seatWords({ state: 'ready', stage: 'ready' }), /Ready/);
  assert.doesNotMatch(seatWords({ state: 'ready', stage: 'ready' }), /said hello|finished|answered/);
  assert.match(seatWords({ state: 'refused', stage: 'starting', reason: 'thread_start_uncertain' }), /unconfirmed|uncertain/i);
});

test('an account change prevents a new Add without adopting this actor’s draft', async () => {
  const state = setup(); await state.owner.load(); await state.owner.edit(form);
  state.api.bootstrap = async () => ({ ...bootstrap, actor: 'someone-else' });
  await assert.rejects(state.owner.add(), /changed|different account/i);
  assert.equal(state.sent.length, 0); assert.deepEqual(state.owner.row.form, form);
});

test('a changed authority prevents even the old operation lookup and retains its exact request', async () => {
  const state = setup(() => { throw Error('lost reply'); });
  await state.owner.load(); await state.owner.edit(form); await assert.rejects(state.owner.add());
  const original = clone(state.owner.row.request);
  state.api.bootstrap = async () => ({ ...bootstrap, authority: { ...bootstrap.authority, authority_epoch: 'changed' } });
  await assert.rejects(state.owner.again(), /changed|different account/i);
  assert.equal(state.sent.length, 1); assert.deepEqual(state.reads, []); assert.deepEqual(state.owner.row.request, original);
});

test('safe setup retry durably keeps the original seat fence and leaves the next form intact', async () => {
  const saved = journal(); let kept;
  const state = setup(request => { kept = saved.row(); return { ...committed(request), result: {
    ...committed(request).result, agent: { id: 'evidence-scribe', name: 'Evidence scribe' },
  } }; }, saved);
  await state.owner.load(); await state.owner.edit(form);
  await state.owner.retrySeat({ id: 'seat-one', agent_id: 'evidence-scribe', version: 7, retryable: true }, 'Evidence scribe');
  assert.deepEqual(kept.request, state.sent[0]);
  assert.deepEqual([state.sent[0].kind, state.sent[0].target, state.sent[0].expected],
    ['workspace.hosted_seat_retry', { workspace_id: 'w1', seat_request_id: 'seat-one' }, { authority: bootstrap.authority, seat_revision: 7 }]);
  assert.deepEqual(state.owner.row.form, form); assert.equal(state.owner.row.request, null);
});

test('uncertain native setup cannot be retried into a replacement context', async () => {
  const state = setup(); await state.owner.load(); await state.owner.edit(form);
  await assert.rejects(state.owner.retrySeat({ id: 'seat-one', version: 7, retryable: false }), /reconciliation/);
  assert.equal(state.sent.length, 0); assert.deepEqual(state.owner.row.form, form);
});
