import test from 'node:test';
import assert from 'node:assert/strict';
import { renderer799 } from './fixtures/renderer799.mjs';
import { ArchiveShelf } from '../web/archive-shelf.mjs';
import { StackFeed } from '../web/stack-feed.mjs';

// Paint/identity semantics only. Native checks separately own actual geometry,
// Core unread records, visibility, input and reading acknowledgements.
function fixture(unreadIds = []) {
  const r = renderer799(), doc = r.list.ownerDocument, unread = new Set(unreadIds), calls = [], opens = [];
  doc.body = doc.createElement('body'); doc.body.root = true;
  const things = doc.createElement('aside'); things.id = 'things'; doc.body.append(things);
  things.getClientRects = () => [{}];
  const oldGet = doc.getElementById.bind(doc);
  doc.getElementById = id => doc.body.querySelector('#' + id) ?? oldGet(id);
  doc.defaultView = { addEventListener() {}, getComputedStyle: () => ({
    visibility: 'visible', display: 'block', position: 'static', getPropertyValue: () => '',
  }) };
  const feed = { list: r.list, state: {}, unread: item => unread.has(item.id),
    press: { over: async () => {} }, pending: new Map(), standIns: new Map(), arrange() {}, moreChanged() {},
    setAside: (stack, below) => calls.push([stack.id, below]), newest: (stack, mark) => opens.push([stack.id, mark]), undo: () => calls.push('undo') };
  const shelf = StackFeed.prototype.archiveShelf.call(feed);
  return { shelf, unread, doc, calls, feed, opens };
}
const dossier = (id, replies = []) => ({ id, dossier: id,
  head: { id, seq: 1, body: 'Dossier ' + id }, replies: replies.map((id, i) => ({ id, seq: i + 2 })) });
const paint = (f, stacks) => f.shelf.paint(stacks.map(stack => ({ stack, section: null })));
const mark = (f, id) => f.shelf.replicas.get(id).querySelector('.shelf-new');

test('1053 a new reply in a read archived dossier appears on its replica and Archived count', () => {
  const f = fixture(['reply']), stack = dossier('a', ['reply']); paint(f, [stack]);
  assert.equal(mark(f, 'a')?.textContent, '1 new'); assert.equal(mark(f, 'a').hidden, false);
  assert.equal(f.shelf.count.textContent, '1 · 1 new');
  assert.match(f.shelf.replicas.get('a').getAttribute('aria-label'), /1 new/);
  assert.equal(f.unread.has('reply'), true, 'painting the shelf never reads the hidden reply');
});

test('1053 live unread changes retain the same replica and focus, then clear from both places', () => {
  const f = fixture(), stacks = [dossier('a', ['r1', 'r2']), dossier('b')]; paint(f, stacks);
  const replica = f.shelf.replicas.get('a'); replica.focus();
  assert.equal(f.shelf.count.textContent, '2');
  f.unread.add('r1'); f.unread.add('r2'); f.unread.add('b'); paint(f, stacks);
  assert.equal(f.shelf.replicas.get('a'), replica); assert.equal(f.doc.activeElement, replica);
  assert.ok(mark(f, 'a'), 'the live reply creates its shelf mark');
  assert.equal(mark(f, 'a').textContent, '2 new'); assert.equal(f.shelf.count.textContent, '2 · 3 new');
  f.unread.clear(); paint(f, stacks);
  assert.equal(mark(f, 'a').hidden, true); assert.equal(f.shelf.count.textContent, '2');
  assert.doesNotMatch(replica.getAttribute('aria-label'), /new/);
});

test('1053 Auto List above18 and the Grid override preserve identical new counts', () => {
  const f = fixture(['r']), stacks = Array.from({ length: 20 }, (_, i) => dossier('a' + i, i ? [] : ['r']));
  paint(f, stacks); assert.equal(f.shelf.root.dataset.view, 'list');
  assert.equal(mark(f, 'a0')?.textContent, '1 new'); assert.equal(f.shelf.count.textContent, '20 · 1 new');
  f.shelf.viewButtons.find(b => b.dataset.value === 'grid').onclick();
  paint(f, stacks); assert.equal(f.shelf.root.dataset.view, 'grid');
  assert.equal(mark(f, 'a0').textContent, '1 new'); assert.equal(f.unread.has('r'), true);
});

