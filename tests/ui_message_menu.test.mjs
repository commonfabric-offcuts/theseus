// A message's menu (docs/links.md, "A message's menu"), below the browser: what
// it lists, where it sits, how keys and presses move and close it, the words
// the ⋯ says after Copy Link, and the clipboard's answer. The native checks in
// tests/links_native.mjs press it in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openMessageMenu, sayOn, copyText } from '../web/message-menu.mjs';
import { Element, miniDocument } from './fixtures/mini_dom.mjs';

// A document whose elements have boxes and styles, listening on the way down
// as the menu does, with a window of a given size.
function page({ width = 1440, height = 900 } = {}) {
  const doc = miniDocument(), listeners = [];
  doc.addEventListener = (type, fn, capture) => { assert.equal(capture, true, 'heard on the way down'); listeners.push({ type, fn }); };
  doc.removeEventListener = (type, fn) => { const at = listeners.findIndex(l => l.type === type && l.fn === fn); if (at >= 0) listeners.splice(at, 1); };
  doc.fire = (type, event) => { for (const { fn } of listeners.filter(l => l.type === type)) fn(event); };
  doc.listening = () => listeners.length;
  doc.body = doc.byId('body');
  const make = doc.createElement;
  doc.createElement = tag => Object.assign(make(tag), { style: {}, offsetWidth: 140, offsetHeight: 90 });
  Element.prototype.contains ??= function contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; };
  Element.prototype.getBoundingClientRect ??= function box() { return this.box ?? { top: 0, left: 0, right: 0, bottom: 0 }; };
  const win = { innerWidth: width, innerHeight: height };
  const anchor = Object.assign(doc.createElement('button'), { box: { top: 100, bottom: 136, left: 900, right: 936 } });
  doc.body.append(anchor);
  return { doc, win, anchor };
}
const key = (root, name) => {
  const event = { key: name, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
  root.listeners.keydown(event); return event;
};
const tap = button => button.onclick({ stopPropagation() {} });
const labels = menu => menu.root.children.map(button => button.textContent);

test('a message\'s menu lists its items in order as a menu, takes the focus, and one tap does that item and closes it, giving the focus back', () => {
  const { doc, win, anchor } = page(), done = [];
  const menu = openMessageMenu({ anchor, items: [{ label: 'Copy Link', act: () => done.push('copy') }, { label: 'Mark unread', act: () => done.push('mark') }], label: 'This message', doc, win });
  assert.deepEqual(labels(menu), ['Copy Link', 'Mark unread']);
  assert.deepEqual([menu.root.getAttribute('role'), menu.root.getAttribute('aria-label'), menu.root.children.map(b => b.getAttribute('role'))], ['menu', 'This message', ['menuitem', 'menuitem']]);
  assert.equal(menu.root.parent, doc.body, 'outside a dialog it belongs to the page');
  assert.equal(anchor.getAttribute('aria-expanded'), 'true');
  assert.equal(doc.activeElement, menu.root.children[0], 'the first item has the focus');
  tap(menu.root.children[1]);
  assert.deepEqual(done, ['mark'], 'that item, once');
  assert.deepEqual([menu.root.parent, anchor.getAttribute('aria-expanded'), doc.activeElement, doc.listening()], [null, 'false', anchor, 0], 'closed, the focus back, nothing left listening');
});

test('Up and Down step through a menu and wrap, Home and End go to its ends, and Escape or Tab closes it and gives the focus back', () => {
  for (const closing of ['Escape', 'Tab']) {
    const { doc, win, anchor } = page();
    const menu = openMessageMenu({ anchor, items: ['A', 'B', 'C'].map(label => ({ label, act: () => assert.fail('no item is chosen') })), doc, win });
    const at = () => menu.root.children.indexOf(doc.activeElement);
    const steps = [];
    for (const name of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'End', 'Home', 'ArrowUp']) { assert.equal(key(menu.root, name).prevented, true, name); steps.push(at()); }
    assert.deepEqual(steps, [1, 2, 0, 2, 2, 0, 2]);
    assert.equal(key(menu.root, 'x').prevented, false, 'any other key is the page\'s');
    assert.equal(key(menu.root, closing).prevented, true);
    assert.deepEqual([menu.root.parent, doc.activeElement], [null, anchor], closing + ' closes it and gives the focus back');
  }
});

