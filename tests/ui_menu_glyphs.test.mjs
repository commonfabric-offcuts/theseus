// A glyph on every menu item (items 602 and 601; docs/links.md, "A message's
// menu"), below the browser: a message's menu draws each item's glyph by name
// in its row, after its words in the document so the row still reads as its
// words and keys, and refuses an item with no glyph or one nobody draws; a
// pipeline item's ⋯ gives each of its items the glyph the design page names
// (tests/menu_glyphs.mjs). The menus as a person sees them, at every width,
// light and dark, in both engines, are tests/stack_native.mjs,
// tests/pipeline_native.mjs and tests/notebook_pages_native.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openMessageMenu } from '../web/message-menu.mjs';
import { PipelinePage } from '../web/pipeline.mjs';
import { Element, miniDocument } from './fixtures/mini_dom.mjs';
import { dom } from './fixtures/ui_dom.mjs';
import { glyphOf } from './menu_glyphs.mjs';

function page() {
  const doc = miniDocument();
  doc.addEventListener = () => {}; doc.removeEventListener = () => {};
  doc.body = doc.byId('body');
  const make = doc.createElement;
  doc.createElement = tag => Object.assign(make(tag), { style: {}, offsetWidth: 140, offsetHeight: 90 });
  Element.prototype.contains ??= function contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; };
  Element.prototype.getBoundingClientRect ??= function box() { return this.box ?? { top: 0, left: 0, right: 0, bottom: 0 }; };
  const anchor = Object.assign(doc.createElement('button'), { box: { top: 100, bottom: 136, left: 900, right: 936 } });
  doc.body.append(anchor);
  return { doc, win: { innerWidth: 1440, innerHeight: 900 }, anchor };
}
// The glyphs a row carries, by name, wherever in it they are.
const named = node => (typeof node === 'object' ? [node.getAttribute?.('data-glyph') ?? node['data-glyph'], ...(node.children ?? []).flatMap(named)] : []).filter(Boolean);

test('a message\'s menu draws each item\'s glyph by name, silent, after its words, so the row still reads as its words and keys', () => {
  const { doc, win, anchor } = page();
  const items = [{ label: 'Copy Link', glyph: 'link', act() {} }, { label: 'Move its stack up', keys: '⌘↑', glyph: 'up', act() {} }, { label: 'Mark unread', glyph: 'unread', act() {} }];
  const { root } = openMessageMenu({ anchor, items, label: 'This message', doc, win });
  assert.deepEqual(root.children.map(named), [['link'], ['up'], ['unread']], 'each row carries its own glyph, once');
  for (const row of root.children) {
    const glyph = row.children.find(node => named(node).length);
    assert.equal(glyph.getAttribute('aria-hidden'), 'true', `${row.textContent}: a screen reader hears its words, not its glyph`);
    assert.equal(row.textContent, items[root.children.indexOf(row)].label, 'its words are the row\'s first words, unchanged');
  }
  assert.deepEqual(root.children[1].children.map(node => named(node)[0] ?? node.className), ['up', 'menu-keys'], 'the keys stay at the row\'s end');
  assert.equal(root.children[1].text, 'Move its stack up⌘↑', 'the row reads as its words and keys alone');
});

test('a menu item with no glyph, or a glyph nothing draws, is refused, and opens no menu', () => {
  for (const item of [{ label: 'Copy Link', act() {} }, { label: 'Copy Link', glyph: 'chain', act() {} }]) {
    const { doc, win, anchor } = page();
    assert.throws(() => openMessageMenu({ anchor, items: [item], doc, win }), /glyph/, JSON.stringify(item));
    assert.equal(doc.body.children.length, 1, 'nothing was put on the page');
  }
});

test('a pipeline item\'s ⋯ gives every item the glyph the design names, in Next and while it is being built', () => {
  globalThis.document = Object.assign(dom(), { addEventListener() {} });
  globalThis.CSS = { escape: text => text };
  const page = new PipelinePage({ host: { addEventListener() {}, querySelector: () => null }, header: {}, reader: 'tony', instanceId: 'i1', workspace: 'w1',
    read: async () => null, send: async () => ({ status: 'committed', result: {} }) });
  page.paint = () => {};
  const pipeline = { you_steer: true, section_words: { now: 'Now', next: 'Next', later: 'Later', candidates: 'Candidates' } };
  const items = [{ number: 1, section: 'next', version: 1 }, { number: 2, section: 'next', version: 1 }, { number: 3, section: 'next', version: 1 }];
  const rows = menu => menu.children.filter(node => node.role === 'menuitem').map(node => [node.children[0].text, named(node)]);
  const middle = rows(page.steerMenu(items[1], items, 1, pipeline));
  assert.deepEqual(middle.map(([label]) => label), ['Move up', 'Move down', 'Move to Now', 'Move to Later', 'Move to Candidates', 'Open its record', 'Drop…'], 'the same items, in the same order');
  assert.deepEqual(middle, middle.map(([label]) => [label, [glyphOf(label)]]));
  const built = { number: 4, section: 'now', version: 1, stage: { name: 'Build' } };
  const underway = rows(page.steerMenu(built, [built], 0, pipeline, true, { id: 'p-1', items: [4], you_set_aside: true }));
  assert.deepEqual(underway, [['Open its record', ['openpage']], ['Set aside to Later…', ['moveto']], ['Drop…', ['drop']]]);
});
