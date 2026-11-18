import test from 'node:test';
import assert from 'node:assert/strict';
import { openThumbnail } from '../web/image-pick.mjs';

test('only an available displayed thumbnail opens, with its exact address and no opener', t => {
  const prior = globalThis.window, opened = [];
  globalThis.window = { open: (...args) => opened.push(args) };
  t.after(() => { globalThis.window = prior; });
  const image = { src: 'blob:isolated-exact-image', hidden: false, isConnected: true };
  let prevented = 0, stopped = 0;
  const event = { preventDefault: () => prevented++, stopPropagation: () => stopped++ };
  for (const missing of [null, { ...image, hidden: true }, { ...image, src: '' }, { ...image, isConnected: false }]) {
    assert.equal(openThumbnail(missing, event), false);
  }
  assert.deepEqual([opened, prevented, stopped], [[], 0, 0], 'unavailable images keep their existing fallback choices');
  assert.equal(openThumbnail(image, event), true);
  assert.deepEqual(opened, [['blob:isolated-exact-image', '_blank', 'noopener']]);
  assert.deepEqual([prevented, stopped], [1, 1], 'the parent card, link or picker does not also act');
});
