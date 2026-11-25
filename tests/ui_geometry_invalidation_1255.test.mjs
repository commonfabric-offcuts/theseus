import test from 'node:test';
import assert from 'node:assert/strict';
import { OutlineDossiers } from '../web/outline-dossiers.mjs';
import { foldFixture } from './fixtures/rail_topic_fold_1161.mjs';
import { RailTopicFold } from '../web/rail-topic-fold.mjs';

// Actual owners and observer callbacks, supplied geometry/events; no native
// visibility, focus, timing or CPU result is claimed by this adapter.
function fold(t) {
  const f = foldFixture(); t.after(f.close); f.outcome.fold.dispose();
  const events = new Map(), fonts = new Map();
  f.doc.defaultView.addEventListener = (name, fn) => events.set(name, fn);
  f.doc.defaultView.removeEventListener = (name, fn) => { if (events.get(name) === fn) events.delete(name); };
  f.doc.fonts = {addEventListener:(name,fn)=>fonts.set(name,fn), removeEventListener:(name,fn)=>{if(fonts.get(name)===fn)fonts.delete(name);}};
  // Explicit parent chain supplies native parentElement to this small adapter.
  f.area.parentElement = f.area.parent; f.area.parentElement.parentElement = f.area.parent.parent;
  const Observed = f.doc.defaultView.MutationObserver;
  class Observer extends Observed {
    constructor(fn) { super(fn); this.targets = []; this.queued = []; }
    observe(target, options) { this.targets.push({target, options}); }
    takeRecords() { const records = this.queued; this.queued = []; return records; }
  }
  f.doc.defaultView.MutationObserver = Observer;
  f.outcome.fold = new RailTopicFold({area:f.area,host:f.host,footer:f.footer,doc:f.doc}); f.flush();
  const owner = f.outcome.fold;
  let reads = 0, written = false, readsAfterWrite = 0;
  const nodes = [f.host, f.footer, ...f.host.children];
  for (const node of nodes) {
    const rect = node.getBoundingClientRect.bind(node);
    node.getBoundingClientRect = () => { reads++; if (written) readsAfterWrite++; return rect(); };
    const rects = node.getClientRects.bind(node);
    node.getClientRects = () => { reads++; if (written) readsAfterWrite++; return rects(); };
    node.dataset = new Proxy(node.dataset, {set(o,k,v) { written = true; o[k] = v; return true; }, deleteProperty(o,k) { written = true; return delete o[k]; }});
  }
  const set = f.area.style.setProperty;
  f.area.style.setProperty = (...args) => { written = true; set(...args); };
  const count = () => ({reads, readsAfterWrite});
  const reset = () => { reads = 0; readsAfterWrite = 0; written = false; };
  const change = records => owner.mutations.callback(records);
  return {...f, owner, count, reset, change, events, fonts};
}

test('1255 unchanged paint callbacks consume no geometry after the initial measure', t => {
  const f = fold(t);
  for (let n = 0; n < 25; n++) { f.owner.soon(); f.flush(); }
  assert.equal(f.count().reads, 0);
  assert.ok(f.area.hasAttribute('data-topic-fold'));
});

test('1255 a real row change coalesces, measures current geometry before fold writes and publishes a new fade', t => {
  const f = fold(t), before = f.area.style.getPropertyValue('--topic-fold-start');
  f.host.children[0].height = 70;
  f.change([{type:'childList',target:f.host.children[0]}]);
  f.owner.soon(); f.owner.soon(); assert.equal(f.frames.size, 1); f.flush();
  assert.ok(f.count().reads > 0); assert.equal(f.count().readsAfterWrite, 0);
  assert.notEqual(f.area.style.getPropertyValue('--topic-fold-start'), before);
  f.reset(); f.owner.soon(); f.flush(); assert.equal(f.count().reads, 0);
});

test('1255 same-value class notifications do not invalidate; actual class changes do', t => {
  const f = fold(t), row = f.host.children[0];
  f.change([{type:'attributes',target:row,attributeName:'class',oldValue:row.getAttribute('class')}]);
  f.flush(); assert.equal(f.count().reads, 0);
  row.setAttribute('class', 'nav-item changed');
  f.change([{type:'attributes',target:row,attributeName:'class',oldValue:'nav-item'}]);
  f.flush(); assert.ok(f.count().reads > 0);
});

