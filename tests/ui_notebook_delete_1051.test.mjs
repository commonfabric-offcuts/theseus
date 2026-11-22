import test from 'node:test';
import assert from 'node:assert/strict';
import {NotebookWriting,NOTEBOOK_UNDO_MS} from '../web/notebook-writing.mjs';
const copy=structuredClone;
async function fixture(t){
 const bootstrap={instance_id:'i',actor:'p',authority:{authority_id:'a',authority_epoch:'e'}};
 let source={instance_id:'i',source_ref:{kind:'memory',id:'n',revision:1},owner_scope:{kind:'topic',id:'t'},title:'Page',body:'Words',attachments:[],references:[],reader_may_write:true,reader_may_delete:true,deleted:false},held=null;
 const calls=[],receipts=new Map(),clients=[],history=[copy(source)];let fail=false;
 const store={get:async()=>copy(held),put:async value=>{if(fail)throw Error('Disk full');held=copy(value);},delete:async()=>{if(fail)throw Error('Disk full');held=null;}};
 const api={view:async()=>copy(source),command:async e=>{
  assert.deepEqual(held.actionPending??held.pending,e,'exact operation kept before transport');calls.push(copy(e));
  if(receipts.has(e.operation_id))return copy(receipts.get(e.operation_id));
  const r={instance_id:'i',operation_id:e.operation_id,kind:e.kind,recorded:true};
  if(e.expected.item_revision!==source.source_ref.revision)Object.assign(r,{status:'rejected',error:{code:'REVISION_CONFLICT',message:'Changed'}});
  else{source={...source,...copy(e.args),source_ref:{kind:'memory',id:'n',revision:source.source_ref.revision+1}};history.push(copy(source));Object.assign(r,{status:'committed',result:{item_id:'n',revision:source.source_ref.revision,source_ref:copy(source.source_ref),deleted:source.deleted}});}
  receipts.set(e.operation_id,copy(r));return r;
 }};
 const make=async()=>{const w=new NotebookWriting({item:'n',bootstrap,api,store,delay:60000});clients.push(w);await w.open();return w;};t.after(()=>clients.forEach(w=>w.close()));
 return {api,store,bootstrap,calls,history,held:()=>copy(held),source:()=>copy(source),fail:v=>fail=v,make,remote:()=>{source.source_ref.revision++;}};
}
const context={title:'Page',scope:{kind:'topic',id:'t'},mode:'cards'};
test('1051 durable close precedes transport, confirmed deletion retains Undo target and all history',async t=>{
 const f=await fixture(t),w=await f.make();let kept=0;w.actionKept=()=>{assert.equal(f.calls.length,0);assert.deepEqual(f.held().deleteUndo.scope,context.scope);kept++;};
 await w.action('memory.delete',{deleted:true},context);assert.equal(kept,1);assert.equal(w.deleteUndo.phase,'committed');assert.equal(f.held().deleteUndo.revision,2);assert.equal(w.deleteUndo.expires-w.deleteUndo.at<=NOTEBOOK_UNDO_MS+1000,true);
 await w.undoDelete();assert.equal(w.deleteUndo.phase,'undone');assert.equal(f.source().deleted,false);assert.equal(f.source().body,'Words');assert.deepEqual(f.history.map(h=>h.deleted),[false,true,false]);
 assert.equal(f.calls[1].expected.item_revision,2);assert.notEqual(f.calls[0].operation_id,f.calls[1].operation_id);
});
test('1051 storage failure sends nothing and does not close; exact retry keeps the target',async t=>{
 const f=await fixture(t),w=await f.make();let closed=0;w.actionKept=()=>closed++;f.fail(true);await w.action('memory.delete',{deleted:true},context);assert.equal(closed,0);assert.equal(f.calls.length,0);assert.ok(w.actionPending);const e=copy(w.actionPending);
 f.fail(false);await w.retryAction();assert.equal(closed,1);assert.deepEqual(f.calls[0],e);
});
test('1051 lost deletion receipt and reload retry exactly once before queued Undo',async t=>{
 const f=await fixture(t),w=await f.make(),send=f.api.command;
 f.api.command=async e=>{await send(e);throw Error('Answer lost');};await w.action('memory.delete',{deleted:true},context);const original=copy(w.actionPending);await w.undoDelete();assert.equal(f.held().deleteUndo.undoRequested,true);assert.equal(f.source().deleted,true);w.close();
 f.api.command=send;const next=await f.make();assert.deepEqual(f.calls[1],original);assert.equal(f.calls.length,3);assert.equal(next.deleteUndo.phase,'undone');assert.equal(f.source().source_ref.revision,3);assert.equal(f.source().body,'Words');
});
test('1051 lost restore receipt reload retains its exact identity and does not re-delete',async t=>{
 const f=await fixture(t),w=await f.make(),send=f.api.command;await w.action('memory.delete',{deleted:true},context);
 f.api.command=async e=>{await send(e);throw Error('Lost restore');};await w.undoDelete();const undo=copy(w.actionPending);assert.equal(undo.args.deleted,false);w.close();f.api.command=send;const next=await f.make();assert.deepEqual(f.calls.at(-1),undo);assert.equal(next.deleteUndo.phase,'undone');assert.equal(f.source().source_ref.revision,3);
});
test('1051 native close after journaling does not run on conflicted local writing',async t=>{
 const f=await fixture(t),w=await f.make();w.conflict={revision:2};w.value.body='Retained local';let closed=false;w.actionKept=()=>closed=true;await w.action('memory.delete',{deleted:true},context);assert.equal(closed,false);assert.equal(f.calls.length,0);assert.equal(w.value.body,'Retained local');assert.match(w.actionError,/Finish saving/);
});
test('1051 definite delete refusal stays explicit and cannot acquire a restore',async t=>{
 const f=await fixture(t),w=await f.make();f.remote();await w.action('memory.delete',{deleted:true},context);assert.equal(w.deleteUndo.phase,'rejected');assert.equal(w.actionPending,null);await w.undoDelete();assert.equal(f.calls.length,1);assert.equal(f.source().deleted,false);
});
test('1051 Undo stays fenced to confirmed deletion when another revision is observed',async t=>{
 const f=await fixture(t),w=await f.make();await w.action('memory.delete',{deleted:true},context);f.remote();await w.refresh();await w.undoDelete();assert.equal(w.deleteUndo.phase,'restore_rejected');assert.equal(f.calls.length,1);assert.match(w.actionError,/changed after/);
});
test('1051 expiry bounds confirmed Undo but never expires an uncertain request',async t=>{
 const f=await fixture(t),w=await f.make();await w.action('memory.delete',{deleted:true},context);w.deleteUndo.expires=Date.now()-1;await w.undoDelete();assert.equal(f.calls.length,1);assert.equal(w.deleteUndo.undoRequested,false);
});
test('1051 changed authority never creates a fresh restore under a different runtime',async t=>{
 const f=await fixture(t),w=await f.make();await w.action('memory.delete',{deleted:true},context);w.bootstrap={...w.bootstrap,authority:{authority_id:'other',authority_epoch:'other'}};await assert.rejects(w.undoDelete(),/earlier runtime/);assert.equal(f.calls.length,1);
});
test('1051 concurrent late Undo continuations join the same restore operation',async t=>{
 const f=await fixture(t),w=await f.make(),send=f.api.command;let release,arrive;const reached=new Promise(done=>arrive=done),gate=new Promise(done=>release=done);
 f.api.command=async e=>{if(e.args.deleted){arrive();await gate;}return send(e);};const deleting=w.action('memory.delete',{deleted:true},context);await reached;const undo=w.undoDelete();await w.serial;assert.equal(f.held().deleteUndo.undoRequested,true);release();await deleting;const joining=w.finishDeleteUndo();await Promise.all([undo,joining]);assert.equal(f.calls.length,2);assert.equal(w.deleteUndo.phase,'undone');assert.equal(f.source().deleted,false);
});
test('1051 a receipt whose device write fails remains an exact retry, not confirmed local deletion',async t=>{
 const f=await fixture(t),w=await f.make(),send=f.api.command;f.api.command=async e=>{const r=await send(e);f.fail(true);return r;};await w.action('memory.delete',{deleted:true},context);const exact=copy(w.actionPending);assert.ok(exact);assert.equal(f.held().deleteUndo.phase,'pending');assert.match(w.actionError,/Not confirmed/);f.fail(false);f.api.command=send;await w.retryAction();assert.deepEqual(f.calls[1],exact);assert.equal(f.history.length,2);assert.equal(f.held().deleteUndo.phase,'committed');
});
test('1051 full-page departure releases the writer after keeping its exact request; destination resumes it',async t=>{
 const f=await fixture(t),w=await f.make();w.actionKept=()=>w.close();await w.action('memory.delete',{deleted:true},context);assert.equal(f.calls.length,0);const kept=copy(f.held().actionPending);assert.equal(f.held().deleteUndo.phase,'pending');const next=await f.make();assert.deepEqual(f.calls[0],kept);assert.equal(next.deleteUndo.phase,'committed');assert.equal(f.source().deleted,true);
});
test('1051 Undo queued during destination opening is durable before the original request resumes',async t=>{
 const f=await fixture(t),w=await f.make();w.actionKept=()=>w.close();await w.action('memory.delete',{deleted:true},context);
 const next=new NotebookWriting({item:'n',bootstrap:f.bootstrap,api:f.api,store:f.store});t.after(()=>next.close());await next.open(async current=>{await current.undoDelete();assert.equal(f.held().deleteUndo.undoRequested,true);assert.equal(f.calls.length,0);});assert.deepEqual(f.calls.map(c=>c.args.deleted),[true,false]);assert.equal(next.deleteUndo.phase,'undone');
});
