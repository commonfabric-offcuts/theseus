// A reply goes to the author of the message it answers unless the person
// removes them, and a reply card says which message it answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../web/editor.mjs';
import { Reader } from '../web/reader.mjs';
import { replyLine } from '../web/replies.mjs';

const context = { instanceId: 'fixture', actor: 'tony', sourceRef: { kind: 'message', id: 'm-1' }, topicId: 't1', kind: 'reply' };
const editor = (draft = {}) => new Editor(context, { id: 'reply', revision: 0, generation: 'g', ...draft });

test('a reply takes the author it was offered with the first thing written, and only then', () => {
  const reply = editor();
  reply.offerAddressees(['fable']);
  assert.deepEqual(reply.offeredAddressees, ['fable'], 'offered while the reply holds nothing');
  reply.edit({ caret: { start: 0, end: 0 } });
  assert.deepEqual(reply.draft.addressees, [], 'moving the caret writes nothing, so it names no one');
  reply.edit({ body: 'O', caret: { start: 1, end: 1 } });
  assert.deepEqual(reply.draft.addressees, ['fable'], 'the first letter brings the author in');
  assert.deepEqual(reply.offeredAddressees, [], 'once taken it is the reply\'s own recipient');
  reply.edit({ addressees: [] });
  reply.edit({ body: 'Ok' });
  assert.deepEqual(reply.draft.addressees, [], 'removed from the writing, the author stays removed');
});

test('a declined author is not added, and other recipients are kept beside an accepted one', () => {
  const declined = editor();
  declined.offerAddressees(['fable']);
  declined.declineAddressee('fable');
  declined.edit({ body: 'Thanks' });
  assert.deepEqual(declined.draft.addressees, []);
  const named = editor();
  named.offerAddressees(['fable']);
  named.edit({ addressees: ['warp'] });
  assert.deepEqual(named.draft.addressees, ['fable', 'warp']);
  const images = editor();
  images.offerAddressees(['fable']);
  images.edit({ attachments: [{ id: 'media-1' }] });
  assert.deepEqual(images.draft.addressees, ['fable'], 'an image alone is writing too');
});

test('writing kept from before is left with the recipients it has', () => {
  const kept = editor({ body: 'Earlier words', addressees: [] });
  kept.offerAddressees(['fable']);
  assert.deepEqual(kept.offeredAddressees, []);
  kept.edit({ body: 'Earlier words, and more' });
  assert.deepEqual(kept.draft.addressees, []);
});

class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], attributes: {}, dataset: {}, className: '', textContent: '' }); }
  focus() { globalThis.document.activeElement = this; }
  get classList() { return { add: name => { this.className = this.className ? `${this.className} ${name}` : name; } }; }
  get isConnected() { return !!this.root || !!this.parent?.isConnected; }
  append(...nodes) { for (const node of nodes) node.parent = this; this.children.push(...nodes); }
  replaceChildren(...nodes) { for (const node of this.children) node.parent = null; this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
}

test('the Reader shows the offered author as a recipient, and its remove declines it without writing', t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), activeElement: null };
  t.after(() => { globalThis.document = previous; });
  const chips = Object.assign(new Element('div'), { root: true }), input = new Element('input'), edits = [];
  const ask = new Element('label'), toggle = new Element('input');
  const reply = editor();
  reply.offerAddressees(['fable']);
  const reader = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply }, presentation: {}, admits: () => true,
    $: id => ({ 'recipient-chips': chips, 'recipient-input': input, 'ask-choice': ask, 'ask-toggle': toggle })[id],
    callbacks: { edit: e => edits.push(e), reach: () => ({ reachable: true }) },
  });
  reader.paintRecipients();
  assert.deepEqual(chips.children.map(chip => chip.dataset.name), ['fable']);
  const remove = chips.children[0].children.find(node => node.tag === 'button');
  assert.equal(remove.attributes['aria-label'], 'Remove fable');
  remove.onclick();
  assert.deepEqual([chips.children.length, edits.length, reply.localVersion], [0, 0, 0], 'declining writes nothing');
  reply.edit({ body: 'Hello' });
  assert.deepEqual(reply.draft.addressees, []);
});

