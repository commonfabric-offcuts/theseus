// The two rails of a topic and an outcome's Conversation (items 272 and 131,
// docs/rails.md), in the parts that decide: what an outcome's row counts
// folded and open, what the chips add up, which outcomes the outline opens, which
// moves happen in place, how back and forward go through the page's guard,
// and what the right rail finds in messages. The native rail checks
// (tests/outcome_rail_native.mjs) press the same things in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { asksIn, rowCount, totals, elsewhere, elsewhereWords, shownUnder, Opened } from '../web/outline-rail.mjs';
import { movesInPlace, Places, Scope, Shell, Superseded, oneAtATime, buildOf, servedBuild } from '../web/in-place-navigation.mjs';
import { linksIn, pullRequest, isPreview, thingsIn, waitingFor, SectionFolds } from '../web/things-rail.mjs';

const asks = n => ({ light: 'waiting', short: { kind: 'asks', count: n } });

test('a folded outcome counts everything new inside it; an open one counts only its Conversation', () => {
  const item = { id: 'w1', unread: 9, addressed: 2 };
  const conversation = { unread: 3, addressed: 1 };
  assert.deepEqual(rowCount(item), { unread: 9, addressed: 2 });
  assert.deepEqual(rowCount(item, { open: false, conversation }), { unread: 9, addressed: 2 });
  assert.deepEqual(rowCount(item, { open: true, conversation }), { unread: 3, addressed: 1 });
  // Open with its Conversation not read yet (or none): nothing on the row, the topics show their own.
  assert.deepEqual(rowCount(item, { open: true }), { unread: 0, addressed: 0 });
  // What is not a count counts nothing.
  assert.deepEqual(rowCount({ unread: -1, addressed: 1.5 }), { unread: 0, addressed: 0 });
});

test('the chips add up what is new and what waits on the reader across every outcome', () => {
  assert.equal(asksIn({ light: asks(2) }), 2);
  assert.equal(asksIn({ light: { light: 'working', short: { kind: 'asks', count: 2 } } }), 0, 'only a waiting light counts its asks');
  assert.equal(asksIn({ light: { light: 'waiting', short: { kind: 'stale', count: 4 } } }), 0, 'only asks are questions');
  const items = [{ id: 'w1', unread: 4, light: asks(1) }, { id: 'w2', unread: 0, light: asks(2) }, { id: 'w3', unread: 5 }];
  assert.deepEqual(totals(items), { fresh: 9, waiting: 3 });
  assert.deepEqual(totals([]), { fresh: 0, waiting: 0 });
  // Elsewhere leaves the outcome being read out.
  assert.deepEqual(elsewhere(items, 'w1'), { fresh: 5, where: 1, waiting: 2 });
  assert.deepEqual(elsewhere(items, 'w3'), { fresh: 4, where: 1, waiting: 3 });
  assert.equal(elsewhereWords({ fresh: 5, where: 1, waiting: 2 }), '5 new in 1 other outcome · 2 waiting on you');
  assert.equal(elsewhereWords({ fresh: 7, where: 2, waiting: 0 }), '7 new in 2 other outcomes');
  assert.equal(elsewhereWords({ fresh: 0, where: 0, waiting: 0 }), '');
});

test('a chip shows only the outcomes that hold what it counts', () => {
  const quiet = { unread: 0 }, fresh = { unread: 2 }, waiting = { unread: 0, light: asks(1) };
  assert.deepEqual([quiet, fresh, waiting].map(item => shownUnder('new', item)), [false, true, false]);
  assert.deepEqual([quiet, fresh, waiting].map(item => shownUnder('waiting', item)), [false, false, true]);
  assert.deepEqual([quiet, fresh, waiting].map(item => shownUnder(null, item)), [true, true, true]);
});

const memory = (initial = {}) => {
  const held = new Map(Object.entries(initial));
  return { getItem: key => held.get(key) ?? null, setItem: (key, value) => held.set(key, value), held };
};

