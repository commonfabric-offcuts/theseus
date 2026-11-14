// Editing a message (docs/message-edit.md), the client's side: an open page
// takes an edited message's later revision and keeps going; a person edits
// their own message in the Reader's edit mode, whose writing journals the
// frozen envelope before it is sent and keeps one operation through every
// retry; "Edited" shows where the message does. Core is a typed fake of the
// frozen interface (message.edit, view('operation'), topic_messages
// {message_ids}), so each state is reached as Core would answer it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicViews, followEdits } from '../web/topic-views.mjs';
import { Freshness } from '../web/freshness.mjs';
import { keyAction, Editor } from '../web/editor.mjs';
import { paintAuthor } from '../web/marks.mjs';
import * as fold from '../web/fold.mjs';
import { CardScroll } from '../web/card-scroll.mjs';
import { Reader } from '../web/reader.mjs';
import { AttemptError } from '../web/api.mjs';
import { MessageEditWriting, mayEdit, revisionOf, wasEdited } from '../web/message-edit-writing.mjs';
import { MessageEdit, SAY } from '../web/message-edit.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const copy = structuredClone;
const INSTANCE = 'i1';
const page = items => ({ instance_id: INSTANCE, items, next_cursor: null, relevant_versions: { topic: 3 } });
// A topic_messages item as Core gives it; old: one from before revisions were kept, with no revision fields.
const item = (id, seq, body, more = {}) => ({ id, seq, topic_id: 't1', author_id: 'tony', body, ...more });

function withDocument(t) {
  const previous = { document: globalThis.document, window: globalThis.window };
  const document = miniDocument();
  globalThis.document = document;
  globalThis.window = { getSelection: () => null };
  t.after(() => Object.assign(globalThis, previous));
  return document;
}

test('an old-shape page holding a message reads a newest page with it at revision 2: it takes the new words, repaints and does not stop', () => {
  const painted = [];
  const v = new TopicViews({ instanceId: INSTANCE, topicId: 't1', paint: kind => painted.push(kind) });
  // The page as a tab loaded before this release holds it: no revision, no edited_ms.
  v.messagesPage(page([item('m1', 1, 'Ship 228 tomorow'), item('m2', 2, 'On it', { reply_to: 'm1', reply_to_author: 'tony', reply_to_excerpt: 'Ship 228 tomorow' })]), { initial: true });
  painted.length = 0;
  assert.doesNotThrow(() => v.messagesPage(page([item('m1', 1, 'Ship 228 tomorrow', { revision: 2, edited_ms: 5 }),
    item('m2', 2, 'On it', { revision: 1, edited_ms: null, reply_to: 'm1', reply_to_author: 'tony', reply_to_excerpt: 'Ship 228 tomorrow' })]), { initial: true }),
    'a changed body at a later revision is an edit, not a broken page');
  assert.equal(v.messages.get('m1').body, 'Ship 228 tomorrow');
  assert.equal(revisionOf(v.messages.get('m1')), 2);
  assert.ok(painted.includes('edited'), 'the edited message is repainted');
  assert.deepEqual([...v.takeRevised()].sort(), ['m1', 'm2'], 'the message and the loaded reply to it are repainted');
  // A page read before the edit, answering late, puts back nothing.
  v.messagesPage(page([item('m1', 1, 'Ship 228 tomorow', { revision: 1, edited_ms: null })]), { initial: true });
  assert.equal(v.messages.get('m1').body, 'Ship 228 tomorrow', 'a lower revision is ignored');
  assert.equal(revisionOf(v.messages.get('m1')), 2);
  assert.deepEqual([...v.takeRevised()], [], 'and repaints nothing');
});

test('what makes a message itself still holds: a moved, re-authored or same-revision rewritten message is refused', () => {
  const v = new TopicViews({ instanceId: INSTANCE, topicId: 't1' });
  v.messagesPage(page([item('m1', 1, 'Words', { revision: 2 })]), { initial: true });
  assert.throws(() => v.messagesPage(page([item('m1', 1, 'Other words', { revision: 2 })]), { initial: true }), /immutable/);
  assert.throws(() => v.messagesPage(page([item('m1', 1, 'Words', { revision: 3, author_id: 'warp' })]), { initial: true }), /immutable/);
});

test('an edit:<id> refresh reads topic_messages for that message alone, takes its later revision, and rewrites the reply lines of loaded replies', async () => {
  const painted = [];
  const v = new TopicViews({ instanceId: INSTANCE, topicId: 't1', paint: kind => painted.push(kind) });
  v.messagesPage(page([item('m1', 1, 'Ship 228 tomorow', { revision: 1, edited_ms: null }),
    item('m2', 2, 'On it', { author_id: 'warp', reply_to: 'm1', reply_to_author: 'tony', reply_to_excerpt: 'Ship 228 tomorow' }),
    item('m3', 3, 'Elsewhere', { author_id: 'warp' })]), { initial: true });
  v.takeRevised();
  const asked = [];
  const read = async (name, args) => { asked.push([name, args]); return page([item('m1', 1, 'Ship 228 tomorrow '.repeat(10), { revision: 2, edited_ms: 9 })]); };
  assert.equal(await v.refresh('edit:m1', 2, read), true);
  assert.deepEqual(asked, [['topic_messages', { topic_id: 't1', message_ids: ['m1'] }]]);
  assert.equal(v.messages.get('m1').edited_ms, 9);
  assert.equal(v.messages.get('m2').reply_to_excerpt, Array.from('Ship 228 tomorrow '.repeat(10)).slice(0, 120).join(''), 'the reply line reads the first 120 characters');
  assert.equal(v.messages.get('m3').reply_to_excerpt, undefined, 'a message replying to something else is left alone');
  assert.deepEqual([...v.takeRevised()].sort(), ['m1', 'm2']);
  assert.ok(painted.includes('edited'));
  // Not loaded here: nothing is read.
  asked.length = 0;
  assert.equal(await v.refresh('edit:m9', 2, read), true);
  assert.deepEqual(asked, []);
  // An answer behind the change's revision is read again.
  await assert.rejects(v.refresh('edit:m1', 3, read), error => error.code === 'RESOURCE_NOT_CURRENT');
});

test('an edit of a message older than the loaded page is read by its id when a loaded reply answers it, and that reply line reads the latest words', async () => {
  const painted = [];
  const v = new TopicViews({ instanceId: INSTANCE, topicId: 't1', paint: kind => painted.push(kind) });
  // The newest page holds m40, which answers m1, older than the page; m41's line is hidden from this reader; m42 answers another.
  v.messagesPage(page([item('m40', 40, 'On it', { author_id: 'warp', reply_to: 'm1', reply_to_author: 'tony', reply_to_excerpt: 'Ship it at 5', revision: 1, edited_ms: null }),
    item('m41', 41, 'Noted', { author_id: 'warp', reply_to: 'm1', reply_to_author: null, reply_to_excerpt: null }),
    item('m42', 42, 'Elsewhere', { author_id: 'warp', reply_to: 'm2', reply_to_author: 'tony', reply_to_excerpt: 'Other words' })]), { initial: true });
  v.takeRevised(); v.takeEdits(); painted.length = 0;
  const asked = [];
  let answer = item('m1', 1, 'Ship it at 6', { revision: 2, edited_ms: 9 });
  const read = async (name, args) => { asked.push([name, args]); return page(args.message_ids.includes('m1') ? [answer] : []); };
  assert.equal(await v.refresh('edit:m1', 2, read, () => true), true);
  assert.deepEqual(asked, [['topic_messages', { topic_id: 't1', message_ids: ['m1'] }]], 'the edited message is read alone, by its id');
  assert.equal(v.messages.get('m40').reply_to_excerpt, 'Ship it at 6', 'the loaded reply line reads the latest words');
  assert.equal(v.messages.get('m41').reply_to_excerpt, null, 'a line hidden from this reader stays hidden');
  assert.equal(v.messages.get('m42').reply_to_excerpt, 'Other words', 'a reply to another message is left alone');
  assert.equal(v.messages.has('m1'), false, 'the edited message is not taken into the loaded page: paging up reads it');
  assert.deepEqual([...v.takeRevised()], ['m40'], 'the reply\'s card is repainted');
  assert.deepEqual([...v.takeEdits().keys()], ['m1'], 'and what else holds the page\'s words hears of the edit');
  assert.ok(painted.includes('edited'));
  // A later edit, then an answer read before it arriving last: the line keeps the later words.
  answer = item('m1', 1, 'Ship it at 7', { revision: 3, edited_ms: 10 });
  await v.refresh('edit:m1', 3, read, () => true);
  answer = item('m1', 1, 'Ship it at 6', { revision: 2, edited_ms: 9 });
  await v.refresh('edit:m1', 2, read, () => true);
  assert.equal(v.messages.get('m40').reply_to_excerpt, 'Ship it at 7', 'an answer at a lower revision puts back nothing');
  // An answer behind the change is read again; neither loaded nor quoted here: nothing is read.
  await assert.rejects(v.refresh('edit:m1', 4, read, () => true), error => error.code === 'RESOURCE_NOT_CURRENT');
  asked.length = 0;
  assert.equal(await v.refresh('edit:m2x', 2, read, () => true), true);
  assert.deepEqual(asked, [], 'a message no loaded card shows or quotes is not read');
});