test('after typing, one press on the offered author\'s remove takes them off, and they stay off', t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), activeElement: null };
  t.after(() => { globalThis.document = previous; });
  const chips = Object.assign(new Element('div'), { root: true }), input = new Element('input'), edits = [];
  const ask = new Element('label'), toggle = new Element('input');
  const reply = editor();
  reply.offerAddressees(['fable']);
  const reader = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply }, presentation: {}, admits: () => true,
    $: id => ({ 'recipient-chips': chips, 'recipient-input': input, 'ask-choice': ask, 'ask-toggle': toggle })[id],
    callbacks: { edit: e => edits.push(e), reach: () => ({ reachable: true }) },
  });
  reader.paintRecipients();
  // Typing edits the writing and leaves the recipient chips as they were drawn.
  reply.edit({ body: 'Hello' });
  assert.deepEqual(reply.draft.addressees, ['fable'], 'the first letter took the offered author');
  reply.edit({ intent: 'ask' });
  chips.children[0].children.find(node => node.tag === 'button').onclick();
  assert.deepEqual({ addressees: reply.draft.addressees, chips: chips.children.map(chip => chip.dataset.name) },
    { addressees: [], chips: [] }, 'one press removes them');
  assert.deepEqual([reply.draft.intent, ask.hidden], [null, true], 'a reply to nobody neither asks nor tells, and Ask goes');
  assert.equal(edits.length, 1, 'the removal is saved like any other edit');
  reply.edit({ body: '' });
  reader.paintRecipients();
  reply.edit({ body: 'Starting again' });
  assert.deepEqual({ addressees: reply.draft.addressees, chips: chips.children.map(chip => chip.dataset.name) },
    { addressees: [], chips: [] }, 'emptying the reply does not offer them again');
});

test('typing that takes the offered author shows Ask beside their name', t => {
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { createElement: tag => new Element(tag), activeElement: null };
  globalThis.window = { getSelection: () => null };
  t.after(() => Object.assign(globalThis, previous));
  // The Reader's own wiring: every element it binds listens, and the writing
  // field is typed into as a browser does, through its input event.
  const listening = tag => Object.assign(new Element(tag), {
    listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; },
  });
  const elements = new Map(), element = id => elements.get(id) ?? elements.set(id, listening('el')).get(id);
  const field = Object.assign(listening('textarea'), { value: '', selectionStart: 0, selectionEnd: 0, readOnly: false });
  const reply = editor();
  reply.offerAddressees(['fable']);
  const reader = Object.assign(Object.create(Reader.prototype), {
    dialog: Object.assign(listening('dialog'), { querySelector: selector => element(selector.replace(/^#/, '')) }),
    field, sourceBody: Object.assign(listening('div'), { querySelectorAll: () => [] }), mode: 'reply', sessions: { reply }, presentation: {},
    callbacks: { edit() {}, admits: () => true }, paintStatus() {},
  });
  reader.bind();
  reader.paintAsk();
  assert.equal(element('ask-choice').hidden, true, 'an empty reply only offers the author, so it asks no one yet');
  field.value = 'H'; field.selectionStart = field.selectionEnd = 1;
  field.listeners.input();
  assert.deepEqual(reply.draft.addressees, ['fable'], 'the first letter took the offered author');
  assert.equal(element('ask-choice').hidden, false, 'the reply now names them, so Ask shows');
});

test('a reply card names the author of the message it answers and how it begins', () => {
  assert.equal(replyLine({ reply_to: null }), '');
  assert.equal(replyLine({ reply_to: 'm-1', reply_to_author: 'fable', reply_to_excerpt: 'Ship it' }), 'Replying to fable: Ship it');
  assert.equal(replyLine({ reply_to: 'm-1', reply_to_author: 'fable', reply_to_excerpt: 'First line\nsecond line' }), 'Replying to fable: First line');
  const long = 'word '.repeat(40);
  assert.equal(replyLine({ reply_to: 'm-1', reply_to_author: 'fable', reply_to_excerpt: long }), 'Replying to fable: ' + long.slice(0, 60).trimEnd() + '…');
  assert.equal(replyLine({ reply_to: 'm-1', reply_to_author: 'fable', reply_to_excerpt: '' }), 'Replying to fable');
});

test('a reply begun with a quote still goes to the author it was offered', t => {
  const previous = globalThis.window;
  globalThis.window = { getSelection: () => null };
  t.after(() => { globalThis.window = previous; });
  const reply = editor();
  reply.offerAddressees(['fable']);
  const field = { value: '', focus() {}, setSelectionRange() {} };
  const reader = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply }, presentation: {}, mode: 'reply', field, writes: () => true,
    source: { source_ref: { kind: 'message', id: 'm-1' }, body: 'Ship it' },
    selectedPassage: () => 'Ship it', disarm() {},
    // The writing field reports each insertion to its editor, as typing does.
    insertText(text) { field.value += text; reply.edit({ body: field.value }); },
  });
  reader.quote();
  assert.deepEqual(reply.draft.quotes.map(quote => quote.excerpt), ['Ship it']);
  assert.equal(reply.draft.body, '> Ship it\n\n');
  assert.deepEqual(reply.draft.addressees, ['fable'], 'quoting first is writing, so it takes the offered author');
  const declined = editor();
  declined.offerAddressees(['fable']);
  declined.declineAddressee('fable');
  Object.assign(reader, { sessions: { reply: declined }, insertText(text) { declined.edit({ body: text }); } });
  reader.quote();
  assert.deepEqual(declined.draft.addressees, [], 'a declined author stays off a quoted reply');
});
