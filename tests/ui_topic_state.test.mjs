import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicStatePanel, managesTopic, organises, paintState, paintWaiting, paintWork, stateLabel, workNote } from '../web/topic-state.mjs';
import { clock } from '../web/times.mjs';

// The page reads every time on Friday 6 November 2026 at noon, so a time on
// the 6th shows bare, one on the 5th as yesterday's, and earlier ones dated.
clock.now = () => new Date(2026, 10, 6, 12, 0).getTime();

// A small DOM with parents and one focused element. Detaching the focused
// element, or an ancestor of it, sends focus to the body, as a browser does;
// putting a node back does not give it focus again.
class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], dataset: {}, attributes: {}, hidden: false, classes: new Set(), parent: null, listeners: {} }); }
  get classList() { return { add: name => this.classes.add(name), contains: name => this.classes.has(name), toggle: (name, on = !this.classes.has(name)) => { if (on) this.classes.add(name); else this.classes.delete(name); return on; } }; }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  select() { this.selected = true; }
  // As in a browser, setting the words replaces whatever the element held.
  set textContent(value) { if (this.children.length) this.replaceChildren(); this.words = value; }
  get textContent() { return this.words; }
  set className(value) { this.classes = new Set(value.split(' ').filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  adopt(node) { if (node instanceof Element) { node.remove(); node.parent = this; } return typeof node === 'string' ? { text: node } : node; }
  // Adopting a node takes it out of where it was first, as a browser moves it.
  append(...nodes) { const adopted = nodes.map(node => this.adopt(node)); this.children.push(...adopted); }
  prepend(...nodes) { const adopted = nodes.map(node => this.adopt(node)); this.children.unshift(...adopted); }
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
// Topic settings' where-it-stands panel is set in place: four chips that
// save on a tap, people chips while it waits, and one-line fields that save
// on Return or on leaving them. Each is found by what the person sees.
const CHANGED = 'Someone else changed this topic first, so that was not saved. Here it is as it stands now; what you typed is kept. Try again.';
const topic = (fields = {}) => ({ id: 't1', version: 4, title: 'Naming', owner_id: 'tony', creator_id: 'tony', state: 'active',
  state_note: '', state_by: null, state_ms: null, waiting_on: [], archived: false, ...fields });
const stateChips = host => host.all().filter(node => node.classes.has('choice-chip') && node.dataset.state);
const lit = host => stateChips(host).filter(node => node.attributes['aria-pressed'] === 'true').map(node => node.textContent);
const chip = (host, words) => host.find(node => node.classes.has('choice-chip') && node.textContent === words && node.tag === 'button');
const waitingChips = host => host.find(node => node.classes.has('people-chips'));
const peopleShown = host => waitingChips(host).parent.hidden ? null : waitingChips(host).children.map(node => [node.textContent, node.attributes['aria-pressed']]);
const controls = host => ({
  note: host.find(node => node.id === 'topic-state-note'), title: host.find(node => node.id === 'topic-rename'),
  part: host.find(node => node.id === 'topic-responsibility'), by: host.find(node => node.classes.has('state-by')),
  rename: host.find(node => node.textContent === 'Rename'), archive: host.find(node => ['Archive', 'Unarchive'].includes(node.textContent)),
  notice: host.find(node => node.classes.has('notice')),
});
const type = (input, value) => { input.value = value; input.oninput?.(); };
// A key in a one-line field; it says whether the field kept the key from the dialog.
const key = (input, name, extra = {}) => {
  const seen = { prevented: false, stopped: false };
  input.onkeydown({ key: name, isComposing: false, preventDefault() { seen.prevented = true; }, stopPropagation() { seen.stopped = true; }, ...extra });
  return seen;
};
// Leaving a field: the browser's blur, to its handler and its listeners.
const leave = input => { if (focus.on === input) focus.on = null; input.onblur?.(); for (const fn of input.listeners.blur ?? []) fn(); };
// Every queued change runs on resolved promises; a few turns settle them.
const settled = async () => { for (let turn = 0; turn < 20; turn++) await new Promise(resolve => setImmediate(resolve)); };
// What Core answers to a committed topic.update, by Core's rules (aim_next/topic_state.py):
// a new state, or any word after a reopen, starts with an empty note unless one is
// given or kept, and a waiting topic keeps who it waits on unless told.
const committed = (current, args, version = current.version + 1) => {
  const state = args.state ?? current.state, same = (state === current.state || 'keep_note' in args) && !current.state_message_id;
  return { status: 'committed', result: { topic_id: current.id, version, title: args.title ?? current.title, archived: args.archived ?? current.archived,
    state, note: args.note ?? (same ? current.state_note : ''), waiting_on: args.waiting_on ?? (state === 'waiting' ? current.waiting_on ?? [] : []),
    state_by: 'tony', state_ms: null } };
};
// A panel whose sends Core answers at once, and the list of what it sent:
// each change as [what it is fenced on, what it changes].
const live = (fields = {}, participants = [], reader = 'tony', extra = {}) => {
  const host = new Element('section'), sent = [];
  const panel = new TopicStatePanel({ host, reader, send: async (current, args, fence) => { sent.push([fence, args]); return committed(current, args); }, ...extra });
  panel.paint(topic(fields), participants);
  return { host, panel, sent };
};

test('those who may say where it stands get four chips, the one that holds lit; there is no dropdown and no Save', t => {
  dom(t);
  const { host } = live({ state: 'review', state_note: 'Look please' }, [{ actor_id: 'fable' }], 'fable');
  assert.deepEqual(stateChips(host).map(node => [node.tag, node.textContent, node.attributes['aria-pressed']]),
    [['button', 'Active', 'false'], ['button', 'Waiting', 'false'], ['button', 'Ready for review', 'true'], ['button', 'Done', 'false']]);
  const group = stateChips(host)[0].parent;
  assert.deepEqual([group.attributes.role, group.attributes['aria-labelledby']], ['group', 'stand-heading'], 'the chips are one group under Where it stands');
  assert.equal(host.find(node => node.tag === 'select'), undefined, 'no dropdown');
  assert.equal(host.find(node => node.tag === 'button' && /^Save/.test(node.textContent ?? '')), undefined, 'no Save button');
  assert.deepEqual([controls(host).note.tag, controls(host).note.type, controls(host).note.value, controls(host).note.placeholder], ['input', 'text', 'Look please', 'Add a note…'], 'the note is one line');
  assert.equal(controls(host).title, undefined, 'a participant who is neither owner nor creator cannot rename');
  assert.equal(controls(host).archive, undefined);
  assert.equal(peopleShown(host), null, 'nobody to wait on unless it waits');
});

test('a reader who may not say where it stands sees the state and its note, with nothing to tap', t => {
  dom(t);
  const { host, panel } = live({ state: 'waiting', waiting_on: ['tony'], state_note: 'Which name?' }, [{ actor_id: 'someone-else' }], 'fable');
  assert.deepEqual(host.all().filter(node => node.classes.has('choice-chip')).map(node => [node.tag, node.textContent]), [['span', 'Waiting on tony']]);
  assert.equal(host.find(node => node.tag === 'button' || node.tag === 'input'), undefined, 'nothing to press or type in');
  assert.equal(host.find(node => node.classes.has('state-note-line')).textContent, 'Which name?');
  // Core says whether the reader may say where it stands: having written in it, they may.
  panel.paint(topic({ version: 5, reader_may_say: true }), [{ actor_id: 'someone-else' }]);
  assert.equal(stateChips(host).length, 4, 'someone who has written in it gets the chips');
  assert.equal(controls(host).title, undefined, 'but cannot rename it');
  panel.paint(topic({ version: 6, reader_may_say: false }), [{ actor_id: 'someone-else' }]);
  assert.equal(stateChips(host).length, 0, 'and when Core says they may not, the chips go');
  const owner = live({}, [], 'tony');
  assert.deepEqual([owner.host.find(node => node.id === 'topic-rename')?.hidden, controls(owner.host).rename?.classes.has('text-action'), controls(owner.host).archive?.classes.has('text-action')],
    [true, true, true], 'the owner gets Rename and Archive as quiet words, the title line hidden until Rename');
});

test('the quiet line under the note says who set it and when, each open ask, and whether it is archived', t => {
  dom(t);
  const since = new Date(2026, 10, 5, 7, 41).getTime();
  const { host } = live({ state: 'review', state_by: 'fable', state_ms: new Date(2026, 10, 6, 7, 41).getTime(), archived: true,
    asks: [{ actor_id: 'tony', message_id: 'm1', by: 'fable', since_ms: since }] }, [{ actor_id: 'fable' }], 'fable');
  const by = controls(host).by;
  assert.equal(by.text, 'Set by you, 7:41 AM · you asked tony, since Yesterday 7:41 AM · Archived');
  assert.deepEqual(by.all().filter(node => node.classes.has('together')).map(node => node.text), ['7:41 AM', 'Yesterday 7:41 AM'], 'a time never breaks inside itself');
  assert.equal(by.find(node => node.tag === 'time').title, '7:41 AM Fri Nov 6', 'its title keeps the date');
  const quiet = live({}, [{ actor_id: 'tony' }]);
  assert.equal(controls(quiet.host).by.hidden, true, 'nothing said, no line');
});

test('a tap on a chip saves that state at once and keeps the note without sending it; a tap on the lit chip sends nothing', async t => {
  dom(t);
  const { host, sent } = live({ state: 'waiting', waiting_on: ['fable'], state_note: 'Which name?' }, [{ actor_id: 'tony' }, { actor_id: 'fable' }]);
  chip(host, 'Waiting').focus();
  await chip(host, 'Waiting').onclick();
  assert.deepEqual(sent, [], 'the state it already holds');
  await chip(host, 'Done').onclick();
  assert.deepEqual(sent, [[{ state: 'waiting', waiting_on: ['fable'] }, { state: 'done', keep_note: true }]],
    'the state alone, fenced on where it stood and who it waited on; Core keeps the note');
  assert.deepEqual([lit(host), controls(host).note.value, peopleShown(host)], [['Done'], 'Which name?', null]);
  assert.deepEqual([controls(host).notice.textContent, controls(host).notice.classes.has('quiet')], ['Saved', true], 'a quiet Saved');
  // A note typed and not yet saved stays in its line through a tap, and Return saves it.
  type(controls(host).note, 'Shipped');
  await chip(host, 'Done').onclick();
  await chip(host, 'Ready for review').onclick();
  assert.deepEqual(sent.slice(1), [[{ state: 'done', waiting_on: [] }, { state: 'review', keep_note: true }]]);
  assert.equal(controls(host).note.value, 'Shipped');
  key(controls(host).note, 'Enter'); await settled();
  assert.deepEqual(sent[2], [{ note: 'Which name?' }, { note: 'Shipped' }]);
});

test('a note a message wrote when it reopened the topic is started afresh by a tap; words typed over it stay and save on Return', async t => {
  dom(t);
  const reopened = { state_note: 'Reopened by a new message', state_message_id: 'm9', state_by: 'fable' };
  const first = live(reopened, [{ actor_id: 'tony' }]);
  await chip(first.host, 'Ready for review').onclick();
  assert.deepEqual(first.sent, [[{ state: 'active', note: 'Reopened by a new message', waiting_on: [] }, { state: 'review', keep_note: true }]]);
  assert.equal(controls(first.host).note.value, '', 'Core starts the note afresh');
  const second = live(reopened, [{ actor_id: 'tony' }]);
  type(controls(second.host).note, 'Needs a read');
  await chip(second.host, 'Ready for review').onclick();
  assert.deepEqual(second.sent[0][1], { state: 'review', keep_note: true });
  key(controls(second.host).note, 'Enter'); await settled();
  assert.deepEqual(second.sent[1], [{ note: '' }, { note: 'Needs a read' }], 'fenced on the empty note the tap left');
});

test('while it waits, its people are chips, you first; each tap adds or takes away one, saved at once', async t => {
  dom(t);
  const { host, panel, sent } = live({}, [{ actor_id: 'fable' }, { actor_id: 'tony' }, { actor_id: 'gone', active: 0 }]);
  await chip(host, 'Waiting').onclick();
  assert.deepEqual(sent, [[{ state: 'active', waiting_on: [] }, { state: 'waiting', keep_note: true }]]);
  assert.deepEqual(peopleShown(host), [['you', 'false'], ['fable', 'false']], 'its active people, the reader first as you');
  const group = waitingChips(host);
  assert.deepEqual([group.attributes.role, group.attributes['aria-labelledby'], host.find(node => node.id === 'waiting-label').textContent], ['group', 'waiting-label', 'Waiting on']);
  const fable = chip(host, 'fable');
  fable.focus();
  await fable.onclick();
  assert.deepEqual(sent[1], [{ state: 'waiting', waiting_on: [] }, { state: 'waiting', waiting_on: ['fable'], keep_note: true }]);
  assert.deepEqual(peopleShown(host), [['you', 'false'], ['fable', 'true']]);
  assert.equal(chip(host, 'fable'), fable, 'the same chip, so the focus stays on it');
  assert.equal(document.activeElement, fable);
  await chip(host, 'you').onclick();
  assert.deepEqual(sent[2][1], { state: 'waiting', waiting_on: ['fable', 'tony'], keep_note: true });
  await fable.onclick();
  assert.deepEqual(sent[3], [{ state: 'waiting', waiting_on: ['fable', 'tony'] }, { state: 'waiting', waiting_on: ['tony'], keep_note: true }], 'a lit person tapped again is taken away');
  assert.deepEqual(peopleShown(host), [['you', 'true'], ['fable', 'false']]);
  // Someone it waits on who is not among its people still shows, lit, so they can be taken away.
  panel.paint(topic({ version: 9, state: 'waiting', waiting_on: ['aim-ux', 'tony'] }), [{ actor_id: 'fable' }, { actor_id: 'tony' }]);
  assert.deepEqual(peopleShown(host), [['you', 'true'], ['fable', 'false'], ['aim-ux', 'true']]);
});

test('the note saves on Return or on leaving the line, and Escape puts back what is saved', async t => {
  dom(t);
  const { host, sent } = live({ state: 'waiting', waiting_on: ['fable'], state_note: 'Old' }, [{ actor_id: 'tony' }]);
  const note = controls(host).note;
  assert.deepEqual([note.maxLength, note.enterKeyHint, note.autocomplete, note.attributes['aria-label']], [1024, 'done', 'off', 'Note']);
  key(note, 'Enter'); await settled();
  assert.deepEqual(sent, [], 'Return on words already saved sends nothing');
  type(note, 'Which name?');
  assert.equal(key(note, 'Enter', { isComposing: true }).prevented, false, 'Return that ends a composition is the composition\'s');
  await settled();
  assert.deepEqual(sent, []);
  assert.equal(key(note, 'Enter').prevented, true); await settled();
  assert.deepEqual(sent, [[{ note: 'Old' }, { note: 'Which name?' }]], 'the note alone, fenced on the note it began from');
  assert.equal(controls(host).notice.textContent, 'Saved');
  leave(note); await settled();
  assert.deepEqual(sent.length, 1, 'leaving a line already saved sends nothing');
  type(note, 'Which name, really?');
  leave(note); await settled();
  assert.deepEqual(sent[1], [{ note: 'Which name?' }, { note: 'Which name, really?' }], 'leaving the line saves it');
  type(note, 'Not this');
  assert.deepEqual(key(note, 'Escape'), { prevented: true, stopped: true }, 'Escape with words to put back is the field\'s, so the dialog stays open');
  assert.equal(note.value, 'Which name, really?');
  leave(note); await settled();
  assert.equal(sent.length, 2, 'what was put back is not sent');
  assert.deepEqual(key(note, 'Escape'), { prevented: false, stopped: false }, 'with nothing to put back, Escape closes the dialog as usual');
});

test('leaving the note is weighed when its turn comes: words typed back while a change is out are saved after it', async t => {
  dom(t);
  const host = new Element('section'), sent = [], answers = [];
  const panel = new TopicStatePanel({ host, reader: 'tony',
    send: (current, args, fence) => { sent.push([fence, args]); return new Promise(resolve => answers.push(() => resolve(committed(current, args)))); } });
  panel.paint(topic({ state_note: 'Old' }), [{ actor_id: 'tony' }]);
  const note = controls(host).note;
  type(note, 'New'); key(note, 'Enter'); await settled();
  assert.deepEqual(sent, [[{ note: 'Old' }, { note: 'New' }]]);
  // Before Core answers, the person types the old words back and leaves.
  type(note, 'Ol'); type(note, 'Old'); leave(note); await settled();
  answers.shift()(); await settled();
  assert.deepEqual(sent, [[{ note: 'Old' }, { note: 'New' }], [{ note: 'New' }, { note: 'Old' }]], 'the words they left are saved, after the change before them, fenced on what it saved');
  answers.shift()(); await settled();
  assert.deepEqual([note.value, panel.topic.state_note], ['Old', 'Old']);
});

test('changes go one at a time, in the order made, each fenced on what the one before it made', async t => {
  dom(t);
  const host = new Element('section'), sent = [], answers = [];
  const panel = new TopicStatePanel({ host, reader: 'tony',
    send: (current, args, fence) => { sent.push([fence, args]); return new Promise(resolve => answers.push(() => resolve(committed(current, args)))); } });
  panel.paint(topic({ state: 'waiting', waiting_on: ['fable'] }), [{ actor_id: 'tony' }, { actor_id: 'fable' }]);
  // Core answers each change that is out, as many as there are, so no check waits forever.
  const answerAll = async () => { for (let turn = 0; turn < 4; turn++) { await settled(); while (answers.length) answers.shift()(); } };
  type(controls(host).note, 'Pick one'); key(controls(host).note, 'Enter');
  const tap = chip(host, 'Ready for review').onclick();
  await settled();
  assert.deepEqual(sent, [[{ note: '' }, { note: 'Pick one' }]], 'the tap waits for the note');
  answers.shift()();
  await settled();
  assert.deepEqual(sent[1], [{ state: 'waiting', waiting_on: ['fable'] }, { state: 'review', keep_note: true }], 'then goes, the note kept');
  await answerAll(); await tap;
  assert.deepEqual(lit(host), ['Ready for review']);
  // A change worked out at its turn sends nothing when nothing is left to change.
  const again = [chip(host, 'Done').onclick(), chip(host, 'Done').onclick()];
  await answerAll(); await Promise.all(again);
  assert.deepEqual(sent.slice(2), [[{ state: 'review', waiting_on: [] }, { state: 'done', keep_note: true }]], 'Done tapped twice is one change');
  // One that fails outright never holds up the next.
  const failing = new TopicStatePanel({ host: new Element('section'), reader: 'tony', send: async (current, args) => {
    if (args.state === 'done') throw Error('offline'); sent.push(['next', args]); return committed(current, args); } });
  failing.paint(topic(), [{ actor_id: 'tony' }]);
  await Promise.all([chip(failing.host, 'Done').onclick(), chip(failing.host, 'Ready for review').onclick()]);
  assert.deepEqual(sent.at(-1), ['next', { state: 'review', keep_note: true }]);
});

test('a repaint from fresh data keeps what the person typed and their focus; untouched fields and every chip follow the data', t => {
  dom(t);
  const { host, panel } = live({}, [{ actor_id: 'tony' }]);
  const before = controls(host);
  type(before.note, 'Pick a name'); before.note.focus();
  panel.paint(topic({ version: 5, title: 'Naming, again', state: 'review', state_note: 'Theirs' }), [{ actor_id: 'tony' }]);
  const after = controls(host);
  assert.equal(after.note, before.note, 'the same field, not a rebuilt one');
  assert.equal(document.activeElement, before.note, 'focus stays where the person left it');
  assert.deepEqual([after.note.value, after.title.value, lit(host)], ['Pick a name', 'Naming, again', ['Ready for review']]);
  // An older read that lands late changes nothing.
  panel.paint(topic({ version: 4, state: 'done' }), [{ actor_id: 'tony' }]);
  assert.deepEqual([lit(host), panel.topic.version], [['Ready for review'], 5]);
});

test('a refusal over newer words says so in plain words beside them, keeps what was typed, asks for fresh data, and the chips show the news', async t => {
  dom(t);
  const host = new Element('section'), sent = [], theirs = topic({ version: 5, state: 'done', state_note: 'Shipped', state_by: 'fable' });
  let refreshed = 0, attention = 0;
  const conflict = { status: 'rejected', error: { code: 'REVISION_CONFLICT', message: 'Writing changed; preserve this attempt and reconcile' } };
  const panel = new TopicStatePanel({ host, reader: 'tony', refresh: () => { refreshed++; }, attention: () => { attention++; },
    read: async () => ({ topic: theirs, participants: [{ actor_id: 'tony' }] }),
    send: async (current, args, fence) => { sent.push([fence, args]); return fence.note === 'Shipped' ? committed(current, args) : conflict; } });
  panel.paint(topic(), [{ actor_id: 'tony' }]);
  type(controls(host).note, 'Mine'); key(controls(host).note, 'Enter'); await settled();
  const notice = controls(host).notice;
  assert.deepEqual([notice.hidden, notice.textContent, notice.classes.has('quiet'), notice.attributes.role],
    [false, 'Someone else changed the note first, so yours was not saved; your words are kept. It now reads “Shipped”: press Return to save yours in its place.', false, 'status']);
  assert.deepEqual([refreshed, attention], [1, 1], 'a refusal asks for fresh data, and for Topic settings to show');
  assert.deepEqual([controls(host).note.value, lit(host)], ['Mine', ['Done']], 'the typed note is kept; the chips show where it stands now');
  key(controls(host).note, 'Enter'); await settled();
  assert.deepEqual(sent, [[{ note: '' }, { note: 'Mine' }], [{ note: 'Shipped' }, { note: 'Mine' }]], 'Return again goes over the words now shown');
  assert.equal(controls(host).notice.textContent, 'Saved');
  // A tap refused is said plainly, with no words of the person's to keep.
  const tapped = new TopicStatePanel({ host: new Element('section'), reader: 'tony', send: async () => conflict });
  tapped.paint(topic(), [{ actor_id: 'tony' }]);
  await chip(tapped.host, 'Done').onclick();
  assert.equal(controls(tapped.host).notice.textContent, CHANGED);
});

test('a commit answered after newer reads were painted leaves the fields showing the newest data', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  let release;
  const panel = new TopicStatePanel({ host, reader: 'tony',
    send: (current, args, fence) => { sent.push([fence, args]); return sent.length > 1 ? committed(current, args) : new Promise(resolve => { release = resolve; }); } });
  panel.paint(topic({ state_note: 'look' }), [{ actor_id: 'tony' }]);
  const out = chip(host, 'Ready for review').onclick();
  await settled();
  panel.paint(topic({ version: 5, state: 'review', state_note: 'look', state_by: 'tony' }), [{ actor_id: 'tony' }]);
  panel.paint(topic({ version: 6, state: 'done', state_note: 'Shipped', state_by: 'fable' }), [{ actor_id: 'tony' }]);
  release(committed(topic({ state_note: 'look' }), { state: 'review', keep_note: true }, 5));
  await out;
  assert.deepEqual([lit(host), controls(host).note.value], [['Done'], 'Shipped'], 'what was saved is the topic\'s, so the fields follow the newest data');
  type(controls(host).note, 'Shipped, checked'); key(controls(host).note, 'Enter'); await settled();
  assert.deepEqual(sent[1], [{ note: 'Shipped' }, { note: 'Shipped, checked' }], 'editing only the note sends no state, fenced on the newest note');
});

test('a refused or failed change is said in plain words and the panel keeps its topic and what was typed', async t => {
  dom(t);
  const host = new Element('section'), answers = [{ status: 'rejected', error: { message: 'No permission for this topic' } }, Error('offline')];
  const panel = new TopicStatePanel({ host, reader: 'tony', send: async () => { const next = answers.shift(); if (next instanceof Error) throw next; return next; } });
  panel.paint(topic(), [{ actor_id: 'tony' }]);
  controls(host).archive.focus();
  await controls(host).archive.onclick();
  assert.deepEqual([controls(host).notice.textContent, controls(host).notice.classes.has('quiet')], ['No permission for this topic', false]);
  assert.equal(document.activeElement, controls(host).archive, 'focus stays on what the person pressed');
  type(controls(host).note, 'Kept');
  await chip(host, 'Done').onclick();
  assert.deepEqual([controls(host).notice.textContent, controls(host).note.value, panel.topic.id], ['offline', 'Kept', 't1']);
});

test('Rename puts the title on one line in place of the quiet actions; Return saves it, Escape or leaving it unchanged puts them back', async t => {
  dom(t);
  const { host, sent } = live({}, [{ actor_id: 'tony' }]);
  const { rename, archive, title } = controls(host);
  assert.deepEqual([title.hidden, rename.hidden, archive.hidden, archive.textContent], [true, false, false, 'Archive']);
  rename.onclick();
  assert.deepEqual([title.hidden, rename.hidden, archive.hidden, document.activeElement === title, title.selected], [false, true, true, true, true], 'the title line, focused and selected');
  assert.deepEqual(key(title, 'Escape'), { prevented: true, stopped: true }, 'Escape is the line\'s, so the dialog stays open');
  assert.deepEqual([title.hidden, rename.hidden, document.activeElement === rename, sent], [true, false, true, []], 'the actions are back, the focus on Rename, nothing sent');
  rename.onclick(); leave(title);
  assert.deepEqual([title.hidden, rename.hidden, sent], [true, false, []], 'leaving it unchanged puts the actions back');
  rename.onclick(); type(title, 'Names');
  key(title, 'Enter'); await settled();
  assert.deepEqual(sent, [[{ title: 'Naming' }, { title: 'Names' }]]);
  assert.deepEqual([title.hidden, rename.hidden, document.activeElement === rename], [true, false, true], 'saved: the actions are back, the focus on Rename');
  rename.onclick(); type(title, 'Renamed on leaving'); leave(title); await settled();
  assert.deepEqual(sent[1], [{ title: 'Names' }, { title: 'Renamed on leaving' }], 'leaving a changed title saves it');
  await archive.onclick();
  assert.deepEqual([sent[2], archive.textContent], [[{ archived: false }, { archived: true }], 'Unarchive']);
  await archive.onclick();
  assert.deepEqual(sent[3], [{ archived: true }, { archived: false }]);
});

test('a refused rename keeps the title line open with what was typed', async t => {
  dom(t);
  const host = new Element('section');
  const panel = new TopicStatePanel({ host, reader: 'tony', send: async () => ({ status: 'rejected', error: { code: 'EMPTY_TITLE', message: 'A topic needs a title' } }) });
  panel.paint(topic(), [{ actor_id: 'tony' }]);
  controls(host).rename.onclick(); type(controls(host).title, ' ');
  key(controls(host).title, 'Enter'); await settled();
  assert.deepEqual([controls(host).notice.textContent, controls(host).title.hidden, controls(host).title.value], ['A topic needs a title', false, ' ']);
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

// "owner building-theseus tony": tony owns it, fable coordinates it, warp is on its team.
test('whoever organises the outcome manages its topics beside their creator; a cleared coordinator organises nothing', t => {
  dom(t);
  const outcome = { owner_id: 'tony', coordinator_id: 'fable' };
  assert.deepEqual(['tony', 'fable', 'warp'].map(actor => organises(outcome, actor)), [true, true, false]);
  assert.equal(organises({ owner_id: 'tony', coordinator_id: null }, null), false, 'no coordinator is no one, not a reader without a name');
  const handed = topic({ owner_id: 'tony', coordinator_id: 'fable', creator_id: 'warp' });
  assert.deepEqual(['tony', 'fable', 'warp', 'og'].map(actor => managesTopic(handed, actor)), [true, true, true, false]);
  const fable = new TopicStatePanel({ host: new Element('section'), reader: 'fable', send: async () => ({}) });
  fable.paint(topic({ coordinator_id: 'fable' }), []);
  assert.ok(fable.host.find(node => node.id === 'topic-rename'), 'the coordinator may rename it');
  assert.equal(fable.host.find(node => node.textContent === 'Archive')?.tag, 'button', 'and archive it');
  fable.paint(topic({ coordinator_id: null }), []);
  assert.equal(fable.host.find(node => node.id === 'topic-rename'), undefined, 'once no longer coordinator, Rename and Archive go');
  const warp = new TopicStatePanel({ host: new Element('section'), reader: 'warp', send: async () => ({}) });
  warp.paint(topic({ coordinator_id: 'fable' }), []);
  assert.equal(warp.host.find(node => node.id === 'topic-rename'), undefined, 'a plain member who did not start it cannot rename it');
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
  // In Topic settings an open ask is said on the quiet line; the state's chip stays what was said.
  const panel = new TopicStatePanel({ host: new Element('section'), reader: 'tony', send: async () => ({}) });
  panel.paint(topic({ state: 'review', asks: [asked('tony')] }), []);
  const line = controls(panel.host).by;
  assert.equal(line.text, 'fable asked you, since Yesterday 7:41 AM');
  assert.deepEqual(line.all().filter(node => node.classes.has('together')).map(node => node.text), ['Yesterday 7:41 AM'], 'the time an ask has waited since is kept whole');
  assert.deepEqual(lit(panel.host), ['Ready for review']);
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

test('a row with observed work carries a dot, and every row says a state and a time, never that nobody works', t => {
  dom(t);
  // A state and a time (item 86, trimmed): who worked in it last, in the last
  // hour, or Quiet since when; never what they did, never "asked", never a sentence.
  const at = new Date(2026, 10, 6, 7, 41).getTime(), when = '7:41 AM';
  const work = (observed, extra = {}) => ({ observed, seen_ms: at, by: 'fable', how: 'posted', waits: false, ...extra });
  assert.equal(workNote(work(true), 'tony'), `fable · ${when}`);
  assert.equal(workNote(work(true, { by: 'warp', how: 'turn' }), 'tony'), `warp · ${when}`, 'a hosted turn is said as a post is: who and when');
  assert.equal(workNote(work(true, { by: null }), 'tony'), `Worked on · ${when}`, 'no author known');
  assert.equal(workNote(work(false), 'tony'), `Quiet since ${when}`);
  assert.equal(workNote(work(false, { seen_ms: new Date(2026, 10, 5, 23, 0).getTime() }), 'tony'), 'Quiet since yesterday 11:00 PM');
  assert.equal(workNote(work(false, { seen_ms: new Date(2026, 10, 3, 16, 10).getTime(), by: 'warp' }), 'tony'), 'Quiet since Tue 4:10 PM');
  assert.equal(workNote(work(false, { seen_ms: new Date(2026, 10, 5, 23, 2).getTime(), by: 'weft', how: 'turn' }), 'tony'), 'Quiet since yesterday 11:02 PM');
  assert.equal(workNote(work(false, { seen_ms: new Date(2026, 10, 3, 16, 5).getTime(), by: null }), 'tony'), 'Quiet since Tue 4:05 PM');
  assert.equal(workNote(work(false, { seen_ms: null, by: null, how: null }), 'tony'), 'Quiet');
  assert.equal(workNote(work(true, { waits: true }), 'tony'), `Waiting on someone · ${when}`);
  assert.equal(workNote(undefined, 'tony'), '', 'a server that does not say gets no words');
  for (const text of [workNote(work(true), 'tony'), workNote(work(false), 'tony'), workNote(work(true, { waits: true }), 'tony')])
    assert.doesNotMatch(text, /posted|worked on it|asked|nobody|no one/i, 'a state and a time, nothing more: ' + text);
  const busy = new Element('a');
  paintWork(busy, { work: work(true) }, 'tony');
  assert.deepEqual(busy.children.map(node => [node.className, node.attributes['aria-hidden'] ?? null, node.textContent ?? null]),
    [['topic-work', 'true', null], ['sr-only', null, ` · fable · ${when}`]]);
  assert.equal(busy.attributes.title, `fable · ${when}`);
  const quiet = new Element('a');
  quiet.setAttribute('title', 'stale');
  paintWork(quiet, { work: work(false) }, 'tony');
  assert.deepEqual(quiet.children.map(node => node.className), ['sr-only'], 'no dot without observed work');
  assert.equal(quiet.attributes.title, `Quiet since ${when}`);
  const unknown = new Element('a');
  unknown.setAttribute('title', 'stale');
  paintWork(unknown, {}, 'tony');
  assert.deepEqual([unknown.children, unknown.attributes.title], [[], undefined]);
});

test('a waiting row\'s title and screen-reader words name whom it waits on as its pill does, then its time', t => {
  dom(t);
  // Seen today: a title and screen-reader words still say the day.
  const at = new Date(2026, 10, 6, 7, 41).getTime(), when = '7:41 AM';
  const work = { observed: true, seen_ms: at, by: 'aim-lead', how: 'posted', waits: true };
  const ask = (actor_id, by = 'aim-lead') => ({ actor_id, by, message_id: 'm-' + actor_id, since_ms: at });
  // The pill's words, then the time of its newest activity: a state and a time, whoever asked.
  for (const [item, pill] of [
    [{ state: 'active', asks: [ask('tony')] }, 'Waiting on you'],
    [{ state: 'waiting', waiting_on: ['riley'], asks: [ask('tony')] }, 'Waiting on you, riley'],
    [{ state: 'review', asks: [ask('fable', 'tony')] }, 'Ready for review · waiting on fable'],
    [{ state: 'active', asks: [{ ...ask('tony'), since_ms: at - 60000 }] }, 'Waiting on you'],
  ]) {
    const row = new Element('a'), topic = { ...item, work };
    paintState(row, topic, 'tony'); paintWork(row, topic, 'tony');
    const mark = row.children.find(node => String(node.className).startsWith('topic-state'));
    assert.equal(mark.textContent, pill);
    const note = `${pill} · ${when}`;
    assert.equal(row.attributes.title, note, 'the row\'s title says what its pill says, then when');
    // A screen reader hears the pill, then the rest of the note, once.
    assert.equal(mark.textContent + row.children.find(node => node.className === 'sr-only').textContent, note);
    assert.doesNotMatch(row.attributes.title, /someone|asked|posted/);
  }
  // A server that counts a wait the page cannot name still says there is one.
  const unnamed = new Element('a');
  paintState(unnamed, { state: 'active', work }, 'tony'); paintWork(unnamed, { state: 'active', work }, 'tony');
  assert.equal(unnamed.attributes.title, `Waiting on someone · ${when}`);
  assert.equal(unnamed.children.find(node => node.className === 'sr-only').textContent, ` · Waiting on someone · ${when}`);
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

// What each participant is responsible for, under "Your part" in Topic settings.
const people = (...notes) => notes.map(([actor_id, responsibility = '', responsibility_revision = 0]) => ({ actor_id, responsibility, responsibility_revision }));
const duties = host => host.find(node => node.classes.has('responsibilities'));
const committedPart = (current, note, revision) => ({ status: 'committed', result: { topic_id: current.id, actor_id: 'fable', note, responsibility_revision: revision + 1, changed: true, version: current.version + 1 } });

test('every reader sees each participant\'s part, their own first as you, and nothing for those without one', t => {
  dom(t);
  const host = new Element('section');
  const panel = new TopicStatePanel({ host, reader: 'agent-b', send: async () => ({}), sendNote: async () => ({}) });
  panel.paint(topic({ state: 'review' }), people(['fable', 'Drafts the notes', 1], ['tony'], ['warp', 'Builds the page', 2]));
  const list = duties(host);
  assert.equal(list.hidden, false);
  assert.deepEqual(list.children.map(item => item.text), ['fable Drafts the notes', 'warp Builds the page']);
  assert.equal(host.find(node => node.id === 'topic-responsibility'), undefined, 'a reader who does not take part writes no part');
  // A participant writes theirs on its own line, so the list leaves them out.
  panel.paint(topic({ state: 'review', version: 5 }), people(['fable', 'Drafts the notes', 1], ['agent-b', 'Checks the copy', 1]));
  assert.deepEqual(duties(host).children.map(item => item.text), ['fable Drafts the notes']);
  assert.equal(host.find(node => node.id === 'topic-responsibility').value, 'Checks the copy');
  // Without a way to send a part, a participant's own is listed as you.
  const bare = new TopicStatePanel({ host: new Element('section'), reader: 'agent-b', send: async () => ({}) });
  bare.paint(topic(), people(['fable', 'Drafts the notes', 1], ['agent-b', 'Checks the copy', 1]));
  assert.deepEqual(duties(bare.host).children.map(item => item.text), ['you Checks the copy', 'fable Drafts the notes']);
  assert.equal(bare.host.find(node => node.id === 'topic-responsibility'), undefined);
  panel.paint(topic({ version: 6 }), people(['fable'], ['agent-b']));
  assert.equal(duties(host).hidden, true, 'no parts, no list');
  assert.deepEqual(duties(host).children, []);
});

test('a participant writes their part on one line under Your part; Return or leaving it saves, fenced on its revision; Escape puts it back', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  const panel = new TopicStatePanel({ host, reader: 'fable', send: async () => ({}),
    sendNote: async (current, note, revision) => { sent.push([current.id, note, revision]); return committedPart(current, note, revision); } });
  panel.paint(topic(), people(['fable', 'Old part', 3], ['tony', 'Reviews']));
  const field = host.find(node => node.id === 'topic-responsibility'), heading = host.find(node => node.id === 'part-heading');
  assert.deepEqual([heading.tag, heading.textContent, field.tag, field.type, field.attributes['aria-labelledby'], field.placeholder, field.value],
    ['h3', 'Your part', 'input', 'text', 'part-heading', 'What you do here…', 'Old part']);
  const part = field.parent;
  assert.deepEqual(part.children.map(node => node.id || [...node.classes][0]), ['part-heading', 'topic-responsibility', 'responsibilities'], 'the heading, the line, then the others\' parts');
  assert.ok(host.children.indexOf(part) > host.children.indexOf(controls(host).by), 'after where it stands');
  key(field, 'Enter'); await settled();
  assert.deepEqual(sent, [], 'Return on the part as it stands sends nothing');
  type(field, 'Drafts the release notes');
  assert.equal(key(field, 'Enter').prevented, true); await settled();
  assert.deepEqual(sent, [['t1', 'Drafts the release notes', 3]]);
  assert.deepEqual([panel.topic.version, panel.mine().responsibility, panel.mine().responsibility_revision], [5, 'Drafts the release notes', 4], 'the answer\'s versions are kept, so the next change sends them');
  assert.deepEqual([controls(host).notice.textContent, controls(host).notice.classes.has('quiet')], ['Saved', true]);
  type(field, 'Drafts and checks'); leave(field); await settled();
  assert.deepEqual(sent[1], ['t1', 'Drafts and checks', 4], 'leaving the line saves it');
  type(field, 'Not this');
  assert.deepEqual(key(field, 'Escape'), { prevented: true, stopped: true });
  assert.equal(field.value, 'Drafts and checks', 'Escape puts back what is saved');
  leave(field); await settled();
  assert.equal(sent.length, 2, 'and nothing is sent');
  // An untouched line follows fresh data.
  panel.paint(topic({ version: 7 }), people(['fable', 'Set on another page', 6]));
  assert.equal(field.value, 'Set on another page');
});

test('a part refused for a newer one keeps what the person wrote and says so; one too long is not sent', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  let refreshed = 0;
  let reads = 0;
  const panel = new TopicStatePanel({ host, reader: 'fable', send: async () => ({}), refresh: () => { refreshed++; },
    read: async () => (++reads > 1 ? Promise.reject(Error('offline')) : { topic: topic({ version: 5 }), participants: people(['fable', 'Set elsewhere', 2], ['tony', 'Reviews']) }),
    sendNote: async (current, note, revision) => { sent.push(revision);
      return { status: 'rejected', recorded: true, error: { code: 'REVISION_CONFLICT', message: 'x', current_versions: { responsibility_revision: 2 } } }; } });
  panel.paint(topic(), people(['fable', 'Mine', 1]));
  const field = host.find(node => node.id === 'topic-responsibility');
  type(field, 'Newer words'); key(field, 'Enter'); await settled();
  assert.deepEqual(sent, [1]);
  assert.equal(controls(host).notice.textContent, 'Your part changed elsewhere first, so yours was not saved; your words are kept. It now reads “Set elsewhere”: press Return to save yours in its place.');
  assert.equal(controls(host).notice.classes.has('quiet'), false);
  assert.equal(refreshed, 1, 'it asks for the part as it now stands');
  assert.equal(field.value, 'Newer words', 'a touched line keeps the person\'s words over fresh data');
  // Told, Return goes over the part now shown; when the read after a refusal fails, the notice says so.
  key(field, 'Enter'); await settled();
  assert.deepEqual([sent, controls(host).notice.textContent], [[1, 2], 'Your part changed elsewhere first, so yours was not saved; your words are kept. Reading it again failed, so press Return to try again.']);
  type(field, 'é'.repeat(513)); key(field, 'Enter'); await settled();
  assert.deepEqual(sent, [1, 2], 'a part over 1024 bytes is not sent');
  assert.equal(controls(host).notice.textContent, 'Your part is at most 1024 bytes; shorten it and press Return again.');
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
  await chip(host, 'Done').onclick();
  const notice = controls(host).notice;
  assert.equal(notice.text, 'The change was not confirmed. It stands as: Waiting on you · Needs a call on the deck — fable, Yesterday 5:33 PM.');
  assert.equal(notice.find(node => node.tag === 'time')?.dataset.ms, String(new Date(2026, 10, 5, 17, 33).getTime()), 'its time is a time node, repainted at midnight');
  assert.equal(notice.classes.has('quiet'), false, 'it is not a quiet Saved');
  assert.deepEqual([sent.length, reads], [1, 1], 'read once; the change is not sent again');
  assert.deepEqual([lit(host), controls(host).note.value], [['Waiting'], 'Needs a call on the deck'], 'the panel shows the topic as read');
  read = async () => { reads++; throw Error('offline'); };
  await chip(host, 'Done').onclick();
  assert.equal(controls(host).notice.text, 'The change was not confirmed, and reading where the topic stands again failed too.');
  assert.deepEqual(lit(host), ['Waiting'], 'it keeps what it last showed');
  assert.deepEqual([sent.length, reads], [2, 2]);
  const bare = new TopicStatePanel({ host: new Element('section'), reader: 'tony', send: async () => ({ status: 'unknown' }) });
  bare.paint(topic(), []); await chip(bare.host, 'Done').onclick();
  assert.equal(controls(bare.host).notice.text, 'The change was not confirmed, and reading where the topic stands again failed too.', 'a panel with no read never says Refresh');
  // A refusal with Core's own words says those, and reads nothing.
  const refusing = new TopicStatePanel({ host: new Element('section'), reader: 'tony', read: () => read(), send: async () => ({ status: 'rejected', error: { code: 'FORBIDDEN', message: 'No permission for this topic' } }) });
  refusing.paint(topic(), []); await chip(refusing.host, 'Done').onclick();
  assert.equal(controls(refusing.host).notice.text, 'No permission for this topic'); assert.equal(reads, 2);
});

test('a part that is not confirmed reads the topic once and says what the reader is responsible for now', async t => {
  dom(t);
  const host = new Element('section'), sent = [];
  let reads = 0, read = async () => { reads++; return { topic: topic({ version: 5 }), participants: people(['fable', 'Drafts the notes', 4]) }; };
  const panel = new TopicStatePanel({ host, reader: 'fable', send: async () => ({}), read: () => read(),
    sendNote: async (current, note) => { sent.push(note); return { status: 'unknown' }; } });
  panel.paint(topic(), people(['fable', 'Mine', 1]));
  const field = host.find(node => node.id === 'topic-responsibility');
  const save = async () => { key(field, 'Enter'); await settled(); };
  type(field, 'Newer words'); await save();
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

// The rule every line set in place keeps (docs/topic-settings.md), as a
// table: each line (the note, Your part, the title) by each way a save starts
// (Return, leaving it, Escape, a chip tap, a chip pressed from the line) by
// each history below, against a Core that keeps its own rules
// (aim_next/topic_state.py, responsibility.py). Leaving covers ✕ and closing
// Topic settings, which leave the line too. Whatever the history, a chip tap
// sends no line's words; nothing of the person's is called someone else's
// unless someone else changed that line since they began, and then a notice
// shows the newer words beside theirs before anything of theirs goes over
// them; and their own save, confirmed, unconfirmed or found saved only by a
// later refusal, is where the line begins next.
class Core {
  constructor() {
    this.topic = topic({ title: 'Old', state_note: 'Old', state_by: 'fable' });
    this.participants = [{ actor_id: 'tony', responsibility: 'Old', responsibility_revision: 1 }, { actor_id: 'fable', responsibility: '', responsibility_revision: 0 }, { actor_id: 'codex' }];
    this.log = []; this.next = {};
  }
  view() { return structuredClone({ topic: this.topic, participants: this.participants }); }
  // The panel's own read of the topic; the next unread of them fail.
  async read() { if (this.unread) { this.unread -= 1; throw Error('offline'); } return this.view(); }
  // Someone else's act: each changes what Core holds and its version.
  other(name, value) {
    if (name === 'duty') Object.assign(this.participants[0], { responsibility: value, responsibility_revision: this.participants[0].responsibility_revision + 1 });
    else if (name === 'title') this.topic.title = value;
    else Object.assign(this.topic, { state_note: value, state_by: 'fable', state_message_id: null });
    this.topic.version += 1;
  }
  reopen() { Object.assign(this.topic, { state: 'active', state_note: 'Reopened by a new message', state_message_id: 'm9', version: this.topic.version + 1 }); }
  // The next answer: held until released, and lost as unconfirmed or dropped
  // after Core commits; 'late' drops it before Core commits, which it then does
  // when land() is called, after whatever the panel reads in between.
  async answer(entry, apply) {
    const { hold, lose } = this.next; this.next = {};
    this.log.push(entry);
    const commit = () => { try { entry.result = apply(); entry.outcome = 'committed'; } catch (refusal) { entry.outcome = refusal.code; entry.receipt = { status: 'rejected', error: refusal }; } };
    if (lose === 'late') { this.land = commit; if (hold) await new Promise(resolve => { this.release = resolve; }); throw Error('Connection interrupted. Confirmation is unknown; your writing is kept.'); }
    commit();
    if (hold) await new Promise(resolve => { this.release = resolve; });
    // 'gone' drops whatever Core answers, a refusal too.
    if ((entry.outcome === 'committed' && lose === 'dropped') || lose === 'gone') throw Error('Connection interrupted. Confirmation is unknown; your writing is kept.');
    if (entry.outcome === 'committed') return lose === 'unconfirmed' ? { status: 'pending' } : { status: 'committed', result: entry.result };
    return entry.receipt;
  }
  update(current, args, fields) {
    return this.answer({ kind: 'topic.update', args, fields, version: current.version }, () => {
      const held = this.topic;
      const now = { title: held.title, archived: held.archived, state: held.state, note: held.state_note, waiting_on: [...held.waiting_on].sort() };
      const fenced = fields ? Object.entries(fields).every(([name, seen]) => JSON.stringify(name === 'waiting_on' ? [...seen].sort() : seen) === JSON.stringify(now[name]))
        : current.version === held.version;
      if (!fenced) throw { code: 'REVISION_CONFLICT', message: 'Writing changed' };
      if ('title' in args) held.title = args.title;
      if ('archived' in args) held.archived = args.archived;
      if (['state', 'note', 'waiting_on'].some(name => name in args)) {
        const state = args.state ?? held.state, said = (state === held.state || 'keep_note' in args) && !held.state_message_id;
        // Core keeps who it waits on sorted.
        Object.assign(held, { state, state_note: args.note ?? (said ? held.state_note : ''), waiting_on: args.waiting_on ? [...args.waiting_on].sort() : state === 'waiting' ? held.waiting_on : [],
          state_by: 'tony', state_message_id: null });
      }
      held.version += 1;
      return { topic_id: held.id, version: held.version, title: held.title, archived: held.archived, state: held.state, note: held.state_note,
        waiting_on: held.waiting_on, state_by: held.state_by, state_ms: null };
    });
  }
  duty(note, revision) {
    return this.answer({ kind: 'responsibility.set', args: { note }, version: revision }, () => {
      const mine = this.participants[0];
      if (revision !== mine.responsibility_revision) throw { code: 'REVISION_CONFLICT', message: 'Your note changed' };
      if (note !== mine.responsibility) Object.assign(mine, { responsibility: note, responsibility_revision: mine.responsibility_revision + 1 });
      this.topic.version += 1;
      return { topic_id: 't1', actor_id: 'tony', note: mine.responsibility, responsibility_revision: mine.responsibility_revision, version: this.topic.version };
    });
  }
  held(name) { return name === 'duty' ? this.participants[0].responsibility : name === 'title' ? this.topic.title : this.topic.state_note; }
}

const LINES = {
  note: { input: host => controls(host).note, other: 'title' },
  duty: { input: host => controls(host).part, other: 'note' },
  title: { input: host => controls(host).title, other: 'note', open: host => controls(host).rename.onclick() },
};
const TRIGGERS = {
  Return: input => key(input, 'Enter'),
  leaving: input => leave(input),
  Escape: input => key(input, 'Escape'),
  'a chip tap': (input, host) => chip(host, 'Ready for review').onclick(),
  // As a browser has it: the press on a chip leaves the line first.
  'a chip pressed from the line': (input, host) => { leave(input); return chip(host, 'Ready for review').onclick(); },
};
// Each history: what happens before the trigger, and what the line, Core and
// the notices should then say. mine: the words the person ends with; shown:
// what the line shows as saved before the trigger.
const HISTORIES = {
  'nothing changed': { nochange: true, mine: 'Old', shown: 'Old', async before({ input }) { type(input, 'Oldx'); type(input, 'Old'); } },
  'typed back after theirs came': { nochange: true, mine: 'Old', shown: 'Theirs', async before({ input, core, name, panel }) {
    type(input, 'Oldx'); core.other(name, 'Theirs'); panel.paint(core.view().topic, core.view().participants); type(input, 'Old');
  } },
  'theirs came the same as mine': { nochange: true, mine: 'Mine', shown: 'Mine', async before({ input, core, name, panel }) {
    type(input, 'Mine'); core.other(name, 'Mine'); panel.paint(core.view().topic, core.view().participants);
  } },
  'someone else changed it': { mine: 'Mine', theirs: true, shown: 'Old', async before({ input, core, name }) { type(input, 'Mine'); core.other(name, 'Theirs'); } },
  'fresh data mid-edit': { mine: 'Mine', theirs: true, shown: 'Theirs', async before({ input, core, name, panel }) {
    type(input, 'Mine'); core.other(name, 'Theirs'); panel.paint(core.view().topic, core.view().participants);
    assert.equal(input.value, 'Mine', 'fresh data never replaces words being edited');
  } },
  'another field changed': { mine: 'Mine', shown: 'Old', async before({ input, core, name }) { type(input, 'Mine'); core.other(LINES[name].other, 'Other'); } },
  'my own save committed': { mine: 'Mine more', shown: 'Mine', async before(at) { await own(at); } },
  // A lost answer, with fresh data slow to come: only the panel's own read says what was saved.
  'my own save unconfirmed': { mine: 'Mine more', shown: 'Mine', async before(at) { at.core.quiet = true; await own(at, 'unconfirmed'); } },
  'my own save dropped': { mine: 'Mine more', shown: 'Mine', async before(at) { at.core.quiet = true; await own(at, 'dropped'); } },
  // The same outage loses the answer and the panel's one read: only Core knows the person's words were saved.
  'my own save dropped, and its read': { mine: 'Mine more', landed: true, shown: 'Old', async before(at) { at.core.quiet = true; at.core.unread = 1; await own(at, 'dropped'); } },
  // The panel reads before the lost save lands, so its read shows the words from before.
  'my own save landing after its read': { mine: 'Mine more', landed: true, shown: 'Old', async before(at) { at.core.quiet = true; await own(at, 'late'); at.core.land(); } },
  // The same, with nothing typed after: the words go nowhere again, as they are saved.
  'my own save dropped, and its read, then the same words': { mine: 'Mine', landed: true, shown: 'Old', async before(at) {
    at.core.quiet = true; at.core.unread = 1; await own(at, 'dropped', () => {}, 'Mine');
  } },
  'my lost save, then theirs': { mine: 'Mine more', theirs: true, shown: 'Theirs', async before(at) { at.core.quiet = true; await own(at, 'dropped', () => at.core.other(at.name, 'Theirs')); } },
  // Their words arrive after the person's own save went; the person puts them back, sees theirs, and begins again from them.
  'my save, then theirs, begun again': { mine: 'Mine more', shown: 'Theirs', async before({ input, core, panel, name }) {
    type(input, 'Mine'); core.next = { hold: true };
    const turn = key(input, 'Enter') && panel.queue;
    await settled(); core.other(name, 'Theirs'); panel.paint(core.view().topic, core.view().participants);
    key(input, 'Escape'); assert.equal(input.value, 'Theirs');
    type(input, 'Mine more'); core.release(); await turn; await settled();
  } },
  'my own tap on a reopened topic': { mine: 'Mine', reopened: true, shown: 'Old', async before(at) { await reopenedTap(at); } },
  'my own tap on a reopened topic, unconfirmed': { mine: 'Mine', reopened: true, shown: 'Old', async before(at) { at.core.quiet = true; await reopenedTap(at, 'unconfirmed'); } },
  // The tap starts the note afresh, and the panel never learns it: the note's
  // words then go again from the empty note the tap left.
  'my own tap on a reopened topic, dropped, and its read': { mine: 'Mine', reopened: true, landed: true, shown: 'Old',
    escaped: { note: ['Reopened by a new message', ''] }, async before(at) { at.core.quiet = true; at.core.unread = 1; await reopenedTap(at, 'dropped'); } },
};
// The person taps Waiting on a reopened topic and types in the line while its answer is out.
async function reopenedTap({ input, core, host }, lose = null) {
    core.next = { hold: true, lose };
    const tap = chip(host, 'Waiting').onclick();
    await settled(); type(input, 'Mine'); core.release(); await tap; await settled();
}
// The person saves 'Mine' and types ' more' while its answer is out; lose
// says how the answer goes, and between happens before it comes back.
async function own({ input, core, panel }, lose = null, between = () => {}, more = 'Mine more') {
  type(input, 'Mine'); core.next = { hold: true, lose };
  const turn = key(input, 'Enter') && panel.queue;
  await settled(); type(input, more); between(); core.release(); await turn; await settled();
}

for (const [name, line] of Object.entries(LINES)) for (const [how, trigger] of Object.entries(TRIGGERS)) for (const [story, history] of Object.entries(HISTORIES)) {
  test(`in place: ${name}, ${how}, ${story}`, async t => {
    dom(t);
    const core = new Core(), host = new Element('section');
    if (history.reopened) core.reopen();
    const notices = [];
    let attended = 0;
    const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields) => core.update(current, args, fields),
      sendNote: (current, note, revision) => core.duty(note, revision), read: () => core.read(), attention: () => { attended++; },
      refresh: () => setImmediate(() => { if (!core.quiet) panel.paint(core.view().topic, core.view().participants); }) });
    // Every notice shown, even one replaced before an act settles.
    const said = [], show = panel.show.bind(panel);
    panel.show = (message, quiet) => { said.push(message); show(message, quiet); };
    panel.paint(core.view().topic, core.view().participants);
    line.open?.(host);
    const input = line.input(host), at = { input, core, panel, host, name };
    const start = history.reopened && name === 'note' ? 'Reopened by a new message' : 'Old';
    assert.equal(input.value, start);
    // Every notice, as it reads once each act settles.
    const act = async run => { const turn = run(); await turn; await settled(); notices.push(controls(host).notice.hidden ? null : controls(host).notice.textContent); };
    await act(() => history.before(at));
    const before = core.log.length, attendedBefore = attended;
    await act(() => trigger(input, host));
    // Topic settings is shown again only for words someone else's refused.
    if (!history.theirs) assert.equal(attended, attendedBefore, 'nothing of the person\'s is left unsaved');
    const lineSends = () => core.log.filter(entry => (name === 'duty' ? entry.kind === 'responsibility.set' : name in entry.args));
    const refused = () => lineSends().filter(entry => entry.outcome === 'REVISION_CONFLICT');
    // R1: a chip sends only where it stands, and keeps the note without sending it.
    for (const entry of core.log.filter(entry => 'state' in entry.args)) assert.deepEqual(Object.keys(entry.args).filter(key => !['state', 'waiting_on', 'keep_note'].includes(key)), [], `a tap sends no line's words: ${JSON.stringify(entry.args)}`);
    const after = core.log.slice(before);
    if (how === 'Escape') {
      // The note a tap after a reopen started afresh is empty.
      // A panel that never learned what Core holds puts back what it last read.
      const [shown, held] = history.escaped?.[name] ?? [history.reopened && name === 'note' ? '' : history.shown, null];
      assert.deepEqual(after.filter(entry => lineSends().includes(entry)), [], 'Escape sends nothing');
      assert.equal(input.value, shown, 'Escape puts back what is saved');
      assert.equal(core.held(name), held ?? (history.theirs || story.startsWith('typed back') || story.endsWith('begun again') ? 'Theirs' : history.landed && !history.reopened ? 'Mine' : shown));
      return;
    }
    if (history.nochange) {
      // Words that are no change: nothing goes, and the line follows fresh data again.
      assert.deepEqual(lineSends(), [], 'words that are no change are not sent');
      assert.equal(input.value, history.shown, 'the line shows what is saved');
      core.other(name, 'Newer'); panel.paint(core.view().topic, core.view().participants);
      assert.deepEqual([input.value, core.held(name)], ['Newer', 'Newer'], 'the line follows fresh data again');
      return;
    }
    if (how === 'a chip pressed from the line') assert.equal(core.topic.state, 'review', 'the tap saves where it stands');
    // A chip tap leaves the words in the line; Return then saves them.
    if (how === 'a chip tap') {
      assert.equal(input.value, history.mine, 'a tap leaves the words typed in the line');
      await act(() => key(input, 'Enter'));
    }
    if (history.theirs) {
      // Refused once, said with the newer words showing, kept; Return again puts them in its place.
      assert.equal(refused().length, 1, `refused once over the newer words: ${JSON.stringify(lineSends())}`);
      assert.equal(core.held(name), 'Theirs', 'their words stand until the person has seen them');
      assert.match(notices.at(-1) ?? '', /Theirs/, 'the notice shows the newer words');
      assert.equal(input.value, history.mine, 'the person\'s words are kept');
      await act(() => key(input, 'Enter'));
    } else {
      // Nobody else changed it: nothing of the person's is called someone else's.
      // Core refuses their words only over their own lost save it holds, and
      // they go again from what that one saved.
      assert.deepEqual(said.filter(message => typeof message === 'string' && /first, so|Someone else/.test(message)), [], 'nothing of the person\'s is called someone else\'s');
      const then = refused().map(entry => lineSends()[lineSends().indexOf(entry) + 1]?.outcome);
      assert.ok(then.length <= (history.landed ? 1 : 0) && then.every(outcome => outcome === 'committed' || outcome === undefined),
        `refused only over their own lost save, then saved: ${JSON.stringify(lineSends())}`);
    }
    assert.equal(core.held(name), history.mine, 'Core holds the person\'s words');
    assert.equal(notices.at(-1), 'Saved');
  });
}

// Every tap by the same rule: the state chips, a person chip and Archive,
// each after someone else changed what it changes, and after a tap of the
// person's own whose answer was lost with the panel unable to learn it.
const TAPS = {
  'a state chip': { first: host => chip(host, 'Done').onclick(), tap: host => chip(host, 'Ready for review').onclick(),
    other: core => Object.assign(core.topic, { state: 'done', waiting_on: [], state_by: 'fable' }), theirs: core => core.topic.state === 'done',
    mine: core => [core.topic.state, core.topic.waiting_on], expect: ['review', []], sends: ['REVISION_CONFLICT', 'committed'] },
  // The person taps codex again while it still shows unlit: they meant to add codex, as the first did,
  // which Core saved in its own order.
  'a person chip': { first: host => chip(host, 'codex').onclick(), tap: host => chip(host, 'codex').onclick(),
    other: core => Object.assign(core.topic, { waiting_on: ['fable', 'zed'] }), theirs: core => core.topic.waiting_on.includes('zed'),
    mine: core => [core.topic.state, core.topic.waiting_on], expect: ['waiting', ['codex', 'fable']], sends: ['REVISION_CONFLICT'] },
  // Archive pressed again while it still says Archive.
  Archive: { first: host => controls(host).archive.onclick(), tap: host => controls(host).archive.onclick(),
    other: core => Object.assign(core.topic, { archived: true }), theirs: core => core.topic.archived,
    mine: core => [core.topic.archived, controls(core.host).archive.textContent], expect: [true, 'Unarchive'], sends: ['REVISION_CONFLICT'] },
};
const TAP_HISTORIES = {
  'someone else changed it': { theirs: true, async before({ core, tap }) { tap.other(core); core.topic.version += 1; } },
  'my own tap dropped, and its read': { async before({ core, host, tap }) { core.next = { lose: 'dropped' }; core.unread = 1; await tap.first(host); await settled(); } },
  'my own tap landing after its read': { async before({ core, host, tap }) { core.next = { lose: 'late' }; await tap.first(host); await settled(); core.land(); } },
};
for (const [how, tap] of Object.entries(TAPS)) for (const [story, history] of Object.entries(TAP_HISTORIES)) {
  test(`a tap: ${how}, ${story}`, async t => {
    dom(t);
    const core = new Core(), host = new Element('section');
    Object.assign(core.topic, { state: 'waiting', waiting_on: ['fable'] });
    core.quiet = true; core.host = host;
    const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields) => core.update(current, args, fields),
      sendNote: (current, note, revision) => core.duty(note, revision), read: () => core.read(), refresh: () => {} });
    const said = [], show = panel.show.bind(panel);
    panel.show = (message, quiet) => { said.push(message); show(message, quiet); };
    panel.paint(core.view().topic, core.view().participants);
    await history.before({ core, host, tap, panel });
    said.length = 0;
    const before = core.log.length;
    await tap.tap(host); await settled();
    const refusals = said.filter(message => typeof message === 'string' && /first, so|Someone else/.test(message));
    if (history.theirs) {
      // R2: refused in plain words, with the topic as it stands now; theirs stands.
      assert.deepEqual([controls(host).notice.textContent, tap.theirs(core)], [CHANGED, true]);
      assert.deepEqual(core.log.slice(before).map(entry => entry.outcome), ['REVISION_CONFLICT'], 'nothing goes over theirs');
      return;
    }
    // R3: the person's own lost tap is never someone else's change, and this one is saved.
    assert.deepEqual(refusals, [], 'nothing of the person\'s is called someone else\'s');
    assert.deepEqual(tap.mine(core), tap.expect);
    // Refused over the person's own tap, then worked out again: what is already so is not sent (R4).
    assert.deepEqual(core.log.slice(before).map(entry => entry.outcome), tap.sends);
    assert.equal(controls(host).notice.textContent, 'Saved');
  });
}

// A refusal is the person's own only when everything it was fenced on is as
// they read it or as their own lost change left it: their lost tap set
// Waiting, and someone else then added who it waits on.
test('a tap after the person\'s own lost tap and someone else\'s change to who it waits on is refused, and theirs stands', async t => {
  dom(t);
  const core = new Core(), host = new Element('section');
  core.quiet = true;
  const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields) => core.update(current, args, fields), read: () => core.read() });
  panel.paint(core.view().topic, core.view().participants);
  core.next = { lose: 'dropped' }; core.unread = 1;
  await chip(host, 'Waiting').onclick(); await settled();
  Object.assign(core.topic, { waiting_on: ['codex'], version: core.topic.version + 1 });
  await chip(host, 'Ready for review').onclick(); await settled();
  assert.deepEqual([controls(host).notice.textContent, core.topic.state, core.topic.waiting_on], [CHANGED, 'waiting', ['codex']]);
  assert.deepEqual(core.log.map(entry => entry.outcome), ['committed', 'REVISION_CONFLICT'], 'nothing goes over theirs');
});

