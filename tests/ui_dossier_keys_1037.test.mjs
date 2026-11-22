import test from 'node:test';
import assert from 'node:assert/strict';
import { StackFeed } from '../web/stack-feed.mjs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { cardIn } from '../web/fold.mjs';
import { MESSAGE_KEY_WORDS, keyAction } from '../web/pane-keys.mjs';
import { stackMenuItems } from '../web/stack-menu-items.mjs';

// Dispatch semantics only: three real rendered dossiers, with action-owner
// spies. Native/Core checks separately prove actual order, archive and Undo.
function fixture() {
  const r = renderer799(), doc = r.list.ownerDocument;
  r.list.id = 'messages'; doc.body = doc.createElement('body'); doc.body.append(r.list);
  doc.querySelector = selector => doc.body.querySelector(selector);
  doc.defaultView = { name: '', sessionStorage: { getItem() { return null; }, setItem() {} } };
  r.add(Array.from({ length: 3 }, (_, i) => [
    { id: 'root' + i, seq: i * 2 + 1, author_id: 'person', author_kind: 'human' },
    { id: 'child' + i, seq: i * 2 + 2, reply_to: 'root' + i, author_id: 'person', author_kind: 'human' },
  ]).flat());
  const feed = new StackFeed({ list: r.list, messages: () => r.messages, doc, viewer: 'reader', instanceId: 'test',
    nameOf: id => id, keep: () => false, unread: () => false, send() { throw Error('Dispatch must delegate to existing owner'); } });
  feed.arrange(); const acts = [];
  feed.setAside = (stack, below) => acts.push(['archive', stack.id, below]);
  feed.move = (entry, way) => acts.push(['move', entry.dataset.id, way]);
  feed.undo = () => acts.push(['undo']);
  const press = (id, key, extra = {}) => {
    const at = typeof id === 'string' ? cardIn(feed.entryFor(id)) : id;
    at.nodeType = 1; at.focus(); let consumed = false;
    feed.key({ key, metaKey: true, target: at, preventDefault() { consumed = true; }, ...extra });
    return consumed;
  };
  return { ...r, doc, feed, acts, press };
}

for (const [key, way] of [['ArrowDown', 'down'], ['ArrowUp', 'up']]) test('1037 three-dossier ' + key + ' delegates reorder without archiving', () => {
  const f = fixture(); assert.equal(f.feed.state.stacks.length, 3);
  assert.equal(f.press('root1', key), true);
  assert.deepEqual(f.acts, [['move', 'root1', way]]);
});
for (const selected of ['root1', 'child1']) test('1037 Command-Right from ' + selected + ' archives its containing dossier', () => {
  const f = fixture(); assert.equal(f.press(selected, 'ArrowRight'), true);
  assert.deepEqual(f.acts, [['archive', 'root1', true]]);
});
test('1037 Command-Z stays with Undo and Return stays with its existing owner', () => {
  const f = fixture(); assert.equal(f.press('child1', 'z'), true); assert.deepEqual(f.acts, [['undo']]);
  f.acts.length = 0; assert.equal(f.press('child1', 'Enter', { metaKey: false }), false); assert.deepEqual(f.acts, []);
});
test('1037 writing, no selection, composition and non-Command modifiers keep their keys', () => {
  const f = fixture(); assert.equal(f.press(f.doc.body, 'ArrowRight'), false);
  const writing = f.doc.createElement('textarea'); f.list.append(writing);
  assert.equal(f.press(writing, 'ArrowRight'), false);
  for (const extra of [{ metaKey: false, ctrlKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { defaultPrevented: true }])
    assert.equal(f.press('root1', 'ArrowRight', extra), false);
  assert.deepEqual(f.acts, []);
  assert.equal(keyAction({ key: 'ArrowRight', metaKey: true }), 'open', 'other panes keep the shared open action');
});
test('1037 visible message legend and menu name the restored defaults', () => {
  const legend = new Map(MESSAGE_KEY_WORDS);
  assert.match(legend.get('⌘↓') ?? '', /down/); assert.doesNotMatch(legend.get('⌘↓') ?? '', /below More/);
  assert.match(legend.get('⌘→') ?? '', /archiv/i);
  const menu = stackMenuItems({ position: true, found: true, below: false }, () => {});
  assert.equal(menu.first.find(x => x.key === 'aside').keys, '⌘→');
  assert.equal(menu.last.find(x => x.key === 'move-down').keys, '⌘↓');
});
