// A pane the keys move through as one tree (docs/interaction.md, "Keys
// across the panes"): one Tab stop (a roving tabindex, on the row last
// visited), a ring on the row the keys are on, and what a screen reader needs
// to read it as a tree (role tree and treeitem, aria-level, aria-setsize,
// aria-posinset, aria-expanded on a row that opens). The pane says which rows
// it has and what each key does to them; this keeps the place.
//
// Until the keys have been in the pane, its Tab stop is the row of the place
// being read (aria-current), as that row is drawn. Once they have, the place
// is the row they were last on, kept by what it stands for (its key), not by
// its element: a row drawn again (the page's topic list after a move in place)
// takes the place back, and the focus with it when the focus was in the pane
// and went with the old element, wearing the ring the row that went wore:
// the keys' ring after the keys or a press that selected the row (the
// outline's), and none after a press that rang nothing (the right rail's).
//
// A pane may choose that a press on a row (a click or a tap) selects it as the
// keys would (selectOnPress, the outline's, item 462): the row becomes the
// pane's place and holds the focus with the keys' ring, so ↑ ↓ and → go on
// from it; the row's own act then runs as it always did.
import { keyAction } from './pane-keys.mjs';
import { revealSelection } from './reveal.mjs';
import { reach } from './arrow-reach.mjs';

// What a press lands on that has an act of its own: a row is one, and so is a control inside a row.
const CONTROLS = 'a[href], button, summary, input, select, textarea, [contenteditable], [role=treeitem]';
const shown = el => el.isConnected && (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0);
// A control set in a row (the right rail's Notebook pencil in its section's row).
const OWN = 'button:not([disabled]), a[href], input:not([type=hidden])';
const setIn = el => [...el.querySelectorAll(OWN)].find(shown) ?? null;