// The person's own words, once saved, can come back from someone else. A
// line is the person's again only from a start their own lost change was
// fenced on, and only until that change is known saved; after that, words
// equal to theirs are someone else's, refused and said like any other.
const lined = (t, core = new Core()) => {
  dom(t);
  const host = new Element('section');
  core.quiet = true;
  const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields) => core.update(current, args, fields), read: () => core.read() });
  const fresh = () => panel.paint(core.view().topic, core.view().participants);
  fresh();
  return { core, host, panel, fresh, input: controls(host).note, said: () => controls(host).notice.textContent };
};
const enter = async input => { key(input, 'Enter'); await settled(); };
const KEPT_MINE = 'Someone else changed the note first, so yours was not saved; your words are kept. It now reads “Mine”: press Return to save yours in its place.';

test('words someone else saves equal to the person\'s lost words, after theirs came in between, are refused like any other', async t => {
  const { core, input, fresh, said } = lined(t);
  type(input, 'Mine'); core.next = { lose: 'dropped' }; core.unread = 1; await enter(input);
  type(input, 'Mine more'); core.other('note', 'Theirs'); fresh();
  await enter(input);
  assert.match(said(), /It now reads “Theirs”/);
  core.other('note', 'Mine'); fresh();
  const before = core.log.length;
  await enter(input);
  assert.deepEqual([said(), core.held('note'), input.value], [KEPT_MINE, 'Mine', 'Mine more'], 'their words stand, said, and the person\'s are kept');
  assert.deepEqual(core.log.slice(before).map(entry => [entry.fields, entry.outcome]), [[{ note: 'Theirs' }, 'REVISION_CONFLICT']], 'refused once, fenced on the words the person last saw');
});

