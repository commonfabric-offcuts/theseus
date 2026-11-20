import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { notebookDocument } from '../web/notebook-view.mjs';

const pathB = 'M10.6 37.4 4 40 26 53 54 43 47.4 38.8 M13.4 31.7 6 35 29 47 56 35 50.1 31.9 M8 29 32 41 58 28 34 16Z M21.5 29.6 35 23.2 M26.5 32.2 36 27.6';
test('Cards tiles draw the approved B stack once without the old offset spans', () => {
  const tile = notebookDocument('cards', miniDocument());
  assert.equal(tile.getAttribute('aria-hidden'), 'true');
  assert.equal(tile.children.length, 1, 'one shared drawing replaces the three old spans');
  const svg = tile.children[0], path = svg.children[0];
  assert.equal(svg.tag, 'svg'); assert.equal(svg.getAttribute('data-glyph'), 'stack');
  assert.equal(svg.getAttribute('viewBox'), '3 15 56 39');
  assert.equal(svg.getAttribute('focusable'), 'false');
  assert.equal(path.getAttribute('d'), pathB);
  assert.equal(path.getAttribute('fill'), 'none');
  assert.equal(path.getAttribute('stroke'), 'currentColor');
  assert.equal(path.getAttribute('stroke-width'), '1.6');
});
test('Text tiles retain their four line spans', () => {
  const tile = notebookDocument('text', miniDocument());
  assert.equal(tile.dataset.mode, 'text'); assert.equal(tile.children.length, 4);
  assert.ok(tile.children.every(child => child.tag === 'span' && !child.children.length));
});
test('the stack keeps its natural shape at the bottom of the tile without old offset-card styling', () => {
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  assert.match(css, /\.notebook-document\[data-mode=cards\]\{[^}]*display:flex;[^}]*align-items:flex-end/);
  assert.match(css, /\.notebook-document\[data-mode=cards\]>\.glyph\{[^}]*width:100%;height:auto/);
  assert.doesNotMatch(css, /\.notebook-document\[data-mode=cards\]>span/);
});
