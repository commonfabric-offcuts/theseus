import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookPage } from '../web/notebook-page.mjs';
import { NotebookPassages, notebookSourceParts } from '../web/notebook-passages.mjs';
import { NotebookWriting } from '../web/notebook-writing.mjs';
import { NotebookEditHistory } from '../web/notebook-edit-history.mjs';
import { WritingInput } from '../web/writing-input.mjs';
import { cardText, deckBody, imageLine, parseDeck } from '../web/deck.mjs';

// Real page/key/history/writing/projection owners, with field, journal, server
// and final quote-opening ports. These are semantic checks, not native input,
// browser focus or Core receipts. The later native producer proves those.
class Input extends Event {
  constructor(type, options = {}) {
    super(type, { cancelable: true, ...options });
    Object.assign(this, { inputType: options.inputType, isComposing: false });
  }
}
class Field extends EventTarget {
  constructor(value) {
    super(); this.value = value; this.readOnly = false; this.isConnected = true;
    this.ownerDocument = { defaultView: { InputEvent: Input } };
    this.setSelectionRange(value.length, value.length);
  }
  closest() { return null; }
  setSelectionRange(start, end, direction = 'none') {
    this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
  }
  replaceSelection(text) {
    if (!this.dispatchEvent(new Input('beforeinput', { inputType: 'insertLineBreak' }))) return;
    const start = this.selectionStart;
    this.value = this.value.slice(0, start) + text + this.value.slice(this.selectionEnd);
    this.setSelectionRange(start + text.length, start + text.length);
    this.dispatchEvent(new Input('input', { inputType: 'insertLineBreak' }));
  }
}
const state = field => [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection];
const body = '## Source\n\nbefore kept after\n\n## Neighbor\n\nUntouched.\n';
function fixture(t, { text = body, value, selected = 'kept', save = 'committed', index = 0, gate, fresh = false } = {}) {
  const source = { instance_id: 'isolated-1076', source_ref: { kind: 'memory', id: 'page-1076', revision: 1 },
    owner_scope: { kind: 'topic', id: 'topic-1076' }, title: 'Selection', body: text,
    attachments: [], references: [], draft: false, reader_may_write: true };
  const bootstrap = { instance_id: source.instance_id, actor: 'isolated-writer',
    authority: { authority_id: 'isolated-authority', authority_epoch: 'isolated-epoch' } };
  const requests = [], notices = [], quotes = [], content = { title: source.title, body: text,
    attachments: [], references: [], draft: false };
  const writer = new NotebookWriting({ item: source.source_ref.id, bootstrap,
    store: { put: async () => {}, delete: async () => {} },
    api: { command: async request => {
      requests.push(structuredClone(request));
      if (gate) { gate.entered(); await gate.released; }
      if (save === 'unconfirmed') return null;
      if (save === 'refused') return { instance_id: bootstrap.instance_id, operation_id: request.operation_id,
        kind: request.kind, status: 'rejected', recorded: true,
        error: { code: 'FORBIDDEN', message: 'This page can no longer be changed.' } };
      return { instance_id: bootstrap.instance_id, operation_id: request.operation_id, kind: request.kind,
        status: 'committed', recorded: true, result: { item_id: source.source_ref.id,
          revision: request.expected.item_revision + 1,
          source_ref: { ...source.source_ref, revision: request.expected.item_revision + 1 } } };
    } } });
  writer.base = { revision: 1, source, content: structuredClone(content) };
  writer.value = structuredClone(content); writer.pageState = source;
  const page = Object.assign(Object.create(NotebookPage.prototype), {
    item: source.source_ref.id, mode: 'cards', host: { hidden: false }, source, writing: writer,
    base: { revision: 1, body: text }, deck: parseDeck(text), picked: index,
    readOnly: false, acts: [], undos: [], selected: new Set(), folded: new Set(),
    doc: { body: {} }, list: { contains: () => true }, header: { description: {} },
    say: words => notices.push(words), paint() {}, show() {}, keepNamed() {},
    holdPage: () => () => {} });
  const card = page.deck.cards[index], written = page.written(card), shown = cardText({ title: card.title, words: written.words });
  const field = new Field(value ?? shown); page.doc.activeElement = field;
  const start = field.value.indexOf(selected); assert.ok(start >= 0, 'fixture selection exists');
  field.setSelectionRange(start, start + selected.length, 'forward');
  page.editing = { text: fresh ? '' : cardText(card), shown: fresh ? field.value : shown,
    field, near: index, depth: card.depth, after: fresh ? cardText(card) : undefined,
    images: fresh ? [] : written.images, stacks: fresh ? [] : written.stacks,
    details: fresh ? [] : written.details, fresh,
    kept: fresh ? '' : written.images.join('\n'), input: new WritingInput({ field, mac: true }) };
  page.editing.history = new NotebookEditHistory({ field, mac: true });
  page.cardsSeen = writer.capture();
  field.addEventListener('input', () => page.save());
  page.passages = Object.assign(Object.create(NotebookPassages.prototype), {
    clear() {}, selection: { clear() {} }, quote: async (choice, opener) => quotes.push({ choice, opener }) });
  t.after(() => { writer.close(); page.editing?.history.close(); });
  return { page, writer, field, source, requests, notices, quotes };
}
async function press(f, extra = {}) {
  const event = { key: 'Enter', target: f.field, preventDefault() { this.defaultPrevented = true; }, ...extra };
  const result = f.page.key(event);
  // Apply the textarea's default replacement as a semantic port when the real
  // page handler leaves Return alone. No synthetic event is called native.
  if (!event.defaultPrevented) f.field.replaceSelection('\n');
  await result; await f.writer.serial;
  return event;
}

