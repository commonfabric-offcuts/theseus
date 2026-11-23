import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookPage } from '../web/notebook-page.mjs';
import { cardText, deckBody, parseDeck } from '../web/deck.mjs';
import { WritingInput } from '../web/writing-input.mjs';
import { NotebookEditHistory } from '../web/notebook-edit-history.mjs';
import { selectionCardSplit } from '../web/notebook-card-split.mjs';
import { applyAct } from '../web/deck.mjs';
import { rebaseCardActs } from '../web/notebook-writing.mjs';
import { cardDetails, detailsLine } from '../web/card-details.mjs';

class Field extends EventTarget {
  constructor(value) {
    super(); this.value = value; this.setSelectionRange(value.length, value.length);
    this.ownerDocument = { defaultView: { InputEvent: class extends Event {
      constructor(type, options) { super(type, options); this.inputType = options.inputType; }
    } } };
  }
  setSelectionRange(start, end, direction = 'none') { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
}

// Actual NotebookPage/DeckPage key, finish, act and model owners with field,
// paint and saving ports. This is semantic evidence, not browser input/focus
// or the actual Core receipt path; those remain required separately.
function page(body = '## Source\n\nbefore payload after\n\n## Neighbor\n\nkept\n') {
  const p = Object.assign(Object.create(NotebookPage.prototype), {
    host: {}, mode: 'cards', doc: { body: {} }, list: { contains: () => true },
    base: { body }, deck: parseDeck(body), picked: 0, selected: new Set(),
    folded: new Set(), acts: [], undos: [], readOnly: false,
    header: { description: {} }, paint() {}, show() {}, save() {},
    keepFolds() {}, holdPage: () => () => {}, say(words) { this.notice = words; },
  });
  p.changes = [];
  p.writing = { value: { body }, edit(patch, seen, mode, acts) {
    if (patch.body === this.value.body) return false;
    p.changes.push(structuredClone({ patch, seen, mode, acts })); this.value = { ...this.value, ...patch }; return true;
  } };
  p.cardsSeen = { revision: 1, content: { body } };
  p.save = () => NotebookPage.prototype.save.call(p);
  p.open = editing => {
    const field = new Field(editing.shown ?? editing.text);
    p.editing = { ...editing, field, input: new WritingInput({ field, mac: true }), history: new NotebookEditHistory({ field, mac: true }) };
  };
  const source = p.deck.cards[0], text = cardText(source), written = p.written(source);
  p.open({ text, shown: cardText({ title: source.title, words: written.words }), ...written, kept: written.images.join('\n'), near: 0, depth: source.depth, fresh: false });
  return p;
}
function commandReturn(p, extra = {}) {
  const event = { key: 'Enter', metaKey: true, target: p.editing.field,
    preventDefault() { this.defaultPrevented = true; }, ...extra };
  p.key(event);
  return event;
}

for (const [selected, body] of [
  ['payload', '## Source\n\nbefore payload after\n\n## Neighbor\n\nkept\n'],
  ['first\nsecond', '## Source\n\nbefore first\nsecond after\n\n## Neighbor\n\nkept\n'],
]) test('1075 Command-Return moves selected text to the new editor: ' + JSON.stringify(selected), () => {
  const p = page(body), initial = p.editing.field.value;
  const start = initial.indexOf(selected), end = start + selected.length;
  p.editing.field.setSelectionRange(start, end);
  assert.equal(commandReturn(p).defaultPrevented, true);
  assert.equal(cardText(p.deck.cards[0]), initial.slice(0, start) + initial.slice(end), 'source must lose exactly the selected range');
  assert.equal(p.editing.field.value, selected, 'new editor must hold the selected range');
  assert.equal(p.deck.cards.at(-1).title, 'Neighbor');
  assert.equal(p.deck.cards.at(-1).words, 'kept');
  assert.equal(p.changes.length, 1);
  assert.equal(p.changes[0].acts.length, 1);
  assert.equal(p.changes[0].acts[0].kind, 'card-region');
});

test('1075 no-selection control retains finish and empty editor after the source child group', () => {
  const body = '## Source\n\nwords\n\n### Child\n\nchild\n\n## Neighbor\n\nkept\n';
  const p = page(body);
  assert.equal(commandReturn(p).defaultPrevented, true);
  assert.equal(deckBody(p.deck), body);
  assert.equal(p.editing.fresh, true);
  assert.equal(p.editing.after, 'Child\nchild');
  assert.equal(p.editing.depth, 0);
  assert.equal(p.editing.field.value, '');
  assert.deepEqual(p.acts, []);
});

for (const extra of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }])
  test('1075 composition/prevented control leaves selection and model intact: ' + JSON.stringify(extra), () => {
    const p = page(), field = p.editing.field, initial = deckBody(p.deck);
    field.setSelectionRange(7, 14);
    commandReturn(p, extra);
    assert.equal(p.editing.field, field);
    assert.deepEqual([field.selectionStart, field.selectionEnd], [7, 14]);
    assert.equal(deckBody(p.deck), initial);
    assert.deepEqual(p.acts, []);
  });

