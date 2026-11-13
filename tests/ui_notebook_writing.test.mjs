import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookWriting, mergeCardContent, sameContent, rebaseCardActs } from '../web/notebook-writing.mjs';

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
  c.edit({body:'First change'},c.capture()); const save=c.flush(); await waiting;
  c.edit({body:'Second change'},c.capture()); release(); await save;
  assert.equal(c.value.body,'Second change'); assert.equal(c.base.content.body,'First change'); assert.equal(c.base.revision,2);
  f.api.command=command; await c.flush();
  assert.equal(f.source().body,'Second change'); assert.equal(f.calls[1].expected.item_revision,2);
  assert.notEqual(f.calls[0].operation_id,f.calls[1].operation_id); assert.equal(c.dirty,false);
});

test('a lost answer reloads and retries the exact full request once, retaining newer local words', async t => {
  const f=fixture(t), c=await f.make(), command=f.api.command;
  f.api.command=async e=>{await command(e);throw Error('Connection lost');};
  c.edit({body:'Sent first',title:'New title',attachments:[{id:'image1'},{id:'image2'}]},c.capture()); await c.flush();
  const request=copy(c.pending); c.edit({body:'Typed after the loss'},c.capture()); await c.serial; c.close();
  f.api.command=command; const next=await f.make();
  assert.deepEqual(f.calls[1],request); assert.equal(f.source().source_ref.revision,2,'retry creates no extra revision');
  assert.equal(next.value.body,'Typed after the loss'); await next.flush();
  assert.equal(f.source().body,'Typed after the loss'); assert.deepEqual(f.source().references,[{kind:'message',id:'evidence1'}]);
  assert.equal(f.source().source_ref.revision,3);
});

test('a competing revision keeps both versions until the writer chooses, never replacing either silently', async t=>{
  const f=fixture(t), c=await f.make(); c.edit({body:'Mine'},c.capture()); f.revise({body:'The agent’s change'}); await c.flush();
  assert.equal(c.value.body,'Mine'); assert.equal(c.conflict.content.body,'The agent’s change'); assert.equal(f.source().body,'The agent’s change');
  await c.resolve(true); await c.flush(); assert.equal(f.source().body,'Mine'); assert.equal(f.calls.at(-1).expected.item_revision,2);
  c.edit({body:'Another local change'},c.capture()); f.revise({body:'Keep this saved version'}); await c.refresh();
  await c.resolve(false); assert.equal(c.value.body,'Keep this saved version'); assert.equal(c.dirty,false);
});

test('a malformed receipt never discards the uncertain request or newer writing', async t=>{
  const f=fixture(t), c=await f.make(), command=f.api.command;
  f.api.command=async e=>({...await command(e),operation_id:'someone-else'});
  c.edit({body:'Retained'},c.capture()); await c.flush(); assert.ok(c.pending); assert.match(c.error,/does not match/);
  const request=copy(c.pending); f.api.command=command; await c.flush(); assert.deepEqual(f.calls.at(-1),request); assert.equal(c.pending,null);
});

test('storage failure prevents a request leaving and preserves words for a later retry', async t=>{
  const f=fixture(t), c=await f.make(); f.storageFails(true); c.edit({body:'Do not lose this'},c.capture()); await c.flush();
  assert.equal(f.calls.length,0); assert.equal(c.value.body,'Do not lose this'); assert.ok(c.pending);
  f.storageFails(false); await c.flush(); assert.equal(f.source().body,'Do not lose this');
});

