// Where a topic stands, as its participants say: a row mark in topic lists,
// its chips and lines in Topic settings, set in place, and the topics that
// wait on the reader. Core keeps every value; nothing here decides one.
import { datedTime, spokenNode, spokenTime, timeNode } from './times.mjs';

export const STATES = ['active', 'waiting', 'review', 'done'];
// Who organises an outcome, read from its workspace or one of its topics: its
// owner, and its coordinator while it has one. Organising is everything the owner
// may do but hand the outcome on (docs/openings.md); Core decides the same way.
export const organises = (record, actor) => actor != null && [record?.owner_id, record?.coordinator_id].includes(actor);
// Who renames, archives and changes who takes part in a topic: whoever organises
// its outcome, and its creator.
export const managesTopic = (topic, actor) => organises(topic, actor) || (actor != null && topic?.creator_id === actor);
const LABELS = { active: 'Active', waiting: 'Waiting', review: 'Ready for review', done: 'Done' };

const named = (id, reader) => id === reader ? 'you' : id;

// The open asks a topic carries: each waits on the person asked until they write in it.
const asksOf = item => Array.isArray(item?.asks) ? item.asks.filter(ask => typeof ask?.actor_id === 'string') : [];

// Who a topic waits on: those its waiting state names, then those asked and not yet answered.
export function waitsOn(item) {
  const said = item?.state === 'waiting' && Array.isArray(item.waiting_on) ? item.waiting_on : [];
  return [...new Set([...said, ...asksOf(item).map(ask => ask.actor_id)])];
}

export function stateLabel(item, reader) {
  const state = STATES.includes(item?.state) ? item.state : 'active';
  const waiting = waitsOn(item);
  // The reader comes first, so a list cut short never cuts them.
  const names = [...waiting.filter(id => id === reader), ...waiting.filter(id => id !== reader)].map(id => named(id, reader)).join(', ');
  if (!names) return LABELS[state];
  // An ask waits without changing what was said: a topic ready for review can still wait on an answer.
  return state === 'waiting' || state === 'active' ? `Waiting on ${names}` : `${LABELS[state]} · waiting on ${names}`;
}

// Each open ask, as who asked whom ("fable asked you") and since when.
const askParts = (item, reader) => asksOf(item).map(ask => ({ words: `${named(ask.by, reader)} asked ${ask.actor_id === reader ? 'you' : ask.actor_id}`,
  since: Number.isSafeInteger(ask.since_ms) ? ask.since_ms : null }));

// "fable asked you, since 7:41 AM Thu Nov 5": how long each open ask has
// waited, dated, for a title.
export function askLines(item, reader) {
  return askParts(item, reader).map(({ words, since }) => words + (since === null ? '' : `, since ${datedTime(since)}`));
}

// Whether work is observed on a topic, by the server's one rule (aim_next/work.py),
// as a state and a time (item 86): "aim-spec · 6:45 AM" (who worked in it
// last, in the last hour), "Quiet since yesterday 11:00 PM", "Waiting on you ·
// 6:20 AM". It never says nobody is working: only that it is quiet, and since
// when. The server reads the rule for this reader, so who it names is never
// the reader. A waiting topic's words are its pill's ("Waiting on you"),
// passed as waiting; without them it waits on someone the page cannot name.
export function workNote(work, reader, waiting = '') {
  if (!work || typeof work !== 'object') return '';
  const when = Number.isSafeInteger(work.seen_ms) ? spokenTime(work.seen_ms, 'short') : null;
  const by = typeof work.by === 'string' ? named(work.by, reader) : null;
  // The server counts every wait as observed work.
  if (work.waits) {
    const who = waiting || 'Waiting on someone';
    return when ? `${who} · ${when}` : who;
  }
  if (work.observed && when) return by ? `${by} · ${when}` : `Worked on · ${when}`;
  return when ? `Quiet since ${when}` : 'Quiet';
}

// A row with observed work carries a small dot; every row's title and
// screen-reader text say what was seen and when. A waiting row's title begins
// with its pill's words; its screen-reader words follow the pill, which the
// row already says, so they do not say it twice.
export function paintWork(host, item, reader) {
  const pill = pillMarked(item) && waitsOn(item).length ? stateLabel(item, reader) : '';
  const note = workNote(item?.work, reader, pill);
  if (!note) { host.removeAttribute('title'); return; }
  host.setAttribute('title', note);
  if (item.work.observed) {
    const dot = document.createElement('span');
    dot.className = 'topic-work'; dot.setAttribute('aria-hidden', 'true');
    host.append(dot);
  }
  const rest = pill && note.startsWith(pill) ? note.slice(pill.length) : ` · ${note}`;
  if (!rest) return;
  const words = document.createElement('span');
  words.className = 'sr-only'; words.textContent = rest;
  host.append(words);
}

