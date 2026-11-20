// Actual message-bar owners on an in-memory DOM. Native pointer/keyboard
// gestures remain a separate check; no store, server or browser is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageMenu } from '../web/message-menu.mjs';
import { mayEdit } from '../web/message-edit-writing.mjs';
import { miniDocument, matches } from './fixtures/mini_dom.mjs';

function fixture({ author = 'person890', kind = 'human', unavailable = false, reached = false } = {}) {
  const doc = miniDocument(), create = doc.createElement;
  doc.createElement = tag => {
    const n = create(tag); n.style = {}; n.tabIndex = 0;
    n.contains = child => n === child || [...n.descendants()].includes(child);
    n.matches = selector => matches(n, selector);
    n.getClientRects = () => n.hidden ? [] : [{}];
    Object.defineProperty(n, 'parentElement', { get: () => n.parent });
    return n;
  };
  doc.body = doc.createElement('body'); doc.body.root = true;
  // A unique marked source proves that glyph() borrows New message's SVG.
  // Shape inventory is held by the existing shared glyph tests, not copied here.
  doc.getElementById = id => id === 'new-message' ? { querySelector: () => ({ cloneNode(deep) {
    assert.equal(deep, true); const clone = doc.createElement('svg'); clone.setAttribute('data-source', 'new-message-890'); return clone;
  } }) } : null;
  const host = doc.createElement('section'), card = doc.createElement('div');
  card.className = 'message-card'; card.dataset.id = 'm890'; host.append(card); doc.body.append(host);
  const query = card.querySelector.bind(card);
  card.querySelector = selector => selector.includes(' > ') && !selector.startsWith(':scope > .message-preview') ? null : query(selector);
  const rights = { actor: 'person890', actorKind: kind, unavailable, reached }, calls = [];
  const item = { id: 'm890', topic_id: 't890', author_id: author, body: 'Exact own words' };
  let offered = true;
  const menu = Object.assign(Object.create(MessageMenu.prototype), { doc, host, viewer: rights.actor, kind, lit: card,
    item: id => id === item.id ? item : null, barless: () => false, clipped: () => false, foldState: () => null, behind: new Set(), place() {},
    acted: id => calls.push(['acted', id]), claim: () => {},
    editChoice: (source, anchor) => offered && mayEdit(source, rights) ? { label: 'Edit', glyph: 'pencil', act: () => calls.push(['edit', source.id, anchor]) } : null,
    inlineReply: (id, anchor) => calls.push(['reply', id, anchor]), more: () => calls.push(['more']) });
  menu.bar = menu.buildBar(); menu.paintBar();
  return { doc, host, card, menu, item, rights, calls, offer: value => { offered = value; } };
}
const visible = menu => Object.values(menu.buttons).filter(button => !button.hidden).map(button => button.dataset.act);
const pressTab = (menu, shiftKey = false) => {
  const e = { key: 'Tab', shiftKey, preventDefault() { this.prevented = true; } }; menu.tab(e); return e;
};

test('890 own editable bar starts with the shared pencil before Reply and More', () => {
  const f = fixture(); assert.deepEqual(visible(f.menu), ['edit', 'reply', 'more']);
  const pencil = f.menu.buttons.edit;
  assert.equal(pencil.title, 'Edit'); assert.equal(pencil.getAttribute('aria-label'), 'Edit');
  assert.equal(pencil.children[0].getAttribute('data-glyph'), 'pencil');
  assert.equal(pencil.children[0].getAttribute('data-source'), 'new-message-890');
  assert.equal(pencil.children[0].getAttribute('aria-hidden'), 'true');
});
test('890 Edit precedes every other offered bar control in DOM and keyboard order', () => {
  const f = fixture(); f.doc.activeElement = f.card;
  assert.equal(pressTab(f.menu).prevented, true);
  assert.equal(f.doc.activeElement.dataset.act, 'edit');
  pressTab(f.menu); assert.equal(f.doc.activeElement.dataset.act, 'reply');
  pressTab(f.menu, true); assert.equal(f.doc.activeElement.dataset.act, 'edit');
  pressTab(f.menu, true); assert.equal(f.doc.activeElement === f.card, true);
});
for (const [label, options] of [['other author', { author: 'other890' }], ['agent reader', { kind: 'agent' }], ['unavailable', { unavailable: true }], ['reached', { reached: true }]]) {
  test('890 Edit is absent for ' + label, () => {
    const f = fixture(options); assert.equal(visible(f.menu).includes('edit'), false); f.menu.act('edit');
    assert.deepEqual(f.calls.filter(([name]) => name === 'edit'), []);
  });
}
test('890 pencil invokes the supplied shared Edit action with its current item and card', () => {
  const f = fixture(); assert.equal(typeof f.menu.buttons.edit?.onclick, 'function');
  f.menu.buttons.edit.onclick();
  assert.equal(f.calls.filter(([name]) => name === 'edit').length, 1);
  assert.equal(f.calls.at(-1)[1], 'm890'); assert.equal(f.calls.at(-1)[2] === f.card, true);
});
test('890 a stale pencil rechecks shared availability and current author at activation', () => {
  for (const change of ['menu removed Edit', 'author changed', 'access lost', 'outcome reached']) {
    const f = fixture(); assert.equal(typeof f.menu.buttons.edit?.onclick, 'function');
    const stale = f.menu.buttons.edit.onclick;
    if (change === 'menu removed Edit') f.offer(false);
    if (change === 'author changed') f.item.author_id = 'other890';
    if (change === 'access lost') f.rights.unavailable = true;
    if (change === 'outcome reached') f.rights.reached = true;
    stale(); assert.deepEqual(f.calls.filter(([name]) => name === 'edit'), [], change);
    assert.equal(visible(f.menu).includes('edit'), false, change + ': the stale press itself repaints');
  }
});
