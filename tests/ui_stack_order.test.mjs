// How a topic's loaded messages read as reply stacks (docs/reply-stacks.md),
// in the parts that decide: chat order inside a stack, the fold lines at each
// gap, the stacks newest on top unless the reader placed one, joins appended
// in the order made, the one New line under the lowest stack holding anything
// new, and the red count on a fold line. The native reading checks
// (tests/stack_native.mjs) press the real keys on the real page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gather, ordered, rowsOf, headOf, lineUnder, moveOf, joinOf, readingOrder, foldStep, keyOf, shown } from '../web/stack-order.mjs';

const message = (seq, extra = {}) => ({ id: 'm' + seq, seq, author_id: 'agent-a', body: `Message ${seq}\nmore`, ...extra });
const ids = items => items.map(item => item.id);
const stacksOf = items => ordered(gather(items));
const words = rows => rows.map(row => row.kind === 'reply' ? row.item.id : row.kind === 'join' ? `join ${row.item.id}` : row.words + (row.fresh ? ` · ${row.fresh} new` : ''));

test('a stack keeps its first message on top and reads its replies oldest first, replies to replies with them', () => {
  const items = [message(1), message(2, { reply_to: 'm1' }), message(3), message(4, { reply_to: 'm2' }), message(5, { reply_to: 'm1' })];
  const [first, second] = stacksOf(items);
  assert.equal(first.id, 'm1', 'the stack with the newest message is on top');
  assert.deepEqual(ids(first.replies), ['m2', 'm4', 'm5'], 'oldest first, whoever each answers');
  assert.equal(first.newest, 5);
  assert.deepEqual([second.id, second.replies.length], ['m3', 0]);
  // A reply whose message is not loaded heads a stack of its own.
  const alone = stacksOf([message(7, { reply_to: 'm6' }), message(8, { reply_to: 'm7' })]);
  assert.deepEqual([alone.length, alone[0].id, ids(alone[0].replies)], [1, 'm7', ['m8']]);
  // A message the page does not show (has) heads nothing and is under nothing.
  const hidden = gather(items, id => id !== 'm2');
  assert.deepEqual(ids(hidden.find(stack => stack.id === 'm1').replies), ['m2', 'm5'], 'm2 still listed, m4 now its own');
});

test('stacks keep newest activity on top; one the reader placed holds its place whatever arrives, and a new stack lands on top', () => {
  const items = [message(1), message(2), message(3), message(4, { reply_to: 'm1' })];
  assert.deepEqual(ids(stacksOf(items).map(stack => stack.head)), ['m1', 'm3', 'm2'], 'a reply lifts its stack');
  const placed = items.map(item => item.id === 'm1' ? { ...item, acts: { placed: 1.5 } } : item);
  assert.deepEqual(ids(stacksOf(placed).map(stack => stack.head)), ['m3', 'm2', 'm1'], 'placed between m2 and the bottom');
  const later = [...placed, message(9, { reply_to: 'm1' }), message(10)];
  assert.deepEqual(ids(stacksOf(later).map(stack => stack.head)), ['m10', 'm3', 'm2', 'm1'], 'its new reply does not lift it; a new stack goes on top');
  assert.equal(keyOf(stacksOf(later).at(-1)), 1.5);
  // Another reader's place is not on this reader's messages: unplaced, the same messages keep newest on top.
  assert.deepEqual(ids(stacksOf([...items, message(9, { reply_to: 'm1' }), message(10)]).map(stack => stack.head)), ['m10', 'm1', 'm3', 'm2']);
});

test('a move places the stack just past its neighbour, refuses at either end, and trades places where no number fits', () => {
  const stacks = stacksOf([message(1), message(2), message(3), message(4)]);
  assert.deepEqual(moveOf(stacks, 3, 'up'), [{ id: 'm1', key: 2.5 }], 'between m3 and m2');
  assert.deepEqual(moveOf(stacks, 0, 'down'), [{ id: 'm4', key: 2.5 }]);
  assert.deepEqual(moveOf(stacks, 1, 'up'), [{ id: 'm3', key: 5 }], 'past the top: above it');
  assert.deepEqual(moveOf(stacks, 2, 'down'), [{ id: 'm2', key: 0 }], 'past the bottom: below it');
  assert.equal(moveOf(stacks, 0, 'up'), null);
  assert.equal(moveOf(stacks, 3, 'down'), null);
  // Each move, applied, puts the stack exactly one place along.
  for (const [index, way] of [[3, 'up'], [0, 'down'], [1, 'up'], [2, 'down'], [2, 'up']]) {
    const keys = new Map(moveOf(stacks, index, way).map(change => [change.id, change.key]));
    const after = ordered(stacks.map(stack => keys.has(stack.id) ? { ...stack, placed: keys.get(stack.id) } : stack));
    const expect = ids(stacks); const [moving] = expect.splice(index, 1); expect.splice(index + (way === 'up' ? -1 : 1), 0, moving);
    assert.deepEqual(ids(after), expect, `${way} from ${index}`);
  }
  // Two placed on the same number: no number fits between, so they trade places.
  const tied = ordered(gather([message(1, { acts: { placed: 7 } }), message(2, { acts: { placed: 7 } }), message(3, { acts: { placed: 7 } })]));
  assert.equal(moveOf(tied, 2, 'up'), null, 'the same place as its neighbour: nothing to trade');
  // Two numbers with none between them: the stack and its neighbour trade places.
  const e = Number.EPSILON;
  const near = ordered(gather([message(1, { acts: { placed: 1 } }), message(2, { acts: { placed: 1 + e } }), message(3, { acts: { placed: 1 + 2 * e } })]));
  assert.deepEqual(moveOf(near, 2, 'up'), [{ id: 'm1', key: 1 + e }, { id: 'm2', key: 1 }]);
});

