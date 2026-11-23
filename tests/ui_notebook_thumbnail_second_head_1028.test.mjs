import test from 'node:test';
import assert from 'node:assert/strict';
import { OutcomeReferences } from '../web/outcome-references.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

// The real thumbnail owner receives modeled bubbling event sequences. Native
// pointer/keyboard behavior, rendered boxes and the hold's timing are separate.
function fixture(t) {
  const doc = miniDocument(), create = doc.createElement;
  doc.createElement = tag => {
    const node = Object.assign(create(tag), { ownerDocument: doc });
    node.contains = target => node === target || [...node.descendants()].includes(target);
    return node;
  };
  const previous = globalThis.document; globalThis.document = doc;
  t.after(() => { globalThis.document = previous; });
  let selected = false;
  doc.getSelection = () => ({ isCollapsed: !selected });
  const list = doc.createElement('div'); list.root = true;
  const menus = [], opened = [];
  const make = label => {
    const node = () => doc.createElement('div');
    const refs = new OutcomeReferences({ scope: 'outcome', host: node(), list, more: node(), message: node(),
      read: async () => {}, open: (...args) => opened.push(args), menu: (...args) => menus.push([label, ...args]) });
    refs.items = [{ id: 'page', title: label, source_ref: { kind: 'memory', id: 'page', revision: 1 }, color: 'blue' }];
    refs.paint(); return refs;
  };
  const refs = make('first'), row = list.children[0];
  const fire = (type, extra = {}) => {
    const e = { target: row, clientX: 0, clientY: 0, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    // The shared click fence is a capture listener, before row navigation.
    if (type === 'click') list.listeners[type]?.(e);
    if (!e.defaultPrevented) row['on' + type]?.(e);
    if (type !== 'click' && !e.stopped) list.listeners[type]?.(e);
    return e;
  };
  return { refs, row, menus, opened, fire, make, select: value => { selected = value; } };
}

test('1028 real thumbnail owner opens one menu for Shift-F10 and its contextmenu', t => {
  const f = fixture(t);
  f.fire('keydown', { key: 'F10', shiftKey: true }); f.fire('contextmenu');
  assert.equal(f.menus.length, 1); assert.equal(f.menus[0][1].id, 'page');
  assert.deepEqual(f.opened, []);
});

test('1028 real thumbnail owner reaches the hold door and fences its following click', t => {
  const f = fixture(t), set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  let callback;
  try {
    globalThis.setTimeout = (fn, ms) => { assert.equal(ms, 500); callback = fn; return 1; };
    globalThis.clearTimeout = () => { callback = null; };
    f.fire('pointerdown', { pointerType: 'touch', clientX: 30, clientY: 40 }); callback?.();
    assert.equal(f.menus.length, 1);
    f.fire('contextmenu', { clientX: 30, clientY: 40 });
    f.fire('click'); assert.equal(f.menus.length, 1); assert.deepEqual(f.opened, []);
    f.fire('click'); assert.equal(f.opened.length, 1);
  } finally { globalThis.setTimeout = set; globalThis.clearTimeout = clear; }
});

test('1028 real thumbnail owner leaves selected text to its own keyboard and context menus', t => {
  const f = fixture(t); f.select(true);
  f.fire('keydown', { key: 'F10', shiftKey: true }); f.fire('contextmenu');
  assert.deepEqual(f.menus, []); assert.deepEqual(f.opened, []);
});

test('1028 replacing the outcome reference owner keeps one live menu door on the reused list', t => {
  const f = fixture(t); f.make('second');
  f.fire('keydown', { key: 'F10', shiftKey: true });
  assert.equal(f.menus.length, 1); assert.equal(f.menus[0][0], 'second');
});
