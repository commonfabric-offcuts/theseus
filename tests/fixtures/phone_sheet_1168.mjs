import { ComposeBar } from '../../web/compose-bar.mjs';
import { miniDocument } from './mini_dom.mjs';
import { viewport991 } from './reply_viewport_991.mjs';

// DOM/measurement ports around the actual ComposeBar constructor and fit.
// Numbers describe this fixture; they are not native layout or timing proof.
export async function field1168(run) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const doc = miniDocument(), make = doc.createElement, writes = [], media = new Set();
  const state = { width: 160, cap: 80, tallCap: 200, fit: 'auto', held: 0, restored: 0 };
  let field;
  doc.createElement = tag => {
    const node = make(tag); node.ownerDocument = doc;
    Object.defineProperties(node, {
      parentNode: { get: () => node.parent },
      parentElement: { get: () => node.parent },
      scrollHeight: { get: () => 8 + 20 * Math.max(1, Math.ceil((node.value ?? '').length /
        Math.max(1, Math.floor((parseFloat(node.style.width) || state.width) / 8)))) },
    });
    node.style = new Proxy({}, { set(target, key, value) {
      if (node === field && key === 'height') writes.push(value);
      target[key] = value; return true;
    } });
    node.getBoundingClientRect = () => ({ width: state.width, top: 10, bottom: 90, height: 80 });
    node.getClientRects = () => [node.getBoundingClientRect()];
    node.hasAttribute = key => node.getAttribute(key) !== null;
    node.toggleAttribute = (key, on) => {
      const next = on ?? !node.hasAttribute(key);
      if (next) node.setAttribute(key, ''); else node.removeAttribute(key);
      return next;
    };
    return node;
  };
  const root = doc.createElement('div'), box = doc.createElement('div');
  root.className = 'composer'; box.className = 'field-box'; root.append(box);
  field = doc.createElement('textarea'); field.className = 'reply-field';
  field.id = 'active-writing'; field.value = 'Long writing '.repeat(8);
  field.placeholder = 'Write here'; field.scrollTop = 7;
  field.selectionStart = 3; field.selectionEnd = 11;
  field.style.height = '77px'; writes.length = 0; box.append(field);
  const win = {
    matchMedia: () => ({ matches: true, addEventListener: (_, fn) => media.add(fn), removeEventListener: (_, fn) => media.delete(fn) }),
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => state.fit,
      maxHeight: String(root.hasAttribute('data-tall') ? state.tallCap : state.cap),
      borderTopWidth: '1px', borderBottomWidth: '1px' }),
  };
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true,
    value: class { observe() {} disconnect() {} } });
  let bar;
  try {
    bar = new ComposeBar({ root, field, panels: {}, openers: {}, win,
      holds: () => { state.held++; return () => state.restored++; } });
    await run({ bar, root, box, field, doc, state, writes,
      twins: () => box.children.filter(node => node !== field && node.tagName === 'TEXTAREA') });
  } finally {
    bar?.dispose();
    if (saved) Object.defineProperty(globalThis, 'ResizeObserver', saved);
    else delete globalThis.ResizeObserver;
  }
}

// Reuse the existing viewport/geometry ports without changing their assertions
// or source. Give the field an actual surface distinction before any event.
export function viewport1168(surface, run, options = {}) {
  return viewport991(options, async f => {
    const originalClosest = f.field.closest;
    const dialog = { parentElement: f.doc.body,
      matches: selector => selector === '.composer-home:not(.notebook-mode)' && surface === 'pencil' };
    f.composer.parentElement = dialog;
    f.field.closest = selector => {
      if (selector === 'dialog') return dialog;
      if ((surface === 'pencil' || surface === 'notebook') &&
          (selector.includes('#reader') || selector.includes('card-reply'))) return null;
      return originalClosest(selector);
    };
    await run(f);
  });
}
