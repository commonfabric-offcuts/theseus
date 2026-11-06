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
  const reply = editor();
  reply.offerAddressees(['fable']);
  const reader = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply }, presentation: {}, admits: () => true,
    $: id => ({ 'recipient-chips': chips, 'recipient-input': input })[id],
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
  const reply = editor();
  reply.offerAddressees(['fable']);
  const reader = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply }, presentation: {}, admits: () => true,
    $: id => ({ 'recipient-chips': chips, 'recipient-input': input })[id],
    callbacks: { edit: e => edits.push(e), reach: () => ({ reachable: true }) },
  });
  reader.paintRecipients();
  // Typing edits the writing and leaves the recipient chips as they were drawn.
  reply.edit({ body: 'Hello' });
  assert.deepEqual(reply.draft.addressees, ['fable'], 'the first letter took the offered author');
  chips.children[0].children.find(node => node.tag === 'button').onclick();
  assert.deepEqual({ addressees: reply.draft.addressees, chips: chips.children.map(chip => chip.dataset.name) },
    { addressees: [], chips: [] }, 'one press removes them');
  assert.equal(edits.length, 1, 'the removal is saved like any other edit');
  reply.edit({ body: '' });
  reader.paintRecipients();
  reply.edit({ body: 'Starting again' });
  assert.deepEqual({ addressees: reply.draft.addressees, chips: chips.children.map(chip => chip.dataset.name) },
    { addressees: [], chips: [] }, 'emptying the reply does not offer them again');
});

test('a reply card names the author of the message it answers and how it begins', () => {
  assert.equal(replyLine({ reply_to: null }), '');
  assert.equal(replyLine({ reply_to: 'm-1', reply_to_author: 'fable', reply_to_excerpt: 'Ship it' }), 'Replying to fable: Ship it');
  assert.equal(replyLine({ reply_to: 'm-1', reply_to_author: 'fable', reply_to_excerpt: 'First line\nsecond line' }), 'Replying to fable: First line');
  const long = 'word '.repeat(40);
  assert.equal(replyLine({ reply_to: 'm-1', reply_to_author: 'fable', reply_to_excerpt: long }), 'Replying to fable: ' + long.slice(0, 60).trimEnd() + '…');
  assert.equal(replyLine({ reply_to: 'm-1', reply_to_author: 'fable', reply_to_excerpt: '' }), 'Replying to fable');
});