function select(p, text) {
  const f = p.editing.field, start = f.value.indexOf(text); assert.ok(start >= 0);
  f.setSelectionRange(start, start + text.length); return f;
}

test('1075 whitespace-only selection retains no-selection meaning and makes no saved card', () => {
  const p = page('## Source\n\nleft \n right\n\n## Neighbor\n\nkept\n'), original = p.writing.value.body;
  select(p, ' \n '); commandReturn(p);
  assert.equal(p.editing.field.value, ''); assert.equal(p.editing.fresh, true);
  assert.equal(p.writing.value.body, original); assert.equal(p.changes.length, 0);
});

test('1075 leading/trailing whitespace is exact in the editor and ordinary normalized text in the saved card', () => {
  const p = page('## Source\n\nleft  moved  right\n\n## Neighbor\n\nkept\n');
  select(p, '  moved  '); commandReturn(p);
  assert.equal(p.editing.field.value, '  moved  ');
  const saved = parseDeck(p.writing.value.body);
  assert.equal(saved.cards[0].words, 'leftright'); assert.equal(saved.cards[1].title, 'moved');
  assert.deepEqual([p.editing.field.selectionStart, p.editing.field.selectionEnd], [9, 9]);
});

test('1075 a selected heading line uses ordinary card serialization without duplicating the new card on Done', () => {
  const p = page('## Source\n\n````\n## literal title\n\nline\n````\n\n## Neighbor\n\nkept\n');
  select(p, '## literal title\n\nline'); commandReturn(p);
  assert.equal(p.editing.field.value, '## literal title\n\nline');
  const before = p.writing.value.body; p.finish();
  assert.equal(p.writing.value.body, before);
  assert.equal(parseDeck(before).cards.filter(c => c.title === 'literal title').length, 1);
});

test('1075 parent with children puts the new same-depth sibling after the intact child group', () => {
  const body = '## Source\n\nleft payload right\n\n### Child\n\nchild\n\n#### Grandchild\n\ngrand\n\n## Neighbor\n\nkept\n';
  const p = page(body); select(p, 'payload'); commandReturn(p);
  const saved = parseDeck(p.writing.value.body);
  assert.deepEqual(saved.cards.map(c => [c.title, c.depth]), [['Source', 0], ['Child', 1], ['Grandchild', 2], ['payload', 0], ['Neighbor', 0]]);
  assert.equal(saved.cards[1].raw, parseDeck(body).cards[1].raw);
  assert.equal(saved.cards[2].raw, parseDeck(body).cards[2].raw);
});

test('1075 whole-text selection retains the source title and children instead of empty-edit removal', () => {
  const p = page('## Source\n\nwords\n\n### Child\n\nchild\n\n## Neighbor\n\nkept\n');
  const selected = p.editing.field.value; select(p, selected); commandReturn(p);
  const saved = parseDeck(p.writing.value.body);
  assert.deepEqual(saved.cards.map(c => [c.title, c.depth]), [['Source', 0], ['Child', 1], ['Source', 0], ['Neighbor', 0]]);
  assert.equal(saved.cards[0].words, ''); assert.equal(p.editing.field.value, selected);
});

test('1075 one Command-Z at the new editor reverses the whole split as one model/writing step', () => {
  const p = page(), original = p.writing.value.body;
  select(p, 'payload'); commandReturn(p);
  assert.equal(p.undos.length, 1); assert.equal(p.editing.history.position, 0);
  const event = { key: 'z', metaKey: true, target: p.editing.field, preventDefault() { this.defaultPrevented = true; } };
  p.key(event);
  assert.equal(event.defaultPrevented, true); assert.equal(p.editing, null);
  assert.equal(p.writing.value.body, original); assert.equal(p.undos.length, 0);
  assert.equal(p.changes.length, 2); assert.equal(p.changes[1].acts.length, 1);
});

