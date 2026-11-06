import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicStatePanel, paintState, paintWaiting, paintWork, readableTime, stateLabel, workNote } from '../web/topic-state.mjs';

// A small DOM with parents and one focused element. Detaching the focused
// element, or an ancestor of it, sends focus to the body, as a browser does;
// putting a node back does not give it focus again.
class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], dataset: {}, attributes: {}, hidden: false, classes: new Set(), parent: null }); }
  get classList() { return { add: name => this.classes.add(name) }; }
  set className(value) { this.classes = new Set(value.split(' ').filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  adopt(node) { if (node instanceof Element) { node.remove(); node.parent = this; } return typeof node === 'string' ? { text: node } : node; }
  append(...nodes) { this.children.push(...nodes.map(node => this.adopt(node))); }
  replaceChildren(...nodes) { for (const node of [...this.children]) if (node instanceof Element) node.remove(); else this.children.splice(this.children.indexOf(node), 1); this.append(...nodes); }
  insertBefore(node, before) { const adopted = this.adopt(node); this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, adopted); }
  remove() {
    if (!this.parent) return;
    if (focus.on && (focus.on === this || this.contains(focus.on))) focus.on = null;
    this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null;
  }
  contains(node) { return this.all().includes(node); }
  get root() { return this.parent ? this.parent.root : this; }
  focus() { focus.on = this; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  querySelector(selector) { return this.all().find(node => node.tag === selector) ?? null; }
  all() { return this.children.flatMap(node => node instanceof Element ? [node, ...node.all()] : []); }
  get text() { return (this.textContent ?? '') + this.children.map(node => node instanceof Element ? node.text : node.text).join(''); }
  find(predicate) { return this.all().find(predicate); }
}
const focus = { on: null };
function dom(t) {
  const previous = globalThis.document;
  focus.on = null;
  globalThis.document = { createElement: tag => new Element(tag), get activeElement() { return focus.on; } };
  t.after(() => { globalThis.document = previous; });
}
const CHANGED = 'This topic changed while you were choosing. What you chose is kept here: check it against the line above and save again.';
const NOT_SENT = 'That was not sent: another change was still being saved. Press it again.';
const topic = (fields = {}) => ({ id: 't1', version: 4, title: 'Naming', owner_id: 'tony', creator_id: 'tony', state: 'active',
  state_note: '', state_by: null, state_ms: null, waiting_on: [], archived: false, ...fields });

test('a time reads like 7:41 AM Thu Nov 5 in the reader\'s zone', () => {
  assert.equal(readableTime(new Date(2026, 10, 5, 7, 41).getTime()), '7:41 AM Thu Nov 5');
  assert.equal(readableTime(new Date(2026, 10, 5, 17, 4).getTime()), '5:04 PM Thu Nov 5');
});

test('labels name who a topic waits on, the reader as you', () => {
  assert.equal(stateLabel(topic({ state: 'waiting', waiting_on: ['tony', 'fable'] }), 'tony'), 'Waiting on you, fable');
  assert.equal(stateLabel(topic({ state: 'waiting' }), 'tony'), 'Waiting');
  assert.equal(stateLabel(topic({ state: 'review' }), 'tony'), 'Ready for review');
  assert.equal(stateLabel(topic({ state: 'done' }), 'tony'), 'Done');
  assert.equal(stateLabel(topic({ state: 'unknown' }), 'tony'), 'Active');
});

test('a row is marked unless its topic is simply active, marked as mine when it waits on the reader, and titled with its whole words', t => {
  dom(t);
  const row = item => { const host = new Element('a'); paintState(host, item, 'tony'); return host.children.map(c => [c.className, c.textContent, c.dataset.state, c.title ?? null]); };
  assert.deepEqual(row(topic()), []);
  assert.deepEqual(row({}), []);
  assert.deepEqual(row(topic({ state: 'waiting', waiting_on: ['tony'], state_note: 'Pick one' })), [['topic-state mine', 'Waiting on you', 'waiting', 'Waiting on you · Pick one']]);
  assert.deepEqual(row(topic({ state: 'waiting', waiting_on: ['fable'] })), [['topic-state', 'Waiting on fable', 'waiting', 'Waiting on fable']]);
  assert.deepEqual(row(topic({ state: 'done' })), [['topic-state', 'Done', 'done', 'Done']]);
  // Core sends the list sorted; the reader still comes first, so a list cut short never cuts them.
  assert.deepEqual(row(topic({ state: 'waiting', waiting_on: ['aim-ux', 'fable', 'tony'] })), [['topic-state mine', 'Waiting on you, aim-ux, fable', 'waiting', 'Waiting on you, aim-ux, fable']]);
});

test('the panel line says who said it and when; only those who may change it get the form', t => {
  dom(t);
  const host = new Element('section'), sent = [];
  const panel = new TopicStatePanel({ host, reader: 'fable', send: async (...args) => { sent.push(args); return { status: 'committed', result: {} }; } });
  const said = topic({ state: 'waiting', waiting_on: ['tony'], state_note: 'Which name?', state_by: 'fable', state_ms: new Date(2026, 10, 5, 7, 41).getTime() });
  panel.paint(said, [{ actor_id: 'fable' }]);
  assert.equal(host.hidden, false);
  assert.equal(host.children[0].text, 'Waiting on tony · Which name? — you, 7:41 AM Thu Nov 5');
  const mark = host.children[0].children[0];
  assert.equal(mark.title, 'Waiting on tony', 'its whole words are its title');
  assert.equal(mark.classes.has('mine'), false, 'it waits on someone else');
  const mine = new TopicStatePanel({ host: new Element('section'), reader: 'tony', send: async () => ({}) });
  mine.paint(said, []);
  assert.equal(mine.host.children[0].children[0].classes.has('mine'), true, 'the panel marks a state that waits on the reader');
  const form = host.find(node => node.tag === 'details');
  assert.ok(form, 'a participant may say where it stands');
  assert.equal(host.find(node => node.id === 'topic-rename'), undefined, 'a participant who is not its creator or owner cannot rename it');
  panel.paint(said, [{ actor_id: 'someone-else' }]);
  assert.equal(host.find(node => node.tag === 'details'), undefined, 'a reader who does not work in it gets no form');
  const owner = new TopicStatePanel({ host: new Element('section'), reader: 'tony', send: async () => ({}) });
  owner.paint(said, []);
  assert.ok(owner.host.find(node => node.id === 'topic-rename'));
  assert.equal(owner.host.find(node => node.textContent === 'Archive')?.tag, 'button');
});

// The form's controls, found by what the person sees.
const controls = host => ({
  details: host.find(node => node.tag === 'details'),
  choice: host.find(node => node.id === 'topic-state-choice'), note: host.find(node => node.id === 'topic-state-note'),
  waiting: host.find(node => node.id === 'topic-state-waiting'), title: host.find(node => node.id === 'topic-rename'),
  save: host.find(node => node.textContent === 'Save'), rename: host.find(node => node.textContent === 'Rename'),
  notice: host.find(node => node.classes.has('notice')),
});
const type = (input, value) => { input.value = value; input.oninput?.(); };
const choose = (select, value) => { select.value = value; select.onchange(); };
// What Core answers to a committed topic.update: the topic as it now stands.
const committed = (current, args, version = current.version + 1) => ({ status: 'committed', result: {
  topic_id: current.id, version, title: args.title ?? current.title, archived: args.archived ?? current.archived,
  state: args.state ?? current.state, note: args.note ?? current.state_note, waiting_on: args.waiting_on ?? [],
  state_by: 'tony', state_ms: null } });

test('Save sends the chosen state, its note, and who it waits on only while waiting', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  const panel = new TopicStatePanel({ host, reader: 'tony',
    send: async (current, args) => { sent.push([current.id, current.version, args]); return committed(current, args); } });
  panel.paint(topic(), []);
  const { choice, note, waiting, save } = controls(host);
  choose(choice, 'waiting'); type(note, 'Your call'); type(waiting, 'fable, tony, fable,');
  await save.onclick();
  choose(choice, 'done'); type(note, '');
  await save.onclick();
  assert.deepEqual(sent, [['t1', 4, { state: 'waiting', note: 'Your call', waiting_on: ['fable', 'tony'] }], ['t1', 5, { state: 'done', note: '' }]]);
});

