import { Element, matches } from './mini_dom.mjs';

// Memory event/DOM ports only. No browser layout, gesture or timing oracle.
// Constructors share these exact ports with the once-only setup entry.
export function escapeDocument() {
  const doc = { listeners: new Map(), activeElement: null };
  const descendants = n => [...n.descendants()].filter(x => x.nodeType === 1);
  class Node extends Element {
    constructor(tag) { super(tag, doc); this.nodeType = 1; this.events = new Map(); this.style = { setProperty() {}, removeProperty() {} }; }
    *descendants() { for (const n of this.children) if (n?.nodeType === 1) { yield n; yield* n.descendants(); } }
    get ownerDocument() { return doc; }
    get parentNode() { return this.parent; }
    get parentElement() { return this.parent; }
    get childNodes() { return this.children; }
    get firstChild() { return this.children[0] ?? null; }
    get firstElementChild() { return this.children.find(x => x.nodeType === 1) ?? null; }
    get nextSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1] ?? null; }
    get nextElementSibling() { return this.nextSibling; }
    get localName() { return this.tag; }
    setAttribute(name, value) {
      super.setAttribute(name, value);
      if (name === 'class') this.className = String(value);
      if (name === 'id') this.id = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    getAttributeNames() { return Object.keys(this.attributes); }
    hasAttribute(n) { return Object.hasOwn(this.attributes, n); }
    contains(node) { for (; node; node = node.parent) if (node === this) return true; return false; }
    after(...nodes) { const p = this.parent, next = this.nextSibling; for (const node of nodes) p?.insertBefore(node, next); }
    before(...nodes) { for (const node of nodes) this.parent?.insertBefore(node, this); }
    cloneNode(deep = false) { const n = doc.createElement(this.tag); n.className = this.className; n.textContent = this.textContent; for (const [k,v] of Object.entries(this.attributes)) n.setAttribute(k,v); if (deep) n.append(...this.children.map(x => typeof x === 'string' ? x : x.nodeType === 3 ? x.textContent : x.cloneNode(true))); return n; }
    addEventListener(type, fn, options = {}) { const list = this.events.get(type) ?? []; list.push({ fn, capture: options === true || options.capture === true, signal: options.signal }); this.events.set(type, list); }
    removeEventListener(type, fn) { this.events.set(type, (this.events.get(type) ?? []).filter(x => x.fn !== fn)); }
    querySelectorAll(selector) {
      if (selector === '*') return descendants(this);
      if (selector.includes(',')) return [...new Set(selector.split(',').flatMap(s => this.querySelectorAll(s.trim())))];
      const parts = selector.split(/\s*>\s*/);
      if (parts.length > 1) {
        let rows = parts.shift() === ':scope' ? [this] : this.querySelectorAll(selector.split(/\s*>\s*/)[0]);
        for (const part of parts) rows = rows.flatMap(row => row.children.filter(x => x.nodeType === 1 && matches(x, part)));
        return rows;
      }
      const space = selector.lastIndexOf(' ');
      if (space >= 0) return this.querySelectorAll(selector.slice(0,space)).flatMap(n => n.querySelectorAll(selector.slice(space+1)));
      return descendants(this).filter(n => matches(n, selector));
    }
    closest(selector) { for (let n = this; n; n = n.parent) if (selector.split(',').some(s => matches(n,s))) return n; return null; }
    focus() { doc.activeElement = this; }
    blur() { if (doc.activeElement === this) { doc.activeElement = doc.body; dispatch(this,'blur'); } }
    select() { this.setSelectionRange(0,this.value.length); }
    setSelectionRange(start,end) { this.selectionStart=start;this.selectionEnd=end; }
    requestSubmit() { return dispatch(this,'submit'); }
    click() { return dispatch(this,'click',{button:0}); }
    getBoundingClientRect() { return {top:0,left:0,right:100,bottom:40,width:100,height:40}; }
    getClientRects() { return this.isConnected ? [this.getBoundingClientRect()] : []; }
  }
  doc.createElement = tag => new Node(tag);
  doc.createElementNS = (_ns,tag) => doc.createElement(tag);
  doc.createTextNode = text => ({nodeType:3,textContent:String(text),parent:null});
  doc.body=doc.createElement('body');doc.body.root=true;doc.documentElement=doc.createElement('html');
  doc.getElementById=id=>doc.body.querySelector('#'+id);
  doc.querySelector=s=>doc.body.querySelector(s);doc.querySelectorAll=s=>doc.body.querySelectorAll(s);
  doc.addEventListener=(...args)=>Node.prototype.addEventListener.apply(doc,args);
  doc.removeEventListener=(...args)=>Node.prototype.removeEventListener.apply(doc,args);
  doc.events=doc.listeners;
  doc.defaultView={matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),getComputedStyle:()=>({zIndex:'1',marginTop:'0px',marginBottom:'0px'}),addEventListener(){},removeEventListener(){},innerWidth:390,innerHeight:844};
  const pencil=doc.createElement('button');pencil.id='new-message';pencil.append(doc.createElement('svg'));doc.body.append(pencil);
  return doc;
}

export function dispatch(target, type, extra = {}) {
  const e={target,currentTarget:target,type,keyCode:0,isComposing:false,repeat:false,shiftKey:false,defaultPrevented:false,stopped:false,
    preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.stopped=this.immediate=true;},...extra};
  const path=[];for(let n=target;n;n=n.parent)path.push(n);
  const doc=target.ownerDocument;if(doc&&!path.includes(doc))path.push(doc);
  const deliver=(node,capture)=>{e.currentTarget=node;for(const row of node.events?.get(type)??[])if(row.capture===capture&&!row.signal?.aborted){row.fn.call(node,e);if(e.immediate)break;}if(!capture&&!e.immediate)node['on'+type]?.(e);};
  for(const node of [...path].reverse()){deliver(node,true);if(e.stopped)return e;}
  for(const node of path){deliver(node,false);if(e.stopped||['blur','focus','submit'].includes(type))break;}
  return e;
}
