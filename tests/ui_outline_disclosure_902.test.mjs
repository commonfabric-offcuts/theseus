// Actual outline, topic-list and key-tree owners. This adapter supplies DOM
// structure/events, local storage and read answers only: no browser, geometry,
// subprocess, Core, HTTP, application server or native-input claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OutlineRail, Opened } from '../web/outline-rail.mjs';
import { Element, matches } from './fixtures/mini_dom.mjs';
import { book } from '../web/outline-order.mjs';
import { KEY_WORDS } from '../web/pane-keys.mjs';
import { RULES } from '../web/interaction-guide.mjs';

class OutlineElement extends Element {
  get ownerDocument() { return this.document; }
  get parentElement() { return this.parent; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] ?? null; }
  get firstElementChild() { return this.children.find(child => typeof child === 'object') ?? null; }
  get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; }
  get textContent() { return (this.words ?? '') + this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this.words = String(value); }
  get text() { return this.textContent; }
  get href() { return this.getAttribute('href') ?? ''; }
  set href(value) { this.setAttribute('href', value); }
  setAttribute(name, value) {
    super.setAttribute(name, value);
    if (name === 'class') this.className = String(value);
    if (name === 'id') this.id = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  contains(node) { return node === this || [...this.descendants()].includes(node); }
  after(...nodes) {
    const parent = this.parent;
    for (const node of nodes) { node.remove(); node.parent = parent; }
    parent.children.splice(parent.children.indexOf(this) + 1, 0, ...nodes);
  }
  cloneNode(deep) {
    const copy = this.document.createElement(this.tag);
    Object.assign(copy, { className: this.className, id: this.id, words: this.words, attributes: { ...this.attributes }, dataset: { ...this.dataset } });
    if (deep) copy.append(...this.children.map(child => typeof child === 'string' ? child : child.cloneNode(true)));
    return copy;
  }
  matches(selector) { return selector === ':focus-visible' ? this.document.activeElement === this : matches(this, selector); }
  checkVisibility() {
    if (!this.isConnected) return false;
    for (let at = this; at; at = at.parent) if (at.hidden || at.inert) return false;
    return true;
  }
  getClientRects() { return this.checkVisibility() ? [{}] : []; }
  addEventListener(type, listener, options = false) {
    (this.listeners[type] ??= []).push({ listener, capture: options === true || options?.capture === true });
  }
  removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] ?? []).filter(entry => entry.listener !== listener); }
  focus() { this.document.activeElement = this; emit(this, 'focusin'); }
  blur() { this.document.activeElement = this.document.body; emit(this, 'focusout', { relatedTarget: this.document.body }); }
}

function emit(target, type, options = {}) {
  const event = { type, target, button: 0, detail: 1, defaultPrevented: false, stopped: false, ...options,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  const path = [];
  for (let at = target; at; at = at.parent) path.push(at);
  const call = (node, capture) => {
    for (const entry of node.listeners[type] ?? []) if (entry.capture === capture) entry.listener(event);
    if (!capture) node['on' + type]?.(event);
  };
  for (const node of [...path].reverse()) { call(node, true); if (event.stopped) return event; }
  for (const node of path) { call(node, false); if (event.stopped) break; }
  return event;
}

const memory = () => {
  const values = new Map(), writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, value); writes.push([key, value]); } };
};
const item = (id, extra = {}) => ({ id, title: 'Outcome ' + id, title_truncated: false, owner_id: 'reader', version: 1, unread: 2, addressed: 0, light: null, ...extra });
const contexts = new WeakSet();

