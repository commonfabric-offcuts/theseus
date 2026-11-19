import { miniDocument, Element } from './mini_dom.mjs';
import { arrangeStacks, stackState } from '../../web/reply-stacks.mjs';
// Selector support only; no layout, geometry, hit testing or native input.
const query = Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll = function(selector) {
  if (selector === '*') return [...this.descendants()];
  if (selector.includes(', ')) return [...new Set(selector.split(', ').flatMap(part => this.querySelectorAll(part)))];
  const values = [...selector.matchAll(/\[data-([\w-]+)=([^\]]+)\]/g)];
  if (values.length) return this.querySelectorAll(selector.replace(/\[data-([\w-]+)=([^\]]+)\]/g, '[data-$1]')).filter(e => values.every(([, key, value]) => e.dataset[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === value.replace(/[\"']/g, '')));
  const parts = selector.split(' > ');
  if (parts.length > 2) return query.call(this, parts.slice(0, 2).join(' > ')).flatMap(child => child.querySelectorAll(':scope > ' + parts.slice(2).join(' > ')));
  return query.call(this, selector);
};
Object.defineProperties(Element.prototype, {
  firstElementChild: { get() { return this.children[0] ?? null; } },
  nextElementSibling: { get() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; } },
  parentElement: { get() { return this.parent; } },
  ownerDocument: { get() { return this.document; } },
  style: { get() { return { setProperty() {}, removeProperty() {} }; } },
});
Element.prototype.contains = function(node) { return node === this || [...this.descendants()].includes(node); };
Element.prototype.after = function(...nodes) {
  const parent = this.parent;
  for (const node of nodes) { node.remove(); node.parent = parent; }
  parent.children.splice(parent.children.indexOf(this) + 1, 0, ...nodes);
};

export function renderer799(viewer = 'reader') {
  const doc = miniDocument(); doc.getElementById = () => null;
  const list = doc.createElement('div'), messages = new Map(); list.root = true;
  function add(items) {
    for (const item of items) {
      if (messages.has(item.id)) continue;
      // Body text does not drive grouping, stars, position or More decisions.
      // The actual projection deliberately omits it; no invented original text.
      messages.set(item.id, { ...item, body:'' });
      const card = doc.createElement('button'); card.className = 'message-card'; card.dataset.id = item.id; card.dataset.seq = String(item.seq);
      const author = doc.createElement('span'); author.className = 'message-author'; author.textContent = item.author_id;
      const body = doc.createElement('span'); body.className = 'message-preview';
      card.append(author, body); list.append(card);
    }
    arrangeStacks(list, messages, { doc, viewer });
    return stackState(list);
  }
  return { list, messages, add };
}


