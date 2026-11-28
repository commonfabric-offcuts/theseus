// Actual outline, topic-list and key-tree owners. This adapter supplies DOM
// structure/events, local storage and read answers only: no browser, geometry,
// subprocess, Core, HTTP, application server or native-input claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OutlineRail, Opened } from '../web/outline-rail.mjs';
import { Element, matches } from './fixtures/mini_dom.mjs';
import { book, scopeOf } from '../web/outline-order.mjs';
import { KEY_WORDS } from '../web/pane-keys.mjs';
import { RULES } from '../web/interaction-guide.mjs';
import { OutcomeColorPicker } from '../web/outcome-color-picker.mjs';

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

async function fixture(t, { storage = memory(), actor = 'reader', instance = 'fixture-902', phone = false, here = 'w1', outcomes = null, topicRows = null } = {}) {
  if (!contexts.has(t)) {
    contexts.add(t);
    const previous = globalThis.document, listeners = new Set(book.listeners), scopes = new Map(book.scopes);
    t.after(() => { globalThis.document = previous; book.listeners = listeners; book.scopes = scopes; });
  }
  const doc = { visibilityState: 'visible', listeners: {}, addEventListener: OutlineElement.prototype.addEventListener,
    removeEventListener: OutlineElement.prototype.removeEventListener };
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
      return { ...base, groups: { done: 0, archived: 0 }, items: topicRows?.[args.workspace_id]?.map((item,index)=>({list_position:index+1,archived:false,...item})) ?? [{ id: 't-' + args.workspace_id, workspace_id: args.workspace_id,
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

test('957 unconfirmed decoration never refuses the outline or another outcome', async t => {
  const f = await fixture(t, { instance: '957-unconfirmed', outcomes: [
    item('w1', { color: 'blue' }), item('w2', { color: 'unknown', color_revision: 1 }),
    item('w3', { color: 'blue', color_revision: 1 }),
  ] });
  assert.equal(f.outline.list.children.length, 3);
  assert.equal(f.outcome('w1').li.dataset.color, undefined);
  assert.equal(f.outcome('w2').li.dataset.color, undefined);
  assert.equal(f.outcome('w3').li.dataset.color, 'blue');
  f.rows[2].color = 'rose'; await f.flush();
  assert.equal(f.outcome('w3').li.dataset.color, undefined, 'same revision with conflicting color is unconfirmed');
  assert.equal(f.outline.list.children.length, 3);
  f.rows[2].color = null; f.rows[2].color_revision = 0; await f.flush();
  assert.equal(f.outcome('w3').li.dataset.color, 'blue', 'an older valid projection cannot reverse a confirmed choice');
});

test('957 an older workspace response leaves the title usable without offering an unconfirmed picker', async t => {
  const f = await fixture(t, { instance: '957-unconfirmed-title' });
  const title = f.doc.createElement('h1'); title.textContent = 'Readable outcome'; f.doc.body.append(title);
  const picker = new OutcomeColorPicker({ title, api: {}, bootstrap: { instance_id: '957-unconfirmed-title', actor: 'reader' }, workspaceId: 'w1' });
  t.after(() => picker.dispose());
  assert.doesNotThrow(() => picker.paint(item('w1', { color: 'blue' })));
  assert.equal(title.textContent, 'Readable outcome'); assert.equal(picker.root.hidden, true);
  picker.paint(item('w1', { color: 'blue', color_revision: 1 }));
  assert.equal(picker.root.hidden, false); assert.equal(picker.trigger.dataset.color, 'blue');
});

test('957 unconfirmed count decoration cannot block counts or inherit a previous color revision', async t => {
  const f = await fixture(t, { instance: '957-unconfirmed-counts', outcomes: [item('w1', { color: 'blue', color_revision: 1 })] });
  const counts = extra => ({ id: 'w1', unread: 7, addressed: 0, build: { unread: 0, addressed: 0 }, cover_waiting: 0, light: null, ...extra });
  for (const decoration of [{ color: 'rose' }, { color: 'unknown', color_revision: 2 }, {}]) {
    await f.outline.loadCounts(async () => ({ instance_id: '957-unconfirmed-counts', items: [counts(decoration)] }), f.outline.handles, () => true);
    f.outline.paint();
    assert.equal(f.outcome('w1').item.unread, 7);
    assert.equal(f.outcome('w1').li.dataset.color, undefined);
  }
  await assert.rejects(f.outline.loadCounts(async () => ({ instance_id: '957-unconfirmed-counts', items: [counts({ unread: -1 })] }),
    f.outline.handles, () => true), /counts could not be confirmed/);
});

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

test('902 phone topic and home arrival open their current outcome without folding other choices', async t => {
  const f = await fixture(t, { phone: true });
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
  assert.deepEqual(['w1', 'w2', 'w3'].map(id => restored.outcome(id).topics.hidden), [true, false, true]);
  const otherReader = await fixture(t, { storage, actor: 'other-reader' });
  assert.equal(otherReader.outcome('w2').topics.hidden, true);
  const otherInstance = await fixture(t, { storage, instance: 'other-instance' });
  assert.equal(otherInstance.outcome('w2').topics.hidden, true);
  otherReader.outline.setOpen(otherReader.outcome('w3'), true);
  otherInstance.outline.setOpen(otherInstance.outcome('w3'), true);
  assert.equal(storage.values.size, 3, 'each reader/instance manual preference has its own record');
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

test('902 New still shows every matching outcome open without overwriting kept folds', async t => {
  const f = await fixture(t);
  f.outline.setOpen(f.outcome('w1'), false); f.outline.setOpen(f.outcome('w2'), true); await f.flush();
  const saved = [...f.storage.values];
  for (const [chip, shown] of [[f.outline.onlyNew, ['w1', 'w2']]]) {
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
  assert.deepEqual(['w1', 'w2', 'w3', 'w4'].map(id => f.outcome(id).topics.hidden), [true, true, true, true]);
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
  assert.equal(reconstructed.outcome('w2').topics.hidden, true, 'desktop arrival does not replace a missing choice with an automatic open');
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

test('902 plain name navigation keeps disclosure;1041 Option name clicks dim without navigation or reads', async t => {
  const f = await fixture(t), second = f.outcome('w2');
  f.outline.setOpen(second, true); await f.flush();
  f.click(second.name); assert.equal(second.topics.hidden, false);
  f.click(second.name, { detail: 0 });
  assert.deepEqual(f.moves, [[{ kind: 'workspace', id: 'w2' }, 'Outcome w2'], [{ kind: 'workspace', id: 'w2' }, 'Outcome w2']]);
  const reads = f.reads.length;
  const beforeCommand = JSON.stringify(f.outline.dimming.choices.value);
  assert.equal(f.click(second.name, { metaKey: true }).defaultPrevented, false, 'Command belongs to the browser');
  assert.equal(JSON.stringify(f.outline.dimming.choices.value), beforeCommand);
  assert.equal(f.moves.length, 2);
  const modified = f.click(second.name, { altKey: true });
  assert.equal(modified.defaultPrevented, true); assert.equal(f.moves.length, 2);
  assert.equal(second.li.dataset.dimmed, 'true'); assert.equal(second.topics.hidden, false);
  f.click(second.name, { altKey: true }); assert.equal(second.li.dataset.dimmed, 'false');
  f.click(second.name, { altKey: true, shiftKey: true });
  assert.equal(second.li.dataset.dimmed, 'false'); assert.equal(f.outcome('w3').li.dataset.dimmed, 'true');
  assert.equal(f.moves.length, 2); assert.equal(f.reads.length, reads);
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

test('46 an outcome badge follows the first unread topic in the loaded rail order', async t => {
  const topics = [
    { id: 'read', title: 'Read', unread: 0, list_position: 3 },
    { id: 'unread-a', title: 'Unread A', unread: 2, list_position: 2 },
    { id: 'unread-b', title: 'Unread B', unread: 1, list_position: 1 },
  ].map(row => ({ ...row, workspace_id: 'w2', state: 'active' }));
  const f = await fixture(t, { topicRows: { w2: topics } }), outcome = f.outcome('w2');
  f.click(outcome.disclosure); await f.flush();
  book.learn(scopeOf('w2'), { ids: ['read', 'unread-b', 'unread-a'], revision: 1 });
  assert.deepEqual(outcome.parts.host.children.map(link => link.dataset.topicId), ['read', 'unread-b', 'unread-a']);
  f.click(outcome.disclosure); await f.flush();
  const beforeReads = f.reads.length, beforeWrites = f.storage.writes.length;
  const badge = outcome.title.querySelector('.unread-count');
  f.click(badge);
  f.click(outcome.name, { detail: 0 });
  f.click(outcome.title);
  assert.deepEqual(f.moves, [
    [{ kind: 'topic', id: 'unread-b', at: 'unread' }, 'Unread B'],
    [{ kind: 'topic', id: 'unread-b', at: 'unread' }, 'Unread B'],
    [{ kind: 'workspace', id: 'w2' }, 'Outcome w2'],
  ]);
  assert.equal(f.reads.length, beforeReads);
  assert.equal(f.storage.writes.length, beforeWrites);
});

test('46 a phone outcome badge opens its home when no eligible unread topic is loaded', async t => {
  const f = await fixture(t, { phone: true }), outcome = f.outcome('w2');
  const beforeReads = f.reads.length, beforeWrites = f.storage.writes.length;
  f.click(outcome.title.querySelector('.unread-count'));
  assert.deepEqual(f.moves, [[{ kind: 'workspace', id: 'w2' }, 'Outcome w2']]);
  assert.equal(outcome.topics.hidden, true);
  assert.equal(f.reads.length, beforeReads);
  assert.equal(f.storage.writes.length, beforeWrites);
});

test('902 a refused topic read keeps the disclosed outcome and exposes the existing retry', async t => {
  const f = await fixture(t), second = f.outcome('w2');
  f.refuseTopics(); assert.ok(second.disclosure); f.click(second.disclosure); await f.flush();
  assert.equal(second.topics.hidden, false); assert.equal(second.disclosure.getAttribute('aria-expanded'), 'true');
  assert.equal(second.parts.retry.hidden, false); assert.match(second.parts.message.textContent, /Topics unavailable.*Retry topics/);
  assert.deepEqual(f.moves, []);
});


test('944 desktop name navigation, topic arrival and reconstruction preserve manual disclosure without writing it', async t => {
  const storage = memory(), f = await fixture(t, { storage });
  assert.deepEqual(['w1','w2','w3'].map(id=>f.outcome(id).topics.hidden), [true,true,true], 'desktop outcomes without a choice start folded');
  assert.equal(storage.writes.length, 0, 'initial arrival writes no disclosure');
  f.click(f.outcome('w2').disclosure); await f.flush();
  const before = storage.writes.length;
  f.click(f.outcome('w3').name); await f.arrive('w3');
  assert.deepEqual(f.moves.at(-1)[0], {kind:'workspace',id:'w3'});
  assert.deepEqual(['w1','w2','w3'].map(id=>f.outcome(id).topics.hidden), [true,false,true]);
  await f.arrive('w3','topic');
  assert.equal(storage.writes.length, before, 'name/home/topic arrival never writes an open mark');
  const restored = await fixture(t, {storage,here:'w3'});
  assert.deepEqual(['w1','w2','w3'].map(id=>restored.outcome(id).topics.hidden), [true,false,true]);
  restored.click(restored.outcome('w2').disclosure); await restored.flush();
  const folded = storage.writes.length;
  await restored.arrive('w2','topic');
  assert.equal(restored.outcome('w2').topics.hidden, true, 'current outcome remains explicitly folded');
  assert.equal(storage.writes.length, folded);
  assert.equal((await fixture(t,{storage,here:'w2'})).outcome('w2').topics.hidden, true, 'reload does not reopen the current outcome');
});


const waitingRows981 = {
  w1: [{ id:'q981',workspace_id:'w1',title:'Quiet topic',state:'active',unread:0 }],
  w2: [{ id:'a981',workspace_id:'w2',title:'A topic waiting on the reader',state:'waiting',waiting_on:['reader'],unread:0 }],
  w3: [{ id:'c981',workspace_id:'w3',title:'A dossier cover waiting on the reader',state:'active',cover_waiting:1,unread:0 }],
};
const waitingOutcomes981 = () => [item('w1'),item('w2',{light:{light:'waiting',short:{kind:'asks',count:1}}}),item('w3',{cover_waiting:1})];
const tick981 = async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const topic981 = (f,w)=>f.outcome(w).parts.host.querySelector('a');

test('372 desktop uses the waiting pill and topic row, with no hidden cycle control',async t=>{
  const asks=[{actor_id:'reader',message_id:'m-372-old',since_ms:1},{actor_id:'reader',message_id:'m-372-next',since_ms:2}];
  const f=await fixture(t,{outcomes:[item('w2',{light:{light:'waiting',short:{kind:'asks',count:2}}})],
    topicRows:{w2:[{id:'t372-pill',workspace_id:'w2',title:'Waiting topic',state:'active',unread:0,asks}]}});
  f.outline.setOpen(f.outcome('w2'),true);await f.flush();
  assert.equal(f.outcome('w2').waiting,null);assert.equal(f.outline.list.querySelector('.ol-waiting'),null);
  assert.equal(f.outline.waitingCount.textContent,'2');f.click(f.outline.onlyWaiting);await tick981();
  const row=topic981(f,'w2');assert.equal(row.dataset.dimmed,'false');
  f.click(row);f.click(row);
  assert.deepEqual(f.moves.map(([target])=>target.message),['m-372-old','m-372-next']);
});

test('372 phone drawer retains its visible cycle control and loses it on desktop resize',async t=>{
  const f=await fixture(t,{phone:true,outcomes:[item('w2',{light:{light:'waiting',short:{kind:'asks',count:2}}})]});
  const outcome=f.outcome('w2');assert.ok(outcome.waiting);assert.equal(outcome.waiting.hidden,false);
  const button=outcome.waiting;button.focus();
  f.doc.defaultView.matchMedia=()=>({matches:false});f.outline.paint();
  assert.equal(outcome.waiting,null);assert.equal(f.doc.activeElement,outcome.name);
  f.doc.defaultView.matchMedia=()=>({matches:true});f.outline.paint();
  assert.ok(outcome.waiting);assert.notEqual(outcome.waiting,button);
});

test('981 waiting keeps every row and manual fold, paints said/cover waits and preserves its count without a read',async t=>{
  const f=await fixture(t,{outcomes:waitingOutcomes981(),topicRows:waitingRows981});
  for(const id of ['w1','w2','w3'])f.outline.setOpen(f.outcome(id),true);
  await f.flush();
  const rows=['w1','w2','w3'].map(id=>f.outcome(id)),links=rows.map(o=>o.parts.host.querySelector('a'));
  const count=f.outline.waitingCount.textContent,reads=f.reads.length,saved=JSON.stringify([...f.storage.values]);
  f.click(f.outline.onlyWaiting);await tick981();
  assert.deepEqual(rows.map(o=>o.li.hidden),[false,false,false],'no outcome disappears');
  assert.deepEqual(rows.map(o=>o.topics.hidden),[false,false,false],'no disclosure changes');
  assert.deepEqual(links.map(link=>link.dataset.dimmed),['true','false','false'],'said and cover waiting rows keep their original eligibility');
  assert.deepEqual(rows.map(o=>o.li.dataset.dimmed),['true','false','false']);
  assert.equal(f.outline.waitingCount.textContent,count);assert.equal(count,'2');
  assert.equal(f.reads.length,reads,'paint-only pill does not reread outcomes or topic lists');
  assert.equal(JSON.stringify([...f.storage.values]),saved);
  f.click(f.outline.onlyWaiting);await tick981();
  assert.ok(links.every(link=>link.dataset.dimmed==='false'));assert.equal(f.reads.length,reads);
  assert.equal(JSON.stringify([...f.storage.values]),saved);
});

test('981 waiting preserves a folded matching outcome and nonmatching folds instead of opening the rail',async t=>{
  const f=await fixture(t,{outcomes:waitingOutcomes981(),topicRows:waitingRows981});
  f.outline.setOpen(f.outcome('w1'),false);f.outline.setOpen(f.outcome('w2'),true);f.outline.setOpen(f.outcome('w3'),false);await f.flush();
  const folds=['w1','w2','w3'].map(id=>f.outcome(id).topics.hidden),saved=JSON.stringify([...f.storage.values]);
  f.click(f.outline.onlyWaiting);await tick981();
  assert.deepEqual(['w1','w2','w3'].map(id=>f.outcome(id).topics.hidden),folds);
  assert.deepEqual(['w1','w2','w3'].map(id=>f.outcome(id).li.hidden),[false,false,false]);
  f.click(f.outline.onlyWaiting);await tick981();assert.equal(JSON.stringify([...f.storage.values]),saved);
});

test('981 waiting composes with saved sets and0 without writing or replacing either set',async t=>{
  const f=await fixture(t,{outcomes:waitingOutcomes981(),topicRows:waitingRows981});
  for(const id of ['w1','w2','w3'])f.outline.setOpen(f.outcome(id),true);await f.flush();
  const dim=f.outline.dimming;dim.choices.toggle('w3','c981');dim.choices.select(2);dim.choices.toggle('w2','a981');dim.choices.select(1);dim.paint();
  const saved=JSON.stringify(dim.choices.value),writes=f.storage.writes.length;
  assert.ok(topic981(f,'w1'),'quiet topic exists before the pill');
  f.click(f.outline.onlyWaiting);await tick981();
  assert.equal(topic981(f,'w1').dataset.dimmed,'true');assert.equal(topic981(f,'w3').dataset.dimmed,'false','1003 reader wait overrides the saved layer');
  assert.equal(topic981(f,'w2').dataset.dimmed,'false');assert.equal(JSON.stringify(dim.choices.value),saved);assert.equal(f.storage.writes.length,writes);
  dim.choices.select(0);dim.paint();assert.equal(topic981(f,'w1').dataset.dimmed,'true','0 bypasses saved sets only');assert.equal(topic981(f,'w3').dataset.dimmed,'false');
  dim.choices.select(1);dim.paint();f.click(f.outline.onlyWaiting);await tick981();
  assert.equal(topic981(f,'w1').dataset.dimmed,'false');assert.equal(topic981(f,'w3').dataset.dimmed,'false');assert.equal(JSON.stringify(dim.choices.value),saved);
});

test('981 existing row waiting markers repaint without changing saved-set contents',async t=>{
  const f=await fixture(t,{outcomes:waitingOutcomes981(),topicRows:waitingRows981});
  f.outline.setOpen(f.outcome('w1'),true);await f.flush();const row=topic981(f,'w1');assert.ok(row,'quiet row exists before the pill');f.click(f.outline.onlyWaiting);await tick981();
  const dim=f.outline.dimming,saved=JSON.stringify(dim.choices.value);
  assert.equal(row.dataset.dimmed,'true');row.setAttribute('data-cover-waiting','');dim.paintRows();assert.equal(row.dataset.dimmed,'false');
  row.removeAttribute('data-cover-waiting');const state=f.doc.createElement('span');state.className='topic-state mine';row.append(state);dim.paintRows();assert.equal(row.dataset.dimmed,'false');
  state.remove();dim.paintRows();assert.equal(row.dataset.dimmed,'true');assert.equal(JSON.stringify(dim.choices.value),saved);
});

test('1005 topic pages and outcome homes consume one persistent rail; clearing current keeps rows until read',async t=>{
 const f=await fixture(t),outcome=f.outcome('w1'),rail=outcome.rail,nodes=[...outcome.parts.host.children];
 const bootstrap=f.outline.bootstrap,topic={id:'t-w1',workspace_id:'w1',title:'Topic w1',list_position:1,state:'active'};
 assert.equal(f.outline.topicsFor(bootstrap,topic,20),rail);assert.equal(f.outline.topicsFor(bootstrap,{...topic,title:'New title'},20),rail);
 assert.deepEqual(outcome.parts.host.children,nodes);rail.updateCurrent(null);
 assert.deepEqual(outcome.parts.host.children,nodes);assert.equal(nodes[0].getAttribute('aria-current'),null);
 await f.arrive('w2');assert.equal(f.outcome('w1').rail,rail);assert.deepEqual(outcome.parts.host.children,nodes);
});
