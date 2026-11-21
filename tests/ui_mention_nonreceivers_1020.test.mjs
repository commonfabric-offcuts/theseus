import test from 'node:test';
import assert from 'node:assert/strict';
import { MentionNotices } from '../web/mention-notices.mjs';

class Element {
  constructor(tag, doc) { Object.assign(this, { tag, ownerDocument: doc, children: [], dataset: {}, attributes: {} }); }
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
  items:people.map(actor_id=>({ actor_id, name:actor_id })), next_cursor:null, ...more });
function fixture(api={}) {
  const doc = { createElement: tag => new Element(tag, doc) }, host = new Element('div', doc);
  let current = true;
  const owner = new MentionNotices({ host, api:{ view:async()=>answer(), ...api }, instanceId:'i1', authority:()=>authority, current:()=>current });
  return { owner, host, buttons:()=>host.all().filter(node=>node.tag==='button'), retire:()=>{ current=false; } };
}
const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r); return { promise, resolve }; };

test('one notice for a confirmed send, all paged names, repeated confirmation deduplicated', async()=>{
  const calls=[]; const f=fixture({ view:async(name,args)=>{ calls.push([name,args]); return args.cursor ? answer(['outside','other']) : answer(['outside'],{next_cursor:23}); } });
  await f.owner.published(null,item()); await f.owner.published(null,item());
  assert.equal(f.host.children.length,1); assert.equal(calls.length,2);
  assert.deepEqual(f.buttons().map(b=>b.textContent),['Add @outside to topic','Add @other to topic','Dismiss']);
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
test('optional read failure offers Check again and retains one notice for the same send',async()=>{
  let reads=0;const f=fixture({view:async()=>{if(++reads===1)throw Error('offline');return answer();}});
  await f.owner.published(null,item());assert.equal(f.buttons()[0].textContent,'Check again');
  await f.buttons()[0].onclick();assert.equal(f.host.children.length,1);assert.equal(f.buttons()[0].textContent,'Add @outside to topic');
  await f.buttons().at(-1).onclick();assert.equal(f.host.children.length,0);
  await f.owner.published(null,item());assert.equal(f.host.children.length,0);
});
test('add is bound to sent scope; uncertain retry keeps operation; definitive conflict retries once',async()=>{
  const requests=[];const f=fixture({command:async envelope=>{
    requests.push(structuredClone(envelope));
    if(requests.length===1)throw Error('lost answer');
    if(requests.length===2)return {instance_id:'i1',operation_id:envelope.operation_id,status:'rejected',recorded:true,error:{code:'REVISION_CONFLICT',current_versions:{topic_revision:9}}};
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
  await f.owner.published(null,item());assert.deepEqual(f.buttons().map(b=>b.textContent),['Dismiss']);
  const g=fixture({command:async()=>{commands++;}});await g.owner.published(null,item());g.owner.authority=()=>({...authority,authority_epoch:'changed'});await g.buttons()[0].onclick();assert.equal(commands,0);
});
