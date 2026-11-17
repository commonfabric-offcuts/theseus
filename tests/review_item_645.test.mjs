// Independent, non-browser mutation probes of the actual renderer functions.
// Browser cases separately hold native input, CSS visibility and line placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';

const file = new URL('../web/reply-stacks.mjs', import.meta.url);
let source = await readFile(file, 'utf8');
source = source.replace(/from '(\.\/[^']+)'/g, (_, relative) => 'from ' + JSON.stringify(new URL(relative, file).href));
const subject = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { paintFolded }; export const reviewPaintNames = typeof paintFoldedNames === "function" ? paintFoldedNames : () => {};').toString('base64'));
const regressions = Boolean(process.env.REVIEW645_REGRESSIONS);
// Extend the existing DOM fixture only for the two-hop child selector used here.
const query = Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll = function(selector) {
  const parts = selector.split(' > ');
  if (parts.length > 2) return query.call(this, parts.slice(0, 2).join(' > ')).flatMap(child => child.querySelectorAll(':scope > ' + parts.slice(2).join(' > ')));
  return query.call(this, selector);
};
Object.defineProperties(Element.prototype, {
  firstElementChild: { get() { return this.children[0] ?? null; } },
  nextElementSibling: { get() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; } },
  parentElement: { get() { return this.parent; } },
});
function fixture(items) {
  const doc = miniDocument(), list = doc.createElement('div'), messages = new Map(), cards = new Map();
  for (const [id, author, folded = true] of items) {
    const item = { id, author_id: author, body: 'Words ' + id }, card = doc.createElement('article'), name = doc.createElement('div');
    card.dataset.id = id; name.className = 'message-author'; name.textContent = author; card.append(name);
    subject.paintFolded(card, item, folded, { doc, nameOf: id => id });
    messages.set(id, item); cards.set(id, card); list.append(card);
  }
  const state = { folded: new Set(items.filter(x => x[2] !== false).map(x => x[0])), earlierRows: new Set(), showCoordination: true };
  const names = () => [...cards.values()].map(card => {
    const name = card.querySelector(':scope > .message-folded > .folded-author');
    return name && !name.classList.contains('sr-only') ? name.textContent : '';
  });
  return { doc, list, messages, cards, state, names };
}
test('item 645 grouping preserves first sender, changes and whole-card boundaries', { skip: regressions }, () => {
  const f = fixture([['a', 'agent'], ['b', 'agent'], ['c', 'person'], ['d', 'agent', false], ['e', 'agent'], ['f', 'agent']]);
  subject.reviewPaintNames(f.list, f.messages, f.state);
  assert.deepEqual(f.names(), ['agent', '', 'person', '', 'agent', '']);
  const repeated = f.cards.get('b').querySelector(':scope > .message-folded > .folded-author');
  assert.equal(repeated.textContent, 'agent', 'accessible attribution remains exact');
  assert.equal(repeated.getAttribute('aria-hidden'), null);
});
test('item 645 opening a repeated folded message preserves its whole author and restarts the run', { skip: regressions }, () => {
  const f = fixture([['a', 'agent'], ['b', 'agent'], ['c', 'agent']]);
  subject.reviewPaintNames(f.list, f.messages, f.state);
  subject.paintFolded(f.cards.get('b'), f.messages.get('b'), false, { doc: f.doc, nameOf: id => id });
  f.state.folded.delete('b'); subject.reviewPaintNames(f.list, f.messages, f.state);
  assert.equal(f.cards.get('b').querySelector(':scope > .message-author').classList.contains('sr-only'), false, 'opening shows the full author');
  assert.deepEqual(f.names(), ['agent', '', 'agent']);
});
test('item 645 explicit hidden rows and pre-existing separator nodes do not suppress a first sender', { skip: regressions }, () => {
  const f = fixture([['a', 'agent'], ['b', 'person'], ['c', 'agent'], ['d', 'agent']]);
  f.cards.get('b').hidden = true;
  const line = f.doc.createElement('div'); line.dataset.line = 'new'; f.list.insertBefore(line, f.cards.get('d'));
  subject.reviewPaintNames(f.list, f.messages, f.state);
  assert.deepEqual(f.names(), ['agent', 'person', '', 'agent']);
});
test('item 645 regression: Only new leaves the first visible sender named', { skip: !regressions }, () => {
  const f = fixture([['a', 'person'], ['b', 'person']]);
  f.state.only = item => item.id === 'b';
  subject.reviewPaintNames(f.list, f.messages, f.state);
  assert.equal(f.names()[1], 'person', 'a CSS-filtered predecessor cannot supply the visible sender');
});
test('item 645 regression: a New line placed by the arranged callback starts a named run', { skip: !regressions }, () => {
  const f = fixture([['a', 'agent'], ['b', 'agent']]);
  subject.reviewPaintNames(f.list, f.messages, f.state);
  // The actual arrangeStacks calls paintFoldedNames before on.arranged;
  // app.mjs stacksRedrawn places the line in that callback.
  const line = f.doc.createElement('div'); line.dataset.line = 'new';
  f.list.insertBefore(line, f.cards.get('b'));
  assert.equal(f.names()[1], 'agent', 'a newly inserted separator cannot leave the next sender suppressed');
});
