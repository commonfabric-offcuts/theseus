import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { QuestionStates, configureQuestionStates, questionOf, questionPill, Resolutions } from '../web/question-state.mjs';
import { coverPills, coverKey } from '../web/dossier-cover.mjs';
import { mayAnswer } from '../web/reactions.mjs';
import { stackCover } from '../web/stack-order.mjs';
import { Reader } from '../web/reader.mjs';

const resolved = { state: 'resolved', by: 'asker', at_ms: 42, waiting_on: [], may_resolve: false, superseded_by: null };
const waiting = { state: 'waiting', waiting_on: ['person'], may_resolve: true, by: null, at_ms: null, superseded_by: null };
const item = { id: 'ask', topic_id: 'topic', question: waiting };
const context = { viewer: 'asker', nameOf: id => id, topicId: 'topic', rootId: 'root' };

test('Reader names exact question, keeps Core-authorized waiting/Resolve actions and omits terminal labels', () => {
  configureQuestionStates(new QuestionStates());
  const doc = miniDocument(); let called;
  const pill = questionPill(doc, item, { resolve: id => { called = id; } });
  assert.equal(pill.tagName, 'BUTTON'); assert.equal(pill.textContent, 'Waiting on person');
  pill.onclick(); assert.equal(called, 'ask');
  assert.equal(questionPill(doc, { ...item, question: { ...waiting, may_resolve: false } }, { resolve() {} }).tagName, 'SPAN');
  const done = questionPill(doc, { ...item, question: resolved });
  assert.equal(done, null);
  assert.equal(questionOf({ ...item, question: waiting }).state, 'resolved', 'closure survives removal of its display');
});

test('receipt removes wait from every cover immediately and stale reads cannot restore it', () => {
  const states = new QuestionStates(); configureQuestionStates(states);
  const cover = { stands: '', waiting: [{ ask_id: 'ask', actor_id: 'person', text: 'Question?' }], payload: null };
  const before = coverKey(cover, context);
  assert.notEqual(coverPills(miniDocument(), cover, context), null);
  states.learn('ask', resolved);
  assert.equal(coverPills(miniDocument(), cover, context), null);
  assert.notEqual(coverKey(cover, context), before);
  assert.deepEqual(stackCover({ head: { id: 'root', acts: { cover } }, replies: [] }, { alone: true }).waiting, []);
  assert.equal(states.of({ ...item, question: waiting }).state, 'resolved');
  assert.equal(states.cover(cover).waiting.length, 0);
  assert.equal(mayAnswer({ ...item, go_ahead: true, addressees: ['person'] }, 'person', 'human'), false);
  assert.equal(cover.waiting.length, 1, 'the cached older server record itself is not rewritten');
  configureQuestionStates(new QuestionStates());
  assert.notEqual(coverPills(miniDocument(), cover, context), null, 'another page/instance has a fresh cache');
});

test('archived question projections hide pills even after a terminal fact was cached', () => {
  const states = new QuestionStates(); configureQuestionStates(states);
  const doc = miniDocument();
  assert.equal(questionPill(doc, { ...item, question: { ...waiting, archived: true } }), null);
  states.learn('ask', resolved);
  assert.equal(questionPill(doc, { ...item, question: { ...resolved, archived: true } }), null);
  assert.equal(questionPill(doc, { ...item, question: { ...resolved, archived: false } }), null);
  const cover = { waiting: [{ ask_id: 'unclosed', text: 'Question?' }] };
  states.archived = true;
  assert.deepEqual(states.cover(cover).waiting, []);
  states.archived = false;
  assert.equal(states.cover(cover), cover, 'archival hides cached pills without destroying their records');
});

test('superseded fact keeps its successor without a label; withdrawal and ordinary thumb Undo stay separate', () => {
  const states = new QuestionStates(); configureQuestionStates(states);
  const doc = miniDocument();
  const old = questionPill(doc, { ...item, question: { ...resolved, state: 'superseded', superseded_by: 'new' } });
  assert.equal(old, null);
  assert.equal(states.of({ ...item, question: waiting }).superseded_by, 'new');
  states.of({ id: 'other', withdrawal: { by: 'asker', at_ms: 42 } });
  assert.deepEqual(states.cover({ waiting: [{ ask_id: 'other' }] }).waiting, []);
  states.of({ id: 'plain', question: { ...waiting, state: 'answered' } });
  assert.equal(states.of({ id: 'plain', question: waiting }).state, 'waiting');
});

