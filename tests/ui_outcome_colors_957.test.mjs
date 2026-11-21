import test from 'node:test';
import assert from 'node:assert/strict';
import { OutcomeColors, validOutcomeColor } from '../web/outcome-colors.mjs';
import { outcomeInvalidation } from '../web/outcome-refresh.mjs';

const bootstrap = { instance_id: 'isolated', actor: 'one', authority: { authority_id: 'a1', authority_epoch: 'e1', instance_id: 'isolated', db_path: '/isolated' } };
const receipt = (request, color, revision) => ({ instance_id: request.instance_id, operation_id: request.operation_id,
  kind: request.kind, status: 'committed', recorded: true,
  result: { workspace_id: request.target.workspace_id, color, color_revision: revision, changed: true } });
function setup(command) {
  let seq = 0; const book = new OutcomeColors({ id: () => `operation-${++seq}` });
  book.bind({ api: { command }, bootstrap }); book.accept({ id: 'w', color: null, color_revision: 0 }); return book;
}

test('957: a personal color refreshes the outcome projection and loaded counts only', () => {
  assert.deepEqual([...outcomeInvalidation([], [{ resource_kind: 'outcome_color', resource_id: 'w', version: 1 }])], ['workspace', 'counts']);
});

test('957: choice waits for its confirmed receipt and late reads cannot erase it', async () => {
  let finish, request;
  const book = setup(envelope => { request = envelope; return new Promise(resolve => { finish = resolve; }); });
  const events = []; book.listen(id => events.push(id));
  const picking = book.choose('w', 'blue'); assert.equal(book.get('w').color, null);
  assert.deepEqual(request.expected.authority, { authority_id: 'a1', authority_epoch: 'e1' });
  finish(receipt(request, 'blue', 1)); await picking;
  assert.deepEqual(book.accept({ id: 'w', color: null, color_revision: 0 }), { color: 'blue', color_revision: 1 });
  assert.deepEqual(events, ['w']);
  assert.throws(() => book.accept({ id: 'w', color: 'rose', color_revision: 1 }), /disagrees/);
});

test('957: a lost response retry keeps the exact envelope and operation', async () => {
  const requests = []; const book = setup(async envelope => { requests.push(envelope);
    if (requests.length === 1) throw Error('lost response'); return receipt(envelope, 'green', 1); });
  await assert.rejects(book.choose('w', 'green'), /lost response/);
  await book.choose('w', 'green'); assert.deepEqual(requests[0], requests[1]);
  assert.equal(book.get('w').color, 'green');
});

test('957: a different actor or authority cannot inherit choices or an in-flight receipt', async () => {
  let finish, request; const book = setup(envelope => { request = envelope; return new Promise(resolve => { finish = resolve; }); });
  const picking = book.choose('w', 'rose');
  book.bind({ api: {}, bootstrap: { ...bootstrap, actor: 'two' } });
  assert.equal(book.get('w'), null); finish(receipt(request, 'rose', 1));
  await assert.rejects(picking, /session changed/); assert.equal(book.get('w'), null);
});

test('957: a late committed response cannot reverse a newer choice or reset', async () => {
  let finish, request; const book = setup(envelope => { request = envelope; return new Promise(resolve => { finish = resolve; }); });
  const picking = book.choose('w', 'blue');
  book.accept({ id: 'w', color: null, color_revision: 2 });
  finish(receipt(request, 'blue', 1)); await picking;
  assert.deepEqual(book.get('w'), { color: null, color_revision: 2 });
});

test('957: wrong-instance or wrong-target receipts and malformed projections never paint', async () => {
  for (const alter of [r => ({ ...r, instance_id: 'elsewhere' }), r => ({ ...r, result: { ...r.result, workspace_id: 'another' } }),
    r => ({ ...r, recorded: false })]) {
    const book = setup(async request => alter(receipt(request, 'blue', 1)));
    await assert.rejects(book.choose('w', 'blue'), /could not be confirmed/); assert.equal(book.get('w').color, null);
  }
  for (const row of [{ color: 'red', color_revision: 1 }, { color: null, color_revision: -1 }, { color: 'blue' }]) assert.equal(validOutcomeColor(row), false);
});
