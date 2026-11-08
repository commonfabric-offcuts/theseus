import { Editor } from '/editor.mjs';
import { Reader } from '/reader.mjs';

// Browser interaction fixture only. No API, delivery, runtime or persistence
// claim is made by the callback receipts recorded below.
const sourceRef = { kind: 'message', id: 'fixture-source' };
const context = { instanceId: `reader-fixture-${new URL(location.href).searchParams.get('case')}`, actor: 'fixture-person', sourceRef, topicId: 'fixture-topic' };
const source = {
  source_ref: sourceRef, topic_id: 'fixture-topic', author: 'Fixture writer', title: 'A place to read and reply',
  body: 'The first passage is for an exact quote. The second passage remains distinct.\n\n' +
    Array.from({ length: 32 }, (_, i) => `Paragraph ${i + 1} gives the reader enough text to keep a place. The writing area must remain usable while this source scrolls.`).join('\n\n'),
  attachments: [],
};
const reply = new Editor({ ...context, kind: 'reply' }, { id: 'reply', revision: 1, generation: 'g1', body: '' });
const note = new Editor({ ...context, kind: 'note' }, { id: 'note', revision: 1, body: '' });
const events = [];
let reader;
const callbacks = {
  edit: editor => events.push({ type: 'edit', kind: editor.context.kind, body: editor.draft.body }),
  send: (editor, options) => events.push({ type: 'send', body: editor.draft.body, ...options }),
  // As the app's own: a note saved is true, and the Reader stays open.
  saveNote: async editor => { events.push({ type: 'note', body: editor.draft.body }); return true; },
  close: async (_sessions, reason) => { events.push({ type: 'close', reason }); return true; },
  step: direction => events.push({ type: 'step', direction }),
  destination: topic => events.push({ type: 'destination', topic }),
  reconcile: async () => {},
};
reader = new Reader(callbacks);
const opener = document.createElement('button');
opener.id = 'open-fixture'; opener.textContent = 'Read fixture message';
document.querySelector('#main').replaceChildren(opener);
opener.onclick = () => reader.show(source, { reply, note }, {
  opener, topics: [{ id: 'fixture-topic', title: 'Fixture topic' }], canPrevious: true, canNext: true,
});
// Read-only observations for the test, never invoked to perform an interaction.
window.fixtureSnapshot = () => ({ events: structuredClone(events), reply: reply.snapshot(), note: note.snapshot() });
document.body.dataset.fixtureReady = 'true';
document.body.dataset.fixtureCase = new URL(location.href).searchParams.get('case');
