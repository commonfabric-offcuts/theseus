// The person's own order of their outcomes and topics (docs/outline-order.md)
// and the keys that move through the panes (docs/interaction.md, "Keys across
// the panes"), in the parts that decide: how a saved order and what Core lists
// make what is shown, what a move saves, what a read of the order accepts, how
// moves are sent and put back, and what each key means, never in writing. The
// native rail checks (tests/outcome_rail_native.mjs) press the real keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeIn, arrangeItems, moved, toSave, orderOf, movedWords, scopeOf, OrderBook } from '../web/outline-order.mjs';
import { keyAction, writing, KEY_WORDS, MESSAGE_KEY_WORDS } from '../web/pane-keys.mjs';

test('what the person placed keeps their order; what they never placed goes where Core lists it, after the one before it', () => {
  assert.deepEqual(placeIn(['a', 'b', 'c', 'd'], []), ['a', 'b', 'c', 'd'], 'nothing placed: Core\'s order');
  assert.deepEqual(placeIn(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a']), ['d', 'c', 'b', 'a']);
  // A new one (n) Core lists after b goes right after b, wherever b was placed; one listed first goes first.
  assert.deepEqual(placeIn(['a', 'b', 'n', 'c'], ['c', 'b', 'a']), ['c', 'b', 'n', 'a']);
  assert.deepEqual(placeIn(['n', 'a', 'b'], ['b', 'a']), ['n', 'b', 'a']);
  // Two new in a row keep Core's order between them, after the placed one before them.
  assert.deepEqual(placeIn(['a', 'n1', 'n2', 'b'], ['b', 'a']), ['b', 'a', 'n1', 'n2']);
  // The placed ones never move among themselves, whatever arrives.
  const placed = ['c', 'a', 'b'];
  for (const listed of [['a', 'b', 'c', 'x'], ['x', 'a', 'y', 'b', 'c'], ['a', 'z', 'c', 'b']]) {
    const shown = placeIn(listed, placed);
    assert.deepEqual(shown.filter(id => placed.includes(id)), placed, `placed stay put among ${listed}`);
    assert.deepEqual([...shown].sort(), [...listed].sort(), 'every listed one shows, once');
  }
});

test('a removed outcome or topic drops out, and an order from another device naming what this page does not know is passed over', () => {
  assert.deepEqual(placeIn(['a', 'c'], ['c', 'b', 'a']), ['c', 'a'], 'b is gone from what Core lists: it drops out');
  assert.deepEqual(placeIn(['a', 'b'], ['zz', 'b', 'yy', 'a', 'b']), ['b', 'a'], 'unknown ids and a repeat are passed over');
  assert.deepEqual(placeIn(['a', 'b'], ['zz']), ['a', 'b'], 'nothing it names is here: Core\'s order');
  // Items keep themselves, in the order shown.
  const items = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
  assert.deepEqual(arrangeItems(items, ['b', 'a']), [items[1], items[0]]);
  assert.equal(arrangeItems(items, ['b', 'a'])[0], items[1], 'the same item, not a copy');
  assert.deepEqual(arrangeItems(items, ['b']), items, 'a, never placed and listed first, stays first');
});

test('a move trades places with the neighbour on screen, and is refused at either end', () => {
  assert.deepEqual(moved(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moved(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
  assert.equal(moved(['a', 'b', 'c'], 'a', -1), null);
  assert.equal(moved(['a', 'b', 'c'], 'c', 1), null);
  assert.equal(moved(['a', 'b', 'c'], 'x', 1), null);
  assert.equal(moved(['a', 'b', 'c'], 'a', 2), null, 'one place at a time');
  // With only some on screen, it trades with the next one shown; those out of sight stay where they are.
  assert.deepEqual(moved(['a', 'h', 'b'], 'b', -1, new Set(['a', 'b'])), ['b', 'h', 'a']);
  assert.equal(moved(['h', 'b'], 'b', -1, new Set(['b'])), null, 'nothing shown above it');
  assert.equal(movedWords('Second', 3, 9), 'Second moved to 3 of 9');
});

test('what a move saves: everything shown in its order, and what an earlier save placed that is not shown here, after its place', () => {
  assert.deepEqual(toSave([], ['b', 'a']), ['b', 'a']);
  // x was placed on another device, where more was loaded: it is kept, after a, where it was.
  assert.deepEqual(toSave(['a', 'x', 'b'], ['b', 'a']), ['b', 'a', 'x']);
  assert.deepEqual(toSave(['x', 'a', 'b'], ['b', 'a']), ['x', 'b', 'a']);
  // Never more than the bound; what is shown comes first.
  const shown = Array.from({ length: 4 }, (_, n) => `s${n}`);
  assert.deepEqual(toSave(['o1', ...shown, 'o2'], shown, 5), [...shown, 'o1']);
  assert.deepEqual(toSave([], shown, 3), ['s0', 's1', 's2']);
});

test('the saved order reads as Core sends it, more than it knows passed over, and a broken one refused', () => {
  assert.equal(orderOf({ items: [] }), null, 'an older Core sends none: nothing is placed');
  assert.deepEqual(orderOf({ order: { ids: ['a'], revision: 2 } }), { ids: ['a'], revision: 2 });
  // A later Core may say more of the order; this page reads what it knows.
  assert.deepEqual(orderOf({ order: { ids: ['a'], revision: 2, placed_ms: 5, by_device: 'phone' } }), { ids: ['a'], revision: 2 });
  for (const order of [null, [], { ids: 'a', revision: 1 }, { ids: [1], revision: 1 }, { ids: [''], revision: 1 }, { ids: [], revision: -1 }, { ids: [], revision: 1.5 }, { ids: [] }]) {
    assert.throws(() => orderOf({ order }), /saved order could not be confirmed/, JSON.stringify(order));
  }
  assert.equal(scopeOf(null), 'outcomes');
  assert.equal(scopeOf('w1'), 'topics:w1');
});

// A Core that records each order sent, at the revision it was fenced on.
function fakeCore() {
  const core = { ids: [], revision: 0, sent: [], hold: null };
  core.send = async ({ ids, revision, operation }) => {
    core.sent.push({ ids, revision, operation });
    if (core.hold) await core.hold;
    if (revision !== core.revision) return { status: 'rejected', error: { code: 'REVISION_CONFLICT', message: 'changed' } };
    core.ids = ids; core.revision += 1;
    return { status: 'committed', result: { ids, order_revision: core.revision } };
  };
  return core;
}

test('a move shows at once, is sent once, and moves made while one is out go together in the next, fenced on its revision', async () => {
  const book = new OrderBook(), core = fakeCore(), heard = [];
  book.listen(scope => heard.push(scope));
  let release; core.hold = new Promise(resolve => { release = resolve; });
  const first = book.place('outcomes', ['b', 'a', 'c'], core.send, ['a', 'b', 'c']);
  assert.deepEqual(book.ids('outcomes'), ['b', 'a', 'c'], 'shown before Core answers');
  await null; await null;
  assert.equal(core.sent.length, 1, 'the first move is out');
  const second = book.place('outcomes', ['b', 'c', 'a'], core.send, ['b', 'a', 'c']);
  assert.equal(second, first, 'one flush per scope at a time');
  assert.deepEqual(book.ids('outcomes'), ['b', 'c', 'a']);
  release(); core.hold = null;
  assert.deepEqual(await first, { saved: true });
  assert.deepEqual(core.sent.map(each => [each.ids, each.revision]), [[['b', 'a', 'c'], 0], [['b', 'c', 'a'], 1]]);
  assert.deepEqual([core.ids, book.ids('outcomes'), book.entry('outcomes').revision], [['b', 'c', 'a'], ['b', 'c', 'a'], 2]);
  assert.ok(heard.length >= 3 && heard.every(scope => scope === 'outcomes'));
  // A read at an older revision does not undo it; a newer one replaces it.
  assert.equal(book.learn('outcomes', { ids: ['a'], revision: 1 }), false);
  assert.equal(book.learn('outcomes', { ids: ['c', 'b', 'a'], revision: 3 }), true);
  assert.deepEqual(book.ids('outcomes'), ['c', 'b', 'a']);
  // Another scope is its own.
  assert.deepEqual(book.ids('topics:w1'), []);
});

test('⌘Z puts the last move back, one at a time, and an order changed on another device is told, not overwritten', async () => {
  const book = new OrderBook(), core = fakeCore();
  await book.place('outcomes', ['b', 'a', 'c'], core.send, ['a', 'b', 'c']);
  await book.place('outcomes', ['b', 'c', 'a'], core.send, ['b', 'a', 'c']);
  let last = book.undo();
  assert.deepEqual(last, { scope: 'outcomes', ids: ['b', 'a', 'c'] });
  await book.place(last.scope, last.ids, core.send, null);
  assert.deepEqual(core.ids, ['b', 'a', 'c']);
  last = book.undo();
  await book.place(last.scope, last.ids, core.send, null);
  assert.deepEqual(core.ids, ['a', 'b', 'c'], 'back to how it was shown before the first move');
  assert.equal(book.undo(), null, 'an Undo is not itself undone');
  await book.place('outcomes', ['b', 'a', 'c'], core.send, ['a', 'b', 'c']);
  book.forget();
  assert.equal(book.undo(), null, 'once the keys leave, the moves stay');
  // Another device saved meanwhile: this one's move is refused and what it shows goes back.
  core.revision += 1; core.ids = ['c', 'a', 'b'];
  const before = book.ids('outcomes');
  assert.deepEqual(await book.place('outcomes', ['a', 'b', 'c'], core.send, before), { conflict: true });
  assert.deepEqual(book.ids('outcomes'), before, 'nothing is shown that Core did not take');
  assert.deepEqual(core.ids, ['c', 'a', 'b'], 'and the other device\'s order stands');
  // A request that never reached Core shows the order as it was and says so.
  const broken = async () => { throw Error('offline'); };
  const result = await book.place('outcomes', ['b', 'c', 'a'], broken, before);
  assert.equal(result.failed.message, 'offline');
  assert.deepEqual(book.ids('outcomes'), before);
});

test('a request sent again after a lost answer is the same request', async () => {
  const book = new OrderBook(), sent = [];
  let lose = true;
  const send = async request => { sent.push(request.operation); if (lose) { lose = false; throw Error('lost'); } return { status: 'committed', result: { ids: request.ids, order_revision: 1 } }; };
  await book.place('outcomes', ['b', 'a'], send, ['a', 'b']);
  await book.place('outcomes', ['b', 'a'], send, ['a', 'b']);
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1], 'the same order at the same revision keeps its operation');
});

const target = (selector = null) => ({ closest: wanted => (selector && wanted.split(',').map(part => part.trim()).includes(selector) ? {} : null) });
const press = (key, more = {}) => ({ key, target: target(), ...more });

test('each key means one thing in the panes: arrows move, ⌘ arrows open, fold and reorder, ⌘Z puts back, ⌘Return writes', () => {
  const said = keys => keys.map(([key, more]) => keyAction(press(key, more)));
  assert.deepEqual(said([['ArrowUp'], ['ArrowDown'], ['ArrowRight'], ['ArrowLeft'], ['Home'], ['End']]), ['up', 'down', 'right', 'left', 'first', 'last']);
  const command = { metaKey: true };
  assert.deepEqual(said([['ArrowUp', command], ['ArrowDown', command], ['ArrowRight', command], ['ArrowLeft', command], ['z', command], ['Enter', command]]),
    ['move-up', 'move-down', 'open', 'fold', 'undo', 'write']);
  // ⌘Return with another modifier, or while a character is composed, means nothing here.
  assert.deepEqual(said([['Enter', { metaKey: true, shiftKey: true }], ['Enter', { metaKey: true, altKey: true }], ['Enter', { metaKey: true, isComposing: true }], ['Enter', { ctrlKey: true }]]), [null, null, null, null]);
  // ⇧⌘→ and ⇧⌘← open and fold every outcome; ⇧⌘↑ and ⇧⌘↓ join reply stacks, which only the messages act on.
  const both = { metaKey: true, shiftKey: true };
  assert.deepEqual(said([['ArrowRight', both], ['ArrowLeft', both], ['ArrowUp', both], ['ArrowDown', both]]), ['open-all', 'fold-all', 'join-up', 'join-down']);
  // Return is the focused row's own; other keys and other modifiers mean nothing here.
  assert.deepEqual(said([['Enter'], ['a'], ['Tab'], ['ArrowUp', { altKey: true }], ['ArrowUp', { ctrlKey: true }], ['ArrowUp', { shiftKey: true }],
    ['z', { metaKey: true, shiftKey: true }], ['Home', command]]), [null, null, null, null, null, null, null, null]);
  assert.equal(keyAction(press('ArrowDown', { defaultPrevented: true })), null, 'a key something else took');
  assert.equal(keyAction(press('ArrowDown', { isComposing: true })), null, 'while composing a character');
  assert.deepEqual(KEY_WORDS.map(([keys]) => keys), ['↑ ↓', 'Return', '⌘→ ⌘←', '⇧⌘→ ⇧⌘←', '→ ←', '⌘Return', 'Option-N · Option-M', '⌘↑ ⌘↓', '⌘Z'], 'the legend names every key');
  assert.ok(KEY_WORDS.length >= 5 && KEY_WORDS.every(([keys, words]) => keys && /^[a-z]/.test(words) && !/\b[tw]-[0-9a-f]{6}/.test(words)), 'the legend is plain words');
  // Under "In the messages", the stack keys, each one the key map gives a message.
  assert.deepEqual(MESSAGE_KEY_WORDS.map(([keys]) => keys), ['↑ ↓', '⌘↑', '⌘↓', '→ ←', '⇧⌘↑ ⇧⌘↓', 'x', '⌘Z'], 'the messages\' legend names every stack key');
  const withCommand = (key, more = {}) => keyAction({ key, metaKey: true, ...more });
  assert.deepEqual([withCommand('ArrowUp'), withCommand('ArrowDown'), keyAction(press('ArrowRight')), keyAction(press('ArrowLeft')), withCommand('ArrowUp', { shiftKey: true }), withCommand('ArrowDown', { shiftKey: true }), withCommand('z')],
    ['move-up', 'move-down', 'right', 'left', 'join-up', 'join-down', 'undo'], 'and the key map gives each its act');
  // x folds the selected message (item 388): plain x only, never in writing, never with a modifier.
  assert.equal(keyAction(press('x')), 'fold-message');
  assert.deepEqual([['X', { shiftKey: true }], ['x', { metaKey: true }], ['x', { ctrlKey: true }], ['x', { altKey: true }], ['x', { isComposing: true }]].map(([key, more]) => keyAction(press(key, more))),
    [null, null, null, null, null], 'x with a modifier, or composing, means nothing here');
  for (const selector of ['input', 'textarea', '[contenteditable="true"]', '.composer', 'dialog']) assert.equal(keyAction({ key: 'x', target: target(selector) }), null, `x types in ${selector}`);
  assert.ok(MESSAGE_KEY_WORDS.every(([, words]) => /^[a-z]/.test(words) && !/\bm-[0-9a-f]{6}/.test(words)), 'in plain words');
});

test('keys never act in writing: a text field, the Reader, a composer or a pop-up keeps its own ⌘ arrows', () => {
  for (const selector of ['input', 'textarea', 'select', '[contenteditable="true"]', '[contenteditable=""]', 'dialog', '.composer', '[role="dialog"]', '[role="menu"]']) {
    assert.equal(writing(target(selector)), true, selector);
    for (const [key, more] of [['ArrowLeft', { metaKey: true }], ['ArrowRight', { metaKey: true }], ['ArrowUp', { metaKey: true }], ['ArrowDown', { metaKey: true }], ['ArrowDown', {}], ['z', { metaKey: true }], ['Enter', { metaKey: true }],
      ['ArrowLeft', { metaKey: true, shiftKey: true }], ['ArrowRight', { metaKey: true, shiftKey: true }]]) {
      assert.equal(keyAction({ key, target: target(selector), ...more }), null, `${selector}: ${key}`);
    }
  }
  assert.equal(writing(target()), false);
  assert.equal(writing(null), false);
});
