import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';
import { InlineComposer } from '../web/inline-composer.mjs';
import { ReaderLayout } from '../web/layout.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

// In-memory adapters only. New document + constructors stand for the page
// replacement/reload boundary: only Storage survives. Actual constructors,
// show/pop/applyLayout, width handlers and screen-preference owner run here.
// Unrelated message painting is stubbed; no product width bodies are copied.
// Rectangles model CSS's published bounds, not native layout or gestures.
const storage = () => {
  const data = new Map(), writes = [];
  return { data, writes, getItem: key => data.get(key) ?? null,
    setItem(key, value) { data.set(key, value); writes.push([key, value]); },
    removeItem(key) { data.delete(key); } };
};
const widthKey = (instance, surface) => JSON.stringify(['aim-next', instance, 'composer-width', surface]);
const globals = new WeakMap();
function page(t, kept, viewport = 1800, instance = 'width-instance', { denyGetter = false } = {}) {
  if (!globals.has(t)) {
    const previous = Object.fromEntries(['document', 'window', 'ResizeObserver', 'getComputedStyle'].map(key => [key, globalThis[key]]));
    globals.set(t, previous); t.after(() => Object.assign(globalThis, previous));
  }
  const doc = miniDocument(), make = doc.createElement;
  const observer = class { observe() {} disconnect() {} };
  const win = { innerWidth: viewport, localStorage: kept, ResizeObserver: observer, addEventListener() {}, scrollTo() {},
    matchMedia: () => ({ get matches() { return win.innerWidth <= 760; }, addEventListener() {} }),
    getComputedStyle: el => ({ fontSize: '16px', lineHeight: '24px', marginTop: '0px', marginBottom: '0px',
      getPropertyValue: () => el.dataset.layout === 'wide' ? '100rem' : '72rem' }) };
  if (denyGetter) Object.defineProperty(win, 'localStorage', { get() { throw Error('disabled'); } });
  doc.defaultView = win;
  doc.createElement = tag => {
    const el = make(tag), values = new Map(), events = new Map(), captured = new Set();
    el.ownerDocument = doc; el.scrollTop = 0; el.clientTop = 0;
    el.style = { setProperty: (key, value) => values.set(key, value), getPropertyValue: key => values.get(key) ?? '', removeProperty: key => values.delete(key) };
    el.addEventListener = (type, fn) => events.set(type, [...(events.get(type) ?? []), fn]);
    el.fire = (type, given = {}) => {
      const event = { target: el, pointerId: 1, button: 0, isPrimary: true, clientX: 100,
        preventDefault() {}, stopPropagation() {}, ...given };
      for (const fn of events.get(type) ?? []) fn(event);
    };
    el.setPointerCapture = id => captured.add(id); el.hasPointerCapture = id => captured.has(id); el.releasePointerCapture = id => captured.delete(id);
    el.showModal = el.show = () => { el.open = true; };
    el.close = () => { el.open = false; el.fire('close'); };
    el.before = () => {}; el.getClientRects = () => [el.getBoundingClientRect()];
    el.getBoundingClientRect = () => {
      const property = el.id === 'reader' ? `--composer-width-${el.dataset.layout === 'wide' ? 'wide' : 'stacked'}` : '--composer-width';
      const maximum = win.innerWidth <= 760 ? win.innerWidth : Math.min(el.dataset.layout === 'wide' ? 1600 : 1152, win.innerWidth - 48);
      const choice = parseFloat(values.get(property)) || maximum;
      return { width: Math.min(maximum, Math.max(Math.min(maximum, win.innerWidth <= 760 ? 280 : 760), choice)), height: 400, top: 0, bottom: 400 };
    };
    const select = el.querySelector.bind(el);
    el.querySelector = selector => selector.startsWith('#') ? doc.byId(selector.slice(1)) : select(selector);
    return el;
  };
  doc.querySelector = selector => doc.byId(selector.slice(1));
  doc.documentElement = doc.createElement('html'); doc.body = doc.createElement('body');
  const dialog = doc.byId('reader'); doc.body.append(dialog);
  Object.assign(globalThis, { document: doc, window: win, ResizeObserver: observer, getComputedStyle: win.getComputedStyle });
  // Width wiring is in the real constructor, outside bind. Input, message
  // menus and source painting are unrelated to this screen preference.
  class WidthReader extends Reader { bind() {} }
  const reader = new WidthReader({});
  for (const name of ['notice', 'disarm', 'paintTitle', 'paintOrigin', 'drawSource', 'drawAttachments', 'drawEditor', 'paintPending', 'rememberPlace', 'moveTo']) reader[name] = () => {};
  const inline = new InlineComposer({ instanceId: instance });
  for (const name of ['drawEditor', 'paintRecipients', 'paintStatus', 'paintChoice']) inline[name] = () => {};
  inline.bar = { writes() {}, fit() {}, fold() {} };
  const reply = { context: { instanceId: instance, topicId: 'topic' }, draft: { body: '', addressees: [], attachments: [] } };
  const source = { source_ref: { kind: 'message', id: 'message' }, topic_id: 'topic', body: '' };
  const openReader = () => reader.show(source, { reply });
  const openNew = () => { inline.show({ topic: { id: 'topic', title: 'Topic' }, editors: { reply } }); inline.pop(); };
  const width = el => el.getBoundingClientRect().width;
  const drag = (el, delta) => {
    const edge = el.children.find(child => child.dataset.edge === 'left');
    edge.fire('pointerdown'); edge.fire('pointermove', { clientX: 100 + delta }); edge.fire('pointerup', { clientX: 100 + delta });
  };
  const arrow = (el, key, extra = {}) => el.children.find(child => child.dataset.edge === 'left').fire('keydown', { key, ...extra });
  return { doc, win, reader, inline, dialog, reply, sheet: inline.sheet, openReader, openNew, width, drag, arrow };
}

