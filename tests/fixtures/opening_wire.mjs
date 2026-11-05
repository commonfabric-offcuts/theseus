import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Api } from '../../web/api.mjs';
import { OpeningDraft, OpeningPages } from '../../web/opening.mjs';

// Drives the browser's opening client through the real HTTP adapter and Core,
// so a wire name, argument or result shape the two sides disagree on fails here.
// Usage: node opening_wire.mjs ORIGIN TOKEN WORKSPACE MEMBER IMAGE
const [origin,token,workspace,member,imagePath]=process.argv.slice(2);
let lose=null; // A command kind whose answer is lost after Core has received it.
const sent=[];
const fetcher=async(path,{cache,...init})=>{
  if(path==='/api/command')sent.push(JSON.parse(init.body));
  const response=await fetch(origin+path,{...init,headers:{...init.headers,Origin:origin}});
  if(lose&&path==='/api/command'&&JSON.parse(init.body).kind===lose){lose=null;await response.arrayBuffer();throw Error('lost answer');}
  return response;
};
const api=new Api(token,fetcher);
const bootstrap=await api.bootstrap();
assert.equal(bootstrap.actor,'owner');
const timers={setTimeout:()=>({}),clearTimeout:()=>{}}; // Saves run only when this script asks.
const memory=()=>{const rows=new Map();return {rows,get:async id=>structuredClone(rows.get(id)??null),
  put:async row=>{rows.set(row.opening,structuredClone(row));},remove:async id=>{rows.delete(id);}};};
let serial=0;
const draft=(opening,topic)=>new OpeningDraft({api,bootstrap,store:memory(),workspace,opening,topic,timers,id:()=>`wire-${++serial}`});
const settle=async d=>{await d.saveQueue;await d.persisting.catch(()=>{});};
const unfinished=async()=>{
  const pages=new OpeningPages(bootstrap.instance_id,workspace);
  assert.ok(pages.accept(await api.view('openings',{workspace_id:workspace,limit:20})));
  return pages.items.map(item=>[item.id,item.topic_id,item.revision,item.title]);
};
const saved=async(d,revision)=>{await d.save();await settle(d);assert.equal(d.notice,null);assert.equal(d.base,revision);assert.equal(d.status,'Saved');};

// Nothing is saved until the first change; members come from workspace_members.
const first=draft('o-wire','t-wire');
assert.equal(await first.load(),'editing');assert.equal(first.base,0);
await first.loadMembers();
assert.ok(first.members.some(m=>m.actor_id===member&&m.kind==='agent'),JSON.stringify(first.members));
first.edit({title:'Wire topic',body:'Opening words'});first.setParticipants([member]);
await saved(first,1);
assert.deepEqual(await unfinished(),[['o-wire','t-wire',1,'Wire topic']]);

// Another device resumes the opening; the first device's stale save conflicts.
const other=draft('o-wire','t-wire');
assert.equal(await other.load(),'editing');
assert.deepEqual([other.base,other.writing.title,other.writing.participants],[1,'Wire topic',[member]]);
other.edit({body:'Edited on another device'});await saved(other,2);
first.edit({body:'Edited here'});await first.save();await settle(first);
assert.equal(first.conflict?.remote?.revision,2);assert.equal(first.conflict.remote.body,'Edited on another device');
await first.resolve('mine');await settle(first);assert.equal(first.conflict,null);assert.equal(first.base,3);

// An image goes through media.begin and the upload route, then is saved by reference.
const image=await first.attach(new File([await readFile(imagePath)],'one.png',{type:'image/png'}));
assert.equal(first.media.get(image).state,'ready',first.media.get(image).message);
await saved(first,4);
assert.equal(await first.send(),'published',first.refusal??first.notice);
assert.equal(first.receipt.result.topic.id,'t-wire');assert.equal(first.receipt.result.opening_revision,5);
const reread=draft('o-wire','t-wire');
assert.equal(await reread.load(),'published');assert.equal(reread.receipt.operation_id,first.receipt.operation_id);

// A stale publish is a recorded refusal; the next Send is a new operation.
const stale=draft('o-stale','t-stale'),newer=draft('o-stale','t-stale');
await stale.load();stale.edit({title:'Stale',body:'Words'});await saved(stale,1);
await newer.load();newer.edit({body:'Newer words'});await saved(newer,2);
assert.equal(await stale.send(),'refused');assert.equal(stale.phase,'editing');assert.equal(stale.base,2);
assert.equal(await stale.send(),'published',stale.refusal??stale.notice);
const publishes=sent.filter(e=>e.kind==='opening.publish'&&e.target.opening_id==='o-stale');
assert.deepEqual(publishes.map(e=>e.expected.opening_revision),[1,2]);assert.notEqual(publishes[0].operation_id,publishes[1].operation_id);

// A send whose answer is lost is settled by Check, from the operation view.
const lost=draft('o-lost','t-lost');
await lost.load();lost.edit({title:'Lost answer',body:'Words'});await saved(lost,1);
lose='opening.publish';
assert.equal(await lost.send(),'unknown');
assert.equal(await lost.check(),'published');assert.equal(lost.receipt.result.topic.id,'t-lost');

// Discard closes an opening and removes it from the unfinished list.
const dropped=draft('o-drop','t-drop');
await dropped.load();dropped.edit({title:'Dropped'});await saved(dropped,1);
assert.deepEqual(await unfinished(),[['o-drop','t-drop',1,'Dropped']]);
assert.equal(await dropped.discard(),'discarded');
assert.deepEqual(await unfinished(),[]);

process.stdout.write(JSON.stringify({image,operations:serial})+'\n');
