// A reply's image rows, painted in place for the Reader and the inline
// composer: a press on Remove lands however the row repaints while it is held.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paintImageRows } from '../web/image-rows.mjs';

// Just enough of the DOM to see what a repaint does to a held button: a node
// taken out of its row, even to be put back at once, counts as a move, and a
// press held on a moved or replaced button clicks nothing.
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.parent = null; this.dataset = {}; this.textContent = ''; this.disabled = false; this.onclick = null; this.moves = 0; this.listeners = []; this.place = { left: 0, top: 0, right: 0, bottom: 0 }; }
  addEventListener(type, listener) { this.listeners.push({ type, listener }); }
  getBoundingClientRect() { return { ...this.place }; }
  contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
  click() { if (!this.disabled) this.onclick?.(); }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling() { return this.parent ? this.parent.children[this.parent.children.indexOf(this) + 1] ?? null : null; }
  // In the page: under the host, which stands for the document.
  get isConnected() { for (let n = this; n; n = n.parent) if (n.page) return true; return false; }
  detach() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; this.moves++; } }
  append(...nodes) { for (const node of nodes) { node.detach(); node.parent = this; this.children.push(node); } }
  after(node) { node.detach(); this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node); node.parent = this.parent; }
  remove() { this.detach(); }
}
// The page's own listeners (capture, on the window) and what is under a point.
const page = [];
let under = null;
globalThis.addEventListener = (type, listener) => page.push({ type, listener });
globalThis.document = { createElement: tag => new Node(tag), elementFromPoint: () => under };
// A pointer event as the browser dispatches it: the window sees it first, then
// the element it is over (a press goes down on the button it is aimed at).
const pointer = (type, target, { x = 10, y = 10, pointerId = 1, button = 0, isPrimary = true } = {}) => {
  const event = { type, clientX: x, clientY: y, pointerId, button, isPrimary };
  for (const l of page) if (l.type === type) l.listener(event);
  for (const l of target?.listeners ?? []) if (l.type === type) l.listener(event);
};
// A click the browser sends after a pointer's release (detail 1) or for a key
// (detail 0): whether the page let it through to its target.
const browserClick = (detail = 1) => {
  const event = { type: 'click', detail, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
  for (const l of page) if (l.type === 'click') l.listener(event);
  return !event.stopped && !event.prevented;
};

// A finger's lift (touchend), which the browser dispatches after its
// pointerup to what the finger went down on, wherever that now is: whether
// the page cancelled it, so that the browser sends no mousedown, mouseup or
// click for the tap to whatever is under the finger.
const lift = target => {
  const event = { type: 'touchend', prevented: false, preventDefault() { this.prevented = true; } };
  for (const l of page) if (l.type === 'touchend') l.listener(event);
  for (const l of target?.listeners ?? []) if (l.type === 'touchend') l.listener(event);
  return event.prevented;
};

const REMOVE = { label: 'Remove', method: 'remove' }, RETRY = { label: 'Retry upload', method: 'retry' };
const choice = (id, state, actions = [REMOVE]) => ({ id, text: `${id}.png · ${state}`, view: JSON.stringify([state, actions.map(a => a.label)]), actions });
const buttons = row => row.children.slice(1);
const labels = row => buttons(row).map(b => b.dataset.action);
const rows = () => {
  const host = new Node('div'), presses = []; host.page = true;
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

// The page moved Remove from under a still pointer between the press going
// down and coming up (its row's words wrapped, or a row above it grew): the
// point it comes up at is over something else, but where Remove was.
const pressedRemove = () => {
  const { host, presses, paint } = rows();
  paint([choice('a', 'Uploading')]);
  const row = host.children[0], remove = buttons(row)[0], words = row.firstElementChild;
  remove.place = { left: 100, top: 0, right: 160, bottom: 40 };
  return { presses, paint, row, remove, words };
};

test('a press that went down on Remove and comes up where Remove was presses it once, though the page moved Remove from under it, and the click the browser sends after it reaches nothing', () => {
  const { presses, remove, words } = pressedRemove();
  pointer('pointerdown', remove, { x: 157, y: 3 });
  remove.place = { left: 100, top: 38, right: 160, bottom: 78 }; under = words;
  pointer('pointerup', words, { x: 157, y: 3 });
  assert.equal(presses.length, 1, 'Remove is pressed, as the person pressed it');
  assert.equal(presses[0].action, REMOVE);
  assert.equal(browserClick(0), true, 'a key\'s click is never taken for it');
  assert.equal(browserClick(), false, 'the click the browser sends to whatever is now under the pointer is this press\'s and is dropped');
  assert.equal(browserClick(), true, 'and only that one');
  presses[0].settle();
});

test('a finger that went down on Remove and lifts where Remove was presses it once, and its tap\'s mousedown, mouseup and click are cancelled, so nothing under the finger is pressed or focused', () => {
  const { presses, remove, words } = pressedRemove();
  pointer('pointerdown', remove, { x: 157, y: 3 });
  remove.place = { left: 100, top: 38, right: 160, bottom: 78 }; under = words;
  pointer('pointerup', words, { x: 157, y: 3 });
  assert.equal(presses.length, 1, 'Remove is pressed, as the person pressed it');
  assert.equal(lift(remove), true, 'the lift is cancelled, so the browser sends the tap\'s mouse events and click to nothing');
  presses[0].settle();
  pointer('pointerdown', words, { x: 50, y: 50 }); under = words;
  pointer('pointerup', words, { x: 50, y: 50 });
  assert.equal(lift(words), false, 'the next tap, on anything else, is left alone');
  assert.equal(browserClick(), true, 'and its click reaches what it was on');
  pointer('pointerdown', remove, { x: 130, y: 50 }); under = remove;
  pointer('pointerup', remove, { x: 130, y: 50 });
  assert.equal(lift(remove), false, 'a tap over Remove at both ends is left to the browser');
});

test('a press over Remove at both ends is left to the browser\'s own click, so it presses once', () => {
  const { presses, remove } = pressedRemove();
  pointer('pointerdown', remove, { x: 130, y: 20 }); under = remove;
  pointer('pointerup', remove, { x: 130, y: 20 });
  assert.equal(presses.length, 0, 'the release itself presses nothing');
  assert.equal(browserClick(), true, 'the browser\'s click is let through');
});

test('a press dragged away from where Remove was, a cancelled press, another pointer, and a press on something else do not press Remove', () => {
  const { presses, remove, words } = pressedRemove();
  pointer('pointerdown', remove, { x: 130, y: 20 }); under = words;
  pointer('pointerup', words, { x: 60, y: 20 });
  assert.equal(presses.length, 0, 'released outside where Remove was: let go');
  assert.equal(browserClick(), true, 'and the browser\'s click is not taken from anything');
  pointer('pointerdown', remove, { x: 130, y: 20 }); pointer('pointercancel', null);
  pointer('pointerup', words, { x: 130, y: 20 });
  assert.equal(presses.length, 0, 'a cancelled press (a scroll took it) presses nothing');
  pointer('pointerdown', remove, { x: 130, y: 20 });
  pointer('pointerup', words, { x: 130, y: 20, pointerId: 2 });
  assert.equal(presses.length, 0, 'a second finger lifting is not this press');
  pointer('pointerdown', remove, { x: 130, y: 20, button: 2 });
  pointer('pointerup', words, { x: 130, y: 20, button: 2 });
  assert.equal(presses.length, 0, 'a right-button press presses nothing');
  pointer('pointerdown', remove, { x: 130, y: 20 }); pointer('pointerdown', words, { x: 130, y: 20 });
  pointer('pointerup', words, { x: 130, y: 20 });
  assert.equal(presses.length, 0, 'a press whose release was lost is forgotten when the next press goes down elsewhere');
});

test('a press on Remove whose row went, or whose Remove was disabled meanwhile, presses nothing', () => {
  const disabled = pressedRemove();
  pointer('pointerdown', disabled.remove, { x: 130, y: 20 }); under = disabled.words;
  disabled.paint([choice('a', 'Ready', [REMOVE])], false);
  pointer('pointerup', disabled.words, { x: 130, y: 20 });
  assert.equal(disabled.presses.length, 0, 'disabled: not pressed');
  const gone = pressedRemove();
  pointer('pointerdown', gone.remove, { x: 130, y: 20 }); under = gone.words;
  gone.paint([]);
  assert.equal(gone.remove.disabled, false, 'the button that went was not disabled');
  pointer('pointerup', gone.words, { x: 130, y: 20 });
  assert.equal(gone.presses.length, 0, 'its row is gone: not pressed');
});
