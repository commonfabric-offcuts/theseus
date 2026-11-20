// Warp11781: unwatched is drawn from the shipped glyphs.mjs entry, not
// copied into the test. The frozen module is independent of today's module
// under test, so changing today's drawing cannot change this expectation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { miniDocument } from './mini_dom.mjs';

const record = JSON.parse(readFileSync(new URL('./item_865_shipped146_glyphs.json', import.meta.url), 'utf8'));
const source = gunzipSync(readFileSync(new URL('./item_865_shipped146_glyphs.mjs.gz', import.meta.url)));
assert.equal(record.commit, 'b38c8db9c6e3ae2f67aa6dc708895a1c73c04a93');
assert.equal(record.path, 'web/glyphs.mjs');
assert.equal(source.length, record.bytes);
assert.equal(createHash('sha256').update(source).digest('hex'), record.sha256, 'the oracle retains the verified shipped source');
const shipped = await import('data:text/javascript;base64,' + source.toString('base64'));
const drawing = shipped.glyph('unwatched', miniDocument());
assert.equal(drawing.children.length, 1);
const [path] = drawing.children;
assert.equal(path.tag, 'path');
export const shippedUnwatched = Object.freeze({
  vb: drawing.getAttribute('viewBox'), sw: path.getAttribute('stroke-width'),
  d: path.getAttribute('d'), fill: path.getAttribute('fill') === 'currentColor',
});
