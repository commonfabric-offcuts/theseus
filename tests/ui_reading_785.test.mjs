import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { held785, solid785, capture785, read785, pill785, rect785, frames785, allExpressions785, expressions785, staleInit785 } from './reading_785_oracle.mjs';
import { reading785Checks, names785, withRestored785, moreLanding785, withDiagnostics785 } from './reading_785_native.mjs';
import { readingChecks } from './topic_reading_native.mjs';
import { traceInit785, sourceProbes785, installTrace785, traceBegin785, traceMark785, traceReceipt785, traceRead785, frontier785, landing785, settlement785, TRACE_LIMIT785, SETTLEMENT_FRAMES785, wheelSettlement785 } from './reading_785_trace.mjs';
const source=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const cut=s=>s.slice(s.indexOf('let roomy = null, anchorDepth'),s.indexOf('// The New line, just below the oldest message'));
const sha=s=>createHash('sha256').update(s).digest('hex');
function model(s=source) {
 const events=new Map(), listeners=new Set(),frames=new Map(),observers=[],nodes=[],scrolls=[];let serial=0;
 const listen=(target,k,f)=>{listeners.add(f);events.set(target+':'+k,[...(events.get(target+':'+k)??[]),f]);};
 const unlisten=(target,k,f)=>{listeners.delete(f);events.set(target+':'+k,(events.get(target+':'+k)??[]).filter(cb=>cb!==f));};
 const win={scrollY:300,addEventListener:(k,f)=>listen('window',k,f),removeEventListener:(k,f)=>unlisten('window',k,f),scrollBy:({top})=>{win.scrollY+=top;scrolls.push(top)}};
 const node=(id,y,h=160)=>{const e={id,dataset:{id,seq:String(nodes.length+1)},isConnected:true,hidden:false,y,h,children:[],style:{setProperty:(k,v)=>{e.y+=parseFloat(v)},removeProperty:()=>{}},contains:n=>n===e||e.children.includes(n),getBoundingClientRect:()=>({top:e.y-win.scrollY,bottom:e.y+e.h-win.scrollY,left:20,right:420,width:400,height:e.h}),getClientRects:()=>e.hidden?[]:[e.getBoundingClientRect()],compareDocumentPosition:n=>nodes.indexOf(n)>nodes.indexOf(e)?4:0,querySelectorAll:()=>[],closest:()=>null,addEventListener:(k,f)=>listen(id,k,f),removeEventListener:(k,f)=>unlisten(id,k,f)};return e;};
 const list=node('messages',100),main=node('main',0),home=node('new-message-sheet',4000);home.parentElement=list;home.open=false;home.contains=()=>false;
 list.contains=n=>nodes.includes(n);list.querySelectorAll=()=>nodes;main.children=[list];main.contains=n=>n===list||nodes.includes(n);main.append=()=>{};
 const listBox=list.getBoundingClientRect;list.getBoundingClientRect=()=>({...listBox(),height:nodes.reduce((n,e)=>n+(e.hidden?0:e.h),0)});
 nodes.push(node('a',250),node('b',450),node('c',650));
 const document={activeElement:null,documentElement:{scrollHeight:5000},body:{},querySelectorAll:()=>nodes.filter(e=>!e.hidden),addEventListener:(k,f)=>listen('document',k,f),removeEventListener:(k,f)=>unlisten('document',k,f),caretPositionFromPoint:()=>null};
 const Observer=class {constructor(cb){this.cb=cb;this.observed=new Set();this.disconnected=false;observers.push(this)}observe(n){this.observed.add(n)}unobserve(n){this.observed.delete(n)}disconnect(){this.observed.clear();this.disconnected=true}takeRecords(){return []}};
 const context=vm.createContext({windowReadSerial:0,window:win,document,innerWidth:600,innerHeight:800,Node:{DOCUMENT_POSITION_FOLLOWING:4,TEXT_NODE:3},inline:null,registry:{},retired:null,topicUnavailable:false,authorityReviewPending:()=>false,entries:()=>nodes,drawn:(l,id)=>nodes.some(n=>n.dataset.id===id&&!n.hidden),typingField:()=>false,views:{messages:new Map()},bootstrap:{actor:'viewer'},messageEntries:new Map(),topic:{id:'isolated-topic'},stackState:()=>({stacks:[]}),cardIn:e=>e,reveal:()=>{},button:(text,activate)=>({activate,style:{},setAttribute:()=>{}}),$:id=>({messages:list,main,'new-message-sheet':home})[id],opened:e=>e,ResizeObserver:Observer,MutationObserver:Observer,requestAnimationFrame:f=>{frames.set(++serial,f);return serial},cancelAnimationFrame:id=>frames.delete(id)});
 vm.runInContext(cut(s)+`;globalThis.api785={captureListAnchor,recordListArrivals,restoreListAnchor,keepListAnchor,watchListAnchor,rememberListAnchor,paintNewAbove,offers:newAbove,pill:()=>newAboveButton,stop:()=>anchorWatch.stop(),settle:(records=[])=>anchorWatch.mutations.cb(records),act:()=>[...[]],state:()=>({anchorActing,anchorDepth,anchorHold})};`,context);
 // Real model arrivals populate the same accepted-record and entry maps used
 // by the product repaint producer. A test-only ownership token grants nothing.
 const insertArrival=height=>{const seq=Math.max(...nodes.map(n=>Number(n.dataset.seq)))+1,id='arrival-'+seq,e=node(id,nodes[0].y,height);e.dataset.seq=String(seq);for(const n of nodes)n.y+=height;nodes.unshift(e);const item={id,seq,topic_id:'isolated-topic',author_id:'outside'};context.views.messages.set(id,item);context.messageEntries.set(id,e);return e;};
 return {context,api:context.api785,win,nodes,list,main,document,scrolls,observers,listeners,frames,node,
  record:(saved,height)=>{const e=insertArrival(height);context.api785.recordListArrivals(saved);return e;},
  arrive:height=>{let entry;context.api785.keepListAnchor(()=>{entry=insertArrival(height)});return entry;},
  dispatch:(target,kind)=>{for(const f of events.get(target+':'+kind)??[])f();},flush:()=>{const pending=[...frames.values()];frames.clear();for(const f of pending)f();}};
}
function holdControl(s) {const m=model(s),held=m.nodes[0],before=held.getBoundingClientRect().top,saved=m.api.captureListAnchor();m.record(saved,135);m.api.restoreListAnchor(saved);assert.equal(held.getBoundingClientRect().top,before,'actual source absorbs 135px displacement');}
test('item 785 source geometry: repaint height changes hold real identity and successor',()=>{
 holdControl(source);const m=model(),saved=m.api.captureListAnchor(),before=saved.tops.get(saved.anchor);const successor=m.nodes[1];m.nodes[0].hidden=true;m.record(saved,70);m.api.restoreListAnchor(saved);assert.equal(successor.getBoundingClientRect().top,before,'1245: first surviving successor top replaces the vanished anchor viewport position');
});
function moreControl(s) {
 const m=model(s),more=m.node('older-new',350,40);more.dataset={line:'older'};m.document.querySelectorAll=()=>[more,...m.nodes];
 const saved=m.api.captureListAnchor();assert.equal(saved.control,more);const edge=more.getBoundingClientRect().top;
 const loaded=m.node('older-loaded',1000);m.nodes.push(loaded);m.api.restoreListAnchor(saved);assert.equal(loaded.getBoundingClientRect().top,edge,'New keeps its actual older loading destination after1045 retires More');
}
test('item 785 New retains requested older landing and focused writing stays in its actual field',()=>{
 moreControl(source);const m=model(),field=m.node('writing',400);m.document.activeElement=field;m.context.inline={root:{contains:e=>e===field},field};m.context.registry={inline:{},isCurrent:()=>true};
 const saved=m.api.captureListAnchor(),top=field.getBoundingClientRect().top;assert.equal(saved.anchor,field);m.record(saved,70);field.y+=70;m.api.restoreListAnchor(saved);assert.equal(field.getBoundingClientRect().top,top);
});
test('item 785 exact same reading character range holds internal rewrap',()=>{
 const m=model(),text={nodeType:3,isConnected:true,data:'real exact line',length:15};m.nodes[0].children.push(text);let lineY=300;
 const range={setStart:()=>{},setEnd:()=>{},getClientRects:()=>[1],getBoundingClientRect:()=>({top:lineY-m.win.scrollY})};m.document.caretPositionFromPoint=()=>({offsetNode:text,offset:2});m.document.createRange=()=>range;
 const before=m.api.captureListAnchor();assert.equal(before.point.text,text);m.record(before,96);lineY+=96;m.api.restoreListAnchor(before);assert.equal(range.getBoundingClientRect().top,0);
});
test('item 785 stale and hidden source cannot scroll; changed character falls back to card',()=>{
 for(const kind of ['retired','disconnected','hidden']){const m=model(),saved=m.api.captureListAnchor();if(kind==='retired')m.context.retired={};if(kind==='disconnected')m.list.isConnected=false;if(kind==='hidden')m.list.hidden=true;m.record(saved,100);m.api.restoreListAnchor(saved);assert.equal(m.scrolls.length,0,kind);}
 const m=model(),saved=m.api.captureListAnchor(),top=m.nodes[0].getBoundingClientRect().top;saved.point={text:{isConnected:true,data:'new words'},words:'old words',range:{getClientRects:()=>[1],getBoundingClientRect:()=>({top:500})},top:0};const held=m.nodes[0];m.record(saved,90);m.api.restoreListAnchor(saved);assert.equal(held.getBoundingClientRect().top,top,'edited text invalidates stale character range and holds actual card');
});
function unrelatedLayoutControl785(s=source) {
 const m=model(s);m.api.watchListAnchor();const held=m.nodes[0],y=m.win.scrollY;
 for(const n of m.nodes)n.y+=80;m.api.settle();
 assert.equal(held.getBoundingClientRect().top,30,'unrelated layout keeps its own 80px movement');
 assert.equal(m.win.scrollY,y,'no arrival means no compensation');return m;
}
test('item 785 real source observers reject unrelated layout, accept deliberate scroll, teardown all resources',()=>{
 const standing=model().listeners.size,m=unrelatedLayoutControl785();assert.equal(m.observers.length,2);assert.ok(m.observers[1].observed.size);
 m.dispatch('document','wheel');m.flush();m.win.scrollY+=120;const wanted=m.win.scrollY;m.api.settle();assert.equal(m.win.scrollY,wanted,'own deliberate scroll supersedes old anchor');
 // All event callbacks are capture-owned; invoking here is a model control, never native proof.
 for(const callback of m.listeners)callback();assert.ok(m.frames.size);m.api.stop();assert.ok(m.observers.every(o=>o.disconnected));assert.equal(m.frames.size,0);assert.equal(m.listeners.size,standing);
});
test('1247 full capture eviction arrival restore retires every detached hold reference while keeping the surviving anchor',()=>{
 const m=model(),gone=m.nodes.slice(1),anchor=m.nodes[0],before=anchor.getBoundingClientRect().top;
 for(const entry of m.nodes){m.context.views.messages.set(entry.dataset.id,{id:entry.dataset.id,seq:Number(entry.dataset.seq),topic_id:'isolated-topic',author_id:'outside'});m.context.messageEntries.set(entry.dataset.id,entry);}
 Object.assign(m.context,{windowEvictions:new Set(),coldArrivals:null,dropCardDocuments(){},dropCardImages(){},cardScroll:null,cardObserver:null,middleObserver:null,
  halfShown:new Set(),atMiddle:new Set(),openedIds:new Set(),cardReplies:null,messageChanges:null,questionStates:null,visitNew:null,reader:null,messageEdit:null,forgetStackMessages(){},stackFeed:null});
 Object.assign(m.context.views,{windowRoots:new Set(),windowHints:new Map()});
 Object.assign(m.context.registry,{cards:new Map(),current:null,sessions:new Map()});
 for(const entry of gone)entry.remove=()=>{entry.isConnected=false;m.nodes.splice(m.nodes.indexOf(entry),1);};
 vm.runInContext(source.slice(source.indexOf('function queueWindowEvictions'),source.indexOf('async function readWindowGap')),m.context);
 m.api.keepListAnchor(()=>{
  m.arrive(80);
  for(const entry of gone)m.context.views.messages.delete(entry.dataset.id);
  m.context.queueWindowEvictions(gone.map(entry=>entry.dataset.id));m.context.releaseWindowReferences();
 });
 const held=m.api.state().anchorHold;
 assert.ok(held,'the real outer finally retains the valid arrival hold');assert.equal(held.anchor,anchor);assert.equal(anchor.getBoundingClientRect().top,before);
 for(const key of ['cards','held','cardSet','backward','present'])for(const entry of held[key]??[])assert.equal(gone.includes(entry),false,key+' drops retired cards');
 for(const key of ['tops','arrivals','arrivalOwners','arrivalLayout'])for(const entry of held[key]?.keys()??[])assert.equal(gone.includes(entry),false,key+' drops retired cards');
 assert.equal(gone.includes(held.last),false,'last drops retired card');assert.equal(gone.includes(held.control),false,'control drops retired card');
 const arrival=[...held.arrivalOwners.keys()][0];arrival.h+=40;anchor.y+=40;m.list.h+=40;
 // The retained owner still compensates a later size change through the same restore path.
 m.api.restoreListAnchor(held);assert.equal(anchor.getBoundingClientRect().top,before);
});
test('item 785 applied source mutants are caught and byte restored with restored controls',()=>{
 const dir=mkdtempSync(join(tmpdir(),'reading785-local-')),path=join(dir,'app.mjs'),history=[];
 try {for(const [name,old,replacement,control] of [
  ['no-hold','function restoreListAnchor(saved) {','function restoreListAnchor(saved) { return;',holdControl],
  ['wrong-direction',"const delta = holdRoom(list, hold,", "const delta = -holdRoom(list, hold,",holdControl],
  ['More-landing','const landed = control && last ? loadedAfter(list, present, last) : null;','const landed = null;',moreControl],
  ['leaked-resize','mutations.disconnect(); sizes.disconnect();','mutations.disconnect();',s=>{const m=model(s);m.api.watchListAnchor();m.api.stop();assert.ok(m.observers.every(o=>o.disconnected),'both observers disconnected')}],
  ['stale-guard','if (!saved || retired || !saved.list.isConnected || saved.list.hidden) return;','if (!saved) return;',s=>{const m=model(s),saved=m.api.captureListAnchor();m.record(saved,100);m.context.retired={};m.api.restoreListAnchor(saved);assert.equal(m.scrolls.length,0,'retired source no-op')}]
 ]){assert.equal(source.split(old).length-1,1);writeFileSync(path,source.replace(old,replacement));const applied=readFileSync(path,'utf8');assert.notEqual(sha(applied),sha(source));assert.ok(applied.includes(replacement));assert.throws(()=>control(applied),{name:'AssertionError'},name+' exact control catches source mutation');history.push({name,applied:sha(applied),caught:true});writeFileSync(path,source);assert.equal(sha(readFileSync(path)),sha(source));control(readFileSync(path,'utf8'));history.push({name,restored:sha(readFileSync(path)),control:true});}
 console.log(JSON.stringify({sourceMutations785:history}));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('item 785 exact generated expressions compile and execute with escaped identities below browser',async()=>{
 for(const expr of [...allExpressions785(),...Object.values(expressions785).map(e=>typeof e==='function'?e('id\"\\\n',130):e),staleInit785('topic\"\\\n')])new vm.Script(expr);
 const e={dataset:{id:'real"\\\n'},isConnected:true,getClientRects:()=>[1],getBoundingClientRect:()=>({top:40,bottom:160,left:20,right:420,width:400,height:120})};
 const ctx=vm.createContext({window:{},document:{querySelectorAll:()=>[e],querySelector:()=>e,caretPositionFromPoint:()=>null},innerWidth:600,scrollY:0,requestAnimationFrame:f=>f()});
 const before=vm.runInContext(capture785,ctx);const after=vm.runInContext(read785,ctx);held785(before,after);assert.equal(before.id,e.dataset.id);assert.equal(vm.runInContext(rect785('escaped"\\\n'),ctx).top,40);await vm.runInContext(frames785,ctx);
 const pill={getBoundingClientRect:()=>({top:12,bottom:48,left:160,right:280,width:120,height:36}),hidden:false,style:{left:'20px'},textContent:'New above · 1 ↑',contains:()=>true};
 ctx.document.querySelector=s=>s==='.new-above'?pill:e;ctx.document.elementFromPoint=()=>pill;ctx.getComputedStyle=()=>({backgroundColor:'rgb(4, 5, 6)',opacity:'1',boxShadow:'0px 4px 16px rgba(0, 0, 0, 0.18)',transform:'matrix(1,0,0,1,-60,0)'});ctx.CSS={supports:()=>true};ctx.matchMedia=()=>({matches:false});solid785(vm.runInContext(pill785,ctx));
 // Instrument corruption uses the very same assertion called by native cases.
 for(const change of [{top:48},{id:'wrong real anchor'},{offset:3},{words:'wrong writing'}])assert.throws(()=>held785(before,{...after,...change}),{name:'AssertionError'});
 const good=vm.runInContext(pill785,ctx);for(const change of [{top:0},{centre:good.centre+8},{alpha:0.5},{shadow:'none'},{left:-8}])assert.throws(()=>solid785({...good,...change}),{name:'AssertionError'});
});
test('item 785 dry enumeration is exact owned filter with no browser or fixture',async()=>{
 const names=[],allNames=[],forbidden=()=>{throw Error('dry registration attempted fixture or browser work')};await readingChecks({check:async name=>{allNames.push(name);if(/^reading item 785/.test(name))names.push(name)},page:forbidden,until:forbidden,view:forbidden,control:forbidden,shot:forbidden,facts:{actor:'dry-reader',agent:'dry-agent',origin:'https://fixture.invalid'},observations:[],engine:'chrome'});assert.deepEqual(names,names785);assert.ok(names.every(n=>/^reading item 785/.test(n)));console.log(JSON.stringify({dryEnumeration785:names,count:names.length,fullEntrypointCount:allNames.length,fullEntrypointNames:allNames,route:'actual readingChecks registration'}));
});

test('item 785 exact generated stale-answer gate holds only the old topic and releases once',async()=>{
 const answer={fixture:'old'},win={fetch:async()=>answer};const ctx=vm.createContext({window:win});vm.runInContext(staleInit785('old-topic'),ctx);win.gateReading785=true;
 let settled=false;const old=win.fetch('/api/view',{body:JSON.stringify({name:'topic_messages',args:{topic_id:'old-topic'}})}).then(v=>{settled=true;return v});
 await Promise.resolve();await Promise.resolve();assert.equal(settled,false);assert.equal(win.reading785Pending,1);
 assert.equal(await win.fetch('/api/view',{body:JSON.stringify({name:'topic_messages',args:{topic_id:'destination'}})}),answer,'destination is never held by old-topic gate');
 vm.runInContext(expressions785.release,ctx);assert.equal(await old,answer);assert.equal(settled,true);vm.runInContext(expressions785.release,ctx);
});

test('item 785 each outside request explicitly selects its actual topic; omission mutants caught and restored',()=>{
 const native=readFileSync(new URL('./reading_785_native.mjs',import.meta.url),'utf8');
 const requests=[...native.matchAll(/await control\((\{method:'agent_message'.*?\})\)/g)].map(m=>m[1]);
 assert.equal(requests.length,3,'arrival, stale and after-leave requests all covered');
 const dir=mkdtempSync(join(tmpdir(),'reading785-requests-')),path=join(dir,'request.js');
 const control=s=>{const r=vm.runInNewContext('('+s+')',{key:'arrival',topic:'isolated-topic',facts:{actor:'fixture-viewer'},body785:x=>x});assert.equal(r.source,'topic','outside request must select readable topic rather than unreadable first message');assert.equal(r.topic_id,'isolated-topic');return r;};
 try {for(const [index,original] of requests.entries()){
  control(original);assert.equal(original.split("source:'topic',").length,2);
  writeFileSync(path,original.replace("source:'topic',",''));const applied=readFileSync(path,'utf8');assert.notEqual(sha(applied),sha(original));
  assert.throws(()=>control(applied),/outside request must select readable topic/);
  writeFileSync(path,original);assert.equal(sha(readFileSync(path)),sha(original));control(readFileSync(path,'utf8'));
  console.log(JSON.stringify({requestMutation785:index,applied:sha(applied),caught:true,restored:sha(readFileSync(path)),control:true}));
 }}finally{rmSync(dir,{recursive:true,force:true});}
});

test('item 785 restoration preserves both exact exceptions and executes after mutant failure',async()=>{
 const mutant=Error('mutant exact failure'),restored=Error('restored exact failure'),calls=[];
 await assert.rejects(withRestored785(async()=>{calls.push('mutant');throw mutant},async()=>{calls.push('restored');throw restored}),error=>error instanceof AggregateError&&error.errors[0]===mutant&&error.errors[1]===restored);
 assert.deepEqual(calls,['mutant','restored']);
 await assert.rejects(withRestored785(async()=>{throw mutant},async()=>{}),error=>error===mutant);
 await assert.rejects(withRestored785(async()=>{},async()=>{throw restored}),error=>error===restored);
 await withRestored785(async()=>{},async()=>{});
 const native=readFileSync(new URL('./reading_785_native.mjs',import.meta.url),'utf8');
 const original=native.slice(native.indexOf('export async function withRestored785'),native.indexOf('export function moreLanding785')).replace('export ','');
 const control=async s=>{const run=vm.runInNewContext('('+s+')');await assert.rejects(run(async()=>{throw mutant},async()=>{throw restored}),e=>e.errors?.[0]===mutant&&e.errors?.[1]===restored,'both original exceptions retained');};
 const dir=mkdtempSync(join(tmpdir(),'reading785-errors-')),path=join(dir,'restore.js');
 try {const target="catch(error){errors.push(error);}";assert.equal(original.split(target).length,3);
  const changed=original.replace(target,'catch(error){}');writeFileSync(path,changed);assert.notEqual(sha(readFileSync(path)),sha(original));
  await assert.rejects(control(readFileSync(path,'utf8')),/both original exceptions retained/);
  writeFileSync(path,original);assert.equal(sha(readFileSync(path)),sha(original));await control(readFileSync(path,'utf8'));
  console.log(JSON.stringify({errorMutation785:sha(changed),caught:true,restored:sha(original),control:true}));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('item 785 event label survives a separately named mutant phase',()=>{
 const native=readFileSync(new URL('./reading_785_native.mjs',import.meta.url),'utf8');
 const expression=native.match(/const history = (.*);/)[1],observations=[];
 const history=vm.runInNewContext(expression,{observations,engine:'model'});
 history('runtime failure',{phase:'no-hold',error:'exact mutant exception'});
 assert.equal(observations[0].event,'runtime failure');assert.equal(observations[0].phase,'no-hold');assert.equal(observations[0].error,'exact mutant exception');
});

function pillContext785(colour) {
 const pill={hidden:false,style:{left:'160px'},textContent:'New above · 1 ↑',contains:()=>true,getBoundingClientRect:()=>({top:12,bottom:48,left:160,right:280,width:120,height:36})};
 return vm.createContext({document:{querySelector:()=>pill,elementFromPoint:()=>pill},getComputedStyle:()=>({backgroundColor:colour,opacity:'1',boxShadow:'0 4px 16px rgba(0,0,0,.18)',transform:'none'}),CSS:{supports:()=>true},matchMedia:()=>({matches:false}),innerWidth:600});
}
test('item 785 exact generated pill expression reads rgba alpha and solid/transparent/translucent surfaces',()=>{
 const cases=[['rgba(4, 5, 6, 0)',0],['rgba(4, 5, 6, 0.5)',0.5],['rgba(4, 5, 6, 1)',1],['transparent',0],['rgb(4, 5, 6)',1]];
 for(const [colour,alpha] of cases){const p=vm.runInContext(pill785,pillContext785(colour));assert.equal(p.alpha,alpha,colour);if(alpha===1)solid785(p);else assert.throws(()=>solid785(p),/pill surface is opaque/);}
 const file=readFileSync(new URL('./reading_785_oracle.mjs',import.meta.url),'utf8'),original=file.match(/^export const pill785 = (.*);$/m)[1];
 const dir=mkdtempSync(join(tmpdir(),'reading785-alpha-')),path=join(dir,'pill-source.js');
 const control=s=>{const expression=vm.runInNewContext(s);assert.throws(()=>solid785(vm.runInContext(expression,pillContext785('rgba(4, 5, 6, 0)'))),/pill surface is opaque/,'actual generated rgba0 must fail surface oracle');solid785(vm.runInContext(expression,pillContext785('rgba(4, 5, 6, 1)')));};
 try{const mutant=original.replace('String.raw`','`');assert.notEqual(mutant,original);writeFileSync(path,mutant);assert.notEqual(sha(readFileSync(path)),sha(original));assert.throws(()=>control(readFileSync(path,'utf8')),/actual generated rgba0 must fail surface oracle/);writeFileSync(path,original);assert.equal(sha(readFileSync(path)),sha(original));control(readFileSync(path,'utf8'));console.log(JSON.stringify({alphaInstrument785:{applied:sha(mutant),caught:true,restored:sha(original),control:true,generated:pill785}}));}finally{rmSync(dir,{recursive:true,force:true});}
});
test('item 785 actual older line selector and unchanged frontier observational expression; applied locator fault caught',()=>{
 const actual='button.new-line-older[data-line=older]',seen=[],ctx=vm.createContext({window:{__trace785:{frontier:{olderCursor:123,loaded:['real-card']}}},document:{querySelector:s=>{seen.push(s);return s===actual?{hidden:false,disabled:false,getClientRects:()=>[1]}:null},querySelectorAll:()=>[{dataset:{id:'real-card'},getClientRects:()=>[1]}]}});
 const control=s=>assert.equal(vm.runInContext(s,ctx),actual,'actual next-page button selector');
 control(expressions785.olderControl);const before=JSON.stringify(ctx.window.__trace785.frontier);const state=vm.runInContext(frontier785,ctx);assert.equal(state.frontier.olderCursor,123);assert.equal(state.controls[1].available,true);assert.equal(JSON.stringify(ctx.window.__trace785.frontier),before,'inspection preserves actual frontier');
 const dir=mkdtempSync(join(tmpdir(),'reading785-locator-')),path=join(dir,'locator.js'),original=expressions785.olderControl;
 try{const mutant=original.replace(actual,'#new-line-older');writeFileSync(path,mutant);assert.notEqual(sha(readFileSync(path)),sha(original));assert.throws(()=>control(readFileSync(path,'utf8')),/actual next-page button selector/);writeFileSync(path,original);assert.equal(sha(readFileSync(path)),sha(original));control(readFileSync(path,'utf8'));console.log(JSON.stringify({locatorInstrument785:{applied:sha(mutant),caught:true,restored:sha(original),control:true}}));}finally{rmSync(dir,{recursive:true,force:true});}
});
function traceContext785() {
 let clock=0;const listeners={},observer=[];
 const node={dataset:{id:'real-anchor'},id:'',tagName:'BUTTON',isConnected:true,getBoundingClientRect:()=>({top:160,bottom:300,left:10,right:410}),getClientRects:()=>[1]};
 const document={querySelector:()=>node,querySelectorAll:()=>[node],activeElement:node};
 const win={fetch:async()=>({clone:()=>({json:async()=>({items:[{id:'arrival'}],next_cursor:55})})})};
 const ctx=vm.createContext({window:win,document,performance:{now:()=>++clock,timeOrigin:1000},scrollY:0,addEventListener:(kind,fn)=>listeners[kind]=fn,MutationObserver:class{constructor(fn){observer.push(fn)}observe(){}},requestAnimationFrame:fn=>fn(),innerHeight:900});
 vm.runInContext(traceInit785,ctx);return {ctx,win,node,listeners,observer};
}
test('item 785 timestamped trace captures scroll/read/render and unchanged lexical anchor projections, bounded and allowlisted',async()=>{
 const {ctx,win,node,listeners,observer}=traceContext785();vm.runInContext(traceBegin785('test'),ctx);vm.runInContext(traceReceipt785('op','arrival','committed'),ctx);assert.equal(win.__trace785.read().events.find(e=>e.event==='Core receipt observed').id,'arrival');
 listeners.scroll();listeners.scrollend();await win.fetch('/api/view',{body:JSON.stringify({name:'topic_messages',args:{topic_id:'isolated',direction:'after',cursor:50}})});await new Promise(resolve=>setImmediate(resolve));
 // The actual source probe conditions execute against lexical values; these
 // calls are instrument controls, never a synthetic native gesture claim.
 const saved={anchor:node,tops:new Map([[node,160]]),y:0,newest:50};Object.assign(ctx,{anchor:node,tops:saved.tops,point:null,saved,anchorHold:saved,hold:node,anchorActing:false,anchorDepth:0,kind:'messages',views:{olderCursor:55,messages:new Map([['real-anchor',{}]])}});
 for(const probe of sourceProbes785(source)){assert.equal(source.split('\n')[probe.lineNumber],probe.target);assert.equal(vm.runInContext(probe.condition,ctx),false);}
 win.__reading785={e:node};node.querySelectorAll=()=>[node];observer[0]();const trace=vm.runInContext(traceRead785,ctx),events=trace.events;
 for(const event of ['scroll','scrollend','read start','read answer','capture','restore enter','restore after scroll','remember','paint','frontier','DOM render'])assert.ok(events.some(e=>e.event===event),event);
 assert.equal(events.find(e=>e.event==='capture').savedTop,160);assert.equal(events.find(e=>e.event==='restore enter').saved.anchor.id,'real-anchor');assert.equal(trace.frontier.olderCursor,55);
 assert.ok(events.every((e,i)=>Number.isFinite(e.t)&&Number.isFinite(e.epoch)&&(!i||e.t>events[i-1].t)));
 assert.equal(events.find(e=>e.event==='read answer').ids[0],'arrival');
 assert.doesNotMatch(JSON.stringify(trace),/headers|Authorization|token|requestId/);
 for(let i=0;i<TRACE_LIMIT785+10;i++)win.__trace785.record('bounded');assert.equal(win.__trace785.read().events.length,TRACE_LIMIT785);assert.ok(win.__trace785.read().dropped>0);
 const calls=[];await installTrace785({send:async(method,args)=>{calls.push({method,args});return {breakpointId:'owned'}}});assert.equal(calls.filter(c=>c.method==='Debugger.setBreakpointByUrl').length,6);
});
test('item 785 applied trace projection fault fails exact source diagnostic oracle and restores bytes',()=>{
 const original=sourceProbes785(source).find(p=>p.event==='capture').condition,dir=mkdtempSync(join(tmpdir(),'reading785-trace-')),path=join(dir,'condition.js');
 const control=s=>{const {ctx,node,win}=traceContext785();win.__trace785.begin('projection');Object.assign(ctx,{anchor:node,tops:new Map([[node,160]]),point:null});vm.runInContext(s,ctx);assert.equal(win.__trace785.read().events.find(e=>e.event==='capture').savedTop,160,'captured source top must equal actual lexical anchor top');};
 try{const mutant=original.replace('tops.get(anchor)??null','(tops.get(anchor)+8)');writeFileSync(path,mutant);assert.notEqual(sha(readFileSync(path)),sha(original));assert.throws(()=>control(readFileSync(path,'utf8')),/captured source top must equal actual lexical anchor top/);writeFileSync(path,original);assert.equal(sha(readFileSync(path)),sha(original));control(readFileSync(path,'utf8'));console.log(JSON.stringify({traceInstrument785:{applied:sha(mutant),caught:true,restored:sha(original),control:true}}));}finally{rmSync(dir,{recursive:true,force:true});}
});
test('item 785 fixed settlement retains legacy strict visibility separately from accepted activation eligibility',async()=>{
 const {ctx,node}=traceContext785();let top=-0.5,frames=0;node.getBoundingClientRect=()=>({top,bottom:100,left:10,right:410});node.contains=()=>true;node.closest=()=>node;node.classList={contains:()=>false};node.hidden=true;
 ctx.document.querySelector=s=>s==='.new-above'?null:node;ctx.requestAnimationFrame=f=>{frames++;f()};
 const state=vm.runInContext(landing785('arrival'),ctx);assert.equal(state.accepts,true);assert.equal(state.legacyVisible,false);assert.equal(state.retires,true);const settled=await vm.runInContext(settlement785('arrival'),ctx);assert.equal(frames,SETTLEMENT_FRAMES785);assert.equal(settled.length,12);assert.equal(settled.at(-1).arrival.top,-0.5);
 top=-8;assert.equal(vm.runInContext(landing785('arrival'),ctx).accepts,false,'8px position fault cannot pass arrivalSightPx=1');
 top=0.5;assert.equal(vm.runInContext(landing785('arrival'),ctx).retires,true);
 for(const expr of [traceInit785,traceRead785,traceBegin785('hostile"\\\n'),traceMark785('hostile"\\\n'),traceReceipt785('op"\\\n','id"\\\n','committed'),frontier785,landing785('hostile"\\\n'),settlement785('hostile"\\\n')])new vm.Script(expr);
});
test('item 785 applied generated landing and frame faults fail then byte restore their controls',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reading785-settlement-')),path=join(dir,'generated.js');
 const context=top=>{const {ctx,node}=traceContext785();node.getBoundingClientRect=()=>({top,bottom:100,left:10,right:410});node.contains=()=>true;node.closest=()=>node;node.classList={contains:()=>false};ctx.document.querySelector=s=>s==='.new-above'?null:node;return ctx;};
 const controls=[
  ['landing bound',landing785('arrival'),'accepts:!!r&&r.top>=-1','accepts:!!r&&r.top>=-8',async s=>assert.equal(vm.runInContext(s,context(-8)).accepts,false,'8px fault remains outside arrivalSightPx=1')],
  ['retirement predicate',landing785('arrival'),'r.top>=0','r.top>=-1',async s=>assert.equal(vm.runInContext(s,context(-0.5)).legacyVisible,false,'legacy strict visibility remains separately measured')],
  ['frame budget',settlement785('arrival'),'frame<12','frame<13',async s=>assert.equal((await vm.runInContext(s,context(0.5))).length,12,'fixed frame budget remains twelve')],
 ];
 try{for(const [name,original,target,replacement,control] of controls){assert.equal(original.split(target).length,2);const mutant=original.replace(target,replacement);writeFileSync(path,mutant);assert.notEqual(sha(readFileSync(path)),sha(original));await assert.rejects(control(readFileSync(path,'utf8')),{name:'AssertionError'});writeFileSync(path,original);assert.equal(sha(readFileSync(path)),sha(original));await control(readFileSync(path,'utf8'));console.log(JSON.stringify({settlementInstrument785:{name,applied:sha(mutant),caught:true,restored:sha(original),control:true}}));}}finally{rmSync(dir,{recursive:true,force:true});}
});

function retirementControl785(s=source, fault=null) {
 const m=model(s),e=m.nodes[0],other=m.nodes[1];
 e.y=m.win.scrollY-50;other.y=m.win.scrollY-100;
 const message={id:e.dataset.id,topic_id:'isolated-topic'};
 m.context.views.messages.set(e.dataset.id,message);m.context.views.messages.set(other.dataset.id,{id:other.dataset.id,topic_id:'isolated-topic'});m.context.messageEntries.set(e.dataset.id,e);m.context.messageEntries.set(other.dataset.id,other);
 m.api.offers.add(e.dataset.id);m.api.offers.add(other.dataset.id);
 m.api.paintNewAbove();
 e.scrollIntoView=()=>{e.y=m.win.scrollY-0.015625;if(fault==='out-of-sight')e.y=m.win.scrollY-8;};
 e.focus=()=>{m.document.activeElement=e;
  if(fault==='focus')m.document.activeElement=null;
  if(fault==='disconnected')e.isConnected=false;
  if(fault==='hidden')m.list.hidden=true;
  if(fault==='retired')m.context.retired={};
  if(fault==='topic')m.context.topic={id:'another-topic'};
  if(fault==='message')m.context.views.messages.set(e.dataset.id,{...message});
  if(fault==='entry')m.context.messageEntries.set(e.dataset.id,other);
 };
 // Inspect activation retirement before unrelated repaint prunes stale entries.
 vm.runInContext('rememberListAnchor=()=>{}',m.context);
 m.api.pill().activate();
 assert.equal(m.api.offers.has(e.dataset.id),!!fault,'only actually reached current arrival retires, including fractional top');
 assert.equal(m.api.offers.has(other.dataset.id),true,'other unreached arrival keeps its offer');
 return m;
}
test('item 785 reached arrival retires by identity at fractional accepted landing; guards retain unreached offers',()=>{
 retirementControl785();for(const fault of ['focus','disconnected','hidden','retired','topic','message','entry','out-of-sight'])retirementControl785(source,fault);
});
function cssControl785(css) {
 const base=css.match(/(?:^|\n)\.new-above\{([^}]+)\}/)[1];
 const supported=css.match(/@supports \(left:anchor\(--message-column center\)\)\{\.new-above\{([^}]+)\}\}/)?.[1]??'';
 // Model only the actual two positioning declarations; native owns real layout.
 const layout=anchor=>{const declarations=base+(anchor?supported:'');const translated=declarations.includes('transform:translateX(-50%)');const anchored=anchor&&declarations.includes('left:anchor(--message-column center)!important');return {left:(anchored?220:160)-(translated?60:0),translated};};
 assert.equal(layout(false).left,160,'fallback retains legacy inline left edge');
 assert.equal(layout(true).left,160,'supported anchor retains centred pill');
 assert.equal(layout(true).translated,true,'supported layout keeps half-width translation');
}
test('item 785 fallback translation is scoped to supported anchor layout',()=>cssControl785(readFileSync(new URL('../web/aim.css',import.meta.url),'utf8')));

test('item 785 applied retirement and fallback product regressions fail and byte restore',()=>{
 const css=readFileSync(new URL('../web/aim.css',import.meta.url),'utf8'),dir=mkdtempSync(join(tmpdir(),'reading785-product-')),path=join(dir,'source');
 const variants=[['retirement',source,'rect.top >= -1','rect.top >= 0',retirementControl785],['all-offers',source,'newAbove.delete(id);\n      rememberListAnchor();','newAbove.clear();\n      rememberListAnchor();',retirementControl785],['focus-guard',source,'entry.isConnected && drawn(list, id) && card.contains(document.activeElement)','entry.isConnected && drawn(list, id) && true',s=>retirementControl785(s,'focus')],['fallback',css,'@supports (left:anchor(--message-column center)){.new-above{left:anchor(--message-column center)!important;transform:translateX(-50%);}}','.new-above{left:anchor(--message-column center)!important;transform:translateX(-50%);}',cssControl785]];
 try{for(const [name,original,target,replacement,control] of variants){assert.equal(original.split(target).length,2);const changed=original.replace(target,replacement);writeFileSync(path,changed);assert.notEqual(sha(readFileSync(path)),sha(original));assert.throws(()=>control(readFileSync(path,'utf8')),{name:'AssertionError'});writeFileSync(path,original);assert.equal(sha(readFileSync(path)),sha(original));control(readFileSync(path,'utf8'));console.log(JSON.stringify({edgeProduct785:{name,applied:sha(changed),caught:true,restored:sha(original),control:true}}));}}finally{rmSync(dir,{recursive:true,force:true});}
});
async function wheelControl785(expression, mode) {
 const {ctx,win,listeners}=traceContext785();let frame=0;
 vm.runInContext(traceBegin785('wheel control'),ctx);vm.runInContext(traceMark785('native wheel dispatch',{dy:-100000}),ctx);
 ctx.requestAnimationFrame=fn=>{frame++;if(mode==='moving')ctx.scrollY+=8;if(mode==='events')listeners.scroll();if(mode==='ended'&&frame===2)listeners.scrollend();fn()};
 const result=await vm.runInContext(expression,ctx);assert.equal(result.frames.length,12,'wheel settlement stays within fixed12 frames');assert.equal(result.completed,mode==='quiet'||mode==='ended','moving or continued scroll events cannot qualify as completion');if(mode==='ended')assert.equal(result.reason,'observed scrollend');if(mode==='quiet')assert.equal(result.reason,'bounded quiet-frame fallback');return result;
}
test('item 785 exact wheel settlement expression distinguishes completion, quiet fallback and exhausted movement; real fault crosses1px',async()=>{
 for(const mode of ['quiet','ended','moving','events'])await wheelControl785(wheelSettlement785,mode);
 const dir=mkdtempSync(join(tmpdir(),'reading785-wheel-')),path=join(dir,'wheel.js');
 try{const changed=wheelSettlement785.replace('Math.abs(scrollY-y)<=1','Math.abs(scrollY-y)<=8');assert.notEqual(changed,wheelSettlement785);writeFileSync(path,changed);await assert.rejects(wheelControl785(readFileSync(path,'utf8'),'moving'),/cannot qualify as completion/);writeFileSync(path,wheelSettlement785);assert.equal(sha(readFileSync(path)),sha(wheelSettlement785));await wheelControl785(readFileSync(path,'utf8'),'moving');console.log(JSON.stringify({wheelInstrument785:{applied:sha(changed),caught:true,restored:sha(wheelSettlement785),control:true}}));}finally{rmSync(dir,{recursive:true,force:true});}
});
test('item 785 More new below oracle requires exact oldest-unread focus and retained real frontier; applied faults restore',()=>{
 const good={wanted:{id:'oldest'},target:{accepts:true,arrival:{id:'oldest',connected:true},active:{message:'oldest'}},prior:['a'],after:['a','oldest'],moreBefore:{frontier:{loaded:['a'],olderCursor:31}},moreAfter:{frontier:{loaded:['a','oldest'],olderCursor:null}}};moreLanding785(good);
 const original=moreLanding785.toString(),dir=mkdtempSync(join(tmpdir(),'reading785-more-')),path=join(dir,'oracle.js');
 try{for(const [name,target,replacement,bad] of [
 ['wrong target',"state.wanted.id, 'More new below reaches exact oldest-unread identity'","state.target.arrival.id, 'More new below reaches exact oldest-unread identity'",{...good,target:{...good.target,arrival:{id:'other',connected:true}}}],
 ['focus',"state.target.active.message, state.wanted.id","state.wanted.id, state.wanted.id",{...good,target:{...good.target,active:{message:'other'}}}],
 ['frontier',"state.moreBefore.frontier.loaded.every(id=>state.moreAfter.frontier.loaded.includes(id))","true",{...good,moreAfter:{frontier:{loaded:['oldest'],olderCursor:null}}}],
 ]){assert.throws(()=>moreLanding785(bad),{name:'AssertionError'});assert.equal(original.split(target).length,2);const changed=original.replace(target,replacement);writeFileSync(path,changed);assert.notEqual(sha(readFileSync(path)),sha(original));const fn=vm.runInNewContext('('+readFileSync(path,'utf8')+')',{assert});assert.throws(()=>assert.throws(()=>fn(bad),{name:'AssertionError'}),{name:'AssertionError'});writeFileSync(path,original);assert.equal(sha(readFileSync(path)),sha(original));const restored=vm.runInNewContext('('+readFileSync(path,'utf8')+')',{assert});restored(good);assert.throws(()=>restored(bad),{name:'AssertionError'});console.log(JSON.stringify({moreInstrument785:{name,applied:sha(changed),caught:true,restored:sha(original),control:true}}));}}finally{rmSync(dir,{recursive:true,force:true});}
});
test('item 785 failure capture preserves primary and secondary errors separately',async()=>{const primary=Error('primary'),capture=Error('capture');assert.equal(await withDiagnostics785(primary,async()=>{}),primary);const both=await withDiagnostics785(primary,async()=>{throw capture});assert.equal(both.errors[0],primary);assert.equal(both.errors[1],capture);});

// These callbacks model event ordering against real product source; the four
// unchanged native cases remain the browser geometry/gesture proof.
function recordedArrivalControl785(s=source) {
 const m=model(s);for(const n of m.nodes)n.y+=210;
 m.api.watchListAnchor();const held=m.nodes[0],top=held.getBoundingClientRect().top;
 const arrival=m.arrive(135);
 assert.equal(m.context.views.messages.get(arrival.dataset.id).seq,Number(arrival.dataset.seq),'arrival record really exists');
 assert.equal(m.context.messageEntries.get(arrival.dataset.id),arrival,'arrival record owns the painted entry');
 assert.equal(held.getBoundingClientRect().top,top,'recorded arrival above reading compensates its own height');
 // An actual recorded arrival owns its later height, without a new DOM record.
 arrival.h+=40;for(const n of m.nodes)if(n!==arrival)n.y+=40;m.observers[0].cb();
 assert.equal(held.getBoundingClientRect().top,top,'same arrival owns its later height');return {m,held,arrival};
}
function pageScrollControl785(s=source) {
 const {m,held,arrival}=recordedArrivalControl785(s);
 for(const delta of [-50,-35,-20]){m.win.scrollY+=delta;const wanted=m.win.scrollY,top=held.getBoundingClientRect().top;m.dispatch('window','scroll');m.api.settle();assert.equal(m.win.scrollY,wanted,'page-made scroll sticks after arrival restoration');assert.equal(held.getBoundingClientRect().top,top,'page scroll chooses the new reading place');}
 const y=m.win.scrollY;arrival.h+=25;for(const n of m.nodes)if(n!==arrival)n.y+=25;m.observers[0].cb();assert.equal(m.win.scrollY,y,'invalidated arrival cannot reclaim later layout');m.api.stop();
}
test('item 785 recorded arrival owns its own height above reading',()=>{const {m}=recordedArrivalControl785();m.api.stop();});
test('item 785 page-made scrolls stick after arrival restoration',()=>pageScrollControl785());
test('item 785 causal model faults apply, fail and byte restore all three controls',()=>{
 const dir=mkdtempSync(join(tmpdir(),'reading785-causal-')),path=join(dir,'app.mjs');
 const variants=[
  ['unrelated-layout','  const settle = () => {','  const unrelated = captureListAnchor(); const settle = () => { restoreListAnchor(unrelated);',s=>{const m=unrelatedLayoutControl785(s);m.api.stop();}],
  ['page-scroll','if (anchorHold?.y !== window.scrollY || event?.target && event.target !== document && event.target !== window) anchorHold = null;','if (anchorHold) { anchorHold.y = window.scrollY; restoreListAnchor(anchorHold); }',pageScrollControl785],
  ['recorded-arrival','function recordListArrivals(saved, revised = []) {','function recordListArrivals(saved, revised = []) { return;',s=>{const {m}=recordedArrivalControl785(s);m.api.stop();}],
 ];
 try{for(const [name,target,replacement,control] of variants){assert.equal(source.split(target).length,2,'unique causal fault target');const changed=source.replace(target,replacement);writeFileSync(path,changed);assert.notEqual(sha(readFileSync(path)),sha(source));assert.ok(readFileSync(path,'utf8').includes(replacement));assert.throws(()=>control(readFileSync(path,'utf8')),{name:'AssertionError'},name+' control catches real product fault');writeFileSync(path,source);assert.equal(sha(readFileSync(path)),sha(source));control(readFileSync(path,'utf8'));console.log(JSON.stringify({causalArrival785:{name,applied:sha(changed),caught:true,restored:sha(source),control:true}}));}}finally{rmSync(dir,{recursive:true,force:true});}
});
test('item 785 fresh wheel touch scrollbar keys and explicit landing release the restored hold',()=>{
 for(const kind of ['wheel','touchstart','touchmove','pointerdown','keydown']){
  const m=model();m.api.watchListAnchor();m.arrive(80);
  m.dispatch('document',kind);m.flush();m.win.scrollY+=120;const wanted=m.win.scrollY;m.dispatch('window','scroll');m.api.settle();
  assert.equal(m.win.scrollY,wanted,kind+' keeps its own movement');m.api.stop();
 }
 const m=model();m.api.watchListAnchor();m.arrive(80);
 m.win.scrollY+=120;const wanted=m.win.scrollY;m.api.rememberListAnchor(true);m.dispatch('window','scroll');assert.equal(m.win.scrollY,wanted,'explicit landing keeps its destination');m.api.stop();
});
test('item 785 composed acted card survives redraw during the captured personal action frame',()=>{
 const m=model();m.api.watchListAnchor();m.dispatch('document','pointerdown');
 const acted=m.nodes[1],top=acted.getBoundingClientRect().top;
 m.api.keepListAnchor(()=>{for(const n of m.nodes)n.y+=80;},{id:acted.dataset.id,anchor:acted});
 assert.equal(acted.getBoundingClientRect().top,top,'810 cardAct remains honored during pointer frame');m.api.stop();
});

test('item 785 composed acted identity resolves its replacement instead of holding a disconnected card',()=>{
 const m=model();m.api.watchListAnchor();const old=m.nodes[1],top=old.getBoundingClientRect().top;
 m.api.keepListAnchor(()=>{old.isConnected=false;m.nodes[1]=m.node(old.dataset.id,old.y+100);},{id:old.dataset.id,anchor:old});
 assert.equal(m.nodes[1].getBoundingClientRect().top,top,'replacement keeps actual acted identity top');m.api.stop();
});
