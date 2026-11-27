// Actual rail, Notebook creation and arrow eligibility owners on an in-memory
// DOM. This proves model behavior, not native focus, layout or browser timing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { resolveLegacyConversation } from './fixtures/legacy_conversation_route.mjs';
import { ThingsRail, SECTIONS } from '../web/things-rail.mjs';
import { NotebookCreate } from '../web/notebook-create.mjs';
import { controls } from '../web/arrow-reach.mjs';
import { Shell } from '../web/in-place-navigation.mjs';

const scope = { kind: 'topic', id: 't788' };
const page = (revision = 3, read_revision = 1) => ({ id: 'n788', title: 'Plan', revision, read_revision });
const click = target => ({ target, button: 0, preventDefault() { this.defaultPrevented = true; } });
function fixture(t, { writable = true, pages = [page()], next = null, ready = true } = {}) {
  const doc = miniDocument(), create = doc.createElement;
  doc.createElement = tag => {
    const n = create(tag); n.ownerDocument = doc; n.localName = tag;
    Object.defineProperty(n, 'parentElement', { get: () => n.parent });
    Object.defineProperty(n, 'childElementCount', { get: () => n.children.filter(x => typeof x === 'object').length });
    n.after = child => n.parent.insertBefore(child, n.parent.children[n.parent.children.indexOf(n) + 1]);
    n.contains = other => n === other || [...n.descendants()].includes(other);
    n.checkVisibility = () => { for (let p = n; p; p = p.parent) if (p.hidden) return false; return true; };
    n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 20, height: 20, right: 20, bottom: 20 });
    return n;
  };
  doc.body = doc.createElement('body'); doc.body.root = true;
  doc.getElementById = id => [doc.body, ...doc.body.descendants()].find(n => n.id === id) ?? null;
  doc.addEventListener = () => {}; doc.visibilityState = 'visible';
  const previous = globalThis.document; globalThis.document = doc;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const host = doc.createElement('aside'); doc.body.append(host);
  const r = Object.assign(Object.create(ThingsRail.prototype), { doc, host, creators: new Map(), serial: 0, scope: 'topic', kept: new Map(),
    folds: { isOpen: () => true }, notebookWant: 20, notebookFrom: null, buildWant: 20, buildFrom: null,
    reload() { this.reloads = (this.reloads ?? 0) + 1; }, shows: () => false, close() {} });
  r.build(); host.hidden = false;
  const calls = [], commands = [], opened = [];
  const api = { command: async request => { commands.push(request); return { instance_id: request.instance_id, operation_id: request.operation_id,
    kind: request.kind, recorded: true, status: 'committed', result: { item_id: request.target.item_id, revision: 1, owner_scope: request.target.owner_scope } }; } };
  const handles = { route: { kind: 'topic', id: 't788' }, topic: { id: 't788', title: 'Private topic title', version: 1 }, workspaceId: 'w788', workspaceTitle: 'Outcome title',
    bootstrap: { instance_id: 'i788', actor: 'reader788', authority: { authority_id: 'a788', authority_epoch: 'e788' } }, api,
    inTurn: async () => null, open: (...args) => opened.push(args), readable: () => true, view: async (name, args) => {
      calls.push([name, structuredClone(args)]);
      if (name === 'pipeline') return { pipeline: null };
      if (name === 'stars') return { items: [] };
      if (name === 'topic_tools') return { linked: [] };
      if (name === 'conversation') return { conversation: { topic_id: 'c788', version: 1 } };
      if (name === 'memory_items') return { items: pages, next_cursor: next, reader_may_write: writable };
      if (name === 'topic_messages' || name === 'topic_images') return { items: [] };
      throw Error('Unexpected read ' + name);
    } };
  handles.notebookCreate = (host, scope) => new NotebookCreate({ host, scope, api, bootstrap: handles.bootstrap, open: (...args) => opened.push(args) });
  if (ready) r.ready(handles);
  return { r, doc, host, handles, calls, commands, opened, api };
}
const visible = r => [...r.sections].filter(([, part]) => !part.details.hidden).map(([key]) => key);
const found = overrides => ({ topicId: 't788', notebook: [page()], notebookMayWrite: true, notebookNext: null,
  pipeline: null, messages: [], images: [], tools: [], ...overrides });

