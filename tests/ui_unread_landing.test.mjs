// Review 613: execute the real application landing functions below the browser.
// Native cases separately prove gestures, painting, focus and on-screen reading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Marks } from '../web/marks.mjs';
import { TopicRail, paintMarks } from '../web/topic-navigation.mjs';
import { ThingsRail } from '../web/things-rail.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { seenRanges } from '../web/card-reading.mjs';

const app = await readFile(new URL('../web/app.mjs', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('async function loadToUnread()'), app.indexOf('// Where the oldest unread message is, read again'));
const reading = app.slice(app.indexOf('function noteRead()'), app.indexOf('// A card counts as on screen'));
function fixture({ renewed = false } = {}) {
  let revision = 1, current = true, visible = true, serial = 0, transient = false;
  const doc = { visibilityState: 'visible', hasFocus: () => true, addEventListener() {} };
  const sent = [], focus = [], reveals = [], readReports = [];
  const marks = new Marks({ instanceId: 'fixture', authority: () => ({ authority_id: 'a', authority_epoch: 'e' }), doc, win: {}, id: () => 'op-' + ++serial,
    api: { command: async envelope => {
      sent.push(envelope);
      if (envelope.expected.mark_revision !== revision) return { operation_id: envelope.operation_id, recorded: true, status: 'rejected', error: { code: 'REVISION_CONFLICT', current_versions: { mark_revision: revision } } };
      revision++;
      return { operation_id: envelope.operation_id, recorded: true, status: 'committed', result: { message_id: 'old', topic_id: 'beds', seq: 1, mark_revision: revision } };
    } } });
  marks.learn('old', 1, { topicId: 'beds', seq: 1 });
  const card = { isConnected: true, focus: () => { focus.push('old'); doc.activeElement = card; } };
  const entry = { dataset: { id: 'old', seq: '1' } }, later = { dataset: { id: 'later', seq: '2' } };
  const bindings = { shell: { drawer: { isOpen: () => false } }, views: { line: { id: 'old' }, oldestUnread: { id: 'old' },
    messages: new Map([['old', { id: 'old', seq: 1, stack_position: { root_id: 'root' } }], ['later', { id: 'later', seq: 2 }]]), runOf: () => 'run', sighted() {} },
    loadUntil: async wanted => { transient = true; actions.noteRead(); if (wanted()?.id === 'root' && renewed) { revision = 3; marks.learn('old', 3); } return entry; },
    entries: () => [entry, later], $: () => ({}), reveal: (e, options) => { transient = false; reveals.push(options); return e; }, opened: () => card,
    topic: { id: 'beds' }, topicUnavailable: false, authorityReviewPending: () => false, review: { open: false }, laidOut: true,
    readThrough: { seen: (topic, from, through) => { readReports.push([from, through]); return Promise.resolve(null); } },
    halfShown: new Set([1, 2]), atMiddle: new Set(), seenRanges, bootstrap: { actor: 'fixture-person' },
    revealSelection() {}, marks, registry: { get disposed() { return !current; } }, document: doc,
    onScreen: node => visible && (node === card || node === (transient ? later : entry)) };
  const actions = new Function(...Object.keys(bindings), reading + source + '\nreturn { landOnUnread, loadToUnread, noteRead };')(...Object.values(bindings));
  return { ...actions, marks, sent, focus, reveals, readReports, doc, revision: () => revision, leave: () => { current = false; }, hide: () => { doc.visibilityState = 'hidden'; }, show: () => { doc.visibilityState = 'visible'; marks.resume(); }, offscreen: () => { visible = false; } };
}

for (const action of ['landOnUnread', 'loadToUnread']) test(`B1/B2 ${action} reveals the whole message and clears its captured mark`, async () => {
  const f = fixture(); await f[action]();
  assert.equal(f.revision(), 2, 'B1: the displayed explicit unread mark must stop counting');
  assert.deepEqual(f.sent.map(e => [e.target.message_id, e.args.marked, e.expected.mark_revision]), [['old', false, 1]]);
  assert.deepEqual(f.reveals, [{ full: true, open: true }], 'B2: reveal the message, never just its collapsed row');
  assert.deepEqual(f.focus, ['old']);
});
test('B1 a renewed mark during landing survives the captured reading act', async () => {
  const f = fixture({ renewed: true }); await f.landOnUnread();
  assert.equal(f.revision(), 3);
  assert.deepEqual(f.sent.map(e => e.expected.mark_revision), [1], 'the reading act cannot adopt a mark renewed while pages load');
});
test('B1 loading toward a mark reads only the landing, never a transient newer delivery', async () => {
  for (const action of ['landOnUnread', 'loadToUnread']) {
    const f = fixture(); await f[action]();
    assert.deepEqual(f.readReports, [[1, 1]], 'pagination must not consume the next unread message on the way to the mark');
  }
});
test('B1 a background landing waits until shown and a departed landing clears nothing', async () => {
  const f = fixture(); f.hide(); await f.landOnUnread(); assert.equal(f.sent.length, 0);
  f.show(); await Promise.resolve(); assert.equal(f.revision(), 2);
  const left = fixture(); left.hide(); await left.landOnUnread(); left.leave(); left.show(); assert.equal(left.sent.length, 0);
  const away = fixture(); away.hide(); await away.landOnUnread(); away.offscreen(); away.show(); assert.equal(away.sent.length, 0);
});
test('B2 Return on an unread topic row reaches the unread landing in both rails', t => {
  const had = globalThis.document, doc = miniDocument(); globalThis.document = doc; t.after(() => { globalThis.document = had; });
  const item = { id: 'beds', title: 'Spring beds', unread: 2 }, opened = [];
  const rail = { links: new Map(), pages: {}, reader: 'fixture', title: () => item.title, question: () => 'question', open: (...args) => opened.push(args) };
  const outline = TopicRail.prototype.row.call(rail, item);
  outline.onclick({ button: 0, detail: 0, target: outline, preventDefault() {} });
  assert.equal(opened[0]?.[3], 'unread', 'B2: Return on the topic row must reach what its unread count promises');
  const right = { doc, wide: { matches: true }, handles: { open: target => opened.push(target) } };
  const build = ThingsRail.prototype.placeLink.call(right, { kind: 'topic', id: item.id, message: 'question' }, item.title);
  paintMarks(build, item, 'fixture');
  build.onclick({ button: 0, detail: 0, target: build, preventDefault() {} });
  assert.deepEqual(opened[1], { kind: 'topic', id: 'beds', at: 'unread' }, 'Build rows share the same keyboard act');
});
