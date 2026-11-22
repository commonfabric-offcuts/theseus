import test from 'node:test';
import assert from 'node:assert/strict';
import { revealSelection } from '../web/reveal.mjs';
import { ThingsRail } from '../web/things-rail.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

// Bounded geometry ports exercise real scroll/routing decisions, not native layout.
function revealFixture({ hidden = false, overlap = true, inside = false } = {}) {
  const scrolls = [], doc = {};
  doc.defaultView = { innerHeight: 1000, getComputedStyle: el => el.style,
    scrollBy: options => scrolls.push(['window', options]) };
  const node = (parent, name, rect, style = {}) => ({ parentElement: parent, ownerDocument: doc, isConnected: true,
    style: { position: 'static', overflowY: 'visible', ...style }, getBoundingClientRect: () => rect,
    scrollHeight: 2000, clientHeight: 1000, querySelectorAll: () => [],
    scrollBy: options => scrolls.push([name, options]) });
  doc.documentElement = node(null, 'html', { top: 0, bottom: 1000 });
  doc.body = node(doc.documentElement, 'body', { top: 0, bottom: 1000 });
  const rail = node(doc.body, 'rail', { top: 0, bottom: 1000 }, { position: 'sticky', overflowY: 'auto' });
  const shelf = node(rail, 'shelf', hidden ? { width: 0, height: 0, top: 0, bottom: 0 } :
    { width: 300, height: 400, top: 600, bottom: 1000, left: overlap ? 0 : 500, right: overlap ? 300 : 800 }, { overflowY: 'auto' });
  const selected = node(inside ? shelf : rail, 'selection', { top: 550, bottom: 620, left: 10, right: 90 });
  rail.querySelectorAll = selector => { assert.equal(selector, '[data-selection-occluder="bottom"]'); return [shelf]; };
  shelf.contains = el => el === selected && inside;
  return { selected, scrolls };
}
test('1048 reveal excludes the actual bottom occluder from the rail area', () => {
  const f = revealFixture(); revealSelection(f.selected);
  assert.deepEqual(f.scrolls, [['rail', { top: 80, behavior: 'instant' }]]);
});
test('1048 an occluder outside the selection column or with no drawn area reserves nothing', () => {
  for (const options of [{ hidden: true }, { overlap: false }]) {
    const f = revealFixture(options); revealSelection(f.selected); assert.deepEqual(f.scrolls, []);
  }
});
test('1048 selection inside the shelf scrolls that shelf by its own visible area', () => {
  const f = revealFixture({ inside: true }); revealSelection(f.selected);
  assert.deepEqual(f.scrolls, [['shelf', { top: -90, behavior: 'instant' }]]);
});