test('a definite refusal clears the envelope but keeps writing and refuses further writes after authority change', async t=>{
  const f=fixture(t), c=await f.make(); c.edit({body:'My retained words'},c.capture());
  f.api.command=async e=>({instance_id:'i1',operation_id:e.operation_id,kind:e.kind,recorded:false,status:'rejected',error:{code:'AUTHORITY_CHANGED',message:'Authority changed'}});
  await c.flush(); assert.equal(c.pending,null);assert.equal(c.readOnly,true);assert.equal(c.value.body,'My retained words');
  const next=await f.make();assert.equal(next.pending,null);assert.equal(next.readOnly,false);assert.equal(next.value.body,'My retained words');
  await next.flush();assert.equal(next.readOnly,true,'the current authority still refuses a new request');
});
test('a refusal without a record does not poison future valid requests', async t=>{
  const f=fixture(t), c=await f.make(), command=f.api.command;
  let refused;
  f.api.command=async e=>{refused=e;return {instance_id:'i1',operation_id:e.operation_id,kind:e.kind,recorded:false,status:'rejected',error:{code:'INVALID_ARGUMENT',message:'Invalid request'}};};
  c.edit({body:'First'},c.capture());await c.flush();assert.equal(c.pending,null);assert.equal(c.readOnly,false);
  f.api.command=command;c.edit({body:'Corrected'},c.capture());await c.flush();
  assert.notEqual(f.calls.at(-1).operation_id,refused.operation_id);assert.equal(f.source().body,'Corrected');
});
test('focus without local writing accepts the latest words and cannot write the old words back', async t=>{
  const f=fixture(t),c=await f.make();c.active=true;f.revise({body:'Changed remotely'});await c.refresh();
  assert.equal(c.value.body,'Changed remotely');assert.equal(c.conflict,null);await c.resolve(true);await c.flush();
  assert.equal(f.calls.length,0);assert.equal(f.source().body,'Changed remotely');assert.equal(f.held(),null);
});
test('confirmed writing deletes its recovery record while newer unsaved words retain one',async t=>{
  const f=fixture(t),c=await f.make();assert.equal(f.held(),null);
  c.edit({body:'Saved words'},c.capture());await c.serial;assert.ok(f.held());await c.flush();assert.equal(f.held(),null);
});
test('Cards merge different card edits, preserve exact words, and require a choice for the same card',()=>{
  const base={title:'Page',body:'Opening\n\n## A\n\nOne\n\n## B\n\nTwo\n',attachments:[],references:[]};
  const mine={...base,body:base.body.replace('One','Mine')},theirs={...base,body:base.body.replace('Two','Theirs')};
  assert.equal(mergeCardContent(base,mine,theirs).body,base.body.replace('One','Mine').replace('Two','Theirs'));
  assert.equal(mergeCardContent(base,mine,{...base,body:base.body.replace('One','Conflict')}),null);
  assert.equal(mergeCardContent(base,{...base,body:base.body+'\n## C\n\nNew\n'},theirs).body,theirs.body+'\n## C\n\nNew\n');
});


test('every edit carries its displayed content even while a slow journal holds a newer Text revision',async t=>{
  const f=fixture(t),c=await f.make(),seen=c.capture(),put=f.store.put;
  let entered,release;const blocked=new Promise(r=>entered=r);
  f.store.put=async value=>{entered();await new Promise(r=>release=r);return put(value);};
  f.revise({body:'Agent words'});const refreshing=c.refresh();await blocked;
  f.store.put=put;
  c.edit({body:seen.content.body+' X'},seen,'text');
  assert.equal(c.conflict.content.body,'Agent words');assert.equal(f.source().body,'Agent words');
  release();await refreshing;await c.serial;await c.flush();assert.equal(f.calls.length,0);
  await c.resolve(false);assert.equal(c.dirty,false);
});

test('stale Cards edits rebase their own delta onto changes accepted before redraw',async t=>{
  const f=fixture(t),c=await f.make(),body='## A\nOne\n## B\nTwo\n## C\nThree\n';
  f.revise({body});await c.refresh();const seen=c.capture();
  f.revise({body:body.replace('Three','Agent')});await c.refresh();
  c.edit({body:body.replace('One','Mine')},seen,'cards');
  assert.equal(c.conflict,null);assert.equal(c.value.body,body.replace('One','Mine').replace('Three','Agent'));
  await c.flush();assert.equal(c.dirty,false);assert.equal(f.held(),null);
});

test('a merged saved content settles regardless of property order and untouched separators are exact',async t=>{
  const f=fixture(t),c=await f.make(),base={...c.value,body:'## A\nOne\n## B\nTwo\n## C\nThree\n'};
  const mine={...base,body:base.body.replace('One','Mine')},theirs={...base,body:base.body.replace('Three','Theirs')};
  const merged=mergeCardContent(base,mine,theirs);
  assert.equal(merged.body,base.body.replace('One','Mine').replace('Three','Theirs'));
  c.value=merged;c.base={...c.base,content:{title:merged.title,body:merged.body,attachments:merged.attachments,references:merged.references}};
  assert.ok(sameContent(c.value,c.base.content));assert.equal(c.dirty,false);await c.persist();assert.equal(f.held(),null);
});

