import test from 'node:test';
import assert from 'node:assert/strict';
import { replyScroll1173 } from './fixtures/reply_scroll_1173.mjs';

test('1173 a phone dossier keeps the persons downward scroll with its inline reply open', t => replyScroll1173(async f => {
  await f.open();
  assert.equal(f.field.closest('.reply-stack'), f.dossier);
  f.emit('resize', { height: 430 }); f.pump(); f.trace.length = 0;
  const start = f.state.pageTop, requested = [20, 40, 60, 80].map(by => start + by), actual = [];
  f.gesture('touchmove');
  for (const [index, top] of requested.entries()) {
    f.userScroll(top); f.emit('scroll', { offsetTop: index % 2 ? 0 : 60 }); f.pump();
    actual.push(f.doc.scrollingElement.scrollTop);
  }
  t.diagnostic(JSON.stringify({ requested, actual, writes: f.trace }));
  assert.deepEqual(f.applications(), [], '1173 only the person writes the page scroll while the inline reply is open');
  assert.deepEqual(actual, requested, '1173 repeated downward scroll positions never oscillate');
  assert.equal(f.root.hidden, false); assert.equal(f.field.value, f.editor.draft.body);
}));
