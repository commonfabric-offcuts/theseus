import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { StackFeed } from '../web/stack-feed.mjs';
import { mayStartFrom } from '../web/whisper-choice.mjs';
import { configureCoverRefresh } from '../web/cover-refresh.mjs';
import { openLinksWith } from '../web/links.mjs';
import { withdrawalItem } from '../web/question-withdrawal.mjs';

const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const menuCode = app.slice(app.indexOf('function messageMenuItems(item,'), app.indexOf('function moveDossier(id,'));
const readerCode = app.slice(app.indexOf('function openReaderMenu()'), app.indexOf('// Who may edit which message here'));
const labels = items => items.map(item => item.label);
const later = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
function fixture({ phone = false, below = false, starred = false, folded = false, unavailable = false } = {}) {
  const r = renderer799(), calls = [], doc = r.list.ownerDocument;
  const position = { root_id: 'm-first', can_move: true, below, through: below ? 2 : null, aside_revision: 1, at: { acts: 1, messages: 2 } };
  const state = r.add([{ id: 'm-first', seq: 1, topic_id: 't-fixture', author_id: 'fixture-agent', author_kind: 'agent', stack_position: position },
    { id: 'm-reply', seq: 2, topic_id: 't-fixture', author_id: 'fixture-agent', author_kind: 'agent', reply_to: 'm-first', stack_position: position }]);
  for (const n of r.list.descendants()) n.getClientRects = () => [{}];
  const item = r.messages.get('m-first'), anchor = doc.createElement('button');
  const feed = { list: r.list, state, undos: [], actsOf: () => ({ starred, folded }),
    entryFor: id => [...r.list.descendants()].find(node => node.dataset.id === id),
    star: item => calls.push(['star', item.id]), setFold: (item, value, options) => calls.push(['fold', item.id, value, options.focus]),
    setAside: (stack, value, options) => calls.push(['aside', stack.id, value, options.focus]),
    startRename: stack => calls.push(['rename', stack.id]), move: () => {}, join: () => {}, fold: () => {}, arrange: () => {}, focusOn: () => {},
    menuItems(item, options) { return StackFeed.prototype.menuItems.call(this, item, options); } };
  const p = { source: { ...item, source_ref: { kind: 'message', id: item.id }, author: item.author_id, body: 'Full source', dossier: { can_move: true } },
    sourceUnavailable: unavailable, editors: { reply: {} } };
  const registry = { current: p, generation: 1, inline: { surface: 'inline' },
    isCurrent: q => q === registry.current || q === registry.inline && !registry.current,
    isSourceCurrent: q => q === registry.current,
    close: async q => { calls.push(['close']); if (q !== registry.current) return false; registry.current = null; ++registry.generation; return true; },
    startDossier: async (q, options) => { calls.push(['dossier', q.source.source_ref.id, options]); registry.current = null; return true; } };
  const reader = { presentation: p, source: p.source, quotable: true, layoutChoice: 'Wide',
    quote: () => calls.push(['quote']), toggleLayout: () => calls.push(['layout']), names: () => ['fixture-agent'], notice: error => calls.push(['notice', error.message]) };
  let menu;
  const env = { window: { matchMedia: () => ({ matches: phone }) }, document: doc, stackFeed: feed, topicUnavailable: false, outcomeReached: false,
    topic: { id: 't-fixture' }, retired: false, registry, reader, messageEdit: null, pipelineRow: { on: true }, pipelineAddFor: null,
    bootstrap: { actor: 'fixture-human' }, messageEntries: new Map(), cardScroll: { clipped: () => true, showFull: () => calls.push(['full']) },
    cardIn: () => ({}), cardMenuActs: (_item, items) => items, run: fn => fn(),
    marks: { state: () => ({ marked: false }) }, mayEdit: () => true, editRights: () => ({}), editOpener: () => anchor,
    updateMenuItem: () => ({ label: 'Ask for update', glyph: 'refresh', act: () => calls.push(['update']) }), updateContext: () => ({}),
    withdrawalItem, withdrawals: { withdraw: item => calls.push(['withdraw', item.id]) },
    copyLink: (...args) => calls.push(['copy', ...args.slice(0, 2)]), editMessage: id => calls.push(['edit', id]),
    markFromMenu: (id, marked) => calls.push(['mark', id, marked]), moveDossier: id => calls.push(['move', id]), mayStartFrom,
    textDisplayMenuItems: () => [{ label: 'Text display', glyph: 'text', act: () => {} }],
    openStartLine: () => calls.push(['topic', registry.current.source.source_ref.id]),
    openPipelineAdd: () => calls.push(['pipeline', registry.current.source.source_ref.id]), closePipelineAdd: () => {},
    openSource: async () => p, messageLink: (topic, id) => 'fixture/' + topic + '/' + id,
    whisperPeople: () => ({ kindOf: () => 'agent' }), inline: { show: () => calls.push(['show']), pop: () => calls.push(['pop']) },
    status: error => calls.push(['status', error.message]),
    $: () => anchor, readerFeedItem: () => item, openMessageMenu: options => { menu = options; },
  };
  const make = overrides => new Function(...Object.keys({ ...env, ...overrides }), menuCode + '\n' + readerCode + '\nreturn { messageMenuItems, openReaderMenu, withMenuSource: typeof withMenuSource === "function" ? withMenuSource : null, leaveReaderForRename: typeof leaveReaderForRename === "function" ? leaveReaderForRename : null };')(...Object.values({ ...env, ...overrides }));
  return { ...r, p, reader, registry, feed, item, anchor, calls, make, menu: () => menu, methods: make({}) };
}

