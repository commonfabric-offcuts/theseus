import test from 'node:test';
import assert from 'node:assert/strict';
import { Element, matches } from './fixtures/mini_dom.mjs';
import { Shell, Places, movesInPlace, hasRails } from '../web/in-place-navigation.mjs';
import { TopicNavigation, routeHref } from '../web/topic-navigation.mjs';

const turn = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const held = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// DOM/history adapters only. Shell.move, restore, retirement, history and
// navigation decisions are actual product code; no browser geometry is claimed.
function fixture({ route = { kind: 'topic', id: 't1' }, served = null } = {}) {
  const doc = { title: 'Theseus', activeElement: null };
  class Dom extends Element {
    get nodeType() { return 1; }
    get ownerDocument() { return doc; }
    get childNodes() { return this.children; }
    get firstChild() { return this.children[0] ?? null; }
    get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; }
    matches(selector) { return selector === '[id]' ? Boolean(this.id) : selector === 'h1' ? this.tag === 'h1' : matches(this, selector); }
    querySelectorAll(selector) { return [...this.descendants()].filter(node => node.matches(selector)); }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    blur() { doc.activeElement = doc.body; }
    cloneNode(deep) {
      const clone = new Dom(this.tag, doc);
      Object.assign(clone, { id: this.id, className: this.className, textContent: this.textContent,
        dataset: { ...this.dataset }, attributes: { ...this.attributes }, hidden: this.hidden });
      if (deep) clone.append(...this.children.map(child => child.cloneNode(true)));
      return clone;
    }
  }
  const make = (tag, id = '', className = '') => Object.assign(new Dom(tag, doc), { id, className });
  doc.body = make('body'); doc.body.root = true; doc.documentElement = make('html');
  doc.activeElement = doc.body;
  doc.getElementById = id => doc.body.querySelector('#' + id);
  doc.querySelector = selector => selector === '#main h1' ? doc.getElementById('main').querySelector('h1') : doc.body.querySelector(selector);
  const layout = make('div', '', 'workspace-layout'), rail = make('aside', 'rail'), outline = make('section', 'outline');
  const keyRow = make('a', 'kept-key-row'), brand = make('div', '', 'brand'), foot = make('div', '', 'rail-foot');
  const main = make('main', 'main'), heading = make('h1', 'heading'), content = make('div', 'content');
  const things = make('aside', 'things'), thingsBackdrop = make('div', 'things-backdrop'), railBackdrop = make('div', 'rail-backdrop');
  outline.append(keyRow); rail.append(brand, outline, foot); main.append(heading, content);
  layout.append(rail, main, things, thingsBackdrop); doc.body.append(layout, railBackdrop);
  rail.scrollTop = 173; outline.scrollTop = 41;
  const win = new EventTarget(), events = [], retired = [], loaded = [];
  win.location = { href: new URL(routeHref(route), 'https://fixture/').href,
    assign: href => events.push(['assign', href]), reload: () => events.push(['reload']) };
  win.history = { state: null, went: [], entries: [],
    replaceState(state, _title, href) { this.state = state; if (href !== undefined) win.location.href = new URL(href, win.location.href).href; },
    pushState(state, title, href) { this.replaceState(state, title, href); this.entries.push(href); },
    go(delta) { this.went.push(delta); } };
  win.scrollTo = (...args) => events.push(['scroll', ...args]);
  let holdLoad = null, holding = false;
  const shell = new Shell({ doc, win, build: served ? 'A' : null, ...(served ? { served } : {}),
    reads: { depart: () => events.push(['depart']), stay: () => events.push(['stay']) },
    load: async number => { loaded.push(number); if (holdLoad) await holdLoad.promise; start(); } });
  // Installation has already supplied the template and persistent holders.
  // Retain the actual begin/ready/move/restore paths below.
  shell.install = () => {}; shell.installed = true; shell.pristine = doc.body.cloneNode(true);
  shell.title = doc.title; shell.places = new Places(win.history); shell.drawer = { close() {}, isOpen: () => false };
  function start() {
    const navigation = new TopicNavigation({ current: shell.route(), navigateTarget: (target, still) => {
      if (!shell.go(target, still)) shell.leave(routeHref(target));
    } });
    shell.begin({ open: (target, title) => navigation.openTarget(target, title), retire: ids => retired.push(ids),
      refused: why => events.push(['refused', why.message]), updated: reload => events.push(['updated', reload]) });
    shell.guard(() => holding);
    doc.getElementById('content').textContent = routeHref(shell.route());
    shell.ready({ view: async () => ({}), workspaceId: shell.route().kind === 'workspace' ? shell.route().id : null });
  }
  start();
  const pop = async (href, index) => { win.location.href = new URL(href, win.location.href).href; await shell.popstate({ state: { aimPlace: index } }); await turn(); };
  return { shell, doc, win, rail, outline, keyRow, main, events, retired, loaded, pop,
    hold: value => { holding = value; }, holdLoad: () => { holdLoad = held(); return holdLoad; } };
}

