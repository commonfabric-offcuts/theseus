import test from 'node:test';
import assert from 'node:assert/strict';
import { menuDoor } from '../web/outline-menus.mjs';

// Below-browser event-sequence checks of the shared owner. Calling the timer
// models its callback; these checks make no native gesture or timing claim.
function fixture() {
  const listeners = new Map(), opened = [];
  let selected = false, timer = null;
  const row = { isConnected: true, contains: target => target === row };
  const doc = { getSelection: () => ({ isCollapsed: !selected }) };
  const root = { ownerDocument: doc, addEventListener(name, fn) {
    listeners.set(name, [...listeners.get(name) ?? [], fn]);
  } };
  const clock = { setTimeout(fn, ms) { assert.equal(ms, 500); timer = fn; return 1; }, clearTimeout() { timer = null; } };
  const reset = menuDoor(root, target => target === row ? row : null, (target, at) => opened.push({ target, at }), { clock });
  const fire = (name, extra = {}) => {
    const event = { target: row, clientX: 0, clientY: 0, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
    for (const fn of listeners.get(name) ?? []) fn(event);
    return event;
  };
  return { row, opened, fire, reset, select: value => { selected = value; }, timer: () => timer?.() };
}

for (const key of ['F10', 'ContextMenu']) test(`1028 shared door opens once for ${key} followed by its zero-coordinate contextmenu`, () => {
  const f = fixture();
  assert.equal(f.fire('keydown', { key, shiftKey: key === 'F10' }).defaultPrevented, true);
  assert.equal(f.fire('contextmenu').defaultPrevented, true);
  assert.equal(f.opened.length, 1);
  assert.deepEqual(f.opened[0], { target: f.row, at: null });
});

test('1028 shared keyboard door leaves an actual text selection to its own menu', () => {
  const f = fixture(); f.select(true);
  const key = f.fire('keydown', { key: 'F10', shiftKey: true });
  const context = f.fire('contextmenu');
  assert.equal(f.opened.length, 0);
  assert.notEqual(key.defaultPrevented, true);
  assert.notEqual(context.defaultPrevented, true);
});

test('1028 shared door keeps subsequent real secondary click after the keyboard menu', () => {
  const f = fixture(); f.fire('keydown', { key: 'F10', shiftKey: true });
  f.fire('pointerdown', { pointerType: 'mouse', clientX: 25, clientY: 40 });
  f.fire('contextmenu', { clientX: 25, clientY: 40 });
  assert.equal(f.opened.length, 2);
  assert.deepEqual(f.opened[1].at, { x: 25, y: 40 });
});

test('1028 shared hold owns its following contextmenu and click once, then releases navigation', () => {
  const f = fixture(); f.fire('pointerdown', { pointerType: 'touch', clientX: 20, clientY: 30 }); f.timer();
  assert.equal(f.opened.length, 1);
  assert.equal(f.fire('contextmenu', { clientX: 20, clientY: 30 }).defaultPrevented, true);
  assert.equal(f.opened.length, 1);
  assert.equal(f.fire('click').defaultPrevented, true);
  assert.notEqual(f.fire('click').defaultPrevented, true);
});

test('1028 shared hold cancels on movement, lift, scroll, selection and reset', () => {
  for (const kind of ['move', 'lift', 'scroll', 'selection', 'reset']) {
    const f = fixture(); f.fire('pointerdown', { pointerType: 'touch', clientX: 20, clientY: 30 });
    if (kind === 'move') f.fire('pointermove', { clientX: 29, clientY: 30 });
    if (kind === 'lift') f.fire('pointerup');
    if (kind === 'scroll') f.fire('scroll');
    if (kind === 'selection') f.select(true);
    if (kind === 'reset') f.reset();
    f.timer(); assert.equal(f.opened.length, 0, kind);
    assert.notEqual(f.fire('click').defaultPrevented, true, kind);
  }
});
