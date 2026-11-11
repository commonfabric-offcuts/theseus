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
// The version Core last committed in this test: each commit is one past it,
// and past the version the page sent it from, as Core counts.
const core = { version: -Infinity };
const nextVersion = current => (core.version = Math.max(core.version, current.version) + 1);
function dom(t) {
  const previous = globalThis.document;
  focus.on = null; core.version = -Infinity;
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
const committed = (current, args, version = nextVersion(current)) => {
  const state = args.state ?? current.state, same = (state === current.state || 'keep_note' in args) && !current.state_message_id;
  return { status: 'committed', result: { topic_id: current.id, version, title: args.title ?? current.title, archived: args.archived ?? current.archived,
    state, note: args.note ?? (same ? current.state_note : ''), waiting_on: args.waiting_on ?? (state === 'waiting' ? current.waiting_on ?? [] : []),
    state_by: 'tony', state_ms: null, state_message_id: ['state', 'note', 'waiting_on'].some(name => name in args) ? null : current.state_message_id ?? null } };
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

// ✅ Done at the top of a topic Ready for review (Tony, 10 Nov) is the Done chip's tap.
test('✅ Done marks the topic Done as the Done chip does, for a reader who may say where it stands, and says a refusal in Topic settings', async t => {
  dom(t);
  const painted = [];
  const { host, panel, sent } = live({ state: 'review', state_note: 'Live in release 43 since 9:05 AM Tue Nov 10' }, [{ actor_id: 'tony' }], 'tony',
    { painted: item => painted.push(item.state) });
  assert.equal(panel.says, true);
  await panel.markDone();
  assert.deepEqual(sent, [[{ state: 'review', waiting_on: [] }, { state: 'done', keep_note: true }]], 'the state alone, fenced as a chip is; Core keeps the note');
  assert.deepEqual([lit(host), painted.at(-1), panel.topic.state_note], [['Done'], 'done', 'Live in release 43 since 9:05 AM Tue Nov 10'], 'it reads Done, and the top of the topic is painted Done');
  await panel.markDone();
  assert.equal(sent.length, 1, 'pressed again once Done, it sends nothing');
  // A reader Core does not let say where it stands is offered no ✅, and pressing sends nothing.
  const reader = live({ state: 'review' }, [{ actor_id: 'someone-else' }], 'fable');
  assert.equal(reader.panel.says, false);
  await reader.panel.markDone();
  assert.deepEqual(reader.sent, []);
  // Refused because someone changed where it stands first: Topic settings opens to say so; a chip's refusal opens nothing.
  const opened = [];
  const refusing = new TopicStatePanel({ host: new Element('section'), reader: 'tony', attention: () => opened.push('open'), read: async () => null,
    send: async () => ({ status: 'rejected', error: { code: 'REVISION_CONFLICT', message: 'changed' } }) });
  refusing.paint(topic({ state: 'review' }), [{ actor_id: 'tony' }]);
  await chip(refusing.host, 'Active').onclick(); await settled();
  assert.deepEqual(opened, [], 'a tap inside Topic settings is answered there');
  await refusing.markDone(); await settled();
  assert.deepEqual([opened, controls(refusing.host).notice.textContent], [['open'], CHANGED]);
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

test('each field saves on its own; within one, saves go one at a time and only the latest goes next, fenced on what the one before saved', async t => {
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
  assert.deepEqual(sent, [[{ note: '' }, { note: 'Pick one' }], [{ state: 'waiting', waiting_on: ['fable'] }, { state: 'review', keep_note: true }]],
    'the tap goes at once, beside the note; neither carries the other');
  await answerAll(); await tap;
  assert.deepEqual(lit(host), ['Ready for review']);
  // Taps while the tap before is out wait for its answer; only the latest goes next.
  const taps = [chip(host, 'Done').onclick(), chip(host, 'Done').onclick(), chip(host, 'Waiting').onclick(), chip(host, 'Active').onclick()];
  await answerAll(); await Promise.all(taps);
  assert.deepEqual(sent.slice(2), [[{ state: 'review', waiting_on: [] }, { state: 'done', keep_note: true }], [{ state: 'done', waiting_on: [] }, { state: 'active', keep_note: true }]],
    'Done, then the last tap, fenced on the Done it saved');
  assert.deepEqual(lit(host), ['Active']);
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
const committedPart = (current, note, revision) => ({ status: 'committed', result: { topic_id: current.id, actor_id: 'fable', note, responsibility_revision: revision + 1, changed: true, version: nextVersion(current) } });

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
  assert.deepEqual([panel.mine().responsibility, panel.mine().responsibility_revision], ['Drafts the release notes', 4], 'the answer\'s revision is kept, so the next change sends it');
  assert.equal(panel.topic.version, 4, 'the answer says nothing of the topic, which stays as read');
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
    // log: each command Core ran, once; done: its outcome by operation id;
    // asked: each command sent again, answered from done.
    this.log = []; this.next = {}; this.done = new Map(); this.asked = [];
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
  // after Core runs it; 'late' drops it before Core runs it, which it then
  // does when land() is called, after whatever the panel reads in between.
  // Core runs each operation once, as aim_next/store.py does: the same id
  // sent again is answered with the outcome it stored, a refusal too.
  async answer(entry, apply, id) {
    const { hold, lose } = this.next; this.next = {};
    const run = () => {
      if (id !== undefined && this.done.has(id)) { this.asked.push(id); return this.done.get(id); }
      this.log.push(entry);
      try { entry.result = apply(); entry.outcome = 'committed'; } catch (refusal) { entry.outcome = refusal.code; entry.receipt = { status: 'rejected', error: refusal }; }
      if (id !== undefined) this.done.set(id, entry);
      return entry;
    };
    const lost = () => Error('Connection interrupted. Confirmation is unknown; your writing is kept.');
    if (lose === 'late') { this.land = run; if (hold) await new Promise(resolve => { this.release = resolve; }); throw lost(); }
    const done = run();
    if (hold) await new Promise(resolve => { this.release = resolve; });
    // 'gone' drops whatever Core answers, a refusal too.
    if ((done.outcome === 'committed' && lose === 'dropped') || lose === 'gone') throw lost();
    if (done.outcome === 'committed') return lose === 'unconfirmed' ? { status: 'pending' } : { status: 'committed', result: done.result };
    return done.receipt;
  }
  update(current, args, fields, id) {
    return this.answer({ kind: 'topic.update', args, fields, version: current.version, id }, () => {
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
        waiting_on: held.waiting_on, state_by: held.state_by, state_ms: null, state_message_id: held.state_message_id ?? null };
    }, id);
  }
  duty(note, revision, id) {
    return this.answer({ kind: 'responsibility.set', args: { note }, version: revision, id }, () => {
      const mine = this.participants[0];
      if (revision !== mine.responsibility_revision) throw { code: 'REVISION_CONFLICT', message: 'Your note changed' };
      if (note !== mine.responsibility) Object.assign(mine, { responsibility: note, responsibility_revision: mine.responsibility_revision + 1 });
      this.topic.version += 1;
      return { topic_id: 't1', actor_id: 'tony', note: mine.responsibility, responsibility_revision: mine.responsibility_revision, version: this.topic.version };
    }, id);
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
  // Lost before it reached Core, which never runs it: it goes again, as itself, at the person's next act.
  'my own save never reached Core': { mine: 'Mine more', shown: 'Old', async before(at) { at.core.quiet = true; await own(at, 'late'); } },
  // The connection comes back before the person acts again: Core answers for the lost save then.
  'my own save dropped, then the connection back': { mine: 'Mine more', landed: true, shown: 'Mine', async before(at) {
    at.core.quiet = true; at.core.unread = 1; await own(at, 'dropped'); await at.panel.reconnected(); await settled();
  } },
  'my own save never reached Core, then the connection back': { mine: 'Mine more', landed: true, shown: 'Mine', async before(at) {
    at.core.quiet = true; at.core.unread = 1; await own(at, 'late'); await at.panel.reconnected(); await settled();
  } },
  'my lost save, then theirs, then the connection back': { mine: 'Mine more', theirs: true, shown: 'Theirs', async before(at) {
    at.core.quiet = true; await own(at, 'dropped', () => at.core.other(at.name, 'Theirs')); await at.panel.reconnected(); await settled();
  } },
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
    const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields, id) => core.update(current, args, fields, id),
      sendNote: (current, note, revision, id) => core.duty(note, revision, id), read: () => core.read(), attention: () => { attended++; },
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
    mine: core => [core.topic.state, core.topic.waiting_on], expect: ['review', []], sends: ['committed'] },
  // The person taps codex again while it still shows unlit: they meant to add codex, as the first did,
  // which Core saved in its own order.
  'a person chip': { first: host => chip(host, 'codex').onclick(), tap: host => chip(host, 'codex').onclick(),
    other: core => Object.assign(core.topic, { waiting_on: ['fable', 'zed'] }), theirs: core => core.topic.waiting_on.includes('zed'),
    mine: core => [core.topic.state, core.topic.waiting_on], expect: ['waiting', ['codex', 'fable']], sends: [] },
  // Archive pressed again while it still says Archive.
  Archive: { first: host => controls(host).archive.onclick(), tap: host => controls(host).archive.onclick(),
    other: core => Object.assign(core.topic, { archived: true }), theirs: core => core.topic.archived,
    mine: core => [core.topic.archived, controls(core.host).archive.textContent], expect: [true, 'Unarchive'], sends: [] },
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
    const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields, id) => core.update(current, args, fields, id),
      sendNote: (current, note, revision, id) => core.duty(note, revision, id), read: () => core.read(), refresh: () => {} });
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
    // Their lost tap is asked about once, as the same command, and Core's
    // answer is where this tap begins: what is already so is not sent (R4).
    assert.equal(core.asked.length, 1, 'the lost tap asked again once');
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
  const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields, id) => core.update(current, args, fields, id), read: () => core.read() });
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
  const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields, id) => core.update(current, args, fields, id), read: () => core.read() });
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
    const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields, id) => core.update(current, args, fields, id),
      sendNote: (current, note, revision, id) => core.duty(note, revision, id), read: () => core.read(),
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

