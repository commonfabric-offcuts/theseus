// How a topic's loaded messages read as reply stacks (docs/reply-stacks.md),
// in the parts that decide: chat order inside a stack, the fold lines at each
// gap, the stacks newest on top unless the reader placed one, a join read as
// one stack oldest first, the one New line under the lowest stack holding anything
// new, and the red count on a fold line. The native reading checks
// (tests/stack_native.mjs) press the real keys on the real page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gather, ordered, rowsOf, headOf, lineUnder, moveOf, joinOf, joinShown, readingOrder, foldStep, keyOf, shown, rowFolded, laterActs, LEVELS, sideOf, shownOrder, positionOf, earlierOf, RECENT } from '../web/stack-order.mjs';

const message = (seq, extra = {}) => ({ id: 'm' + seq, seq, author_id: 'agent-a', body: `Message ${seq}\nmore`, ...extra });
const ids = items => items.map(item => item.id);
const stacksOf = items => ordered(gather(items));
const words = rows => rows.map(row => row.kind === 'reply' ? row.item.id + (row.folded ? ' (folded)' : '') + (row.earlier ? ' (earlier)' : '') : row.kind === 'join' ? `join ${row.item.id}` : row.words + (row.fresh ? ` · ${row.fresh} new` : ''));

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
  const hidden = gather(items, { has: id => id !== 'm2' });
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

