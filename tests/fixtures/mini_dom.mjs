// A small DOM for checks that paint real view code: elements with children,
// classes, data and attributes, and the few selectors the views use (a tag,
// .class, #id, [data-x] or [attr], attribute equality, combined, and comma lists). Native-browser
// proof stays separate: this fixture shows what is painted, not hit testing,
// layout or focus order.
//
// As in the older fakes beside it, textContent is an element's own words, a
// string child stays a string, and `text` is everything it says in order.

const camel = name => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

function parse(selector) {
  const found = /^([a-zA-Z]*)((?:[.#][\w-]+)*)((?:\[[\w-]+(?:=(?:"[^"]*"|'[^']*'|[^\]\s]+))?\])*)$/.exec(selector.trim());
  if (!found) throw new Error(`mini_dom cannot match the selector ${selector}`);
  const parts = found[2].match(/[.#][\w-]+/g) ?? [];
  return { tag: found[1].toLowerCase(), classes: parts.filter(part => part[0] === '.').map(part => part.slice(1)),
    ids: parts.filter(part => part[0] === '#').map(part => part.slice(1)),
    attributes: [...found[3].matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\]/g)]
      .map(([, name, quoted, single, bare]) => ({ name, value: quoted ?? single ?? bare })) };
}

export function matches(node, selector) {
  if (!node || typeof node !== 'object') return false;
  return selector.split(',').some(one => {
    const excluded = [...one.matchAll(/:not\(([^()]+)\)/g)].map(match => match[1]);
    if (excluded.some(part => matches(node, part))) return false;
    one = one.replace(/:not\([^()]+\)/g, '');
    const wanted = parse(one);
    return (!wanted.tag || node.tag === wanted.tag) && wanted.classes.every(name => node.classList.contains(name)) &&
      wanted.ids.every(id => node.id === id) &&
      wanted.attributes.every(({ name, value }) => {
        const values = name.startsWith('data-') ? node.dataset : node.attributes;
        const key = name.startsWith('data-') ? camel(name.slice(5)) : name;
        return Object.hasOwn(values, key) && (value === undefined || String(values[key]) === value);
      });
  });
}

export class Element {
  constructor(tag = 'div', document = null) {
    Object.assign(this, { tag: String(tag).toLowerCase(), children: [], attributes: {}, dataset: {}, className: '', id: '', title: '',
      textContent: '', hidden: false, disabled: false, value: '', parent: null, listeners: {}, document });
  }
  get tagName() { return this.tag.toUpperCase(); }
  get text() { return this.textContent + this.children.map(node => typeof node === 'string' ? node : node.text).join(''); }
  get isConnected() { return Boolean(this.root) || Boolean(this.parent?.isConnected); }
  get classList() {
    const names = () => this.className.split(' ').filter(Boolean), set = list => { this.className = list.join(' '); };
    return { add: (...add) => set([...names(), ...add.filter(name => !names().includes(name))]), remove: (...gone) => set(names().filter(name => !gone.includes(name))),
      contains: name => names().includes(name),
      toggle: (name, on = !names().includes(name)) => { set(on ? [...names().filter(other => other !== name), name] : names().filter(other => other !== name)); return on; } };
  }
  append(...nodes) {
    for (const node of nodes) { if (typeof node === 'object') { node.remove?.(); node.parent = this; } this.children.push(node); }
  }
  replaceChildren(...nodes) {
    for (const node of this.children) if (typeof node === 'object') node.parent = null;
    this.children = []; this.append(...nodes);
  }
  insertBefore(node, before) {
    node.remove?.(); const index = before ? this.children.indexOf(before) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, node); node.parent = this;
  }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; } }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  toggleAttribute(name, force) { const on = force ?? !Object.hasOwn(this.attributes, name); if (on) this.attributes[name] = ''; else delete this.attributes[name]; return on; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  focus() { if (this.document) this.document.activeElement = this; else if (globalThis.document) globalThis.document.activeElement = this; }
  setSelectionRange() {}
  *descendants() { for (const node of this.children) if (typeof node === 'object') { yield node; yield* node.descendants(); } }
  prepend(...nodes) { const rest = this.children; this.children = []; this.append(...nodes); this.children.push(...rest.filter(node => !nodes.includes(node))); }
  // ':scope > SELECTOR' matches only this element's own children.
  querySelectorAll(selector) {
    const own = /^:scope\s*>\s*(.+)$/.exec(selector.trim());
    return own ? this.children.filter(node => matches(node, own[1])) : [...this.descendants()].filter(node => matches(node, selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { for (let node = this; node; node = node.parent) if (matches(node, selector)) return node; return null; }
}

// A document whose elements are these; byId finds or makes the element a view looks up by id.
export function miniDocument() {
  const ids = new Map();
  const document = { activeElement: null };
  document.createElement = tag => new Element(tag, document);
  document.createTextNode = text => Object.assign(new Element('text', document), { nodeType: 3, data: String(text), textContent: String(text) });
  document.createElementNS = (ns, tag) => new Element(tag, document);
  document.byId = id => ids.get(id) ?? ids.set(id, Object.assign(document.createElement('div'), { id, root: true })).get(id);
  return document;
}