test('a tap after someone else set what the person\'s lost tap would have, with theirs in between, is refused', async t => {
  const { core, host, fresh } = lined(t);
  core.next = { lose: 'dropped' }; core.unread = 1;
  await chip(host, 'Done').onclick(); await settled();
  Object.assign(core.topic, { state: 'review', version: core.topic.version + 1 }); fresh();
  Object.assign(core.topic, { state: 'done', version: core.topic.version + 1 });
  const before = core.log.length;
  await chip(host, 'Active').onclick(); await settled();
  assert.deepEqual([controls(host).notice.textContent, core.topic.state], [CHANGED, 'done']);
  assert.deepEqual(core.log.slice(before).map(entry => entry.outcome), ['REVISION_CONFLICT']);
});

for (const [how, settle] of Object.entries({
  // Known saved by its read, then the next words commit.
  'a commit after it': async ({ core, input }) => { core.unread = 0; type(input, 'Mine'); core.next = { lose: 'dropped' }; await enter(input); type(input, 'Mine more'); await enter(input); },
  // Known saved by a refusal, after which the same words send nothing.
  'a refusal that finds it, with nothing left to send': async ({ core, input }) => { type(input, 'Mine'); core.next = { lose: 'dropped' }; core.unread = 1; await enter(input); await enter(input); },
})) {
  test(`once the person's lost words are known saved (${how}), the same words from someone else later are theirs`, async t => {
    const at = lined(t), { core, input, fresh, said } = at;
    await settle(at);
    assert.equal(said(), 'Saved');
    core.other('note', 'Old'); fresh();
    assert.equal(input.value, 'Old', 'the line follows the data');
    type(input, 'X'); core.other('note', 'Mine'); fresh();
    assert.equal(input.value, 'X', 'the words being edited stay');
    await enter(input);
    assert.deepEqual([said(), core.held('note'), input.value], [KEPT_MINE, 'Mine', 'X'], 'their words stand, said, and the person\'s are kept');
  });
}

