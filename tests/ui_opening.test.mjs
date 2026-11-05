import test from 'node:test';
import assert from 'node:assert/strict';
import { OpeningDraft, OpeningPages } from '../web/opening.mjs';
import { OpeningView, UnfinishedOpenings } from '../web/opening-view.mjs';
import { openOpeningStore, validDeviceRow } from '../web/opening-store.mjs';
import { dom } from './fixtures/ui_dom.mjs';

const copy=structuredClone;
const authority={authority_id:'authority',authority_epoch:'epoch',continuity:'initial'};
const bootstrap={instance_id:'fixture',actor:'person',authority,limits:{topic_participants:3,image_bytes:1024,attachment_count:2,media_name_utf8_bytes:64,body_utf8_bytes:4096}};
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let serial=0; // One counter, so drafts on two "devices" never share an operation ID.

// A small Core that follows docs/openings.md: CAS saves, deduplication by
// operation ID, recorded refusals, one publication, and the operation view.
function core() {
  const operations=new Map(),openings=new Map(),media=new Map(),topics=new Map(),disabled=new Set();
  const receipt=(e,status,recorded,result=null,error=null)=>({instance_id:'fixture',operation_id:e.operation_id,kind:e.kind,status,recorded,result,affected:[],...(error?{error}:{})});
  const refuse=(code,message,current_versions)=>{throw Object.assign(Error(message),{code,current_versions});};
  const run={
    'opening.save':e=>{
      const id=e.target.opening_id,o=openings.get(id),revision=o?.revision??0,a=e.args;
      if(Object.keys(a).sort().join()!=='attachments,body,participants,title,topic_id,workspace_id')refuse('INVALID_ARGUMENT','A save carries the whole writing');
      if(o&&o.state!=='open')refuse('OPENING_CLOSED','This opening was already '+o.state);
      if(e.expected.opening_revision!==revision)refuse('REVISION_CONFLICT','Writing changed; reconcile',{opening_revision:revision});
      if(!o&&(topics.has(a.topic_id)||[...openings.values()].some(x=>x.topic_id===a.topic_id)))refuse('REVISION_CONFLICT','Topic identity in use');
      for(const ref of a.attachments)if(!media.has(ref.id))refuse('FORBIDDEN','No accessible attachment');
      openings.set(id,{id,workspace_id:a.workspace_id,topic_id:a.topic_id,revision:revision+1,state:'open',title:a.title,participants:copy(a.participants),
        body:a.body,attachments:copy(a.attachments),publish_operation_id:null,message_id:null});
      return {opening_id:id,opening_revision:revision+1,state:'open'};
    },
    'opening.publish':e=>{
      const o=openings.get(e.target.opening_id);
      if(!o)refuse('FORBIDDEN','No private opening');if(o.state!=='open')refuse('OPENING_CLOSED','This opening was already '+o.state);
      if(e.expected.opening_revision!==o.revision)refuse('REVISION_CONFLICT','Writing changed',{opening_revision:o.revision});
      if(o.participants.some(p=>disabled.has(p)))refuse('INVALID_RECIPIENT','A participant is not enabled');
      if(!o.title.trim())refuse('EMPTY_TITLE','A topic needs a title');
      if(o.attachments.some(ref=>media.get(ref.id).state!=='ready'))refuse('ATTACHMENT_NOT_READY','Every attachment must be ready');
      const message='message-'+(topics.size+1);topics.set(o.topic_id,{title:o.title,body:o.body,participants:copy(o.participants),message});
      Object.assign(o,{state:'published',revision:o.revision+1,publish_operation_id:e.operation_id,message_id:message});
      return {opening_id:o.id,opening_revision:o.revision,topic:{id:o.topic_id,version:1},message_id:message,delivery:{queued:0,unavailable_subscribers:[]}};
    },
    'opening.discard':e=>{
      const o=openings.get(e.target.opening_id);
      if(!o)refuse('FORBIDDEN','No private opening');if(o.state!=='open')refuse('OPENING_CLOSED','closed');
      if(e.expected.opening_revision!==o.revision)refuse('REVISION_CONFLICT','Writing changed');
      Object.assign(o,{state:'discarded',revision:o.revision+1});return {opening_id:o.id,opening_revision:o.revision,state:'discarded'};
    },
    'media.begin':e=>{
      media.set(e.target.media_id,{...copy(e.args),state:'pending'});return {media_id:e.target.media_id,media_revision:1,state:'pending'};
    },
  };
  const command=e=>{
    const previous=operations.get(e.operation_id);
    if(previous)return previous.fingerprint===JSON.stringify(e)?copy(previous.receipt):receipt(e,'rejected',false,null,{code:'OPERATION_PAYLOAD_MISMATCH',message:'Different content'});
    let answer;
    try{answer=receipt(e,'committed',true,run[e.kind](e));}
    catch(error){
      if(error.code==='INVALID_ARGUMENT')return receipt(e,'rejected',false,null,{code:error.code,message:error.message,retryable:false});
      answer=receipt(e,'rejected',true,null,{code:error.code,message:error.message,retryable:false,...(error.current_versions?{current_versions:error.current_versions}:{})});
    }
    operations.set(e.operation_id,{fingerprint:JSON.stringify(e),receipt:answer});return copy(answer);
  };
  const view=(name,args)=>{
    if(name==='opening'){
      const o=openings.get(args.opening_id);
      if(!o)return {instance_id:'fixture',error:{code:'FORBIDDEN',message:'No private opening for this actor',retryable:false}};
      return {instance_id:'fixture',opening:copy(o),publish_receipt:o.publish_operation_id?copy(operations.get(o.publish_operation_id).receipt):null};
    }
    if(name==='operation')return copy(operations.get(args.operation_id)?.receipt??{instance_id:'fixture',operation_id:args.operation_id,status:'unknown',recorded:false});
    if(name==='openings'){
      const all=[...openings.values()].filter(o=>o.state==='open'&&o.workspace_id===args.workspace_id&&o.id>(args.cursor??'')).sort((a,b)=>a.id<b.id?-1:1);
      const items=all.slice(0,args.limit).map(o=>({id:o.id,workspace_id:o.workspace_id,topic_id:o.topic_id,revision:o.revision,title:o.title,title_truncated:false}));
      return {instance_id:'fixture',items,next_cursor:all.length>args.limit?items.at(-1).id:null};
    }
    if(name==='workspace_members')return {instance_id:'fixture',items:[{actor_id:'agent',kind:'agent',name:'Agent',name_truncated:false},
      {actor_id:'person',kind:'human',name:'Person',name_truncated:false},{actor_id:'teammate',kind:'human',name:'Teammate',name_truncated:false}],next_cursor:null};
    if(name==='media'){const m=media.get(args.media_id);return {instance_id:'fixture',media_id:args.media_id,name:m.name,state:m.state,media_revision:m.state==='ready'?2:1};}
    throw Error('Unexpected view '+name);
  };
  const upload=(e)=>{
    const m=media.get(e.target.media_id);m.state='ready';
    const answer=receipt(e,'committed',true,{instance_id:'fixture',media_id:e.target.media_id,state:'ready',media_revision:2,name:m.name,content_type:m.content_type,size_bytes:m.size_bytes,sha256:m.sha256,inline:true});
    operations.set(e.operation_id,{fingerprint:JSON.stringify(e),receipt:answer});return copy(answer);
  };
  return {operations,openings,media,topics,disabled,command,view,upload};
}