test('the outline tidies itself: only the outcome being read is open, a key\'s open or fold or every one lasts until the next place, and nothing is kept on the browser', () => {
  const opened = new Opened();
  assert.deepEqual([opened.isOpen('w1', 'w1'), opened.isOpen('w2', 'w1')], [true, false], 'the outcome being read is open, every other folded');
  opened.set('w2', true); opened.set('w1', false);
  assert.deepEqual([opened.isOpen('w1', 'w1'), opened.isOpen('w2', 'w1')], [false, true], '⌘→ opens another, ⌘← folds the one being read');
  opened.tidy();
  assert.deepEqual([opened.isOpen('w1', 'w2'), opened.isOpen('w2', 'w2')], [false, true], 'arriving at another place tidies to it alone');
  opened.all(true);
  assert.deepEqual(['w1', 'w2', 'w9'].map(id => opened.isOpen(id, 'w2')), [true, true, true], '⇧⌘→ opens every one, those listed later too');
  opened.set('w9', false);
  assert.equal(opened.isOpen('w9', 'w2'), false, 'one folded after stays folded');
  opened.all(false);
  assert.deepEqual(['w1', 'w2', 'w9'].map(id => opened.isOpen(id, 'w2')), [false, false, false], '⇧⌘← folds every one, the one being read too');
  opened.tidy();
  assert.deepEqual(['w1', 'w2'].map(id => opened.isOpen(id, 'w2')), [false, true], 'and the next place tidies back to it alone');
  assert.deepEqual(['w1', 'w2'].map(id => opened.isOpen(id, 'w2', 'new')), [true, true], 'while a chip shows only some, each shown is open');
  assert.equal(new Opened().isOpen('w2', 'w1'), false, 'a new page starts tidy: no fold is kept');
});

test('only moves between an outcome Conversation and topics are made in place', () => {
  const topic = { kind: 'topic', id: 't1' }, conversation = { kind: 'conversation', id: 'w1' };
  assert.equal(movesInPlace(topic, { kind: 'topic', id: 't2' }), true);
  assert.equal(movesInPlace(topic, conversation), true);
  assert.equal(movesInPlace(conversation, topic), true);
  for (const other of [{ kind: 'root' }, { kind: 'workspace', id: 'w1' }, { kind: 'pipeline', id: 'w1' }, { kind: 'health' }, null]) {
    assert.equal(movesInPlace(topic, other), false, `to ${other?.kind}`);
    assert.equal(movesInPlace(other, topic), false, `from ${other?.kind}`);
  }
});

const history = (state = null) => ({
  state, entries: [], went: [],
  replaceState(next) { this.state = next; },
  pushState(next, _title, href) { this.state = next; this.entries.push(href); },
  go(delta) { this.went.push(delta); },
});

test('each move is a history entry that knows its place; a refused back goes forward again by as many', () => {
  const h = history();
  const places = new Places(h);
  assert.deepEqual(h.state, { aimPlace: 0 }, 'the first page marks its entry');
  places.push('?topic=t2'); places.push('?topic=t3');
  assert.deepEqual([h.entries, places.index], [['?topic=t2', '?topic=t3'], 2]);
  const moved = places.popped({ aimPlace: 0 });
  assert.deepEqual(moved, { from: 2, to: 0 });
  places.refuse(moved);
  assert.deepEqual(h.went, [2], 'back two refused: forward two');
  assert.deepEqual(places.popped({ aimPlace: 2 }), { ignore: true }, 'the way back is not a move');
  assert.deepEqual(places.popped({ aimPlace: 1 }), { from: 2, to: 1 });
  assert.deepEqual(places.popped(null), { load: true }, 'an entry the page did not make loads');
  // A reload keeps the place its entry carries.
  assert.equal(new Places(history({ aimPlace: 5 })).index, 5);
});

test('a page that goes hears pagehide, and every listener it added goes with it', () => {
  const win = new EventTarget(), doc = new EventTarget();
  const heard = [];
  const scope = new Scope();
  const add = (target, type, listener) => { scope.add(target, type, listener); target.addEventListener(type, listener); };
  add(win, 'pagehide', event => heard.push(['hide', event.type]));
  add(win, 'focus', () => heard.push(['focus']));
  add(doc, 'pagehide', () => heard.push(['doc hide']));
  add(win, 'pagehide', { handleEvent: () => heard.push(['hide object']) });
  scope.end(win);
  assert.deepEqual(heard, [['hide', 'pagehide'], ['hide object']], 'only the window hears pagehide, once each');
  win.dispatchEvent(new Event('focus')); win.dispatchEvent(new Event('pagehide')); doc.dispatchEvent(new Event('pagehide'));
  assert.equal(heard.length, 2, 'nothing the page added still listens');
});

