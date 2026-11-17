// Focused non-browser checks of the actual renderer functions.
// Browser cases separately hold native input, CSS visibility and line placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { placeNewLine } from '../web/unanswered.mjs';

const file = new URL('../web/reply-stacks.mjs', import.meta.url);
let source = await readFile(file, 'utf8');
source = source.replace(/from '(\.\/[^']+)'/g, (_, relative) => 'from ' + JSON.stringify(new URL(relative, file).href));
const subject = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { paintFolded }; export { paintFoldedNames as reviewPaintNames };').toString('base64'));
// Extend the existing DOM fixture only for the two-hop child selector used here.
const query = Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll = function(selector) {
  if (selector.includes(', ')) return [...new Set(selector.split(', ').flatMap(part => this.querySelectorAll(part)))];
  const parts = selector.split(' > ');
  if (parts.length > 2) return query.call(this, parts.slice(0, 2).join(' > ')).flatMap(child => child.querySelectorAll(':scope > ' + parts.slice(2).join(' > ')));
  return query.call(this, selector);
};
Object.defineProperties(Element.prototype, {
  firstElementChild: { get() { return this.children[0] ?? null; } },
  nextElementSibling: { get() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; } },
  parentElement: { get() { return this.parent; } },
});
Element.prototype.contains = function(node) { return node === this || [...this.descendants()].includes(node); };
function fixture(items) {
  const doc = miniDocument(), list = doc.createElement('div'), messages = new Map(), cards = new Map();
  for (const [id, author, folded = true] of items) {
    const item = { id, seq: items.length - messages.size, author_id: author, body: 'Words ' + id, acts: { folded } }, card = doc.createElement('article'), name = doc.createElement('div');
    card.dataset.id = id; card.dataset.seq = String(item.seq); name.className = 'message-author'; name.textContent = author; card.append(name);
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
test('item 645 grouping preserves first sender, changes and whole-card boundaries', () => {
  const f = fixture([['a', 'agent'], ['b', 'agent'], ['c', 'person'], ['d', 'agent', false], ['e', 'agent'], ['f', 'agent']]);
  subject.reviewPaintNames(f.list, f.messages, f.state);
  assert.deepEqual(f.names(), ['agent', '', 'person', '', 'agent', '']);
  const repeated = f.cards.get('b').querySelector(':scope > .message-folded > .folded-author');
  assert.equal(repeated.textContent, 'agent', 'accessible attribution remains exact');
  assert.equal(repeated.getAttribute('aria-hidden'), null);
});
test('item 645 opening a repeated folded message preserves its whole author and restarts the run', () => {
  const f = fixture([['a', 'agent'], ['b', 'agent'], ['c', 'agent']]);
  subject.reviewPaintNames(f.list, f.messages, f.state);
  subject.paintFolded(f.cards.get('b'), f.messages.get('b'), false, { doc: f.doc, nameOf: id => id });
  f.state.folded.delete('b'); subject.reviewPaintNames(f.list, f.messages, f.state);
  assert.equal(f.cards.get('b').querySelector(':scope > .message-author').classList.contains('sr-only'), false, 'opening shows the full author');
  assert.deepEqual(f.names(), ['agent', '', 'agent']);
});
test('item 645 explicit hidden rows and pre-existing separator nodes do not suppress a first sender', () => {
  const f = fixture([['a', 'agent'], ['b', 'person'], ['c', 'agent'], ['d', 'agent']]);
  f.cards.get('b').hidden = true;
  const line = f.doc.createElement('div'); line.dataset.line = 'new'; f.list.insertBefore(line, f.cards.get('d'));
  subject.reviewPaintNames(f.list, f.messages, f.state);
  assert.deepEqual(f.names(), ['agent', 'person', '', 'agent']);
});
test('item 645 regression: Only new leaves the first visible sender named', () => {
  const f = fixture([['a', 'person'], ['b', 'person'], ['c', 'other'], ['d', 'person']]);
  subject.reviewPaintNames(f.list, f.messages, f.state);
  assert.equal(f.names()[1], '');
  f.state.only = item => ['b', 'd'].includes(item.id);
  subject.reviewPaintNames(f.list, f.messages, f.state);
  assert.equal(f.names()[1], 'person', 'a CSS-filtered predecessor cannot supply the visible sender');
  assert.equal(f.names()[3], '', 'a CSS-filtered sender change cannot break a visible run');
  f.state.only = null; subject.reviewPaintNames(f.list, f.messages, f.state);
  assert.deepEqual(f.names(), ['person', '', 'other', 'person'], 'leaving Only new restores the original runs');
});
test('item 645 regression: Only new counts a drawn folded head and skips hidden separators', () => {
  const f = fixture([['a', 'person'], ['b', 'person']]);
  const section = f.doc.createElement('section'), replies = f.doc.createElement('div');
  section.className = 'reply-stack'; section.dataset.headOpen = 'false'; replies.className = 'stack-replies';
  section.append(f.cards.get('a'), replies); replies.append(f.cards.get('b')); f.list.append(section);
  const line = f.doc.createElement('div'); line.dataset.line = 'new'; replies.prepend(line);
  f.state.only = () => true;
  subject.reviewPaintNames(f.list, f.messages, f.state);
  assert.deepEqual(f.names(), ['person', ''], 'Only new draws the head whole and hides separating furniture');
});
test('item 645 regression: a New line placed by the arranged callback starts a named run', () => {
  const f = fixture([['a', 'agent'], ['b', 'agent'], ['c', 'agent']]);
  let separated = false;
  const line = f.doc.createElement('div'); line.dataset.line = 'new';
  const arrange = () => subject.arrangeStacks(f.list, f.messages, { doc: f.doc, on: { arranged() {
    if (separated) f.list.insertBefore(line, f.cards.get('c'));
    else line.remove();
  } } });
  arrange();
  assert.deepEqual(f.names(), ['agent', '', '']);
  separated = true; arrange();
  assert.deepEqual(f.names(), ['agent', '', 'agent'], 'a newly inserted separator starts a named run');
  separated = false; arrange();
  assert.deepEqual(f.names(), ['agent', '', ''], 'removing the separator groups the run again');
});

// Execute the page's actual boundary function with the real line renderer.
// No browser, layout or timers: only the page shell and its data are supplied.
test('item 645 regression: line-only refresh regroups inserted, moved and removed separators', async () => {
  const f = fixture([['a', 'agent'], ['b', 'agent'], ['c', 'agent']]);
  subject.arrangeStacks(f.list, f.messages, { doc: f.doc });
  const views = { messages: f.messages, line: { seq: 2 }, olderCursor: null, held: true };
  const app = await readFile(new URL('../web/app.mjs', import.meta.url), 'utf8');
  const body = app.match(/function placeLine\(\) \{([\s\S]*?)\n\}/)[1];
  const place = new Function('$', 'views', 'document', 'placeNewLine', 'lineSeq', 'paintMoreMessages', 'paintFoldedNames',
    body).bind(null, () => f.list, views, f.doc, placeNewLine, subject.lineSeq, () => {}, subject.reviewPaintNames);
  place();
  assert.deepEqual(f.names(), ['agent', '', 'agent'], 'line-only insertion starts a named run');
  views.line.seq = 3; place();
  assert.deepEqual(f.names(), ['agent', 'agent', ''], 'moving the line names its new successor and groups the old one');
  views.line = null; place();
  assert.deepEqual(f.names(), ['agent', '', ''], 'removing the line groups the run again');
});
