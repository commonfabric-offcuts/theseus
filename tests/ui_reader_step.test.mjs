import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../web/editor.mjs';
import { Reader } from '../web/reader.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

// While a step to another message waits, the Reader's own writing goes on:
// recipients and quotes reach it like typing. Sending and a note's Done wait, and
// say why. A Reader that no longer holds its writing takes none of these.
const STEP_WAITS = /Another message is still opening\. Your writing is kept; images and sending wait until it opens\./;

function reader(t, { admits, writes }) {
  const previous = { document: globalThis.document, window: globalThis.window };
  const document = miniDocument();
  globalThis.document = document;
  globalThis.window = { getSelection: () => null };
  t.after(() => Object.assign(globalThis, previous));
  const context = { instanceId: 'reader-step', actor: 'fixture-person', sourceRef: { kind: 'message', id: 'm1' }, topicId: 't1' };
  const reply = new Editor({ ...context, kind: 'reply' }, { id: 'reply', revision: 1, generation: 'g1', body: '' });
  const note = new Editor({ ...context, kind: 'note' }, { id: 'note', revision: 1, body: 'A private note' });
  const elements = { 'reader-notice': Object.assign(document.createElement('p'), { hidden: true }), 'recipient-input': document.createElement('input'),
    'recipient-chips': Object.assign(document.createElement('div'), { root: true }), 'intent-row': Object.assign(document.createElement('div'), { id: 'intent-row' }),
    'send-reply': document.createElement('button') };
  const kinds = { fable: 'agent', warp: 'agent', tony: 'human' };
  const acts = [], inserted = [];
  const r = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply, note }, mode: 'reply', presentation: {}, source: { source_ref: context.sourceRef, body: 'Quoted passage' },
    field: document.createElement('textarea'), $: id => elements[id],
    selectedPassage: () => 'Quoted passage', insertText: text => inserted.push(text), disarm() {},
    callbacks: { admits: () => admits, writes: () => writes, reach: () => ({ reachable: true }),
      edit: editor => acts.push(['edit', editor.context.kind]), send: () => acts.push(['send']), saveNote: editor => acts.push(['saveNote', editor.context.kind]),
      people: () => ({ kindOf: name => kinds[name], everyone: ['fable', 'warp'] }) },
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

test('Whisper, Tell or Ask follows who the reply names, keeps the person\'s choice, and goes with the last name', t => {
  const f = reader(t, { admits: true, writes: true });
  const row = f.elements['intent-row'];
  const state = () => {
    const chips = row.querySelectorAll('button[data-intent]');
    return { checked: chips.find(chip => chip.getAttribute('aria-pressed') === 'true')?.dataset.intent, disabled: chips.filter(chip => chip.disabled).map(chip => chip.dataset.intent) };
  };
  const remove = name => f.elements['recipient-chips'].children.find(chip => chip.dataset.name === name).querySelector('button').onclick();
  f.r.paintChoice();
  assert.deepEqual(state(), { checked: 'tell', disabled: ['whisper', 'ask'] }, 'a reply to nobody can neither whisper nor ask');
  f.r.choose('ask');
  assert.equal(f.reply.draft.intent, 'ask', 'a choice made before naming anyone is still the person\'s');
  f.r.paintChoice();
  assert.equal(state().checked, 'tell', 'but a reply to nobody goes as neither');
  f.elements['recipient-input'].value = 'tony'; f.r.addRecipient();
  assert.deepEqual(state(), { checked: 'ask', disabled: ['whisper'] }, 'named, the Ask chosen earlier holds; a person is never whispered to');
  remove('tony');
  assert.deepEqual([f.reply.draft.addressees, f.reply.draft.intent, f.reply.draft.whisper], [[], null, null], 'the last name taken away takes the choice with it');
  f.elements['recipient-input'].value = 'fable'; f.r.addRecipient();
  assert.deepEqual(state(), { checked: 'whisper', disabled: [] }, 'one agent named: a whisper');
  f.r.choose('ask');
  assert.deepEqual([f.reply.draft.intent, f.reply.draft.whisper, state().checked], ['ask', false, 'ask']);
  f.elements['recipient-input'].value = 'warp'; f.r.addRecipient();
  remove('fable');
  assert.deepEqual([f.reply.draft.addressees, f.reply.draft.intent, state().checked], [['warp'], 'ask', 'ask'], 'Ask stays while someone is named');
  f.r.choose('tell');
  assert.deepEqual([f.reply.draft.intent, state().checked], ['tell', 'tell'], 'a Tell chosen with one agent is not made a whisper');
  assert.equal(f.acts.filter(([act]) => act === 'edit').length, 8, 'each change is kept as it lands');
});

test('while a step waits, sending and a note\'s Done wait and say why', async t => {
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
  assert.match(f.notice(), STEP_WAITS, 'Done on a note says so too');
  assert.deepEqual(f.acts, [], 'nothing is sent or saved');
});

test('a Reader that no longer holds its writing takes nothing and says nothing', async t => {
  const f = reader(t, { admits: false, writes: false });
  f.elements['recipient-input'].value = 'fable'; f.r.addRecipient();
  f.r.quote(); await f.r.send(false); f.r.mode = 'note'; f.commandReturn(); f.r.saveNote();
  assert.deepEqual([f.reply.draft.addressees, f.inserted, f.acts, f.notice()], [[], [], [], '']);
});

test('with no step waiting, ⌘ Return and Done save the private note', t => {
  const f = reader(t, { admits: true, writes: true });
  f.r.mode = 'note'; f.commandReturn(); f.r.saveNote();
  assert.deepEqual(f.acts, [['saveNote', 'note'], ['saveNote', 'note']]);
  assert.equal(f.notice(), '');
});
