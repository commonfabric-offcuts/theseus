import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicStatePanel, paintState, paintWaiting, paintWork, stateLabel, workNote } from '../web/topic-state.mjs';
import { clock } from '../web/times.mjs';

// The page reads every time on Friday 6 November 2026 at noon, so a time on
// the 6th shows bare, one on the 5th as yesterday's, and earlier ones dated.
clock.now = () => new Date(2026, 10, 6, 12, 0).getTime();

// A small DOM with parents and one focused element. Detaching the focused
// element, or an ancestor of it, sends focus to the body, as a browser does;
// putting a node back does not give it focus again.
class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], dataset: {}, attributes: {}, hidden: false, classes: new Set(), parent: null }); }
  get classList() { return { add: name => this.classes.add(name) }; }
  // As in a browser, setting the words replaces whatever the element held.
  set textContent(value) { if (this.children.length) this.replaceChildren(); this.words = value; }
  get textContent() { return this.words; }
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
// Where the topic stands is the line under the panel's "Where it stands"
// heading; the form is its "Change where it stands" section, always open.
const stateLine = host => host.find(node => node.classes.has('state-line'));
const isForm = node => node.classes.has('state-form');
const CHANGED = 'This topic changed while you were choosing. What you chose is kept here: check it against the line above and save again.';
const NOT_SENT = 'That was not sent: another change was still being saved. Press it again.';
const topic = (fields = {}) => ({ id: 't1', version: 4, title: 'Naming', owner_id: 'tony', creator_id: 'tony', state: 'active',
  state_note: '', state_by: null, state_ms: null, waiting_on: [], archived: false, ...fields });

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
  const said = topic({ state: 'waiting', waiting_on: ['tony'], state_note: 'Which name?', state_by: 'fable', state_ms: new Date(2026, 10, 6, 7, 41).getTime() });
  panel.paint(said, [{ actor_id: 'fable' }]);
  assert.equal(host.hidden, false);
  assert.equal(stateLine(host).text, 'Waiting on tony · Which name? — you, 7:41 AM', 'said today: the time alone');
  assert.equal(stateLine(host).find(node => node.tag === 'time').title, '7:41 AM Fri Nov 6', 'its title keeps the date');
  // At 390 the line wraps; a time never breaks inside itself (warp, item 91b).
  assert.deepEqual(stateLine(host).all().filter(node => node.classes.has('together')).map(node => node.text), ['7:41 AM'], 'the time is kept whole');
  const mark = stateLine(host).children[0];
  assert.equal(mark.title, 'Waiting on tony', 'its whole words are its title');
  assert.equal(mark.classes.has('mine'), false, 'it waits on someone else');
  const mine = new TopicStatePanel({ host: new Element('section'), reader: 'tony', send: async () => ({}) });
  mine.paint(said, []);
  assert.equal(stateLine(mine.host).children[0].classes.has('mine'), true, 'the panel marks a state that waits on the reader');
  const form = host.find(isForm);
  assert.ok(form, 'a participant may say where it stands');
  assert.equal(host.find(node => node.id === 'topic-rename'), undefined, 'a participant who is not its creator or owner cannot rename it');
  panel.paint(said, [{ actor_id: 'someone-else' }]);
  assert.equal(host.find(isForm), undefined, 'a reader who does not work in it gets no form');
  // Core says whether the reader may say where it stands: having written in a
  // topic, they may, without being one of its participants.
  const writer = new TopicStatePanel({ host: new Element('section'), reader: 'fable', send: async () => ({}) });
  writer.paint({ ...said, reader_may_say: true }, [{ actor_id: 'someone-else' }]);
  assert.ok(writer.host.find(isForm), 'someone who has written in it may say where it stands');
  assert.equal(writer.host.find(node => node.id === 'topic-rename'), undefined, 'but cannot rename it');
  writer.paint({ ...said, version: 5, reader_may_say: false }, [{ actor_id: 'someone-else' }]);
  assert.equal(writer.host.find(isForm), undefined, 'and when Core says they may not, the form goes');
  const owner = new TopicStatePanel({ host: new Element('section'), reader: 'tony', send: async () => ({}) });
  owner.paint(said, []);
  assert.ok(owner.host.find(node => node.id === 'topic-rename'));
  assert.equal(owner.host.find(node => node.textContent === 'Archive')?.tag, 'button');
});

