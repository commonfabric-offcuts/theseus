// Focused owner/DOM contracts; native timing and pixels belong to Flex.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as reactions from '../web/reactions.mjs';
import { MessageMenu } from '../web/message-menu.mjs';
import { StackFeed } from '../web/stack-feed.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { readNow } from '../web/card-reading.mjs';
import { AttemptError } from '../web/api.mjs';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';

for (const [name, get] of Object.entries({ ownerDocument() { return this.document; }, parentElement() { return this.parent; },
  parentNode() { return this.parent; }, firstElementChild() { return this.children[0] ?? null; } }))
  Object.defineProperty(Element.prototype, name, { configurable: true, get });

const value = on => ({ version: on ? 1 : 0, thumbs: on ? [{ actor_id: 'reader' }] : [], answers: [], thumb_revision: on ? 1 : 0, answer_revision: 0 });
const item = (id = 'm', on = false) => ({ id, seq: 1, author_id: 'writer', body: 'Exact words', unread: true, reactions: value(on) });
const answer = on => ({ instance_id: 'fixture', message_id: 'm', go_ahead: false, reactions: value(on) });
const committed = { status: 'committed', recorded: true, result: { message_id: 'm', topic_id: 't', seq: 1, mark_revision: 2, settled: true } };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture({ on = false, readFails = false } = {}) {
  const doc = miniDocument(), card = doc.createElement('button'), reader = doc.createElement('button');
  const messages = new Map([['m', item('m', on)]]), command = deferred(), read = deferred(), heard = [], envelopes = [];
  let current = true, authority = { authority_id: 'a', authority_epoch: 1 };
  card.dataset.id = 'm';
  let client;
  const paint = () => {
    reactions.paintReactions(card, messages.get('m'), 'reader', 'human', doc, client?.pending?.get('m') ?? null);
    reactions.paintReaderThumb(reader, messages.get('m'), 'reader', client?.busy.has('m') ?? false, client?.pending?.get('m') ?? null);
  };
  client = new reactions.Reactions({ instanceId: 'fixture', authority: () => authority, current: () => current,
    api: { command: envelope => { envelopes.push(envelope); return command.promise; },
      view: async () => { heard.push('read'); if (readFails) throw Error('Read unavailable'); return read.promise; } },
    changed: id => { heard.push(['pending', id, client.pending?.get(id) ?? null]); paint(); },
    cleared: result => heard.push(['cleared', result.mark_revision]),
    learned: result => { heard.push('learned'); reactions.learnReactions(messages, result); paint(); },
    recorded: () => heard.push('recorded') });
  paint();
  return { client, card, reader, messages, command, read, heard, envelopes, retire: () => { current = false; },
    changeAuthority: () => { authority = { authority_id: 'b', authority_epoch: 2 }; } };
}

test('1238 held command immediately shows pending, not a recorded thumb, and duplicate presses send once', async () => {
  const f = fixture(), sending = f.client.thumb(f.messages.get('m'), true);
  try {
    assert.equal(f.card.querySelector('.reaction-pending')?.textContent, '👍 Saving…');
    assert.equal(f.reader.getAttribute('aria-busy'), 'true');
    assert.equal(f.reader.getAttribute('aria-pressed'), 'false');
    assert.equal(f.messages.get('m').reactions.thumb_revision, 0);
    assert.equal(f.card.querySelector('.reaction-count'), null);
    assert.equal(await f.client.thumb(f.messages.get('m'), true), null);
    assert.equal(f.envelopes.length, 1);
  } finally { f.command.resolve(committed); f.read.resolve(answer(true)); await sending; }
  assert.equal(f.reader.getAttribute('aria-pressed'), 'true');
  assert.equal(f.reader.getAttribute('aria-busy'), null);
  assert.equal(f.card.querySelector('.reaction-pending'), null);
  assert.equal(f.client.busy.size, 0);
  assert.equal(f.client.pending.size, 0);
  assert.ok(f.heard.findIndex(x => Array.isArray(x) && x[0] === 'cleared') < f.heard.indexOf('learned'));
});

test('1238 receipt before held reconciliation keeps the aggregate and pressed state unconfirmed', async () => {
  const f = fixture(), sending = f.client.thumb(f.messages.get('m'), true);
  try {
    f.command.resolve(committed); await Promise.resolve(); await Promise.resolve();
    assert.ok(f.heard.includes('read'));
    assert.equal(f.messages.get('m').reactions.thumb_revision, 0);
    assert.equal(f.reader.getAttribute('aria-pressed'), 'false');
    assert.equal(f.card.querySelector('.reaction-pending')?.textContent, '👍 Saving…');
  } finally { f.read.resolve(answer(true)); await sending; }
});