test('a press outside closes a menu and leaves the focus where it lands; the same ⋯ pressed again closes it; another opening closes the first', () => {
  const { doc, win, anchor } = page(), outside = doc.createElement('p'), items = [{ label: 'Copy Link', act() {} }];
  doc.body.append(outside);
  let menu = openMessageMenu({ anchor, items, doc, win });
  doc.fire('pointerdown', { target: menu.root.children[0] });
  doc.fire('pointerdown', { target: anchor });
  assert.equal(menu.root.parent, doc.body, 'a press on the menu, or on the ⋯ that opened it, is not outside');
  doc.fire('pointerdown', { target: outside });
  assert.equal(menu.root.parent, null);
  assert.notEqual(doc.activeElement, anchor, 'the focus is not pulled back from where the press went');
  menu = openMessageMenu({ anchor, items, doc, win });
  assert.equal(openMessageMenu({ anchor, items, doc, win }), null, 'the ⋯ again closes it');
  assert.deepEqual([menu.root.parent, doc.activeElement], [null, anchor]);
  const first = openMessageMenu({ anchor, items, doc, win });
  const card = Object.assign(doc.createElement('button'), { box: { top: 300, bottom: 400, left: 200, right: 1000 } });
  doc.body.append(card);
  const second = openMessageMenu({ anchor: card, at: { x: 500, y: 350 }, items, doc, win });
  assert.deepEqual([first.root.parent, second.root.parent], [null, doc.body], 'one menu is open at a time');
  // A right-click on the card again opens it where the pointer now is.
  const third = openMessageMenu({ anchor: card, at: { x: 520, y: 360 }, items, doc, win });
  assert.deepEqual([second.root.parent, third.root.style.left, third.root.style.top], [null, '520px', '360px']);
  assert.equal(openMessageMenu({ anchor, items: [], doc, win }), null, 'nothing to offer opens nothing');
  assert.equal(third.root.parent, null);
});

test('a menu sits under its ⋯ with their right edges lined up, above it when there is no room below, at the pointer for a right-click, and always inside the window', () => {
  const place = (box, options = {}, size = {}) => {
    const { doc, win, anchor } = page(size); anchor.box = box;
    const { root } = openMessageMenu({ anchor, items: [{ label: 'Copy Link', act() {} }], doc, win, ...options });
    return [root.style.position, root.style.left, root.style.top];
  };
  assert.deepEqual(place({ top: 100, bottom: 136, left: 900, right: 936 }), ['fixed', '796px', '140px'], 'under it: 936 - 140 wide, 4 below');
  assert.deepEqual(place({ top: 800, bottom: 836, left: 900, right: 936 }), ['fixed', '796px', '706px'], 'above it: 800 - 4 - 90 high');
  assert.deepEqual(place({ top: 10, bottom: 46, left: 900, right: 936 }, {}, { height: 120 }), ['fixed', '796px', '50px'], 'no room above either: under it');
  assert.deepEqual(place({ top: 100, bottom: 136, left: 4, right: 40 }), ['fixed', '8px', '140px'], 'never past the left edge');
  assert.deepEqual(place({ top: 300, bottom: 400, left: 0, right: 1440 }, { at: { x: 1400, y: 320 } }), ['fixed', '1292px', '320px'], 'at the pointer, kept inside the right edge');
  assert.deepEqual(place({ top: 300, bottom: 400, left: 0, right: 390 }, { at: { x: 30, y: 820 } }, { width: 390, height: 844 }), ['fixed', '30px', '730px'], 'at the pointer near the bottom: above it');
});

test('inside the Reader a menu belongs to the Reader\'s dialog, so it shows above the page', () => {
  const { doc, win, anchor } = page(), dialog = doc.createElement('dialog');
  dialog.attributes.open = ''; doc.body.append(dialog); dialog.append(anchor);
  const { root } = openMessageMenu({ anchor, items: [{ label: 'Wide layout', act() {} }], doc, win });
  assert.equal(root.parent, dialog);
});

test('the ⋯ says what was just done until the next press has landed or a key is pressed anywhere, then shows ⋯ again', () => {
  const { doc, anchor } = page();
  anchor.textContent = '⋯';
  sayOn(anchor, 'Link copied', doc);
  assert.deepEqual([anchor.textContent, anchor.classList.contains('said')], ['Link copied', true]);
  sayOn(anchor, 'Link copied', doc);
  doc.fire('keydown', {});
  assert.deepEqual([anchor.textContent, anchor.classList.contains('said'), doc.listening()], ['⋯', false, 0], 'said twice, still ⋯ after one key');
  sayOn(anchor, 'Link copied', doc);
  doc.fire('pointerdown', { target: anchor });
  assert.equal(anchor.textContent, 'Link copied', 'a press that has only started keeps the words, so it lands on the button they size');
  doc.fire('click', { target: anchor });
  assert.deepEqual([anchor.textContent, doc.listening()], ['⋯', 0], 'the press landed: ⋯ again');
});

test('copying answers whether the words are on the clipboard', async () => {
  const written = [];
  assert.equal(await copyText('https://a.example/?topic=t&message=m', { clipboard: { writeText: async text => { written.push(text); } } }), true);
  assert.deepEqual(written, ['https://a.example/?topic=t&message=m']);
  assert.equal(await copyText('x', { clipboard: { writeText: async () => { throw Error('NotAllowedError'); } } }), false);
  assert.equal(await copyText('x', {}), false, 'no clipboard here');
});
