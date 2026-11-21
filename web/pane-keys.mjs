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

// Capture before reach tries to focus or scroll. Its true return alone does
// not prove movement: a control can refuse focus.
export function readingMovement(doc, within = null, at = doc.activeElement) {
  const boxes = [doc.scrollingElement, ...(within ?? doc.body).querySelectorAll('*')];
  for (let box = within ?? doc.body; box; box = box.parentElement) boxes.push(box);
  const scrollers = boxes
    .filter(box => box && (box.scrollHeight > box.clientHeight || box.scrollWidth > box.clientWidth))
    .map(box => ({ box, top: box.scrollTop, left: box.scrollLeft }));
  return () => Boolean(doc.activeElement !== at && doc.activeElement?.isConnected && !pageItself(doc.activeElement, doc) ||
    scrollers.some(({ box, top, left }) => box.scrollTop !== top || box.scrollLeft !== left));
}

// Plain Return is resolved before the key can restore a pane's old focus.
// These are the selection surfaces drawn by aim.css and stack-look.css;
// :hover alone is not selection (in particular, a rail topic's hover).
export const plainReturn = event => event?.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;

// Whether some of the element is actually drawn in the viewport and its
// scrolling ancestors. A retained .lit or DOM focus outside that area is no
// visible promise. This reads geometry only; it never scrolls or moves focus.
function returnShown(el, doc) {
  if (!el?.isConnected || el.closest('[inert], [hidden]') || !el.getClientRects().length) return false;
  const win = doc.defaultView, box = el.getBoundingClientRect();
  let left = Math.max(0, box.left), right = Math.min(win.innerWidth, box.right);
  let top = Math.max(0, box.top), bottom = Math.min(win.innerHeight, box.bottom);
  for (let at = el; at; at = at.parentElement) {
    const style = win.getComputedStyle(at);
    if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none' || Number(style.opacity) === 0) return false;
    if (at === el) continue;
    const clip = at.getBoundingClientRect();
    if (/^(hidden|clip|auto|scroll|overlay)$/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
    if (/^(hidden|clip|auto|scroll|overlay)$/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
  }
  return right > left && bottom > top;
}

// null: leave the key to writing/pop-ups or an actually ringed control;
// { entry, dossier? }: this message or the dossier's existing Reply owner;
// {}: this page's pencil sheet.
// No last-target state: .lit suppresses rail/header focus rings in rails.css,
// and suppresses the old dossier chevron's ring in stack-look.css. Reading
// the computed ring respects those rules even if :focus-visible still matches.
export function returnIntent(event, doc, host, shown = entry => entry, controls = true) {
  const at = doc.activeElement;
  if (!plainReturn(event) || event.defaultPrevented || event.isComposing || writing(event.target) || writing(at) || at?.isContentEditable || doc.querySelector('dialog[open]:not([data-card-reply])')) return null;
  const selection = at?.matches?.('.message-card, .fold-line, .stack-toggle');
  if (controls && !selection && at?.matches?.(':focus-visible') && returnShown(at, doc)) {
    const style = doc.defaultView.getComputedStyle(at);
    if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) return null;
  }
  for (const entry of host.querySelectorAll('[data-id].lit')) {
    const surface = entry.matches('.message-fold') ? entry.querySelector('.fold-line') : shown(entry);
    if (returnShown(surface, doc)) return { entry, dossier: surface !== entry && surface?.matches?.('.reply-stack') ? surface : null };
  }
  // With no lit message, a focused chevron draws the dossier outline, even
  // after pointer focus. Its current title-bar Reply owns the target (StackFeed).
  if (!host.querySelector('.lit') && host.contains(at) && at?.matches?.('.stack-toggle') && !at.closest('.only-new') && returnShown(shown(at), doc)) {
    const entry = at.closest('.reply-stack')?.querySelector(':scope > [data-id]');
    if (entry) return { entry, dossier: at.closest('.reply-stack') };
  }
  return {};
}

// What a key press means, or null when it means nothing here: 'up', 'down',
// 'first', 'last', 'left', 'right' (plain), 'open' and 'fold' (⌘→ ⌘←),
// 'open-all' and 'fold-all' (⇧⌘→ ⇧⌘←), 'move-up' and 'move-down' (⌘↑ ⌘↓),
// 'undo' (⌘Z), 'write' (⌘Return: a new message in the place the keys are on;
// in writing it stays Send), 'join-up' and 'join-down' (⇧⌘↑ ⇧⌘↓), and
// 'fold-message' (x), which only the messages' reply stacks act on (stack-feed.mjs).
// Plain Return uses the visible outline, or this page's pencil when none is
// drawn. Writing and a control showing its focus ring keep their own Return. ⌘ is the Command key, on a Mac and on an
// iPad's keyboard alike; Control and Option with an arrow mean nothing here.
export function keyAction(event) {
  if (!event || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || writing(event.target)) return null;
  const command = Boolean(event.metaKey);
  if (event.shiftKey) return command ? { ArrowRight: 'open-all', ArrowLeft: 'fold-all', ArrowUp: 'join-up', ArrowDown: 'join-down' }[event.key] ?? null : null;
  if (command) return { ArrowUp: 'move-up', ArrowDown: 'move-down', ArrowRight: 'open', ArrowLeft: 'fold', z: 'undo', Z: 'undo', Enter: 'write' }[event.key] ?? null;
  return { ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'right', ArrowLeft: 'left', Home: 'first', End: 'last', x: 'fold-message' }[event.key] ?? null;
}

// The keys, in plain words, as the outline's legend and the guide list them.
export const KEY_WORDS = [
  ['↑ ↓', 'move through the outcomes and topics; Home and End go to the first and last'],
  ['Return', 'replies to the visibly outlined message or dossier; with nothing outlined, opens New message here. Rail hover is not selection. Writing and a button or link showing its focus ring keep their own Return. On an outline row showing its focus ring, Return opens the topic at its oldest unread message when it has an unread count, or the outcome home with its topics, without folding other outcomes; on a pencil, a new topic\'s or outcome\'s title line'],
  ['⌘→ ⌘←', 'open and fold an outcome'],
  ['⇧⌘→ ⇧⌘←', 'open every outcome, or fold every one'],
  ['→ ←', 'open or fold, then move between the outline, the messages and the right rail'],
  ['⌘Return', 'starts a new message in the topic the keys are on, or in the outcome\'s Conversation'],
  ['Option-N · Option-M', 'opens the pencil sheet in Note mode with Option-N or Message mode with Option-M; either switches mode while typing without inserting a character. After clicking Note or Message, Return or ⌘Return sends; in a text field Return makes a new line and ⌘Return sends'],
  ['⌘↑ ⌘↓', 'move an outcome, or a topic within its outcome, up or down; your order is kept wherever you sign in'],
  ['⌘Z', 'puts the last move back'],
];
// The same keys on a message, as the outline's legend lists them under "In the messages" (docs/reply-stacks.md).
export const MESSAGE_KEY_WORDS = [
  ['↑ ↓', 'move the light from message to message, down a stack to its newer replies and on to the stack below'],
  ['⌘↑', 'move the message\'s stack up; your order is yours, kept wherever you sign in'],
  ['⌘↓', 'move the selected dossier below More; a selected message moves its containing dossier'],
  ['→ ←', 'show a stack\'s every message, or only its latest and unread; past either, move to the right or left siderail'],
  ['⇧⌘↑ ⇧⌘↓', 'join the stack to the one above or below, for everyone here; Split back out in ⋯ takes it out again'],
  ['x', 'folds the message to one line, for you alone, and x again unfolds it; a starred message stays open'],
  ['⌘Z', 'puts back your last move, fold, rename or join'],
];