function harness({core:c=core(),store=memoryStore()}={}) {
  const calls=[],timers=manualTimers();
  // Each hook can hold, lose or refuse a call to model the network around Core.
  const api={hooks:{},
    async command(e){calls.push(copy(e));const hook=api.hooks[e.kind];return hook?hook(e,()=>c.command(copy(e))):c.command(copy(e));},
    async view(name,args){calls.push({view:name,args:copy(args)});const hook=api.hooks['view:'+name];return hook?hook(args,()=>c.view(name,args)):c.view(name,args);},
    async upload(e,blob){calls.push(copy(e));assert.ok(blob instanceof Blob);return c.upload(copy(e));}};
  const published=[];
  const draft=(options={})=>new OpeningDraft({api,bootstrap,store,workspace:'w1',opening:'o1',topic:'t1',timers,id:()=>`id-${++serial}`,
    published:receipt=>published.push(receipt),...options});
  return {core:c,store,api,calls,timers,published,draft,commands:kind=>calls.filter(x=>x.kind===kind)};
}
function memoryStore() {
  const rows=new Map(),log=[];
  return {rows,log,fail:null,
    async get(id){log.push(['get',id]);return copy(rows.get(id)??null);},
    async put(row){log.push(['put',copy(row)]);if(this.fail)throw Error(this.fail);
      assert.ok(validDeviceRow(row,{instanceId:'fixture',actor:'person',opening:row.opening}),'device rows keep their documented shape');rows.set(row.opening,copy(row));},
    async remove(id){log.push(['remove',id]);if(this.fail)throw Error(this.fail);rows.delete(id);}};
}
function manualTimers() {
  const pending=new Map();let next=0;
  return {pending,setTimeout:fn=>{pending.set(++next,fn);return next;},clearTimeout:id=>pending.delete(id),
    async fire(){const due=[...pending.values()];pending.clear();await Promise.all(due.map(fn=>fn()));}};
}
async function settled(d){await d.saveQueue;await d.persisting.catch(()=>{});await tick();}

test('the first change saves revision 1 with the whole writing; later saves carry the acknowledged revision',async()=>{
  const h=harness(),d=h.draft();
  assert.equal(await d.load(),'editing');assert.equal(d.base,0);assert.equal(d.status,'Not saved yet');
  assert.equal(h.commands('opening.save').length,0,'loading a fresh link writes nothing');
  d.edit({title:'Plan the launch'});assert.equal(h.timers.pending.size,2,'typing is debounced by an idle and a maximum delay');
  const gate=defer();h.api.hooks['opening.save']=async(_e,send)=>{await gate.promise;return send();};
  const saving=h.timers.fire();await tick();assert.equal(d.status,'Saving');
  gate.resolve();await saving;await settled(d);
  const [first]=h.commands('opening.save');
  assert.deepEqual(first.target,{opening_id:'o1'});assert.deepEqual(first.expected,{opening_revision:0,authority:{authority_id:'authority',authority_epoch:'epoch'}});
  assert.deepEqual(first.args,{workspace_id:'w1',topic_id:'t1',title:'Plan the launch',participants:[],body:'',attachments:[]});
  assert.equal(d.status,'Saved');assert.equal(d.base,1);assert.equal(h.store.rows.has('o1'),false,'acknowledged writing leaves the device');
  delete h.api.hooks['opening.save'];
  d.edit({body:'First words'});await d.save();
  assert.deepEqual(h.commands('opening.save')[1].expected.opening_revision,1);assert.equal(h.core.openings.get('o1').body,'First words');
  assert.deepEqual(h.commands('opening.save')[1].args,{workspace_id:'w1',topic_id:'t1',title:'Plan the launch',participants:[],body:'First words',attachments:[]},'every save carries the whole writing');
});