test('872 three widths survive actual surface reconstruction and another reload independently', t => {
  const kept = storage(), first = page(t, kept);
  first.openReader(); first.drag(first.dialog, 76); assert.equal(first.width(first.dialog), 1000);
  first.reader.toggleLayout(); first.drag(first.dialog, 100); assert.equal(first.width(first.dialog), 1400);
  first.openNew(); first.drag(first.sheet, 126); assert.equal(first.width(first.sheet), 900);
  for (const boundary of ['page replacement', 'reload']) {
    const next = page(t, kept); next.openReader(); next.openNew();
    assert.equal(next.width(next.dialog), 1400, `${boundary}: Wide choice restored`);
    assert.equal(next.width(next.sheet), 900, `${boundary}: New message choice restored`);
    next.reader.toggleLayout(); assert.equal(next.width(next.dialog), 1000, `${boundary}: Stacked choice restored`);
    next.reader.toggleLayout();
  }
  assert.equal(kept.data.get(widthKey('width-instance', 'reader-stacked')), '1000');
  assert.equal(kept.data.get(widthKey('width-instance', 'reader-wide')), '1400');
  assert.equal(kept.data.get(widthKey('width-instance', 'new-message')), '900');
});

test('872 desktop clamps restore against current window and CSS bounds without changing saved choice', t => {
  const kept = storage(), first = page(t, kept); first.openReader(); first.drag(first.dialog, 76);
  first.reader.toggleLayout(); first.drag(first.dialog, 100); first.openNew(); first.drag(first.sheet, 126);
  const writes = kept.writes.length, smaller = page(t, kept, 800); smaller.openReader(); smaller.openNew();
  assert.equal(smaller.width(smaller.dialog), 752); assert.equal(smaller.width(smaller.sheet), 752);
  smaller.reader.toggleLayout(); assert.equal(smaller.width(smaller.dialog), 752);
  assert.equal(kept.writes.length, writes + 1, 'only the explicit mode toggle writes; clamps never write widths');
  const larger = page(t, kept); larger.openReader(); larger.openNew();
  assert.equal(larger.width(larger.dialog), 1000); larger.reader.toggleLayout(); assert.equal(larger.width(larger.dialog), 1400);
  assert.equal(larger.width(larger.sheet), 900);
});

