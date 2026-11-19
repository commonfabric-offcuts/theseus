import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { held785, solid785, capture785, read785, pill785, rect785, frames785, allExpressions785, expressions785, staleInit785 } from './reading_785_oracle.mjs';
import { reading785Checks, names785, withRestored785 } from './reading_785_native.mjs';
import { readingChecks } from './topic_reading_native.mjs';
import { traceInit785, sourceProbes785, installTrace785, traceBegin785, traceMark785, traceReceipt785, traceRead785, frontier785, landing785, settlement785, TRACE_LIMIT785, SETTLEMENT_FRAMES785 } from './reading_785_trace.mjs';
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
 const original=native.slice(native.indexOf('export async function withRestored785')).replace('export ','');
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
 const pill={hidden:false,style:{left:'160px'},textContent:'New above ↑',contains:()=>true,getBoundingClientRect:()=>({top:12,bottom:48,left:160,right:280,width:120,height:36})};
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
 const saved={anchor:node,tops:new Map([[node,160]]),y:0,newest:50};Object.assign(ctx,{anchor:node,tops:saved.tops,point:null,saved,listAnchor:saved,hold:node,anchorActing:false,anchorDepth:0,kind:'messages',views:{olderCursor:55,messages:new Map([['real-anchor',{}]])}});
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
test('item 785 fixed settlement preserves acceptance -1 and retirement 0 as separate predicates',async()=>{
 const {ctx,node}=traceContext785();let top=-0.5,frames=0;node.getBoundingClientRect=()=>({top,bottom:100,left:10,right:410});node.contains=()=>true;node.closest=()=>node;node.classList={contains:()=>false};node.hidden=true;
 ctx.document.querySelector=s=>s==='.new-above'?null:node;ctx.requestAnimationFrame=f=>{frames++;f()};
 const state=vm.runInContext(landing785('arrival'),ctx);assert.equal(state.accepts,true);assert.equal(state.retires,false);const settled=await vm.runInContext(settlement785('arrival'),ctx);assert.equal(frames,SETTLEMENT_FRAMES785);assert.equal(settled.length,12);assert.equal(settled.at(-1).arrival.top,-0.5);
 top=-8;assert.equal(vm.runInContext(landing785('arrival'),ctx).accepts,false,'8px position fault cannot pass arrivalSightPx=1');
 top=0.5;assert.equal(vm.runInContext(landing785('arrival'),ctx).retires,true);
 for(const expr of [traceInit785,traceRead785,traceBegin785('hostile"\\\n'),traceMark785('hostile"\\\n'),traceReceipt785('op"\\\n','id"\\\n','committed'),frontier785,landing785('hostile"\\\n'),settlement785('hostile"\\\n')])new vm.Script(expr);
});
test('item 785 applied generated landing and frame faults fail then byte restore their controls',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reading785-settlement-')),path=join(dir,'generated.js');
 const context=top=>{const {ctx,node}=traceContext785();node.getBoundingClientRect=()=>({top,bottom:100,left:10,right:410});node.contains=()=>true;node.closest=()=>node;node.classList={contains:()=>false};ctx.document.querySelector=s=>s==='.new-above'?null:node;return ctx;};
 const controls=[
  ['landing bound',landing785('arrival'),'r.top>=-1','r.top>=-8',async s=>assert.equal(vm.runInContext(s,context(-8)).accepts,false,'8px fault remains outside arrivalSightPx=1')],
  ['retirement predicate',landing785('arrival'),'r.top>=0','r.top>=-1',async s=>assert.equal(vm.runInContext(s,context(-0.5)).retires,false,'negative top cannot retire offer')],
  ['frame budget',settlement785('arrival'),'frame<12','frame<13',async s=>assert.equal((await vm.runInContext(s,context(0.5))).length,12,'fixed frame budget remains twelve')],
 ];
 try{for(const [name,original,target,replacement,control] of controls){assert.equal(original.split(target).length,2);const mutant=original.replace(target,replacement);writeFileSync(path,mutant);assert.notEqual(sha(readFileSync(path)),sha(original));await assert.rejects(control(readFileSync(path,'utf8')),{name:'AssertionError'});writeFileSync(path,original);assert.equal(sha(readFileSync(path)),sha(original));await control(readFileSync(path,'utf8'));console.log(JSON.stringify({settlementInstrument785:{name,applied:sha(mutant),caught:true,restored:sha(original),control:true}}));}}finally{rmSync(dir,{recursive:true,force:true});}
});