test('an edit of a message only another holder on the page shows (the conversation\'s own read) is read, and given to that holder', async () => {
  const held = new Set(['m7']);
  const v = new TopicViews({ instanceId: INSTANCE, topicId: 't1', holds: id => held.has(id) });
  v.messagesPage(page([item('m40', 40, 'Newest')]), { initial: true });
  const asked = [];
  const read = async (name, args) => { asked.push(args.message_ids); return page([item(args.message_ids[0], 7, 'Later words', { revision: 2, edited_ms: 9 })]); };
  assert.equal(await v.refresh('edit:m7', 2, read, () => true), true);
  assert.deepEqual(asked, [['m7']]);
  assert.equal(v.takeEdits().get('m7').body, 'Later words');
  assert.equal(await v.refresh('edit:m8', 2, read, () => true), true);
  assert.deepEqual(asked, [['m7']], 'one no holder shows is not read');
});

test('the conversation\'s own items follow each edit: the edited message\'s later revision, and the line of each reply to it', () => {
  const items = new Map([
    ['m1', item('m1', 1, 'Ship it at 5', { revision: 1, edited_ms: null, item: { state: 'new' } })],
    ['m40', item('m40', 40, 'On it', { reply_to: 'm1', reply_to_excerpt: 'Ship it at 5', item: { state: 'answered' } })],
    ['m41', item('m41', 41, 'Noted', { reply_to: 'm1', reply_to_excerpt: null })],
    ['m42', item('m42', 42, 'Elsewhere', { reply_to: 'm2', reply_to_excerpt: 'Other words' })]]);
  followEdits(items, new Map([['m1', item('m1', 1, 'Ship it at 6', { revision: 2, edited_ms: 9, preview: false })]]));
  assert.deepEqual({ ...items.get('m1') }, { ...item('m1', 1, 'Ship it at 6', { revision: 2, edited_ms: 9, preview: false, item: { state: 'new' } }) },
    'the edited message takes the later words and keeps what the conversation says of it');
  assert.equal(items.get('m40').reply_to_excerpt, 'Ship it at 6');
  assert.equal(items.get('m40').item.state, 'answered');
  assert.equal(items.get('m41').reply_to_excerpt, null, 'a hidden line stays hidden');
  assert.equal(items.get('m42').reply_to_excerpt, 'Other words', 'a reply to another message is left alone');
  followEdits(items, new Map([['m1', item('m1', 1, 'Ship it at 5', { revision: 1, edited_ms: null })]]));
  assert.equal(items.get('m1').body, 'Ship it at 6', 'a lower revision puts back nothing');
  assert.equal(items.get('m40').reply_to_excerpt, 'Ship it at 6');
});

test('an actor-scope edit change asks for its message to be read again; other private changes do not', async () => {
  const bootstrap = { instance_id: INSTANCE, actor: 'tony', authority: { authority_id: 'a', authority_epoch: 'e' },
    transport: { read_admission: { version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } } } };
  const cursor = (after_seq, scope) => ({ v: 1, kind: 'checkpoint', instance_id: INSTANCE, actor_id: 'tony', authority_id: 'a', authority_epoch: 'e', scope, after_seq });
  const actor = { kind: 'actor', id: 'tony' };
  const f = new Freshness({ api: {}, bootstrap, topicId: 't1', checkpoint: cursor(10, { kind: 'topic', id: 't1' }), actorCheckpoint: cursor(5, actor), read: () => {}, keys: () => [], refresh: async () => true });
  const answer = { instance_id: INSTANCE, scope: actor, has_more: false, continuation: null, checkpoint: cursor(10, actor), items: [
    { seq: 6, resource_kind: 'edit', resource_id: 'm1', version: 2 }, { seq: 7, resource_kind: 'delivery', resource_id: 'd1', version: 1 }] };
  await f.readWhispers(async () => answer, () => true);
  assert.deepEqual([...f.dirty.keys()], ['edit:m1']);
  assert.equal(f.dirty.get('edit:m1').version, 2);
});

test('an actor-scope edit_session change asks the page editing that message to compare it; a whisper\'s or a delivery\'s does not', async () => {
  const bootstrap = { instance_id: INSTANCE, actor: 'tony', authority: { authority_id: 'a', authority_epoch: 'e' },
    transport: { read_admission: { version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } } } };
  const cursor = (after_seq, scope) => ({ v: 1, kind: 'checkpoint', instance_id: INSTANCE, actor_id: 'tony', authority_id: 'a', authority_epoch: 'e', scope, after_seq });
  const actor = { kind: 'actor', id: 'tony' };
  const f = new Freshness({ api: {}, bootstrap, topicId: 't1', checkpoint: cursor(10, { kind: 'topic', id: 't1' }), actorCheckpoint: cursor(5, actor), read: () => {}, keys: () => [], refresh: async () => true });
  const answer = { instance_id: INSTANCE, scope: actor, has_more: false, continuation: null, checkpoint: cursor(10, actor), items: [
    { seq: 6, resource_kind: 'edit_session', resource_id: 'm1', version: 4 }, { seq: 7, resource_kind: 'delivery', resource_id: 'd1', version: 1 },
    { seq: 8, resource_kind: 'edit_session', resource_id: null, version: 5 }, { seq: 9, resource_kind: 'whisper', resource_id: 't1', version: 3 }] };
  await f.readWhispers(async () => answer, () => true);
  assert.deepEqual([...f.dirty.keys()], ['edit_session:m1', 'whisper:3'], 'a session change of a named message, and the whisper as before');
  assert.equal(f.dirty.get('edit_session:m1').version, 4);
});

test('"Edited" shows in a card\'s author line and is part of what it shows, so marking an edit repaints it', t => {
  withDocument(t);
  const author = document.createElement('span');
  paintAuthor(author, 'Tony', null, false, false);
  const before = author.dataset.shows;
  assert.doesNotMatch(author.text, /Edited/);
  paintAuthor(author, 'Tony', null, false, true);
  assert.notEqual(author.dataset.shows, before);
  assert.match(author.text, /Edited/);
  assert.equal(wasEdited({ revision: 2, edited_ms: 3 }), true);
  assert.equal(wasEdited({ revision: 1, edited_ms: null }), false);
  assert.equal(wasEdited({}), false, 'an item from before revisions were kept was never edited');
});

test('a folded line\'s words follow the message\'s latest words', t => {
  const doc = withDocument(t);
  doc.createTextNode = text => text;
  const card = doc.createElement('button');
  const folded = fold.foldCard(card, { id: 'm1', seq: 1, author_id: 'tony', addressees: ['warp'], body: 'Old words' }, doc);
  fold.paintFoldWords(folded, { id: 'm1', seq: 1, author_id: 'tony', addressees: ['warp'], body: 'New words' });
  assert.match(folded.text, /New words/);
  assert.doesNotMatch(folded.text, /Old words/);
});

test('a card read whole forgets the old whole words once its message is edited', async () => {
  const scroll = new CardScroll({ read: async id => ({ source_ref: { id }, body: 'Whole old words' }) });
  assert.equal(await scroll.whole('m1'), 'Whole old words');
  const card = Object.assign(new (miniDocument().createElement('div').constructor)('button'), { style: { maxHeight: '80px' } });
  card.dataset.whole = 'shown'; card.dataset.full = 'shown'; card.classList.add('scroll-in-place');
  scroll.forget('m1', card);
  assert.equal(scroll.known('m1'), undefined);
  assert.equal(card.dataset.whole, undefined); assert.equal(card.dataset.full, undefined);
  assert.equal(card.style.maxHeight, ''); assert.equal(card.classList.contains('scroll-in-place'), false);
});

test('in the edit mode ⌘Return saves the edit and Return is a new line', () => {
  const key = (more = {}) => ({ key: 'Enter', metaKey: false, shiftKey: false, altKey: false, isComposing: false, keyCode: 13, repeat: false, ...more });
  assert.equal(keyAction(key({ metaKey: true }), { context: 'edit' }), 'save-edit');
  assert.equal(keyAction(key(), { context: 'edit' }), 'newline');
  assert.equal(keyAction(key({ metaKey: true }), { context: 'reply' }), 'send-return', 'the reply keeps its own keys');
});

test('Edit shows only on a person\'s own message, in a topic they can read whose outcome is not reached', () => {
  const own = { author_id: 'tony' };
  assert.equal(mayEdit(own, { actor: 'tony', actorKind: 'human' }), true);
  assert.equal(mayEdit({ author_id: 'warp' }, { actor: 'tony', actorKind: 'human' }), false, 'someone else\'s message');
  assert.equal(mayEdit({ author_id: 'warp' }, { actor: 'warp', actorKind: 'agent' }), false, 'an agent\'s own message');
  assert.equal(mayEdit(own, { actor: 'tony', actorKind: 'human', unavailable: true }), false, 'a topic no longer readable');
  assert.equal(mayEdit(own, { actor: 'tony', actorKind: 'human', reached: true }), false, 'a reached outcome');
});

