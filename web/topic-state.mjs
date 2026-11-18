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
// What Core's answer to a topic.update says of the topic, and what its answer
// to Your part says of the reader's own row; everything else only a read says.
const SAID = ['title', 'archived', 'state', 'state_note', 'waiting_on', 'state_by', 'state_ms', 'state_message_id'];
const DUTY = ['responsibility', 'responsibility_truncated', 'responsibility_revision'];
const pick = (record, keys) => Object.fromEntries(keys.map(key => [key, record[key]]));
// Two values of a field alike; who a topic waits on compares as a set.
const alike = (a, b) => Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every(id => b.includes(id)) : a === b;
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

// Where the topic stands, in Topic settings, set in place: four chips, the
// topic's people as chips while it waits, the note and the reader's part as
// one line each, and for whoever organises the outcome or created the topic,
// a quiet Rename and Archive. The controls are built once per topic and kept
// across repaints, so focus and typed words survive fresh data.
//
// Each control is a field (docs/topic-settings.md): the note, Your part, the
// title, the state chips, the people chips and Archive. Its start is where
// the person's change began, each key as Core held it and the topic version
// Core said it at; out is its one save, in flight or with its answer lost;
// next says the person asked for another. A save sends only what the field
// changed, fenced on its start. Core's answer decides: committed moves every
// start read before it on the same value to what Core saved; refused shows
// the newer value beside the person's kept words and starts from it; lost is
// asked again, as the same command, when the connection is back or at the
// person's next act. Only the latest change goes next. A field waits for
// another's save that changes a key it is fenced on.
export class TopicStatePanel {
  // send(topic, args, fields, id) and sendNote(topic, note, revision, id) send
  // operation id to Core, which answers the same id once and then as stored.
  // refresh asks for fresh data after each answer; painted(topic) hears each
  // topic painted; read() gives {topic, participants}, read once after a
  // refusal or a lost answer to show what Core holds; attention() asks the
  // page to show Topic settings when a line's words are refused.
  constructor({ host, reader, send, sendNote = null, refresh = () => {}, painted = () => {}, read = null, attention = () => {}, titleSurface = null }) {
    Object.assign(this, { host, reader, send, sendNote, refresh, painted, read, attention, titleSurface });
    // kept: the refusal said over a line's words, while they stay unsaved.
    // running: each answer still awaited. at: the topic version Core said
    // each part of what shows at: the last read, what a topic.update answers
    // (SAID) and the reader's own part (DUTY). An answer says only its own
    // part, so it moves only that part's version.
    this.topic = null; this.controls = null; this.fields = {}; this.kept = null; this.running = new Set(); this.at = null;
    this.heading = element('h3', { id: 'stand-heading', textContent: 'Where it stands' });
    // One notice, kept in place, so a screen reader announces each new text.
    this.notice = element('p', { className: 'notice', hidden: true });
    this.notice.setAttribute('role', 'status');
    if (titleSurface) {
      titleSurface.host.replaceChildren(); titleSurface.host.hidden = true; titleSurface.title.hidden = false;
      titleSurface.pencil.onclick = () => this.renameTitle();
    }
  }

  // A read of the topic and its participants.
  paint(topic, participants = this.participants ?? []) {
    if (this.topic?.id !== topic.id) { this.reset(); this.at = { read: -Infinity, said: -Infinity, duty: -Infinity }; }
    // A read that left before the one shown cannot undo it.
    else if (topic.version < this.at.read) return;
    const version = topic.version, mine = this.mine();
    // Nor what a later answer said: that part stays as answered.
    if (version < this.at.said) topic = { ...topic, ...pick(this.topic, SAID) };
    if (version < this.at.duty && mine) participants = participants.map(person => person.actor_id === this.reader ? { ...person, ...pick(mine, DUTY) } : person);
    this.at = { read: version, said: Math.max(this.at.said, version), duty: Math.max(this.at.duty, version) };
    this.draw(topic, participants);
  }

  draw(topic, participants = this.participants) {
    this.topic = topic; this.participants = participants;
    const reader = this.reader, manager = managesTopic(topic, reader);
    const participant = participants.some(person => person.actor_id === reader);
    const says = topic.reader_may_say === true || participant || manager;
    if (!this.controls || this.controls.says !== says) this.build(says);
    this.manage(manager); this.duty(participant && !!this.sendNote); this.follow();
    this.host.hidden = false;
    this.painted(topic);
  }

