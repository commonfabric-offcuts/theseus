import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { waitWords, coverSheet, coverPills, coverKey } from '../web/dossier-cover.mjs';
import { configureCoverAnswers } from '../web/cover-answers.mjs';
import { configureQuestionStates, QuestionStates } from '../web/question-state.mjs';
import { Reader } from '../web/reader.mjs';

const mine = 'Waiting for your answer.', generic = 'Waiting for an answer.';
const context = viewer => ({ viewer, owner: 'owner', nameOf: id => id === 'owner' ? 'Casey' : 'Another reader', topicId: 'topic', rootId: 'root' });
const cover = waiting => ({ owner: 'owner', waiting, stands: null, payload: null, root_id: 'root', revision: 1 });
const wait = { text: 'Choose a date', actor_id: 'owner', ask_id: 'ask', message_id: 'ask', default: null };

for (const [name, value, ctx, expected] of [
  ['awaited reader', wait, context('owner'), mine],
  ['other reader', wait, context('other'), generic],
  ['missing viewer', wait, context(undefined), generic],
  ['missing context', wait, undefined, generic],
  ['legacy owner is the awaited reader', { default: null }, context('owner'), mine],
  ['legacy owner differs from reader', { default: null }, context('other'), generic],
  ['explicit actor overrides owner', { ...wait, actor_id: 'other' }, context('owner'), generic],
  ['both identities unknown', { default: null }, { viewer: null, owner: null }, generic],
]) test('1272 formatter: ' + name, () => assert.equal(waitWords(value, ctx), expected));

test('1272 generic note performs no identity lookup or mutation', () => {
  const value = { ...wait, actor_id: 'private-actor', options: [], reason: 'Legacy redundant reason' };
  const before = JSON.stringify(value);
  assert.equal(waitWords(value, { viewer: 'other', nameOf() { throw Error('unexpected identity lookup'); } }), generic);
  assert.equal(JSON.stringify(value), before);
});

test('1272 actual sheet and hover tooltip use the current awaited reader', () => {
  const doc = miniDocument(), value = cover([wait]), before = JSON.stringify(value);
  for (const [viewer, expected, label] of [['owner', mine, 'Waits on you'], ['other', generic, 'Waits on Casey']]) {
    const ctx = context(viewer), sheet = coverSheet(doc, value, ctx);
    assert.equal(sheet.querySelector('.cover-note').text, expected);
    assert.equal(sheet.querySelector('.topic-state').text, label);
    assert.match(sheet.querySelector('.topic-state').href, /message=ask/);
    assert.equal(coverPills(doc, value, ctx).querySelector('.pill-waits').title, wait.text + ' ' + expected);
  }
  assert.equal(JSON.stringify(value), before);
});

test('1272 choices, default and authored reason retain their exact words', () => {
  const value = { ...wait, options: ['Friday', 'Saturday'], default: 'Friday', reason: 'Already booked' };
  const expected = 'Options: Friday | Saturday · Default: Friday. · Already booked';
  for (const viewer of ['owner', 'other', null]) {
    assert.equal(waitWords(value, context(viewer)), expected);
    assert.equal(coverSheet(miniDocument(), cover([value]), context(viewer)).querySelector('.cover-note').text, expected);
  }
});

test('1272 changed viewer, legacy owner and actual awaited actor replace stale words', () => {
  const doc = miniDocument(), value = cover([{ text: 'Legacy wait', default: null }]);
  const ctx = context('owner'), first = coverSheet(doc, value, ctx);
  assert.equal(first.querySelector('.cover-note').text, mine);
  const other = coverSheet(doc, value, context('other'), first);
  assert.notEqual(other, first);
  assert.equal(other.querySelector('.cover-note').text, generic);
  const moved = { ...value, owner: 'other' };
  assert.notEqual(coverKey(value, ctx), coverKey(moved, ctx));
  const next = coverSheet(doc, moved, ctx, first);
  assert.equal(next.querySelector('.cover-note').text, generic);
  const explicit = coverSheet(doc, { ...moved, waiting: [{ ...wait, actor_id: 'owner' }] }, ctx, next);
  assert.equal(explicit.querySelector('.cover-note').text, mine);
  assert.equal(explicit.querySelector('.topic-state').text, 'Waits on you');
});