test('1238 refused removal retains the recorded thumb and retires only local pending feedback', async () => {
  const f = fixture({ on: true }), said = [], sending = f.client.thumb(f.messages.get('m'), false, failure => said.push(failure));
  try {
    assert.equal(f.card.querySelector('.reaction-pending')?.textContent, '👍 Removing…');
    assert.equal(f.reader.getAttribute('aria-pressed'), 'true');
  } finally {
    f.command.resolve({ status: 'rejected', recorded: true, error: { code: 'FORBIDDEN', message: 'Fixture refuses' } });
    f.read.resolve(answer(true)); await sending;
  }
  assert.equal(said.length, 1); assert.equal(f.reader.getAttribute('aria-pressed'), 'true');
  assert.equal(f.card.querySelector('.reaction-pending'), null);
  assert.equal(f.heard.some(x => Array.isArray(x) && x[0] === 'cleared'), false);
});

test('1238 unknown command plus failed read keeps prior truth and reports uncertainty without resending', async () => {
  const f = fixture({ readFails: true }), sending = f.client.thumb(f.messages.get('m'), true);
  f.command.reject(new AttemptError('Connection interrupted. Confirmation is unknown; your writing is kept.'));
  await assert.rejects(sending, /whether that was saved is unknown/);
  assert.equal(f.messages.get('m').reactions.thumb_revision, 0);
  assert.equal(f.reader.getAttribute('aria-pressed'), 'false');
  assert.equal(f.reader.getAttribute('aria-busy'), null); assert.equal(f.envelopes.length, 1);
});

for (const retirement of ['retire', 'changeAuthority']) test(`1238 ${retirement} prevents a late receipt/read from painting the successor`, async () => {
  const f = fixture(), sending = f.client.thumb(f.messages.get('m'), true);
  f[retirement](); f.command.resolve(committed); f.read.resolve(answer(true));
  assert.equal(await sending, null);
  assert.equal(f.messages.get('m').reactions.thumb_revision, 0);
  assert.equal(f.heard.includes('learned'), false); assert.equal(f.heard.includes('recorded'), false);
  assert.equal(f.heard.filter(x => Array.isArray(x) && x[0] === 'pending').length, 1);
});

test('1238 actual menu paints only the selected card and preserves another card and its reactions', () => {
  const doc = miniDocument(), cards = [doc.createElement('button'), doc.createElement('button')], items = [item(), item('other', true)];
  cards.forEach((card, i) => { card.dataset.id = items[i].id; reactions.paintReactions(card, items[i], 'reader', 'human', doc); });
  const untouched = cards[1].querySelector('.message-reactions'), count = untouched.children[0], painted = [];
  const menu = { doc, item: id => items.find(item => item.id === id), viewer: 'reader', kind: 'human', pending: () => true,
    lit: cards[0], paintBar: () => painted.push('bar'), host: { querySelectorAll() { throw Error('Full feed visited'); } } };
  assert.equal(typeof MessageMenu.prototype.paintMessage, 'function');
  MessageMenu.prototype.paintMessage.call(menu, 'm', cards[0]);
  assert.equal(cards[0].querySelector('.reaction-pending')?.textContent, '👍 Saving…');
  assert.equal(cards[1].querySelector('.message-reactions'), untouched); assert.equal(untouched.children[0], count);
  assert.deepEqual(painted, ['bar']);
});

test('1238 folded-row pending feedback preserves confirmed count and sends its own click/key action', () => {
  const doc = miniDocument(), card = doc.createElement('button'), row = doc.createElement('span');
  row.className = 'message-folded'; card.dataset.id = 'm'; card.append(row);
  let shown = item(), pending = true; const calls = [];
  const feed = { doc, viewer: 'reader', thumb: (...args) => calls.push(args), thumbPending: () => pending, cardItem: () => shown };
  const paint = () => StackFeed.prototype.paintFoldedThumb.call(feed, card, shown);
  paint(); const button = row.querySelector('.folded-thumb');
  assert.equal(button.textContent, '👍 …'); assert.equal(button.dataset.count, '0');
  assert.equal(button.getAttribute('aria-pressed'), 'false'); assert.equal(button.getAttribute('aria-busy'), 'true');
  button.onclick({ stopPropagation() {} }); button.onkeydown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(calls, [[shown, true], [shown, true]]);
  shown = item('m', true); pending = null; paint();
  assert.equal(row.querySelector('.folded-thumb'), button); assert.equal(button.dataset.count, '1');
  assert.equal(button.getAttribute('aria-pressed'), 'true'); assert.equal(button.getAttribute('aria-busy'), null);
});