async function fixture(t, { storage = memory(), actor = 'reader', instance = 'fixture-902', phone = false, here = 'w1', outcomes = null } = {}) {
  if (!contexts.has(t)) {
    contexts.add(t);
    const previous = globalThis.document, listeners = new Set(book.listeners), scopes = new Map(book.scopes);
    t.after(() => { globalThis.document = previous; book.listeners = listeners; book.scopes = scopes; });
  }
  const doc = { visibilityState: 'visible', listeners: {}, addEventListener: OutlineElement.prototype.addEventListener };
  doc.createElement = tag => new OutlineElement(tag, doc);
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  doc.body = doc.createElement('body'); doc.body.root = true; doc.activeElement = doc.body;
  doc.getElementById = id => [...doc.body.descendants()].find(node => node.id === id) ?? null;
  doc.querySelector = selector => selector === '#main > .topic-header' ? null : doc.body.querySelector(selector);
  doc.defaultView = { matchMedia: () => ({ matches: phone }), MutationObserver: class { observe() {} disconnect() {} } };
  const pencil = doc.createElement('button'); pencil.id = 'new-message'; pencil.append(doc.createElement('svg')); doc.body.append(pencil);
  const rail = doc.createElement('aside'); rail.id = 'rail'; rail.className = 'rail'; doc.body.append(rail);
  const host = doc.createElement('div'); host.id = 'outline'; rail.append(host);
  globalThis.document = doc;
  const reads = [], moves = [], rows = outcomes ?? [item('w1'), item('w2'), item('w3', { unread: 0, cover_waiting: 1 })];
  let refuseTopics = false;
  const read = async (name, args, lane) => {
    reads.push([name, structuredClone(args), lane]);
    const base = { instance_id: instance, next_cursor: null };
    if (name === 'workspaces') {
      const remaining = rows.filter(row => !args.cursor || row.id > args.cursor), page = remaining.slice(0, args.limit);
      return { ...base, items: page, next_cursor: remaining.length > page.length ? page.at(-1).id : null };
    }
    if (name === 'workspace_topics') {
      if (refuseTopics) throw Error('Topics unavailable');
      return { ...base, groups: { done: 0, archived: 0 }, items: [{ id: 't-' + args.workspace_id, workspace_id: args.workspace_id,
        title: 'Topic ' + args.workspace_id, list_position: 1, state: 'active', archived: false, unread: 0 }] };
    }
    if (name === 'conversation') return { instance_id: instance, conversation: null };
    if (name === 'stars' || name === 'memory_stars') return { ...base, items: [] };
    assert.fail('Unexpected read: ' + name);
  };
  const outline = new OutlineRail({ host, doc, storage, read, open: (target, title) => { moves.push([target, title]); return true; } });
  const handles = id => ({ bootstrap: { instance_id: instance, actor }, workspaceId: id, workspaceTitle: 'Outcome ' + id,
    route: { kind: 'workspace', id }, view: read, api: { command() { assert.fail('Disclosure sent a command'); } } });
  const flush = async () => {
    await outline.reload();
    for (let i = 0; i < 16; i++) await Promise.resolve();
    outline.tree.refresh();
  };
  const arrive = async (id, kind = 'workspace') => {
    outline.begin(true);
    const next = handles(id); next.route = { kind, id: kind === 'topic' ? 't-' + id : id };
    if (kind === 'topic') next.topic = { id: 't-' + id, workspace_id: id, title: 'Topic ' + id, list_position: 1, state: 'active' };
    outline.ready(next); await flush();
  };
  await arrive(here);
  return { outline, doc, storage, reads, moves, rows, arrive, flush,
    outcome: id => outline.outcomes.get(id), click: (node, options) => emit(node, 'click', options),
    key: (node, key, options) => emit(node, 'keydown', { key, ...options }), refuseTopics: () => { refuseTopics = true; } };
}

test('902 disclosure opens and folds two actual topic lists without navigation or an outcome-page read', async t => {
  const f = await fixture(t), second = f.outcome('w2'), third = f.outcome('w3');
  assert.equal(second.topics.hidden, true);
  for (const outcome of [second, third]) {
    assert.ok(outcome.disclosure, 'the outcome has its own disclosure');
    f.click(outcome.disclosure); await f.flush();
    assert.equal(outcome.topics.hidden, false);
    assert.equal(outcome.parts.host.querySelector('a').dataset.topicId, 't-' + outcome.id);
  }
  assert.equal(second.topics.hidden, false, 'opening another outcome keeps this one open');
  f.click(second.disclosure); await f.flush();
  assert.equal(second.topics.hidden, true); assert.equal(third.topics.hidden, false);
  assert.deepEqual(f.moves, []);
  assert.equal(f.reads.some(([name]) => name === 'workspace' || name === 'outcome_light'), false);
  assert.ok(f.reads.some(([name, args]) => name === 'workspace_topics' && args.workspace_id === 'w2'));
});