// Whether a topic list row carries a state pill.
const pillMarked = item => STATES.includes(item?.state) && !(item.state === 'active' && !waitsOn(item).length);

// A row in a topic list says where its topic stands unless it is simply active
// and waits on nobody. The caller has just set the row's text, so the row holds no earlier mark.
export function paintState(host, item, reader) {
  if (!pillMarked(item)) return;
  const mark = document.createElement('span');
  mark.className = 'topic-state'; mark.dataset.state = waitsOn(item).length ? 'waiting' : item.state;
  if (waitsOn(item).includes(reader)) mark.classList.add('mine');
  mark.textContent = stateLabel(item, reader);
  // A long state ends in an ellipsis; its title holds the whole of it, and how long each ask has waited.
  mark.title = [mark.textContent, ...(typeof item.state_note === 'string' && item.state_note ? [item.state_note] : []), ...askLines(item, reader)].join(' · ');
  host.append(mark);
}

const element = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children); return node;
};
// A shown time after its lead-in (", 7:41 AM"), or nothing when there is no time.
const at = (lead, ms) => Number.isSafeInteger(ms) ? [lead, timeNode(ms, document)] : [];
// The non-empty groups of parts, with gap between each.
const joined = (groups, gap) => groups.filter(parts => parts.length).flatMap((parts, index) => index ? [gap, ...parts] : parts);
// The same, kept on one line so a narrow screen never breaks inside the time.
const whole = (lead, ms) => Number.isSafeInteger(ms) ? [lead, element('span', { className: 'together' }, timeNode(ms, document))] : [];
const known = state => STATES.includes(state) ? state : 'active';
// What Core holds for each field of the topic itself, as last read.
const HELD = { title: topic => topic.title, archived: topic => topic.archived === true, state: topic => known(topic.state),
  note: topic => topic.state_note ?? '', waiting_on: topic => Array.isArray(topic.waiting_on) ? topic.waiting_on : [] };
// Two values of a field alike; who a topic waits on compares as a set.
const alike = (a, b) => Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every(id => b.includes(id)) : a === b;
// Answered for a change refused only because the person's own lost change came first.
const AGAIN = Symbol('again');
// A chip shows the topic as it now stands; a line keeps what was typed.
const CHANGED = 'Someone else changed this topic first, so that was not saved. Here it is as it stands now; what you typed is kept. Try again.';
// A line's words refused over newer ones: both show, and the person's are kept.
const KEPT = { note: 'Someone else changed the note first', title: 'Someone else renamed it first', duty: 'Your part changed elsewhere first' };
const kept = (name, now) => now === null ? `${KEPT[name]}, so yours was not saved; your words are kept. Reading it again failed, so press Return to try again.`
  : `${KEPT[name]}, so yours was not saved; your words are kept. ${now ? `It now reads “${now}”` : 'It is now empty'}: press Return to save yours in its place.`;
const NOTE_BYTES = 1024;

// What each participant said they are responsible for, beside where the topic
// stands; the reader first, as "you". Participants without a note are left out.
export function responsibilities(participants, reader) {
  const said = (Array.isArray(participants) ? participants : [])
    .filter(person => typeof person?.actor_id === 'string' && typeof person.responsibility === 'string' && person.responsibility.trim());
  return [...said.filter(person => person.actor_id === reader), ...said.filter(person => person.actor_id !== reader)]
    .map(person => ({ who: named(person.actor_id, reader), note: person.responsibility + (person.responsibility_truncated ? '…' : '') }));
}

// A chip that is tapped once: aria-pressed says whether it is lit.
const chip = (label, onclick) => {
  const button = element('button', { type: 'button', className: 'choice-chip', textContent: label });
  button.setAttribute('aria-pressed', 'false'); button.onclick = onclick;
  return button;
};
const lit = (button, on) => button.setAttribute('aria-pressed', on ? 'true' : 'false');

// A one-line field that saves itself: Return or leaving it saves what was
// typed (leave, when leaving it means something else), and Escape cancels:
// cancel() puts back what is saved and says whether it did anything. An
// Escape with nothing to cancel closes the dialog as usual.
function lineField(props, { touch, save, cancel, leave = save }) {
  const input = element('input', { type: 'text', autocomplete: 'off', enterKeyHint: 'done', ...props });
  input.oninput = touch;
  input.onkeydown = event => {
    if (event.isComposing) return;
    if (event.key === 'Enter') { event.preventDefault(); save(); }
    else if (event.key === 'Escape' && cancel()) { event.preventDefault(); event.stopPropagation(); }
  };
  input.onblur = leave;
  return input;
}