test('a repaint from fresh data keeps what the person typed and their focus; untouched fields follow the data', t => {
  dom(t);
  const host = new Element('section');
  const panel = new TopicStatePanel({ host, reader: 'tony', send: async () => assert.fail('nothing is sent') });
  panel.paint(topic(), [{ actor_id: 'tony' }]);
  const before = controls(host);
  before.details.open = true;
  choose(before.choice, 'waiting'); type(before.note, 'Pick a name'); type(before.waiting, 'fable');
  before.note.focus();
  // Someone posts a message: the topic's version moves on and the page repaints it.
  panel.paint(topic({ version: 5, title: 'Naming, again' }), [{ actor_id: 'tony' }]);
  const after = controls(host);
  assert.equal(after.note, before.note, 'the same field, not a rebuilt one');
  assert.equal(document.activeElement, before.note, 'focus stays where the person left it');
  assert.deepEqual([after.choice.value, after.note.value, after.waiting.value, after.details.open], ['waiting', 'Pick a name', 'fable', true]);
  assert.equal(after.waiting.parent.hidden, false, 'the waiting field stays shown while Waiting is chosen');
  assert.equal(after.title.value, 'Naming, again', 'an untouched title follows the data');
  type(after.title, 'My title');
  // Another participant says where it stands: what the person typed is kept,
  // what they did not touch shows the news.
  panel.paint(topic({ version: 6, title: 'Theirs', state: 'review', state_note: 'Look please' }), [{ actor_id: 'tony' }]);
  assert.deepEqual([after.choice.value, after.note.value, after.waiting.value, after.title.value], ['waiting', 'Pick a name', 'fable', 'My title']);
  assert.match(host.children[0].text, /^Ready for review · Look please/);
  // An older read that lands late changes nothing.
  panel.paint(topic({ version: 5, title: 'Stale', state: 'done' }), [{ actor_id: 'tony' }]);
  assert.match(host.children[0].text, /^Ready for review/);
  assert.equal(panel.topic.version, 6);

  // A person who has typed nothing sees each repaint's data in the form.
  const quiet = new Element('section'), other = new TopicStatePanel({ host: quiet, reader: 'tony', send: async () => ({}) });
  other.paint(topic(), []);
  other.paint(topic({ version: 5, state: 'waiting', state_note: 'Which name?', waiting_on: ['fable'], title: 'New' }), []);
  const fresh = controls(quiet);
  assert.deepEqual([fresh.choice.value, fresh.note.value, fresh.waiting.value, fresh.title.value], ['waiting', 'Which name?', 'fable', 'New']);
});