test('1076 selected Return quotes exact confirmed source and leaves card/editor/history intact', async t => {
  const f = fixture(t), before = state(f.field), deck = deckBody(f.page.deck), editing = f.page.editing;
  const event = await press(f);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(state(f.field), before); assert.equal(f.page.editing, editing);
  assert.equal(deckBody(f.page.deck), deck); assert.deepEqual(f.page.undos, []);
  assert.equal(editing.history.entries.length, 0); assert.equal(f.quotes.length, 1);
  const { choice, opener } = f.quotes[0];
  assert.equal(choice.text, 'kept'); assert.deepEqual(choice.source, f.source.source_ref);
  assert.equal(f.source.body.slice(choice.start, choice.end), 'kept');
  assert.equal(opener, f.field); assert.equal(f.requests.length, 0, 'unchanged card creates no save');
});
test('1076 no selection keeps Return newline and uses ordinary editor history', async t => {
  const f = fixture(t); f.field.setSelectionRange(13, 13);
  const before = f.field.value; const event = await press(f);
  assert.equal(Boolean(event.defaultPrevented), false);
  assert.equal(f.field.value, before.slice(0, 13) + '\n' + before.slice(13));
  assert.equal(f.quotes.length, 0); assert.equal(f.page.editing.history.entries.length, 1);
});
test('1076 whitespace-only selection keeps ordinary Return replacement/newline', async t => {
  const f = fixture(t, { value: 'Source\nbefore   after', selected: '   ' }), before = f.field.value;
  const start = f.field.selectionStart, end = f.field.selectionEnd, event = await press(f);
  assert.equal(Boolean(event.defaultPrevented), false);
  assert.equal(f.field.value, before.slice(0, start) + '\n' + before.slice(end));
  assert.equal(f.quotes.length, 0);
});
test('1076 selection across title/body and a hidden image keeps exact confirmed parts within its card', async t => {
  const text = '## Source\n\nAbove.\n\n' + imageLine('Picture', 'isolated-image') + '\n\nBelow.\n\n## Neighbor\n';
  const selected = 'Source\nAbove.\n\n\nBelow.';
  const f = fixture(t, { text, selected }), before = state(f.field);
  await press(f); assert.deepEqual(state(f.field), before); assert.equal(f.quotes.length, 1);
  assert.equal(f.requests.length, 0, 'quoting unchanged hidden-image writing sends no memory revise');
  assert.equal(f.writer.base.revision, 1); assert.equal(f.writer.base.source.body, text);
  const c = f.quotes[0].choice; assert.equal(c.text, selected);
  assert.equal(c.parts.join(''), c.text); assert.ok(c.parts.length > 1);
  assert.ok(c.parts.every(part => f.writer.base.source.body.includes(part))); assert.equal(c.start, -1);
});
test('1076 unchanged hidden-image editor preview and save preserve the raw body', async t => {
  const text = '## Source\n\nbefore kept after\n\n' + imageLine('Picture', 'isolated-image') + '\n\nAfter picture.\n\n## Neighbor\n\nUntouched.\n';
  const f = fixture(t, { text }), before = state(f.field);
  assert.equal(f.page.boxChanged(f.page.editing), false);
  assert.equal(f.page.previewBody(), text, 'an unchanged editor does not rewrite its hidden image position');
  f.page.save(); await f.page.saveCardChange();
  assert.equal(f.requests.length, 0); assert.equal(f.writer.dirty, false);
  assert.equal(f.writer.base.revision, 1); assert.equal(f.writer.base.source.body, text);
  assert.deepEqual(state(f.field), before);
});
test('1076 unchanged duplicate hidden-image card quotes its own original occurrence', async t => {
  const card = '## Source\n\nbefore kept after\n\n' + imageLine('Picture', 'isolated-image') + '\n\nBelow.\n';
  const text = card + '\n' + card;
  const f = fixture(t, { text, selected: 'Below.', index: 1 }), before = state(f.field);
  await press(f); assert.deepEqual(state(f.field), before);
  assert.equal(f.requests.length, 0); assert.equal(f.writer.base.revision, 1);
  assert.equal(f.writer.base.source.body, text); assert.equal(f.quotes.length, 1);
  const c = f.quotes[0].choice;
  assert.equal(c.start, text.lastIndexOf('Below.')); assert.equal(c.end, c.start + 'Below.'.length);
  assert.deepEqual(c.source, f.source.source_ref);
});
test('1076 dirty hidden-image writing still flushes and quotes the confirmed revision', async t => {
  const text = '## Source\n\nbefore kept after\n\n' + imageLine('Picture', 'isolated-image') + '\n\nAfter picture.\n\n## Neighbor\n\nUntouched.\n';
  const f = fixture(t, { text }), edited = f.field.value + ' edited';
  f.field.value = edited; const before = state(f.field);
  await press(f); assert.deepEqual(state(f.field), before);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].kind, 'memory.revise');
  assert.equal(f.requests[0].expected.item_revision, 1); assert.equal(f.writer.base.revision, 2);
  assert.equal(f.writer.base.source.body, f.requests[0].args.body);
  assert.ok(f.writer.base.source.body.includes('After picture. edited'));
  assert.ok(f.writer.base.source.body.includes(imageLine('Picture', 'isolated-image')));
  assert.equal(f.writer.dirty, false); assert.equal(f.writer.pending, null);
  assert.equal(f.quotes.length, 1); const c = f.quotes[0].choice;
  assert.deepEqual(c.source, { ...f.source.source_ref, revision: 2 });
  assert.equal(f.writer.base.source.body.slice(c.start, c.end), 'kept');
});
for (const save of ['refused', 'unconfirmed']) test(`1076 ${save} save retains exact editor selection and opens no quote`, async t => {
  const f = fixture(t, { value: 'Source\nbefore kept after, edited', save }), before = state(f.field);
  await press(f); assert.deepEqual(state(f.field), before);
  assert.equal(f.quotes.length, 0); assert.equal(f.writer.base.revision, 1);
  assert.equal(f.requests.length, 1); assert.ok(f.notices.some(line => typeof line === 'string' && line.length));
});
test('1076 a selected trailing fragment removed by save normalization is refused without changing its field', async t => {
  const f = fixture(t, { value: 'Source\nbefore kept after  ', selected: 'after  ' }), before = state(f.field);
  await press(f); assert.deepEqual(state(f.field), before); assert.equal(f.quotes.length, 0);
  assert.ok(f.notices.some(line => typeof line === 'string' && line.length));
});

