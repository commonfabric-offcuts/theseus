import test from 'node:test';
import assert from 'node:assert/strict';
import { composerWidth, edgeWidth } from '../web/composer-width.mjs';

// Adapter-level pointer regression. Hosted native cases separately exercise
// the same uninterrupted gesture through the browser's input system.
function pointerFixture(initial) {
  const properties = new Map(), edges = [], listeners = new Map(), root = {};
  const win = { innerWidth: initial <= 390 ? initial : 1280,
    getComputedStyle: el => el === root ? { fontSize: '16px' } : { getPropertyValue: () => '72rem' },
    ResizeObserver: class { observe() {} },
  };
  const doc = { defaultView: win, documentElement: root,
    createElement() {
      const events = new Map(), captured = new Set();
      return { dataset: {}, setAttribute() {},
        addEventListener(name, fn) { events.set(name, fn); },
        setPointerCapture(id) { captured.add(id); },
        hasPointerCapture(id) { return captured.has(id); },
        releasePointerCapture(id) { captured.delete(id); },
        fire(name, x) { events.get(name)?.({ pointerId: 1, button: 0, isPrimary: true, clientX: x,
          preventDefault() {}, stopPropagation() {} }); },
      };
    },
  };
  const dialog = { ownerDocument: doc, open: true, id: 'reader', dataset: {},
    classList: { contains() { return false; } },
    style: { setProperty(name, value) { properties.set(name, value); } },
    getBoundingClientRect() {
      const mode = dialog.dataset.layout === 'wide' ? 'wide' : 'stacked';
      return { width: parseFloat(properties.get('--composer-width') || properties.get(`--composer-width-${mode}`) || String(initial)) };
    },
    append(edge) { edges.push(edge); },
    addEventListener(name, fn) { listeners.set(name, fn); },
  };
  const sync = composerWidth(dialog);
  return { dialog, edges, sync, properties };
}

test('items 721 and 650: embedded reply hides resize stops without changing floating widths', () => {
  const { dialog, edges, sync, properties } = pointerFixture(1152);
  const drag = delta => { edges[0].fire('pointerdown', 100); edges[0].fire('pointermove', 100 + delta); edges[0].fire('pointerup', 100 + delta); };
  assert.ok(edges.every(edge => !edge.hidden && edge.tabIndex === 0), 'floating Reader has both resizing stops');
  drag(16);
  dialog.dataset.layout = 'wide'; drag(32);
  const chosen = [...properties];
  dialog.dataset.cardReply = ''; sync?.();
  assert.ok(edges.every(edge => edge.hidden && edge.tabIndex === -1), 'embedded reply has no visible or tabbable resizing stop');
  drag(80);
  assert.deepEqual([...properties], chosen, 'even a stale event on an embedded edge cannot change either floating choice');
  delete dialog.dataset.cardReply; sync?.();
  assert.ok(edges.every(edge => !edge.hidden && edge.tabIndex === 0), 'floating Reader regains both resizing stops');
  assert.deepEqual([...properties], chosen, 'returning to floating changes neither saved width');
  dialog.dataset.layout = 'stacked';
  assert.equal(dialog.getBoundingClientRect().width, 1120);
  dialog.dataset.layout = 'wide';
  assert.equal(dialog.getBoundingClientRect().width, 1088);
  drag(16);
  assert.equal(dialog.getBoundingClientRect().width, 1056, 'floating controls still resize');
});

test('item 650 Reader modes keep independent widths for their element lifetime', () => {
  const { dialog, edges } = pointerFixture(1152);
  const drag = delta => { edges[0].fire('pointerdown', 100); edges[0].fire('pointermove', 100 + delta); edges[0].fire('pointerup', 100 + delta); };
  const width = () => dialog.getBoundingClientRect().width;
  drag(16);
  assert.equal(width(), 1120);
  dialog.dataset.layout = 'wide';
  assert.equal(width(), 1152, 'unchosen Wide has no stacked width');
  drag(32);
  assert.equal(width(), 1088, 'Wide stores its own choice');
  dialog.dataset.layout = 'stacked';
  assert.equal(width(), 1120, 'stacked restores its own choice');
  dialog.open = false; dialog.open = true;
  assert.equal(width(), 1120, 'reopening the same element keeps its choice');
  dialog.dataset.layout = 'wide';
  assert.equal(width(), 1088, 'Wide restores its own choice');
  assert.equal(pointerFixture(1152).dialog.getBoundingClientRect().width, 1152, 'a new element has no old choices');
});

for (const initial of [320, 375, 390, 1152]) for (const [index, side, inward] of [[0, 'left', 16], [1, 'right', -16]]) {
  test(`item 650 ${initial} ${side}: a held drag follows a return through its origin`, () => {
    const { dialog, edges } = pointerFixture(initial), edge = edges[index];
    const WIDTH_TOLERANCE_PX = 0.01; // Adapter arithmetic, without browser layout rounding.
    const near = (expected, words) => assert.ok(Math.abs(dialog.getBoundingClientRect().width - expected) <= WIDTH_TOLERANCE_PX,
      `${words}; tolerance ${WIDTH_TOLERANCE_PX}px: ${dialog.getBoundingClientRect().width} vs ${expected}`);
    edge.fire('pointerdown', 100);
    edge.fire('pointermove', 100 + inward);
    near(initial - 32, 'inward motion narrows both sides');
    edge.fire('pointermove', 100);
    near(initial, 'returning the held pointer restores the original width');
    // The entire old dead zone is covered, including crossing the origin.
    for (const delta of [inward, inward / 32, inward, -inward / 32]) {
      edge.fire('pointermove', 100 + delta);
      near(edgeWidth(initial, delta, side, initial <= 390 ? 280 : 760, initial), 'every held position uses the starting width');
    }
    edge.fire('pointerup', 100);
    assert.equal(dialog.dataset.widthDragging, undefined, 'release ends the drag');
    const released = dialog.getBoundingClientRect().width;
    edge.fire('pointermove', 100 + inward);
    near(released, 'motion after release cannot resize');
  });
}

test('either edge follows its pointer by the same distance on both sides of the centre', () => {
  for (const [side, inward] of [['left', 16], ['right', -16]]) {
    const start = 1152, smaller = edgeWidth(start, inward, side, 760, 1232);
    assert.equal(smaller, 1120, `${side}: two sides shrink by 16`);
    assert.equal(edgeWidth(smaller, -inward, side, 760, 1232), start, `${side}: two sides grow by 16`);
    assert.equal(edgeWidth(start, 0, side, 760, 1232), start, 'no horizontal movement changes no width');
  }
});

test('width stays inside the phone and laptop bounds, including an outward drag beyond the screen', () => {
  for (const [start, min, max] of [[320, 280, 320], [375, 280, 375], [390, 280, 390], [1152, 760, 1152]]) {
    assert.equal(edgeWidth(start, 10000, 'left', min, max), min);
    assert.equal(edgeWidth(start, -10000, 'left', min, max), max);
    assert.equal(edgeWidth(start, -10000, 'right', min, max), min);
    assert.equal(edgeWidth(start, 10000, 'right', min, max), max);
  }
});

test('an invalid pointer or edge cannot set an invalid CSS width', () => {
  for (const [delta, side, min, max] of [[NaN, 'left', 280, 390], [Infinity, 'right', 280, 390], [16, 'top', 280, 390], [16, 'right', NaN, 390]]) {
    assert.equal(edgeWidth(320, delta, side, min, max), 320);
  }
});