// The Reader as ui_reader_step.test.mjs builds it, showing message m1.
function reader(t, source = { source_ref: { kind: 'message', id: 'm1' }, body: 'Quoted passage', author: 'tony' }) {
  const doc = withDocument(t);
  const context = { instanceId: 'reader-edit', actor: 'tony', sourceRef: { kind: 'message', id: 'm1' }, topicId: 't1' };
  const reply = new Editor({ ...context, kind: 'reply' }, { id: 'reply', revision: 1, generation: 'g1', body: 'An unsent reply' });
  const note = new Editor({ ...context, kind: 'note' }, { id: 'note', revision: 1, body: '' });
  const elements = { 'reader-notice': Object.assign(doc.createElement('p'), { hidden: true }), 'reader-origin': doc.createElement('p'),
    'recipient-input': doc.createElement('input'), 'recipient-chips': Object.assign(doc.createElement('div'), { root: true }),
    'intent-row': doc.createElement('div'), 'send-reply': doc.createElement('button'), 'destination-note': doc.createElement('p'),
    'next-message': doc.createElement('button'), 'previous-message': doc.createElement('button'), 'message-edit': doc.createElement('div') };
  const acts = [];
  const r = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply, note }, mode: 'reply', presentation: {}, source, dialog: { open: true },
    field: doc.createElement('textarea'), sourceBody: Object.assign(doc.createElement('article'), { root: true }), $: id => elements[id],
    selectedPassage: () => 'Quoted passage', insertText: () => {}, disarm() {}, stepTo: where => acts.push(['step', where]),
    close: () => acts.push(['close']), send: () => acts.push(['send']),
    callbacks: { admits: () => true, writes: () => true, edit: () => {}, actorName: id => id, actor: () => 'tony',
      people: () => ({ kindOf: () => undefined, everyone: [] }) },
  });
  return { r, reply, elements, acts, doc };
}
const keyOn = (target, more) => ({ key: 'Enter', metaKey: false, shiftKey: false, altKey: false, keyCode: 0, isComposing: false, repeat: false,
  target, preventDefault() {}, stopPropagation() {}, ...more });

test('a quote names the revision of the message it was taken from, 1 for a message never edited', t => {
  const edited = reader(t, { source_ref: { kind: 'message', id: 'm1' }, body: 'Quoted passage', revision: 2 });
  edited.r.quote();
  assert.deepEqual(edited.reply.draft.quotes.map(quote => quote.source), [{ kind: 'message', id: 'm1', revision: 2 }]);
  const never = reader(t, { source_ref: { kind: 'message', id: 'm1' }, body: 'Quoted passage' });
  never.r.quote();
  assert.deepEqual(never.reply.draft.quotes.map(quote => quote.source), [{ kind: 'message', id: 'm1', revision: 1 }]);
  const page = reader(t, { source_ref: { kind: 'memory', id: 'n1', revision: 4 }, body: 'Quoted passage' });
  page.r.quote();
  assert.deepEqual(page.reply.draft.quotes.map(quote => quote.source), [{ kind: 'memory', id: 'n1', revision: 4 }], 'a Notebook page\'s quote is as it was');
});

test('while the Reader edits a message, ⌘↑ and ⌘↓ do not step, ⌘Return saves the edit and not the reply, and Escape leaves the edit keeping its writing', t => {
  const { r, acts, reply } = reader(t);
  const editing = { field: document.createElement('textarea'), saves: 0, leaves: 0, save() { this.saves++; }, leave() { this.leaves++; } };
  editing.field.closest = () => editing.field;
  r.editing = editing;
  const elsewhere = { closest: () => null };
  r.key(keyOn(elsewhere, { key: 'ArrowUp', metaKey: true }));
  r.key(keyOn(elsewhere, { key: 'ArrowDown', metaKey: true }));
  assert.deepEqual(acts, [], 'no step while editing');
  r.key(keyOn(editing.field, { metaKey: true }));
  assert.equal(editing.saves, 1);
  assert.deepEqual(acts, [], 'the reply is not sent');
  r.escape();
  assert.equal(editing.leaves, 1);
  assert.deepEqual(acts, [], 'Escape does not close the Reader while editing');
  assert.equal(reply.draft.body, 'An unsent reply', 'the unsent reply is untouched');
  // Not editing, the keys are the Reader's again.
  r.editing = null;
  r.key(keyOn(elsewhere, { key: 'ArrowUp', metaKey: true }));
  assert.deepEqual(acts, [['step', 'above']]);
});

test('the Reader\'s provenance says Edited for an edited message, and nothing for one never edited', t => {
  const { r, elements } = reader(t);
  r.paintOrigin({ source_ref: { kind: 'message', id: 'm1' }, author: 'tony', body: 'x', revision: 2, edited_ms: 1700000000000 });
  assert.match(elements['reader-origin'].text, /Edited/);
  r.paintOrigin({ source_ref: { kind: 'message', id: 'm1' }, author: 'tony', body: 'x', revision: 1, edited_ms: null });
  assert.doesNotMatch(elements['reader-origin'].text, /Edited/);
});

