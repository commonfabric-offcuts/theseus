import test from 'node:test';
import assert from 'node:assert/strict';
import { SplitSources, openSplitSources } from '../web/dossier-splits.mjs';
import { GLYPH_NAMES } from '../web/glyphs.mjs';
import { openMessageMenu } from '../web/message-menu.mjs';
import { Element, miniDocument } from './fixtures/mini_dom.mjs';

const source = (id = 'source', extra = {}) => ({ id, seq: 2, topic_id: 'topic', body: 'Joined words', acts: {
  joined: { into: 'destination', by: 'author' }, join_revision: 3, name: { text: 'Tracking changes' }, cover: { stands: 'Kept source cover' } },
  stack_position: { root_id: 'destination', placed: 8, name: { text: 'Destination' } }, ...extra });
const acts = (items = [{ message_id: 'source', seq: 2, acts: { joined: { into: 'destination' } } }], next_cursor = null) =>
  ({ instance_id: 'instance', topic_id: 'topic', version: 8, items, next_cursor });
const named = (items = [source()], next_cursor = null) => ({ instance_id: 'instance', topic_id: 'topic', items, next_cursor });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function fixture(answers = [acts(), named()]) {
  const calls = []; let current = true;
  const read = async (name, args) => { calls.push([name, args]); const answer = answers.shift(); if (answer instanceof Error) throw answer; return typeof answer === 'function' ? answer() : answer; };
  const sources = new SplitSources({ instanceId: 'instance', topicId: 'topic', rootId: 'destination', read, current: () => current });
  return { sources, calls, answers, stop: () => { current = false; }, read };
}

test('1268 named discovery finds an unloaded head without mutating its name, cover, placement or caller window', async () => {
  const item = source(), before = structuredClone(item), f = fixture([acts(), named([item])]);
  assert.deepEqual(await f.sources.next(), { choices: [item], more: false });
  assert.deepEqual(item, before); assert.deepEqual(f.calls, [['message_acts', { topic_id: 'topic', limit: 100 }], ['topic_messages', { topic_id: 'topic', message_ids: ['source'] }]]);
});
test('1268 explicit More crosses empty/irrelevant pages without automatically scanning history', async () => {
  const f = fixture([acts([], 20), acts([{ message_id: 'source', seq: 10, acts: { joined: { into: 'destination' } } }]), named()]);
  assert.deepEqual(await f.sources.next(), { choices: [], more: true }); assert.equal(f.calls.length, 1);
  assert.equal((await f.sources.next()).choices[0].id, 'source'); assert.equal(f.calls.length, 3); assert.equal(f.calls[1][1].cursor, 20);
});
test('1268 byte-cut named answer retains omitted IDs for the next explicit More', async () => {
  const f = fixture([acts([{ message_id: 'a', seq: 3, acts: { joined: { into: 'destination' } } }, { message_id: 'b', seq: 2, acts: { joined: { into: 'destination' } } }]), named([source('a')], 2), named([source('b')])]);
  assert.deepEqual((await f.sources.next()).choices.map(x => x.id), ['a']); assert.deepEqual(f.sources.pending, ['b']);
  assert.deepEqual((await f.sources.next()).choices.map(x => x.id), ['b']); assert.equal(f.calls.length, 3);
  assert.equal(f.calls.filter(([name]) => name === 'message_acts').length, 1);
});
test('1268 only current admitted joins of this dossier are choices, including nested deliberate joins', async () => {
  const items = [source('nested', { acts: { joined: { into: 'branch' }, join_revision: 7 } }), source('elsewhere', { stack_position: { root_id: 'another' } }),
    source('private', { withheld: true }), source('removed', { removal: { kind: 'unsent' } }), source('split', { acts: { joined: null, join_revision: 4 } })];
  const f = fixture([acts(items.map((item, i) => ({ message_id: item.id, seq: 20 - i, acts: { joined: { into: 'destination' } } }))), named(items)]);
  assert.deepEqual((await f.sources.next()).choices.map(x => x.id), ['nested']);
});
for (const bad of ['foreign instance', 'foreign topic', 'duplicate id', 'unrequested id', 'nonprogressing acts', 'oversize', 'no named progress']) {
  test('1268 refuses malformed discovery: ' + bad, async () => {
    let first = acts(), second = named();
    if (bad === 'foreign instance') first.instance_id = 'other';
    if (bad === 'foreign topic') second.topic_id = 'other';
    if (bad === 'duplicate id') second.items.push(source());
    if (bad === 'unrequested id') second.items = [source('other')];
    if (bad === 'nonprogressing acts') first.next_cursor = 99;
    if (bad === 'oversize') first.items = Array.from({ length: 101 }, (_, n) => ({ message_id: String(n), seq: 102 - n, acts: {} }));
    if (bad === 'no named progress') second = named([], 1);
    const f = fixture([first, second]); await assert.rejects(f.sources.next()); assert.equal(f.sources.started, false);
  });
}
for (const bad of ['access revoked', 'moved dossier', 'join changed', 'revision changed', 'missing', 'foreign id', 'visit retired']) {
  test('1268 fresh selected source refuses ' + bad + ' without a command', async () => {
    const choice = source(); let fresh = source();
    if (bad === 'access revoked') fresh.withheld = true;
    if (bad === 'moved dossier') fresh.stack_position = { root_id: 'other' };
    if (bad === 'join changed') fresh.acts.joined.into = 'another';
    if (bad === 'revision changed') fresh.acts.join_revision = 4;
    if (bad === 'foreign id') fresh.id = 'other';
    const f = fixture([named(bad === 'missing' ? [] : [fresh])]);
    if (bad === 'visit retired') f.stop();
    await assert.rejects(f.sources.fresh(choice));
  });
}
test('1268 named/read failure retains the prior cursor for explicit retry', async () => {
  const f = fixture([acts(), Error('transport'), acts(), named()]);
  await assert.rejects(f.sources.next(), /transport/); assert.equal(f.sources.started, false);
  assert.equal((await f.sources.next()).choices.length, 1); assert.equal(f.calls[2][0], 'message_acts');
});

