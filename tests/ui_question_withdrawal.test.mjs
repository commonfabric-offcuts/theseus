import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { withdrawalItem, paintWithdrawal, Withdrawals, learnWithdrawal } from '../web/question-withdrawal.mjs';
import { openMessageMenu } from '../web/message-menu.mjs';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { TopicViews } from '../web/topic-views.mjs';

const own = { id: 'ask', topic_id: 'topic', author_id: 'asker', intent: 'ask', body: 'Exact question?' };
const rights = { actor: 'asker', unavailable: false, reached: false };
const value = { by: 'asker', at_ms: 42 };

test('asker-only default and origin render leave the words and hide withdrawal elsewhere', () => {
  const doc = miniDocument(), line = doc.createElement('span');
  assert.equal(withdrawalItem(own, rights, () => {}).label, 'Withdraw question');
  for (const [item, context] of [[own, { ...rights, actor: 'owner' }], [own, { ...rights, unavailable: true }],
    [own, { ...rights, reached: true }], [{ ...own, intent: 'tell' }, rights], [{ ...own, withdrawal: value }, rights]])
    assert.equal(withdrawalItem(item, context, () => {}), null);
  line.append('Asker · time'); paintWithdrawal(line, { ...own, withdrawal: value }, doc);
  assert.equal(line.text, 'Asker · time · Question withdrawn');
  paintWithdrawal(line, { ...own, withdrawal: value }, doc);
  assert.equal(line.querySelectorAll('.question-withdrawn').length, 1);
  assert.equal(own.body, 'Exact question?');
});

test('laptop anchored menu and narrow bottom sheet render the same withdrawal act', () => {
  for (const width of [1280, 320, 375, 390]) {
    const doc = miniDocument(); doc.body = doc.byId('body');
    doc.addEventListener = () => {}; doc.removeEventListener = () => {};
    Element.prototype.contains ??= function (node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; };
    const make = doc.createElement;
    doc.createElement = tag => Object.assign(make(tag), { style: {}, offsetWidth: 220, offsetHeight: 100 });
    const anchor = doc.createElement('button'); anchor.getBoundingClientRect = () => ({ top: 100, bottom: 144, left: 30, right: 74 }); doc.body.append(anchor);
    let calls = 0;
    const item = withdrawalItem(own, rights, () => { calls++; });
    const menu = openMessageMenu({ anchor, items: [item], sheet: true, doc, win: { innerWidth: width, innerHeight: 800, matchMedia: () => ({ matches: width <= 760 }) } });
    assert.equal(menu.root.children[0].textContent, 'Withdraw question');
    assert.equal(menu.root.children[0].getAttribute('role'), 'menuitem');
    assert.equal(menu.root.querySelector('svg')?.getAttribute('data-glyph') === 'undo', true);
    assert.equal(menu.root.classList.contains('menu-sheet'), width <= 760);
    menu.root.children[0].onclick({ stopPropagation() {} });
    assert.equal(calls, 1);
    assert.equal(doc.activeElement, anchor);
  }
});

test('lost result retry keeps exact operation and pending state; old page hears no late result', async () => {
  const requests = [], learned = [], said = [];
  let fail = true, current = true, release;
  const api = { command: async request => { requests.push(structuredClone(request)); if (fail) throw Error('lost');
    return new Promise(resolve => { release = () => resolve({ status: 'committed', result: { message_id: 'ask', withdrawal: value } }); }); } };
  const control = new Withdrawals({ api, instanceId: 'fixture', authority: () => ({ authority_id: 'fixture', authority_epoch: 1 }),
    current: () => current, learned: x => learned.push(x), say: x => said.push(x) });
  await control.withdraw(own);
  assert.equal(said.at(-1), 'Whether the question was withdrawn is unknown. Press Withdraw question again.');
  fail = false;
  const pending = control.withdraw(own);
  assert.equal(control.busy.has('ask'), true);
  assert.equal(await control.withdraw(own), null);
  assert.deepEqual(requests[0], requests[1]);
  current = false; release(); await pending;
  assert.deepEqual(learned, []);
  assert.equal(said.at(-1), 'Withdrawing question…');
});

test('recorded refusal and successful result stay truthful; old reads cannot undo withdrawal', async () => {
  const said = [], learned = [];
  let receipt = { status: 'rejected', recorded: true, error: { message: 'Only whoever wrote a message edits it' } };
  const control = new Withdrawals({ api: { command: async () => receipt }, instanceId: 'fixture', authority: () => ({}),
    learned: x => learned.push(x), say: x => said.push(x) });
  await control.withdraw(own);
  assert.equal(said.at(-1), receipt.error.message);
  receipt = { status: 'committed', result: { message_id: 'ask', withdrawal: value } };
  await control.withdraw(own);
  assert.deepEqual(learned, [receipt.result]);
  assert.equal(said.at(-1), 'Question withdrawn.');
  const item = { ...own }; learnWithdrawal(item, value); learnWithdrawal(item, null);
  assert.deepEqual(item.withdrawal, value);
  const views = new TopicViews({ instanceId: 'fixture', topicId: 'topic' });
  const page = item => ({ instance_id: 'fixture', items: [item], next_cursor: null, relevant_versions: { topic: 1 } });
  views.messagesPage(page({ ...own, seq: 1, withdrawal: value }), { initial: true });
  views.messagesPage(page({ ...own, seq: 1, withdrawal: null }), { initial: true });
  assert.deepEqual(views.messages.get('ask').withdrawal, value);
});

