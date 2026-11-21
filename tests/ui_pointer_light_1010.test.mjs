// Bounded preference/routing checks; real input and paint are held by the native driver.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
const sourceRoot=process.env.POINTER_LIGHT_SOURCE??fileURLToPath(new URL('..',import.meta.url));
const { FeedPassages } = await import(pathToFileURL(join(sourceRoot,'web/feed-passages.mjs')));
const { Reader } = await import(pathToFileURL(join(sourceRoot,'web/reader.mjs')));
const { formatWords } = await import(pathToFileURL(join(sourceRoot,'web/message-format.mjs')));
import { doc as textDoc } from './text_display_768_fixtures.mjs';

function switches(saved = new Map(), blocked = false) {
  class Node {
    constructor(tag = 'span') { Object.assign(this, {tag,children:[],dataset:{},className:'',attributes:{},handlers:{},style:{setProperty(){}}}); }
    append(n) { n.remove(); this.children.push(n); n.parentElement=this; }
    remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null; }
    setAttribute(k,v) { this.attributes[k]=v; }
    getAttribute(k) { return this.attributes[k]; }
    addEventListener(k,fn) { this.handlers[k]=fn; }
    click() { this.handlers.click(); }
    getBoundingClientRect() { return {width:120}; }
    querySelectorAll(selector) { return this.children.flatMap(n=>[n,...n.querySelectorAll('*')]).filter(n=>selector==='*'||selector==='button'&&n.tag==='button'||selector==='.look-switch-name'&&n.className==='look-switch-name'||selector.startsWith('.look-switch[')&&n.className==='look-switch'&&n.dataset.switch===selector.match(/="(.*?)"/)[1]); }
    querySelector(s) { return this.querySelectorAll(s)[0]??null; }
  }
  const root=new Node('html');let foot=new Node('footer');root.append(foot);const observers=[];
  const doc={documentElement:root,readyState:'complete',createElement:t=>new Node(t),querySelector:s=>s==='.rail-foot'?foot:null,querySelectorAll:s=>root.querySelectorAll(s)};
  vm.runInNewContext(readFileSync(join(sourceRoot,'web/look.mjs'),'utf8'),{document:doc,localStorage:{getItem(k){if(blocked)throw Error('blocked');return saved.get(k)??null;},setItem(k,v){if(blocked)throw Error('blocked');saved.set(k,v);},removeItem(k){if(blocked)throw Error('blocked');saved.delete(k);}},ResizeObserver:class{observe(){}},MutationObserver:class{constructor(fn){observers.push(fn);}observe(){}}});
  const group=()=>root.querySelectorAll('.look-switch[data-switch="pointerLight"]')[0];
  return {root,saved,group,button:label=>{const b=group()?.children.find(n=>n.textContent===label);assert.ok(b,`the switch has ${label}`);return b;},replaceFoot(){foot.remove();foot=new Node('footer');root.append(foot);observers.forEach(fn=>fn());return foot;}};
}

test('1010 device switch defaults on, names both choices and stays beside Quiet/Vivid',()=>{
  const f=switches();assert.ok(f.group(),'pointer-light group mounted');
  assert.equal(f.button('Light on').getAttribute('aria-pressed'),'true');
  assert.equal(f.button('Light off').getAttribute('aria-pressed'),'false');
  const groups=f.group().parentElement.children;
  assert.equal(groups[groups.indexOf(f.group())-1].dataset.switch,'agentColors');
});
test('1010 off survives reload and footer remount without changing another device preference',()=>{
  const saved=new Map([['theseus-look','paper'],['theseus-agent-colors','vivid'],['theseus-bench','umber']]);
  const f=switches(saved);f.button('Light off').click();assert.equal(f.root.dataset.pointerLight,'off');
  assert.equal(saved.get('theseus-pointer-light'),'off');
  const g=switches(saved);assert.equal(g.button('Light off').getAttribute('aria-pressed'),'true');
  assert.equal(g.root.dataset.look,'paper');assert.equal(g.root.dataset.agentColors,'vivid');assert.equal(g.root.dataset.bench,'umber');
  const original=g.group();g.replaceFoot();assert.equal(g.group(),original);assert.equal(g.group().parentElement.children.filter(n=>n.dataset.switch==='pointerLight').length,1);
  g.button('Light on').click();assert.equal(g.root.dataset.pointerLight,undefined);assert.equal(saved.has('theseus-pointer-light'),false);
});
test('1010 unknown saved value defaults on and refused storage still holds this page choice',()=>{
  const a=switches(new Map([['theseus-pointer-light','garbage']]));assert.equal(a.button('Light on').getAttribute('aria-pressed'),'true');
  const b=switches(new Map(),true);b.button('Light off').click();assert.equal(b.root.dataset.pointerLight,'off');b.replaceFoot();assert.equal(b.button('Light off').getAttribute('aria-pressed'),'true');
});

