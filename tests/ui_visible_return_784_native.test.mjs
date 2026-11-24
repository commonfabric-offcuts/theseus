// Cheap instrument controls. These establish no native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cases784, TOLERANCES, readReturnPaint, assertPaint, assertStable, ringWidths, assertInPlace } from './visible_return_784_native.mjs';

function model({ hidden = false, inert = false, opacity = '1', clipRight = 500, left = 30, right = 330, ring = 2, shadow = 'none', offsetTop = 30 } = {}) {
  const box = { left, right, top: offsetTop, bottom: offsetTop + 100, width: right - left, height: 100 };
  const ancestor = { tagName: 'MAIN', id: 'main', parentElement: null,
    getBoundingClientRect: () => ({ left: 10, right: clipRight, top: 10, bottom: 600, width: clipRight - 10, height: 590 }) };
  const element = { tagName: 'ARTICLE', id: '', isConnected: true, parentElement: ancestor,
    closest: selector => selector === '[hidden], [inert]' ? (hidden || inert ? ancestor : null) : null,
    getBoundingClientRect: () => box, getClientRects: () => [box], matches: () => false,
    classList: { contains: value => value === 'lit' }, contains: e => e === element };
  const style = { display: 'block', visibility: 'visible', opacity, overflowX: 'visible', overflowY: 'visible',
    outlineStyle: ring ? 'solid' : 'none', outlineWidth: ring + 'px', outlineColor: 'rgb(20, 30, 40)', outlineOffset: '2px', boxShadow: shadow, getPropertyValue: () => '' };
  const doc = { querySelector: () => element, activeElement: { id: 'main', closest: () => null },
    elementFromPoint: () => element, defaultView: { innerWidth: 1280, innerHeight: 900,
      getComputedStyle: e => e === ancestor ? { ...style, opacity: '1', overflowX: 'hidden' } : style } };
  return readReturnPaint('fixture', doc);
}

test('784 native inventory has N1–N7, both themes, named tolerances and exact narrow sizes', () => {
  const cases = cases784();
  assert.equal(cases.length, 36);
  assert.equal(new Set(cases.map(c => c.name)).size, 36);
  assert.deepEqual([...new Set(cases.map(c => c.id))].sort(), ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7']);
  for (const c of cases) {
    assert.ok(c.name.startsWith('reading item 784 '));
    for (const [name, value] of Object.entries(TOLERANCES)) assert.ok(c.name.includes(`${name}=${value}`));
  }
});

test('784 actual native paint expression rejects hidden inert transparent viewport and ancestor-clipped targets', () => {
  assertPaint(model());
  for (const options of [{ hidden: true }, { inert: true }, { opacity: '0' }, { left: 1300, right: 1600 }, { clipRight: 20 }, { offsetTop: 950 }]) {
    assert.equal(model(options).visible, false, JSON.stringify(options));
    assert.throws(() => assertPaint(model(options)), /actually visible/);
  }
});

test('784 RING_WIDTH_EPS=0.25 accepts engine drift and still rejects a one-pixel ring mutant', () => {
  assertPaint(model({ ring: 2.2 }));
  assert.throws(() => assertPaint(model({ ring: 1 })), /actual CSS ring/);
  assert.throws(() => assertPaint(model({ ring: 2.3 })), /actual CSS ring/);
  assert.throws(() => assertPaint(model({ ring: 0 })), /actual CSS ring/);
  const state = model({ ring: 0, shadow: 'rgb(230, 230, 230) 0px 0px 0px 2px, rgb(30, 30, 30) 0px 0px 0px 4px, rgba(0, 0, 0, 0.2) 0px 3px 10px 8px' });
  assert.deepEqual(ringWidths(state), [2, 4]);
  assertPaint(state, 'dossier');
  assert.throws(() => assertPaint(model({ ring: 0, shadow: 'rgba(0, 0, 0, 0) 0px 0px 0px 4px' }), 'dossier'), /actual CSS ring/);
});

test('784 STABLE_EPS=0.5 aiming rejects real movement without exact measured equality', () => {
  const box = { left: 10, top: 20, width: 200, height: 100 };
  assertStable(box, { ...box, top: 20.4 });
  assert.throws(() => assertStable(box, { ...box, top: 22 }), /STABLE_EPS=0.5/);
});

test('784 native in-place oracle rejects a navigated topic and changed history', () => {
  const place = { href: 'http://fixture/?topic=A', history: 1, title: 'A', document: 'native-document' };
  assertInPlace(place, { ...place });
  assert.throws(() => assertInPlace(place, { ...place, href: 'http://fixture/?topic=B' }));
  assert.throws(() => assertInPlace(place, { ...place, history: 2 }));
});

test('784 source registration binds shared native module and route/CSS sources in both engines', () => {
  const shared = readFileSync(new URL('./topic_reading_native.mjs', import.meta.url), 'utf8');
  assert.ok(shared.includes("import { visibleReturn784Checks } from './visible_return_784_native.mjs'"));
  assert.match(shared, /await visibleReturn784Checks\(\{ check, page, until, control, shot, facts, observations, engine \}, \{ seed \}\)/);
  for (const filename of ['reader_persistence_native.mjs', 'webkit_native.mjs']) {
    const source = readFileSync(new URL(filename, import.meta.url), 'utf8');
    assert.match(source, /await readingChecks\(/);
    for (const name of ['tests/visible_return_784_native.mjs', 'tests/ui_visible_return_784_native.test.mjs', 'web/pane-keys.mjs', 'web/rails.css', 'web/in-place-navigation.mjs']) assert.ok(source.includes(`'${name}'`), `${filename}: retains original source ${name}`);
    assert.match(source, /Browser.close|browser.close\(/, `${filename}: owned browser normal close`);
  }
});

test('784 native actions avoid forced focus and synthetic click/event proof and retain failure diagnostics', () => {
  const source = readFileSync(new URL('./visible_return_784_native.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.focus\(|\.blur\(|\.click\(|dispatchEvent\(/);
  assert.ok(source.indexOf("await record('FAILURE-before-close')") < source.indexOf('await p.close()'));
  assert.match(source, /primary: error.stack, capture: capture.stack/);
  assert.match(source, /primary: primary\?\.stack \?\? null, cleanup/);
  assert.match(source, /native IME/);
});

test('784 superseded rename expectations cite original authority and preserve pen rename', () => {
  const source = readFileSync(new URL('./stack_native.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes('Return edits the hovered dossier'));
  assert.ok(!source.includes('Return on a selected dossier edits its title:'));
  assert.match(source, /Item 784 supersedes only item385/);
  assert.match(source, /Tony9689\/9698\/9705/);
  assert.match(source, /pen click still edits the title/);
  assert.match(source, /Core holds it for everyone/);
  assert.match(source, /Return in the writing makes a new line/);
  assert.match(source, /Return started no second edit/);
});