test('902 disclosure is a separate ordinary Tab button before the name with current expanded and controlled-list attributes', async t => {
  const f = await fixture(t), outcome = f.outcome('w2'), button = outcome.disclosure;
  assert.ok(button, 'disclosure exists');
  assert.deepEqual([button.tagName, button.type, button.tabIndex, button.disabled], ['BUTTON', 'button', 0, false]);
  assert.equal(outcome.row.children[0] === button, true); assert.equal(outcome.row.children[1] === outcome.name, true);
  assert.equal(button.getAttribute('aria-controls'), outcome.topics.id);
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-label'), 'Open topics in Outcome w2');
  f.click(button, { detail: 0 }); await f.flush();
  assert.equal(button.tabIndex, 0, 'the tree refresh does not remove the disclosure Tab stop');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(button.getAttribute('aria-label'), 'Fold topics in Outcome w2');
  assert.equal(button.querySelector('svg').getAttribute('data-glyph'), 'chevron');
  assert.equal(button.querySelector('svg').getAttribute('aria-hidden'), 'true');
});

test('902 topic and home arrival open their current outcome without folding other choices', async t => {
  const f = await fixture(t);
  f.outline.setOpen(f.outcome('w2'), true); await f.flush();
  await f.arrive('w3', 'topic');
  assert.deepEqual(['w1', 'w2', 'w3'].map(id => f.outcome(id).topics.hidden), [false, false, false]);
  f.outline.setOpen(f.outcome('w1'), false); await f.flush();
  await f.arrive('w2');
  assert.deepEqual(['w1', 'w2', 'w3'].map(id => f.outcome(id).topics.hidden), [true, false, false]);
  await f.arrive('w1'); assert.equal(f.outcome('w1').topics.hidden, false, 'arrival reopens the folded current outcome');
});

test('902 reconstruction restores explicit outcome choices for this reader and instance only', async t => {
  const storage = memory(), f = await fixture(t, { storage });
  f.outline.setOpen(f.outcome('w2'), true); f.outline.setOpen(f.outcome('w3'), false); await f.flush();
  const restored = await fixture(t, { storage });
  assert.deepEqual(['w1', 'w2', 'w3'].map(id => restored.outcome(id).topics.hidden), [false, false, true]);
  const otherReader = await fixture(t, { storage, actor: 'other-reader' });
  assert.equal(otherReader.outcome('w2').topics.hidden, true);
  const otherInstance = await fixture(t, { storage, instance: 'other-instance' });
  assert.equal(otherInstance.outcome('w2').topics.hidden, true);
  assert.equal(storage.values.size, 3, 'each reader/instance scope has an independent preference');
  restored.outline.setOpen(restored.outcome('w2'), false); await restored.flush();
  const foldedLast = await fixture(t, { storage });
  assert.equal(foldedLast.outcome('w2').topics.hidden, true, 'fold w2 last, then reconstruct: the fold was actually saved');
});

test('902 malformed or denied storage leaves controls usable and keeps page choices', async t => {
  for (const storage of [
    { getItem: () => '{broken', setItem() { throw Error('full'); } },
    { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } },
  ]) {
    const f = await fixture(t, { storage });
    f.outline.setOpen(f.outcome('w2'), true); await f.flush(); await f.arrive('w3');
    assert.equal(f.outcome('w2').topics.hidden, false);
    f.outline.setOpen(f.outcome('w2'), false); await f.flush();
    assert.equal(f.outcome('w2').topics.hidden, true);
  }
});

test('902 only explicit boolean preferences are admitted and new outcomes default folded', () => {
  const storage = { getItem: () => '{"w1":true,"w2":false,"w3":"open","w4":1}', setItem() {} };
  const opened = new Opened(storage, 'fixture');
  assert.deepEqual(['w1', 'w2', 'w3', 'w4', 'new'].map(id => opened.isOpen(id, 'current')), [true, false, false, false, false]);
  assert.equal(opened.isOpen('current', 'current'), true);
});

test('902 New and Waiting show every matching outcome open without overwriting kept folds', async t => {
  const f = await fixture(t);
  f.outline.setOpen(f.outcome('w1'), false); f.outline.setOpen(f.outcome('w2'), true); await f.flush();
  const saved = [...f.storage.values];
  for (const [chip, shown] of [[f.outline.onlyNew, ['w1', 'w2']], [f.outline.onlyWaiting, ['w3']]]) {
    f.click(chip); await f.flush();
    assert.deepEqual([...f.outline.outcomes.values()].filter(o => !o.li.hidden).map(o => o.id), shown);
    for (const id of shown) assert.equal(f.outcome(id).topics.hidden, false);
    assert.deepEqual([...f.storage.values], saved);
    f.click(chip); await f.flush();
    assert.deepEqual(['w1', 'w2', 'w3'].map(id => f.outcome(id).topics.hidden), [true, false, true]);
  }
});

