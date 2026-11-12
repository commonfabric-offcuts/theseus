import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookWriting } from '../web/notebook-writing.mjs';

const copy = structuredClone;
function fixture(t) {
  const bootstrap = { instance_id: 'i1', actor: 'owner', authority: { authority_id: 'a1', authority_epoch: 'e1' } };
  let source = { instance_id: 'i1', source_ref: { kind: 'memory', id: 'page', revision: 1 }, owner_scope: { kind: 'workspace', id: 'w1' },
    title: 'Plans', body: '## First\n\nOriginal words\n', attachments: [{id:'image1',name:'First image'}], references: [{kind:'message',id:'evidence1'}] };
  let held = null, failStorage = false;
  const store = { get: async () => copy(held), put: async snapshot => { if (failStorage) throw Error('Disk full'); held = copy(snapshot); } };
  const calls = [], receipts = new Map(), clients = [];
  const api = { view: async () => copy(source), command: async envelope => {
    assert.deepEqual(held.pending, envelope, 'complete request is journaled before transport');
    calls.push(copy(envelope));
    if (receipts.has(envelope.operation_id)) return copy(receipts.get(envelope.operation_id));
    const r = { instance_id:'i1', operation_id:envelope.operation_id, kind:envelope.kind, recorded:true };
    if (envelope.expected.item_revision !== source.source_ref.revision) Object.assign(r, {status:'rejected', error:{code:'REVISION_CONFLICT',message:'Changed elsewhere'}});
    else {
      source = { ...source, ...copy(envelope.args), source_ref:{kind:'memory',id:'page',revision:source.source_ref.revision+1} };
      Object.assign(r, {status:'committed',result:{item_id:'page',revision:source.source_ref.revision,source_ref:copy(source.source_ref)}});
    }
    receipts.set(envelope.operation_id, copy(r)); return r;
  } };
  const make = async () => { const c = new NotebookWriting({item:'page',bootstrap,api,store,delay:60000}); clients.push(c); await c.open(); return c; };
  t.after(() => clients.forEach(c => c.close()));
  return { make, api, calls, store, bootstrap, held:()=>copy(held), source:()=>copy(source),
    storageFails: on => { failStorage=on; }, revise: patch => { source = {...source,...copy(patch),source_ref:{...source.source_ref,revision:source.source_ref.revision+1}}; } };
}

test('a late save keeps later writing and the next save uses its confirmed revision', async t => {
  const f = fixture(t), c = await f.make(), command=f.api.command;
  let release, arrived;
  const waiting = new Promise(done => { arrived=done; });
  f.api.command = async e => { const r=await command(e); arrived(); await new Promise(done => {release=done;}); return r; };
  c.edit({body:'First change'}); const save=c.flush(); await waiting;
  c.edit({body:'Second change'}); release(); await save;
  assert.equal(c.value.body,'Second change'); assert.equal(c.base.content.body,'First change'); assert.equal(c.base.revision,2);
  f.api.command=command; await c.flush();
  assert.equal(f.source().body,'Second change'); assert.equal(f.calls[1].expected.item_revision,2);
  assert.notEqual(f.calls[0].operation_id,f.calls[1].operation_id); assert.equal(c.dirty,false);
});

test('a lost answer reloads and retries the exact full request once, retaining newer local words', async t => {
  const f=fixture(t), c=await f.make(), command=f.api.command;
  f.api.command=async e=>{await command(e);throw Error('Connection lost');};
  c.edit({body:'Sent first',title:'New title',attachments:[{id:'image1'},{id:'image2'}]}); await c.flush();
  const request=copy(c.pending); c.edit({body:'Typed after the loss'}); await c.serial; c.close();
  f.api.command=command; const next=await f.make();
  assert.deepEqual(f.calls[1],request); assert.equal(f.source().source_ref.revision,2,'retry creates no extra revision');
  assert.equal(next.value.body,'Typed after the loss'); await next.flush();
  assert.equal(f.source().body,'Typed after the loss'); assert.deepEqual(f.source().references,[{kind:'message',id:'evidence1'}]);
  assert.equal(f.source().source_ref.revision,3);
});

test('a competing revision keeps both versions until the writer chooses, never replacing either silently', async t=>{
  const f=fixture(t), c=await f.make(); c.edit({body:'Mine'}); f.revise({body:'The agent’s change'}); await c.flush();
  assert.equal(c.value.body,'Mine'); assert.equal(c.conflict.content.body,'The agent’s change'); assert.equal(f.source().body,'The agent’s change');
  await c.resolve(true); await c.flush(); assert.equal(f.source().body,'Mine'); assert.equal(f.calls.at(-1).expected.item_revision,2);
  c.edit({body:'Another local change'}); f.revise({body:'Keep this saved version'}); await c.refresh();
  await c.resolve(false); assert.equal(c.value.body,'Keep this saved version'); assert.equal(c.dirty,false);
});

test('a malformed receipt never discards the uncertain request or newer writing', async t=>{
  const f=fixture(t), c=await f.make(), command=f.api.command;
  f.api.command=async e=>({...await command(e),operation_id:'someone-else'});
  c.edit({body:'Retained'}); await c.flush(); assert.ok(c.pending); assert.match(c.error,/does not match/);
  const request=copy(c.pending); f.api.command=command; await c.flush(); assert.deepEqual(f.calls.at(-1),request); assert.equal(c.pending,null);
});

test('storage failure prevents a request leaving and preserves words for a later retry', async t=>{
  const f=fixture(t), c=await f.make(); f.storageFails(true); c.edit({body:'Do not lose this'}); await c.flush();
  assert.equal(f.calls.length,0); assert.equal(c.value.body,'Do not lose this'); assert.ok(c.pending);
  f.storageFails(false); await c.flush(); assert.equal(f.source().body,'Do not lose this');
});

test('a save refusal keeps writing and an active editor is not replaced by a background refresh', async t=>{
  const f=fixture(t), c=await f.make(); c.active=true; f.revise({body:'Changed remotely'}); await c.refresh();
  assert.equal(c.value.body,'## First\n\nOriginal words\n'); assert.equal(c.conflict.content.body,'Changed remotely');
  await c.resolve(true);
  f.api.command=async e=>({instance_id:'i1',operation_id:e.operation_id,kind:e.kind,recorded:true,status:'rejected',error:{code:'FORBIDDEN',message:'No longer a member'}});
  await c.flush(); assert.equal(c.readOnly,true); assert.equal(c.value.body,'## First\n\nOriginal words\n'); assert.match(c.error,/No longer/);
});
