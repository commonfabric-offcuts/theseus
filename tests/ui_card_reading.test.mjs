// How each card in a topic reads to the person (docs/topic-reading.md), below
// the browser: which messages are talk between agents, whether a card reads as
// read, the reply arrow's newest reply, the dots on the reader's own message
// while it waits for a reply (item 475), and the ranges a page reports read.
// tests/topic_reading_native.mjs presses the same cards in Chrome and WebKit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentTalk, readNow, learnReply, learnAnswered, paintAwaiting, AWAITING_WORDS, seenRanges } from '../web/card-reading.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const kinds = { 'aim-core': 'agent', 'aim-ux': 'agent', 'aim-qa': 'agent', tony: 'human', dan: 'human' };
const kindOf = name => kinds[name];
const talk = more => ({ id: 'm1', author_id: 'aim-core', author_kind: 'agent', addressees: ['aim-ux', 'aim-qa'], reply_to_author: null, ...more });

test('talk between agents is an agent writing by name to agents only, read by a person who is none of them', () => {
  assert.equal(agentTalk(talk(), 'tony', 'human', kindOf), true);
  // Each condition, broken alone, makes it a message for the person.
  const not = {
    'an agent reads it': [talk(), 'aim-qa-reader', 'agent'],
    'a person wrote it': [talk({ author_id: 'dan', author_kind: 'human' }), 'tony', 'human'],
    'to everyone, naming no one': [talk({ addressees: [] }), 'tony', 'human'],
    'no addressees field': [talk({ addressees: undefined }), 'tony', 'human'],
    'the reader is named': [talk({ addressees: ['aim-ux', 'tony'] }), 'tony', 'human'],
    'a person is named': [talk({ addressees: ['aim-ux', 'dan'] }), 'tony', 'human'],
    'a name the page cannot place': [talk({ addressees: ['aim-ux', 'someone-new'] }), 'tony', 'human'],
    'it answers the reader': [talk({ reply_to_author: 'tony' }), 'tony', 'human'],
    'the reader wrote it': [talk({ author_id: 'tony' }), 'tony', 'human'],
  };
  for (const [why, [item, viewer, viewerKind]] of Object.entries(not)) assert.equal(agentTalk(item, viewer, viewerKind, kindOf), false, why);
  // It answers someone else's message: still talk between agents.
  assert.equal(agentTalk(talk({ reply_to_author: 'aim-ux' }), 'tony', 'human', kindOf), true, 'answering an agent');
});

test('whether a message is talk between agents cannot be said without knowing who reads it', () => {
  for (const [viewer, lookup] of [['', kindOf], [undefined, kindOf], [null, kindOf], ['tony', null], ['tony', kinds]]) {
    assert.throws(() => agentTalk(talk(), viewer, 'human', lookup), /depends on who reads it/, String(viewer) + ' ' + typeof lookup);
  }
});

test('a card reads as read when Core says it is, once opened or replied to this visit, never while marked unread, and always when it is the reader\'s own', () => {
  const read = (item, options) => readNow({ author_id: 'aim-core', ...item }, { viewer: 'tony', ...options });
  assert.equal(read({ unread: true }, {}), false, 'unread, as the topic opened');
  assert.equal(read({ unread: false }, {}), true, 'read');
  assert.equal(read({}, {}), true, 'Core said nothing unread');
  assert.equal(read({ unread: true }, { opened: true }), true, 'opened in the Reader this visit');
  assert.equal(read({ unread: true, replied: { id: 'r', sent_ms: 1 } }, {}), true, 'replied to');
  assert.equal(read({ unread: false }, { marked: true }), false, 'marked unread');
  assert.equal(read({ unread: true }, { marked: true, opened: true }), false, 'marked unread holds over opened');
  assert.equal(read({ author_id: 'tony', unread: true }, { marked: true }), true, 'the reader\'s own');
});