// One line set in place: the note, Your part or the title. read() is what
// Core holds for it now, { value, fence }, where fence is what Core checks a
// save against: the saved words themselves, or Your part's revision.
//
// While the person edits, start is what was saved when they began, and
// session counts their edits: Escape, or words found saved, ends one. Their
// words are a change only when they differ from where they began and from
// what is saved now; otherwise a save sends nothing and the line follows the
// data again. Each save is fenced on the start as it was when the person
// made it (the panel's acts, below). Only the person's own change known
// saved moves the start, to what Core saved; a refusal moves it to the newer
// words once they show. Fresh data shows in a line nobody is editing, and
// never over words being edited.
class Line {
  constructor(input, read) { Object.assign(this, { input, read, start: null, session: 0 }); }
  // The first key: the line begins from what is saved.
  begin() { this.start ??= this.read(); }
  // Whether the words are no change: those it began from, or those saved now.
  same(from = this.start) { return !from || this.input.value === from.value || this.input.value === this.read().value; }
  stop() { this.start = null; this.session += 1; this.follow(); }
  follow() { if (!this.start) this.input.value = this.read().value; }
  // The person's own change, fenced on from, is known saved as to ({ value,
  // fence }); words: what it sent from this line, if anything. Words already
  // saved end the edit; any others go on from what Core saved.
  landed(from, to, words) {
    if (!this.start || !alike(this.start.fence, from)) return;
    if (this.input.value === to.value || this.input.value === words) this.stop(); else this.start = to;
  }
  // Core refused a change fenced on fence over someone else's newer words,
  // just read and now shown: the line begins from those, so the next Return,
  // made once the person has seen them, goes in their place.
  refused(fence) { if (this.start && alike(this.start.fence, fence)) this.start = this.read(); }
}

// Where the topic stands, in Topic settings, set in place. Those who may say
// where it stands (participants, and whoever has written in it: Core's
// reader_may_say) tap one of four chips; Waiting then shows the topic's people
// as chips for who it waits on. The note is one line under the chips, and a
// participant's own part one line after it; each saves on Return or on
// leaving it. Whoever organises the outcome (its owner and coordinator) and
// the topic's creator also rename and archive it, from quiet actions at the bottom. Every save is a Core command;
// a quiet "Saved" or the refusal in plain words says what became of the last.
//
// The fields are built once per topic and kept across repaints, so focus and
// whatever the person has typed survive fresh data (Line, above).
//
// Each press, key or leaving is an act. An act is fenced, field by field, on
// what the person saw when they made it ({ value, fence }), and sends only
// what its own control changed: a chip never sends the note, and keeps it
// (keep_note); a change to a field it is not fenced on never refuses it.
// Acts go one at a time, in the order made; one with nothing left to change
// when its turn comes is not sent. Two things move an act's fences:
//   - a change of the person's own known saved, confirmed or found by a read
//     after its answer was lost, moves every act fenced on what that change
//     read to what Core saved (landed);
//   - a refusal over someone else's newer value ends every act made before
//     it was shown that is fenced on the same value (overtaken): each would
//     go over a value the person never saw. Their next act goes from what
//     now shows.
export class TopicStatePanel {
  // send(topic, args, fields) asks Core to change the topic, fenced on fields.
  // sendNote(topic, note, revision) says what the reader is responsible for.
  // refresh asks the page for fresh topic data; it is called after every answer.
  // painted(topic) hears each topic the panel paints, the newest it has seen,
  // so the page's subtitle shows a saved change at once.
  // read, when given, answers the topic as the topic view gives it ({topic,
  // participants}); it is read once after a refusal or a change whose answer
  // was lost, so the notice says what it holds now.
  // attention() is called when words the person sent from a line are not
  // known to be saved, so the page can show Topic settings if it was closed.
  constructor({ host, reader, send, sendNote = null, refresh = () => {}, painted = () => {}, read = null, attention = () => {} }) {
    Object.assign(this, { host, reader, send, sendNote, refresh, painted, read, attention });
    // kept: the refusal said over a line's words, while they stay unsaved.
    // lost: by field, a list of { fence, would }, one for each change of the
    // person's own whose answer was lost: what it read of the field, and what
    // it would have left there. Each stays only while the field holds what
    // it read, since until then it may still land.
    // pending: the acts not yet settled, in order. found: how many changes
    // of the person's own reads have found saved.
    this.topic = null; this.controls = null; this.lines = {}; this.kept = null; this.lost = {}; this.pending = []; this.found = 0; this.queue = Promise.resolve();
    this.heading = element('h3', { id: 'stand-heading', textContent: 'Where it stands' });
    // One notice, kept in place, so a screen reader announces each new text.
    this.notice = element('p', { className: 'notice', hidden: true });
    this.notice.setAttribute('role', 'status');
  }

