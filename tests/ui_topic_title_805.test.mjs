import test from 'node:test';
import assert from 'node:assert/strict';
import { accessibleControl, textEdgeGeometry } from './topic_title_805_oracles.mjs';

test('item 805 visibility oracle rejects retained hidden disabled fields and accepts actual accessible actions', () => {
  const make = (extra = {}) => ({ isConnected: true, disabled: false, getAttribute: () => null, closest: () => null,
    getClientRects: () => [1], ownerDocument: { defaultView: { getComputedStyle: () => ({ display: 'inline', visibility: 'visible', opacity: '1' }) } }, ...extra });
  assert.equal(accessibleControl(make()), true);
  assert.equal(accessibleControl(make({ disabled: true })), false);
  assert.equal(accessibleControl(make({ closest: selector => selector.includes('[hidden]') ? {} : null })), false);
  assert.equal(accessibleControl(make({ closest: selector => selector === 'dialog' ? { open: false } : null })), false);
  assert.equal(accessibleControl(make({ getClientRects: () => [] })), false);
  assert.equal(accessibleControl(make({ isConnected: false })), false);
});

test('item 805 text-fragment oracle rejects stretched-box placement, concealment and overflow', () => {
  const good = { text: [{ left: 20, right: 120, top: 20, bottom: 50 }], pencil: { left: 123, right: 136, top: 30, bottom: 43, width: 13 },
    controls: [{ left: 300, right: 344 }], viewport: { left: 0, right: 390 } };
  textEdgeGeometry(good);
  assert.throws(() => textEdgeGeometry({ ...good, pencil: { ...good.pencil, left: 270, right: 283 } }), /actual text edge/);
  assert.throws(() => textEdgeGeometry({ ...good, controls: [{ left: 350, right: 392 }] }), /in reach/);
  assert.throws(() => textEdgeGeometry({ ...good, text: [] }), /actual text fragments/);
  assert.throws(() => textEdgeGeometry({ ...good, pencil: { ...good.pencil, top: 80, bottom: 93 } }), /actual text edge/);
});

test('item 805 wrapped text edge permits only a necessary next-line pencil', () => {
  const g = { text: [{ left: 20, right: 192, top: 20, bottom: 50 }], pencil: { left: 20, right: 33, top: 52, bottom: 65, width: 13 },
    controls: [{ left: 210, right: 254 }], viewport: { left: 0, right: 390 }, flowRight: 200, pencilMarginPx: 2.4, wrapped: true };
  textEdgeGeometry(g);
  assert.throws(() => textEdgeGeometry({ ...g, text: [{ left: 20, right: 120, top: 20, bottom: 50 }] }), /actual text edge/, 'cannot wrap the pencil away from short text');
});
