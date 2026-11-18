import test from 'node:test';
import assert from 'node:assert/strict';
import { DeckPage } from '../web/deck-page.mjs';

test('item 644 a composer redraw restores each vertical scroll owner without changing horizontal reading', () => {
  const document = {scrollTop: 379, scrollLeft: 7, parentElement: null};
  const sheet = {scrollTop: 152, scrollLeft: 9, parentElement: document};
  const page = {scrollTop: 0, scrollLeft: 11, parentElement: sheet};
  const restore = DeckPage.prototype.holdPage.call({host: page});
  // Replacing the card shrinks the document; setting the caret also moves a sheet.
  document.scrollTop = 243; sheet.scrollTop = 0; page.scrollTop = 19;
  restore();
  assert.deepEqual([document.scrollTop, sheet.scrollTop, page.scrollTop], [379, 152, 0]);
  assert.deepEqual([document.scrollLeft, sheet.scrollLeft, page.scrollLeft], [7, 9, 11], 'horizontal card choice stays the person’s');
});