test('1076 dirty selected writing uses the newly committed revision without finishing the editor', async t => {
  const f = fixture(t, { value: 'Source\nbefore kept after, edited' }), before = state(f.field);
  const editing = f.page.editing; await press(f);
  assert.deepEqual(state(f.field), before); assert.equal(f.page.editing, editing);
  assert.equal(f.requests.length, 1); assert.equal(f.writer.base.revision, 2);
  assert.equal(f.quotes.length, 1); assert.equal(f.quotes[0].choice.source.revision, 2);
  assert.equal(f.writer.base.source.body.slice(f.quotes[0].choice.start, f.quotes[0].choice.end), 'kept');
  assert.equal(editing.history.entries.length, 0); assert.deepEqual(f.page.undos, []);
});
test('1076 selected title uses its exact saved heading words without changing the card', async t => {
  const f = fixture(t, { selected: 'Source' }), before = state(f.field);
  await press(f); assert.deepEqual(state(f.field), before); assert.equal(f.quotes.length, 1);
  const choice = f.quotes[0].choice;
  assert.equal(choice.text, 'Source'); assert.equal(choice.start, f.source.body.indexOf('Source'));
  assert.equal(f.source.body.slice(choice.start, choice.end), choice.text);
  assert.equal(f.requests.length, 0); assert.deepEqual(f.page.undos, []);
});
test('1076 exact title-to-body selection joins the editor newline from saved source parts', async t => {
  const selected = 'Source\nbefore', f = fixture(t, { selected }), before = state(f.field);
  await press(f); assert.deepEqual(state(f.field), before); assert.equal(f.quotes.length, 1);
  const choice = f.quotes[0].choice;
  assert.equal(choice.text, selected); assert.equal(choice.parts.join(''), selected);
  assert.ok(choice.parts.length > 1); assert.equal(choice.start, -1);
  assert.ok(choice.parts.every(part => f.source.body.includes(part)));
});
test('1076 a fresh card quotes its newly confirmed occurrence and keeps its existing editor open', async t => {
  const f = fixture(t, { fresh: true, value: 'New note\nbefore kept after' });
  const editing = f.page.editing, before = state(f.field), originalDeck = deckBody(f.page.deck);
  await press(f);
  assert.deepEqual(state(f.field), before); assert.equal(f.page.editing, editing); assert.equal(editing.fresh, true);
  assert.equal(deckBody(f.page.deck), originalDeck); assert.deepEqual(f.page.undos, []);
  assert.equal(editing.history.entries.length, 0); assert.equal(f.requests.length, 1);
  assert.equal(f.writer.base.revision, 2); assert.equal(f.quotes.length, 1);
  const saved = f.writer.base.source, choice = f.quotes[0].choice;
  assert.deepEqual(parseDeck(saved.body).cards.map(card => card.title), ['Source', 'New note', 'Neighbor']);
  assert.equal(choice.source.revision, 2); assert.equal(choice.text, 'kept');
  assert.equal(choice.start, saved.body.indexOf('kept', saved.body.indexOf('## New note')));
  assert.equal(saved.body.slice(choice.start, choice.end), choice.text);
});
for (const [label, value] of [
  ['title spaces', '  Source \nbefore kept after'],
  ['leading blank lines', '\n\nSource\nbefore kept after'],
  ['trailing spaces', 'Source\nbefore kept after  '],
]) test('1076 normalization outside the selected range (' + label + ') preserves exact selected attribution', async t => {
  const f = fixture(t, { value }), before = state(f.field);
  await press(f); assert.deepEqual(state(f.field), before); assert.equal(f.quotes.length, 1);
  const choice = f.quotes[0].choice;
  assert.equal(choice.text, 'kept'); assert.equal(choice.source.revision, f.writer.base.revision);
  assert.equal(f.writer.base.source.body.slice(choice.start, choice.end), 'kept');
  assert.equal(f.page.editing.history.entries.length, 0); assert.deepEqual(f.page.undos, []);
});
test('1076 duplicate card text uses the edited card bounds, never the earlier identical phrase', async t => {
  const text = '## Source\n\nbefore kept after\n\n## Source\n\nbefore kept after\n';
  const f = fixture(t, { text, index: 1 }); await press(f);
  assert.equal(f.quotes.length, 1);
  assert.equal(f.quotes[0].choice.start, text.lastIndexOf('kept'));
});
test('1076 exact Unicode and backward selection are preserved', async t => {
  const selected = '🧭 cafe\u0301 漢字', f = fixture(t, { text: `## Source\n\n${selected} after\n`, selected });
  f.field.setSelectionRange(f.field.selectionStart, f.field.selectionEnd, 'backward');
  const before = state(f.field); await press(f);
  assert.deepEqual(state(f.field), before); assert.equal(f.quotes.length, 1);
  assert.equal(f.quotes[0].choice.text, selected);
});
test('1076 existing projection can join over an omitted image without copying its markup', async t => {
  const text = '## Source\n\nAbove.\n\n' + imageLine('Picture', 'isolated-image') + '\n\nBelow.\n';
  const f = fixture(t, { text, selected: 'Above.\n\n\nBelow.' });
  const start = f.field.selectionStart, end = f.field.selectionEnd;
  const opened = await f.page.passages.openEditor(f.field, { source: f.source, text: f.field.value,
    excerpt: { start, end, text: f.field.value.slice(start, end) }, bounds: { start: 0, end: text.length } });
  assert.equal(opened, true); const c = f.quotes[0].choice;
  assert.equal(c.parts.join(''), c.text); assert.ok(c.parts.length > 1);
  assert.ok(c.parts.every(part => text.includes(part))); assert.ok(c.parts.every(part => !part.includes('attachment:')));
});
test('1076 blank lines across an omitted image map to actual source newlines', () => {
  const text = '## Source\n\nAbove.\n\n' + imageLine('Picture', 'isolated-image') + '\n\nBelow.\n';
  const shown = 'Source\nAbove.\n\n\nBelow.', start = shown.indexOf('Above.'), selected = shown.slice(start);
  const parts = notebookSourceParts(text, shown, { start, end: shown.length, text: selected });
  assert.equal(parts.join(''), selected); assert.ok(parts.length > 1);
  assert.ok(parts.every(part => text.includes(part))); assert.ok(parts.every(part => !part.includes('attachment:')));
});
function deferredSave() {
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  return { ready, released, entered, release };
}
test('1076 repeated pending Return joins one save and one quote', async t => {
  const gate = deferredSave(), f = fixture(t, { value: 'Source\nbefore kept after, edited', gate });
  const first = press(f); await Promise.race([gate.ready, first.then(() => assert.fail('selected Return must enter the existing save before it finishes'))]);
  const second = press(f); gate.release(); await Promise.all([first, second]);
  assert.equal(f.requests.length, 1); assert.equal(f.quotes.length, 1);
});
for (const change of ['selection', 'direction', 'typing', 'focus', 'editor', 'writer', 'page', 'mode', 'hidden', 'detached']) {
  test(`1076 pending save cannot open a stale quote after ${change} changes`, async t => {
    const gate = deferredSave(), f = fixture(t, { value: 'Source\nbefore kept after, edited', gate });
    const pending = press(f); await Promise.race([gate.ready, pending.then(() => assert.fail('selected Return must enter the existing save before it finishes'))]);
    if (change === 'selection') f.field.setSelectionRange(0, 6);
    if (change === 'direction') f.field.setSelectionRange(f.field.selectionStart, f.field.selectionEnd, 'backward');
    if (change === 'writer') f.page.writing = { ...f.writer };
    if (change === 'page') f.page.item = 'different-page';
    if (change === 'hidden') f.page.host.hidden = true;
    if (change === 'typing') { f.field.value += '!'; f.field.setSelectionRange(f.field.value.length, f.field.value.length); }
    if (change === 'focus') f.page.doc.activeElement = {};
    if (change === 'editor') f.page.editing = { ...f.page.editing, field: new Field('other writing') };
    if (change === 'mode') f.page.mode = 'text';
    if (change === 'detached') f.page.detached = true;
    const newer = state(f.field); gate.release(); await pending;
    assert.deepEqual(state(f.field), newer); assert.equal(f.quotes.length, 0);
    if (['selection', 'typing'].includes(change)) assert.ok(f.notices.some(line => line.includes('changed')));
  });
}
for (const flag of ['readOnly', 'reading', 'conflict', 'journalError', 'closed', 'deleted', 'actionPending', 'actionRunning']) {
  test(`1076 ${flag} cannot attribute dirty editor writing to an older saved revision`, async t => {
    const f = fixture(t, { value: 'Source\nbefore kept after, edited' });
    f.writer[flag] = flag === 'journalError' ? 'isolated journal refusal' : true;
    const before = state(f.field); await press(f);
    assert.deepEqual(state(f.field), before); assert.equal(f.quotes.length, 0);
    assert.equal(f.requests.length, 0); assert.equal(f.writer.base.revision, 1);
    assert.ok(f.notices.length);
  });
}
test('1076 a readable confirmed source can still quote when page writing is read-only', async t => {
  const f = fixture(t); f.writer.readOnly = f.page.readOnly = f.field.readOnly = true;
  const before = state(f.field); await press(f);
  assert.deepEqual(state(f.field), before); assert.equal(f.quotes.length, 1); assert.equal(f.requests.length, 0);
});
for (const extra of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }]) {
  test(`1076 quote handler leaves existing key owner with ${JSON.stringify(extra)}`, t => {
    const f = fixture(t), before = state(f.field);
    const event = { key: 'Enter', target: f.field, preventDefault() { this.defaultPrevented = true; }, ...extra };
    f.page.key(event); assert.equal(f.quotes.length, 0); assert.equal(f.requests.length, 0);
    assert.deepEqual(state(f.field), before);
    assert.equal(Boolean(event.defaultPrevented), Boolean(extra.defaultPrevented));
  });
}