test('a new state clears the note and who it waits on unless the person typed them', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  const panel = new TopicStatePanel({ host, reader: 'tony', send: async (current, args) => { sent.push(args); return committed(current, args); } });
  panel.paint(topic({ state: 'waiting', state_note: 'Which name?', waiting_on: ['fable'] }), []);
  const { choice, note, waiting, save } = controls(host);
  choose(choice, 'done');
  assert.deepEqual([note.value, waiting.value], ['', '']);
  choose(choice, 'waiting');
  assert.deepEqual([note.value, waiting.value], ['Which name?', 'fable'], 'back to where it stands, its note and names return');
  choose(choice, 'done');
  await save.onclick();
  assert.deepEqual(sent, [{ state: 'done', note: '' }]);
  // What the person typed survives a change of state.
  choose(choice, 'review'); type(note, 'Have a look'); choose(choice, 'waiting'); type(waiting, 'tony'); choose(choice, 'waiting');
  assert.deepEqual([note.value, waiting.value], ['Have a look', 'tony']);
});

test('a stale-revision refusal keeps the attempt, asks for fresh data, and its notice goes once a newer version arrives', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  let refreshed = 0, server = 5;
  const panel = new TopicStatePanel({ host, reader: 'tony', refresh: () => { refreshed++; },
    send: async (current, args) => {
      sent.push([current.version, args]);
      if (current.version !== server) return { status: 'rejected', error: { code: 'REVISION_CONFLICT', message: 'Writing changed; preserve this attempt and reconcile', current_versions: { topic_revision: server } } };
      return committed(current, args);
    } });
  panel.paint(topic(), []);
  const { choice, note, save } = controls(host);
  choose(choice, 'done'); type(note, 'Shipped'); save.focus();
  await save.onclick();
  const kept = controls(host);
  assert.deepEqual([kept.choice.value, kept.note.value], ['done', 'Shipped'], 'the attempt is kept');
  assert.equal(document.activeElement, save, 'focus stays on Save');
  const notice = controls(host).notice;
  assert.equal(notice.hidden, false);
  assert.equal(notice.attributes.role, 'status');
  assert.match(notice.textContent, /changed/);
  assert.doesNotMatch(notice.textContent, /reconcile/, 'plain words, not the server\'s');
  assert.equal(refreshed, 1, 'a refusal asks for fresh data');
  panel.paint(topic(), []);
  assert.equal(notice.hidden, false, 'the same version again leaves the notice');
  panel.paint(topic({ version: 5 }), []);
  assert.equal(controls(host).notice, notice, 'one notice, kept in place so a reader announces its changes');
  assert.deepEqual([notice.hidden, notice.textContent], [false, CHANGED], 'fresh data does not answer the refusal, so its notice stays');
  assert.deepEqual([choice.value, note.value], ['done', 'Shipped'], 'the attempt survives the fresh data');
  await save.onclick();
  assert.deepEqual(sent, [[4, { state: 'done', note: 'Shipped' }], [5, { state: 'done', note: 'Shipped' }]], 'the retry sends the fresh version');
  assert.match(host.children[0].text, /^Done · Shipped/);
  assert.deepEqual([notice.hidden, notice.textContent], [true, ''], 'the next attempt clears the notice');
});

