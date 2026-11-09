// A reply's image rows, painted in place for the Reader and the inline
// composer: a press on Remove lands however the row repaints while it is held.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paintImageRows } from '../web/image-rows.mjs';
import { protectTouchBounds } from '../web/creation-view.mjs';

// Just enough of the DOM to see what a repaint does to a held button: a node
// taken out of its row, even to be put back at once, counts as a move, and a
// press held on a moved or replaced button clicks nothing.
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.parent = null; this.dataset = {}; this.textContent = ''; this.disabled = false; this.onclick = null; this.moves = 0; this.listeners = []; this.place = { left: 0, top: 0, right: 0, bottom: 0 }; this.captured = null; }
  addEventListener(type, listener, options) { this.listeners.push({ type, listener, once: Boolean(options?.once) }); }
  removeEventListener(type, listener) { this.listeners = this.listeners.filter(l => l.type !== type || l.listener !== listener); }
  fire(type, event) { for (const l of [...this.listeners]) if (l.type === type) { if (l.once) this.removeEventListener(type, l.listener); l.listener(event); } }
  getBoundingClientRect() { return { ...this.place }; }
  setPointerCapture(pointerId) { this.captured = pointerId; }
  releasePointerCapture(pointerId) { if (this.captured === pointerId) { this.captured = null; this.fire('lostpointercapture', { pointerId }); } }
  contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
  // The one selector the rows ask about: a button that holds its press.
  closest(selector) {
    assert.equal(selector, '[data-holds-press]');
    for (let n = this; n; n = n.parent) if ('holdsPress' in n.dataset) return n;
    return null;
  }
  click() { if (!this.disabled) this.onclick?.(); }
  // A disabled button or one out of the page takes no focus.
  focus(options) { if (!this.disabled && this.isConnected) { document.activeElement = this; this.focusedWith = options; } }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling() { return this.parent ? this.parent.children[this.parent.children.indexOf(this) + 1] ?? null : null; }
  // In the page: under the host, which stands for the document.
  get isConnected() { for (let n = this; n; n = n.parent) if (n.page) return true; return false; }
  detach() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; this.moves++; } }
  append(...nodes) { for (const node of nodes) { node.detach(); node.parent = this; this.children.push(node); } }
  after(node) { node.detach(); this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node); node.parent = this.parent; }
  prepend(node) { node.detach(); node.parent = this; this.children.unshift(node); }
  remove() { this.detach(); }
  // What a thumbnail asks of its row: the page it is in, and its image at the row's start.
  get ownerDocument() { return document; }
  querySelector(selector) {
    assert.equal(selector, ':scope > img.image-thumb');
    return this.children.find(child => child.tagName === 'img' && child.className === 'image-thumb') ?? null;
  }
}
// The page's own listeners (capture, on the window), and what is under a point.
const page = [];
globalThis.addEventListener = (type, listener) => page.push({ type, listener });
globalThis.document = { createElement: tag => new Node(tag), activeElement: null, elementFromPoint: (x, y) => document.at?.(x, y) ?? null };

