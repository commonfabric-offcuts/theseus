import test from 'node:test';
import assert from 'node:assert/strict';
import { OutcomeCreation, retainOpening } from '../web/creation.mjs';

const copy=structuredClone;
const bootstrap={instance_id:'fixture',actor:'person',authority:{authority_id:'authority',authority_epoch:'epoch',continuity:'initial'},limits:{body_utf8_bytes:1024,workspace_members:4,http_envelope_bytes:2048}};
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture() {
  const rows=new Map(),calls=[],reads=[];let fail=false,owned=true,serial=0,answer=null;
  const journal={claim:async()=>owned,get:async id=>copy(rows.get(id)??null),put:async row=>{
    if(fail)throw Error('Storage failed');rows.set(row.id,copy(row));return copy(row);
  }};
  const receipt=envelope=>({instance_id:'fixture',operation_id:envelope.operation_id,kind:envelope.kind,recorded:true,status:'committed',
    result:{workspace:{id:envelope.args.id,owner_id:'person',title:envelope.args.title,version:1}}});
  const api={bootstrap:async()=>copy(bootstrap),command:async envelope=>{
    calls.push(copy(envelope));assert.deepEqual(rows.get('intent').envelope,envelope,'exact request must already be durable');
    return answer?answer(envelope):receipt(envelope);
  },view:async(name,args)=>{reads.push([name,copy(args)]);return answer?answer(calls.at(-1)):receipt(calls.at(-1));}};
  const create=()=>new OutcomeCreation({api,bootstrap:copy(bootstrap),journal,intentId:'intent',id:()=>`id-${++serial}`});
  return {rows,calls,reads,journal,api,receipt,create,setAnswer:fn=>answer=fn,fail:()=>fail=true,deny:()=>owned=false};
}
test('creation persists before dispatch, shares the pending promise and freezes owner and exact form',async()=>{
  const f=fixture(),c=f.create();await c.load();await c.edit({title:'Real outcome',purpose:'Its purpose',team:['agent']});
  const gate=defer();f.setAnswer(()=>gate.promise);
  const first=c.create(),second=c.create();assert.equal(first,second);await new Promise(r=>setTimeout(r,0));
  assert.equal(f.calls.length,1);assert.equal(c.readOnly,true);assert.deepEqual(f.calls[0].args.team,['person','agent']);
  await assert.rejects(c.edit({title:'Different'}),/locked|read.only/i);
  gate.resolve(f.receipt(f.calls[0]));await first;assert.equal(c.row.phase,'confirmed');assert.equal(c.row.workspace,f.calls[0].args.id);
});
test('failed durable save prevents creation and private opening admission',async()=>{
  const f=fixture(),c=f.create();await c.load();await c.edit({title:'Kept'});f.fail();
  await assert.rejects(c.create(),/Storage failed/);assert.equal(f.calls.length,0);
  await assert.rejects(retainOpening({journal:f.journal,bootstrap,workspace:'w',opening:'o',topic:'t'}),/Storage failed/);
});
test('blank title and invalid actor identifiers refuse before freezing or dispatch',async()=>{
  for(const fields of [{title:'  '},{title:'Good',team:['bad\nactor']},{title:'Good',team:['x'.repeat(201)]}]){
    const f=fixture(),c=f.create();await c.load();await c.edit(fields);
    await assert.rejects(c.create(),/title|actor/i);assert.equal(c.row.envelope,null);assert.equal(f.calls.length,0);
  }
});
test('unknown creation survives reload; Check only reads and Retry uses its complete original envelope',async()=>{
  const f=fixture(),c=f.create();await c.load();await c.edit({title:'Kept',purpose:'Purpose'});
  f.setAnswer(()=>{throw Error('connection lost');});await c.create();const original=copy(f.calls[0]);assert.equal(c.row.phase,'uncertain');
  const restored=f.create();await restored.load();assert.deepEqual(restored.row.envelope,original);
  f.setAnswer(envelope=>({instance_id:'fixture',operation_id:envelope.operation_id,recorded:false,status:'unknown'}));
  await restored.check();assert.equal(f.calls.length,1);assert.deepEqual(f.reads,[['operation',{operation_id:original.operation_id}]]);assert.equal(restored.retryAllowed,true);
  f.setAnswer(f.receipt);await restored.retry();assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1],original);assert.equal(restored.row.phase,'confirmed');
});
test('wrong receipt and changed authority never authorize retry or rebind',async()=>{
  const f=fixture(),c=f.create();await c.load();await c.edit({title:'Kept'});
  f.setAnswer(envelope=>({...f.receipt(envelope),result:{workspace:{id:'wrong',owner_id:'person',title:'Kept',version:1}}}));
  await c.create();assert.equal(c.row.phase,'uncertain');await assert.rejects(c.check(),/confirmation/i);assert.equal(c.retryAllowed,false);
  await assert.rejects(c.retry(),/Check/);const original=copy(c.row.envelope);
  f.api.bootstrap=async()=>({...bootstrap,authority:{...bootstrap.authority,authority_epoch:'changed'}});
  await assert.rejects(c.check(),/authority|runtime/i);assert.deepEqual(c.row.envelope,original);assert.equal(f.calls.length,1);
});
test('only an exact recorded refusal allows editing as a new creation act',async()=>{
  const f=fixture(),c=f.create();await c.load();await c.edit({title:'Kept',team:['unknown']});
  f.setAnswer(e=>({...f.receipt(e),status:'rejected',result:null,error:{code:'INVALID_RECIPIENT',message:'Unknown agent'}}));
  await c.create();assert.equal(c.row.phase,'rejected');const old=copy(c.row.envelope);
  await c.edit({team:[]});assert.equal(c.row.envelope,null);assert.deepEqual(c.row.history[0].envelope,old);
  f.setAnswer(f.receipt);await c.create();assert.notEqual(c.row.envelope.operation_id,old.operation_id);assert.notEqual(c.row.workspace,old.args.id);
});
test('another tab and a retained intent from another authority remain read-only',async()=>{
  const f=fixture(),first=f.create();await first.load();await first.edit({title:'Keep'});f.deny();const second=f.create();await second.load();
  assert.equal(second.readOnly,true);await assert.rejects(second.create(),/another tab|read.only/i);assert.equal(f.calls.length,0);
  const g=fixture();g.rows.set('intent',{...copy(first.row),authority:{authority_id:'other',authority_epoch:'old'}});
  const parked=g.create();await parked.load();assert.equal(parked.parked,true);assert.equal(parked.row.form.title,'Keep');await assert.rejects(parked.create(),/authority|runtime/i);assert.equal(g.calls.length,0);
});
test('private opening retains original identity without body and refuses conflicting route identity',async()=>{
  const f=fixture(),args={journal:f.journal,bootstrap,workspace:'w',opening:'o',topic:'t'};
  const first=await retainOpening(args);assert.equal(first.writable,true);assert.deepEqual(first.row.sourceRef,{kind:'new_topic',id:'o',workspace_id:'w'});
  assert.equal(Object.hasOwn(first.row,'body'),false);assert.equal(first.row.topic,'t');
  assert.deepEqual((await retainOpening(args)).row,first.row);
  await assert.rejects(retainOpening({...args,topic:'replacement'}),/identity/i);
  f.deny();assert.equal((await retainOpening(args)).writable,false);
});
test('creation departure blocks active commands, retains form changes, and requires a named second choice for uncertainty',async()=>{
  const f=fixture(),c=f.create();await c.load();await c.edit({title:'Kept'});
  const gate=defer();f.setAnswer(()=>gate.promise);const sending=c.create();
  await assert.rejects(c.leave('root','Outcomes'),/finish/i);
  await new Promise(r=>setTimeout(r,0));gate.reject(Error('offline'));await sending;
  await assert.rejects(c.leave('root','Outcomes'),/Choose.*Outcomes.*again/);
  await assert.rejects(c.leave('workspace:w','Selected outcome'),/Selected outcome/);
  await c.leave('workspace:w','Selected outcome');
  assert.deepEqual(f.rows.get('intent').envelope,c.row.envelope);
});

