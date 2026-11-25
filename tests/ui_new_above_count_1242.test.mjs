import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const source = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function paintNewAbove() {');
const end = source.indexOf('function watchListAnchor()', start);
assert.ok(start >= 0 && end > start, 'actual New above painter boundaries');
const code = source.slice(start, end);
const observerStart = source.indexOf('const cardsSeen =');
const observerEnd = source.indexOf('function revokeMedia()', observerStart);
assert.ok(observerStart >= 0 && observerEnd > observerStart, 'actual visibility callback boundaries');
const observerCode = source.slice(observerStart, observerEnd);

function fixture() {
  const doc = miniDocument(), list = doc.createElement('div'), main = doc.createElement('main');
  list.root = true; list.style = {}; list.hidden = false; doc.visibilityState = 'visible';
  let columnReads = 0, geometryReads = 0, released = 0, remembered = 0, scrolls = 0, noteReads = 0;
  list.getBoundingClientRect = () => { columnReads++; return { left: 40 }; };
  const records = new Map(), entries = new Map(), flags = { authority: false, geometry: false, unavailable: false };
  const writing = { text: 'Exact draft', selection: [2, 5] }; doc.activeElement = writing;
  const ports = { document: doc, innerHeight: 800, retired: false, topicUnavailable: false,
    authorityReviewPending: () => flags.authority, topic: { id: 'topic' }, bootstrap: { actor: 'viewer' },
    views: { messages: records }, messageEntries: entries, anchorHold: null,
    button: (text, activate) => { const control = doc.createElement('button'); control.textContent = text; control.style = {}; control.activate = activate; return control; },
    releaseTopArrivals: () => { released++; }, reveal() {}, opened: entry => entry,
    rememberListAnchor: () => { remembered++; }, noteRead: () => { noteReads++; },
    $: id => ({ messages: list, main })[id], entries: () => list.children,
    stackState: () => ({ waiting: new Set() }), drawn: (_, id) => entries.get(id)?.drawn !== false };
  const api = new Function(...Object.keys(ports), 'const newAbove = new Set(); let newAboveButton = null;\n' + code + observerCode +
    '\nreturn { paintNewAbove, cardsSeen, offers: newAbove, pill: () => newAboveButton, unavailable: value => { topicUnavailable = value; }, retire: () => { retired = true; } };')(...Object.values(ports));
  const add = (id, extra = {}) => {
    const entry = doc.createElement('article'); entry.dataset.id = id; entry.dataset.seq = String(records.size + 1); entry.drawn = true; entry.top = -100;
    entry.contains = node => node === entry;
    entry.getBoundingClientRect = () => { geometryReads++; if (!flags.geometry) throw Error('PASSIVE_CARD_GEOMETRY'); return { top: entry.top, bottom: entry.top + 80 }; };
    entry.scrollIntoView = () => { scrolls++; entry.top = 0; };
    list.append(entry); entries.set(id, entry); records.set(id, { id, topic_id: 'topic', author_id: 'outside', ...extra });
    api.offers.add(id); return entry;
  };
  return { api, doc, list, main, records, entries, flags, writing, add,
    counts: () => ({ columnReads, geometryReads, released, remembered, scrolls, noteReads }) };
}

test('1242 passive count paints never measure any offered card or move writing', () => {
  const f = fixture(); for (let i = 0; i < 250; i++) f.add('arrival-' + i);
  for (let i = 0; i < 32; i++) f.api.paintNewAbove();
  assert.equal(f.counts().geometryReads, 0);
  assert.equal(f.api.pill().textContent, 'New above · 250 ↑');
  assert.equal(f.main.children.length, 1, 'one persistent control');
  assert.equal(f.doc.activeElement, f.writing); assert.equal(f.writing.text, 'Exact draft');
  assert.deepEqual(f.writing.selection, [2, 5]); assert.equal(f.counts().scrolls, 0);
});

test('1242 count reconciles record/entry/topic truth while retaining connected arrival offers', () => {
  const f = fixture(); f.flags.geometry = true;
  const visible = f.add('visible'); visible.top = 50;
  f.add('wrong-topic', { topic_id: 'elsewhere' }); f.add('own', { author_id: 'viewer' });
  f.add('gone').remove(); f.add('no-record'); f.records.delete('no-record');
  f.add('no-entry'); f.entries.delete('no-entry');
  f.api.paintNewAbove();
  assert.deepEqual([...f.api.offers], ['visible']);
  assert.equal(f.api.pill().textContent, 'New above · 1 ↑');
  assert.equal(f.counts().geometryReads, 0, 'count is arrival offers, not a viewport estimate');
});

test('1242 activation reveals/scrolls/focuses the current arrival and retires only that identity', () => {
  const f = fixture(); f.flags.geometry = true;
  const first = f.add('first'); f.add('second'); f.api.paintNewAbove(); f.api.pill().activate();
  assert.equal(f.doc.activeElement, first);
  assert.deepEqual([...f.api.offers], ['second']);
  assert.equal(f.counts().scrolls, 1); assert.equal(f.counts().released, 1);
  assert.equal(f.counts().remembered, 1);
});

test('1242 failed focus, stale source and out-of-view activation retain the offered identity', () => {
  for (const fault of ['focus', 'source', 'landing']) {
    const f = fixture(); f.flags.geometry = true;
    const entry = f.add('arrival'); f.api.paintNewAbove();
    if (fault === 'focus') entry.focus = () => {};
    if (fault === 'source') entry.focus = () => { f.records.set('arrival', { ...f.records.get('arrival') }); };
    if (fault === 'landing') entry.scrollIntoView = () => { entry.top = -10; };
    f.api.pill().activate();
    assert.equal(f.api.offers.has('arrival'), true, fault);
  }
});

test('1242 unavailable, authority, retired and hidden pages cannot activate an old offer', () => {
  for (const fault of ['unavailable', 'authority', 'retired', 'hidden']) {
    const f = fixture(); f.flags.geometry = true; f.add('arrival'); f.api.paintNewAbove();
    if (fault === 'unavailable') f.api.unavailable(true);
    if (fault === 'authority') f.flags.authority = true;
    if (fault === 'retired') f.api.retire();
    if (fault === 'hidden') f.list.hidden = true;
    f.api.pill().activate();
    assert.equal(f.counts().scrolls, 0, fault); assert.equal(f.doc.activeElement, f.writing);
    assert.equal(f.api.offers.has('arrival'), true, 'unconfirmed access does not invent a read');
  }
});

test('1242 changing count updates one accessible control and hides it at zero', () => {
  const f = fixture(); f.add('a'); f.api.paintNewAbove(); const control = f.api.pill();
  assert.equal(control.getAttribute('aria-label'), 'Read 1 new message above');
  f.add('b'); f.api.paintNewAbove(); assert.equal(f.api.pill(), control);
  assert.equal(control.getAttribute('aria-label'), 'Read 2 new messages above');
  f.api.offers.clear(); f.api.paintNewAbove(); assert.equal(control.hidden, true);
});


test('1242 actual half-shown observer clears manually read arrivals and hides zero without measuring cards', () => {
  const f = fixture(), arrivals = Array.from({ length: 5 }, (_, i) => f.add('manual-' + i));
  f.api.paintNewAbove(); const before = f.counts().columnReads, shown = new Set();
  const observe = f.api.cardsSeen(shown, entry => entry.isIntersecting && entry.intersectionRatio >= 0.5);
  observe([{ target: arrivals[0], isIntersecting: true, intersectionRatio: 0.49 }]);
  assert.equal(f.api.offers.size, 5); assert.equal(f.counts().columnReads, before, 'unchanged count repaints nothing');
  observe(arrivals.map(target => ({ target, isIntersecting: true, intersectionRatio: 0.5 })));
  assert.equal(shown.size, 5, 'original visibility owner still learns all five');
  assert.equal(f.api.offers.size, 0); assert.equal(f.api.pill().hidden, true);
  assert.equal(f.counts().columnReads, before + 1, 'one repaint for a changed batch');
  assert.equal(f.counts().geometryReads, 0); assert.equal(f.counts().noteReads, 2);
});

test('1242 stale, hidden and unavailable observer events retain current offers', () => {
  for (const fault of ['old-entry', 'topic', 'hidden-document', 'unavailable', 'authority', 'retired', 'disconnected']) {
    const f = fixture(), current = f.add('current'); f.api.paintNewAbove(); let target = current;
    if (fault === 'old-entry') { target = f.doc.createElement('article'); target.dataset.id = 'current'; target.dataset.seq = current.dataset.seq; target.root = true; }
    if (fault === 'topic') f.records.set('current', { ...f.records.get('current'), topic_id: 'elsewhere' });
    if (fault === 'hidden-document') f.doc.visibilityState = 'hidden';
    if (fault === 'unavailable') f.api.unavailable(true);
    if (fault === 'authority') f.flags.authority = true;
    if (fault === 'retired') f.api.retire();
    if (fault === 'disconnected') current.remove();
    f.api.cardsSeen(new Set(), e => e.isIntersecting && e.intersectionRatio >= 0.5)([{ target, isIntersecting: true, intersectionRatio: 0.5 }]);
    assert.equal(f.api.offers.has('current'), true, fault); assert.equal(f.counts().geometryReads, 0);
  }
});
