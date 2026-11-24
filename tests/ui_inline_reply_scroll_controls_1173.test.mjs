import test from 'node:test';
import assert from 'node:assert/strict';
import { replyScroll1173 } from './fixtures/reply_scroll_1173.mjs';

test('1173 a person scroll interrupts keyboard settling already between its two frames', () => replyScroll1173(async f => {
  await f.open(); f.emit('resize', { height: 430 }); f.step();
  assert.ok(f.frames.size > 0);
  f.gesture('touchmove'); f.userScroll(120); f.emit('scroll', { offsetTop: 30 }); f.pump();
  assert.deepEqual(f.applications(), []); assert.equal(f.state.pageTop, 120);
  assert.equal(f.field.value, f.editor.draft.body);
}));

test('1173 wheel scrolling also owns the phone page after the keyboard has settled', () => replyScroll1173(async f => {
  await f.open(); f.emit('resize', { height: 430 }); f.pump(); f.trace.length = 0;
  const wanted = f.state.pageTop + 100;
  f.gesture('wheel'); f.userScroll(wanted); f.emit('scroll', { offsetTop: 40 }); f.pump();
  assert.deepEqual(f.applications(), []); assert.equal(f.state.pageTop, wanted);
}));

test('1173 deliberate writing after a person scroll can reveal the field again', () => replyScroll1173(async f => {
  await f.open(); f.emit('resize', { height: 430 }); f.pump();
  f.gesture('touchmove'); f.userScroll(f.state.pageTop - 200); f.trace.length = 0;
  f.input(); f.pump();
  assert.equal(f.applications().length, 1); assert.equal(f.applications()[0].owner, 'scrollBy');
  assert.equal(f.state.sendBottom, 422);
  assert.deepEqual([f.field.selectionStart, f.field.selectionEnd], [3, 11]);
}));

test('1173 inline opening and the existing close owner retain the exact draft after scrolling', () => replyScroll1173(async f => {
  const draft = JSON.parse(JSON.stringify(f.editor.draft));
  await f.open(); assert.equal(f.root.hidden, false); assert.equal(f.doc.activeElement, f.field);
  f.gesture('touchmove'); f.userScroll(60);
  assert.equal(await f.close(), true); assert.equal(f.root.hidden, true); assert.equal(f.doc.activeElement, f.card);
  assert.deepEqual(f.kept, [draft]); assert.deepEqual(f.editor.draft, draft);
  await f.open(); assert.equal(f.root.hidden, false); assert.equal(f.field.value, draft.body);
  assert.deepEqual(f.editor.draft, draft); assert.ok(f.focusOptions.every(value => value.preventScroll === true));
}));