const REMOVE = { label: 'Remove', method: 'remove' }, RETRY = { label: 'Retry upload', method: 'retry' };
const choice = (id, state, actions = [REMOVE]) => ({ id, text: `${id}.png · ${state}`, view: JSON.stringify([state, actions.map(a => a.label)]), actions });
const buttons = row => row.children.slice(1);
const labels = row => buttons(row).filter(b => b.dataset.action).map(b => b.dataset.action);
const rows = () => {
  const host = new Node('div'), presses = []; host.page = true;
  // Where focus is as the press reaches the surface's act.
  const press = (action, pressed, button) => new Promise(resolve => presses.push({ action, choice: pressed, button, focus: document.activeElement, settle: resolve }));
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


// What the browser does with a press, as far as these checks need it. A
// pointer event goes to the window first, then to its target. A mouse's
// mouseup and click go to the button that captured it, else to what the
// pointer is over. A finger's lift (touchend) goes to what it went down on,
// and unless the page cancelled it the browser decides whether the finger
// made a tap; a tap's mousedown, mouseup and click go to whatever is then
// under the point the finger went down on. A mouse event goes to the window,
// then, unless stopped there, to its target: a mousedown not cancelled
// focuses what it lands on, and a click presses it.
const pointer = (type, target, { x = 10, y = 10, pointerId = 1, button = 0, isPrimary = true, pointerType = 'mouse' } = {}) => {
  const event = { type, target, clientX: x, clientY: y, pointerId, button, isPrimary, pointerType };
  for (const l of page) if (l.type === type) l.listener(event);
  target?.fire(type, event);
};
// What a mouse event reached: 'stopped', or its target by name.
const name = node => node.id ?? node.dataset.action ?? node.tagName;
const mouse = (type, target, detail = 1) => {
  const event = { type, target, detail, stopped: false, halted: false, prevented: false, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = this.halted = true; }, preventDefault() { this.prevented = true; } };
  for (const l of page) if (l.type === type && !event.halted) l.listener(event);
  if (event.stopped) return 'stopped';
  if (type === 'mousedown' && !event.prevented) target.focus();
  if (type === 'click') target.click();
  return name(target);
};
// A mouse press: down on the button it is aimed at, the page moving things
// meanwhile, a move to `to`, and up over `over`. Returns where its click went.
const mousePress = (button, over, { x = 130, y = 20, to = null } = {}, meanwhile = () => {}) => {
  pointer('pointerdown', button, { x, y }); mouse('mousedown', button);
  meanwhile();
  if (to) pointer('pointermove', button.captured === 1 ? button : over, { x: to.x, y: to.y });
  const up = button.captured === 1 ? button : over;
  pointer('pointerup', up, to ?? { x, y });
  const captured = button.captured === 1; button.captured = null;
  mouse('mouseup', up);
  return mouse('click', captured ? button : over);
};
// A finger press: down on the button, the page moving things meanwhile, up;
// if the browser takes it for a tap, its mouse events go to `under`. Returns
// what the tap's mousedown, mouseup and click reached, or null if no tap was sent.
const fingerPress = (button, under, { cancel = false } = {}, meanwhile = () => {}) => {
  pointer('pointerdown', button, { x: 130, y: 20, pointerType: 'touch' });
  meanwhile();
  if (cancel) { pointer('pointercancel', button, { pointerType: 'touch' }); return null; }
  pointer('pointerup', button, { x: 130, y: 20, pointerType: 'touch' });
  const lift = { prevented: false, preventDefault() { this.prevented = true; } };
  for (const l of page) if (l.type === 'touchend') l.listener(lift);
  button.fire('touchend', lift);
  if (lift.prevented) return null;
  return ['mousedown', 'mouseup', 'click'].map(type => mouse(type, under));
};

// The page moved Remove from under a still pointer between the press going
// down and coming up (its row's words wrapped, or a row above it grew).
const pressedRemove = () => {
  const { host, presses, paint } = rows();
  paint([choice('a', 'Uploading')]);
  const row = host.children[0], remove = buttons(row)[0], words = row.firstElementChild;
  remove.place = { left: 100, top: 0, right: 160, bottom: 40 };
  const moved = () => { remove.place = { left: 100, top: 38, right: 160, bottom: 78 }; };
  // Focus is in the reply field, where a person who pasted an image keeps typing.
  const field = new Node('textarea'); field.page = true; field.id = 'writing-body';
  document.activeElement = field;
  const r = () => remove.place;
  document.at = (x, y) => x >= r().left && x <= r().right && y >= r().top && y <= r().bottom ? remove : field;
  return { presses, paint, row, remove, words, field, moved };
};

test('a mouse press on Remove is captured, so the browser\'s own click comes to Remove though the page moves it from under the pointer, and presses it once', () => {
  const { presses, remove, words, moved } = pressedRemove();
  assert.equal(mousePress(remove, words, {}, moved), 'Remove', 'the browser\'s click came to Remove');
  assert.equal(presses.length, 1, 'Remove is pressed, as the person pressed it');
  assert.equal(presses[0].action, REMOVE);
  assert.equal(presses[0].focus, remove, 'focused by the browser\'s own mousedown on it');
});

test('a mouse press that moves only within where Remove is or was stays Remove\'s; one dragged away from both goes back to the browser\'s aim and presses nothing', () => {
  const { presses, remove, words, moved } = pressedRemove();
  assert.equal(mousePress(remove, words, { to: { x: 132, y: 22 } }, moved), 'Remove', 'a pointer that shook where Remove was is still Remove\'s');
  presses[0].settle();
  const other = pressedRemove();
  assert.equal(mousePress(other.remove, other.words, { to: { x: 132, y: 60 } }, other.moved), 'Remove', 'and one that followed Remove to where it now is');
  other.presses[0].settle();
  const away = pressedRemove();
  assert.equal(mousePress(away.remove, away.words, { to: { x: 40, y: 20 } }), 'span', 'dragged away: the click goes where the browser aims it, not to Remove');
  assert.equal(away.presses.length, 0, 'and Remove is not pressed');
  assert.equal(away.remove.captured, null);
});