test('the rails read one at a time, each after the one before has settled, and say when they are quiet', async () => {
  const said = [], inTurn = oneAtATime(busy => said.push(busy)), order = [];
  let release;
  const first = inTurn(() => new Promise((resolve, reject) => { release = reject; order.push('first starts'); }));
  const second = inTurn(async () => { order.push('second starts'); return 2; });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(order, ['first starts'], 'the second waits');
  release(Error('refused'));
  await assert.rejects(first, /refused/);
  assert.equal(await second, 2, 'a refusal before it does not stop the next');
  assert.deepEqual(order, ['first starts', 'second starts']);
  await Promise.resolve();
  assert.deepEqual(said, [true, false], 'busy from the first read until the last has settled, once each');
});

// A shell with its page up, without a document: what go and popstate decide.
function shellAt(href, { guard = () => true, build = null, served = undefined } = {}) {
  const h = history();
  // order: each load in turn, the page departing (api.mjs depart) before it,
  // and the page staying (stay). The window hears what the shell heeds.
  const win = Object.assign(new EventTarget(), { location: { href: 'http://aim.test/' + href, reload() { win.reloads += 1; win.order.push('reload'); }, assign(to) { win.assigned.push(to); win.order.push(to); } }, history: h, reloads: 0, assigned: [], order: [] });
  const shell = new Shell({ doc: null, win, load: async () => {}, reads: { depart: () => win.order.push('depart'), stay: () => win.order.push('stay') }, build, ...(served ? { served } : {}) });
  shell.heed();
  shell.installed = true; shell.places = new Places(h); shell.feed = true;
  const moves = [], opened = [];
  // Each run is a page of its own; its guard says whether the person may go.
  const run = () => ({ open(target) { opened.push(target); const yes = guard(target); if (yes) shell.go(target); return yes; } });
  shell.move = () => { moves.push(win.location.href); shell.page = run(); };
  const page = { opened };
  shell.page = run(); shell.handles = {}; shell.at = JSON.stringify(['topic', 't1']);
  const goTo = to => { win.location.href = 'http://aim.test/' + to; };
  // A move under way, as the real one leaves it until its run is up: no page, then a page not up yet.
  const moving = () => { shell.moving = true; shell.page = null; shell.handles = null; shell.at = shell.route() && JSON.stringify([shell.route().kind, shell.route().id]); };
  const started = () => { shell.moving = false; shell.begin(run()); };
  const up = async () => { shell.ready({ view: async () => ({}) }); await Promise.resolve(); await Promise.resolve(); };
  return { shell, win, h, moves, page, goTo, moving, started, up };
}

test('a link between feeds moves in place with a new entry; any other loads as before', () => {
  const { shell, h, moves } = shellAt('?topic=t1');
  assert.equal(shell.go({ kind: 'topic', id: 't2' }), true);
  assert.deepEqual([h.entries, moves.length], [['?topic=t2'], 1]);
  assert.equal(shell.go({ kind: 'workspace', id: 'w1' }), false, 'the outcome page loads');
  assert.equal(shell.go({ kind: 'root' }), false, 'the Outcomes home loads');
  assert.deepEqual([h.entries.length, moves.length], [1, 1]);
  shell.moving = true;
  assert.equal(shell.go({ kind: 'topic', id: 't3' }), false, 'a move under way is not stacked');
  shell.moving = false; shell.handles = null;
  assert.equal(shell.go({ kind: 'topic', id: 't3' }), true, 'before the page is up the move waits for it');
  assert.deepEqual([h.entries.length, moves.length], [1, 1], 'nothing moved yet');
});