// The form's controls, found by what the person sees.
const controls = host => ({
  form: host.find(isForm),
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
  choose(before.choice, 'waiting'); type(before.note, 'Pick a name'); type(before.waiting, 'fable');
  before.note.focus();
  // Someone posts a message: the topic's version moves on and the page repaints it.
  panel.paint(topic({ version: 5, title: 'Naming, again' }), [{ actor_id: 'tony' }]);
  const after = controls(host);
  assert.equal(after.note, before.note, 'the same field, not a rebuilt one');
  assert.equal(document.activeElement, before.note, 'focus stays where the person left it');
  assert.deepEqual([after.choice.value, after.note.value, after.waiting.value, after.form, after.form.parent], ['waiting', 'Pick a name', 'fable', before.form, host]);
  assert.equal(after.waiting.parent.hidden, false, 'the waiting field stays shown while Waiting is chosen');
  assert.equal(after.title.value, 'Naming, again', 'an untouched title follows the data');
  type(after.title, 'My title');
  // Another participant says where it stands: what the person typed is kept,
  // what they did not touch shows the news.
  panel.paint(topic({ version: 6, title: 'Theirs', state: 'review', state_note: 'Look please' }), [{ actor_id: 'tony' }]);
  assert.deepEqual([after.choice.value, after.note.value, after.waiting.value, after.title.value], ['waiting', 'Pick a name', 'fable', 'My title']);
  assert.match(stateLine(host).text, /^Ready for review · Look please/);
  // An older read that lands late changes nothing.
  panel.paint(topic({ version: 5, title: 'Stale', state: 'done' }), [{ actor_id: 'tony' }]);
  assert.match(stateLine(host).text, /^Ready for review/);
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
  assert.match(stateLine(host).text, /^Done · Shipped/);
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
  assert.match(stateLine(host).text, /^Done — fable/, 'the fresh read was painted');
  assert.deepEqual([notice.hidden, notice.textContent, choice.value], [false, CHANGED, 'review'], 'the refused choice and its notice are both still shown');
  panel.paint(topic({ version: 6, owner_id: 'fable', creator_id: 'fable' }), [{ actor_id: 'fable' }]);
  assert.deepEqual([host.find(isForm), notice.hidden], [undefined, true], 'a reader who may no longer change it loses the form and the notice about it');
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
  assert.match(stateLine(host).text, /^Done · Shipped — fable/);
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
  const line = stateLine(host).text;
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
  paintWaiting(host, { waiting_on_me: 7, latest_waiting: [{ id: 't9', title: 'Naming', title_truncated: false, note: 'Pick one', state_by: 'fable', state_ms: null,
    workspace: { id: 'w2', title: 'Pitch deck', title_truncated: false } }] },
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
  // Each row says which outcome it is in (item 86), then, muted after " — ", what the state says.
  assert.equal(host.find(node => node.tag === 'li').text, 'Naming, in Pitch deck — Pick one — fable');
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
  const line = panel.line.find(node => node.classes.has('ask-line'));
  assert.equal(line.text, ' · fable asked you, since Yesterday 7:41 AM');
  assert.deepEqual(line.all().filter(node => node.classes.has('together')).map(node => node.text), ['Yesterday 7:41 AM'], 'the time an ask has waited since is kept whole');
  assert.equal(panel.line.find(node => node.classes.has('topic-state')).dataset.state, 'waiting');
});

test('the waiting list says who asked and since when, and leaves out a state it was not said in', t => {
  dom(t);
  const since = new Date(2026, 10, 5, 7, 41).getTime(), host = new Element('section');
  paintWaiting(host, { waiting_on_me: 2, latest_waiting: [
    { id: 't1', title: 'Speaker notes', title_truncated: false, note: 'Someone else\'s note', state_by: 'codex', state_ms: null, said: false,
      ask: { message_id: 'm1', by: 'fable', since_ms: new Date(2026, 10, 6, 6, 20).getTime() }, workspace: { id: 'w2', title: 'Pitch deck', title_truncated: false } },
    { id: 't2', title: 'Both', title_truncated: false, note: 'Pick one', state_by: 'codex', state_ms: new Date(2026, 10, 3, 16, 0).getTime(), said: true,
      ask: { message_id: 'm2', by: 'fable', since_ms: since }, workspace: { id: 'w1', title: 'Building Theseus', title_truncated: true } }] }, () => {});
  // Mockup 86's words: the outcome named, then when the ask was made, said out loud; a state
  // that also says the topic waits keeps its words before the ask, joined by " · ".
  assert.deepEqual(host.all().filter(node => node.tag === 'li').map(node => node.text),
    ['Speaker notes, in Pitch deck — fable asked at 6:20 AM', 'Both, in Building Theseus… — Pick one — codex, 4:00 PM Tue Nov 3 · fable asked yesterday at 7:41 AM']);
  assert.deepEqual(host.all().filter(node => node.tag === 'time').map(node => node.title), ['6:20 AM Fri Nov 6', '4:00 PM Tue Nov 3', '7:41 AM Thu Nov 5'],
    'each time\'s title keeps its date');
});

test('a row with observed work carries a dot, and every row says when activity was last seen, never that nobody works', t => {
  dom(t);
  // Seen today: a title and screen-reader words still say the day.
  // Said out loud (item 86, mockup 86's After column).
  const at = new Date(2026, 10, 6, 7, 41).getTime(), when = '7:41 AM';
  const work = (observed, extra = {}) => ({ observed, seen_ms: at, by: 'fable', how: 'posted', waits: false, ...extra });
  assert.equal(workNote(work(true), 'tony'), `fable posted at ${when}`);
  assert.equal(workNote(work(true, { by: 'warp', how: 'turn' }), 'tony'), `warp worked on it at ${when}`);
  assert.equal(workNote(work(true, { by: 'tony', how: 'turn' }), 'tony'), `you worked on it at ${when}`);
  assert.equal(workNote(work(true, { by: null }), 'tony'), `Worked on at ${when}`, 'no author known');
  assert.equal(workNote(work(false), 'tony'), `Quiet since fable posted at ${when}`);
  assert.equal(workNote(work(false, { seen_ms: new Date(2026, 10, 5, 23, 0).getTime() }), 'tony'), 'Quiet since fable posted yesterday at 11:00 PM');
  assert.equal(workNote(work(false, { seen_ms: new Date(2026, 10, 3, 16, 10).getTime(), by: 'warp' }), 'tony'), 'Quiet since warp posted Tuesday at 4:10 PM');
  assert.equal(workNote(work(false, { seen_ms: new Date(2026, 10, 5, 23, 2).getTime(), by: 'weft', how: 'turn' }), 'tony'), 'Quiet since weft worked on it yesterday at 11:02 PM');
  assert.equal(workNote(work(false, { seen_ms: new Date(2026, 10, 3, 16, 5).getTime(), by: null }), 'tony'), 'Quiet since Tuesday at 4:05 PM');
  assert.equal(workNote(work(false, { seen_ms: null, by: null, how: null }), 'tony'), 'Quiet');
  assert.equal(workNote(work(true, { waits: true }), 'tony'), `Waiting on someone · fable posted at ${when}`);
  assert.equal(workNote(undefined, 'tony'), '', 'a server that does not say gets no words');
  for (const text of [workNote(work(false), 'tony'), workNote(work(false, { seen_ms: null }), 'tony')]) assert.doesNotMatch(text, /nobody|no one/i);
  const busy = new Element('a');
  paintWork(busy, { work: work(true) }, 'tony');
  assert.deepEqual(busy.children.map(node => [node.className, node.attributes['aria-hidden'] ?? null, node.textContent ?? null]),
    [['topic-work', 'true', null], ['sr-only', null, ` · fable posted at ${when}`]]);
  assert.equal(busy.attributes.title, `fable posted at ${when}`);
  const quiet = new Element('a');
  quiet.setAttribute('title', 'stale');
  paintWork(quiet, { work: work(false) }, 'tony');
  assert.deepEqual(quiet.children.map(node => node.className), ['sr-only'], 'no dot without observed work');
  assert.equal(quiet.attributes.title, `Quiet since fable posted at ${when}`);
  const unknown = new Element('a');
  unknown.setAttribute('title', 'stale');
  paintWork(unknown, {}, 'tony');
  assert.deepEqual([unknown.children, unknown.attributes.title], [[], undefined]);
});

test('a waiting row\'s title and screen-reader words name whom it waits on as its pill does', t => {
  dom(t);
  // Seen today: a title and screen-reader words still say the day.
  const at = new Date(2026, 10, 6, 7, 41).getTime(), when = 'at 7:41 AM';
  const work = { observed: true, seen_ms: at, by: 'aim-lead', how: 'posted', waits: true };
  const ask = (actor_id, by = 'aim-lead') => ({ actor_id, by, message_id: 'm-' + actor_id, since_ms: at });
  // Its newest activity is the open ask itself, so it says who asked; else what that activity was.
  for (const [item, pill, said] of [
    [{ state: 'active', asks: [ask('tony')] }, 'Waiting on you', `aim-lead asked ${when}`],
    [{ state: 'waiting', waiting_on: ['riley'], asks: [ask('tony')] }, 'Waiting on you, riley', `aim-lead asked ${when}`],
    [{ state: 'review', asks: [ask('fable', 'tony')] }, 'Ready for review · waiting on fable', `aim-lead posted ${when}`],
    [{ state: 'active', asks: [{ ...ask('tony'), since_ms: at - 60000 }] }, 'Waiting on you', `aim-lead posted ${when}`],
  ]) {
    const row = new Element('a'), topic = { ...item, work };
    paintState(row, topic, 'tony'); paintWork(row, topic, 'tony');
    const mark = row.children.find(node => String(node.className).startsWith('topic-state'));
    assert.equal(mark.textContent, pill);
    const note = `${pill} · ${said}`;
    assert.equal(row.attributes.title, note, 'the row\'s title says what its pill says');
    // A screen reader hears the pill, then the rest of the note, once.
    assert.equal(mark.textContent + row.children.find(node => node.className === 'sr-only').textContent, note);
    assert.doesNotMatch(row.attributes.title, /someone/);
  }
  // A server that counts a wait the page cannot name still says there is one.
  const unnamed = new Element('a');
  paintState(unnamed, { state: 'active', work }, 'tony'); paintWork(unnamed, { state: 'active', work }, 'tony');
  assert.equal(unnamed.attributes.title, `Waiting on someone · aim-lead posted ${when}`);
  assert.equal(unnamed.children.find(node => node.className === 'sr-only').textContent, ` · Waiting on someone · aim-lead posted ${when}`);
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
  // The key says the server's rule (aim_next/work.py, held true by tests/test_work_observed.py): a post or turn by
  // someone else within the hour, or a wait; warp asked it match the outcome page's words (item 86).
  assert.match(key[2], /^<span class="topic-work"><\/span>\s*Posted in or worked on in the last hour, or waiting on an answer$/, 'the ring, and in words what it means');
  assert.ok(html.indexOf('id="topics-key"') > html.indexOf('id="topics"'), 'under the topics');
});

// What each participant is responsible for, beside where the topic stands.
const people = (...notes) => notes.map(([actor_id, responsibility = '', responsibility_revision = 0]) => ({ actor_id, responsibility, responsibility_revision }));
const duties = host => host.find(node => node.classes.has('responsibilities'));

test('every reader sees each participant\'s note beside the state, their own first as you, and nothing for those without one', t => {
  dom(t);
  const host = new Element('section');
  const panel = new TopicStatePanel({ host, reader: 'agent-b', send: async () => ({}), sendNote: async () => ({}) });
  panel.paint(topic({ state: 'review' }), people(['fable', 'Drafts the notes', 1], ['tony'], ['warp', 'Builds the page', 2]));
  const list = duties(host);
  assert.equal(host.children.indexOf(list), host.children.indexOf(panel.line) + 1, 'the notes sit right under the state line');
  assert.equal(list.hidden, false);
  assert.deepEqual(list.children.map(item => item.text), ['fable Drafts the notes', 'warp Builds the page']);
  assert.equal(host.find(node => node.id === 'topic-responsibility'), undefined, 'a reader who does not take part sets no note');
  panel.paint(topic({ state: 'review', version: 5 }), people(['fable', 'Drafts the notes', 1], ['agent-b', 'Checks the copy', 1]));
  assert.deepEqual(duties(host).children.map(item => item.text), ['you Checks the copy', 'fable Drafts the notes']);
  panel.paint(topic({ version: 6 }), people(['fable'], ['agent-b']));
  assert.equal(duties(host).hidden, true, 'no notes, no list');
  assert.deepEqual(duties(host).children, []);
});

test('a participant says what they do from the form, fenced on their note\'s revision, and the list follows the answer', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  const panel = new TopicStatePanel({ host, reader: 'fable', send: async () => ({}),
    sendNote: async (current, note, revision) => { sent.push([current.id, note, revision]);
      return { status: 'committed', result: { topic_id: current.id, actor_id: 'fable', note, responsibility_revision: revision + 1, changed: true, version: current.version + 1 } }; } });
  panel.paint(topic(), people(['fable', 'Old part', 3], ['tony']));
  const field = host.find(node => node.id === 'topic-responsibility');
  const save = host.find(node => node.textContent === 'Save my part');
  assert.equal(field.value, 'Old part', 'the field shows the note as it stands');
  type(field, 'Drafts the release notes');
  await save.onclick();
  assert.deepEqual(sent, [['t1', 'Drafts the release notes', 3]]);
  assert.deepEqual(duties(host).children.map(item => item.text), ['you Drafts the release notes']);
  assert.equal(panel.topic.version, 5, 'the answer\'s topic version is kept, so the next change sends it');
  assert.equal(panel.mine().responsibility_revision, 4);
  // An untouched field follows fresh data.
  panel.paint(topic({ version: 6 }), people(['fable', 'Set on another page', 5]));
  assert.equal(field.value, 'Set on another page');
  await save.onclick();
  assert.deepEqual(sent.at(-1), ['t1', 'Set on another page', 5]);
});

