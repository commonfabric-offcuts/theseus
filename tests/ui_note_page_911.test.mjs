import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookPage } from '../web/notebook-page.mjs';
import { notebookWriting } from '../web/quick-create.mjs';
import { parseDeck, cardText, deckBody } from '../web/deck.mjs';
import { ThingsRail } from '../web/things-rail.mjs';
import { notebookFixture } from './fixtures/notebook_sheet_dom.mjs';

// Real Sheet, NotebookPage, card acts, writer and journal; only transport,
// device storage and DOM geometry are in-memory. No native gesture claim.
function device() {
  const held=new Set(), requested=[], records=new Map(), lifetimes=[];
  const request=result=>{const r={result:structuredClone(result)};queueMicrotask(()=>r.onsuccess?.());return r;};
  const db={close(){},transaction(){
    const tx={objectStore:name=>({
      get:key=>request(records.get(name+key)),
      put:(value,key)=>records.set(name+key,structuredClone(value)),
      delete:key=>records.delete(name+key),
      index:()=>({openKeyCursor:()=>request(null)}),
    })};
    queueMicrotask(()=>queueMicrotask(()=>tx.oncomplete?.()));return tx;
  }};
  return {requested,held,lifetimes,navigator:{platform:'MacIntel',locks:{request(name,options,fn){
    requested.push({name,options});
    const lifetime=(async()=>{
      if(held.has(name))return fn(null);
      held.add(name);try{return await fn({name});}finally{held.delete(name);}
    })();lifetimes.push(lifetime);return lifetime;
  }}},indexedDB:{open(){const r={result:db};queueMicrotask(()=>r.onsuccess?.());return r;}},IDBKeyRange:{only:key=>key}};
}
async function fixture(t, answer) {
  const f = notebookFixture(t), disk = device(), pages = [], sent = [];
  const create = f.doc.createElement;
  f.doc.createElement = tag => {
    const n = create(tag);
    n.style.setProperty = (k,v) => n.style[k] = v;
    n.getClientRects = () => [n.getBoundingClientRect()];
    n.setSelectionRange = (start,end) => { n.selectionStart = start; n.selectionEnd = end; };
    n.scrollHeight = n.clientHeight = n.offsetHeight = 100;
    n.after = (...nodes) => { const next = n.parent?.children[n.parent.children.indexOf(n)+1]; for (const node of nodes) n.parent?.insertBefore(node,next); };
    return n;
  };
  for (const name of ['navigator','indexedDB','IDBKeyRange']) f.set(name,disk[name]);
  f.set('localStorage',{getItem:()=>null,setItem(){}});
  const source = { instance_id:'i', source_ref:{kind:'memory',id:'p',revision:1}, owner_scope:{kind:'topic',id:'t'}, title:'Existing title',
    body:'## First\n\nKept body\n\n## Second\n\nLast old card\n', draft:true, attachments:[{id:'old-image'}], references:[], reader_may_write:true };
  const api = {view:async name => {
    if (name === 'memory_current' || name === 'memory_status') { if (source.refused) throw Error('This page cannot be read.'); return structuredClone(source); }
    if (name === 'memory_items') return { relevant_versions:{notebook:source.source_ref.revision}, items:[] };
    throw Error('Unexpected view '+name);
  }, command:async request => {
    sent.push(structuredClone(request));
    if (answer) { const result = await answer(request,sent.length); if (result) return result; }
    Object.assign(source,structuredClone(request.args),{source_ref:{kind:'memory',id:'p',revision:request.expected.item_revision+1}});
    return {instance_id:'i',operation_id:request.operation_id,kind:request.kind,status:'committed',recorded:true,
      result:{item_id:'p',revision:source.source_ref.revision,source_ref:source.source_ref}};
  }};
  f.sheet.make = (id,host,header,idSuffix,revisionShown) => {
    const page = new NotebookPage({doc:f.doc,host,header,item:id,idSuffix,revisionShown,mode:'cards',api,read:api.view,send:api.command,
      bootstrap:{instance_id:'i',actor:'reader',authority:{authority_id:'a',authority_epoch:'e'}}, viewPreference:{get:()=> 'cards',set(){}},
      place:async()=>({title:'Topic',href:'?topic=t'}),askIn:async()=>null});
    pages.push(page); return page;
  };
  t.after(async()=>{ for (const page of pages) page.close(); await Promise.all(pages.map(page=>page.writing?.serial)); await Promise.all(disk.lifetimes); });
  return {...f,source,sent,pages,disk};
}
function job(body='New card\nNew words',images=[]) {
  const writing=notebookWriting(body,'note-card',images);
  return {body,cardWords:writing.card,words:writing.body,scope:{kind:'topic',id:'t'},attachments:images.map(image=>({id:image.id}))};
}
test('911 actual append preserves old cards, title, draft and attachments; opens the appended card picked',async t=>{
  const f=await fixture(t), add=job('New card\nNew words',[{id:'new-image',name:'Photo'}]);
  await f.sheet.appendNote('p',add);
  assert.equal(f.sheet.showing,false,'nothing opens before confirmed handoff');
  assert.equal(f.sent.length,1); assert.equal(f.sent[0].kind,'memory.revise');
  assert.equal(f.source.title,'Existing title'); assert.equal(f.source.draft,true);
  assert.deepEqual(f.source.attachments,[{id:'old-image'},{id:'new-image'}]);
  assert.deepEqual(parseDeck(f.source.body).cards.map(c=>c.title),['First','Second','New card']);
  assert.match(f.source.body,/Kept body/); assert.match(f.source.body,/Last old card/); assert.match(f.source.body,/new-image/);
  assert.ok(add.card.startsWith('c-')); assert.equal(f.source.source_ref.revision,2);
  await f.sheet.open('p',{mode:'cards',beside:true,card:add.card});
  assert.equal(f.sheet.current.picked,2); assert.equal(f.sheet.docked,true); assert.equal(f.pages.length,1);
});
test('911 actual lost append retries exact writer envelope and never adds twice',async t=>{
  const f=await fixture(t,(_r,n)=>{if(n===1)throw Error('Lost answer');}),add=job();
  await assert.rejects(f.sheet.appendNote('p',add),/Lost answer/);
  assert.equal(add.applied,true); assert.equal(f.sheet.showing,false);
  await f.sheet.appendNote('p',add);
  assert.deepEqual(f.sent[1],f.sent[0]); assert.equal(f.pages.length,1);
  assert.equal(parseDeck(f.source.body).cards.filter(c=>c.title==='New card').length,1);
  assert.equal(f.sheet.leaving.get('p').writing.pending,null);
});
for(const state of ['deleted','reader_may_write','refused','scope'])test('911 actual '+state+' destination refuses before an append',async t=>{
  const f=await fixture(t),before=structuredClone(f.source),add=job();
  if(state==='scope')f.source.owner_scope={kind:'topic',id:'other'};
  else f.source[state]=state==='reader_may_write'?false:true;
  await assert.rejects(f.sheet.appendNote('p',add),/available|read/);
  assert.equal(f.sent.length,0); assert.equal(f.source.body,before.body); assert.equal(add.applied,undefined);
  assert.equal(f.sheet.showing,false); assert.equal(f.sheet.leaving.size,0);
});
test('911 already open page reuses its writer and a changed title remains intact',async t=>{
  const f=await fixture(t); await f.sheet.open('p'); const page=f.sheet.current, writer=page.writing;
  f.source.title='Renamed elsewhere'; f.source.source_ref.revision=2;
  await f.sheet.appendNote('p',job());
  assert.ok(page.writing===writer); assert.equal(f.pages.length,1);
  assert.equal(f.sent[0].expected.item_revision,2); assert.equal(f.source.title,'Renamed elsewhere');
});
test('911 multiline headings and image lines use the same Cards add text without dropping later words',async t=>{
  const f=await fixture(t),add=job('Title\nBody\n\n## Another heading\nLater words',[{id:'new-image',name:'Photo'}]);
  await f.sheet.appendNote('p',add);
  assert.match(f.source.body,/Later words/); assert.match(f.source.body,/new-image/);
});
test('911 rail destination reader includes every bounded page, with identical names and Core order',async()=>{
  const calls=[],rail=Object.create(ThingsRail.prototype);
  rail.handles={topic:{id:'t'},pageMax:2,view:async(name,args,priority)=>{
    calls.push({name,args,priority}); return args.cursor?{items:[{id:'old',title:''}],next_cursor:null}:{items:[{id:'new',title:'Newest'},{id:'middle',title:'Middle'}],next_cursor:'next'};
  }};
  const result=await rail.notebookPages('t');
  assert.deepEqual(result,[{id:'new',name:'Newest'},{id:'middle',name:'Middle'},{id:'old',name:'Notebook page'}]);
  assert.equal(calls.length,2); assert.ok(calls.every(c=>c.name==='memory_items'&&c.args.limit===2&&c.args.owner_scope.id==='t'&&c.priority==='foreground'));
  assert.equal(calls[1].args.cursor,'next');
  assert.equal(result[2].name,rail.notebookName({title:''}));
});
test('911 rail destination read refuses an answer for a topic left behind',async()=>{
  let release; const held=new Promise(done=>release=done),rail=Object.create(ThingsRail.prototype);
  rail.handles={topic:{id:'t'},view:()=>held};
  const reading=rail.notebookPages('t');rail.handles={topic:{id:'other'}};release({items:[{id:'p',title:'Old topic'}],next_cursor:null});
  await assert.rejects(reading,/no longer available/);
});