// The page's refresh reads the topic and repaints the panel, as freshness does;
// the refusal's notice is still there once the read it asked for has landed.
test('a stale-revision refusal is still said after the fresh read it asks for repaints the panel', async t => {
  dom(t);
  const host = new Element('section'), theirs = topic({ version: 5, state: 'done', state_by: 'fable' });
  const panel = new TopicStatePanel({ host, reader: 'tony', refresh: () => panel.paint(theirs, []),
    send: async () => ({ status: 'rejected', error: { code: 'REVISION_CONFLICT', message: 'Writing changed', current_versions: { topic_revision: 5 } } }) });
  panel.paint(topic(), []);
  const { choice, save, notice } = controls(host);
  choose(choice, 'review');
  await save.onclick();
  assert.match(host.children[0].text, /^Done — fable/, 'the fresh read was painted');
  assert.deepEqual([notice.hidden, notice.textContent, choice.value], [false, CHANGED, 'review'], 'the refused choice and its notice are both still shown');
  panel.paint(topic({ version: 6, owner_id: 'fable', creator_id: 'fable' }), [{ actor_id: 'fable' }]);
  assert.deepEqual([host.find(node => node.tag === 'details'), notice.hidden], [undefined, true], 'a reader who may no longer change it loses the form and the notice about it');
});

test('a commit answered after newer reads were painted leaves the fields showing the newest data', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  let release;
  const panel = new TopicStatePanel({ host, reader: 'tony',
    send: (current, args) => { sent.push([current.version, args]); return sent.length > 1 ? committed(current, args) : new Promise(resolve => { release = resolve; }); } });
  panel.paint(topic(), []);
  const { choice, note, save } = controls(host);
  choose(choice, 'review'); type(note, 'look');
  const out = save.onclick();
  // The reader's own change, then fable's, are read and painted before the answer.
  panel.paint(topic({ version: 5, state: 'review', state_note: 'look', state_by: 'tony' }), []);
  panel.paint(topic({ version: 6, state: 'done', state_note: 'Shipped', state_by: 'fable' }), []);
  release(committed(topic(), { state: 'review', note: 'look' }, 5));
  await out;
  assert.match(host.children[0].text, /^Done · Shipped — fable/);
  assert.deepEqual([choice.value, note.value], ['done', 'Shipped'], 'what was saved is the topic\'s, so the fields follow the newest data');
  type(note, 'Shipped, checked');
  await save.onclick();
  assert.deepEqual(sent[1], [6, { state: 'done', note: 'Shipped, checked' }], 'editing only the note does not send back the older state');
});