for (const viewport of [390, 760]) test(`872 phone ${viewport} opens full each time, narrows until close, and never saves`, t => {
  const kept = storage(), desktop = page(t, kept); desktop.openReader(); desktop.drag(desktop.dialog, 76);
  desktop.reader.toggleLayout(); desktop.drag(desktop.dialog, 100); desktop.openNew(); desktop.drag(desktop.sheet, 126);
  const data = [...kept.data], writes = kept.writes.length, phone = page(t, kept, viewport);
  phone.openReader(); phone.openNew();
  for (const el of [phone.dialog, phone.sheet]) {
    assert.equal(phone.width(el), viewport);
    phone.drag(el, 16); assert.equal(phone.width(el), viewport - 32, '650 inward drag remains');
    phone.arrow(el, 'ArrowRight'); assert.equal(phone.width(el), Math.max(280, viewport - 64), '650 arrow remains');
  }
  phone.reader.applyLayout(); assert.equal(phone.width(phone.dialog), Math.max(280, viewport - 64), 'ordinary redraw preserves active phone narrowing');
  assert.deepEqual([...kept.data], data); assert.equal(kept.writes.length, writes, 'phone gestures write no preferences');
  phone.dialog.close(); phone.sheet.close(); phone.openReader(); phone.openNew();
  assert.equal(phone.width(phone.dialog), viewport, 'Reader reopens full'); assert.equal(phone.width(phone.sheet), viewport, 'New message reopens full');
  const returned = page(t, kept); returned.openReader(); returned.openNew();
  assert.equal(returned.width(returned.dialog), 1400); returned.reader.toggleLayout(); assert.equal(returned.width(returned.dialog), 1000);
  assert.equal(returned.width(returned.sheet), 900);
});

test('872 desktop arrow choices persist, modified arrows do not write, and instances are separate', t => {
  const kept = storage(), first = page(t, kept); first.openReader(); first.arrow(first.dialog, 'ArrowRight');
  first.openNew(); first.arrow(first.sheet, 'ArrowRight');
  const writes = kept.writes.length;
  for (const key of ['metaKey', 'ctrlKey', 'altKey']) first.arrow(first.dialog, 'ArrowRight', { [key]: true });
  assert.equal(kept.writes.length, writes);
  const rebuilt = page(t, kept); rebuilt.openReader(); rebuilt.openNew();
  assert.equal(rebuilt.width(rebuilt.dialog), 1120); assert.equal(rebuilt.width(rebuilt.sheet), 1120);
  const other = page(t, kept, 1800, 'other-instance'); other.openReader(); other.openNew();
  assert.equal(other.width(other.dialog), 1152); assert.equal(other.width(other.sheet), 1152);
});

test('872 unavailable Storage keeps choices in the current owner and never prevents opening', t => {
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  const first = page(t, denied); first.openReader(); first.drag(first.dialog, 76); first.openNew(); first.drag(first.sheet, 126);
  first.dialog.close(); first.sheet.close(); first.openReader(); first.openNew();
  assert.equal(first.width(first.dialog), 1000); assert.equal(first.width(first.sheet), 900);
  const next = page(t, denied); next.openReader(); next.openNew();
  assert.equal(next.width(next.dialog), 1152); assert.equal(next.width(next.sheet), 1152);
});

test('872 embedded reply and Notebook never save width or change the floating choice', t => {
  const kept = storage(), first = page(t, kept); first.openReader(); first.drag(first.dialog, 76); first.openNew(); first.drag(first.sheet, 126);
  const writes = kept.writes.length;
  first.dialog.dataset.cardReply = ''; first.reader.syncWidthPlacement(); first.sheet.classList.add('notebook-mode');
  for (const el of [first.dialog, first.sheet]) { first.drag(el, 50); first.arrow(el, 'ArrowRight'); }
  assert.equal(kept.writes.length, writes);
  delete first.dialog.dataset.cardReply; first.reader.syncWidthPlacement(); first.sheet.classList.remove('notebook-mode');
  const next = page(t, kept); next.openReader(); next.openNew();
  assert.equal(next.width(next.dialog), 1000); assert.equal(next.width(next.sheet), 900);
});

