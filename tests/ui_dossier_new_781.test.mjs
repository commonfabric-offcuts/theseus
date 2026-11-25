// Contracts below the browser. No native gesture, layout or rendering claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as order from '../web/stack-order.mjs';
import * as stacks from '../web/reply-stacks.mjs';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
import { readNow } from '../web/card-reading.mjs';
import { Marks } from '../web/marks.mjs';
import { VisitNew } from '../web/visit-new.mjs';

const app = await readFile(new URL('../web/app.mjs', import.meta.url), 'utf8');
const file = new URL('../web/reply-stacks.mjs', import.meta.url);
const renderer = (await readFile(file, 'utf8')).replace(/from '(\.\/[^']+)'/g, (_, p) => 'from ' + JSON.stringify(new URL(p, file).href));
const { paintHead } = await import('data:text/javascript;base64,' + Buffer.from(renderer + '\nexport { paintHead };').toString('base64'));
Object.defineProperties(Element.prototype, {
  firstElementChild: { get() { return this.children[0] ?? null; } },
  parentElement: { get() { return this.parent; } },
  ownerDocument: { get() { return this.document; } },
});
const item = (id, seq, extra = {}) => ({ id, seq, topic_id: 'fixture-topic', body: 'Exact ' + id, author_id: 'fixture-writer', unread: true, ...extra });
const root = item('z-head', 10), oldest = item('r-last-alphabet', 20), middle = item('r-middle', 30), newest = item('a-newest', 40);
const stack = () => ({ id: root.id, dossier: root.id, head: { ...root }, replies: [{ ...middle }, { ...newest }, { ...oldest }], joins: new Map() });

test('781 greatest New sequence wins, including a head with newer replies; input order stays exact', () => {
  const s = stack(), before = structuredClone(s);
  assert.equal(typeof order.newestNew, 'function', 'the header needs an actual newest-New selection rule');
  const unread = new Set([root.id, oldest.id, middle.id, newest.id]), take = () => order.newestNew(s, each => unread.has(each.id));
  const result = [];
  while (take()) { result.push(take().id); unread.delete(take().id); }
  assert.deepEqual(result, [newest.id, middle.id, oldest.id, root.id]);
  assert.deepEqual(s, before, 'selection must not sort/mutate the dossier');
  assert.equal(take(), null);
});

test('781 actual header routes New before folding; ordinary tab and words retain their acts', () => {
  const doc = miniDocument(), list = doc.createElement('div'), section = doc.createElement('div'), card = doc.createElement('button');
  section.className = 'reply-stack'; section.dataset.stack = root.id; section.dataset.headOpen = 'true';
  card.dataset.id = root.id; list.append(section); section.append(card);
  const row = doc.createElement('span'), mark = doc.createElement('span'); row.className = 'stack-head'; mark.className = 'stack-act stack-new stack-new-action'; mark.dataset.stackAct = 'new'; row.append(mark); card.append(row);
  const state = stacks.stackState(list), s = stack(), calls = [], acted = [];
  Object.assign(state, { stacks: [s], sections: new Map([[s.id, section]]), on: { newest: (...args) => calls.push(args), acted: id => acted.push(id) }, again: () => calls.push('fold') });
  state.levels.set(s.id, 'open');
  assert.equal(stacks.headClick(list, card, { target: mark }), true);
  assert.deepEqual(calls, [[s, mark]], 'red New performs the explicit message act, never a generic tab fold');
  assert.equal(state.levels.get(s.id), 'open');
  assert.deepEqual(acted, [], 'New retains its confirmed-receipt action path');
  calls.length = 0; stacks.headClick(list, card, { target: row }); assert.deepEqual(calls, ['fold']);
  assert.deepEqual(acted, [root.id], 'hiding the first message by its title clears only that message');
  section.dataset.headOpen = 'true'; state.levels.set(s.id, 'open');
  assert.equal(stacks.headClick(list, card, { target: card }), false, 'words still reach their existing Reader handler');
});

test('781 real header renderer derives count from unread messages and removes it at zero', () => {
  const doc = miniDocument(); doc.getElementById = () => null;
  const card = doc.createElement('button'), s = stack(), unread = new Set([oldest.id, middle.id, newest.id]);
  const state = { renaming: null, checking: new Map() };
  const paint = () => paintHead(card, s, { state, open: true, starred: false, unread: each => unread.has(each.id), nameOf: id => id, doc });
  for (const [id, expected] of [[newest.id, ' · 3 new'], [middle.id, ' · 2 new'], [oldest.id, ' · 1 new']]) {
    paint(); const mark = card.querySelector('.stack-fresh'); assert.equal(mark.textContent, expected);
    assert.equal(mark.dataset.stackAct, 'new'); assert.equal(mark.getAttribute('role'), 'button');
    unread.delete(id);
  }
  paint(); assert.equal(card.querySelector('.stack-new-action'), null);
  unread.add(root.id); paint(); assert.equal(card.querySelector('.stack-new').textContent, 'New');
});

