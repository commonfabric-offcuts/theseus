// Actual component/Reader model controls; no native gesture/range claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { Reader } from '../web/reader.mjs';
import { drawnRevision, drawnText, formatWords } from '../web/message-format.mjs';
import { paintReleaseCard, deferReleaseCard, releaseCardObservation, releaseReadingProtected } from '../web/release-card.mjs';

const id = 'm-' + '1'.repeat(32), other = 'm-' + '2'.repeat(32), commit = 'a'.repeat(40);
const time = '2026-11-25T21:00:00.000Z', ms = Date.parse(time);
function item(revision = 1, state = 'going_out', message = id) {
  return { id: message, source_ref: { kind: 'message', id: message }, revision,
    body: `# Release 463\n\nUpdate ${revision}. Exact source words remain readable.`,
    release_card: { format: 'release-card-v1', message_id: message, workspace_id: 'isolated1248',
      writer: 'writer1248', revision, recorded_ms: ms, original_forecasts: { push_at: null, live_at: time },
      payload: { release: 463, commit, attempt_id: 'attempt1248', state, title: 'A release card',
        forecasts: { push_at: null, live_at: time } },
      ...(['live', 'measured'].includes(state) ? { deployed_at: time, deployed_ms: ms } : {}) } };
}
function fixture() {
  const doc = miniDocument(), create = doc.createElement;
  doc.createElement = tag => {
    const node = create(tag);
    Object.defineProperties(node, { ownerDocument: { get: () => doc }, parentElement: { get: () => node.parent }, parentNode: { get: () => node.parent } });
    node.contains = child => { for (let at = child; at; at = at.parent) if (at === node) return true; return false; };
    return node;
  };
  doc.getSelection = () => doc.selection ?? { isCollapsed: true };
  const host = doc.createElement('div'); host.root = true;
  const words = doc.createElement('span'); words.className = 'message-preview'; host.append(words);
  const paint = next => { formatWords(words, next.body, { doc, revision: next.revision }); paintReleaseCard(host, next); };
  return { doc, host, words, paint };
}
const event = () => ({ preventDefault() {}, stopPropagation() {} });