function passages() {
  const watched=[],handlers={},viewHandlers={},root={dataset:{}},selected={isCollapsed:true,rangeCount:0};
  const doc={documentElement:root,getSelection:()=>selected,addEventListener(){},defaultView:{addEventListener(type,fn){viewHandlers[type]=fn;},MutationObserver:class{constructor(fn){this.fn=fn;}observe(target,options){this.connected=true;watched.push({target,options,fn:this.fn});}disconnect(){this.connected=false;}},ResizeObserver:class{observe(){}disconnect(){}},Highlight:class{},CSS:{highlights:new Map()}}};
  const host={addEventListener:(name,fn)=>{(handlers[name]??=[]).push(fn);}};
  const words=textDoc.createElement('div');formatWords(words,'Alpha sentence. Beta sentence.',{revision:3});
  const entry={};const p=new FeedPassages({host,doc,entryOf:()=>entry,lights:()=>true,wordsOf:()=>words});
  // Geometry and paint are native checks; retain real passage ownership/quote/clear paths here.
  p.paint=()=>{};p.at=()=>({words,span:{start:0,end:15}});
  return {p,doc,entry,words,root,handlers,viewHandlers,off(){root.dataset.pointerLight='off';},flush(){watched.filter(w=>w.target===root&&w.options.attributes).forEach(w=>w.fn());}};
}
test('1010 pointer off gates feed/dossier/Notebook passage moves and Shift-presses',()=>{
  const f=passages();f.off();f.p.point({pointerType:'mouse',buttons:0,clientX:10,clientY:20},f.entry);assert.equal(f.p.lit,null);
  f.handlers.pointerdown.forEach(fn=>fn({target:{},shiftKey:true,button:0,pointerType:'mouse',clientX:10,clientY:20}));assert.equal(f.p.lit,null);assert.equal(f.p.shifted,false);
});
test('1010 changing off clears an already lit passage and its field without a later pointer event',()=>{
  const f=passages();f.p.light(f.entry,{words:f.words,span:{start:0,end:15}});assert.equal(f.p.chosen(f.entry).text,'Alpha sentence.');
  const removed=[];f.p.fielded=[{style:{removeProperty:name=>removed.push(name)}}];f.off();f.flush();
  assert.equal(f.p.lit,null);assert.ok(removed.includes('background-image'));assert.equal(f.p.chosen(f.entry),null);assert.equal(f.p.copied(f.entry),null);
});
test('1010 off cannot consume a stale passage even before preference notification; explicit selection still quotes',()=>{
  const f=passages();f.p.light(f.entry,{words:f.words,span:{start:0,end:15}});f.off();assert.equal(f.p.chosen(f.entry),null);assert.equal(f.p.copied(f.entry),null);
  f.p.selected=()=>({start:16,end:30,text:'Beta sentence.'});assert.deepEqual(f.p.chosen(f.entry),{start:16,end:30,text:'Beta sentence.',revision:3});
});
test('1010 on restores passage selection on a fresh move and does not intercept a touch move',()=>{
  const f=passages();f.off();f.flush();delete f.root.dataset.pointerLight;f.p.point({pointerType:'mouse',buttons:0,clientX:10,clientY:20},f.entry);assert.equal(f.p.chosen(f.entry).text,'Alpha sentence.');
  f.p.clear();f.p.point({pointerType:'touch',buttons:0,clientX:10,clientY:20},f.entry);assert.equal(f.p.lit,null);
});
function reader(t) {
  const before={window:globalThis.window,document:globalThis.document};
  const doc={documentElement:{dataset:{pointerLight:'off'}}};globalThis.document=doc;globalThis.window={getSelection:()=>({isCollapsed:true,rangeCount:0})};t.after(()=>Object.assign(globalThis,before));
  const span={dataset:{start:'0',end:'15'},closest(){return this;},classList:{toggle(){}}};
  const body={ownerDocument:doc,children:[span],contains:()=>true,querySelectorAll:()=>[]};
  const r=Object.assign(Object.create(Reader.prototype),{sourceBody:body,source:{body:'Alpha sentence. Beta sentence.'},hover:null,paintQuote(){}});
  return {r,span,doc};
}
test('1010 off gates Reader passage presses/extension without stealing a native selection',t=>{
  const {r,span}=reader(t);let adopted=0;r.adoptSelection=()=>adopted++;r.light(span,true,true);assert.equal(r.hover,null);assert.equal(adopted,0);
});
test('1010 Reader ignores stale pointer range while off and retains selected source offsets',t=>{
  const {r}=reader(t);r.hover={start:0,end:15};assert.equal(r.selectedRange(),null);
  globalThis.window.getSelection=()=>({rangeCount:1,isCollapsed:false,getRangeAt:()=>({startContainer:{},endContainer:{},startOffset:16,endOffset:30})});r.sourceOffset=(_n,offset)=>offset;
  assert.deepEqual(r.selectedRange(),{start:16,end:30});assert.equal(r.selectedPassage(),'Beta sentence.');
});

test('1010 page retirement disconnects the preference observer and clears its old light; cached pages keep observing',()=>{
 const f=passages();f.p.light(f.entry,{words:f.words,span:{start:0,end:15}});assert.equal(typeof f.viewHandlers.pagehide,'function','scoped pagehide owns observer retirement');f.viewHandlers.pagehide({persisted:false});assert.equal(f.p.lightSetting.connected,false);assert.equal(f.p.lit,null);
 const cached=passages();cached.p.light(cached.entry,{words:cached.words,span:{start:0,end:15}});cached.viewHandlers.pagehide({persisted:true});assert.equal(cached.p.lightSetting.connected,true,'BFCache may return this same page');assert.equal(cached.p.lit,null);
});
