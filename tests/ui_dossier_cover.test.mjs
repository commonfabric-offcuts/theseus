// A dossier's cover as the page draws it (item 624, docs/dossier-covers.md),
// below the browser: the sheet says where it stands, the payload with its
// label, its pill and the message that delivered it, and what waits on the
// outcome's owner with its default; the pill says proposed until Core says
// done, then how and by whom, in the reader's words; a message on its own
// takes pills, never a sheet; and an act read late never puts back a cover
// Core has moved past. Where the sheet sits in a folder, at every width and
// theme in both engines, is tests/stack_native.mjs ("reading covers …").
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverSheet, coverPills, doneWords, payloadPill, coverKey, coverOf } from '../web/dossier-cover.mjs';
import { laterActs, stackCover } from '../web/stack-order.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const NAMES = { owner: 'Ana', 'agent-a': 'Scout', 'agent-b': 'Pilot' };
const nameOf = id => NAMES[id] ?? id;
const context = (viewer = 'owner') => ({ viewer, nameOf, topicId: 't-1' });
const COVER = {
  stands: 'Answered: the second weekend', waiting: [{ text: 'Book the cabin?', default: 'booked Friday' }],
  payload: { text: 'The second weekend', message_id: 'm-answer', seq: 12, link: null, kind: 'answer', done: null },
  by: 'agent-a', at_ms: 1_700_000_000_000, owner: 'owner',
};
const DONE_BY_THUMB = { how: 'thumb', by: 'owner', at_ms: 1_700_000_100_000 };
const DONE_BY_WORD = { how: 'word', by: 'owner', at_ms: 1_700_000_200_000, message_id: 'm-word', seq: 14 };
const of = (node, className) => [...node.descendants()].filter(each => each.classList.contains(className));
const glyphs = node => [...node.descendants()].map(each => each.getAttribute('data-glyph')).filter(Boolean);

test('the sheet says where it stands, its payload with its label, pill and the message that delivered it, and what waits on the owner with its default', () => {
  const doc = miniDocument(), sheet = coverSheet(doc, COVER, context());
  assert.equal(sheet.className, 'dossier-cover');
  assert.deepEqual(sheet.children.map(line => line.className), ['cover-line cover-stands', 'cover-line cover-payload', 'cover-line cover-wait'], 'stands, then the payload, then each wait');
  assert.equal(sheet.children[0].text, 'Answered: the second weekend');
  assert.equal(of(sheet, 'cover-label')[0].text, 'Payload · answer');
  assert.equal(of(sheet, 'row-pill')[0].dataset.state, 'proposed');
  assert.deepEqual(glyphs(sheet), ['payload'], 'a proposed payload is a box');
  const cite = of(sheet, 'cover-src')[0];
  assert.equal(cite.text, '#12', 'the payload\'s message, by its number');
  assert.match(cite.getAttribute?.('href') ?? cite.href, /m-answer/, 'a link that opens that message');
  const wait = sheet.children[2];
  assert.equal(of(wait, 'topic-state')[0].text, 'Waits on you', 'the owner reads "you"');
  assert.ok(of(wait, 'topic-state')[0].classList.contains('mine'));
  assert.equal(of(wait, 'cover-note')[0].text, 'Default: booked Friday.');
  assert.equal(sheet.dataset.done, 'false');
  // Anyone else reads the owner's name, not "you", and no "mine".
  const theirs = coverSheet(doc, COVER, context('agent-b'));
  assert.equal(of(theirs, 'topic-state')[0].text, 'Waits on Ana');
  assert.equal(of(theirs, 'topic-state')[0].classList.contains('mine'), false);
});

