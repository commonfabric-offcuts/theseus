import test from 'node:test';
import assert from 'node:assert/strict';
import { ThingsRail, SECTIONS, SectionFolds } from '../web/things-rail.mjs';
import { KeyTree } from '../web/key-tree.mjs';
import { panes } from '../web/panes.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

// Real rail builder/actions with bounded DOM/pane ports. No gesture/layout claim.
function fixture(t) {
  const doc = miniDocument(), make = doc.createElement;
  doc.createElement = tag => {
    const el = make(tag);
    Object.defineProperties(el, { parentElement: { get: () => el.parent }, ownerDocument: { get: () => doc } });
    el.checkVisibility = () => !el.hidden;
    el.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 500, width: 500, height: 500 });
    return el;
  };
  doc.body = doc.createElement('body'); doc.body.root = true; doc.defaultView = { innerWidth: 1280, innerHeight: 800,
    getComputedStyle: () => ({ overflowY: 'visible' }), scrollBy() {} };
  const main = doc.createElement('main'); main.id = 'main'; const feed = doc.createElement('button'); main.append(feed); doc.body.append(main);
  doc.getElementById = id => id === 'main' ? main : null;
  const host = doc.createElement('aside'); doc.body.append(host);
  const store = new Map(), rail = Object.assign(Object.create(ThingsRail.prototype), {
    doc, host, close() {}, reload() {}, folds: new SectionFolds({ getItem: k => store.get(k), setItem: (k,v) => store.set(k,v) }, 'folds996'),
  });
  rail.build(); host.hidden = false;
  for (const part of rail.sections.values()) {
    part.details.hidden = false; part.details.open = true;
    const link = doc.createElement('a'); link.setAttribute('href', '?page=actual-row'); part.body.append(link);
  }
  const pencil = doc.createElement('button'); pencil.className = 'notebook-create';
  rail.sections.get('notebook').details.querySelector(':scope > summary').append(pencil);
  rail.tree = { list: () => rail.treeRows(), go: row => row?.el.focus(), stepOut: KeyTree.prototype.stepOut, stepIn: KeyTree.prototype.stepIn };
  const previous = { things: panes.things, notebook: panes.notebook, feed: panes.feed };
  Object.assign(panes, { things: { leave() {} }, notebook: null, feed: () => { feed.focus(); return true; } });
  t.after(() => Object.assign(panes, previous));
  return { doc, rail, feed, pencil, part: name => rail.sections.get(name) };
}
function key(target, name, more = {}) {
  return { target, key: name, ...more, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
}

for (const [name] of SECTIONS) test('996 Left from ' + name + ' row or header lands in feed without folding', t => {
  const f = fixture(t), part = f.part(name), rows = f.rail.treeRows();
  for (const row of rows.filter(row => row.el === part.details.querySelector(':scope > summary') || row.el.parentElement === part.body)) {
    row.el.focus(); f.rail.act('left', row, rows);
    assert.ok(f.doc.activeElement === f.feed, 'one Left reaches the feed'); assert.equal(part.details.open, true);
  }
});

test('996 every shown section has an independent chevron with shared glyph and real body identity', t => {
  const f = fixture(t);
  for (const [name, part] of f.rail.sections) {
    const button = part.details.querySelector('.things-disclosure'); assert.ok(button, name);
    assert.equal(button.tagName, 'BUTTON'); assert.equal(button.tabIndex, 0);
    assert.equal(button.getAttribute('aria-controls'), part.body.id); assert.ok(part.body.id);
    assert.equal(button.querySelector('svg').getAttribute('data-glyph'), 'chevron');
    button.focus(); assert.equal(part.details.open, true, 'arrival never changes disclosure');
  }
});

test('996 disclosure Return and Space toggle once and modified/repeated keys do not toggle', t => {
  const f = fixture(t), part = f.part('notebook'), button = part.details.querySelector('.things-disclosure'); assert.ok(button);
  for (const name of ['Enter', ' ']) {
    const before = part.details.open, event = key(button, name); button.onkeydown(event);
    assert.equal(part.details.open, !before); assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
    button.onkeydown(key(button, name, { repeat: true })); assert.equal(part.details.open, !before);
    button.onkeydown(key(button, name, { metaKey: true })); assert.equal(part.details.open, !before);
  }
});

test('996 disclosure Down reaches its first item, Right reaches Notebook pencil, and Left leaves directly', t => {
  const f = fixture(t), part = f.part('notebook'), button = part.details.querySelector('.things-disclosure'); assert.ok(button);
  button.onkeydown(key(button, 'ArrowDown')); assert.ok(f.doc.activeElement === part.body.querySelector('a'));
  button.onkeydown(key(button, 'ArrowRight')); assert.ok(f.doc.activeElement === f.pencil);
  button.onkeydown(key(button, 'ArrowLeft')); assert.ok(f.doc.activeElement === f.feed); assert.equal(part.details.open, true);
});

test('996 inset Notebook pencil Left goes directly to feed and pointer disclosure keeps its own fold', t => {
  const f = fixture(t), part = f.part('notebook'), summary = part.details.querySelector(':scope > summary');
  summary.onkeydown?.(key(f.pencil, 'ArrowLeft')); assert.ok(f.doc.activeElement === f.feed);
  const button = part.details.querySelector('.things-disclosure'); assert.ok(button);
  const event = key(button, 'click', { button: 0 }); button.onclick(event); assert.equal(part.details.open, false); assert.equal(event.stopped, true);
});