test('a back, a forward, a place chosen or a link pressed while a run is on its way waits for that run, and never loads the page', async () => {
  // Back twice in quick succession: the second comes while the first move is under way.
  const quick = shellAt('?topic=t1');
  quick.shell.places.push('?topic=t2'); quick.goTo('?topic=t2'); quick.shell.at = JSON.stringify(['topic', 't2']);
  quick.shell.places.push('?topic=t3'); quick.goTo('?topic=t3'); quick.shell.at = JSON.stringify(['topic', 't3']);
  quick.goTo('?topic=t2');
  await quick.shell.popstate({ state: { aimPlace: 1 } });
  assert.deepEqual([quick.page.opened, quick.moves.length], [[{ kind: 'topic', id: 't2' }], 1], 'the first back moves in place');
  quick.moving();
  quick.goTo('?topic=t1');
  await quick.shell.popstate({ state: { aimPlace: 0 } });
  assert.deepEqual([quick.win.reloads, quick.moves.length, quick.page.opened.length], [0, 1, 1], 'the second waits: no load, no move yet');
  quick.started();
  assert.equal(quick.shell.at, JSON.stringify(['topic', 't1']), 'the run on its way reads the address as it starts');
  await quick.up();
  assert.deepEqual([quick.win.reloads, quick.moves.length], [0, 1], 'it started on the place the second back reached: nothing more to do');

  // A back after the run started but before it is up: it is taken up once the run is up.
  const early = shellAt('?topic=t1');
  early.shell.places.push('?topic=t2'); early.goTo('?topic=t2');
  early.moving(); early.started();
  early.goTo('?topic=t1');
  await early.shell.popstate({ state: { aimPlace: 0 } });
  assert.deepEqual([early.win.reloads, early.page.opened.length], [0, 0], 'waits for the run');
  await early.up();
  assert.deepEqual([early.win.reloads, early.page.opened, early.moves], [0, [{ kind: 'topic', id: 't1' }], ['http://aim.test/?topic=t1']],
    'then goes through its guard and moves in place');
  assert.equal(early.h.entries.length, 1, 'with no new entry');

  // Back then forward before the run is up: it is where it started; nothing to do.
  const there = shellAt('?topic=t1');
  there.shell.places.push('?topic=t2'); there.goTo('?topic=t2'); there.moving(); there.started();
  there.goTo('?topic=t1'); await there.shell.popstate({ state: { aimPlace: 0 } });
  there.goTo('?topic=t2'); await there.shell.popstate({ state: { aimPlace: 1 } });
  await there.up();
  assert.deepEqual([there.win.reloads, there.page.opened.length], [0, 0]);

  // A place chosen in the outline while a move is under way: chosen once the run is up, through its guard.
  const chosen = shellAt('?topic=t1');
  chosen.shell.places.push('?topic=t2'); chosen.goTo('?topic=t2'); chosen.moving();
  const first = chosen.shell.open({ kind: 'topic', id: 't8' }, 'Eight');
  const second = chosen.shell.open({ kind: 'topic', id: 't9' }, 'Nine');
  assert.equal(await first, false, 'the newer choice stands for the one before');
  assert.deepEqual([chosen.win.assigned, chosen.page.opened], [[], []], 'nothing loads meanwhile');
  chosen.started(); await chosen.up();
  assert.equal(await second, true);
  assert.deepEqual([chosen.win.assigned, chosen.page.opened, chosen.h.entries.at(-1)], [[], [{ kind: 'topic', id: 't9' }], '?topic=t9'], 'it moves in place with its own entry');

  // A link on the page pressed before the page is up: the move is made once it is.
  const link = shellAt('?topic=t1');
  link.moving(); link.started();
  assert.equal(link.shell.go({ kind: 'conversation', id: 'w1' }), true);
  assert.equal(link.moves.length, 0);
  await link.up();
  assert.deepEqual([link.moves, link.h.entries], [['http://aim.test/?topic=t1'], ['?conversation=w1']], 'moved in place, with its entry');

  // A run that cannot start: what waited goes as it would with no feed page up.
  const broken = shellAt('?topic=t1');
  broken.shell.places.push('?topic=t2'); broken.goTo('?topic=t2'); broken.moving(); broken.started();
  const pending = broken.shell.open({ kind: 'topic', id: 't5' }, 'Five');
  broken.shell.failed(broken.shell.page);
  assert.deepEqual([await pending, broken.win.assigned], [false, ['?topic=t5']], 'the place chosen loads');
  broken.goTo('?topic=t1'); await broken.shell.popstate({ state: { aimPlace: 0 } });
  assert.equal(broken.win.reloads, 1, 'and a back loads');
});

// One build per document (item 523, docs/rails.md): a move reads the build the server serves first, and moves
// in place only on its own; on another it loads the place afresh, or, while writing is not yet safe, stays and says so.
// answer(build): a served() whose answer the test gives, and how many times it was asked.
const answerable = () => {
  const asked = [];
  const served = () => new Promise(resolve => asked.push(resolve));
  return { served, asked, answer: async build => { asked.shift()(build); for (let n = 0; n < 4; n++) await Promise.resolve(); } };
};

