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
  if (answer.disabled) {
    chip.append(element('span', { className: 'reach', textContent: ' · switched off' }));
    chip.title = `${name} is switched off, so a message to them is refused.`;
    return;
  }
  chip.append(element('span', { className: 'reach', textContent: ' · not in this topic' }));
  chip.title = answer.add ? `A message to ${name} is refused until they are in this topic.`
    : `A message to ${name} is refused until they are in this topic. Its creator or the outcome's owner can add them.`;
  if (!answer.add) return;
  const add = element('button', { type: 'button', textContent: 'Add to topic (gets all its messages)' });
  const said = element('span', { className: 'reach-notice', hidden: true });
  said.setAttribute('role', 'status');
  // The add belongs to the person, not to this chip: a chip rebuilt while it
  // is out shows it still out and says how it ended. While out the button
  // says so rather than being disabled, which would drop the focus it holds.
  const offer = offerFor(reach, answer.scope, name);
  offer.views.add({ add, said });
  offer.paint();
  add.onclick = async () => {
    if (offer.out) return;
    offer.out = true; offer.paint();
    let receipt;
    try { receipt = await answer.add(); } catch (error) { receipt = { error }; }
    offer.out = false;
    offer.notice = receipt?.status === 'committed' ? '' : ` · ${receipt?.error?.message ?? `Adding ${name} was not confirmed.`}`;
    offer.paint();
  };
  chip.append(add, said);
}

const offers = new WeakMap();
function offerFor(reach, scope, name) {
  let byName = offers.get(reach);
  if (!byName) offers.set(reach, byName = new Map());
  const key = JSON.stringify([scope ?? null, name]);
  let offer = byName.get(key);
  if (!offer) byName.set(key, offer = { out: false, notice: '', views: new Set(), paint() {
    for (const view of this.views) {
      if (view.add.isConnected === false) { this.views.delete(view); continue; }
      if (this.out) view.add.setAttribute('aria-disabled', 'true'); else view.add.removeAttribute('aria-disabled');
      Object.assign(view.said, { textContent: this.notice, hidden: !this.notice });
    }
  } });
  return offer;
}

// A composer's recipient chips, each built with dataset.name, replace those in
// host. A chip's button that held focus hands it to the same button on that
// person's new chip, or to field when there is none (an add took them into the
// topic, or they were removed), so focus stays in the writing.
export function replaceChips(host, field, chips) {
  const at = document.activeElement;
  const held = [...host.children].find(chip => [...chip.children].includes(at))?.dataset.name;
  host.replaceChildren(...chips);
  if (held === undefined) return;
  const next = chips.find(chip => chip.dataset.name === held);
  ([...next?.children ?? []].find(node => node.textContent === at.textContent) ?? field).focus();
}

// The people in a team or a topic, with a field to add someone and a remove
// button on each, for a reader who may change them. fixed names those no one
// can remove here (an outcome's owner). add and remove return the command's
// receipt; a refusal is shown beside the field. The field is built once and
// never replaced or disabled, so a repaint from someone else's change leaves
// the person typing in it where they were.
export class PeoplePanel {
  constructor({ host, label, names, fixed = () => [] , add, remove }) {
    Object.assign(this, { host, label, names, fixed, add, remove });
    this.busy = false; this.error = ''; this.people = []; this.manage = false; this.removers = new Map();
    this.chips = element('div', { className: 'chips' });
    this.input = element('input', { autocomplete: 'off', placeholder: 'Add a name' });
    this.input.setAttribute('list', names); this.input.setAttribute('aria-label', label);
    this.button = element('button', { type: 'button', textContent: 'Add' });
    // An added name leaves the field only if the field still holds it; a name
    // typed while the add was out is the person's next one.
    const go = () => {
      const typed = this.input.value, id = typed.trim().replace(/^@/, '');
      if (id) return this.submit(() => this.add(id), () => { if (this.input.value === typed) this.input.value = ''; });
    };
    this.button.onclick = go;
    this.input.onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); if (!event.repeat) go(); } };
    this.row = element('div', { className: 'people-add' }, this.input, this.button);
    this.notice = element('p', { className: 'notice', hidden: true });
    this.notice.setAttribute('role', 'status');
    host.replaceChildren(this.chips, this.row, this.notice);
  }

  paint(people = this.people, manage = this.manage) {
    this.people = people; this.manage = manage;
    const fixed = new Set(this.fixed());
    // A repaint replaces the remove buttons; one that held focus hands it to
    // the same person's new button, or to the field when they have gone.
    const held = [...this.removers].find(([, out]) => out === document.activeElement)?.[0];
    this.removers = new Map();
    this.chips.replaceChildren(...people.map(person => {
      const chip = element('span', { className: 'chip', textContent: person.actor_id });
      if (manage && !fixed.has(person.actor_id)) {
        const out = element('button', { type: 'button', textContent: '×', disabled: this.busy });
        out.setAttribute('aria-label', `Remove ${person.actor_id}`);
        // The chip goes with its person; the field keeps the reader's place.
        out.onclick = () => { this.input.focus(); return this.submit(() => this.remove(person.actor_id), () => {}, () => this.input.focus()); };
        this.removers.set(person.actor_id, out);
        chip.append(out);
      }
      return chip;
    }));
    if (held !== undefined && manage) (this.removers.get(held) ?? this.input).focus();
    this.row.hidden = !manage;
    this.button.disabled = this.busy;
    this.notice.textContent = this.error; this.notice.hidden = !this.error;
    this.host.hidden = false;
  }

  async submit(action, committed = () => {}, settled = () => {}) {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.paint();
    try {
      const receipt = await action();
      if (receipt?.status === 'committed') committed();
      else this.error = receipt?.error?.message ?? 'The change was not confirmed. Refresh to see who is here.';
    } catch (error) {
      this.error = error.message;
    } finally {
      this.busy = false; this.paint(); settled();
    }
  }
}
