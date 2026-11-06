// Where a topic stands, as its participants say: a row mark in topic lists, a
// line under the topic's title with a form to change it, and the topics that
// wait on the reader. Core keeps every value; nothing here decides one.

export const STATES = ['active', 'waiting', 'review', 'done'];
const LABELS = { active: 'Active', waiting: 'Waiting', review: 'Ready for review', done: 'Done' };

const named = (id, reader) => id === reader ? 'you' : id;

// "7:41 AM Thu Nov 5", in the reader's own time zone.
export function readableTime(ms) {
  const when = new Date(ms);
  const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  return `${time} ${day}`;
}

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

// "fable asked you, since 7:41 AM Thu Nov 5": how long each open ask has waited.
export function askLines(item, reader) {
  return asksOf(item).map(ask => `${named(ask.by, reader)} asked ${ask.actor_id === reader ? 'you' : ask.actor_id}` +
    (Number.isSafeInteger(ask.since_ms) ? `, since ${readableTime(ask.since_ms)}` : ''));
}

// Whether work is observed on a topic, by the server's one rule (aim_next/work.py),
// in words. It never says nobody is working: only when activity was last seen.
// A waiting topic's words are its pill's ("Waiting on you"), passed as
// waiting; without them it waits on someone the page cannot name.
export function workNote(work, reader, waiting = '') {
  if (!work || typeof work !== 'object') return '';
  const when = Number.isSafeInteger(work.seen_ms) ? readableTime(work.seen_ms) : null;
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
const names = value => [...new Set(value.split(',').map(name => name.trim()).filter(Boolean))];
const known = state => STATES.includes(state) ? state : 'active';
const CHANGED = 'This topic changed while you were choosing. What you chose is kept here: check it against the line above and save again.';
const NOT_SENT = 'That was not sent: another change was still being saved. Press it again.';

// The line under a topic's title, and a form for those who may change it:
// participants say where it stands; the outcome's owner and the topic's
// creator also rename and archive it.
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
  constructor({ host, reader, send, refresh = () => {} }) {
    Object.assign(this, { host, reader, send, refresh });
    this.topic = null; this.out = null; this.controls = null; this.touched = new Set();
    this.line = element('p', { className: 'state-line' });
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
    const mark = element('strong', { className: 'topic-state', textContent: stateLabel(topic, reader), title: stateLabel(topic, reader) });
    mark.dataset.state = waitsOn(topic).length ? 'waiting' : topic.state ?? 'active';
    if (waitsOn(topic).includes(reader)) mark.classList.add('mine');
    const line = [mark];
    if (topic.state_note) line.push(' · ', element('span', { className: 'state-note', textContent: topic.state_note }));
    if (topic.state_by) line.push(element('span', { className: 'muted', textContent:
      ` — ${named(topic.state_by, reader)}${Number.isSafeInteger(topic.state_ms) ? ', ' + readableTime(topic.state_ms) : ''}` }));
    for (const ask of askLines(topic, reader)) line.push(element('span', { className: 'muted ask-line', textContent: ` · ${ask}` }));
    if (topic.archived) line.push(element('span', { className: 'muted', textContent: ' · Archived' }));
    this.line.replaceChildren(...line);
    if (!(manager || participant)) this.drop();
    else {
      if (!this.controls) this.host.insertBefore(this.build(), this.notice);
      this.manage(manager); this.follow();
    }
    this.host.hidden = false;
  }

  reset() {
    this.controls = null; this.touched.clear(); this.show(null);
    this.host.replaceChildren(this.line, this.notice);
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

  // Each untouched field shows the topic as it stands. The note and who it
  // waits on belong to the topic's state, so another chosen state starts both empty.
  follow() {
    const { state, note, waiting, waitingField, managed } = this.controls, topic = this.topic, touched = this.touched;
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
    const { save, managed } = this.controls ?? {};
    for (const button of [save, managed?.rename, managed?.archive]) {
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
    const ask = item.ask && typeof item.ask.by === 'string'
      ? `${item.ask.by} asked you${Number.isSafeInteger(item.ask.since_ms) ? ', since ' + readableTime(item.ask.since_ms) : ''}` : '';
    const said = item.said === false ? '' : [item.note, item.state_by ? `${item.state_by}${Number.isSafeInteger(item.state_ms) ? ', ' + readableTime(item.state_ms) : ''}` : ''].filter(Boolean).join(' — ');
    const detail = [said, ask].filter(Boolean).join(' · ');
    return element('li', {}, link, ...(detail ? [element('span', { className: 'muted', textContent: ' ' + detail })] : []));
  }));
  host.replaceChildren(element('h2', { textContent: count > items.length ? `Waiting on you (${count}, newest ${items.length} shown)` : `Waiting on you (${count})` }), list);
  host.hidden = false;
}