for (const [value, selected] of [
  ['  Source\nbefore kept after', '  Source'],
  ['Source\nbefore kept after  ', 'after  '],
  ['Source\n\nbefore kept after', 'Source\n\nbefore'],
]) test('1076 selected bytes lost by normalization cannot rebind: ' + JSON.stringify(selected), async t => {
  const f = fixture(t, { value, selected }), before = state(f.field);
  await press(f); assert.deepEqual(state(f.field), before); assert.equal(f.quotes.length, 0);
  assert.equal(f.notices.length, 1); assert.match(f.notices[0], /exact selection/);
});
test('1076 source revision mismatch refuses even when its selected text is unchanged', async t => {
  const f = fixture(t), before = state(f.field); f.writer.base.source.source_ref.revision = 2;
  await press(f); assert.deepEqual(state(f.field), before); assert.equal(f.quotes.length, 0);
  assert.equal(f.requests.length, 0); assert.equal(f.notices.length, 1);
});
test('1076 a newer selected Return supersedes only the older pending quote, retaining the save stream', async t => {
  const gate = deferredSave(), f = fixture(t, { value: 'Source\nbefore kept after, edited', gate });
  const first = press(f); await Promise.race([gate.ready, first.then(() => assert.fail('selected Return must enter the existing save before it finishes'))]);
  f.field.value += ' newer'; const at = f.field.value.indexOf('newer'); f.field.setSelectionRange(at, at + 5);
  const latest = state(f.field), second = press(f); gate.release(); await Promise.all([first, second]);
  assert.deepEqual(state(f.field), latest); assert.equal(f.quotes.length, 1);
  assert.equal(f.quotes[0].choice.text, 'newer'); assert.equal(f.quotes[0].choice.source.revision, 3);
  assert.deepEqual(f.requests.map(r => r.expected.item_revision), [1, 2]);
  assert.notEqual(f.requests[0].operation_id, f.requests[1].operation_id);
});

