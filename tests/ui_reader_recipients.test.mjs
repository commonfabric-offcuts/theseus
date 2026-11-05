import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';

class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], attributes: {}, dataset: {}, className: '', textContent: '' }); }
  focus() { globalThis.document.activeElement = this; }
  get classList() { return { add: name => { this.className = this.className ? `${this.className} ${name}` : name; } }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
}

test('the reader\'s recipient chips say who is not in the topic, and offer the add the page allows', t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = previous; });
  const chips = new Element('div'), asked = [];
  const reader = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply: { draft: { addressees: ['fable', 'stranger'] } } }, presentation: {},
    $: id => { assert.ok(['recipient-chips', 'recipient-input'].includes(id)); return id === 'recipient-chips' ? chips : new Element('input'); },
    callbacks: { reach: name => { asked.push(name); return name === 'stranger' ? { reachable: false, add: async () => {} } : { reachable: true }; } },
  });
  reader.paintRecipients();
  assert.deepEqual(asked, ['fable', 'stranger']);
  assert.deepEqual(chips.children.map(chip => chip.className), ['chip', 'chip unreachable']);
  assert.ok(chips.children[1].children.some(node => node.tag === 'button' && node.textContent.startsWith('Add to topic')));
});

test('a repaint of the reader\'s chips keeps keyboard focus in the writing and keeps what a chip said', async t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), activeElement: null };
  t.after(() => { globalThis.document = previous; });
  const chips = new Element('div'), input = new Element('input');
  let inTopic = false, answer = { status: 'refused', error: { message: 'No permission for this topic' } };
  const editor = { draft: { addressees: ['fable', 'stranger'] }, edit(patch) { Object.assign(this.draft, patch); } };
  const reader = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply: editor }, presentation: {}, admits: () => true,
    $: id => ({ 'recipient-chips': chips, 'recipient-input': input })[id],
    callbacks: { edit() {}, reach: name => name === 'stranger' && !inTopic ? { reachable: false, add: async () => answer } : { reachable: true } },
  });
  const chip = name => chips.children.find(node => node.dataset.name === name);
  const offer = () => chip('stranger').children.find(node => node.textContent.startsWith('Add to topic'));
  const said = () => chip('stranger').children.find(node => node.className === 'reach-notice');
  reader.paintRecipients();
  offer().focus();
  await offer().onclick();
  assert.equal(said().textContent, ' · No permission for this topic');
  const refused = offer();
  reader.paintRecipients();
  assert.notEqual(offer(), refused, 'the chips were rebuilt');
  assert.equal(document.activeElement, offer(), 'focus moves to the same offer on the new chip');
  assert.deepEqual([said().textContent, said().hidden], [' · No permission for this topic', false], 'the refusal is still said');

  answer = { status: 'committed' };
  await offer().onclick();
  inTopic = true;
  reader.paintRecipients();
  assert.equal(document.activeElement, input, 'with the offer gone, focus goes to the recipient field, not the page');

  chip('fable').children[0].focus();
  chip('fable').children[0].onclick();
  assert.deepEqual([editor.draft.addressees, document.activeElement], [['stranger'], input], 'a removed recipient hands focus to the field');
  document.activeElement = null;
  reader.paintRecipients();
  assert.equal(document.activeElement, null, 'a repaint takes no focus it did not hold');
});

test('the origin line names the author, the kind and when it was sent, and leaves out a time it does not have', () => {
  const origin = new Element('div');
  const reader = Object.assign(Object.create(Reader.prototype), { $: id => { assert.equal(id, 'reader-origin'); return origin; } });
  const sent_ms = new Date(2026, 10, 5, 5, 44).getTime();
  reader.paintOrigin({ author: 'tony', source_ref: { kind: 'message', id: 'm1' }, sent_ms });
  assert.equal(origin.textContent, 'tony · Message · 5:44 AM Thu Nov 5');
  reader.paintOrigin({ author: 'tony', source_ref: { kind: 'memory', id: 'n1', revision: 3 } });
  assert.equal(origin.textContent, 'tony · Notebook · revision 3');
});
