// Thumbs-up and go-ahead answers on a card (docs/thumbs.md), below the browser:
// what the page takes from Core's reactions, and the line each card carries.
// tests/topic_reading_native.mjs presses the same line and the message bar in
// Chrome and WebKit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Reactions, reactionsOf, paintReactions, mayThumb, mayAnswer, learnReactions } from '../web/reactions.mjs';
import { revisionOf } from '../web/message-edit-writing.mjs';
import { MessageMenu } from '../web/message-menu.mjs';
import { adoptWordsRevision } from '../web/message-format.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { AttemptError } from '../web/api.mjs';

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

test('an edit splits the thumbs using loaded timestamps and marks the reader’s earlier chip unpressed', () => {
  const { doc, card: c } = card();
  const item = { id: 'm', author_id: 'aim-core', reactions: reactions({
    thumbs: [{ actor_id: 'tony', at_ms: 100 }, { actor_id: 'dan', at_ms: 300 }]
  }) };
  paintReactions(c, item, 'tony', 'human', doc);
  assert.deepEqual(parts(c), [['reaction-count mine', '👍 2you, dan', 'thumb']]);
  paintReactions(c, { ...item, revision: 2, edited_ms: 200 }, 'tony', 'human', doc);
  assert.deepEqual(parts(c), [['reaction-count', '👍 1dan', 'thumb'], ['reaction-count reaction-stale', '👍 1', 'thumb-again']]);
  assert.equal(line(c).children[1].title, 'Thumbed before the latest edit: you');
  assert.equal(line(c).children[1].getAttribute('aria-label'), 'Thumbed before the latest edit: you');
  assert.equal(line(c).children[1].getAttribute('aria-pressed'), 'false');
  assert.equal(line(c).children[1].querySelector('.reaction-stale-emoji').textContent, '👍');
  paintReactions(c, { ...item, revision: 3, edited_ms: 400 }, 'tony', 'human', doc);
  assert.deepEqual(parts(c), [['reaction-count reaction-stale', '👍 2', 'thumb-again']]);
});

test('the Reader renews for the visible revision even when its feed card is ahead', () => {
  const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
  const itemStart = app.indexOf('function readerItem()'), itemEnd = app.indexOf('\n}', itemStart) + 2;
  const actionStart = app.indexOf('function thumbFromReader('), actionEnd = app.indexOf('\n}', actionStart) + 2;
  const source = { source_ref: { kind: 'message', id: 'm' }, revision: 2, edited_ms: 200 };
  const latestReactions = reactions({ thumbs: [{ actor_id: 'tony', at_ms: 100 }] });
  const loaded = { id: 'm', revision: 3, edited_ms: 300, reactions: latestReactions };
  const registry = { current: { source } }, renewed = [];
  const { readerItem, thumbFromReader } = runInNewContext(
    app.slice(itemStart, itemEnd) + '\n' + app.slice(actionStart, actionEnd) + '\n({ readerItem, thumbFromReader })', {
    registry, views: { messages: new Map([['m', loaded]]) }, revisionOf, run: task => task(),
    thumbMessage: item => renewed.push(item), paintReaderThumb$: () => {}, reader: { notice: assert.fail }
  });

  const displayed = readerItem();
  assert.equal(displayed.revision, 2);
  assert.equal(displayed.edited_ms, 200);
  assert.equal(displayed.reactions, latestReactions);
  thumbFromReader(false, displayed);
  assert.deepEqual(renewed.map(item => item.revision), [2]);
  Object.assign(source, { revision: 3, edited_ms: 300 });
  thumbFromReader(false, displayed);
  assert.deepEqual(renewed.map(item => item.revision), [2], 'a stale click cannot renew for a newly painted source');
});

test('a card whose new words are held cannot renew a thumb for the unseen revision', () => {
  const { doc, card: c } = card();
  const preview = doc.createElement('span');
  preview.className = 'message-preview';
  c.append(preview);
  const item = { id: 'm', author_id: 'aim-core', revision: 3, edited_ms: 300,
    reactions: reactions({ thumbs: [{ actor_id: 'tony', at_ms: 100 }] }) };
  const renewed = [];
  const menu = { lit: c, viewer: 'tony', item: () => item, acted() {},
    thumb: (message, on) => renewed.push([message.revision, on]) };
  adoptWordsRevision(preview, 2);
  MessageMenu.prototype.act.call(menu, 'thumb-again');
  assert.deepEqual(renewed, []);
  adoptWordsRevision(preview, 3);
  MessageMenu.prototype.act.call(menu, 'thumb-again');
  assert.deepEqual(renewed, [[3, true]]);
});

