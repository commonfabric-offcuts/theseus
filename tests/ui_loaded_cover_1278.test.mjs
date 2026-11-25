import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TopicViews } from '../web/topic-views.mjs';
import { planTopicWindow } from '../web/topic-working-set.mjs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { stackState, arrangeStacks, forgetStackMessages } from '../web/reply-stacks.mjs';

const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const row = n => ({ id: 'm' + n, seq: n, topic_id: 't', author_id: 'person', body: 'Words ' + n });
const page = (from, to) => ({ instance_id: 'i', items: Array.from({ length: to - from + 1 }, (_, n) => row(from + n)), next_cursor: null, relevant_versions: { topic: to } });
function fixture({ supplemental = false, replyHead = false } = {}) {
  const r = renderer799('person'), doc = r.list.ownerDocument;
  const first = row(1), reply = { ...row(2), reply_to: supplemental ? 'original' : 'm1' };
  if (supplemental) reply.stack_position = { root_id: 'original', at: { acts: 1 } };
  r.add(replyHead ? [reply] : [first, reply]);
  const head = replyHead ? 'm2' : 'm1', section = r.list.querySelector('.reply-stack');
  const cover = doc.createElement('div'); cover.className = 'dossier-cover';
  const words = doc.createElement('span'), button = doc.createElement('button'); cover.append(words, button); section.prepend(cover);
  // Rectangles and range intersection are modeled here; no native geometry claim.
  let rect = { top: 18, bottom: 918, height: 900, width: 500 }, rendered = true;
  cover.getBoundingClientRect = () => rect; cover.getClientRects = () => rendered ? [rect] : [];
  const entries = new Map(r.list.querySelectorAll('[data-id]').map(node => [node.dataset.id, node]));
  const env = { windowTargets: new Set(), document: doc, messageEntries: entries,
    halfShown: new Set(), atMiddle: new Set(), pressHold: { down: false }, reader: null,
    registry: { current: null, cards: new Map(), sessions: new Map() }, messageEdit: null, menu: null,
    views: null, listActAnchor: null, anchorHold: null, pendingSendCard: () => null,
    $: () => r.list, innerHeight: 900 };
  let getOptions;
  const views = new TopicViews({ instanceId: 'i', topicId: 't', window: () => getOptions() }); env.views = views;
  getOptions = new Function(...Object.keys(env), app.slice(app.indexOf('function topicWindowOptions('), app.indexOf('function queueWindowEvictions(')) + '\nreturn topicWindowOptions;')(...Object.values(env));
  const initial = page(1, 30); initial.items[1] = reply;
  if (replyHead) initial.items = initial.items.filter(item => item.id !== 'm1');
  views.messagesPage(initial, { initial: true });
  const pressure = (from = 30, to = 660) => { for (let n = from; n < to; n += 30) {
    assert.equal(views.messagesPage(page(n + 1, n + 30), { live: true, cursor: n }), true);
    assert.ok(views.messages.size + views.windowRoots.size <= 300);
    assert.ok(new Set(views.runs.values()).size <= 8);
  } };
  return { ...r, doc, cover, section, words, button, entries, env, views, getOptions, pressure, head,
    offscreen: () => { rect = { top: -1000, bottom: -100, height: 900, width: 500 }; },
    show: () => { rect = { top: 18, bottom: 918, height: 900, width: 500 }; },
    hide: () => { rendered = false; } };
}
for (const route of ['passive arrivals while reading', 'wheel/touch scroll into view', 'pointer/key noncollapsed selection', 'keyboard focus on cover control']) {
  test('1278 ' + route + ' protects the current dossier with message entries offscreen', () => {
    const f = fixture();
    if (route.includes('scroll')) { f.offscreen(); assert.equal(f.getOptions().pins.has(f.head), false); f.show(); }
    if (route.includes('selection')) { f.offscreen(); f.doc.getSelection = () => ({ isCollapsed: false, rangeCount: 1, getRangeAt: () => ({ intersectsNode: node => node === f.cover }) }); }
    if (route.includes('focus')) { f.offscreen(); f.button.focus(); }
    assert.ok(f.getOptions().pins.has(f.head));
    f.pressure(); assert.ok(f.views.messages.has(f.head)); assert.ok(f.views.messages.has('m660'));
    assert.equal(f.getOptions().pins.size, 1, 'cover protects one current head, not every historical member');
    assert.ok(f.views.windowGaps.length > 0, 'ordinary eviction still creates bounded gaps');
  });
}
test('1278 scrolling away releases viewport protection; bounded explicit return restores current source', () => {
  const f = fixture(); assert.ok(f.getOptions().pins.has('m1')); f.offscreen();
  f.doc.activeElement = null; f.doc.getSelection = () => ({ isCollapsed: true, rangeCount: 0 });
  assert.equal(f.getOptions().pins.has('m1'), false); f.pressure(); assert.equal(f.views.messages.has('m1'), false);
  const current = page(1, 30); current.items[0].body = 'Current stored words'; current.items[0].revision = 4;
  assert.equal(f.views.messagesPage(current, { anchored: true, cursor: 31 }), true);
  assert.equal(f.views.messages.get('m1').body, 'Current stored words'); assert.ok(f.views.messages.size <= 300);
});
test('1278 offscreen cover selection protects through pressure, then collapse or move-away releases it for eviction', () => {
  for (const release of ['collapse', 'move-away']) {
    const f = fixture(); f.offscreen();
    const outside = f.doc.createElement('span'); f.list.append(outside);
    let selected = f.cover, collapsed = false;
    f.doc.getSelection = () => ({ isCollapsed: collapsed, rangeCount: collapsed ? 0 : 1,
      getRangeAt: () => ({ intersectsNode: node => node === selected }) });
    assert.ok(f.getOptions().pins.has('m1'), release + ': noncollapsed cover range establishes protection');
    f.pressure(); assert.ok(f.views.messages.has('m1'), release + ': selected dossier survives ordinary pressure');
    if (release === 'collapse') collapsed = true; else selected = outside;
    assert.equal(f.getOptions().pins.has('m1'), false, release + ': changed range releases the offscreen cover');
    f.pressure(660, 1320);
    assert.equal(f.views.messages.has('m1'), false, release + ': ordinary eviction resumes');
    assert.ok(f.views.messages.has('m1320')); assert.equal(f.views.newest, 1320);
  }
});
test('1278 offscreen focused cover control protects through pressure, then focus elsewhere releases it for eviction', () => {
  const f = fixture(); f.offscreen();
  const outside = f.doc.createElement('button'); f.list.append(outside);
  f.button.focus(); assert.ok(f.getOptions().pins.has('m1'), 'cover control establishes focus protection');
  f.pressure(); assert.ok(f.views.messages.has('m1'), 'focused dossier survives ordinary pressure');
  outside.focus(); assert.equal(f.doc.activeElement, outside);
  assert.equal(f.getOptions().pins.has('m1'), false, 'moving focus elsewhere releases the offscreen cover');
  f.pressure(660, 1320);
  assert.equal(f.views.messages.has('m1'), false, 'ordinary eviction resumes');
  assert.ok(f.views.messages.has('m1320')); assert.equal(f.views.newest, 1320);
});
for (const options of [{ replyHead: true }, { supplemental: true, replyHead: true }]) {
  test('1278 reply-headed cover reserves its current ' + (options.supplemental ? 'supplemental original and member' : 'loaded identity'), () => {
    const f = fixture(options); assert.equal(f.section.dataset.stack, 'm2'); assert.ok(f.getOptions().pins.has('m2'));
    f.pressure(); assert.ok(f.views.messages.has('m2'));
    if (options.supplemental) assert.ok(f.views.windowRoots.has('original'));
    assert.ok(f.views.messages.size + f.views.windowRoots.size <= 300);
  });
}
test('1278 hidden/disconnected or foreign-list covers and stale head ids add no protection', () => {
  for (const mode of ['hidden', 'detached', 'foreign', 'stale']) {
    const f = fixture();
    if (mode === 'hidden') f.hide();
    if (mode === 'detached') f.section.remove();
    if (mode === 'foreign') { const other = f.doc.createElement('div'); other.root = true; other.append(f.section); }
    if (mode === 'stale') f.section.dataset.stack = 'never-loaded-private';
    assert.equal(f.getOptions().pins.size, 0, mode); f.pressure(); assert.equal(f.views.messages.has('m1'), false, mode);
  }
});
test('1278 current section identity wins over old cover provenance after a split/rehead', () => {
  const f = fixture(); f.cover.dataset.root = 'old-private-root'; f.section.dataset.stack = 'm2';
  assert.ok(f.getOptions().pins.has('m2')); assert.equal(f.getOptions().pins.has('old-private-root'), false);
});
test('1278 other message/explicit/external Reader pins and original writing survive cover protection', () => {
  const f = fixture(); f.env.halfShown.add(2); f.env.windowTargets.add('explicit');
  // These owners are mutable after the options closure captures them.
  f.env.registry.current = { source: { source_ref: { kind: 'message', id: 'external-reader' } } };
  f.env.registry.sessions.set('draft', { editor: { draft: { body: 'Later B', attachments: ['image'] }, submissions: [{ id: 'A', status: 'unknown', envelope: { operation_id: 'same-A' } }] } });
  const before = structuredClone(f.env.registry.sessions.get('draft').editor);
  const options = f.getOptions(); assert.equal(options.budget, 299); assert.ok(options.pins.has('m2')); assert.ok(options.pins.has('explicit')); assert.ok(options.pins.has('external-reader'));
  f.pressure(); assert.ok(f.views.messages.size + f.views.windowRoots.size + 1 <= 300); assert.deepEqual(f.env.registry.sessions.get('draft').editor, before);
});
test('1278 actual retirement and arrangement retain the protected dossier section while unprotected cards leave', () => {
  const f = fixture(); f.offscreen(); f.button.focus(); f.pressure();
  assert.equal(f.views.messages.has('m2'), false, 'unprotected neighboring card is actually retired');
  const env = { ...f.env, windowEvictions: new Set([...f.entries.keys()].filter(id => !f.views.messages.has(id))),
    newAbove: new Set(), coldArrivals: null, openedIds: new Set(), cardReplies: null, cardScroll: null,
    messageChanges: null, questionStates: null, visitNew: null, stackFeed: null,
    dropCardDocuments() {}, dropCardImages() {}, cardIn: entry => entry, forgetReadEntry() {}, forgetStackMessages };
  new Function(...Object.keys(env), app.slice(app.indexOf('function releaseWindowReferences('), app.indexOf('async function readWindowGap(')) + '\nreleaseWindowReferences();')(...Object.values(env));
  arrangeStacks(f.list, new Map([...f.views.messages].filter(([id]) => f.entries.has(id))), { doc: f.doc, viewer: 'person' });
  assert.equal(stackState(f.list).sections.get('m1'), f.section); assert.equal(f.section.isConnected, true);
});
test('1278 visible message control and unsatisfiable protection keep existing planner pressure semantics', () => {
  const f = fixture(); f.offscreen(); f.env.halfShown.add(1); assert.ok(f.getOptions().pins.has('m1')); f.pressure(); assert.ok(f.views.messages.has('m1'));
  const messages = new Map(Array.from({ length: 301 }, (_, n) => { const item = row(n + 1); return [item.id, item]; }));
  const plan = planTopicWindow(messages, new Map([...messages.keys()].map(id => [id, 1])), { pins: messages.keys() });
  assert.equal(plan.blocked, true); assert.equal(plan.full.size, 300); assert.ok(plan.rejectedPins.size);
});