  paint(topic, participants = this.participants ?? []) {
    if (this.topic?.id !== topic.id) this.reset();
    // A read that left before the version shown here cannot undo it.
    else if (topic.version < this.topic.version) return;
    this.topic = topic; this.participants = participants;
    const reader = this.reader, manager = managesTopic(topic, reader);
    const participant = participants.some(person => person.actor_id === reader);
    const says = topic.reader_may_say === true || participant || manager;
    if (!this.controls || this.controls.says !== says) this.build(says);
    this.manage(manager); this.duty(participant && !!this.sendNote); this.follow();
    this.host.hidden = false;
    this.painted(topic);
  }

  reset() {
    this.controls = null; this.lines = {}; this.kept = null; this.lost = {}; this.pending = []; this.show(null);
  }

  // The chips, the note and the quiet line of who said it: chips to tap for
  // those who may say where it stands, the state alone for everyone else.
  build(says) {
    const chips = element('div', { className: 'state-chips' });
    chips.setAttribute('role', 'group'); chips.setAttribute('aria-labelledby', 'stand-heading');
    const states = new Map();
    const waitingLabel = element('span', { id: 'waiting-label', className: 'chips-label', textContent: 'Waiting on' });
    const people = element('div', { className: 'state-chips people-chips' });
    people.setAttribute('role', 'group'); people.setAttribute('aria-labelledby', 'waiting-label');
    const waiting = element('div', { className: 'waiting-on', hidden: true }, waitingLabel, people);
    let note;
    this.lines = {};
    if (says) {
      for (const value of STATES) {
        const button = chip(LABELS[value], () => this.choose(value));
        button.dataset.state = value; states.set(value, button); chips.append(button);
      }
      note = this.line('note', { id: 'topic-state-note', maxLength: NOTE_BYTES, placeholder: 'Add a note…' });
      note.setAttribute('aria-label', 'Note');
    } else {
      note = element('p', { className: 'state-note-line' });
    }
    const by = element('p', { className: 'muted state-by' });
    const duties = element('ul', { className: 'responsibilities', hidden: true });
    duties.setAttribute('aria-label', 'Who is responsible for what');
    const part = element('div', { className: 'settings-part' }, duties);
    const actions = element('div', { className: 'settings-actions', hidden: true });
    this.host.replaceChildren(this.heading, chips, waiting, note, by, part, this.notice, actions);
    this.controls = { says, chips, states, waiting, people, personChips: new Map(), note, by, part, duties, actions, duty: null, managed: null };
  }

  // A line by name, saved on Return or leaving it; Escape puts back what is saved.
  line(name, props, events = {}) {
    const input = lineField(props, { touch: () => this.lines[name]?.begin(), save: () => this.saveLine(name), cancel: () => this.cancel(name), ...events });
    this.lines[name] = new Line(input, () => this.field(name));
    return input;
  }

  // What Core holds for a field, { value, fence }, as this panel last read
  // it: a field of the topic, fenced on its value, or the reader's part,
  // fenced on its revision.
  field(name) {
    if (name !== 'duty') { const value = HELD[name](this.topic); return { value, fence: value }; }
    const mine = this.mine(), revision = mine?.responsibility_revision;
    return { value: mine?.responsibility ?? '', fence: Number.isSafeInteger(revision) ? revision : 0 };
  }

  // Renaming and archiving, for whoever organises the outcome and the topic's creator:
  // two quiet actions. Rename puts a one-line title in their place.
  manage(manager) {
    const controls = this.controls;
    if (manager && !controls.managed) {
      const unchanged = () => this.lines.title?.input.value === this.topic?.title;
      const title = this.line('title', { id: 'topic-rename', className: 'rename-line', hidden: true },
        { cancel: () => { this.renaming(false); return true; }, leave: () => { if (!unchanged()) this.saveLine('title'); } });
      title.setAttribute('aria-label', 'Title');
      // Leaving the title unchanged puts the actions back, where the focus went.
      title.addEventListener('blur', () => { if (unchanged() && !title.hidden) this.renaming(false, false); });
      const rename = element('button', { type: 'button', className: 'text-action', textContent: 'Rename' });
      rename.onclick = () => this.renaming(true);
      const archive = element('button', { type: 'button', className: 'text-action' });
      // Archive says what it does when pressed; done already, there is nothing to send.
      archive.onclick = () => {
        const act = this.act(['archived']), archived = !act.fences.archived.value;
        return this.after(act, () => act.fences.archived.value === archived || this.field('archived').value === archived ? undefined : this.submit(act, { archived }));
      };
      controls.actions.replaceChildren(title, rename, archive);
      controls.actions.hidden = false;
      controls.managed = { title, rename, archive };
    } else if (!manager && controls.managed) {
      controls.actions.replaceChildren(); controls.actions.hidden = true; controls.managed = null; delete this.lines.title;
    }
  }

