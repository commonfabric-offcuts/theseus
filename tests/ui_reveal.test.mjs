// What the keys select comes fully into view (item 379, web/reveal.mjs,
// docs/interaction.md "What the keys select comes into view"): the geometry of
// revealBy, going down and going up, and revealSelection's scrolling area on a
// small page of its own (the window or the nearest box that scrolls, less any
// scroll-padding), scrolled at once. The native cases in
// tests/topic_reading_native.mjs press the keys in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { revealBy, revealSelection, MARGIN } from '../web/reveal.mjs';

// The area from 0 to 1000: a tenth is 100.
const AREA = { top: 0, bottom: 1000 };
const at = (top, size) => ({ top, bottom: top + size });
// Where a selection stands once scrolled by revealBy.
const after = (selection, area = AREA) => {
  const by = revealBy(selection, area);
  return [selection.top - by, selection.bottom - by];
};

test('the gap is a tenth of the scrolling area', () => {
  assert.equal(MARGIN, 0.1);
});

test('a selection that fits, well inside the area, does not move, going down or up', () => {
  for (const selection of [at(300, 100), at(100, 800), at(101, 100), at(799, 100)]) assert.equal(revealBy(selection, AREA), 0, JSON.stringify(selection));
});

test('going down: one past the bottom scrolls the least that shows all of it with a tenth below it', () => {
  assert.deepEqual(after(at(950, 100)), [800, 900], 'partly below the bottom');
  assert.deepEqual(after(at(1400, 100)), [800, 900], 'wholly below the bottom');
});

test('going down: one fully in view but inside the bottom tenth still scrolls up a little', () => {
  assert.equal(revealBy(at(850, 100), AREA), 50);
  assert.deepEqual(after(at(850, 100)), [800, 900]);
  assert.equal(revealBy(at(800, 100), AREA), 0, 'exactly a tenth from the bottom stays');
});

test('going up: the same rule at the top, a tenth above it', () => {
  assert.deepEqual(after(at(-50, 100)), [100, 200], 'partly above the top');
  assert.deepEqual(after(at(-900, 100)), [100, 200], 'wholly above the top');
  assert.equal(revealBy(at(20, 100), AREA), -80, 'fully in view but inside the top tenth');
  assert.equal(revealBy(at(100, 100), AREA), 0, 'exactly a tenth from the top stays');
});

test('one that fits but not with a full tenth beside it shows whole, with what room is left over', () => {
  // 950 tall: 50 is left over.
  assert.deepEqual(after(at(500, 950)), [0, 950], 'coming in at the bottom: all of it, 50 below');
  assert.deepEqual(after(at(-900, 950)), [50, 1000], 'coming in at the top: all of it, 50 above');
  assert.equal(revealBy(at(25, 950), AREA), 0, 'already whole, with the room there is on each side: stays');
  // Exactly the area's height: all of it, no room.
  assert.deepEqual(after(at(300, 1000)), [0, 1000]);
  assert.deepEqual(after(at(-300, 1000)), [0, 1000]);
});

test('one taller than the area puts its top a tenth below the area\'s top, from below or above', () => {
  assert.deepEqual(after(at(500, 1500)), [100, 1600], 'coming in at the bottom');
  assert.deepEqual(after(at(-1400, 1500)), [100, 1600], 'coming in at the top');
  assert.deepEqual(after(at(300, 1001)), [100, 1101], 'a pixel too tall');
  assert.equal(revealBy(at(100, 1500), AREA), 0, 'already there: stays');
});

test('the area need not start at 0: a tenth of its own height from its own edges', () => {
  const area = { top: 60, bottom: 960 };   // 900 tall: a tenth is 90
  assert.deepEqual(after(at(900, 100), area), [770, 870]);
  assert.deepEqual(after(at(40, 100), area), [150, 250]);
  assert.deepEqual(after(at(500, 2000), area), [150, 2150]);
  assert.equal(revealBy(at(0, 10), { top: 50, bottom: 50 }), 0, 'an area with no height scrolls nothing');
});

// A page with only what revealSelection reads: the window (innerHeight,
// getComputedStyle, scrollBy) and a chain of boxes, each with its place on the
// screen, its style and whether it overflows. Scrolls are recorded.
function page({ innerHeight = 1000, rootStyle = {} } = {}) {
  const scrolls = [];
  const styles = new Map();
  const doc = {};
  const view = { innerHeight, getComputedStyle: el => ({ overflowY: 'visible', position: 'static', scrollPaddingTop: '0px', scrollPaddingBottom: '0px', ...(styles.get(el) ?? {}) }),
    scrollBy: options => scrolls.push(['window', options]) };
  const box = (parent, { rect = { top: 0, bottom: 0 }, style = {}, overflows = false, name = 'box' } = {}) => {
    const el = { name, parentElement: parent, ownerDocument: doc, isConnected: true, getBoundingClientRect: () => rect,
      scrollHeight: overflows ? 2000 : 100, clientHeight: 100, scrollBy: options => scrolls.push([name, options]) };
    styles.set(el, style);
    return el;
  };
  Object.assign(doc, { defaultView: view });
  doc.documentElement = box(null, { name: 'html', style: rootStyle });
  doc.body = box(doc.documentElement, { name: 'body' });
  return { doc, box, scrolls };
}

