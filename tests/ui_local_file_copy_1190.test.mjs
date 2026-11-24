import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWords, drawPassages, drawnText, sourcePosition } from '../web/message-format.mjs';
import { openLinksWith } from '../web/links.mjs';
import { CardScroll } from '../web/card-scroll.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';
import { deckBody } from '../web/deck.mjs';
import { document1178, bubble, painted1178, reportedLink, reportedTarget } from './fixtures/angle_links_1178.mjs';

const walk = node => [node, ...(node.childNodes ?? []).flatMap(walk)];
const references = node => walk(node).filter(n => n.classList?.contains('words-reference'));
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); promise.catch(() => {}); return { promise, resolve, reject }; };
function clipboard(doc = document1178(), write = () => Promise.resolve()) {
  const saved = [], timers = new Map(); let serial = 0;
  doc.defaultView = { navigator: { clipboard: { writeText(text) { saved.push(text); return write(text); } } },
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); } };
  return { doc, saved, timers, expire() { for (const { fn } of [...timers.values()]) fn(); } };
}
function rendered(port = clipboard(), body = reportedLink, reader = false) {
  const host = port.doc.createElement('div'); port.doc.body.append(host);
  if (reader) drawPassages(host, body, port.doc); else formatWords(host, body);
  return { ...port, host, reference: references(host)[0] };
}
const status = reference => reference.getAttribute('data-copy-status');

test('1190 a local click writes the entire path and line inside the gesture before its answer', async () => {
  const answer = deferred(), p = rendered(clipboard(undefined, () => answer.promise));
  const event = bubble(p.reference, 'click');
  assert.deepEqual(p.saved, [reportedTarget], 'the actual1178 node calls the clipboard before the click returns');
  assert.equal(event.stopped, true); assert.equal(event.defaultPrevented, false);
  assert.equal(status(p.reference), null, 'a pending write is not announced as copied');
  answer.resolve(); await flush(); assert.equal(status(p.reference), 'Copied');
  assert.equal(p.reference.title, reportedTarget); assert.equal(p.reference.textContent, 'Saved dose plan');
  assert.equal(p.reference.getAttribute('href'), null); assert.equal(p.reference.getAttribute('tabindex'), null);
});

test('1190 copy preserves complete spaces line suffixes file forms and decoded Markdown punctuation', async () => {
  for (const [written, copied] of [
    ['/a path/file.md:28', '/a path/file.md:28'], ['~/Notes/a (new) plan.md:9', '~/Notes/a (new) plan.md:9'],
    ['file:///Users/reader/a path/file.md:28', 'file:///Users/reader/a path/file.md:28'],
    [String.raw`/a\<b\>/a\)plan.md:2`, '/a<b>/a)plan.md:2'],
  ]) {
    const p = rendered(clipboard(), `[the **plan**](<${written}>)`); bubble(p.reference, 'click'); await flush();
    assert.deepEqual(p.saved, [copied]); assert.equal(p.reference.title, copied); assert.equal(status(p.reference), 'Copied');
    assert.equal(p.reference.textContent, 'the plan'); assert.equal(drawnText(p.host), `[the **plan**](<${written}>)`);
  }
});

test('1190 rejected clipboard answers show failure without a false copied result', async () => {
  const p = rendered(clipboard(undefined, () => Promise.reject(Error('refused'))));
  bubble(p.reference, 'click'); await flush();
  assert.deepEqual(p.saved, [reportedTarget]); assert.equal(status(p.reference), 'Could not copy');
  assert.equal(p.reference.title, reportedTarget); assert.equal(drawnText(p.host), reportedLink);
});

test('1190 unavailable and synchronously throwing clipboard APIs are handled as failures', async () => {
  for (const api of [null, { writeText() { throw Error('unavailable'); } }]) {
    const p = rendered(); p.doc.defaultView.navigator.clipboard = api;
    assert.doesNotThrow(() => bubble(p.reference, 'click')); await flush();
    assert.equal(status(p.reference), 'Could not copy'); assert.equal(p.reference.textContent, 'Saved dose plan');
  }
});

test('1190 feedback clears after one brief interval without changing the label or title', async () => {
  const p = rendered(); bubble(p.reference, 'click'); await flush();
  assert.equal(status(p.reference), 'Copied'); assert.deepEqual([...p.timers.values()].map(t => t.ms), [1500]);
  p.expire(); assert.equal(status(p.reference), null); assert.equal(p.reference.getAttribute('aria-description'), null);
  assert.equal(p.reference.title, reportedTarget); assert.equal(p.reference.textContent, 'Saved dose plan');
});

test('1190 a late answer from an earlier click cannot replace the latest failure', async () => {
  const first = deferred(), second = deferred(); let n = 0;
  const p = rendered(clipboard(undefined, () => (++n === 1 ? first : second).promise));
  bubble(p.reference, 'click'); bubble(p.reference, 'click'); second.reject(Error('refused')); await flush();
  assert.equal(status(p.reference), 'Could not copy'); first.resolve(); await flush();
  assert.equal(status(p.reference), 'Could not copy'); assert.deepEqual(p.saved, [reportedTarget, reportedTarget]);
});

test('1190 another click clears older feedback and owns a fresh interval', async () => {
  const next = deferred(); let n = 0;
  const p = rendered(clipboard(undefined, () => ++n === 1 ? Promise.resolve() : next.promise));
  bubble(p.reference, 'click'); await flush(); const old = [...p.timers.values()][0];
  assert.ok(old, 'a completed copy owns its feedback interval');
  bubble(p.reference, 'click'); assert.equal(status(p.reference), null); assert.equal(p.timers.size, 0);
  next.resolve(); await flush(); old.fn();
  assert.equal(status(p.reference), 'Copied'); assert.equal(p.timers.size, 1);
});