test('a note refused for a newer one keeps what the person wrote and says so; one too long is not sent', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  let refreshed = 0;
  const panel = new TopicStatePanel({ host, reader: 'fable', send: async () => ({}), refresh: () => { refreshed++; },
    sendNote: async (current, note, revision) => { sent.push(revision);
      return { status: 'rejected', recorded: true, error: { code: 'REVISION_CONFLICT', message: 'x', current_versions: { responsibility_revision: 2 } } }; } });
  panel.paint(topic(), people(['fable', 'Mine', 1]));
  const field = host.find(node => node.id === 'topic-responsibility');
  type(field, 'Newer words');
  await host.find(node => node.textContent === 'Save my part').onclick();
  assert.deepEqual(sent, [1]);
  assert.equal(controls(host).notice.textContent, 'Your note changed elsewhere while you were writing. What you wrote is kept here: check it against the list above and save again.');
  assert.equal(refreshed, 1, 'it asks for the note as it now stands');
  panel.paint(topic({ version: 5 }), people(['fable', 'Set elsewhere', 2]));
  assert.equal(field.value, 'Newer words', 'a touched field keeps the person\'s words over fresh data');
  assert.deepEqual(duties(host).children.map(item => item.text), ['you Set elsewhere']);
  type(field, 'é'.repeat(513));
  await host.find(node => node.textContent === 'Save my part').onclick();
  assert.deepEqual(sent, [1], 'a note over 1024 bytes is not sent');
  assert.match(controls(host).notice.textContent, /at most 1024 bytes/);
});

