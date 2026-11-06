// Where a topic stands, as its participants say: a row mark in topic lists, a
// line under the topic's title with a form to change it, and the topics that
// wait on the reader. Core keeps every value; nothing here decides one.
import { datedTime, timeNode } from './times.mjs';

export const STATES = ['active', 'waiting', 'review', 'done'];
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
// in words. It never says nobody is working: only when activity was last seen.
// The server reads the rule for this reader, so what it names is never the
// reader's own: a topic only they wrote in reads "No activity seen".
// A waiting topic's words are its pill's ("Waiting on you"), passed as
// waiting; without them it waits on someone the page cannot name.
export function workNote(work, reader, waiting = '') {
  if (!work || typeof work !== 'object') return '';
  const when = Number.isSafeInteger(work.seen_ms) ? datedTime(work.seen_ms) : null;
  const what = when && typeof work.by === 'string' ? ` (${named(work.by, reader)} ${work.how === 'turn' ? 'took a turn' : 'posted'})` : '';
  // The server counts every wait as observed work.
  if (work.waits) {
    const who = waiting || 'Waiting on someone';
    return when ? `${who} · last activity ${when}${what}` : who;
  }
  if (work.observed && when) return `Activity seen ${when}${what}`;
  return when ? `No activity seen since ${when}` : 'No activity seen';
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
// A shown time after its lead-in (", since 7:41 AM"), or nothing when there is no time.
const at = (lead, ms) => Number.isSafeInteger(ms) ? [lead, timeNode(ms, document)] : [];
// The non-empty groups of parts, with gap between each.
const joined = (groups, gap) => groups.filter(parts => parts.length).flatMap((parts, index) => index ? [gap, ...parts] : parts);
// The same, kept on one line so a narrow screen never breaks inside the time.
const whole = (lead, ms) => Number.isSafeInteger(ms) ? [lead, element('span', { className: 'together' }, timeNode(ms, document))] : [];
const names = value => [...new Set(value.split(',').map(name => name.trim()).filter(Boolean))];
const known = state => STATES.includes(state) ? state : 'active';
const CHANGED = 'This topic changed while you were choosing. What you chose is kept here: check it against the line above and save again.';
const NOTE_CHANGED = 'Your note changed elsewhere while you were writing. What you wrote is kept here: check it against the list above and save again.';
const NOTE_BYTES = 1024;

// What each participant said they are responsible for, beside where the topic
// stands; the reader first, as "you". Participants without a note are left out.
export function responsibilities(participants, reader) {
  const said = (Array.isArray(participants) ? participants : [])
    .filter(person => typeof person?.actor_id === 'string' && typeof person.responsibility === 'string' && person.responsibility.trim());
  return [...said.filter(person => person.actor_id === reader), ...said.filter(person => person.actor_id !== reader)]
    .map(person => ({ who: named(person.actor_id, reader), note: person.responsibility + (person.responsibility_truncated ? '…' : '') }));
}
const NOT_SENT = 'That was not sent: another change was still being saved. Press it again.';

// The line under a topic's title, and a form for those who may change it:
// participants, and whoever has written in it (Core's reader_may_say), say
// where it stands; the outcome's owner and the topic's creator also rename and
// archive it.
//
// The form is built once per topic and kept across repaints, so focus and
// whatever the person has typed survive fresh data. A field the person has
// not touched shows the data; one they have touched keeps their value until
// it is saved. A new state starts with an empty note and nobody waited on,
// as in Core, unless the person typed them.
//
// A notice says what became of the person's last press, so it stays until
// they press again: the fresh data a refusal asks for does not answer it.
export class TopicStatePanel {
  // refresh asks the page for fresh topic data; it is called after every answer
  // to a change, so a refusal for a stale version is followed by the news.
  // sendNote(topic, note, revision) says what the reader is responsible for.
  constructor({ host, reader, send, sendNote = null, refresh = () => {} }) {
    Object.assign(this, { host, reader, send, sendNote, refresh });
    this.topic = null; this.out = null; this.controls = null; this.touched = new Set();
    this.line = element('p', { className: 'state-line' });
    this.duties = element('ul', { className: 'responsibilities', hidden: true });
    this.duties.setAttribute('aria-label', 'Who is responsible for what');
    // One notice, kept in place, so a screen reader announces each new text.
    this.notice = element('p', { className: 'notice', hidden: true });
    this.notice.setAttribute('role', 'status');
  }

  paint(topic, participants = this.participants ?? []) {
    if (this.topic?.id !== topic.id) this.reset();
    // A read that left before the version shown here cannot undo it.
    else if (topic.version < this.topic.version) return;
    this.topic = topic; this.participants = participants;
    const reader = this.reader, manager = [topic.owner_id, topic.creator_id].includes(reader);
    const participant = participants.some(person => person.actor_id === reader);
    const says = topic.reader_may_say === true || participant;
    const mark = element('strong', { className: 'topic-state', textContent: stateLabel(topic, reader), title: stateLabel(topic, reader) });
    mark.dataset.state = waitsOn(topic).length ? 'waiting' : topic.state ?? 'active';
    if (waitsOn(topic).includes(reader)) mark.classList.add('mine');
    const line = [mark];
    if (topic.state_note) line.push(' · ', element('span', { className: 'state-note', textContent: topic.state_note }));
    if (topic.state_by) line.push(element('span', { className: 'muted' }, ` — ${named(topic.state_by, reader)}`, ...whole(', ', topic.state_ms)));
    for (const { words, since } of askParts(topic, reader)) line.push(element('span', { className: 'muted ask-line' }, ` · ${words}`, ...whole(', since ', since)));
    if (topic.archived) line.push(element('span', { className: 'muted', textContent: ' · Archived' }));
    this.line.replaceChildren(...line);
    const duties = responsibilities(participants, reader);
    this.duties.replaceChildren(...duties.map(({ who, note }) => element('li', {}, element('strong', { textContent: who }), ` ${note}`)));
    this.duties.hidden = !duties.length;
    if (!(manager || says)) this.drop();
    else {
      if (!this.controls) this.host.insertBefore(this.build(), this.notice);
      this.manage(manager); this.duty(participant); this.follow();
    }
    this.host.hidden = false;
  }

  reset() {
    this.controls = null; this.touched.clear(); this.show(null);
    this.host.replaceChildren(this.line, this.duties, this.notice);
  }

  drop() {
    this.controls?.details.remove(); this.controls = null; this.touched.clear(); this.show(null);
  }

  build() {
    const touch = name => () => { this.touched.add(name); };
    const details = element('details', { className: 'state-form' }, element('summary', { textContent: 'Change where it stands' }));
    const state = element('select', { id: 'topic-state-choice' }, ...STATES.map(value => element('option', { value, textContent: LABELS[value] })));
    const note = element('input', { id: 'topic-state-note', maxLength: 1024, autocomplete: 'off' });
    const waiting = element('input', { id: 'topic-state-waiting', autocomplete: 'off', placeholder: 'Names, separated by commas' });
    const waitingField = element('label', { className: 'field-label' }, 'Waiting on ', waiting);
    state.onchange = () => { this.touched.add('state'); this.follow(); };
    note.oninput = touch('note'); waiting.oninput = touch('waiting');
    const save = element('button', { type: 'button', className: 'primary', textContent: 'Save' });
    save.onclick = () => this.submit({ state: state.value, note: note.value, ...(state.value === 'waiting' ? { waiting_on: names(waiting.value) } : {}) },
      ['state', 'note', 'waiting']);
    details.append(element('div', { className: 'state-fields' },
      element('label', { className: 'field-label' }, 'State ', state),
      element('label', { className: 'field-label' }, 'Note ', note), waitingField, save));
    this.controls = { details, state, note, waiting, waitingField, save, managed: null };
    return details;
  }

  // Renaming and archiving, for the outcome's owner and the topic's creator.
  manage(manager) {
    const controls = this.controls;
    if (manager && !controls.managed) {
      const title = element('input', { id: 'topic-rename', autocomplete: 'off' });
      title.oninput = () => { this.touched.add('title'); };
      const rename = element('button', { type: 'button', textContent: 'Rename' });
      rename.onclick = () => this.submit({ title: title.value }, ['title']);
      const archive = element('button', { type: 'button' });
      archive.onclick = () => this.submit({ archived: !this.topic.archived }, []);
      const row = element('div', { className: 'state-fields' }, element('label', { className: 'field-label' }, 'Title ', title), rename, archive);
      controls.details.append(row);
      controls.managed = { row, title, rename, archive };
      this.mark();
    } else if (!manager && controls.managed) {
      controls.managed.row.remove(); controls.managed = null; this.touched.delete('title');
    }
  }

  // The reader's own note, for a participant: only they say what they do here.
  duty(participant) {
    const controls = this.controls;
    if (participant && this.sendNote && !controls.duty) {
      const note = element('input', { id: 'topic-responsibility', maxLength: NOTE_BYTES, autocomplete: 'off', placeholder: 'What you do in this topic' });
      note.oninput = () => { this.touched.add('duty'); };
      const save = element('button', { type: 'button', id: 'topic-responsibility-save', textContent: 'Save my part' });
      save.onclick = () => this.submitNote();
      const row = element('div', { className: 'state-fields' }, element('label', { className: 'field-label' }, 'You are responsible for ', note), save);
      controls.details.append(row);
      controls.duty = { row, note, save };
      this.mark();
    } else if (!(participant && this.sendNote) && controls.duty) {
      controls.duty.row.remove(); controls.duty = null; this.touched.delete('duty');
    }
  }

  mine() { return this.participants?.find(person => person.actor_id === this.reader) ?? null; }

  // The reader's note goes fenced on the revision the page read. Like a state
  // change, one is out at a time, and the notice says what became of it.
  async submitNote() {
    const duty = this.controls?.duty, mine = this.mine();
    if (!duty || !this.topic || !mine) return;
    const value = duty.note.value, args = JSON.stringify({ note: value });
    if (this.out !== null) { if (args !== this.out) this.show(NOT_SENT); return; }
    if (new TextEncoder().encode(value).length > NOTE_BYTES) { this.show(`A note is at most ${NOTE_BYTES} bytes; shorten it and save again.`); return; }
    const topic = this.topic;
    this.out = args; this.show(null); this.mark();
    let message = null;
    try {
      const receipt = await this.sendNote(topic, value, Number.isSafeInteger(mine.responsibility_revision) ? mine.responsibility_revision : 0);
      const result = receipt?.result;
      if (receipt?.status === 'committed' && result?.topic_id === topic.id && result.actor_id === this.reader) {
        if (this.controls?.duty?.note.value === value) this.touched.delete('duty');
        const participants = this.participants.map(person => person.actor_id === this.reader
          ? { ...person, responsibility: result.note, responsibility_truncated: false, responsibility_revision: result.responsibility_revision } : person);
        if (Number.isSafeInteger(result.version) && result.version > this.topic.version) this.paint({ ...this.topic, version: result.version }, participants);
        else this.paint(this.topic, participants);
      } else if (receipt?.error?.code === 'REVISION_CONFLICT') message = NOTE_CHANGED;
      else message = receipt?.error?.message ?? 'Your note was not confirmed. Refresh to see it as it stands.';
    } catch (error) {
      message = error.message;
    } finally {
      this.out = null; this.mark();
    }
    if (this.topic?.id !== topic.id) return;
    if (message) this.show(message);
    this.refresh();
  }

  // Each untouched field shows the topic as it stands. The note and who it
  // waits on belong to the topic's state, so another chosen state starts both empty.
  follow() {
    const { state, note, waiting, waitingField, managed, duty } = this.controls, topic = this.topic, touched = this.touched;
    if (duty && !touched.has('duty')) duty.note.value = this.mine()?.responsibility ?? '';
    if (!touched.has('state')) state.value = known(topic.state);
    const current = state.value === known(topic.state);
    if (!touched.has('note')) note.value = current ? topic.state_note ?? '' : '';
    if (!touched.has('waiting')) waiting.value = current ? (topic.waiting_on ?? []).join(', ') : '';
    waitingField.hidden = state.value !== 'waiting';
    if (managed) {
      if (!touched.has('title')) managed.title.value = topic.title;
      managed.archive.textContent = topic.archived ? 'Unarchive' : 'Archive';
    }
  }

  show(message) {
    this.notice.textContent = message ?? ''; this.notice.hidden = !message;
  }

  // While a change is out, the buttons say they are unavailable. They are not
  // disabled, so the one pressed keeps its focus.
  mark() {
    const { save, managed, duty } = this.controls ?? {};
    for (const button of [save, managed?.rename, managed?.archive, duty?.save]) {
      if (!button) continue;
      if (this.out !== null) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled');
    }
  }

  // fields: the touched fields this change saves. Once it commits, each that
  // still holds what was sent follows the data again. Another change pressed
  // while one is out is not sent, and the notice says so; the same change
  // pressed twice is the one already on its way.
  async submit(args, fields) {
    if (!this.topic) return;
    if (this.out !== null) { if (JSON.stringify(args) !== this.out) this.show(NOT_SENT); return; }
    const topic = this.topic, field = name => name === 'title' ? this.controls?.managed?.title : this.controls?.[name];
    const sent = fields.map(name => [name, field(name)?.value]);
    this.out = JSON.stringify(args); this.show(null); this.mark();
    let message = null;
    try {
      const receipt = await this.send(topic, args);
      if (receipt?.status === 'committed') {
        for (const [name, value] of sent) if (field(name)?.value === value) this.touched.delete(name);
        this.advance(receipt.result);
        // Fresh data newer than this answer may already be painted; the
        // fields this change saved follow it.
        if (this.controls) this.follow();
      } else if (receipt?.error?.code === 'REVISION_CONFLICT') message = CHANGED;
      else message = receipt?.error?.message ?? 'The change was not confirmed. Refresh to see where the topic stands.';
    } catch (error) {
      message = error.message;
    } finally {
      this.out = null; this.mark();
    }
    if (this.topic?.id !== topic.id) return;
    if (message) this.show(message);
    this.refresh();
  }

  // Core's answer to a committed change is the topic as it now stands: paint
  // it, so the next change sends the version this one made.
  advance(result) {
    if (result?.topic_id !== this.topic?.id || !Number.isSafeInteger(result.version)) return;
    const { version, title, archived, state, note, waiting_on, state_by, state_ms } = result;
    // The answer says what was said; the open asks are as the page last read them.
    this.paint({ ...this.topic, version, title, archived, state, state_note: note, waiting_on, state_by, state_ms });
  }

  hide() {
    this.host.hidden = true; this.host.replaceChildren(); this.topic = null; this.controls = null; this.touched.clear(); this.show(null);
  }
}

// The topics that wait on the reader, newest first: said to, or asked and not yet answered.
export function paintWaiting(host, answer, open) {
  const items = Array.isArray(answer?.latest_waiting) ? answer.latest_waiting : [];
  const count = Number.isSafeInteger(answer?.waiting_on_me) ? answer.waiting_on_me : 0;
  if (!count) { host.hidden = true; host.replaceChildren(); return; }
  const list = element('ul', { className: 'waiting-list' }, ...items.map(item => {
    const link = element('a', { href: '?topic=' + encodeURIComponent(item.id), textContent: item.title + (item.title_truncated ? '…' : '') });
    link.onclick = event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); open(item.id, item.title);
    };
    const ask = item.ask && typeof item.ask.by === 'string' ? [`${item.ask.by} asked you`, ...at(', since ', item.ask.since_ms)] : [];
    const said = item.said === false ? [] : joined([item.note ? [item.note] : [], item.state_by ? [item.state_by, ...at(', ', item.state_ms)] : []], ' — ');
    const detail = joined([said, ask], ' · ');
    return element('li', {}, link, ...(detail.length ? [element('span', { className: 'muted' }, ' ', ...detail)] : []));
  }));
  host.replaceChildren(element('h2', { textContent: count > items.length ? `Waiting on you (${count}, newest ${items.length} shown)` : `Waiting on you (${count})` }), list);
  host.hidden = false;
}