test('a tap waiting for the tap before it goes from what that one saved, and is refused over a change made after it', async t => {
  const { core, host, panel, fresh } = lined(t);
  core.next = { hold: true };
  const first = chip(host, 'Done').onclick(); await settled();
  const second = chip(host, 'Ready for review').onclick(); await settled();
  // Core saved Done; someone else then makes it Waiting, and the page shows it.
  Object.assign(core.topic, { state: 'waiting', state_by: 'fable', version: core.topic.version + 1 }); fresh();
  core.release(); await first; await second; await panel.queue; await settled();
  assert.deepEqual([core.log.map(entry => [entry.args.state, entry.outcome]), core.topic.state, controls(host).notice.textContent],
    [[['done', 'committed'], ['review', 'REVISION_CONFLICT']], 'waiting', CHANGED]);
  assert.deepEqual(core.log[1].fields, { state: 'done', waiting_on: [] }, 'fenced on the Done the first saved');
});

// A lost save is asked about again as the same command before any later
// words go: the person's next act, here a Return, sends it again, and only
// once Core has answered for it do the newest words go, from what it saved.
test('a lost save is asked again as itself at the next Return; the newest words then go on from what it saved, called nobody else\'s', async t => {
  const { core, input, said } = lined(t);
  const shown = [];
  type(input, 'A'); core.next = { lose: 'dropped' }; core.unread = 1; await enter(input); shown.push(said());
  // The next Return asks about A again; that answer is lost too.
  type(input, 'AB'); core.next = { lose: 'gone' }; await enter(input); shown.push(said());
  type(input, 'ABC'); await enter(input); shown.push(said());
  assert.deepEqual(core.log.map(entry => [entry.fields, entry.args.note, entry.outcome]), [[{ note: 'Old' }, 'A', 'committed'], [{ note: 'A' }, 'ABC', 'committed']],
    'A ran once; AB, never the latest when its turn came, never went');
  assert.deepEqual(core.asked.length, 2, 'A asked again at each Return');
  assert.deepEqual(new Set(core.log.map(entry => entry.id)).size, 2);
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
    const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields, id) => core.update(current, args, fields, id), read: () => core.read() });
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
  const { core, panel, fresh, input, said } = lined(t);
  type(input, 'Mine'); core.next = { hold: true }; key(input, 'Enter'); await settled();
  type(input, 'Mine 2'); key(input, 'Enter');
  key(input, 'Escape');
  core.other('note', 'Theirs'); fresh();
  assert.equal(input.value, 'Theirs', 'put back, the line shows what is saved');
  type(input, 'Other');
  core.release(); await panel.queue; await settled();
  assert.deepEqual([core.log.map(entry => entry.args.note), core.held('note'), input.value, said()], [['Mine'], 'Theirs', 'Other', 'Saved']);
});