test('giving a thumb to the current words uses the existing reaction read and fences the message revision', async () => {
  const calls = [], item = { id: 'm', revision: 2, edited_ms: 200,
    reactions: reactions({ thumbs: [{ actor_id: 'tony', at_ms: 100 }] }) };
  const acts = new Reactions({ instanceId: 'i', viewer: 'tony', authority: () => ({ authority_id: 'a', authority_epoch: 'e' }),
    api: {
      command: async request => { calls.push(request); return { status: 'committed', result: { message_id: 'm' } }; },
      view: async (name, args) => {
        calls.push([name, args]); return { instance_id: 'i', message_id: 'm', reactions: reactions({ thumb_revision: 3 }) };
      }
    }
  });
  await acts.thumb(item, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].expected, { thumb_revision: 1, message_revision: 2, authority: { authority_id: 'a', authority_epoch: 'e' } });
  assert.deepEqual(calls[1], ['reactions', { message_id: 'm' }]);
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

// Item 547: a 👍 or an answer Theseus answered without taking is said as what
// it answered, never as a lost connection; with someone to say it on the
// card, it is told before the reactions are read again, so that read ends it.
test('a 👍 Theseus answered without taking is said as what it answered, told before its reactions are read again; only no answer at all is a lost connection', async () => {
  const item = { id: 'm', author_id: 'aim-core', reactions: reactions({ thumb_revision: 0 }) };
  const page = failure => {
    const heard = [];
    const api = { command: async () => { throw failure; },
      view: async (name, args) => { heard.push(['read', args.message_id]); return { instance_id: 'i', message_id: args.message_id, go_ahead: false, reactions: reactions({ version: 4 }) }; } };
    const r = new Reactions({ api, instanceId: 'i', authority: () => ({ authority_id: 'a', authority_epoch: 1 }), learned: () => heard.push(['learned']),
      reading: id => { heard.push(['reading', id]); return () => heard.push(['landed', id]); } });
    return { r, heard };
  };
  const busy = new AttemptError('This request lane is busy; retain its operation.', 503, { error: { code: 'SERVER_BUSY', message: 'This request lane is busy; retain its operation.' } });
  let { r, heard } = page(busy);
  await assert.rejects(r.thumb(item, true), error => {
    assert.equal(error.message, 'That was not saved: Theseus was busy. Press again: Core keeps one of each.');
    return true;
  }, 'with no one to say it on the card, it is thrown in words of what Theseus answered');
  ({ r, heard } = page(busy));
  assert.equal(await r.thumb(item, true, failure => heard.push(['said', failure.error === busy])), null, 'said on the card, nothing is thrown');
  assert.deepEqual(heard, [['said', true], ['reading', 'm'], ['read', 'm'], ['landed', 'm'], ['learned']], 'said before the reactions are read again, which then land');
  const restarted = new AttemptError('Session required.', 401, { error: { code: 'SESSION_REQUIRED', message: 'Session required.' } });
  ({ r } = page(restarted));
  await assert.rejects(r.answer({ ...item, go_ahead: true }, 'yes'), /^Error: That was not saved: Theseus restarted\./, 'a restart is no lost connection');
  const unconfirmedAnswer = new AttemptError('The request could not be confirmed; reconcile its operation.', 500, { error: { code: 'REQUEST_UNCONFIRMED' } });
  ({ r } = page(unconfirmedAnswer));
  await assert.rejects(r.thumb(item, true), /^Error: Not known whether that was saved: Theseus could not confirm it\./);
  // No answer at all is a lost connection, and goes to a connection line even with the card to say it on.
  const lost = new AttemptError('Connection interrupted. Confirmation is unknown; your writing is kept.');
  ({ r, heard } = page(lost));
  await assert.rejects(r.thumb(item, true, () => heard.push(['said'])), /Connection interrupted; whether that was saved is unknown/);
  assert.equal(heard.some(([what]) => what === 'said'), false, 'a lost connection is not said on the card');
});