test('902 actual tree arrows and Command arrows keep their expansion and child-focus grammar', async t => {
  const f = await fixture(t), second = f.outcome('w2');
  second.name.focus(); f.key(second.name, 'ArrowRight'); await f.flush();
  assert.equal(second.topics.hidden, false);
  f.key(second.name, 'ArrowRight'); assert.equal(f.doc.activeElement === second.newTopic, true);
  f.key(second.newTopic, 'ArrowLeft'); assert.equal(f.doc.activeElement === second.name, true);
  f.key(second.name, 'ArrowLeft'); await f.flush(); assert.equal(second.topics.hidden, true);
  f.key(second.name, 'ArrowRight', { metaKey: true }); await f.flush(); assert.equal(second.topics.hidden, false);
  f.key(second.name, 'ArrowLeft', { metaKey: true }); await f.flush(); assert.equal(second.topics.hidden, true);
  assert.deepEqual(f.moves, []);
});

test('921 Shift-Command sets the default for later outcomes and keeps subsequent fold exceptions', async t => {
  const f = await fixture(t);
  f.key(f.outcome('w2').name, 'ArrowRight', { metaKey: true, shiftKey: true }); await f.flush();
  assert.equal([...f.outline.outcomes.values()].every(o => !o.topics.hidden), true);
  f.rows.push(item('w4')); await f.flush();
  assert.equal(f.outcome('w4').topics.hidden, false, 'open all includes outcomes first encountered later');
  f.outline.setOpen(f.outcome('w2'), false); await f.flush();
  const rebuilt = await fixture(t, { storage: f.storage });
  assert.equal(rebuilt.outcome('w2').topics.hidden, true, 'a later individual fold is a kept exception');
  assert.equal(rebuilt.outcome('w3').topics.hidden, false, 'the all-open default is kept too');
  f.key(f.outcome('w2').name, 'ArrowLeft', { metaKey: true, shiftKey: true }); await f.flush();
  assert.equal([...f.outline.outcomes.values()].every(o => o.topics.hidden), true);
  await f.arrive('w3');
  assert.deepEqual(['w1', 'w2', 'w3', 'w4'].map(id => f.outcome(id).topics.hidden), [true, true, false, true]);
});

test('921 a fold in one tab survives another tab arriving in a different outcome', async t => {
  const storage = memory(), a = await fixture(t, { storage });
  a.outline.setOpen(a.outcome('w3'), true); await a.flush();
  const b = await fixture(t, { storage });
  assert.equal(b.outcome('w3').topics.hidden, false);
  a.outline.setOpen(a.outcome('w3'), false); await a.flush();
  await b.arrive('w2', 'topic');
  const reconstructed = await fixture(t, { storage });
  assert.equal(reconstructed.outcome('w3').topics.hidden, true, 'arrival must not write back the other tab’s stale open choice');
  assert.equal(b.outcome('w3').topics.hidden, true, 'the navigating tab paints the merged choices');
  assert.equal(reconstructed.outcome('w2').topics.hidden, false);
});

test('921 Shift-Command open-all includes the five outcomes beyond the first twenty', async t => {
  const outcomes = Array.from({ length: 25 }, (_, i) => item('w' + String(i + 1).padStart(2, '0')));
  const f = await fixture(t, { outcomes, here: 'w01' });
  assert.equal(f.outline.pages.items.length, 20); assert.equal(f.outcome('w21'), undefined);
  f.key(f.outcome('w02').name, 'ArrowRight', { metaKey: true, shiftKey: true }); await f.flush();
  assert.equal(f.outline.more.hidden, false); await f.outline.more.onclick();
  for (const id of ['w21', 'w22', 'w23', 'w24', 'w25']) {
    assert.equal(f.outcome(id).topics.hidden, false, id + ' arrives open');
    assert.equal(f.outcome(id).disclosure.getAttribute('aria-expanded'), 'true');
  }
  assert.deepEqual(f.reads.filter(([name]) => name === 'workspaces').at(-1)[1], { limit: 20, cursor: 'w20' });
  assert.equal(f.outline.more.hidden, true); assert.deepEqual(f.moves, []);
});

test('921 the Keys legend and guide describe arrival without folding other outcomes', () => {
  const keys = KEY_WORDS.find(([name]) => name === 'Return')[1];
  const guide = RULES.find(([name]) => name === 'Moving through the panes')[1];
  for (const words of [keys, guide]) {
    assert.doesNotMatch(words, /folding every other|tidies/);
    assert.match(words, /without folding/);
  }
});