test('unacknowledged writing stays on this device and is restored on reload only when newer than its base',async()=>{
  const h=harness(),d=h.draft();await d.load();
  d.edit({title:'Kept title',body:'Saved once'});await d.save();
  h.api.hooks['opening.save']=async()=>{throw Error('Connection interrupted.');};
  d.edit({body:'Newer words on this device'});await d.save();await settled(d);
  assert.equal(d.status,'Not saved yet');assert.equal(d.device,'Kept on this device only');
  assert.deepEqual(h.store.rows.get('o1').writing.body,'Newer words on this device');assert.equal(h.store.rows.get('o1').base,1);
  delete h.api.hooks['opening.save'];
  const reloaded=h.draft();await reloaded.load();
  assert.equal(reloaded.writing.body,'Newer words on this device');assert.equal(reloaded.conflict,null);
  assert.equal(reloaded.status,'Not saved yet');assert.equal(reloaded.device,'Kept on this device only');
  await h.timers.fire();await settled(reloaded);
  assert.equal(h.core.openings.get('o1').body,'Newer words on this device');assert.equal(reloaded.status,'Saved');assert.equal(h.store.rows.has('o1'),false);
  // A device copy equal to Core's revision is nothing unacknowledged.
  h.store.rows.set('o1',{format:1,instanceId:'fixture',actor:'person',opening:'o1',workspace:'w1',topic:'t1',base:1,writing:copy(reloaded.writing),publish:null});
  const again=h.draft();await again.load();
  assert.equal(again.dirty,false);assert.equal(again.status,'Saved');assert.equal(again.conflict,null);assert.equal(h.store.rows.has('o1'),false);
});

test('a lost save answer is re-sent exactly before newer writing',async()=>{
  const h=harness(),d=h.draft();await d.load();
  h.api.hooks['opening.save']=async(_e,send)=>{send();throw Error('Answer lost');};
  d.edit({title:'T',body:'A'});await d.save();
  delete h.api.hooks['opening.save'];
  d.edit({body:'B'});await d.save();
  const saves=h.commands('opening.save');
  assert.deepEqual(saves[1],saves[0],'the same operation settles what Core recorded');assert.equal(d.base,1);assert.equal(d.dirty,true);
  await d.save();assert.equal(h.commands('opening.save')[2].expected.opening_revision,1);assert.equal(h.core.openings.get('o1').body,'B');
});

test('a revision conflict shows both versions and overwrites neither until the person chooses',async()=>{
  const h=harness(),here=h.draft();await here.load();here.edit({title:'Shared',body:'Original'});await here.save();
  const other=harness({core:h.core}).draft();await other.load();other.edit({body:'Written on the phone'});await other.save();
  assert.equal(h.core.openings.get('o1').revision,2);
  here.edit({body:'Written on the laptop'});await here.save();await settled(here);
  assert.equal(here.conflict.remote.revision,2);assert.equal(here.conflict.remote.body,'Written on the phone');
  assert.equal(here.writing.body,'Written on the laptop');assert.equal(h.core.openings.get('o1').body,'Written on the phone');
  assert.equal(here.status,'Not saved yet');assert.equal(here.store.rows.get('o1').base,1,'the device copy keeps the revision it was based on');
  await here.save();assert.equal(h.core.openings.get('o1').body,'Written on the phone','no save is sent while the choice is open');
  await assert.rejects(here.send(),/Choose/);
  // The same conflict is found after a reload from the device copy.
  const reloaded=h.draft();await reloaded.load();
  assert.equal(reloaded.conflict.remote.body,'Written on the phone');assert.equal(reloaded.writing.body,'Written on the laptop');
  await reloaded.resolve('mine');
  const last=h.commands('opening.save').at(-1);assert.equal(last.expected.opening_revision,2);assert.equal(last.args.body,'Written on the laptop');
  assert.equal(h.core.openings.get('o1').body,'Written on the laptop');assert.equal(reloaded.conflict,null);assert.equal(reloaded.status,'Saved');
  // Choosing the saved version takes Core's writing without sending a save.
  other.edit({body:'Phone again'});await other.save();await settled(other);
  assert.equal(other.conflict.remote.body,'Written on the laptop');const count=h.calls.length;
  await other.resolve('server');assert.equal(other.writing.body,'Written on the laptop');assert.equal(other.dirty,false);
  assert.equal(h.calls.slice(count).filter(x=>x.kind).length,0);
});

