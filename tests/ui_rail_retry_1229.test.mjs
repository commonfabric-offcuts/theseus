// Quiet local-load ownership, below the browser. Native gestures/layout stay
// with the owned browser comparison; these tests enter the real read owners.
import test from 'node:test';
import assert from 'node:assert/strict';
import {OutlineDossiers} from '../web/outline-dossiers.mjs';
import {ThingsRail} from '../web/things-rail.mjs';
import {reloader} from '../web/live.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){let id=0;const jobs=new Map();return {jobs,setTimeout(fn,ms){jobs.set(++id,{fn,ms});return id;},clearTimeout(id){jobs.delete(id);},async next(){const first=[...jobs][0];assert.ok(first,'a later retry is owned');jobs.delete(first[0]);await first[1].fn();await tick();}};}
const busy=()=>Object.assign(Error('read lane busy'),{code:'SERVER_BUSY'});
function stars(){
  const timers=clock(),listeners={},parents=[];let calls=0,failures=1,paints=[];
  const doc={visibilityState:'visible',defaultView:{MutationObserver:class{observe(){} disconnect(){}}},addEventListener(name,fn){listeners[name]=fn;},createElement(){return {dataset:{},setAttribute(){},remove(){}};}};
  const parent={dataset:{topicId:'t1'},nextElementSibling:null,getClientRects:()=>[{}],closest:()=>null,after(box){this.nextElementSibling=box;}};
  const handles={bootstrap:{instance_id:'i1'}};
  const outline={doc,handles,host:{closest:()=>null},list:{querySelectorAll:()=>parents},async read(name,args){calls++;assert.equal(name,'stars');assert.equal(args.topic_id,'t1');if(failures-->0)throw busy();return {instance_id:'i1',items:[{topic_id:'t1',star:2,dossier:{id:'fresh'}}],next_cursor:null};}};
  const owner=new OutlineDossiers(outline,{timers});owner.paint=state=>paints.push(state.stars.map(x=>x.dossier.id));
  return {owner,outline,doc,parent,parents,timers,listeners,paints,calls:()=>calls,fail:()=>{failures=1;}};
}
test('first-visible starred read retries without a commit and preserves retained stars',async()=>{
  const f=stars();f.parents.push(f.parent);f.owner.sync();const state=f.owner.states.get('t1');state.stars=[{dossier:{id:'last-good'}}];
  await state.busy;assert.deepEqual(state.stars.map(x=>x.dossier.id),['last-good']);assert.deepEqual(f.paints,[]);assert.equal(f.timers.jobs.size,1);
  await f.timers.next();assert.equal(f.calls(),2);assert.deepEqual(state.stars.map(x=>x.dossier.id),['fresh']);assert.equal(f.timers.jobs.size,0);
});
test('star retries retire when a row hides, the page hides or navigation begins',async()=>{
  for(const action of ['row','page','navigate']){
    const f=stars();f.parents.push(f.parent);f.owner.sync();await f.owner.states.get('t1').busy;assert.equal(f.timers.jobs.size,1);
    if(action==='row'){f.parents.length=0;f.owner.sync();}
    if(action==='page'){f.doc.visibilityState='hidden';f.listeners.visibilitychange();}
    if(action==='navigate')f.owner.begin();
    assert.equal(f.timers.jobs.size,0,action);await tick();assert.equal(f.calls(),1,action);
  }
});
test('a local star typed refusal does not turn into an automatic retry',async()=>{
  const f=stars();f.outline.read=async()=>{throw Object.assign(Error('authority moved'),{code:'AUTHORITY_CHANGED'});};f.parents.push(f.parent);f.owner.sync();const state=f.owner.states.get('t1');await state.busy;
  assert.equal(state.error.kind,'authority');assert.equal(f.timers.jobs.size,0);
});
function things(){
  const timers=clock(),attrs=new Map();let failures=1,calls=0,paints=[];
  const control={setAttribute(){},focus(){},remove(){}};
  const rail=Object.assign(Object.create(ThingsRail.prototype),{timers,retryTimer:null,retryFailures:0,serial:0,stale:true,drawnOnce:false,host:{hidden:false},wide:{matches:false},doc:{visibilityState:'visible',documentElement:{hasAttribute:key=>attrs.has(key),setAttribute:(key,value)=>attrs.set(key,value),removeAttribute:key=>attrs.delete(key)},querySelector:()=>null},backdrop:{hidden:true},closer:{focus(){}},creators:new Map(),kept:new Map(),holder:{removeAttribute(){},setAttribute(){}},message:{hidden:true},retry:{hidden:true},control:()=>control,cover(){},clear(){},paint(value){paints.push(value);},readPipeline:(view)=>view('pipeline',{}),readNotebook:(view)=>view('memory_items',{}),links:{read:handles=>handles.view('workspace_links',{})}});
  const handles={workspaceId:'w1',bootstrap:{instance_id:'i1'},topic:{id:'t1',workspace_id:'w1',title:'Topic',version:2},readable:()=>true,async view(name){calls++;if(name==='topic_tools'&&failures-->0)throw busy();return name==='topic_tools'?{linked:[]}:{items:name==='topic_messages'?[{id:'fresh',body:'new'}]:[]};}};
  rail.handles=handles;rail.reload=reloader(()=>rail.load());
  return {rail,handles,timers,paints,calls:()=>calls};
}
test('first-open ThingsRail retries without a commit and keeps its last presentation quiet',async()=>{
  const f=things();f.rail.lastPresentation={messages:['last-good']};f.rail.open();await tick();
  assert.deepEqual(f.paints,[]);assert.equal(f.rail.message.hidden,true);assert.equal(f.rail.stale,true);assert.equal(f.timers.jobs.size,1);
  await f.timers.next();assert.equal(f.paints.length,1);assert.equal(f.paints[0].messages[0].id,'fresh');assert.equal(f.rail.stale,false);assert.equal(f.timers.jobs.size,0);
});
test('ThingsRail retry retires on closing, navigation, or authority unreadability',async()=>{
  for(const action of ['close','navigate','authority']){
    const f=things();f.rail.open();await tick();const before=f.calls();assert.equal(f.timers.jobs.size,1);
    if(action==='close')f.rail.close(false);
    if(action==='navigate')f.rail.begin(false,{kind:'root'});
    if(action==='authority'){f.handles.readable=()=>false;await f.timers.next();}
    assert.equal(f.timers.jobs.size,0,action);await tick();assert.equal(f.calls(),before,action);assert.deepEqual(f.paints,[],action);
  }
});
test('a late ThingsRail answer cannot paint or schedule old-route work after navigation',async()=>{
  const f=things();let release;f.handles.view=async name=>{if(name==='topic_tools')return new Promise(resolve=>release=resolve);return {items:[]};};
  f.rail.open();await tick();f.rail.begin(false,{kind:'root'});release({linked:[]});await tick();assert.deepEqual(f.paints,[]);assert.equal(f.timers.jobs.size,0);
});

test('a retained-star retry resumes on visibility return without a commit',async()=>{
  const f=stars();f.parents.push(f.parent);f.owner.sync();const state=f.owner.states.get('t1');state.loaded=true;state.stars=[{dossier:{id:'kept'}}];await state.busy;assert.equal(f.timers.jobs.size,1,'the retained dirty owner must first own a later retry');
  f.doc.visibilityState='hidden';f.listeners.visibilitychange();assert.equal(f.timers.jobs.size,0);
  f.doc.visibilityState='visible';f.listeners.visibilitychange();await state.busy;
  assert.equal(f.calls(),2);assert.equal(state.stars[0].dossier.id,'fresh');
});