// A lost save is never sent again on a timer or because fresh data came: only
// when the connection is back (the page's live feed, or the browser, says so)
// or at the person's next act on that field, and always as the same command,
// so Core runs it at most once.
test('a lost save goes again only when the connection is back or at the next act, as the same command, never on fresh data', async t => {
  const { core, panel, input, fresh, said } = lined(t);
  type(input, 'Mine'); core.next = { lose: 'late' }; await enter(input);
  fresh(); fresh(); await settled();
  assert.deepEqual([core.log.length, core.asked.length, input.value], [0, 0, 'Mine'], 'fresh data sends nothing, and the words stay');
  await panel.reconnected(); await settled();
  assert.deepEqual([core.held('note'), core.log.length, said()], ['Mine', 1, 'Saved'], 'back online, it goes again and Core runs it');
  // Its first attempt reaches Core after all: the same command, already run, changes nothing.
  core.land();
  assert.deepEqual([core.log.length, core.asked.length, core.held('note')], [1, 1, 'Mine']);
  await panel.reconnected(); await settled();
  assert.equal(core.asked.length, 1, 'nothing lost, nothing asked');
  // Lost again with Core never told, and not recorded: Return sends it, as itself, once.
  type(input, 'Mine 2'); core.next = { lose: 'late' }; await enter(input);
  const first = core.land;
  type(input, 'Mine 3'); await enter(input);
  assert.deepEqual([core.log.map(entry => entry.args.note), core.held('note')], [['Mine', 'Mine 2', 'Mine 3'], 'Mine 3']);
  first();
  assert.deepEqual([core.log.length, core.held('note')], [3, 'Mine 3'], 'the late first attempt of Mine 2 runs nothing');
});

