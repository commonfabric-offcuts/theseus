import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookDestinations,chooseNotebookDestination} from '../web/notebook-transfer.mjs';
import {book,scopeOf} from '../web/outline-order.mjs';

const topic=(id,position,patch={})=>({id,title:id,workspace_id:'w1171',list_position:position,state:'active',archived:false,build:false,...patch});
function fixture({conversation=topic('conversation',10),order=['b','conversation','a'],error=null}={}) {
 const calls=[];
 const read=async(name,args)=>{
  calls.push([name,structuredClone(args)]);
  if(name==='workspace')return {instance_id:'i1171',workspace:{id:'w1171',title:'Outcome'}};
  if(name==='topic')return {instance_id:'i1171',topic:args.topic_id==='source'?topic('source',40):conversation};
  if(name==='conversation')return {instance_id:'i1171',conversation:conversation?{topic_id:conversation.id}:null};
  if(name==='workspace_topics') {
   if(error)return {error:{message:error}};
   const items=args.cursor?[topic('tail',5)]:[topic('a',30),topic('b',20)];
   if(args.build!==false&&!args.done&&!args.archived)items.unshift(topic('build',50,{build:true}));
   return {instance_id:'i1171',items:args.done?[topic('done',8,{state:'done'})]:args.archived?[topic('archived',7,{archived:true})]:items,
    next_cursor:args.cursor||args.done||args.archived?null:'0:20:b',order:{revision:1,ids:order}};
  }
  throw Error(name);
 };
 return {read,calls};
}
const ids=model=>model.topics.map(x=>x.scope.id);
const reset=()=>book.scopes.delete(scopeOf('w1171'));

test('1171 active destinations exclude Build and keep the conversation in the rail order',async()=>{
 reset();const f=fixture();const model=await notebookDestinations(f.read,{kind:'topic',id:'source'});
 assert.deepEqual(ids(model),['b','conversation','a']);
 assert.deepEqual(f.calls.find(([n])=>n==='workspace_topics')[1],{workspace_id:'w1171',build:false,limit:20});
 assert.equal(model.cursor,'0:20:b');
});
test('1171 More retains earlier topics and the conversation without rereading it',async()=>{
 reset();const f=fixture(),state={};const first=await notebookDestinations(f.read,{kind:'workspace',id:'w1171'},null,'active',state);
 const next=await notebookDestinations(f.read,{kind:'workspace',id:'w1171'},first.cursor,'active',state);
 assert.deepEqual(ids(next),['b','conversation','tail','a']);
 assert.equal(next.cursor,null);assert.equal(f.calls.filter(([n])=>n==='conversation').length,1);
 assert.equal(ids(next).filter(id=>id==='conversation').length,1);
});
test('1171 the picker uses the same retained page owner for both Move and Copy',async()=>{
 for(const kind of ['memory.move','memory.copy']) {
  reset();const f=fixture(),menus=[],actions=[];
  const page={writing:{pageState:{owner_scope:{kind:'workspace',id:'w1171'}}},doc:{},more:{},read:f.read,say:assert.fail,transferPage:(...a)=>actions.push(a)};
  const show=m=>{menus.push(m);return m;};
  await chooseNotebookDestination(page,kind,null,show);
  await menus[0].items.find(x=>x.key==='more').act();
  assert.deepEqual(menus[1].items.filter(x=>x.key.startsWith('topic:')).map(x=>x.key),['topic:b','topic:conversation','topic:tail','topic:a']);
  menus[1].items.find(x=>x.key==='topic:conversation').act();
  assert.deepEqual(actions,[[kind,{kind:'topic',id:'conversation'}]]);
 }
});
test('1171 pending personal order wins over a destination read of an older order',async()=>{
 reset();const entry=book.entry(scopeOf('w1171'));entry.pending=['a','conversation','b'];
 const f=fixture();assert.deepEqual(ids(await notebookDestinations(f.read,{kind:'workspace',id:'w1171'})),['a','conversation','b']);reset();
});
test('1171 absent or archived conversations do not add an active destination',async()=>{
 for(const conversation of [null,topic('conversation',10,{archived:true})]) {
  reset();const f=fixture({conversation,order:[]});assert.deepEqual(ids(await notebookDestinations(f.read,{kind:'workspace',id:'w1171'})),['a','b']);
 }
});
test('1171 Done and Archived use the rail lists without a conversation read',async()=>{
 for(const list of ['done','archived']) {
  reset();const f=fixture();const model=await notebookDestinations(f.read,{kind:'workspace',id:'w1171'},null,list);
  assert.deepEqual(ids(model),[list]);assert.equal(f.calls.some(([n])=>n==='conversation'),false);
  assert.deepEqual(f.calls.at(-1),['workspace_topics',{workspace_id:'w1171',[list]:true,limit:20}]);
 }
});
test('1171 a mismatched conversation cannot offer another outcome as a destination',async()=>{
 reset();const f=fixture({conversation:topic('conversation',10,{workspace_id:'other'})});
 await assert.rejects(notebookDestinations(f.read,{kind:'workspace',id:'w1171'}),/identity/);
});
test('1171 refused reads report the actual error and open no picker',async()=>{
 reset();const f=fixture({error:'Topics are unavailable.'}),said=[];
 const page={writing:{pageState:{owner_scope:{kind:'workspace',id:'w1171'}}},doc:{},more:{},read:f.read,say:(...x)=>said.push(x)};
 await chooseNotebookDestination(page,'memory.move',null,()=>assert.fail('refused read opened a picker'));
 assert.deepEqual(said,[['Topics are unavailable.','attention']]);
});
