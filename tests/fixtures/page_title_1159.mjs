import assert from 'node:assert/strict';
import { CardDisclosure } from '../../web/card-disclosure.mjs';
import { DeckPage } from '../../web/deck-page.mjs';
import { text867 } from './card_text_867.mjs';

export const BODY = 'Opening stays.\n\n## First\n\nFirst words\n\n## Last\n\nLast words\n';

// Real NotebookPage constructor/rename/key/focus, Deck edit/start/render,
// NotebookWriting journal and transport. This memory DOM stores requested
// focus/selection; it does not prove native events, geometry or durable Core.
export async function titlePage(t, { body = BODY, mode = 'cards' } = {}) {
  const f = await text867(t, body), { p, w, calls } = f, { doc } = p;
  const oldDocument = globalThis.document;
  globalThis.document = doc;
  t.after(() => { globalThis.document = oldDocument; });
  const frames = new Map(); let serial = 0;
  doc.defaultView = new EventTarget();
  Object.assign(doc.defaultView, { innerWidth: 1000, innerHeight: 800,
    requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); } });
  const create = doc.createElement;
  doc.createElement = tag => {
    const node = create(tag), query = node.querySelectorAll.bind(node);
    node.querySelectorAll = selector => selector === ':scope > .deck-images > .deck-image'
      ? query(':scope > .deck-images').flatMap(images => images.querySelectorAll(':scope > .deck-image')) : query(selector);
    node.getClientRects = () => node.isConnected ? [{}] : [];
    node.clientWidth = 200; node.clientHeight = 40; node.scrollHeight = 120;
    node.style.removeProperty = () => {};
    return node;
  };
  class Observer {
    constructor(fn) { this.callback = fn; }
    observe() {}
    disconnect() {}
  }
  p.disclosure.close();
  p.disclosure = new CardDisclosure({ doc, signal: p.listening.signal,
    ResizeObserver: Observer, IntersectionObserver: null });
  p.holdPage = () => () => {};
  p.mark = () => {}; p.fit = () => {};
  p.imagePicker = () => ({ close() {} });
  p.paint = () => DeckPage.prototype.paint.call(p);
  p.show = focus => DeckPage.prototype.show.call(p, focus);
  p.header.description = doc.createElement('p');
  doc.body.append(p.header.title);
  p.titleBox.select = () => p.titleBox.setSelectionRange(0, p.titleBox.value.length);
  const views = [];
  p.viewPreference = { get: () => mode, set: (_id, chosen) => views.push(chosen) };
  p.mode = mode; p.drawView(); p.sync(true); p.paint();
  const flushFrames = () => {
    const work = [...frames.values()]; frames.clear(); for (const fn of work) fn();
  };
  const event = (target, extra = {}) => ({ target, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; }, ...extra });
  const activate = (kind = 'click', extra = {}) => {
    const node = p.titleControl ?? p.header.title, e = event(node, { button: 0, ...extra });
    node.listeners[kind]?.(e); return e;
  };
  const complete = async (key = 'Escape', extra = {}) => {
    const e = event(p.titleBox, { key, ...extra });
    await p.titleBox.listeners.keydown(e);
    await w.serial; if (w.running) await w.running; await w.serial;
    flushFrames(); return e;
  };
  const open = (title = 'Renamed page') => {
    p.rename(); assert.equal(doc.activeElement, p.titleBox);
    p.titleBox.value = title; return p.titleBox;
  };
  t.after(() => {
    p.stopCaret?.(); p.editing?.history?.close(); p.cardImages?.close();
    p.disclosure.close(); p.listening.abort();
    assert.equal(w.running, null, 'no transport remains owned by this memory fixture');
  });
  return { ...f, p, w, calls, views, event, activate, complete, open, flushFrames };
}