test('feed and Reader consume the same actions; arrangement, full message, quote and layout remain on their own surface', () => {
  for (const phone of [false, true]) {
    const f = fixture({ phone }), feed = f.methods.messageMenuItems(f.item, f.anchor);
    f.methods.openReaderMenu(); const reader = f.menu().items;
    const common = ['Star for me', 'Rename', 'Archive', 'Fold', 'Move to topic…', 'Copy Link', 'Edit', 'Ask for update', 'Mark unread',
      'Start a topic from this', 'Add to pipeline', 'Start a new dossier', 'Text display'];
    for (const label of common) { assert.ok(labels(feed).includes(label), 'feed: ' + label); assert.ok(labels(reader).includes(label), 'Reader: ' + label); }
    assert.equal(labels(reader).some(label => /stack|latest|Show all|Show full|Move or join/.test(label)), false);
    assert.ok(labels(feed).includes('Show full message')); assert.ok(labels(reader).includes('Quote selection')); assert.ok(labels(reader).includes('Wide'));
    assert.equal(labels(feed).includes('Quote selection'), false); assert.equal(labels(feed).includes('Wide'), false);
  }
});

test('366 card, dossier and Reader use one shared withdrawal action with the exact source', () => {
  for (const phone of [false, true]) {
    const f = fixture({ phone });
    Object.assign(f.item, { author_id: 'fixture-human', intent: 'ask' });
    Object.assign(f.p.source, { author: 'fixture-human', author_id: 'fixture-human', intent: 'ask' });
    const methods = f.make({ editRights: () => ({ actor: 'fixture-human' }) });
    const card = methods.messageMenuItems(f.item, f.anchor);
    const dossier = methods.messageMenuItems(f.item, null, f.anchor, [
      { label: 'Reply', glyph: 'reply', act() {} },
      { label: 'Withdraw question', glyph: 'undo', act() { throw Error('duplicate withdrawal owner'); } },
    ]);
    methods.openReaderMenu();
    for (const items of [card, dossier, f.menu().items]) {
      const offered = items.filter(item => item.label === 'Withdraw question');
      assert.equal(offered.length, 1);
      offered[0].act();
    }
    assert.deepEqual(f.calls, [['withdraw', 'm-first'], ['withdraw', 'm-first'], ['withdraw', 'm-first']]);
    f.item.withdrawal = f.p.source.withdrawal = { by: 'fixture-human', at_ms: 42 };
    assert.equal(labels(methods.messageMenuItems(f.item, f.anchor)).includes('Withdraw question'), false);
    methods.openReaderMenu(); assert.equal(labels(f.menu().items).includes('Withdraw question'), false);
  }
});