// Core as the frozen interface says it answers message.edit, the session
// commands (message.edit_open, message.edit_draft, message.edit_close),
// view('operation') and source, for message m1 by tony. next: how the next
// command's answer goes wrong; nextOf[kind]: the same for the next command of
// that kind: 'drop' (it commits and the answer is lost), 'lost' (nothing
// reaches Core), 'busy' (Core is busy and takes nothing), or a function that
// is the answer (a promise the test settles).
const DRAFT_LIMIT = 40;
class FakeCore {
  constructor(body = 'Ship 228 tomorow') {
    this.revisions = [{ revision: 1, body }]; this.ops = new Map(); this.sent = []; this.next = null; this.nextOf = {}; this.views = [];
    this.session = null; this.sessionRevision = 0; this.changes = [];
  }
  get current() { return this.revisions.at(-1); }
  get saves() { return this.sent.filter(envelope => envelope.kind === 'message.edit'); }
  of(kind) { return this.sent.filter(envelope => envelope.kind === kind); }
  get kinds() { return this.sent.map(envelope => envelope.kind.slice('message.'.length)); }
  editElsewhere(body) { this.revisions.push({ revision: this.current.revision + 1, body }); }
  // Another device's page, through Core: it opens the session for its holder.
  openElsewhere(holder = 'h-phone') { return this.apply({ kind: 'message.edit_open', args: { holder } }); }
  receipt(envelope, status, recorded, more) {
    return { instance_id: INSTANCE, operation_id: envelope.operation_id, kind: envelope.kind, status, recorded, result: null, affected: [], ...more };
  }
  refuse(envelope, code, recorded, more = {}) {
    return this.receipt(envelope, 'rejected', recorded, { error: { code, message: `Core says ${code}`, ...more } });
  }
  moveSession(state, more = {}) {
    this.sessionRevision++; Object.assign(this.session, { state, revision: this.sessionRevision, ...more });
    this.changes.push(this.sessionRevision);
  }
  // What Core does with one envelope, as message_edit.py does it.
  apply(envelope) {
    const s = this.session, open = s?.state === 'open', args = envelope.args;
    if (envelope.kind === 'message.edit_open') {
      assert.deepEqual(Object.keys(args), ['holder']);
      const taken = open && s.holder !== args.holder;
      if (!open) this.session = { base_revision: this.current.revision, draft: this.current.body };
      this.moveSession('open', { holder: args.holder });
      const base = this.revisions.find(r => r.revision === this.session.base_revision);
      return { status: 'committed', result: { message_id: 'm1', session_revision: this.sessionRevision, holder: args.holder, taken, base_revision: base.revision,
        base_words: base.body, draft: this.session.draft, revision: this.current.revision, words: this.current.body, renewed_ms: 1, hold_ms: 120000 } };
    }
    if (envelope.kind === 'message.edit_draft') {
      assert.deepEqual(Object.keys(args).sort(), ['base_revision', 'body', 'holder']);
      if (args.body.length > DRAFT_LIMIT) return { refuse: ['BODY_TOO_LARGE', true] };
      if (!open) return { refuse: ['EDIT_CLOSED', false] };
      if (s.holder !== args.holder) return { refuse: ['EDIT_TAKEN', false] };
      if (envelope.expected.session_revision !== s.revision) return { refuse: ['REVISION_CONFLICT', true, { current_versions: { session_revision: s.revision } }] };
      this.moveSession('open', { draft: args.body, base_revision: args.base_revision });
      return { status: 'committed', result: { message_id: 'm1', session_revision: this.sessionRevision, renewed_ms: 2 } };
    }
    if (envelope.kind === 'message.edit_close') {
      assert.deepEqual(Object.keys(args), ['holder']);
      if (!open) return { status: 'committed', result: { message_id: 'm1', closed: false } };
      if (s.holder !== args.holder) return { refuse: ['EDIT_TAKEN', false] };
      this.moveSession('closed');
      return { status: 'committed', result: { message_id: 'm1', closed: true, session_revision: this.sessionRevision } };
    }
    assert.equal(envelope.kind, 'message.edit');
    assert.deepEqual(Object.keys(envelope.target), ['message_id']);
    assert.ok(Number.isSafeInteger(envelope.expected.message_revision), 'the base revision is expected');
    assert.ok(['body', 'body,holder'].includes(Object.keys(args).join()), 'args are {body} or {body, holder}');
    if (envelope.expected.message_revision !== this.current.revision) {
      return { refuse: ['REVISION_CONFLICT', true, { current_versions: { message_revision: this.current.revision } }] };
    }
    if (!args.body.trim()) return { refuse: ['EMPTY_MESSAGE', false] };
    if (args.body === this.current.body) return { refuse: ['INVALID_ARGUMENT', false] };
    const revision = this.current.revision + 1;
    this.revisions.push({ revision, body: args.body });
    const closes = open && s.holder === args.holder;
    if (closes) this.moveSession('saved');
    return { status: 'committed', result: { message_id: 'm1', revision, edited_ms: 1000 + revision, corrections: 0, session_closed: closes,
      ...(closes ? { session_revision: this.sessionRevision } : {}) } };
  }
  async command(envelope) {
    this.sent.push(copy(envelope));
    let fault = this.nextOf[envelope.kind] ?? this.next;
    if (this.nextOf[envelope.kind] !== undefined) delete this.nextOf[envelope.kind]; else this.next = null;
    if (typeof fault === 'function') return fault(envelope);
    if (fault === 'lost') throw new AttemptError('Connection interrupted.', 0, null);
    if (fault === 'busy') return this.receipt(envelope, 'retryable', false, { error: { code: 'DATABASE_BUSY', message: 'busy', retryable: true } });
    const fingerprint = JSON.stringify(envelope), held = this.ops.get(envelope.operation_id);
    if (held) return held.fingerprint === fingerprint ? held.receipt : this.refuse(envelope, 'OPERATION_PAYLOAD_MISMATCH', false);
    const done = this.apply(envelope);
    const receipt = done.refuse ? this.refuse(envelope, done.refuse[0], done.refuse[1], done.refuse[2]) :
      this.receipt(envelope, done.status, true, { result: done.result, affected: [{ kind: 'message', id: 'm1', version: this.current.revision }] });
    if (!done.refuse || done.refuse[1]) this.ops.set(envelope.operation_id, { fingerprint, receipt });
    if (fault === 'drop') throw new AttemptError('Connection interrupted.', 0, null);
    return receipt;
  }
  async view(name, args) {
    this.views.push(name);
    if (name !== 'operation') throw Error('unexpected view ' + name);
    return this.ops.get(args.operation_id)?.receipt ?? { instance_id: INSTANCE, operation_id: args.operation_id, status: 'unknown', recorded: false };
  }
}
// The device copy, as messageEditStore keeps it; at: what it held when each command left.
function deviceStore(core) {
  const store = { held: null, deleted: 0, closed: false, at: [] };
  Object.assign(store, { get: async () => copy(store.held), put: async value => { store.held = copy(value); }, delete: async () => { store.held = null; store.deleted++; },
    close: () => { store.closed = true; } });
  const command = core.command.bind(core);
  core.command = async envelope => { store.at.push(copy(store.held)); return command(envelope); };
  return store;
}
// A clock the test moves: timers fire when it passes their time, in order, and never otherwise.
class FakeTimers {
  constructor() { this.time = 0; this.due = new Map(); this.id = 0; }
  now() { return this.time; }
  setTimeout(fn, ms) { this.due.set(++this.id, { at: this.time + ms, fn }); return this.id; }
  clearTimeout(id) { this.due.delete(id); }
  async advance(ms) {
    const end = this.time + ms;
    for (;;) {
      const [id, next] = [...this.due].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      if (!next) break;
      this.due.delete(id); this.time = next.at; next.fn();
      await settle();
    }
    this.time = end; await settle();
  }
}
const settle = async () => { for (let n = 0; n < 20; n++) await new Promise(resolve => setImmediate(resolve)); };
const BOOT = { instance_id: INSTANCE, actor: 'tony', authority: { authority_id: 'a', authority_epoch: 'e' } };
function writer(core = new FakeCore(), store = deviceStore(core), message = { id: 'm1', revision: 1, body: core.current.body, attachments: [] },
  timers = new FakeTimers()) {
  const w = new MessageEditWriting({ message, bootstrap: BOOT, api: core, store, timers, read: async () => copy(core.current) });
  return { w, core, store, timers };
}
// Edit opened as the page opens it: the device row read, the session taken, a kept Save resumed.
async function opened(...args) {
  const made = writer(...args);
  await made.w.open();
  await settle();
  return made;
}
// A command whose answer the test gives: answer() lets it through Core, lose() drops it unanswered.
function heldBack(core) {
  let release;
  const command = FakeCore.prototype.command;
  const gate = envelope => new Promise((resolve, reject) => {
    release = { answer: () => { core.sent.pop(); resolve(command.call(core, envelope)); }, lose: () => reject(new AttemptError('Connection interrupted.', 0, null)) };
  });
  return { gate, get release() { return release; } };
}

test('opening Edit takes the session before anything shows: one edit_open with this device\'s holder, kept on the device first', async () => {
  const { w, core, store } = await opened();
  assert.deepEqual(core.kinds, ['edit_open']);
  assert.equal(typeof w.holder, 'string');
  assert.equal(store.at[0]?.holder, w.holder, 'the holder was on the device before edit_open left');
  assert.deepEqual(core.sent[0].args, { holder: w.holder });
  assert.equal(core.session.state, 'open');
  assert.equal(w.sessionRevision, 1); assert.equal(w.kept, 'Ship 228 tomorow'); assert.equal(w.value, 'Ship 228 tomorow');
  assert.equal(store.held.holder, w.holder, 'the row stays while the edit is unended, clean or not');
});

test('Edit could not start: refused, busy or unanswered, nothing opens, the Reader says why, and the row is left as it was', async () => {
  for (const [fault, words] of [[env => ({ instance_id: INSTANCE, operation_id: env.operation_id, kind: env.kind, status: 'rejected', recorded: true,
    error: { code: 'OUTCOME_REACHED', message: 'Field was reached; its topics are kept to read.' } }), 'Field was reached; its topics are kept to read.'],
  ['busy', 'Theseus was busy'], ['lost', 'Theseus did not answer']]) {
    const { w, core, store } = writer();
    store.held = { v: 1, binding: w.binding, base: { revision: 1, body: 'Ship 228 tomorow' }, value: 'Half typed', pending: null, conflict: null,
      holder: 'h-kept', session_revision: 3, kept: 'Ship 228 tomorow', closing: null };
    const before = copy(store.held);
    core.nextOf['message.edit_open'] = fault;
    await assert.rejects(w.open(), error => error.message === `Edit could not start: ${words}`);
    assert.deepEqual(core.kinds, ['edit_open'], 'nothing else is sent');
    assert.equal(core.sent[0].args.holder, 'h-kept', 'the holder kept on the device goes');
    assert.deepEqual(store.held, before, 'the row is untouched');
    assert.equal(w.started, false);
    w.edit('More'); await settle();
    assert.deepEqual(core.kinds, ['edit_open'], 'no draft save goes from an edit that never opened');
  }
});

test('the field opens on Core\'s draft, or on this device\'s own words, which become the draft at once', async () => {
  // Core's draft: another device saved a draft on base 1, and this device has nothing kept.
  const core = new FakeCore();
  core.openElsewhere();
  core.apply({ kind: 'message.edit_draft', expected: { session_revision: 1 }, args: { holder: 'h-phone', body: 'Phone draft', base_revision: 1 } });
  const { w } = await opened(core);
  assert.equal(w.value, 'Phone draft'); assert.equal(w.kept, 'Phone draft'); assert.deepEqual(w.base, { revision: 1, body: 'Ship 228 tomorow' });
  assert.deepEqual(core.kinds, ['edit_open'], 'Core\'s own draft is not saved again');
  // Device words Core never confirmed, other than its draft: they open, and one draft save of them goes at once.
  const other = new FakeCore();
  const mine = writer(other);
  mine.store.held = { v: 1, binding: mine.w.binding, base: { revision: 1, body: 'Ship 228 tomorow' }, value: 'Laptop words', pending: null, conflict: null,
    holder: 'h-laptop', session_revision: 1, kept: 'Ship 228 tomorow', closing: null };
  await mine.w.open(); await settle();
  assert.equal(mine.w.value, 'Laptop words');
  assert.deepEqual(other.kinds, ['edit_open', 'edit_draft']);
  assert.deepEqual(other.sent[1].args, { holder: 'h-laptop', body: 'Laptop words', base_revision: 1 });
  assert.equal(other.sent[1].expected.session_revision, 1, 'on the session revision edit_open answered');
  assert.equal(mine.w.kept, 'Laptop words');
  // Clean device words (Core confirmed them, and they are the base's): Core's draft, with no save.
  const clean = writer(new FakeCore());
  clean.store.held = { v: 1, binding: clean.w.binding, base: { revision: 1, body: 'Ship 228 tomorow' }, value: 'Ship 228 tomorow', pending: null, conflict: null,
    holder: 'h-laptop', session_revision: 1, kept: 'Ship 228 tomorow', closing: null };
  await clean.w.open(); await settle();
  assert.deepEqual(clean.core.kinds, ['edit_open']);
});

