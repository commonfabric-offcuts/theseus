// A repaint that leaves in place every node it would draw again (docs/targets.md, "Checks").
//
// The outcome page's panels read again after every commit anywhere. Replacing their nodes each time would lose a
// press held across a commit: a click needs its down and its up on the same node. So a panel builds its nodes
// afresh and repaint() carries what differs onto the nodes already shown: attributes, text and handlers. A node
// is the same one again when its tag, its data-key (or data-fold) and, without a key, its class match; anything
// else is replaced. What the reader typed in a box, a box's caret and the focus stay where they are, since their
// nodes do. A handler is set with on(), so the shown node takes the newest one.
const HANDLERS = new WeakMap();

// node[name] = fn, remembered so that a repaint moves it onto the node already shown.
export function on(node, name, fn) {
  node[name] = fn;
  if (!HANDLERS.has(node)) HANDLERS.set(node, new Set());
  HANDLERS.get(node).add(name);
}

const keyOf = node => (node.nodeType === 1 ? node.getAttribute('data-key') ?? node.getAttribute('data-fold') : null);
const alike = (shown, fresh) => shown.nodeType === fresh.nodeType && (shown.nodeType !== 1 || (shown.tagName === fresh.tagName
  && shown.namespaceURI === fresh.namespaceURI && keyOf(shown) === keyOf(fresh) && (keyOf(fresh) !== null || shown.getAttribute('class') === fresh.getAttribute('class'))));

function carry(shown, fresh) {
  if (shown.nodeType !== 1) { if (shown.data !== fresh.data) shown.data = fresh.data; return; }
  // A fold no panel names (no data-fold), such as a chart's numbers, is the reader's to open and close.
  const kept = name => name === 'open' && shown.tagName === 'DETAILS' && keyOf(shown) === null;
  for (const name of shown.getAttributeNames()) if (!fresh.hasAttribute(name) && !kept(name)) shown.removeAttribute(name);
  for (const name of fresh.getAttributeNames()) if (shown.getAttribute(name) !== fresh.getAttribute(name) && !kept(name)) shown.setAttribute(name, fresh.getAttribute(name));
  const had = HANDLERS.get(shown) ?? new Set(), has = HANDLERS.get(fresh) ?? new Set();
  for (const name of had) if (!has.has(name)) shown[name] = null;
  for (const name of has) shown[name] = fresh[name];
  HANDLERS.set(shown, has);
  place(shown, [...fresh.childNodes]);
}

// The children of parent become kids, keeping each shown child that is the same node again: a keyed child is
// found by its key wherever it was, an unkeyed one in order among the unkeyed, past any that were taken out.
function place(parent, kids) {
  const shown = [...parent.childNodes], keyed = new Map(), used = new Set();
  for (const node of shown) { const key = keyOf(node); if (key !== null && !keyed.has(key)) keyed.set(key, node); }
  let next = 0;
  kids.forEach((kid, index) => {
    const key = keyOf(kid);
    let match = null;
    if (key !== null) match = keyed.get(key) ?? null;
    else {
      // The first unkeyed shown node from here on that is alike; those it passes were taken out.
      for (let at = next; at < shown.length; at += 1) {
        if (!used.has(shown[at]) && keyOf(shown[at]) === null && alike(shown[at], kid)) { match = shown[at]; next = at + 1; break; }
      }
    }
    if (match && (used.has(match) || !alike(match, kid))) match = null;
    if (match) { used.add(match); carry(match, kid); }
    const node = match ?? kid, at = parent.childNodes[index] ?? null;
    if (at !== node) parent.insertBefore(node, at);
  });
  while (parent.childNodes.length > kids.length) parent.lastChild.remove();
}

// What the focus is on, found again by its data-key, or a fold's summary by its data-fold.
function focusSelector(node) {
  if (node.dataset?.key) return `[data-key="${CSS.escape(node.dataset.key)}"]`;
  if (node.tagName === 'SUMMARY' && node.parentElement?.dataset.fold) return `[data-fold="${CSS.escape(node.parentElement.dataset.fold)}"] > summary`;
  return null;
}

// host shows nodes. A focused control that had to be replaced, or moved, gets the focus back by its key, with the
// caret where it was in a box.
export function repaint(host, ...nodes) {
  const active = document.activeElement;
  const selector = active && active !== host && host.contains(active) ? focusSelector(active) : null;
  const caret = selector && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  place(host, nodes.flat().filter(node => node !== null && node !== undefined && node !== false));
  if (!selector || document.activeElement === active) return;
  const again = host.querySelector(selector);
  if (!again) return;
  again.focus({ preventScroll: true });
  if (caret && typeof again.setSelectionRange === 'function') again.setSelectionRange(...caret);
}