test('Send flushes the save and makes the exact publish envelope durable on this device before dispatching it',async()=>{
  const h=harness(),d=h.draft();await d.load();
  d.edit({title:'Launch',body:'Unsaved until Send'});
  h.api.hooks['opening.publish']=(e,send)=>{
    const kept=h.store.rows.get('o1')?.publish?.envelope;
    assert.deepEqual(kept,e,'the dispatched envelope is already on this device');
    return send();
  };
  assert.equal(await d.send(),'published');
  const kinds=h.calls.filter(x=>x.kind).map(x=>x.kind);assert.deepEqual(kinds,['opening.save','opening.publish']);
  const publish=h.commands('opening.publish')[0];
  assert.deepEqual(publish.args,{});assert.equal(publish.expected.opening_revision,1);assert.deepEqual(publish.target,{opening_id:'o1'});
  assert.equal(h.published.length,1);assert.equal(h.published[0].result.topic.id,'t1');assert.equal(d.phase,'published');
  assert.equal(h.store.rows.has('o1'),false,'a committed receipt clears the device copy');
  assert.equal(h.core.topics.get('t1').body,'Unsaved until Send');
});

test('a publish envelope that cannot be stored on this device is never dispatched',async()=>{
  const h=harness(),d=h.draft();await d.load();d.edit({title:'Launch',body:'Words'});await d.save();
  h.store.fail='Disk full';
  await assert.rejects(d.send(),/Disk full/);
  assert.equal(h.commands('opening.publish').length,0);assert.equal(d.phase,'editing');assert.equal(d.publish,null);
});

test('an unknown result keeps the envelope; Check reads the operation and Send again repeats it identically',async()=>{
  const h=harness(),d=h.draft();await d.load();d.edit({title:'Launch',body:'Once only'});await d.save();
  h.api.hooks['opening.publish']=async()=>{throw Error('Connection interrupted.');};
  assert.equal(await d.send(),'unknown');assert.equal(d.phase,'unknown');
  const envelope=h.commands('opening.publish')[0];assert.deepEqual(h.store.rows.get('o1').publish.envelope,envelope);
  assert.throws(()=>d.edit({body:'More'}),/Check/);
  // A reload resumes the same unconfirmed send.
  const reloaded=h.draft();await reloaded.load();assert.equal(reloaded.phase,'unknown');assert.deepEqual(reloaded.publish.envelope,envelope);
  assert.equal(await reloaded.check(),'unknown');assert.match(reloaded.notice,/no record/);
  assert.deepEqual(h.calls.filter(x=>x.view==='operation').at(-1).args,{operation_id:envelope.operation_id});
  delete h.api.hooks['opening.publish'];
  assert.equal(await reloaded.sendAgain(),'published');
  assert.deepEqual(h.commands('opening.publish')[1],envelope,'Send again is the identical envelope');
  assert.equal(h.core.topics.size,1);assert.equal(h.store.rows.has('o1'),false);
});

test('Check settles a send whose answer was lost after Core recorded it',async()=>{
  const h=harness(),d=h.draft();await d.load();d.edit({title:'Launch',body:'Recorded'});await d.save();
  h.api.hooks['opening.publish']=async(_e,send)=>{send();throw Error('Answer lost');};
  assert.equal(await d.send(),'unknown');
  assert.equal(await d.check(),'published');assert.equal(h.published.length,1);assert.equal(h.commands('opening.publish').length,1,'Check never sends');
});

test('a recorded refusal shows its reason, returns to editing, and the next Send is a new operation',async()=>{
  const h=harness(),d=h.draft();await d.load();h.core.disabled.add('agent');
  d.setParticipants(['agent']);d.edit({title:'Launch',body:'Hello'});
  assert.equal(await d.send(),'refused');
  assert.equal(d.phase,'editing');assert.match(d.refusal,/not enabled/);assert.equal(d.publish,null);assert.equal(h.store.rows.has('o1'),false);
  assert.equal(h.core.openings.get('o1').state,'open','the refusal changed nothing');
  d.setParticipants([]);assert.equal(d.refusal,null);
  assert.equal(await d.send(),'published');
  const [first,second]=h.commands('opening.publish');
  assert.notEqual(second.operation_id,first.operation_id);assert.equal(second.expected.opening_revision,2);
});

test('closed and changed openings are read again after a refused Send',async()=>{
  const h=harness(),d=h.draft();await d.load();d.edit({title:'Launch',body:'Hello'});await d.save();
  const other=harness({core:h.core}).draft();await other.load();assert.equal(await other.send(),'published');
  assert.equal(await d.send(),'refused');assert.equal(d.phase,'published');assert.match(d.refusal,/published/);
});

test('Send refuses incomplete writing before any request',async()=>{
  const h=harness(),d=h.draft();await d.load();
  d.edit({title:'  ',body:'Words'});await assert.rejects(d.send(),/title/);
  d.edit({title:'Title',body:'   '});await assert.rejects(d.send(),/message|image/);
  assert.equal(h.calls.filter(x=>x.kind==='opening.publish').length,0);
});

test('participants come from outcome members and the limit includes the author',async()=>{
  const h=harness(),d=h.draft();await d.load();await d.loadMembers();
  assert.deepEqual(d.members.map(m=>m.actor_id),['agent','person','teammate']);
  assert.deepEqual(h.calls.find(x=>x.view==='workspace_members').args,{workspace_id:'w1',limit:50});
  d.setParticipants(['agent','teammate']);assert.deepEqual(d.writing.participants,['agent','teammate']);
  assert.throws(()=>d.setParticipants(['agent','teammate','third']),/limit/);
  assert.throws(()=>d.setParticipants(['person']),/already included/);
  assert.throws(()=>d.setParticipants(['agent','agent']),/once/);
});

