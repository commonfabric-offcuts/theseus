// Actual renderer/menu/handler data checks; native layout, gestures and Core
// persistence are separate. The command double keeps records apart from DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { withReaderArchive } from './fixtures/reader_archive.mjs';
import { arrangeStacks, stackState, setLevel, headClick, reveal } from '../web/reply-stacks.mjs';
import { StackFeed } from '../web/stack-feed.mjs';

const query = Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll = function(selector) {
  if (selector === '*') return [...this.descendants()];
  if (selector.includes(', ')) return [...new Set(selector.split(', ').flatMap(part => this.querySelectorAll(part)))];
  const parts = selector.split(' > ');
  if (parts.length > 2) return query.call(this, parts.slice(0, 2).join(' > ')).flatMap(child => child.querySelectorAll(':scope > ' + parts.slice(2).join(' > ')));
  return query.call(this, selector);
};
Object.defineProperties(Element.prototype, {
  ownerDocument: { get() { return this.document; } },
  firstElementChild: { get() { return this.children[0] ?? null; } },
  nextElementSibling: { get() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; } },
  parentElement: { get() { return this.parent; } },
  style: { get() { return { setProperty() {}, removeProperty() {} }; } },
});
Element.prototype.contains = function(node) { return node === this || [...this.descendants()].includes(node); };
Element.prototype.after = function(node) { this.parent.insertBefore(node, this.nextElementSibling); };

function fixture({ records = new Map(), count = 14, note = false, starred = false } = {}) {
  const doc = withReaderArchive(miniDocument()), list = doc.createElement('div'); list.root = true;
  const messages = new Map(), cards = new Map(), commands = [];
  const add = seq => {
    const id = 'm' + seq;
    if (!records.has(id)) records.set(id, { folded: false, fold_revision: 0, starred: seq === 1 && starred });
    const item = { id, seq, topic_id: 'isolated-1101', author_id: seq === 1 ? 'you' : 'other',
      body: 'Exact first line ' + seq + '\nSecond line stays.', reply_to: seq === 1 ? null : 'm1',
      acts: structuredClone(records.get(id)), yours: { note: seq === 1 && note } };
    const card = doc.createElement('button'); card.className = 'message-card'; card.dataset.id = id; card.dataset.seq = String(seq);
    const author = doc.createElement('span'); author.className = 'message-author';
    const body = doc.createElement('span'); body.className = 'message-preview'; body.textContent = item.body;
    card.append(author, body); list.append(card); messages.set(id, item); cards.set(id, card); card.scrollIntoView = () => {};
  };
  for (let i = 1; i <= count; i++) add(i);
  const state = stackState(list), draw = () => arrangeStacks(list, messages, { doc, viewer: 'you' });
  const feed = Object.assign(Object.create(StackFeed.prototype), { doc, list, undos: [],
    actsOf: id => messages.get(id).acts, entryFor: id => cards.get(id), arrange: draw,
    remember(action) { this.undos.push(action); }, focusOn() {}, say() {}, refuseFold: reason => ({ refused: reason }),
    act(kind, item, args) {
      assert.equal(kind, 'message.fold');
      const before = records.get(item.id), kept = { ...before, folded: args.folded, fold_revision: before.fold_revision + 1 };
      records.set(item.id, kept); item.acts = structuredClone(kept);
      commands.push({ kind, id: item.id, args, previous: before.fold_revision, revision: kept.fold_revision });
      return { recorded: true };
    } });
  draw();
  const head = () => cards.get('m1'), section = () => state.sections.get('m1');
  const earlier = () => section().querySelector('.stack-earlier');
  const openEarlier = () => { const button = earlier(); assert.ok(button); button.onclick({ pointerType: 'mouse' }); };
  const menu = () => feed.menuItems(messages.get('m1'), { reader: true }).first.find(item => item.key === 'fold');
  return { doc, list, state, messages, cards, records, commands, draw, add, feed, head, section, earlier, openEarlier, menu };
}
function whole(f) {
  assert.equal(f.section().dataset.headOpen, 'true');
  assert.notEqual(f.head().dataset.folded, 'true', 'the first message is not the personal folded row');
  assert.notEqual(f.head().dataset.earlier, 'true', 'no second temporary single line replaces the unfolded first message');
  assert.equal(f.head().querySelector('.message-earlier'), null);
  assert.equal(f.menu().label, 'Fold');
  assert.equal(f.feed.foldState(f.messages.get('m1')), 'fold', 'hover-bar action agrees with the menu');
}
function folded(f) {
  assert.equal(f.head().dataset.folded, 'true');
  assert.notEqual(f.head().dataset.earlier, 'true');
  assert.equal(f.head().querySelector('.message-folded').children[1].textContent, 'Exact first line 1');
  assert.equal(f.menu().label, 'Unfold');
  assert.equal(f.feed.foldState(f.messages.get('m1')), 'unfold');
}