// The last review's probes (round 4), each a case a reviewer ran against the
// model: kept here so the class stays closed. B1 failed on f903f51.
const SOMEONE = /first, so|Someone else/;
function rig(t, { reopened = false, quiet = false, setup = () => {} } = {}) {
  dom(t);
  const core = new Core(), host = new Element('section');
  if (reopened) core.reopen();
  setup(core);
  core.quiet = quiet;
  let attended = 0;
  const panel = new TopicStatePanel({ host, reader: 'tony', send: (current, args, fields, id) => core.update(current, args, fields, id),
    sendNote: (current, note, revision, id) => core.duty(note, revision, id), read: () => core.read(), attention: () => { attended++; },
    refresh: () => setImmediate(() => { if (!core.quiet) panel.paint(core.view().topic, core.view().participants); }) });
  const said = [], show = panel.show.bind(panel);
  panel.show = (message, q) => { said.push(typeof message === 'string' ? message : '[parts]'); show(message, q); };
  const fresh = () => panel.paint(core.view().topic, core.view().participants);
  fresh();
  const c = controls(host);
  return { core, host, panel, fresh, said, attended: () => attended, note: c.note, part: c.part, notice: () => controls(host).notice.textContent,
    sends: () => core.log.map(e => [e.kind === 'responsibility.set' ? 'duty' : Object.keys(e.args).join('+'), e.fields ?? e.version, e.args, e.outcome]) };
}
const drain = async panel => { await panel.queue; await settled(); };

test('rv A1: note Return, type more, Return; first answer lost and lands after its read', async t => {
  const r = rig(t, { quiet: true });
  type(r.note, 'Mine'); r.core.next = { hold: true, lose: 'late' };
  key(r.note, 'Enter'); await settled();
  type(r.note, 'Mine more'); key(r.note, 'Enter'); await settled();
  r.core.release(); await settled(); r.core.land(); await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.equal(r.core.held('note'), 'Mine more', JSON.stringify(r.sends()));
  assert.equal(r.notice(), 'Saved');
});

test('rv A2: unconfirmed then Return again; the first reaching Core late runs nothing; next words are not someone else\'s', async t => {
  const r = rig(t, { quiet: true });
  type(r.note, 'Mine'); r.core.next = { lose: 'late' };
  key(r.note, 'Enter'); await drain(r.panel);
  const land = r.core.land;
  key(r.note, 'Enter'); await drain(r.panel);
  assert.equal(r.core.held('note'), 'Mine');
  land(); // the first attempt reaches Core now: the same command, already run
  assert.deepEqual([r.core.log.length, r.core.held('note')], [1, 'Mine']);
  type(r.note, 'Mine 2'); key(r.note, 'Enter'); await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.equal(r.core.held('note'), 'Mine 2', JSON.stringify(r.sends()));
});

