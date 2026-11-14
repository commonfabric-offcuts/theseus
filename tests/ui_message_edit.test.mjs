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

// Core as the frozen interface says it answers message.edit, view('operation')
// and source, for message m1 by tony. next: how the next command's answer goes
// wrong: 'drop' (it commits and the answer is lost), 'lost' (nothing reaches
// Core), 'busy' (Core is busy and takes nothing).
class FakeCore {
  constructor(body = 'Ship 228 tomorow') {
    this.revisions = [{ revision: 1, body }]; this.ops = new Map(); this.sent = []; this.next = null; this.views = [];
  }
  get current() { return this.revisions.at(-1); }
  editElsewhere(body) { this.revisions.push({ revision: this.current.revision + 1, body }); }
  receipt(envelope, status, recorded, more) {
    return { instance_id: INSTANCE, operation_id: envelope.operation_id, kind: envelope.kind, status, recorded, result: null, affected: [], ...more };
  }
  async command(envelope) {
    this.sent.push(copy(envelope));
    const fault = this.next; this.next = null;
    if (fault === 'lost') throw new AttemptError('Connection interrupted.', 0, null);
    if (fault === 'busy') return this.receipt(envelope, 'retryable', false, { error: { code: 'DATABASE_BUSY', message: 'busy', retryable: true } });
    assert.equal(envelope.kind, 'message.edit');
    assert.deepEqual(Object.keys(envelope.target), ['message_id']);
    assert.ok(Number.isSafeInteger(envelope.expected.message_revision), 'the base revision is expected');
    assert.deepEqual(Object.keys(envelope.args), ['body']);
    const fingerprint = JSON.stringify(envelope), held = this.ops.get(envelope.operation_id);
    if (held) return held.fingerprint === fingerprint ? held.receipt : this.receipt(envelope, 'rejected', false, { error: { code: 'OPERATION_PAYLOAD_MISMATCH', message: 'mismatch' } });
    let receipt;
    if (envelope.expected.message_revision !== this.current.revision) {
      receipt = this.receipt(envelope, 'rejected', true, { error: { code: 'REVISION_CONFLICT', message: 'changed', current_versions: { message_revision: this.current.revision } } });
    } else if (!envelope.args.body.trim()) return this.receipt(envelope, 'rejected', false, { error: { code: 'EMPTY_MESSAGE', message: 'empty' } });
    else if (envelope.args.body === this.current.body) return this.receipt(envelope, 'rejected', false, { error: { code: 'INVALID_ARGUMENT', message: 'unchanged' } });
    else {
      const revision = this.current.revision + 1;
      this.revisions.push({ revision, body: envelope.args.body });
      receipt = this.receipt(envelope, 'committed', true, { result: { message_id: 'm1', revision, edited_ms: 1000 + revision, corrections: 0 }, affected: [{ kind: 'message', id: 'm1', version: revision }] });
    }
    this.ops.set(envelope.operation_id, { fingerprint, receipt });
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
const BOOT = { instance_id: INSTANCE, actor: 'tony', authority: { authority_id: 'a', authority_epoch: 'e' } };
function writer(core = new FakeCore(), store = deviceStore(core), message = { id: 'm1', revision: 1, body: core.current.body, attachments: [] }) {
  const w = new MessageEditWriting({ message, bootstrap: BOOT, api: core, store, read: async () => copy(core.current) });
  return { w, core, store };
}

test('saved: the frozen envelope is on the device before it is sent; Core\'s revision 2 clears it', async () => {
  const { w, core, store } = writer();
  w.edit('Ship 228 tomorrow');
  await w.serial;
  assert.equal(store.held.value, 'Ship 228 tomorrow', 'editing: the draft is kept on the device');
  await w.save();
  assert.equal(store.at[0].pending.operation_id, core.sent[0].operation_id, 'the envelope was journaled before it left');
  assert.deepEqual(store.at[0].pending, core.sent[0]);
  assert.equal(core.sent[0].expected.message_revision, 1, 'on the base revision fixed when Edit opened');
  assert.equal(w.state, 'saved'); assert.equal(w.result.revision, 2); assert.equal(store.held, null, 'the journal is cleared');
});

test('conflict: another revision saved since Edit opened; Save mine sends a new operation on the new base, Use saved lets the words go', async () => {
  const mine = writer();
  mine.w.edit('My words');
  mine.core.editElsewhere('Their words');
  await mine.w.save();
  assert.equal(mine.w.state, 'conflict');
  assert.deepEqual(mine.w.conflict, { revision: 2, body: 'Their words' });
  assert.equal(mine.w.value, 'My words', 'the words are kept');
  await mine.w.resolve(true);
  assert.equal(mine.core.sent.length, 2);
  assert.notEqual(mine.core.sent[1].operation_id, mine.core.sent[0].operation_id, 'a new operation');
  assert.equal(mine.core.sent[1].expected.message_revision, 2, 'on the newer base');
  assert.equal(mine.w.state, 'saved'); assert.equal(mine.core.current.body, 'My words');
  const theirs = writer();
  theirs.w.edit('My words'); theirs.core.editElsewhere('Their words');
  await theirs.w.save(); await theirs.w.resolve(false);
  assert.equal(theirs.w.state, 'discarded'); assert.equal(theirs.core.sent.length, 1, 'Use saved sends nothing');
  assert.equal(theirs.store.held, null); assert.equal(theirs.core.current.body, 'Their words');
});

test('uncertain: no answer; Try again asks Core what it recorded first, and only an operation it does not know is sent again, the same', async () => {
  const committed = writer();
  committed.w.edit('Ship 228 tomorrow');
  committed.core.next = 'drop';
  await committed.w.save();
  assert.equal(committed.w.state, 'uncertain');
  assert.ok(committed.store.held.pending, 'the envelope stays on the device');
  await committed.w.retry();
  assert.deepEqual(committed.core.views, ['operation'], 'Core is asked first');
  assert.equal(committed.core.sent.length, 1, 'and its recorded receipt is taken without sending again');
  assert.equal(committed.w.state, 'saved'); assert.equal(committed.core.revisions.length, 2, 'one revision 2');
  const lost = writer();
  lost.w.edit('Ship 228 tomorrow');
  lost.core.next = 'lost';
  await lost.w.save();
  assert.equal(lost.w.state, 'uncertain');
  await lost.w.retry();
  assert.deepEqual(lost.core.views, ['operation']);
  assert.equal(lost.core.sent.length, 2);
  assert.deepEqual(lost.core.sent[1], lost.core.sent[0], 'the same journaled envelope goes again');
  assert.equal(lost.w.state, 'saved');
});

test('a reload while saving sends the journaled envelope again: one revision, the same receipt', async () => {
  const first = writer();
  first.w.edit('Ship 228 tomorrow');
  first.core.next = 'drop';
  await first.w.save();
  first.w.close();
  // The page is opened again: a new writing over the same device copy.
  const again = writer(first.core, first.store);
  await again.w.open();
  assert.equal(again.w.state, 'saved');
  assert.equal(first.core.revisions.length, 2, 'one revision 2');
  assert.ok(first.core.sent.every(envelope => envelope.operation_id === first.core.sent[0].operation_id), 'one operation throughout');
});

test('busy: Theseus took nothing, and Try again sends the same operation', async () => {
  const { w, core } = writer();
  w.edit('Ship 228 tomorrow');
  core.next = 'busy';
  await w.save();
  assert.equal(w.state, 'busy');
  await w.retry();
  assert.deepEqual(core.views, [], 'a busy answer is known not taken');
  assert.deepEqual(core.sent[1], core.sent[0]);
  assert.equal(w.state, 'saved');
});

test('empty, unchanged and refused: blank words send nothing, identical words end the edit unsent, and Core\'s refusal keeps the words', async () => {
  const blank = writer();
  blank.w.edit('   ');
  assert.equal(blank.w.empty, true);
  await blank.w.save();
  assert.equal(blank.core.sent.length, 0); assert.equal(blank.w.state, 'editing');
  const images = writer(undefined, undefined, { id: 'm1', revision: 1, body: 'x', attachments: [{ id: 'media-1' }] });
  images.w.edit('');
  assert.equal(images.w.empty, false, 'a message with an image may lose its words');
  const same = writer();
  same.w.edit('Ship 228 tomorrow'); same.w.edit('Ship 228 tomorow');
  await same.w.save();
  assert.equal(same.core.sent.length, 0); assert.equal(same.w.state, 'unchanged'); assert.equal(same.store.held, null);
  // Core refuses blank words where the page thought there were images.
  const refused = writer(undefined, undefined, { id: 'm1', revision: 1, body: 'Ship 228 tomorow', attachments: [{ id: 'gone' }] });
  refused.w.edit('');
  await refused.w.save();
  assert.equal(refused.w.state, 'refused'); assert.equal(refused.w.value, ''); assert.match(refused.w.error, /needs words/);
  assert.equal(refused.w.readOnly, false);
  const forbidden = writer();
  forbidden.core.command = async envelope => forbidden.core.receipt(envelope, 'rejected', false, { error: { code: 'OUTCOME_REACHED', message: 'Reached; its topics are kept to read.' } });
  forbidden.w.edit('Late words');
  await forbidden.w.save();
  assert.equal(forbidden.w.readOnly, true); assert.equal(forbidden.w.value, 'Late words', 'the words are kept');
  assert.equal(forbidden.w.edit('More'), false, 'and nothing more is written');
});

test('cancel lets the edit\'s writing go; leaving keeps it on the device for the next Edit', async () => {
  const cancelled = writer();
  cancelled.w.edit('Half a thought');
  await cancelled.w.cancel();
  assert.equal(cancelled.w.state, 'cancelled'); assert.equal(cancelled.store.held, null); assert.equal(cancelled.core.sent.length, 0);
  const left = writer();
  left.w.edit('Half a thought');
  await left.w.serial;
  left.w.close();
  assert.equal(left.store.closed, true); assert.equal(left.store.held.value, 'Half a thought');
  const back = writer(left.core, left.store);
  await back.w.open();
  assert.equal(back.w.value, 'Half a thought'); assert.equal(back.w.state, 'editing');
});

test('the edit mode paints each state: its words, its controls and what it says', async t => {
  const doc = withDocument(t);
  const host = doc.createElement('div'), ended = [];
  const { w, core } = writer();
  const view = new MessageEdit({ host, writing: w, done: state => ended.push(state), doc });
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
  // Cancel ends it too, unsent.
  const second = writer();
  const cancelled = [];
  const other = new MessageEdit({ host: doc.createElement('div'), writing: second.w, done: state => cancelled.push(state), doc });
  other.cancel.onclick(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(cancelled, ['cancelled']); assert.equal(second.core.sent.length, 0);
});

test('words kept from an earlier Edit come back into the field, though the cursor is already in it', async t => {
  const doc = withDocument(t);
  const left = writer();
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
  const { w, core, store } = writer();
  const send = FakeCore.prototype.command.bind(core);
  core.command = async envelope => {
    core.sent.push(copy(envelope));
    if (envelope.args.body.length > 20) return core.receipt(envelope, 'rejected', true, { error: { code: 'BODY_TOO_LARGE', message: 'Writing exceeds the body limit; it has not been truncated' } });
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
  assert.notEqual(core.sent.at(-1).operation_id, core.sent[0].operation_id, 'a new operation');
  // Any other refusal says Core's words, the words kept.
  const other = writer();
  other.core.command = async envelope => other.core.receipt(envelope, 'rejected', true, { error: { code: 'ATTACHMENT_INVALID', message: 'Core says these will not do' } });
  other.w.edit('Other words');
  await other.w.save();
  assert.equal(other.w.error, 'Not saved: Core says these will not do');
  assert.equal(other.w.value, 'Other words');
});

test('a draft kept on the device and resumed after the message moved on keeps its base, and its Save is a conflict', async () => {
  const left = writer();
  left.w.edit('My words, written at revision 1');
  await left.w.serial; left.w.close();
  left.core.editElsewhere('Saved elsewhere');
  // Edit opens again on the Reader's revision 2: the kept draft brings back its own base.
  const back = writer(left.core, left.store, { id: 'm1', revision: 2, body: 'Saved elsewhere', attachments: [] });
  await back.w.open();
  assert.equal(back.w.value, 'My words, written at revision 1');
  await back.w.save();
  assert.equal(left.core.sent[0].expected.message_revision, 1, 'sent on the base the draft was written on');
  assert.equal(back.w.state, 'conflict', 'never an overwrite');
  assert.deepEqual(back.w.conflict, { revision: 2, body: 'Saved elsewhere' });
});

test('Save mine with words equal to the current revision ends the edit unchanged and sends nothing more', async () => {
  const { w, core, store } = writer();
  w.edit('The same fix');
  core.editElsewhere('The same fix');
  await w.save();
  assert.equal(w.state, 'conflict');
  await w.resolve(true);
  assert.equal(w.state, 'unchanged');
  assert.equal(core.sent.length, 1, 'only the Save that met the conflict was sent');
  assert.equal(store.held, null, 'the journal is cleared');
  // Cancel clears the journal; leaving keeps it (Escape).
  const cancelled = writer();
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
