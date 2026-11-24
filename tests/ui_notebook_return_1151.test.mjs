import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDisclosure } from '../web/card-disclosure.mjs';
import { DeckPage } from '../web/deck-page.mjs';
import { writingPort, painted867, card } from './fixtures/card_menu_867.mjs';

// Real Notebook key/open/writer, Deck renderer and disclosure callback owners.
// DOM focus and observer frames are explicit ports, not native input or timing.
async function fixture(t) {
  const f = await writingPort(t, card('First', 'Kept words', null) + card('Last', 'Neighbor', null));
  const { p } = f, { doc } = p, frames = new Map();
  let serial = 0;
  const make = doc.createElement;
  doc.createElement = tag => {
    const node = make(tag);
    const query = node.querySelectorAll.bind(node);
    node.querySelectorAll = selector => selector === ':scope > .deck-images > .deck-image'
      ? query(':scope > .deck-images').flatMap(images => images.querySelectorAll(':scope > .deck-image'))
      : query(selector);
    node.getClientRects = () => node.isConnected ? [{}] : [];
    node.clientWidth = 200; node.clientHeight = 40; node.scrollHeight = 120;
    return node;
  };
  doc.defaultView = new EventTarget();
  Object.assign(doc.defaultView, { innerWidth: 1000, innerHeight: 800,
    requestAnimationFrame(callback) { frames.set(++serial, callback); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); } });
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = new Set(); }
    observe(node) { this.targets.add(node); }
    disconnect() { this.targets.clear(); }
  }
  painted867(t, p); p.mode = 'cards';
  p.show = focus => DeckPage.prototype.show.call(p, focus);
  p.disclosure = new CardDisclosure({ doc, signal: p.listening.signal,
    ResizeObserver: Observer, IntersectionObserver: null });
  const flush = () => { const queued = [...frames.values()]; frames.clear(); for (const callback of queued) callback(); };
  const press = (key, extra = {}) => {
    const event = { key, target: doc.activeElement, preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; }, ...extra };
    p.key(event); return event;
  };
  t.after(() => { p.stopCaret?.(); p.editing?.history?.close(); p.cardImages?.close(); p.disclosure.close(); });
  p.paint(); flush();
  const row = index => p.list.querySelector(`.deck-card[data-index="${index}"]`);
  return { ...f, frames, flush, press, row };
}

test('1151 Return keeps the new Notebook editor focused after disclosure measurements', async t => {
  const { p, w, calls, frames, flush, press, row } = await fixture(t), before = w.value.body;
  p.picked = 1; row(1).focus();
  assert.equal(press('Enter').defaultPrevented, true);
  const editor = p.editing.field;
  assert.equal(p.editing.fresh, true); assert.equal(editor.value, '');
  assert.equal(p.doc.activeElement, editor, 'opening initially focuses the new editor');
  assert.ok(frames.size > 0, 'the real disclosure owner has a deferred measurement');
  flush();
  assert.equal(p.doc.activeElement === editor, true, 'the new editor retains focus after disclosure measurement');
  assert.deepEqual([editor.selectionStart, editor.selectionEnd], [0, 0]);
  assert.equal(w.value.body, before); assert.equal(calls.length, 0, 'an empty opening writes no Core revision');
  const enter = press('Enter');
  assert.notEqual(enter.defaultPrevented, true, 'Return inside the editor retains its text action');
  assert.equal(p.editing.field, editor);
  const down = press('ArrowDown');
  assert.equal(down.stopped, true, 'the empty editor owns its otherwise unused caret arrow');
  assert.equal(p.doc.activeElement, editor);
});

test('1151 Command Return editing retains the same field and selection through disclosure measurement', async t => {
  const { p, w, calls, flush, press, row } = await fixture(t), before = w.value.body;
  row(0).focus(); press('Enter', { metaKey: true });
  const editor = p.editing.field;
  assert.equal(p.editing.fresh, false); assert.equal(editor.value, 'First\nKept words');
  editor.setSelectionRange(2, 5); flush();
  assert.equal(p.doc.activeElement, editor); assert.deepEqual([editor.selectionStart, editor.selectionEnd], [2, 5]);
  p.paint(); flush();
  assert.equal(p.editing.field, editor); assert.equal(p.doc.activeElement, editor);
  assert.deepEqual([editor.selectionStart, editor.selectionEnd], [2, 5]);
  assert.equal(w.value.body, before); assert.equal(calls.length, 0);
});

test('1151 a Display repaint still restores its disclosure control when no editor opens', async t => {
  const { p, flush } = await fixture(t);
  const old = p.disclosure.entries[0]; assert.equal(old.button.hidden, false);
  old.button.focus(); p.paint();
  const next = p.disclosure.entries[0]; assert.notEqual(next.button, old.button);
  flush();
  assert.equal(p.editing, undefined); assert.equal(p.doc.activeElement, next.button);
  assert.equal(next.button.hidden, false);
});