test('a join appends the joined stack after the replies, in the order joined, with its own replies, and its first message keeps its line', () => {
  const items = [message(1), message(2, { reply_to: 'm1' }), message(3), message(4, { reply_to: 'm3' }),
    message(5, { acts: { joined: { into: 'm1', by: 'owner', at_ms: 20 } } }), message(6, { reply_to: 'm5' }),
    message(7, { reply_to: 'm1' })];
  items[2].acts = { joined: { into: 'm1', by: 'agent-a', at_ms: 10 } };
  const [stack] = stacksOf(items);
  assert.equal(stacksOf(items).length, 1, 'one stack');
  assert.deepEqual(ids(stack.replies), ['m2', 'm7', 'm3', 'm4', 'm5', 'm6'], 'own replies, then m3 (joined first), then m5');
  assert.deepEqual([...stack.joins.keys()], ['m3', 'm5']);
  assert.deepEqual(words(rowsOf(stack, { level: 'head' })), ['2 earlier replies', 'join m3', 'm3', '1 more reply', 'join m5', 'm5', '1 more reply'],
    'folded to its head, a joined stack\'s first message still shows with its join line');
  // A join into a joined stack follows that stack.
  const nested = stacksOf([message(1), message(2, { acts: { joined: { into: 'm1', at_ms: 30 } } }),
    message(3, { acts: { joined: { into: 'm2', at_ms: 10 } } }), message(4, { acts: { joined: { into: 'm1', at_ms: 20 } } })]);
  assert.deepEqual(ids(nested[0].replies), ['m4', 'm2', 'm3']);
  // A joined message is cut from the message it answers.
  const cut = stacksOf([message(1), message(2), message(3, { reply_to: 'm1', acts: { joined: { into: 'm2', at_ms: 1 } } })]);
  assert.deepEqual(cut.map(stack => [stack.id, ids(stack.replies)]), [['m2', ['m3']], ['m1', []]]);
  // Split back out (joined null): back under the message it answers.
  const split = stacksOf([message(1), message(2), message(3, { reply_to: 'm1', acts: { joined: null } })]);
  assert.deepEqual(split.map(stack => [stack.id, ids(stack.replies)]), [['m1', ['m3']], ['m2', []]]);
  // A loop read from two moments is cut at its newest message, which heads its stack.
  const loop = stacksOf([message(1, { acts: { joined: { into: 'm2', at_ms: 1 } } }), message(2, { acts: { joined: { into: 'm1', at_ms: 2 } } })]);
  assert.deepEqual(loop.map(stack => [stack.id, ids(stack.replies)]), [['m2', ['m1']]]);
  // Joined to a message the page has not loaded: it heads its own stack.
  assert.deepEqual(stacksOf([message(5, { acts: { joined: { into: 'm1', at_ms: 1 } } })]).map(stack => stack.id), ['m5']);
  assert.deepEqual(joinOf(stacksOf([message(1), message(2)]), 1, 'up').id, 'm2');
  assert.equal(joinOf(stacksOf([message(1), message(2)]), 0, 'up'), null);
});