test('1101 opening Earlier messages shows an unfolded first message whole and keeps earlier replies as rows', () => {
  const f = fixture(); assert.equal(f.section().dataset.headOpen, 'false');
  const held = f.state.held.get('m1'); f.openEarlier(); whole(f);
  assert.equal(f.cards.get('m2').dataset.earlier, 'true');
  assert.equal(f.cards.get('m8').dataset.earlier, undefined);
  f.add(15); f.draw(); whole(f);
  assert.equal(f.state.held.get('m1'), held, 'a later arrival never recounts the newest seven');
  assert.equal(f.cards.get('m2').dataset.earlier, 'true'); assert.deepEqual(f.commands, []);
});

test('1101 the actual menu Fold then Unfold changes the kept fold and draws whole again, including fresh views', () => {
  const records = new Map([['m1', { folded: true, fold_revision: 4, starred: false }]]), f = fixture({ records });
  f.openEarlier(); folded(f); f.menu().act(); whole(f);
  assert.deepEqual(records.get('m1'), { folded: false, fold_revision: 5, starred: false });
  assert.equal(f.messages.get('m1').body, 'Exact first line 1\nSecond line stays.');
  let fresh = fixture({ records }); fresh.openEarlier(); whole(fresh);
  fresh.menu().act(); folded(fresh);
  assert.deepEqual(records.get('m1'), { folded: true, fold_revision: 6, starred: false });
  const reloaded = fixture({ records }); reloaded.openEarlier(); folded(reloaded);
  reloaded.menu().act(); whole(reloaded);
  assert.deepEqual(records.get('m1'), { folded: false, fold_revision: 7, starred: false });
  assert.deepEqual([...f.commands, ...fresh.commands, ...reloaded.commands].map(x => [x.args.folded, x.previous, x.revision]),
    [[false, 4, 5], [true, 5, 6], [false, 6, 7]]);
});

test('1101 head title/rename/read handlers, closed earlier control and dossier level retain their meanings', () => {
  const f = fixture(), original = f.head(); f.openEarlier();
  const body = original.querySelector('.message-preview');
  assert.equal(headClick(f.list, original, { target: body }), false, 'whole message words continue to the reader/selection owner');
  const title = original.querySelector('.stack-head');
  assert.equal(headClick(f.list, original, { target: title }), true);
  assert.equal(f.section().dataset.fold, 'folded'); assert.equal(f.section().dataset.headOpen, 'false');
  assert.equal(f.commands.length, 0, 'title changes no saved personal fold');
  setLevel(f.state, f.state.stacks[0], 'open'); f.draw();
  assert.equal(f.section().dataset.headOpen, 'false'); assert.ok(f.earlier(), 'closed earlier control still represents the hidden head');
  f.openEarlier(); whole(f); assert.equal(f.head(), original, 'no message node is replaced');
});

test('1101 star, own-note and link-peek exceptions retain their existing fold record without exposing earlier replies', () => {
  for (const option of [{ starred: true }, { note: true }]) {
    const records = new Map([['m1', { folded: true, fold_revision: 3, starred: Boolean(option.starred) }]]), f = fixture({ ...option, records });
    f.openEarlier(); assert.notEqual(f.head().dataset.folded, 'true'); assert.notEqual(f.head().dataset.earlier, 'true');
    assert.equal(records.get('m1').fold_revision, 3); assert.equal(records.get('m1').folded, true); assert.deepEqual(f.commands, []);
  }
  const f = fixture({ records: new Map([['m1', { folded: true, fold_revision: 2, starred: false }]]) });
  reveal(f.head(), { full: true });
  assert.equal(f.section().dataset.headOpen, 'true'); assert.notEqual(f.head().dataset.folded, 'true');
  assert.equal(f.state.earlier.has('m1'), false); assert.equal(f.cards.get('m2').hidden, true);
  assert.deepEqual(f.records.get('m1'), { folded: true, fold_revision: 2, starred: false }); assert.deepEqual(f.commands, []);
});