test('901 every topic, Conversation, outcome and root pair moves in place; other routes still load', () => {
  const routes = [{ kind: 'topic', id: 't' }, { kind: 'conversation', id: 'w' }, { kind: 'workspace', id: 'w' }, { kind: 'root' }];
  for (const from of routes) for (const to of routes) assert.equal(movesInPlace(from, to), true, from.kind + ' to ' + to.kind);
  for (const other of [{ kind: 'pipeline', id: 'w' }, { kind: 'health' }, { kind: 'cards', id: 'n' }, { kind: 'create', intent: 'i' }, null]) {
    for (const route of routes) assert.deepEqual([movesInPlace(route, other), movesInPlace(other, route)], [false, false]);
  }
  assert.equal(hasRails({ kind: 'root' }), false, 'root presentation stays unchanged');
  assert.equal(hasRails({ kind: 'workspace', id: 'w' }), true);
});

test('901 actual move retains rail, outline, scroll and key row while replacing main and retiring old IDs', async () => {
  const f = fixture(); f.keyRow.focus(); f.shell.by = 'keys';
  const oldContent = f.doc.getElementById('content'); oldContent.textContent = 'old run';
  let hidden = 0; const pagehide = () => hidden++;
  f.win.addEventListener('pagehide', pagehide); f.shell.scope.add(f.win, 'pagehide', pagehide);
  await f.shell.open({ kind: 'workspace', id: 'w2' }, 'Two'); await turn();
  assert.equal(f.loaded.length, 1);
  assert.equal(f.doc.getElementById('rail') === f.rail, true);
  assert.equal(f.doc.getElementById('outline') === f.outline, true);
  assert.equal(f.doc.getElementById('main') === f.main, false);
  assert.deepEqual([f.rail.scrollTop, f.outline.scrollTop], [173, 41]);
  assert.equal(f.doc.activeElement === f.keyRow, true);
  assert.equal(f.retired[0].get('content') === oldContent, true);
  assert.equal(f.retired[0].has('kept-key-row'), false);
  oldContent.textContent = 'late old response';
  assert.equal(f.doc.getElementById('content').textContent, '?workspace=w2');
  assert.equal(hidden, 1); f.win.dispatchEvent(new Event('pagehide')); assert.equal(hidden, 1);
  assert.deepEqual(f.win.history.entries, ['?workspace=w2']);
  assert.equal(f.events.some(([name]) => name === 'assign' || name === 'reload'), false);
});

test('901 root arrival and return use actual ready lifecycle and the same retained outline', async () => {
  const f = fixture({ route: { kind: 'workspace', id: 'w1' } });
  await f.shell.open({ kind: 'root' }); await turn();
  assert.equal(f.shell.handles.route.kind, 'root');
  assert.equal(f.doc.documentElement.hasAttribute('data-rails'), false);
  assert.equal(f.doc.getElementById('outline') === f.outline, true);
  await f.shell.open({ kind: 'topic', id: 't2' }); await turn();
  assert.equal(f.shell.handles.route.kind, 'topic');
  assert.equal(f.doc.getElementById('outline') === f.outline, true);
  assert.equal(f.rail.scrollTop, 173);
  assert.deepEqual(f.win.history.entries, ['/', '?topic=t2']);
});