function appFixture({ headNew = false, failure = false, marked = false, short = false, waiting = false } = {}) {
  const s = stack(); s.head.unread = headNew; if (short) s.replies = [{ ...oldest, unread: false }];
  const messages = new Map([s.head, ...s.replies].map(each => [each.id, each]));
  const entries = new Map();
  const visitNew = new VisitNew('fixture-reader');
  const doc = { visibilityState: 'visible', hasFocus: () => true, addEventListener() {} }, openedIds = new Set(), sent = [], shown = [], focuses = [], focusCalls = [], lights = [], reveals = [];
  let serial = 0, fail = failure, epoch = 1, blockWhole = null, wholeWait = null, afterSend = null, afterRepaint = null, repaints = 0;
  const makeEntry = id => {
    const card = { dataset: { id }, isConnected: true };
    card.focus = () => {
      focusCalls.push(id);
      // A browser does not move focus or emit another focus event when the
      // already-focused node is focused again. Keep calls separately visible.
      if (doc.activeElement === card) return;
      doc.activeElement = card; focuses.push(id);
    };
    return card;
  };
  for (const id of messages.keys()) entries.set(id, makeEntry(id));
  const api = { command: async envelope => {
    sent.push(structuredClone(envelope));
    if (afterSend) afterSend();
    if (fail === 'refused') return { recorded: true, operation_id: envelope.operation_id, status: 'rejected', error: { code: 'FORBIDDEN' } };
    if (fail) return { recorded: false, operation_id: envelope.operation_id, status: 'unknown' };
    return { recorded: true, operation_id: envelope.operation_id, status: 'committed', result: envelope.kind === 'message.mark'
      ? { message_id: envelope.target.message_id, mark_revision: envelope.expected.mark_revision + 1, topic_id: 'fixture-topic' }
      : { topic_id: 'fixture-topic', from_seq: envelope.args.from_seq, seq: envelope.args.seq } };
  } };
  const marks = new Marks({ api, instanceId: 'fixture', authority: () => ({ authority_id: 'a', authority_epoch: 'e' }), doc, win: {}, id: () => 'mark-' + ++serial });
  if (marked) marks.learn(short ? root.id : newest.id, 1);
  const cardRead = each => readNow(each, { viewer: 'fixture-reader', opened: openedIds.has(each.id), marked: marks.state(each.id)?.marked });
  const registry = { disposed: false, runtime: { current: { authority_id: 'a', authority_epoch: 'e' } } };
  const writing = { body: 'Unsent exact\nwords', destination: 'elsewhere', images: ['kept'], guard: 'retained' }, beforeWriting = structuredClone(writing);
  const pending = waiting ? s.replies.splice(s.replies.findIndex(each => each.id === newest.id), 1) : [];
  const bindings = { releaseTopArrivals: () => { s.replies.push(...pending.splice(0)); }, newestNew: order.newestNew, cardRead, visitNew, topic: { id: 'fixture-topic' }, topicUnavailable: false, authorityReviewPending: () => false,
    registry, getEpoch: () => epoch, views: { messages }, stackState: () => ({ stacks: [s] }), $: id => id === 'messages' ? {} : { open: false, inert: false },
    entries: () => [...entries.values()], reveal: (entry, options) => reveals.push([entry.dataset.id, options]), opened: entry => entry,
    cardScroll: { showFull: async (card, message) => { shown.push([card.dataset.id, message.body]); if (wholeWait) await wholeWait; return true; } },
    revealSelection() {}, menu: { light: entry => lights.push(entry.dataset.id) }, document: doc, onScreen: () => true, marks, api, bootstrap: { instance_id: 'fixture' },
    crypto: { randomUUID: () => 'read-' + ++serial }, revisionOf: each => each.revision ?? 1,
    openedHere: id => { visitNew.clear(id); openedIds.add(id); }, stackMessages: () => { repaints++; afterRepaint?.(); },
    // This controller fixture observes the render request;1265 executes the
    // actual affected-dossier painter separately, with real stack owners.
    paintReadChanges: () => { repaints++; afterRepaint?.(); }, attention: { refresh() {} }, commitReload: null,
    run: fn => fn(), checkDossierNew: async () => { shown.push('check'); }, status() {}, writing };
  // Execute the real application block, with no module startup, server or fake Reader open.
  const begin = app.indexOf('const dossierNewFlights ='), end = app.indexOf('// A message a link on the page names');
  assert.ok(begin >= 0 && end > begin, 'application must wire an explicit header-New act');
  const predicate = app.slice(app.indexOf('const newOnPage ='), app.indexOf('let visitPaintQueued ='));
  const code = predicate + app.slice(begin, end).replaceAll('listAccessEpoch', 'getEpoch()');
  const actions = new Function(...Object.keys(bindings), code + '\nreturn { openDossierNew };')(...Object.values(bindings));
  return { ...actions, s, messages, marks, sent, shown, focuses, focusCalls, lights, reveals, writing, beforeWriting, openedIds, cardRead, visitNew, registry, doc,
    repaintCount: () => repaints, allow: () => { fail = false; }, leave: () => { epoch++; },
    waitWhole: () => { wholeWait = new Promise(resolve => { blockWhole = resolve; }); }, releaseWhole: () => blockWhole(), afterSend: fn => { afterSend = fn; },
    afterRepaint: fn => { afterRepaint = fn; }, entry: id => entries.get(id),
    replaceEntry: id => {
      const old = entries.get(id), replacement = makeEntry(id);
      old.isConnected = false;
      if (doc.activeElement === old) doc.activeElement = null;
      entries.set(id, replacement);
      return replacement;
    } };
}

