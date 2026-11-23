import test from 'node:test';
import assert from 'node:assert/strict';
import { MentionNotices } from '../web/mention-notices.mjs';

class Element {
  constructor(tag, doc) { Object.assign(this, { tag, ownerDocument: doc, children: [], dataset: {}, attributes: {} }); }
  get parentElement() { return this.parent; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(key, value) { this.attributes[key] = value; }
  all() { return [this, ...this.children.flatMap(child => child.all())]; }
}
const authority = { authority_id: 'a', authority_epoch: 'e', instance_id:'i1', actor_id:'person', commit_seq:42 };
const item = (id='s1') => ({ id, sendOperationId: `send-${id}`, status: 'confirmed', snapshot: { body: 'Hi @outside' },
  receipt: { status: 'committed', result: { message_id: `m-${id}` } } });
const scope = { kind:'topic', id:'t1', title:'Original topic', revision:7, may_add:true,
  add_kind:'participation.set', target:{ topic_id:'t1' }, revision_field:'topic_revision' };
const answer = (people=['outside'], more={}) => ({ instance_id:'i1', message_id:'m-s1', scope,
  items:people.map(actor_id=>({ actor_id, name:actor_id, kind:'agent', may_add:true })), next_cursor:null, ...more });
function fixture(api={},options={}) {
  const doc = { createElement: tag => new Element(tag, doc) }, host = new Element('div', doc); host.id = 'page-notices';
  let current = true;
  const owner = new MentionNotices({ host, api:{ view:async()=>answer(), ...api }, instanceId:'i1', authority:()=>authority, current:()=>current, ...options });
  return { owner, host, buttons:()=>host.all().filter(node=>node.tag==='button'), retire:()=>{ current=false; } };
}
const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r); return { promise, resolve }; };
function retryClock() {
  let next=0;const pending=new Map();
  return {pending,timers:{setTimeout(fn,delay){const id=++next;pending.set(id,{fn,delay});return id;},clearTimeout(id){pending.delete(id);}},
    async tick(){assert.equal(pending.size,1,'one delayed check');const [id,{fn,delay}]=pending.entries().next().value;assert.equal(delay,500);pending.delete(id);await fn();}};
}

