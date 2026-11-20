import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { entryOf } from '../web/reply-stacks.mjs';
import { cardIn } from '../web/fold.mjs';
import { OnboardingPrompt } from '../web/onboarding.mjs';
import { StackFeed } from '../web/stack-feed.mjs';
import { OutlineMenus, menuDoor } from '../web/outline-menus.mjs';
import { outcomeMenuItems } from '../web/outcome-menu-items.mjs';
import { GLYPH_NAMES } from '../web/glyphs.mjs';
import { RailMenuCommands } from '../web/rail-menu-commands.mjs';
import { routeHref, parseRoute, TopicNavigation } from '../web/topic-navigation.mjs';
import { consumeMenuRoute, dossierMenuRoute } from '../web/menu-route.mjs';
import { OutlineDossiers } from '../web/outline-dossiers.mjs';
import { unstarDossier } from '../web/dossier-unstar.mjs';

const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const contextCode = app.slice(app.indexOf('function messageContextMenu(event)'), app.indexOf('// The link names the message'));
function headerFixture() {
  const r = renderer799();
  r.add([{ id: 'm-root', topic_id: 't-one', author_id: 'agent', author_kind: 'agent', seq: 1 }]);
  for (const node of r.list.descendants()) node.nodeType = 1;
  const menus = [], choices = [{ label: 'the existing menu', act() {} }];
  const env = { $: () => r.list, entryOf, cardIn, views: { messages: r.messages },
    window: { getSelection: () => ({ isCollapsed: true }) }, menu: null, retired: false,
    messageMenuItems: item => { assert.equal(item.id, 'm-root'); return choices; },
    openMessageMenu: options => menus.push(options) };
  const make = overrides => new Function(...Object.keys({ ...env, ...overrides }), contextCode + ';return messageContextMenu;')(...Object.values({ ...env, ...overrides }));
  const event = target => ({ target, clientX: 73, clientY: 91, prevented: false, preventDefault() { this.prevented = true; } });
  return { ...r, menus, choices, make, event };
}

for (const selector of ['.stack-head', '.stack-name', '.reply-stack']) {
  test('863 dossier header context menu uses its root and existing list: ' + selector, () => {
    const f = headerFixture(), target = f.list.querySelector(selector);
    assert.ok(target, 'actual renderer supplies the target');
    const e = f.event(target); f.make()(e);
    assert.equal(e.prevented, true);
    assert.equal(f.menus.length, 1);
    assert.equal(f.menus[0].items, f.choices);
    assert.deepEqual(f.menus[0].at, { x: 73, y: 91 });
  });
}

test('863 header menu leaves links, selected text and writing to their own controls', () => {
  for (const tag of ['a', 'input', 'textarea']) {
    const f = headerFixture(), target = f.list.ownerDocument.createElement(tag);
    f.list.querySelector('.stack-head').append(target); target.nodeType = 1;
    const e = f.event(target); f.make()(e);
    assert.equal(e.prevented, false); assert.equal(f.menus.length, 0);
  }
  const f = headerFixture(), e = f.event(f.list.querySelector('.stack-head'));
  f.make({ window: { getSelection: () => ({ isCollapsed: false }) } })(e);
  assert.equal(e.prevented, false); assert.equal(f.menus.length, 0);
});