test('781 app consumes three replies one by one via exact Core range, never opens Reader or changes writing', async () => {
  const f = appFixture();
  for (const id of [newest.id, middle.id, oldest.id]) {
    await f.openDossierNew(f.s, {});
    assert.equal(f.focuses.at(-1), id); assert.equal(f.openedIds.has(id), true);
  }
  assert.deepEqual(f.sent.map(e => [e.kind, e.target, e.args]), [40, 30, 20].map(seq => ['topic.read_through', { topic_id: 'fixture-topic' }, { from_seq: seq, seq }]));
  assert.deepEqual(f.shown.map(each => each[0]), [newest.id, middle.id, oldest.id]);
  assert.deepEqual(f.reveals.map(each => each[1]), Array(3).fill({ full: true, open: true }));
  assert.deepEqual(f.s.replies.map(each => each.id), [middle.id, newest.id, oldest.id]);
  assert.deepEqual(f.writing, f.beforeWriting);
  assert.equal(f.repaintCount(), 3);
});

test('781 app head New and stale path; ordinary reading preserves retained New', async () => {
  const f = appFixture({ headNew: true, short: true });
  assert.equal(f.cardRead(f.s.head), false);
  // Delivery acknowledgement elsewhere does not mutate the visit snapshot or opened set.
  assert.equal(f.openedIds.size, 0);
  await f.openDossierNew(f.s, {}); assert.deepEqual(f.focuses, [root.id]); assert.equal(f.cardRead(f.s.head), true);
  const before = f.sent.length; await f.openDossierNew(f.s, {});
  assert.equal(f.shown.at(-1), 'check'); assert.equal(f.sent.length, before, 'stale checks fabricate no read');
});

test('865 repeated selection calls keep one focus transition while lighting the exact head at all three stages', async () => {
  const f = appFixture({ headNew: true, short: true });
  f.waitWhole();
  const pending = f.openDossierNew(f.s, {});
  assert.deepEqual(f.focusCalls, [root.id], 'selection precedes waiting for whole words');
  assert.deepEqual(f.lights, [root.id]);
  assert.equal(f.doc.activeElement, f.entry(root.id));
  f.afterSend(() => {
    assert.deepEqual(f.focusCalls, [root.id, root.id], 'whole-word landing reselects before the Core read');
    assert.deepEqual(f.lights, [root.id, root.id]);
  });
  f.releaseWhole(); await pending;
  assert.deepEqual(f.focusCalls, [root.id, root.id, root.id], 'receipt repaint restores the explicit selection');
  assert.deepEqual(f.lights, [root.id, root.id, root.id]);
  assert.deepEqual(f.focuses, [root.id], 'three calls to one already-focused node move focus only once');
  assert.equal(f.doc.activeElement, f.entry(root.id));
  assert.deepEqual(f.sent.map(envelope => envelope.args), [{ from_seq: root.seq, seq: root.seq }]);
  assert.deepEqual(f.writing, f.beforeWriting);
});