test('one notice for a confirmed send, all paged names, repeated confirmation deduplicated', async()=>{
  const calls=[]; const f=fixture({ view:async(name,args)=>{ calls.push([name,args]); return args.cursor ? answer(['outside','other']) : answer(['outside'],{next_cursor:23}); } });
  await f.owner.published(null,item()); await f.owner.published(null,item());
  assert.equal(f.host.children.length,1); assert.equal(calls.length,2);
  assert.deepEqual(f.buttons().map(b=>b.textContent),['Add @outside to topic','Add @other to topic','×']);
  assert.equal(f.host.children[0].attributes.role,'status');
});
test('members show no toast; unconfirmed, detached and whisper sends never start the read', async()=>{
  let reads=0;const f=fixture({view:async()=>{reads++;return answer([]);}});
  await f.owner.published(null,{...item(),status:'prepared'});
  await f.owner.published(null,{...item(),detached:true});
  await f.owner.published(null,{...item(),snapshot:{body:'@outside',whisper:true}});
  assert.equal(reads,0); await f.owner.published(null,item()); assert.equal(reads,1);assert.equal(f.host.children.length,0);
});
test('pending advisory cannot block publication caller, change focus or land after retirement', async()=>{
  const read=deferred();const f=fixture({view:()=>read.promise});
  const pending=f.owner.published(null,item());assert.equal(f.host.children.length,0);
  f.retire(); read.resolve(answer());await pending;assert.equal(f.host.children.length,0);
});
test('1142 a failed check retries quietly once and an outsider answer shows the existing list',async()=>{
  const clock=retryClock();let reads=0,commands=0;
  const f=fixture({view:async()=>{if(++reads===1)throw TypeError('offline');return answer();},command:async()=>{commands++;}},{timers:clock.timers});
  await f.owner.published(null,item());assert.equal(reads,1);assert.equal(f.host.children.length,0);
  await f.owner.published(null,item());assert.equal(reads,1);assert.equal(clock.pending.size,1);
  await clock.tick();assert.equal(reads,2);assert.equal(f.host.children.length,1);
  assert.deepEqual(f.buttons().map(b=>b.textContent),['Add @outside to topic','×']);assert.equal(commands,0);
  await f.buttons().at(-1).onclick();assert.equal(f.host.children.length,0);
  await f.owner.published(null,item());assert.equal(reads,2);assert.equal(f.host.children.length,0);assert.equal(clock.pending.size,0);
});
test('1142 a failed check and failed automatic retry leave no notice in the rail',async()=>{
  const clock=retryClock();let reads=0,commands=0;
  const f=fixture({view:async()=>{reads++;throw TypeError('offline');},command:async()=>{commands++;}},{timers:clock.timers});
  await f.owner.published(null,item());assert.equal(reads,1);assert.equal(f.host.children.length,0);
  await clock.tick();assert.equal(reads,2);assert.equal(f.host.children.length,0);assert.equal(clock.pending.size,0);assert.equal(commands,0);
  await f.owner.published(null,item());assert.equal(reads,2);assert.equal(clock.pending.size,0);
});
test('add is bound to sent scope; uncertain retry keeps operation; definitive conflict retries once',async()=>{
  const requests=[];const f=fixture({command:async envelope=>{
    requests.push(structuredClone(envelope));
    if(requests.length===1)throw Error('lost answer');
    if(requests.length===2)return {instance_id:'i1',operation_id:envelope.operation_id,status:'rejected',recorded:false,error:{code:'REVISION_CONFLICT',current_versions:{topic_revision:9}}};
    return {instance_id:'i1',operation_id:envelope.operation_id,status:'committed',recorded:true,result:{present:true,actor_id:'outside',topic_id:'t1'}};
  }});
  await f.owner.published(null,item());const add=f.buttons()[0];await add.onclick();
  assert.equal(add.textContent,'Check add @outside');await add.onclick();
  assert.equal(requests[0].operation_id,requests[1].operation_id);assert.notEqual(requests[1].operation_id,requests[2].operation_id);
  assert.deepEqual(requests.map(r=>r.target),[{topic_id:'t1'},{topic_id:'t1'},{topic_id:'t1'}]);
  assert.deepEqual(requests[0].expected.authority,{authority_id:'a',authority_epoch:'e'});
  assert.equal(requests[2].expected.topic_revision,9);assert.equal(add.disabled,true);
});
test('outcome permission controls Add; changed authority makes old controls inert',async()=>{
  let commands=0;const f=fixture({view:async()=>answer(['outside'],{scope:{...scope,kind:'outcome',id:'w1',may_add:false}}),command:async()=>{commands++;}});
  await f.owner.published(null,item());assert.deepEqual(f.buttons().map(b=>b.textContent),['×']);
  const g=fixture({command:async()=>{commands++;}});await g.owner.published(null,item());g.owner.authority=()=>({...authority,authority_epoch:'changed'});await g.buttons()[0].onclick();assert.equal(commands,0);
});

