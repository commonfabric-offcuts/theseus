import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTopicCloseRecord } from '../web/topic-close-storage.mjs';
import { TopicCloseActions } from '../web/topic-close.mjs';
import { topicUpdateEnvelope, topicFieldFences } from '../web/topic-state.mjs';
import { TopicPages, TopicRail } from '../web/topic-navigation.mjs';
import { closingTopics } from '../web/topic-close-projection.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
const binding={instanceId:'scratch',actor:'person',authority:{authority_id:'a',authority_epoch:'e'}};
const original={id:'t',workspace_id:'w',title:'A topic',state:'waiting',waiting_on:['agent'],state_note:'Keep these words',archived:false,version:4,list_position:10};
const envelope=(args={state:'done',keep_note:true},id='op')=>topicUpdateEnvelope({instance_id:binding.instanceId,authority:binding.authority},original,args,topicFieldFences(original,'archived' in args?'archived':'state'),id);
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const turns=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
class MemoryJournal{
 constructor(){this.rows=new Map();this.saved=[];this.fail=false;this.wait=null;}
 async put(row){if(this.wait)await this.wait.promise;if(this.fail)throw Error('disk full');const stored=mergeTopicCloseRecord(this.rows.get(row.id),structuredClone(row));this.rows.set(row.id,stored);this.saved.push(structuredClone(stored));return structuredClone(stored);}
 async get(id){return structuredClone(this.rows.get(id));}
 async list(pending=false,limit=20,cursor=null){return [...this.rows.values()].filter(r=>(!pending||['pending','uncertain','undo_pending'].includes(r.phase))&&(!cursor||r.at>cursor.at||r.at===cursor.at&&r.id>cursor.id)).sort((a,b)=>(pending?1:-1)*(a.at-b.at||(a.id>b.id?1:-1))).slice(0,limit).map(r=>structuredClone(r));}
}
const committed=(request,more={})=>({instance_id:'scratch',operation_id:request.operation_id,kind:'topic.update',status:'committed',recorded:true,result:{topic_id:'t',version:5,title:'A topic',state:'done',waiting_on:[],note:'Keep these words',archived:false,state_message_id:null,...more}});
const refused=request=>({instance_id:'scratch',operation_id:request.operation_id,kind:'topic.update',status:'rejected',recorded:true,error:{code:'REVISION_CONFLICT',message:'The topic changed on another device.'}});
function setup(send){const journal=new MemoryJournal(),events=[];const actions=new TopicCloseActions({journal,binding,send:request=>{events.push(['send',structuredClone(request)]);return send(request);},changed:row=>events.push(['draw',row.phase]),kept:row=>events.push(['depart',row.id])});return{journal,actions,events};}

test('strict keep precedes projection, departure and service call; storage refusal admits none',async()=>{
 const reply=gate(),f=setup(()=>reply.promise);f.journal.wait=gate();
 const flight=f.actions.act(original,envelope());await turns();assert.deepEqual(f.events,[]);assert.equal(f.journal.rows.size,0);
 f.journal.wait.resolve();await turns();assert.deepEqual(f.events.map(e=>e[0]),['draw','depart','send']);assert.deepEqual(f.journal.saved[0].envelope,envelope());
 reply.resolve(committed(envelope()));await flight;
 const bad=setup(()=>{throw Error('must never send');});bad.journal.fail=true;
 await assert.rejects(bad.actions.act(original,envelope()),/disk full/);assert.deepEqual(bad.events,[]);assert.equal(bad.actions.rows.size,0);
});

test('reload after lost answer replays exact operation, target, fences and authority',async()=>{
 const f=setup(()=>{throw Error('connection lost');});await f.actions.act(original,envelope());
 assert.equal(f.actions.rows.get('op').phase,'uncertain');assert.deepEqual(f.journal.rows.get('op').envelope,envelope());
 const sent=[];const resumed=new TopicCloseActions({journal:f.journal,binding,send:async request=>{sent.push(structuredClone(request));return committed(request);}});
 await resumed.load();await resumed.resume();assert.deepEqual(sent,[envelope()]);assert.equal(resumed.rows.get('op').phase,'committed');
});

test('a receipt for another operation, topic, instance, or unrecorded outcome never clears uncertainty',async()=>{
 for(const change of [{operation_id:'other'},{instance_id:'elsewhere'},{recorded:false},{result:{topic_id:'other',version:6}},{status:'retryable'}]){
  const f=setup(request=>({...committed(request),...change}));await f.actions.act(original,envelope());assert.equal(f.actions.rows.get('op').phase,'uncertain');
 }
});

