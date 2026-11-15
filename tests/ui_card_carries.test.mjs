// A card's marks of what its message carries (item 127, docs/topic-reading.md):
// an image, the person's own private note, a reply they saved and have not
// sent. Core says the last two for the reader alone (`yours`); here the page's
// side: which marks a message gets, how they are painted in the card's line
// beside its time, how a change of the person's own writing reaches the card,
// and that a late read never puts back marks since changed. Native layout,
// light and dark and phone widths are tests/card_marks_native.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { carriesOf, carryWords, paintAuthor } from '../web/marks.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { Freshness } from '../web/freshness.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const INSTANCE = 'i1';
const page = items => ({ instance_id: INSTANCE, items, next_cursor: null, relevant_versions: { topic: 3 } });
const item = (id, seq, more = {}) => ({ id, seq, topic_id: 't1', author_id: 'fable', body: 'Words', revision: 1, ...more });
const yours = (note, reply, version) => ({ note, reply, version });
const png = { id: 'a1', name: 'shot.png', content_type: 'image/png', size_bytes: 9, inline: true };

function withDocument(t) {
  const previous = globalThis.document;
  globalThis.document = miniDocument();
  t.after(() => { globalThis.document = previous; });
  return globalThis.document;
}
// The author line as [class, aria-label, title] for each mark, in order, and where the marks sit among its parts.
const marksOf = author => author.querySelectorAll('.carry').map(mark => [mark.className, mark.getAttribute('aria-label'), mark.title, mark.getAttribute('role')]);
const parts = author => author.children.map(child => (typeof child === 'string' ? child : child.className));
// The time's own parts: the separator, then the time and the marks held together so a wrapping line keeps them side by side.
const timeParts = author => {
  const at = author.querySelector(':scope > .message-time'), together = at?.querySelector(':scope > .together');
  return at && [at.children[0], together ? together.children.map(child => child.tag === 'time' ? 'time' : child.className) : at.children[1].tag];
};

test('a message carries its images, and the reader\'s own note and saved reply only when Core says they are theirs', () => {
  assert.deepEqual(carriesOf(item('m1', 1)), { images: 0, note: false, reply: false }, 'a plain message carries nothing');
  assert.deepEqual(carriesOf(item('m1', 1, { attachments: [png, { ...png, id: 'a2', content_type: 'image/webp' }, { id: 'a3', name: 'notes.txt', content_type: 'text/plain' }] })).images, 2,
    'images are counted; another kind of attachment is not an image');
  assert.deepEqual(carriesOf(item('m1', 1, { yours: yours(true, false, 1) })), { images: 0, note: true, reply: false });
  assert.deepEqual(carriesOf(item('m1', 1, { yours: yours(false, true, 2) })), { images: 0, note: false, reply: true });
  // Someone else's note or draft is never in the reader's `yours`: Core leaves it false, and anything but true is no mark.
  assert.deepEqual(carriesOf(item('m1', 1, { yours: { note: 'yes', reply: 1, version: 3 } })), { images: 0, note: false, reply: false });
  assert.deepEqual(carriesOf(item('m1', 1, { withheld: true, attachments: [] })), { images: 0, note: false, reply: false });
});

test('the marks sit in the card\'s line just after its time, each a named, titled glyph and never a control', t => {
  withDocument(t);
  const author = document.createElement('span');
  const sent = Date.UTC(2026, 10, 14, 15, 4);
  paintAuthor(author, 'fable', sent, false, false, { images: 1, note: true, reply: true });
  assert.deepEqual(parts(author), ['author-name', 'message-time']);
  assert.deepEqual(timeParts(author), [' · ', ['time', 'card-carries']], 'one group of marks, straight after the time and held to it');
  assert.deepEqual(marksOf(author), [
    ['carry carry-image', 'Has an image', 'Has an image', 'img'],
    ['carry carry-note', carryWords.note, carryWords.note, 'img'],
    ['carry carry-reply', carryWords.reply, carryWords.reply, 'img']]);
  assert.equal([...author.descendants()].some(node => node.tag === 'button' || node.getAttribute('role') === 'button' || node.getAttribute('tabindex') !== null), false,
    'no new button: a mark takes no press and no Tab stop of its own');
  paintAuthor(author, 'fable', sent, false, true, { images: 3, note: false, reply: false });
  assert.deepEqual(parts(author), ['author-name', 'message-time', 'message-edited'], 'Edited is still said last');
  assert.deepEqual(marksOf(author), [['carry carry-image', 'Has 3 images', 'Has 3 images', 'img']]);
  paintAuthor(author, 'fable', null, false, false, { images: 0, note: false, reply: true });
  assert.deepEqual(parts(author), ['author-name', 'card-carries'], 'a message from before times were kept still shows its marks');
});

test('a card with nothing to carry shows no marks, and a change of what it carries repaints its line', t => {
  withDocument(t);
  const author = document.createElement('span');
  paintAuthor(author, 'fable', Date.UTC(2026, 10, 14, 15, 4), false, false, { images: 0, note: false, reply: false });
  assert.equal(author.querySelector('.card-carries'), null);
  assert.deepEqual(timeParts(author), [' · ', 'time'], 'with no marks the time is drawn as it always was');
  const before = author.dataset.shows;
  paintAuthor(author, 'fable', null, false, false, { images: 0, note: true, reply: false });
  assert.notEqual(author.dataset.shows, before, 'what the line shows includes its marks');
  assert.deepEqual(marksOf(author).map(([name]) => name), ['carry carry-note']);
  paintAuthor(author, 'fable', null, false, false, null);
  assert.equal(author.querySelector('.card-carries'), null, 'a line painted with no carries (a folded line) has no marks');
});

