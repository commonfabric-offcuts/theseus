// A reply goes to the author of the message it answers unless the person
// removes them, and a reply card says which message it answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor, holdsWriting, written } from '../web/editor.mjs';
import { Reader } from '../web/reader.mjs';
import { replyLine } from '../web/replies.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

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

test('a reply emptied of all that was written offers its author again, as before the first word, and keeps a name the person chose', () => {
  const emptied = (reply, why) => assert.deepEqual([reply.draft.addressees, reply.offeredAddressees, holdsWriting(reply.draft)], [[], ['fable'], false], why);
  const typed = editor();
  typed.offerAddressees(['fable']);
  typed.edit({ body: 'T' });
  assert.deepEqual(typed.draft.addressees, ['fable'], 'the first letter took the offered author');
  typed.edit({ body: '' });
  emptied(typed, 'a letter typed and deleted leaves the reply holding nothing, its author offered again');
  typed.edit({ body: 'Again' });
  assert.deepEqual(typed.draft.addressees, ['fable'], 'and the next word takes them once more');
  const quoted = editor();
  quoted.offerAddressees(['fable']);
  quoted.edit({ quotes: [{ source: { kind: 'message', id: 'm-1' }, excerpt: 'Words' }] });
  quoted.edit({ quotes: [] });
  emptied(quoted, 'a quote taken out again holds nothing');
  // Saved so before this rule: only the offered author named, nothing written.
  const saved = editor({ addressees: ['fable'] });
  saved.offerAddressees(['fable']);
  emptied(saved, 'a saved reply naming only who it is offered to holds nothing');
  // What the person chose stays theirs, written words or not.
  const chosen = editor();
  chosen.offerAddressees(['fable']);
  chosen.edit({ body: 'T' });
  chosen.edit({ addressees: ['fable', 'warp'] });
  chosen.edit({ body: '' });
  assert.deepEqual([chosen.draft.addressees, holdsWriting(chosen.draft)], [['fable', 'warp'], true], 'a name the person added keeps the reply, its author with it');
  const again = editor();
  again.offerAddressees(['fable']);
  again.declineAddressee('fable');
  again.edit({ addressees: ['fable'] });
  again.edit({ body: 'T' });
  again.edit({ body: '' });
  assert.deepEqual([again.draft.addressees, holdsWriting(again.draft)], [['fable'], true], 'an author taken off and named again is the person\'s choice');
  const other = editor({ addressees: ['warp'] });
  other.offerAddressees(['fable']);
  assert.deepEqual([other.draft.addressees, holdsWriting(other.draft)], [['warp'], true], 'a saved reply naming someone not offered keeps them');
  const words = editor({ body: 'Earlier', addressees: ['fable'] });
  words.offerAddressees(['fable']);
  assert.deepEqual(words.draft.addressees, ['fable'], 'saved words keep their recipients');
});

// Send's dimming, 👍 beside it and the line's Draft read whether anything is
// written: words or an image. Names, a choice of how it asks, and a quote whose
// words were taken out are not writing, though Core holds the draft for them.
test('nothing is written until there are words or an image, whoever the reply names and however it asks', () => {
  const reply = editor();
  reply.offerAddressees(['fable']);
  const seen = () => [written(reply.draft), holdsWriting(reply.draft)];
  assert.deepEqual(seen(), [false, false], 'an empty reply');
  reply.edit({ addressees: ['fable', 'warp'], intent: 'ask' });
  assert.deepEqual(seen(), [false, true], 'named and asked, nothing written: Core keeps the choices, and nothing is written');
  reply.edit({ body: ' \n' });
  assert.deepEqual(seen(), [false, true], 'blank lines are not words');
  reply.edit({ body: 'Hi' });
  assert.deepEqual(seen(), [true, true], 'a word is written');
  reply.edit({ body: '', quotes: [{ source: { kind: 'message', id: 'm-1' }, excerpt: 'Words' }] });
  assert.deepEqual(seen(), [false, true], 'a quote whose words were all deleted is not written');
  reply.edit({ attachments: [{ id: 'media-1' }] });
  assert.deepEqual(seen(), [true, true], 'an image is written');
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
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; } }
  insertBefore(node, before) { node.remove(); this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node); node.parent = this; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
}