test('a module served under a build names it; the build the server serves is read once, and a failed read is no build', async () => {
  assert.equal(buildOf('http://aim.test/b/08eebbec4a52f0e974bc/in-place-navigation.mjs'), '08eebbec4a52f0e974bc');
  assert.equal(buildOf('http://aim.test/in-place-navigation.mjs'), null, 'a module served outside a build');
  assert.equal(buildOf('file:///repo/web/in-place-navigation.mjs'), null, 'a module loaded from disk, as these tests load it');
  assert.equal(buildOf('http://aim.test/x/b/abc/in-place-navigation.mjs'), null, 'only the leading /b/<build>/ names one');
  const asked = [];
  const answer = body => async (...args) => { asked.push(args); return body; };
  assert.equal(await servedBuild(answer({ ok: true, json: async () => ({ build: 'B1' }) })), 'B1');
  assert.deepEqual(asked[0], ['/api/build', { cache: 'no-store', credentials: 'same-origin' }]);
  assert.equal(await servedBuild(answer({ ok: false, json: async () => ({ build: 'B1' }) })), null, 'a refusal is no build');
  assert.equal(await servedBuild(answer({ ok: true, json: async () => ({}) })), null, 'an answer with no build is none');
  assert.equal(await servedBuild(answer({ ok: true, json: async () => ({ build: '' }) })), null);
  assert.equal(await servedBuild(async () => { throw new TypeError('Failed to fetch'); }), null, 'an unreached server is no build');
});

test('a move on this document\'s own build reads the served build first and moves in place; on another it loads the place afresh, with no entry of its own', async () => {
  const same = answerable(), here = shellAt('?topic=t1', { build: 'A', served: same.served });
  assert.equal(here.shell.go({ kind: 'topic', id: 't2' }), true);
  assert.deepEqual([same.asked.length, here.moves.length, here.h.entries], [1, 0, []], 'nothing moves while the read is out');
  assert.equal(here.shell.between, true, 'the move is under way meanwhile');
  assert.equal(here.shell.go({ kind: 'topic', id: 't3' }), false, 'and is not stacked');
  await same.answer('A');
  assert.deepEqual([here.moves, here.h.entries, here.win.order], [['http://aim.test/?topic=t1'], ['?topic=t2'], []], 'its own build: in place, with its entry, no load');

  const next = answerable(), there = shellAt('?topic=t1', { build: 'A', served: next.served });
  assert.equal(there.shell.go({ kind: 'topic', id: 't2' }), true);
  await next.answer('B');
  assert.deepEqual([there.moves, there.h.entries, there.win.order], [[], [], ['depart', '?topic=t2']], 'another build: the place loads, as a link loads it');
  assert.equal(there.shell.moving, false);

  const unread = answerable(), blind = shellAt('?topic=t1', { build: 'A', served: unread.served });
  blind.shell.go({ kind: 'topic', id: 't2' });
  await unread.answer(null);
  assert.deepEqual([blind.moves.length, blind.win.order], [1, []], 'a build that could not be read: the move goes on, its import naming this build');

  const none = shellAt('?topic=t1', { served: () => assert.fail('a document with no build reads none') });
  none.shell.go({ kind: 'topic', id: 't2' });
  assert.deepEqual([none.moves.length, none.h.entries], [1, ['?topic=t2']], 'with no build of its own, the move is made at once');
});