test('a finger\'s tap that lands on Remove is the browser\'s alone: its lift is never cancelled and nothing is taken from it, so a tap rolled off Remove that the browser still counts presses it', () => {
  const { presses, remove, field } = pressedRemove();
  assert.deepEqual(fingerPress(remove, remove), ['Remove', 'Remove', 'Remove'], 'the tap\'s mousedown, mouseup and click reached Remove');
  assert.equal(presses.length, 1, 'pressed once, by the browser\'s click');
  assert.equal(presses[0].focus, remove, 'focused by the tap\'s own mousedown');
  assert.equal(remove.captured, null, 'a finger is never captured');
  presses[0].settle();
  document.activeElement = field;
  assert.equal(mouse('click', field), 'writing-body', 'the next click, on anything else, reaches what it is on');
});

test('a finger\'s tap whose Remove the page moved is taken from what slid under it: its mousedown focuses Remove, its click presses Remove once, and nothing else is pressed or focused', () => {
  const { presses, remove, field, moved } = pressedRemove();
  assert.deepEqual(fingerPress(remove, field, {}, moved), ['stopped', 'stopped', 'stopped'], 'the tap\'s mousedown, mouseup and click reach nothing under the finger');
  assert.equal(presses.length, 1, 'Remove is pressed, as the person pressed it');
  assert.equal(presses[0].focus, remove, 'focus left the reply field for Remove, as a tap on a Remove left in place moves it');
  assert.deepEqual(remove.focusedWith, { preventScroll: true }, 'focused without scrolling the page');
  presses[0].settle();
  assert.equal(mouse('click', field), 'writing-body', 'and only that tap: the next click reaches what it is on');
});

test('a finger\'s tap that went down on anything but an image button presses no image button the page moved under it, and reaches what it went down on when nothing moved', () => {
  const { presses, remove, field } = pressedRemove();
  assert.deepEqual(fingerPress(field, remove), ['stopped', 'stopped', 'stopped'], 'a tap that went down in the reply field, which the browser now aims at the Remove that slid under the finger, reaches nothing');
  assert.equal(presses.length, 0, 'Remove is not pressed');
  assert.equal(document.activeElement, field, 'and focus stays in the reply field, so the keyboard stays open');
  const add = new Node('button'); add.page = true; add.id = 'add-image';
  assert.deepEqual(fingerPress(add, remove), ['stopped', 'stopped', 'stopped'], 'nor one that went down on another button');
  assert.equal(presses.length, 0);
  assert.deepEqual(fingerPress(field, field), ['writing-body', 'writing-body', 'writing-body'], 'where nothing moved, the tap reaches the reply field');
  assert.deepEqual(fingerPress(add, add), ['add-image', 'add-image', 'add-image'], 'and the button it went down on');
  pointer('pointerdown', field, { pointerType: 'touch' }); pointer('pointercancel', field, { pointerType: 'touch' });
  assert.equal(mouse('click', remove), 'Remove', 'a finger press the browser sent no tap for takes nothing from the next click');
  assert.equal(presses.length, 1);
  const key = pressedRemove();
  pointer('pointerdown', key.field, { pointerType: 'touch' });
  assert.equal(mouse('click', key.remove, 0), 'Remove', 'a key\'s click on Remove is never taken for the tap');
  assert.equal(key.presses.length, 1);
});

test('a finger press the browser sends no tap for (a scroll took it, a long press) presses nothing and takes nothing from what comes next; a key\'s click is never taken', () => {
  const { presses, remove, field } = pressedRemove();
  assert.equal(fingerPress(remove, field, { cancel: true }), null);
  assert.equal(mouse('mousedown', field), 'writing-body', 'a cancelled finger press takes no later mousedown');
  assert.equal(mouse('click', field), 'writing-body');
  assert.equal(presses.length, 0, 'a cancelled press (a scroll took it) presses nothing');
  pointer('pointerdown', remove, { pointerType: 'touch' }); pointer('pointerup', remove, { pointerType: 'touch' });
  assert.equal(mouse('click', field, 0), 'writing-body', 'a key\'s click (detail 0) is never taken for a tap');
  pointer('pointerdown', field); assert.equal(mouse('mousedown', field), 'writing-body', 'a finger press with no tap is forgotten when the next press goes down');
  assert.equal(mouse('click', field), 'writing-body');
  assert.equal(presses.length, 0);
  pointer('pointerdown', remove, { button: 2 }); assert.equal(remove.captured, null, 'a right-button press is not captured');
  pointer('pointerdown', remove, { isPrimary: false, pointerType: 'touch' }); assert.equal(mouse('click', field), 'writing-body', 'nor is a second finger\'s press Remove\'s');
});