test('872 missing and malformed preferences preserve current defaults without repair writes', t => {
  for (const value of [null, '', 'NaN', 'Infinity', '-1', '0', '900px']) {
    const kept = storage();
    if (value !== null) for (const name of ['reader-stacked', 'reader-wide', 'new-message']) kept.data.set(widthKey('width-instance', name), value);
    const current = page(t, kept); current.openReader(); current.openNew();
    assert.equal(current.width(current.dialog), 1152); assert.equal(current.width(current.sheet), 1152);
    current.reader.toggleLayout(); assert.equal(current.width(current.dialog), 1600);
    assert.equal(kept.writes.length, 1, 'only explicit mode choice writes');
  }
});

test('872 screen preferences alone own width records, with exact instance and surface keys', () => {
  const kept = storage(), first = new ReaderLayout('one', kept);
  assert.equal(typeof first.setWidth, 'function', 'the screen-preference owner provides the width write');
  first.setWidth('reader-stacked', 1000); first.setWidth('reader-wide', 1400); first.setWidth('new-message', 900);
  for (const value of [0, -1, NaN, Infinity, '900']) first.setWidth('reader-stacked', value);
  first.setWidth('unknown', 800);
  assert.deepEqual(kept.writes, [
    [widthKey('one', 'reader-stacked'), '1000'], [widthKey('one', 'reader-wide'), '1400'], [widthKey('one', 'new-message'), '900'],
  ]);
  const reconstructed = new ReaderLayout('one', kept), other = new ReaderLayout('two', kept);
  for (const [name, value] of [['reader-stacked', 1000], ['reader-wide', 1400], ['new-message', 900]]) {
    assert.equal(reconstructed.width(name), value); assert.equal(other.width(name), null);
  }
});

test('872 valid extreme preferences clamp to current bounds without rewriting records', t => {
  for (const [choice, expected] of [[1, 760], [9000, 1152]]) {
    const kept = storage();
    for (const name of ['reader-stacked', 'reader-wide', 'new-message']) kept.data.set(widthKey('width-instance', name), String(choice));
    const current = page(t, kept); current.openReader(); current.openNew();
    assert.equal(current.width(current.dialog), expected); assert.equal(current.width(current.sheet), expected);
    assert.equal(current.dialog.style.getPropertyValue('--composer-width-stacked'), `${expected}px`, 'Reader restores the bounded choice');
    assert.equal(current.sheet.style.getPropertyValue('--composer-width'), `${expected}px`, 'New message restores the bounded choice');
    current.reader.toggleLayout();
    assert.equal(current.width(current.dialog), choice === 1 ? 760 : 1600);
    assert.equal(kept.writes.length, 1, 'only mode choice writes');
    for (const name of ['reader-stacked', 'reader-wide', 'new-message']) assert.equal(kept.data.get(widthKey('width-instance', name)), String(choice));
  }
});

test('872 a reused surface changing instance clears prior choices; unavailable New message still uses bootstrap identity', t => {
  const kept = storage(), current = page(t, kept); current.openReader(); current.drag(current.dialog, 76);
  current.openNew(); current.drag(current.sheet, 126);
  current.reply.context.instanceId = 'other-instance'; current.dialog.close(); current.sheet.close(); current.openReader(); current.openNew();
  assert.equal(current.width(current.dialog), 1152); assert.equal(current.width(current.sheet), 1152);
  const unavailable = page(t, kept); unavailable.inline.fail('Not loaded'); unavailable.inline.pop();
  assert.equal(unavailable.width(unavailable.sheet), 900, 'startup refusal still restores the browser/instance preference');
  unavailable.arrow(unavailable.sheet, 'ArrowRight');
  assert.equal(kept.data.get(widthKey('width-instance', 'new-message')), '868');
});

test('872 denied localStorage getter does not prevent opening or keeping a current-page choice', t => {
  const current = page(t, null, 1800, 'width-instance', { denyGetter: true });
  current.openReader(); current.drag(current.dialog, 76); current.dialog.close(); current.openReader();
  assert.equal(current.width(current.dialog), 1000);
  const inline = current.inline; inline.fail('Unavailable'); inline.pop();
  current.drag(inline.sheet, 126); inline.sheet.close(); inline.pop();
  assert.equal(current.width(inline.sheet), 900);
});