test('an actor-scope "yours" change names its message for the page; a draft\'s or a note\'s own change does not', async () => {
  const bootstrap = { instance_id: INSTANCE, actor: 'tony', authority: { authority_id: 'a', authority_epoch: 'e' },
    transport: { read_admission: { version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } } } };
  const cursor = (after_seq, scope) => ({ v: 1, kind: 'checkpoint', instance_id: INSTANCE, actor_id: 'tony', authority_id: 'a', authority_epoch: 'e', scope, after_seq });
  const actor = { kind: 'actor', id: 'tony' };
  const f = new Freshness({ api: {}, bootstrap, topicId: 't1', checkpoint: cursor(10, { kind: 'topic', id: 't1' }), actorCheckpoint: cursor(5, actor), read: () => {}, keys: () => [], refresh: async () => true });
  const answer = { instance_id: INSTANCE, scope: actor, has_more: false, continuation: null, checkpoint: cursor(10, actor), items: [
    { seq: 6, resource_kind: 'draft', resource_id: 'd1', version: 2 }, { seq: 7, resource_kind: 'yours', resource_id: 'm1', version: 3 },
    { seq: 8, resource_kind: 'note', resource_id: 'n1', version: 1 }, { seq: 9, resource_kind: 'yours', resource_id: null, version: 4 }] };
  await f.readWhispers(async () => answer, () => true);
  assert.deepEqual([...f.dirty.keys()], ['yours:m1']);
  assert.equal(f.dirty.get('yours:m1').version, 3);
});

test('a yours:<id> refresh reads that message alone and repaints its card only when its marks changed', async () => {
  const painted = [];
  const v = new TopicViews({ instanceId: INSTANCE, topicId: 't1', paint: kind => painted.push(kind) });
  v.messagesPage(page([item('m1', 1, { yours: yours(false, false, 0) }), item('m2', 2, { yours: yours(false, false, 0) })]), { initial: true });
  painted.length = 0;
  const asked = [];
  let answer = item('m1', 1, { yours: yours(true, false, 1) });
  const read = async (name, args) => { asked.push([name, args]); return page([answer]); };
  assert.equal(await v.refresh('yours:m1', 1, read), true);
  assert.deepEqual(asked, [['topic_messages', { topic_id: 't1', message_ids: ['m1'] }]]);
  assert.deepEqual(v.messages.get('m1').yours, yours(true, false, 1));
  assert.deepEqual([painted, [...v.takeYours()]], [['yours'], ['m1']], 'the card whose marks changed is repainted, and no other');
  // A save that leaves the marks as they were (the note's words changed) moves the version and repaints nothing.
  answer = item('m1', 1, { yours: yours(true, false, 2) }); painted.length = 0;
  assert.equal(await v.refresh('yours:m1', 2, read), true);
  assert.deepEqual([painted, [...v.takeYours()], v.messages.get('m1').yours.version], [[], [], 2]);
  // An answer from before the change it was asked for is read again later.
  await assert.rejects(v.refresh('yours:m1', 5, read), error => error.code === 'RESOURCE_NOT_CURRENT');
  // A message this page has not loaded is not read: it brings its marks with it as it loads.
  assert.equal(await v.refresh('yours:m9', 1, read), true);
  assert.equal(asked.length, 3);
  // Refused (no longer readable here), as an answer or as the read's error: the card keeps its marks and the page goes on.
  const refusal = { error: { code: 'FORBIDDEN', message: 'No readable source' } };
  assert.equal(await v.refresh('yours:m1', 6, async () => refusal), true);
  assert.equal(await v.refresh('yours:m1', 6, async () => { throw { details: refusal }; }), true);
  assert.deepEqual(v.messages.get('m1').yours, yours(true, false, 2));
});

test('a page read before the person saved or sent answers late and puts back no mark', () => {
  const painted = [];
  const v = new TopicViews({ instanceId: INSTANCE, topicId: 't1', paint: kind => painted.push(kind) });
  v.messagesPage(page([item('m1', 1, { yours: yours(false, true, 4) })]), { initial: true });
  painted.length = 0;
  v.messagesPage(page([item('m1', 1, { yours: yours(false, false, 3) })]), { initial: true });
  assert.deepEqual([v.messages.get('m1').yours, painted.includes('yours')], [yours(false, true, 4), false], 'the older read is not taken');
  v.messagesPage(page([item('m1', 1, { yours: yours(false, false, 5) })]), { initial: true });
  assert.deepEqual([v.messages.get('m1').yours, painted.includes('yours'), [...v.takeYours()]], [yours(false, false, 5), true, ['m1']],
    'a newer read, the reply sent, takes the mark away');
  // An edit's later revision keeps the newer marks the page already holds.
  v.messagesPage(page([item('m1', 1, { yours: yours(true, false, 7) })]), { initial: true });
  v.messagesPage(page([item('m1', 1, { body: 'Edited words', revision: 2, yours: yours(false, false, 6) })]), { initial: true });
  assert.deepEqual([v.messages.get('m1').body, v.messages.get('m1').yours], ['Edited words', yours(true, false, 7)]);
});