test('a ready image is attached through media.begin and upload; Send waits for it',async()=>{
  const h=harness(),d=h.draft();await d.load();d.edit({title:'Picture'});
  const gate=defer();h.api.upload=async(e,blob)=>{h.calls.push(copy(e));await gate.promise;return h.core.upload(copy(e),blob);};
  const attaching=d.attach(new File(['png bytes'],'chart.png',{type:'image/png'}));
  while(!h.commands('media.begin').length)await tick();await tick();
  const [begin]=h.commands('media.begin');
  assert.equal(begin.args.name,'chart.png');assert.match(begin.args.sha256,/^[0-9a-f]{64}$/);
  assert.deepEqual(d.writing.attachments,[{id:begin.target.media_id}],'the reference is kept once its intent exists');
  await assert.rejects(d.send(),/image/);assert.equal(h.commands('opening.publish').length,0);
  gate.resolve();await attaching;
  const publish=h.commands('media.publish')[0];assert.equal(publish.operation_id,begin.args.publish_operation_id);
  assert.equal(d.media.get(begin.target.media_id).state,'ready');
  assert.equal(await d.send(),'published');assert.deepEqual(h.core.openings.get('o1').attachments,[{id:begin.target.media_id}]);
  await assert.rejects(harness().draft().attach(new File(['x'],'a.txt',{type:'text/plain'})),/./);
});

test('discard asks Core with the expected revision and removes the device copy; a never-saved opening sends nothing',async()=>{
  const h=harness(),d=h.draft();await d.load();d.edit({title:'Drop me'});await d.save();
  h.api.hooks['opening.save']=async()=>{throw Error('offline');};d.edit({body:'Unsaved'});await d.save();await settled(d);
  delete h.api.hooks['opening.save'];const lost=h.commands('opening.save').at(-1);
  assert.equal(await d.discard(),'discarded');
  assert.deepEqual(h.commands('opening.save').at(-1),lost,'the unconfirmed save is settled exactly before discarding');
  const discard=h.commands('opening.discard')[0];assert.equal(discard.expected.opening_revision,2);
  assert.equal(h.core.openings.get('o1').state,'discarded');assert.equal(h.store.rows.has('o1'),false);
  const g=harness(),fresh=g.draft();await fresh.load();fresh.edit({title:'Local only'});fresh.cancelSave();await settled(fresh);
  assert.ok(g.store.rows.has('o1'));assert.equal(await fresh.discard(),'discarded');
  assert.equal(g.calls.filter(x=>x.kind).length,0);assert.equal(g.store.rows.has('o1'),false);
});

test('leaving saves writing first and needs a second choice while a send is unconfirmed',async()=>{
  const h=harness(),d=h.draft();await d.load();d.edit({title:'T',body:'Leaving now'});
  await d.leave('["workspace","w1"]','Outcome');assert.equal(h.core.openings.get('o1').body,'Leaving now');
  h.api.hooks['opening.publish']=async()=>{throw Error('offline');};await d.send();
  await assert.rejects(d.leave('["workspace","w1"]','Outcome'),/Choose “Outcome” again/);
  await d.leave('["workspace","w1"]','Outcome');
});

