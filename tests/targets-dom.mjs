// A small document for the outcome page's target, charts and topic line (web/targets.mjs, web/charts.mjs):
// elements with attributes, children, text, focus, events and the few selectors those modules use.
export function installDocument(t) {
  const previous = { document: globalThis.document, CSS: globalThis.CSS };
  class Node {
    constructor(tag, ns = null) { this.tagName = String(tag).toUpperCase(); this.namespaceURI = ns; this.children = []; this.attributes = {}; this.handlers = {}; this.text = ''; this.parent = null; this.style = {}; this.hidden = false; }
    get parentElement() { return this.parent; }
    get childNodes() { return this.children; }
    get firstChild() { return this.children[0] ?? null; }
    get dataset() { return Object.fromEntries(Object.entries(this.attributes).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-(.)/g, (_, c) => c.toUpperCase()), v])); }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.text = String(value); this.children = []; }
    get className() { return this.attributes.class ?? ''; }
    set className(value) { this.attributes.class = String(value); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
    removeAttribute(name) { delete this.attributes[name]; }
    append(...kids) { for (const kid of kids) { const node = typeof kid === 'string' ? new Text(kid) : kid; node.remove?.(); node.parent = this; this.children.push(node); } }
    replaceChildren(...kids) { for (const child of this.children) child.parent = null; this.children = []; this.text = ''; this.append(...kids); }
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; } }
    addEventListener(name, fn) { (this.handlers[name] ??= []).push(fn); }
    dispatch(name, event = {}) { const full = { target: this, preventDefault() { this.prevented = true; }, ...event }; for (let at = this; at; at = at.parent) { for (const fn of at.handlers[name] ?? []) fn(full); const prop = at['on' + name]; if (typeof prop === 'function') prop(full); if (name !== 'keydown' && name !== 'input') break; } return full; }
    click() { return this.dispatch('click', { button: 0 }); }
    focus() { document.activeElement = this; }
    contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
    descendants() { return this.children.flatMap(child => child instanceof Text ? [] : [child, ...child.descendants()]); }
    matches(selector) {
      const attr = selector.match(/^\[([\w-]+)="(.*)"\]$/);
      if (attr) return this.getAttribute(attr[1]) === attr[2];
      if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
      return this.tagName === selector.toUpperCase();
    }
    querySelectorAll(selector) {
      const child = selector.match(/^(.*) > (\S+)$/);
      if (child) return this.querySelectorAll(child[1]).flatMap(parent => parent.children.filter(node => !(node instanceof Text) && node.matches(child[2])));
      const scoped = selector.match(/^:scope > (\S+)$/);
      if (scoped) return this.children.filter(node => !(node instanceof Text) && node.matches(scoped[1]));
      return this.descendants().filter(node => node.matches(selector));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  }
  class Text { constructor(data) { this.data = String(data); this.parent = null; } get textContent() { return this.data; } remove() { if (this.parent) { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; } } }
  const document = { activeElement: null, createElement: tag => new Node(tag), createElementNS: (ns, tag) => new Node(tag, ns), createTextNode: data => new Text(data) };
  globalThis.document = document;
  globalThis.CSS = { escape: value => String(value).replace(/"/g, '\\"'), supports: () => true };
  t.after(() => { globalThis.document = previous.document; globalThis.CSS = previous.CSS; });
  return { document, Node, host: () => new Node('section') };
}

export const buttons = node => node.querySelectorAll('button');
export const named = (node, key) => node.querySelector(`[data-key="${key}"]`);