// Actual1075 writeNext/act/finish/save/updateSelectionUndo/history with the
// same explicit field/mount port as its existing semantic split tests.
function splitFixture(t, options, selected = 'kept') {
  const f = fixture(t, options), p = f.page; p.keepFolds = () => {};
  p.open = editing => {
    const field = new Field(editing.shown ?? editing.text), at = editing.at ?? field.value.length;
    field.setSelectionRange(at, at); p.doc.activeElement = field;
    p.editing = { ...editing, field, input: new WritingInput({ field, mac: true }),
      history: new NotebookEditHistory({ field, mac: true }) };
    field.addEventListener('input', () => p.save());
  };
  const event = { key: 'Enter', metaKey: true, target: f.field, preventDefault() { this.defaultPrevented = true; } };
  p.key(event); assert.equal(event.defaultPrevented, true); assert.equal(p.editing.fresh, true);
  assert.equal(p.editing.field.value, selected); f.field = p.editing.field;
  return f;
}
const undoKey = field => ({ key: 'z', metaKey: true, target: field, preventDefault() { this.defaultPrevented = true; } });
const proseImageProse = '## Source\n\nFirst prose.\n\n' + imageLine('Picture', 'isolated-image') +
  '\n\nSecond prose.\n\n## Neighbor\n\nUntouched.\n';
