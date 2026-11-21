import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { StackFeed } from '../web/stack-feed.mjs';
import { glyph } from '../web/glyphs.mjs';
import { approved, signature } from './menu_glyphs.mjs';

const drawing = node => signature(node.getAttribute('viewBox'), node.children.map(path => [path.tag, Object.entries(path.attributes)]));
function page(below = false) {
  const r = renderer799();
  const position = { root_id: 'a', below, through: below ? 2 : null, aside_revision: 1, at: { acts: 1, messages: 2 } };
  const state = r.add([{ id: 'a', seq: 1, author_id: 'person', stack_position: position },
    { id: 'b', seq: 2, author_id: 'person', reply_to: 'a', stack_position: position }]);
  // Only presence for the notice/menu callback; no geometry or native input is modelled.
  for (const node of r.list.descendants()) node.getClientRects = () => [{}];
  const tools = state.sections.get('a').querySelector('.stack-tools');
  return { ...r, state, tools, doc: r.list.ownerDocument };
}

test('601 dossier archive action has the Reader drawing and the return action keeps its own meaning', () => {
  for (const below of [false, true]) {
    const f = page(below), button = f.tools.children[1], name = below ? 'Bring back' : 'Archive';
    assert.equal(button.getAttribute('aria-label'), name);
    assert.equal(button.title, name);
    assert.equal(drawing(button.firstElementChild), approved(below ? 'back' : 'archive'));
    assert.equal(button.firstElementChild.getAttribute('aria-hidden'), 'true');
    if (!below) assert.equal(drawing(button.firstElementChild), drawing(f.doc.getElementById('reader-aside').querySelector('svg')));
    const actions = []; f.state.on = { aside: (stack, next) => actions.push([stack.id, next]) };
    button.onclick(); assert.deepEqual(actions, [['a', !below]], 'same dossier and archive direction');
  }
});

test('601 desktop and phone menus name Archive or Bring back and retain their actual archive action', () => {
  for (const below of [false, true]) {
    const f = page(below), calls = [], expected = below ? 'Bring back' : 'Archive';
    const feed = { list: f.list, state: f.state, undos: [], actsOf: () => ({}),
      entryFor: id => [...f.list.descendants()].find(node => node.dataset.id === id),
      setAside: (stack, next) => calls.push([stack.id, next]) };
    for (const phone of [false, true]) {
      let moves;
      const menu = StackFeed.prototype.menuItems.call(feed, f.messages.get('a'), { phone, more: items => moves = items });
      if (phone) menu.last[0].act(); else moves = menu.last;
      const action = menu.first.find(item => item.label === expected); assert.ok(action, `${phone ? 'phone' : 'desktop'} ${expected}`);
      assert.equal(moves.some(item => item.label === expected), false, '861: archive belongs to the shared message actions');
      assert.equal(drawing(glyph(action.glyph, f.doc)), approved(below ? 'back' : 'archive'));
      action.act();
    }
    assert.deepEqual(calls, [['a', !below], ['a', !below]]);
    const reply = f.tools.children[0]; reply.getClientRects = () => [];
    let titleMenu; f.state.on = { menu: (_stack, _anchor, first) => titleMenu = first };
    f.tools.children[2].onclick();
    assert.equal(titleMenu[1].label, expected);
    assert.equal(drawing(glyph(titleMenu[1].glyph, f.doc)), approved(below ? 'back' : 'archive'));
  }
});

test('601 archived count names dossiers, preserves expansion and disappears when empty', () => {
  const f = page(true);
  assert.equal(f.state.more.textContent, 'Archived (1)');
  assert.equal(f.state.more.getAttribute('aria-expanded'), 'false');
  f.state.more.onclick();
  assert.equal(f.state.more.textContent, 'Archived (1)');
  assert.equal(f.state.more.getAttribute('aria-expanded'), 'true');
  f.add([{ id: 'c', seq: 3, author_id: 'person', stack_position: { root_id: 'c', below: true, through: 3, aside_revision: 1, at: { acts: 1, messages: 3 } } }]);
  assert.equal(f.state.more.textContent, 'Archived (2)', 'two dossiers, despite three messages');
  for (const item of f.messages.values()) item.stack_position = { ...item.stack_position, below: false, through: null, aside_revision: 2 };
  f.state.again(); assert.equal(f.state.more.parentElement, null, 'no archived dossiers leaves no toggle');
});

test('601 actual Reader paint names Archive and Bring back with the exact message count', () => {
  const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
  const body = app.match(/function paintReaderAside\(\) \{([\s\S]*?)\n\}/)[1];
  for (const [below, count] of [[false, 1], [false, 3], [true, 2]]) {
    const f = page(below), button = f.doc.createElement('button'), number = f.doc.createElement('span'); number.className = 'aside-count'; button.append(number);
    const paint = new Function('$', 'readerAside', body);
    paint(() => button, () => ({ below, count }));
    const expected = `${below ? 'Bring back' : 'Archive'}: ${count} ${count === 1 ? 'message' : 'messages'}`;
    assert.equal(button.getAttribute('aria-label'), expected); assert.equal(button.title, expected);
    assert.equal(number.textContent, String(count)); assert.equal(button.getAttribute('aria-pressed'), String(below));
    paint(() => button, () => null); assert.equal(button.hidden, true);
  }
});
