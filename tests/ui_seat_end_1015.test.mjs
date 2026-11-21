import test from 'node:test';
import assert from 'node:assert/strict';
import { SeatAddition, seatWords } from '../web/headless-seat.mjs';

const bootstrap = { instance_id:'fixture', actor:'owner', authority:{authority_id:'authority',authority_epoch:'epoch'} };
const workspace = {id:'w1',version:1};
const seat = {id:'seat-1', agent_id:'scribe', state:'ready', version:7};
const clone = structuredClone;
function setup() {
  let saved = null, serial=0;
  const requests=[];
  const receipt = request => ({ instance_id:'fixture', operation_id:request.operation_id, kind:request.kind,
    recorded:true, status:'committed', result:{workspace_id:'w1', seat_request_id:seat.id,
      agent:{id:'scribe',name:'Scribe'},seat:{...seat,workspace_id:'w1',state:'ending',version:8}} });
  const journal={get:async()=>clone(saved),put:async(row,expected)=>{
    assert.equal(expected,saved?.revision??0);saved={...clone(row),revision:expected+1};return clone(saved);
  }};
  const api={bootstrap:async()=>clone(bootstrap),command:async r=>{requests.push(clone(r));throw Error('lost answer');},
    view:async()=>receipt(requests[0])};
  const make=()=>new SeatAddition({api,bootstrap,workspace,journal,id:()=>`op-${++serial}`});
  return {make,api,receipt,requests,saved:()=>clone(saved)};
}
test('End saves one exact request; lost response reloads and reads its receipt, keeping Add writing',async()=>{
  const s=setup(), owner=s.make();await owner.load();
  const form={name:'Next seat',role:'Keep my newer writing.\n'};await owner.edit(form);
  await assert.rejects(owner.endSeat(seat,'Scribe'),/unconfirmed/i);
  assert.deepEqual(s.saved().request,s.requests[0]);
  assert.deepEqual(s.requests[0],{v:1,instance_id:'fixture',operation_id:'op-1',kind:'workspace.hosted_seat_end',
    target:{workspace_id:'w1',seat_request_id:'seat-1'},expected:{authority:bootstrap.authority,seat_revision:7},args:{}});
  const next=s.make();await next.load();await next.again();
  assert.equal(s.requests.length,1);assert.equal(next.row.request,null);
  assert.deepEqual(next.row.form,form);assert.match(next.notice,/Ending after the current turn/);
});
test('Unknown End operation retries exact identity and bytes, never creates another act',async()=>{
  const s=setup(),owner=s.make();await owner.load();await assert.rejects(owner.endSeat(seat));
  s.api.view=async()=>({instance_id:'fixture',operation_id:'op-1',recorded:false,status:'unknown'});
  s.api.command=async r=>{s.requests.push(clone(r));return s.receipt(r);};
  await owner.again();assert.deepEqual(s.requests[0],s.requests[1]);
});
test('A mismatched End receipt stays unconfirmed; another End cannot erase it',async()=>{
  const s=setup(),owner=s.make();await owner.load();
  s.api.command=async r=>{s.requests.push(clone(r));const result=s.receipt(r);result.result.seat_request_id='other';return result;};
  await assert.rejects(owner.endSeat(seat),/unconfirmed/i);
  await assert.rejects(owner.endSeat({...seat,id:'other'}),/unconfirmed/i);
  assert.equal(s.requests.length,1);assert.equal(owner.row.request.target.seat_request_id,'seat-1');
});
test('End and ended name the turn boundary and retained history',()=>{
  assert.equal(seatWords({state:'ending'}),'Ending after the current turn…');
  assert.equal(seatWords({state:'ended'}),'Ended · history kept.');
});

test('an Add validation notice ends ownership by the earlier End notice',async()=>{
  const s=setup(),owner=s.make();await owner.load();s.api.command=async r=>s.receipt(r);
  await owner.endSeat(seat,'Scribe');assert.equal(owner.noticeSeatId,seat.id);
  await assert.rejects(owner.add(),/Give the seat a name/);
  assert.equal(owner.noticeSeatId,null);assert.match(owner.notice,/Give the seat a name/);
});
test('an authority change after End keeps its parked notice through later Team refreshes',async()=>{
  const s=setup(),owner=s.make();await owner.load();s.api.command=async r=>s.receipt(r);await owner.endSeat(seat,'Scribe');
  s.api.bootstrap=async()=>({...bootstrap,actor:'another'});
  await assert.rejects(owner.add(),/authority changed/);
  assert.equal(owner.noticeSeatId,null);assert.equal(owner.parked,true);assert.match(owner.notice,/authority changed/);
});
test('a recorded refusal after End replaces the old End notice',async()=>{
  const s=setup(),owner=s.make();await owner.load();await owner.edit({name:'Next seat',role:'Keep this role'});
  s.api.command=async r=>s.receipt(r);await owner.endSeat(seat,'Scribe');
  s.api.command=async r=>({...s.receipt(r),status:'rejected',result:null,error:{message:'This seat name already exists.'}});
  await assert.rejects(owner.add(),/already exists/);
  assert.equal(owner.noticeSeatId,null);assert.match(owner.notice,/already exists/);
});
