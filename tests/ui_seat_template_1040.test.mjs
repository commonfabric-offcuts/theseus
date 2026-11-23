import test from 'node:test';
import assert from 'node:assert/strict';
import {SeatAddition} from '../web/headless-seat.mjs';

const one='template-'+'1'.repeat(64), two='template-'+'2'.repeat(64);
const form={name:'Chosen seat',role:'Keep the named settings.',template_id:one};
const bootstrap={instance_id:'fixture',actor:'owner',authority:{authority_id:'a',authority_epoch:'e'}};
const receipt=request=>({instance_id:'fixture',operation_id:request.operation_id,kind:request.kind,recorded:true,status:'committed',
  result:{workspace_id:'w',seat_request_id:'seat-one',agent:{id:'chosen-seat',name:'Chosen seat'},
    seat:{id:'seat-one',agent_id:'chosen-seat',role:request.args.role,template_id:request.args.template_id}}});
async function fixture(answer=receipt){
  let row=null,serial=0;const sent=[];
  const journal={get:async()=>structuredClone(row),put:async(value,expected)=>{assert.equal(expected,row?.revision??0);row={...structuredClone(value),revision:expected+1};return structuredClone(row);}};
  const owner=new SeatAddition({bootstrap,workspace:{id:'w',version:1},journal,id:()=>`op-${++serial}`,
    api:{bootstrap:async()=>structuredClone(bootstrap),command:async request=>{sent.push(structuredClone(request));return answer(request);}}});
  await owner.load();owner.templates={available:true,items:[{id:one},{id:two}]};return {owner,sent};
}
test('1040 multiple templates require a named selection before any Add',async()=>{
  const f=await fixture();await f.owner.edit({name:form.name,role:form.role});
  await assert.rejects(f.owner.add(),/template/i);assert.equal(f.sent.length,0);
});
test('1040 late confirmation preserves a newer template choice with the same name and role',async()=>{
  let release;const f=await fixture(request=>new Promise(resolve=>release=()=>resolve(receipt(request))));
  await f.owner.edit(form);const pending=f.owner.add();
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  await f.owner.edit({...form,template_id:two});release();await pending;
  assert.equal(f.sent[0].args.template_id,one);assert.equal(f.owner.row.form.template_id,two);
});
test('1040 a receipt for different settings cannot clear the chosen request',async()=>{
  const f=await fixture(request=>{const r=receipt(request);r.result.seat.template_id=two;return r;});
  await f.owner.edit(form);await assert.rejects(f.owner.add(),/identity|template/i);
  assert.equal(f.owner.row.request.args.template_id,one);
});
test('1040 an unavailable catalogue keeps writing and sends no Add',async()=>{
  const f=await fixture();await f.owner.edit(form);f.owner.templates={available:false,items:[]};
  await assert.rejects(f.owner.add(),/not available/i);assert.equal(f.sent.length,0);
  assert.deepEqual(f.owner.row.form,form);
});
test('1040 retry for a legacy template refusal carries its choice and original seat',async()=>{
  const f=await fixture();await f.owner.edit(form);
  await f.owner.retrySeat({id:'seat-one',version:4,retryable:true,reason:'host_template_ambiguous'},'Legacy');
  assert.equal(f.sent[0].kind,'workspace.hosted_seat_retry');assert.equal(f.sent[0].target.seat_request_id,'seat-one');
  assert.deepEqual(f.sent[0].args,{template_id:one});assert.deepEqual(f.owner.row.form,form);
});
test('1040 retry of an uncertain Add keeps the exact choice despite newer writing',async()=>{
  const f=await fixture(()=>{throw Error('lost answer');});await f.owner.edit(form);
  await assert.rejects(f.owner.add(),/unconfirmed/);const request=structuredClone(f.owner.row.request);
  await f.owner.edit({...form,template_id:two});
  f.owner.api.view=async()=>({instance_id:'fixture',operation_id:request.operation_id,recorded:false,status:'unknown'});
  f.owner.api.command=async exact=>{f.sent.push(structuredClone(exact));return receipt(exact);};
  await f.owner.again();assert.deepEqual(f.sent[1],request);assert.equal(f.owner.row.form.template_id,two);
});