test('1075 Undo after Done retains one inverse and restores the source', () => {
  const p = page(), original = p.writing.value.body;
  select(p, 'payload'); commandReturn(p); p.finish();
  assert.equal(p.undos.length, 1); p.undo();
  assert.equal(p.writing.value.body, original);
});

test('1075 an input typed before the move survives Undo of the split', () => {
  const p = page(); p.editing.field.value += ' typed first'; p.save();
  const before = p.writing.value.body;
  select(p, 'payload'); commandReturn(p); p.undo();
  assert.equal(p.writing.value.body, before);
});

test('1075 typing in the new editor undoes locally first, then one more Undo reverses the split', () => {
  const p = page(), original = p.writing.value.body;
  select(p, 'payload'); commandReturn(p);
  const e = p.editing, before = { text: e.field.value, selection: [7, 7, 'none'] };
  e.field.value += ' typed'; e.field.setSelectionRange(13, 13);
  e.history.record(before, { text: e.field.value, selection: [13, 13, 'none'] }, 'insertText');
  p.save();
  p.key({ key: 'z', metaKey: true, target: e.field, preventDefault() {} });
  assert.equal(p.editing, e); assert.equal(e.field.value, 'payload');
  // The fixture's input/save port is explicit; the real editor wires it in open().
  p.save(); p.key({ key: 'z', metaKey: true, target: e.field, preventDefault() {} });
  assert.equal(p.writing.value.body, original);
});

test('1075 a fresh source editor splits and undoes to the single original source', () => {
  const p = page(); p.finish(); p.start();
  p.editing.field.value = 'Fresh\nfirst payload last'; p.editing.field.setSelectionRange(0, 0); p.save();
  const original = p.writing.value.body;
  select(p, 'payload'); commandReturn(p); p.undo();
  assert.equal(p.writing.value.body, original);
});

test('1075 UTF-16 selections move the same Unicode string and preserve both unselected sides', () => {
  const p = page('## Source\n\nleft 🧶 café 日本語 right\n\n## Neighbor\n\nkept\n');
  select(p, '🧶 café 日本語'); commandReturn(p);
  assert.equal(p.editing.field.value, '🧶 café 日本語');
  assert.equal(parseDeck(p.writing.value.body).cards[0].words, 'left  right');
});

test('1075 read-only arriving after split preserves the new editor and its selection on Undo', () => {
  const p = page(); select(p, 'payload'); commandReturn(p);
  const e = p.editing, body = p.writing.value.body; p.readOnly = true;
  p.key({ key: 'z', metaKey: true, target: e.field, preventDefault() {} });
  assert.equal(p.editing, e); assert.equal(p.writing.value.body, body);
});

test('1075 one model act and inverse preserve an unrelated external card edit; changed split regions refuse Undo', () => {
  const p = page(); select(p, 'payload');
  const split = selectionCardSplit(p.deck, { ...p.editing, value: p.editing.field.value, start: p.editing.field.selectionStart, end: p.editing.field.selectionEnd });
  const done = applyAct(parseDeck(split.before), split.act);
  assert.equal(deckBody(done.deck), split.after);
  const external = split.after.replace('kept\n', 'externally kept\n');
  assert.equal(deckBody(applyAct(parseDeck(external), done.undo).deck), split.before.replace('kept\n', 'externally kept\n'));
  assert.equal(applyAct(parseDeck(split.after.replace('before  after', 'changed source')), done.undo), null);
  assert.equal(rebaseCardActs(split.before, split.before.replace('kept\n', 'externally kept\n'), [split.act]), external);
});

for (const change of ['changed source with duplicate', 'deleted source with duplicate', 'duplicate text inside another card fence'])
  test('1075 Undo never rebinds a changed or deleted source region to unrelated identical text: ' + change, () => {
    const p = page(); select(p, 'payload');
    const split = selectionCardSplit(p.deck, { ...p.editing, value: p.editing.field.value, start: p.editing.field.selectionStart, end: p.editing.field.selectionEnd });
    const done = applyAct(parseDeck(split.before), split.act), region = done.undo.from;
    let body;
    if (change === 'changed source with duplicate') body = split.after.replace('before  after', 'changed source') + region;
    else if (change === 'deleted source with duplicate') body = split.after.slice(region.length) + region;
    else body = split.after.replace('before  after', 'changed source') + '\n## Other\n\n````\n' + region + '````\n';
    assert.equal(applyAct(parseDeck(body), done.undo), null, 'an uncertain original target refuses instead of changing the surviving duplicate');
  });

