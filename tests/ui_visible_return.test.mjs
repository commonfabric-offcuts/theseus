// Focused routing evidence only. This DOM model does not prove native gestures,
// CSS painting, focus modality or physical touch/keyboard hardware.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageMenu } from '../web/message-menu.mjs';
import { Element } from './fixtures/mini_dom.mjs';
import { shell } from '../web/in-place-navigation.mjs';
import { panes } from '../web/panes.mjs';

function fixture({ useShell = false } = {}) {
  const listeners = [];
  const doc = { activeElement: null, addEventListener(type, fn, capture = false) { listeners.push({ type, fn, capture }); }, getSelection: () => ({ isCollapsed: true }) };
  const noObserver = class { observe() {} disconnect() {} };
  doc.defaultView = { innerWidth: 1280, innerHeight: 900, MutationObserver: noObserver, ResizeObserver: noObserver,
    addEventListener() {}, getComputedStyle: el => ({ display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible',
      outlineStyle: el.ring ? 'solid' : 'none', outlineWidth: el.ring ? '2px' : '0px', outlineColor: 'rgb(0, 0, 0)', boxShadow: 'none', ...el.css }) };
  function make(tag, cls = '', parent = null) {
    const el = new Element(tag, doc);
    Object.assign(el, { nodeType: 1, ownerDocument: doc, className: cls, style: {}, box: { left: 10, top: 50, right: 600, bottom: 150, width: 590, height: 100 } });
    Object.defineProperty(el, 'parentElement', { get() { return this.parent; } });
    el.contains = node => node === el || [...el.descendants()].includes(node);
    el.matches = selector => selector.split(',').some(raw => {
      let s = raw.trim();
      if (s.includes(' ')) { const bits = s.split(/\s+/); return el.matches(bits.at(-1)) && Boolean(el.parentElement?.closest(bits.slice(0, -1).join(' '))); }
      if (s.includes(':focus-visible')) { if (!el.focusVisible) return false; s = s.replace(':focus-visible', ''); }
      const tagName = s.match(/^[a-z][a-z0-9]*/i)?.[0];
      if (tagName && el.tag !== tagName) return false;
      if ([...s.matchAll(/\.([\w-]+)/g)].some(m => !el.classList.contains(m[1]))) return false;
      if ([...s.matchAll(/#([\w-]+)/g)].some(m => el.id !== m[1])) return false;
      for (const m of s.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)) {
        const value = m[1].startsWith('data-') ? el.dataset[m[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : el.getAttribute(m[1]);
        if (value == null || m[2] !== undefined && value !== m[2]) return false;
      }
      return true;
    });
    el.closest = selector => { for (let at = el; at; at = at.parentElement) if (at.matches(selector)) return at; return null; };
    el.querySelectorAll = selector => selector.split(',').flatMap(s => {
      s = s.trim();
      if (s.startsWith(':scope > ')) return el.children.filter(n => typeof n === 'object' && n.matches(s.slice(9)));
      return [...el.descendants()].filter(n => n.matches(s));
    });
    el.querySelector = selector => el.querySelectorAll(selector)[0] ?? null;
    el.getBoundingClientRect = () => el.box;
    el.getClientRects = () => el.checkVisibility() ? [el.box] : [];
    el.checkVisibility = () => !el.closest('[hidden]') && ![el, ...ancestors(el)].some(n => n.hidden || n.css?.visibility === 'hidden' || n.css?.opacity === '0');
    el.focus = () => { doc.activeElement = el; };
    parent?.append(el); return el;
  }
  function ancestors(el) { const all = []; for (let at = el.parentElement; at; at = at.parentElement) all.push(at); return all; }
  doc.createElement = tag => make(tag); doc.createElementNS = (_, tag) => make(tag);
  doc.body = make('body'); doc.body.root = true; doc.documentElement = doc.body;
  doc.querySelector = selector => doc.body.querySelector(selector);
  doc.getElementById = id => doc.body.querySelector('#' + id);
  const main = make('main', '', doc.body); main.id = 'main';
  const host = make('div', '', main); host.id = 'messages';
  const rail = make('aside', 'rail', doc.body); rail.id = 'rail';
  const link = make('a', '', rail); link.setAttribute('href', '?topic=B');
  const head = make('h1', '', main);
  const card = (id, parent = host) => { const el = make('article', 'message-card', parent); el.dataset.id = id; return el; };
  const a = card('A'), b = card('B');
  const section = make('section', 'reply-stack', host); section.dataset.stack = 'H'; section.dataset.headOpen = 'false';
  const toggle = make('button', 'stack-toggle', section);
  const h = card('H', section); h.classList.add('stack-head-card');
  const items = new Map(['A', 'B', 'H'].map(id => [id, { id }])), calls = [];
  const menu = new MessageMenu({ host, item: id => items.get(id), viewer: 'fixture', kind: 'human', doc, mac: true,
    reply: (id, card) => calls.push(['reply', id, card.dataset.id]), quote: (id, card, chosen) => calls.push(['quote', id, card.dataset.id, chosen]),
    ...(useShell ? {} : { write: () => calls.push(['write', null]) }) });
  // Bar geometry/reaction rendering is outside this contract; keep real light,
  // capture listener, key(), entryOf(), passages ownership and reply routing.
  menu.paintBar = () => {}; menu.passages.chosen = () => null;
  let native = 0;
  function press(extra = {}) {
    const event = { key: 'Enter', target: doc.activeElement, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    const handlers = listeners.filter(l => l.type === 'keydown');
    for (const l of handlers.filter(l => l.capture)) l.fn(event);
    if (!event.stopped) {
      for (const l of handlers.filter(l => !l.capture)) l.fn(event);
      if (!event.defaultPrevented && doc.activeElement?.matches('a[href],button')) native++;
    }
    return event;
  }
  doc.activeElement = head;
  const move = target => {
    for (const l of listeners.filter(l => l.type === 'pointermove')) l.fn({ target, pointerType: 'mouse', screenX: ++move.x, screenY: 10, buttons: 0 });
  };
  move.x = 0;
  return { doc, host, rail, link, head, a, b, h, toggle, section, menu, calls, press, make, move, native: () => native };
}

test('784 no outline: rail hover and unringed hidden focus open current sheet without activation', () => {
  for (const focus of ['head', 'link', 'a']) {
    const f = fixture(); f.doc.activeElement = f[focus];
    const e = f.press();
    assert.deepEqual(f.calls, [['write', null]], focus);
    assert.equal(e.defaultPrevented, true); assert.equal(f.native(), 0);
  }
});

test('784 current outlined message wins over stale focus, including a suppressed rail focus ring', () => {
  for (const focus of ['head', 'a', 'link', 'toggle']) {
    const f = fixture(); f.menu.light(f.b); f.doc.activeElement = f[focus];
    if (focus === 'link') { f.link.focusVisible = true; f.link.ring = false; }
    f.press();
    assert.deepEqual(f.calls, [['reply', 'B', 'B']], focus);
    assert.equal(f.native(), 0);
  }
});

test('784 selected and hovered dossier outline replies to its head, never rename or unfold', () => {
  for (const surface of ['head', 'toggle']) {
    const f = fixture();
    if (surface === 'head') { f.menu.light(f.h); f.doc.activeElement = f.h; }
    else f.doc.activeElement = f.toggle;
    f.press(); assert.deepEqual(f.calls, [['reply', 'H', 'H']], surface); assert.equal(f.native(), 0);
  }
});

test('784 a visible focus-ringed control keeps its own activation even with a lit message', () => {
  for (const tag of ['button', 'a']) {
    const f = fixture(), control = f.make(tag, '', f.a); control.setAttribute('href', '#target');
    f.menu.light(f.a); control.focusVisible = true; control.ring = true; control.focus();
    const e = f.press(); assert.equal(e.defaultPrevented, false); assert.deepEqual(f.calls, []); assert.equal(f.native(), 1);
  }
});

test('784 a rail link showing its actual focus ring keeps native navigation', () => {
  const f = fixture(); f.link.focusVisible = true; f.link.ring = true; f.link.focus();
  const e = f.press(); assert.equal(e.defaultPrevented, false); assert.equal(f.native(), 1); assert.deepEqual(f.calls, []);
});

test('784 text fields and editable descendants retain Return; no competing outlined reply', () => {
  for (const tag of ['textarea', 'input', 'select', 'editable']) {
    const f = fixture(), field = f.make(tag === 'editable' ? 'div' : tag, '', f.doc.body);
    if (tag === 'editable') field.setAttribute('contenteditable', 'true');
    f.menu.light(f.a); field.focus(); const e = f.press();
    assert.equal(e.defaultPrevented, false, tag); assert.deepEqual(f.calls, [], tag);
  }
  const f = fixture(), editable = f.make('div', '', f.doc.body), child = f.make('span', '', editable);
  editable.setAttribute('contenteditable', 'true'); f.menu.light(f.a); child.focus();
  const e = f.press(); assert.equal(e.defaultPrevented, false); assert.deepEqual(f.calls, []);
});

test('784 hidden, offscreen, clipped and inert outlines cannot take Return', () => {
  for (const state of ['hidden', 'offscreen', 'clipped', 'inert', 'transparent']) {
    const f = fixture(); f.menu.light(f.a);
    if (state === 'hidden') f.a.hidden = true;
    if (state === 'transparent') f.a.css = { opacity: '0' };
    if (state === 'offscreen') f.a.box = { left: 1, right: 100, top: -200, bottom: -100, width: 99, height: 100 };
    if (state === 'clipped') { f.host.css = { overflowY: 'auto' }; f.host.box = { top: 300, bottom: 400, left: 0, right: 800 }; }
    if (state === 'inert') f.a.setAttribute('inert', '');
    f.press(); assert.deepEqual(f.calls, [['write', null]], state);
  }
});

test('784 Return keeps selected-passage quote target and modifiers/IME/popup ownership', () => {
  const f = fixture(), chosen = { start: 1, end: 4, text: 'two', revision: 2 };
  f.menu.light(f.b); f.menu.passages.chosen = () => chosen; f.press();
  assert.deepEqual(f.calls, [['quote', 'B', 'B', chosen]]);
  for (const extra of [{ metaKey: true }, { shiftKey: true }, { altKey: true }, { ctrlKey: true }, { isComposing: true }, { defaultPrevented: true }]) {
    const g = fixture(); g.menu.light(g.a); g.press(extra); assert.deepEqual(g.calls, [], JSON.stringify(extra));
  }
  const g = fixture(), dialog = g.make('dialog', '', g.doc.body); dialog.setAttribute('open', '');
  g.menu.light(g.a); g.press(); assert.deepEqual(g.calls, []);
});

test('784 rail topic hover with unringed DOM focus cannot navigate on Return', () => {
  const f = fixture(); f.doc.activeElement = f.link;
  f.press(); assert.deepEqual(f.calls, [['write', null]]); assert.equal(f.native(), 0);
});

test('784 actual pointer routing lights a card or dossier; rail hover clears the card without selecting the topic', () => {
  for (const target of ['b', 'h', 'toggle']) {
    const f = fixture(); f.move(f[target]);
    assert.equal(target === 'toggle' ? f.doc.activeElement === f.toggle : f[target].classList.contains('lit'), true);
    f.press(); assert.deepEqual(f.calls, [['reply', target === 'b' ? 'B' : 'H', target === 'b' ? 'B' : 'H']]);
  }
  const f = fixture(); f.move(f.a); f.move(f.link);
  assert.equal(f.host.querySelector('.lit'), null, 'moving to the rail draws no message outline');
  f.press(); assert.deepEqual(f.calls, [['write', null]]); assert.equal(f.native(), 0);
});

test('784 default no-outline route uses the existing pencil sheet on this page, never shell.open', () => {
  const f = fixture({ useShell: true }), button = f.make('button', '', f.doc.body), sheet = f.make('dialog', '', f.doc.body), field = f.make('textarea', '', sheet);
  button.id = 'new-message'; sheet.id = 'new-message-sheet';
  let clicked = 0, drawerClosed = 0, rightLeft = 0;
  const main = f.host.parentElement; main.setAttribute('inert', ''); f.doc.activeElement = f.link;
  button.click = () => { assert.equal(main.getAttribute('inert'), null, 'the covering rail leaves before the pencil'); clicked++; sheet.open = true; field.focus(); };
  const before = Object.fromEntries(['doc', 'handles', 'moving', 'drawer', 'open'].map(name => [name, shell[name]]));
  const priorThings = panes.things;
  try {
    panes.things = { leave() { rightLeft++; main.removeAttribute('inert'); } };
    Object.assign(shell, { doc: f.doc, handles: {}, moving: false, drawer: { close() { drawerClosed++; } }, open() { assert.fail('Return must not navigate'); } });
    f.press(); assert.equal(clicked, 1); assert.equal(drawerClosed, 1); assert.equal(rightLeft, 1); assert.equal(sheet.open, true);
    assert.equal(f.doc.activeElement === field, true); assert.deepEqual(f.calls, []);
  } finally { Object.assign(shell, before); panes.things = priorThings; }
});

test('784 unringed rail focus over an inert feed opens New message, never the covered outline or rail topic', () => {
  const f = fixture(); f.menu.light(f.a); f.host.parentElement.setAttribute('inert', ''); f.doc.activeElement = f.link;
  f.press(); assert.deepEqual(f.calls, [['write', null]]); assert.equal(f.native(), 0);
});