test('unknown outcome retries identical operation; duplicate press and old page never apply a late result', async () => {
  let fail = true, current = true, release; const requests = [], learned = [];
  const control = new Resolutions({ instanceId: 'fixture', authority: () => ({ authority_id: 'a', authority_epoch: 'e' }),
    api: { command: async request => { requests.push(structuredClone(request)); if (fail) throw Error('lost');
      return new Promise(done => { release = () => done({ instance_id: 'fixture', status: 'committed', result: { message_id: 'ask', question: resolved } }); }); } },
    current: () => current, learned: result => learned.push(result) });
  await control.resolve('ask'); fail = false;
  const pending = control.resolve('ask'); assert.equal(await control.resolve('ask'), null);
  assert.deepEqual(requests[0], requests[1]); current = false; release(); await pending;
  assert.deepEqual(learned, []);
});

test('receipt is learned before reload callback and mismatched receipt never closes a wait', async () => {
  const events = []; let receipt = { instance_id: 'other', status: 'committed', recorded: true, result: { message_id: 'ask', question: resolved } };
  const control = new Resolutions({ instanceId: 'fixture', authority: () => ({}), api: { command: async () => receipt },
    learned: () => events.push('paint'), recorded: () => events.push('reload') });
  await control.resolve('ask'); assert.deepEqual(events, []); assert.equal(control.pending.size, 1);
  receipt = { ...receipt, instance_id: 'fixture' }; await control.resolve('ask');
  assert.deepEqual(events, ['paint', 'reload']); assert.equal(control.pending.size, 0);
});

test('151 removal suppresses stale question controls and cover waits without inventing a closure', () => {
  const states = new QuestionStates(); configureQuestionStates(states);
  const doc = miniDocument(), stale = { ...item };
  const cover = { waiting: [{ ask_id: 'ask', actor_id: 'person', text: 'Question?' }] };
  assert.notEqual(questionPill(doc, stale, { resolve() {} }), null);
  assert.equal(questionPill(doc, { ...stale, removal: { kind: 'retracted', by: 'asker', at_ms: 45 } }, { resolve() {} }), null);
  assert.equal(questionPill(doc, stale, { resolve() {} }), null, 'a late source cannot restore the question control');
  assert.deepEqual(states.cover(cover).waiting, []);
  assert.equal(states.closed.has('ask'), false, 'removal does not manufacture a question closure');
  assert.equal(cover.waiting.length, 1);
  configureQuestionStates(new QuestionStates());
});

function originFixture(t) {
  const previous = globalThis.document, doc = miniDocument(); globalThis.document = doc;
  const states = new QuestionStates(); configureQuestionStates(states);
  t.after(() => { globalThis.document = previous; configureQuestionStates(null); });
  const origin = doc.createElement('div'), calls = [];
  const reader = Object.assign(Object.create(Reader.prototype), {
    $: id => { assert.equal(id, 'reader-origin'); return origin; }, sourceBody: doc.createElement('div'),
    callbacks: { actor: () => 'viewer', actorName: id => id, resolveQuestion: id => calls.push(id) }, paintTone() {},
  });
  return { origin, reader, states, calls };
}
test('1239 actual Reader origin omits resolved/superseded labels while keeping author/time/edit and facts', t => {
  const f = originFixture(t);
  for (const state of ['resolved', 'superseded']) {
    const source = { author: 'asker', author_kind: 'human', source_ref: { kind: 'message', id: state }, topic_id: 'topic',
      sent_ms: 42, revision: 2, edited_ms: 43, question: { ...resolved, state, superseded_by: state === 'superseded' ? 'next' : null } };
    for (let i = 0; i < 16; i++) f.reader.paintOrigin(source);
    assert.equal(f.origin.querySelectorAll('.question-state').length, 0);
    assert.match(f.origin.text, /asker/); assert.ok(f.origin.querySelector('time')); assert.ok(f.origin.querySelector('.message-edited'));
    assert.equal(f.states.closed.get(state).state, state);
    assert.doesNotMatch(f.origin.text, /Resolved|Superseded/);
  }
});
test('1239 actual Reader keeps Waiting/Resolve activation and retires only its resolved display', t => {
  const f = originFixture(t), source = { author: 'asker', author_kind: 'human', source_ref: { kind: 'message', id: 'question-action' },
    topic_id: 'topic', question: waiting };
  f.reader.paintOrigin(source);
  const control = f.origin.querySelector('button.question-state');
  assert.ok(control); assert.equal(control.textContent, 'Waiting on person'); control.onclick();
  assert.deepEqual(f.calls, ['question-action']);
  source.question = resolved; f.reader.paintOrigin(source);
  assert.equal(f.origin.querySelector('.question-state'), null);
  assert.equal(f.states.closed.get('question-action').state, 'resolved');
  assert.equal(mayAnswer({ id: 'question-action', question: waiting, go_ahead: true, addressees: ['person'] }, 'person', 'human'), false);
});