test('865 receipt redraw selects its replacement node and preserves a later user focus', async () => {
  const replaced = appFixture({ headNew: true, short: true });
  const original = replaced.entry(root.id);
  replaced.afterRepaint(() => replaced.replaceEntry(root.id));
  await replaced.openDossierNew(replaced.s, {});
  assert.equal(original.isConnected, false);
  assert.notEqual(replaced.entry(root.id), original);
  assert.equal(replaced.doc.activeElement, replaced.entry(root.id));
  assert.deepEqual(replaced.focuses, [root.id, root.id], 'a replacement node receives actual focus after redraw');
  assert.deepEqual(replaced.lights, [root.id, root.id, root.id]);
  assert.deepEqual(replaced.writing, replaced.beforeWriting);

  const moved = appFixture({ headNew: true, short: true }), writing = { name: 'later writing focus' };
  moved.afterSend(() => { moved.doc.activeElement = writing; });
  await moved.openDossierNew(moved.s, {});
  assert.equal(moved.doc.activeElement === writing, true, 'the receipt does not reclaim later user focus');
  assert.deepEqual(moved.focusCalls, [root.id, root.id]);
  assert.deepEqual(moved.lights, [root.id, root.id]);
  assert.equal(moved.cardRead(moved.s.head), true, 'the confirmed read is retained');
  assert.deepEqual(moved.writing, moved.beforeWriting);
});

test('781 unknown settlement keeps New and exact retry, rapid presses consume sequential messages', async () => {
  const f = appFixture({ failure: true });
  await assert.rejects(f.openDossierNew(f.s, {}));
  assert.equal(f.openedIds.size, 0, 'a cosmetic decrement cannot replace Core settlement');
  f.allow(); await f.openDossierNew(f.s, {}); assert.deepEqual(f.sent[0], f.sent[1], 'retry preserves the exact operation');
  const slow = appFixture(); slow.waitWhole();
  const first = slow.openDossierNew(slow.s, {}); await Promise.resolve(); const second = slow.openDossierNew(slow.s, {});
  slow.releaseWhole(); await first; await second;
  assert.deepEqual(slow.sent.map(e => e.args.seq), [40, 30], 'each explicit press takes the next newest after the prior receipt');
});

test('781 a recorded refusal consumes nothing and a new explicit press makes a new operation', async () => {
  const f = appFixture({ failure: 'refused' });
  await assert.rejects(f.openDossierNew(f.s, {})); assert.equal(f.openedIds.size, 0);
  f.allow(); await f.openDossierNew(f.s, {});
  assert.notEqual(f.sent[0].operation_id, f.sent[1].operation_id);
  assert.equal(f.openedIds.has(newest.id), true);
});

test('781 departure or changed source during whole-text read consumes nothing', async () => {
  for (const change of [f => f.leave(), f => { f.messages.get(newest.id).revision = 2; }, f => { f.doc.activeElement = { writing: 'kept' }; }]) {
    const f = appFixture(); f.waitWhole(); const pending = f.openDossierNew(f.s, {}); await Promise.resolve(); change(f); f.releaseWhole(); await pending;
    assert.equal(f.sent.length, 0); assert.equal(f.openedIds.size, 0);
  }
});

test('781 explicit mark clear is captured before opening; a newer mark survives', async () => {
  const f = appFixture({ marked: true }); await f.openDossierNew(f.s, {});
  assert.deepEqual(f.sent.map(e => e.kind), ['topic.read_through', 'message.mark']);
  assert.equal(f.sent[1].expected.mark_revision, 1); assert.equal(f.marks.state(newest.id).marked, false);
  const newer = appFixture({ marked: true }); newer.waitWhole(); const pending = newer.openDossierNew(newer.s, {}); await Promise.resolve();
  newer.marks.learn(newest.id, 3); newer.releaseWhole(); await pending;
  assert.equal(newer.sent[1].expected.mark_revision, 1, 'never adopts a renewed mark');
  assert.equal(newer.cardRead(newer.messages.get(newest.id)), false, 'renewed mark still owns New');
});

