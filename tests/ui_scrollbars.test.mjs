import assert from 'node:assert/strict';
import test from 'node:test';
import { quietScrollbars } from '../web/scrollbars.mjs';

function fixture() {
  const listeners = new Map(), pageListeners = new Map(), timers = new Map(); let serial = 0;
  const element = (overflow = true) => ({
    scrollHeight: overflow ? 500 : 100, clientHeight: 100, scrollWidth: 100, clientWidth: 100,
    isConnected: true, attributes: new Set(), fades: [],
    setAttribute(name) { this.attributes.add(name); }, removeAttribute(name) { this.attributes.delete(name); },
    animate() { const fade = { cancelled: false, cancel() { this.cancelled = true; } }; this.fades.push(fade); return fade; }
  });
  const doc = {
    documentElement: element(), scrollingElement: element(),
    addEventListener(type, fn, opts) { listeners.set(type, { fn, opts }); },
    removeEventListener(type) { listeners.delete(type); },
    defaultView: {
      addEventListener(type, fn) { pageListeners.set(type, fn); }, removeEventListener(type) { pageListeners.delete(type); },
      setTimeout(fn) { const n = ++serial; timers.set(n, fn); return n; }, clearTimeout(n) { timers.delete(n); },
      getComputedStyle() { return { getPropertyValue() { return 'rgb(80, 80, 80)'; } }; },
      matchMedia() { return { matches: false }; }
    }
  };
  return { doc, element, listeners, pageListeners, timers,
    scroll: e => listeners.get('scroll').fn({ target: e }),
    settle: () => { const now = [...timers.values()]; timers.clear(); now.forEach(fn => fn()); } };
}

test('one document observer covers later scrollers, without marking their idle parent or no-overflow children', () => {
  const f = fixture(), stop = quietScrollbars(f.doc);
  assert.equal(quietScrollbars(f.doc), stop);
  assert.deepEqual(f.listeners.get('scroll').opts, { capture: true, passive: true });
  const child = f.element(), short = f.element(false);
  f.scroll(child); f.scroll(short);
  assert.equal(child.attributes.has('data-scrolling'), true);
  assert.equal(short.attributes.has('data-scrolling'), false);
  assert.equal(f.doc.scrollingElement.attributes.has('data-scrolling'), false);
  f.scroll(f.doc);
  assert.equal(f.doc.scrollingElement.attributes.has('data-scrolling'), true);
  stop();
  assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
});

test('a new scroll cancels its earlier fade; an old finish cannot clear the new scroll', () => {
  const f = fixture(), e = f.element(); quietScrollbars(f.doc);
  f.scroll(e); f.settle(); const old = e.fades[0];
  f.scroll(e); old.onfinish();
  assert.equal(old.cancelled, true);
  assert.equal(e.attributes.has('data-scrolling'), true);
  f.settle(); e.fades[1].onfinish();
  assert.equal(e.attributes.has('data-scrolling'), false);
  assert.equal(f.timers.size, 0);
});

test('page hiding clears timers and fades while keeping the observer for back/forward restoration', () => {
  const f = fixture(), first = f.element(), second = f.element(); quietScrollbars(f.doc);
  f.scroll(first); f.settle(); f.scroll(second);
  f.pageListeners.get('pagehide')();
  assert.equal(first.fades[0].cancelled, true);
  assert.equal(second.attributes.has('data-scrolling'), false);
  assert.equal(f.timers.size, 0);
  f.scroll(second); assert.equal(second.attributes.has('data-scrolling'), true);
});

test('reduced motion and detached elements settle without an animation', () => {
  const f = fixture(), e = f.element(); quietScrollbars(f.doc);
  f.doc.defaultView.matchMedia = () => ({ matches: true });
  f.scroll(e); f.settle(); assert.equal(e.fades.length, 0);
  assert.equal(e.attributes.has('data-scrolling'), false);
  e.isConnected = false; f.doc.defaultView.matchMedia = () => ({ matches: false });
  f.scroll(e); f.settle(); assert.equal(e.fades.length, 0);
});