test('863 actual header doors open once when a phone hold is followed by contextmenu', () => {
  const f = headerFixture(), handlers = new Map(); let tick;
  f.list.addEventListener = (name, fn) => handlers.set(name, [...handlers.get(name) ?? [], fn]);
  const at = app.indexOf("  const cancelDossierHold = menuDoor($('messages')"), end = app.indexOf("  $('start-from-message').setAttribute", at);
  const env = { $: () => f.list, window: { addEventListener() {} }, messageContextMenu: f.make(),
    menuDoor: (root, locate, open) => menuDoor(root, locate, open, { clock: { setTimeout(fn) { tick = fn; return 1; }, clearTimeout() {} } }) };
  new Function(...Object.keys(env), app.slice(at, end))(...Object.values(env));
  const target = f.list.querySelector('.stack-head');
  const event = { target, pointerType: 'touch', clientX: 2, clientY: 3, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  for (const fn of handlers.get('pointerdown')) fn(event); tick();
  assert.equal(f.menus.length, 1);
  for (const fn of handlers.get('contextmenu')) fn(event);
  assert.equal(f.menus.length, 1, 'the browser contextmenu cannot open a second menu after the hold');
});

test('863 the outcome overflow is available to a readable non-owner; onboarding stays owner-only', () => {
  const r = renderer799(), doc = r.list.ownerDocument;
  globalThis.document = doc; doc.body = doc.createElement('body');
  const button = doc.createElement('button');
  const prompt = new OnboardingPrompt({ button, reader: 'member', read: () => assert.fail('opening the menu must not read a prompt'),
    menuItems: () => [{ label: 'Copy Link', glyph: 'link', act() {} }] });
  prompt.paint({ id: 'w-one', owner_id: 'owner' });
  assert.equal(button.hidden, false, 'shared outcome actions are not owner-only');
  prompt.open(); assert.notEqual(prompt.dialog.open, true, 'the onboarding dialog remains owner-only');
  prompt.paint(null); assert.equal(button.hidden, true, 'no menu after access is lost');
});

test('863 Rename includes a one-message dossier and reaches its existing title editor', () => {
  const f = headerFixture(), renamed = [];
  const feed = { list: f.list, state: f.add([]), undos: [], actsOf: () => ({}),
    entryFor: id => [...f.list.descendants()].find(n => n.dataset.id === id),
    acted() {}, arrange: () => f.add([]),
    startRename: stack => { renamed.push(stack.id); StackFeed.prototype.startRename.call(feed, stack); } };
  const items = StackFeed.prototype.menuItems.call(feed, f.messages.get('m-root')).first;
  const rename = items.find(item => item.label === 'Rename');
  assert.ok(rename, 'a dossier can be named before it has replies'); rename.act();
  assert.deepEqual(renamed, ['m-root']);
  assert.ok(f.list.querySelector('.stack-rename-input'));
  assert.equal(f.list.ownerDocument.activeElement, f.list.querySelector('.stack-rename-input'));
});

test('863 a dossier starred only through a reply offers Unstar on its head and disappears from the actual rail renderer', async () => {
  const f = headerFixture(), doc = f.list.ownerDocument, requests = [];
  const position = { root_id: 'm-root', starred: ['m-reply'], below: false, through: null, at: { messages: 0, acts: 2 } };
  Object.assign(f.messages.get('m-root'), { stack_position: position, acts: { starred: false } });
  const state = f.add([{ id: 'm-reply', seq: 2, topic_id: 't-one', author_id: 'agent', reply_to: 'm-root', stack_position: position, acts: { starred: true, star_revision: 8 } }]);
  const railState = { links: new Map(), stars: [{ message_id: 'm-reply', dossier: { id: 'm-root', name: 'Only a reply starred' } }],
    id: 't-one', next: null, loaded: true, box: doc.createElement('div'), parent: doc.createElement('a') };
  const rail = { outline: { doc } }; OutlineDossiers.prototype.paint.call(rail, railState);
  assert.equal(railState.box.children.length, 1);
  const feed = { list: f.list, state, undos: [], instanceId: 'instance', actsOf: id => f.messages.get(id).acts,
    entryFor: id => [...f.list.descendants()].find(n => n.dataset.id === id),
    unstarDossier: (...args) => StackFeed.prototype.unstarDossier.call(feed, ...args),
    readNamed: async (name, args) => { assert.equal(name, 'topic_messages'); assert.deepEqual(args, { topic_id: 't-one', message_ids: ['m-reply'] });
      return { instance_id: 'instance', items: [f.messages.get('m-reply')] }; },
    act: async (kind, item, args) => { requests.push([kind, item.id, item.acts.star_revision, args]); item.acts.starred = false; position.starred = []; },
    reread: () => { railState.stars = f.messages.get('m-reply').acts.starred ? railState.stars : []; OutlineDossiers.prototype.paint.call(rail, railState); },
    say() {}, status: error => assert.fail(error.message) };
  const root = StackFeed.prototype.menuItems.call(feed, f.messages.get('m-root')).first;
  assert.equal(root[0].label, 'Unstar'); await root[0].act();
  assert.deepEqual(requests, [['message.star', 'm-reply', 8, { starred: false }]]);
  assert.equal(railState.box.children.length, 0);
  const reply = StackFeed.prototype.menuItems.call(feed, f.messages.get('m-reply')).first;
  assert.equal(reply[0].label, 'Star for me');
});

const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
function railFixture() {
  const f = headerFixture(), doc = f.list.ownerDocument, events = {}, shown = [], calls = [];
  doc.addEventListener = (kind, fn) => { events[kind] = fn; };
  doc.defaultView = { location: { href: 'https://fixture.invalid/?topic=t-before' } };
  const row = doc.createElement('a'); row.className = 'ol-dossier'; row.dataset.dossierId = 'm-target';
  row.pageTarget = { kind: 'topic', id: 't-target', message: 'm-target', land: true }; f.list.append(row);
  const bootstrap = { instance_id: 'instance', actor: 'reader', authority: { authority_id: 'authority', authority_epoch: 'epoch' } };
  const item = { id: 'm-target', topic_id: 't-target', seq: 12, acts: { starred: true, star_revision: 3, aside_revision: 4 }, stack_position: { root_id: 'm-target', below: false, starred: ['m-target'] } };
  const source = { instance_id: 'instance', topic_id: 't-target', items: [item] };
  const handles = { bootstrap, route: { kind: 'topic', id: 't-before' }, readable: () => true,
    view: async (...args) => { calls.push(['read', ...args]); return source; },
    dossierMenu: (_source, _row, choose) => [{ key: 'rename', label: 'Rename', act: () => choose('rename', 'Rename') }] };
  const outline = { list: f.list, doc, handles, outcomes: new Map(), message: doc.createElement('p'),
    open: () => assert.fail('opening a menu must not navigate') };
  const menus = new OutlineMenus(outline, { show: options => { shown.push(options); return { close() {} }; } });
  return { ...f, doc, row, source, item, handles, outline, menus, shown, calls, events };
}

test('863 unopened dossier menu reads exactly its source and leaves the page and URL unchanged', async () => {
  const f = railFixture(), href = f.doc.defaultView.location.href;
  await f.menus.open(f.row, { x: 4, y: 9 });
  assert.deepEqual(f.calls, [['read', 'topic_messages', { topic_id: 't-target', message_ids: ['m-target'] }, 'foreground']]);
  assert.equal(f.outline.handles, f.handles); assert.equal(f.doc.defaultView.location.href, href);
  assert.deepEqual(f.shown[0].at, { x: 4, y: 9 }); assert.equal(f.shown[0].items[0].label, 'Rename');
});

test('863 menu read cannot repaint after navigation, row reuse, dismissal or a newer menu', async () => {
  for (const change of ['navigation', 'row', 'dismissal', 'escape', 'access', 'menu']) {
    const f = railFixture(), wait = deferred(); f.handles.view = () => wait.promise;
    const opening = f.menus.open(f.row);
    if (change === 'navigation') { f.menus.reset(); f.outline.handles = { ...f.handles }; }
    if (change === 'row') f.row.pageTarget = { ...f.row.pageTarget, id: 't-other' };
    if (change === 'dismissal') f.events.pointerdown({ target: f.list });
    if (change === 'escape') f.events.keydown({ key: 'Escape' });
    if (change === 'access') f.handles.readable = () => false;
    if (change === 'menu') { f.handles.view = async () => f.source; await f.menus.open(f.row); }
    wait.resolve(f.source); await opening;
    assert.equal(f.shown.length, change === 'menu' ? 1 : 0, change);
  }
});

test('863 mismatched source identities show a refusal and expose no actions', async () => {
  for (const wrong of ['instance', 'topic', 'message', 'root']) {
    const f = railFixture(), source = structuredClone(f.source);
    if (wrong === 'instance') source.instance_id = 'wrong';
    if (wrong === 'topic') source.items[0].topic_id = 'wrong';
    if (wrong === 'message') source.items[0].id = 'wrong';
    if (wrong === 'root') source.items[0].stack_position.root_id = 'wrong';
    f.handles.view = async () => source;
    await f.menus.open(f.row); assert.equal(f.shown.length, 0);
    assert.match(f.outline.message.textContent, /dossier could not be confirmed/); assert.equal(f.outline.message.hidden, false);
  }
});

test('863 id commands stay in place, fence the named record and keep one request after an unknown result', async () => {
  const f = railFixture(), requests = [], commands = new RailMenuCommands();
  f.handles.api = { command: async request => { requests.push(structuredClone(request)); if (requests.length === 1) throw Error('connection lost'); return { status: 'committed', result: {} }; } };
  const href = f.doc.defaultView.location.href;
  await assert.rejects(commands.message(f.handles, f.item, 'star', 'Unstar'), /unknown/);
  f.item.acts.star_revision = 99;
  await commands.message(f.handles, f.item, 'star', 'Unstar');
  assert.deepEqual(requests[1], requests[0], 'an uncertain retry is the same operation and revision');
  assert.equal(requests[0].kind, 'message.star'); assert.deepEqual(requests[0].target, { message_id: 'm-target' });
  assert.equal(requests[0].expected.star_revision, 3); assert.equal(requests[0].args.starred, false);
  assert.equal(f.doc.defaultView.location.href, href);
  assert.throws(() => commands.message(f.handles, f.item, 'aside', 'Archive'), /unstar it to archive it/);
  await commands.end(f.handles, { id: 'w-target', version: 7 }, 'archived');
  assert.equal(requests[2].kind, 'outcome.end_set'); assert.deepEqual(requests[2].target, { workspace_id: 'w-target' });
  assert.equal(requests[2].expected.workspace_revision, 7);
  assert.equal(f.doc.defaultView.location.href, href);
});

test('863 a stale page cannot send an id command and a recorded refusal is visible', async () => {
  const f = railFixture(); let sent = 0;
  f.handles.api = { command: async () => { ++sent; return { status: 'refused', recorded: true, error: { message: 'The outcome changed.' } }; } };
  await f.menus.perform(f.handles, () => f.menus.commands.end(f.handles, { id: 'w-target', version: 1 }, 'completed'));
  assert.equal(sent, 1); assert.match(f.outline.message.textContent, /The outcome changed/);
  f.outline.handles = { ...f.handles };
  await f.menus.perform(f.handles, () => assert.fail('stale command'));
  assert.match(f.outline.message.textContent, /page changed/);
});

test('863 a rail star unfolds the first message with its own revision and retains an uncertain unfold', async () => {
  const f = railFixture(), commands = new RailMenuCommands(), requests = [];
  f.item.acts = { starred: false, star_revision: 4, folded: true, fold_revision: 7 };
  f.item.stack_position.starred = [];
  f.handles.api = { command: async request => {
    requests.push(structuredClone(request));
    if (requests.length === 2) throw Error('lost unfold answer');
    return { status: 'committed' };
  } };
  await assert.rejects(commands.message(f.handles, f.item, 'star', 'Star for me'), /unknown/);
  assert.deepEqual(requests.map(r => r.kind), ['message.star', 'message.fold']);
  assert.equal(requests[1].expected.fold_revision, 7); assert.equal(requests[1].args.folded, false);
  f.item.acts.fold_revision = 9;
  await commands.message(f.handles, f.item, 'fold', 'Unfold');
  assert.deepEqual(requests[2], requests[1]);
});

test('863 copying a link cannot report into a page that replaced its source', async () => {
  for (const kind of ['dossier', 'outcome']) {
    const f = railFixture(), wait = deferred(); f.menus.copy = () => wait.promise;
    f.outline.message.textContent = 'new page notice';
    const copying = kind === 'dossier' ? f.menus.dossierAction(f.item, 'Copy Link', 'Copy Link', f.row, f.handles)
      : f.menus.outcomeAction({ id: 'w-one' }, 'copy', f.row, f.handles);
    f.outline.handles = { ...f.handles }; wait.resolve(true); await copying;
    assert.equal(f.outline.message.textContent, 'new page notice');
  }
});

test('863 Unstar refuses a member moved to another dossier and an authority run retired during the read', async () => {
  for (const changed of ['dossier', 'run']) {
    let sent = 0;
    const root = { id: 'm-root', topic_id: 't-one', stack_position: { starred: ['m-reply'] } };
    await assert.rejects(unstarDossier(root, { instanceId: 'instance', current: () => changed !== 'run', send: () => ++sent,
      read: async () => ({ instance_id: 'instance', items: [{ id: 'm-reply', topic_id: 't-one', acts: { starred: true, star_revision: 4 }, stack_position: { root_id: changed === 'dossier' ? 'm-other' : 'm-root' } }] }) }), /changed/);
    assert.equal(sent, 0);
  }
});

test('863 Rename from an outcome home uses its guarded exact address and consumes the act once', async () => {
  const f = railFixture(), destinations = [];
  f.handles.route = { kind: 'workspace', id: 'w-before' };
  const navigation = new TopicNavigation({ current: f.handles.route, beforeLeave: async () => destinations.push('guard'), navigateTarget: target => destinations.push(routeHref(target)) });
  f.outline.open = (target, title) => navigation.openTarget(target, title);
  await f.menus.open(f.row); await f.shown[0].items[0].act();
  assert.equal(destinations[0], 'guard');
  const arrival = new URL(destinations[1], 'https://fixture.invalid/'), route = parseRoute(arrival);
  assert.deepEqual(route, { kind: 'topic', id: 't-target', message: 'm-target', land: true, act: 'rename' });
  const history = { state: { original: true }, replaceState(state, _, href) { assert.equal(state, this.state); arrival.href = href; } };
  const win = { location: arrival, history };
  assert.equal(consumeMenuRoute(route, win), true); assert.equal(arrival.hash, '');
  assert.equal(consumeMenuRoute(route, win), false, 'reload cannot replay the UI act');
  assert.equal(parseRoute(arrival).act, undefined);
});

test('863 incoming command-like acts are rejected; a move handoff opens only the exact current menu', () => {
  for (const act of ['star', 'aside', 'completed', 'join-up']) assert.throws(() => parseRoute(new URL('?topic=t&message=m&land=only#act=' + act, 'https://fixture.invalid/')));
  const f = headerFixture(), calls = [], choices = [{ key: 'rename', label: 'Rename', act: () => calls.push('rename') },
    { key: 'move-up', label: 'Move its stack up', act: () => calls.push('move') }];
  const start = app.indexOf('function openDossierMenuRoute('), end = app.indexOf('// A right-click on a message', start);
  const env = { views: { messages: f.messages }, messageEntries: new Map([['m-root', f.list.querySelector('[data-id]')]]), cardIn,
    retired: false, topicUnavailable: false, topic: { id: 't-one' }, status: words => calls.push(words),
    messageMenuItems: () => choices, openMessageMenu: options => calls.push(options) };
  const open = new Function(...Object.keys(env), app.slice(start, end) + '; return openDossierMenuRoute;')(...Object.values(env));
  open('m-root', dossierMenuRoute('move-up'));
  assert.equal(calls.length, 1); assert.equal(calls[0].focusKey, 'move-up'); assert.equal(calls[0].items, choices);
  choices[1].act(); assert.equal(calls[1], 'move', 'the explicit press owns the change');
  open('m-root', { act: 'rename' }); assert.equal(calls[2], 'rename');
  open('m-missing', { act: 'rename' }); assert.match(calls[3], /no longer available/);
});

test('863 actual startup consumes Rename before landing and cannot open it after a cancelled landing or reload', async () => {
  const at = app.indexOf("  const anchored = route.kind === 'topic'"), stop = app.indexOf("  if (route.kind === 'conversation')", at);
  const arrival = app.lastIndexOf('  if (anchored) {'), end = app.indexOf("  // A Notebook page's link opens the page in the Reader", arrival);
  for (const lands of [true, false]) {
    const url = new URL('https://fixture.invalid/?topic=t-one&message=m-one&land=only#act=rename'), calls = [], queued = [];
    const win = { location: url, history: { replaceState(_state, _title, href) { url.href = href; calls.push('consume'); } } };
    const env = { topicId: 't-one', route: parseRoute(url), bootstrap: { instance_id: 'instance' }, location: url,
      checkedView: value => value, api: { view: async () => ({ instance_id: 'instance', topic_id: 't-one' }) },
      shell: { rename() {} }, run: job => { const p = job(); queued.push(p); return p; }, retired: false, topicUnavailable: false,
      consumeMenuRoute: route => consumeMenuRoute(route, win), landOnMessage: async () => { assert.equal(url.hash, ''); calls.push('land'); return lands; },
      openDossierMenuRoute: (id, route) => calls.push([id, route.act]), notebookReturning: () => false };
    const start = new Function(...Object.keys(env), 'return (async()=>{' + app.slice(at, stop) + app.slice(arrival, end) + '})();');
    await start(...Object.values(env)); await Promise.all(queued);
    assert.deepEqual(calls, lands ? ['consume', 'land', ['m-one', 'rename']] : ['consume', 'land']);
    assert.equal(parseRoute(url).act, undefined);
  }
});

test('863 actual outcome arrival consumes its address before rechecking onboarding ownership', () => {
  const at = app.indexOf("    if (route.act === 'onboarding' && consumeMenuRoute(route))"), end = app.indexOf('    if(shown)', at);
  for (const allowed of [true, false]) {
    const url = new URL('https://fixture.invalid/?workspace=w-one#act=onboarding'), calls = [];
    const win = { location: url, history: { replaceState(_state, _title, href) { url.href = href; calls.push('consume'); } } };
    const env = { route: parseRoute(url), consumeMenuRoute: route => consumeMenuRoute(route, win), permitted: allowed,
      bootstrap: { actor: 'reader' }, onboarding: { workspace: { owner_id: allowed ? 'reader' : 'other' }, open() { assert.equal(url.hash, ''); calls.push('open'); } }, status: () => calls.push('refused') };
    const arrive = new Function(...Object.keys(env), app.slice(at, end));
    arrive(...Object.values(env)); arrive(...Object.values(env));
    assert.deepEqual(calls, ['consume', allowed ? 'open' : 'refused']);
  }
});

test('863 outcome title and rail list use existing owners, ownership eligibility and valid glyphs', async () => {
  const f = railFixture(), workspace = { id: 'w-fixture', title: 'Fixture', owner_id: 'reader' };
  f.row.className = 'ol-name'; f.row.dataset.workspaceId = workspace.id;
  f.handles.view = async () => ({ instance_id: 'instance', workspace });
  await f.menus.open(f.row);
  const page = outcomeMenuItems(workspace, { actor: 'reader', act() {} });
  assert.deepEqual(f.shown[0].items.map(x => [x.key, x.label]), page.map(x => [x.key, x.label]));
  assert.deepEqual(page.map(x => x.label), ['New topic', 'Copy Link', 'Move up', 'Move down', 'Complete…', 'Archive…', 'Onboarding prompt…']);
  for (const choice of page) assert.ok(GLYPH_NAMES.includes(choice.glyph), choice.glyph);
  assert.deepEqual(outcomeMenuItems(workspace, { actor: 'member', act() {} }).map(x => x.key), ['new-topic', 'copy', 'up', 'down']);
  assert.deepEqual(outcomeMenuItems({ ...workspace, end: { state: 'archived' } }, { actor: 'reader', act() {} }).map(x => x.key), ['copy', 'open', 'onboarding']);
});

test('863 keyboard and phone hold doors preserve taps, scrolling, selection and ordinary keys', () => {
  const f = railFixture(), root = f.list, called = []; let tick = null;
  const reset = menuDoor(root, target => target === f.row ? f.row : null, (row, at) => called.push([row, at]),
    { clock: { setTimeout(fn) { tick = fn; return 1; }, clearTimeout() { tick = null; } } });
  const press = (kind, data = {}) => { const event = { target: f.row, clientX: 9, clientY: 13, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...data }; root.listeners[kind](event); return event; };
  for (const keys of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }]) assert.equal(press('keydown', keys).prevented, true);
  assert.equal(called.length, 2); assert.equal(called[0][1], null);
  assert.notEqual(press('keydown', { key: 'Enter' }).prevented, true);
  press('pointerdown', { pointerType: 'touch' }); press('pointerup'); assert.equal(tick, null);
  press('pointerdown', { pointerType: 'touch' }); press('pointermove', { clientX: 30 }); assert.equal(tick, null);
  press('pointerdown', { pointerType: 'touch' }); press('scroll'); assert.equal(tick, null);
  f.doc.getSelection = () => ({ isCollapsed: false }); press('contextmenu'); assert.equal(called.length, 2);
  f.doc.getSelection = () => ({ isCollapsed: true }); press('pointerdown', { pointerType: 'touch' }); tick();
  assert.equal(called.length, 3); assert.deepEqual(called[2][1], { x: 9, y: 13 });
  assert.equal(press('contextmenu').prevented, true); assert.equal(called.length, 3, 'one hold does not open twice');
  assert.equal(press('click').prevented, true); assert.notEqual(press('click').prevented, true);
  press('pointerdown', { pointerType: 'touch' }); tick(); reset();
  assert.notEqual(press('click').prevented, true, 'retiring the menu cancels its old synthetic-click suppression');
});
