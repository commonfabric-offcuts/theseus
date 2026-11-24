import test from 'node:test';
import assert from 'node:assert/strict';
import { writingPort, painted867 } from './fixtures/card_menu_867.mjs';

// Supplied rectangles check the real add/open/paint/reveal wiring and scroll
// owner. They are not native layout, focus or animation evidence.
async function page(t, childTop) {
  const f = await writingPort(t, '## Parent\n\n### Existing child\n\n## Peer\n');
  const { p } = f;
  painted867(t, p);
  const prototype = Object.getPrototypeOf(p.list);
  Object.defineProperties(prototype, {
    ownerDocument: { get() { return this.document; } },
    parentElement: { get() { return this.parent; } },
  });
  const box = p.doc.createElement('section');
  Object.assign(box, { scrollTop: 0, scrollHeight: 1200, clientHeight: 300 });
  box.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 500 });
  p.doc.body.append(box); box.append(p.list, p.anchor); p.host = box;
  const moves = [], order = [], outer = [];
  box.scrollBy = move => { moves.push(move); box.scrollTop += move.top; order.push('reveal'); };
  p.doc.defaultView = {
    innerHeight: 300,
    getComputedStyle: node => ({ position: 'static', overflowY: node === box ? 'auto' : 'visible',
      scrollPaddingTop: '0', scrollPaddingBottom: '0' }),
    scrollBy: move => outer.push(move),
  };
  const node = p.node.bind(p);
  p.node = (...args) => {
    const made = node(...args);
    if (made.classList.contains('deck-writing')) made.getBoundingClientRect = () =>
      ({ top: childTop - box.scrollTop, bottom: childTop + 60 - box.scrollTop, left: 0, right: 500 });
    return made;
  };
  const hold = p.holdPage.bind(p);
  p.holdPage = () => { const putBack = hold(); return () => { putBack(); order.push('restore'); }; };
  p.mode = 'cards'; p.paint(); order.length = 0;
  return { ...f, box, moves, order, outer };
}

for (const [name, top, scrolls] of [['below the viewport', 620, true], ['already visible', 100, false]]) {
  test('1204 Add child reveals its new editor when ' + name, async t => {
    const { p, w, calls, box, moves, order, outer } = await page(t, top);
    const body = w.value.body;
    const button = p.list.children[0].querySelector('.notebook-card-add');
    assert.equal(button.onclick({ preventDefault() {}, stopPropagation() {} }), true);
    assert.equal(p.editing.fresh, true);
    assert.equal(p.editing.near, 1, 'the child still follows existing descendants');
    assert.equal(p.doc.activeElement, p.editing.field, 'the editor port keeps writing active');
    assert.equal(moves.length, scrolls ? 1 : 0);
    assert.equal(outer.length, 0, 'only the Notebook scroll owner moves');
    const row = p.editing.field.closest('li').getBoundingClientRect();
    assert.ok(row.top >= 0 && row.bottom <= 300, 'the whole new editor is visible');
    if (scrolls) assert.equal(order.at(-1), 'reveal', 'reveal follows pointer scroll restoration');
    else assert.equal(box.scrollTop, 0);
    assert.equal(w.value.body, body, 'an empty new editor creates no persisted card');
    assert.equal(calls.length, 0);
  });
}