test('Undo kept during an unknown forward result waits, then fences its inverse on the real receipt',async()=>{
 const response=gate(),sent=[];const f=setup(request=>{sent.push(structuredClone(request));return sent.length===1?response.promise:Promise.resolve(committed(request,{version:6,state:'waiting',waiting_on:['agent']}));});
 const flight=f.actions.act(original,envelope());await turns();const undo=f.actions.undo('op');await turns();
 assert.equal(sent.length,1);assert.ok(f.journal.rows.get('op').undo.id);assert.equal(f.journal.rows.get('op').undo.envelope,null);
 response.resolve(committed(sent[0]));await Promise.all([flight,undo]);
 assert.equal(sent.length,2);assert.notEqual(sent[1].operation_id,sent[0].operation_id);
 assert.deepEqual(sent[1].args,{state:'waiting',waiting_on:['agent'],keep_note:true});
 assert.deepEqual(sent[1].expected,{topic_fields:{state:'done',waiting_on:[]},authority:binding.authority});
 assert.equal(f.actions.rows.get('op').phase,'undone');
});

test('Undo of Archive uses archived field alone; a later field conflict remains Core refusal',async()=>{
 let count=0;const f=setup(request=>++count===1?committed(request,{archived:true,state:'waiting',waiting_on:['agent']}):refused(request));
 await f.actions.act(original,envelope({archived:true}));await f.actions.undo('op');
 const row=f.actions.rows.get('op');assert.deepEqual(row.undo.envelope.args,{archived:false});assert.deepEqual(row.undo.envelope.expected.topic_fields,{archived:true});
 assert.equal(row.phase,'committed');assert.equal(row.error,'The topic changed on another device.');assert.equal(count,2);
});

test('new authority never rebinds or resends a kept older operation',async()=>{
 const f=setup(()=>{throw Error('lost');});await f.actions.act(original,envelope());const sent=[];
 const resumed=new TopicCloseActions({journal:f.journal,binding:{...binding,authority:{...binding.authority,authority_epoch:'new'}},send:r=>sent.push(r)});
 await resumed.load();await resumed.resume();assert.deepEqual(sent,[]);assert.deepEqual(f.journal.rows.get('op').authority,binding.authority);
});

test('duplicate explicit act while pending keeps the first identity; note/title acts are not admitted',async()=>{
 const reply=gate(),f=setup(()=>reply.promise);const first=f.actions.act(original,envelope());await turns();const next=f.actions.act(original,envelope({state:'done',keep_note:true},'new-id'));await turns();
 assert.equal(f.journal.rows.size,1);assert.equal(f.events.filter(e=>e[0]==='send').length,1);
 reply.resolve(committed(envelope()));await Promise.all([first,next]);
 await assert.rejects(f.actions.act(original,envelope({title:'Other'})),/does not match/);
});

test('projection is document/actor/authority/workspace scoped and leaves raw maps/cursors/counts byte-identical',t=>{
 const doc={},previous=globalThis.document;globalThis.document=doc;t.after(()=>globalThis.document=previous);
 const projection=closingTopics(doc);projection.configure(binding);
 const pages=new TopicPages('scratch','w',original);pages.accept({instance_id:'scratch',items:[original],next_cursor:null,groups:{done:0,archived:0}});
 const before=structuredClone({loaded:[...pages.loaded],next:pages.next,groups:pages.groups,readAt:pages.readAt});
 const row={...binding,workspaceId:'w',id:'op',topic:original,envelope:envelope(),phase:'pending'};projection.set(row);
 assert.deepEqual(pages.items,[]);assert.deepEqual({loaded:[...pages.loaded],next:pages.next,groups:pages.groups,readAt:pages.readAt},before);
 assert.equal(new TopicPages('other','w',original).items.length,1);assert.equal(new TopicPages('scratch','other',{...original,workspace_id:'other'}).items.length,1);
 projection.set({...row,phase:'rejected'});assert.equal(pages.items.length,1);
 projection.set(row);projection.configure({...binding,actor:'other'});assert.equal(pages.items.length,1,'another account receives no old projection');
});

test('intentional projection removes even focused/pointed cached links and refusal restores retained rows',t=>{
 const doc=miniDocument(),previous=globalThis.document;globalThis.document=doc;t.after(()=>globalThis.document=previous);
 const projection=closingTopics(doc);projection.configure(binding);
 const host=doc.byId('topics'),more=doc.byId('more'),retry=doc.byId('retry'),message=doc.byId('message');
 const pages=new TopicPages('scratch','w',original);pages.accept({instance_id:'scratch',items:[original],next_cursor:null});
 const rail=new TopicRail({pages,host,more,retry,message,read:()=>{throw Error('no read during projection');},open:()=>{},denied:()=>false,updated:()=>{}});
 const link=rail.links.get('t');link.focus();rail.pointed=true;
 const row={...binding,workspaceId:'w',id:'op',topic:original,envelope:envelope(),phase:'pending'};
 projection.set(row);assert.equal(host.children.length,0);assert.equal(rail.links.has('t'),false);assert.equal(pages.loaded.size,1);
 projection.set({...row,phase:'rejected'});assert.equal(host.children.length,1);assert.notEqual(rail.links.get('t'),link);
 rail.disposeProjection();projection.set(row);assert.equal(host.children.length,1,'disposed rail is no longer subscribed');
});


