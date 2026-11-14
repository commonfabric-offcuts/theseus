// Reading controls have no DOM text: native selection, Reader quotations and
// Notebook click-to-edit mapping must see only the author's words.
const documents = new WeakMap();

function stateOf(doc) {
  let state = documents.get(doc);
  if (state) return state;
  state = { held: null, paints: new Map(), serial: 0, release: 0 };
  documents.set(doc, state);
  const flush = () => {
    state.held = null;
    const paints = [...state.paints]; state.paints.clear();
    for (const [host, paint] of paints) if (host.isConnected) paint();
  };
  const release = afterClick => {
    if (!state.held) return;
    const revision = ++state.release;
    if (!afterClick) { flush(); return; }
    // pointerup/keyup's native click runs before the next message task.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close(); channel.port2.close();
      if (state.release === revision) flush();
    };
    channel.port2.postMessage(null);
  };
  doc.addEventListener?.('pointerdown', event => {
    const button = event.target.closest?.('.fence-copy');
    if (button && event.isPrimary && event.button === 0) {
      ++state.release; state.held = { button, pointer: event.pointerId };
    }
  }, true);
  doc.addEventListener?.('pointerup', event => {
    if (state.held?.pointer === event.pointerId) release(true);
  }, true);
  doc.addEventListener?.('pointercancel', event => {
    if (state.held?.pointer === event.pointerId) release(false);
  }, true);
  doc.addEventListener?.('keydown', event => {
    const button = event.target.closest?.('.fence-copy');
    if (button && event.key === ' ' && !event.repeat) {
      ++state.release; state.held = { button, space: true };
    }
  }, true);
  doc.addEventListener?.('keyup', event => { if (state.held?.space && event.key === ' ') release(true); }, true);
  doc.addEventListener?.('focusout', event => { if (state.held?.space && event.target === state.held.button) release(false); }, true);
  doc.addEventListener?.('contextmenu', () => release(false), true);
  doc.defaultView?.addEventListener('blur', () => release(false));
  return state;
}

// Destructive redraws wait only when they would remove a pressed Copy control.
// Latest paint per host wins. This never defers the clipboard call itself.
export function deferFencePaint(host, paint) {
  const state = documents.get(host.ownerDocument);
  if (!state?.held || !host.contains?.(state.held.button)) return false;
  state.paints.set(host, paint);
  return true;
}

export function fenceCopyButton(doc, text) {
  const state = stateOf(doc), button = doc.createElement('button');
  button.type = 'button'; button.className = 'fence-copy';
  button.dataset.label = 'Copy';
  button.setAttribute('aria-label', 'Copy fenced text');
  button.title = 'Copy fenced text';
  let attempt = 0;
  button.addEventListener('pointerdown', event => event.stopPropagation());
  // Keep native text selection and a phone's writing focus. Cancelling
  // pointerdown instead would suppress WebKit's tap-generated click.
  button.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('keydown', event => {
    if (event.key === 'Tab') return;
    event.stopPropagation();
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
  });
  button.addEventListener('keyup', event => { if (event.key !== 'Tab') event.stopPropagation(); });
  button.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    if (button.isContentEditable) return;
    const current = ++attempt, serial = ++state.serial;
    // No awaited permission query, fetch or timer before this native gesture's
    // write. Rejected/missing APIs are ordinary failures, never false success.
    let writing;
    try { writing = doc.defaultView.navigator.clipboard.writeText(text); }
    catch { writing = Promise.reject(); }
    button.dataset.label = 'Copying…';
    const finish = copied => {
      if (attempt !== current || !button.isConnected) return;
      const words = copied ? 'Copied fenced text.' : 'Could not copy. Select the text and use Copy.';
      button.dataset.label = copied ? 'Copied' : 'Copy failed';
      button.title = words; button.setAttribute('aria-label', words + ' Press to copy again.');
      if (state.serial !== serial) return;
      const root = button.closest('dialog') ?? doc.body;
      let notice = root.querySelector(':scope > .fence-copy-announcement');
      if (!notice) {
        notice = doc.createElement('span'); notice.className = 'sr-only fence-copy-announcement';
        notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
        root.append(notice);
      }
      notice.textContent = words;
    };
    Promise.resolve(writing).then(() => finish(true), () => finish(false));
  });
  return button;
}