// With no Refresh button, a change whose answer never came reads the topic
// once, at that moment, and says what it found. The write is never sent again.
test('a state change that is not confirmed reads the topic once and says where it stands; a failed read says so too', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  let reads = 0, read = async () => { reads++; return { topic: topic({ version: 5, state: 'waiting', waiting_on: ['tony'], state_note: 'Needs a call on the deck',
    state_by: 'fable', state_ms: new Date(2026, 10, 5, 17, 33).getTime() }), participants: [] }; };
  const panel = new TopicStatePanel({ host, reader: 'tony', read: () => read(), send: async (current, args) => { sent.push(args); return { status: 'unknown' }; } });
  panel.paint(topic(), []);
  choose(controls(host).choice, 'done'); await controls(host).save.onclick();
  const notice = controls(host).notice;
  assert.equal(notice.text, 'The change was not confirmed. It stands as: Waiting on you · Needs a call on the deck — fable, Yesterday 5:33 PM.');
  assert.equal(notice.find(node => node.tag === 'time')?.dataset.ms, String(new Date(2026, 10, 5, 17, 33).getTime()), 'its time is a time node, repainted at midnight');
  assert.deepEqual([sent.length, reads], [1, 1], 'read once; the change is not sent again');
  assert.match(stateLine(host).text, /^Waiting on you · Needs a call on the deck/, 'the panel shows the topic as read');
  read = async () => { reads++; throw Error('offline'); };
  choose(controls(host).choice, 'done'); await controls(host).save.onclick();
  assert.equal(controls(host).notice.text, 'The change was not confirmed, and reading where the topic stands again failed too.');
  assert.match(stateLine(host).text, /^Waiting on you · Needs a call on the deck/, 'it keeps what it last showed');
  assert.deepEqual([sent.length, reads], [2, 2]);
  const bare = new TopicStatePanel({ host: new Element('section'), reader: 'tony', send: async () => ({ status: 'unknown' }) });
  bare.paint(topic(), []); choose(controls(bare.host).choice, 'done'); await controls(bare.host).save.onclick();
  assert.equal(controls(bare.host).notice.text, 'The change was not confirmed, and reading where the topic stands again failed too.', 'a panel with no read never says Refresh');
  // A refusal with Core's own words says those, and reads nothing.
  const refusing = new TopicStatePanel({ host: new Element('section'), reader: 'tony', read: () => read(), send: async () => ({ status: 'rejected', error: { code: 'FORBIDDEN', message: 'No permission for this topic' } }) });
  refusing.paint(topic(), []); choose(controls(refusing.host).choice, 'done'); await controls(refusing.host).save.onclick();
  assert.equal(controls(refusing.host).notice.text, 'No permission for this topic'); assert.equal(reads, 2);
});