test('a slice-1 row, with no holder, opens on its words as unconfirmed, and they become the draft', async () => {
  const { w, core, store } = writer();
  store.held = { v: 1, binding: w.binding, base: { revision: 1, body: 'Ship 228 tomorow' }, value: 'Kept by slice 1', pending: null, conflict: null };
  await w.open(); await settle();
  assert.equal(w.value, 'Kept by slice 1');
  assert.deepEqual(core.kinds, ['edit_open', 'edit_draft']);
  assert.equal(core.session.draft, 'Kept by slice 1');
  assert.equal(typeof store.held.holder, 'string', 'it was given a holder');
});

test('draft saves: debounced 450 ms idle, 2 s at most, on the session revision; the receipt keeps the words and the status reads Kept', async t => {
  const doc = withDocument(t);
  const { w, core, timers } = await opened();
  const view = new MessageEdit({ host: doc.createElement('div'), writing: w, doc });
  w.edit('Ship 228 tomorrow');
  assert.equal(view.status.textContent, SAY.kept, 'on this device until Core confirms them');
  await timers.advance(449);
  assert.deepEqual(core.kinds, ['edit_open'], 'nothing before the idle delay');
  await timers.advance(1);
  assert.deepEqual(core.kinds, ['edit_open', 'edit_draft']);
  assert.deepEqual(core.sent[1].expected.session_revision, 1);
  assert.equal(w.kept, 'Ship 228 tomorrow'); assert.equal(w.sessionRevision, 2);
  assert.equal(view.status.textContent, SAY.confirmed);
  // Typing without a pause: one save at the 2-second maximum.
  for (let n = 0; n < 8; n++) { w.edit('Ship 228 tomorrow' + '!'.repeat(n + 1)); await timers.advance(300); }
  assert.deepEqual(core.of('message.edit_draft').length, 2, 'one more, at 2 s');
  assert.equal(core.of('message.edit_draft')[1].expected.session_revision, 2);
});

test('a key, a press or the focus in the field renews the hold once a quarter of it has passed, and not sooner', async t => {
  const doc = withDocument(t);
  for (const name of ['keydown', 'focus', 'pointerdown']) {
    const { w, core, timers } = await opened();
    const view = new MessageEdit({ host: doc.createElement('div'), writing: w, doc });
    assert.equal(typeof view.field.listeners[name], 'function', `${name}: the field listens for it`);
    view.field.listeners[name]();
    assert.deepEqual(core.kinds, ['edit_open'], `${name}: not yet`);
    await timers.advance(30000);
    view.field.listeners[name](); await settle();
    assert.deepEqual(core.kinds, ['edit_open', 'edit_draft'], `${name}: renewed`);
  }
});

test('a draft save with no answer goes again under its own operation, and Core answers what it recorded', async () => {
  const { w, core, timers } = await opened();
  core.nextOf['message.edit_draft'] = 'drop';
  w.edit('Ship 228 tomorrow'); await timers.advance(450);
  assert.equal(w.kept, 'Ship 228 tomorow', 'not confirmed');
  w.edit('Ship 228 tomorrow.'); await timers.advance(450);
  const drafts = core.of('message.edit_draft');
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts[1], drafts[0], 'the lost one goes again, the same');
  assert.equal(w.kept, 'Ship 228 tomorrow');
  await timers.advance(450);
  assert.equal(core.of('message.edit_draft').length, 2, 'the newer words wait for the next edit');
  w.edit('Ship 228 tomorrow!'); await timers.advance(450);
  assert.equal(core.of('message.edit_draft')[2].args.body, 'Ship 228 tomorrow!');
});

test('draft refusals: EDIT_CLOSED stops them, BODY_TOO_LARGE pauses them until the words fit, FORBIDDEN makes the edit read-only', async t => {
  const doc = withDocument(t);
  const closed = await opened();
  const view = new MessageEdit({ host: doc.createElement('div'), writing: closed.w, doc });
  closed.core.session.state = 'closed';
  closed.w.edit('After a close elsewhere'); await closed.timers.advance(450);
  assert.equal(closed.w.draftClosed, true);
  assert.equal(view.status.textContent, SAY.kept, 'Kept on this device');
  closed.w.edit('More words'); await closed.timers.advance(2000);
  assert.equal(closed.core.of('message.edit_draft').length, 1, 'no more draft saves');
  await closed.w.save();
  assert.equal(closed.w.state, 'saved', 'Save still commits by revision');
  const long = await opened();
  long.w.edit('x'.repeat(DRAFT_LIMIT + 5)); await long.timers.advance(450);
  assert.equal(long.w.state, 'refused'); assert.equal(long.w.error, 'Not saved: too long');
  assert.equal(long.w.value, 'x'.repeat(DRAFT_LIMIT + 5), 'the words stay');
  long.w.edit('x'.repeat(DRAFT_LIMIT + 6)); await long.timers.advance(450);
  assert.equal(long.core.of('message.edit_draft').length, 1, 'paused while the words do not fit');
  long.w.edit('Short again'); await long.timers.advance(450);
  const drafts = long.core.of('message.edit_draft');
  assert.equal(drafts.length, 2); assert.notEqual(drafts[1].operation_id, drafts[0].operation_id, 'a new operation');
  assert.equal(long.w.kept, 'Short again'); assert.equal(long.w.state, 'editing');
  const forbidden = await opened();
  forbidden.core.nextOf['message.edit_draft'] = env => forbidden.core.refuse(env, 'FORBIDDEN', true);
  forbidden.w.edit('Late words'); await forbidden.timers.advance(450);
  assert.equal(forbidden.w.readOnly, true); assert.equal(forbidden.w.state, 'refused'); assert.equal(forbidden.w.value, 'Late words');
  assert.equal(forbidden.w.edit('More'), false);
  await forbidden.w.cancel();
  assert.deepEqual(forbidden.core.kinds, ['edit_open', 'edit_draft', 'edit_close'], 'the read-only Cancel closes the session once');
});

test('a draft save that meets REVISION_CONFLICT on the session revision goes once more, on the current one, as a new operation', async () => {
  const { w, core, timers } = await opened();
  core.sessionRevision++; core.session.revision = core.sessionRevision;
  w.edit('Ship 228 tomorrow'); await timers.advance(450);
  const drafts = core.of('message.edit_draft');
  assert.equal(drafts.length, 2);
  assert.equal(drafts[1].expected.session_revision, 2); assert.notEqual(drafts[1].operation_id, drafts[0].operation_id);
  assert.equal(w.kept, 'Ship 228 tomorrow');
  // Twice in a row: it stops after the once.
  let refusals = 0;
  core.command = (send => async env => {
    if (env.kind !== 'message.edit_draft' || refusals === 2) return send(env);
    refusals++; core.sent.push(copy(env));
    return core.refuse(env, 'REVISION_CONFLICT', true, { current_versions: { session_revision: 9 } });
  })(core.command);
  w.edit('Ship 228 tomorrow!'); await timers.advance(450);
  assert.equal(core.of('message.edit_draft').length, 4, 'the refused one and its one resend, no more');
  assert.equal(w.sessionRevision, 9); assert.equal(w.kept, 'Ship 228 tomorrow');
});

test('Save waits only for a draft save in flight until that request returns, never on the debounce', async () => {
  const { w, core, timers } = await opened();
  const held = heldBack(core);
  core.nextOf['message.edit_draft'] = held.gate;
  w.edit('Ship 228 tomorrow'); await timers.advance(450);
  w.edit('Ship 228 tomorrow!');
  const saving = w.save(); await settle();
  assert.deepEqual(core.kinds, ['edit_open', 'edit_draft'], 'the Save waits for the draft request out');
  held.release.lose(); await saving;
  assert.deepEqual(core.kinds, ['edit_open', 'edit_draft', 'edit'], 'and goes once it returned with no answer');
  assert.equal(w.state, 'saved'); assert.equal(core.session.state, 'saved', 'the holder\'s Save closed the session');
  await timers.advance(5000);
  assert.deepEqual(core.kinds, ['edit_open', 'edit_draft', 'edit'], 'the debounced save never goes after the Save, nor any close');
});

