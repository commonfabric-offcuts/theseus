// How a topic's loaded messages read as reply stacks (docs/reply-stacks.md),
// in the parts that decide: chat order inside a stack, the fold lines at each
// gap, the stacks newest on top unless the reader placed one, a join read as
// one stack oldest first, the one New line under the lowest stack holding anything
// new, and the red count on a fold line. The native reading checks
// (tests/stack_native.mjs) press the real keys on the real page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gather, ordered, rowsOf, headOf, lineUnder, moveOf, joinOf, joinShown, readingOrder, foldStep, keyOf, shown, rowFolded, laterActs, LEVELS } from '../web/stack-order.mjs';

const message = (seq, extra = {}) => ({ id: 'm' + seq, seq, author_id: 'agent-a', body: `Message ${seq}\nmore`, ...extra });
const ids = items => items.map(item => item.id);
const stacksOf = items => ordered(gather(items));
const words = rows => rows.map(row => row.kind === 'reply' ? row.item.id + (row.folded ? ' (folded)' : '') : row.kind === 'join' ? `join ${row.item.id}` : row.words + (row.fresh ? ` · ${row.fresh} new` : ''));

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
    return rowsOf(together[0], { level: shown.level }).filter(row => row.kind !== 'fold-all');
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
const shownRows = (stack, level = 'open') => words(rowsOf(stack, { level }).filter(row => row.kind !== 'fold-all'));

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
  assert.deepEqual(words(rowsOf(stack, { level: 'open', kept })), ['Fold 5 earlier replies', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8']);
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
  assert.deepEqual(words(rowsOf(stack, { level: 'open', kept })), ['Fold 2 earlier replies', 'm2', 'm3 (folded)', 'm4', 'm5 (folded)'],
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
  assert.deepEqual(words(rowsOf(stack, { level: 'open', kept, peeked: item => item.id === 'm3' })).slice(1), ['m2', 'm3', 'm4', 'm5 (folded)']);
  // Unfolded (folded: false at a later revision), it reads whole again.
  const back = stacksOf(items.map(item => item.seq === 3 ? { ...item, acts: { folded: false, fold_revision: 2 } } : item))[0];
  assert.deepEqual(words(rowsOf(back, { level: 'open', kept })).slice(1), ['m2', 'm3', 'm4', 'm5 (folded)']);
});

test('a folded first message reads as its stack\'s head row alone, and a message on its own as its row', () => {
  const items = [message(1, { acts: { folded: true, fold_revision: 1 } }), message(2, { reply_to: 'm1' }), message(3, { acts: { folded: true, fold_revision: 1 } }), message(4)];
  const withReplies = stacksOf(items).find(stack => stack.id === 'm1');
  assert.equal(headOf(withReplies).folded, true, 'the head row says its first message is folded');
  assert.equal(headOf(stacksOf([message(1), message(2, { reply_to: 'm1' })])[0]).folded, false);
  assert.equal(headOf(withReplies, { peeked: item => item.id === 'm1' }).folded, false, 'opened for this view, it shows whole');
  assert.deepEqual(items.map(item => rowFolded(item)), [true, false, true, false]);
  assert.equal(rowFolded(message(5, { acts: { folded: true, starred: true } })), false, 'a starred message is never a row');
  assert.equal(rowFolded(message(6, { acts: { folded: true } }), { peeked: () => true }), false);
});

test('the page holds a fold or unfold until Core answers it, and an older answer puts back none', () => {
  const known = { folded: true, fold_revision: 2, starred: false, star_revision: 0 };
  assert.deepEqual(laterActs(known, { folded: false, fold_revision: 1, starred: false, star_revision: 0 }).folded, true, 'an answer read before the fold puts back nothing');
  assert.deepEqual(laterActs(known, { folded: false, fold_revision: 3, starred: false, star_revision: 0 }).folded, false, 'a later unfold, from another device, shows');
});
