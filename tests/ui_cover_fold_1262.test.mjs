// Complete actual-owner model controls. Projected toggle events are not native
// pointer/touch/key/Tab/range/geometry or performance evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { coverSheet } from '../web/dossier-cover.mjs';
import { sourcePosition } from '../web/message-format.mjs';

const context = { viewer: 'reader1262', topicId: 'topic1262', rootId: 'root1262', nameOf: x => x };
const base = { owner: 'owner1262', root_id: 'root1262', stands: '## Done {folded}\n\nFinished work\n\n## Next\n\nCurrent work', items: [], waiting: [], revision: 1 };
const item = (number, state = 'Live · release 456') => ({ workspace_id: 'isolated1262', number, title: 'Item ' + number, state });
function fixture(storage = new Map(), denied = false) {
  const doc = miniDocument(), create = doc.createElement, events = new Map();
  doc.createElement = tag => {
    const n = create(tag); let text = n.textContent;
    Object.defineProperties(n, {
      textContent: { get: () => text + n.children.map(c => c.textContent).join(''), set: v => { for (const c of n.children) c.parent = null; n.children = []; text = String(v); } },
      text: { get: () => n.textContent }, childNodes: { get: () => n.children }, ownerDocument: { get: () => doc },
      parentNode: { get: () => n.parent }, parentElement: { get: () => n.parent },
    });
    n.nodeType = 1; n.style = { setProperty() {} };
    n.contains = other => { for (let at = other; at; at = at.parentNode) if (at === n) return true; return false; };
    const append = n.append.bind(n); n.append = (...nodes) => append(...nodes.map(x => typeof x === 'string' ? doc.createTextNode(x) : x));
    return n;
  };
  doc.createTextNode = value => {
    const node = doc.createElement('text'); node.nodeType = 3;
    node.data = String(value); node.textContent = node.data; return node;
  };
  const host = doc.createElement('div'); host.root = true;
  doc.querySelectorAll = s => host.querySelectorAll(s);
  doc.defaultView = { crypto: webcrypto, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, addEventListener: (name, f) => events.set(name, f) };
  if (denied) Object.defineProperty(doc.defaultView, 'localStorage', { get() { throw Error('storage denied'); } });
  const paint = (patch = {}, ctx = context, previous = null) => {
    const sheet = coverSheet(doc, { ...base, ...patch }, ctx, previous);
    if (!sheet.isConnected) host.append(sheet);
    return sheet;
  };
  return { doc, host, paint, storage, events };
}
const sections = sheet => sheet.querySelector('.cover-stands')?.querySelectorAll('.cover-section') ?? [];
const group = sheet => sheet.querySelector('.cover-linked-items');
const summary = section => section.children[0];
const rows = sheet => sheet.querySelectorAll('.cover-item');
const toggle = (section, open) => { section.open = open; section.listeners.toggle?.({ target: section }); };
const textNodes = node => [...node.descendants()].filter(n => n.nodeType === 3);

