import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Editor } from '../web/editor.mjs';
import { Reader } from '../web/reader.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

// The Reader and reply box, finished (pipeline 22, 74, 75, 76, 27, 28): the
// heading is the topic's name and goes back to it, the note button says what
// a press does and shows a note is there, Done keeps the Reader open, the
// arrows follow the page, and a quote leaves the cursor drawn after it. The
// page's own look, focus ring and native gestures are in
// tests/reader_native.mjs --finished.

function reader(t, { noteBody = '' } = {}) {
  const previous = { document: globalThis.document, window: globalThis.window };
  const document = miniDocument(), order = [];
  globalThis.document = document;
  globalThis.window = { getSelection: () => ({ removeAllRanges: () => order.push('selection let go') }) };
  t.after(() => Object.assign(globalThis, previous));
  const context = { instanceId: 'reader-finished', actor: 'fixture-person', sourceRef: { kind: 'message', id: 'm1' }, topicId: 't1' };
  const reply = new Editor({ ...context, kind: 'reply' }, { id: 'reply', revision: 1, generation: 'g1', body: '' });
  const note = new Editor({ ...context, kind: 'note' }, { id: 'note', revision: 1, body: noteBody });
  const ids = ['reader-title', 'toggle-note', 'reader-notice'];
  const elements = Object.fromEntries(ids.map(id => [id, Object.assign(document.createElement(id === 'reader-title' ? 'h2' : 'button'), { id })]));
  elements['reader-notice'].hidden = true;
  const field = document.createElement('textarea');
  Object.assign(field, { scrollTop: 0, scrollHeight: 900, selection: null });
  field.focus = () => { order.push('field focused'); document.activeElement = field; };
  field.setSelectionRange = (start, end) => { field.selection = [start, end]; };
  const acts = [];
  const r = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply, note }, mode: 'reply', presentation: {}, dialog: { open: true }, positions: new Map(), sourceBody: { scrollTop: 0 },
    source: { source_ref: context.sourceRef, topic_id: 't1', body: 'Quoted passage' }, field, $: id => elements[id],
    selectedPassage: () => 'Quoted passage', disarm() {}, input: { readOnly: () => false, terminalKey: () => false },
    insertText(text) { field.value += text; },
    callbacks: { admits: () => true, writes: () => true, edit: editor => acts.push(['edit', editor.context.kind]),
      step: direction => acts.push(['step', direction]), close: reason => acts.push(['close', reason]) },
  });
  r.close = reason => acts.push(['close', reason]);
  const notice = () => elements['reader-notice'].hidden ? '' : elements['reader-notice'].textContent;
  return { r, reply, note, elements, field, acts, order, notice };
}