for(const code of ['FORBIDDEN','UNKNOWN_VIEW','INVALID_ARGUMENT'])test('terminal view refusal removes advice: '+code,async()=>{
 let reads=0;const f=fixture({view:async()=>{reads++;return {instance_id:'i1',error:{code,message:'Definitive '+code,retryable:false}};}});
 await f.owner.published(null,item());await f.owner.published(null,item());assert.equal(reads,1);assert.equal(f.host.children.length,0);
});
test('retryable Core read refusal retries quietly and terminal unsend stays silent',async()=>{
 const clock=retryClock();let reads=0;const f=fixture({view:async()=>++reads===1?{error:{code:'SERVER_BUSY',message:'busy',retryable:true}}:{error:{code:'FORBIDDEN',message:'unsent',retryable:false}}},{timers:clock.timers});
 await f.owner.published(null,item());assert.equal(f.host.children.length,0);await clock.tick();assert.equal(reads,2);assert.equal(f.host.children.length,0);assert.equal(clock.pending.size,0);
});
for(const code of ['SERVER_BUSY','CLEANUP_DEFERRED','RESYNC_REQUIRED','READ_SUPERSEDED'])test('1142 quiet retry is bounded for '+code,async()=>{
 const clock=retryClock();let reads=0;const f=fixture({view:async()=>{reads++;return {error:{code,message:code}};}},{timers:clock.timers});
 await f.owner.published(null,item());assert.equal(reads,1);assert.equal(f.host.children.length,0);
 await clock.tick();assert.equal(reads,2);assert.equal(f.host.children.length,0);assert.equal(clock.pending.size,0);
});
test('1142 a failed later page restarts the bounded check without leaking a partial outsider list',async()=>{
 const clock=retryClock(),cursors=[];let attempt=0;
 const f=fixture({view:async(_name,args)=>{cursors.push(args.cursor);if(cursors.length===1)return answer(['partial'],{next_cursor:23});if(cursors.length===2)throw TypeError('offline');attempt++;return answer([]);}},{timers:clock.timers});
 await f.owner.published(null,item());assert.equal(f.host.children.length,0);
 await clock.tick();assert.deepEqual(cursors,[0,23,0]);assert.equal(attempt,1);assert.equal(f.host.children.length,0);
});
test('1142 disposal cancels its delayed retry; retirement or authority change cannot start it',async()=>{
 for(const end of ['dispose','retire','authority']){
  const clock=retryClock();let reads=0;const f=fixture({view:async()=>{reads++;throw TypeError('offline');}},{timers:clock.timers});
  await f.owner.published(null,item());assert.equal(clock.pending.size,1);
  if(end==='dispose'){f.owner.dispose();assert.equal(clock.pending.size,0);}else{
   if(end==='retire')f.retire();else f.owner.authority=()=>({...authority,authority_epoch:'changed'});
   await clock.tick();
  }
  assert.equal(reads,1);assert.equal(f.host.children.length,0);assert.equal(clock.pending.size,0);
 }
});
test('1142 a delayed outsider answer cannot paint after its owner is disposed',async()=>{
 const clock=retryClock(),late=deferred();let reads=0;
 const f=fixture({view:async()=>{if(++reads===1)throw TypeError('offline');return late.promise;}},{timers:clock.timers});
 await f.owner.published(null,item());const retried=clock.tick();assert.equal(reads,2);
 f.owner.dispose();late.resolve(answer());await retried;assert.equal(f.host.children.length,0);assert.equal(clock.pending.size,0);
});
for(const code of ['FORBIDDEN','INVALID_RECIPIENT','TOO_MANY_PARTICIPANTS'])test('rejected Add is definitive visible text and never Check add: '+code,async()=>{
 let calls=0;const reason='Cannot add: '+code;const f=fixture({command:async request=>{calls++;return {instance_id:'i1',operation_id:request.operation_id,status:'rejected',recorded:false,error:{code,message:reason}};}});
 await f.owner.published(null,item());const add=f.buttons()[0];await add.onclick();await add.onclick();assert.equal(calls,1);assert.ok(f.host.all().some(n=>n.textContent===reason));assert.deepEqual(f.buttons().map(b=>b.textContent),['×']);
});
test('a second definitive revision conflict stops after one fresh attempt and says why',async()=>{
 const requests=[];const f=fixture({command:async request=>{requests.push(request);return {instance_id:'i1',operation_id:request.operation_id,status:'rejected',recorded:false,error:{code:'REVISION_CONFLICT',message:'Changed again',current_versions:{topic_revision:request.expected.topic_revision+1}}};}});
 await f.owner.published(null,item());await f.buttons()[0].onclick();assert.equal(requests.length,2);assert.notEqual(requests[0].operation_id,requests[1].operation_id);assert.ok(f.host.all().some(n=>n.textContent==='Changed again'));assert.deepEqual(f.buttons().map(b=>b.textContent),['×']);
});
test('unknown transport result keeps the exact Add operation for Check add',async()=>{
 const requests=[];const f=fixture({command:async request=>{requests.push(request);return requests.length===1?{instance_id:'i1',operation_id:request.operation_id,status:'unknown',recorded:false}:{instance_id:'i1',operation_id:request.operation_id,status:'committed',recorded:true,result:{present:true,actor_id:'outside',topic_id:'t1'}};}});
 await f.owner.published(null,item());const add=f.buttons()[0];await add.onclick();assert.equal(add.textContent,'Check add @outside');await add.onclick();assert.equal(requests[0].operation_id,requests[1].operation_id);
});
test('unsubscribed Conversation team agent is warned without an ineffective repeated Add',async()=>{
 const f=fixture({view:async()=>answer(['outside'],{scope:{...scope,kind:'outcome',id:'w1'},items:[{actor_id:'outside',name:'outside',kind:'agent',may_add:false}]})});
 await f.owner.published(null,item());assert.deepEqual(f.buttons().map(b=>b.textContent),['×']);assert.ok(f.host.all().some(n=>n.textContent?.includes('Name them in To')));
});
