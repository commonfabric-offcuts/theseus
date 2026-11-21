import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { OutcomePageLayout } from '../web/outcome-page-layout.mjs';

function fixture() {
  const doc = miniDocument(), make = doc.createElement;
  doc.createElement = tag => {
    const node = make(tag); node.ownerDocument = doc;
    Object.defineProperty(node, 'parentNode', { get: () => node.parent });
    Object.defineProperty(node, 'nextSibling', { get: () => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null });
    return node;
  };
  const header = doc.createElement('header'), team = doc.createElement('section'), host = doc.createElement('main');
  header.append(team);
  return { header, team, host, doc, cards: { filter() {} }, reader: 'reader', color: () => 'olive' };
}

test('960 a host without matchMedia draws the existing narrow layout and disposes safely', t => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  Object.defineProperty(globalThis, 'matchMedia', { value: undefined, writable: true, configurable: true });
  t.after(() => { if (before) Object.defineProperty(globalThis, 'matchMedia', before); else delete globalThis.matchMedia; });
  const f = fixture(); let page;
  assert.doesNotThrow(() => { page = new OutcomePageLayout(f); });
  const modes = []; page.setPurpose({ layout: wide => modes.push(wide) });
  assert.equal(f.team.parentNode, f.header);
  assert.equal(f.host.getAttribute('data-outcome-wide'), null);
  assert.equal(f.host.children.length, 0, 'the narrow page gains no wide-only section');
  assert.deepEqual(modes, [false]);
  assert.doesNotThrow(() => page.dispose());
});

test('960 a media result without event methods can draw and dispose', () => {
  const f = fixture(), page = new OutcomePageLayout({ ...f, media: { matches: true } });
  assert.equal(f.team.parentNode, page.section);
  assert.equal(f.host.getAttribute('data-outcome-wide'), '');
  assert.doesNotThrow(() => page.dispose());
});

test('960 a real media change restores Team and its purpose owner, then removes its listener', () => {
  const f = fixture(), events = new Map(), media = { matches: true,
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name, callback) => { assert.equal(events.get(name), callback); events.delete(name); } };
  const page = new OutcomePageLayout({ ...f, media }), modes = [];
  page.setPurpose({ layout: wide => modes.push(wide) });
  media.matches = false; events.get('change')();
  assert.equal(f.team.parentNode, f.header); assert.deepEqual(modes, [true, false]);
  assert.equal(page.section.parentNode, null);
  assert.equal(f.host.getAttribute('data-outcome-wide'), null);
  page.dispose(); assert.equal(events.size, 0);
});
