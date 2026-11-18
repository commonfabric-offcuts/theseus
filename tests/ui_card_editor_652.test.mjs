import test from 'node:test';
import assert from 'node:assert/strict';
import { DeckPage } from '../web/deck-page.mjs';

for (const width of [320, 375, 390, 1280]) test(`item 652: at ${width} a pointer pick uses the laptop list's focus and holds the page, never horizontal paging`, () => {
  const acts = [], row = {
    scrollIntoView: options => acts.push(['reveal', options]),
    focus: options => acts.push(['focus', options]),
  };
  const page = Object.assign(Object.create(DeckPage.prototype), {
    narrow: { matches: width <= 760 }, picked: 0, keyed: false,
    list: { clientWidth: width, querySelector: () => row, querySelectorAll: () => [row], scrollTo: options => acts.push(['page sideways', options]) },
  });
  page.show(true);
  assert.deepEqual(acts, [['focus', { preventScroll: true }]]);
  acts.length = 0;
  page.show(false);
  assert.deepEqual(acts, [], 'an ordinary redraw neither scrolls the page nor steals writing focus (item 644)');
});
