// Small tree document shared with the formatted-words contracts. No browser gesture proof.
class Text {
  constructor(data) { Object.assign(this, { nodeType: 3, nodeName: '#text', data: String(data), parentNode: null }); }
  get textContent() { return this.data; }
}
class Element {
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
export const all = (node, test) => walk(node).filter(n => n.nodeType === 1 && test(n));
export const byClass = (node, name) => all(node, n => n.className.split(' ').includes(name));
export const byTag = (node, tag) => all(node, n => n.tagName === tag.toUpperCase());
const texts = nodes => nodes.map(n => n.textContent);

export const RULE = 'break-out-paragraphs';
export const formatted768 = [
  'First sentence. Second **bold** sentence. Third sentence.',
  'Choose 1) First 2) **Second** 3) Third',
  'a) First i. Second (a) Third',
  'Keep **1) First 2) Second. Still bold.** and [3) Third. Link](https://example.com) and `4) Code. Code` together. Next.',
  'Nested ***strong. Emphasis.*** stays. Next.',
  'Café 😀 ends. Next e\u0301 sentence.\r\nCarried words. Final.',
  '1) First sentence. Second sentence.\n2) Next item. Last sentence.',
  '- [x] Done sentence. Another sentence.\n  - Nested sentence. Final sentence.\n- [ ] Open sentence. Last.',
  '# Heading. Intact.\n\n> Quote. Intact.\n>\n> - Quoted. List.\n\n```js\ncode. intact.\n```\n\n| A | B |\n|---|---|\n| C. D. | E |',
];
export const native768 = {
  sentence: {body:'Alpha sentence. Beta **bold** sentence. Gamma end.', first:'Alpha', last:'end.', expected:'Alpha sentence. Beta **bold** sentence. Gamma end.', light:'Beta **bold** sentence.', target:'bold', paragraphs:3},
  enumerator: {body:'a) First 2) **Second** 3) Third', first:'First', last:'Third', expected:'First 2) **Second** 3) Third', light:'2) **Second**', target:'Second', paragraphs:3},
  list: {body:'1) First sentence. Second **bold** sentence.\n2) Next item. Last end.', first:'First', last:'end.', expected:'First sentence. Second **bold** sentence.\n2) Next item. Last end.', light:'1) First sentence. Second **bold** sentence.', target:'bold', paragraphs:4},
};