test('1272 unrelated cover revision retains the wait row and modeled focus', () => {
  const doc = miniDocument(), ctx = context('other'), value = { ...cover([wait]), stands: 'Before' };
  const root = doc.byId('root'), first = coverSheet(doc, value, ctx); root.append(first);
  const row = first.querySelector('.cover-wait'), words = row.querySelector('.cover-words'); words.focus();
  assert.equal(row.querySelector('.cover-note').text, generic);
  const next = coverSheet(doc, { ...value, stands: 'After', revision: 2 }, ctx, first);
  assert.equal(next, first);
  assert.equal(next.querySelector('.cover-wait'), row);
  assert.equal(doc.activeElement, words);
});

for (const state of ['resolved', 'withdrawn', 'superseded']) test('1272 ' + state + ' wait stays absent after an older cover read', t => {
  const states = new QuestionStates(); configureQuestionStates(states); t.after(() => configureQuestionStates(null));
  const doc = miniDocument(), value = cover([wait]);
  assert.equal(coverSheet(doc, value, context('other')).querySelectorAll('.cover-wait').length, 1);
  states.learn('ask', { state, waiting_on: [], may_resolve: false });
  assert.equal(coverSheet(doc, value, context('other')).querySelectorAll('.cover-wait').length, 0);
  assert.equal(coverPills(doc, value, context('other')), null);
});

test('1272 answer button click and keyboard isolation keep current identity/revision', async t => {
  const sent = [], doc = miniDocument();
  configureCoverAnswers(() => ({ reactions: { answer: async (message, answer) => sent.push({ message, answer }) }, changed() {} }));
  t.after(() => configureCoverAnswers(null));
  const value = cover([{ ...wait, go_ahead: true, answer_revision: 7 }]);
  const sheet = coverSheet(doc, value, context('owner')), button = sheet.querySelector('.cover-answer');
  let stopped = 0; button.onkeydown({ stopPropagation() { stopped++; } }); assert.equal(stopped, 1);
  await button.onclick({ stopPropagation() { stopped++; } });
  assert.equal(sent[0].message.id, 'ask'); assert.equal(sent[0].message.reactions.answer_revision, 7); assert.equal(sent[0].answer, 'yes');
  const updated = { ...value, waiting: [{ ...value.waiting[0], answer_revision: 8 }] };
  const next = coverSheet(doc, updated, context('owner'), sheet);
  assert.notEqual(next.querySelector('.cover-answer'), button);
  await next.querySelectorAll('.cover-answer')[1].onclick({ stopPropagation() {} });
  assert.equal(sent[1].message.reactions.answer_revision, 8); assert.equal(sent[1].answer, 'no');
  assert.equal(coverSheet(doc, updated, context('other')).querySelectorAll('.cover-answer').length, 0);
});

test('1272 actual Reader cover paint follows reader changes and keeps its opened dossier', t => {
  const doc = miniDocument(), previous = globalThis.document; globalThis.document = doc;
  t.after(() => { globalThis.document = previous; });
  const host = doc.byId('reader-cover'), line = doc.byId('reader-cover-line'); host.append(line);
  let viewer = 'owner';
  const reader = Object.assign(Object.create(Reader.prototype), { $: id => doc.byId(id), callbacks: {
    actor: () => viewer, actorName: id => id, dossierCover: () => ({ cover: cover([wait]), rootId: 'root', topicId: 'topic' }),
  } });
  const source = { source_ref: { kind: 'message', id: 'root' } };
  reader.paintCover(source); host.open = true;
  assert.equal(host.querySelector('.cover-note').text, mine);
  viewer = 'other'; reader.paintCover(source);
  assert.equal(host.querySelector('.cover-note').text, generic);
  assert.equal(host.open, true);
  assert.equal(line.querySelector('.reader-cover-words').text, 'Something waits on owner');
});
