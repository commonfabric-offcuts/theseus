import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';

function setup(t) {
  const previous = globalThis.window;
  globalThis.window = { getSelection: () => ({ isCollapsed: true }) };
  t.after(() => { globalThis.window = previous; });
  const events = new Map(), calls = [];
  const surface = { clientWidth: 320, ownerDocument: { defaultView: { innerHeight: 568, getComputedStyle: at => ({ overflowX: at.overflowX ?? 'visible' }) } },
    addEventListener: (name, fn) => events.set(name, fn) };
  const target = { parentElement: surface, scrollWidth: 100, clientWidth: 100, closest: () => null };
  const source = { source_ref: { kind: 'message', id: 'm1' } };
  const r = { dialog: { open: true }, source, presentation: {}, sourceBody: surface, callbacks: { foldMessage: s => calls.push(s) } };
  assert.equal(typeof Reader.prototype.bindSwipe, 'function', 'item 648: the Reader binds native swipe events');
  Reader.prototype.bindSwipe.call(r);
  let stamp = 0;
  const fire = (name, data = {}) => {
    let prevented = false;
    events.get(name)?.({ target, timeStamp: stamp += 20, preventDefault: () => { prevented = true; }, ...data });
    return prevented;
  };
  const wheel = (deltaX, deltaY = 0, data = {}) => fire('wheel', { deltaX, deltaY, deltaMode: 0, ...data });
  const touch = (dx, dy = 0) => { fire('touchstart', { touches: [{ identifier: 1, clientX: 20, clientY: 50 }] }); fire('touchend', { changedTouches: [{ identifier: 1, clientX: 20 + dx, clientY: 50 + dy }] }); };
  return { r, target, calls, fire, wheel, touch, gap: () => { stamp += 300; } };
}

test('item 648: a right finger swipe and a natural trackpad swipe fold once, momentum never unfolds', t => {
  const f = setup(t); f.touch(100); assert.deepEqual(f.calls, [f.r.source]);
  f.calls.length = 0;
  assert.equal(f.wheel(-45), true); assert.equal(f.calls.length, 0);
  f.wheel(-40); f.wheel(-100); f.wheel(200);
  assert.deepEqual(f.calls, [f.r.source]);
  f.gap(); f.wheel(-100); assert.equal(f.calls.length, 2);
});

test('item 648: short, left, vertical, zoom, control, selection and sideways scrolling fold nothing', t => {
  const f = setup(t);
  f.touch(79); f.touch(-100); f.touch(100, 41);
  f.wheel(100); f.gap(); f.wheel(-79); f.gap();
  f.wheel(-100, 120); f.wheel(-100, 0, { ctrlKey: true }); f.wheel(-100, 0, { metaKey: true });
  f.target.closest = () => ({}); f.touch(100); f.wheel(-100); f.gap(); f.target.closest = () => null;
  f.target.scrollWidth = 200; f.target.overflowX = 'auto'; f.touch(100); f.wheel(-100); f.gap();
  f.target.scrollWidth = 100; window.getSelection = () => ({ isCollapsed: false }); f.touch(100); f.wheel(-100);
  assert.deepEqual(f.calls, []);
});

test('item 648: unavailable, unconfirmed, closed, empty and Notebook sources admit no fold', t => {
  const f = setup(t);
  for (const state of ['sourceUnavailable', 'availabilityUnconfirmed']) {
    f.r.presentation[state] = true; f.touch(100); f.wheel(-100); f.gap(); delete f.r.presentation[state];
  }
  f.r.dialog.open = false; f.touch(100); f.wheel(-100); f.gap(); f.r.dialog.open = true;
  f.r.source = null; f.touch(100); f.wheel(-100); f.gap();
  f.r.source = { source_ref: { kind: 'memory', id: 'page' } }; f.touch(100); f.wheel(-100);
  assert.deepEqual(f.calls, []);
});

test('item 648: cancellation, multi-touch and changing source mid-gesture fold neither source', t => {
  const f = setup(t), start = () => f.fire('touchstart', { touches: [{ identifier: 1, clientX: 20, clientY: 50 }] });
  start(); f.fire('touchcancel'); f.fire('touchend', { changedTouches: [{ identifier: 1, clientX: 120, clientY: 50 }] });
  f.fire('touchstart', { touches: [{}, {}] }); f.fire('touchend', { changedTouches: [{ identifier: 1, clientX: 120, clientY: 50 }] });
  start(); f.r.source = { source_ref: { kind: 'message', id: 'm2' } }; f.fire('touchend', { changedTouches: [{ identifier: 1, clientX: 120, clientY: 50 }] });
  f.wheel(-40); f.r.source = { source_ref: { kind: 'message', id: 'm3' } }; f.wheel(-50);
  assert.deepEqual(f.calls, []);
});
