import { arrange } from './topic-navigation.mjs';
import { waitsOn } from './topic-state.mjs';

// Composition only: members and topics come from their existing owners. The
// real Team picker moves with the viewport, so + Add keeps its native action.
export class OutcomePageLayout {
  constructor({ host, team, cards, reader, color, doc = host.ownerDocument, media = globalThis.matchMedia?.('(min-width:1100px)') }) {
    Object.assign(this, { host, team, cards, reader, color, doc, media });
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
    if (wide) { this.host.append(this.section); this.section.append(this.team); }
    else {
      if (this.teamParent && this.team.parentNode !== this.teamParent) this.teamParent.insertBefore(this.team, this.teamNext?.parentNode === this.teamParent ? this.teamNext : null);
      this.section.remove();
    }
    this.purpose?.layout(wide);
  }
  setPurpose(purpose) { this.purpose = purpose; this.layout(); }
  members(people) { this.people = people; this.section.hidden = people.length === 0; this.paint(); }
  topics(presentation) {
    this.items = [...new Map((presentation?.groups ?? []).flatMap(group => group.rows.map(row => [row.item.id, row.item]))).values()];
    this.paint();
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
        button.onclick = () => { this.selected = this.selected === id ? null : id; this.cards.filter(this.selected); this.paint(); };
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
