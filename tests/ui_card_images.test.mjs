// A message's images in its card (item 474, web/card-images.mjs): which of its attachments its card shows as
// thumbnails. The native reading checks (tests/stack_native.mjs, "reading thumbnails …") read them on the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardImages } from '../web/card-images.mjs';

const image = (id, type, more = {}) => ({ id, name: `${id}.x`, content_type: type, inline: true, ...more });

test('a card shows each verified inline image its message carries, in the order sent', () => {
  const item = { attachments: [image('b', 'image/jpeg'), image('a', 'image/png'), image('c', 'image/gif'), image('d', 'image/webp')] };
  assert.deepEqual(cardImages(item).map(each => each.id), ['b', 'a', 'c', 'd']);
});

test('a file, an SVG and an image not verified inline show no thumbnail; a message with none shows nothing', () => {
  const item = { attachments: [image('notes', 'text/plain', { inline: false }), image('drawing', 'image/svg+xml'), image('raw', 'image/png', { inline: false }), image('kept', 'image/png')] };
  assert.deepEqual(cardImages(item).map(each => each.id), ['kept']);
  assert.deepEqual(cardImages({ attachments: [] }), []);
  assert.deepEqual(cardImages({ body: 'No attachments at all.' }), []);
});