test('a move that finds another build while writing is not yet safe stays where it is and says so, Reload asks the browser\'s guard, and a back is put back', async () => {
  const read = answerable(), held = shellAt('?topic=t1', { build: 'A', served: read.served });
  let holds = false, reloads = [];
  held.shell.page.updated = reload => reloads.push(reload);
  held.shell.guard(() => holds);
  held.shell.go({ kind: 'topic', id: 't2' });
  holds = true;
  // A place chosen while the read is out waits for it.
  const chosen = held.shell.open({ kind: 'topic', id: 't9' }, 'Nine');
  await read.answer('B');
  assert.deepEqual([held.moves, held.h.entries, held.win.order, held.win.reloads], [[], [], [], 0], 'the page stays: no load, no move, no entry');
  assert.equal(reloads.length, 1, 'and says Theseus updated, with Reload');
  assert.deepEqual([held.page.opened.map(t => t.id), read.asked.length], [['t9'], 1], 'what was chosen meanwhile goes through the page as it stands, and reads the build again');
  await read.answer('B');
  assert.equal(await chosen, true);
  assert.deepEqual([held.moves, held.win.order, reloads.length, held.shell.moving], [[], [], 2, false], 'it stays too, and says so again');
  reloads[0]();
  assert.deepEqual(held.win.order, ['reload'], 'Reload loads with no departure while the guard holds: the browser asks the person first');
  holds = false;
  reloads[0]();
  assert.deepEqual(held.win.order, ['reload', 'depart', 'reload'], 'once the writing is safe, it departs and loads');

  const back = answerable(), popped = shellAt('?topic=t1', { build: 'A', served: back.served });
  popped.shell.page.updated = () => {};
  popped.shell.guard(() => true);
  popped.shell.places.push('?topic=t2'); popped.goTo('?topic=t2'); popped.shell.at = JSON.stringify(['topic', 't2']);
  popped.goTo('?topic=t1');
  const going = popped.shell.popstate({ state: { aimPlace: 0 } });
  await going;
  await back.answer('B');
  assert.deepEqual([popped.h.went, popped.win.reloads, popped.moves.length], [[1], 0, 0], 'a back that found another build is put back, once');

  const free = answerable(), loads = shellAt('?topic=t1', { build: 'A', served: free.served });
  loads.shell.places.push('?topic=t2'); loads.goTo('?topic=t2'); loads.shell.at = JSON.stringify(['topic', 't2']);
  loads.goTo('?topic=t1');
  await loads.shell.popstate({ state: { aimPlace: 0 } });
  await free.answer('B');
  assert.deepEqual([loads.h.went, loads.win.order], [[], ['depart', 'reload']], 'with nothing to keep, a back loads the place it reached');
});

// The page asks Theseus nothing more from the moment it decides to load
// another (api.mjs depart), before it asks the browser for the load: nothing
// starts in the moment before the browser begins it. A move in place loads
// nothing, so the page departs from nothing.
test('every load the shell decides departs first; a move in place does not depart', async () => {
  const { shell, win, moves } = shellAt('?topic=t1');
  assert.equal(shell.go({ kind: 'topic', id: 't2' }), true);
  assert.deepEqual([moves.length, win.order], [1, []], 'moved in place: no load, no departure');
  shell.leave('?workspace=w1');
  assert.deepEqual(win.order, ['depart', '?workspace=w1'], 'departs, then loads');

  const away = shellAt('?topic=t1');
  away.shell.feed = false; away.shell.handles = null; away.shell.page = null;
  await away.shell.open({ kind: 'workspace', id: 'w2' }, 'Two');
  assert.deepEqual(away.win.order, ['depart', '?workspace=w2'], 'a place chosen with no feed page up');

  const foreign = shellAt('?topic=t1');
  await foreign.shell.popstate({ state: null });
  assert.deepEqual(foreign.win.order, ['depart', 'reload'], 'an entry the page did not make');

  const broken = shellAt('?topic=t1');
  broken.moving(); broken.started();
  const pending = broken.shell.open({ kind: 'topic', id: 't5' }, 'Five');
  broken.shell.failed(broken.shell.page);
  await pending;
  assert.deepEqual(broken.win.order, ['depart', '?topic=t5'], 'what waited on a run that could not start');
});