test('the Reader shows the offered author as a recipient, and its remove declines it without writing', t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), activeElement: null };
  t.after(() => { globalThis.document = previous; });
  const chips = Object.assign(new Element('div'), { root: true }), input = new Element('input'), edits = [];
  const reply = editor();
  reply.offerAddressees(['fable']);
  const reader = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply }, presentation: {}, admits: () => true,
    $: id => ({ 'recipient-chips': chips, 'recipient-input': input })[id],
    callbacks: { edit: e => edits.push(e), reach: () => ({ reachable: true }) },
    // How the reply is sent has its own checks (ui_whisper.test.mjs).
    paintChoice() {},
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
  const reply = editor();
  reply.offerAddressees(['fable']);
  const reader = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply }, presentation: {}, admits: () => true,
    $: id => ({ 'recipient-chips': chips, 'recipient-input': input })[id],
    callbacks: { edit: e => edits.push(e), reach: () => ({ reachable: true }) },
    // How the reply is sent has its own checks (ui_whisper.test.mjs).
    paintChoice() {},
  });
  reader.paintRecipients();
  // Typing edits the writing and leaves the recipient chips as they were drawn.
  reply.edit({ body: 'Hello' });
  assert.deepEqual(reply.draft.addressees, ['fable'], 'the first letter took the offered author');
  reply.edit({ intent: 'ask' });
  chips.children[0].children.find(node => node.tag === 'button').onclick();
  assert.deepEqual({ addressees: reply.draft.addressees, chips: chips.children.map(chip => chip.dataset.name) },
    { addressees: [], chips: [] }, 'one press removes them');
  assert.deepEqual([reply.draft.intent, reply.draft.whisper], [null, null], 'a reply to nobody neither asks, tells nor whispers');
  assert.equal(edits.length, 1, 'the removal is saved like any other edit');
  reply.edit({ body: '' });
  reader.paintRecipients();
  reply.edit({ body: 'Starting again' });
  assert.deepEqual({ addressees: reply.draft.addressees, chips: chips.children.map(chip => chip.dataset.name) },
    { addressees: [], chips: [] }, 'emptying the reply does not offer them again');
});

