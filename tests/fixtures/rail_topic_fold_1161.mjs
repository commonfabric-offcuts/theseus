// Modeled geometry/event adapter only. Constructors do no Core/HTTP/browser
// work and import no test bodies. Pixel layout and native input stay separate.
import { Element, matches } from './mini_dom.mjs';
import { TopicRail, TopicPages } from '../../web/topic-navigation.mjs';
import { OutlineRail } from '../../web/outline-rail.mjs';
import { book } from '../../web/outline-order.mjs';

class Row extends Element {
  constructor(tag, doc) {
    super(tag, doc); this.height = 44;
    const values = new Map(); this.style = { setProperty: (k,v) => values.set(k,v), getPropertyValue: k => values.get(k) ?? '' };
  }
  get ownerDocument() { return this.document; }
  get firstChild() { return this.children[0] ?? null; }
  get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this)+1] ?? null; }
  get textContent() { return (this.words ?? '') + this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
  set textContent(value) { if (this.children) this.replaceChildren(); this.words = String(value); }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  matches(selector) { return matches(this, selector); }
  cloneNode(deep) {
    const copy = this.document.createElement(this.tag);
    Object.assign(copy, {className:this.className,attributes:{...this.attributes},dataset:{...this.dataset},words:this.words});
    if (deep) copy.append(...this.children.map(node => typeof node === 'string' ? node : node.cloneNode(true)));
    return copy;
  }
  contains(node) { return node === this || [...this.descendants()].includes(node); }
  after(...nodes) { for (const node of nodes) this.parent.insertBefore(node, this.nextElementSibling); }
  getClientRects() { return this.hidden ? [] : [{}]; }
  get scrollHeight() { return this.children.reduce((n,child) => n + (child.hidden ? 0 : child.height), 0); }
  getBoundingClientRect() {
    const siblings = this.parent?.children ?? [], top = siblings.slice(0,siblings.indexOf(this)).reduce((n,node) => n + (node.hidden ? 0 : node.height), 0);
    return { top, height: this.height, bottom: top + this.height };
  }
}

export function foldFixture({ count = 10, phone = false, view = 'full' } = {}) {
  const previous = globalThis.document, listeners = new Set(book.listeners), scopes = new Map(book.scopes);
  const observers = [], frames = new Map(); let serial = 0;
  class Observer {
    constructor(callback) { this.callback = callback; this.stopped = false; observers.push(this); }
    observe() {} disconnect() { this.stopped = true; }
  }
  const doc = { activeElement: null, createElement: tag => new Row(tag, doc) };
  const pencil = doc.createElement('button'); pencil.append(doc.createElement('svg'));
  doc.getElementById = id => id === 'new-message' ? pencil : null;
  doc.createElementNS = (_ns,tag) => doc.createElement(tag);
  doc.defaultView = { matchMedia: () => ({matches:phone}), MutationObserver: Observer, ResizeObserver: Observer,
    requestAnimationFrame: callback => { const id = ++serial; frames.set(id,callback); return id; }, cancelAnimationFrame: id => frames.delete(id) };
  if (view === 'none') delete doc.defaultView;
  else if (view === 'partial') doc.defaultView = {matchMedia: () => ({matches:phone})};
  globalThis.document = doc;
  const list = doc.createElement('div'); list.root = true;
  const moved = [], source = { doc, list, outcomes: new Map(), topicLine() {}, open: (...args) => moved.push(args) };
  const outcome = OutlineRail.prototype.outcome.call(source, {id:'fold-1161',title:'Fold fixture'});
  const rows = Array.from({length:count},(_,i) => ({id:'t'+i,title:'Topic '+i,workspace_id:outcome.id,list_position:100-i,unread:i===7?3:0,state:'active',archived:false}));
  const pages = new TopicPages('fold-1161-instance',outcome.id,null);
  pages.loaded = new Map(rows.map(row => [row.id,row])); pages.started = true;
  const opens = [], reads = [];
  const rail = new TopicRail({pages,...outcome.parts,area:outcome.own,reader:'fold-reader',
    read: async args => { reads.push(args); return {instance_id:pages.instanceId,items:rows,next_cursor:null}; },
    open:(...args) => opens.push(args),denied:()=>false,painted:()=>outcome.fold?.soon()});
  const flush = () => { const queued = [...frames.values()]; frames.clear(); for (const fn of queued) fn(); };
  const emit = (target,type,options = {}) => {
    const event = {target,button:0,detail:1,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...options};
    outcome.own.listeners[type]?.(event);
    if (type === 'click' && !event.stopped) target.onclick?.(event);
    return event;
  };
  const close = () => { outcome.fold?.dispose(); rail.disposeProjection(); globalThis.document = previous; book.listeners = listeners; book.scopes = scopes; };
  return {doc,outcome,area:outcome.own,host:outcome.parts.host,footer:outcome.own.querySelector('.ol-topic-foot'),rail,rows,opens,reads,observers,frames,flush,emit,close};
}
