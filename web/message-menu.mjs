// A message's ⋯ menu (docs/links.md, "A message's menu"): a small list of
// what can be done to one message, opened from its ⋯ button or by a right-click
// on it. Each item is one tap or click and closes the menu. Up and Down move
// between the items, Escape closes it and gives the focus back to what opened
// it, and a press outside it or a scroll that moves what opened it closes it.
// One is open at a time.
let open = null;

const element = (doc, tag, props = {}) => Object.assign(doc.createElement(tag), props);

// anchor: the ⋯ button, or the card a right-click landed on; at: where the
// pointer was for a right-click, else the menu sits under the anchor. items:
// [{ label, act }] in order; act may answer a promise.
export function openMessageMenu({ anchor, at = null, items, label = 'Message', doc = globalThis.document, win = globalThis }) {
  if (open?.anchor === anchor && !at) { open.close(true); return null; }
  open?.close(false);
  if (!items.length) return null;
  const root = element(doc, 'div', { className: 'message-menu-list' });
  root.setAttribute('role', 'menu'); root.setAttribute('aria-label', label);
  const buttons = items.map(item => {
    const button = element(doc, 'button', { type: 'button', textContent: item.label });
    button.setAttribute('role', 'menuitem');
    button.onclick = event => { event.stopPropagation(); menu.close(true); item.act(); };
    return button;
  });
  root.append(...buttons);
  const keys = event => {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); menu.close(true); return; }
    const step = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const now = buttons.indexOf(doc.activeElement);
    const next = step === -Infinity ? 0 : step === Infinity ? buttons.length - 1 : ((now < 0 ? 0 : now) + step + buttons.length) % buttons.length;
    buttons[next].focus({ preventScroll: true });
  };
  const outside = event => { if (!root.contains(event.target) && !(at === null && anchor.contains(event.target))) menu.close(false); };
  const scrolled = event => {
    if (root.contains(event.target)) return;
    const now = anchor.isConnected === false ? null : anchor.getBoundingClientRect();
    if (now && Math.abs(now.top - box.top) < 1 && Math.abs(now.left - box.left) < 1) return;
    menu.close(root.contains(doc.activeElement));
  };
  root.addEventListener('keydown', keys);
  root.addEventListener('click', event => event.stopPropagation());
  doc.addEventListener('pointerdown', outside, true);
  doc.addEventListener('scroll', scrolled, true);
  const menu = { anchor, root, close(restore) {
    doc.removeEventListener('pointerdown', outside, true);
    doc.removeEventListener('scroll', scrolled, true);
    root.remove(); anchor.setAttribute?.('aria-expanded', 'false');
    if (open === menu) open = null;
    if (restore && anchor.isConnected !== false) anchor.focus({ preventScroll: true });
  } };
  open = menu;
  anchor.setAttribute?.('aria-expanded', 'true');
  // Inside the Reader's dialog it belongs to the dialog's layer; elsewhere, to the page.
  (anchor.closest?.('dialog[open]') ?? doc.body).append(root);
  const box = anchor.getBoundingClientRect(), width = root.offsetWidth || 0, height = root.offsetHeight || 0;
  const W = win.innerWidth ?? Infinity, H = win.innerHeight ?? Infinity;
  // At the pointer for a right-click; else under the ⋯, its right edge on the ⋯'s, or above it with no room below.
  const x = at ? at.x : box.right - width, below = at ? at.y : box.bottom + 4, above = (at ? at.y : box.top - 4) - height;
  const top = below + height + 8 <= H || above < 8 ? below : above;
  Object.assign(root.style, { position: 'fixed', top: `${Math.round(Math.max(8, top))}px`, left: `${Math.round(Math.max(8, Math.min(x, W - width - 8)))}px` });
  buttons[0].focus({ preventScroll: true });
  return menu;
}

// Says on the ⋯ button what was just done ("Link copied") until the next press
// or key anywhere, when it shows ⋯ again. A press changes it back once it has
// landed (its click), not as it starts: the words are wider than ⋯, so a
// press on the button itself would otherwise end beside it and open nothing.
export function sayOn(button, words, doc = globalThis.document) {
  const before = button.dataset.said ?? button.textContent;
  button.dataset.said = before; button.textContent = words; button.classList.add('said');
  const back = () => {
    doc.removeEventListener('click', back, true); doc.removeEventListener('keydown', back, true);
    if (button.textContent === words) { button.textContent = before; button.classList.remove('said'); }
    delete button.dataset.said;
  };
  doc.addEventListener('click', back, true); doc.addEventListener('keydown', back, true);
}

// Puts text on the clipboard. Settles true when it is there.
export async function copyText(text, nav = globalThis.navigator) {
  try { await nav.clipboard.writeText(text); return true; } catch { return false; }
}