test('permission refusals pause this opening only and Try again uses a new request',async t=>{
  const f=fixture(t),c=await f.make(),command=f.api.command;let refused;
  f.api.command=async e=>{refused=e;return {instance_id:'i1',operation_id:e.operation_id,kind:e.kind,recorded:true,status:'rejected',error:{code:'FORBIDDEN',message:'Access removed'}};};
  c.edit({body:'Keep my words'},c.capture());await c.flush();assert.equal(c.readOnly,true);
  f.api.command=command;await c.retry();assert.equal(c.readOnly,false);assert.equal(f.source().body,'Keep my words');
  assert.notEqual(f.calls.at(-1).operation_id,refused.operation_id);
});

test('a reload can save retained writing after membership returns',async t=>{
  const f=fixture(t),c=await f.make(),command=f.api.command;
  f.api.command=async e=>({instance_id:'i1',operation_id:e.operation_id,kind:e.kind,recorded:true,status:'rejected',error:{code:'OUTCOME_REACHED',message:'Read only'}});
  c.edit({body:'Retained words'},c.capture());await c.flush();assert.equal(c.readOnly,true);c.close();
  f.api.command=command;const next=await f.make();await next.flush();assert.equal(next.readOnly,false);assert.equal(f.source().body,'Retained words');
});

test('discard after a refusal removes only local writing without sending it',async t=>{
  const f=fixture(t),c=await f.make();c.edit({body:'Discard me'},c.capture());await c.serial;c.readOnly=true;
  const image={id:'pending',associated:false,bytes:new ArrayBuffer(1)};c.images.push(image);
  assert.equal(await c.discard(),true);assert.equal(image.removed,true);assert.equal(image.bytes,null);assert.equal(c.value.body,f.source().body);assert.equal(c.dirty,false);assert.equal(c.readOnly,false);assert.equal(f.held(),null);assert.equal(f.calls.length,0);
});


test('an edit without a displayed snapshot cannot replace retained content',async t=>{
  const f=fixture(t),c=await f.make(),before=c.capture();
  assert.equal(c.edit({body:'Empty surface'}),false);
  assert.deepEqual(c.capture(),before);await c.flush();assert.equal(f.calls.length,0);
});

test('card gestures rebase on changed neighbors but cannot remove changed children',()=>{
  const before='## Plan\nShip it.\n## Notes\nDan reviews.\n## Risks\nNone yet.\n';
  const theirs=before.replace('Dan reviews.','Dan approves.');
  const move={kind:'move',text:'Plan\nShip it.',near:0,step:1};
  assert.equal(rebaseCardActs(before,theirs,[move]),'## Notes\nDan approves.\n\n## Plan\nShip it.\n\n## Risks\nNone yet.\n');
  const add={kind:'add',after:'Notes\nDan reviews.',text:'New',near:1,depth:0};
  assert.ok(rebaseCardActs(before,theirs,[add]).includes('Dan approves.\n\n## New'));
  const nested='## Plan\nShip it.\n### Notes\nDan reviews.\n';
  assert.equal(rebaseCardActs(nested,nested.replace('Dan reviews.','Agent changed child'),[{kind:'remove',text:'Plan\nShip it.',near:0}]),null);
});

// A draft page (item 391; docs/notebook-pages.md, "A draft page"): the mark is part of the page's content, saved,
// merged and kept as its words are, and a person Core does not let write the page (item 371) writes nothing new.
test('the draft mark is saved as a revision, merges beside other writing and leaves the words as they were', async t => {
  const f=fixture(t), c=await f.make();
  assert.equal(c.value.draft,false,'a page read without a mark is unmarked');
  assert.equal(c.edit({draft:true},c.capture()),true); assert.equal(c.dirty,true);
  await c.flush();
  assert.equal(f.calls.at(-1).args.draft,true); assert.equal(f.source().draft,true); assert.equal(f.source().body,'## First\n\nOriginal words\n');
  assert.equal(c.base.content.draft,true); assert.equal(c.dirty,false);
  // Cleared while the person's own words wait unsaved: one revision carries both.
  c.edit({body:'New words'},c.capture()); c.edit({draft:false},c.capture()); await c.flush();
  assert.deepEqual([f.source().body,f.source().draft,f.source().source_ref.revision],['New words',false,3]);
  // A mark and someone else's words merge, either way about: my words, their mark; my mark, their words.
  assert.deepEqual(mergeCardContent({title:'T',body:'a',attachments:[],references:[],draft:false},{title:'T',body:'b',attachments:[],references:[],draft:false},
    {title:'T',body:'a',attachments:[],references:[],draft:true}),{title:'T',body:'b',attachments:[],references:[],draft:true});
  assert.deepEqual(mergeCardContent({title:'T',body:'a',attachments:[],references:[],draft:false},{title:'T',body:'a',attachments:[],references:[],draft:true},
    {title:'U',body:'c',attachments:[],references:[],draft:false}),{title:'U',body:'c',attachments:[],references:[],draft:true});
  // The same mark set on both sides is one change, not a conflict.
  assert.equal(mergeCardContent({title:'T',body:'a',attachments:[],references:[],draft:true},{title:'T',body:'a',attachments:[],references:[],draft:false},
    {title:'T',body:'a',attachments:[],references:[],draft:false}).draft,false);
});

