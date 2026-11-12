// The keys that move through the three panes, as Finder's column view does
// (docs/interaction.md, "Keys across the panes"): ↑ and ↓ within a pane,
// → and ← between them, and with ⌘ the same arrows open, fold and reorder.
// One map for every pane, so each pane names what a key means and decides for
// itself whether it acts: the outline (outline-rail.mjs), the right rail
// (things-rail.mjs) and the feed between them (rails.mjs). The feed leaves its
// ⌘ arrows to its own pieces (reply stacks), which read the same map.
//
// Keys never act in writing: in a text field, the Reader or a composer ⌘← and
// ⌘→ are the line's start and end, and ⌘↑ ⌘↓ the writing's.

// Where the keys belong to what is being written, or to an open pop-up.
export const WRITING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog, .composer, [role="dialog"], [role="menu"]';
export function writing(target) {
  return Boolean(target?.closest?.(WRITING));
}

// Whether the focus is on the page itself, where the keys are the page's:
// nothing, the page (main), or its heading, where a move in place puts the
// focus as a load leaves it on the page (in-place-navigation.mjs).
export function pageItself(at, doc) {
  return !at || at === doc.body || at.id === 'main' || Boolean(at.matches?.('#main h1'));
}

// What a key press means, or null when it means nothing here: 'up', 'down',
// 'first', 'last', 'left', 'right' (plain), 'open' and 'fold' (⌘→ ⌘←),
// 'open-all' and 'fold-all' (⇧⌘→ ⇧⌘←), 'move-up' and 'move-down' (⌘↑ ⌘↓),
// 'undo' (⌘Z), 'write' (⌘Return: a new message in the place the keys are on;
// in writing it stays Send), and 'join-up' and 'join-down' (⇧⌘↑ ⇧⌘↓), which
// only the messages' reply stacks act on (stack-feed.mjs). Return is left to
// what is focused, which opens it. ⌘ is the Command key, on a Mac and on an
// iPad's keyboard alike; Control and Option with an arrow mean nothing here.
export function keyAction(event) {
  if (!event || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || writing(event.target)) return null;
  const command = Boolean(event.metaKey);
  if (event.shiftKey) return command ? { ArrowRight: 'open-all', ArrowLeft: 'fold-all', ArrowUp: 'join-up', ArrowDown: 'join-down' }[event.key] ?? null : null;
  if (command) return { ArrowUp: 'move-up', ArrowDown: 'move-down', ArrowRight: 'open', ArrowLeft: 'fold', z: 'undo', Z: 'undo', Enter: 'write' }[event.key] ?? null;
  return { ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'right', ArrowLeft: 'left', Home: 'first', End: 'last' }[event.key] ?? null;
}

// The keys, in plain words, as the outline's legend and the guide list them.
export const KEY_WORDS = [
  ['↑ ↓', 'move through the outcomes and topics; Home and End go to the first and last'],
  ['Return', 'opens the topic, or the outcome\'s Conversation with its topics, folding every other outcome'],
  ['⌘→ ⌘←', 'open and fold an outcome'],
  ['⇧⌘→ ⇧⌘←', 'open every outcome, or fold every one'],
  ['→ ←', 'open or fold, then move between the outline, the messages and the right rail'],
  ['⌘Return', 'starts a new message in the topic the keys are on, or in the outcome\'s Conversation'],
  ['⌘↑ ⌘↓', 'move an outcome, or a topic within its outcome, up or down; your order is kept wherever you sign in'],
  ['⌘Z', 'puts the last move back'],
];
// The same keys on a message, as the outline's legend lists them under "In the messages" (docs/reply-stacks.md).
export const MESSAGE_KEY_WORDS = [
  ['↑ ↓', 'move the light from message to message, down a stack to its newer replies and on to the stack below'],
  ['⌘↑ ⌘↓', 'move the message\'s stack up or down; your order is yours, kept wherever you sign in'],
  ['→ ←', 'open or fold a stack a step at a time; past fully open or closed, move to the right or left siderail'],
  ['⇧⌘↑ ⇧⌘↓', 'join the stack to the one above or below, for everyone here; Split back out in ⋯ takes it out again'],
  ['⌘Z', 'puts back your last move, fold, rename or join'],
];