test('renewal: a touch 30 s after Core last renewed sends one draft save at once; one sooner sends none; one with a save scheduled sends one', async () => {
  const { w, core, timers } = await opened();
  await timers.advance(29999);
  assert.equal(w.touch(), false); assert.deepEqual(core.kinds, ['edit_open']);
  await timers.advance(1);
  assert.equal(w.touch(), true); await settle();
  assert.deepEqual(core.kinds, ['edit_open', 'edit_draft']);
  assert.equal(core.sent[1].args.body, 'Ship 228 tomorow', 'the current words, unchanged');
  await timers.advance(10000);
  assert.equal(w.touch(), false, 'within 30 s of that renewal');
  await timers.advance(20000);
  w.edit('Ship 228 tomorrow');
  assert.equal(w.touch(), true); await settle();
  await timers.advance(3000);
  assert.equal(core.of('message.edit_draft').length, 2, 'the scheduled save was folded into the renewal');
  assert.equal(core.of('message.edit_draft')[1].args.body, 'Ship 228 tomorrow');
});

test('saved: the frozen envelope, with the holder, is on the device before it is sent; the holder\'s Save closes the session and sends no close', async () => {
  const { w, core, store } = await opened();
  w.edit('Ship 228 tomorrow');
  await w.save();
  const [save] = core.saves, at = store.at[core.sent.indexOf(core.sent.find(e => e.kind === 'message.edit'))];
  assert.deepEqual(at.pending, save, 'the envelope was journaled before it left');
  assert.deepEqual(save.args, { body: 'Ship 228 tomorrow', holder: w.holder });
  assert.equal(save.expected.message_revision, 1, 'on the base revision fixed when Edit opened');
  assert.equal(w.state, 'saved'); assert.equal(w.result.revision, 2); assert.equal(store.held, null, 'the journal is cleared');
  assert.deepEqual(core.kinds, ['edit_open', 'edit'], 'no close: Core closed it');
});

test('every ending sends one close: Cancel, unchanged, Use saved, and a Save that left the session open', async () => {
  const cancelled = await opened();
  cancelled.w.edit('Half a thought');
  await cancelled.w.cancel();
  assert.equal(cancelled.w.state, 'cancelled'); assert.equal(cancelled.store.held, null);
  assert.deepEqual(cancelled.core.kinds, ['edit_open', 'edit_close']); assert.equal(cancelled.core.session.state, 'closed');
  const same = await opened();
  same.w.edit('Ship 228 tomorrow'); same.w.edit('Ship 228 tomorow');
  await same.w.save();
  assert.equal(same.w.state, 'unchanged'); assert.deepEqual(same.core.kinds, ['edit_open', 'edit_close']);
  const theirs = await opened();
  theirs.w.edit('My words'); theirs.core.editElsewhere('Their words');
  await theirs.w.save(); await theirs.w.resolve(false);
  assert.equal(theirs.w.state, 'discarded'); assert.deepEqual(theirs.core.kinds, ['edit_open', 'edit', 'edit_close']);
  assert.equal(theirs.store.held, null); assert.equal(theirs.core.current.body, 'Their words');
  // A receipt that says the session stayed open (Core closed none: here, a session another page reopened between).
  const left = await opened();
  left.core.nextOf['message.edit'] = async env => {
    const receipt = await FakeCore.prototype.command.call(left.core, env); left.core.sent.pop();
    return { ...receipt, result: { ...receipt.result, session_closed: false } };
  };
  left.w.edit('Ship 228 tomorrow'); await left.w.save();
  assert.equal(left.w.state, 'saved'); assert.deepEqual(left.core.kinds, ['edit_open', 'edit', 'edit_close']);
});

test('conflict: Save mine sends a new operation on the new base and the session closes with it', async () => {
  const mine = await opened();
  mine.w.edit('My words');
  mine.core.editElsewhere('Their words');
  await mine.w.save();
  assert.equal(mine.w.state, 'conflict');
  assert.deepEqual(mine.w.conflict, { revision: 2, body: 'Their words' });
  assert.equal(mine.w.value, 'My words', 'the words are kept');
  await mine.w.resolve(true);
  assert.equal(mine.core.saves.length, 2);
  assert.notEqual(mine.core.saves[1].operation_id, mine.core.saves[0].operation_id, 'a new operation');
  assert.equal(mine.core.saves[1].expected.message_revision, 2, 'on the newer base');
  assert.equal(mine.w.state, 'saved'); assert.equal(mine.core.current.body, 'My words');
  assert.equal(mine.core.of('message.edit_close').length, 0);
});

test('uncertain: no answer; Try again asks Core what it recorded first, and only an operation it does not know is sent again, the same', async () => {
  const committed = await opened();
  committed.w.edit('Ship 228 tomorrow');
  committed.core.nextOf['message.edit'] = 'drop';
  await committed.w.save();
  assert.equal(committed.w.state, 'uncertain');
  assert.ok(committed.store.held.pending, 'the envelope stays on the device');
  await committed.w.retry();
  assert.deepEqual(committed.core.views, ['operation'], 'Core is asked first');
  assert.equal(committed.core.saves.length, 1, 'and its recorded receipt is taken without sending again');
  assert.equal(committed.w.state, 'saved'); assert.equal(committed.core.revisions.length, 2, 'one revision 2');
  const lost = await opened();
  lost.w.edit('Ship 228 tomorrow');
  lost.core.nextOf['message.edit'] = 'lost';
  await lost.w.save();
  assert.equal(lost.w.state, 'uncertain');
  await lost.w.retry();
  assert.deepEqual(lost.core.views, ['operation']);
  assert.equal(lost.core.saves.length, 2);
  assert.deepEqual(lost.core.saves[1], lost.core.saves[0], 'the same journaled envelope goes again');
  assert.equal(lost.w.state, 'saved');
});

test('a reload while saving replays the journaled Save byte for byte, then sends one close: one revision, and the session is not open', async () => {
  // The Save never reached Core: it goes again as it was made, and then one close.
  const first = await opened();
  first.w.edit('Ship 228 tomorrow');
  first.core.nextOf['message.edit'] = 'lost';
  await first.w.save();
  first.w.close();
  const again = await opened(first.core, first.store);
  assert.equal(again.w.state, 'saved');
  assert.equal(first.core.revisions.length, 2, 'one revision 2');
  assert.equal(first.core.saves.length, 2); assert.deepEqual(first.core.saves[1], first.core.saves[0], 'byte for byte');
  assert.deepEqual(first.core.kinds, ['edit_open', 'edit', 'edit_open', 'edit', 'edit_close'], 'then one close');
  assert.notEqual(first.core.session.state, 'open'); assert.equal(first.store.held, null);
  // The Save committed and its answer was lost: the reload's edit_open opened a new session, as the first Save closed
  // the old one, which the recorded receipt cannot say; Core's receipt is taken, and the close ends the new session.
  const dropped = await opened();
  dropped.w.edit('Ship 228 tomorrow');
  dropped.core.nextOf['message.edit'] = 'drop';
  await dropped.w.save();
  dropped.w.close();
  const back = await opened(dropped.core, dropped.store);
  assert.equal(back.w.state, 'saved'); assert.deepEqual(dropped.core.views, ['operation']);
  assert.deepEqual(dropped.core.kinds, ['edit_open', 'edit', 'edit_open', 'edit_close']);
  assert.equal(dropped.core.session.state, 'closed', 'the session the reload opened is not left holding');
  // A slice-1 envelope journaled before this release ({body} alone) replays the same way, and is followed by one close.
  const old = writer();
  const envelope = { v: 1, instance_id: INSTANCE, operation_id: 'op-slice-1', kind: 'message.edit', target: { message_id: 'm1' },
    expected: { authority: { authority_id: 'a', authority_epoch: 'e' }, message_revision: 1 }, args: { body: 'Saved by slice 1' } };
  old.store.held = { v: 1, binding: old.w.binding, base: { revision: 1, body: 'Ship 228 tomorow' }, value: 'Saved by slice 1', pending: envelope, conflict: null };
  await old.w.open(); await settle();
  assert.deepEqual(old.core.saves, [envelope], 'replayed unchanged, with {body} only');
  assert.deepEqual(old.core.kinds, ['edit_open', 'edit', 'edit_close']);
  assert.equal(old.w.state, 'saved'); assert.equal(old.core.session.state, 'closed');
});

test('busy: Theseus took nothing, and Try again sends the same operation', async () => {
  const { w, core } = await opened();
  w.edit('Ship 228 tomorrow');
  core.nextOf['message.edit'] = 'busy';
  await w.save();
  assert.equal(w.state, 'busy');
  await w.retry();
  assert.deepEqual(core.views, [], 'a busy answer is known not taken');
  assert.deepEqual(core.saves[1], core.saves[0]);
  assert.equal(w.state, 'saved');
});

