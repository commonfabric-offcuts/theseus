import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { held785, solid785, capture785, read785, pill785, rect785, frames785, allExpressions785, expressions785, staleInit785 } from './reading_785_oracle.mjs';
import { reading785Checks, names785 } from './reading_785_native.mjs';
import { readingChecks } from './topic_reading_native.mjs';
const source=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const cut=s=>s.slice(s.indexOf('let roomy = null, listAnchor'),s.indexOf('// The New line, just below the oldest message'));
const sha=s=>createHash('sha256').update(s).digest('hex');
function model(s=source) {
 const listeners=new Set(),frames=new Map(),observers=[],nodes=[],scrolls=[];let serial=0;
 const win={scrollY:300,addEventListener:(k,f)=>listeners.add(f),removeEventListener:(k,f)=>listeners.delete(f),scrollBy:({top})=>{win.scrollY+=top;scrolls.push(top)}};
 const node=(id,y,h=160)=>{const e={id,dataset:{id,seq:String(nodes.length+1)},isConnected:true,hidden:false,y,h,children:[],style:{setProperty:(k,v)=>{e.y+=parseFloat(v)},removeProperty:()=>{}},contains:n=>n===e||e.children.includes(n),getBoundingClientRect:()=>({top:e.y-win.scrollY,bottom:e.y+e.h-win.scrollY,left:20,right:420,width:400,height:e.h}),getClientRects:()=>e.hidden?[]:[e.getBoundingClientRect()],compareDocumentPosition:n=>nodes.indexOf(n)>nodes.indexOf(e)?4:0,querySelectorAll:()=>[],addEventListener:(k,f)=>listeners.add(f),removeEventListener:(k,f)=>listeners.delete(f)};return e;};
 const list=node('messages',100),main=node('main',0),home=node('new-message-sheet',4000);home.parentElement=list;home.open=false;home.contains=()=>false;
 list.contains=n=>nodes.includes(n);list.querySelectorAll=()=>nodes;main.children=[list];main.contains=n=>n===list||nodes.includes(n);
 nodes.push(node('a',250),node('b',450),node('c',650));
 const document={activeElement:null,documentElement:{scrollHeight:5000},body:{},querySelectorAll:()=>nodes.filter(e=>!e.hidden),addEventListener:(k,f)=>listeners.add(f),removeEventListener:(k,f)=>listeners.delete(f),caretPositionFromPoint:()=>null};
 const Observer=class {constructor(cb){this.cb=cb;this.observed=new Set();this.disconnected=false;observers.push(this)}observe(n){this.observed.add(n)}unobserve(n){this.observed.delete(n)}disconnect(){this.observed.clear();this.disconnected=true}takeRecords(){return []}};
 const context=vm.createContext({window:win,document,innerWidth:600,innerHeight:800,Node:{DOCUMENT_POSITION_FOLLOWING:4,TEXT_NODE:3},inline:null,registry:{},retired:null,entries:()=>nodes,drawn:(l,id)=>nodes.some(n=>n.dataset.id===id&&!n.hidden),typingField:()=>false,views:{messages:new Map()},bootstrap:{actor:'viewer'},messageEntries:new Map(),button:()=>{throw Error('unexpected offer')},$:id=>({messages:list,main,'new-message-sheet':home})[id],opened:e=>e,ResizeObserver:Observer,MutationObserver:Observer,requestAnimationFrame:f=>{frames.set(++serial,f);return serial},cancelAnimationFrame:id=>frames.delete(id)});
 vm.runInContext(cut(s)+`;globalThis.api785={captureListAnchor,restoreListAnchor,keepListAnchor,watchListAnchor,rememberListAnchor,stop:()=>anchorWatch.stop(),settle:()=>anchorWatch.mutations.cb(),act:()=>[...[]],state:()=>({anchorActing,anchorDepth,listAnchor})};`,context);
 return {context,api:context.api785,win,nodes,list,main,document,scrolls,observers,listeners,frames,node};
}
function holdControl(s) {const m=model(s),before=m.nodes[0].getBoundingClientRect().top,saved=m.api.captureListAnchor();for(const n of m.nodes)n.y+=135;m.api.restoreListAnchor(saved);assert.equal(m.nodes[0].getBoundingClientRect().top,before,'actual source absorbs 135px displacement');}
test('item 785 source geometry: repaint height changes hold real identity and successor',()=>{
 holdControl(source);const m=model(),saved=m.api.captureListAnchor(),before=m.nodes[1].getBoundingClientRect().top;m.nodes[0].hidden=true;for(const n of m.nodes)n.y+=70;m.api.restoreListAnchor(saved);assert.equal(m.nodes[1].getBoundingClientRect().top,before,'hidden first card hands hold to exact successor');
});
function moreControl(s) {
 const m=model(s),more=m.node('more-messages',350,40);more.dataset={};m.document.querySelectorAll=()=>[more,...m.nodes];
 const saved=m.api.captureListAnchor();assert.equal(saved.control,more);const edge=more.getBoundingClientRect().top;
 const loaded=m.node('older-loaded',1000);m.nodes.push(loaded);m.api.restoreListAnchor(saved);assert.equal(loaded.getBoundingClientRect().top,edge,'More has its own actual loading destination');
}
test('item 785 More retains requested landing and focused writing stays in its actual field',()=>{
 moreControl(source);const m=model(),field=m.node('writing',400);m.document.activeElement=field;m.context.inline={root:{contains:e=>e===field},field};m.context.registry={inline:{},isCurrent:()=>true};
 const saved=m.api.captureListAnchor(),top=field.getBoundingClientRect().top;assert.equal(saved.anchor,field);field.y+=70;m.api.restoreListAnchor(saved);assert.equal(field.getBoundingClientRect().top,top);
});
test('item 785 exact same reading character range holds internal rewrap',()=>{
 const m=model(),text={nodeType:3,isConnected:true,data:'real exact line',length:15};m.nodes[0].children.push(text);let lineY=300;
 const range={setStart:()=>{},setEnd:()=>{},getClientRects:()=>[1],getBoundingClientRect:()=>({top:lineY-m.win.scrollY})};m.document.caretPositionFromPoint=()=>({offsetNode:text,offset:2});m.document.createRange=()=>range;
 const before=m.api.captureListAnchor();assert.equal(before.point.text,text);lineY+=96;m.api.restoreListAnchor(before);assert.equal(range.getBoundingClientRect().top,0);
});
test('item 785 stale and hidden source cannot scroll; changed character falls back to card',()=>{
 for(const kind of ['retired','disconnected','hidden']){const m=model(),saved=m.api.captureListAnchor();if(kind==='retired')m.context.retired={};if(kind==='disconnected')m.list.isConnected=false;if(kind==='hidden')m.list.hidden=true;m.nodes[0].y+=100;m.api.restoreListAnchor(saved);assert.equal(m.scrolls.length,0,kind);}
 const m=model(),saved=m.api.captureListAnchor(),top=m.nodes[0].getBoundingClientRect().top;saved.point={text:{isConnected:true,data:'new words'},words:'old words',range:{getClientRects:()=>[1],getBoundingClientRect:()=>({top:500})},top:0};m.nodes[0].y+=90;m.api.restoreListAnchor(saved);assert.equal(m.nodes[0].getBoundingClientRect().top,top,'edited text invalidates stale character range and holds actual card');
});
test('item 785 real source observers share hold, accept deliberate scroll, teardown all resources',()=>{
 const m=model();m.api.watchListAnchor();assert.equal(m.observers.length,2);assert.ok(m.observers.every(o=>o.observed.size));
 for(const n of m.nodes)n.y+=80;m.api.settle();assert.equal(m.nodes[0].getBoundingClientRect().top,-50);
 m.win.scrollY+=120;const wanted=m.win.scrollY;m.api.settle();assert.equal(m.win.scrollY,wanted,'own deliberate scroll supersedes old anchor');
 // All event callbacks are capture-owned; invoking here is a model control, never native proof.
 for(const callback of m.listeners)callback();assert.ok(m.frames.size);m.api.stop();assert.ok(m.observers.every(o=>o.disconnected));assert.equal(m.frames.size,0);assert.equal(m.listeners.size,0);
});
test('item 785 applied source mutants are caught and byte restored with restored controls',()=>{
 const dir=mkdtempSync(join(tmpdir(),'reading785-local-')),path=join(dir,'app.mjs'),history=[];
 try {for(const [name,old,replacement,control] of [
  ['no-hold','function restoreListAnchor(saved) {','function restoreListAnchor(saved) { return;',holdControl],
  ['wrong-direction',"top: holdRoom(list, hold,", "top: -holdRoom(list, hold,",holdControl],
  ['More-landing','const landed = control && last ? loadedAfter(list, present, last) : null;','const landed = null;',moreControl],
  ['leaked-resize','mutations.disconnect(); sizes.disconnect();','mutations.disconnect();',s=>{const m=model(s);m.api.watchListAnchor();m.api.stop();assert.ok(m.observers.every(o=>o.disconnected),'both observers disconnected')}],
  ['stale-guard','if (!saved || retired || !saved.list.isConnected || saved.list.hidden) return;','if (!saved) return;',s=>{const m=model(s),saved=m.api.captureListAnchor();m.context.retired={};m.nodes[0].y+=100;m.api.restoreListAnchor(saved);assert.equal(m.scrolls.length,0,'retired source no-op')}]
 ]){assert.equal(source.split(old).length-1,1);writeFileSync(path,source.replace(old,replacement));const applied=readFileSync(path,'utf8');assert.notEqual(sha(applied),sha(source));assert.ok(applied.includes(replacement));assert.throws(()=>control(applied),{name:'AssertionError'},name+' exact control catches source mutation');history.push({name,applied:sha(applied),caught:true});writeFileSync(path,source);assert.equal(sha(readFileSync(path)),sha(source));control(readFileSync(path,'utf8'));history.push({name,restored:sha(readFileSync(path)),control:true});}
 console.log(JSON.stringify({sourceMutations785:history}));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('item 785 exact generated expressions compile and execute with escaped identities below browser',async()=>{
 for(const expr of [...allExpressions785(),...Object.values(expressions785).map(e=>typeof e==='function'?e('id\"\\\n',130):e),staleInit785('topic\"\\\n')])new vm.Script(expr);
 const e={dataset:{id:'real"\\\n'},isConnected:true,getClientRects:()=>[1],getBoundingClientRect:()=>({top:40,bottom:160,left:20,right:420,width:400,height:120})};
 const ctx=vm.createContext({window:{},document:{querySelectorAll:()=>[e],querySelector:()=>e,caretPositionFromPoint:()=>null},innerWidth:600,scrollY:0,requestAnimationFrame:f=>f()});
 const before=vm.runInContext(capture785,ctx);const after=vm.runInContext(read785,ctx);held785(before,after);assert.equal(before.id,e.dataset.id);assert.equal(vm.runInContext(rect785('escaped"\\\n'),ctx).top,40);await vm.runInContext(frames785,ctx);
 const pill={getBoundingClientRect:()=>({top:12,bottom:48,left:160,right:280,width:120,height:36}),hidden:false,style:{left:'20px'},textContent:'New above ↑',contains:()=>true};
 ctx.document.querySelector=s=>s==='.new-above'?pill:e;ctx.document.elementFromPoint=()=>pill;ctx.getComputedStyle=()=>({backgroundColor:'rgb(4, 5, 6)',opacity:'1',boxShadow:'0px 4px 16px rgba(0, 0, 0, 0.18)',transform:'matrix(1,0,0,1,-60,0)'});ctx.CSS={supports:()=>true};ctx.matchMedia=()=>({matches:false});solid785(vm.runInContext(pill785,ctx));
 // Instrument corruption uses the very same assertion called by native cases.
 for(const change of [{top:48},{id:'wrong real anchor'},{offset:3},{words:'wrong writing'}])assert.throws(()=>held785(before,{...after,...change}),{name:'AssertionError'});
 const good=vm.runInContext(pill785,ctx);for(const change of [{top:0},{centre:good.centre+8},{alpha:0.5},{shadow:'none'},{left:-8}])assert.throws(()=>solid785({...good,...change}),{name:'AssertionError'});
});
test('item 785 dry enumeration is exact owned filter with no browser or fixture',async()=>{
 const names=[],forbidden=()=>{throw Error('dry registration attempted fixture or browser work')};await readingChecks({check:async name=>{if(/^reading item 785/.test(name))names.push(name)},page:forbidden,until:forbidden,view:forbidden,control:forbidden,shot:forbidden,facts:{actor:'dry-reader',agent:'dry-agent',origin:'https://fixture.invalid'},observations:[],engine:'chrome'});assert.deepEqual(names,names785);assert.ok(names.every(n=>/^reading item 785/.test(n)));console.log(JSON.stringify({dryEnumeration785:names,count:names.length,route:'actual readingChecks registration'}));
});

test('item 785 exact generated stale-answer gate holds only the old topic and releases once',async()=>{
 const answer={fixture:'old'},win={fetch:async()=>answer};const ctx=vm.createContext({window:win});vm.runInContext(staleInit785('old-topic'),ctx);win.gateReading785=true;
 let settled=false;const old=win.fetch('/api/view',{body:JSON.stringify({name:'topic_messages',args:{topic_id:'old-topic'}})}).then(v=>{settled=true;return v});
 await Promise.resolve();await Promise.resolve();assert.equal(settled,false);assert.equal(win.reading785Pending,1);
 assert.equal(await win.fetch('/api/view',{body:JSON.stringify({name:'topic_messages',args:{topic_id:'destination'}})}),answer,'destination is never held by old-topic gate');
 vm.runInContext(expressions785.release,ctx);assert.equal(await old,answer);assert.equal(settled,true);vm.runInContext(expressions785.release,ctx);
});
