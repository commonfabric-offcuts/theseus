import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';
import { clock } from '../web/times.mjs';

class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], attributes: {}, dataset: {}, className: '', textContent: '' }); }
  focus() { globalThis.document.activeElement = this; }
  get classList() { return { add: name => { this.className = this.className ? `${this.className} ${name}` : name; } }; }
  // A node is on the page while its parents reach a root, as in a browser.
  get isConnected() { return !!this.root || !!this.parent?.isConnected; }
  append(...nodes) { for (const node of nodes) if (typeof node === 'object') node.parent = this; this.children.push(...nodes); }
  // What it says: its own text, then its children's, a string child as itself.
  get text() { return this.textContent + this.children.map(node => typeof node === 'string' ? node : node.text).join(''); }
  replaceChildren(...nodes) { for (const node of this.children) if (typeof node === 'object') node.parent = null; this.children = []; this.textContent = ''; this.append(...nodes); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; } }
  insertBefore(node, before) { node.remove(); this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node); node.parent = this; }
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
  const chips = Object.assign(new Element('div'), { root: true }), input = new Element('input');
  let inTopic = false, answer = { status: 'refused', error: { message: 'No permission for this topic' } };
  const editor = { draft: { addressees: ['fable', 'stranger'] }, edit(patch) { Object.assign(this.draft, patch); }, declineAddressee() {} };
  const reader = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply: editor }, presentation: {}, admits: () => true,
    $: id => ({ 'recipient-chips': chips, 'recipient-input': input, 'ask-choice': new Element('label'), 'ask-toggle': new Element('input') })[id],
    callbacks: { edit() {}, reach: name => name === 'stranger' && !inTopic ? { reachable: false, add: async () => answer } : { reachable: true } },
  });
  const chip = name => chips.children.find(node => node.textContent === name);
  const offer = () => chip('stranger').children.find(node => node.textContent.startsWith('Add to topic'));
  const said = () => chip('stranger').children.find(node => node.className === 'reach-notice');
  reader.paintRecipients();
  offer().focus();
  await offer().onclick();
  assert.equal(said().textContent, ' · No permission for this topic');
  const refused = offer();
  reader.paintRecipients();
  assert.equal(offer(), refused, 'a repaint that changes nothing keeps the chip and its offer');
  assert.equal(document.activeElement, refused, 'and the focus on it');
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

test('a chip rebuilt while its add is out shows it still out, sends nothing more, and says how the add ended', async t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), activeElement: null };
  t.after(() => { globalThis.document = previous; });
  const chips = Object.assign(new Element('div'), { root: true }), input = new Element('input');
  let settle, adds = 0, scope = 't1';
  const editor = { draft: { addressees: ['stranger'] }, edit(patch) { Object.assign(this.draft, patch); } };
  const reach = name => ({ reachable: false, scope, add: () => { adds++; return new Promise(resolve => { settle = resolve; }); } });
  const reader = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply: editor }, presentation: {}, admits: () => true,
    $: id => ({ 'recipient-chips': chips, 'recipient-input': input, 'ask-choice': new Element('label'), 'ask-toggle': new Element('input') })[id], callbacks: { edit() {}, reach },
  });
  const offer = () => chips.children[0].children.find(node => node.textContent.startsWith('Add to topic'));
  const said = () => chips.children[0].children.find(node => node.className === 'reach-notice');
  reader.paintRecipients();
  offer().focus();
  const pressed = offer().onclick();
  reader.paintRecipients();
  assert.equal(offer().attributes['aria-disabled'], 'true', 'the new chip says the add is still out');
  await offer().onclick();
  assert.equal(adds, 1, 'pressing the new chip sends no second add');
  settle({ status: 'refused', error: { code: 'FORBIDDEN', message: 'No permission for this topic' } }); await pressed;
  assert.deepEqual([said().textContent, said().hidden, offer().attributes['aria-disabled']], [' · No permission for this topic', false, undefined],
    'the refusal is said on the chip on the page');
  scope = 't2'; reader.paintRecipients();
  assert.deepEqual([said().textContent, said().hidden], ['', true], 'in another topic the same person\'s chip starts afresh');
  scope = 't1'; reader.paintRecipients();
  assert.deepEqual([said().textContent, said().hidden], ['', true], 'back in the first topic, a person whose chips all left starts afresh');
  const again = offer().onclick();
  editor.draft.addressees = []; reader.paintRecipients();
  editor.draft.addressees = ['stranger']; reader.paintRecipients();
  assert.equal(offer().attributes['aria-disabled'], 'true', 'a person removed while their add is out is still out when they come back');
  settle({ status: 'refused', error: { message: 'Still no permission' } }); await again;
  assert.equal(said().textContent, ' · Still no permission', 'and their chip says how it ended');
  editor.draft.addressees = []; reader.paintRecipients();
  editor.draft.addressees = ['stranger']; reader.paintRecipients();
  assert.deepEqual([said().textContent, said().hidden, offer().attributes['aria-disabled']], ['', true, undefined],
    'a person removed and added again later starts afresh');
  const unseen = offer().onclick();
  editor.draft.addressees = []; reader.paintRecipients();
  settle({ status: 'refused', error: { message: 'Refused unseen' } }); await unseen;
  editor.draft.addressees = ['stranger']; reader.paintRecipients();
  assert.deepEqual([said().textContent, offer().attributes['aria-disabled']], ['', undefined], 'an add that ended with no chip on the page is forgotten');
});

test('the origin line names the author, the kind and when it was sent, and leaves out a time it does not have', t => {
  const previous = globalThis.document, now = clock.now;
  globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = previous; clock.now = now; });
  const origin = new Element('div');
  const reader = Object.assign(Object.create(Reader.prototype), { $: id => { assert.equal(id, 'reader-origin'); return origin; } });
  const sent_ms = new Date(2026, 10, 5, 5, 44).getTime();
  clock.now = () => new Date(2026, 10, 6, 9, 0).getTime();
  reader.paintOrigin({ author: 'tony', source_ref: { kind: 'message', id: 'm1' }, sent_ms });
  assert.equal(origin.text, 'tony · Message · Yesterday 5:44 AM');
  assert.equal(origin.children.find(node => node.tag === 'time')?.title, '5:44 AM Thu Nov 5', 'its title keeps the date');
  clock.now = () => new Date(2026, 10, 9, 9, 0).getTime();
  reader.paintOrigin({ author: 'tony', source_ref: { kind: 'message', id: 'm1' }, sent_ms });
  assert.equal(origin.text, 'tony · Message · 5:44 AM Thu Nov 5', 'from before yesterday: dated');
  reader.paintOrigin({ author: 'tony', source_ref: { kind: 'memory', id: 'n1', revision: 3 } });
  assert.equal(origin.text, 'tony · Notebook · revision 3');
});