  // Whether the one-line title shows in place of Rename and Archive.
  // focus: whether the focus moves too, to the title or back to Rename.
  renaming(on, focus = true) {
    const managed = this.controls?.managed;
    if (!managed) return;
    const had = managed.title === document.activeElement;
    if (!on) this.lines.title.stop();
    managed.title.hidden = !on; managed.rename.hidden = managed.archive.hidden = on;
    if (!focus) return;
    if (on) { managed.title.focus(); managed.title.select(); }
    else if (had || document.activeElement === document.body || !document.activeElement) managed.rename.focus();
  }

  // Escape in a line: what is saved comes back, if the line held anything else.
  cancel(name) {
    const line = this.lines[name], dirty = !!line && !line.same();
    line?.stop();
    return dirty;
  }

  // The reader's own part, for a participant: only they say what they do here.
  duty(participant) {
    const controls = this.controls;
    if (participant && !controls.duty) {
      const heading = element('h3', { id: 'part-heading', textContent: 'Your part' });
      const note = this.line('duty', { id: 'topic-responsibility', maxLength: NOTE_BYTES, placeholder: 'What you do here…' });
      note.setAttribute('aria-labelledby', 'part-heading');
      controls.part.prepend(heading, note);
      controls.duty = { heading, note };
    } else if (!participant && controls.duty) {
      controls.duty.heading.remove(); controls.duty.note.remove(); controls.duty = null; delete this.lines.duty;
    }
  }

  mine() { return this.participants?.find(person => person.actor_id === this.reader) ?? null; }

  // What a tap is fenced on: where the topic stands and who it waits on, and
  // the note when Core will start it afresh after a reopen. A tap keeps any
  // other note without sending it, so a change to the note never refuses one.
  stands() {
    return ['state', 'waiting_on', ...(this.topic.state_message_id ? ['note'] : [])];
  }

  // An act of the person's, made now: fenced on each named field as the
  // panel shows it (a line: where its edit began). It waits in pending
  // until it settles, so what settles before it can move or end it.
  act(names, fences = Object.fromEntries(names.map(name => [name, this.field(name)]))) {
    const act = { fences, dead: false };
    this.pending.push(act);
    return act;
  }

  // A tap is a change of its own: lines whose words are no change follow the data again.
  tapped() {
    for (const line of Object.values(this.lines)) if (line.start && line.same()) line.stop();
  }

  // A state chip means the state it names, over the state shown when pressed.
  choose(state) {
    this.tapped();
    const act = this.act(this.stands());
    return this.after(act, () => state === act.fences.state.value || state === HELD.state(this.topic) ? undefined : this.submit(act, { state, keep_note: true }));
  }

  // A person chip adds or takes away one person the topic waits on, as the
  // chip showed when tapped; one already so, on a waiting topic, sends nothing.
  toggle(actor) {
    this.tapped();
    const act = this.act(this.stands()), on = !act.fences.waiting_on.value.includes(actor);
    const so = (state, list) => state === 'waiting' && list.includes(actor) === on;
    return this.after(act, () => {
      const was = act.fences.waiting_on.value;
      if (so(act.fences.state.value, was) || so(HELD.state(this.topic), HELD.waiting_on(this.topic))) return undefined;
      return this.submit(act, { state: 'waiting', waiting_on: on ? [...was.filter(id => id !== actor), actor] : was.filter(id => id !== actor), keep_note: true });
    });
  }

  // A line's words, weighed when their turn comes, fenced on where the edit
  // began when the person saved. An edit that ended meanwhile (Escape, or
  // its words found saved) sends nothing.
  saveLine(name) {
    const line = this.lines[name], session = line?.session;
    const act = this.act([], line?.start ? { [name]: line.start } : {});
    const turn = this.after(act, () => {
      const line = this.lines[name], from = act.fences[name];
      if (!line || !from || !line.start || line.session !== session) return undefined;
      if (line.same(from)) { line.stop(); return undefined; }
      return name === 'duty' ? this.submitNote(act, line.input.value) : this.submit(act, { [name]: line.input.value }, name);
    });
    return name === 'title' ? turn.then(() => { if (!this.lines.title?.start) this.renaming(false); }) : turn;
  }