test('a thumbs-up of the reader\'s own reads its message, taken back it stays read, and anyone else\'s reads nothing', () => {
  const read = (reactions, options = {}) => readNow({ author_id: 'aim-core', unread: true, reactions }, { viewer: 'tony', ...options });
  const reactions = (thumbRevision, thumbs) => ({ version: thumbRevision + thumbs.length, thumbs: thumbs.map(actor_id => ({ actor_id, at_ms: 1 })), answers: [], thumb_revision: thumbRevision, answer_revision: 0 });
  assert.equal(read(reactions(1, ['tony'])), true, 'thumbed up by the reader');
  assert.equal(read(reactions(2, [])), true, 'thumbed up and taken back: still read');
  assert.equal(read(reactions(0, ['dan'])), false, 'someone else\'s thumbs-up reads nothing for the reader');
  assert.equal(read(undefined), false, 'no reactions at all');
  assert.equal(read(reactions(1, ['tony']), { marked: true }), false, 'a mark holds over a thumbs-up, as over a reply');
});

test('the reply arrow follows the reader\'s newest reply, written here or said by Core, and nothing else', () => {
  const messages = new Map([['p', { id: 'p', seq: 1, replied: null }], ['old', { id: 'old', seq: 5 }], ['new', { id: 'new', seq: 9 }]]);
  // Someone else's reply, and the reader's message answering nothing, move nothing.
  assert.equal(learnReply(messages, { id: 'x', seq: 3, author_id: 'aim-core', reply_to: 'p', sent_ms: 3 }, 'tony'), null);
  assert.equal(learnReply(messages, { id: 'y', seq: 4, author_id: 'tony', sent_ms: 4 }, 'tony'), null);
  assert.equal(learnReply(messages, { id: 'z', seq: 4, author_id: 'tony', reply_to: 'not-loaded', sent_ms: 4 }, 'tony'), null);
  assert.equal(messages.get('p').replied, null);
  assert.equal(learnReply(messages, { id: 'new', seq: 9, author_id: 'tony', reply_to: 'p', sent_ms: 900 }, 'tony'), messages.get('p'));
  assert.deepEqual(messages.get('p').replied, { id: 'new', sent_ms: 900 });
  // An older reply, arriving late, leaves the newer one.
  assert.equal(learnReply(messages, { id: 'old', seq: 5, author_id: 'tony', reply_to: 'p', sent_ms: 500 }, 'tony'), null);
  assert.deepEqual(messages.get('p').replied, { id: 'new', sent_ms: 900 });
  // A newer one replaces it; a time that is not a whole millisecond is said as unknown.
  messages.set('newer', { id: 'newer', seq: 12 });
  learnReply(messages, { id: 'newer', seq: 12, author_id: 'tony', reply_to: 'p', sent_ms: 'soon' }, 'tony');
  assert.deepEqual(messages.get('p').replied, { id: 'newer', sent_ms: null });
});

test('the ranges a page reports read hold only messages seen on screen, in one loaded run each', () => {
  const item = (seq, author = 'aim-core', run = 'a') => ({ id: 'm' + seq, seq, author_id: author, run });
  const ranges = (items, shown) => seenRanges(items, seq => shown.includes(seq), id => items.find(each => each.id === id).run, 'tony');
  assert.deepEqual(ranges([item(1), item(2), item(3)], [1, 2, 3]), [[1, 3]], 'all seen');
  assert.deepEqual(ranges([item(3), item(1), item(2)], [1, 2, 3]), [[1, 3]], 'in the topic\'s order, however loaded');
  assert.deepEqual(ranges([item(1), item(2), item(3)], [1, 3]), [[1, 1], [3, 3]], 'a loaded message not seen (a folded reply) ends a range');
  assert.deepEqual(ranges([item(1), item(2, 'tony'), item(3)], [1, 3]), [[1, 3]], 'the reader\'s own message neither counts nor breaks one');
  assert.deepEqual(ranges([item(1, 'tony'), item(2, 'tony')], [1, 2]), [], 'the reader\'s own are never reported');
  assert.deepEqual(ranges([item(1), item(2), item(3)], []), [], 'nothing seen, nothing reported');
  assert.deepEqual(ranges([item(1), item(2), item(5, 'aim-core', 'b'), item(6, 'aim-core', 'b')], [1, 2, 5, 6]), [[1, 2], [5, 6]], 'never across a gap between runs');
  assert.deepEqual(ranges([item(1), item(2), item(3, 'aim-core', 'b')], [1, 2, 3]), [[1, 2], [3, 3]], 'adjacent numbers in two runs stay two ranges');
});