function menus(answers = [acts(), named(), named()]) {
  const f = fixture(answers), shown = [], sent = [], notices = []; let active, visiting = true;
  const show = items => {
    // Real openMessageMenu toggles an already-open anchor; replacements must close first.
    if (active?.root.isConnected) { active.close(true); return null; }
    const menu = { items, root: { isConnected: true }, close(restore) { this.root.isConnected = false; this.restore = restore; } };
    shown.push(menu); active = menu; return menu;
  };
  const run = () => openSplitSources({ instanceId: 'instance', topicId: 'topic', rootId: 'destination', read: f.read, current: () => visiting,
    show, split: item => sent.push(item), say: words => notices.push(words) });
  const press = async key => { const menu = shown.at(-1), item = menu.items.find(x => x.key === key); assert.ok(item, key); menu.close(true); await item.act(); };
  return { ...f, shown, sent, notices, run, press, retire() { visiting = false; } };
}
for (const input of ['pointer click', 'keyboard activation', 'touch-shaped activation']) test('1268 explicit source choice via ' + input, async () => {
  const f = menus(); await f.run(); assert.equal(f.sent.length, 0);
  await f.press('split:source'); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].acts.join_revision, 3);
  assert.equal(f.calls.length, 3); assert.equal(f.shown.at(-1).restore, true);
  for (const menu of f.shown) for (const item of menu.items) assert.ok(GLYPH_NAMES.includes(item.glyph), item.glyph);
});
for (const dismissal of ['Escape', 'Tab', 'outside click', 'scroll', 'visit change']) test('1268 late discovery cannot reopen after ' + dismissal, async () => {
  const wait = deferred(), f = menus([() => wait.promise]); const run = f.run();
  if (dismissal === 'visit change') f.retire(); else f.shown.at(-1).close(true);
  wait.resolve(acts()); await run; assert.equal(f.shown.length, 1); assert.equal(f.calls.length, 1); assert.equal(f.sent.length, 0);
});
test('1268 late fresh source cannot split after menu dismissal', async () => {
  const wait = deferred(), f = menus([acts(), named(), () => wait.promise]); await f.run(); const selected = f.press('split:source');
  f.shown.at(-1).close(true); wait.resolve(named()); await selected; assert.equal(f.sent.length, 0);
});
test('1268 More is explicit, empty continuation is retained, and a source is never selected automatically', async () => {
  const f = menus([acts([], 10), acts([{ message_id: 'source', seq: 2, acts: { joined: { into: 'destination' } } }]), named()]);
  await f.run(); assert.equal(f.calls.length, 1); assert.equal(f.sent.length, 0);
  await f.press('split-more'); assert.equal(f.calls.length, 3); assert.equal(f.sent.length, 0); assert.ok(f.shown.at(-1).items.some(x => x.key === 'split:source'));
});