test('Reader star, fold and archive use the loaded message owners without moving focus into the feed', () => {
  for (const [starred, folded, below] of [[false, false, false], [true, true, true]]) {
    const f = fixture({ starred, folded, below }); f.methods.openReaderMenu(); const items = f.menu().items;
    items.find(x => x.label === (starred ? 'Unstar' : 'Star for me')).act();
    items.find(x => x.label === (folded ? 'Unfold' : 'Fold')).act();
    items.find(x => x.label === (below ? 'Bring back' : 'Archive')).act();
    assert.deepEqual(f.calls, [['star', 'm-first'], ['fold', 'm-first', !folded, false], ['aside', 'm-first', !below, false]]);
  }
  const f = fixture({ starred: true }); f.methods.openReaderMenu(); assert.equal(labels(f.menu().items).includes('Fold'), false);
});

test('Reader Rename retains and closes the Reader before opening the existing dossier title field; a reply has no Rename', async () => {
  const f = fixture(); f.methods.openReaderMenu(); await f.menu().items.find(x => x.label === 'Rename').act();
  assert.deepEqual(f.calls, [['close'], ['rename', 'm-first']]);
  const reply = f.feed.menuItems(f.messages.get('m-reply'), { reader: true }); assert.equal(labels(reply.first).includes('Rename'), false);
});

test('phone title extras retain Reply and use only the shared Archive owner', async () => {
  const f = fixture({ phone: true });
  const items = f.methods.messageMenuItems(f.item, null, f.anchor, [
    { label: 'Reply', glyph: 'reply', act: () => f.calls.push(['reply']) },
    { label: 'Archive', glyph: 'archive', act: () => { throw Error('duplicate owner'); } },
  ]);
  assert.equal(labels(items).filter(label => label === 'Archive').length, 1);
  assert.equal(items[0].label, 'Reply');
  items[0].act(); items.find(item => item.label === 'Archive').act();
  assert.deepEqual(f.calls, [['reply'], ['aside', 'm-first', true, true]]);
});

test('Rename stays put when keeping the Reader fails or another source wins the close', async () => {
  for (const close of ['failed', 'superseded']) {
    const f = fixture();
    f.registry.close = async () => { if (close === 'superseded') f.registry.generation += 2; return close !== 'failed'; };
    f.methods.openReaderMenu(); await f.menu().items.find(x => x.label === 'Rename').act();
    if (close === 'failed') assert.equal(f.calls[0][0], 'notice');
    else assert.deepEqual(f.calls, []);
  }
});

test('feed Start topic and Add pipeline open the exact source; a superseded or failed open performs no action', async () => {
  for (const label of ['Start a topic from this', 'Add to pipeline', 'Start a new dossier']) {
    const f = fixture(), wait = later(); let opened = 0;
    const methods = f.make({ openSource: async ref => { assert.equal(ref.id, 'm-first'); ++opened; await wait.promise; return f.p; } });
    const action = methods.messageMenuItems(f.item, f.anchor).find(x => x.label === label).act();
    f.registry.current = { ...f.p }; wait.resolve(); await action;
    assert.equal(opened, 1); assert.deepEqual(f.calls, []);
    const failed = f.make({ openSource: async () => null });
    await failed.messageMenuItems(f.item, f.anchor).find(x => x.label === label).act(); assert.deepEqual(f.calls, []);
  }
  for (const [label, expected] of [['Start a topic from this', 'topic'], ['Add to pipeline', 'pipeline']]) {
    const f = fixture(); await f.methods.messageMenuItems(f.item, f.anchor).find(x => x.label === label).act();
    assert.deepEqual(f.calls, [[expected, 'm-first']]);
  }
});

test('new dossier from Reader moves its reply, feed leaves it, and both open the existing New message composer', async () => {
  for (const inReader of [false, true]) {
    const f = fixture(); let items;
    if (inReader) { f.methods.openReaderMenu(); items = f.menu().items; } else items = f.methods.messageMenuItems(f.item, f.anchor);
    await items.find(x => x.label === 'Start a new dossier').act();
    assert.equal(f.calls[0][0], 'dossier'); assert.equal(f.calls[0][2].moveReply, inReader);
    assert.equal(f.calls[0][2].link, 'fixture/t-fixture/m-first');
    assert.deepEqual(f.calls.slice(1), [['show'], ['pop']]);
  }
});

