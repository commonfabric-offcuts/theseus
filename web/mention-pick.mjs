import { markSeatEnded } from './people.mjs';

// Completion changes only writing. Core still owns leading-@ addressing.
export function mentionQuery(value, start, end = start) {
  if (start !== end) return null;
  const match = /(?:^|[\s([{,:;!?])@([A-Za-z0-9_.-]*)$/.exec(value.slice(0, start));
  if (!match) return null;
  return { start: start - match[1].length - 1,
    end: start + (value.slice(start).match(/^[A-Za-z0-9_.-]*/)?.[0].length ?? 0), filter: match[1].toLowerCase() };
}
export function mentionChoices(members, filter) {
  const unique = new Map();
  for (const person of members) if (person.enabled !== false && !unique.has(person.id)) unique.set(person.id, person);
  const prefix = filter.toLowerCase();
  return [...unique.values()].filter(({id, name}) => id.toLowerCase().startsWith(prefix) || name?.toLowerCase().startsWith(prefix))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export class MentionPick {
  constructor({field, members, admits, insert}) {
    Object.assign(this, {field, members, admits, insert});
    this.active = 0; this.query = null; this.list = null; this.listeners = [];
    const on = (type, handler, capture = false) => {
      field.addEventListener(type, handler, capture); this.listeners.push([type, handler, capture]);
    };
    on('click', () => this.update());
    on('keyup', event => { if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) this.update(); });
    on('blur', event => { if (!this.list?.contains(event.relatedTarget)) this.close(); });
    on('compositionstart', () => { this.composing = true; this.close(); });
    on('compositionend', () => { this.composing = false; this.update(); });
    // Take completion keys/Escape before the surface can send, indent or close.
    on('keydown', event => this.key(event), true);
  }
  get open() { return Boolean(this.query && this.list && !this.list.hidden); }
  current() {
    return !this.composing && this.admits() && !this.field.disabled
      ? mentionQuery(this.field.value, this.field.selectionStart, this.field.selectionEnd) : null;
  }
  update() {
    const query = this.current();
    if (!query) { this.close(); return; }
    if (!this.query || this.query.start !== query.start || this.query.filter !== query.filter) this.active = 0;
    this.query = query;
    this.paint();
  }
  ensureList() {
    if (this.list) return;
    this.doc = this.field.ownerDocument;
    this.list = this.doc.createElement('div'); this.list.className = 'mention-pick';
    this.list.id = `${this.field.id}-mentions`; this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'People to mention');
    // Keep mouse focus in the field. Touch must retain its native click.
    this.list.addEventListener('mousedown', event => event.preventDefault());
    this.field.after(this.list);
  }
  paint() {
    const choices = mentionChoices(this.members(), this.query.filter);
    if (!choices.length) { this.close(); return; }
    this.ensureList();
    this.active = Math.max(0, Math.min(this.active, choices.length - 1));
    const rows = choices.map((person, index) => {
      const row = this.doc.createElement('button'); row.type = 'button'; row.tabIndex = -1;
      row.id = `${this.list.id}-${index}`; row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === this.active));
      row.textContent = `@${person.id}${person.name && person.name !== person.id ? ' · ' + person.name : ''}`;
      markSeatEnded(row, person.seat_ended);
      row.onclick = () => this.pick(person.id); return row;
    });
    this.list.replaceChildren(...rows); this.list.hidden = false;
    this.field.setAttribute('aria-controls', this.list.id); this.field.setAttribute('aria-expanded', 'true');
    this.field.setAttribute('aria-autocomplete', 'list');
    if (choices.length) this.field.setAttribute('aria-activedescendant', `${this.list.id}-${this.active}`);
    else this.field.removeAttribute('aria-activedescendant');
    rows[this.active]?.scrollIntoView?.({block:'nearest'});
  }
  close() {
    this.query = null;
    if (!this.list) return;
    this.list.hidden = true; this.list.replaceChildren();
    if (this.field.getAttribute('aria-controls') === this.list.id) {
      for (const attribute of ['aria-controls','aria-activedescendant','aria-autocomplete']) this.field.removeAttribute(attribute);
      this.field.setAttribute('aria-expanded', 'false');
    }
  }
  pick(id) {
    const query = this.current();
    if (!query || !this.query || query.start !== this.query.start || !mentionChoices(this.members(), query.filter).some(person => person.id === id)) { this.close(); return; }
    const tail = this.field.value.slice(query.end);
    const text = `@${id}${!tail || !/^[\s),:;!?\]}]/.test(tail) ? ' ' : ''}`;
    this.close(); this.field.focus({preventScroll:true});
    this.field.setSelectionRange(query.start, query.end); this.insert(text);
    this.close();
  }
  key(event) {
    if (!this.open || event.defaultPrevented || event.isComposing || this.composing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
    if (!this.current()) { this.close(); return false; }
    const choices = mentionChoices(this.members(), this.query.filter);
    if (event.key === 'Escape') this.close();
    else if (['Enter','Tab'].includes(event.key) && choices.length) this.pick(choices[this.active]?.id);
    else if (['ArrowDown','ArrowUp'].includes(event.key) && choices.length) {
      this.active = (this.active + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length; this.paint();
    } else return false;
    event.preventDefault(); event.stopPropagation(); return true;
  }
  dispose() {
    this.close(); this.list?.remove();
    for (const args of this.listeners) this.field.removeEventListener(...args);
    this.listeners = [];
  }
}