function actualMenus(phone = false) {
  const doc = miniDocument(), listeners = new Map(); doc.body = doc.byId('body');
  doc.addEventListener = (type, fn) => listeners.set(type, fn);
  doc.removeEventListener = (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); };
  const make = doc.createElement;
  doc.createElement = tag => Object.assign(make(tag), { style: {}, offsetWidth: 240, offsetHeight: 180 });
  Element.prototype.contains ??= function(node) { for (; node; node = node.parent) if (node === this) return true; return false; };
  Element.prototype.getBoundingClientRect ??= function() { return this.box ?? { top: 40, bottom: 70, left: 40, right: 70 }; };
  const anchor = doc.createElement('button'); doc.body.append(anchor); const shown = [];
  const show = items => { const menu = openMessageMenu({ anchor, items, label: 'Move or join', sheet: true, doc,
    win: { innerWidth: phone ? 375 : 1280, innerHeight: 800, matchMedia: () => ({ matches: phone }) } }); if (menu) shown.push(menu); return menu; };
  return { doc, anchor, listeners, shown, show };
}
for (const phone of [false, true]) test(`1268 real menu replacement, arrow focus, activation and restoration; phone=${phone}`, async () => {
  const f = actualMenus(phone), calls = []; const answers = [acts(), named(), named()];
  await openSplitSources({ instanceId: 'instance', topicId: 'topic', rootId: 'destination', read: async () => answers.shift(),
    current: () => true, show: f.show, split: item => calls.push(item), say() {} });
  const menu = f.shown.at(-1), button = menu.root.querySelectorAll('button')[0];
  assert.equal(menu.root.isConnected, true); assert.equal(f.doc.activeElement, button);
  assert.equal(menu.root.classList.contains('menu-sheet'), phone);
  menu.root.listeners.keydown({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} });
  assert.notEqual(f.doc.activeElement, button);
  menu.root.listeners.keydown({ key: 'ArrowUp', preventDefault() {}, stopPropagation() {} });
  assert.equal(f.doc.activeElement, button);
  button.onclick({ stopPropagation() {}, pointerType: phone ? 'touch' : 'mouse' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1); assert.equal(f.doc.activeElement, f.anchor); assert.equal(f.shown.at(-1).root.isConnected, false);
});
for (const dismissal of ['Escape', 'Tab', 'outside pointer', 'scroll']) test('1268 real menu ' + dismissal + ' invalidates pending source read', async () => {
  const f = actualMenus(), wait = deferred(); const pending = openSplitSources({ instanceId: 'instance', topicId: 'topic', rootId: 'destination',
    read: () => wait.promise, current: () => true, show: f.show, split() { assert.fail('dismissed menu must not split'); }, say() {} });
  if (dismissal === 'outside pointer') f.listeners.get('pointerdown')({ target: f.doc.body });
  else if (dismissal === 'scroll') { f.anchor.box = { top: 100, bottom: 130, left: 40, right: 70 }; f.listeners.get('scroll')({ target: f.doc.body }); }
  else f.shown[0].root.listeners.keydown({ key: dismissal, preventDefault() {}, stopPropagation() {} });
  wait.resolve(acts()); await pending; assert.equal(f.shown.length, 1); assert.equal(f.shown[0].root.isConnected, false);
});
