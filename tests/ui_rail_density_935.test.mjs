import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyTree } from '../web/key-tree.mjs';
import { Element } from './fixtures/mini_dom.mjs';

function keys() {
  const els = ['heading', 'outcome', 'pencil', 'topic', 'next-outcome'].map(key => ({ key, querySelectorAll: () => [] }));
  const rows = els.map((el, i) => ({ el, key: el.key, ...(i === 2 ? { byRight: true } : {}) }));
  const moves = [], tree = Object.create(KeyTree.prototype);
  tree.list = () => rows; tree.go = row => moves.push(row?.key); tree.act = action => moves.push(action);
  return { rows, moves, tree, press: (i, key) => tree.key({ target: els[i], key, preventDefault() {} }) };
}
test('935 real KeyTree up/down skip a byRight pencil, including a step from the pencil', () => {
  const f = keys();
  f.press(1, 'ArrowDown'); f.press(3, 'ArrowUp'); f.press(2, 'ArrowUp'); f.press(2, 'ArrowDown');
  assert.deepEqual(f.moves, ['topic', 'outcome', 'outcome', 'topic']);
});
test('935 right still delegates to the tree step and heading Up behavior stays unchanged', () => {
  const f = keys(); f.press(1, 'ArrowRight'); f.press(1, 'ArrowUp');
  assert.deepEqual(f.moves, ['right', 'heading']);
  f.rows[1].expanded = true; f.rows[2].parent = f.rows[1].el;
  assert.equal(f.tree.stepIn(f.rows[1], f.rows, () => assert.fail('already open')), true);
  assert.equal(f.moves.at(-1), 'pencil');
});

//1005 retires adopted/cloned-list handoffs. Retained native identity and
//late publication now live in solid_left_rail_1005_native and ui_topic_rail.
class Dom extends Element {}

test('935 separator announced width follows density changes and keeps an explicit width', async () => {
  // Rectangle adapter only: this checks the actual installed density callback
  // and ARIA state, not browser geometry or a native gesture.
  const previous = ['document', 'localStorage'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const values = new Map(), styles = new Map();
  let root;
  class DensityElement extends Dom {
    get parentElement() { return this.parent; }
    after(node) { const at = this.parent.children.indexOf(this); this.parent.insertBefore(node, this.parent.children[at + 1] ?? null); }
    getBoundingClientRect() { return { width: styles.has('--rail-w') ? Number.parseInt(styles.get('--rail-w'), 10) : root.getAttribute('data-rail-roomy') === null ? 264 : 288 }; }
  }
  const doc = { createElement: tag => new DensityElement(tag) };
  root = doc.documentElement = new DensityElement('html');
  root.style = { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) };
  doc.body = new DensityElement('body'); doc.body.root = true;
  const layout = new DensityElement(), rail = new DensityElement('nav'), foot = new DensityElement();
  rail.id = 'rail'; foot.className = 'rail-foot'; rail.append(foot); layout.append(rail); doc.body.append(layout);
  doc.querySelector = selector => doc.body.querySelector(selector); doc.getElementById = id => doc.querySelector('#' + id);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } });
  try {
    const { railDensity } = await import('../web/rail-density.mjs?935-aria-control'); railDensity();
    const handle = layout.querySelector('.rail-resize'), choices = foot.querySelector('.rail-density').children;
    assert.equal(handle.getAttribute('aria-valuenow'), '264');
    choices[1].onclick(); assert.equal(rail.getBoundingClientRect().width, 288); assert.equal(handle.getAttribute('aria-valuenow'), '288');
    choices[0].onclick(); assert.equal(handle.getAttribute('aria-valuenow'), '264');
    handle.onkeydown({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} });
    assert.equal(handle.getAttribute('aria-valuenow'), '280');
    choices[1].onclick(); assert.equal(handle.getAttribute('aria-valuenow'), '280', 'explicit width holds across density');
  } finally {
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});
