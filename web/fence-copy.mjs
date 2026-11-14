// Reading controls have no DOM text: native selection, Reader quotations and
// Notebook click-to-edit mapping must see only the author's words.
import { listen, shell } from './in-place-navigation.mjs';
import { typingField } from './writing-input.mjs';

const documents = new WeakMap();
const COPY = 'M8 8h12v12H8z M16 8V4H4v12h4';
const DONE = 'M5 12l4 4L19 6';
const FAILED = 'M12 4v10 M12 18v2';

function stateOf(doc) {
  let state = documents.get(doc);
  if (state) return state;
  state = { held: null, paints: new Map(), serial: 0, release: 0 };
  documents.set(doc, state);
  const clearNotice = () => {
    if (!state.notice) return;
    state.notice.classList.add('sr-only');
    state.notice.textContent = '';
    state.notice = null;
  };
  const flush = () => {
    state.held = null;
    const paints = [...state.paints]; state.paints.clear();
    for (const [host, paint] of paints) if (host.isConnected) paint();
  };
  const add = (target, name, fn, options) => { if (target instanceof EventTarget) listen(target, name, fn, options); };
  shell.follow({ begin() { ++state.release; state.held = null; state.paints.clear(); ++state.serial; clearNotice(); } });
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
  add(doc, 'pointerdown', event => {
    const button = event.target.closest?.('.fence-copy');
    if (!button) clearNotice();
    if (button && event.isPrimary && event.button === 0) {
      ++state.release; state.held = { button, pointer: event.pointerId };
    }
  }, true);
  add(doc, 'pointerup', event => {
    if (state.held?.pointer === event.pointerId) release(true);
  }, true);
  add(doc, 'pointercancel', event => {
    if (state.held?.pointer === event.pointerId) release(false);
  }, true);
  add(doc, 'keydown', event => {
    const button = event.target.closest?.('.fence-copy');
    if (button && event.key === ' ' && !event.repeat) {
      ++state.release; state.held = { button, space: true };
    }
  }, true);
  add(doc, 'keyup', event => { if (state.held?.space && event.key === ' ') release(true); }, true);
  add(doc, 'focusout', event => { if (state.held?.space && event.target === state.held.button) release(false); }, true);
  add(doc, 'input', event => { if (state.notice && typingField(event.target)) clearNotice(); }, true);
  add(doc, 'contextmenu', () => release(false), true);
  add(doc.defaultView, 'blur', () => release(false));
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
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', COPY); svg.append(path); button.append(svg);
  let attempt = 0;
  button.addEventListener('pointerdown', event => event.stopPropagation());
  // Keep native text selection and a phone's writing focus. Cancelling
  // pointerdown instead would suppress WebKit's tap-generated click.
  button.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
    event.stopPropagation();
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
  });
  button.addEventListener('keyup', event => { if (['Enter', ' '].includes(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) event.stopPropagation(); });
  button.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation();
    if (button.isContentEditable) return;
    const current = ++attempt, serial = ++state.serial;
    // No awaited permission query, fetch or timer before this native gesture's
    // write. Rejected/missing APIs are ordinary failures, never false success.
    let writing;
    try { writing = doc.defaultView.navigator.clipboard.writeText(text); }
    catch { writing = Promise.reject(); }
    button.dataset.label = 'Copying…'; path.setAttribute('d', COPY);
    button.title = 'Copying fenced text…';
    button.setAttribute('aria-label', button.title);
    const root = button.closest('dialog') ?? doc.body;
    let notice = root.querySelector(':scope > .fence-copy-announcement');
    if (!notice) {
      notice = doc.createElement('span'); notice.className = 'sr-only fence-copy-announcement';
      notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
      root.append(notice);
    }
    if (state.notice && state.notice !== notice) {
      state.notice.classList.add('sr-only');
      state.notice.textContent = '';
    }
    state.notice = notice;
    notice.classList.add('sr-only');
    notice.textContent = '';
    // The status is mounted empty before a result arrives; a fresh result is
    // announced even when the previous press also succeeded.

    const finish = copied => {
      if (attempt !== current || !button.isConnected) return;
      const words = copied ? 'Copied fenced text.' : 'Could not copy. Select the text and use Copy.';
      button.dataset.label = copied ? 'Copied' : 'Copy failed';
      path.setAttribute('d', copied ? DONE : FAILED);
      button.title = words; button.setAttribute('aria-label', words + ' Press to copy again.');
      if (state.serial !== serial || state.notice !== notice) return;
      notice.classList.toggle('sr-only', copied);
      notice.textContent = words;
    };
    Promise.resolve(writing).then(() => finish(true), () => finish(false));
  });
  return button;
}