test('rv A3: reopen while editing Your part and the title; both save', async t => {
  const r = rig(t, { setup: core => { core.topic.state = 'done'; } });
  type(r.part, 'Mine'); r.core.reopen(); r.fresh();
  key(r.part, 'Enter'); await drain(r.panel);
  controls(r.host).rename.onclick();
  const title = controls(r.host).title; type(title, 'New title'); r.core.reopen(); r.fresh();
  key(title, 'Enter'); await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.deepEqual([r.core.held('duty'), r.core.held('title')], ['Mine', 'New title']);
});

test('rv A4: reopen before the note save reaches Core: refused beside the reopen note, kept, then saved', async t => {
  const r = rig(t, { setup: core => { core.topic.state = 'done'; } });
  type(r.note, 'Mine'); r.core.reopen();
  key(r.note, 'Enter'); await drain(r.panel);
  assert.match(r.notice(), /Reopened by a new message/);
  assert.deepEqual([r.note.value, r.core.held('note'), r.attended()], ['Mine', 'Reopened by a new message', 1]);
  key(r.note, 'Enter'); await drain(r.panel);
  assert.deepEqual([r.core.held('note'), r.notice()], ['Mine', 'Saved']);
});

test('rv A5: note refused while a Your part save goes beside it: the part saves, the note is kept', async t => {
  const r = rig(t);
  type(r.note, 'Mine'); r.core.other('note', 'Theirs'); r.core.next = { hold: true };
  key(r.note, 'Enter'); await settled(); leave(r.note);
  type(r.part, 'My part'); key(r.part, 'Enter'); await settled();
  r.core.release(); await drain(r.panel);
  assert.deepEqual([r.core.held('note'), r.core.held('duty'), r.note.value], ['Theirs', 'My part', 'Mine'], JSON.stringify(r.sends()));
  assert.match(r.notice(), /Theirs/, 'the note refusal stays said');
});

test('rv A6: reopened topic, note Return + chip, someone else saved a note first: nothing of theirs is overwritten, and the tap is not dropped silently', async t => {
  const r = rig(t, { reopened: true });
  type(r.note, 'Mine'); r.core.other('note', 'Theirs'); r.core.next = { hold: true };
  key(r.note, 'Enter'); await settled();
  const tap = chip(r.host, 'Done').onclick(); await settled();
  r.core.release(); await tap; await drain(r.panel);
  assert.equal(r.core.held('note'), 'Theirs', JSON.stringify(r.sends()));
  assert.equal(r.note.value, 'Mine');
  // The tap, fenced on the reopen note it was pressed over, is refused and said.
  assert.deepEqual([r.sends().map(e => e[3]), r.said.includes(CHANGED)], [['REVISION_CONFLICT', 'REVISION_CONFLICT'], true]);
});

test('rv A7: own commit painted by fresh data before its answer, with another field changed: next words save', async t => {
  const r = rig(t, { quiet: true });
  type(r.note, 'Mine'); r.core.next = { hold: true };
  key(r.note, 'Enter'); await settled();
  Object.assign(r.core.topic, { state: 'review', version: r.core.topic.version + 1 }); r.fresh();
  type(r.note, 'Mine more');
  r.core.release(); await drain(r.panel);
  key(r.note, 'Enter'); await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.equal(r.core.held('note'), 'Mine more');
});

test('rv A8: Your part dropped and unread, left with the same words, then more words: saved, nobody else blamed', async t => {
  const r = rig(t, { quiet: true });
  type(r.part, 'Mine'); r.core.next = { lose: 'dropped' }; r.core.unread = 1;
  key(r.part, 'Enter'); await drain(r.panel);
  leave(r.part); await drain(r.panel);
  type(r.part, 'Mine more'); key(r.part, 'Enter'); await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.equal(r.core.held('duty'), 'Mine more');
});

test('rv A9: title Return then Escape while in flight; renaming again later saves', async t => {
  const r = rig(t, { quiet: true });
  controls(r.host).rename.onclick();
  let title = controls(r.host).title; type(title, 'New'); r.core.next = { hold: true };
  key(title, 'Enter'); await settled(); key(title, 'Escape');
  r.core.release(); await drain(r.panel);
  controls(r.host).rename.onclick(); title = controls(r.host).title;
  assert.equal(title.value, 'New', 'the saved title shows');
  type(title, 'Newer'); key(title, 'Enter'); await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.equal(r.core.held('title'), 'Newer');
});