test('the unfinished list pages Core openings for one outcome and refuses mismatched pages',async t=>{
  const previous=globalThis.document;globalThis.document=dom();t.after(()=>{globalThis.document=previous;});
  const c=core();
  for(const id of ['a','b','c'])c.command({v:1,instance_id:'fixture',operation_id:'save-'+id,kind:'opening.save',target:{opening_id:id},
    expected:{opening_revision:0,authority:{authority_id:'authority',authority_epoch:'epoch'}},args:{workspace_id:'w1',topic_id:'topic-'+id,title:id==='b'?'':'Topic '+id,participants:[],body:'',attachments:[]}});
  c.command({v:1,instance_id:'fixture',operation_id:'save-other',kind:'opening.save',target:{opening_id:'z'},
    expected:{opening_revision:0,authority:{authority_id:'authority',authority_epoch:'epoch'}},args:{workspace_id:'w2',topic_id:'topic-z',title:'Elsewhere',participants:[],body:'',attachments:[]}});
  const reads=[],opened=[],host=document.createElement('section');
  const list=new UnfinishedOpenings({host,instanceId:'fixture',workspace:'w1',open:(route,title)=>opened.push([route,title]),
    read:async args=>{reads.push(args);return c.view('openings',{...args,limit:2});}});
  await list.load();
  const links=()=>list.list.children;
  assert.deepEqual([...links()].map(a=>a.textContent),['Resume Topic a','Resume Untitled topic']);assert.equal(list.more.hidden,false);
  assert.equal(links()[0].href,'?workspace=w1&opening=a&opening_topic=topic-a');
  await list.load(true);assert.deepEqual([...links()].map(a=>a.dataset.openingId),['a','b','c']);assert.equal(list.more.hidden,true);
  assert.deepEqual(reads.map(r=>r.cursor??null),[null,'b']);
  let prevented=false;links()[2].onclick({button:0,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.deepEqual(opened,[[{kind:'opening',workspace:'w1',opening:'c',topic:'topic-c'},'Topic c']]);
  const pages=new OpeningPages('fixture','w1');
  assert.throws(()=>pages.accept(c.view('openings',{workspace_id:'w2',limit:20})),/could not be confirmed/,'another outcome’s opening is refused');
  assert.throws(()=>pages.accept({instance_id:'other',items:[],next_cursor:null}),/could not be confirmed/);
});

test('the opening page shows both versions in a conflict and Check and Send again for an unknown send',async t=>{
  const previous=globalThis.document;globalThis.document=dom();t.after(()=>{globalThis.document=previous;});
  const h=harness(),d=h.draft(),host=document.createElement('main'),opened=[];
  const view=new OpeningView({host,draft:d,workspace:{id:'w1',title:'Outcome'},open:(route,title)=>opened.push([route,title])});
  await d.load();d.edit({title:'Shared',body:'Original'});await d.save();
  const other=harness({core:h.core}).draft();await other.load();other.edit({body:'Phone words'});await other.save();
  d.edit({body:'Laptop words'});await d.save();await settled(d);
  const texts=node=>[node.textContent,...node.children.flatMap(texts)];
  const shown=texts(view.conflict);
  assert.equal(view.conflict.hidden,false);assert.equal(view.sendButton.disabled,true);
  assert.ok(shown.some(x=>x.includes('Laptop words')),'your writing is shown');
  assert.ok(shown.some(x=>x.includes('Phone words')),'the saved version is shown');
  assert.ok(shown.includes('Saved version · revision 2'));
  const keep=view.conflict.children.find(x=>x.textContent==='Keep my writing');
  await keep.onclick();await settled(d);
  assert.equal(view.conflict.hidden,true);assert.equal(h.core.openings.get('o1').body,'Laptop words');assert.equal(view.state.textContent,'Saved');
  h.api.hooks['opening.publish']=async()=>{throw Error('offline');};
  await view.sendButton.onclick();
  assert.equal(view.outcome.hidden,false);assert.equal(view.sendButton.hidden,true);assert.equal(view.discard.hidden,true);
  const labels=view.outcome.children.map(x=>x.textContent);
  assert.ok(labels.includes('Check')&&labels.includes('Send again'));assert.match(view.state.textContent,/on this device only/);
  delete h.api.hooks['opening.publish'];
  await view.outcome.children.find(x=>x.textContent==='Send again').onclick();
  assert.equal(d.phase,'published');assert.equal(h.published.length,1);assert.equal(view.later.textContent,'Back to outcome');
});

const texts=node=>[node.textContent,...node.children.flatMap(texts)];
const lostAnswer=async(_e,send)=>{send();throw Error('Answer lost');};

test('a save whose answer was lost is kept on this device and re-sent first after a reload or Refresh',async()=>{
  for(const way of ['reload','refresh']){
    const h=harness(),d=h.draft();await d.load();d.edit({title:'T',body:'A'});await d.save();
    h.api.hooks['opening.save']=lostAnswer;d.edit({body:'B'});await d.save();await settled(d);
    delete h.api.hooks['opening.save'];
    d.edit({body:'C'});d.cancelSave();await settled(d);
    const lost=h.commands('opening.save')[1];assert.deepEqual(h.store.rows.get('o1').save.envelope,lost,way);
    const again=way==='reload'?h.draft():d;assert.equal(await (way==='reload'?again.load():again.refresh()),'editing');
    assert.equal(again.conflict,null,`${way}: Core's revision 2 is this device's own save, not another device's`);
    assert.equal(again.writing.body,'C');assert.equal(again.status,'Not saved yet');
    await h.timers.fire();await settled(again);
    const saves=h.commands('opening.save');
    assert.deepEqual(saves[2],lost,'the lost save is re-sent with its operation ID before newer writing');
    assert.equal(saves[3].expected.opening_revision,2);assert.equal(saves[3].args.body,'C');
    assert.equal(h.core.openings.get('o1').body,'C');assert.equal(again.status,'Saved');assert.equal(h.store.rows.has('o1'),false);
  }
  // A lost save Core never recorded still meets a real change from another device as a conflict.
  const h=harness(),d=h.draft();await d.load();d.edit({title:'T',body:'A'});await d.save();
  h.api.hooks['opening.save']=async()=>{throw Error('offline');};d.edit({body:'Laptop'});await d.save();await settled(d);
  const phone=harness({core:h.core}).draft();await phone.load();phone.edit({body:'Phone'});await phone.save();
  delete h.api.hooks['opening.save'];
  const reloaded=h.draft();await reloaded.load();await h.timers.fire();await settled(reloaded);
  assert.equal(reloaded.conflict.remote.body,'Phone');assert.equal(reloaded.writing.body,'Laptop');assert.equal(h.core.openings.get('o1').body,'Phone');
});

test('Send after a lost save answer settles that save and then saves the newer writing',async()=>{
  const h=harness(),d=h.draft();await d.load();d.edit({title:'T',body:'A'});await d.save();
  h.api.hooks['opening.save']=lostAnswer;d.edit({body:'B'});await d.save();delete h.api.hooks['opening.save'];
  d.edit({body:'C'});
  assert.equal(await d.send(),'published');
  const saves=h.commands('opening.save');assert.deepEqual(saves[2],saves[1]);assert.equal(saves[3].args.body,'C');
  assert.equal(h.core.topics.get('t1').body,'C');
});

test('Send stops when its own save finds the opening already sent on another device',async()=>{
  const h=harness(),d=h.draft();await d.load();d.edit({title:'Launch',body:'Hello'});await d.save();
  const phone=harness({core:h.core}).draft();await phone.load();assert.equal(await phone.send(),'published');
  d.edit({body:'Laptop words'});
  assert.equal(await d.send(),'published');
  assert.equal(h.commands('opening.publish').length,0,'no publish is sent for an opening Core already closed');
  assert.match(d.refusal,/published/);assert.equal(d.leftover.body,'Laptop words');
  assert.equal([...h.core.operations.values()].filter(o=>o.receipt.kind==='opening.publish').length,1);
});

test('writing left on this device when another device closed the opening stays visible until removed',async t=>{
  const previous=globalThis.document;globalThis.document=dom();t.after(()=>{globalThis.document=previous;});
  for(const state of ['published','discarded']){
    const h=harness(),d=h.draft();await d.load();d.edit({title:'Shared',body:'Saved words'});await d.save();
    h.api.hooks['opening.save']=async()=>{throw Error('offline');};d.edit({body:'Offline words'});await d.save();await settled(d);
    const phone=harness({core:h.core}).draft();await phone.load();
    assert.equal(await (state==='published'?phone.send():phone.discard()),state);
    const reloaded=h.draft(),view=new OpeningView({host:document.createElement('main'),draft:reloaded,workspace:{id:'w1',title:'Outcome'},open:()=>{}});
    assert.equal(await reloaded.load(),state);
    assert.equal(reloaded.leftover.body,'Offline words',state);assert.equal(h.store.rows.get('o1').writing.body,'Offline words');
    const shown=texts(view.outcome);
    assert.ok(shown.includes('This writing was on this device only and was not part of it:'));assert.ok(shown.some(x=>x.includes('Offline words')));
    await view.outcome.children.find(x=>x.textContent==='Remove from this device').onclick();
    assert.equal(reloaded.leftover,null);assert.equal(h.store.rows.has('o1'),false);
    const again=h.draft();await again.load();assert.equal(again.leftover,null,'nothing is left once removed');
  }
});

test('a committed publish naming another opening, topic or message is unknown and keeps its envelope',async()=>{
  for(const [name,change] of [['topic',r=>{r.topic.id='t-other';}],['opening',r=>{r.opening_id='o-other';}],['message',r=>{r.message_id='';}]]){
    const h=harness(),d=h.draft();await d.load();d.edit({title:'Launch',body:'Words'});await d.save();
    h.api.hooks['opening.publish']=(_e,send)=>{const receipt=send();change(receipt.result);return receipt;};
    assert.equal(await d.send(),'unknown',name);
    assert.equal(h.published.length,0,name);assert.match(d.notice,/does not match/);
    assert.deepEqual(h.store.rows.get('o1').publish.envelope,h.commands('opening.publish')[0],name);
    // Check reads Core's own record of the same operation.
    assert.equal(await d.check(),'published',name);assert.equal(h.published.length,1);assert.equal(h.commands('opening.publish').length,1);
  }
});

test('a send Core never recorded before a restore returns to editing once Check runs under the new authority',async()=>{
  const h=harness(),d=h.draft();await d.load();d.edit({title:'Launch',body:'Restored'});await d.save();
  let epoch='epoch',lose=true;
  // Core refuses, without recording, any act captured under another epoch.
  h.api.hooks['opening.publish']=async(e,send)=>{
    if(lose){lose=false;throw Error('Connection interrupted.');}
    return e.expected.authority.authority_epoch===epoch?send():{instance_id:'fixture',operation_id:e.operation_id,kind:e.kind,status:'rejected',recorded:false,
      result:null,affected:[],error:{code:'AUTHORITY_CHANGED',message:'This act belongs to another authority epoch',retryable:false}};
  };
  assert.equal(await d.send(),'unknown');epoch='epoch-2';
  assert.equal(await d.sendAgain(),'unknown');assert.match(d.notice,/Reload this page, then Check/);
  assert.equal(await d.check(),'unknown','under the same authority, Check keeps the exact request');assert.ok(d.publish);
  const restored=h.draft({bootstrap:{...bootstrap,authority:{...authority,authority_epoch:'epoch-2'}}});
  assert.equal(await restored.load(),'unknown');const stale=restored.publish.envelope;
  assert.equal(await restored.check(),'editing');assert.equal(restored.publish,null);assert.equal(h.store.rows.has('o1'),false);
  assert.match(restored.notice,/no record/);
  assert.equal(await restored.send(),'published');
  const last=h.commands('opening.publish').at(-1);
  assert.notEqual(last.operation_id,stale.operation_id);assert.equal(last.expected.authority.authority_epoch,'epoch-2');assert.equal(h.core.topics.size,1);
});

test('leaving writing no page lists needs a second choice, and so does closing the page',async()=>{
  const h=harness(),d=h.draft();await d.load();
  h.api.hooks['opening.save']=async()=>{throw Error('offline');};
  d.edit({title:'T',body:'Only here'});await settled(d);assert.equal(d.unprotected,true,'nothing lists a never-saved opening');
  await assert.rejects(d.leave('["workspace","w1"]','Outcome'),/no page will list it.*Choose “Outcome” again/);
  assert.equal(h.core.openings.size,0);assert.equal(h.store.rows.get('o1').writing.body,'Only here');
  await d.leave('["workspace","w1"]','Outcome');
  delete h.api.hooks['opening.save'];await d.save();await settled(d);
  assert.equal(d.base,1);assert.equal(d.unprotected,false,'Core lists a saved opening');
  h.api.hooks['opening.save']=async()=>{throw Error('offline');};d.edit({body:'More'});
  await d.leave('["workspace","w1"]','Outcome');
});

test('a link whose topic already exists says so and moves its writing to a new opening',async t=>{
  const previous=globalThis.document;globalThis.document=dom();t.after(()=>{globalThis.document=previous;});
  const h=harness();h.core.topics.set('t1',{title:'Started the old way'});
  const d=h.draft(),opened=[],view=new OpeningView({host:document.createElement('main'),draft:d,workspace:{id:'w1',title:'Outcome'},open:(route,title)=>opened.push([route,title])});
  await d.load();d.edit({title:'Plan',body:'Words'});await h.timers.fire();await settled(d);
  assert.equal(d.phase,'taken');assert.equal(d.conflict,null);assert.equal(view.conflict.hidden,true,'this is not another device’s change');
  await d.save();assert.equal(h.commands('opening.save').length,1,'nothing re-sends into the same refusal');
  assert.throws(()=>d.edit({body:'x'}),/cannot be changed/);await assert.rejects(d.send(),/cannot be sent/);
  assert.ok(texts(view.outcome).includes('This link can no longer start a topic'));assert.equal(view.sendButton.hidden,true);
  await view.outcome.children.find(x=>x.textContent==='Start a new topic with this writing').onclick();
  const [[route,title]]=opened;assert.equal(title,'Plan');
  assert.deepEqual(Object.keys(route),['kind','workspace','opening','topic']);assert.equal(route.workspace,'w1');
  assert.notEqual(route.opening,'o1');assert.notEqual(route.topic,'t1');assert.equal(h.store.rows.has('o1'),false);
  await d.leave('["workspace","w1"]','Outcome');
  const g=harness({core:h.core,store:h.store}),moved=g.draft({opening:route.opening,topic:route.topic});
  assert.equal(await moved.load(),'editing');assert.equal(moved.writing.body,'Words');
  await g.timers.fire();await settled(moved);
  assert.equal(h.core.openings.get(route.opening).body,'Words');assert.equal(moved.status,'Saved');
});

// Just enough IndexedDB for the device store: one shared key space per name.
function fakeIndexedDB({durability='strict'}={}) {
  const databases=new Map();
  return {databases,open(name){
    const request={};
    queueMicrotask(()=>{
      const fresh=!databases.has(name);if(fresh)databases.set(name,new Map());const data=databases.get(name);
      const db={stores:new Set(fresh?[]:['openings']),createObjectStore(store){this.stores.add(store);},close(){},
        transaction(store,mode,options){
          assert.ok(this.stores.has(store));const tx={durability:mode==='readwrite'?(options?.durability==='strict'?durability:'default'):'default',abort(){tx.aborted=true;}};
          tx.objectStore=()=>({get(key){const r={};queueMicrotask(()=>r.onsuccess?.({target:{result:structuredClone(data.get(key))}}));return r;},
            put(value,key){data.set(key,structuredClone(value));},delete(key){data.delete(key);}});
          queueMicrotask(()=>queueMicrotask(()=>{if(!tx.aborted)tx.oncomplete?.();}));return tx;
        }};
      request.result=db;if(fresh)request.onupgradeneeded?.();request.onsuccess?.();
    });
    return request;
  }};
}

test('the device store is its own database keyed by instance, actor and opening, with strict durability',async()=>{
  const indexedDB=fakeIndexedDB(),mine=await openOpeningStore({instanceId:'fixture',actor:'person',indexedDB});
  const theirs=await openOpeningStore({instanceId:'fixture',actor:'someone-else',indexedDB});
  const row={format:1,instanceId:'fixture',actor:'person',opening:'o1',workspace:'w1',topic:'t1',base:2,writing:{title:'T',participants:[],body:'B',attachments:[]},publish:null};
  await mine.put(row);
  assert.deepEqual([...indexedDB.databases.keys()],['aim-next-openings']);
  assert.deepEqual([...indexedDB.databases.get('aim-next-openings').keys()],[JSON.stringify(['fixture','person','o1'])]);
  assert.deepEqual(await mine.get('o1'),row);assert.equal(await theirs.get('o1'),null,'another actor never sees this writing');
  await assert.rejects(theirs.put(row),/does not belong/);
  await assert.rejects(mine.put({...row,extra:true}),/does not belong/);
  indexedDB.databases.get('aim-next-openings').set(JSON.stringify(['fixture','person','o2']),{...row,opening:'o2',base:-1});
  await assert.rejects(mine.get('o2'),/cannot be read safely/);
  const lost={...row,save:{envelope:{kind:'opening.save'}}};await mine.put(lost);assert.deepEqual(await mine.get('o1'),lost,'a lost save is kept beside the writing');
  await assert.rejects(mine.put({...row,save:'opening.save'}),/does not belong/);
  await mine.remove('o1');assert.equal(await mine.get('o1'),null);
  const relaxed=await openOpeningStore({instanceId:'fixture',actor:'person',indexedDB:fakeIndexedDB({durability:'relaxed'})});
  await assert.rejects(relaxed.put(row),/Strict storage durability/);
});
