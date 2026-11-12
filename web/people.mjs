import { checkedView } from './freshness.mjs';

// Who can be named. Two lists feed every input that names someone, as a
// datalist the browser offers while the person types: the instance's
// directory, for teams and participants, and those who can receive a message
// in the open topic, for the composer. Core decides what a name may do; these
// lists only save typing.

const PAGE = 100;

// Names are presentation; membership and addressing still use the stable ID.
const actorName = person => person.name || person.id || person.actor_id;
const actorId = person => person.id ?? person.actor_id;
const folded = value => String(value ?? '').toLowerCase();
function distinctName(person, people) {
  const name = actorName(person), id = actorId(person);
  return people.some(other => other && actorId(other) !== id && folded(actorName(other)) === folded(name))
    ? `${name} (${id})` : name;
}

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
// offers to make them one, which also sends them every later message. answer
// is reach(name), when the caller has already asked.
export function markReach(chip, name, reach, answer = reach?.(name)) {
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
  const offer = offerFor(reach, answer.scope, name), view = { add, said };
  offer.views.add(view);
  chip.leave = () => offer.leave(view);
  offer.paint();
  add.onclick = async () => {
    if (offer.out) return;
    offer.out = true; offer.paint();
    let receipt;
    try { receipt = await answer.add(); } catch (error) { receipt = { error }; }
    offer.out = false;
    offer.notice = receipt?.status === 'committed' ? '' : ` · ${receipt?.error?.message ?? `Adding ${name} was not confirmed.`}`;
    offer.paint(); offer.leave();
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
      if (this.out) view.add.setAttribute('aria-disabled', 'true'); else view.add.removeAttribute('aria-disabled');
      Object.assign(view.said, { textContent: this.notice, hidden: !this.notice });
    }
  // A chip leaves when replaceChips takes it off the page; a person with no
  // chip left and no add out is forgotten, so their next chip starts afresh.
  }, leave(view) {
    this.views.delete(view);
    if (!this.out && !this.views.size) byName.delete(key);
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
  for (const chip of [...host.children]) if (!chips.includes(chip)) chip.leave?.();
  host.replaceChildren(...chips);
  if (held === undefined) return;
  const next = chips.find(chip => chip.dataset.name === held);
  ([...next?.children ?? []].find(node => node.textContent === at.textContent) ?? field).focus();
}

// chips, in order, become host's children. A chip already there stays the same
// node and is not moved unless the order changed, so a press held on it while
// a repaint runs still clicks, and the focus it holds stays; those not wanted
// leave the page.
function placeChips(host, chips) {
  for (const chip of [...host.children]) if (!chips.includes(chip)) { chip.leave?.(); chip.remove(); }
  chips.forEach((chip, index) => { if (host.children[index] !== chip) host.insertBefore(chip, host.children[index] ?? null); });
}

// Who a message is to. The topic's people are names tapped once: aria-pressed
// says who it is to, and a second tap takes them off. Anyone else it names
// (typed in the small field beside them) follows with a × to take them off.
// A repaint keeps each person's chip while what it shows is the same, so a
// press held across a commit's repaint is not lost. A chip that held the focus
// and was drawn afresh hands it to the same person's new chip, or to field
// when there is none.
//
// summary, when given ({ host, opener }), is the first step of naming on a
// phone (docs/reader.md): everyone named, each with only a ×, and opener
// (+ Someone) for the rest. It never lists anyone not named, so it is the
// same size however big the team.
export function paintAddress(host, field, { people, named, toggle, remove, reach, summary = null }) {
  const at = document.activeElement, holder = [...host.children].find(chip => chip === at || [...chip.children ?? []].includes(at));
  const held = holder ? { name: holder.dataset.name, inner: holder !== at ? at.textContent : null } : null;
  const was = new Map([...host.children].map(chip => [chip.dataset.name, chip]));
  // The chip shown for name as key describes it, the one there if it shows the same.
  const kept = (name, key, build) => {
    const chip = was.get(name);
    if (chip?.addressKey === key) return chip;
    const fresh = build(); fresh.dataset.name = name; fresh.addressKey = key; return fresh;
  };
  const offered = people.filter((id, index) => people.indexOf(id) === index);
  const chips = offered.map(id => {
    const chip = kept(id, 'choice', () => element('button', { type: 'button', className: 'choice-chip', textContent: id }));
    chip.setAttribute('aria-pressed', named.includes(id) ? 'true' : 'false');
    chip.onclick = () => toggle(id, !named.includes(id));
    return chip;
  });
  const answers = new Map();
  for (const name of named.filter(id => !offered.includes(id))) {
    const answer = reach?.(name); answers.set(name, answer);
    const key = JSON.stringify(['named', answer ? [answer.reachable === true, answer.disabled === true, Boolean(answer.add), answer.scope ?? null] : null]);
    const chip = kept(name, key, () => {
      const fresh = element('span', { className: 'chip', textContent: name }), out = element('button', { type: 'button', textContent: '×' });
      out.setAttribute('aria-label', `Remove ${name}`); fresh.out = out;
      fresh.append(out); markReach(fresh, name, reach, answer); return fresh;
    });
    chip.out.onclick = () => remove(name);
    chips.push(chip);
  }
  placeChips(host, chips);
  if (summary) paintNamed(summary, named, remove, answers);
  if (!held) return;
  const next = chips.find(chip => chip.dataset.name === held.name);
  // The same button on the new chip (its words say which), or the chip itself.
  const inner = held.inner === null ? next : [...next?.children ?? []].find(node => node.textContent === held.inner);
  (inner ?? field).focus();
}

