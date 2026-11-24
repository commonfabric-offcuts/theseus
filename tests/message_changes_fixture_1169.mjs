// Modeled document fixture derived from ui_message_format; no test registration or product bodies.
// A document whose elements hold child nodes and know their parent, as the browser's do.
export class Text {
  constructor(data) { Object.assign(this, { nodeType: 3, nodeName: '#text', data: String(data), parentNode: null, childNodes: [] }); }
  get textContent() { return this.data; }
}
export class Element {
  constructor(tag) {
    Object.assign(this, { nodeType: 1, nodeName: tag.toUpperCase(), tagName: tag.toUpperCase(), childNodes: [], parentNode: null, className: '', dataset: {}, attributes: {},
      handlers: {}, href: '', target: '', rel: '', title: '', scrollLeft: 0, scrollWidth: 0, clientWidth: 0, isConnected: true });
    this.style = { props: {}, textAlign: '', setProperty(name, value) { this.props[name] = value; } };
  }
  get classList() {
    const names = () => this.className.split(' ').filter(Boolean);
    return { add: (...more) => { this.className = [...new Set([...names(), ...more])].join(' '); },
      remove: name => { this.className = names().filter(n => n !== name).join(' '); },
      toggle: (name, on) => { if (on ?? !names().includes(name)) this.classList.add(name); else this.classList.remove(name); },
      contains: name => names().includes(name) };
  }
  append(...nodes) { for (let node of nodes) { if (typeof node === 'string') node = new Text(node); node.parentNode = this; this.childNodes.push(node); } }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  replaceChild(node, old) { this.childNodes[this.childNodes.indexOf(old)] = node; node.parentNode = this; old.parentNode = null; }
  addEventListener(name, fn) { (this.handlers[name] ??= []).push(fn); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  get textContent() { return this.childNodes.map(child => child.textContent).join(''); }
  set textContent(value) { this.childNodes = []; if (String(value)) this.append(new Text(value)); }
  get ownerDocument() { return doc; }
}
// A node's place among its parent's, and words put just before or after it, as the browser's ChildNode does.
for (const Kind of [Text, Element]) {
  Object.defineProperty(Kind.prototype, 'nextSibling', { get() { const kids = this.parentNode?.childNodes ?? []; return kids[kids.indexOf(this) + 1] ?? null; } });
  const put = (node, nodes, offset) => {
    const parent = node.parentNode, kids = parent.childNodes;
    kids.splice(kids.indexOf(node) + offset, 0, ...nodes);
    for (const added of nodes) added.parentNode = parent;
  };
  Kind.prototype.after = function (...nodes) { put(this, nodes, 1); };
  Kind.prototype.before = function (...nodes) { put(this, nodes, 0); };
}
export const doc = { createElementNS: (_, tag) => new Element(tag), createElement: tag => new Element(tag), createTextNode: data => new Text(data) };

// Every node under node, in document order.
export const walk = (node, out = []) => { out.push(node); for (const child of node.childNodes ?? []) walk(child, out); return out; };
const all = (node, test) => walk(node).filter(n => n.nodeType === 1 && test(n));
export const byClass = (node, name) => all(node, n => n.className.split(' ').includes(name));
export const byTag = (node, tag) => all(node, n => n.tagName === tag.toUpperCase());
const texts = nodes => nodes.map(n => n.textContent);

export const visible = node => node.nodeType === 3 ? node.data : node.classList?.contains('sr-only') ? '' : node.childNodes.map(visible).join('');
export function constructCases(CardScroll) {
  doc.defaultView = { scrollBy() {} };
  doc.createTreeWalker = root => { const texts = walk(root).filter(node => node.nodeType === 3); let at = -1; return { nextNode: () => texts[++at] ?? null }; };
  doc.createRange = () => ({ setStart(node, k) { this.start = [node, k]; }, setEnd(node, k) { this.end = [node, k]; }, get collapsed() { return this.start[0] === this.end[0] && this.start[1] === this.end[1]; } });
  return Array.from({ length: 6 }, () => {
    const host = new Element('span'), plain = new Element('span'), card = new Element('div'), preview = new Element('span'), cue = new Element('span');
    preview.className = 'message-preview'; cue.className = 'message-preview-cue'; card.append(preview, cue);
    Object.assign(card, { scrollTop: 0, scrollHeight: 300, clientHeight: 150, getBoundingClientRect: () => ({ top: 0, height: 150 }),
      querySelector: selector => ({ ':scope > .message-preview': preview, ':scope > .message-preview-cue': cue })[selector] ?? null });
    preview.getBoundingClientRect = () => ({ top: 10, height: 100 });
    const saved = new Map(), storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
    const source = { source_ref: { kind: 'message', id: 'm' }, revision: 2, body: 'Before new words after.', struck: { revision: 1, cuts: [{ at: 7, words: 'old' }], added: [{ start: 7, end: 16 }] } };
    const owner = new CardScroll({ read: async () => source });
    const event = { prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; }, key: 'Enter', repeat: false };
    return { host, plain, card, preview, cue, storage, saved, source, owner, event };
  });
}