test('rv A10: Escape after a refusal puts back theirs, and the notice no longer says the words are kept', async t => {
  const r = rig(t);
  type(r.note, 'Mine'); r.core.other('note', 'Theirs');
  key(r.note, 'Enter'); await drain(r.panel);
  assert.match(r.notice(), /your words are kept/);
  key(r.note, 'Escape');
  assert.deepEqual([r.note.value, controls(r.host).notice.hidden], ['Theirs', true]);
  key(r.note, 'Enter'); await drain(r.panel);
  assert.equal(r.core.log.length, 1, 'Return sends nothing over the words put back');
});

test('rv A11: leaving saves; unconfirmed but the read finds it saved: no reopening, nothing blamed', async t => {
  const r = rig(t, { quiet: true });
  type(r.note, 'Mine'); r.core.next = { lose: 'unconfirmed' };
  leave(r.note); await drain(r.panel);
  assert.deepEqual([r.attended(), r.said.filter(m => SOMEONE.test(m))], [0, []]);
  assert.equal(r.note.value, 'Mine');
  type(r.note, 'Mine 2'); leave(r.note); await drain(r.panel);
  assert.equal(r.core.held('note'), 'Mine 2', JSON.stringify(r.sends()));
});

test('rv A12: reopened; Waiting, note Return, Done all before any answer; all the person\'s, none refused', async t => {
  const r = rig(t, { reopened: true });
  r.core.next = { hold: true };
  const a = chip(r.host, 'Waiting').onclick(); await settled();
  type(r.note, 'Mine'); key(r.note, 'Enter');
  const b = chip(r.host, 'Done').onclick();
  r.core.release(); await a; await b; await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.deepEqual([r.core.topic.state, r.core.held('note')], ['done', 'Mine'], JSON.stringify(r.sends()));
});

test('rv A13: reopened; Waiting (dropped, unread), note Return, Done: the person\'s words and Done stand', async t => {
  const r = rig(t, { reopened: true, quiet: true });
  r.core.next = { hold: true, lose: 'dropped' }; r.core.unread = 1;
  const a = chip(r.host, 'Waiting').onclick(); await settled();
  type(r.note, 'Mine'); key(r.note, 'Enter');
  const b = chip(r.host, 'Done').onclick();
  r.core.release(); await a; await b; await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.deepEqual([r.core.topic.state, r.core.held('note')], ['done', 'Mine'], JSON.stringify(r.sends()));
});

test('rv A14: R1 every tap\'s args', async t => {
  const r = rig(t, { setup: core => Object.assign(core.topic, { state: 'waiting', waiting_on: ['fable'] }) });
  type(r.note, 'Typed'); await chip(r.host, 'codex').onclick(); await drain(r.panel);
  await controls(r.host).archive.onclick(); await drain(r.panel);
  for (const e of r.core.log) assert.ok(!('note' in e.args) && !('title' in e.args), JSON.stringify(e.args));
  assert.equal(r.note.value, 'Typed');
});

test('rv A15: refused, then the read shows the note back at the start: the person\'s words are not silently sent', async t => {
  const r = rig(t, { quiet: true });
  type(r.note, 'Mine'); r.core.other('note', 'B');
  const orig = r.core.read.bind(r.core);
  r.core.read = async () => { r.core.other('note', 'Old'); r.core.read = orig; return orig(); };
  key(r.note, 'Enter'); await drain(r.panel);
  assert.deepEqual([r.core.log.length, r.core.held('note'), r.note.value], [1, 'Old', 'Mine']);
  assert.match(r.notice(), /It now reads “Old”/);
});

test('rv A16: lost title save, then a note refused by someone else: the note refusal is not swallowed by the title', async t => {
  const r = rig(t, { quiet: true });
  controls(r.host).rename.onclick();
  const title = controls(r.host).title; type(title, 'New'); r.core.next = { lose: 'dropped' }; r.core.unread = 1;
  key(title, 'Enter'); await drain(r.panel);
  type(r.note, 'Mine'); r.core.other('note', 'Theirs');
  key(r.note, 'Enter'); await drain(r.panel);
  assert.equal(r.core.held('note'), 'Theirs', JSON.stringify(r.sends()));
  assert.match(r.notice(), /Theirs/);
  assert.equal(r.note.value, 'Mine');
});

