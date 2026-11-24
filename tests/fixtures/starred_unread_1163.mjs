// Memory DOM ports for the real outline painter. No native input/layout claim.
import { Element } from './mini_dom.mjs';
import { OutlineDossiers } from '../../web/outline-dossiers.mjs';

export function outline1163(t, { pages = false } = {}) {
  const prior = globalThis.document, doc = { activeElement: null };
  class Node extends Element {
    constructor(tag) { super(tag, doc); this.nodeType = 1; this.ownerDocument = doc; }
    get childNodes() { return this.children; }
    get lastChild() { return this.children.at(-1) ?? null; }
    get textContent() { return this.nodeType === 3 ? this.data : this.children.map(n => n.textContent).join(''); }
    set textContent(value) { this.children = []; if (value) this.append(String(value)); }
    append(...nodes) { super.append(...nodes.map(n => typeof n === 'string' ? doc.createTextNode(n) : n)); }
  }
  doc.createElement = tag => new Node(tag);
  doc.createTextNode = text => Object.assign(new Node('text'), { nodeType: 3, data: String(text) });
  globalThis.document = doc;
  t.after(() => { globalThis.document = prior; });
  const calls = [], subject = Object.create(OutlineDossiers.prototype);
  subject.pageStars = pages;
  subject.outline = { doc, open: (target, title) => { calls.push({ target, title }); return false; } };
  const parent = doc.createElement('a'), box = doc.createElement('div');
  const state = { id: 'topic', parent, box, links: new Map(), stars: [], next: null, loaded: true, error: null };
  const paint = stars => { state.stars = stars; subject.paint(state); };
  return { subject, state, doc, calls, paint };
}

export const star1163 = (id, unread = 2, oldest = 'oldest', name = 'Orchard plan') => ({
  topic_id: 'topic', message_id: 'star-' + id, star: 10,
  dossier: { id, name, body: 'Original title', unread,
    oldest_unread: oldest ? { id: oldest, seq: 20, sent_ms: 100 } : null },
});

export function press1163(link, target = link, extra = {}) {
  const event = { target, button: 0, detail: 1, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, ...extra };
  link.onclick(event);
  return event;
}
