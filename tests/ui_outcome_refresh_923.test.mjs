import test from 'node:test';
import assert from 'node:assert/strict';
import { OutcomeChanges, outcomeInvalidation } from '../web/outcome-refresh.mjs';

const bootstrap = { instance_id: 'fixture', actor: 'reader', authority: { authority_id: 'a', authority_epoch: 'e' }, transport: { read_admission: {
  version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } } } };
const page = (scope, { cursor = null, seq = 0, items = [], more = false } = {}) => {
  const versions = scope.kind === 'workspace' ? { workspace: 1, notebook: 0 } : {};
  const end = { v: 1, kind: more ? 'continuation' : 'checkpoint', instance_id: 'fixture', authority_id: 'a', authority_epoch: 'e', actor_id: 'reader', scope, after_seq: seq,
    ...(more ? { through_seq: seq + 1, covered_versions: versions } : {}) };
  return { instance_id: 'fixture', scope, baseline: cursor === null, items, has_more: more,
    continuation: more ? end : null, checkpoint: more ? null : end, covered_versions: more ? null : versions };
};

test('904 Live list key invalidates only outcomes and a failed or older read cannot accept a later key', async () => {
  const changes = new OutcomeChanges({ bootstrap, workspaceId:'w', outcomesKey:'first', api:{ view:async(_name,args)=>page(args.scope,{cursor:args.cursor}) } });
  await changes.baseline();
  assert.equal(typeof changes.observe,'function');
  changes.observe({kind:'commit',seq:1,outcomes:'first'});
  assert.deepEqual([...((await changes.next()).dirty)],[],'ordinary commit has no list refresh');
  changes.observe({kind:'commit',seq:2,outcomes:'second'});
  const read=await changes.next();assert.deepEqual([...read.dirty],['outcomes']);
  assert.deepEqual([...(await changes.next()).dirty],['outcomes'],'a failed list read remains owed');
  changes.observe({kind:'commit',seq:3,outcomes:'third'});read.accept();
  const later=await changes.next();assert.deepEqual([...later.dirty],['outcomes'],'older read cannot accept third');
  later.accept();assert.deepEqual([...(await changes.next()).dirty],[]);
});

test('923 scoped change keys map to the existing list owners, leaving private writing alone', () => {
  const key = resource_kind => ({ resource_kind });
  assert.deepEqual([...outcomeInvalidation([], [key('draft'), key('note'), key('submission')])], []);
  assert.deepEqual([...outcomeInvalidation([key('memory')], [])], ['references']);
  assert.deepEqual([...outcomeInvalidation([key('tool_use')], [])], ['tools']);
  assert.deepEqual([...outcomeInvalidation([], [key('memory_star')])], ['pages']);
  assert.deepEqual([...outcomeInvalidation([], [key('acts')])], ['stars']);
  assert.equal(outcomeInvalidation([key('new-public-key')], []).has('workspace'), true);
});

test('923 B2 ordinary commits never dirty the global outcomes list', () => {
  for (const kind of ['topic', 'pipeline', 'new-public-key']) {
    const dirty = outcomeInvalidation([{ resource_kind: kind }], []);
    assert.equal(dirty.has('outcomes'), false, 'workspace-scoped ' + kind);
    assert.equal(dirty.has('topics'), true);
  }
  for (const kind of ['waiting', 'delivery', 'mark']) {
    const dirty = outcomeInvalidation([], [{ resource_kind: kind }]);
    assert.equal(dirty.has('outcomes'), false, 'actor-scoped ' + kind);
    assert.equal(dirty.has('topics'), true); assert.equal(dirty.has('standing'), true);
  }
  for (const [workspace, actor] of [[[{ resource_kind: 'workspace' }], []], [[], [{ resource_kind: 'workspace' }]],
    [[], [{ resource_kind: 'participation' }]], [[], [{ resource_kind: 'outcome_order' }]]]) {
    assert.equal(outcomeInvalidation(workspace, actor).has('outcomes'), true, 'explicit outcome/own-actor change retains the global refresh');
  }
});

test('923 a completed scoped window advances only when its views were accepted', async () => {
  const calls = []; let head = 0;
  const api = { view: async (_name, args) => {
    calls.push(args);
    return page(args.scope, { cursor: args.cursor, seq: head, items: args.cursor && head > args.cursor.after_seq && args.scope.kind === 'workspace'
      ? [{ seq: head, resource_kind: 'checks', resource_id: 'check', version: 1 }] : [] });
  } };
  const changes = new OutcomeChanges({ api, bootstrap, workspaceId: 'w' }); await changes.baseline();
  head = 2;
  const failedViews = await changes.next(); assert.equal(failedViews.dirty.has('targets'), true);
  assert.equal(changes.cursors[0].after_seq, 0, 'not accepted while a panel failed');
  const retry = await changes.next(); retry.accept();
  assert.equal(changes.cursors[0].after_seq, 2);
  assert.deepEqual(calls.filter(args => args.cursor).map(args => args.cursor.after_seq), [0, 0, 0, 0]);
});

test('923 continuation failure keeps the old checkpoint and a later retry rereads the complete window', async () => {
  let failed = true;
  const changes = new OutcomeChanges({ bootstrap, workspaceId: 'w', api: { view: async (_name, args) => {
    if (!args.cursor) return page(args.scope);
    if (args.scope.kind === 'actor') return page(args.scope, { cursor: args.cursor, seq: 2 });
    if (args.cursor.kind === 'continuation') {
      if (failed) throw Error('lost continuation');
      return page(args.scope, { cursor: args.cursor, seq: 2, items: [{ seq: 2, resource_kind: 'memory', resource_id: 'n', version: 1 }] });
    }
    return page(args.scope, { cursor: args.cursor, seq: 1, more: true, items: [{ seq: 1, resource_kind: 'checks', resource_id: 'c', version: 1 }] });
  } } });
  await changes.baseline();
  await assert.rejects(changes.next(), /lost continuation/);
  assert.equal(changes.cursors[0].after_seq, 0);
  failed = false; const next = await changes.next();
  assert.deepEqual([...next.dirty], ['targets', 'standing', 'references']);
  next.accept(); assert.equal(changes.cursors[0].after_seq, 2);
});

test('923 a foreign cursor or retired page cannot advance scoped state', async () => {
  let current = true, foreign = false;
  const changes = new OutcomeChanges({ bootstrap, workspaceId: 'w', current: () => current, api: { view: async (_name, args) => {
    const answer = page(args.scope, { cursor: args.cursor, seq: args.cursor ? 2 : 0 });
    if (foreign) answer.checkpoint.actor_id = 'someone-else';
    return answer;
  } } });
  await changes.baseline(); foreign = true;
  await assert.rejects(changes.next(), /different binding or scope/);
  assert.equal(changes.cursors[0].after_seq, 0);
  foreign = false; current = false;
  const next = await changes.next(); next.accept();
  assert.equal(changes.cursors[0].after_seq, 0);
});