export class KeyTree {
  // root: the element that is the tree. rows(): the rows on show, in order,
  // each { el, level, set, key, parent (a row's el, or null), expanded (true,
  // false, or undefined for a row that does not open), and aside: true for a
  // row never taken as the Tab stop for want of another (the outline's heading
  // pencil), and byRight: true for a row ↑ and ↓ pass over, reached by → alone }. act(action, row,
  // rows): what the pane does for a key the tree does not answer itself; it
  // returns false for a key it leaves to the page, which then goes on unanswered. The
  // tree speaks through a polite status of its own (say). also: rows drawn
  // outside root (the outline's heading pencil), which the tree owns
  // (aria-owns) and hears as its own.
  // fallback(key, previousRows, rows): optional replacement for a removed
  // selected row. Its replacement becomes the kept key; other trees keep the
  // default place fallback.
  // column: where ↑ above the first row and ↓ below the last go on to, in the
  // page's column the tree stands in (the side rail's logo block, its Keys;
  // arrow-reach.mjs), else the tree's own root, where nothing lies beyond.
  constructor({ root, rows, act = () => false, label = null, also = [], column = root, doc = root.ownerDocument, selectOnPress = false, fallback = null }) {
    Object.assign(this, { root, rows, act, column, doc, also, fallback });
    this.current = null; this.currentKey = null; this.wanted = false; this.queued = false; this.chosen = false; this.placing = false; this.marked = new Set();
    // ringed: whether the focus in the pane wears a ring. standing: whether
    // the row chosen is still the person's last choice (away, show).
    this.ringed = false; this.standing = false;
    root.setAttribute('role', 'tree');
    if (label) root.setAttribute('aria-label', label);
    this.status = doc.createElement('span');
    this.status.className = 'sr-only'; this.status.setAttribute('role', 'status');
    root.after(this.status);
    if (also.some(el => !el.id)) throw Error('A row drawn outside the tree needs an id, for the tree to own it');
    if (also.length) root.setAttribute('aria-owns', also.map(el => el.id).join(' '));
    // Before the row's own act, so the act finds the row selected (the shell keeps the keys on it).
    if (selectOnPress) root.addEventListener('click', event => this.pressed(event), true);
    for (const part of [root, ...also]) this.hear(part);
    this.watch = new (doc.defaultView.MutationObserver)(() => this.soon());
    this.watch.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'aria-current', 'disabled', 'inert'] });
    this.refresh();
  }
  // Whether an element is in the pane: under its root, or one of its own rows drawn outside it.
  holds(el) { return Boolean(el) && (this.root.contains(el) || this.also.some(part => part.contains(el))); }
  hear(part) {
    part.addEventListener('keydown', event => this.key(event));
    part.addEventListener('focusin', event => {
      // Rows that came to show since the last draw (the phone's drawer opening
      // shows a rail the tree could not see) get their tree words first.
      if (!this.placing && !(this.current && shown(this.current))) this.refresh();
      const at = event.target, row = this.rowOf(at);
      this.wanted = true;
      // A row the person moved to; not one the tree put the focus on while the row it keeps is away.
      if (row && !this.placing) { this.chosen = true; this.standing = true; this.visit(row); }
      // Whether the focus wears a ring, read once it has landed: what a row drawn in its place wears (refresh).
      queueMicrotask(() => { if (this.doc.activeElement === at) this.ringed = at.matches(':focus-visible'); });
    });
    part.addEventListener('focusout', event => {
      // Focus that leaves for somewhere else in the page is gone from the
      // pane; focus whose row was taken out of the page, or made inert while
      // the next run draws it again (a move in place), is given back to the
      // row drawn in its place.
      const left = event.target;
      if (event.relatedTarget && !this.holds(event.relatedTarget)) this.wanted = false;
      else if (!event.relatedTarget) queueMicrotask(() => { if (left.isConnected && !left.closest('[inert]') && !this.holds(this.doc.activeElement)) this.wanted = false; });
    });
  }
  // Drawn again once the changes under way have landed.
  soon() { if (this.queued) return; this.queued = true; queueMicrotask(() => { this.queued = false; this.refresh(); }); }
  list() { return this.rows().filter(row => shown(row.el)); }
  // The row a focused element is.
  rowOf(target, rows = this.list()) { return rows.find(row => row.el === target) ?? null; }
  // The row is the Tab stop; unless held, it is also the place kept.
  visit(row, held = false) {
    if (this.current && this.current !== row.el) this.current.tabIndex = -1;
    row.el.tabIndex = 0; this.current = row.el;
    if (!held) this.currentKey = row.key;
  }
  // Every row's tree words, and the one Tab stop: the row drawn for the place
  // kept, or while it is not drawn (a pane emptied between two runs), the
  // page's own row (aria-current) or else the first, holding the place for
  // when its row is drawn again.
  refresh() {
    const rows = this.list(), sets = new Map();
    for (const row of rows) { if (!sets.has(row.set)) sets.set(row.set, []); sets.get(row.set).push(row); }
    for (const row of rows) {
      const set = sets.get(row.set), el = row.el;
      el.setAttribute('role', 'treeitem');
      el.setAttribute('aria-level', String(row.level));
      el.setAttribute('aria-setsize', String(set.length));
      el.setAttribute('aria-posinset', String(set.indexOf(row) + 1));
      // A row that does not open keeps what its own control says of itself (a pencil's title line, say).
      if (row.expanded !== undefined) el.setAttribute('aria-expanded', String(row.expanded));
      if (el !== this.current) el.tabIndex = -1;
    }
    // A control still on show that is no row now (a folded outcome's pencil) no longer says it is one.
    const now = new Set(rows.map(row => row.el));
    for (const el of this.marked) if (!now.has(el) && shown(el)) for (const name of ['role', 'aria-level', 'aria-setsize', 'aria-posinset']) el.removeAttribute(name);
    this.marked = now;
    const focused = this.doc.activeElement, before = this.current;
    const reading = rows.find(row => row.el.getAttribute('aria-current') === 'page');
    const kept = rows.find(row => row.key === this.currentKey);
    const replacement = !kept && this.fallback?.(this.currentKey, this.previousRows ?? [], rows);
    this.previousRows = rows;
    const place = (!this.chosen && reading) || kept || replacement || rows.find(row => row.el === this.current) || reading || rows.find(row => !row.aside) || rows[0] || null;
    if (!place) return;
    this.visit(place, this.chosen && !kept && !replacement);
    // The focus was on the row that went, or on the one standing in for it: it
    // goes to the row in its place, wearing the ring the row that went wore. A
    // browser rings no focus a script gives after a press unless asked to (the
    // outline's row pressed); a press that rang nothing (an Unstar in the right
    // rail) leaves the browser's own way, which rings nothing then.
    if (place.el !== before && this.wanted && (!focused || focused === this.doc.body || focused === before || !focused.isConnected || !shown(focused) || focused.closest('[inert]'))) {
      this.placing = true;
      try {
        place.el.focus(this.ringed ? { preventScroll: true, focusVisible: true } : { preventScroll: true });
        if (replacement && this.doc.activeElement === place.el) revealSelection(place.el);
      } finally { this.placing = false; }
    }
  }
  // Puts the keys on the pane: on the first row prefer(row) chooses, when
  // given and one does, else on the row it was last on.
  focus(prefer = null) {
    this.refresh();
    const rows = this.list(), row = (prefer && rows.find(prefer)) ?? rows.find(each => each.el === this.current) ?? rows.find(each => !each.aside) ?? rows[0];
    if (!row) return false;
    this.visit(row); row.el.focus({ preventScroll: true }); revealSelection(row.el);
    return true;
  }
  // A press on a row: the main button, no modifier, made by the pointer or a
  // finger (a click the keys made, Return on a link, is theirs already), and
  // on the row itself, not on a control inside it, which keeps its own way.
  pressed(event) {
    if (event.button !== 0 || event.detail === 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const row = this.rowOf(event.target.closest?.(CONTROLS));
    if (row) this.ring(row.el);
  }
  // The focus on a row, wearing the keys' ring. A browser rings no focus a
  // press gave (Chrome's, on its mousedown), nor one a script gives while a
  // press was the person's last act, unless asked to, and not then for an
  // element that already has the focus.
  ring(el) {
    if (this.doc.activeElement === el) el.blur();
    el.focus({ preventScroll: true, focusVisible: true });
  }
  // A move begun elsewhere (back, forward, a link in the page, the right
  // rail): the row chosen is no longer the person's last choice (show).
  away() { this.standing = false; }
  // The pane comes into view (the phone's drawer opening): the focus on the
  // row the person chose there (the keys or a press), ringed, while that is
  // still their last choice; else on the row of the place being read with no
  // ring, as a fresh page has it, which is no choice and becomes the pane's
  // place. Answers whether a row took the focus.
  show() {
    this.refresh();
    const rows = this.list(), chosen = this.chosen && this.standing && rows.find(each => each.el === this.current);
    if (chosen) { this.ring(chosen.el); return true; }
    const row = rows.find(each => each.el.getAttribute('aria-current') === 'page') ?? rows.find(each => each.el === this.current);
    if (!row) return false;
    this.visit(row);
    this.placing = true;
    try { row.el.focus({ preventScroll: true }); } finally { this.placing = false; }
    return true;
  }
  go(row) { if (!row) return; this.visit(row); row.el.focus({ preventScroll: true }); revealSelection(row.el); }
  say(words) { this.status.textContent = ''; this.status.textContent = words; }
  key(event) {
    const action = keyAction(event);
    // ⇧⌘↑ ⇧⌘↓ join reply stacks, and x folds a message (stack-feed.mjs); they mean nothing in a tree.
    if (!action || action.startsWith('join-') || action === 'fold-message') return;
    const rows = this.list(), row = this.rowOf(event.target, rows);
    if (!row) return this.ownKey(event, action, rows);
    // A control set in a row that is not folded is the row's own, as a card's
    // speech bubble is (docs/decks.md): → gives it the focus before the rows
    // under it, and from it → goes on to them and ← comes back to the row.
    if (action === 'right' && row.expanded !== false && setIn(row.el)) { event.preventDefault(); setIn(row.el).focus({ preventScroll: true }); return; }
    const at = rows.indexOf(row);
    // Past the first row or the last, on to what lies that way in its column;
    // while that is out of sight, the column scrolls toward it (arrow-reach.mjs).
    // A row only → reaches (byRight: an outline pencil) is passed over by ↑ and ↓.
    const step = by => { let i = at + by; while (rows[i]?.byRight) i += by; return rows[i] ?? null; };
    const next = action === 'up' ? step(-1) : action === 'down' ? step(1) : null;
    const beyond = (action === 'up' || action === 'down') && !next;
    if (beyond) { if (reach(row.el, action, { within: this.column, doc: this.doc })) event.preventDefault(); return; }
    if (next || action === 'first' || action === 'last') { event.preventDefault(); return this.go(next ?? (action === 'first' ? rows[0] : rows.at(-1))); }
    if (this.act(action, row, rows) !== false) event.preventDefault();
  }
  // ← and → on a control set in a row; ↑ and ↓ there are the page's (arrow-reach.mjs).
  ownKey(event, action, rows) {
    const holder = rows.find(each => each.el !== event.target && each.el.contains(event.target));
    if (!holder || (action !== 'left' && action !== 'right')) return;
    const under = rows[rows.indexOf(holder) + 1], to = action === 'left' ? holder : under?.parent === holder.el ? under : null;
    if (!to) return;
    event.preventDefault(); this.go(to);
  }
  // The tree's own steps for → and ←: open a folded row or go to its first
  // row; fold an open row or go to the row it is under. Answers whether a step was taken.
  stepIn(row, rows, open) {
    if (row.expanded === false) { open(row); return true; }
    if (row.expanded === true) { const first = rows[rows.indexOf(row) + 1]; if (first?.parent === row.el) { this.go(first); return true; } }
    return false;
  }
  stepOut(row, rows, fold) {
    if (row.expanded === true) { fold(row); return true; }
    const parent = rows.find(each => each.el === row.parent);
    if (parent) { this.go(parent); return true; }
    return false;
  }
}