test('921 legacy choices migrate without reserving an outcome id for the all-open default', () => {
  const storage = memory(); storage.setItem('outline', JSON.stringify({ every: true, marks: false, '*': true, w2: false }));
  const opened = new Opened(storage, 'outline');
  assert.deepEqual(['every', 'marks', '*', 'w2', 'new'].map(id => opened.isOpen(id)), [true, false, true, false, false]);
  opened.set('w1', true);
  const rebuilt = new Opened(storage, 'outline');
  assert.deepEqual(['every', 'marks', '*', 'w2', 'new'].map(id => rebuilt.isOpen(id)), [true, false, true, false, false]);
  rebuilt.all(true); rebuilt.set('every', false);
  const all = new Opened(storage, 'outline');
  assert.equal(all.isOpen('new'), true); assert.equal(all.isOpen('every'), false);
});

test('921 failed local saves remain on the page and merge other-tab choices when storage recovers', () => {
  const storage = memory(), save = storage.setItem; let full = false;
  storage.setItem = (key, value) => { if (full) throw Error('full'); save(key, value); };
  const a = new Opened(storage, 'outline'), b = new Opened(storage, 'outline');
  a.set('w1', true); full = true; a.set('w1', false); a.set('w2', true);
  assert.equal(a.isOpen('w1'), false); assert.equal(a.isOpen('w2'), true);
  full = false; b.set('w3', false); a.set('w4', true);
  const rebuilt = new Opened(storage, 'outline');
  assert.deepEqual(['w1', 'w2', 'w3', 'w4'].map(id => rebuilt.isOpen(id)), [false, true, false, true]);
});

test('902 name activation retains navigation and never doubles as desktop fold', async t => {
  const f = await fixture(t), second = f.outcome('w2');
  f.outline.setOpen(second, true); await f.flush();
  f.click(second.name); assert.equal(second.topics.hidden, false);
  f.click(second.name, { detail: 0 });
  assert.deepEqual(f.moves, [[{ kind: 'workspace', id: 'w2' }, 'Outcome w2'], [{ kind: 'workspace', id: 'w2' }, 'Outcome w2']]);
  const modified = f.click(second.name, { metaKey: true });
  assert.equal(modified.defaultPrevented, false); assert.equal(f.moves.length, 2);
});

test('902 phone first name tap expands without navigation or drawer bubbling; next tap navigates', async t => {
  const f = await fixture(t, { phone: true }), second = f.outcome('w2');
  let drawerLinks = 0; f.outline.host.addEventListener('click', event => { if (event.target.closest('a[href]')) drawerLinks++; });
  const first = f.click(second.name); await f.flush();
  assert.equal(first.stopped, true); assert.equal(second.topics.hidden, false);
  assert.deepEqual(f.moves, []); assert.equal(drawerLinks, 0);
  f.click(second.name); assert.equal(f.moves.length, 1); assert.equal(drawerLinks, 1);
  assert.ok(second.disclosure); f.click(second.disclosure); await f.flush();
  assert.equal(second.topics.hidden, true); assert.equal(f.moves.length, 1); assert.equal(drawerLinks, 1);
});

test('902 disclosure arrows and Command arrows act in place while Return on a phone name navigates', async t => {
  const f = await fixture(t, { phone: true }), second = f.outcome('w2');
  assert.ok(second.disclosure);
  for (const metaKey of [false, true]) {
    const right = f.key(second.disclosure, 'ArrowRight', { metaKey }); await f.flush();
    assert.equal(right.defaultPrevented, true); assert.equal(second.topics.hidden, false);
    f.key(second.disclosure, 'ArrowLeft', { metaKey }); await f.flush(); assert.equal(second.topics.hidden, true);
  }
  assert.deepEqual(f.moves, []);
  f.click(second.name, { detail: 0 }); assert.equal(f.moves.length, 1);
});

test('902 a refused topic read keeps the disclosed outcome and exposes the existing retry', async t => {
  const f = await fixture(t), second = f.outcome('w2');
  f.refuseTopics(); assert.ok(second.disclosure); f.click(second.disclosure); await f.flush();
  assert.equal(second.topics.hidden, false); assert.equal(second.disclosure.getAttribute('aria-expanded'), 'true');
  assert.equal(second.parts.retry.hidden, false); assert.match(second.parts.message.textContent, /Topics unavailable.*Retry topics/);
  assert.deepEqual(f.moves, []);
});
