import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const sourceRoot=process.env.LIGHT_COLOURS_SOURCE??fileURLToPath(new URL('..',import.meta.url));
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
  const group=(attr="lightColour")=>root.querySelectorAll(`.look-switch[data-switch="${attr}"]`)[0];
  return {root,saved,group,button:(label,attr="lightColour")=>{const b=group(attr)?.children.find(n=>n.textContent===label);assert.ok(b,`the switch has ${label}`);return b;},replaceFoot(){foot.remove();foot=new Node('footer');root.append(foot);observers.forEach(fn=>fn());return foot;}};
}

test('1024 Middle is the absent default and choices follow Light in order',()=>{
 const f=switches();assert.ok(f.group(),'colour choices mounted');
 assert.deepEqual(f.group().children.map(b=>b.textContent),['lighter','Middle','darker']);
 assert.equal(f.button('Middle').getAttribute('aria-pressed'),'true');assert.equal(f.root.dataset.lightColour,undefined);
 const groups=f.group().parentElement.children;assert.equal(groups[groups.indexOf(f.group())-1].dataset.switch,'pointerLight');
});
test('1024 Light off hides choices, retains chosen colour, and Light on restores them',()=>{
 const f=switches();f.button('lighter').click();f.button('Light off','pointerLight').click();
 assert.equal(f.group().hidden,true);assert.equal(f.root.dataset.lightColour,'lighter');
 f.button('Light on','pointerLight').click();assert.equal(f.group().hidden,false);assert.equal(f.button('lighter').getAttribute('aria-pressed'),'true');
});
test('1024 every colour persists on reload without changing look, intensity or bench',()=>{
 const saved=new Map([['theseus-look','paper'],['theseus-agent-colors','vivid'],['theseus-bench','umber']]);
 for(const [label,value]of [['lighter','lighter'],['darker','darker'],['Middle',undefined]]){
  const f=switches(saved);f.button(label).click();const again=switches(saved);
  assert.equal(again.root.dataset.lightColour,value);assert.equal(again.button(label).getAttribute('aria-pressed'),'true');
  assert.equal(again.root.dataset.look,'paper');assert.equal(again.root.dataset.agentColors,'vivid');assert.equal(again.root.dataset.bench,'umber');
  assert.equal(saved.get('theseus-light-colour'),value);
 }
});
test('1024 invalid and blocked storage follow look owner defaults',()=>{
 const invalid=switches(new Map([['theseus-light-colour','unrecognised']]));assert.equal(invalid.button('Middle').getAttribute('aria-pressed'),'true');
 const blocked=switches(new Map(),true);blocked.button('darker').click();blocked.replaceFoot();assert.equal(blocked.root.dataset.lightColour,'darker');assert.equal(blocked.button('darker').getAttribute('aria-pressed'),'true');
 assert.equal(switches(new Map(),true).button('Middle').getAttribute('aria-pressed'),'true','no persistence claim when storage is blocked');
});
test('1024 remount keeps one colour group, its selection and hidden state',()=>{
 const f=switches();f.button('darker').click();f.button('Light off','pointerLight').click();const group=f.group();
 for(let i=0;i<3;i++){const foot=f.replaceFoot();assert.equal(f.group(),group);assert.equal(foot.querySelectorAll('.look-switch[data-switch="lightColour"]').length,1);assert.equal(group.hidden,true);}
 assert.equal(f.button('darker').getAttribute('aria-pressed'),'true');
});
test('1024 colour survives changing Bookends/Paper and Quiet/Vivid',()=>{
 const f=switches();f.button('lighter').click();for(const [label,attr]of [['Paper','look'],['Vivid','agentColors'],['Bookends','look'],['Quiet','agentColors']]){f.button(label,attr).click();assert.equal(f.root.dataset.lightColour,'lighter');assert.equal(f.button('lighter').getAttribute('aria-pressed'),'true');}
});
