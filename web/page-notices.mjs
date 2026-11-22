// A dismissal belongs to this page's notice node, including later paints of it.
// The shell replaces page nodes on navigation; moving the same host keeps it.
const notices = new WeakMap();

export function finishPageNotice(notice, onClose) {
  if (notice?.parentElement?.id !== 'page-notices') return;
  let state = notices.get(notice);
  if (!state) { state = { closed: false }; notices.set(notice, state); }
  if (onClose) state.onClose = onClose;
  if (state.closed) { notice.hidden = true; return; }
  if (notice.hidden) return;
  if (!state.button) {
    const doc = notice.ownerDocument, button = doc.createElement('button');
    button.type = 'button'; button.className = 'page-notice-close';
    button.textContent = '×'; button.title = 'Close notice';
    button.setAttribute('aria-label', 'Close notice');
    button.onclick = () => {
      const focused = doc.activeElement === button;
      state.closed = true; notice.hidden = true; state.onClose?.();
      if (focused) doc.getElementById('main')?.focus({ preventScroll: true });
    };
    state.button = button;
  }
  if (!Array.from(notice.children).includes(state.button)) notice.append(state.button);
}