// A load the page asked for can still be stopped: the browser asks the person
// first while a guard holds, and the person may stay; or the person stops
// the load, or goes back. The page must then read on. While a guard holds, it
// does not depart at all; once departed, it stays on a back or forward it
// hears, or on a key or a press of the person's.
test('a page whose guard holds loads without departing; a departed page stays on a back, a key or a press, and on nothing else', async () => {
  const guarded = shellAt('?topic=t1');
  let holds = true;
  guarded.shell.begin({ open() {} });
  guarded.shell.guard(() => holds);
  guarded.shell.leave('?workspace=w1');
  assert.deepEqual(guarded.win.order, ['?workspace=w1'], 'writing not yet safe: the browser asks the person, and the page reads on if they stay');
  const asked = new Event('beforeunload', { cancelable: true });
  guarded.win.dispatchEvent(asked);
  assert.equal(asked.defaultPrevented, true, 'the guard has the browser ask');
  holds = false;
  guarded.shell.leave('?workspace=w2');
  assert.deepEqual(guarded.win.order, ['?workspace=w1', 'depart', '?workspace=w2'], 'once the writing is safe, the load departs');
  const free = new Event('beforeunload', { cancelable: true });
  guarded.win.dispatchEvent(free);
  assert.equal(free.defaultPrevented, false, 'and the browser does not ask');
  guarded.shell.begin({ open() {} });
  holds = true;
  guarded.shell.leave(null);
  assert.equal(guarded.win.order.at(-2), 'depart', 'a new run starts with no guard of the run before');

  const pressed = shellAt('?topic=t1');
  pressed.shell.leave('?workspace=w1');
  pressed.win.dispatchEvent(new Event('beforeunload')); pressed.win.dispatchEvent(new Event('focus'));
  pressed.win.dispatchEvent(Object.assign(new Event('keydown'), { repeat: true }));
  assert.deepEqual(pressed.win.order, ['depart', '?workspace=w1'], 'the load beginning, focus, or a key held down from before is not the page staying');
  pressed.win.dispatchEvent(new Event('keydown'));
  assert.deepEqual(pressed.win.order, ['depart', '?workspace=w1', 'stay'], 'a key: the load was stopped, the page stays');
  pressed.win.dispatchEvent(new Event('pointerdown'));
  assert.deepEqual(pressed.win.order, ['depart', '?workspace=w1', 'stay'], 'and stays once');
  pressed.shell.leave('?workspace=w2'); pressed.win.dispatchEvent(new Event('pointerdown'));
  assert.deepEqual(pressed.win.order.slice(3), ['depart', '?workspace=w2', 'stay'], 'a press stays too');

  const back = shellAt('?topic=t1');
  back.shell.leave('?workspace=w1');
  await back.shell.popstate({ state: { aimPlace: 0 } });
  assert.deepEqual(back.win.order, ['depart', '?workspace=w1', 'stay'], 'a back this page hears: the page stays');
  const quiet = shellAt('?topic=t1');
  await quiet.shell.popstate({ state: { aimPlace: 0 } });
  quiet.win.dispatchEvent(new Event('keydown'));
  assert.deepEqual(quiet.win.order, [], 'a page that did not depart has nothing to stay from');
});