test('1076 prose/image/prose: Command-Return splits the second prose without loss or a changed-card refusal', async t => {
  const f = splitFixture(t, { text: proseImageProse, selected: 'Second prose.' }, 'Second prose.'), p = f.page;
  const split = p.editing.selectionSplit;
  assert.deepEqual(f.notices, [], 'the equality guard accepts the same raw preview body');
  assert.equal(split.before, proseImageProse, 'the inverse retains the exact image-between-prose source');
  assert.equal(p.previewBody(), '## Source\n\nFirst prose.\n\n' + imageLine('Picture', 'isolated-image') +
    '\n\n## Second prose.\n\n## Neighbor\n\nUntouched.\n');
  f.field.setSelectionRange(0, f.field.value.length, 'backward'); await press(f);
  assert.equal(f.quotes.length, 1); assert.equal(f.quotes[0].choice.text, 'Second prose.');
  assert.equal(f.writer.base.source.body.slice(f.quotes[0].choice.start, f.quotes[0].choice.end), 'Second prose.');
  assert.equal(p.undos.length, 1); p.key(undoKey(f.field)); await f.writer.serial;
  assert.equal(p.editing, null); assert.equal(f.writer.value.body, proseImageProse);
});
test('1076 prose/image/prose: Return quotes the second prose from the unchanged raw card', async t => {
  const f = fixture(t, { text: proseImageProse, selected: 'Second prose.' }), before = state(f.field);
  await press(f);
  assert.deepEqual(f.notices, []); assert.deepEqual(state(f.field), before);
  assert.equal(f.requests.length, 0); assert.equal(f.writer.base.source.body, proseImageProse);
  assert.equal(f.writer.base.revision, 1); assert.equal(f.quotes.length, 1);
  const c = f.quotes[0].choice;
  assert.deepEqual(c.source, f.source.source_ref); assert.equal(c.text, 'Second prose.');
  assert.equal(c.start, proseImageProse.indexOf('Second prose.')); assert.equal(c.end, c.start + c.text.length);
});
test('1076 Return after1075 fresh split quotes its confirmed range and preserves the one split inverse', async t => {
  const f = splitFixture(t), p = f.page, editing = p.editing, inverse = p.undos[0];
  assert.equal(p.undos.length, 1); f.field.setSelectionRange(0, 4, 'backward'); const before = state(f.field);
  await press(f); assert.deepEqual(state(f.field), before); assert.equal(p.editing, editing);
  assert.equal(p.undos.length, 1); assert.equal(p.undos[0], inverse); assert.equal(editing.history.position, 0);
  assert.equal(f.quotes.length, 1); assert.equal(f.quotes[0].choice.source.revision, 2);
  assert.equal(f.writer.base.source.body.slice(f.quotes[0].choice.start, f.quotes[0].choice.end), 'kept');
  assert.equal(inverse.from, f.writer.base.source.body.slice(editing.selectionSplit.prefix.length,
    f.writer.base.source.body.length - editing.selectionSplit.suffix.length));
  p.key(undoKey(f.field)); await f.writer.serial;
  assert.equal(p.editing, null); assert.equal(f.writer.value.body, body); assert.equal(p.undos.length, 0);
  assert.equal(f.writer.base.source.source_ref.revision, 2, 'confirmed quote source stays immutable while Undo becomes new writing');
});
test('1076 ordinary Return after1075 fresh split stays local history and refreshes its saved inverse', async t => {
  const f = splitFixture(t), p = f.page, editing = p.editing;
  f.field.setSelectionRange(2, 2); await press(f);
  assert.equal(f.field.value, 'ke\npt'); assert.equal(editing.history.position, 1); assert.equal(f.quotes.length, 0);
  assert.match(editing.selectionSplit.undo.from, /## ke\n\npt/);
  p.key(undoKey(f.field)); await f.writer.serial;
  assert.equal(p.editing, editing); assert.equal(f.field.value, 'kept'); assert.equal(editing.history.position, 0);
  assert.doesNotMatch(editing.selectionSplit.undo.from, /## ke\n\npt/);
  p.key(undoKey(f.field)); await f.writer.serial;
  assert.equal(p.editing, null); assert.equal(f.writer.value.body, body); assert.equal(p.undos.length, 0);
});