const command = (key, { target = { closest: () => null }, shiftKey = false } = {}) => {
  const event = { key, metaKey: true, shiftKey, altKey: false, ctrlKey: false, keyCode: 0, isComposing: false, repeat: false,
    target, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
  return event;
};

test('a message\'s heading is its topic\'s name, and a press on it goes back to the topic', t => {
  const f = reader(t);
  f.r.paintTitle(f.r.source, [{ id: 't0', title: 'Another topic' }, { id: 't1', title: 'Building: the Reader' }]);
  const heading = f.elements['reader-title'];
  const topic = heading.children.find(node => node.tag === 'button');
  assert.equal(topic?.text, 'Building: the Reader', 'the heading names the message\'s own topic');
  assert.equal(heading.text, 'Building: the Reader', 'and says nothing else: no "Message"');
  assert.deepEqual(f.acts, [], 'painting goes nowhere');
  topic.onclick();
  assert.deepEqual(f.acts, [['close', 'parent']], 'a press goes back to the topic, as the arrow beside it does');

  const plain = (source, label) => {
    const g = reader(t);
    g.r.paintTitle(source, [{ id: 't1', title: 'Building: the Reader' }]);
    const shown = g.elements['reader-title'];
    assert.deepEqual([shown.text, shown.children.some(node => node.tag === 'button')], [label.words, false], label.why);
  };
  plain({ source_ref: { kind: 'memory', id: 'n1', revision: 2 } }, { words: 'Notebook', why: 'a Notebook page is not a topic to go back to' });
  plain({ source_ref: { kind: 'message', id: 'm9' }, topic_id: 'gone' }, { words: 'Message', why: 'a topic the page does not list leaves the plain heading' });
});

test('the note button says what a press does, and shows when the message has a note', t => {
  const toggle = f => [f.elements['toggle-note'].textContent, Object.hasOwn(f.elements['toggle-note'].attributes, 'data-has-note')];
  const none = reader(t);
  none.r.paintNoteToggle();
  assert.deepEqual(toggle(none), ['Add note', false], 'no note yet: Add note, plain');
  const blank = reader(t, { noteBody: '  \n' });
  blank.r.paintNoteToggle();
  assert.deepEqual(toggle(blank), ['Add note', false], 'a note of only spaces is no note');
  const some = reader(t, { noteBody: 'Remember to ask about the deploy' });
  some.r.paintNoteToggle();
  assert.deepEqual(toggle(some), ['Show note', true], 'a note: Show note, wearing the note\'s fill');
  some.r.mode = 'note'; some.r.paintNoteToggle();
  assert.deepEqual(toggle(some), ['Back to reply', false], 'while writing the note it goes back to the reply');
});

test('Done keeps the Reader open and goes back to the reply; a note not saved stays in front and says so', async t => {
  for (const [answer, mode, words] of [[true, 'reply', ''], [false, 'note', 'Not saved yet. Your note is kept here; press Done to try again.'], [null, 'note', '']]) {
    const f = reader(t, { noteBody: 'Private words' });
    f.r.mode = 'note';
    f.r.callbacks.saveNote = async editor => { f.acts.push(['saveNote', editor.context.kind]); return answer; };
    f.r.switchMode = next => { f.acts.push(['switchMode', next]); f.r.mode = next; };
    await f.r.saveNote();
    assert.equal(f.r.mode, mode, `answer ${answer}: the Reader is in its ${mode}`);
    assert.equal(f.notice(), words, `answer ${answer}: what the Reader says`);
    assert.equal(f.acts.some(([act]) => act === 'close'), false, `answer ${answer}: Done never closes the Reader`);
  }
  // A step that began while the save was out goes on undisturbed.
  const f = reader(t, { noteBody: 'Private words' });
  f.r.mode = 'note';
  f.r.callbacks.saveNote = async () => { f.r.presentation = {}; return true; };
  f.r.switchMode = next => f.acts.push(['switchMode', next]);
  await f.r.saveNote();
  assert.deepEqual(f.acts.filter(([act]) => act === 'switchMode'), [], 'a newer presentation is not switched back to the reply');
});

test('the arrows follow the page: ⌘↑ opens the message above (newer), ⌘↓ the one below (older)', t => {
  const f = reader(t);
  const up = command('ArrowUp'), down = command('ArrowDown');
  f.r.key(up); f.r.key(down);
  assert.deepEqual(f.acts, [['step', 1], ['step', -1]], 'the newest message is on top, so up is newer');
  assert.deepEqual([up.prevented, down.prevented], [true, true]);
  f.acts.length = 0;
  f.r.key(command('ArrowLeft')); f.r.key(command('ArrowRight'));
  assert.deepEqual(f.acts, [], '⌘← and ⌘→ no longer step');
  f.r.key(command('ArrowUp', { shiftKey: true }));
  assert.deepEqual(f.acts, [], '⇧⌘↑ is not a step');
  f.r.key(command('ArrowUp', { target: f.field }));
  assert.deepEqual(f.acts, [], 'in the writing, ⌘↑ is the field\'s own');
  f.r.source = { source_ref: { kind: 'memory', id: 'n1', revision: 1 }, body: '' };
  f.r.key(command('ArrowDown'));
  assert.deepEqual(f.acts, [], 'a Notebook page has no neighbours to step to');
  f.r.source = { source_ref: { kind: 'message', id: 'm1' }, body: '' };
  f.r.stepTo('above'); f.r.stepTo('below');
  assert.deepEqual(f.acts, [['step', 1], ['step', -1]], 'the buttons step by the same rule');
});

test('a quote lets go of the message\'s selection before the field takes focus, and leaves the cursor after it, in view', t => {
  const f = reader(t);
  f.r.quote();
  assert.equal(f.field.value, '> Quoted passage\n\n');
  assert.deepEqual(f.order, ['selection let go', 'field focused'],
    'once the field has focus the selection is its caret: letting go after would leave no cursor drawn');
  assert.deepEqual(f.field.selection, [f.field.value.length, f.field.value.length], 'the cursor sits after the quote and its blank line');
  assert.equal(f.field.scrollTop, f.field.scrollHeight, 'the field scrolls so the cursor is in view');
});

test('the page: the note button sits before Add image, no Reply row, the hint says what Shift-click and Return do, the arrows go up and down', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const reader = html.slice(html.indexOf('<dialog id="reader"'), html.indexOf('</dialog>', html.indexOf('<dialog id="reader"')));
  const footer = reader.slice(reader.indexOf('<footer class="writing-footer">'), reader.indexOf('</footer>', reader.indexOf('<footer class="writing-footer">')));
  assert.match(footer, /^<footer class="writing-footer">\s*<button id="toggle-note" type="button">Add note<\/button>\s*<button id="add-image"/, 'Add note opens the reply\'s lower row, just before Add image');
  assert.equal((reader.match(/id="toggle-note"/g) ?? []).length, 1, 'there is one note button');
  assert.doesNotMatch(reader, /writing-heading|<h3[^>]*>Reply</, 'no "Reply" heading row over the writing');
  assert.match(reader, /<textarea id="writing-body"[^>]*placeholder="Write a reply…"/, 'the field says what it is');
  assert.match(reader, /<span class="muted">Shift-click extends the lit passage · Return inserts it as a quote<\/span>/);
  assert.match(reader, /<button id="reader-parent"[^>]*aria-label="Back to the topic"[^>]*>←<\/button>/, 'the back button is its arrow, named for a screen reader');
  assert.match(reader, /<div id="reader-stepping"><button id="next-message"[^>]*aria-label="Newer message \(above\)"[^>]*>↑<\/button><button id="previous-message"[^>]*aria-label="Older message \(below\)"[^>]*>↓<\/button><\/div>/,
    'up (newer) comes first, then down (older)');
});