// Item 475: the reader's message an agent received waits for a reply, as Core says (awaiting_reply), until a message
// by anyone else arrives after it in its dossier; the page ends it by the same rule as the message arrives.
test('a message that arrives ends the wait on the reader\'s earlier messages in its dossier only when someone else wrote it', () => {
  const at = (id, seq, author, root, awaiting = false) => [id, { id, seq, author_id: author, stack_position: { root_id: root }, awaiting_reply: awaiting }];
  const messages = new Map([at('r', 1, 'tony', 'r', true), at('s', 2, 'tony', 'r', true), at('x', 3, 'tony', 'x', true)]);
  assert.deepEqual(learnAnswered(messages, 'tony'), [], 'nothing by anyone else: every wait stands');
  messages.set(...at('own', 4, 'tony', 'r'));
  assert.deepEqual(learnAnswered(messages, 'tony'), [], 'the reader\'s own later message ends nothing');
  messages.set(...at('other', 5, 'aim-core', 'elsewhere'));
  assert.deepEqual(learnAnswered(messages, 'tony'), [], 'someone else\'s message in another dossier ends nothing');
  messages.set(...at('reply', 6, 'dan', 'r'));
  assert.deepEqual(learnAnswered(messages, 'tony').map(item => item.id), ['r', 's'], 'a person\'s reply in the dossier ends both waits before it');
  assert.deepEqual([...messages.values()].map(item => [item.id, item.awaiting_reply]),
    [['r', false], ['s', false], ['x', true], ['own', false], ['other', false], ['reply', false]], 'and only those');
  messages.set(...at('later', 7, 'tony', 'r', true));
  assert.deepEqual(learnAnswered(messages, 'tony'), [], 'a reply before a message is no reply to it');
  messages.set(...at('agent', 8, 'aim-core', 'x'));
  assert.deepEqual(learnAnswered(messages, 'tony').map(item => item.id), ['x'], 'an agent\'s reply ends it as a person\'s does');
});

test('the dots on a waiting message are the Conversation\'s three, named in words, and go once it waits no more', () => {
  const doc = miniDocument(), card = doc.createElement('button');
  card.append(doc.createElement('span'));
  paintAwaiting(card, { awaiting_reply: false }, doc);
  assert.equal(card.querySelector('.item-waiting'), null, 'a message that does not wait draws none');
  paintAwaiting(card, { awaiting_reply: true }, doc);
  paintAwaiting(card, { awaiting_reply: true }, doc);
  const dots = card.querySelectorAll('.item-waiting');
  assert.equal(dots.length, 1, 'repainting keeps one');
  assert.equal(dots[0].children.length, 3, 'three dots');
  assert.deepEqual([dots[0].getAttribute('role'), dots[0].getAttribute('aria-label'), dots[0].title], ['img', AWAITING_WORDS, AWAITING_WORDS]);
  assert.equal(AWAITING_WORDS, 'Waiting for a reply');
  paintAwaiting(card, { awaiting_reply: false }, doc);
  assert.equal(card.querySelector('.reply-wait'), null, 'answered, the dots go');
  paintAwaiting(card, {}, doc);
  assert.equal(card.querySelector('.reply-wait'), null, 'a message Core said nothing of waits for nothing');
});