test('a sheet holds only the lines its cover says, and one done with nothing waiting says so', () => {
  const doc = miniDocument();
  const bare = coverSheet(doc, { ...COVER, stands: null, waiting: [], payload: { ...COVER.payload, kind: null, done: DONE_BY_THUMB } }, context());
  assert.deepEqual(bare.children.map(line => line.className), ['cover-line cover-payload']);
  assert.equal(of(bare, 'cover-label')[0].text, 'Payload', 'no kind, no kind in the label');
  assert.equal(bare.dataset.done, 'true');
  const waits = coverSheet(doc, { ...COVER, payload: null }, context());
  assert.deepEqual(waits.children.map(line => line.className), ['cover-line cover-stands', 'cover-line cover-wait']);
  assert.equal(waits.dataset.done, 'false');
  assert.equal(of(waits, 'row-pill').length, 0, 'no payload, no pill');
});

test('the pill says proposed until Core says done, then how and by whom in the reader\'s words; a word the reader can open is cited', () => {
  const doc = miniDocument();
  assert.equal(doneWords(null, context()), 'payload proposed');
  assert.equal(doneWords(DONE_BY_THUMB, context()), 'done · your 👍');
  assert.equal(doneWords(DONE_BY_THUMB, context('agent-a')), "done · Ana's 👍");
  assert.equal(doneWords(DONE_BY_WORD, context()), 'done · your word');
  const pill = payloadPill(doc, { ...COVER.payload, done: DONE_BY_THUMB }, { ...context(), owner: 'owner' });
  assert.equal(pill.dataset.state, 'done');
  assert.deepEqual(glyphs(pill), ['kept'], 'done is a tick');
  assert.match(pill.text, /^done · your 👍 at /, 'with when');
  assert.equal([...pill.descendants()].filter(node => node.tag === 'time').length, 1, 'its time follows the day');
  const proposed = payloadPill(doc, COVER.payload, { ...context('agent-a'), owner: 'owner' });
  assert.equal(proposed.title, "Proposed: done by Ana's thumbs up on its message, or a reply of Ana's to it named as the word");
  // Done by a word the reader can open cites it; Core leaves a whisper's id out for a reader outside it, and nothing is cited.
  const word = coverSheet(doc, { ...COVER, payload: { ...COVER.payload, done: DONE_BY_WORD } }, context());
  assert.deepEqual(of(word, 'cover-src').map(node => node.text), ['#12', '#14']);
  const unseen = coverSheet(doc, { ...COVER, payload: { ...COVER.payload, done: { how: 'word', by: 'owner', at_ms: 1 } } }, context('agent-b'));
  assert.deepEqual(of(unseen, 'cover-src').map(node => node.text), ['#12']);
  assert.match(of(unseen, 'row-pill')[0].text, /^done · Ana's word at /);
});

test('a payload\'s link shows its address\'s host and goes where it was written; a message on its own takes pills, never a sheet', () => {
  const doc = miniDocument();
  const linked = coverSheet(doc, { ...COVER, payload: { ...COVER.payload, link: 'https://example.test/cabin/week' } }, context());
  const anchor = [...linked.descendants()].find(node => node.tag === 'a' && !node.classList.contains('cover-src'));
  assert.equal(anchor.text, 'example.test');
  assert.equal(anchor.title, 'https://example.test/cabin/week');
  const pills = coverPills(doc, COVER, context());
  assert.equal(pills.className, 'row-pills');
  assert.deepEqual(pills.children.map(pill => [pill.dataset.state, of(pill, 'pill-words')[0].text]), [['proposed', 'payload proposed'], ['waiting', 'waits on you']]);
  assert.equal(pills.title, 'Answered: the second weekend', 'where it stands, on the pills');
  assert.equal(of(pills, 'dossier-cover').length, 0);
  const many = coverPills(doc, { ...COVER, payload: null, waiting: [COVER.waiting[0], COVER.waiting[0]] }, context('agent-a'));
  assert.deepEqual(many.children.map(pill => of(pill, 'pill-words')[0].text), ['2 wait on Ana']);
  assert.equal(coverPills(doc, { ...COVER, payload: null, waiting: [] }, context()), null, 'stands alone gives no pill');
});

test('only a dossier\'s first message carries a cover, and its key changes with what it says and to whom', () => {
  assert.equal(coverOf({ acts: { cover: COVER } }), COVER);
  assert.equal(coverOf({ acts: { cover: null } }), null);
  assert.equal(coverOf({ acts: {} }), null, 'a page from a Core before covers reads none');
  assert.equal(coverOf(null), null);
  const key = coverKey(COVER, context());
  assert.equal(coverKey(COVER, context()), key, 'the same cover, the same key');
  assert.notEqual(coverKey({ ...COVER, payload: { ...COVER.payload, done: DONE_BY_THUMB } }, context()), key, 'done changes it');
  assert.notEqual(coverKey(COVER, context('agent-a')), key, 'another reader reads other words');
  assert.equal(coverKey(null, context()), '');
});

test('an act read late never puts back a cover Core has moved past, and a newer one replaces it', () => {
  const known = { cover: { ...COVER, payload: { ...COVER.payload, done: DONE_BY_THUMB } }, cover_revision: 3, starred: false, star_revision: 0 };
  const stale = { cover: COVER, cover_revision: 2, starred: false, star_revision: 0 };
  assert.deepEqual(laterActs(known, stale).cover, known.cover, 'an answer read before the 👍 settled keeps Done');
  assert.equal(laterActs(known, stale).cover_revision, 3);
  const newer = { cover: { ...COVER, stands: 'Booked' }, cover_revision: 4 };
  assert.equal(laterActs(known, newer).cover.stands, 'Booked');
  assert.equal(laterActs(known, newer).cover_revision, 4);
});

// Item 624: the cover rides with the dossier's place (stack_position), as its name does, so a page whose first
// message is above what is loaded shows it on the reply heading the dossier; where the first message is loaded, its
// own acts say it; a message on its own takes pills, never a sheet.
test('a dossier\'s cover comes with its place, so a stack of replies whose first message is not loaded shows it', () => {
  const at = (acts, extra = {}) => ({ root_id: 'm-root', through: null, aside_revision: 0, below: false, name: null, name_revision: 0, at: { messages: 9, acts }, ...extra });
  const placed = at(4, { cover: COVER, cover_revision: 2 });
  const reply = (id, reply_to) => ({ id, reply_to, acts: { cover: null, cover_revision: 0 }, stack_position: placed });
  // The first message is above the page: the stack is headed by a reply, and the place carries the cover.
  assert.equal(stackCover({ head: reply('m-r1', 'm-root'), replies: [reply('m-r2', 'm-r1')] }), COVER, 'the reply heading the dossier shows its cover');
  assert.equal(stackCover({ head: reply('m-r1', 'm-root'), replies: [] }), COVER, 'so does a lone reply of it');
  // Loaded, the first message's own acts say it, and the place's older read never puts back what they moved past.
  const newer = { ...COVER, stands: 'Booked' };
  const root = { id: 'm-root', reply_to: null, acts: { cover: newer, cover_revision: 3 }, stack_position: placed };
  assert.equal(stackCover({ head: root, replies: [reply('m-r1', 'm-root')] }), newer);
  // A message on its own takes its cover as pills; a dossier with none, or a Core before covers, shows none.
  const lone = { id: 'm-lone', reply_to: null, acts: { cover: COVER, cover_revision: 1 }, stack_position: at(4, { root_id: 'm-lone', cover: COVER, cover_revision: 1 }) };
  assert.equal(stackCover({ head: lone, replies: [] }), null, 'a message on its own has no sheet');
  assert.equal(stackCover({ head: lone, replies: [] }, { alone: true }), COVER, 'its pills show its own cover');
  assert.equal(stackCover({ head: reply('m-r1', 'm-root'), replies: [] }, { alone: true }), COVER, 'a lone reply\'s pills show its dossier\'s');
  assert.equal(stackCover({ head: { ...reply('m-r1', 'm-root'), stack_position: at(4, { cover: null, cover_revision: 0 }) }, replies: [] }), null, 'a dossier with no cover shows none');
  assert.equal(stackCover({ head: { ...reply('m-r1', 'm-root'), stack_position: at(4) }, replies: [] }), null, 'a place from a Core before covers carries none');
});
