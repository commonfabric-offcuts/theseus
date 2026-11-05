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

export function stateLabel(item, reader) {
  const state = STATES.includes(item?.state) ? item.state : 'active';
  const waiting = Array.isArray(item?.waiting_on) ? item.waiting_on : [];
  return state === 'waiting' && waiting.length ? `Waiting on ${waiting.map(id => named(id, reader)).join(', ')}` : LABELS[state];
}

// A row in a topic list says where its topic stands unless it is simply active.
// The caller has just set the row's text, so the row holds no earlier mark.
export function paintState(host, item, reader) {
  if (!STATES.includes(item?.state) || item.state === 'active') return;
  const mark = document.createElement('span');
  mark.className = 'topic-state'; mark.dataset.state = item.state;
  if (item.state === 'waiting' && item.waiting_on?.includes(reader)) mark.classList.add('mine');
  mark.textContent = stateLabel(item, reader);
  if (typeof item.state_note === 'string' && item.state_note) mark.title = item.state_note;
  host.append(mark);
}

const element = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children); return node;
};
const names = value => [...new Set(value.split(',').map(name => name.trim()).filter(Boolean))];
const known = state => STATES.includes(state) ? state : 'active';
const CHANGED = 'This topic changed while you were choosing. What you chose is kept here: check it against the line above and save again.';

// The line under a topic's title, and a form for those who may change it:
// participants say where it stands; the outcome's owner and the topic's
// creator also rename and archive it.
//
// The form is built once per topic and kept across repaints, so focus and
// whatever the person has typed survive fresh data. A field the person has
// not touched shows the data; one they have touched keeps their value until
// it is saved. A new state starts with an empty note and nobody waited on,
// as in Core, unless the person typed them.
export class TopicStatePanel {
  // refresh asks the page for fresh topic data; it is called after every answer
  // to a change, so a refusal for a stale version is followed by the news.
  constructor({ host, reader, send, refresh = () => {} }) {
    Object.assign(this, { host, reader, send, refresh });
    this.topic = null; this.busy = false; this.error = null; this.controls = null; this.touched = new Set();
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
    const mark = element('strong', { className: 'topic-state', textContent: stateLabel(topic, reader) });
    mark.dataset.state = topic.state ?? 'active';
    const line = [mark];
    if (topic.state_note) line.push(' · ', element('span', { className: 'state-note', textContent: topic.state_note }));
    if (topic.state_by) line.push(element('span', { className: 'muted', textContent:
      ` — ${named(topic.state_by, reader)}${Number.isSafeInteger(topic.state_ms) ? ', ' + readableTime(topic.state_ms) : ''}` }));
    if (topic.archived) line.push(element('span', { className: 'muted', textContent: ' · Archived' }));
    this.line.replaceChildren(...line);
    if (!(manager || participant)) this.drop();
    else {
      if (!this.controls) this.host.insertBefore(this.build(), this.notice);
      this.manage(manager); this.follow();
    }
    // A notice is about an attempt on the version it was made on.
    if (this.error && topic.version > this.error.version) this.show(null);
    this.host.hidden = false;
  }

  reset() {
    this.controls = null; this.touched.clear(); this.show(null);
    this.host.replaceChildren(this.line, this.notice);
  }

  drop() {
    this.controls?.details.remove(); this.controls = null; this.touched.clear();
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
    this.controls = { details, state, note, waiting, waitingField, managed: null };
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
      controls.managed = { row, title, archive };
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

  show(error) {
    this.error = error;
    this.notice.textContent = error?.message ?? ''; this.notice.hidden = !error;
  }

  // fields: the touched fields this change saves. Once it commits, each that
  // still holds what was sent follows the data again.
  async submit(args, fields) {
    if (this.busy || !this.topic) return;
    const topic = this.topic, field = name => name === 'title' ? this.controls?.managed?.title : this.controls?.[name];
    const sent = fields.map(name => [name, field(name)?.value]);
    this.busy = true; this.show(null);
    let message = null;
    try {
      const receipt = await this.send(topic, args);
      if (receipt?.status === 'committed') {
        for (const [name, value] of sent) if (field(name)?.value === value) this.touched.delete(name);
        this.advance(receipt.result);
      } else if (receipt?.error?.code === 'REVISION_CONFLICT') message = CHANGED;
      else message = receipt?.error?.message ?? 'The change was not confirmed. Refresh to see where the topic stands.';
    } catch (error) {
      message = error.message;
    } finally {
      this.busy = false;
    }
    if (this.topic?.id !== topic.id) return;
    if (message) this.show({ message, version: this.topic.version });
    this.refresh();
  }

  // Core's answer to a committed change is the topic as it now stands: paint
  // it, so the next change sends the version this one made.
  advance(result) {
    if (result?.topic_id !== this.topic?.id || !Number.isSafeInteger(result.version)) return;
    const { version, title, archived, state, note, waiting_on, state_by, state_ms } = result;
    this.paint({ ...this.topic, version, title, archived, state, state_note: note, waiting_on, state_by, state_ms });
  }

  hide() {
    this.host.hidden = true; this.host.replaceChildren(); this.topic = null; this.controls = null; this.touched.clear(); this.show(null);
  }
}

// The topics that say they wait on the reader, newest first.
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
    const detail = [item.note, item.state_by ? `${item.state_by}${Number.isSafeInteger(item.state_ms) ? ', ' + readableTime(item.state_ms) : ''}` : ''].filter(Boolean).join(' — ');
    return element('li', {}, link, ...(detail ? [element('span', { className: 'muted', textContent: ' ' + detail })] : []));
  }));
  host.replaceChildren(element('h2', { textContent: count > items.length ? `Waiting on you (${count}, newest ${items.length} shown)` : `Waiting on you (${count})` }), list);
  host.hidden = false;
}
