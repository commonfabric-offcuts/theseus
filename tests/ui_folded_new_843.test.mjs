// Actual app painting below the browser; no native layout claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { foldCard, cardIn, show } from '../web/fold.mjs';
import { VisitNew, paintVisitNew } from '../web/visit-new.mjs';
import { messageUpdateHost } from '../web/cover-refresh.mjs';

Object.defineProperties(Element.prototype, {
  parentElement: { get() { return this.parent; } },
  ownerDocument: { get() { return this.document; } },
});
const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const body = app.slice(app.indexOf('function paintMessageUpdates() {'), app.indexOf('function paintCardAuthor('));
const css = readFileSync(new URL('../web/stack-look.css', import.meta.url), 'utf8');
function fixture() {
  const doc = miniDocument(), visitNew = new VisitNew('reader'), messages = new Map(), messageEntries = new Map();
  doc.createTextNode = text => text;
  const make = (id, folded = false) => {
    const item = { id, seq: messages.size + 1, body: 'Long excerpt '.repeat(30), author_id: 'writer', addressees: ['another'] };
    const card = doc.createElement('article'), author = doc.createElement('span');
    author.className = 'message-author'; card.append(author); messages.set(id, item);
    const entry = folded ? foldCard(card, item, doc) : card; messageEntries.set(id, entry);
    visitNew.arrive([item]); return { item, entry, card, author };
  };
  const bindings = { messageEntries, views: { messages }, cardIn, messageUpdateHost, messageUpdateActivity: () => null,
    document: doc, updateContext: () => ({}), paintVisitNew, visitNew, reader: null };
  const paint = new Function(...Object.keys(bindings), body + '; return paintMessageUpdates;')(...Object.values(bindings));
  return { doc, make, paint, visitNew };
}

test('843 actual app keeps a between-others new label inside its folded button, across open/fold repaints', () => {
  const f = fixture(), a = f.make('one', true), b = f.make('two', true);
  const list = f.doc.createElement('div'); list.append(a.entry, b.entry);
  f.paint();
  for (const { entry } of [a, b]) {
    assert.equal(entry.querySelector('.message-visit-new').parentElement, entry.querySelector('.fold-line'), 'badge must be inside the row, not underneath it');
    assert.equal(entry.querySelectorAll(':scope > .message-visit-new').length, 0);
  }
  const label = a.entry.querySelector('.message-visit-new');
  show(a.entry, true); f.paint();
  assert.equal(label.parentElement, a.author);
  show(a.entry, false); f.paint(); f.paint();
  assert.equal(a.entry.querySelectorAll('.message-visit-new').length, 1);
  assert.equal(label.parentElement, a.entry.querySelector('.fold-line'));
  f.visitNew.clear('one'); f.paint();
  assert.equal(a.entry.querySelector('.message-visit-new'), null);
  assert.ok(b.entry.querySelector('.message-visit-new'), 'other rows retain their mark');
});

test('843 ordinary folded and earlier rows keep the badge in their row; opening keeps one in the author', () => {
  const f = fixture();
  for (const kind of ['folded', 'earlier']) {
    const { card, entry, author } = f.make(kind), row = f.doc.createElement('span');
    row.className = 'message-' + kind; card.prepend(row); card.dataset[kind] = 'true';
    f.paint(); assert.equal(entry.querySelector('.message-visit-new').parentElement, row);
    card.dataset[kind] = 'false'; f.paint();
    assert.equal(entry.querySelector('.message-visit-new').parentElement, author);
    assert.equal(entry.querySelectorAll('.message-visit-new').length, 1);
  }
});

test('843 folded button reserves badge space while the excerpt ellipsizes', () => {
  const rules = selector => { const at = css.indexOf(selector + '{'); assert.ok(at >= 0, 'missing rule: ' + selector); return css.slice(at + selector.length + 1).split('}')[0]; };
  assert.match(rules('.fold-line:has(>.message-visit-new)'), /display:flex/);
  assert.match(rules('.fold-line:has(>.message-visit-new)>.fold-words'), /min-width:0/);
  assert.match(rules('.fold-line:has(>.message-visit-new)>.fold-words'), /text-overflow:ellipsis/);
  assert.match(rules('.message-visit-new'), /flex:none/);
});
