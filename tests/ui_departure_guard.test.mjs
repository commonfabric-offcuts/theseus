import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../web/editor.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { EditorSession } from '../web/session.mjs';
import { TopicNavigation } from '../web/topic-navigation.mjs';

const complete = { instance_id: 'i', items: [], next_cursor: null, through: 0 };
// A real registry, session and departure guard over one topic composer whose
// server list of replies not sent was read as `page` (null: never read).
function guarded(page = complete) {
  const registry = Object.create(EditorRegistry.prototype);
  Object.assign(registry, { sessions: new Map(), localWrites: new Map(), pages: new Map(), inline: null, current: null, disposed: false,
    flush: async () => ({ recorded: true, status: 'committed' }), keepEditorsLocal: async () => {} });
  const editor = new Editor({ instanceId: 'i', actor: 'fixture', sourceRef: { kind: 'topic', id: 't' }, topicId: 't', kind: 'reply' }, { id: 'd', revision: 0, generation: 'g' });
  const session = Object.assign(Object.create(EditorSession.prototype), { editor, sends: new Map() });
  registry.sessions.set(editor.key, session);
  if (page) registry.pages.set(editor.key, page);
  const visits = [], navigation = new TopicNavigation({ registry, shown: editor => registry.inDoubt.find(entry => entry.editor === editor)?.label, topicId: 't', navigate: id => visits.push(id) });
  // What leaving says: null when it left.
  const leave = async () => { try { await navigation.open('b'); return null; } catch (error) { return error.message; } };
  return { registry, editor, session, visits, leave, label: () => registry.doubt(editor).label };
}

test('registry unload protection follows active sends, not settled or historical submissions', () => {
  const { registry, editor, session } = guarded();
  editor.edit({ body: 'Exact send' }); const item = editor.beginPrepare({ prepareOperationId: 'p', sendOperationId: 's', submissionId: 'sub' });
  assert.equal(editor.dirty, false, 'actual beginPrepare makes the successor clean');
  session.sends.set(item.id, Promise.resolve()); assert.equal(registry.hasUnprotectedWriting, true, 'beforeunload protects an active chain');
  assert.equal(registry.hasInFlightSend, true); session.sends.clear();
  assert.equal(registry.hasUnprotectedWriting, false, 'settled preparation alone does not trap reload');
  for (const state of ['confirmed', 'refused']) { item.status = state; assert.equal(registry.hasUnprotectedWriting, false); }
  registry.localWrites.set(editor.key, { pending: true }); assert.equal(registry.hasUnprotectedWriting, true, 'existing durability guard remains');
});

// Item 118: while a reply is on its way there is no Review button, so the
// wait names none; once its send ends unanswered the button shows, and
// leaving names it by its words.
test('while a reply is on its way leaving waits and points at no Review button; once its send ends unanswered leaving names the button it shows', async () => {
  const f = guarded();
  f.editor.edit({ body: 'Exact send' });
  const item = f.editor.beginPrepare({ prepareOperationId: 'p', sendOperationId: 's', submissionId: 'sub' });
  f.session.sends.set(item.id, new Promise(() => {}));
  assert.equal(f.label(), null, 'no Review button while it goes');
  assert.equal(await f.leave(), 'Wait for the send to finish before changing topics.', 'leaving waits, and names no button');
  f.session.sends.clear();
  assert.equal(f.label(), 'Review 1 reply', 'its send ended unanswered: it is in doubt');
  const refusal = await f.leave();
  assert.ok(refusal?.includes('Use “Review 1 reply” to check'), 'leaving names the button the page shows: ' + refusal);
  assert.equal(await f.leave(), null, 'a second choice of the same topic leaves'); assert.deepEqual(f.visits, ['b']);
});

// Item 118: the button and the departure guard are one answer, so in every
// state leaving asks exactly when a Review button shows, and names it.
test('leaving asks for a second choice exactly when a Review button shows, and names it', async () => {
  const held = { id: 'a', status: 'prepared', preparationConfirmed: true, prepareReceipt: { result: { seq: 7 } } };
  const states = [
    ['a reply confirmed here', [{ id: 'a', status: 'confirmed' }], complete, null],
    ['a reply held here as prepared, its send answer lost, that the server lists as sent', [held], { ...complete, items: [{ id: 'a', send_status: 'committed' }], through: 9 }, null],
    ['a reply prepared here that a whole read of the list after it does not hold, so it went', [held], { ...complete, through: 9 }, null],
    ['the same reply, read before it was prepared', [held], { ...complete, through: 6 }, 'Review 1 reply'],
    ['the same reply, listed as not sent', [held], { ...complete, items: [{ id: 'a', send_status: 'unknown' }], through: 9 }, 'Review 1 reply'],
    ['the same reply, the list not read to its end', [held], { ...complete, next_cursor: 3, through: 9 }, 'Review 1+ replies'],
    ['a reply prepared here with no answer for it', [{ id: 'a', status: 'prepared', preparationConfirmed: true }], { ...complete, through: 9 }, 'Review 1 reply'],
    ['a refused reply', [{ id: 'a', status: 'refused' }], complete, 'Review 1 reply'],
    ['an earlier runtime’s reply', [{ id: 'a', status: 'prepared', detached: true }], complete, 'Review 1 reply'],
    ['a refusal whose correction went', [{ id: 'a', status: 'refused', correctedBy: 'b' }, { id: 'b', status: 'confirmed' }], complete, null],
    ['a reply only the server lists, not sent', [], { ...complete, items: [{ id: 's', send_status: 'unknown' }], through: 3 }, 'Review 1 reply'],
    ['a reply only the server lists, checked as sent', [], { ...complete, items: [{ id: 's', send_status: 'committed' }], through: 3 }, null],
    ['two replies, one more unread', [], { ...complete, items: [{ id: 's', send_status: 'unknown' }, { id: 't', send_status: 'rejected' }], next_cursor: 9, through: 30 }, 'Review 2+ replies'],
    ['a list never read', [], null, 'Review more replies'],
  ];
  for (const [name, submissions, page, label] of states) {
    const f = guarded(page); f.editor.submissions = submissions;
    assert.equal(f.label(), label, name + ': the button');
    const refusal = await f.leave();
    if (label === null) { assert.equal(refusal, null, name + ': leaving goes at once'); assert.deepEqual(f.visits, ['b'], name); }
    else { assert.ok(refusal?.includes(`Use “${label}” to check`), name + ': leaving names the button: ' + refusal); assert.deepEqual(f.visits, [], name); }
  }
});
