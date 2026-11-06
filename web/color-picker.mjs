// The small picker that changes an agent's color for the reader: the
// palette's colors as swatches and the agent's own color, opened from the
// agent's name (docs/reading-colors.md, "Choosing an agent's color"). It is a
// non-modal popover: every swatch is a button reached by Tab or the arrow
// keys, Escape closes it and gives the focus back to the name, and a press
// outside it or a scroll of the page under it closes it. One is open at a time.
let open = null;

const element = (doc, tag, props = {}) => Object.assign(doc.createElement(tag), props);

// anchor: the name that opened it; back: what takes the focus when it closes
// by Escape or a choice (the anchor, or the card a name sits in). choose(color)
// sends the choice (a palette name, or null for the agent's own) and answers
// the receipt; the picker closes when it is committed and says why when not.
export function openColorPicker({ anchor, back = anchor, agent, palette, chosen, own, choose, doc = globalThis.document, win = globalThis }) {
  if (open?.anchor === anchor) { open.close(true); return null; }
  open?.close(false);
  const root = element(doc, 'div', { className: 'color-picker' });
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', `Color for ${agent}`);
  const title = element(doc, 'p', { className: 'color-picker-title', textContent: `Color for ${agent}` });
  const swatches = element(doc, 'div', { className: 'color-picker-swatches' });
  swatches.setAttribute('role', 'group'); swatches.setAttribute('aria-label', 'Colors');
  const notice = element(doc, 'p', { className: 'notice', hidden: true });
  notice.setAttribute('role', 'status');
  const buttons = [];
  const press = (button, color) => {
    button.onclick = async () => {
      if (picker.busy) return;
      picker.busy = true; notice.hidden = true;
      let receipt;
      try { receipt = await choose(color); } catch (error) { receipt = { error: { message: 'Connection interrupted; whether the color was saved is unknown. Press again to send the same request.' } }; }
      picker.busy = false;
      if (receipt?.status === 'committed') { picker.close(true); return; }
      Object.assign(notice, { textContent: receipt?.error?.message ?? 'The color was not confirmed. Press again to send the same request.', hidden: false });
    };
    buttons.push(button);
  };
  for (const name of palette) {
    const swatch = element(doc, 'button', { type: 'button', className: `swatch agent-${name}`, title: name });
    swatch.setAttribute('aria-label', name); swatch.setAttribute('aria-pressed', String(chosen === name));
    swatch.append(element(doc, 'span', { className: 'swatch-tag' }));
    press(swatch, name); swatches.append(swatch);
  }
  const reset = element(doc, 'button', { type: 'button', className: `swatch-default agent-${own}`, textContent: `Default (${own})` });
  reset.setAttribute('aria-pressed', String(chosen === null));
  press(reset, null);
  root.append(title, swatches, reset, notice);

  const keys = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation?.(); picker.close(true); return; }
    const at = buttons.indexOf(doc.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -Infinity, End: Infinity }[event.key];
    const tab = event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : 0;
    if (step === undefined && !tab) return;
    // The picker keeps the focus while it is open: Tab and the arrows go round it.
    if (tab && at !== (tab > 0 ? buttons.length - 1 : 0) && at >= 0) return;
    event.preventDefault();
    const move = step ?? tab, next = move === -Infinity ? 0 : move === Infinity ? buttons.length - 1
      : ((at < 0 ? 0 : at) + move + buttons.length) % buttons.length;
    buttons[next].focus({ preventScroll: true });
  };
  const outside = event => { if (!root.contains(event.target) && !anchor.contains(event.target)) picker.close(false); };
  // It is placed once, fixed to the window: when anything but the picker
  // scrolls, its name moves away, so it closes, giving the focus back if it held it.
  const scrolled = event => { if (!root.contains(event.target)) picker.close(root.contains(doc.activeElement)); };
  root.addEventListener('keydown', keys);
  doc.addEventListener('pointerdown', outside, true);
  doc.addEventListener('scroll', scrolled, true);
  const picker = { anchor, root, busy: false, close(restore) {
    doc.removeEventListener('pointerdown', outside, true);
    doc.removeEventListener('scroll', scrolled, true);
    root.remove();
    if (open === picker) open = null;
    if (restore && back.isConnected !== false) back.focus();
  } };
  open = picker;
  // Inside the Reader's dialog it belongs to the dialog's layer; elsewhere, to the page.
  (anchor.closest?.('dialog[open]') ?? doc.body).append(root);
  // Just below the name, or above it when the window has no room below.
  const box = anchor.getBoundingClientRect(), width = root.offsetWidth || 0, height = root.offsetHeight || 0;
  const below = box.bottom + 4, above = box.top - 4 - height;
  const top = below + height + 8 <= (win.innerHeight ?? Infinity) || above < 8 ? below : above;
  Object.assign(root.style, { position: 'fixed', top: `${Math.round(top)}px`,
    left: `${Math.max(8, Math.min(Math.round(box.left), (win.innerWidth ?? 0) - width - 8))}px` });
  // Focusing it must not scroll the page, or it would close itself.
  (buttons.find(button => button.getAttribute('aria-pressed') === 'true') ?? buttons[0]).focus({ preventScroll: true });
  return picker;
}
