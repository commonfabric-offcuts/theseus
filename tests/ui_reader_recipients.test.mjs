import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';

class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], attributes: {}, className: '', textContent: '' }); }
  get classList() { return { add: name => { this.className = this.className ? `${this.className} ${name}` : name; } }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
}

test('the reader\'s recipient chips say who is not in the topic, and offer the add the page allows', t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = previous; });
  const chips = new Element('div'), asked = [];
  const reader = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply: { draft: { addressees: ['fable', 'stranger'] } } }, presentation: {},
    $: id => { assert.equal(id, 'recipient-chips'); return chips; },
    callbacks: { reach: name => { asked.push(name); return name === 'stranger' ? { reachable: false, add: async () => {} } : { reachable: true }; } },
  });
  reader.paintRecipients();
  assert.deepEqual(asked, ['fable', 'stranger']);
  assert.deepEqual(chips.children.map(chip => chip.className), ['chip', 'chip unreachable']);
  assert.ok(chips.children[1].children.some(node => node.tag === 'button' && node.textContent.startsWith('Add to topic')));
});