test('a note that is not confirmed reads the topic once and says what the reader is responsible for now', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  let reads = 0, read = async () => { reads++; return { topic: topic({ version: 5 }), participants: people(['fable', 'Drafts the notes', 4]) }; };
  const panel = new TopicStatePanel({ host, reader: 'fable', send: async () => ({}), read: () => read(),
    sendNote: async (current, note) => { sent.push(note); return { status: 'unknown' }; } });
  panel.paint(topic(), people(['fable', 'Mine', 1]));
  const save = () => host.find(node => node.textContent === 'Save my part').onclick();
  type(host.find(node => node.id === 'topic-responsibility'), 'Newer words'); await save();
  assert.equal(controls(host).notice.text, 'Your note was not confirmed. You are responsible for: Drafts the notes.');
  assert.deepEqual([sent, reads], [['Newer words'], 1]);
  read = async () => { reads++; return { topic: topic({ version: 6 }), participants: people(['fable', '', 5]) }; };
  await save();
  assert.equal(controls(host).notice.text, 'Your note was not confirmed. You have no note in this topic.');
  read = async () => { reads++; throw Error('offline'); };
  await save();
  assert.equal(controls(host).notice.text, 'Your note was not confirmed, and reading it again failed too.');
  assert.equal(reads, 3);
});