test('1238 actual scoped reaction refresh identifies one message instead of requesting a full reaction paint', async () => {
  const paints = [], reads = [], views = new TopicViews({ instanceId: 'fixture', topicId: 't', reader: 'reader', paint: (...args) => paints.push(args) });
  views.messages.set('m', item()); views.messages.set('other', item('other'));
  const untouched = views.messages.get('other');
  assert.equal(await views.refresh('reaction:m', 1, async (name, args) => { reads.push([name, args]); return answer(true); }), true);
  assert.deepEqual(reads, [['reactions', { message_id: 'm' }]]); assert.deepEqual(paints, [['reactions', 'm']]);
  assert.equal(views.messages.get('other'), untouched);
});

test('1238 actual app thumb helper has no pending feed/anchor pass and defers confirmed paints during a press', () => {
  const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
  const source = app.match(/^function paintThumbMessage\([^]*?^}/m)?.[0];
  assert.ok(source, 'application needs the targeted pending/reconciliation owner');
  const entry = { dataset: { id: 'm' } }, messages = new Map([['m', item()]]), calls = [], pressHold = { down: false, after: (key, job) => calls.push([key, job]) };
  const bindings = { pressHold, messageEntries: new Map([['m', entry]]), feedMessages: () => messages, cardIn: x => x,
    stackFeed: { paintFoldedThumb: () => calls.push('folded'), paintReactionReading: () => calls.push('header') },
    menu: { paintMessage: id => calls.push(['card', id]) }, paintCardReading: id => calls.push(['read', id]),
    keepListAnchor: job => { calls.push('anchor'); job(); }, readerItem: () => ({ id: 'another-source' }), paintReaderThumb$: () => { throw Error('Unrelated Reader painted'); } };
  const paint = new Function(...Object.keys(bindings), `return (${source});`)(...Object.values(bindings));
  paint('m'); assert.deepEqual(calls, ['folded', ['card', 'm']]);
  calls.length = 0; paint('m', false); assert.deepEqual(calls, ['anchor', ['read', 'm'], 'header', 'folded', ['card', 'm']]);
  calls.length = 0; pressHold.down = true; paint('m', false);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'thumb:m');
});

test('1238 actual dossier header keeps unread replies when its head becomes read, without arranging another dossier', async () => {
  const file = new URL('../web/reply-stacks.mjs', import.meta.url);
  const source = readFileSync(file, 'utf8').replace(/from '(\.\/[^']+)'/g, (_, path) => 'from ' + JSON.stringify(new URL(path, file).href));
  const owner = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { paintHead };').toString('base64'));
  const doc = miniDocument(); doc.getElementById = () => null;
  const list = doc.createElement('div'), section = doc.createElement('div'), card = doc.createElement('button'), other = doc.createElement('div');
  section.className = 'reply-stack'; section.dataset.stack = 'm'; card.dataset.id = 'm'; section.append(card); list.append(section, other);
  const head = item(), reply = { ...item('reply'), seq: 2 }, stack = { id: 'm', dossier: 'm', head, replies: [reply] };
  const messages = new Map([['m', head], ['reply', reply]]), state = owner.stackState(list);
  Object.assign(state, { stacks: [stack], sections: new Map([['m', section]]) });
  const unread = message => !readNow(message, { viewer: 'reader' });
  owner.paintHead(card, stack, { state, open: true, unread, nameOf: x => x, doc });
  assert.ok(card.querySelector('.stack-new'));
  messages.set('m', { ...head, reactions: value(true) });
  assert.equal(typeof owner.paintHeadReading, 'function');
  owner.paintHeadReading(card, messages, unread, x => x);
  assert.equal(card.querySelector('.stack-new'), null); assert.equal(card.querySelector('.stack-fresh')?.textContent, ' · 1 new');
  messages.set('reply', { ...reply, unread: false }); owner.paintHeadReading(card, messages, unread, x => x);
  assert.equal(card.querySelector('.stack-new-action'), null); assert.equal(list.children[1], other);
});