test('a reply offered to an agent shows Tell from the start, and typing that takes the author keeps it', t => {
  const previous = { document: globalThis.document, window: globalThis.window, MutationObserver: globalThis.MutationObserver, ResizeObserver: globalThis.ResizeObserver };
  const document = miniDocument();
  // The page's own listeners and its end-of-message line are not what this checks.
  document.addEventListener = () => {};
  globalThis.MutationObserver = class { observe() {} };
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.document = document;
  const win = { listeners: {}, getSelection: () => null, addEventListener(type, listener, capture) { this.listeners[type] = [listener, capture]; },
    matchMedia: () => ({ matches: false, addEventListener() {} }) };
  globalThis.window = win;
  t.after(() => Object.assign(globalThis, previous));
  // The Reader's own wiring: every element it binds listens, and the writing
  // field is typed into as a browser does, through its input event.
  const element = id => document.byId(id);
  const field = Object.assign(document.createElement('textarea'), { value: '', selectionStart: 0, selectionEnd: 0, readOnly: false });
  const reply = editor();
  reply.offerAddressees(['fable']);
  const reader = Object.assign(Object.create(Reader.prototype), {
    dialog: Object.assign(document.createElement('dialog'), { querySelector: selector => element(selector.replace(/^#/, '')) }),
    field, sourceBody: Object.assign(document.createElement('div'), { querySelectorAll: () => [] }), mode: 'reply', sessions: { reply }, presentation: {},
    callbacks: { edit() {}, admits: () => true, people: () => ({ kindOf: name => name === 'fable' ? 'agent' : undefined, everyone: ['fable'] }) }, paintStatus() {},
  });
  reader.bind();
  const checked = () => element('intent-row').querySelectorAll('button[data-intent]').find(chip => chip.getAttribute('aria-pressed') === 'true')?.dataset.intent;
  reader.paintChoice();
  assert.deepEqual([reply.draft.addressees, checked()], [[], 'tell'], 'an empty reply only offers the author, and already shows how it would go: a Tell');
  field.value = 'H'; field.selectionStart = field.selectionEnd = 1;
  field.listeners.input();
  assert.deepEqual(reply.draft.addressees, ['fable'], 'the first letter took the offered author');
  assert.equal(checked(), 'tell', 'the reply now names them, and is still a Tell');
  // A click outside, on the backdrop, closes the Reader as × does; one inside does not.
  let closes = 0;
  reader.close = () => { closes++; };
  // No smaller pop-up is open inside it.
  const named = reader.dialog.querySelector;
  Object.assign(reader.dialog, { open: true, getBoundingClientRect: () => ({ left: 100, right: 900, top: 50, bottom: 750 }),
    querySelector: selector => selector === '[role="dialog"]:not([hidden])' ? null : named(selector) });
  assert.ok(win.listeners.pointerdown, 'the Reader listens for a press outside it');
  const [down, capture] = win.listeners.pointerdown;
  assert.equal(capture, true, 'the press is seen on the window, on its way down');
  const press = (x, y) => { const event = { target: reader.dialog, clientX: x, clientY: y, button: 0, isPrimary: true }; down(event); reader.dialog.listeners.click(event); };
  press(500, 400);
  assert.equal(closes, 0, 'a press inside the Reader keeps it open');
  press(20, 400);
  assert.equal(closes, 1, 'a press on the backdrop closes it');
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
    narrow: {matches: true}, // The quote's address is independent of a phone's fixed layout.
    sessions: { reply }, presentation: {}, mode: 'reply', field, writes: () => true,
    source: { source_ref: { kind: 'message', id: 'm-1' }, body: 'Ship it' },
    selectedPassage: () => 'Ship it', disarm() {}, notice() {},
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

test('a reply posted to another topic than the message\'s says where on its chip, its field and the line under the chip; one posted where the message is says nothing more', t => {
  const previous = globalThis.document;
  const document = miniDocument();
  globalThis.document = document;
  t.after(() => { globalThis.document = previous; });
  const element = id => document.byId(id);
  const field = Object.assign(document.createElement('textarea'), { value: '' });
  const conversation = { name: 'the conversation', note: 'Goes to the outcome\'s conversation; nobody in this topic is woken.' };
  const shown = (from, to) => {
    const reply = new Editor({ ...context, topicId: to }, { id: 'reply', revision: 0, generation: 'g', body: 'Hi', addressees: ['fable'], intent: 'tell' });
    const reader = Object.assign(Object.create(Reader.prototype), { $: element, field, mode: 'reply', sessions: { reply }, source: { topic_id: from, source_ref: context.sourceRef },
      callbacks: { place: id => id === 'c1' ? conversation : null, people: () => ({ kindOf: () => 'agent', everyone: ['fable'] }) } });
    reader.paintChoice();
    const note = element('destination-note');
    return [element('who-chip').textContent, field.placeholder, note.hidden ? '' : note.textContent];
  };
  assert.deepEqual(shown('t1', 'c1'), ['Tell fable · in the conversation', 'Reply to fable in the conversation…', conversation.note]);
  assert.deepEqual(shown('t1', 't1'), ['Tell fable · everyone here', 'Reply to fable…', '']);
  // Read in the conversation itself, a reply there goes to everyone here.
  assert.deepEqual(shown('c1', 'c1'), ['Tell fable · everyone here', 'Reply to fable…', '']);
});