  // Each act waits for the one before it; one that fails outright never
  // holds up the next, and one overtaken meanwhile sends nothing. Each
  // returns its turn. An act refused only because the person's own lost
  // change came first is worked out again, from what that one saved
  // (answered); each time a read has found one more such change of theirs
  // saved, and none is added meanwhile, so this ends.
  after(act, run) {
    const topic = this.topic, current = () => this.topic?.id === topic?.id;
    const next = this.queue.then(async () => {
      try { while (current() && !act.dead && await run() === AGAIN); } finally { this.pending = this.pending.filter(item => item !== act); }
    });
    this.queue = next.catch(error => { this.show(error?.message ?? String(error)); });
    return this.queue;
  }

  // The reader's part, fenced on its revision.
  async submitNote(act, words) {
    if (!this.topic || !this.mine()) return;
    if (new TextEncoder().encode(words).length > NOTE_BYTES) { this.show(`Your part is at most ${NOTE_BYTES} bytes; shorten it and press Return again.`); return; }
    const topic = this.topic, fence = act.fences.duty.fence;
    return this.answered(act, topic, () => this.sendNote(topic, words, fence), { duty: fence }, 'duty', { duty: words }, result => {
      if (result.actor_id !== this.reader) return null;
      const participants = this.participants.map(person => person.actor_id === this.reader
        ? { ...person, responsibility: result.note, responsibility_truncated: false, responsibility_revision: result.responsibility_revision } : person);
      this.paint(Number.isSafeInteger(result.version) && result.version > this.topic.version ? { ...this.topic, version: result.version } : this.topic, participants);
      return { duty: { value: result.note, fence: result.responsibility_revision } };
    }, answer => {
      const note = answer.participants?.find(person => person.actor_id === this.reader)?.responsibility;
      return note ? `Your note was not confirmed. You are responsible for: ${note}.` : 'Your note was not confirmed. You have no note in this topic.';
    }, 'Your note was not confirmed, and reading it again failed too.');
  }

  // A change to the topic: args, fenced on the act's fields. sent: the line
  // whose words it sends, if any.
  submit(act, args, sent = null) {
    if (!this.topic) return undefined;
    const topic = this.topic, fields = Object.fromEntries(Object.entries(act.fences).map(([name, seen]) => [name, seen.fence]));
    // What each field it changes would hold had it committed, by Core's
    // rules: what it sends; the note, which a state starts afresh after a
    // reopen; and who it waits on, which only a waiting topic keeps.
    const left = { ...('state' in args && topic.state_message_id ? { note: '' } : {}), ...('state' in args && args.state !== 'waiting' ? { waiting_on: [] } : {}), ...args };
    const would = Object.fromEntries(Object.keys(fields).filter(name => name in left && !alike(left[name], fields[name])).map(name => [name, left[name]]));
    return this.answered(act, topic, () => this.send(topic, args, fields), fields, sent, would, result => {
      this.advance(result, args);
      const now = { title: result.title, archived: result.archived, state: result.state, state_note: result.note, waiting_on: result.waiting_on };
      return Object.fromEntries(Object.keys(fields).map(name => { const value = HELD[name](now); return [name, { value, fence: value }]; }));
    }, answer => ['The change was not confirmed. It stands as: ', ...this.standing(answer.topic), '.'],
    'The change was not confirmed, and reading where the topic stands again failed too.');
  }

  // Core's answer to an act, settled on each field it was fenced on
  // (fields: by name, what it read). sent: the line whose words went; would:
  // what each field it changes would hold had it committed. apply(result)
  // paints a committed answer and gives what Core saved, by field;
  // unsure(answer) and unread word a change that was not confirmed, after
  // one read of the topic. Answers AGAIN when the act is to be worked out
  // again, after the person's own lost change that came first.
  async answered(act, topic, go, fields, sent, would, apply, unsure, unread) {
    let message = null, receipt = null, lost = false, again = false;
    try {
      receipt = await go();
    } catch (error) {
      message = error.message; lost = true;
    }
    if (this.topic?.id !== topic.id) return undefined;
    const names = Object.keys(fields), refused = receipt?.error?.code === 'REVISION_CONFLICT';
    const saved = receipt?.status === 'committed' && receipt.result?.topic_id === topic.id ? apply(receipt.result) : null;
    if (saved) {
      // Its paint has settled what the person's lost changes left (settle).
      for (const name of names) if (saved[name]) this.landed(name, fields[name], saved[name], sent === name ? would[name] : undefined);
    } else if (refused) {
      // Read once, so whatever came first shows: the person's own lost
      // change, found saved by this read, which this act then goes again
      // from; or someone else's newer value, which shows beside the
      // person's own words before anything of theirs goes over it.
      const found = this.found, answer = await this.readAgain(topic);
      const stale = answer ? names.filter(name => !alike(act.fences[name].fence, this.field(name).fence)) : names;
      again = !!answer && this.found > found && !stale.length;
      if (!again) {
        this.overtaken(act, stale.length ? stale : names);
        if (answer && sent) this.lines[sent]?.refused(act.fences[sent].fence);
        message = sent ? kept(sent, answer ? this.field(sent).value : null) : CHANGED;
      }
    } else if (receipt?.error?.message) {
      message = receipt.error.message;
    } else {
      // Read once, before the next act is weighed, so what this one saved is where its fields begin.
      for (const name of Object.keys(would)) (this.lost[name] ??= []).push({ fence: fields[name], would: would[name] });
      const answer = await this.readAgain(topic);
      if (!lost) message = answer ? unsure(answer) : unread;
    }
    if (!again) {
      if (!saved && this.lines[sent] && !this.lines[sent].same()) this.attention();
      // A refusal over newer words stays said, past later changes, until that line's words are saved or put back.
      if (sent && refused) this.kept = { name: sent, message };
      else if (this.kept && (this.kept.name === sent || this.lines[this.kept.name]?.same() !== false)) this.kept = null;
    }
    this.show(message ?? this.kept?.message ?? 'Saved', !message && !this.kept);
    this.refresh();
    return again ? AGAIN : undefined;
  }

