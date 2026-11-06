import test from 'node:test';
import assert from 'node:assert/strict';
import { Reader } from '../web/reader.mjs';

function fixture({ mode = 'reply', readOnly = false, authorityRecovery = null } = {}) {
  const calls = [], notices = [], selected = [];
  const editor = { authorityRecovery }, presentation = {};
  const uploads = {
    reserve: shown => { assert.equal(shown, presentation); return { shown }; },
    choose: async (token, file) => { calls.push({ token, file }); },
  };
  const reader = Object.assign(Object.create(Reader.prototype), {
    mode, sessions: { reply: editor, note: {} }, presentation,
    callbacks: { uploads: value => { selected.push(value); return uploads; } },
    writingReadOnly: () => readOnly, notice: text => notices.push(text), paintStatus() {},
  });
  const event = (files = []) => ({
    clipboardData: { items: files.map(file => ({ type: file.type, getAsFile: () => file })) },
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
  });
  return { reader, calls, notices, selected, editor, event };
}
const picture = name => new File(['image fixture'], name, { type: 'image/png' });

test('paste captures each image in its original presentation, naming nameless blobs', async () => {
  const f = fixture(), event = f.event([picture(''), picture('second.png')]);
  await f.reader.paste(event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(f.calls.map(x => x.file.name), ['pasted.png', 'second.png']);
  assert.equal(await f.calls[0].file.text(), 'image fixture');
  assert.deepEqual(f.notices, []);
  assert.deepEqual(f.selected, [f.editor]);
});
for (const [name, options] of [
  ['private note', { mode: 'note' }],
  ['read-only writing', { readOnly: true }],
  ['authority review', { authorityRecovery: { phase: 'ready' } }],
]) test(`image paste visibly refuses ${name} without choosing or queuing`, async () => {
  const f = fixture(options), event = f.event([picture('image.png')]);
  await f.reader.paste(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.calls.length, 0);
  assert.equal(f.notices.length, 1);
  assert.match(f.notices[0], /note|read.only|review|runtime/i);
});
test('text-only paste keeps its native default even in a private note', async () => {
  const f = fixture({ mode: 'note' }), event = f.event();
  await f.reader.paste(event);
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.notices, []);
});

test('a late paste refusal cannot appear on a different reader', async () => {
  const f = fixture(); let reject;
  f.reader.callbacks.uploads = () => ({ reserve: () => ({}), choose: () => new Promise((_resolve, failed) => { reject = failed; }) });
  const pending = f.reader.paste(f.event([picture('image.png')]));
  f.reader.presentation = {}; f.reader.sessions = { reply: {} };
  reject(Error('Original image was refused')); await pending;
  assert.deepEqual(f.notices, [], 'a different reader must not inherit the original paste error');
});

// A paste while Close keeps the writing is refused with the reason: the
// Reader is closing, not waiting for another message; while a step waits it
// is the step.
for (const [closing, notice] of [[true, 'This reply is closing, so the image was not added.'],
  [false, 'Another message is still opening. Your writing is kept; images and sending wait until it opens.']]) {
  test(`an image pasted while the Reader ${closing ? 'closes' : 'waits for a step'} is refused and says why`, async () => {
    const f = fixture(), event = f.event([picture('image.png')]);
    Object.assign(f.reader.callbacks, { admits: () => false, writes: () => false, closing: shown => closing && shown === f.reader.presentation });
    await f.reader.paste(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.notices, [notice]);
  });
}
