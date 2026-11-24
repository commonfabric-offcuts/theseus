// The designer's second take (1170): admitted pointers, grouped by destination.
// This view reads no sources and changes no message, writing or remembered view.
import { timeNode } from './times.mjs';

const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// The destination bubble from the selected second take; it is a place, not the
// menu's "Start a topic" bubble with its plus.
function topicMark(doc) {
  const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg'), path = doc.createElementNS(ns, 'path');
  for (const [name, value] of Object.entries({ viewBox: '0 0 16 16', width: '13', height: '13', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
  for (const [name, value] of Object.entries({ d: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linejoin': 'round' })) path.setAttribute(name, value);
  svg.append(path);
  return svg;
}

export function movedGroups(pointers) {
  const roots = new Map(), groups = new Map();
  for (const pointer of pointers ?? []) {
    if (typeof pointer?.root_id === 'string' && typeof pointer.topic_id === 'string') roots.set(pointer.root_id, pointer);
  }
  for (const pointer of roots.values()) {
    if (!groups.has(pointer.topic_id)) groups.set(pointer.topic_id, { id: pointer.topic_id, title: pointer.title, items: [] });
    groups.get(pointer.topic_id).items.push(pointer);
  }
  return [...groups.values()];
}

export class MovedDossiers {
  constructor({ doc, href, actorName = id => id }) {
    Object.assign(this, { doc, href, actorName, groups: new Map(), serial: 0 });
    this.root = element(doc, 'section', 'moved-dossiers');
    this.root.setAttribute('aria-labelledby', 'moved-dossiers-heading');
    this.heading = element(doc, 'h2', 'moved-dossiers-heading', 'Moved elsewhere ');
    this.heading.id = 'moved-dossiers-heading';
    this.total = element(doc, 'span', 'moved-dossiers-total');
    this.heading.append(this.total);
    this.root.append(this.heading);
  }
  make(group) {
    const box = element(this.doc, 'div', 'moved-dossiers-group'), destination = element(this.doc, 'a', 'moved-dossiers-topic');
    const title = element(this.doc, 'span', 'moved-dossiers-destination'), count = element(this.doc, 'span', 'moved-dossiers-count');
    destination.append(topicMark(this.doc), title, count);
    const rows = element(this.doc, 'ul', 'moved-dossiers-rows'), more = element(this.doc, 'button', 'moved-dossiers-more');
    rows.id = `moved-dossiers-rows-${++this.serial}`;
    more.type = 'button'; more.setAttribute('aria-controls', rows.id);
    box.append(destination, rows, more);
    const state = { box, destination, title, count, rows, more, items: new Map(), expanded: false };
    more.onclick = () => {
      const first = state.current.items.length > 4 ? 3 : state.current.items.length;
      state.expanded = true;
      this.paint(this.host, this.pointers);
      state.items.get(state.current.items[first]?.root_id)?.link.focus({ preventScroll: true });
    };
    return state;
  }
  makeRow() {
    const row = element(this.doc, 'li', 'moved-dossiers-row'), link = element(this.doc, 'a', 'moved-dossiers-link');
    const folder = element(this.doc, 'span', 'moved-dossiers-folder'), sheet = element(this.doc, 'span', 'moved-dossiers-sheet');
    folder.setAttribute('aria-hidden', 'true'); folder.append(sheet);
    const name = element(this.doc, 'span', 'moved-dossiers-name'), metadata = element(this.doc, 'span', 'moved-dossiers-meta');
    link.append(folder, name, metadata); row.append(link);
    return { row, link, name, metadata };
  }
  paint(host, pointers) {
    this.host = host; this.pointers = pointers;
    const groups = movedGroups(pointers), live = new Set(groups.map(group => group.id));
    if (!groups.length) { this.root.remove(); this.groups.clear(); return; }
    this.total.textContent = String(groups.reduce((sum, group) => sum + group.items.length, 0));
    for (const [id, state] of this.groups) if (!live.has(id)) { state.box.remove(); this.groups.delete(id); }
    groups.forEach((group, index) => {
      let state = this.groups.get(group.id);
      if (!state) { state = this.make(group); this.groups.set(group.id, state); }
      state.current = group;
      state.title.textContent = group.title; state.count.textContent = String(group.items.length);
      state.destination.href = this.href(group.id);
      const keep = new Set(group.items.map(pointer => pointer.root_id));
      for (const [id, item] of state.items) if (!keep.has(id)) { item.row.remove(); state.items.delete(id); }
      group.items.forEach((pointer, at) => {
        let item = state.items.get(pointer.root_id);
        if (!item) { item = this.makeRow(); state.items.set(pointer.root_id, item); }
        item.link.dataset.rootId = pointer.root_id;
        item.link.href = this.href(pointer.topic_id, pointer.root_id);
        const name = pointer.name || 'Unnamed dossier';
        item.name.textContent = name; item.link.title = name;
        const by = typeof pointer.actor_id === 'string' ? this.actorName(pointer.actor_id) : 'Mover unavailable';
        item.metadata.replaceChildren(element(this.doc, 'span', '', by));
        if (Number.isSafeInteger(pointer.at_ms) && pointer.at_ms >= 0) item.metadata.append(' · ', timeNode(pointer.at_ms, this.doc));
        item.row.hidden = !state.expanded && group.items.length > 4 && at >= 3;
        if (state.rows.children[at] !== item.row) state.rows.insertBefore(item.row, state.rows.children[at] ?? null);
      });
      const collapsed = !state.expanded && group.items.length > 4;
      state.more.hidden = !collapsed;
      state.more.textContent = `${group.items.length - 3} more`;
      state.more.setAttribute('aria-expanded', String(state.expanded));
      state.more.setAttribute('aria-label', `Show ${group.items.length - 3} more dossiers moved to ${group.title}`);
      if (this.root.children[index + 1] !== state.box) this.root.insertBefore(state.box, this.root.children[index + 1] ?? null);
    });
    if (host.lastElementChild !== this.root) host.append(this.root);
  }
}
