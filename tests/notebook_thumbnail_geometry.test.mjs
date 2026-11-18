import test from 'node:test';
import assert from 'node:assert/strict';
import { readingThumbnailSize } from './notebook_card_images_native.mjs';

// Adapted from approved9501's independent geometry controls. All inputs here
// are synthetic CSS/client metadata; these checks never measure native layout.
test('653 thumbnail oracle derives both client dimensions from rem and borders with runner rounding', () => {
  for (const rootRem of [14, 16, 18.5, 20]) for (const boxSizing of ['border-box', 'content-box']) {
    const borderX = 2, borderY = 3;
    const width = 3 * rootRem - (boxSizing === 'border-box' ? borderX : 0);
    const height = 3 * rootRem - (boxSizing === 'border-box' ? borderY : 0);
    // Approved runner rounding allowance: 2 CSS px on each measured dimension.
    for (const delta of [-2, 0, 2]) readingThumbnailSize({ rootRem, boxSizing, borderX, borderY,
      width: width + delta, height: height - delta, objectFit: 'contain' }, 'synthetic runner rounding (2 CSS px)');
  }
});

test('653 thumbnail oracle uses independent horizontal and vertical border sums', () => {
  // Unequal sums discriminate swapped axes or subtraction from content-box.
  for (const boxSizing of ['border-box', 'content-box']) {
    readingThumbnailSize({ rootRem: 20, boxSizing, borderX: 6, borderY: 1,
      width: boxSizing === 'border-box' ? 54 : 60,
      height: boxSizing === 'border-box' ? 59 : 60, objectFit: 'contain' }, 'unequal synthetic borders (2 CSS px)');
  }
});

test('653 thumbnail oracle catches full-size, proportional, cropped and oversized pictures', () => {
  const image = { rootRem: 16, boxSizing: 'border-box', borderX: 2, borderY: 2,
    width: 46, height: 46, natural: 480, room: 1082, objectFit: 'contain' };
  for (const change of [{ width: 480, height: 300 }, { height: 46 * 300 / 480 }, { objectFit: 'cover' },
    { objectFit: 'fill' }, { width: 49 }, { height: 49 }, { width: 43 }, { height: 43 }])
    assert.throws(() => readingThumbnailSize({ ...image, ...change }, 'bad synthetic thumbnail (2 CSS px)'), assert.AssertionError);
});

test('653 thumbnail oracle requires a positive finite measured root rem', () => {
  for (const rootRem of [0, -1, NaN, Infinity, undefined])
    assert.throws(() => readingThumbnailSize({ rootRem, boxSizing: 'border-box', borderX: 2, borderY: 2,
      width: 46, height: 46, objectFit: 'contain' }, 'invalid synthetic rem'), /measured root rem/);
});

test('653 thumbnail oracle preserves intrinsic dimensions and source truth without using them as layout', () => {
  for (const [natural, naturalHeight, room] of [[480, 300, 1082], [30, 90, 240], [2300, 2300, 320]]) {
    const image = { name: 'synthetic.png', shown: true, natural, naturalHeight, room,
      source_ref: { kind: 'memory', id: 'synthetic-page', revision: 7 },
      rootRem: 16, boxSizing: 'border-box', borderX: 2, borderY: 2, width: 46, height: 46, objectFit: 'contain' };
    const before = structuredClone(image);
    readingThumbnailSize(image, 'synthetic intrinsic/source metadata (2 CSS px)');
    assert.deepEqual(image, before, 'oracle changes no image metadata');
  }
});
