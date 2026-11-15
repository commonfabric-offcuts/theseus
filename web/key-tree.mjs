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
// and went with the old element.
//
// A pane may choose that a press on a row (a click or a tap) selects it as the
// keys would (selectOnPress, the outline's, item 462): the row becomes the
// pane's place and holds the focus with the keys' ring, so ↑ ↓ and → go on
// from it; the row's own act then runs as it always did. While the pane
// cannot hold the focus on the row (holds(el)), the row is only its place.
import { keyAction } from './pane-keys.mjs';
import { revealSelection } from './reveal.mjs';

// What a press lands on that has an act of its own: a row is one, and so is a control inside a row.
const CONTROLS = 'a[href], button, summary, input, select, textarea, [contenteditable], [role=treeitem]';
const shown = el => el.isConnected && (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0);

export class KeyTree {
  // root: the element that is the tree. rows(): the rows on show, in order,
  // each { el, level, set, key, parent (a row's el, or null), expanded (true,
  // false, or undefined for a row that does not open) }. act(action, row,
  // rows): what the pane does for a key the tree does not answer itself. The
  // tree speaks through a polite status of its own (say).
  constructor({ root, rows, act = () => false, label = null, doc = root.ownerDocument, selectOnPress = false, holds = () => true }) {
    Object.assign(this, { root, rows, act, doc, holds });
    this.current = null; this.currentKey = null; this.wanted = false; this.queued = false; this.chosen = false; this.placing = false;
    root.setAttribute('role', 'tree');
    if (label) root.setAttribute('aria-label', label);
    this.status = doc.createElement('span');
    this.status.className = 'sr-only'; this.status.setAttribute('role', 'status');
    root.after(this.status);
    root.addEventListener('keydown', event => this.key(event));
    // Before the row's own act, so the act finds the row selected (the shell keeps the keys on it).
    if (selectOnPress) root.addEventListener('click', event => this.pressed(event), true);
    root.addEventListener('focusin', event => {
      const row = this.rowOf(event.target);
      this.wanted = true;
      // A row the person moved to; not one the tree put the focus on while the row it keeps is away.
      if (row && !this.placing) { this.chosen = true; this.visit(row); }
    });
    root.addEventListener('focusout', event => {
      // Focus that leaves for somewhere else in the page is gone from the
      // pane; focus whose row was taken out of the page, or made inert while
      // the next run draws it again (a move in place), is given back to the
      // row drawn in its place.
      const left = event.target;
      if (event.relatedTarget && !root.contains(event.relatedTarget)) this.wanted = false;
      else if (!event.relatedTarget) queueMicrotask(() => { if (left.isConnected && !left.closest('[inert]') && !root.contains(this.doc.activeElement)) this.wanted = false; });
    });
    this.watch = new (doc.defaultView.MutationObserver)(() => this.soon());
    this.watch.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'aria-current', 'disabled', 'inert'] });
    this.refresh();
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
      // A row that does not open keeps what its own control says of itself (+ New topic's line, say).
      if (row.expanded !== undefined) el.setAttribute('aria-expanded', String(row.expanded));
      if (el !== this.current) el.tabIndex = -1;
    }
    const focused = this.doc.activeElement, before = this.current;
    const reading = rows.find(row => row.el.getAttribute('aria-current') === 'page');
    const kept = rows.find(row => row.key === this.currentKey);
    const place = (!this.chosen && reading) || kept || rows.find(row => row.el === this.current) || reading || rows[0] || null;
    if (!place) return;
    this.visit(place, this.chosen && !kept);
    // The focus was on the row that went, or on the one standing in for it: it goes to the row in its place.
    if (place.el !== before && this.wanted && (!focused || focused === this.doc.body || focused === before || !focused.isConnected || !shown(focused) || focused.closest('[inert]'))) {
      this.placing = true;
      try { place.el.focus({ preventScroll: true, focusVisible: true }); } finally { this.placing = false; }
    }
  }
  // Puts the keys on the pane: on the first row prefer(row) chooses, when
  // given and one does, else on the row it was last on.
  focus(prefer = null) {
    this.refresh();
    const rows = this.list(), row = (prefer && rows.find(prefer)) ?? rows.find(each => each.el === this.current) ?? rows[0];
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
    if (!row) return;
    // Where the pane cannot keep the focus on the row (holds(el): a row in the
    // phone's drawer that closes it), the row is its place, to come back to.
    if (this.holds(row.el)) this.ring(row.el); else { this.chosen = true; this.visit(row); }
  }
  // The focus on a row, wearing the keys' ring. A browser rings no focus a
  // press gave (Chrome's, on its mousedown), nor one a script gives while a
  // press was the person's last act, unless asked to, and not then for an
  // element that already has the focus.
  ring(el) {
    if (this.doc.activeElement === el) el.blur();
    el.focus({ preventScroll: true, focusVisible: true });
  }
  // The pane comes into view (the phone's drawer opening): the focus on its
  // Tab stop, ringed once the person has chosen a row there (the keys or a
  // press), else on the row of the place being read with no ring, as a fresh
  // page has it, and that is no choice. Answers whether a row took the focus.
  show() {
    this.refresh();
    const row = this.list().find(each => each.el === this.current);
    if (!row) return false;
    if (this.chosen) { this.ring(row.el); return true; }
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
    if (!row) return;
    const at = rows.indexOf(row);
    event.preventDefault();
    if (action === 'up') return this.go(rows[at - 1]);
    if (action === 'down') return this.go(rows[at + 1]);
    if (action === 'first') return this.go(rows[0]);
    if (action === 'last') return this.go(rows.at(-1));
    this.act(action, row, rows);
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