test('revealSelection scrolls the window at once by revealBy when no box between scrolls', () => {
  const { doc, box, scrolls } = page();
  const plain = box(doc.body, { name: 'feed', style: { overflowY: 'visible' } });
  revealSelection(box(plain, { rect: at(950, 100) }));
  assert.deepEqual(scrolls, [['window', { top: 150, behavior: 'instant' }]]);
  revealSelection(box(plain, { rect: at(-50, 100) }));
  assert.deepEqual(scrolls.at(-1), ['window', { top: -150, behavior: 'instant' }]);
  revealSelection(box(plain, { rect: at(400, 100) }));
  assert.equal(scrolls.length, 2, 'one well inside scrolls nothing');
});

test('revealSelection leaves out the scroll-padding a page declares on its scrolling area, top and bottom', () => {
  const { doc, box, scrolls } = page({ rootStyle: { scrollPaddingTop: '60px', scrollPaddingBottom: '40px' } });
  // The area is 60 to 960, 900 tall: a tenth is 90.
  revealSelection(box(doc.body, { rect: at(800, 50) }));
  assert.deepEqual(scrolls, [], 'more than 90 from the padded bottom: stays');
  revealSelection(box(doc.body, { rect: at(830, 50) }));
  assert.deepEqual(scrolls, [['window', { top: 10, behavior: 'instant' }]], 'within 90 of the padded bottom');
  revealSelection(box(doc.body, { rect: at(100, 50) }));
  assert.deepEqual(scrolls.at(-1), ['window', { top: -50, behavior: 'instant' }], 'within 90 of the padded top');
  // Without the padding the same selection is well inside.
  const plain = page();
  revealSelection(plain.box(plain.doc.body, { rect: at(830, 50) }));
  assert.deepEqual(plain.scrolls, []);
});

test('revealSelection scrolls the nearest box that scrolls, its area what of it shows in the window', () => {
  const { doc, box, scrolls } = page();
  const rail = box(doc.body, { name: 'rail', rect: { top: -100, bottom: 600 }, style: { overflowY: 'auto' }, overflows: true });
  // The area is 0 to 600 (the rail's top is above the window): a tenth is 60.
  revealSelection(box(rail, { rect: at(560, 30) }));
  assert.deepEqual(scrolls, [['rail', { top: 50, behavior: 'instant' }]]);
});

test('a box that stays put is where its rows scroll even when they fit, and a box that neither scrolls nor stays put is passed over', () => {
  const { doc, box, scrolls } = page();
  // A sticky rail whose rows all fit: the page under it is not scrolled.
  const sticky = box(doc.body, { name: 'sticky', rect: { top: 0, bottom: 1000 }, style: { overflowY: 'auto', position: 'sticky' } });
  revealSelection(box(sticky, { rect: at(950, 30) }));
  assert.deepEqual(scrolls, [['sticky', { top: 80, behavior: 'instant' }]]);
  // A fixed drawer, the same.
  const fixed = box(doc.body, { name: 'drawer', rect: { top: 0, bottom: 1000 }, style: { position: 'fixed' } });
  revealSelection(box(box(fixed, { name: 'list' }), { rect: at(950, 30) }));
  assert.deepEqual(scrolls.at(-1), ['drawer', { top: 80, behavior: 'instant' }]);
  // A box with overflow that does not overflow, and is not sticky, is passed over for the window.
  const quiet = box(doc.body, { name: 'quiet', rect: { top: 0, bottom: 2000 }, style: { overflowY: 'auto' } });
  revealSelection(box(quiet, { rect: at(950, 30) }));
  assert.deepEqual(scrolls.at(-1), ['window', { top: 80, behavior: 'instant' }]);
});

test('revealSelection does nothing for nothing, or for an element no longer on the page', () => {
  const { doc, box, scrolls } = page();
  revealSelection(null);
  revealSelection(undefined);
  const gone = box(doc.body, { rect: at(950, 100) });
  gone.isConnected = false;
  revealSelection(gone);
  assert.deepEqual(scrolls, []);
});