test('empty and refused: blank words send nothing, and Core\'s refusal keeps the words', async () => {
  const blank = await opened();
  blank.w.edit('   ');
  assert.equal(blank.w.empty, true);
  await blank.w.save();
  assert.equal(blank.core.saves.length, 0); assert.equal(blank.w.state, 'editing');
  const images = writer(undefined, undefined, { id: 'm1', revision: 1, body: 'x', attachments: [{ id: 'media-1' }] });
  images.w.edit('');
  assert.equal(images.w.empty, false, 'a message with an image may lose its words');
  // Core refuses blank words where the page thought there were images.
  const refused = await opened(undefined, undefined, { id: 'm1', revision: 1, body: 'Ship 228 tomorow', attachments: [{ id: 'gone' }] });
  refused.w.edit('');
  await refused.w.save();
  assert.equal(refused.w.state, 'refused'); assert.equal(refused.w.value, ''); assert.match(refused.w.error, /needs words/);
  assert.equal(refused.w.readOnly, false);
  const forbidden = await opened();
  forbidden.core.nextOf['message.edit'] = async envelope => forbidden.core.refuse(envelope, 'OUTCOME_REACHED', true, { message: 'Reached; its topics are kept to read.' });
  forbidden.w.edit('Late words');
  await forbidden.w.save();
  assert.equal(forbidden.w.readOnly, true); assert.equal(forbidden.w.value, 'Late words', 'the words are kept');
  assert.equal(forbidden.w.edit('More'), false, 'and nothing more is written');
});

test('a close with no answer keeps only the holder and its operation; the next Edit sends it again first', async () => {
  const left = await opened();
  left.core.nextOf['message.edit_close'] = 'lost';
  left.w.edit('Half'); await left.w.cancel();
  const close = left.core.of('message.edit_close')[0];
  assert.deepEqual(left.store.held, { v: 1, binding: left.w.binding, holder: left.w.holder, closing: close.operation_id }, 'the words go as Cancel meant');
  left.w.close();
  // Busy again: nothing opens, and the row stays as it was.
  const busy = writer(left.core, left.store);
  left.core.nextOf['message.edit_close'] = 'busy';
  await assert.rejects(busy.w.open(), /Edit could not start: Theseus was busy/);
  assert.equal(left.core.of('message.edit_close')[1].operation_id, close.operation_id, 'the same operation');
  assert.equal(left.core.of('message.edit_open').length, 1, 'no edit_open');
  assert.equal(left.store.held.closing, close.operation_id);
  // Answered: the row is cleared, and opening goes on, with a fresh holder.
  const next = await opened(left.core, left.store);
  assert.deepEqual(left.core.kinds.slice(-2), ['edit_close', 'edit_open']);
  assert.equal(left.core.sent.at(-2).operation_id, close.operation_id);
  assert.notEqual(next.w.holder, left.w.holder, 'a fresh row'); assert.equal(next.w.value, 'Ship 228 tomorow');
  // A resend refused (FORBIDDEN: it can never succeed) clears the row the same way.
  const refused = writer();
  refused.store.held = { v: 1, binding: refused.w.binding, holder: 'h-old', closing: 'op-close' };
  refused.core.nextOf['message.edit_close'] = env => refused.core.refuse(env, 'FORBIDDEN', false);
  await refused.w.open();
  assert.deepEqual(refused.core.kinds, ['edit_close', 'edit_open']);
  assert.notEqual(refused.w.holder, 'h-old');
});

test('Escape sends nothing and keeps the row; a reload rejoins the session with the same holder and its words', async () => {
  const left = await opened();
  left.w.edit('Half a thought');
  await left.w.serial;
  left.w.close();
  await left.timers.advance(5000);
  assert.deepEqual(left.core.kinds, ['edit_open'], 'nothing goes to Core, not even the debounced save');
  assert.equal(left.store.closed, true); assert.equal(left.store.held.value, 'Half a thought');
  const back = await opened(left.core, left.store);
  assert.equal(back.w.holder, left.w.holder);
  assert.equal(left.core.of('message.edit_open')[1].args.holder, left.w.holder);
  assert.equal(back.w.value, 'Half a thought'); assert.equal(back.w.state, 'editing');
  assert.deepEqual(left.core.kinds, ['edit_open', 'edit_open', 'edit_draft'], 'its unconfirmed words become the draft');
});

test('Escape while a draft save is out: the one queued behind it never goes', async () => {
  const { w, core, timers } = await opened();
  const held = heldBack(core);
  core.nextOf['message.edit_draft'] = held.gate;
  w.edit('Ship 228 tomorrow'); await timers.advance(450);
  w.edit('Ship 228 tomorrow!'); await timers.advance(450);
  assert.deepEqual(core.kinds, ['edit_open', 'edit_draft'], 'the second draft save waits behind the first');
  w.close();
  held.release.answer(); await settle();
  await timers.advance(5000);
  assert.deepEqual(core.kinds, ['edit_open', 'edit_draft'], 'after Escape, nothing more goes to Core');
});

test('another device took the edit: Open on your other device, no draft saves, Save still saves, and neither it nor Cancel closes', async t => {
  const doc = withDocument(t);
  const { w, core, timers } = await opened();
  const view = new MessageEdit({ host: doc.createElement('div'), writing: w, doc });
  assert.equal(view.here.hidden, true, 'Edit here shows only elsewhere');
  core.openElsewhere();
  w.sessionChanged(core.sessionRevision);
  assert.equal(w.elsewhere, true);
  assert.equal(view.status.textContent, SAY.elsewhere); assert.equal(view.here.hidden, false);
  assert.equal(view.here.textContent, 'Edit here'); assert.equal(view.here.title, 'Take the edit back to this device');
  w.edit('Laptop words'); await timers.advance(3000);
  assert.equal(core.of('message.edit_draft').length, 0, 'typing goes into the device row only');
  await w.save();
  assert.equal(w.state, 'saved'); assert.equal(core.saves.at(-1).args.holder, w.holder);
  assert.equal(core.session.state, 'open', 'the other device\'s session stays open');
  assert.equal(core.of('message.edit_close').length, 0);
  // Cancel in elsewhere: none either.
  const other = await opened();
  other.core.openElsewhere(); other.w.sessionChanged(other.core.sessionRevision);
  await other.w.cancel();
  assert.deepEqual(other.core.kinds, ['edit_open'], 'Cancel ends it here alone');
  // A draft save answered EDIT_TAKEN is the other way it learns.
  const taken = await opened();
  taken.core.openElsewhere();
  taken.w.edit('Typed'); await taken.timers.advance(450);
  assert.equal(taken.w.elsewhere, true);
  // A change at or below its own session revision is its own: it stays.
  const own = await opened();
  own.w.sessionChanged(own.w.sessionRevision);
  assert.equal(own.w.elsewhere, false);
});

test('a change read while a session command is out is compared once it answers: Edit here\'s own change leaves the page holding', async () => {
  const { w, core, timers } = await opened();
  core.openElsewhere(); w.sessionChanged(core.sessionRevision);
  assert.equal(w.elsewhere, true);
  w.edit('Laptop words');
  const held = heldBack(core);
  core.nextOf['message.edit_open'] = held.gate;
  const retaking = w.retake(); await settle();
  // Its own edit_open commits in Core and its change is read before its receipt arrives.
  held.release.answer(); w.sessionChanged(core.sessionRevision + 1);
  await retaking; await settle();
  assert.equal(w.elsewhere, false, 'still holding');
  assert.deepEqual(core.kinds.slice(-2), ['edit_open', 'edit_draft'], 'and this device\'s words become the draft');
  assert.equal(core.session.draft, 'Laptop words');
  w.edit('Laptop words, more'); await timers.advance(450);
  assert.equal(core.of('message.edit_draft').length, 2, 'draft saves go on');
  // A later change above it, with nothing out: elsewhere.
  core.openElsewhere(); w.sessionChanged(core.sessionRevision);
  assert.equal(w.elsewhere, true);
  // A command with no answer settles nothing until its resend does.
  const next = await opened();
  next.core.nextOf['message.edit_draft'] = 'lost';
  next.w.edit('One'); await next.timers.advance(450);
  next.w.sessionChanged(next.core.sessionRevision + 5);
  assert.equal(next.w.elsewhere, false, 'not while the draft save\'s outcome is unknown');
  next.w.edit('Two'); await next.timers.advance(450);
  assert.equal(next.w.elsewhere, true, 'its resend answered: the change was above it');
});