test('creation validates server whitespace and whole serialized request before freezing',async()=>{
  for(const fields of [{title:'\u0085'},{title:'\u001c\u001d'},{title:'Good',purpose:'\n'.repeat(1000)}]){
    const f=fixture(),c=f.create();await c.load();await c.edit(fields);
    await assert.rejects(c.create(),/title|request|size|large/i);assert.equal(c.row.envelope,null);assert.equal(f.calls.length,0);
  }
});
test('unrecorded refusals preserve the original act and expose the reason rather than authorizing a new act',async()=>{
  for(const code of ['INVALID_ARGUMENT','OPERATION_CONFLICT','AUTHORITY_CHANGED','INTERNAL_ERROR']){
    const f=fixture(),c=f.create();await c.load();await c.edit({title:'Kept'});
    f.setAnswer(e=>({...f.receipt(e),recorded:false,status:'rejected',result:null,error:{code,message:'Refused before confirmation',retryable:false}}));
    await c.create();assert.equal(c.row.phase,'uncertain');assert.equal(c.readOnly,true);assert.match(c.notice,/Refused before confirmation/);
    assert.equal(c.row.receipt,null);await assert.rejects(c.edit({title:'Different'}),/locked/);
  }
});
test('creation transient confirmation read cannot replace a terminal receipt',async()=>{
  for(const rejected of [false,true]){
    const f=fixture(),c=f.create();await c.load();await c.edit({title:'Kept'});
    if(rejected)f.setAnswer(e=>({...f.receipt(e),status:'rejected',error:{code:'INVALID_RECIPIENT',message:'Unavailable'}}));
    await c.create();const prior=copy(c.row),phase=c.row.phase;
    f.setAnswer(()=>({instance_id:'fixture',error:{code:'DATABASE_BUSY',message:'Try later',retryable:true}}));
    await assert.rejects(c.check(),/Try later|confirmation/i);assert.equal(c.row.phase,phase);assert.deepEqual(c.row.receipt,prior.receipt);
    assert.equal(f.rows.get('intent').phase,phase);
  }
});
test('read-only creation Refresh makes no write and does not trap departure',async()=>{
  const f=fixture(),first=f.create();await first.load();await first.edit({title:'Kept'});f.deny();const second=f.create();await second.load();
  f.journal.put=async()=>{throw Error('Readonly write attempted');};await second.refresh();await second.leave('root','Outcomes');assert.equal(second.storageError,undefined);
});
test('authority preflight failure keeps an editable draft with no imagined frozen request',async()=>{
  const f=fixture(),c=f.create();await c.load();await c.edit({title:'Kept'});f.api.bootstrap=async()=>{throw Error('Offline');};
  await assert.rejects(c.create(),/Offline/);assert.equal(c.row.envelope,null);assert.equal(c.row.phase,'draft');assert.equal(c.readOnly,false);
});

test('contradictory unknown cannot erase a verified terminal creation receipt',async()=>{
  const f=fixture(),c=f.create();await c.load();await c.edit({title:'Kept'});await c.create();const before=copy(c.row.receipt);
  f.setAnswer(e=>({instance_id:'fixture',operation_id:e.operation_id,status:'unknown',recorded:false}));
  await assert.rejects(c.check(),/recorded|confirmation/i);assert.equal(c.row.phase,'confirmed');assert.deepEqual(c.row.receipt,before);
});