test('a fold shows the newest reply and every kept one in its place, with a line for each run folded away', () => {
  const items = [message(1), ...[2, 3, 4, 5, 6, 7, 8].map(seq => message(seq, { reply_to: 'm1' }))];
  const [stack] = stacksOf(items);
  const kept = item => item.seq === 5;
  assert.deepEqual(words(rowsOf(stack, { kept })), ['3 earlier replies', 'm5', '2 more replies', 'm8']);
  assert.deepEqual(words(rowsOf(stack, { level: 'open', kept })), ['Fold 5 earlier replies', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
  assert.deepEqual(words(rowsOf(stack, { level: 'head', kept })), ['7 replies'], 'every reply folded: one line counts them all');
  // A starred reply never folds; a reply folded by hand does even when kept.
  const starred = stacksOf(items.map(item => item.seq === 3 ? { ...item, acts: { starred: true } } : item))[0];
  assert.deepEqual(words(rowsOf(starred, { level: 'head' })), ['1 earlier reply', 'm3', '5 more replies']);
  assert.deepEqual(words(rowsOf(stack, { kept, handFolded: new Set(['m5']) })), ['6 earlier replies', 'm8']);
  assert.deepEqual([5, 6, 8].map(seq => shown(stack, items[seq - 1], { kept })), [true, false, true], 'kept, folded, the newest');
  // Open with nothing the fold would take: no Fold line.
  const short = stacksOf([message(1), message(2, { reply_to: 'm1' })])[0];
  assert.deepEqual(words(rowsOf(short, { level: 'open' })), ['m2']);
});

test('a fold line holding unread replies says how many in red; the head says New when its own message is', () => {
  const items = [message(1), ...[2, 3, 4, 5].map(seq => message(seq, { reply_to: 'm1', author_id: seq === 4 ? 'agent-b' : 'agent-a' }))];
  const [stack] = stacksOf(items);
  const unread = item => [2, 3].includes(item.seq);
  assert.deepEqual(words(rowsOf(stack, { level: 'head', unread })), ['4 replies · 2 new']);
  assert.deepEqual(words(rowsOf(stack, { unread, kept: unread })), ['m2', 'm3', '1 more reply', 'm5'], 'the usual fold keeps unread replies in view');
  const head = headOf(stack, { unread });
  assert.deepEqual([head.name, head.count, head.repliers, head.headNew, head.fresh], ['Message 1', 4, ['agent-a', 'agent-b'], false, 2]);
  assert.deepEqual([headOf(stack, { unread: item => item.seq === 1 || item.seq === 2 }).headNew, headOf(stack, { unread: item => item.seq === 1 }).fresh], [true, 0]);
  const named = { ...stack, head: { ...stack.head, acts: { name: { text: 'Cabin week', by: 'owner' } } } };
  assert.deepEqual([headOf(named).name, headOf(named).typed.by], ['Cabin week', 'owner']);
  assert.equal(headOf({ ...stack, head: { ...stack.head, acts: { name: null } } }, { firstLine: text => text.split('\n')[0] + '!' }).name, 'Message 1!');
});

test('the one New line goes under the lowest stack holding anything new since its message, never cutting a stack', () => {
  const items = [message(1), message(2), message(3, { reply_to: 'm1' }), message(4)];
  const stacks = stacksOf(items);
  assert.deepEqual(ids(stacks.map(stack => stack.head)), ['m4', 'm1', 'm2']);
  assert.equal(lineUnder(stacks, 3, 'owner'), 1, 'm3 is in m1\'s stack: under the stack, not inside it');
  assert.equal(lineUnder(stacks, 4, 'owner'), 0);
  assert.equal(lineUnder(stacks, 2, 'owner'), 2, 'm2 itself, at the bottom');
  // The reader's own newer reply is not new to them.
  const own = stacksOf([message(1), message(2), message(3, { reply_to: 'm1', author_id: 'owner' })]);
  assert.equal(lineUnder(own, 2, 'owner'), 1, 'm2 sits under m1, whose newest is the reader\'s own');
  assert.equal(lineUnder(stacks, null, 'owner'), null);
  assert.equal(lineUnder(stacks, 99, 'owner'), null, 'its message not loaded and nothing newer');
  assert.equal(lineUnder(stacksOf([message(5), message(6)]), 3, 'owner'), null, 'its message not loaded: the line waits for what loads it, though newer ones are here');
});

test('the Reader steps down the page as shown: down a stack to newer replies, then on to the stack below', () => {
  const items = [message(1), message(2), message(3, { reply_to: 'm1' }), message(4, { reply_to: 'm1' })];
  assert.deepEqual(ids(readingOrder(stacksOf(items))), ['m1', 'm3', 'm4', 'm2']);
});

test('⌘→ shows the full first message, then opens the replies a step at a time; ⌘← hides it, then folds to the usual fold, then the head alone', () => {
  let state = { level: 'folded', headOpen: false };
  const steps = [];
  for (let next = foldStep(state, 'open', { onHead: true }); next; next = foldStep(state, 'open', { onHead: true })) { state = next; steps.push({ ...state }); }
  assert.deepEqual(steps, [{ level: 'folded', headOpen: true }, { level: 'open', headOpen: true }]);
  const back = [];
  for (let next = foldStep(state, 'fold', { onHead: true }); next; next = foldStep(state, 'fold', { onHead: true })) { state = next; back.push({ ...state }); }
  assert.deepEqual(back, [{ level: 'open', headOpen: false }, { level: 'folded', headOpen: false }, { level: 'head', headOpen: false }]);
  assert.deepEqual(foldStep({ level: 'head', headOpen: false }, 'open'), { level: 'folded', headOpen: false }, 'on a reply: the replies only');
  assert.equal(foldStep({ level: 'folded', headOpen: false }, 'open', { replies: false }), null, 'a message with no replies has nothing to open');
});