// An act made before a refusal comes back was made before the person saw the
// newer value: it never goes over that value. Each line, saved on Return and
// then left, saved again or left by pressing a chip while Core's refusal of
// the first is out, over someone else's words the page has not shown.
const SECOND = {
  'Return then leaving it': input => leave(input),
  'Return then Return': input => key(input, 'Enter'),
  'Return then a chip pressed from the line': (input, host) => { leave(input); return chip(host, 'Ready for review').onclick(); },
};
for (const [name, line] of Object.entries(LINES)) for (const [how, second] of Object.entries(SECOND)) {
  test(`before a refusal comes back: ${name}, ${how}`, async t => {
    dom(t);
    const core = new Core(), host = new Element('section');
    const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields) => core.update(current, args, fields),
      sendNote: (current, note, revision) => core.duty(note, revision), read: () => core.read(),
      refresh: () => setImmediate(() => panel.paint(core.view().topic, core.view().participants)) });
    const said = [], show = panel.show.bind(panel);
    panel.show = (message, quiet) => { said.push(message); show(message, quiet); };
    panel.paint(core.view().topic, core.view().participants);
    line.open?.(host);
    const input = line.input(host);
    type(input, 'Mine'); core.other(name, 'Theirs');
    core.next = { hold: true };
    key(input, 'Enter'); await settled();
    const out = second(input, host); await settled();
    core.release(); await out; await panel.queue; await settled();
    const lineSends = () => core.log.filter(entry => (name === 'duty' ? entry.kind === 'responsibility.set' : name in entry.args)).map(entry => entry.outcome);
    assert.deepEqual(lineSends(), ['REVISION_CONFLICT'], 'refused once, and nothing of the person\'s goes over the words they never saw');
    assert.deepEqual([core.held(name), input.value], ['Theirs', 'Mine'], 'their words stand; the person\'s are kept');
    assert.match(controls(host).notice.textContent, /Theirs/, 'the notice shows the newer words');
    assert.ok(!said.slice(said.findIndex(message => typeof message === 'string' && /Theirs/.test(message))).includes('Saved') || how.includes('chip'),
      'nothing says Saved over the refusal');
    // Told, Return puts theirs in its place.
    key(input, 'Enter'); await panel.queue; await settled();
    assert.deepEqual([lineSends(), core.held(name), controls(host).notice.textContent], [['REVISION_CONFLICT', 'committed'], 'Mine', 'Saved']);
  });
}

