import { arrange } from './topic-navigation.mjs';
import { waitsOn } from './topic-state.mjs';

// Composition only: members and topics come from their existing owners. The
// bench applies at every width (985); without a media API the page keeps its
// original narrow DOM. The real Team picker moves with it, so + Add keeps its
// native action.
// Below 1100px the bench's three parts are tabs (997): Topics, Agents and
// Notebook, each with its count. The page opens on Topics, and the tab chosen
// for an outcome is kept for the rest of the visit (this page load).
const chosenTabs = new Map();
const TABS = [['topics', 'Topics', 'topic-navigation'], ['agents', 'Agents', 'outcome-agents'], ['notes', 'Notebook', 'outcome-references']];
export class OutcomePageLayout {
  constructor({ host, team, cards, reader, color, scope = null, doc = host.ownerDocument, media = globalThis.matchMedia?.('all') }) {
    Object.assign(this, { host, team, cards, reader, color, scope, doc, media });
    this.counts = { topics: '', agents: '', notes: '' }; this.notesShown = true;
    this.tabs = doc.createElement('div'); this.tabs.className = 'outcome-tabs'; this.tabs.setAttribute('role', 'tablist'); this.tabs.setAttribute('aria-label', 'This outcome');
    this.tabButtons = new Map(TABS.map(([key, word, panel]) => {
      const button = doc.createElement('button'); button.type = 'button'; button.setAttribute('role', 'tab'); button.id = `outcome-tab-${key}`;
      button.setAttribute('aria-controls', panel); button.dataset.tab = key;
      const label = doc.createElement('span'); label.textContent = word; const count = doc.createElement('span'); count.className = 'outcome-tab-count';
      button.append(label, count); button.onclick = () => this.choose(key);
      this.tabs.append(button); return [key, { button, count }];
    }));
    this.tabs.addEventListener('keydown', event => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]; if (!step) return;
      const keys = TABS.map(([key]) => key).filter(key => !this.tabButtons.get(key).button.hidden);
      const next = keys[(keys.indexOf(this.host.dataset.outcomeTab) + step + keys.length) % keys.length];
      event.preventDefault(); this.choose(next); this.tabButtons.get(next).button.focus();
    });
    this.tab = chosenTabs.get(scope) ?? 'topics';
    this.teamParent = team.parentNode; this.teamNext = team.nextSibling;
    this.people = []; this.items = []; this.rows = new Map(); this.selected = null;
    this.section = doc.createElement('section'); this.section.id = 'outcome-agents';
    this.section.setAttribute('aria-labelledby', 'outcome-agents-heading');
    const head = doc.createElement('div'); head.className = 'rail-heading';
    const title = doc.createElement('h2'); title.id = 'outcome-agents-heading'; title.textContent = 'Agents'; head.append(title);
    this.list = doc.createElement('ul'); this.list.className = 'outcome-agent-list';
    this.section.append(head, this.list);
    this.changed = () => this.layout(); media?.addEventListener?.('change', this.changed); this.layout();
  }
  layout() {
    const wide = Boolean(this.media?.matches);
    if (wide) this.host.setAttribute('data-outcome-wide', ''); else this.host.removeAttribute('data-outcome-wide');
    if (wide) { this.host.append(this.tabs, this.section); this.section.append(this.team); this.paintTabs(); }
    else {
      this.tabs.remove();
      if (this.teamParent && this.team.parentNode !== this.teamParent) this.teamParent.insertBefore(this.team, this.teamNext?.parentNode === this.teamParent ? this.teamNext : null);
      this.section.remove();
    }
    this.purpose?.layout(wide);
  }
  setPurpose(purpose) { this.purpose = purpose; this.layout(); }
  choose(tab) {
    this.tab = tab; if (this.scope !== null) chosenTabs.set(this.scope, tab);
    // Tabs held at the top of a page scrolled down: the chosen part starts just under them.
    const stuck = this.tabs.isConnected && this.tabs.getBoundingClientRect().top <= 0;
    this.paintTabs();
    if (stuck) this.doc.getElementById(TABS.find(([key]) => key === tab)[2])?.scrollIntoView({ block: 'start' });
  }
  // The Notebook's owner reports what it lists; a reader who may not list it gets no tab.
  notes({ count, more, shown }) { this.counts.notes = `${count}${more ? '+' : ''}`; this.notesShown = shown; this.paintTabs(); }
  paintTabs() {
    // A part with nothing to show has no tab; the page shows Topics meanwhile, and the choice stands for when it returns.
    const hidden = { agents: this.membersKnown && this.people.length === 0, notes: !this.notesShown };
    const shown = hidden[this.tab] ? 'topics' : this.tab;
    this.host.dataset.outcomeTab = shown;
    for (const [key, { button, count }] of this.tabButtons) {
      const selected = key === shown;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      button.hidden = Boolean(hidden[key]);
      count.textContent = this.counts[key];
    }
  }
  members(people) { this.people = people; this.membersKnown = true; this.section.hidden = people.length === 0; this.counts.agents = String(people.length); this.paint(); this.paintTabs(); }
  topics(presentation) {
    this.items = [...new Map((presentation?.groups ?? []).flatMap(group => group.rows.map(row => [row.item.id, row.item]))).values()];
    const active = (presentation?.groups ?? []).filter(group => !group.toggle);
    this.counts.topics = `${active.reduce((sum, group) => sum + group.rows.length, 0)}${active.some(group => group.more) ? '+' : ''}`;
    this.paint(); this.paintTabs();
  }
  paint() {
    const rows = [];
    for (const person of this.people) {
      const id = person.actor_id, own = id === this.reader;
      let row = this.rows.get(id);
      if (!row) {
        const li = this.doc.createElement('li'), button = this.doc.createElement('button'); button.type = 'button';
        const dot = this.doc.createElement('span'), name = this.doc.createElement('span'), line = this.doc.createElement('span');
        dot.className = 'outcome-agent-dot'; name.className = 'outcome-agent-name'; line.className = 'outcome-agent-line';
        dot.setAttribute('aria-hidden', 'true'); button.append(dot, name, line); li.append(button);
        button.onclick = () => { this.selected = this.selected === id ? null : id; this.cards.filter(this.selected); this.paint(); if (this.selected) this.choose('topics'); };
        row = { li, button, name, line }; this.rows.set(id, row);
      }
      const waiting = this.items.filter(item => waitsOn(item).includes(id)).length;
      row.button.dataset.actorId = id;
      row.button.className = `outcome-agent${own ? ' own' : ''}${person.kind === 'agent' ? ` agent-${this.color(id)}` : ''}${waiting ? ' waited' : ''}`;
      row.button.setAttribute('aria-pressed', String(this.selected === id));
      row.name.textContent = `${person.name || id}${own ? ' (you)' : ''}`;
      row.line.textContent = waiting ? `${waiting} ${waiting === 1 ? 'topic waits' : 'topics wait'} on ${own ? 'you' : 'them'}` : `Nothing waits on ${own ? 'you' : 'them'}`;
      row.button.title = waiting ? `Show the topics waiting on ${own ? 'you' : person.name || id}` : row.line.textContent;
      rows.push(row.li);
    }
    for (const [id, row] of this.rows) if (!this.people.some(person => person.actor_id === id)) { row.li.remove(); this.rows.delete(id); }
    if (this.selected && !this.rows.has(this.selected)) { this.selected = null; this.cards.filter(null); }
    arrange(this.list, rows, this.doc.activeElement);
  }
  dispose() { this.media?.removeEventListener?.('change', this.changed); this.unlisten?.(); }
}