test('1262 writer annotation closes only its heading; unmarked1006 sections remain open', () => {
  const f = fixture(), sheet = f.paint(), all = sections(sheet);
  assert.equal(all.length, 2); assert.equal(all[0].open, false); assert.equal(all[1].open, true);
  assert.equal(summary(all[0]).textContent, 'Done'); assert.equal(all[0].children[1].textContent, 'Finished work');
  assert.equal(sheet.textContent.includes('{folded}'), false);
});
test('1262 explicit open beats closed default through repaint, revision and document reload', () => {
  const f = fixture(), first = f.paint(); toggle(sections(first)[0], true);
  assert.equal(sections(f.paint({ revision: 9 }))[0].open, true);
  const again = fixture(f.storage); assert.equal(sections(again.paint())[0].open, true);
  assert.ok([...f.storage.values()].some(v => JSON.parse(v).some(x => x?.open === true)));
});
test('1262 explicit closed beats open default; changing annotation keeps the same choice identity', () => {
  const f = fixture(), plain = base.stands.replace(' {folded}', ''), first = f.paint({ stands: plain });
  const id = sections(first)[0].dataset.coverFoldSection; toggle(sections(first)[0], false);
  const marked = sections(f.paint())[0]; assert.equal(marked.dataset.coverFoldSection, id); assert.equal(marked.open, false);
  toggle(marked, true); assert.equal(sections(f.paint({ stands: plain }))[0].open, true);
  assert.equal(sections(f.paint())[0].open, true);
});
test('1262 legacy1006 saved closed strings survive the new preference reader', () => {
  const f = fixture(), sheet = f.paint({ stands: '## Done\n\nOld words' }), section = sections(sheet)[0];
  const store = new Map([[section.dataset.coverFoldScope, JSON.stringify([section.dataset.coverFoldSection])]]);
  const legacy = fixture(store); assert.equal(sections(legacy.paint())[0].open, false);
  toggle(sections(legacy.paint())[0], true); assert.equal(sections(fixture(store).paint())[0].open, true);
});
for (const value of ['{bad json', '{"closed":"wrong"}', '[null,7,{"section":7,"open":true},{"section":"other","open":false}]']) test('1262 corrupt preference uses defaults: ' + value, () => {
  const f = fixture(), first = sections(f.paint())[0], storage = new Map([[first.dataset.coverFoldScope, value]]);
  const all = sections(fixture(storage).paint()); assert.equal(all[0].open, false); assert.equal(all[1].open, true);
});
test('1262 refused storage keeps explicit in-document open and closed choices', () => {
  const f = fixture(new Map(), true), first = f.paint(); toggle(sections(first)[0], true); toggle(sections(first)[1], false);
  const again = sections(f.paint()); assert.equal(again[0].open, true); assert.equal(again[1].open, false);
});
test('1262 storage events synchronize mounted surfaces and clear resets each default', () => {
  const f = fixture(), a = f.paint(), b = f.paint(), one = sections(a)[0], key = one.dataset.coverFoldScope;
  f.storage.set(key, JSON.stringify([{ section: one.dataset.coverFoldSection, open: true }])); f.events.get('storage')({ key });
  assert.equal(sections(a)[0].open, true); assert.equal(sections(b)[0].open, true);
  f.storage.clear(); f.events.get('storage')({ key: null }); assert.equal(sections(a)[0].open, false); assert.equal(sections(a)[1].open, true);
  f.events.get('storage')({ key: 'unrelated' }); assert.equal(sections(b)[0].open, false);
});
for (const field of ['viewer', 'topicId', 'rootId']) test('1262 reader scope isolates ' + field, () => {
  const f = fixture(), a = f.paint(); toggle(sections(a)[0], true);
  const ctx = { ...context, [field]: 'different' }, patch = field === 'rootId' ? { root_id: 'different' } : {};
  assert.equal(sections(f.paint(patch, ctx))[0].open, false);
});
test('1262 nested/repeated headings retain independent choices and renamed headings use their default', () => {
  const f = fixture(), stands = '## Same {folded}\n\nA\n\n### Child\n\nB\n\n## Same {folded}\n\nC';
  const all = sections(f.paint({ stands })); assert.equal(all.length, 3); toggle(all[2], true);
  const next = sections(f.paint({ stands: 'Intro\n\n' + stands + ' later' })); assert.deepEqual(next.map(s => s.open), [false, true, true]);
  assert.equal(sections(f.paint({ stands: stands.replaceAll('Same', 'Renamed') }))[2].open, false);
});
test('1262 mapped Unicode/CRLF heading links and following words keep original source positions', () => {
  const f = fixture(), stands = 'Intro\r\n\r\n## **Döne** [result](https://example.test/x) {folded}\r\n\r\nExact later 🐇 words';
  const sheet = f.paint({ stands }), label = summary(sections(sheet)[0]), body = sections(sheet)[0].children[1];
  assert.equal(label.textContent, 'Döne result'); assert.equal(label.querySelector('a').href, 'https://example.test/x');
  const done = textNodes(label).find(n => n.data === 'Döne'); assert.ok(done);
  assert.equal(sourcePosition(done, 1), stands.indexOf('Döne') + 1);
  const result = textNodes(label.querySelector('a'))[0]; assert.ok(result);
  assert.equal(sourcePosition(result, 1), stands.indexOf('[result]'));
  const words = textNodes(body).find(n => n.data.includes('Exact later')); assert.ok(words);
  assert.equal(sourcePosition(words, 3), stands.indexOf('Exact later') + 3);
  assert.equal(sourcePosition(textNodes(label).at(-1), textNodes(label).at(-1).data.length, true), stands.indexOf(' {folded}'));
});
for (const stands of ['Ordinary {folded}', '## Literal \\{folded}\n\nBody', '## `{folded}`\n\nBody', '## Literal {folded} extra\n\nBody']) test('1262 annotation is terminal cover heading syntax only: ' + stands, () => {
  const f = fixture(), sheet = f.paint({ stands }); assert.ok(sheet.textContent.includes('{folded}'));
  assert.ok(sections(sheet).every(s => s.open));
});
test('1262 complete HTML fences retain their separate painter', () => {
  const sheet = fixture().paint({ stands: '# Literal\n```html\n<button>Run</button>\n```' });
  assert.equal(sections(sheet).length, 0); assert.equal(sheet.querySelector('iframe').getAttribute('sandbox'), 'allow-scripts');
});
test('1262 nine linked items start closed with current8live1next summary and all original routes', () => {
  const items = Array.from({ length: 9 }, (_, n) => item(n + 1, n === 5 ? 'Next' : 'Live · release ' + (440 + n)));
  const f = fixture(), sheet = f.paint({ items }), disclosure = group(sheet);
  assert.ok(disclosure); assert.equal(disclosure.open, false); assert.equal(summary(disclosure).textContent, '9 items: 8 live, 1 next');
  assert.equal(rows(sheet).length, 9); assert.deepEqual(rows(sheet).map(r => r.querySelector('a').href), items.map(i => '?pipeline=isolated1262&item=' + i.number));
  assert.deepEqual(rows(sheet).map(r => r.querySelector('.cover-item-state').textContent), items.map(i => i.state));
});
test('1262 empty items add no disclosure; one item uses a singular current state', () => {
  const f = fixture(); assert.equal(group(f.paint()), null);
  const sheet = f.paint({ items: [item(7, 'Review')] }); assert.equal(summary(group(sheet)).textContent, '1 item: 1 review');
});
test('1262 generated-only cover still has its current item links and fold', () => {
  const f = fixture(), sheet = f.paint({ stands: null, items: [item(4, 'Next')], by: null, revision: 0 });
  assert.equal(group(sheet).open, false); assert.equal(rows(sheet)[0].querySelector('a').href, '?pipeline=isolated1262&item=4');
});
test('1262 count and state updates keep disclosure, summary, focused link, row and open choice connected', () => {
  const f = fixture(), items = [item(1), item(2, 'Next')], sheet = f.paint({ items }); toggle(group(sheet), true);
  const section = group(sheet), header = summary(section), row = rows(sheet)[0], link = row.querySelector('a'); link.focus();
  let detachments = 0; const remove = link.remove.bind(link); link.remove = () => { detachments++; remove(); };
  const next = f.paint({ items: [item(1, 'Live · release 459'), item(2), item(3, 'Next')], revision: 7 }, context, sheet);
  assert.equal(next, sheet); assert.equal(group(next), section); assert.equal(summary(section), header); assert.equal(section.open, true);
  assert.equal(rows(next)[0], row); assert.equal(row.querySelector('a'), link); assert.equal(link.isConnected, true); assert.equal(f.doc.activeElement, link); assert.equal(detachments, 0);
  assert.equal(summary(section).textContent, '3 items: 2 live, 1 next'); assert.equal(row.querySelector('.cover-item-state').textContent, 'Live · release 459');
});
test('1262 in-place input updates change the existing title/state without replacing its link', () => {
  const f = fixture(), i = item(1), sheet = f.paint({ items: [i] }), row = rows(sheet)[0], link = row.querySelector('a');
  i.title = 'Current title'; i.state = 'Next'; f.paint({ items: [i], revision: 8 }, context, sheet);
  assert.equal(rows(sheet)[0], row); assert.equal(link.textContent, 'Current title'); assert.equal(row.querySelector('.cover-item-state').textContent, 'Next');
});
test('1262 reorder and duplicate occurrences retain distinct item nodes and all current links', () => {
  const f = fixture(), a = item(1), b = item(2), sheet = f.paint({ items: [a, b, a] }), before = rows(sheet);
  assert.notEqual(before[0], before[2]); f.paint({ items: [b, a, a] }, context, sheet);
  assert.deepEqual(rows(sheet), [before[1], before[0], before[2]]); assert.equal(rows(sheet).length, 3);
});
test('1262 removing a focused item retires it and focuses the retained visible summary', () => {
  const f = fixture(), sheet = f.paint({ items: [item(1), item(2)] }); toggle(group(sheet), true);
  const old = rows(sheet)[0]; old.querySelector('a').focus(); f.paint({ items: [item(2)] }, context, sheet);
  assert.equal(old.isConnected, false); assert.equal(rows(sheet).length, 1); assert.equal(f.doc.activeElement, summary(group(sheet)));
});
test('1262 removing then restoring the item list keeps the saved explicit open preference', () => {
  const f = fixture(), sheet = f.paint({ items: [item(1)] }); toggle(group(sheet), true);
  f.paint({ items: [] }, context, sheet); assert.equal(group(sheet), null);
  f.paint({ items: [item(2)] }, context, sheet); assert.equal(group(sheet).open, true);
});
test('1262 generated group identity cannot collide with an authored Items heading', () => {
  const f = fixture(), sheet = f.paint({ stands: '## Items {folded}\n\nWritten words', items: [item(1)] });
  assert.notEqual(sections(sheet)[0].dataset.coverFoldSection, group(sheet).dataset.coverFoldSection);
  toggle(group(sheet), true); assert.equal(sections(sheet)[0].open, false);
});
test('1262 mounted feed/Reader disclosures share choices without changing an outer Reader fold', () => {
  const f = fixture(), a = f.paint({ items: [item(1)] }), b = f.paint({ items: [item(1)] });
  const outer = f.doc.createElement('details'); outer.open = true; outer.append(b); f.host.append(outer);
  toggle(group(a), true); assert.equal(group(b).open, true); toggle(sections(b)[0], true); assert.equal(sections(a)[0].open, true);
  toggle(group(b), false); assert.equal(group(a).open, false); assert.equal(outer.open, true);
});
test('1262 closing a mounted group containing focus moves focus to that surface summary', () => {
  const f = fixture(), a = f.paint({ items: [item(1)] }), b = f.paint({ items: [item(1)] }); toggle(group(a), true);
  rows(b)[0].querySelector('a').focus(); toggle(group(a), false);
  assert.equal(f.doc.activeElement, summary(group(b))); assert.equal(group(b).open, false);
});
test('1262 metadata/payload changes retain selected standing words, summary focus and later writing', () => {
  const f = fixture(), sheet = f.paint({ items: [item(1)] }), words = sheet.querySelector('.cover-stands'), text = textNodes(words).find(n => n.data.includes('Finished'));
  assert.ok(text); f.doc.selection = { anchorNode: text, anchorOffset: 2, focusNode: text, focusOffset: 6 };
  const selection = f.doc.selection, header = summary(group(sheet)), field = f.doc.createElement('textarea'); field.value = 'Later exact writing'; header.focus();
  f.paint({ items: [item(1)], revision: 9, payload: { text: 'Current payload', kind: 'answer' } }, context, sheet);
  assert.equal(sheet.querySelector('.cover-stands'), words); assert.equal(text.isConnected, true); assert.equal(f.doc.selection, selection);
  assert.equal(summary(group(sheet)), header); assert.equal(f.doc.activeElement, header); assert.equal(field.value, 'Later exact writing');
});
for (const activation of ['pointer click', 'touch tap', 'Enter', 'Space']) test('1262 modeled ' + activation + ' toggle outcome uses the current disclosure preference owner', () => {
  const f = fixture(), sheet = f.paint({ items: [item(1)] }), section = group(sheet), header = summary(section);
  assert.equal(section.tagName, 'DETAILS'); assert.equal(header.tagName, 'SUMMARY'); header.focus(); toggle(section, true);
  assert.equal(section.open, true); assert.equal(f.doc.activeElement, header); assert.equal(group(f.paint({ items: [item(1)] })).open, true);
  toggle(section, false); assert.equal(group(f.paint({ items: [item(1)] })).open, false);
});
for (const event of ['mouseover', 'wheel', 'swipe']) test('1262 ' + event + ' has no fold handler and leaves existing interaction ownership', () => {
  const f = fixture(), sheet = f.paint({ items: [item(1)] }), section = group(sheet);
  assert.equal(section.listeners[event], undefined); assert.equal(summary(section).listeners[event], undefined); assert.equal(section.open, false);
});
test('1262 rendering and folding leave supplied item, cover, wait and authority facts unchanged', () => {
  const f = fixture(), patch = { items: [item(1)], waiting: [{ text: 'Current wait', default: 'Keep current' }], refresh: { state: 'pending', recipient: 'writer' } }, before = JSON.stringify(patch);
  const sheet = f.paint(patch); toggle(group(sheet), true); assert.equal(JSON.stringify(patch), before);
  assert.ok(sheet.textContent.includes('Current wait')); assert.ok(sheet.textContent.includes('Keep current'));
});
