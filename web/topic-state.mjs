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

// The line under a topic's title, and a form for those who may change it:
// participants say where it stands; the outcome's owner and the topic's
// creator also rename and archive it.
export class TopicStatePanel {
  constructor({ host, reader, send, saved = () => {} }) {
    Object.assign(this, { host, reader, send, saved });
    this.topic = null; this.busy = false; this.open = false;
  }

  paint(topic, participants = this.participants ?? []) {
    this.topic = topic; this.participants = participants;
    const reader = this.reader, manager = [topic.owner_id, topic.creator_id].includes(reader);
    const participant = participants.some(person => person.actor_id === reader);
    const line = element('p', { className: 'state-line' }, element('strong', { className: 'topic-state', textContent: stateLabel(topic, reader) }));
    line.querySelector('strong').dataset.state = topic.state ?? 'active';
    if (topic.state_note) line.append(' · ', element('span', { className: 'state-note', textContent: topic.state_note }));
    if (topic.state_by) line.append(element('span', { className: 'muted', textContent:
      ` — ${named(topic.state_by, reader)}${Number.isSafeInteger(topic.state_ms) ? ', ' + readableTime(topic.state_ms) : ''}` }));
    if (topic.archived) line.append(element('span', { className: 'muted', textContent: ' · Archived' }));
    const nodes = [line];
    if (manager || participant) nodes.push(this.form(topic, manager));
    if (this.error) { const notice = element('p', { className: 'notice', textContent: this.error }); notice.setAttribute('role', 'status'); nodes.push(notice); }
    this.host.replaceChildren(...nodes);
    this.host.hidden = false;
  }

  form(topic, manager) {
    const details = element('details', { className: 'state-form' }, element('summary', { textContent: 'Change where it stands' }));
    details.open = this.open; details.ontoggle = () => { this.open = details.open; };
    const state = element('select', { id: 'topic-state-choice' }, ...STATES.map(value => element('option', { value, textContent: LABELS[value] })));
    state.value = STATES.includes(topic.state) ? topic.state : 'active';
    const note = element('input', { id: 'topic-state-note', value: topic.state_note ?? '', maxLength: 1024, autocomplete: 'off' });
    const waiting = element('input', { id: 'topic-state-waiting', value: (topic.waiting_on ?? []).join(', '), autocomplete: 'off', placeholder: 'Names, separated by commas' });
    const waitingField = element('label', { className: 'field-label' }, 'Waiting on ', waiting);
    const shown = () => { waitingField.hidden = state.value !== 'waiting'; };
    state.onchange = shown; shown();
    const save = element('button', { type: 'button', className: 'primary', textContent: 'Save' });
    save.onclick = () => this.submit({ state: state.value, note: note.value, ...(state.value === 'waiting' ? { waiting_on: names(waiting.value) } : {}) });
    details.append(element('div', { className: 'state-fields' },
      element('label', { className: 'field-label' }, 'State ', state),
      element('label', { className: 'field-label' }, 'Note ', note), waitingField, save));
    if (manager) {
      const title = element('input', { id: 'topic-rename', value: topic.title, autocomplete: 'off' });
      const rename = element('button', { type: 'button', textContent: 'Rename' });
      rename.onclick = () => this.submit({ title: title.value });
      const archive = element('button', { type: 'button', textContent: topic.archived ? 'Unarchive' : 'Archive' });
      archive.onclick = () => this.submit({ archived: !topic.archived });
      details.append(element('div', { className: 'state-fields' }, element('label', { className: 'field-label' }, 'Title ', title), rename, archive));
    }
    return details;
  }

  async submit(args) {
    if (this.busy || !this.topic) return;
    this.busy = true; this.error = '';
    try {
      const receipt = await this.send(this.topic, args);
      if (receipt?.status !== 'committed') this.error = receipt?.error?.message ?? 'The change was not confirmed. Refresh to see where the topic stands.';
      else this.saved(receipt.result);
    } catch (error) {
      this.error = error.message;
    } finally {
      this.busy = false;
      if (this.error) this.paint(this.topic);
    }
  }

  hide() { this.host.hidden = true; this.host.replaceChildren(); this.topic = null; }
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
