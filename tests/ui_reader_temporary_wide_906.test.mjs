import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';
import { ReaderLayout } from '../web/layout.mjs';
import { Editor } from '../web/editor.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

function fixture(t, { phone = false, saved = 'stacked' } = {}) {
  const previous = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle };
  const document = miniDocument(), data = new Map(), writes = [];
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); writes.push([key, value]); } };
  const layout = new ReaderLayout('i906', storage); layout.setMode(saved); writes.length = 0;
  globalThis.document = document;
  globalThis.window = { localStorage: storage, scrollX: 0, scrollY: 0, scrollTo() {}, getSelection: () => ({ removeAllRanges() {} }) };
  globalThis.getComputedStyle = () => ({ lineHeight: '20px', paddingTop: '8px', paddingBottom: '8px' });
  t.after(() => Object.assign(globalThis, previous));
  const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, document.createElement('div')); return nodes.get(id); };
  document.getElementById = $;
  const field = document.createElement('textarea');
  Object.assign(field, { scrollHeight: 56, scrollTop: 0, style: { height: '40px', whiteSpace: 'nowrap' }, focus() {}, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } });
  const dialog = { open: false, dataset: {}, showModal() { this.open = true; }, show() { this.open = true; }, close() { this.open = false; } };
  const r = Object.assign(Object.create(Reader.prototype), {
    $, dialog, field, layout, layoutInstance: 'i906', narrow: { matches: phone }, positions: new Map(), viewToken: 0, card: null,
    sourceBody: { scrollTop: 0, focus() {} }, input: { readOnly: () => false },
    callbacks: { admits: () => true, writes: () => true }, compose: { writes() {}, fold() {}, fit() {} },
    notice() {}, disarm() {}, paintTitle() {}, paintOrigin() {}, drawSource() {}, drawAttachments() {}, paintPending() {},
    drawEditor() { field.value = this.sessions.reply.draft.body; },
    applyLayout() { dialog.dataset.layout = this.layoutShape; },
    insertText(words) { field.value += words; this.sessions.reply.edit({ body: field.value }); },
    placeReply(card) { this.card = card; }, keepAbove() {},
  });
  const open = (id = 'm1', body = '', quotes = [], card = null) => {
    const source_ref = { kind: 'message', id };
    const editor = new Editor({ instanceId: 'i906', actor: 'fixture-person', kind: 'reply', sourceRef: source_ref, topicId: 't1' }, { body, quotes });
    r.show({ source_ref, topic_id: 't1', body: 'Source words', attachments: [] }, { reply: editor }, { presentation: { replyCard: card } });
    return editor;
  };
  return { r, open, field, writes, data, storage, saved: () => new ReaderLayout('i906', storage).mode };
}

test('906 a quote widens only the current Reader; repaint retains it and close/reopen restores the saved layout', t => {
  const f = fixture(t); f.open(); f.r.quoteInto('Source words', null);
  assert.equal(f.r.layoutShape, 'wide'); assert.equal(f.saved(), 'stacked'); assert.equal(f.writes.length, 0);
  assert.equal(f.field.value, '> Source words\n\n');
  assert.equal(f.r.layoutChoice, 'Stacked layout');
  f.r.show(f.r.source, f.r.sessions, { presentation: f.r.presentation });
  assert.equal(f.r.layoutShape, 'wide', 'same-source repaint retains temporary width');
  f.r.finishClose(); f.open(); assert.equal(f.r.layoutShape, 'stacked');
  f.r.quoteInto('Source words', null); f.open('m2'); assert.equal(f.r.layoutShape, 'stacked', 'next source drops temporary width');
  assert.equal(f.saved(), 'stacked'); assert.equal(f.writes.length, 0);
});

test('906 the explicit toggle acts on the temporary visible layout and saves only the chosen preference', t => {
  const f = fixture(t); f.open(); f.r.quoteInto('Source words', null);
  f.r.toggleLayout(); assert.equal(f.r.layoutShape, 'stacked'); assert.equal(f.saved(), 'stacked'); assert.equal(f.r.layoutChoice, 'Wide layout');
  f.r.toggleLayout(); assert.equal(f.r.layoutShape, 'wide'); assert.equal(f.saved(), 'wide');
  assert.equal(f.writes.length, 2); f.r.finishClose(); f.open('m2'); assert.equal(f.r.layoutShape, 'wide');
});

for (const saved of ['stacked', 'wide']) test(`906 opening ordinary saved writing uses the kept ${saved} choice`, t => {
  const f = fixture(t, { saved }); f.open('m1', 'One\nTwo\nThree\nFour\nFive');
  assert.equal(f.r.layoutShape, saved); assert.equal(f.saved(), saved); assert.equal(f.writes.length, 0);
});

for (const [kind, height, quotes, expected] of [['short', 96, [], 'stacked'], ['wrapped', 116, [], 'wide'], ['quoted', 56, [{ source: { kind: 'message', id: 'm1' }, excerpt: 'Source words' }], 'wide']]) {
  test(`906 expanding an inline ${kind} reply uses the temporary layout`, t => {
    const f = fixture(t), card = { dataset: { id: 'm1' }, isConnected: true, getClientRects: () => [{}] };
    const editor = f.open('m1', 'Retained writing', quotes, card); f.field.scrollHeight = height;
    f.r.expandReply();
    assert.equal(f.r.layoutShape, expected); assert.equal(f.saved(), 'stacked'); assert.equal(f.writes.length, 0);
    assert.equal(f.r.sessions.reply, editor); assert.equal(editor.draft.body, 'Retained writing');
    assert.equal(f.field.style.height, '40px'); assert.equal(f.field.style.whiteSpace, 'nowrap');
    f.r.finishClose(); f.open('m2'); assert.equal(f.r.layoutShape, 'stacked');
  });
}

test('906 a phone keeps stacked for a quote and for an expanded long inline reply', t => {
  const f = fixture(t, { phone: true, saved: 'wide' }); f.open(); f.r.quoteInto('Source words', null);
  assert.equal(f.r.layoutShape, 'stacked'); assert.equal(f.saved(), 'wide'); assert.equal(f.writes.length, 0);
  const card = { dataset: { id: 'm1' }, isConnected: true, getClientRects: () => [{}] };
  f.open('m1', 'Kept writing', [], card); f.field.scrollHeight = 200; f.r.expandReply();
  assert.equal(f.r.layoutShape, 'stacked'); assert.equal(f.saved(), 'wide'); assert.equal(f.writes.length, 0);
});

test('906 showing the same inline source in the modal Reader retains its quote as temporary Wide', t => {
  const f = fixture(t), card = { dataset: { id: 'm1' }, isConnected: true, getClientRects: () => [{}] };
  f.open('m1', '> Source words\n\n', [{ source: { kind: 'message', id: 'm1' }, excerpt: 'Source words' }], card);
  const editor = f.r.sessions.reply;
  f.r.show(f.r.source, f.r.sessions, { presentation: { replyCard: null } });
  assert.equal(f.r.card, null); assert.equal(f.r.layoutShape, 'wide'); assert.equal(f.saved(), 'stacked');
  assert.equal(f.r.sessions.reply, editor); assert.equal(f.writes.length, 0);
});