test('the reader\'s own reply leaves its stack where it was; anyone else\'s lifts it, a new stack of the reader\'s own lands on top, and a place still wins', () => {
  const viewer = 'owner';
  const mine = (seq, extra = {}) => message(seq, { author_id: viewer, ...extra });
  const items = [message(1), message(2), message(3), message(4, { reply_to: 'm1' })];
  const heads = (list, who = viewer) => ids(ordered(gather(list, { viewer: who })).map(stack => stack.head));
  assert.deepEqual(heads(items), ['m1', 'm3', 'm2'], 'before: m1 sits where its newest reply puts it');
  // The reader replies to the stack at the bottom, and to a message standing alone: neither moves.
  const replied = [...items, mine(5, { reply_to: 'm2' }), mine(6, { reply_to: 'm3' }), mine(7, { reply_to: 'm6' })];
  assert.deepEqual(heads(replied), ['m1', 'm3', 'm2'], 'own replies, and a reply to an own reply, lift nothing');
  const [, , bottom] = ordered(gather(replied, { viewer }));
  assert.deepEqual([bottom.id, bottom.newest, keyOf(bottom)], ['m2', 5, 2], 'its newest is the reply; its key is still its own message');
  // Every other reader sees the reply as anyone else's, so it lifts the stack for them.
  assert.deepEqual(heads(replied, 'agent-b'), ['m3', 'm2', 'm1'], 'another reader: the newest activity on top');
  assert.deepEqual(heads(replied, null), ['m3', 'm2', 'm1'], 'no reader named: newest on top as before');
  // Anyone else's reply lifts it as today, the reader's own replies in it notwithstanding.
  assert.deepEqual(heads([...replied, message(8, { reply_to: 'm5' })]), ['m2', 'm1', 'm3'], 'another\'s reply to the reader\'s own lifts the stack');
  // A new stack of the reader's own lands on top, and its own replies keep it there, not higher.
  assert.deepEqual(heads([...replied, mine(9)]), ['m9', 'm1', 'm3', 'm2'], 'the reader\'s new message is a new stack, on top');
  assert.deepEqual(heads([...replied, mine(9), message(10), mine(11, { reply_to: 'm9' })]), ['m10', 'm9', 'm1', 'm3', 'm2']);
  // A place the reader set wins either way.
  const placed = replied.map(item => item.id === 'm2' ? { ...item, acts: { placed: 9.5 } } : item);
  assert.deepEqual(heads([...placed, message(9, { reply_to: 'm2' })]), ['m2', 'm1', 'm3'], 'placed on top, it stays on top');
  // A joined stack moves its stack where the newer of the two would, though the reader started it, as joins always have.
  const joined = [...items, mine(5, { acts: { joined: { into: 'm2', by: viewer, at_ms: 1 } } })];
  assert.deepEqual(heads(joined), ['m2', 'm1', 'm3'], 'the reader\'s own message joined into m2 still counts for it');
  assert.deepEqual(heads([...joined, mine(6, { reply_to: 'm5' })]), ['m2', 'm1', 'm3'], 'and an own reply inside the joined part lifts nothing');
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

test('a move or a join steps among the stacks on its own side of More: over a dossier below More, never into or out of one', () => {
  // m4, m3, m2, m1 newest first; m3 and m1 drawn below More.
  const stacks = stacksOf([message(1), message(2), message(3), message(4)]), below = stack => stack.id === 'm3' || stack.id === 'm1';
  const side = index => sideOf(stacks, index, { below, hidden: () => false });
  assert.deepEqual([ids(side(2).stacks), side(2).index], [['m4', 'm2'], 1], 'm2 steps among the stacks above More');
  assert.deepEqual([ids(side(1).stacks), side(1).index], [['m3', 'm1'], 0], 'm3 among those below it');
  const join = (index, way) => { const { stacks: among, index: at } = side(index); return joinShown(among, at, way, stacks[index].id)?.act ?? null; };
  assert.deepEqual(join(2, 'up'), { id: 'm2', into: 'm4' }, 'm2 joins m4, shown above it, not m3 below More');
  assert.deepEqual(join(0, 'down'), { id: 'm4', into: 'm2' }, 'm4 joins m2, shown below it');
  assert.equal(join(2, 'down'), null, 'm2, last above More, has nothing below to join');
  assert.equal(join(1, 'up'), null, 'm3, first below More, has nothing above to join');
  assert.deepEqual(join(1, 'down'), { id: 'm3', into: 'm1' }, 'below More, a dossier joins the one below it there');
  const { stacks: among, index: at } = side(2);
  assert.deepEqual(moveOf(among, at, 'up'), [{ id: 'm2', key: 5 }], 'm2 moves above m4, past the dossier below More');
  assert.equal(moveOf(among, at, 'down'), null, 'and no further down than More');
  // With nothing below More, every stack is on one side.
  assert.deepEqual(ids(sideOf(stacks, 2, { below: () => false, hidden: () => false }).stacks), ids(stacks));
  assert.throws(() => sideOf(stacks, 4, { below, hidden: () => false }), /No stack at 4/);
  // A stack drawn but not on show (agent coordination hidden) is stepped over too, unless it is the one acting.
  const hidden = stack => stack.id === 'm4';
  assert.deepEqual(ids(sideOf(stacks, 2, { below, hidden }).stacks), ['m2'], 'm2 steps over hidden m4: nothing above it to join or pass');
  assert.deepEqual(ids(sideOf(stacks, 0, { below, hidden }).stacks), ['m4', 'm2'], 'the hidden stack acting keeps its own place');
});

test('the stacks as shown: those above More in order, then those below it, leaving out the ones not on show', () => {
  // m4, m3, m2, m1 newest first; m3 and m1 drawn below More.
  const stacks = stacksOf([message(1), message(2), message(3), message(4)]), below = stack => stack.id === 'm3' || stack.id === 'm1';
  assert.deepEqual(ids(shownOrder(stacks, { below, hidden: () => false })), ['m4', 'm2', 'm3', 'm1'], 'More open: below More comes after every stack above it');
  assert.deepEqual(ids(shownOrder(stacks, { below, hidden: below })), ['m4', 'm2'], 'More closed: the dossiers put aside are not shown');
  assert.deepEqual(ids(shownOrder(stacks, { below, hidden: stack => stack.id === 'm2' })), ['m4', 'm3', 'm1'], 'a hidden stack above More is left out');
  assert.deepEqual(ids(shownOrder(stacks, { below: () => false, hidden: () => false })), ids(stacks), 'with nothing aside or hidden it is the stacks in their order');
  // The Reader steps along each shown stack's messages, folded replies included.
  const withReply = stacksOf([message(1), message(2, { reply_to: 'm1', acts: { folded: true } }), message(3)]);
  assert.deepEqual(ids(readingOrder(shownOrder(withReply, { below: stack => stack.id === 'm3', hidden: stack => stack.id === 'm3' }))), ['m1', 'm2']);
});

test('a join reads as one stack: the head first, then every other message oldest first, a joined stack\'s first message keeping its line', () => {
  const items = [message(1), message(2, { reply_to: 'm1' }), message(3), message(4, { reply_to: 'm3' }),
    message(5, { acts: { joined: { into: 'm1', by: 'owner', at_ms: 20 } } }), message(6, { reply_to: 'm5' }),
    message(7, { reply_to: 'm1' })];
  items[2].acts = { joined: { into: 'm1', by: 'agent-a', at_ms: 10 } };
  const [stack] = stacksOf(items);
  assert.equal(stacksOf(items).length, 1, 'one stack');
  assert.deepEqual(ids(stack.replies), ['m2', 'm3', 'm4', 'm5', 'm6', 'm7'], 'own replies and both joined stacks as one run, oldest first');
  assert.deepEqual([...stack.joins.keys()], ['m3', 'm5']);
  assert.deepEqual(words(rowsOf(stack, { level: 'head' })), ['6 replies'], 'closed hides joined messages too');
  assert.ok(words(rowsOf(stack, { level: 'open' })).includes('join m3'), 'open still shows join context');
  // A join into a joined stack reads in the same run, whatever order the joins were made in.
  const nested = stacksOf([message(1), message(2, { acts: { joined: { into: 'm1', at_ms: 30 } } }),
    message(3, { acts: { joined: { into: 'm2', at_ms: 10 } } }), message(4, { acts: { joined: { into: 'm1', at_ms: 20 } } })]);
  assert.deepEqual(ids(nested[0].replies), ['m2', 'm3', 'm4']);
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

// Item 354, Tony's case: ⇧⌘↑ on an older stack whose replies were read, into the newer message on its own above.
test('a join the reader makes shows where it went: the stack it goes into open, its head whole and the joined messages under their join line, the selection on the message acted on', () => {
  const items = [message(1), message(2, { reply_to: 'm1' }), message(3, { reply_to: 'm1' }), message(4)];
  const stacks = stacksOf(items);
  assert.deepEqual(ids(stacks.map(stack => stack.head)), ['m4', 'm1'], 'B (m4) on its own above A (m1) and its replies');
  // What the rows show once the decision's act is recorded, at the level it draws the stack it goes into.
  const after = (shown, at_ms = 5) => {
    const joined = items.map(item => item.id === shown.act.id ? { ...item, acts: { joined: { into: shown.act.into, by: 'owner', at_ms } } } : item);
    const together = stacksOf(joined);
    assert.equal(together.length, 1, 'one stack');
    assert.equal(together[0].id, shown.open, 'the stack opened is the one heading the two');
    return rowsOf(together[0], { level: shown.level });
  };
  for (const acted of ['m1', 'm3']) {
    const up = joinShown(stacks, 1, 'up', acted);
    assert.deepEqual(up, { act: { id: 'm1', into: 'm4' }, open: 'm4', level: 'open', select: acted }, `⇧⌘↑ from ${acted}: A joins B, B opens, the selection stays on ${acted}`);
    assert.deepEqual(words(after(up)), ['join m1', 'm1', 'm2', 'm3'], 'B whole, then A under its join line with every read reply');
    assert.ok(words(after(up)).includes(up.select), 'the message acted on shows');
  }
  // Drawn as any stack is drawn, folded: the head as one row and only the newest reply, which is what Tony saw.
  const joined = stacksOf(items.map(item => item.id === 'm1' ? { ...item, acts: { joined: { into: 'm4', by: 'owner', at_ms: 5 } } } : item));
  assert.deepEqual(words(rowsOf(joined[0], { level: 'folded' })), ['2 earlier replies', 'm3'], 'folded hides A and its join line');
  // ⇧⌘↓ from a reply of the newer stack: it joins the older one below, which opens.
  const down = joinShown(stacksOf([message(1), message(2, { reply_to: 'm1' }), message(3), message(4, { reply_to: 'm3' })]), 0, 'down', 'm4');
  assert.deepEqual(down, { act: { id: 'm3', into: 'm1' }, open: 'm1', level: 'open', select: 'm4' });
  // Nothing that way: no join and nothing opens. A message outside the stack cannot make its join.
  assert.equal(joinShown(stacks, 0, 'up', 'm4'), null);
  assert.equal(joinShown(stacks, 1, 'down', 'm2'), null);
  assert.throws(() => joinShown(stacks, 1, 'up', 'm4'), /not m4/);
  assert.throws(() => joinShown(stacks, 2, 'up', 'm1'), /No stack at 2/);
});

// Item 361, Tony's case: a join makes the two stacks one, so a reply to any of their messages lands at the bottom.
const named = (id, seq, extra = {}) => ({ id, seq, author_id: 'agent-a', body: `${id}\nmore`, ...extra });
const joinedA = { joined: { into: 'B', by: 'owner', at_ms: 50 } };
const tonys = (joined = joinedA) => [named('B', 1), named('A', 3, { acts: joined }), named('b1', 5, { reply_to: 'B' }), named('a2', 7, { reply_to: 'A' }), named('b3', 9, { reply_to: 'B' })];
// The rows a join makes; an open dossier of more than seven begins with its earlier-messages row (item 476), which
// the cases on that row read, not these.
const shownRows = (stack, level = 'open') => words(rowsOf(stack, { level }).filter(row => row.kind !== 'earlier'));

test('a join interleaves both stacks oldest first under the head, the join line staying on the joined stack\'s first message', () => {
  const [stack, ...rest] = stacksOf(tonys());
  assert.deepEqual(rest, [], 'one stack');
  assert.equal(stack.id, 'B', 'the head stays first');
  assert.deepEqual(shownRows(stack), ['join A', 'A', 'b1', 'a2', 'b3'], 'B, then A under its join line, b1, a2, b3, by sequence');
  assert.deepEqual(ids(readingOrder([stack])), ['B', 'A', 'b1', 'a2', 'b3'], 'the keys step in the same order');
  // A new reply to A lands at the bottom, and so does one to B's own reply.
  const later = stacksOf([...tonys(), named('a11', 11, { reply_to: 'A' })])[0];
  assert.deepEqual(shownRows(later), ['join A', 'A', 'b1', 'a2', 'b3', 'a11'], 'a reply to the joined stack\'s message lands last');
  const after = stacksOf([...tonys(), named('a11', 11, { reply_to: 'A' }), named('b12', 12, { reply_to: 'b1' })])[0];
  assert.deepEqual(ids(after.replies).slice(-2), ['a11', 'b12'], 'a reply to the head\'s own reply lands last too');
  assert.deepEqual(shownRows(after, 'folded'), ['5 earlier replies', 'b12'], 'latest plus unread: the newest across both stacks, at the bottom, everything older folded above it');
  // Joined by someone else first, or later: the rule is the sequence, not the order of the joins.
  assert.deepEqual(ids(stacksOf(tonys({ joined: { into: 'B', by: 'owner', at_ms: 1 } }))[0].replies), ['A', 'b1', 'a2', 'b3']);
});

test('a join of a join interleaves too, each joined stack\'s first message keeping its line', () => {
  const items = [...tonys(), named('C', 4, { acts: { joined: { into: 'a2', by: 'owner', at_ms: 60 } } }), named('c6', 6, { reply_to: 'C' }), named('c10', 10, { reply_to: 'C' })];
  const [stack, ...rest] = stacksOf(items);
  assert.deepEqual([stack.id, rest.length], ['B', 0]);
  assert.deepEqual(shownRows(stack), ['join A', 'A', 'join C', 'C', 'b1', 'c6', 'a2', 'b3', 'c10']);
  assert.deepEqual([...stack.joins.keys()].sort(), ['A', 'C']);
});

test('Split back out puts both stacks back exactly as they were; a stack with no joins reads as it always did', () => {
  const before = stacksOf(tonys(null));
  const split = stacksOf(tonys({ joined: null, join_revision: 2 }));
  const shape = stacks => stacks.map(stack => [stack.id, ids(stack.replies), [...stack.joins.keys()], stack.newest, keyOf(stack)]);
  assert.deepEqual(shape(split), shape(before));
  assert.deepEqual(shape(before), [['B', ['b1', 'b3'], [], 9, 9], ['A', ['a2'], [], 7, 7]]);
  // With no joins nothing moves: replies, and replies to them, oldest first, under the head.
  const plain = stacksOf([named('B', 1), named('b1', 5, { reply_to: 'B' }), named('b2', 6, { reply_to: 'b1' }), named('b3', 9, { reply_to: 'B' }), named('b4', 10, { reply_to: 'b2' })])[0];
  assert.deepEqual(shownRows(plain), ['b1', 'b2', 'b3', 'b4']);
  assert.ok(!shownRows(plain).some(row => row.startsWith('join')), 'and no join line');
  // A joined stack's sort key is the newest message across both, as before,
  // including when that newest message is a reply in the joined part.
  assert.equal(keyOf(stacksOf(tonys())[0]), 9);
  assert.equal(keyOf(stacksOf([...tonys(), named('a11', 11, { reply_to: 'A' })])[0]), 11, 'a newer reply to the joined stack moves the combined stack\'s key');
  assert.equal(keyOf(stacksOf([named('B', 1), named('b1', 5, { reply_to: 'B' }), named('A', 12, { acts: joinedA })])[0]), 12, 'a joined stack whose own first message is the newest gives the combined stack its key');
  assert.deepEqual(stacksOf([...tonys(), named('D', 10), named('a11', 11, { reply_to: 'A' })]).map(stack => stack.id), ['B', 'D'], 'and so sorts it above a stack whose newest message is older');
});

test('a fold shows the newest reply and every kept one in its place, with a line for each run folded away', () => {
  const items = [message(1), ...[2, 3, 4, 5, 6, 7, 8].map(seq => message(seq, { reply_to: 'm1' }))];
  const [stack] = stacksOf(items);
  const kept = item => item.seq === 5;
  assert.deepEqual(words(rowsOf(stack, { kept })), ['3 earlier replies', 'm5', '2 more replies', 'm8']);
  // Open, a dossier of eight shows its newest seven and one row for the first (item 476); no fold line.
  assert.deepEqual(words(rowsOf(stack, { level: 'open', kept })), ['1 earlier message', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
  assert.deepEqual(words(rowsOf(stack, { level: 'head', kept })), ['7 replies'], 'every reply folded: one line counts them all');
  // Stars do not override an explicit closed state.
  const starred = stacksOf(items.map(item => item.seq === 3 ? { ...item, acts: { starred: true } } : item))[0];
  assert.deepEqual(words(rowsOf(starred, { level: 'head' })), ['7 replies']);
  assert.deepEqual([5, 6, 8].map(seq => shown(stack, items[seq - 1], { kept })), [true, false, true], 'kept, folded, the newest');
  // Open with nothing the fold would take: no Fold line.
  const short = stacksOf([message(1), message(2, { reply_to: 'm1' })])[0];
  assert.deepEqual(words(rowsOf(short, { level: 'open' })), ['m2']);
});

test('latest and unread keeps the reader\'s starred replies whole, in order, until unstarred', () => {
  const items = [message(1), message(2, { reply_to: 'm1' }),
    message(3, { reply_to: 'm1', acts: { starred: true, star_revision: 1, folded: true, fold_revision: 1 } }),
    message(4, { reply_to: 'm1' }), message(5, { reply_to: 'm1', acts: { starred: true } })];
  const [stack] = stacksOf(items), kept = item => item.seq === 2;
  assert.deepEqual(words(rowsOf(stack, { kept })), ['m2', 'm3', '1 more reply', 'm5'], 'kept unread, older starred and latest replies remain in chronological places');
  assert.equal(rowFolded(items[2]), false, 'a saved fold never hides a starred reply\'s words');
  assert.deepEqual(rowsOf(stack, { level: 'open' }).filter(row => row.kind === 'reply').map(row => row.item.id), ['m2','m3','m4','m5'], 'all messages stays unchanged, without duplicate stars');
  assert.equal(shown(stack, items[2], { level: 'head' }), false, 'the quiet agent header-only state remains explicit');
  const unstarred = stacksOf(items.map(item => item.seq === 3 ? { ...item, acts: { ...item.acts, starred: false, star_revision: 2 } } : item))[0];
  assert.deepEqual(words(rowsOf(unstarred, { kept })), ['m2', '2 more replies', 'm5'], 'unstarred older read replies hide again');
});

test('star visibility follows the reader\'s acts through joined stacks, not another reader\'s stars', () => {
  const items = [message(1), message(2, { acts: { joined: { into: 'm1', by: 'owner' } } }),
    message(3, { reply_to: 'm2', acts: { starred: true, star_revision: 1 } }), message(4, { reply_to: 'm1' })];
  const replies = stack => rowsOf(stack).filter(row => row.kind === 'reply').map(row => row.item.id);
  assert.deepEqual(replies(stacksOf(items)[0]), ['m3', 'm4'], 'an older starred reply in a joined stack remains visible');
  const otherReader = items.map(item => ({ ...item, acts: { ...item.acts, starred: false, star_revision: 0 } }));
  assert.deepEqual(replies(stacksOf(otherReader)[0]), ['m4'], 'another reader\'s ordinary read reply stays hidden');
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
  assert.equal(headOf({ ...stack, head: { ...stack.head, acts: { name: null } } }, { preview: item => item.body.split('\n')[0] + '!' }).name, 'Message 1!');
});

// Item 470: a dossier's name is its first message's. A page holding only replies reads it from the position Core
// sends with each of them; a name on a reply showing as the head is not the dossier's.
test('a dossier\'s name is its first message\'s, read from the position where the page holds only replies', () => {
  const at = (name, revision, acts = 1) => ({ root_id: 'm1', through: null, below: false, aside_revision: 0, name, name_revision: revision, at: { acts, messages: 0 } });
  const typed = { text: 'Siderail changes', by: 'owner', at_ms: 1 };
  const replies = [message(3, { reply_to: 'm2', acts: { name: { text: 'On the reply', by: 'owner' } }, stack_position: at(typed, 1) }), message(4, { reply_to: 'm3', stack_position: at(null, 0, 0) })];
  const [partial] = stacksOf(replies);
  assert.equal(partial.head.id, 'm3', 'the oldest loaded reply shows as the head');
  assert.deepEqual([headOf(partial).name, headOf(partial).typed.by], ['Siderail changes', 'owner'], 'the later position names the dossier, not the reply\'s own act');
  const [unnamed] = stacksOf(replies.map(item => ({ ...item, stack_position: at(null, 2, 2) })));
  assert.deepEqual([headOf(unnamed).name, headOf(unnamed).typed], ['Message 3', null], 'with no name on the dossier, the first line shown');
  const [whole] = stacksOf([message(1, { acts: { name: typed }, stack_position: at(null, 0, 0) }), message(2, { reply_to: 'm1' }), ...replies]);
  assert.equal(headOf(whole).name, 'Siderail changes', 'with the first message loaded, its own acts say it');
  const [older] = stacksOf([{ ...replies[0], stack_position: undefined }]);
  assert.equal(headOf(older).name, 'On the reply', 'a page whose Core sends no position reads the head\'s own acts');
});

// Item 479: a minted name says who minted it, as "Named by" in the row; a typed name, and a name an older Core
// kept, carry no minted mark, so the row says nothing more than it did.
test('a minted name says the agent that minted it; a typed name and an old one say no one', () => {
  const at = name => ({ root_id: 'm1', through: null, below: false, aside_revision: 0, name, name_revision: 1, at: { acts: 1, messages: 0 } });
  const minted = { text: 'Cabin week plan', by: 'agent-a', at_ms: 1, minted: true };
  const [whole] = stacksOf([message(1, { acts: { name: minted } }), message(2, { reply_to: 'm1' })]);
  assert.deepEqual([headOf(whole).name, headOf(whole).mintedBy], ['Cabin week plan', 'agent-a']);
  const [partial] = stacksOf([message(3, { reply_to: 'm2', stack_position: at(minted) }), message(4, { reply_to: 'm3', stack_position: at(minted) })]);
  assert.equal(headOf(partial).mintedBy, 'agent-a', 'a page holding only replies says it from the position');
  for (const name of [{ text: 'Typed', by: 'owner', at_ms: 2 }, { text: 'Old', by: 'owner', at_ms: 2, minted: 'yes' }, null]) {
    const [stack] = stacksOf([message(1, { acts: { name } }), message(2, { reply_to: 'm1' })]);
    assert.equal(headOf(stack).mintedBy, null, JSON.stringify(name));
  }
});

// Item 470: where the page holds the first message as the head, its own acts name the dossier, though the newest
// position says another name (an answer the page has, its positions not yet read again).
test('with the first message loaded as the head, its own acts name the dossier over a position that says another', () => {
  const at = name => ({ root_id: 'm1', through: null, below: false, aside_revision: 0, name, name_revision: 1, at: { acts: 1, messages: 0 } });
  const [whole] = stacksOf([message(1, { acts: { name: { text: 'Renamed here', by: 'owner', at_ms: 2 }, name_revision: 2 }, stack_position: at(null) }),
    message(2, { reply_to: 'm1', stack_position: at({ text: 'Siderail changes', by: 'owner', at_ms: 1 }) })]);
  assert.equal(positionOf(whole).name.text, 'Siderail changes', 'the newest position says the older name');
  assert.equal(headOf(whole).name, 'Renamed here', 'the first message\'s own acts say it');
});

// Item 470: a join or a split, before Core answers it and until the page reads the positions again, leaves the
// positions Core sent before it on the messages it moved. Neither the stack's position nor its head row's name
// comes from one, on a full page or on one holding only replies.
test('a position a join or a split has made stale is not the stack\'s: the head row names its own dossier', () => {
  const at = (root, name) => ({ root_id: root, through: null, below: false, aside_revision: 0, name, name_revision: name ? 1 : 0, at: { acts: 5, messages: 0 } });
  const named = text => ({ text, by: 'owner', at_ms: 1 });
  // Old (m3, its reply m4) and the stack it was joined to, every message carrying the position read then (root, name).
  const old = (joined, root, name) => [message(3, { acts: { name: named('Old name'), joined }, stack_position: at(root, name) }), message(4, { reply_to: 'm3', stack_position: at(root, name) })];
  // A full page: Top (m1, its reply m2).
  const top = [message(1, { acts: { name: named('Top name') }, stack_position: at('m1', named('Top name')) }), message(2, { reply_to: 'm1', stack_position: at('m1', named('Top name')) })];
  const split = stacksOf([...top, ...old(null, 'm1', named('Top name'))]).find(stack => stack.id === 'm3');
  assert.equal(positionOf(split), null, 'split out, the positions it carries are the dossier it left: none is its own');
  assert.deepEqual([headOf(split).name, headOf(split).typed.text], ['Old name', 'Old name'], 'split out, it reads its own name');
  const joined = stacksOf([...top, ...old({ into: 'm1', by: 'owner' }, 'm3', named('Old name'))]);
  assert.deepEqual(ids(joined), ['m1'], 'joined, one stack');
  assert.deepEqual([positionOf(joined[0]).root_id, headOf(joined[0]).name], ['m1', 'Top name'], 'joined, its newer messages carry Old\'s position; the stack is Top\'s');
  // A page holding only replies (m6, m7) of a dossier whose first message m5 is not loaded: m6 shows as its head.
  const dossier = [message(6, { reply_to: 'm5', stack_position: at('m5', named('Dossier name')) }), message(7, { reply_to: 'm6', stack_position: at('m5', named('Dossier name')) })];
  const partSplit = stacksOf([...dossier, ...old(null, 'm5', named('Dossier name'))]).find(stack => stack.id === 'm3');
  assert.deepEqual([positionOf(partSplit), headOf(partSplit).name], [null, 'Old name'], 'split out of a dossier the page holds only replies of, it reads its own name');
  const partJoined = stacksOf([...dossier, ...old({ into: 'm6', by: 'owner' }, 'm3', named('Old name'))]);
  assert.deepEqual(ids(partJoined), ['m6'], 'joined to the reply shown as the head, one stack');
  assert.deepEqual([positionOf(partJoined[0]).root_id, headOf(partJoined[0]).name], ['m5', 'Dossier name'], 'joined, the stack reads the dossier it hangs under');
  // The negative: positions that agree with the page stand.
  assert.deepEqual([positionOf(stacksOf(dossier)[0]).root_id, positionOf(stacksOf(top)[0]).root_id], ['m5', 'm1'], 'a page holding only replies, and a full one, keep their positions');
  const joinedAfar = stacksOf(old({ into: 'm5', by: 'owner' }, 'm5', named('Dossier name')));
  assert.deepEqual([positionOf(joinedAfar[0]).root_id, headOf(joinedAfar[0]).name], ['m5', 'Dossier name'], 'joined to a dossier the page has not loaded, it reads that dossier\'s position');
});

// Item 550: a dossier whose fork sits above the loaded page is one stack, not one per branch. Core's position names
// the dossier's first message on every reply; the branches that name one gather under the oldest loaded head, or under
// that first message where the page has loaded it, whatever is loaded between.
test('the branches of one dossier whose fork sits above the loaded page are one stack: one name, one count, its replies in time order', () => {
  const at = (root, name, acts = 3) => ({ root_id: root, through: null, below: false, aside_revision: 0, name, name_revision: name ? 1 : 0, at: { acts, messages: 0 } });
  const minted = { text: 'Lantern repair plan', by: 'agent-a', at_ms: 1, minted: true };
  const lantern = extra => ({ stack_position: at('m1', minted), ...extra });
  // m1, the lantern dossier's first message, and m9, a fork under it, are above the page. m10, m11 and m13 answer m1
  // itself; m15 answers m9; m12 and m14 answer m10 and m11.
  const branches = [message(10, lantern({ reply_to: 'm1' })), message(11, lantern({ reply_to: 'm1', author_id: 'agent-b' })), message(12, lantern({ reply_to: 'm10' })),
    message(13, lantern({ reply_to: 'm1' })), message(14, lantern({ reply_to: 'm11' })), message(15, lantern({ reply_to: 'm9' }))];
  // m2, another dossier above the page, with no name of its own; m20, a dossier whose first message is loaded.
  const other = [message(16, { reply_to: 'm2', stack_position: at('m2', null) }), message(17, { reply_to: 'm16', stack_position: at('m2', null) })];
  const loaded = [message(20, { stack_position: at('m20', null) }), message(21, { reply_to: 'm20', stack_position: at('m20', null) })];
  const stacks = stacksOf([...branches, ...other, ...loaded]);
  const lanterns = stacks.filter(stack => headOf(stack).name === 'Lantern repair plan');
  assert.equal(lanterns.length, 1, 'the dossier is one stack: its name shows once');
  const [one] = lanterns;
  assert.deepEqual([one.head.id, ids(one.replies)], ['m10', ['m11', 'm12', 'm13', 'm14', 'm15']], 'the oldest loaded head, every other reply oldest first');
  assert.deepEqual([headOf(one).count, headOf(one).mintedBy, headOf(one).repliers], [5, 'agent-a', ['agent-b', 'agent-a']], 'one count, its minted name\'s agent, who replied');
  assert.equal(positionOf(one).root_id, 'm1');
  assert.deepEqual(ids(stacks.map(stack => stack.head)), ['m20', 'm16', 'm10'], 'three stacks: the lantern dossier sits where its newest reply does');
  // The negatives: another dossier stays its own, under its own first line and no minted name.
  const second = stacks.find(stack => stack.id === 'm16');
  assert.deepEqual([ids(second.replies), headOf(second).name, headOf(second).mintedBy], [['m17'], 'Message 16', null], 'another dossier is its own stack and takes no other name');
  // A dossier whose first message is loaded reads as it did.
  assert.deepEqual(ids(stacks.find(stack => stack.id === 'm20').replies), ['m21']);
  // More: the fork m9 loads, then the first message; the dossier stays one stack, never split or doubled.
  const fork = message(9, lantern({ reply_to: 'm1' }));
  const withFork = stacksOf([fork, ...branches, ...other, ...loaded]);
  assert.deepEqual(withFork.filter(stack => headOf(stack).name === 'Lantern repair plan').map(stack => [stack.head.id, ids(stack.replies)]),
    [['m9', ['m10', 'm11', 'm12', 'm13', 'm14', 'm15']]], 'the fork loaded: one stack under it');
  const root = message(1, { acts: { name: minted }, stack_position: at('m1', minted) });
  const whole = stacksOf([root, fork, ...branches, ...other, ...loaded]);
  assert.deepEqual(whole.filter(stack => headOf(stack).name === 'Lantern repair plan').map(stack => [stack.head.id, stack.replies.length]), [['m1', 7]], 'the first message loaded: one stack under it');
  // The first message loaded and the fork not (two runs of the page with a gap between): m15 goes into m1's stack.
  const gap = stacksOf([root, ...branches]);
  assert.deepEqual(gap.map(stack => [stack.head.id, ids(stack.replies)]), [['m1', ['m10', 'm11', 'm12', 'm13', 'm14', 'm15']]], 'the root loaded, the fork not: one stack');
  // The reader's own reply under the dossier's first message does not lift it, as in any stack.
  const mine = ordered(gather([...branches, message(25), message(30, lantern({ reply_to: 'm1', author_id: 'owner' }))], { viewer: 'owner' }));
  assert.deepEqual(mine.map(stack => [stack.head.id, stack.replies.length]), [['m25', 0], ['m10', 6]], 'the reader\'s own reply joins the dossier and leaves it where it was');
  // A split not yet answered: the head carries positions Core read before it, naming the dossier it left. It gathers
  // nothing by them and takes none of its name.
  const split = stacksOf([...branches, message(40, { reply_to: 'm39', moving: true, acts: { joined: null, name: { text: 'Its own', by: 'owner', at_ms: 1 } }, stack_position: at('m1', minted) }),
    message(41, lantern({ reply_to: 'm40' }))]);
  const out = split.find(stack => stack.id === 'm40');
  assert.deepEqual([ids(out.replies), positionOf(out), headOf(out).name], [['m41'], null, 'Its own'], 'a split not yet answered stays out, under its own name');
  assert.equal(split.filter(stack => headOf(stack).name === 'Lantern repair plan').length, 1);
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

test('a stack has two states a person steps between, latest plus unread and every message; the header alone is only where an agent dossier begins', () => {
  let state = { level: 'folded' };
  const steps = [];
  for (let next = foldStep(state, 'open'); next; next = foldStep(state, 'open')) { state = next; steps.push({ ...state }); }
  assert.deepEqual(steps, [{ level: 'open' }], '→ from latest plus unread shows every message, then goes nowhere further');
  const back = [];
  for (let next = foldStep(state, 'fold'); next; next = foldStep(state, 'fold')) { state = next; back.push({ ...state }); }
  assert.deepEqual(back, [{ level: 'folded' }], '← goes back to latest plus unread and stops there, never to the header alone');
  assert.deepEqual(LEVELS, ['folded', 'open']);
  assert.deepEqual(foldStep({ level: 'head' }, 'open'), { level: 'folded' }, 'an agent dossier\'s header alone opens to latest plus unread');
  assert.equal(foldStep({ level: 'head' }, 'fold'), null, 'and has nothing to fold to');
  assert.equal(foldStep({ level: 'folded', headOpen: false }, 'open', { replies: false }), null, 'a message with no replies has nothing to open');
});

test('a stack left at its header alone shows latest plus unread unless it is an agent dossier', async () => {
  const { levelOf } = await import('../web/reply-stacks.mjs');
  const state = { levels: new Map([['m1', 'head'], ['m2', 'head'], ['m3', 'open']]), coordination: new Set(['m2', 'm4']) };
  assert.equal(levelOf(state, 'm1'), 'folded', 'a stack that stopped being agent-only, left at its header, shows latest plus unread');
  assert.equal(levelOf(state, 'm2'), 'head', 'an agent dossier taken back to its header stays there');
  assert.equal(levelOf(state, 'm3'), 'open');
  assert.equal(levelOf(state, 'm4'), 'head', 'an agent dossier begins as its header alone');
  assert.equal(levelOf(state, 'm5'), 'folded', 'any other stack begins at latest plus unread');
});

test('an acts answer read before an act the page has since heard of puts back nothing; a later one, from another device, shows', async () => {
  const { TopicViews } = await import('../web/topic-views.mjs');
  const painted = [];
  const v = new TopicViews({ instanceId: 'i1', topicId: 't1', paint: kind => painted.push(kind) });
  const none = { starred: false, star_revision: 0, dealt: false, deal_revision: 0, placed: null, place_revision: 0, name: null, name_revision: 0, joined: null, join_revision: 0 };
  const item = acts => ({ id: 'm1', seq: 1, topic_id: 't1', body: 'The root.', author_id: 'agent-a', acts: { ...none, ...acts } });
  v.messagesPage({ instance_id: 'i1', items: [item({})], next_cursor: null, relevant_versions: { topic: 1 } }, { initial: true });
  // The page heard of its own place at revision 2 and a star at revision 1.
  v.messages.get('m1').acts = { ...none, placed: 10, place_revision: 2, starred: true, star_revision: 1 };
  const answer = acts => async () => ({ instance_id: 'i1', topic_id: 't1', version: 9, next_cursor: null, items: [{ message_id: 'm1', seq: 1, acts: { ...none, ...acts } }] });
  painted.length = 0;
  await v.readActs(0, answer({ placed: 5, place_revision: 1, starred: true, star_revision: 1 }), () => true);
  assert.deepEqual([v.messages.get('m1').acts.placed, v.messages.get('m1').acts.place_revision], [10, 2], 'an answer older than the place the page holds puts back nothing');
  assert.deepEqual(painted, [], 'and draws nothing again');
  await v.readActs(0, answer({ placed: 10, place_revision: 2, starred: false, star_revision: 2, name: { text: 'Cabin', by: 'aim-ux', at_ms: 1 }, name_revision: 1 }), () => true);
  assert.deepEqual([v.messages.get('m1').acts.starred, v.messages.get('m1').acts.name?.text], [false, 'Cabin'], 'later acts, made elsewhere, show');
  assert.deepEqual(painted, ['acts']);
  // The message read again on a page read before those acts keeps them.
  v.messagesPage({ instance_id: 'i1', items: [item({ placed: 5, place_revision: 1 })], next_cursor: null, relevant_versions: { topic: 1 } }, { initial: true });
  assert.deepEqual([v.messages.get('m1').acts.placed, v.messages.get('m1').acts.starred, v.messages.get('m1').acts.name?.text], [10, false, 'Cabin'], 'a message page read earlier puts back no act');
});

test('a message the reader folded reads as its one-line row wherever its stack shows it, fully open included', () => {
  const fold = { folded: true, fold_revision: 1 };
  const items = [message(1), ...[2, 3, 4, 5].map(seq => message(seq, { reply_to: 'm1', ...(seq === 3 || seq === 5 ? { acts: fold } : {}) }))];
  const [stack] = stacksOf(items);
  const kept = item => item.seq === 3;
  assert.deepEqual(words(rowsOf(stack, { level: 'open', kept })), ['m2', 'm3 (folded)', 'm4', 'm5 (folded)'],
    'fully open: each folded message is its row, in its place, and nothing else changes');
  assert.deepEqual(words(rowsOf(stack, { level: 'folded', kept })), ['1 earlier reply', 'm3 (folded)', '1 more reply', 'm5 (folded)'],
    'latest and unread: a folded reply the view keeps, and a folded newest, are rows, never taken away');
  assert.deepEqual(words(rowsOf(stack, { level: 'head', kept })), ['4 replies'], 'header only: nothing shows, folded or not');
  // A fold neither shows nor hides a reply: the level alone decides that.
  for (const level of ['head', 'folded', 'open']) {
    const unfolded = stacksOf(items.map(item => ({ ...item, acts: {} })))[0];
    assert.deepEqual(rowsOf(stack, { level, kept }).map(row => row.kind), rowsOf(unfolded, { level, kept }).map(row => row.kind), level);
    assert.deepEqual(stack.replies.map(item => shown(stack, item, { level, kept })), unfolded.replies.map(item => shown(unfolded, item, { level, kept })), level);
  }
  // A star keeps a message in view: a starred message never reads as its row, folded or not.
  const both = stacksOf(items.map(item => item.seq === 5 ? { ...item, acts: { ...fold, starred: true, star_revision: 1 } } : item))[0];
  assert.deepEqual(words(rowsOf(both, { level: 'open', kept })).slice(-1), ['m5']);
  // Opened for this view (a link, search, Starred): the message shows whole, its fold kept in Core.
  assert.deepEqual(words(rowsOf(stack, { level: 'open', kept, peeked: item => item.id === 'm3' })), ['m2', 'm3', 'm4', 'm5 (folded)']);
  // Unfolded (folded: false at a later revision), it reads whole again.
  const back = stacksOf(items.map(item => item.seq === 3 ? { ...item, acts: { folded: false, fold_revision: 2 } } : item))[0];
  assert.deepEqual(words(rowsOf(back, { level: 'open', kept })), ['m2', 'm3', 'm4', 'm5 (folded)']);
});

test('a folded first message reads as its row, as any message does, under a head row that says nothing of it; a message on its own as its row', () => {
  const items = [message(1, { acts: { folded: true, fold_revision: 1 } }), message(2, { reply_to: 'm1' }), message(3, { acts: { folded: true, fold_revision: 1 } }), message(4)];
  const withReplies = stacksOf(items).find(stack => stack.id === 'm1');
  // Item 471: the head row is the dossier's title, folded first message or not.
  assert.deepEqual(headOf(withReplies), headOf(stacksOf([message(1), ...items.slice(1)]).find(stack => stack.id === 'm1')),
    'the head row is the same whether its first message is folded or not');
  assert.equal('folded' in headOf(withReplies), false, 'and says nothing of a fold');
  assert.equal(rowFolded(withReplies.head), true, 'the first message itself reads as its row');
  assert.equal(rowFolded(withReplies.head, { peeked: item => item.id === 'm1' }), false, 'opened for this view, it shows whole');
  assert.deepEqual(items.map(item => rowFolded(item)), [true, false, true, false]);
  assert.equal(rowFolded(message(5, { acts: { folded: true, starred: true } })), false, 'a starred message is never a row');
  assert.equal(rowFolded(message(6, { acts: { folded: true } }), { peeked: () => true }), false);
});

test('the page holds a fold or unfold until Core answers it, and an older answer puts back none', () => {
  const known = { folded: true, fold_revision: 2, starred: false, star_revision: 0 };
  assert.deepEqual(laterActs(known, { folded: false, fold_revision: 1, starred: false, star_revision: 0 }).folded, true, 'an answer read before the fold puts back nothing');
  assert.deepEqual(laterActs(known, { folded: false, fold_revision: 3, starred: false, star_revision: 0 }).folded, false, 'a later unfold, from another device, shows');
});

// Item 476: an open dossier shows its newest seven messages and one row for the rest, which shows them all as rows
// for this visit only. It is a way of showing the dossier: every message stays in it, in its place, and nothing is
// recorded, so latest plus unread and a dossier of seven or fewer read as before.
test('an open dossier of more than seven shows its newest seven and one row for the earlier ones; opened, that row shows them all as rows in their places', () => {
  const items = [message(1), ...Array.from({ length: 20 }, (_, n) => message(n + 2, { reply_to: 'm1' }))];
  const [stack] = stacksOf(items), unread = item => item.seq === 3 || item.seq === 20;
  assert.equal(RECENT, 7);
  assert.deepEqual(ids(earlierOf(stack, 'open')), ['m1', ...Array.from({ length: 13 }, (_, n) => 'm' + (n + 2))], 'the first fourteen of twenty-one, the first message among them');
  const recent = Array.from({ length: 7 }, (_, n) => 'm' + (n + 15));
  assert.deepEqual(words(rowsOf(stack, { level: 'open', unread })), ['14 earlier messages · 1 new', ...recent], 'one row says how many, and how many of them are new');
  // Opened for this visit: every earlier reply is its row, in its place, oldest first, then the seven as before.
  assert.deepEqual(words(rowsOf(stack, { level: 'open', unread, earlier: true })),
    [...Array.from({ length: 13 }, (_, n) => `m${n + 2} (earlier)`), ...recent], 'every message is reachable in place; none is lost or moved');
  // Whether a reply shows: hidden behind the row until it is opened; the seven always.
  assert.deepEqual([shown(stack, items[2], { level: 'open' }), shown(stack, items[2], { level: 'open', earlier: true }), shown(stack, items[20], { level: 'open' })], [false, true, true]);
  // The other state is untouched: latest plus unread shows what it showed.
  assert.deepEqual(earlierOf(stack, 'folded'), []);
  assert.deepEqual(words(rowsOf(stack, { unread, kept: unread })), ['1 earlier reply', 'm3', '16 more replies', 'm20', 'm21']);
  // A reply the reader folded keeps its own row, and a starred one stays whole, opened or not.
  const marked = stacksOf(items.map(item => item.seq === 4 ? { ...item, acts: { folded: true, fold_revision: 1 } } : item.seq === 5 ? { ...item, acts: { starred: true } } : item))[0];
  assert.deepEqual(words(rowsOf(marked, { level: 'open', earlier: true })).slice(1, 4), ['m3 (earlier)', 'm4 (folded) (earlier)', 'm5 (earlier)']);
  // A joined stack's first message among the earlier keeps its join line, shown with it once the row is opened.
  const joined = stacksOf(items.map(item => item.seq === 6 ? { ...item, reply_to: undefined, acts: { joined: { into: 'm1', by: 'owner' } } } : item))[0];
  assert.deepEqual(words(rowsOf(joined, { level: 'open' })).filter(row => row.startsWith('join')), [], 'closed: no join line over messages it hides');
  assert.ok(words(rowsOf(joined, { level: 'open', earlier: true })).includes('join m6'), 'opened: the join line sits before its message');
});

test('a dossier of seven messages or fewer shows no earlier row; one of eight shows one for its first message', () => {
  const dossier = n => stacksOf([message(1), ...Array.from({ length: n - 1 }, (_, i) => message(i + 2, { reply_to: 'm1' }))])[0];
  for (const n of [2, 5, 7]) {
    assert.deepEqual(earlierOf(dossier(n), 'open'), [], `${n} messages`);
    assert.ok(rowsOf(dossier(n), { level: 'open' }).every(row => row.kind === 'reply' && !row.earlier), `${n} messages: every reply a card`);
  }
  assert.deepEqual(ids(earlierOf(dossier(8), 'open')), ['m1']);
  assert.deepEqual(words(rowsOf(dossier(8), { level: 'open' })), ['1 earlier message', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
});

// Your place holds (docs/experience-guidelines.md): the newest seven are counted once, when the dossier is drawn open,
// and the page holds the first message it showed then (held). A message arriving after that joins the shown ones
// below and hides nothing; one loaded from before goes behind the row. Held gone from the dossier, they are counted
// afresh; at latest plus unread none is earlier, held or not.
test('the newest seven are counted when the dossier is drawn open: a message arriving after that hides nothing', () => {
  const dossier = n => stacksOf([message(1), ...Array.from({ length: n - 1 }, (_, i) => message(i + 2, { reply_to: 'm1' }))])[0];
  // Seven drawn open, the first message shown: an eighth arrives and the first message stays shown, no row.
  assert.deepEqual(earlierOf(dossier(8), 'open', { held: 'm1' }), [], 'seven held from m1, an eighth arrives');
  assert.deepEqual(words(rowsOf(dossier(8), { level: 'open', held: 'm1' })), ['m2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'], 'every reply a card, no earlier row');
  // Ten drawn open showed m4 on: an eleventh arrives, and m4 is still shown, the row still three.
  const eleven = dossier(11);
  assert.deepEqual(ids(earlierOf(eleven, 'open', { held: 'm4' })), ['m1', 'm2', 'm3']);
  assert.deepEqual(words(rowsOf(eleven, { level: 'open', held: 'm4' })), ['3 earlier messages', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11']);
  assert.equal(shown(eleven, eleven.replies[2], { level: 'open', held: 'm4' }), true, 'the card being read stays shown');
  assert.equal(shown(eleven, eleven.replies[1], { level: 'open', held: 'm4' }), false, 'the earlier ones stay behind the row');
  // Held is no longer in the dossier: counted afresh. Latest plus unread: none is earlier.
  assert.deepEqual(ids(earlierOf(dossier(9), 'open', { held: 'gone' })), ['m1', 'm2']);
  assert.deepEqual(earlierOf(eleven, 'folded', { held: 'm4' }), []);
  // Not held (drawn open for the first time): the last seven, as before.
  assert.deepEqual(ids(earlierOf(eleven, 'open')), ['m1', 'm2', 'm3', 'm4']);
});
