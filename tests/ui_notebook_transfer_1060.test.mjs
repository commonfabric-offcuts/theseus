import test from 'node:test';
import assert from 'node:assert/strict';
import {NotebookWriting,NOTEBOOK_UNDO_MS} from '../web/notebook-writing.mjs';

const copy=structuredClone, origin={kind:'topic',id:'t'}, destination={kind:'workspace',id:'w'};
// Receipt/recovery seam only: real Core effects, audience and migration are
// exercised in test_notebook_transfer_1060.py, not claimed by this adapter.
async function fixture(t){
 const bootstrap={instance_id:'i',actor:'p',authority:{authority_id:'a',authority_epoch:'e'}};
 let source={instance_id:'i',source_ref:{kind:'memory',id:'n',revision:1},owner_scope:origin,title:'Page',body:'Words',attachments:[],references:[],reader_may_write:true,reader_may_delete:true,deleted:false},held=null,fail=false;
 const calls=[],receipts=new Map(),writers=[];
 const store={get:async()=>copy(held),put:async value=>{if(fail)throw Error('Device full');held=copy(value);},delete:async()=>{if(fail)throw Error('Device full');held=null;}};
 const api={view:async()=>copy(source),command:async e=>{
  assert.deepEqual(held.actionPending??held.pending,e,'kept exact before transport');calls.push(copy(e));
  if(receipts.has(e.operation_id))return copy(receipts.get(e.operation_id));
  let r={instance_id:'i',operation_id:e.operation_id,kind:e.kind,recorded:true};
  if(e.expected.item_revision!==source.source_ref.revision)r={...r,status:'rejected',error:{code:'REVISION_CONFLICT',message:'Page changed'}};
  else{
   const from=copy(source.owner_scope),undo=e.kind==='memory.transfer.undo',copying=e.kind==='memory.copy';
   source={...source,...(e.kind==='memory.revise'?copy(e.args):{}),owner_scope:e.kind==='memory.move'?copy(e.args.owner_scope):undo?origin:from,
    body:copying?'Linked current body':undo?'Words':source.body,source_ref:{kind:'memory',id:'n',revision:source.source_ref.revision+1}};
   const result={item_id:'n',revision:source.source_ref.revision,source_ref:copy(source.source_ref),owner_scope:copy(source.owner_scope),transfer_id:e.operation_id,committed_ms:Date.now(),from_scope:from,to_scope:copy(undo?origin:e.args.owner_scope)};
   if(copying)result.copy={item_id:e.args.copy_id,revision:1,owner_scope:copy(destination),source_ref:{kind:'memory',id:e.args.copy_id,revision:1}};
   if(undo){result.undo_of=e.target.transfer_id;if(e.expected.copy_revision)result.copy={item_id:'clone',revision:2,owner_scope:copy(destination),source_ref:{kind:'memory',id:'clone',revision:2},deleted:true};}
   r={...r,status:'committed',result};
  }
  receipts.set(e.operation_id,copy(r));return r;
 }};
 const make=async()=>{const w=new NotebookWriting({item:'n',bootstrap,api,store,delay:60000});writers.push(w);await w.open();return w;};
 t.after(()=>writers.forEach(w=>w.close()));
 return {api,store,bootstrap,calls,receipts,held:()=>copy(held),fail:value=>fail=value,make,source:()=>copy(source),remote:()=>source.source_ref.revision++};
}
const context={title:'Page',scope:origin,mode:'text'};
test('1060 move flushes actual writing and keeps exact scope/revision before transport',async t=>{
 const f=await fixture(t),w=await f.make();w.edit({body:'Latest writing'},w.capture());await w.serial;
 await w.action('memory.move',{owner_scope:destination},context);
 assert.deepEqual(f.calls.map(c=>c.kind),['memory.revise','memory.move']);assert.equal(f.calls[1].expected.item_revision,2);
 assert.ok(w.deleteUndo,'a transfer Undo target is required');assert.equal(w.deleteUndo.phase,'committed');assert.equal(w.deleteUndo.kind,'memory.move');assert.deepEqual(w.pageState.owner_scope,destination);
 assert.equal(w.deleteUndo.expires,f.receipts.get(f.calls[1].operation_id).result.committed_ms+NOTEBOOK_UNDO_MS);
});
test('1060 copy keeps one clone id, validates the two fences and Undo names its forward act',async t=>{
 const f=await fixture(t),w=await f.make();await w.action('memory.copy',{owner_scope:destination,copy_id:'clone'},context);
 assert.equal(f.calls[0].expected.copy_revision,0);assert.ok(w.deleteUndo,'a copy keeps its exact inverse target');assert.equal(w.value.body,'Linked current body');
 await w.undoDelete();const inverse=f.calls[1];assert.equal(inverse.kind,'memory.transfer.undo');assert.deepEqual(inverse.target,{transfer_id:f.calls[0].operation_id});
 assert.equal(inverse.expected.item_revision,2);assert.equal(inverse.expected.copy_revision,1);assert.ok(w.deleteUndo,'a transfer Undo target is required');assert.equal(w.deleteUndo.phase,'undone');assert.equal(w.value.body,'Words');
});
test('1060 uncertain copy reloads the same envelope before already-kept Undo',async t=>{
 const f=await fixture(t),w=await f.make(),send=f.api.command;f.api.command=async e=>{await send(e);throw Error('Answer lost');};
 await w.action('memory.copy',{owner_scope:destination,copy_id:'clone'},context);const exact=copy(w.actionPending);
 assert.ok(f.held().deleteUndo,'the uncertain transfer has durable Undo metadata');await w.undoDelete();assert.equal(f.held().deleteUndo.undoRequested,true);w.close();f.api.command=send;
 const next=await f.make();assert.deepEqual(f.calls[1],exact);assert.equal(f.calls.length,3);assert.equal(next.deleteUndo.phase,'undone');
});
test('1060 device failure sends nothing; refused or conflicted writing stays in its writer',async t=>{
 const f=await fixture(t),w=await f.make();f.fail(true);await w.action('memory.move',{owner_scope:destination},context);
 assert.equal(f.calls.length,0);assert.ok(w.actionPending);f.fail(false);await w.retryAction();assert.ok(w.deleteUndo,'a transfer Undo target is required');assert.equal(w.deleteUndo.phase,'committed');
 const g=await fixture(t),other=await g.make();other.conflict={revision:2};other.value.body='Retained';await other.action('memory.copy',{owner_scope:destination,copy_id:'clone'},context);
 assert.equal(g.calls.length,0);assert.equal(other.value.body,'Retained');assert.match(other.actionError,/Finish saving/);
});
test('1060 failed receipt persistence and later replay never renew Core first receipt deadline',async t=>{
 const f=await fixture(t),w=await f.make(),send=f.api.command;f.api.command=async e=>{const r=await send(e);f.fail(true);return r;};
 await w.action('memory.move',{owner_scope:destination},context);assert.ok(w.actionPending,'the exact uncertain transfer stays pending');const exact=copy(w.actionPending),first=f.receipts.get(exact.operation_id).result.committed_ms;
 assert.ok(exact);f.fail(false);w.close();f.api.command=send;const next=await f.make();
 assert.deepEqual(f.calls[1],exact);assert.ok(next.deleteUndo,'the first receipt deadline survives reload');assert.equal(next.deleteUndo.expires,first+NOTEBOOK_UNDO_MS);
});
test('1060 expiry prevents a new inverse and a later revision cannot be borrowed for Undo',async t=>{
 const f=await fixture(t),w=await f.make();await w.action('memory.move',{owner_scope:destination},context);assert.ok(w.deleteUndo,'confirmed transfer can be undone');w.deleteUndo.expires=Date.now()-1;
 await w.undoDelete();assert.equal(f.calls.length,1);w.deleteUndo.expires=Date.now()+1000;f.remote();await w.refresh();await w.undoDelete();
 assert.equal(f.calls.length,1);assert.ok(w.deleteUndo,'a transfer Undo target is required');assert.equal(w.deleteUndo.phase,'restore_rejected');
});