test('1075 an unchanged original among identical cards still splits and undoes at its own position', () => {
  const p = page('## Source\n\nbefore payload after\n\n## Source\n\nbefore payload after\n');
  const before = p.writing.value.body; select(p, 'payload'); commandReturn(p); p.undo();
  assert.equal(p.writing.value.body, before);
});

test('1075 unrelated structural changes conservatively refuse the inverse rather than guess an occurrence', () => {
  const p = page(); select(p, 'payload');
  const split = selectionCardSplit(p.deck, { ...p.editing, value: p.editing.field.value, start: p.editing.field.selectionStart, end: p.editing.field.selectionEnd });
  const done = applyAct(parseDeck(split.before), split.act);
  assert.equal(applyAct(parseDeck(split.after + '\n## New unrelated card\n'), done.undo), null);
});

test('1075 an unrelated body edit above the source can shift offsets without rebinding its inverse', () => {
  const body = '## Earlier\n\nkept\n\n## Source\n\nbefore payload after\n\n## Neighbor\n\nkept\n';
  const deck = parseDeck(body), text = cardText(deck.cards[1]), start = text.indexOf('payload');
  const split = selectionCardSplit(deck, { text, value: text, near: 1, depth: 0, start, end: start + 7 });
  const done = applyAct(parseDeck(split.before), split.act);
  const changed = split.after.replace('Earlier\n\nkept', 'Earlier\n\nlonger outside text');
  assert.equal(deckBody(applyAct(parseDeck(changed), done.undo).deck), body.replace('Earlier\n\nkept', 'Earlier\n\nlonger outside text'));
});

test('1075 a compact existing Markdown source moves its selection without falsely reporting an external change', () => {
  const p = page('## Source\nbefore payload after\n\n## Neighbor\nkept\n');
  select(p, 'payload'); commandReturn(p);
  assert.equal(p.editing.field.value, 'payload'); assert.equal(p.notice, undefined);
  p.undo(); assert.equal(p.writing.value.body, '## Source\nbefore payload after\n\n## Neighbor\nkept\n');
});

test('1075 whole selection in an untitled source retains its empty title and child group', () => {
  const p = page('##\n\npayload\n\n### Child\n\nchild\n\n## Neighbor\n\nkept\n');
  const selected = p.editing.field.value; select(p, selected); commandReturn(p);
  const saved = parseDeck(p.writing.value.body);
  assert.equal(saved.cards.length, 4); assert.equal(saved.cards[0].title, ''); assert.equal(saved.cards[0].words, '');
  assert.equal(saved.cards[1].title, 'Child'); assert.equal(saved.cards[1].depth, 1);
  assert.equal(p.editing.field.value, selected);
});

test('1075 a whole visible-text move keeps the source metadata and image without copying its identity', () => {
  const id = 'c-' + '1'.repeat(32), marker = detailsLine({ id, aliases: [], color: null });
  const p = page('## Source\n\nwords\n\n![picture](attachment:fixture-picture)\n\n' + marker + '\n\n## Neighbor\n\nkept\n');
  const selected = p.editing.field.value; assert.equal(selected, 'Source\nwords');
  select(p, selected); commandReturn(p);
  const saved = parseDeck(p.writing.value.body);
  assert.equal(cardDetails(saved.cards[0].words).id, id);
  assert.match(saved.cards[0].words, /attachment:fixture-picture/);
  assert.deepEqual(cardDetails(saved.cards[1].words).ids, []);
  assert.equal(p.editing.field.value, selected);
});

for (const guard of ['read-only page', 'read-only field', 'unavailable device', 'closed writing', 'pending page action'])
  test('1075 guards preserve the existing field and selected text: ' + guard, () => {
    const p = page(), original = p.writing.value.body, field = select(p, 'payload');
    if (guard === 'read-only page') p.readOnly = true;
    if (guard === 'read-only field') field.readOnly = true;
    if (guard === 'unavailable device') { p.unavailable = 'Other tab owns this page'; p.say = () => {}; }
    if (guard === 'closed writing') p.writing.closed = true;
    if (guard === 'pending page action') p.writing.actionPending = {};
    commandReturn(p); assert.equal(p.editing.field, field);
    assert.equal(p.writing.value.body, original); assert.equal(p.changes.length, 0);
  });
