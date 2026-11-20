import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyTree } from '../web/key-tree.mjs';
import { OutlineRail } from '../web/outline-rail.mjs';
import { Element } from './fixtures/mini_dom.mjs';

const turn = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const held = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
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

// DOM adapter only. Release/adopt and the asynchronous completion are the
// actual OutlineRail owners; these checks make no native layout/timing claim.
class Dom extends Element {
  cloneNode(deep) {
    const copy = Object.assign(new Dom(this.tag), { id: this.id, className: this.className, attributes: { ...this.attributes } });
    if (deep) copy.append(...this.children.map(child => child.cloneNode(true)));
    return copy;
  }
  removeAttribute(name) { super.removeAttribute(name); if (name === 'id') this.id = ''; }
  querySelectorAll(selector) { return selector === '[id]' ? [...this.descendants()].filter(node => node.id) : super.querySelectorAll(selector); }
  replaceWith(other) { const parent = this.parent; parent.insertBefore(other, this); this.remove(); }
}
function releaseFixture() {
  const read = held(), topics = new Dom(), own = new Dom(), adopted = new Dom();
  adopted.id = 'topic-navigation'; adopted.className = 'ol-adopted';
  const list = new Dom(); list.id = 'topics'; const row = new Dom('a'); row.id = 'topic-row'; list.append(row); adopted.append(list);
  own.hidden = true; topics.append(adopted, own);
  const outcome = { id: 'w1', adopted, own, topics, held: null };
  const rail = Object.create(OutlineRail.prototype);
  rail.outcomes = new Map([['w1', outcome]]); rail.isOpen = () => true; rail.ownRail = () => ({ load: () => read.promise });
  return { rail, outcome, read, adopted, own, topics };
}
test('935 release retains inert id-free rows until the actual replacement read settles', async () => {
  const f = releaseFixture(); f.rail.release(f.outcome);
  assert.equal(f.outcome.adopted, null); assert.equal(f.adopted.parent, null);
  assert.ok(f.outcome.held, 'a held list prevents an empty rail');
  assert.equal(f.outcome.held.inert, true); assert.equal(f.outcome.held.getAttribute('aria-hidden'), 'true');
  assert.deepEqual([f.outcome.held.id, ...f.outcome.held.querySelectorAll('[id]').map(node => node.id)], ['']);
  assert.equal(f.outcome.held.children[0].classList.contains('topic-list'), true);
  assert.equal(f.own.hidden, true);
  f.read.resolve(true); await turn(); assert.equal(f.outcome.held, null); assert.equal(f.own.hidden, false);
});
test('935 a quick adoption removes the held copy and late completion leaves the live list alone', async () => {
  const f = releaseFixture(); f.rail.release(f.outcome); const copy = f.outcome.held;
  const fresh = new Dom(); f.rail.adopt(fresh, f.outcome);
  assert.equal(copy?.parent, null); assert.equal(f.outcome.held, null);
  f.read.resolve(true); await turn();
  assert.equal(f.outcome.adopted, fresh); assert.equal(fresh.parent, f.topics); assert.equal(f.own.hidden, true);
  assert.equal(f.topics.children.length, 2, 'one live list and the hidden owned list');
});
test('935 a failed replacement releases the placeholder so its own Retry can be reached', async () => {
  const f = releaseFixture(); f.rail.release(f.outcome);
  f.read.resolve(false); await turn(); assert.equal(f.outcome.held, null); assert.equal(f.own.hidden, false);
});