// Everyone named, each a chip with its ×; one not in the topic is marked so
// (its offer to add them is in the naming sheet). A chip is kept while it
// shows the same, so a press held across a repaint still clicks, and a ×
// that held the focus as its chip went hands it to opener.
function paintNamed({ host, opener }, named, remove, answers) {
  const held = [...host.children].some(chip => chip.contains(document.activeElement));
  const was = new Map([...host.children].map(chip => [chip.dataset.name, chip]));
  const chips = [...new Set(named)].map(name => {
    const answer = answers.get(name), away = Boolean(answer && !answer.reachable);
    let chip = was.get(name);
    if (chip?.away !== away) {
      chip = element('span', { className: away ? 'chip unreachable' : 'chip', textContent: name });
      const out = element('button', { type: 'button', textContent: '×' });
      out.setAttribute('aria-label', `Remove ${name}`);
      if (away) chip.title = `${name} is not in this topic, so a message to them is refused. + Someone says more.`;
      chip.append(out); Object.assign(chip, { out, away }); chip.dataset.name = name;
    }
    chip.out.onclick = () => remove(name);
    return chip;
  });
  placeChips(host, chips);
  if (held && !chips.some(chip => chip.contains(document.activeElement))) opener.focus();
}

// The people in a team or a topic, for a reader who may change them: each a
// pill with a remove button, then "+ Add", which opens the people not yet in
// (candidates()) as names tapped once to add, with a small filter that narrows
// them; Return adds the person whose id was typed (any case, an @ before it
// or not), or the words as typed, never someone else the filter happens to
// leave, and an empty Return adds nobody. fixed names those no one can remove
// here (an outcome's owner). add and remove return the command's receipt; a refusal is
// shown in plain words beside them, and the filter keeps what was typed. The
// filter is built once and never replaced or disabled, so a repaint from
// someone else's change leaves the person typing in it where they were, and a
// repaint keeps every chip whose person and look are the same, so a press held
// across a commit's repaint still clicks.
//
// pill(person), when given, makes each person one pill filled with the class
// it returns (their colour, or own-pill for the reader), holding the name and,
// for a reader who may manage, the remove button after it.
export class PeoplePanel {
  // read, when given, answers who is here now, read again once when a change
  // is not confirmed, so the panel says what it found.
  constructor({ host, label, fixed = () => [] , add, remove, named = () => null, light = () => null, pill = null, read = null, candidates = () => [], opened = () => {} }) {
    Object.assign(this, { host, label, fixed, add, remove, named, light, pill, read, candidates, opened });
    this.busy = false; this.error = ''; this.people = []; this.manage = false; this.pills = new Map(); this.removers = new Map(); this.namers = new Map();
    this.chips = element('div', { className: 'chips' });
    this.opener = element('button', { type: 'button', className: 'choice-chip add-chip', textContent: '+ Add' });
    this.opener.setAttribute('aria-expanded', 'false'); this.opener.title = label;
    this.opener.onclick = () => this.toggle();
    this.input = element('input', { type: 'text', autocomplete: 'off', placeholder: 'Find a name', enterKeyHint: 'done' });
    this.input.setAttribute('aria-label', 'Find someone to add');
    this.choices = element('div', { className: 'state-chips people-chips' });
    this.choices.setAttribute('role', 'group'); this.choices.setAttribute('aria-label', 'People who can be added');
    // An added name leaves the field only if the field still holds it; a name
    // typed while the add was out is the person's next one.
    const go = () => {
      const typed = this.input.value, words = typed.trim().replace(/^@/, '');
      const candidates = this.candidates().filter(person => person?.id);
      const exact = candidates.find(person => folded(person.id) === folded(words));
      const names = candidates.filter(person => folded(actorName(person)) === folded(words));
      if (!exact && new Set(names.map(person => person.id)).size > 1) {
        this.error = 'More than one person has that name. Choose their button or type their ID.';
        this.paint(); return;
      }
      const id = exact?.id ?? names[0]?.id ?? words;
      if (id) return this.submit(() => this.add(id), () => { if (this.input.value === typed) this.input.value = ''; this.paintChoices(); });
    };
    this.input.oninput = () => this.paintChoices();
    this.input.onkeydown = event => {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) go(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.toggle(false); }
    };
    this.row = element('div', { className: 'people-add', hidden: true }, this.choices, this.input);
    this.notice = element('p', { className: 'notice', hidden: true });
    this.notice.setAttribute('role', 'status');
    host.replaceChildren(this.chips, this.row, this.notice);
  }

  // open: show or hide the people who can be added; closing gives the focus back to "+ Add".
  toggle(open = this.row.hidden) {
    this.row.hidden = !open; this.opener.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { this.opened(); this.paintChoices(); this.input.focus(); } else this.opener.focus();
  }

  // The people not yet in, narrowed by what the filter holds.
  addable() {
    const here = new Set(this.people.map(person => person.actor_id)), typed = this.input.value.trim().replace(/^@/, '').toLowerCase();
    return this.candidates().filter(person => person?.id && !here.has(person.id) &&
      (!typed || person.id.toLowerCase().includes(typed) || String(person.name ?? '').toLowerCase().includes(typed)));
  }

  paintChoices() {
    if (this.row.hidden) return;
    const addable = this.addable(), typed = Boolean(this.input.value.trim());
    const was = new Map([...this.choices.children].filter(chip => chip.dataset?.id !== undefined).map(chip => [chip.dataset.id, chip]));
    const at = document.activeElement, held = this.choices.contains(at) ? at.dataset?.id : undefined;
    // A name still offered keeps its button, so a press is never lost to a
    // repaint between its down and up; only whether it can be pressed changes.
    const chips = addable.map(person => {
      let chip = was.get(person.id);
      if (!chip) {
        chip = element('button', { type: 'button', className: 'choice-chip' });
        chip.dataset.id = person.id; chip.setAttribute('aria-pressed', 'false');
        chip.onclick = () => this.submit(() => this.add(person.id), () => this.paintChoices(), () => {
          const next = [...this.choices.children][0]; (next ?? this.input).focus();
        });
      }
      const label = distinctName(person, this.candidates());
      if (chip.textContent !== label) chip.textContent = label;
      chip.title = person.name && person.name !== person.id ? person.name : ''; chip.disabled = this.busy;
      return chip;
    });
    if (!addable.length) {
      this.none ??= element('span', { className: 'muted' });
      this.none.textContent = typed ? 'No one by that name yet. Return adds it as typed.' : 'Everyone is already here.';
      chips.push(this.none);
    }
    placeChips(this.choices, chips);
    if (held !== undefined) (chips.find(chip => chip.dataset?.id === held) ?? this.input).focus();
  }

  paint(people = this.people, manage = this.manage) {
    this.people = people; this.manage = manage;
    const fixed = new Set(this.fixed());
    // What each chip shows. A name may be a control of its own (named), such as
    // an agent's color; the light says whether this agent's wakes are getting
    // through, when they are not.
    const shown = people.map(person => ({ id: person.actor_id, label: distinctName(person, people), named: this.named(person, distinctName(person, people)),
      className: this.pill ? ['person-pill', this.pill(person)].filter(Boolean).join(' ') : 'chip',
      light: this.light(person), removable: manage && !fixed.has(person.actor_id) }));
    this.paintChips(shown);
    // "+ Add" stays the same node after the pills, so a repaint never takes its focus.
    if (manage) { if (this.opener.parentNode !== this.chips) this.chips.append(this.opener); }
    else { this.opener.remove(); this.row.hidden = true; this.opener.setAttribute('aria-expanded', 'false'); }
    this.paintChoices();
    this.notice.textContent = this.error; this.notice.hidden = !this.error;
    this.host.hidden = false;
  }

  // A person whose chip would look the same keeps it, as after a commit that
  // changed nothing it shows: a press on a button that a repaint replaced
  // between its down and up would click nothing. Busy only disables the
  // remove buttons. A chip drawn afresh whose remove button held focus hands it
  // to the same person's new button, or to "+ Add" when they have gone.
  paintChips(shown) {
    const at = document.activeElement;
    const held = [...this.removers].find(([, out]) => out === at)?.[0];
    const heldName = [...this.namers].find(([, name]) => name === at)?.[0];
    const was = this.pills;
    this.pills = new Map(); this.removers = new Map(); this.namers = new Map();
    const pills = shown.map(({ id, label, named, className, light, removable }) => {
      const key = JSON.stringify([className, light, removable]);
      let pill = was.get(id);
      if (pill?.key !== key || pill.named !== named) pill = { key, named, chip: this.drawPill(id, named, className, light, removable) };
      if (!named && pill.chip.nameNode.textContent !== label) pill.chip.nameNode.textContent = label;
      pill.out = pill.chip.out;
      if (pill.out) { pill.out.setAttribute('aria-label', `Remove ${label}`); pill.out.disabled = this.busy; this.removers.set(id, pill.out); }
      if (named) this.namers.set(id, named);
      this.pills.set(id, pill);
      return pill.chip;
    });
    // "+ Add", when shown, stays after the pills, the same node.
    placeChips(this.chips, this.opener.parentNode === this.chips ? [...pills, this.opener] : pills);
    if (held !== undefined && this.manage) (this.removers.get(held) ?? this.opener).focus();
    else if (heldName !== undefined) this.namers.get(heldName)?.focus();
  }

  drawPill(id, named, className, light, removable) {
    const nameNode = named ?? element('span', { ...(this.pill ? { className: 'pill-name' } : {}), textContent: id });
    const chip = element('span', { className }, nameNode);
    chip.nameNode = nameNode;
    if (light) chip.append(element('span', { className: 'wake-light', textContent: ` · ${light}` }));
    if (removable) {
      const out = element('button', { type: 'button', textContent: '×', ...(this.pill ? { className: 'pill-remove' } : {}) });
      out.setAttribute('aria-label', `Remove ${id}`);
      // The chip goes with its person; the focus goes to "+ Add".
      out.onclick = () => { this.opener.focus(); return this.submit(() => this.remove(id), () => {}, () => this.opener.focus()); };
      chip.out = out; chip.append(out);
    }
    return chip;
  }

  // One read of who is here, never a second send. A refusal keeps its own
  // words; an unconfirmed change says who is here now, or that the read failed.
  async readAgain(refusal) {
    let people = null;
    try { people = this.read ? await this.read() : null; } catch { people = null; }
    if (Array.isArray(people)) this.people = people;
    if (refusal) return refusal;
    return people ? `The change was not confirmed. Here now: ${listWords(people.map(actorName))}.`
      : 'The change was not confirmed, and reading who is here again failed too.';
  }

  async submit(action, committed = () => {}, settled = () => {}) {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.paint();
    try {
      let receipt;
      try { receipt = await action(); } catch (error) { receipt = { error: { message: error.message } }; }
      if (receipt?.status === 'committed') committed();
      else this.error = await this.readAgain(receipt?.error?.message ?? null);
    } finally {
      this.busy = false; this.paint(); settled();
    }
  }
}

// "tony", "tony and fable", "tony, fable and aim-core".
export function listWords(names) {
  if (names.length < 2) return names.join('') || 'nobody';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