test('the shared menu owner and scoped freshness path wire withdrawal', () => {
  const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
  assert.match(app, /withdrawalItem\(item, editRights\(\)/);
  assert.equal([...app.matchAll(/withdrawalItem\(/g)].length, 1);
  const shared = app.slice(app.indexOf('function sharedMessageMenuItems('), app.indexOf('async function withMenuSource('));
  assert.match(shared, /withdrawalItem\(item, editRights\(\)/);
  const reader = app.slice(app.indexOf('function openReaderMenu()'), app.indexOf('function learnQuestionWithdrawal('));
  assert.match(reader, /sharedMessageMenuItems\(/);
  assert.doesNotMatch(reader, /withdrawalItem\(/);
  assert.match(app, /key.startsWith\('withdrawal:'\)/);
  assert.match(app, /paintWithdrawal\(author, item/);
  const fresh = readFileSync(new URL('../web/freshness.mjs', import.meta.url), 'utf8');
  assert.match(fresh, /resource_kind === 'withdrawal'/);
});

test('narrow Reader origin leads with the terminal state and withdrawn go-ahead stops asking', async () => {
  const { mayAnswer, paintReactions } = await import('../web/reactions.mjs');
  const doc = miniDocument(), line = doc.createElement('span'); line.append('Long author · time');
  paintWithdrawal(line, { withdrawal: value }, doc, true);
  assert.equal(line.text, 'Question withdrawn · Long author · time');
  const item = { ...own, withdrawal: value, go_ahead: true, addressees: ['reader'] };
  const before = { ...item, withdrawal: null };
  const otherCard = doc.createElement('div');
  paintReactions(otherCard, before, 'observer', 'human', doc);
  assert.equal(otherCard.text.includes('Asks for a go-ahead'), true);
  paintReactions(otherCard, item, 'observer', 'human', doc);
  assert.equal(otherCard.text.includes('Asks for a go-ahead'), false);
  assert.equal(mayAnswer(item, 'reader', 'human'), false);
  const card = doc.createElement('div'); paintReactions(card, item, 'reader', 'human', doc);
  assert.equal(card.querySelector('.reaction-choice'), null);
  assert.equal(card.text.includes('Asks for a go-ahead'), false);
});

test('actual private-scope freshness notice invalidates only that withdrawal identity', async () => {
  const { Freshness } = await import('../web/freshness.mjs');
  const scope = { kind: 'actor', id: 'reader' };
  const bootstrap = { instance_id: 'fixture', actor: 'reader', authority: { authority_id: 'fixture', authority_epoch: 'epoch' } };
  const cursor = n => ({ v: 1, kind: 'checkpoint', instance_id: 'fixture', actor_id: 'reader', authority_id: 'fixture', authority_epoch: 'epoch', scope, after_seq: n });
  const f = new Freshness({ api: {}, bootstrap, topicId: 'topic', checkpoint: cursor(2), actorCheckpoint: cursor(1), read() {}, keys() {}, refresh() {} });
  await f.readWhispers(async (name, args) => {
    assert.equal(name, 'changes'); assert.deepEqual(args.scope, scope);
    return { instance_id: 'fixture', scope, items: [{ seq: 2, resource_kind: 'withdrawal', resource_id: 'ask', version: 1 }], has_more: false, checkpoint: cursor(2) };
  }, () => true);
  assert.deepEqual([...f.dirty.keys()], ['withdrawal:ask']);
});

test('late withdrawal receipt updates only its exact source and preserves newer writing', () => {
  const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
  const start = app.indexOf('function learnQuestionWithdrawal('), end = app.indexOf('// Who may edit', start);
  assert.ok(start >= 0 && end > start);
  const original = { ...own }, other = { source_ref: { kind: 'message', id: 'other' }, body: 'Other source words' };
  const writing = { body: 'Newer unsent writing', destination: 'other' }, painted = [];
  const registry = { current: { source: other, writing } };
  const learned = runInNewContext('(' + app.slice(start, end).trim() + ')', {
    views: { messages: new Map([['ask', original]]) }, learnWithdrawal, cardIn: () => null,
    feedMessages: () => new Map([['ask', original]]), stackMessages() {},
    messageEntries: new Map(), menu: { paint() {} }, registry, reader: { paintOrigin: source => painted.push(source) },
  });
  learned({ message_id: 'ask', withdrawal: value });
  assert.deepEqual(original.withdrawal, value);
  assert.equal(other.withdrawal, undefined);
  assert.deepEqual(painted, []);
  assert.deepEqual(writing, { body: 'Newer unsent writing', destination: 'other' });
  const ownSource = { source_ref: { kind: 'message', id: 'ask' }, body: own.body };
  registry.current.source = ownSource;
  learned({ message_id: 'ask', withdrawal: value });
  assert.deepEqual(ownSource.withdrawal, value);
  assert.deepEqual(painted, [ownSource]);
  assert.equal(ownSource.body, own.body);
});