test('1248 generated Markdown stays source-mapped beside one retained typed status', () => {
  const f = fixture(), first = item(); f.paint(first);
  const status = f.host.querySelector('.release-card-state'), label = status.children[0];
  assert.equal(label.textContent, 'Release 463 · Going out');
  assert.equal(drawnText(f.words), first.body); assert.equal(drawnRevision(f.words), 1);
  f.paint(item(2, 'live')); assert.equal(f.host.querySelector('.release-card-state'), status);
  assert.equal(status.children[0], label); assert.equal(label.textContent, `Release 463 · Live at ${time}`);
});
for (const state of ['going_out', 'live', 'measured', 'failed', 'unknown']) test('1248 current state has its verified plain label: ' + state, () => {
  const f = fixture(); f.paint(item(1, state));
  assert.ok(f.host.querySelector('.release-card-state'));
  const text = f.host.querySelector('.release-card-state').text;
  if (state === 'failed' || state === 'unknown' || state === 'going_out') assert.equal(text.includes('Live at'), false);
});
test('1248 malformed Live time, identity, revision and unsupported format cannot promote the display', () => {
  const f = fixture(); f.paint(item()); const status = f.host.querySelector('.release-card-state');
  for (const change of [x => delete x.release_card.deployed_ms, x => x.release_card.deployed_ms++,
    x => x.release_card.message_id = other, x => x.release_card.revision++, x => x.release_card.format = 'future']) {
    const next = item(2, 'live'); change(next); assert.equal(releaseCardObservation(next), null);
    assert.equal(deferReleaseCard(f.host, next, () => assert.fail('unverified update applied')), true);
    assert.equal(f.host.querySelector('.release-card-state'), status); assert.equal(status.children[0].textContent, 'Release 463 · Going out');
  }
});
test('1248 selected source words retain nodes and quote revision until explicit Show update', () => {
  const f = fixture(); f.paint(item()); const oldNode = f.words.children[0];
  f.doc.selection = { isCollapsed: false, anchorNode: oldNode, focusNode: oldNode };
  const selection = f.doc.selection, next = item(2, 'live');
  assert.equal(releaseReadingProtected(f.host), true);
  assert.equal(deferReleaseCard(f.host, next, () => f.paint(next)), true);
  assert.equal(f.words.children[0], oldNode); assert.equal(drawnRevision(f.words), 1); assert.equal(f.doc.selection, selection);
  const button = f.host.querySelector('button'); button.listeners.click(event());
  assert.equal(drawnText(f.words), next.body); assert.equal(drawnRevision(f.words), 2);
  assert.equal(f.host.querySelector('button'), button); assert.equal(button.hidden, true); assert.equal(f.doc.activeElement, f.host);
});
test('1248 focus and later writing survive a deferred release update', () => {
  const f = fixture(); f.paint(item()); const field = f.doc.createElement('textarea'); field.value = 'Exact later writing'; f.host.append(field); field.focus();
  const next = item(2, 'live'); assert.equal(deferReleaseCard(f.host, next, () => f.paint(next)), true);
  assert.equal(field.value, 'Exact later writing'); assert.equal(f.doc.activeElement, field); assert.equal(field.isConnected, true);
});
test('1248 unprotected update is delegated to the existing source painter and leaves other cards untouched', () => {
  const f = fixture(), unrelated = f.doc.createElement('div'); unrelated.textContent = 'Other reading'; f.host.append(unrelated); f.paint(item());
  const next = item(2, 'live'); assert.equal(deferReleaseCard(f.host, next, () => assert.fail('automatic painting has its existing caller')), false);
  f.paint(next); assert.equal(drawnRevision(f.words), 2); assert.equal(unrelated.parent, f.host); assert.equal(unrelated.textContent, 'Other reading');
});
test('1248 only the newest queued revision is offered and an older arrival cannot regress it', () => {
  const f = fixture(); f.paint(item()); f.host.focus();
  const seen = [];
  assert.equal(deferReleaseCard(f.host, item(3, 'measured'), () => { seen.push(3); f.paint(item(3, 'measured')); }), true);
  assert.equal(deferReleaseCard(f.host, item(2, 'live'), () => seen.push(2)), true);
  assert.equal(f.host.querySelector('button').textContent, 'Show release update 3');
  f.host.querySelector('button').listeners.click(event()); assert.deepEqual(seen, [3]);
  paintReleaseCard(f.host, item(1)); assert.ok(f.host.querySelector('.release-card-state').text.includes('Measured'));
});
test('1248 retired or navigated source never applies a queued callback', () => {
  const f = fixture(); f.paint(item()); f.host.focus(); let applied = false;
  deferReleaseCard(f.host, item(2, 'live'), () => { applied = true; }, { current: () => false });
  f.host.querySelector('button').listeners.click(event()); assert.equal(applied, false); assert.equal(drawnRevision(f.words), 1);
});
test('1248 repeated same revision creates no update offer; absent typed data keeps ordinary fallback', () => {
  const f = fixture(); f.paint(item()); f.host.focus();
  assert.equal(deferReleaseCard(f.host, item(), () => assert.fail('unchanged')), false);
  assert.equal(f.host.querySelector('button').hidden, true);
  const plain = { id, revision: 1, body: 'Ordinary message' }; f.paint(plain);
  assert.equal(f.host.querySelector('.release-card-state'), null); assert.equal(drawnText(f.words), plain.body);
});
for (const activation of ['pointer click', 'touch tap', 'Enter', 'Space']) test('1248 modeled ' + activation + ' applies the offered revision once', () => {
  const f = fixture(); f.paint(item()); f.host.focus(); let calls = 0;
  const next = item(2, 'live'); deferReleaseCard(f.host, next, () => { calls++; f.paint(next); });
  const button = f.host.querySelector('button'); button.listeners.click(event()); button.listeners.click(event()); assert.equal(calls, 1);
});
test('1248 update control keeps native Tab/key ownership; hover/wheel/swipe have no new handler', () => {
  const f = fixture(); f.paint(item()); const button = f.host.querySelector('button');
  assert.equal(button.tagName, 'BUTTON'); let stopped = 0;
  for (const key of ['Enter', ' ']) button.listeners.keydown({ key, stopPropagation() { stopped++; } });
  assert.equal(stopped, 2);
  for (const type of ['mouseover', 'wheel', 'swipe', 'focus', 'blur']) assert.equal(button.listeners[type], undefined);
});
test('1248 actual Reader draws its typed current state outside mapped words and retains reply writing', () => {
  const f = fixture(), parent = f.doc.createElement('div'); parent.root = true; parent.append(f.host);
  const previous = globalThis.document; globalThis.document = f.doc;
  try {
    const first = item(1, 'live'), field = f.doc.createElement('textarea'); field.value = 'Unsent reply';
    const reader = Object.assign(Object.create(Reader.prototype), { source: first, sourceBody: f.host, callbacks: {}, narrow: { matches: false }, field });
    reader.drawSource(first.body);
    assert.equal(drawnText(f.host), first.body); assert.ok(parent.querySelector('.release-card-state').text.includes('Live at'));
    assert.equal(field.value, 'Unsent reply'); assert.equal(parent.querySelector('.release-card-state').parent, parent);
    reader.source = { source_ref: { kind: 'message', id: other }, body: 'Another source' }; reader.drawSource('Another source');
    assert.equal(parent.querySelector('.release-card-state'), null); assert.equal(field.value, 'Unsent reply');
  } finally { globalThis.document = previous; }
});
test('1248 actual app wires initial cards and named revision updates without a history or writer call', () => {
  const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
  assert.match(app, /paintReleaseCard\(card, item\)/);
  assert.match(app, /deferReleaseCard\(reader\.sourceBody, latest, apply/);
  assert.match(app, /deferReleaseCard\(card, item, \(\) => repaintEdited\(\[id\], edits, true\)/);
  assert.doesNotMatch(readFileSync(new URL('../web/release-card.mjs', import.meta.url), 'utf8'), /api\.(command|view)|release_card_history|setInterval/);
});
test('1248 actual unavailable-source lifecycle retires queued controls and fences the captured app apply', () => {
  const f = fixture(), parent = f.doc.createElement('div'); parent.root = true; parent.append(f.host);
  const previous = globalThis.document; globalThis.document = f.doc;
  try {
    const first = item(), next = item(2, 'live'), field = f.doc.createElement('textarea'); field.value = 'Private reply kept';
    const pending = { operation_id: 'original1248', body: 'Exact pending writing' };
    const p = { source: first, sourceUnavailable: false, availabilityUnconfirmed: false, pending };
    const reader = Object.assign(Object.create(Reader.prototype), { source: first, sourceBody: f.host, callbacks: {}, narrow: { matches: false },
      field, presentation: p, dialog: { open: true }, $: f.doc.byId, expandReply() {}, disarm() {}, paintTone() {}, paintStatus() {} });
    reader.drawSource(first.body); let redraws = 0; reader.redrawSource = () => { redraws++; reader.drawSource(p.source.body); };
    const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
    const fragment = app.slice(app.indexOf('  const apply = () => {', app.indexOf('async function messageEdited(')), app.indexOf('  if (deferReleaseCard(reader.sourceBody', app.indexOf('async function messageEdited(')));
    const apply = runInNewContext(fragment + '\napply', { p, latest: next, reader, current: () => true,
      registry: { isSourceCurrent: () => true }, revisionOf: value => value.revision });
    assert.equal(deferReleaseCard(f.host, next, apply, { protect: () => true, current: () => !p.sourceUnavailable && !p.availabilityUnconfirmed }), true);
    const oldButton = parent.querySelector('button'); assert.equal(oldButton.hidden, false);
    p.sourceUnavailable = true; first.body = ''; reader.hideUnavailableSource();
    assert.equal(parent.querySelector('.release-card-state'), null, 'unavailable source retires sibling status and action');
    oldButton.listeners.click(event()); apply();
    assert.equal(redraws, 0); assert.equal(first.body, ''); assert.equal(f.host.children.length, 0);
    assert.equal(field.value, 'Private reply kept'); assert.equal(p.pending, pending); assert.equal(pending.operation_id, 'original1248');
  } finally { globalThis.document = previous; }
});

test('1248 actual App apply refuses an unconfirmed read even while the Reader identity remains current', () => {
  const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
  const begin = app.indexOf('  const apply = () => {', app.indexOf('async function messageEdited('));
  const end = app.indexOf('  if (deferReleaseCard(reader.sourceBody', begin);
  const first = item(), next = item(2, 'live'), p = { source: first, sourceUnavailable: false, availabilityUnconfirmed: true };
  let redraws = 0; const reader = { source: first, dialog: { open: true }, redrawSource() { redraws++; } };
  const apply = runInNewContext(app.slice(begin, end) + '\napply', { p, latest: next, reader, current: () => true,
    registry: { isSourceCurrent: () => true }, revisionOf: value => value.revision });
  apply(); assert.equal(redraws, 0); assert.equal(first.revision, 1); assert.equal(first.body, item().body);
});

test('1248 actual App messageEdited retains open Reader words until its offered update is chosen', async () => {
  const f = fixture(), parent = f.doc.createElement('div'); parent.root = true; parent.append(f.host);
  const previous = globalThis.document; globalThis.document = f.doc;
  try {
    const first = item(), next = item(2, 'live'), p = { source: first, sourceUnavailable: false, availabilityUnconfirmed: false };
    const field = f.doc.createElement('textarea'); field.value = 'Later private writing';
    const reader = Object.assign(Object.create(Reader.prototype), { source: first, sourceBody: f.host, callbacks: {}, narrow: { matches: false }, dialog: { open: true }, field });
    reader.drawSource(first.body); reader.redrawSource = () => reader.drawSource(first.body);
    const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
    const start = app.indexOf('async function messageEdited('), end = app.indexOf('// Each card whose marks', start);
    const edited = runInNewContext(app.slice(start, end) + '\nmessageEdited', {
      refreshDossierHeads() {}, shell: { messageEdited() {} }, views: { refresh: async () => true, messages: new Map([[id, next]]) },
      attention: null, registry: { current: p, isSourceCurrent: value => value === p }, reader, messageEdit: null,
      revisionOf: value => value.revision, deferReleaseCard });
    await edited('edit:' + id, 2, async () => next, () => true);
    assert.equal(first.revision, 1, 'open Reader retains the displayed source revision'); assert.equal(drawnText(f.host), item().body);
    const button = parent.querySelector('button'); assert.equal(button.hidden, false); button.listeners.click(event());
    assert.equal(first.revision, 2); assert.equal(drawnText(f.host), next.body); assert.equal(field.value, 'Later private writing');
  } finally { globalThis.document = previous; }
});