test('781 stale check survives until actual animation endpoint; arriving New is redrawn', async () => {
  const doc = miniDocument(), list = doc.createElement('div'), state = stacks.stackState(list), section = doc.createElement('div'), card = doc.createElement('button'), s = stack();
  doc.getElementById = () => null;
  const unread = new Set([newest.id]); section.append(card); list.append(section); state.sections.set(root.id, section);
  const paint = () => paintHead(card, s, { state, open: true, starred: false, unread: each => unread.has(each.id), nameOf: id => id, doc });
  paint(); const mark = card.querySelector('.stack-fresh'); unread.clear();
  let finish, paints = 0, options;
  mark.animate = (frames, timing) => { options = { frames, timing }; return { finished: new Promise(resolve => { finish = resolve; }) }; };
  state.again = () => { paints++; paint(); };
  assert.equal(typeof stacks.checkDossierNew, 'function');
  const pending = stacks.checkDossierNew(list, { id: root.id }, mark);
  await Promise.resolve(); assert.equal(state.checking.has(root.id), true); assert.equal(paints, 1);
  assert.equal(mark.textContent, '✓'); assert.ok(options.timing.duration > 0 && options.timing.duration <= 400);
  unread.add(oldest.id); state.again();
  assert.equal(card.querySelector('.stack-new-action'), mark, 'an arrival repaint keeps the same animated node');
  finish(); await pending; assert.equal(state.checking.has(root.id), false); assert.equal(paints, 3, 'endpoint redraw uses current unread predicate');
  assert.equal(card.querySelector('.stack-fresh').textContent, ' · 1 new', 'new arrival survives the stale check');
});

test('781 actual phone capture listener permits first New tap, ordinary cards still light first', async () => {
  const menuSource = await readFile(new URL('../web/message-menu.mjs', import.meta.url), 'utf8');
  const begin = menuSource.indexOf("    host.addEventListener('click', event => {"), end = menuSource.indexOf('// A click or tap in a message or a dossier also');
  const doc = miniDocument(), entry = doc.createElement('button'), mark = doc.createElement('span'); mark.className = 'stack-new-action'; entry.dataset.id = 'tapped';
  const header = doc.createElement('span'); header.className = 'stack-head'; header.append(mark); entry.append(header);
  let listener, stopped = false, lights = 0; const acted = [];
  const menu = { acted: id => acted.push(id), touch: true, before: null, entryOf: () => entry, light: () => { lights++; } };
  new Function('host', 'onEarlierRow', 'cardIn', menuSource.slice(begin, end)).call(menu,
    { addEventListener: (kind, fn) => { listener = fn; } }, () => false, each => each);
  const event = target => ({ target, preventDefault() {}, stopPropagation() { stopped = true; } });
  listener(event(mark)); assert.equal(stopped, false, 'first native tap must reach the header action');
  assert.deepEqual(acted, [], 'New keeps its receipt-confirmed clearing path');
  listener(event(entry)); assert.equal(stopped, true, 'ordinary first tap still only selects'); assert.equal(lights, 1);
  assert.deepEqual(acted, ['tapped'], 'ordinary first tap clears its visit mark');
});

test('781 native landing instrument accepts rounding and refuses an offscreen message by 12px', async () => {
  const { assertLanding781 } = await import('./dossier_new_781_native.mjs');
  const state = { reader: false, active: 'chosen', lit: ['chosen'], top: -.7, left: -.5, right: 320.5, width: 321, height: 100, viewportWidth: 320, viewportHeight: 700 };
  assert.doesNotThrow(() => assertLanding781(state, 'chosen'));
  assert.throws(() => assertLanding781({ ...state, top: -12 }, 'chosen'), /viewportEdgePx/);
  assert.throws(() => assertLanding781({ ...state, active: 'other' }, 'chosen'), /same exact/);
  assert.throws(() => assertLanding781({ ...state, reader: true }, 'chosen'), /Reader/);
});

test('833 New selects an already-read live arrival and clears its visit mark only after a confirmed receipt', async () => {
  const f = appFixture({ failure: true });
  for (const message of f.messages.values()) message.unread = false;
  f.visitNew.arrive([f.messages.get(newest.id)]);
  await assert.rejects(f.openDossierNew(f.s, {}));
  assert.equal(f.visitNew.has(newest.id), true);
  const retry = structuredClone(f.sent[0]);
  f.allow(); await f.openDossierNew(f.s, {});
  assert.deepEqual(f.sent[1], retry, 'unknown result retries the same exact operation');
  assert.equal(f.focuses.at(-1), newest.id);
  assert.equal(f.visitNew.has(newest.id), false);
  assert.deepEqual(f.sent[1].args, { from_seq: newest.seq, seq: newest.seq });
});

// A waiting arrival is already recorded and connected, but absent from the
// visible stack until an explicit reading destination admits it.
test('785 dossier New admits waiting replies before choosing the newest message', async () => {
  const f = appFixture({ waiting: true });
  await f.openDossierNew(f.s, {});
  assert.equal(f.focuses.at(-1), newest.id);
  assert.equal(f.sent[0].args.seq, newest.seq);
  assert.deepEqual(f.writing, f.beforeWriting);
});