test('writing kept on a device before the mark existed reads as unmarked, and is no change of its own', async t => {
  const base={title:'T',body:'a',attachments:[],references:[]};
  assert.equal(sameContent(base,{...base,draft:false}),true);
  assert.equal(sameContent(base,{...base,draft:true}),false);
  const f=fixture(t), c=await f.make(); c.close();
  const held=f.held()??{v:1,binding:{instance_id:'i1',actor_id:'owner',item_id:'page'},base:copy(c.base),value:copy(c.value),pending:null,conflict:null,localVersion:0,images:[]};
  delete held.base.content.draft; delete held.value.draft;
  await f.store.put(held);
  const next=await f.make();
  assert.equal(next.dirty,false); assert.equal(f.calls.length,0,'nothing is saved for a mark nobody set');
});

test('a reader Core does not let write the page writes nothing new, and writing kept on the device still goes', async t => {
  const f=fixture(t), c=await f.make();
  c.edit({body:'Kept before the rule changed'},c.capture()); await c.serial;
  f.api.view=(view=>async (...args)=>({...await view(...args),reader_may_write:false}))(f.api.view);
  await c.refresh();
  assert.equal(c.reading,true);
  assert.equal(c.edit({body:'Not written'},c.capture()),false); assert.equal(c.edit({draft:true},c.capture()),false);
  assert.equal(c.value.body,'Kept before the rule changed');
  await c.flush(); assert.equal(f.calls.length,1,'what the device held goes, and Core answers it');
  // Told again that they may write, they write.
  f.api.view=(view=>async (...args)=>({...await view(...args),reader_may_write:true}))(f.api.view);
  f.revise({title:'Plans'}); await c.refresh();
  assert.equal(c.reading,false); assert.equal(c.edit({body:'Written'},c.capture()),true);
});

// Every read of the page as it stands tells the writing whether Core lets this person write it, so no path that
// takes the latest page back leaves the writing controls to someone it would refuse.
test('discarding after a refusal reads the page to read when Core no longer lets the person write it', async t => {
  const f=fixture(t), c=await f.make();
  c.edit({body:'Written before they left'},c.capture()); await c.serial;
  f.api.view=(view=>async (...args)=>({...await view(...args),reader_may_write:false}))(f.api.view);
  f.api.command=async e=>({instance_id:'i1',operation_id:e.operation_id,kind:e.kind,recorded:true,status:'rejected',error:{code:'FORBIDDEN',message:'Only those taking part write'}});
  await c.flush(); assert.equal(c.readOnly,true);
  assert.equal(await c.discard(),true);
  assert.equal(c.readOnly,false); assert.equal(c.reading,true,'the page is to read, not to write');
  assert.equal(c.edit({body:'Refused again'},c.capture()),false); assert.equal(c.value.body,f.source().body);
});

test('a save answered by a newer revision reads whether the person may still write the page', async t => {
  const f=fixture(t), c=await f.make();
  c.edit({body:'Mine'},c.capture()); await c.serial;
  f.revise({title:'Renamed elsewhere'});
  f.api.view=(view=>async (...args)=>({...await view(...args),reader_may_write:false}))(f.api.view);
  await c.flush();
  assert.equal(c.conflict.content.title,'Renamed elsewhere','the newer revision was read'); assert.equal(c.reading,true);
});