test('1053 removing a dossier removes its counted new content without changing another unread record', () => {
  const f = fixture(['r', 'other']), a = dossier('a', ['r']), b = dossier('b', ['other']);
  paint(f, [a, b]); assert.equal(f.shelf.count.textContent, '2 · 2 new');
  paint(f, [b]); assert.equal(f.shelf.count.textContent, '1 · 1 new');
  assert.equal(f.shelf.replicas.has('a'), false); assert.deepEqual([...f.unread], ['r', 'other']);
});

test('1053 the existing shelf press brings back the actual dossier; a mark is not a second nested control', () => {
  const f = fixture(['r']), stack = dossier('a', ['r']); paint(f, [stack]);
  const feedMark = f.doc.createElement('span'); feedMark.className = 'stack-new-action';
  const section = f.doc.createElement('section'); section.append(feedMark);
  f.feed.state.sections = new Map([['a', section]]);
  const replica = f.shelf.replicas.get('a'); replica.onclick({ detail: 1 });
  assert.deepEqual(f.calls, [['a', false]]); assert.deepEqual(f.opens, [['a', feedMark]], 'the existing exact-message reader owns the new act'); assert.equal(f.unread.has('r'), true);
  assert.notEqual(mark(f, 'a')?.getAttribute('role'), 'button');
});

test('1053 two viewers derive new marks from their own feed predicate', () => {
  const a = fixture(['r']), b = fixture(), stack = dossier('a', ['r']);
  paint(a, [stack]); paint(b, [stack]);
  assert.equal(mark(a, 'a')?.hidden, false); assert.equal(mark(b, 'a')?.hidden, true);
  assert.equal(a.shelf.count.textContent, '1 · 1 new'); assert.equal(b.shelf.count.textContent, '1');
});


test('1053 an unavailable restoration does not start the exact-message read', () => {
  const f = fixture(['r']), stack = dossier('a', ['r']); paint(f, [stack]);
  const section = f.doc.createElement('section'), feedMark = f.doc.createElement('span'); feedMark.className = 'stack-new-action'; section.append(feedMark);
  f.feed.state.sections = new Map([['a', section]]); f.feed.setAside = () => false;
  f.shelf.replicas.get('a').onclick({ detail: 1 }); assert.deepEqual(f.opens, []);
});

const projected = (items = []) => ({ topic_id: 'topic', items, next_cursor: null, remaining: 0 });
const oldArchive = { message_id: 'remote', excerpt: 'An off-page excerpt', count: 3, unread: 0, seq: 1, latest: 3,
  through: 3, aside_revision: 1, order_key: 1, order_tie: 1 };

test('removing an off-page root rejects an older archive response', async () => {
  const { shelf } = fixture();
  shelf.started = true;
  shelf.read = async () => projected([oldArchive]);
  await shelf.readPage(true);
  assert.equal(shelf.replicas.get('remote').querySelector('.shelf-title').textContent, oldArchive.excerpt);
  let resolve;
  shelf.read = () => new Promise(done => { resolve = done; });
  const pending = shelf.readPage(true);
  shelf.read = async () => projected();
  shelf.removed('remote');
  assert.equal(shelf.replicas.has('remote'), false);
  resolve(projected([oldArchive]));
  await pending;
  assert.equal(shelf.replicas.has('remote'), false);
});

test('topic denial clears both archive sources and fences a late page', async () => {
  const f = fixture();
  f.shelf.started = true;
  f.shelf.read = async () => projected([oldArchive]);
  paint(f, [dossier('loaded')]);
  await f.shelf.readPage(true);
  assert.equal(f.shelf.replicas.size, 2);
  let resolve;
  f.shelf.read = () => new Promise(done => { resolve = done; });
  const pending = f.shelf.readPage(true);
  f.shelf.setAvailable(false);
  assert.equal(f.shelf.root.hidden, true);
  assert.equal(f.shelf.replicas.size, 0);
  paint(f, [dossier('loaded')]);
  resolve(projected([oldArchive]));
  await pending;
  assert.equal(f.shelf.projected.size, 0);
  assert.equal(f.shelf.replicas.size, 0);
});