test('1190 text-selection gestures keep their default and copy nothing', async () => {
  const p = rendered(); let parent = 0; p.host.addEventListener('click', () => parent++);
  p.doc.getSelection = () => ({ isCollapsed: false });
  for (const kind of ['pointerdown', 'mousedown', 'click']) {
    const event = bubble(p.reference, kind); assert.equal(event.defaultPrevented, false); assert.equal(event.stopped, true);
  }
  await flush(); assert.deepEqual(p.saved, []); assert.equal(parent, 0); assert.equal(status(p.reference), null);
});

test('1190 modifier and non-primary clicks do not copy or reach the surrounding card', async () => {
  const p = rendered(); let parent = 0; p.host.addEventListener('click', () => parent++);
  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }]) {
    const event = bubble(p.reference, 'click', extra); assert.equal(event.defaultPrevented, false); assert.equal(event.stopped, true);
  }
  await flush(); assert.deepEqual(p.saved, []); assert.equal(parent, 0);
});

test('1190 an editable reference leaves writing alone', async () => {
  const p = rendered(); p.reference.isContentEditable = true; bubble(p.reference, 'click'); await flush();
  assert.deepEqual(p.saved, []); assert.equal(status(p.reference), null);
});

test('1190 detached references ignore answers that arrive after their owning paint is gone', async () => {
  const answer = deferred(), p = rendered(clipboard(undefined, () => answer.promise));
  bubble(p.reference, 'click'); p.reference.remove(); answer.resolve(); await flush();
  assert.equal(status(p.reference), null); assert.equal(p.timers.size, 0);
});

test('1190 actual CardScroll reference copies once without opening or folding its message', async () => {
  const p = clipboard(), card = p.doc.createElement('article'), preview = p.doc.createElement('div');
  preview.className = 'message-preview'; card.append(preview); p.doc.body.append(card);
  let folds = 0, opens = 0; card.addEventListener('click', () => folds++); openLinksWith(() => opens++);
  try {
    const scroll = new CardScroll({ read: async () => { throw Error('Unexpected read'); } });
    assert.equal(await scroll.showFull(card, { id: 'synthetic1190', body: reportedLink }), true);
    const reference = references(preview)[0]; bubble(reference, 'click'); await flush();
    assert.deepEqual(p.saved, [reportedTarget]); assert.equal(status(reference), 'Copied'); assert.equal(folds, 0); assert.equal(opens, 0);
    assert.equal(drawnText(preview), reportedLink); bubble(preview, 'click'); assert.equal(folds, 1);
  } finally { openLinksWith(null); }
});

test('1190 real Notebook Display opening and cards copy while keeping writing and passage source intact', async t => {
  const body = reportedLink + '\n\n## First\n\n' + reportedLink + '\n';
  const p = painted1178(t, body), port = clipboard(p.doc), acts = [];
  if (!p.opening.isConnected) p.doc.body.append(p.opening);
  p.editAt = () => acts.push('edit'); p.placeOf = () => 0; p.toggle = () => acts.push('toggle');
  p.extend = () => acts.push('extend'); p.pick = () => acts.push('pick');
  const source = { body, source_ref: { kind: 'memory', id: 'synthetic1190', revision: 1 } };
  p.source = source; p.writing = { base: { source }, value: { body }, closed: false, deleted: false };
  p.passages = { bind() {} }; NotebookPage.prototype.readingPassages.call(p);
  for (const reference of [references(p.opening)[0], references(p.list)[0]]) {
    bubble(reference, 'click'); await flush(); assert.equal(status(reference), 'Copied');
  }
  assert.deepEqual(port.saved, [reportedTarget, reportedTarget]); assert.deepEqual(acts, []);
  assert.equal(deckBody(p.deck), body); assert.equal(p.writing.value.body, body); assert.equal(source.body, body);
  const row = p.list.children[0], reference = references(row)[0], text = walk(reference).find(n => n.nodeType === 3);
  const written = drawnText(row); assert.equal(written.slice(sourcePosition(text, 0), sourcePosition(text, text.data.length, true)), reportedLink);
  bubble(p.list.querySelector('.deck-words'), 'click'); assert.deepEqual(acts, ['edit'], 'the parent edit owner remains active');
});

test('1190 Reader-formatted labels retain their exact atomic authored source after feedback', async () => {
  const body = 'Before [the **new** `plan`](</a path/plan.md:28>) after.', p = rendered(clipboard(), body, true);
  bubble(p.reference, 'click'); await flush(); assert.equal(status(p.reference), 'Copied'); assert.equal(drawnText(p.host), body);
  const start = body.indexOf('['), end = body.indexOf('>)') + 2;
  for (const node of walk(p.reference).filter(n => n.nodeType === 3)) {
    assert.equal(sourcePosition(node, 0), start); assert.equal(sourcePosition(node, node.data.length, true), end);
  }
});

test('1190 web links keep their ordinary href and opener without a clipboard call', async t => {
  const before = globalThis.location; globalThis.location = new URL('https://theseus.example/');
  const opened = []; openLinksWith((...args) => opened.push(args)); t.after(() => { globalThis.location = before; openLinksWith(null); });
  const p = rendered(clipboard(), '[outside](https://elsewhere.example/a) [inside](?topic=t-test)');
  const anchors = walk(p.host).filter(n => n.tagName === 'A'); assert.equal(anchors.length, 2); assert.equal(references(p.host).length, 0);
  assert.equal(anchors[0].href, 'https://elsewhere.example/a'); assert.equal(anchors[0].target, '_blank');
  bubble(anchors[0], 'click'); bubble(anchors[1], 'click'); await flush();
  assert.equal(opened.length, 1); assert.equal(opened[0][0].id, 't-test'); assert.deepEqual(p.saved, []);
});