  // The person's own change to a field, fenced on from, is known saved as
  // to ({ value, fence }): where its line's edit began, and every act made
  // from that same value, go on from what Core saved. words: what it sent
  // from that line, if anything.
  landed(name, from, to, words) {
    this.found += 1;
    this.lines[name]?.landed(from, to, words);
    for (const act of this.pending) if (act.fences[name] && alike(act.fences[name].fence, from)) act.fences[name] = to;
  }

  // A refusal of act, said now, over someone else's change to the stale
  // fields: every act after it fenced on the same value of one of those was
  // made before the person saw the newer value, so it is never sent.
  overtaken(act, stale) {
    for (const later of this.pending.slice(this.pending.indexOf(act) + 1)) {
      if (stale.some(name => later.fences[name] && alike(later.fences[name].fence, act.fences[name].fence))) later.dead = true;
    }
  }

  // What fresh data says of each change of the person's whose answer was
  // lost: still unsaved while the field holds what it read; found saved when
  // the field holds what it would have left; otherwise past, as someone
  // else's change has come since. Either way the record goes.
  settle() {
    for (const [name, entries] of Object.entries(this.lost)) {
      const now = this.field(name), waiting = entries.filter(entry => alike(now.fence, entry.fence));
      const found = entries.find(entry => !alike(now.fence, entry.fence) && alike(now.value, entry.would));
      if (waiting.length) this.lost[name] = waiting; else delete this.lost[name];
      if (found) this.landed(name, found.fence, now, found.would);
    }
  }

  // Each line nobody is editing shows the topic as it stands; the chips always do.
  follow() {
    const controls = this.controls, topic = this.topic, reader = this.reader;
    this.settle();
    for (const line of Object.values(this.lines)) line.follow();
    const state = known(topic.state);
    if (controls.says) {
      for (const [value, button] of controls.states) lit(button, value === state);
      this.people(state === 'waiting');
    } else {
      const mark = element('span', { className: 'choice-chip', textContent: stateLabel(topic, reader) });
      mark.setAttribute('aria-pressed', 'true');
      controls.chips.replaceChildren(mark);
      controls.note.textContent = topic.state_note ?? ''; controls.note.hidden = !topic.state_note;
    }
    const by = topic.state_by ? [`Set by ${named(topic.state_by, reader)}`, ...whole(', ', topic.state_ms)] : [];
    const asks = askParts(topic, reader).map(({ words, since }) => [words, ...whole(', since ', since)]);
    const said = joined([by, ...asks, topic.archived ? ['Archived'] : []], ' · ');
    controls.by.replaceChildren(...said); controls.by.hidden = !said.length;
    const duties = responsibilities(this.participants, reader).filter(({ who }) => !(controls.duty && who === 'you'));
    controls.duties.replaceChildren(...duties.map(({ who, note }) => element('li', {}, element('strong', { textContent: who }), ` ${note}`)));
    controls.duties.hidden = !duties.length;
    if (controls.managed) controls.managed.archive.textContent = topic.archived ? 'Unarchive' : 'Archive';
  }