test('a read a run asked for that reaches its turn after a newer run is up is never sent; the outline\'s own reads go through whichever run is up', async () => {
  const { shell, moving, started } = shellAt('?topic=t1');
  const sent = [];
  started();
  shell.ready({ view: async (name, args) => { sent.push(['first', name, args.id]); return { from: 'first' }; } });
  const old = shell.handles;
  // A read out now holds the line: the next ones wait their turn.
  let release;
  const out = old.inTurn(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve(); await Promise.resolve();
  const waiting = old.view('conversation', { id: 'w1' });
  const outline = shell.view('workspace_topics', { id: 'w2' });
  moving(); started();
  shell.ready({ view: async (name, args) => { sent.push(['second', name, args.id]); return { from: 'second' }; } });
  assert.equal(old.current(), false, 'the first run is no longer the page');
  assert.equal(shell.handles.current(), true);
  release('done');
  assert.equal(await out, 'done', 'a read already out lands with whoever asked');
  await assert.rejects(waiting, Superseded, 'a read still waiting is dropped');
  assert.deepEqual(await outline, { from: 'second' }, 'the outline\'s read goes through the run up when its turn comes');
  assert.deepEqual(sent, [['second', 'workspace_topics', 'w2']], 'the dropped read was never sent');
  // Between runs the outline's read waits for the next run to be up.
  moving(); started();
  const later = shell.view('workspaces', { id: 'all' });
  await Promise.resolve();
  assert.equal(sent.length, 1, 'nothing is sent with no run up');
  shell.ready({ view: async (name, args) => { sent.push(['third', name, args.id]); return { from: 'third' }; } });
  assert.deepEqual(await later, { from: 'third' });
});

test('back and forward go through the page guard; a refusal puts the address back', async () => {
  const refused = shellAt('?topic=t1', { guard: () => false });
  refused.shell.places.push('?topic=t2'); refused.shell.at = JSON.stringify(['topic', 't2']);
  refused.goTo('?topic=t1');
  await refused.shell.popstate({ state: { aimPlace: 0 } });
  assert.deepEqual(refused.page.opened, [{ kind: 'topic', id: 't1' }], 'the guard was asked');
  assert.deepEqual([refused.moves.length, refused.h.went], [0, [1]], 'unsent writing stays: forward again by one');
  assert.equal(refused.h.entries.length, 1, 'no new entry');

  const allowed = shellAt('?topic=t1');
  allowed.shell.places.push('?conversation=w1'); allowed.shell.at = JSON.stringify(['conversation', 'w1']);
  allowed.goTo('?topic=t1');
  await allowed.shell.popstate({ state: { aimPlace: 0 } });
  assert.deepEqual([allowed.moves.length, allowed.h.went, allowed.h.entries.length], [1, [], 1], 'moved in place without a new entry');

  const foreign = shellAt('?topic=t1');
  foreign.goTo('?topic=t9');
  await foreign.shell.popstate({ state: null });
  assert.deepEqual([foreign.win.reloads, foreign.moves.length], [1, 0], 'an entry from before this page loads');

  const away = shellAt('?topic=t1');
  away.shell.places.push('?topic=t2'); away.goTo('/');
  await away.shell.popstate({ state: { aimPlace: 0 } });
  assert.deepEqual([away.win.reloads, away.page.opened.length], [1, 0], 'back to a page that is not a feed loads');
});

test('the right rail finds previews and pull requests in messages, newest first, each once', () => {
  assert.deepEqual(linksIn('see https://x.ts.net/a/b. and [the PR](https://github.com/o/r/pull/12) (https://localhost:5192/?topic=t)'),
    [{ url: 'https://x.ts.net/a/b', text: null }, { url: 'https://github.com/o/r/pull/12', text: 'the PR' }, { url: 'https://localhost:5192/?topic=t', text: null }]);
  assert.deepEqual(pullRequest('https://github.com/o/r/pull/12/files'), { repo: 'r', number: 12, href: 'https://github.com/o/r/pull/12' });
  assert.equal(pullRequest('https://github.com/o/r/issues/12'), null);
  assert.deepEqual(['https://box.tail1.ts.net/', 'http://localhost:8000/x', 'https://example.com/mockups/a', 'https://example.com/docs', 'https://github.com/o/r/pull/1', 'nope'].map(isPreview),
    [true, true, true, false, false, false]);
  const { previews, prs } = thingsIn([
    { id: 'old', sent_ms: 1, body: 'https://github.com/o/r/pull/7 and https://box.ts.net/p' },
    { id: 'new', sent_ms: 2, body: '[Rails](https://github.com/o/r/pull/7) https://box.ts.net/p https://example.com/' },
  ]);
  assert.deepEqual(prs.map(pr => [pr.number, pr.title, pr.message.id]), [[7, 'Rails', 'new']]);
  assert.deepEqual(previews.map(preview => [preview.url, preview.message.id]), [['https://box.ts.net/p', 'new']]);
});

test('Waiting for… holds what the reader raised that is not shipped, and their Conversation posts not taken up', () => {
  const now = [{ title: 'Mine', raised_by: 'me', stage: { name: 'Build', entered_ms: 5 }, pieceTopic: 't1' }, { title: 'Theirs', raised_by: 'them' }];
  const next = [{ title: 'Later', raised_by: 'me', section: 'next', pieceTopic: 't2' }, { title: 'Shipped', raised_by: 'me', shipped: true }];
  const conversation = [{ author_id: 'me', body: 'Please add rails', item: { state: 'new', takes: [] } }, { author_id: 'me', body: 'done', item: { state: 'done' } }, { author_id: 'them', body: 'x', item: { state: 'new' } }];
  assert.deepEqual(waitingFor({ reader: 'me', now, next, conversation }).map(row => [row.what, row.where.stage ?? row.where.words]),
    [['Mine', 'Build'], ['Later', 'Next'], ['Please add rails', 'Not taken up yet']]);
  assert.deepEqual(waitingFor({ reader: 'me', now, next, conversation, topic: 't1' }).map(row => row.what), ['Mine'], 'on a topic: only its own');
});

test('right rail sections stay open until folded, per viewer', () => {
  const storage = memory(), folds = new SectionFolds(storage, 's');
  assert.equal(folds.isOpen('images'), true);
  folds.set('images', false);
  assert.deepEqual([new SectionFolds(storage, 's').isOpen('images'), new SectionFolds(storage, 's').isOpen('prs')], [false, true]);
});
