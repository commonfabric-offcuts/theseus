import { checkedView } from './freshness.mjs';

// Who can be named. Two lists feed every input that names someone, as a
// datalist the browser offers while the person types: the instance's
// directory, for teams and participants, and those who can receive a message
// in the open topic, for the composer. Core decides what a name may do; these
// lists only save typing.

const PAGE = 100;

// Every enabled person and agent, up to pages * PAGE of them; more says the
// directory went on past what was read.
export async function readDirectory(api, instanceId, { pages = 10 } = {}) {
  const items = [];
  let cursor = null;
  for (let n = 0; n < pages; n++) {
    const answer = checkedView(await api.view('actors', { limit: PAGE, ...(cursor === null ? {} : { cursor }) }, { readClass: 'background' }), instanceId);
    for (const item of answer.items) items.push(item);
    cursor = answer.next_cursor;
    if (cursor === null) break;
  }
  return { items, more: cursor !== null };
}

// Every member of an outcome; the team limit keeps this to a few pages.
export async function readMembers(api, instanceId, workspaceId) {
  const items = [];
  let cursor = null;
  do {
    const answer = checkedView(await api.view('workspace_members', { workspace_id: workspaceId, limit: PAGE, ...(cursor === null ? {} : { cursor }) }, { readClass: 'background' }), instanceId);
    for (const item of answer.items) items.push(item);
    cursor = answer.next_cursor;
  } while (cursor !== null);
  return items;
}

// people: [{ id, name?, kind? }]. Each becomes an option whose value is the id
// an input needs and whose label says who it is.
export function fillNames(list, people) {
  const seen = new Set(), options = [];
  for (const person of people) {
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    const option = document.createElement('option');
    option.value = person.id;
    const label = [person.name && person.name !== person.id ? person.name : '', person.kind ?? ''].filter(Boolean).join(' · ');
    if (label) option.label = label;
    options.push(option);
  }
  list.replaceChildren();
  for (const option of options) list.append(option);
}

const element = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children); return node;
};

// A recipient who cannot see the topic would make the whole send refused.
// reach(name) answers { reachable, add }: the chip says when they are not in
// the topic, and add, given to a reader who may change its participants,
// offers to make them one, which also sends them every later message.
export function markReach(chip, name, reach) {
  const answer = reach?.(name);
  if (!answer || answer.reachable) return;
  chip.classList.add('unreachable');
  chip.append(element('span', { className: 'reach', textContent: ' · not in this topic' }));
  chip.title = answer.add ? `A message to ${name} is refused until they are in this topic.`
    : `A message to ${name} is refused until they are in this topic. Its creator or the outcome's owner can add them.`;
  if (!answer.add) return;
  const add = element('button', { type: 'button', textContent: 'Add to topic (gets all its messages)' });
  add.onclick = async () => {
    add.disabled = true;
    try { await answer.add(); } finally { add.disabled = false; }
  };
  chip.append(add);
}

// The people in a team or a topic, with a field to add someone and a remove
// button on each, for a reader who may change them. fixed names those no one
// can remove here (an outcome's owner). add and remove return the command's
// receipt; a refusal is shown beside the field.
export class PeoplePanel {
  constructor({ host, label, names, fixed = () => [] , add, remove }) {
    Object.assign(this, { host, label, names, fixed, add, remove });
    this.busy = false; this.error = ''; this.people = []; this.manage = false; this.draft = '';
  }

  paint(people = this.people, manage = this.manage) {
    this.people = people; this.manage = manage;
    const fixed = new Set(this.fixed());
    const chips = element('div', { className: 'chips' }, ...people.map(person => {
      const chip = element('span', { className: 'chip', textContent: person.actor_id });
      if (manage && !fixed.has(person.actor_id)) {
        const out = element('button', { type: 'button', textContent: '×', disabled: this.busy });
        out.setAttribute('aria-label', `Remove ${person.actor_id}`);
        out.onclick = () => this.submit(() => this.remove(person.actor_id));
        chip.append(out);
      }
      return chip;
    }));
    const nodes = [chips];
    if (manage) {
      // The typed name outlives a repaint, and is cleared only once added.
      const input = element('input', { autocomplete: 'off', placeholder: 'Add a name', disabled: this.busy, value: this.draft });
      input.setAttribute('list', this.names); input.setAttribute('aria-label', this.label);
      input.oninput = () => { this.draft = input.value; };
      const go = () => {
        const id = this.draft.trim().replace(/^@/, '');
        if (id) return this.submit(() => this.add(id), () => { this.draft = ''; });
      };
      const button = element('button', { type: 'button', textContent: 'Add', disabled: this.busy });
      button.onclick = go;
      input.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); if (!event.repeat) go(); } };
      nodes.push(element('div', { className: 'people-add' }, input, button));
    }
    if (this.error) { const notice = element('p', { className: 'notice', textContent: this.error }); notice.setAttribute('role', 'status'); nodes.push(notice); }
    this.host.replaceChildren(...nodes);
    this.host.hidden = false;
  }

  async submit(action, committed = () => {}) {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.paint();
    try {
      const receipt = await action();
      if (receipt?.status === 'committed') committed();
      else this.error = receipt?.error?.message ?? 'The change was not confirmed. Refresh to see who is here.';
    } catch (error) {
      this.error = error.message;
    } finally {
      this.busy = false; this.paint();
    }
  }
}