for (const event of ['resize', 'font', 'image']) test('1255 '+event+' completion invalidates and its listener retires', t => {
  const f = fold(t), before = f.area.style.getPropertyValue('--topic-fold-start');
  const callback = event === 'resize' ? f.events.get('resize') : event === 'font' ? f.fonts.get('loadingdone') : f.area.listeners.load;
  assert.equal(typeof callback, 'function');
  f.host.children[0].height += 15; callback(); f.flush();
  assert.ok(f.count().reads > 0); assert.notEqual(f.area.style.getPropertyValue('--topic-fold-start'), before);
  f.owner.dispose(); f.reset(); callback(); f.flush(); assert.equal(f.count().reads, 0);
  assert.equal(f.events.size, 0); assert.equal(f.fonts.size, 0); assert.equal(f.area.listeners.load, undefined);
});

for (const name of ['hidden', 'inert', 'open', 'class', 'data-only', 'style']) test('1255 ancestor '+name+' invalidation is observed before same-task paint', t => {
  const f = fold(t), parent = f.area.parentElement;
  assert.ok(f.owner.mutations.targets.some(w => w.target === parent && w.options.attributeFilter.includes(name)));
  parent.setAttribute(name, 'changed'); f.host.children[0].height += 10;
  f.owner.mutations.queued.push({type:'attributes',target:parent,attributeName:name,oldValue:null});
  f.owner.soon(); assert.equal(f.frames.size, 1); f.flush(); assert.ok(f.count().reads > 0);
});

test('1255 current-row disclosure, removed rows and hidden-to-visible rows use current geometry', t => {
  const f = fold(t), row = f.host.children[8];
  row.setAttribute('aria-current', 'page');
  f.change([{type:'attributes',target:row,attributeName:'aria-current',oldValue:null}]); f.flush();
  assert.ok(f.area.hasAttribute('data-topic-current'));
  row.removeAttribute('aria-current'); row.hidden = true; row.setAttribute('hidden', '');
  f.change([{type:'attributes',target:row,attributeName:'hidden',oldValue:null}]); f.flush();
  assert.equal(row.dataset.railFold, undefined);
  row.hidden = false; row.removeAttribute('hidden'); f.change([{type:'attributes',target:row,attributeName:'hidden',oldValue:''}]); f.flush();
  assert.equal(row.dataset.railFold, 'past');
  for (const child of [...f.host.children].slice(6)) child.remove();
  f.change([{type:'childList',target:f.host}]); f.flush(); assert.equal(f.area.hasAttribute('data-topic-fold'), false);
});

test('1255 resize notification invalidates geometry and disposal fences late callbacks', t => {
  const f = fold(t);
  f.host.children[0].height = 62;
  f.owner.sizes.callback(); f.flush(); assert.ok(f.count().reads > 0);
  f.reset(); f.owner.sizes.callback(); assert.equal(f.frames.size, 1);
  f.owner.dispose(); f.flush();
  f.owner.mutations.callback([{type:'childList',target:f.host}]);
  f.owner.sizes.callback(); f.owner.soon(); f.flush();
  assert.equal(f.count().reads, 0); assert.equal(f.frames.size, 0);
});

function stars(t) {
  let callback, scans = 0;
  class Observer { constructor(fn) { callback = fn; } observe() {} }
  const outline = {doc:{defaultView:{MutationObserver:Observer}},list:{querySelectorAll() { scans++; return []; }},host:{closest:()=>null},handles:{}};
  const owner = new OutlineDossiers(outline);
  return {owner, callback:records=>callback(records), scans:()=>scans, outline};
}

test('1255 starred-child paint does not rescan topic geometry; parent topology still does', t => {
  const f = stars(t), inside = {closest:()=>({})};
  f.callback([{type:'childList',target:inside}]);
  assert.equal(f.scans(), 0);
  f.callback([{type:'childList',target:{closest:()=>null}}]);
  assert.equal(f.scans(), 1);
});

test('1255 one refresh takes one current parent scan and retains read results', async t => {
  const f = stars(t); assert.deepEqual(await f.owner.refresh(), []);
  assert.equal(f.scans(), 1);
});