test('a delayed tab cannot erase kept Undo or demote a known forward/inverse receipt',async()=>{
 const row={format:1,id:'op',at:1,...binding,workspaceId:'w',topic:original,envelope:envelope(),phase:'pending',receipt:null,undo:null,error:null};
 const undo={id:'undo',envelope:null,receipt:null};
 let kept=mergeTopicCloseRecord({...row,undo},{...row,receipt:committed(envelope()),phase:'committed'});
 assert.deepEqual(kept.undo,undo);assert.equal(kept.phase,'committed');
 const undoEnvelope=envelope({state:'waiting',waiting_on:['agent'],keep_note:true},'undo');
 kept={...kept,phase:'undone',undo:{...undo,envelope:undoEnvelope,receipt:committed(undoEnvelope,{state:'waiting',waiting_on:['agent'],version:6})}};
 const merged=mergeTopicCloseRecord(kept,{...row,phase:'uncertain',error:'lost'});
 assert.equal(merged.phase,'undone');assert.deepEqual(merged.receipt,kept.receipt);assert.deepEqual(merged.undo,kept.undo);
 assert.throws(()=>mergeTopicCloseRecord(kept,{...row,envelope:envelope({archived:true})}),/identity/);
});

test('the first durably kept Undo identity wins between concurrent tabs',()=>{
 const row={id:'op',...binding,workspaceId:'w',topic:original,envelope:envelope(),phase:'pending',receipt:null,undo:{id:'first',envelope:null,receipt:null}};
 const merged=mergeTopicCloseRecord(row,{...row,undo:{id:'second',envelope:null,receipt:null}});
 assert.equal(merged.undo.id,'first');
});

test('pending recovery advances bounded pages beyond20 and sends each exact identity once',async()=>{
 const journal=new MemoryJournal(),sent=[];
 for(let i=0;i<27;i++){const request=envelope({state:'done',keep_note:true},'recover-'+i);journal.rows.set(request.operation_id,{format:1,id:request.operation_id,at:i+1,...binding,workspaceId:'w',topic:original,envelope:request,phase:'uncertain',receipt:null,undo:null,error:'lost'});}
 const actions=new TopicCloseActions({journal,binding,send:async request=>{sent.push(request.operation_id);return committed(request);}});
 await actions.load();await actions.resume();assert.equal(sent.length,27);assert.equal(new Set(sent).size,27);assert.equal([...journal.rows.values()].filter(r=>r.phase==='committed').length,27);
});

test('Undo restores a reopened note only when the forward act changed it, fenced against newer note edits',async()=>{
 const reopened={...original,state_message_id:'message'};let calls=0;const f=setup(request=>++calls===1?committed(request,{note:''}):committed(request,{state:'waiting',waiting_on:['agent'],note:'Keep these words',version:6}));
 const request=topicUpdateEnvelope({instance_id:binding.instanceId,authority:binding.authority},reopened,{state:'done',keep_note:true},topicFieldFences(reopened,'state'),'op');
 await f.actions.act(reopened,request);await f.actions.undo('op');const inverse=f.actions.rows.get('op').undo.envelope;
 assert.deepEqual(inverse.args,{state:'waiting',waiting_on:['agent'],note:'Keep these words'});assert.deepEqual(inverse.expected.topic_fields,{state:'done',waiting_on:[],note:''});
});

test('a distinct Archive intent is kept alongside an unresolved Done, rather than silently reused',async()=>{
 const gate=deferredForDistinct(),f=setup(request=>gate.promise.then(()=>committed(request,{archived:request.args.archived===true})));
 const done=f.actions.act(original,envelope());await turns();const archive=f.actions.act(original,envelope({archived:true},'archive'));await turns();
 try{assert.equal(f.journal.rows.size,2);assert.equal(f.events.filter(e=>e[0]==='send').length,2);}finally{gate.resolve();await Promise.all([done,archive]);}
});
function deferredForDistinct(){return gate();}

test('refusing one of two independently kept acts cannot clear the other pending projection',t=>{
 const doc={},prior=globalThis.document;globalThis.document=doc;t.after(()=>globalThis.document=prior);
 const projection=closingTopics(doc);projection.configure(binding);
 const row={...binding,workspaceId:'w',id:'done',topic:original,envelope:envelope({state:'done',keep_note:true},'done'),phase:'pending'};
 const archive={...row,id:'archive',envelope:envelope({archived:true},'archive')};
 projection.set(row);projection.set(archive);projection.set({...archive,phase:'rejected'});
 assert.deepEqual(projection.project('scratch','w',[original]),[],'Done is still durably pending');
});