// A tap means the state shown when it was pressed: one pressed while an
// earlier tap's refusal is out never goes over the state the person never saw.
test('a tap pressed while the refusal of the tap before it is out is not sent; theirs stands', async t => {
  const { core, host } = lined(t);
  Object.assign(core.topic, { state: 'done', state_by: 'fable', version: core.topic.version + 1 });
  core.next = { hold: true };
  const first = chip(host, 'Waiting').onclick(); await settled();
  const second = chip(host, 'Ready for review').onclick(); await settled();
  core.release(); await first; await second; await settled();
  assert.deepEqual([core.log.map(entry => [entry.args.state, entry.outcome]), core.topic.state, controls(host).notice.textContent, lit(host)],
    [[['waiting', 'REVISION_CONFLICT']], 'done', CHANGED, ['Done']], 'refused once; their Done stands and shows');
  await chip(host, 'Ready for review').onclick(); await settled();
  assert.deepEqual([core.log.at(-1).fields, core.topic.state], [{ state: 'done', waiting_on: [] }, 'review'], 'pressed again once Done shows, it goes over Done');
});

test('a tap waiting its turn while newer data arrives is fenced on the state shown when it was pressed', async t => {
  const { core, host, panel, fresh, input } = lined(t);
  type(input, 'Mine'); core.next = { hold: true };
  key(input, 'Enter'); await settled();
  const tap = chip(host, 'Ready for review').onclick();
  Object.assign(core.topic, { state: 'done', state_by: 'fable', version: core.topic.version + 1 }); fresh();
  core.release(); await tap; await panel.queue; await settled();
  assert.deepEqual([core.log.map(entry => entry.outcome), core.topic.state, controls(host).notice.textContent], [['committed', 'REVISION_CONFLICT'], 'done', CHANGED]);
  assert.deepEqual(core.log[1].fields, { state: 'active', waiting_on: [] });
});