test('an agent whisper offers no topic/pipeline extraction, and an unavailable Reader offers no message actions', () => {
  const f = fixture(); f.item.whisper = true; f.p.source.whisper = true;
  const feed = f.methods.messageMenuItems(f.item, f.anchor); f.methods.openReaderMenu();
  for (const items of [feed, f.menu().items]) for (const label of ['Start a topic from this', 'Add to pipeline']) assert.equal(labels(items).includes(label), false);
  const unavailable = fixture({ unavailable: true }); unavailable.reader.quotable = false; unavailable.methods.openReaderMenu();
  assert.deepEqual(labels(unavailable.menu().items), ['Wide']);
});

test('the actual app source-open returns only the confirmed current presentation, never a cancelled or superseded source', async () => {
  const openCode = app.slice(app.indexOf('async function openSource('), app.indexOf('// Synchronous repaint owners retain writing'));
  for (const outcome of ['current', 'cancelled', 'superseded', 'unavailable']) {
    const source = { instance_id: 'i-fixture', source_ref: { kind: 'message', id: 'm-first' } }, p = { source, token: 1 };
    const registry = { interactive: {}, generation: 1, isCurrent: q => q === p };
    const reader = { dialog: { open: true }, presentation: p, source, paintOffer() {}, notice() {} };
    if (outcome === 'superseded') reader.presentation = {};
    if (outcome === 'unavailable') p.sourceUnavailable = true;
    const env = { clearVisitNew() {}, opening: 0, registry, topic: { id: 't-fixture' }, views: { retain() {} }, listAccessEpoch: 1,
      status() {}, marks: { open: async () => outcome === 'cancelled' ? null : p }, retired: false,
      bootstrap: { instance_id: 'i-fixture' }, reader, releaseTopArrivals() {}, landOn() {} };
    const open = new Function(...Object.keys(env), openCode + '\nreturn openSource;')(...Object.values(env));
    const result = await open({ kind: 'message', id: 'm-first' });
    assert.equal(result === p, outcome === 'current', outcome);
  }
});

test('feed and Reader keep 840’s one cover request and pending-link owner', async t => {
  const f = fixture(), doc = f.list.ownerDocument, storage = new Map(), sent = [], opened = [];
  doc.querySelectorAll = selector => f.list.querySelectorAll(selector);
  doc.defaultView = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  const make = doc.createElement;
  doc.createElement = tag => {
    const node = make(tag); node.click = () => node.listeners.click?.({ button: 0, stopPropagation() {}, preventDefault() {} }); return node;
  };
  openLinksWith((route, title, node) => opened.push([route.message, node.href]));
  configureCoverRefresh(() => ({ bootstrap: { instance_id: 'menus861-' + f.item.id, actor: 'fixture-human', authority: { authority_id: 'a-fixture', authority_epoch: 'e-fixture' } },
    api: { command: async envelope => { sent.push(envelope); return { ...envelope, status: 'committed', recorded: true,
      result: { refresh_revision: 1, refresh: { state: 'pending', recipient: 'fixture-writer', request_message_id: 'm-request' } } }; } }, changed() {} }));
  t.after(() => { configureCoverRefresh(null); openLinksWith(null); });
  f.methods.openReaderMenu(); assert.ok(f.menu().items.find(x => x.label === 'Ask for a cover'));
  await f.methods.messageMenuItems(f.item, f.anchor).find(x => x.label === 'Ask for a cover').act();
  assert.equal(sent.length, 1); assert.equal(sent[0].kind, 'stack.cover_refresh'); assert.equal(sent[0].target.message_id, 'm-first');
  f.methods.openReaderMenu(); await f.menu().items.find(x => x.label === 'Open the cover request').act();
  await f.methods.messageMenuItems(f.item, f.anchor).find(x => x.label === 'Open the cover request').act();
  assert.equal(sent.length, 1); assert.equal(opened.length, 2); assert.equal(opened[0][0], 'm-request');
  assert.deepEqual(opened[0], opened[1]);
  assert.equal(f.feed.menuItems(f.messages.get('m-reply'), { reader: true }).first.some(x => /cover/.test(x.label)), false);
});