test('a press while another change is out is not sent, and says so', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  let release;
  const panel = new TopicStatePanel({ host, reader: 'tony',
    send: (current, args) => { sent.push([current.version, args]); return sent.length > 1 ? committed(current, args) : new Promise(resolve => { release = resolve; }); } });
  panel.paint(topic(), []);
  const { choice, title, save, rename, notice } = controls(host);
  const archive = host.find(node => node.textContent === 'Archive');
  choose(choice, 'review');
  const out = save.onclick();
  assert.deepEqual([save, rename, archive].map(button => button.attributes['aria-disabled']), ['true', 'true', 'true'], 'every button says it is unavailable');
  await save.onclick();
  assert.deepEqual([sent.length, notice.hidden], [1, true], 'Save pressed twice is the one change already on its way');
  type(title, 'New name'); rename.focus();
  await rename.onclick();
  assert.deepEqual(sent, [[4, { state: 'review', note: '' }]], 'the rename is not sent while the save is out');
  assert.deepEqual([notice.hidden, notice.textContent], [false, NOT_SENT]);
  assert.equal(document.activeElement, rename, 'focus stays on the button pressed');
  release(committed(topic(), { state: 'review', note: '' }));
  await out;
  assert.deepEqual([save, rename, archive].map(button => button.attributes['aria-disabled']), [undefined, undefined, undefined]);
  assert.deepEqual([notice.hidden, notice.textContent, title.value], [false, NOT_SENT, 'New name'], 'the unsent rename is still said, and its title kept');
  await rename.onclick();
  assert.deepEqual(sent[1], [5, { title: 'New name' }], 'pressed again, it is sent');
  assert.equal(notice.hidden, true);
});

test('after a committed change the next one sends the version it made, and focus stays on its button', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  let server = 4, refreshed = 0;
  const panel = new TopicStatePanel({ host, reader: 'tony', refresh: () => { refreshed++; },
    send: async (current, args) => {
      sent.push(current.version);
      if (current.version < server) return { status: 'rejected', error: { code: 'REVISION_CONFLICT', message: 'Writing changed' } };
      server = current.version + 1; return committed(current, args, server);
    } });
  panel.paint(topic(), []);
  const { choice, title, save, rename } = controls(host);
  choose(choice, 'review'); save.focus();
  await save.onclick();
  assert.equal(document.activeElement, save);
  const line = host.children[0].text;
  type(title, 'Named'); rename.focus();
  await rename.onclick();
  assert.deepEqual(sent, [4, 5], 'the second change sends the version the first one made');
  assert.match(line, /^Ready for review/, 'the line showed the change at once');
  assert.equal(document.activeElement, rename);
  assert.equal(controls(host).notice.hidden, true);
  assert.equal(refreshed, 2, 'each commit asks for fresh data');
  assert.equal(title.value, 'Named');
  // Fresh data from before the second commit does not undo it.
  panel.paint(topic({ version: 5, state: 'review' }), []);
  assert.equal(title.value, 'Named');
  assert.equal(panel.topic.version, 6);
  // What was saved is the topic's now, so the fields follow later news again.
  panel.paint(topic({ version: 7, state: 'done', title: 'Theirs' }), []);
  assert.deepEqual([choice.value, title.value], ['done', 'Theirs']);
  // Typing again while a change is out is kept when it commits.
  type(title, 'Mine'); const out = rename.onclick(); type(title, 'Mine, longer');
  await out;
  assert.deepEqual([sent, controls(host).notice.hidden], [[4, 5, 7], true], 'the rename committed');
  panel.paint(topic({ version: 9, title: 'Theirs again' }), []);
  assert.equal(title.value, 'Mine, longer');
});

