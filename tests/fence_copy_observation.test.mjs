import test from 'node:test';
import assert from 'node:assert/strict';
import { fenceBoundarySnapshot } from './fence-copy-observation.mjs';

test('observation retains actual occlusion, geometry and before/after native and field selection', () => {
  const rect = { x: 10, y: 20, left: 10, top: 20, right: 54, bottom: 64, width: 44, height: 44 };
  const element = (id, tag = 'DIV') => ({ id, tagName: tag, className: id, dataset: {},
    getBoundingClientRect: () => rect, getAttribute: () => null, closest() { return this; }, contains(el) { return el === this; } });
  const card = element('card'), copy = element('copy', 'BUTTON'), blocker = element('reply-bar'), field = element('field', 'TEXTAREA');
  Object.assign(field, { value: 'hello composer', selectionStart: 0, selectionEnd: 5, selectionDirection: 'forward' });
  field.getBoundingClientRect = () => ({ ...rect, x: 110, left: 110, right: 154 });
  const notice = element('notice');
  let hit = blocker, selected = 'hello';
  const values = { document: { querySelector: s => ({ card, copy, '#inline-writing-body': field, '#reader': { open: false }, '.fence-copy-announcement:not(.sr-only)': notice })[s] ?? null,
    querySelectorAll: () => [copy, field], elementFromPoint: () => hit, activeElement: field },
    getSelection: () => ({ toString: () => selected, anchorOffset: 0, focusOffset: selected.length, rangeCount: 1 }),
    innerWidth: 320, innerHeight: 844, scrollX: 0, scrollY: 100, devicePixelRatio: 2, visualViewport: null };
  const descriptors = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
    const before = fenceBoundarySnapshot({ cardSelector: 'card', controlSelector: 'copy' });
    assert.equal(before.occludingTarget.id, 'reply-bar');
    assert.deepEqual(before.control.rect, rect);
    assert.deepEqual(before.hitPoint, { x: 32, y: 42 });
    assert.equal(before.viewport.width, 320);
    assert.equal(before.controlRects[0].overlapsNotice, true);
    assert.deepEqual(before.controlRects[0].overlapPoint, { x: 32, y: 42 });
    assert.equal(before.controlRects[0].overlapHit.id, 'reply-bar');
    assert.equal(before.controlRects[1].overlapsNotice, false);
    assert.equal(before.controlRects[1].overlapPoint, null);
    assert.deepEqual(before.tolerances, { geometryTolerancePx: 1, overlapTolerancePx: 0.5 });
    assert.equal(before.selection.text, 'hello');
    assert.equal(before.fieldSelection.selected, 'hello');
    hit = copy; selected = '';
    const after = fenceBoundarySnapshot({ cardSelector: 'card', controlSelector: 'copy' });
    assert.equal(after.occludingTarget, null);
    assert.equal(after.selection.text, '');
    assert.equal(after.fieldSelection.selected, 'hello', 'field caret and document Selection remain separate observations');
    hit = card; selected = 'After';
    const longPress = fenceBoundarySnapshot({ cardSelector: 'card', controlSelector: 'copy', point: { x: 40, y: 50 } });
    assert.equal(longPress.intendedTarget.id, 'card');
    assert.equal(longPress.occludingTarget, null, 'the intended card is not falsely called an occluder of Copy');
    assert.equal(longPress.selection.text, 'After');
  } finally {
    for (const [key, descriptor] of descriptors) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});
