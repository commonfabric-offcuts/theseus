// Thumbs-up and go-ahead answers on a card (docs/thumbs.md), below the browser:
// what the page takes from Core's reactions, and the line each card carries.
// tests/topic_reading_native.mjs presses the same line and the message bar in
// Chrome and WebKit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Reactions, reactionsOf, paintReactions, mayThumb, mayAnswer, learnReactions } from '../web/reactions.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const reactions = more => ({ version: 3, thumbs: [], answers: [], thumb_revision: 1, answer_revision: 0, ...more });

test('a message\'s reactions are what Core said, none when it said nothing, and a malformed answer is refused', () => {
  assert.deepEqual(reactionsOf({}), { version: 0, thumbs: [], answers: [], thumb_revision: 0, answer_revision: 0 });
  assert.equal(Object.isFrozen(reactionsOf(undefined)), true, 'the empty value is shared, so frozen');
  const said = reactions({ thumbs: [{ actor_id: 'dan' }] });
  assert.equal(reactionsOf({ reactions: said }), said);
  for (const bad of [null, {}, reactions({ version: -1 }), reactions({ version: 1.5 }), reactions({ thumbs: null }), reactions({ answers: {} }),
    reactions({ thumb_revision: '1' }), reactions({ answer_revision: undefined })]) {
    assert.throws(() => reactionsOf({ reactions: bad }), /malformed/, JSON.stringify(bad));
  }
});

test('anyone thumbs up another\'s message, and only a person it asks answers a go-ahead', () => {
  assert.equal(mayThumb({ author_id: 'aim-core' }, 'tony'), true);
  assert.equal(mayThumb({ author_id: 'tony' }, 'tony'), false, 'never one\'s own');
  assert.equal(mayThumb(null, 'tony'), false);
  const ask = { author_id: 'aim-core', go_ahead: true, addressees: ['tony'] };
  assert.equal(mayAnswer(ask, 'tony', 'human'), true);
  assert.equal(mayAnswer(ask, 'tony', 'agent'), false, 'an agent never answers');
  assert.equal(mayAnswer(ask, 'dan', 'human'), false, 'a person it does not ask');
  assert.equal(mayAnswer({ ...ask, go_ahead: false }, 'tony', 'human'), false, 'not a go-ahead ask');
  assert.equal(mayAnswer({ ...ask, addressees: undefined }, 'tony', 'human'), false, 'asks no one');
});

const card = () => { const doc = miniDocument(); return { doc, card: doc.createElement('button') }; };
const line = c => c.querySelector(':scope > .message-reactions');
const parts = c => line(c)?.children.map(part => [part.className, part.text, part.dataset.react ?? null]) ?? null;

test('a card\'s line counts its thumbs-up, names who, and offers the reader\'s own 👍 as a press', () => {
  const { doc, card: c } = card();
  const item = { id: 'm', author_id: 'aim-core', reactions: reactions({ thumbs: [{ actor_id: 'dan' }, { actor_id: 'tony' }] }) };
  paintReactions(c, item, 'tony', 'human', doc);
  assert.deepEqual(parts(c), [['reaction-count mine', '👍 2dan, you', 'thumb']]);
  assert.equal(line(c).children[0].title, '👍 dan, you: read and understood');
  // Read by someone who has not thumbed it: not theirs.
  const { doc: d2, card: other } = card();
  paintReactions(other, item, 'eve', 'human', d2);
  assert.deepEqual(parts(other), [['reaction-count', '👍 2dan, tony', 'thumb']]);
  // The author's own message: the count reads, but is no press.
  const { doc: d3, card: own } = card();
  paintReactions(own, item, 'aim-core', 'agent', d3);
  assert.deepEqual(parts(own), [['reaction-count', '👍 2dan, tony', null]]);
});

test('a go-ahead ask offers the person it asks ✅ and 🚫, marks their answer, and says what others answered', () => {
  const ask = more => ({ id: 'a', author_id: 'aim-core', go_ahead: true, addressees: ['tony', 'dan'], reactions: reactions(more) });
  const paint = (item, viewer, kind = 'human') => { const { doc, card: c } = card(); paintReactions(c, item, viewer, kind, doc); return parts(c); };
  assert.deepEqual(paint(ask(), 'tony'), [['reaction-choice', '✅ Go ahead', 'yes'], ['reaction-choice', "🚫 Don't", 'no']]);
  assert.deepEqual(paint(ask({ answers: [{ actor_id: 'tony', answer: 'no' }] }), 'tony'),
    [['reaction-choice', '✅ Go ahead', 'yes'], ['reaction-choice mine', "🚫 Don't", 'no']], 'their own answer marked, not listed');
  assert.deepEqual(paint(ask({ answers: [{ actor_id: 'dan', answer: 'yes' }, { actor_id: 'tony', answer: 'yes' }] }), 'tony'),
    [['reaction-choice mine', '✅ Go ahead', 'yes'], ['reaction-choice', "🚫 Don't", 'no'], ['reaction-said', '✅ dan', null]]);
  // Someone it does not ask sees what was said, or that it asks, and no choice.
  assert.deepEqual(paint(ask(), 'eve'), [['reaction-said', 'Asks for a go-ahead', null]]);
  assert.deepEqual(paint(ask({ answers: [{ actor_id: 'tony', answer: 'no' }] }), 'eve'), [['reaction-said', '🚫 tony', null]]);
  assert.deepEqual(paint(ask(), 'tony', 'agent'), [['reaction-said', 'Asks for a go-ahead', null]], 'an agent it names is offered no choice');
});

