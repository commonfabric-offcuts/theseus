// A reply's image rows, painted in place for the Reader and the inline
// composer: a press on Remove lands however the row repaints while it is held.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paintImageRows } from '../web/image-rows.mjs';

// Just enough of the DOM to see what a repaint does to a held button: a node
// taken out of its row, even to be put back at once, counts as a move, and a
// press held on a moved or replaced button clicks nothing.
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.parent = null; this.dataset = {}; this.textContent = ''; this.disabled = false; this.onclick = null; this.moves = 0; }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling() { return this.parent ? this.parent.children[this.parent.children.indexOf(this) + 1] ?? null : null; }
  get isConnected() { return Boolean(this.parent); }
  detach() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; this.moves++; } }
  append(...nodes) { for (const node of nodes) { node.detach(); node.parent = this; this.children.push(node); } }
  after(node) { node.detach(); this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node); node.parent = this.parent; }
  remove() { this.detach(); }
}
globalThis.document = { createElement: tag => new Node(tag) };

const REMOVE = { label: 'Remove', method: 'remove' }, RETRY = { label: 'Retry upload', method: 'retry' };
const choice = (id, state, actions = [REMOVE]) => ({ id, text: `${id}.png · ${state}`, view: JSON.stringify([state, actions.map(a => a.label)]), actions });
const buttons = row => row.children.slice(1);
const labels = row => buttons(row).map(b => b.dataset.action);
const rows = () => {
  const host = new Node('div'), presses = [];
  const press = (action, pressed, button) => new Promise(resolve => presses.push({ action, choice: pressed, button, settle: resolve }));
  return { host, presses, paint: (choices, enabled = true) => paintImageRows(host, choices, enabled, press) };
};

test('as an upload finishes its row repaints and Remove stays the same button, never taken out of the row, and its press reaches the image as it now is', async () => {
  const { host, presses, paint } = rows();
  paint([choice('a', 'Uploading')]);
  const row = host.children[0], remove = buttons(row)[0];
  assert.equal(row.firstElementChild.textContent, 'a.png · Uploading');
  paint([choice('a', 'Ready')]);
  assert.equal(row.firstElementChild.textContent, 'a.png · Ready', 'the words follow the upload');
  assert.equal(buttons(row)[0], remove, 'the button held down is still the one in the row');
  assert.equal(remove.moves, 0, 'a held button taken out of its row, even to be put back, loses its press');
  remove.onclick();
  assert.equal(presses.length, 1);
  assert.equal(presses[0].action, REMOVE); assert.equal(presses[0].button, remove);
  assert.equal(presses[0].choice.text, 'a.png · Ready', 'the press acts on the row as it is when released');
});

test('a failed upload\'s Retry upload comes in before Remove and goes again, and Remove never moves', () => {
  const { host, paint } = rows();
  paint([choice('a', 'Uploading')]);
  const row = host.children[0], remove = buttons(row)[0];
  paint([choice('a', 'Could not attach', [RETRY, REMOVE])]);
  assert.deepEqual(labels(row), ['Retry upload', 'Remove']);
  const retry = buttons(row)[0];
  assert.equal(retry.textContent, 'Retry upload'); assert.equal(retry.type, 'button');
  paint([choice('a', 'Uploading')]);
  assert.deepEqual(labels(row), ['Remove'], 'a button the row no longer offers goes');
  assert.equal(retry.isConnected, false);
  assert.equal(buttons(row)[0], remove); assert.equal(remove.moves, 0, 'Remove stayed where it was through both repaints');
});

test('a press runs once, and its button stays disabled until it settles whatever repaints meanwhile; then it can be pressed again', async () => {
  const { host, presses, paint } = rows();
  paint([choice('a', 'Could not attach', [RETRY, REMOVE])]);
  const retry = buttons(host.children[0])[0];
  retry.onclick(); retry.onclick();
  assert.equal(presses.length, 1, 'a second press while the first is under way does nothing');
  assert.equal(retry.disabled, true);
  paint([choice('a', 'Server busy', [RETRY, REMOVE])]);
  assert.equal(buttons(host.children[0])[0], retry);
  assert.equal(retry.disabled, true, 'a repaint while the press is under way does not make it pressable');
  retry.onclick(); assert.equal(presses.length, 1, 'nor does the repainted handler run it again');
  presses[0].settle(); await new Promise(resolve => setImmediate(resolve));
  paint([choice('a', 'Could not attach', [RETRY, REMOVE])]);
  assert.equal(retry.disabled, false, 'once it settles the button follows the page again');
  retry.onclick(); assert.equal(presses.length, 2, 'and a new press runs');
});

test('rows follow the chosen images: a removed image\'s row goes, an unchanged row is left as it is, and a page that cannot write disables every button', () => {
  const { host, paint } = rows();
  paint([choice('a', 'Ready'), choice('b', 'Uploading')]);
  const [a, b] = host.children, handler = buttons(a)[0].onclick;
  paint([choice('a', 'Ready'), choice('b', 'Ready')]);
  assert.equal(buttons(a)[0].onclick, handler, 'a row whose view is unchanged is not repainted');
  paint([choice('b', 'Ready')]);
  assert.deepEqual(host.children, [b], 'the removed image\'s row is gone');
  assert.equal(a.isConnected, false);
  paint([choice('b', 'Ready', [RETRY, REMOVE])], false);
  assert.deepEqual(buttons(b).map(x => x.disabled), [true, true]);
  assert.deepEqual(host.children.map(r => r.dataset.selection), ['b']);
});