test('788 revised rail declares Notebook, PRs, Images, conditional sections, then Pipeline; no Starred', () => {
  assert.deepEqual(SECTIONS.map(([key]) => key), ['notebook', 'prs', 'images', 'waiting', 'previews', 'tools', 'pipeline']);
});
test('788 revised topic has no scope controls, name row or arrow-reachable scope choice', t => {
  const { r, host } = fixture(t);
  assert.equal(host.querySelector('.things-scope') === null, true);
  assert.equal(host.querySelector('.things-name') === null, true);
  assert.equal(host.text.includes('Private topic title'), false);
  assert.equal(typeof r.choose, 'undefined', 'retired choice has no remaining handler');
  assert.deepEqual(controls(host).filter(n => /Just this topic|All of this outcome/.test(n.text)).map(n => n.text), []);
});
test('788 revised topic reads only its Notebook and links, retaining exact bounds without a stars read', async t => {
  const f = fixture(t); await f.r.load();
  assert.deepEqual(f.calls, [
    ['pipeline', { workspace_id: 'w788', section: 'now', limit: 100 }],
    ['topic_tools', { topic_id: 't788' }], ['memory_items', { owner_scope: scope, limit: 20 }],
    ['topic_messages', { topic_id: 't788', direction: 'before', limit: 50 }], ['topic_images', { topic_id: 't788', limit: 24, include_pdfs: true }],
  ]);
  assert.deepEqual(visible(f.r), ['notebook']);
});
test('788 revised actual paint keeps conditional section order and Pipeline last', async t => {
  const { r } = fixture(t);
  r.paint(found({ pipeline: {
    now: { pipeline: { title: 'Work' }, items: [{ number: 788, title: 'Revise rail', raised_by: 'reader788' }],
      pieces: [{ topic: { id: 't788', title: 'Current build' }, items: [788], stage: { name: 'Build' } }] },
    next: { items: [] }, builds: { items: [], next: null, fresh: 0 } },
    messages: [{ id: 'm788', body: 'https://github.com/example/repo/pull/7 https://preview.example/preview/', sent_ms: null, author_id: 'reader788' }],
    images: [{ attachment: { id: 'image788', name: 'Sketch' }, topic_id: 't788', source_ref: { id: 'm788' }, author_id: 'reader788', sent_ms: null }],
    tools: [{ tool_id: 'tool788', name: 'Tool', home: 'w788', live: true }] }));
  assert.deepEqual(visible(r), ['notebook', 'prs', 'images', 'waiting', 'previews', 'tools', 'pipeline']);
  assert.equal(r.sections.get('images').body.querySelector('a').href, '?topic=t788&message=m788');
  assert.match(r.sections.get('pipeline').body.text, /Current build/);
  assert.match(r.sections.get('waiting').body.text, /Revise rail/);
  await new Promise(resolve => setImmediate(resolve));
});
test('788 revised empty writable Notebook retains its same-topic pencil and creation receipt', async t => {
  const f = fixture(t, { pages: [] }); await f.r.load();
  assert.deepEqual(visible(f.r), ['notebook']);
  const creator = f.r.creators.get('topic'); assert.equal(creator.button.hidden, false);
  assert.ok(f.r.sections.get('notebook').details.querySelector('summary').children.includes(creator.button));
  creator.button.onclick(); creator.line.input.value = 'Exact title'; await creator.line.go();
  assert.equal(f.commands.length, 1); const request = f.commands[0];
  assert.equal(request.kind, 'memory.create'); assert.deepEqual(request.target.owner_scope, scope);
  assert.deepEqual(request.args, { title: 'Exact title', body: '', attachments: [], references: [] });
  assert.deepEqual(request.expected, { item_revision: 0, authority: { authority_id: 'a788', authority_epoch: 'e788' } });
  assert.deepEqual(f.opened[0][0], { kind: 'cards', id: request.target.item_id, write: 'new' });
  assert.ok(f.opened[0][1] === creator.button);
});
test('788 revised pencil keeps exact retry identity and title after an unconfirmed creation', async t => {
  const f = fixture(t, { pages: [] }); await f.r.load(); const creator = f.r.creators.get('topic');
  const original = f.api.command; let attempt = 0; const sent = [];
  f.api.command = async request => { sent.push(structuredClone(request)); if (++attempt === 1) throw Error('lost answer'); return original(request); };
  creator.button.onclick(); creator.line.input.value = 'Kept title'; await creator.line.go();
  assert.equal(f.opened.length, 0); assert.equal(creator.line.input.value, 'Kept title'); assert.match(creator.line.state.text, /Not confirmed/);
  await creator.line.go(); assert.deepEqual(sent[1], sent[0]); assert.equal(f.opened.length, 1);
});
test('788 revised read-only Notebook hides the pencil but keeps its page link and changed light', async t => {
  const f = fixture(t, { writable: false }); await f.r.load();
  assert.equal(f.r.creators.get('topic').button.hidden, true);
  const link = f.r.sections.get('notebook').body.querySelector('a.row');
  const light = () => { const row = f.r.sections.get('notebook').body.querySelector('a.row'), badge = row.querySelector('.changed');
    return badge ? [badge.textContent, row.querySelector('.sr-only').textContent] : null; };
  assert.equal(link.href, '?topic=t788&page=n788');
  assert.deepEqual(light(), ['2', ', changed since you read it, 2 new revisions']);
  link.onclick(click(link)); assert.deepEqual(f.opened[0][0], { kind: 'topic', id: 't788', page: 'n788' });
  assert.ok(f.opened[0][2] === link);
  f.r.paint(found({ notebook: [page(3, 3)], notebookMayWrite: false }));
  assert.equal(light(), null);
  f.r.paint(found({ notebook: [page(4, 3)], notebookMayWrite: false }));
  assert.deepEqual(light(), ['1', ', changed since you read it, 1 new revision']);
});
test('788 revised More pages retains paging owner and readable-denial clears the rail and pencil', async t => {
  const f = fixture(t, { next: 20 }); f.r.notebookWant = 1; await f.r.load();
  const more = f.r.sections.get('notebook').body.querySelector('button'); more.focus(); more.onclick();
  assert.equal(f.r.notebookWant, 21); assert.equal(f.r.notebookFrom, 1); assert.equal(f.r.reloads, 1);
  f.handles.readable = () => false; f.r.topicChanged();
  assert.deepEqual(visible(f.r), []); assert.equal(f.r.creators.get('topic').button.hidden, true); assert.equal(f.r.kept.size, 0);
});
test('788 revised a stale rail read cannot repaint the next topic', async t => {
  const f = fixture(t); let release; const view = f.handles.view;
  let started;
  const notebookStarted = new Promise(resolve => { started = resolve; });
  f.handles.view = (name, args) => {
    if (name !== 'memory_items') return view(name, args);
    return new Promise(resolve => { release = resolve; started(); });
  };
  const pending = f.r.load(); await notebookStarted; f.r.serial++; f.r.clear();
  release({ items: [page()], reader_may_write: true }); await pending;
  assert.deepEqual(visible(f.r), []); assert.equal(f.r.creators.get('topic').button.hidden, true);
});