test('the edit mode paints each state: its words, its controls and what it says', async t => {
  const doc = withDocument(t);
  const host = doc.createElement('div'), ended = [];
  const { w, core } = await opened();
  const view = new MessageEdit({ host, writing: w, done: state => ended.push(state), doc });
  assert.equal(view.here.hidden, true, 'Edit here only when another device holds the edit');
  const shown = () => ({ status: view.status.textContent, save: view.save.disabled, retry: !view.retry.hidden, conflict: !view.conflictBox.hidden, readOnly: view.field.readOnly });
  assert.deepEqual(shown(), { status: '', save: false, retry: false, conflict: false, readOnly: false }, 'normal editing');
  view.field.value = '  '; view.field.listeners.input();
  assert.equal(shown().save, true, 'empty: Save is off');
  view.field.value = 'Ship 228 tomorrow'; view.field.listeners.input();
  await w.serial;
  assert.deepEqual(shown(), { status: SAY.kept, save: false, retry: false, conflict: false, readOnly: false }, 'editing: kept on this device');
  let release;
  core.command = envelope => new Promise(resolve => { release = () => resolve(FakeCore.prototype.command.call(core, envelope)); });
  const saving = w.save();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(shown(), { status: SAY.saving, save: true, retry: false, conflict: false, readOnly: true }, 'saving: read only');
  core.next = 'busy'; release(); await saving;
  assert.deepEqual(shown(), { status: SAY.busy, save: true, retry: true, conflict: false, readOnly: true }, 'busy: the words wait for Try again');
  assert.equal(w.edit('Words typed meanwhile'), false, 'busy: the words of the Save that goes again stay as sent');
  assert.equal(w.pending.args.body, 'Ship 228 tomorrow');
  core.command = FakeCore.prototype.command.bind(core);
  core.next = 'lost'; await w.retry();
  assert.deepEqual(shown(), { status: SAY.uncertain, save: true, retry: true, conflict: false, readOnly: true }, 'uncertain: the words wait for Try again');
  assert.equal(w.edit('Words typed meanwhile'), false, 'uncertain: the words stay as sent');
  core.editElsewhere('Their words');
  await w.retry();
  assert.deepEqual(shown(), { status: '', save: true, retry: false, conflict: true, readOnly: false }, 'conflict');
  assert.equal(view.savedWords.textContent, 'Their words');
  assert.equal(view.conflictTitle.textContent, 'This message was edited elsewhere');
  view.mine.onclick(); await new Promise(resolve => setTimeout(resolve, 0)); await w.serial;
  assert.deepEqual(ended, ['saved'], 'saved ends the edit mode');
  // Cancel ends it too, with no Save, and closes the session once.
  const second = await opened();
  const cancelled = [];
  const other = new MessageEdit({ host: doc.createElement('div'), writing: second.w, done: state => cancelled.push(state), doc });
  other.cancel.onclick(); await settle();
  assert.deepEqual(cancelled, ['cancelled']); assert.deepEqual(second.core.kinds, ['edit_open', 'edit_close']);
});

test('words kept from an earlier Edit come back into the field, though the cursor is already in it', async t => {
  const doc = withDocument(t);
  const left = await opened();
  left.w.edit('Half a thought'); await left.w.serial; left.w.close();
  const back = writer(left.core, left.store);
  const view = new MessageEdit({ host: doc.createElement('div'), writing: back.w, doc });
  view.field.focus();
  assert.equal(doc.activeElement, view.field, 'the Reader put the cursor in the field before the kept words were read');
  await back.w.open();
  assert.equal(view.field.value, 'Half a thought');
  // While the person types, the field is what they typed: the writing follows it, and paint leaves it be.
  view.field.value = 'Half a thought, and more'; view.field.listeners.input();
  assert.equal(back.w.value, 'Half a thought, and more'); assert.equal(view.field.value, 'Half a thought, and more');
});

// The join pass (contract revision 5): what the writing does on BODY_TOO_LARGE and any other refusal, a draft
// resumed on a base that moved, Save mine with the current words, and an edit refresh Core refuses.
test('too long: "Not saved: too long", the words kept in the field and on the device; changed words go as a new operation', async () => {
  const { w, core, store } = await opened();
  const send = core.command.bind(core);
  core.command = async envelope => {
    core.sent.push(copy(envelope));
    if (envelope.kind === 'message.edit' && envelope.args.body.length > 20) return core.receipt(envelope, 'rejected', true, { error: { code: 'BODY_TOO_LARGE', message: 'Writing exceeds the body limit; it has not been truncated' } });
    core.sent.pop(); return send(envelope);
  };
  w.edit('Words far longer than Core takes');
  await w.save();
  assert.equal(w.state, 'refused');
  assert.equal(w.error, 'Not saved: too long');
  assert.equal(w.value, 'Words far longer than Core takes', 'the words stay in the field');
  await w.serial;
  assert.equal(store.held.value, 'Words far longer than Core takes', 'and on the device');
  assert.equal(store.held.pending, null, 'the refused envelope is not sent again');
  assert.equal(w.readOnly, false, 'the person may shorten them');
  w.edit('Shorter words');
  await w.save();
  assert.equal(w.state, 'saved');
  assert.notEqual(core.saves.at(-1).operation_id, core.saves[0].operation_id, 'a new operation');
  // Any other refusal says Core's words, the words kept.
  const other = await opened();
  other.core.command = async envelope => other.core.receipt(envelope, 'rejected', true, { error: { code: 'ATTACHMENT_INVALID', message: 'Core says these will not do' } });
  other.w.edit('Other words');
  await other.w.save();
  assert.equal(other.w.error, 'Not saved: Core says these will not do');
  assert.equal(other.w.value, 'Other words');
});

test('a draft kept on the device and resumed after the message moved on keeps its base, and its Save is a conflict', async () => {
  const left = await opened();
  left.w.edit('My words, written at revision 1');
  await left.w.serial; left.w.close();
  left.core.editElsewhere('Saved elsewhere');
  // Edit opens again on the Reader's revision 2: the kept draft brings back its own base.
  const back = writer(left.core, left.store, { id: 'm1', revision: 2, body: 'Saved elsewhere', attachments: [] });
  await back.w.open();
  assert.equal(back.w.value, 'My words, written at revision 1');
  await back.w.save();
  assert.equal(left.core.saves[0].expected.message_revision, 1, 'sent on the base the draft was written on');
  assert.equal(back.w.state, 'conflict', 'never an overwrite');
  assert.deepEqual(back.w.conflict, { revision: 2, body: 'Saved elsewhere' });
});

test('Save mine with words equal to the current revision ends the edit unchanged and sends nothing more', async () => {
  const { w, core, store } = await opened();
  w.edit('The same fix');
  core.editElsewhere('The same fix');
  await w.save();
  assert.equal(w.state, 'conflict');
  await w.resolve(true);
  assert.equal(w.state, 'unchanged');
  assert.equal(core.saves.length, 1, 'only the Save that met the conflict was sent');
  assert.deepEqual(core.kinds, ['edit_open', 'edit', 'edit_close'], 'and the ending closed the session');
  assert.equal(store.held, null, 'the journal is cleared');
  // Cancel clears the journal; leaving keeps it (Escape).
  const cancelled = await opened();
  cancelled.w.edit('Half'); await cancelled.w.serial;
  assert.equal(cancelled.store.held.value, 'Half');
  await cancelled.w.cancel();
  assert.equal(cancelled.store.held, null);
});

test('an edit refresh that Core refuses leaves the card as it is, and does not stop the page', async () => {
  const painted = [];
  const v = new TopicViews({ instanceId: INSTANCE, topicId: 't1', paint: kind => painted.push(kind) });
  v.messagesPage(page([item('m1', 1, 'Ship 228 tomorow', { revision: 1, edited_ms: null })]), { initial: true });
  v.takeRevised(); painted.length = 0;
  for (const code of ['FORBIDDEN', 'INVALID_ARGUMENT']) {
    const read = async () => ({ instance_id: INSTANCE, error: { code, message: 'No readable source', retryable: false } });
    // What the refresh throws is its answer here, so a refusal that stops the page fails on an assertion.
    const ended = refresh => refresh.catch(error => `threw ${error.message}`);
    assert.equal(await ended(v.refresh('edit:m1', 2, read, () => true)), true, `${code}: the refresh is done`);
    assert.equal(v.messages.get('m1').body, 'Ship 228 tomorow', `${code}: the card's words stay`);
    assert.deepEqual(painted, []);
    // The page's own reads throw what Core refused (freshness.mjs, checkedView): the same.
    const thrown = async () => { throw Object.assign(Error('No readable source'), { details: { instance_id: INSTANCE, error: { code, message: 'No readable source' } } }); };
    assert.equal(await ended(v.refresh('edit:m1', 2, thrown, () => true)), true, `${code}, thrown: the refresh is done`);
    assert.equal(v.messages.get('m1').body, 'Ship 228 tomorow');
  }
  // Busy is not a refusal: it is read again.
  await assert.rejects(v.refresh('edit:m1', 2, async () => ({ instance_id: INSTANCE, error: { code: 'DATABASE_BUSY', message: 'busy', retryable: true } }), () => true));
});

test('the right rail reads again each place that holds an edited message, and only those', async () => {
  const { ThingsRail } = await import('../web/things-rail.mjs');
  const changed = [];
  const rail = { kept: new Map([
    ['t1', { version: 3, limit: 24, value: { messages: [{ id: 'm1', body: 'https://github.com/acme/field/pull/1' }], images: [] } }],
    ['t2', { version: 5, limit: 24, value: { messages: [{ id: 'm9', body: 'elsewhere' }], images: [] } }]]), changed: () => changed.push(true) };
  assert.equal(ThingsRail.prototype.messageEdited.call(rail, 'm1'), true);
  assert.deepEqual([...rail.kept.keys()], ['t2'], 'the place holding it is read again; the other is kept');
  assert.equal(changed.length, 1, 'and the rail reads');
  assert.equal(ThingsRail.prototype.messageEdited.call(rail, 'm404'), false, 'a message no place holds reads nothing');
  assert.equal(changed.length, 1);
});
