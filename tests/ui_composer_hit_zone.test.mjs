import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composerWidth } from '../web/composer-width.mjs';

// Synthetic layout contracts, not browser hit testing or native input.
const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
const rule = css.match(/\.composer-edge\{([^}]+)\}/)[1];
const TARGET_PX = 44, ARITHMETIC_PX = 0.01;
function fixture(view = 390, id = 'reader') {
  const edges = [], callbacks = [], observed = [], attrs = new Map(), props = new Map();
  const layout = { top: 11, height: 440, paneTop: 88, paneHeight: 126, border: 0 };
  const pane = { getBoundingClientRect: () => ({ top: layout.top + layout.paneTop,
    bottom: layout.top + layout.paneTop + layout.paneHeight, height: layout.paneHeight }) };
  const root = {};
  const win = { innerWidth: view, getComputedStyle: el => el === root ? { fontSize: '16px' } : { getPropertyValue: () => '72rem' },
    ResizeObserver: class { constructor(fn) { callbacks.push(fn); } observe(el) { observed.push(el); } } };
  const dialog = { id, open: true, dataset: { layout: 'stacked' }, clientTop: layout.border,
    classList: { contains: () => false }, style: { setProperty: (k,v) => props.set(k,v) },
    getBoundingClientRect: () => ({ top: layout.top, height: layout.height, width: parseFloat(props.get('--composer-width-stacked') ?? view) }),
    querySelector: s => s === '.reading-pane' ? pane : null,
    append: el => edges.push(el), addEventListener() {} };
  dialog.ownerDocument = { defaultView: win, documentElement: root, createElement() {
    const events = {}, capture = new Set();
    return { dataset: {}, style: { top: '' }, setAttribute(k,v) { attrs.set(k,v); }, addEventListener(k,v) { events[k]=v; },
      setPointerCapture: x => capture.add(x), hasPointerCapture: x => capture.has(x), releasePointerCapture: x => capture.delete(x),
      fire(k, more = {}) { events[k]?.({ button: 0, pointerId: 1, isPrimary: true, clientX: 100,
        preventDefault() {}, stopPropagation() {}, ...more }); } };
  } };
  composerWidth(dialog);
  const update = () => { dialog.clientTop = layout.border; callbacks.forEach(fn => fn()); };
  const top = e => layout.top + layout.border + (e.style.top ? parseFloat(e.style.top) : layout.height/2 - TARGET_PX/2);
  return { layout, pane, dialog, edges, observed, attrs, update, top };
}

test('phone edges own reading space and leave the entire plus target outside their rectangles', () => {
  assert.match(rule, /width:44px;height:44px/);
  assert.match(rule, /z-index:6;/, 'no stacking escalation');
  assert.doesNotMatch(rule, /pointer-events:none/, 'targets retain pointer ownership');
  for (const view of [320,375,390]) {
    const f = fixture(view); f.update();
    // This explicit keyboard-up layout places the old 44px dialog-centre
    // target on a 44px plus target. It is not a measured historical rectangle.
    const plus = { top: f.layout.top + 198, bottom: f.layout.top + 242 };
    for (const e of f.edges) {
      assert.ok(f.top(e) + TARGET_PX <= plus.top + ARITHMETIC_PX, 'reading-owned edge cannot intercept plus');
      assert.ok(f.top(e) >= f.layout.top + f.layout.paneTop - ARITHMETIC_PX);
      assert.equal(e.tabIndex, 0);
    }
    assert.ok(f.observed.includes(f.pane), 'writing growth must trigger placement even when dialog size is unchanged');
    const first = f.top(f.edges[0]);
    f.layout.paneHeight = 80; f.update();
    assert.ok(f.top(f.edges[0]) < first, 'grips follow the shrinking reading pane');
    f.layout.paneHeight = 20; f.update();
    assert.ok(f.top(f.edges[0])+TARGET_PX <= f.layout.top+f.layout.paneTop+20+ARITHMETIC_PX, 'a short reading pane cannot spill the target into writing');
    f.layout.border=1; f.layout.paneHeight=126; f.update();
    assert.ok(Math.abs(f.top(f.edges[0])-(f.layout.top+f.layout.paneTop+63-22))<=ARITHMETIC_PX,'border is excluded from the positioned containing block');
    for(const [edge,delta] of [[f.edges[0],16],[f.edges[1],-16]]) {
      const start=f.dialog.getBoundingClientRect().width;
      edge.fire('pointerdown'); edge.fire('pointermove',{clientX:100+delta});
      assert.equal(f.dialog.getBoundingClientRect().width,start-32,'repositioned edge still resizes symmetrically');
      edge.fire('pointermove'); edge.fire('pointerup');
      assert.equal(f.dialog.getBoundingClientRect().width,start,'held return preserves width');
    }
    assert.equal(f.attrs.get('aria-valuemin'),'280');
    assert.equal(f.attrs.get('aria-valuemax'),String(view));
  }
});

test('desktop and New message retain their existing placement; closed Reader does no layout work', () => {
  for(const f of [fixture(1280),fixture(390,'new-message-sheet')]) {
    f.update(); assert.equal(f.edges[0].style.top,'');
  }
  const f=fixture(); f.update(); const before=f.edges[0].style.top;
  f.dialog.open=false; f.layout.paneHeight=80; f.update(); assert.equal(f.edges[0].style.top,before);
  f.dialog.open=true; f.update(); assert.notEqual(f.edges[0].style.top,before);
});
