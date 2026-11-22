import test from 'node:test';
import assert from 'node:assert/strict';
import { StackFeed } from '../web/stack-feed.mjs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { cardIn } from '../web/fold.mjs';
import { stackMenuItems } from '../web/stack-menu-items.mjs';

function fixture() {
  const r = renderer799(), doc = r.list.ownerDocument;
  r.list.id = 'messages';
  doc.body = doc.createElement('body'); doc.body.append(r.list);
  doc.querySelector = selector => doc.body.querySelector(selector);
  doc.defaultView = { name: '', sessionStorage: { getItem() { return null; }, setItem() {} } };
  r.add([{ id: 'root', seq: 1, author_id: 'person', author_kind: 'human' },
    { id: 'child', seq: 2, reply_to: 'root', author_id: 'person', author_kind: 'human' }]);
  const feed = new StackFeed({ list: r.list, messages: () => r.messages, doc, viewer: 'reader', instanceId: 'test',
    nameOf: id => id, keep: () => false, unread: () => false, send() { throw Error('Routing test must delegate, not send'); } });
  feed.arrange(); const acts = [];
  feed.setAside = (stack, below) => acts.push(['aside', stack.id, below]);
  feed.move = (entry, way) => acts.push(['place', entry.dataset.id, way]);
  const key = (at, more = {}) => { at.nodeType = 1; at.focus(); let consumed = false; feed.key({ key: 'ArrowRight', metaKey: true, target: at,
    preventDefault() { consumed = true; }, ...more }); return consumed; };
  return { ...r, doc, feed, acts, key };
}

for (const selected of ['root', 'child']) test('705/1037 selected '+selected+' archives its actual containing dossier', () => {
  const f = fixture(); assert.equal(f.key(cardIn(f.feed.entryFor(selected))), true);
  assert.deepEqual(f.acts, [['aside', 'root', true]]);
});
test('705 no selection and writing keep their keys', () => {
  const f = fixture(); assert.equal(f.key(f.doc.body), false);
  const writing = f.doc.createElement('textarea'); f.list.append(writing);
  assert.equal(f.key(writing), false); assert.deepEqual(f.acts, []);
});
test('705 1037 Command Up retains reorder-up and Control/Option Right do not archive', () => {
  const f = fixture(), at = cardIn(f.feed.entryFor('child'));
  f.key(at, { key: 'ArrowUp' }); assert.deepEqual(f.acts, [['place', 'child', 'up']]);
  f.acts.length = 0;
  for (const more of [{ metaKey: false, ctrlKey: true }, { altKey: true }, { defaultPrevented: true }, { isComposing: true }]) f.key(at, more);
  assert.deepEqual(f.acts, []);
});
for (const below of [false, true]) test('705 menu shortcut belongs to Archive only, below='+below, () => {
  const menu = stackMenuItems({ position: true, found: true, below }, () => {}), all = [...menu.first, ...menu.last];
  assert.equal(all.find(i => i.key === 'aside').keys, below ? '' : '⌘→');
  assert.equal(all.find(i => i.key === 'move-down').keys, '⌘↓');
});
test('705 Reader archive offers no feed-only keyboard hint', () => {
  const menu = stackMenuItems({ position: true, found: true, reader: true, below: false }, () => {});
  assert.equal(menu.first.find(i => i.key === 'aside').keys, '');
});
