import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../web/editor.mjs';
import { Reader } from '../web/reader.mjs';

// While a step to another message waits, the Reader's own writing goes on:
// recipients and quotes reach it like typing. Sending and Save note wait, and
// say why. A Reader that no longer holds its writing takes none of these.
class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], attributes: {}, dataset: {}, className: '', textContent: '', value: '', hidden: true }); }
  focus() { globalThis.document.activeElement = this; }
  get classList() { return { add: name => { this.className = this.className ? `${this.className} ${name}` : name; } }; }
  get isConnected() { return !!this.root || !!this.parent?.isConnected; }
  append(...nodes) { for (const node of nodes) node.parent = this; this.children.push(...nodes); }
  replaceChildren(...nodes) { for (const node of this.children) node.parent = null; this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  setSelectionRange() {}
}

const STEP_WAITS = /Another message is still opening\. Your writing is kept; images and sending wait until it opens\./;

function reader(t, { admits, writes }) {
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = { createElement: tag => new Element(tag), activeElement: null };
  globalThis.window = { getSelection: () => null };
  t.after(() => Object.assign(globalThis, previous));
  const context = { instanceId: 'reader-step', actor: 'fixture-person', sourceRef: { kind: 'message', id: 'm1' }, topicId: 't1' };
  const reply = new Editor({ ...context, kind: 'reply' }, { id: 'reply', revision: 1, generation: 'g1', body: '' });
  const note = new Editor({ ...context, kind: 'note' }, { id: 'note', revision: 1, body: 'A private note' });
  const elements = { 'reader-notice': new Element('p'), 'recipient-input': new Element('input'), 'recipient-chips': Object.assign(new Element('div'), { root: true }) };
  const acts = [], inserted = [];
  const r = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply, note }, mode: 'reply', presentation: {}, source: { source_ref: context.sourceRef, body: 'Quoted passage' },
    field: new Element('textarea'), $: id => elements[id],
    selectedPassage: () => 'Quoted passage', insertText: text => inserted.push(text), disarm() {},
    callbacks: { admits: () => admits, writes: () => writes, reach: () => ({ reachable: true }),
      edit: editor => acts.push(['edit', editor.context.kind]), send: () => acts.push(['send']), saveNote: editor => acts.push(['saveNote', editor.context.kind]) },
  });
  const notice = () => elements['reader-notice'].hidden ? '' : elements['reader-notice'].textContent;
  const commandReturn = () => r.key({ key: 'Enter', metaKey: true, shiftKey: false, altKey: false, keyCode: 13, isComposing: false, repeat: false,
    target: { closest: () => null }, preventDefault() {}, stopPropagation() {} });
  return { r, reply, note, elements, acts, inserted, notice, commandReturn };
}

test('while a step waits, recipients and quotes reach the Reader\'s writing', t => {
  const f = reader(t, { admits: false, writes: true });
  f.elements['recipient-input'].value = 'fable'; f.r.addRecipient();
  assert.deepEqual(f.reply.draft.addressees, ['fable'], 'a recipient is added');
  f.elements['recipient-chips'].children[0].children.find(node => node.tag === 'button').onclick();
  assert.deepEqual(f.reply.draft.addressees, [], 'a recipient is removed');
  f.r.quote();
  assert.deepEqual(f.inserted, ['> Quoted passage\n\n'], 'the quote is written');
  assert.deepEqual(f.acts, [['edit', 'reply'], ['edit', 'reply']], 'each change is kept as it lands');
  assert.equal(f.notice(), '');
});

test('while a step waits, sending and Save note wait and say why', async t => {
  const f = reader(t, { admits: false, writes: true });
  await f.r.send(false);
  assert.match(f.notice(), STEP_WAITS, 'Send says the step is still opening');
  f.r.notice('');
  f.commandReturn();
  assert.match(f.notice(), STEP_WAITS, '⌘ Return in the reply says so too');
  f.r.notice(''); f.r.mode = 'note';
  f.commandReturn();
  assert.match(f.notice(), STEP_WAITS, '⌘ Return in a private note says so too');
  f.r.notice('');
  f.r.saveNote();
  assert.match(f.notice(), STEP_WAITS, 'Save note says so too');
  assert.deepEqual(f.acts, [], 'nothing is sent or saved');
});

test('a Reader that no longer holds its writing takes nothing and says nothing', async t => {
  const f = reader(t, { admits: false, writes: false });
  f.elements['recipient-input'].value = 'fable'; f.r.addRecipient();
  f.r.quote(); await f.r.send(false); f.r.mode = 'note'; f.commandReturn(); f.r.saveNote();
  assert.deepEqual([f.reply.draft.addressees, f.inserted, f.acts, f.notice()], [[], [], [], '']);
});

test('with no step waiting, ⌘ Return and Save note save the private note', t => {
  const f = reader(t, { admits: true, writes: true });
  f.r.mode = 'note'; f.commandReturn(); f.r.saveNote();
  assert.deepEqual(f.acts, [['saveNote', 'note'], ['saveNote', 'note']]);
  assert.equal(f.notice(), '');
});