test('a refused or failed change is shown and the panel keeps its topic', async t => {
  dom(t);
  const host = new Element('section'), answers = [{ status: 'rejected', error: { message: 'No permission for this topic' } }, Error('offline')];
  const panel = new TopicStatePanel({ host, reader: 'tony', send: async () => { const next = answers.shift(); if (next instanceof Error) throw next; return next; } });
  panel.paint(topic(), []);
  const archive = host.find(node => node.textContent === 'Archive');
  archive.focus();
  await archive.onclick();
  assert.equal(host.find(node => node.classes.has('notice')).textContent, 'No permission for this topic');
  assert.equal(document.activeElement, archive, 'focus stays on the button the person pressed');
  await archive.onclick();
  assert.equal(host.find(node => node.classes.has('notice')).textContent, 'offline');
  assert.equal(panel.topic.id, 't1');
});

test('the waiting list names each topic, opens it, and hides when nothing waits', t => {
  dom(t);
  const host = new Element('section'), opened = [];
  paintWaiting(host, { waiting_on_me: 0, latest_waiting: [] }, () => {});
  assert.equal(host.hidden, true);
  paintWaiting(host, { waiting_on_me: 7, latest_waiting: [{ id: 't9', title: 'Naming', title_truncated: false, note: 'Pick one', state_by: 'fable', state_ms: null }] },
    (id, title) => opened.push([id, title]));
  assert.equal(host.hidden, false);
  assert.equal(host.children[0].textContent, 'Waiting on you (7, newest 1 shown)');
  const link = host.find(node => node.tag === 'a');
  assert.equal(link.href, '?topic=t9');
  let prevented = false;
  link.onclick({ button: 0, preventDefault: () => { prevented = true; } });
  link.onclick({ button: 0, metaKey: true, preventDefault: () => assert.fail('a modified click keeps the browser default') });
  assert.equal(prevented, true);
  assert.deepEqual(opened, [['t9', 'Naming']]);
  assert.equal(host.find(node => node.tag === 'li').text, 'Naming Pick one — fable');
});

test('an open ask makes a topic wait on whoever it asks, whatever its state, and says since when', t => {
  dom(t);
  const since = new Date(2026, 10, 5, 7, 41).getTime(), asked = (actor_id, by = 'fable') => ({ actor_id, message_id: 'm-' + actor_id, by, since_ms: since });
  assert.equal(stateLabel(topic({ asks: [asked('tony')] }), 'tony'), 'Waiting on you');
  assert.equal(stateLabel(topic({ state: 'review', asks: [asked('codex')] }), 'tony'), 'Ready for review · waiting on codex');
  // Someone both said and asked is named once; the reader still comes first.
  assert.equal(stateLabel(topic({ state: 'waiting', waiting_on: ['codex'], asks: [asked('codex'), asked('tony')] }), 'tony'), 'Waiting on you, codex');
  // A said list only counts while the topic is waiting, as before.
  assert.equal(stateLabel(topic({ state: 'done', waiting_on: ['codex'] }), 'tony'), 'Done');
  const host = new Element('a');
  paintState(host, topic({ asks: [asked('tony')] }), 'tony');
  const [mark] = host.children;
  assert.deepEqual([mark.textContent, mark.dataset.state, mark.classes.has('mine'), mark.title],
    ['Waiting on you', 'waiting', true, 'Waiting on you · fable asked you, since 7:41 AM Thu Nov 5']);
  const other = new Element('a');
  paintState(other, topic({ asks: [asked('codex')] }), 'tony');
  assert.equal(other.children[0].classes.has('mine'), false);
  const panel = new TopicStatePanel({ host: new Element('section'), reader: 'tony', send: async () => ({}) });
  panel.paint(topic({ state: 'review', asks: [asked('tony')] }), []);
  assert.equal(panel.line.find(node => node.classes.has('ask-line')).textContent, ' · fable asked you, since 7:41 AM Thu Nov 5');
  assert.equal(panel.line.find(node => node.classes.has('topic-state')).dataset.state, 'waiting');
});