function cursorFixture({ hidden = false, reverse = false } = {}) {
  const doc = miniDocument(), make = doc.createElement;
  doc.createElement = tag => {
    const el = make(tag);
    Object.defineProperties(el, { parentElement: { get: () => el.parent }, ownerDocument: { get: () => doc } });
    el.contains = node => el === node || [...el.descendants()].includes(node);
    el.checkVisibility = () => !el.hidden;
    el.getBoundingClientRect = () => el.box ?? { top: 0, bottom: 800, left: 0, right: 300, width: 300, height: 800 };
    return el;
  };
  doc.body = doc.createElement('body'); doc.body.root = true;
  doc.defaultView = { innerHeight: 800, innerWidth: 1280, getComputedStyle: () => ({ overflowY: 'visible' }), scrollBy() {} };
  const host = doc.createElement('aside'), holder = doc.createElement('div'), details = doc.createElement('details');
  const summary = doc.createElement('summary'), body = doc.createElement('div'), images = doc.createElement('div');
  images.className = 'things-thumbs'; details.dataset.key = 'images'; details.open = true;
  details.append(summary, body); body.append(images); holder.append(details); host.append(holder); doc.body.append(host);
  const tiles = Array.from({ length: 6 }, (_, i) => {
    const el = doc.createElement('a'); el.setAttribute('href', '?image=' + i); el.dataset.railImage = String(i);
    el.box = { top: 100 + Math.floor(i / 3) * 100, bottom: 180 + Math.floor(i / 3) * 100,
      left: i % 3 * 90, right: i % 3 * 90 + 80, width: 80, height: 80 }; return el;
  });
  images.append(...(reverse ? [...tiles].reverse() : tiles));
  const shelf = doc.createElement('section'), grid = doc.createElement('div'); shelf.className = 'archive-shelf';
  shelf.hidden = hidden; shelf.scrollTop = 700; grid.className = 'archive-shelf-row'; shelf.append(grid); host.append(shelf);
  const archived = Array.from({ length: 4 }, (_, i) => {
    const el = doc.createElement('button'); el.className = 'shelf-dossier'; el.dataset.id = 'archived-' + i;
    el.box = { top: -300 + Math.floor(i / 2) * 120, bottom: -200 + Math.floor(i / 2) * 120,
      left: i % 2 * 140, right: i % 2 * 140 + 120, width: 120, height: 100 }; return el;
  }); grid.append(...archived);
  const rail = Object.assign(Object.create(ThingsRail.prototype), { doc, host, holder, drawnOnce: true,
    sections: new Map([['images', { details, summary, body }]]) });
  rail.tree = { list: () => rail.treeRows(), go: row => row?.el.focus() };
  const press = (at, key, extra = {}) => {
    at.focus(); const event = { target: at, key, ...extra, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    rail.gridKey(event); return event;
  };
  return { doc, rail, tiles, archived, shelf, summary, press };
}
test('1048 actual Archive rows belong to the rail tree despite being scrolled away', () => {
  const f = cursorFixture(), rows = f.rail.treeRows();
  assert.deepEqual(rows.filter(r => r.el.className === 'shelf-dossier').map(r => r.el.dataset.id), f.archived.map(el => el.dataset.id));
});
test('1048 a hidden Archive adds no rail row', () => {
  const f = cursorFixture({ hidden: true }); assert.equal(f.rail.treeRows().some(r => r.el.className === 'shelf-dossier'), false);
});
test('1048 Archive arriving before the first section read cannot take its initial roving stop', () => {
  const f = cursorFixture(); f.rail.drawnOnce = false;
  assert.equal(f.rail.treeRows().some(r => r.el.className === 'shelf-dossier'), false);
  f.rail.drawnOnce = true;
  assert.equal(f.rail.treeRows().filter(r => r.el.className === 'shelf-dossier').length, 4);
});
test('1048 Down from each final Images cell chooses the first actual Archive item', () => {
  const f = cursorFixture();
  for (const tile of f.tiles.slice(3)) { f.press(tile, 'ArrowDown'); assert.equal(f.doc.activeElement, f.archived[0]); }
});
test('1048 Up from the first Archive row chooses a final Images column as drawn', () => {
  for (const reverse of [false, true]) {
    const f = cursorFixture({ reverse });
    f.press(f.archived[0], 'ArrowUp'); assert.equal(f.doc.activeElement, f.tiles[3]);
    f.press(f.archived[1], 'ArrowUp'); assert.equal(f.doc.activeElement, f.tiles[5]);
  }
});
test('1048 Archive horizontal and vertical arrows use their own drawn columns', () => {
  const f = cursorFixture();
  f.press(f.archived[0], 'ArrowRight'); assert.equal(f.doc.activeElement, f.archived[1]);
  f.press(f.archived[1], 'ArrowDown'); assert.equal(f.doc.activeElement, f.archived[3]);
  f.press(f.archived[3], 'ArrowLeft'); assert.equal(f.doc.activeElement, f.archived[2]);
});
test('1048 Archive keeps Return, menu keys, modifiers and IME with their owners', () => {
  const f = cursorFixture();
  for (const [key, extra] of [['Enter', {}], ['F10', { shiftKey: true }], ['ContextMenu', {}],
    ['ArrowUp', { isComposing: true }], ['ArrowRight', { metaKey: true }]]) {
    assert.equal(f.press(f.archived[0], key, extra).defaultPrevented, undefined);
  }
});
