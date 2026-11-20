import test from 'node:test';
import assert from 'node:assert/strict';
import { holdReplyImages, replyNeedsWide } from '../web/card-replies.mjs';

function field(top, bottom) {
  const rect = { top, bottom, height: bottom - top }, moves = [];
  return { field: { getClientRects: () => [rect], closest: () => ({ getBoundingClientRect: () => rect }) },
    win: { innerHeight: 800, scrollBy: value => moves.push(value) }, moves };
}
test('916 added and removed image strip keeps the reply field bottom in place', () => {
  for (const delta of [160, -160]) {
    const f = field(640 + delta, 740 + delta); holdReplyImages(f.field, delta, f.win);
    assert.deepEqual(f.moves, [{ top: delta, behavior: 'instant' }]);
  }
});
test('916 offscreen reply does not pull the reader away; the keyboard bounds a visible reply', () => {
  const off = field(1200, 1300); holdReplyImages(off.field, 160, off.win); assert.deepEqual(off.moves, []);
  const f = field(420, 520); f.win.visualViewport = { offsetTop: 60, height: 340 };
  holdReplyImages(f.field, 80, f.win); assert.deepEqual(f.moves, [{ top: 120, behavior: 'instant' }]);
});
test('907 temporary Wide detects explicit quotes, typed quote lines and wrapped overflow without changing caret or size', () => {
  const f = { style: { height: '90px', whiteSpace: '' }, scrollTop: 12, scrollHeight: 120 };
  const win = { getComputedStyle: () => ({ lineHeight: '24px', paddingTop: '8px', paddingBottom: '8px' }) };
  assert.equal(replyNeedsWide(f, { body: 'a\n> quoted' }, win), true);
  assert.equal(replyNeedsWide(f, { body: 'wrapped', quotes: [{}] }, win), true);
  assert.equal(replyNeedsWide(f, { body: 'wrapped' }, win), true);
  f.scrollHeight = 112; assert.equal(replyNeedsWide(f, { body: 'four lines' }, win), false);
  assert.deepEqual(f.style, { height: '90px', whiteSpace: '' }); assert.equal(f.scrollTop, 12);
});

test('907 saved reply restoration never unfolds unrelated cards', async () => {
  const { CardReplies } = await import('../web/card-replies.mjs');
  const requested = [], owner = { rows: new Map(), closed: new Set(), queue: new Map(), drain() {} };
  CardReplies.prototype.sync.call(owner, [{ id: 'plain' }, { id: 'saved', yours: { reply: true } }], id => { requested.push(id); return {}; });
  assert.deepEqual(requested, ['saved']); assert.deepEqual([...owner.queue.keys()], ['saved']);
});

test('907 adding then removing a second recipient keeps a whispered reply private by default', async () => {
  const { InlineComposer } = await import('../web/inline-composer.mjs');
  const { choiceOf } = await import('../web/whisper-choice.mjs');
  const draft = { addressees: ['agent-a'], body: '', whisper: null, intent: null };
  const editor = { draft, edit: patch => Object.assign(draft, patch) }, p = { source: { whisper: true }, editors: { reply: editor } };
  const ui = { kind: 'message', cardReply: true, presentation: p, editor, admits: () => true, state: () => ({ readOnly: false }),
    names: () => draft.addressees, kindOf: () => 'agent', callbacks: { edit() {} }, paintRecipients() {}, paintChoice() {} };
  InlineComposer.prototype.addName.call(ui, 'agent-b');
  assert.deepEqual(choiceOf(draft, draft.addressees, ui.kindOf), { choice: 'tell', switched: true });
  InlineComposer.prototype.removeName.call(ui, 'agent-b');
  assert.equal(choiceOf(draft, draft.addressees, ui.kindOf).choice, 'whisper');
});