// Every lost change of the person's to a line is kept, not only the last:
// the first may be the one Core saved.
test('two lost saves from the same start, the first saved: the next words go on from it, called nobody else\'s', async t => {
  const { core, input, said } = lined(t);
  const shown = [];
  type(input, 'A'); core.next = { lose: 'dropped' }; core.unread = 1; await enter(input); shown.push(said());
  type(input, 'AB'); core.next = { lose: 'gone' }; await enter(input); shown.push(said());
  type(input, 'ABC'); await enter(input); shown.push(said());
  assert.deepEqual(core.log.map(entry => [entry.fields, entry.args.note, entry.outcome]),
    [[{ note: 'Old' }, 'A', 'committed'], [{ note: 'Old' }, 'AB', 'REVISION_CONFLICT'], [{ note: 'A' }, 'ABC', 'committed']]);
  assert.deepEqual(shown.filter(words => /first, so|Someone else/.test(words)), [], 'nothing of the person\'s is called someone else\'s');
  assert.deepEqual([core.held('note'), said()], ['ABC', 'Saved']);
});

// A lost save a read has shown saved is settled: words equal to it that
// someone else saves later are theirs.
test('a lost save found saved by a read is settled; the same words from someone else later are refused like any other', async t => {
  const { core, input, fresh, said } = lined(t);
  type(input, 'A'); core.next = { lose: 'dropped' }; await enter(input);
  leave(input); await settled();
  core.other('note', 'Old'); fresh();
  assert.equal(input.value, 'Old');
  type(input, 'X'); core.other('note', 'A'); fresh();
  const before = core.log.length;
  await enter(input);
  assert.deepEqual(core.log.slice(before).map(entry => [entry.fields, entry.outcome]), [[{ note: 'Old' }, 'REVISION_CONFLICT']]);
  assert.deepEqual([said(), core.held('note'), input.value],
    ['Someone else changed the note first, so yours was not saved; your words are kept. It now reads “A”: press Return to save yours in its place.', 'A', 'X']);
});