test('the waiting list says who asked and since when, and leaves out a state it was not said in', t => {
  dom(t);
  const since = new Date(2026, 10, 5, 7, 41).getTime(), host = new Element('section');
  paintWaiting(host, { waiting_on_me: 2, latest_waiting: [
    { id: 't1', title: 'Asked', title_truncated: false, note: 'Someone else\'s note', state_by: 'codex', state_ms: null, said: false,
      ask: { message_id: 'm1', by: 'fable', since_ms: since } },
    { id: 't2', title: 'Both', title_truncated: false, note: 'Pick one', state_by: 'codex', state_ms: null, said: true,
      ask: { message_id: 'm2', by: 'fable', since_ms: since } }] }, () => {});
  assert.deepEqual(host.all().filter(node => node.tag === 'li').map(node => node.text),
    ['Asked fable asked you, since 7:41 AM Thu Nov 5', 'Both Pick one — codex · fable asked you, since 7:41 AM Thu Nov 5']);
});

test('a row with observed work carries a dot, and every row says when activity was last seen, never that nobody works', t => {
  dom(t);
  const at = new Date(2026, 10, 5, 7, 41).getTime(), when = '7:41 AM Thu Nov 5';
  const work = (observed, extra = {}) => ({ observed, seen_ms: at, by: 'fable', how: 'posted', waits: false, ...extra });
  assert.equal(workNote(work(true), 'tony'), `Activity seen ${when} (fable posted)`);
  assert.equal(workNote(work(true, { by: 'tony', how: 'turn' }), 'tony'), `Activity seen ${when} (you took a turn)`);
  assert.equal(workNote(work(false), 'tony'), `No activity seen since ${when}`);
  assert.equal(workNote(work(false, { seen_ms: null, by: null, how: null }), 'tony'), 'No activity seen');
  assert.equal(workNote(work(true, { waits: true }), 'tony'), `Waiting on someone · last activity ${when} (fable posted)`);
  assert.equal(workNote(undefined, 'tony'), '', 'a server that does not say gets no words');
  for (const text of [workNote(work(false), 'tony'), workNote(work(false, { seen_ms: null }), 'tony')]) assert.doesNotMatch(text, /nobody|no one/i);
  const busy = new Element('a');
  paintWork(busy, { work: work(true) }, 'tony');
  assert.deepEqual(busy.children.map(node => [node.className, node.attributes['aria-hidden'] ?? null, node.textContent ?? null]),
    [['topic-work', 'true', null], ['sr-only', null, ` · Activity seen ${when} (fable posted)`]]);
  assert.equal(busy.attributes.title, `Activity seen ${when} (fable posted)`);
  const quiet = new Element('a');
  quiet.setAttribute('title', 'stale');
  paintWork(quiet, { work: work(false) }, 'tony');
  assert.deepEqual(quiet.children.map(node => node.className), ['sr-only'], 'no dot without observed work');
  assert.equal(quiet.attributes.title, `No activity seen since ${when}`);
  const unknown = new Element('a');
  unknown.setAttribute('title', 'stale');
  paintWork(unknown, {}, 'tony');
  assert.deepEqual([unknown.children, unknown.attributes.title], [[], undefined]);
});