test('901 actual back and forward traverse workspace and root without adding entries', async () => {
  const f = fixture();
  await f.shell.open({ kind: 'workspace', id: 'w' }); await turn();
  await f.shell.open({ kind: 'root' }); await turn();
  await f.pop('?workspace=w', 1); assert.equal(f.shell.handles.route.kind, 'workspace');
  await f.pop('/', 2); assert.equal(f.shell.handles.route.kind, 'root');
  assert.deepEqual(f.win.history.entries, ['?workspace=w', '/']);
  assert.equal(f.events.some(([name]) => name === 'assign' || name === 'reload'), false);
});

test('901 a second back while an outcome load is held is settled by the actual next run', async () => {
  const f = fixture();
  await f.shell.open({ kind: 'workspace', id: 'w' }); await turn();
  await f.shell.open({ kind: 'root' }); await turn();
  const load = f.holdLoad();
  await f.pop('?workspace=w', 1); await f.pop('?topic=t1', 0);
  assert.ok(f.shell.owed, 'the second Back waits for the run already loading');
  assert.equal(f.shell.owed.pop, true);
  load.resolve(); await turn();
  assert.equal(f.shell.handles.route.kind, 'topic');
  assert.equal(f.shell.handles.route.id, 't1');
  assert.equal(f.shell.owed, null);
  assert.equal(f.events.some(([name]) => name === 'reload'), false);
});

test('901 registered Notebook writing guard refuses in-place departure and keeps the original page', async () => {
  const f = fixture({ route: { kind: 'workspace', id: 'w' } }); f.hold(true);
  await f.shell.open({ kind: 'root' }); await turn();
  assert.equal(f.loaded.length, 0);
  assert.equal(f.doc.getElementById('main') === f.main, true);
  assert.match(f.events.find(([name]) => name === 'refused')?.[1] ?? '', /writing.*saved|saved.*writing/i);
  assert.deepEqual(f.win.history.entries, []);
  f.hold(false); await f.shell.open({ kind: 'root' }); await turn();
  assert.equal(f.loaded.length, 1);
});

test('901 writing becoming held during the build read refuses and a refused Back restores its history place', async () => {
  const answer = held(), f = fixture({ route: { kind: 'workspace', id: 'w' }, served: () => answer.promise });
  await f.shell.open({ kind: 'root' });
  f.hold(true); answer.resolve('A'); await turn();
  assert.equal(f.loaded.length, 0); assert.deepEqual(f.win.history.entries, []);
  await f.pop('?topic=t', -1);
  assert.deepEqual(f.win.history.went, [1]);
  assert.equal(f.loaded.length, 0);
});

test('901 a changed build still loads safely or keeps held writing with the existing update notice', async () => {
  for (const holding of [false, true]) {
    const f = fixture({ route: { kind: 'workspace', id: 'w' }, served: async () => 'B' }); f.hold(holding);
    await f.shell.open({ kind: 'root' }); await turn();
    assert.equal(f.loaded.length, 0);
    assert.equal(f.events.some(([name]) => name === 'assign'), !holding);
    assert.equal(f.events.some(([name]) => name === 'updated'), holding);
  }
});

test('1005 a shared queued read retired by navigation is never dispatched; the new run reads',async()=>{
  const {shell}=fixture(),gate=held(),entered=held(),calls=[];
  shell.ready({view:async(name)=>{calls.push(name);if(name==='held'){entered.resolve();await gate.promise;}return{name};}});
  const first=shell.view('held',{});await entered.promise;
  let current=true;const old=shell.view('retired',{},'foreground',()=>current);
  const rejected=assert.rejects(old,error=>error.code==='READ_SUPERSEDED');current=false;
  gate.resolve();await first;await rejected;assert.deepEqual(calls,['held']);
  assert.deepEqual(await shell.view('new',{},'foreground'),{name:'new'});assert.deepEqual(calls,['held','new']);
});
