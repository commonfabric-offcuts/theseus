import test from 'node:test';
import assert from 'node:assert/strict';
import { DeckPage } from '../web/deck-page.mjs';

for (const width of [320, 375, 390, 1280]) test(`item 652: at ${width} the picked card uses the laptop list's focus and reveal, never horizontal paging`, () => {
  const acts = [], row = {
    scrollIntoView: options => acts.push(['reveal', options]),
    focus: options => acts.push(['focus', options]),
  };
  const page = Object.assign(Object.create(DeckPage.prototype), {
    narrow: { matches: width <= 760 }, picked: 0, keyed: false,
    list: { clientWidth: width, querySelector: () => row, querySelectorAll: () => [row], scrollTo: options => acts.push(['page sideways', options]) },
  });
  page.show(true);
  assert.deepEqual(acts, [['reveal', { block: 'nearest' }], ['focus', { preventScroll: true }]]);
  acts.length = 0;
  page.show(false);
  assert.deepEqual(acts, [['reveal', { block: 'nearest' }]], 'revealing without focus does not steal writing focus');
});