test('a waiting row\'s title and screen-reader words name whom it waits on as its pill does', t => {
  dom(t);
  const at = new Date(2026, 10, 5, 7, 41).getTime(), when = '7:41 AM Thu Nov 5';
  const work = { observed: true, seen_ms: at, by: 'aim-lead', how: 'posted', waits: true };
  const ask = (actor_id, by = 'aim-lead') => ({ actor_id, by, message_id: 'm-' + actor_id, since_ms: at });
  for (const [item, pill] of [
    [{ state: 'active', asks: [ask('tony')] }, 'Waiting on you'],
    [{ state: 'waiting', waiting_on: ['riley'], asks: [ask('tony')] }, 'Waiting on you, riley'],
    [{ state: 'review', asks: [ask('fable', 'tony')] }, 'Ready for review · waiting on fable'],
  ]) {
    const row = new Element('a'), topic = { ...item, work };
    paintState(row, topic, 'tony'); paintWork(row, topic, 'tony');
    const mark = row.children.find(node => String(node.className).startsWith('topic-state'));
    assert.equal(mark.textContent, pill);
    const note = `${pill} · last activity ${when} (aim-lead posted)`;
    assert.equal(row.attributes.title, note, 'the row\'s title says what its pill says');
    // A screen reader hears the pill, then the rest of the note, once.
    assert.equal(mark.textContent + row.children.find(node => node.className === 'sr-only').textContent, note);
    assert.doesNotMatch(row.attributes.title, /someone/);
  }
  // A server that counts a wait the page cannot name still says there is one.
  const unnamed = new Element('a');
  paintState(unnamed, { state: 'active', work }, 'tony'); paintWork(unnamed, { state: 'active', work }, 'tony');
  assert.equal(unnamed.attributes.title, `Waiting on someone · last activity ${when} (aim-lead posted)`);
  assert.equal(unnamed.children.find(node => node.className === 'sr-only').textContent, ` · Waiting on someone · last activity ${when} (aim-lead posted)`);
  // Without a time, a waiting row's words are its pill's alone, said once.
  const untimed = new Element('a'), quiet = { state: 'active', asks: [ask('tony')], work: { ...work, seen_ms: null } };
  paintState(untimed, quiet, 'tony'); paintWork(untimed, quiet, 'tony');
  assert.equal(untimed.attributes.title, 'Waiting on you');
  assert.deepEqual(untimed.children.map(node => String(node.className)), ['topic-state mine', 'topic-work']);
});

// Work observed on a row was the same filled accent dot as the presence dot by
// the wordmark, beside the unread count, so it read as unread; and its meaning
// was only in a hover title, which phones never show (warp, item 91b). It is a
// hollow ring in the quiet text color, and a key under the topics says what
// the ring means, at every width.
test('work observed is a hollow ring, never the filled dot of presence or unread, and a key under the topics says what it means', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const at = css.indexOf('.topic-work{'), ring = css.slice(at, css.indexOf('}', at));
  assert.ok(at >= 0, 'aim.css draws the work mark');
  assert.match(ring, /border:1\.5px solid var\(--muted\)/, 'a ring in the quiet text color');
  assert.match(ring, /background:transparent/, 'hollow');
  assert.doesNotMatch(ring, /var\(--accent\)/, 'not the accent of presence and unread');
  const hex = (text, name) => { const h = text.match(new RegExp('--' + name + ':(#[0-9a-f]{6}|#[0-9a-f]{3})(?![0-9a-f])'))[1]; return h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h; };
  const luminance = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const light = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{'))), darkAt = css.indexOf('@media(prefers-color-scheme:dark){:root{');
  for (const [theme, root] of [['light', light], ['dark', css.slice(darkAt, css.indexOf('}', darkAt))]])
    for (const behind of ['paper', 'panel', 'soft'])
      assert.ok(contrast(hex(root, 'muted'), hex(root, behind)) >= 3, `${theme}: the ring shows on --${behind} (${contrast(hex(root, 'muted'), hex(root, behind)).toFixed(2)})`);
  const key = html.match(/<p id="topics-key"([^>]*)>([\s\S]*?)<\/p>/);
  assert.ok(key, 'index.html has the key under the topics');
  assert.match(key[1], /aria-hidden="true"/, 'each row already says its work to a screen reader');
  assert.match(key[1], /\bhidden\b/, 'hidden until a row has the ring');
  assert.match(key[2], /<span class="topic-work"><\/span>\s*Activity seen/, 'the ring, and in words what it means');
  assert.ok(html.indexOf('id="topics-key"') > html.indexOf('id="topics"'), 'under the topics');
});