  // Who a waiting topic can wait on: its people, the reader as "you" first,
  // and anyone it already waits on. The chips are kept by person, so the one
  // just tapped keeps its focus.
  people(show) {
    const { waiting, people, personChips } = this.controls, topic = this.topic, reader = this.reader;
    waiting.hidden = !show;
    if (!show) return;
    const said = Array.isArray(topic.waiting_on) ? topic.waiting_on : [];
    const ids = [...new Set([...this.participants.filter(person => typeof person?.actor_id === 'string' && person.active !== 0 && person.active !== false)
      .map(person => person.actor_id), ...said])];
    const order = [...ids.filter(id => id === reader), ...ids.filter(id => id !== reader)];
    for (const id of order) if (!personChips.has(id)) personChips.set(id, chip(named(id, reader), () => this.toggle(id)));
    for (const [id, button] of personChips) if (!order.includes(id)) { button.remove(); personChips.delete(id); }
    if (order.some((id, index) => people.children[index] !== personChips.get(id))) people.append(...order.map(id => personChips.get(id)));
    for (const id of order) lit(personChips.get(id), said.includes(id));
  }

  // message: words, or a list of parts holding times. quiet: a plain
  // "Saved", not a warning.
  show(message, quiet = false) {
    if (Array.isArray(message)) this.notice.replaceChildren(...message); else this.notice.textContent = message ?? '';
    this.notice.hidden = !message;
    this.notice.classList.toggle('quiet', quiet);
  }

  // One read of the topic as it stands, never a second send. The panel keeps
  // what it last showed when the read fails; the next commit repaints it.
  async readAgain(topic) {
    if (!this.read) return null;
    try {
      const answer = await this.read();
      if (answer?.topic?.id !== topic.id || this.topic?.id !== topic.id) return null;
      this.paint(answer.topic, Array.isArray(answer.participants) ? answer.participants : this.participants);
      return answer;
    } catch { return null; }
  }

  // "Waiting on tony · Needs a call on the deck — fable, 5:33 PM Thu Nov 5"
  standing(topic) {
    return [stateLabel(topic, this.reader), ...(topic.state_note ? [' · ', topic.state_note] : []),
      ...(topic.state_by ? [` — ${named(topic.state_by, this.reader)}`, ...at(', ', topic.state_ms)] : [])];
  }

  // Core's answer to a committed change is the topic as it now stands: paint
  // it, so the next change reads what this one made.
  advance(result, args) {
    if (!Number.isSafeInteger(result.version)) return;
    const { version, title, archived, state, note, waiting_on, state_by, state_ms } = result;
    // The answer says what was said; the open asks are as the page last read them.
    // A state someone said is no longer a message's.
    const said = ['state', 'note', 'waiting_on'].some(name => name in args) ? { state_message_id: null } : {};
    this.paint({ ...this.topic, version, title, archived, state, state_note: note, waiting_on, state_by, state_ms, ...said });
  }

  hide() {
    this.host.hidden = true; this.host.replaceChildren(); this.topic = null; this.controls = null; this.lines = {}; this.kept = null; this.lost = {}; this.pending = []; this.show(null);
  }
}

// The topics that wait on the reader, newest first: said to, or asked and not
// yet answered. Painted on the Outcomes home only; each row says which outcome
// it is in: "Speaker notes, in Pitch deck — fable asked at 6:20 AM" (item 86).
export function paintWaiting(host, answer, open) {
  const items = Array.isArray(answer?.latest_waiting) ? answer.latest_waiting : [];
  const count = Number.isSafeInteger(answer?.waiting_on_me) ? answer.waiting_on_me : 0;
  if (!count) { host.hidden = true; host.replaceChildren(); return; }
  const spoken = (ms, form = 'at') => Number.isSafeInteger(ms) ? [spokenNode(ms, form, document)] : [];
  const list = element('ul', { className: 'waiting-list' }, ...items.map(item => {
    const link = element('a', { href: '?topic=' + encodeURIComponent(item.id), textContent: item.title + (item.title_truncated ? '…' : '') });
    link.onclick = event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); open(item.id, item.title);
    };
    const outcome = item.workspace && typeof item.workspace.title === 'string'
      ? [`, in ${item.workspace.title}${item.workspace.title_truncated ? '…' : ''}`] : [];
    const ask = item.ask && typeof item.ask.by === 'string' ? [`${item.ask.by} asked`, ...(Number.isSafeInteger(item.ask.since_ms) ? [' ', ...spoken(item.ask.since_ms)] : [])] : [];
    // A topic whose state also says it waits keeps those words, as they were, before the ask.
    const said = item.said === false ? [] : joined([item.note ? [item.note] : [], item.state_by ? [item.state_by, ...at(', ', item.state_ms)] : []], ' — ');
    const detail = joined([said, ask], ' · ');
    return element('li', {}, link, ...outcome, ...(detail.length ? [element('span', { className: 'muted' }, ' — ', ...detail)] : []));
  }));
  host.replaceChildren(element('h2', { textContent: count > items.length ? `Waiting on you (${count}, newest ${items.length} shown)` : `Waiting on you (${count})` }), list);
  host.hidden = false;
}