test('a card with nothing to say carries no line, and a line already showing what it says is left as it is', () => {
  const { doc, card: c } = card();
  const item = { id: 'm', author_id: 'aim-core', reactions: reactions({ thumbs: [{ actor_id: 'dan' }] }) };
  paintReactions(c, item, 'tony', 'human', doc);
  const painted = line(c), count = painted.children[0];
  paintReactions(c, { ...item }, 'tony', 'human', doc);
  assert.equal(line(c).children[0], count, 'the same reactions paint nothing again');
  paintReactions(c, { ...item, reactions: reactions({ version: 4, thumbs: [{ actor_id: 'dan' }, { actor_id: 'eve' }] }) }, 'tony', 'human', doc);
  assert.equal(line(c), painted, 'one line per card');
  assert.notEqual(line(c).children[0], count, 'a new version paints again');
  assert.equal(line(c).children[0].text, '👍 2dan, eve');
  paintReactions(c, { ...item, reactions: reactions({ version: 5 }) }, 'tony', 'human', doc);
  assert.equal(line(c), null, 'the last thumbs-up taken back takes the line away');
  paintReactions(c, { id: 'm', author_id: 'aim-core' }, 'tony', 'human', doc);
  assert.equal(c.children.length, 0, 'none to begin with');
});

test('the page keeps the newest reactions Core answered for a loaded message, and none for another', () => {
  const messages = new Map([['m', { id: 'm', reactions: reactions({ version: 5 }) }]]);
  assert.equal(learnReactions(messages, { message_id: 'm', reactions: reactions({ version: 4 }), go_ahead: false }), false, 'an older answer');
  assert.equal(messages.get('m').reactions.version, 5);
  assert.equal(learnReactions(messages, { message_id: 'other', reactions: reactions({ version: 9 }) }), false, 'not loaded');
  assert.equal(learnReactions(messages, { message_id: 'm', reactions: reactions({ version: 6, thumbs: [{ actor_id: 'dan' }] }), go_ahead: true }), true);
  assert.deepEqual([messages.get('m').reactions.version, messages.get('m').go_ahead], [6, true]);
  learnReactions(messages, { message_id: 'm', reactions: reactions({ version: 7 }), go_ahead: false });
  assert.equal('go_ahead' in messages.get('m'), false, 'no longer asks');
});

test('a 👍 or an answer that cleared the person\'s mark tells the page before it paints, and nothing else does (item 327)', async () => {
  // Core's receipt for one act on message m: committed with the result given, or refused.
  const page = receipt => {
    const heard = [];
    const api = { command: async envelope => ({ ...receipt, operation_id: envelope.operation_id }),
      view: async (name, args) => ({ instance_id: 'i', message_id: args.message_id, go_ahead: false, reactions: reactions({ version: 4 }) }) };
    const r = new Reactions({ api, instanceId: 'i', authority: () => ({ authority_id: 'a', authority_epoch: 1 }),
      cleared: result => heard.push(['cleared', result.message_id, result.mark_revision, result.topic_id, result.seq]),
      learned: () => heard.push(['learned']), recorded: () => heard.push(['recorded']) });
    return { r, heard };
  };
  const item = { id: 'm', author_id: 'aim-core', reactions: reactions({ thumb_revision: 0 }) };
  const done = result => ({ status: 'committed', recorded: true, result: { message_id: 'm', topic_id: 't', seq: 7, ...result } });
  let { r, heard } = page(done({ thumbed: true, settled: true, mark_revision: 4 }));
  await r.thumb(item, true);
  assert.deepEqual(heard, [['cleared', 'm', 4, 't', 7], ['learned'], ['recorded']], 'the cleared mark is known before the card is painted');
  ({ r, heard } = page(done({ answer: 'yes', mark_revision: 2 })));
  await r.answer({ ...item, go_ahead: true }, 'yes');
  assert.deepEqual(heard[0], ['cleared', 'm', 2, 't', 7], 'an answer that cleared a mark says so too');
  ({ r, heard } = page(done({ thumbed: true, settled: true })));
  await r.thumb(item, true);
  assert.deepEqual(heard, [['learned'], ['recorded']], 'a 👍 that cleared no mark clears none here');
  ({ r, heard } = page(done({ message_id: 'other', mark_revision: 4 })));
  await r.thumb(item, true);
  assert.deepEqual(heard, [['learned'], ['recorded']], 'a result for another message clears nothing');
  ({ r, heard } = page({ status: 'rejected', recorded: true, error: { code: 'REVISION_CONFLICT' }, result: { message_id: 'm', mark_revision: 4 } }));
  await assert.rejects(r.thumb(item, true));
  assert.deepEqual(heard, [['learned']], 'a refused act clears nothing');
});