// B1: the person's lost save shows as saved in fresh data that arrives while
// their next save is out (red on f903f51 for every field).
for (const [name, open] of [['note', null], ['duty', null], ['title', host => controls(host).rename.onclick()]]) {
  test(`rv B1 ${name}: lost save shown by fresh data while the next save is out: not called someone else's`, async t => {
    const r = rig(t, { quiet: true });
    open?.(r.host);
    const input = name === 'note' ? r.note : name === 'duty' ? r.part : controls(r.host).title;
    type(input, 'A'); r.core.next = { lose: 'dropped' }; r.core.unread = 1;
    key(input, 'Enter'); await drain(r.panel);
    type(input, 'AB'); r.core.next = { hold: true };
    key(input, 'Enter'); await settled();
    r.fresh(); // the page's live feed catches up and paints Core's 'A' while the Return is out
    r.core.release(); await drain(r.panel);
    assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], 'nothing of the person\'s is called someone else\'s: ' + JSON.stringify(r.sends()));
    assert.equal(r.core.held(name), 'AB');
  });
}
test('rv B1 chip: lost tap shown by fresh data while the next tap is out: not called someone else\'s', async t => {
  const r = rig(t, { quiet: true });
  r.core.next = { lose: 'dropped' }; r.core.unread = 1;
  await chip(r.host, 'Done').onclick(); await drain(r.panel);
  r.core.next = { hold: true };
  const tap = chip(r.host, 'Ready for review').onclick(); await settled();
  r.fresh();
  r.core.release(); await tap; await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], 'nothing of the person\'s is called someone else\'s: ' + JSON.stringify(r.sends()));
  assert.equal(r.core.topic.state, 'review');
});

// A person tapped while the tap before is out goes from what that one saved,
// not from a read that came in between: someone took fable away and put
// them back, and the page read only the first of those.
test('a person tapped while the tap before is out changes only that person, from what the one before saved', async t => {
  const r = rig(t, { quiet: true, setup: core => Object.assign(core.topic, { state: 'waiting', waiting_on: ['fable'] }) });
  r.core.next = { hold: true };
  const first = chip(r.host, 'codex').onclick(); await settled();
  const second = chip(r.host, 'you').onclick(); await settled();
  Object.assign(r.core.topic, { waiting_on: ['codex'], version: r.core.topic.version + 1 }); r.fresh();
  Object.assign(r.core.topic, { waiting_on: ['codex', 'fable'], version: r.core.topic.version + 1 });
  r.core.release(); await first; await second; await drain(r.panel);
  assert.deepEqual(r.sends().map(([, fields, args, outcome]) => [[...fields.waiting_on].sort(), [...args.waiting_on].sort(), outcome]),
    [[['fable'], ['codex', 'fable'], 'committed'], [['codex', 'fable'], ['codex', 'fable', 'tony'], 'committed']]);
  assert.deepEqual(r.core.topic.waiting_on, ['codex', 'fable', 'tony'], 'fable, put back by someone else, stays');
});

// The person's own commit moves a start only when the start is older than
// it: a value that came back to what the save was fenced on after the save
// ran is someone else's, and the tap fenced on it goes.
test('a tap on a reopened topic waiting for the note goes from the note shown, when the note came back after the save', async t => {
  const r = rig(t, { quiet: true, reopened: true });
  type(r.note, 'A'); r.core.next = { hold: true };
  const saving = (key(r.note, 'Enter'), settled()); await saving;
  r.core.reopen(); r.fresh();
  const tap = chip(r.host, 'Done').onclick(); await settled();
  r.core.release(); await tap; await drain(r.panel);
  assert.deepEqual(r.sends().map(([what, fields, , outcome]) => [what, fields.note, outcome]),
    [['note', 'Reopened by a new message', 'committed'], ['state+keep_note', 'Reopened by a new message', 'committed']]);
  assert.equal(r.core.topic.state, 'done');
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), []);
});

// An answer says what Core holds for what it answers at its version, and
// nothing more: Your part's answer says nothing of where the topic stands,
// and a topic.update's says nothing of the open asks. Each is known at the
// version Core answered it at, so the person's own commit moves every start
// read before it (R3), whatever other answer came in between.
test('rv C1: Done out, Your part saved and answered first: Ready for review goes from Done, nobody else blamed', async t => {
  for (const early of [false, true]) {
    const r = rig(t, { quiet: true });
    r.core.next = { hold: true };
    const done = chip(r.host, 'Done').onclick(); await settled();
    const release = r.core.release;
    type(r.part, 'My part'); key(r.part, 'Enter'); await settled();
    // Ready for review tapped before or after Done's answer comes.
    if (early) { const tap = chip(r.host, 'Ready for review').onclick(); release(); await tap; await done; }
    else { release(); await done; await drain(r.panel); await chip(r.host, 'Ready for review').onclick(); }
    await drain(r.panel);
    assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], `${early}: ` + JSON.stringify(r.sends()));
    assert.deepEqual([r.core.topic.state, r.core.held('duty')], ['review', 'My part'], JSON.stringify(r.sends()));
  }
});