test('a press on Remove whose row went, or whose Remove was disabled meanwhile, presses nothing, and a moved tap\'s click still reaches nothing else', () => {
  const disabled = pressedRemove();
  assert.equal(fingerPress(disabled.remove, disabled.field, {}, () => disabled.paint([choice('a', 'Ready', [REMOVE])], false))[2], 'stopped');
  assert.equal(disabled.presses.length, 0, 'disabled: not pressed');
  const gone = pressedRemove();
  assert.deepEqual(fingerPress(gone.remove, gone.field, {}, () => gone.paint([])), ['stopped', 'stopped', 'stopped'], 'the tap of a Remove that went presses nothing under the finger');
  assert.equal(gone.presses.length, 0, 'its row is gone: not pressed');
  assert.equal(document.activeElement, gone.field, 'and focus stays where it was');
});

test('the new-topic page\'s touch guard leaves a tap on a button that holds its press to the browser, though the page moved it from under the finger, and still cancels a finger lifted off any other button', () => {
  const { remove, moved } = pressedRemove();
  const host = new Node('div'), other = new Node('button');
  other.place = { left: 100, top: 0, right: 160, bottom: 40 };
  protectTouchBounds(host);
  const lift = button => {
    const event = { target: { closest: () => button }, changedTouches: [{ clientX: 130, clientY: 20 }], prevented: false, preventDefault() { this.prevented = true; } };
    host.fire('touchend', event); return event.prevented;
  };
  moved();
  assert.equal(lift(remove), false, 'the moved Remove\'s tap is left to the browser');
  assert.equal(lift(other), false, 'a finger lifted on another button taps it');
  other.place = { left: 100, top: 38, right: 160, bottom: 78 };
  assert.equal(lift(other), true, 'a finger lifted off another button is cancelled, as before');
});

test('given a preview, a row holds its image small between its words and its buttons (shown first), so Remove is its last part, keeps it through a repaint with one read, and lets it go with the row', async t => {
  const made = [], freed = [], { createObjectURL, revokeObjectURL } = URL;
  URL.createObjectURL = blob => { made.push(blob); return 'blob:' + blob; };
  URL.revokeObjectURL = url => { freed.push(url); };
  t.after(() => Object.assign(URL, { createObjectURL, revokeObjectURL }));
  const host = new Node('div'), reads = [];
  host.page = true;
  const paint = choices => paintImageRows(host, choices, true, () => {}, id => { reads.push(id); return Promise.resolve(id + '-bytes'); });
  const settled = () => new Promise(resolve => setImmediate(resolve));
  paint([choice('a', 'Uploading')]);
  const row = host.children[0], [words, thumb, remove] = row.children;
  assert.deepEqual([words.textContent, thumb.className, thumb.dataset.key, remove.dataset.action], ['a.png · Uploading', 'image-thumb', 'a', 'Remove']);
  await settled();
  assert.deepEqual([thumb.src, thumb.hidden], ['blob:a-bytes', false], 'the image itself, made small');
  paint([choice('a', 'Could not attach', [RETRY, REMOVE])]);
  assert.deepEqual([row.firstElementChild.textContent, row.children[1], labels(row), row.children.at(-1), remove.moves, thumb.moves],
    ['a.png · Could not attach', thumb, ['Retry upload', 'Remove'], remove, 0, 0], 'the words follow the upload, a new button comes in after the thumbnail and before Remove, and nothing moves');
  assert.deepEqual(reads, ['a'], 'a repaint reads the image no second time');
  paint([]);
  await settled();
  assert.deepEqual([host.children.length, freed], [0, ['blob:a-bytes']], 'the row goes and its thumbnail is let go');
  // Without a preview, a row is its words and its buttons.
  const plain = rows();
  plain.paint([choice('b', 'Ready')]);
  assert.deepEqual(plain.host.children[0].children.map(child => child.tagName), ['span', 'button']);
});