test('788 real Shell resolves the legacy Conversation address before ready and supplies only its topic rail and pencil', async t => {
  const f = fixture(t, { ready: false, pages: [] });
  const win = { location: new URL('http://aim.test/?conversation=w788#kept'), history: { state: { aimPlace: 3 },
    replaceState(state, title, href) { this.state = state; win.location = new URL(href, win.location); } } };
  const shell = new Shell({ doc: null, win, build: null });
  shell.begin({}); shell.follow(f.r);
  assert.deepEqual(shell.route(), { kind: 'conversation', id: 'w788' });
  // Execute the app's real legacy-address block, not a copy of its rename or
  // a synthetic route passed to the rail. The Shell reads the resulting URL.
  const topicId = await resolveLegacyConversation(shell, f.handles.view);
  assert.equal(topicId, 'c788');
  assert.equal(win.location.search + win.location.hash, '?topic=c788#kept', 'legacy address is replaced before ready');
  assert.deepEqual(win.history.state, { aimPlace: 3 }, 'rename preserves the history entry');
  shell.ready({ ...f.handles, topic: { id: topicId, title: 'Conversation', kind: 'conversation', version: 1 } });
  assert.deepEqual(f.r.handles.route, { kind: 'topic', id: 'c788' });
  assert.equal(f.r.heading.textContent, 'In this topic');
  await f.r.load();
  assert.deepEqual(f.calls, [
    ['conversation', { workspace_id: 'w788' }],
    ['pipeline', { workspace_id: 'w788', section: 'now', limit: 100 }],
    ['topic_tools', { topic_id: 'c788' }], ['memory_items', { owner_scope: { kind: 'topic', id: 'c788' }, limit: 20 }],
    ['topic_messages', { topic_id: 'c788', direction: 'before', limit: 50 }], ['topic_images', { topic_id: 'c788', limit: 24, include_pdfs: true }],
  ]);
  assert.equal(f.host.querySelector('.things-scope') === null, true);
  assert.equal(f.host.querySelector('.things-name') === null, true);
  assert.deepEqual(visible(f.r), ['notebook']);
  assert.deepEqual([...f.r.creators.keys()], ['topic'], 'only the current-topic pencil exists');
  const creator = f.r.creators.get('topic'); assert.equal(creator.button.hidden, false);
  creator.button.onclick(); creator.line.input.value = 'Conversation page'; await creator.line.go();
  assert.deepEqual(f.commands[0].target.owner_scope, { kind: 'topic', id: 'c788' });
});