  reset() { this.restoreTitleSurface(); this.managedTitle = null; this.controls = null; this.fields = {}; this.kept = null; this.show(null); }

  // Whether the reader may say where the topic stands, by Core's rule: its
  // participants, its creator, whoever organises the outcome and whoever has
  // written in it (reader_may_say). Their chips are buttons.
  get says() { return this.controls?.says === true; }

  // ✅ Done at the top of a topic: the Done chip's tap, from the topic as it
  // shows. A refusal or an answer lost is said in Topic settings, opened for it.
  markDone() { return this.says ? this.tap('state', () => 'done', true) : this.queue; }

  // The chips, the note and the quiet line of who said it: chips to tap for
  // those who may say where it stands, the state alone for everyone else.
  build(says) {
    // Reclaim the field while its lending panel still owns it. Keep the
    // title model across a permission rebuild so answers and writing survive.
    this.restoreTitleSurface();
    const titleFields = Object.fromEntries(['title', 'archived'].filter(name => this.fields[name]).map(name => [name, this.fields[name]]));
    const chips = element('div', { className: 'state-chips' });
    chips.setAttribute('role', 'group'); chips.setAttribute('aria-labelledby', 'stand-heading');
    const states = new Map();
    const waitingLabel = element('span', { id: 'waiting-label', className: 'chips-label', textContent: 'Waiting on' });
    const people = element('div', { className: 'state-chips people-chips' });
    people.setAttribute('role', 'group'); people.setAttribute('aria-labelledby', 'waiting-label');
    const waiting = element('div', { className: 'waiting-on', hidden: true }, waitingLabel, people);
    let note;
    this.fields = titleFields;
    if (says) {
      for (const value of STATES) {
        const button = chip(LABELS[value], () => this.tap('state', () => value));
        button.dataset.state = value; states.set(value, button); chips.append(button);
      }
      this.fields.state = { name: 'state' }; this.fields.people = { name: 'people' };
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

  // A line by name: its first key begins a change, Return or leaving saves
  // it, and Escape puts back what is saved.
  line(name, props, events = {}) {
    const input = lineField(props, { touch: () => { const field = this.fields[name]; if (field) field.start ??= this.snapshot(name); },
      save: () => this.save(name), cancel: () => this.cancel(name), ...events });
    this.fields[name] = { name, line: input };
    return input;
  }

  // What Core holds for a key, { value, fence }, as this panel last read it:
  // a field of the topic, fenced on its value, or the reader's part
  // ('duty'), fenced on its revision.
  held(key) {
    if (key !== 'duty') { const value = HELD[key](this.topic); return { value, fence: value }; }
    const mine = this.mine(), revision = mine?.responsibility_revision;
    return { value: mine?.responsibility ?? '', fence: Number.isSafeInteger(revision) ? revision : 0 };
  }

  // Where a change of a field begins: each key it is fenced on as held now,
  // with the topic version Core said it at. The keys are its own, and for a
  // chip where the topic stands and who it waits on, which a state also sets,
  // and the note after a reopen, which Core then starts afresh.
  snapshot(name) {
    const keys = name === 'state' || name === 'people' ? ['state', 'waiting_on', ...(this.topic.state_message_id ? ['note'] : [])] : [name];
    return Object.fromEntries(keys.map(key => [key, { ...this.held(key), version: key === 'duty' ? this.at.duty : this.at.said }]));
  }

  // Renaming and archiving, for whoever organises the outcome and the
  // topic's creator: two quiet actions. Rename puts a one-line title in their place.
  manage(manager) {
    const controls = this.controls;
    if (manager && !this.managedTitle) {
      const unchanged = () => this.fields.title?.line.value === this.topic?.title;
      const title = this.line('title', { id: 'topic-rename', className: 'rename-line', hidden: true },
        { cancel: () => { this.renaming(false); return true; }, leave: () => { if (!this.movingTitle && !unchanged()) this.save('title'); } });
      title.setAttribute('aria-label', 'Title');
      // Leaving the title unchanged puts the actions back, where the focus went.
      title.addEventListener('blur', () => { if (!this.movingTitle && unchanged() && !title.hidden) this.renaming(false, false); });
      const rename = element('button', { type: 'button', className: 'text-action', textContent: 'Rename' });
      rename.onclick = () => this.renaming(true);
      // Archive means what it said when pressed.
      const archive = element('button', { type: 'button', className: 'text-action' });
      archive.onclick = () => this.tap('archived', () => !HELD.archived(this.topic));
      this.fields.archived = { name: 'archived' };
      controls.actions.replaceChildren(title, rename, archive);
      controls.actions.hidden = false;
      this.managedTitle = { title, rename, archive };
    }
    if (this.managedTitle) {
      if (!manager) this.restoreTitleSurface();
      const { title, rename, archive } = this.managedTitle;
      // A read-only panel owns the same disabled field behind its hidden
      // actions; a regained permission makes those exact words available.
      if (!controls.actions.contains(title) && !this.inlineTitle) controls.actions.replaceChildren(title, rename, archive);
      title.disabled = rename.disabled = archive.disabled = !manager;
      controls.actions.hidden = !manager;
      controls.managed = manager ? this.managedTitle : null;
    }
  }

  // The header borrows the existing title field and its notice. No second
  // save model: both entry points keep the same words, fences and operation.
  renameTitle() {
    const managed = this.controls?.managed, surface = this.titleSurface;
    if (!managed || !surface || this.topic.kind === 'conversation') return;
    this.inlineTitle = true;
    surface.title.hidden = surface.pencil.hidden = true; surface.host.hidden = false;
    surface.host.append(managed.title, this.notice);
    this.show(null);
    this.renaming(true);
  }

  // Opening settings or ending the edit puts the field and notice back. A
  // move alone preserves its writing and in-flight save, without taking focus.
  restoreTitleSurface() {
    if (!this.inlineTitle) return;
    const managed = this.controls?.managed, surface = this.titleSurface;
    this.inlineTitle = false;
    this.movingTitle = true;
    try {
      if (managed) this.controls.actions.prepend(managed.title);
      this.host.insertBefore(this.notice, this.controls?.actions ?? null);
    } finally { this.movingTitle = false; }
    surface.host.hidden = true; surface.title.hidden = false;
    surface.pencil.hidden = !managesTopic(this.topic, this.reader) || this.topic.kind === 'conversation';
  }

  // Whether the one-line title shows in place of the title or settings actions.
  // focus: whether the focus moves too, to the line or back to its opener.
  renaming(on, focus = true) {
    const managed = this.controls?.managed;
    if (!managed) return;
    const had = managed.title === document.activeElement;
    const opener = this.inlineTitle ? this.titleSurface.pencil : managed.rename;
    if (!on) { this.cancel('title'); this.restoreTitleSurface(); }
    managed.title.hidden = !on; managed.rename.hidden = managed.archive.hidden = on;
    if (!focus) return;
    if (on) { managed.title.focus(); managed.title.select(); }
    else if (had || document.activeElement === document.body || !document.activeElement) opener.focus();
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
      controls.duty.heading.remove(); controls.duty.note.remove(); controls.duty = null; delete this.fields.duty;
    }
  }

  mine() { return this.participants?.find(person => person.actor_id === this.reader) ?? null; }

  // Whether a line's words are no change: those it began from, or those saved now (R4).
  same(field) {
    const words = field.line.value;
    return words === field.start[field.name].value || words === this.held(field.name).value;
  }

  // The person's change to a field ends: a line shows what is saved again.
  stop(field) {
    field.start = null; field.next = false; field.intent = null;
    if (field.line) field.line.value = this.held(field.name).value;
    if (this.kept?.name === field.name) this.kept = null;
  }

  // Return or leaving a line.
  save(name) {
    const field = this.fields[name];
    if (!field) return this.queue;
    if (field.start) field.next = true;
    const turn = this.turn(field);
    return name === 'title' ? turn.then(() => { if (!this.fields.title?.start) this.renaming(false); }) : turn;
  }

  // Escape in a line: what is saved comes back, if the line held anything else.
  cancel(name) {
    const field = this.fields[name];
    if (!field?.start) return false;
    const dirty = !this.same(field), refused = this.kept?.name === name;
    this.stop(field);
    if (refused) this.show(null);
    return dirty;
  }

  // A tap on a chip or Archive: a change of its own, from the topic as it
  // shows. change(intent) is what the person means now. Lines whose words are
  // no change follow the data again. away: the tap was made outside Topic
  // settings, which then opens to say what became of it, unless it saved.
  tap(name, change, away = false) {
    for (const field of Object.values(this.fields)) if (field.line && field.start && !field.out && !field.next && this.same(field)) this.stop(field);
    const field = this.fields[name];
    field.start = this.snapshot(name); field.intent = change(field.intent); field.next = true; field.away = away;
    return this.turn(field);
  }

  // The field's next save, when the person asked for one and nothing it
  // waits on is out. At the person's act (ask), a save it waits on whose
  // answer was lost is asked again first.
  turn(field, ask = true) {
    if (['title', 'archived'].includes(field.name) && !managesTopic(this.topic, this.reader)) return this.queue;
    if (field.next) {
      const busy = field.out ? field : this.blocker(field);
      if (!busy) this.go(field);
      else if (ask && busy.out.lost) this.post(busy, true);
    }
    return this.queue;
  }

  // Another field whose save is out and changes a key this field is fenced on.
  blocker(field) {
    const keys = Object.keys(field.start ?? {});
    return Object.values(this.fields).find(other => other !== field && other.out && Object.keys(other.out.fences).some(key => keys.includes(key))) ?? null;
  }

  // What the field's save changes, worked out from its start now; nothing
  // when there is nothing to change (R4).
  want(field) {
    const { start, intent } = field, now = key => this.held(key).value;
    if (field.line) return this.same(field) ? null : { [field.name === 'duty' ? 'note' : field.name]: field.line.value };
    if (field.name === 'state') return intent === start.state.value || intent === now('state') ? null : { state: intent, keep_note: true };
    if (field.name === 'archived') return intent === start.archived.value || intent === now('archived') ? null : { archived: intent };
    const so = (state, list) => state === 'waiting' && [...intent].every(([id, on]) => list.includes(id) === on);
    if (so(start.state.value, start.waiting_on.value) || so(now('state'), now('waiting_on'))) return null;
    const list = [...start.waiting_on.value.filter(id => !intent.has(id)), ...[...intent].filter(([, on]) => on).map(([id]) => id)];
    return { state: 'waiting', waiting_on: list, keep_note: true };
  }

  go(field) {
    field.next = false;
    const args = field.start && this.want(field);
    if (!args) { if (field.start) this.stop(field); return; }
    if (field.name === 'duty' && new TextEncoder().encode(args.note).length > NOTE_BYTES) {
      this.show(`Your part is at most ${NOTE_BYTES} bytes; shorten it and press Return again.`); return;
    }
    const fences = Object.fromEntries(Object.entries(field.start).map(([key, seen]) => [key, seen.fence]));
    field.out = { id: crypto.randomUUID(), args, fences, again: false, lost: false };
    this.post(field, false);
  }

  // Send the field's save; again: as the same command, to ask Core what became of it.
  post(field, again) {
    const out = field.out, topic = this.topic;
    out.lost = false; out.again ||= again;
    const run = (async () => {
      let receipt = null, error = null;
      try {
        receipt = await (field.name === 'duty' ? this.sendNote(topic, out.args.note, out.fences.duty, out.id) : this.send(topic, out.args, out.fences, out.id));
      } catch (caught) { error = caught ?? Error('The change was not confirmed.', { cause: caught }); }
      await this.answered(field, out, topic, receipt, error);
    })().catch(error => this.show(error?.message ?? String(error)));
    this.running.add(run);
    run.then(() => this.running.delete(run));
  }

  // Core's answer to a field's save, or the attempt's error.
  async answered(field, out, topic, receipt, error) {
    if (this.topic?.id !== topic.id || this.fields[field.name] !== field || field.out !== out) return;
    let message = null;
    if (receipt?.status === 'committed' && receipt.result?.topic_id === topic.id) {
      field.out = null;
      const version = Number.isSafeInteger(receipt.result.version) ? receipt.result.version : Infinity;
      this.moved(out.fences, this.apply(field, receipt.result), version);
      if (this.kept?.name === field.name) this.kept = null;
      if (field.line ? field.start && this.same(field) : !field.next) this.stop(field);
    } else if (receipt?.error?.code === 'REVISION_CONFLICT') {
      field.out = null; field.next = false;
      const answer = await this.readAgain(topic);
      if (field.line && field.start) {
        if (answer) field.start = this.snapshot(field.name);
        message = kept(field.name, answer ? this.held(field.name).value : null);
        this.kept = { name: field.name, message };
        if (!(field.name === 'title' && this.inlineTitle)) this.attention();
      } else {
        message = field.line ? `${KEPT[field.name]}, so yours was not saved.` : CHANGED;
        if (!field.line) this.stop(field);
      }
    } else if (receipt?.error?.message && receipt.status !== 'retryable') {
      field.out = null; field.next = false; message = receipt.error.message;
    } else {
      out.lost = true;
      // The person acted again while it was out: ask Core about it once now.
      if (!out.again && (field.next || Object.values(this.fields).some(other => other.next && this.blocker(other) === field))) { this.post(field, true); return; }
      const answer = await this.readAgain(topic);
      message = error ? error.message : this.unconfirmed(field, answer);
    }
    if (message && field.away) this.attention();
    this.show(message ?? this.kept?.message ?? 'Saved', !message && !this.kept);
    this.refresh();
    for (const other of Object.values(this.fields)) if (other.next) this.turn(other, false);
  }

  // The person's own save, committed as the topic's version, fenced on
  // fences: every start read before it, on the same value, goes on from what
  // Core saved (R3). A start read at that version or later already shows it,
  // or what came after it.
  moved(fences, saved, version) {
    for (const field of Object.values(this.fields)) {
      for (const [key, seen] of Object.entries(field.start ?? {})) {
        if (key in fences && saved[key] && seen.version < version && alike(seen.fence, fences[key])) field.start[key] = { ...saved[key], version };
      }
    }
  }

  // Paint a committed answer; what Core saved, by key.
  apply(field, result) {
    if (field.name === 'duty') {
      if (result.actor_id !== this.reader) return {};
      const { note, responsibility_revision: revision, version } = result;
      // It says the reader's part as of its version, and nothing of the
      // topic. One that comes after a newer part was read leaves that one showing.
      if (Number.isSafeInteger(version) && version > this.at.duty) {
        this.at.duty = version;
        this.draw(this.topic, this.participants.map(person =>
          person.actor_id === this.reader ? { ...person, responsibility: note, responsibility_truncated: false, responsibility_revision: revision } : person));
      }
      return { duty: { value: note, fence: revision } };
    }
    this.advance(result);
    const now = { title: result.title, archived: result.archived, state: result.state, state_note: result.note, waiting_on: result.waiting_on };
    return Object.fromEntries(Object.keys(HELD).map(key => { const value = HELD[key](now); return [key, { value, fence: value }]; }));
  }

  // A lost answer, said after one read (answer, or null when it failed).
  unconfirmed(field, answer) {
    if (field.name !== 'duty') return answer ? ['The change was not confirmed. It stands as: ', ...this.standing(answer.topic), '.']
      : 'The change was not confirmed, and reading where the topic stands again failed too.';
    const note = answer?.participants?.find(person => person.actor_id === this.reader)?.responsibility;
    return !answer ? 'Your note was not confirmed, and reading it again failed too.'
      : note ? `Your note was not confirmed. You are responsible for: ${note}.` : 'Your note was not confirmed. You have no note in this topic.';
  }

  // The connection is back: each save whose answer was lost goes again as
  // the same command, once, and Core says what became of it.
  reconnected() {
    for (const field of Object.values(this.fields)) if (field.out?.lost) this.post(field, true);
    return this.queue;
  }

  // Settles once no answer is awaited.
  get queue() {
    return (async () => { while (this.running.size) await Promise.all([...this.running]); })();
  }

  // Each line nobody is editing shows the topic as it stands; the chips always do.
  follow() {
    const controls = this.controls, topic = this.topic, reader = this.reader;
    for (const field of Object.values(this.fields)) if (field.line && !field.start) field.line.value = this.held(field.name).value;
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
    // A tap adds or takes away that person, as the chip showed.
    const toggle = id => () => this.tap('people', intent => new Map(intent ?? []).set(id, !HELD.waiting_on(this.topic).includes(id)));
    for (const id of order) if (!personChips.has(id)) personChips.set(id, chip(named(id, reader), toggle(id)));
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

  // One read of the topic as it stands, to show it. The panel keeps what it
  // last showed when the read fails; the next commit repaints it.
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

  // Core's answer to a committed change is what the topic says as it now
  // stands (SAID), at its version: paint it, so the next change reads what
  // this one made. The open asks are as the page last read them.
  advance(result) {
    const { version, title, archived, state, note, waiting_on, state_by, state_ms, state_message_id } = result;
    if (!Number.isSafeInteger(version) || version <= this.at.said || !(state_message_id === null || typeof state_message_id === 'string')) return;
    this.at.said = version;
    this.draw({ ...this.topic, title, archived, state, state_note: note, waiting_on, state_by, state_ms, state_message_id });
  }

  hide() {
    this.restoreTitleSurface();
    this.host.hidden = true; this.host.replaceChildren(); this.topic = null; this.managedTitle = null; this.controls = null; this.fields = {}; this.kept = null; this.at = null; this.show(null);
  }
}

// "release 44", "item 259", "items 259 and 260": what a blocking ask holds, in plain words (item 259).
export function blockedWords(blocks) {
  if (blocks?.kind === 'release') return Number.isSafeInteger(blocks.release) ? `release ${blocks.release}` : 'a release';
  const items = Array.isArray(blocks?.items) ? blocks.items.filter(Number.isSafeInteger) : [];
  if (!items.length) return 'a piece';
  return `item${items.length > 1 ? 's' : ''} ${items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`}`;
}

// The topics that wait on the reader, newest first: said to, or asked and not
// yet answered. Painted on the Outcomes home only; each row says which outcome
// it is in: "Speaker notes, in Pitch deck — fable asked at 6:20 AM" (item 86).
// An ask that holds a piece or a release comes first, above every other
// question, labelled with what it holds: "Blocking a release (release 44):
// Deploy, in Theseus — fable asked at 6:20 AM" (item 259); its topic is not
// listed again below it.
export function paintWaiting(host, answer, open) {
  const blocking = (Array.isArray(answer?.blocking) ? answer.blocking : [])
    .filter(item => typeof item?.topic_id === 'string' && ['release', 'piece'].includes(item.blocks?.kind));
  const held = new Set(blocking.map(item => item.topic_id));
  const items = (Array.isArray(answer?.latest_waiting) ? answer.latest_waiting : []).filter(item => !held.has(item.id));
  const count = Number.isSafeInteger(answer?.waiting_on_me) ? answer.waiting_on_me : 0;
  if (!count && !blocking.length) { host.hidden = true; host.replaceChildren(); return; }
  const spoken = (ms, form = 'at') => Number.isSafeInteger(ms) ? [spokenNode(ms, form, document)] : [];
  const topicLink = (id, title, truncated) => {
    const link = element('a', { href: '?topic=' + encodeURIComponent(id), textContent: title + (truncated ? '…' : '') });
    link.onclick = event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); open(id, title);
    };
    return link;
  };
  const outcomeOf = item => item.workspace && typeof item.workspace.title === 'string'
    ? [`, in ${item.workspace.title}${item.workspace.title_truncated ? '…' : ''}`] : [];
  const asked = ask => ask && typeof ask.by === 'string' ? [`${ask.by} asked`, ...(Number.isSafeInteger(ask.since_ms) ? [' ', ...spoken(ask.since_ms)] : [])] : [];
  const blockingRows = blocking.map(item => {
    const label = element('strong', { className: 'blocking-label', textContent: item.blocks.kind === 'release' ? 'Blocking a release' : 'Blocking a piece' });
    const detail = asked(item);
    return element('li', { className: 'blocking' }, label, ` (${blockedWords(item.blocks)}): `, topicLink(item.topic_id, item.title ?? '', item.title_truncated),
      ...outcomeOf(item), ...(detail.length ? [element('span', { className: 'muted' }, ' — ', ...detail)] : []));
  });
  const list = element('ul', { className: 'waiting-list' }, ...blockingRows, ...items.map(item => {
    const ask = asked(item.ask);
    // A topic whose state also says it waits keeps those words, as they were, before the ask.
    const said = item.said === false ? [] : joined([item.note ? [item.note] : [], item.state_by ? [item.state_by, ...at(', ', item.state_ms)] : []], ' — ');
    const detail = joined([said, ask], ' · ');
    return element('li', {}, topicLink(item.id, item.title, item.title_truncated), ...outcomeOf(item), ...(detail.length ? [element('span', { className: 'muted' }, ' — ', ...detail)] : []));
  }));
  const shown = held.size + items.length, total = Math.max(count, shown);
  host.replaceChildren(element('h2', { textContent: total > shown ? `Waiting on you (${total}, newest ${shown} shown)` : `Waiting on you (${total})` }), list);
  host.hidden = false;
}