// Every tap by the same rule: pressed twice after someone else changed what
// it changes, the second while the first's refusal is out.
for (const [how, tap] of Object.entries(TAPS)) {
  test(`a tap: ${how}, pressed again before the refusal comes back`, async t => {
    dom(t);
    const core = new Core(), host = new Element('section');
    Object.assign(core.topic, { state: 'waiting', waiting_on: ['fable'] });
    core.quiet = true; core.host = host;
    const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields) => core.update(current, args, fields), read: () => core.read() });
    panel.paint(core.view().topic, core.view().participants);
    tap.other(core); core.topic.version += 1;
    core.next = { hold: true };
    const first = tap.tap(host); await settled();
    const second = tap.tap(host); await settled();
    core.release(); await first; await second; await settled();
    assert.deepEqual([core.log.map(entry => entry.outcome), controls(host).notice.textContent, tap.theirs(core)], [['REVISION_CONFLICT'], CHANGED, true], 'refused once, and nothing goes over theirs');
  });
}

// A Return waiting its turn belongs to its edit: put back by Escape, it sends
// nothing, even when the person has begun again from newer words.
test('a Return put back by Escape before its turn sends nothing, though the person has begun again', async t => {
  const { core, host, panel, fresh, input, said } = lined(t);
  core.next = { hold: true };
  const tap = chip(host, 'Ready for review').onclick(); await settled();
  type(input, 'Mine'); key(input, 'Enter');
  key(input, 'Escape');
  core.other('note', 'Theirs'); fresh();
  type(input, 'Other');
  core.release(); await tap; await panel.queue; await settled();
  assert.deepEqual([core.log.map(entry => Object.keys(entry.args)), core.held('note'), input.value, said()], [[['state', 'keep_note']], 'Theirs', 'Other', 'Saved']);
});