test('rv C2: Done lost with its read, Your part saved, then Ready for review: saved, nobody else blamed', async t => {
  const r = rig(t, { quiet: true });
  r.core.next = { lose: 'dropped' }; r.core.unread = 1;
  await chip(r.host, 'Done').onclick(); await drain(r.panel);
  type(r.part, 'My part'); key(r.part, 'Enter'); await drain(r.panel);
  await chip(r.host, 'Ready for review').onclick(); await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.equal(r.core.topic.state, 'review', JSON.stringify(r.sends()));
});

test('rv C3: note lost with its read, Escape, Your part saved, new words: saved over the person\'s own, nobody else blamed', async t => {
  const r = rig(t, { quiet: true });
  type(r.note, 'Mine'); r.core.next = { lose: 'dropped' }; r.core.unread = 1;
  key(r.note, 'Enter'); await drain(r.panel);
  key(r.note, 'Escape');
  type(r.part, 'My part'); key(r.part, 'Enter'); await drain(r.panel);
  type(r.note, 'New'); key(r.note, 'Enter'); await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.deepEqual([r.core.held('note'), r.core.held('duty')], ['New', 'My part'], JSON.stringify(r.sends()));
});

// A message reopened the topic and the page has not read it: the person's
// rename is answered with the topic as it stands, the reopen too, so a tap
// after it is fenced on the reopen note it clears, and the note's words then
// go on from what the tap left.
test('rv C4: reopened unread, renamed, words in the note, Ready for review, Return: the words save, nobody else blamed', async t => {
  const r = rig(t, { quiet: true, setup: core => { core.topic.state = 'done'; } });
  r.core.reopen();
  controls(r.host).rename.onclick();
  const title = controls(r.host).title; type(title, 'New title'); key(title, 'Enter'); await drain(r.panel);
  assert.equal(r.note.value, 'Reopened by a new message', 'the rename\'s answer shows the reopen');
  type(r.note, 'Mine');
  await chip(r.host, 'Ready for review').onclick(); await drain(r.panel);
  assert.deepEqual(r.core.log.at(-1).fields, { state: 'active', waiting_on: [], note: 'Reopened by a new message' }, 'the tap is fenced on the note it clears');
  key(r.note, 'Enter'); await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.deepEqual([r.core.topic.state, r.core.held('note'), r.core.held('title')], ['review', 'Mine', 'New title'], JSON.stringify(r.sends()));
});

// A read that left before an answer cannot undo what the answer said, and
// still shows the rest of what it read, newer than what showed.
test('rv C5: a read that left before Your part was answered keeps the part saved and shows where the topic stands', async t => {
  const r = rig(t, { quiet: true });
  Object.assign(r.core.topic, { state: 'review', state_by: 'fable', version: r.core.topic.version + 1 });
  const old = r.core.view();
  type(r.part, 'My part'); key(r.part, 'Enter'); await drain(r.panel);
  r.panel.paint(old.topic, old.participants);
  assert.deepEqual([r.part.value, lit(r.host)], ['My part', ['Ready for review']]);
  type(r.part, 'My part 2'); key(r.part, 'Enter'); await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.equal(r.core.held('duty'), 'My part 2', JSON.stringify(r.sends()));
});

test('rv C6: a read that left before a rename was answered keeps the new title and shows the ask it read', async t => {
  const r = rig(t, { quiet: true });
  Object.assign(r.core.topic, { asks: [{ actor_id: 'tony', message_id: 'm1', by: 'fable', since_ms: null }], version: r.core.topic.version + 1 });
  const old = r.core.view();
  controls(r.host).rename.onclick();
  const title = controls(r.host).title; type(title, 'New title'); key(title, 'Enter'); await drain(r.panel);
  r.panel.paint(old.topic, old.participants);
  assert.deepEqual([title.value, r.panel.topic.title, controls(r.host).by.text], ['New title', 'New title', 'Set by fable · fable asked you']);
  controls(r.host).rename.onclick(); type(title, 'Newer'); key(title, 'Enter'); await drain(r.panel);
  assert.deepEqual(r.said.filter(m => SOMEONE.test(m)), [], JSON.stringify(r.sends()));
  assert.equal(r.core.held('title'), 'Newer', JSON.stringify(r.sends()));
});
