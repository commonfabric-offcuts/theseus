import assert from 'node:assert/strict';

export function assertFeedCard(state) {
  assert.deepEqual(state, { tag: 'DIV', role: 'button', tabIndex: 0 },
    'approved721 source card is a focusable DIV with button role');
}
export function assertCardDrag(state) {
  assert.deepEqual(state, { selection: 'last', reader: false },
    'approved721 source drag selects exact words and opens no Reader');
}
export function assertInlineReply(state, sourceId) {
  assert.deepEqual(state, { open: true, sourceId, role: 'group', focus: 'writing-body' },
    'approved721 toolbar Reply embeds the one reply surface in its source card');
}
