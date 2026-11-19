import test from 'node:test';
import assert from 'node:assert/strict';
import { readTopicList, TopicPages, topicPosition, reread, questionOf } from '../web/topic-navigation.mjs';
import { OutcomeRail } from '../web/outcomes.mjs';
import { OutlineRail } from '../web/outline-rail.mjs';
const topic = (id, position, patch={}) => ({id,workspace_id:'w',title:id,list_position:position,state:'active',archived:false,build:false,...patch});
const conversation = topic('c',10,{title:'Launch Conversation',kind:'conversation',asks:[{actor_id:'reader',message_id:'question'}],waiting_on:[],work:{observed:true}});
function fixture({list=[topic('a',30)], next='0:30:a', record=conversation, meta={topic_id:'c',unread:3,addressed:1}}={}) {
  const calls=[];
  const read=async(name,args)=>{
    calls.push([name,structuredClone(args)]);
    if(name==='workspace_topics')return {instance_id:'i',items:list,next_cursor:next,groups:{done:0,archived:0}};
    if(name==='conversation')return {instance_id:'i',conversation:meta};
    if(name==='topic')return {instance_id:'i',topic:record};
    throw Error(name);
  };
  return {calls,read};
}
test('835 outcome links open home with or without a conversation, including archived home rows',()=>{
  for(const item of [{id:'w'},{id:'w',conversation_id:'c'},{id:'w',conversation_id:'c',end:{state:'completed'}}]) {
    assert.deepEqual(OutcomeRail.prototype.target.call({},item),{kind:'workspace',id:'w'});
    assert.deepEqual(OutlineRail.prototype.nameTarget.call({}, {id:'w',item,conversationRead:true,conversation:{topic_id:'c'}}),{kind:'workspace',id:'w'});
  }
});
test('835 the conversation has its recorded title, counts and ordinary ask destination, separate from the server cursor',async()=>{
  const f=fixture(), pages=new TopicPages('i','w',conversation,'active',true);
  const answer=await readTopicList(f.read,{workspace_id:'w',limit:1,build:false});
  pages.accept(answer);
  assert.deepEqual(pages.items.map(t=>[t.id,t.title]),[['a','a'],['c','Launch Conversation']]);
  const row=pages.items.find(t=>t.id==='c');
  assert.deepEqual([row.unread,row.addressed,questionOf(row,'reader'),row.work.observed],[3,1,'question',true]);
  assert.deepEqual([pages.next,pages.last(),pages.loaded.size],['0:30:a','0:30:a',1]);
  assert.deepEqual(f.calls.map(c=>c[0]),['workspace_topics','conversation','topic']);
  const before=structuredClone(answer); pages.items[0].title='caller copy';
  assert.deepEqual(answer,before,'list ownership cannot edit the read response');
});
test('835 More does not reread the conversation or duplicate the current topic',async()=>{
  const pages=new TopicPages('i','w',conversation), f=fixture();
  pages.accept(await readTopicList(f.read,{workspace_id:'w',limit:1}));
  const more=fixture({list:[topic('b',20)],next:null});
  pages.accept(await readTopicList(more.read,{workspace_id:'w',limit:1,cursor:pages.next}),pages.next);
  assert.deepEqual(more.calls.map(c=>c[0]),['workspace_topics']);
  assert.deepEqual(pages.items.map(t=>t.id),['a','b','c']);
  assert.equal(pages.last(),topicPosition(topic('b',20)));
});
test('835 Done, Archived and Build lists use only their existing server pages',async()=>{
  for(const extra of [{done:true},{archived:true},{build:true}]) {
    const f=fixture({list:[],next:null});
    const answer=await readTopicList(f.read,{workspace_id:'w',...extra});
    assert.deepEqual(f.calls.map(c=>c[0]),['workspace_topics']);
    assert.equal(Object.hasOwn(answer,'conversation_topic'),false);
  }
});
test('835 no conversation or one now archived adds no active row',async()=>{
  for(const options of [{meta:null},{record:{...conversation,archived:true}}]) {
    const f=fixture(options),pages=new TopicPages('i','w');
    pages.accept(await readTopicList(f.read,{workspace_id:'w'}));
    assert.deepEqual(pages.items.map(t=>t.id),['a']);
  }
});
test('835 refuses a different instance or topic/outcome identity before accepting a listing',async()=>{
  for(const change of [
    (name,a)=>name==='conversation'?{...a,instance_id:'other',conversation:null}:a,
    (name,a)=>name==='topic'?{...a,instance_id:'other'}:a,
    (name,a)=>name==='topic'?{...a,topic:{...a.topic,id:'other'}}:a,
    (name,a)=>name==='topic'?{...a,topic:{...a.topic,workspace_id:'other'}}:a,
  ]) {
    const f=fixture(); await assert.rejects(readTopicList(async(name,args)=>change(name,await f.read(name,args)),{workspace_id:'w'}),/identity/);
  }
});
test('835 invalid companion row cannot erase a previously accepted page',async()=>{
  const f=fixture(),pages=new TopicPages('i','w'); const answer=await readTopicList(f.read,{workspace_id:'w'}); pages.accept(answer);
  for(const bad of [{...conversation,workspace_id:'other'},{...conversation,list_position:-1},{...conversation,title:null}]) {
    assert.throws(()=>pages.accept({...answer,items:[],next_cursor:null,conversation_topic:bad}),/confirmed/);
    assert.deepEqual(pages.items.map(t=>t.id),['a','c']);assert.equal(pages.next,'0:30:a');
  }
});
test('835 reread keeps the loaded extent and refreshes the separately carried conversation once',async()=>{
  const pages=new TopicPages('i','w'); pages.accept(await readTopicList(fixture().read,{workspace_id:'w'}));
  pages.accept({instance_id:'i',items:[topic('b',20)],next_cursor:null},pages.next);
  const calls=[];const read=async(name,args)=>{
    calls.push([name,args]);
    if(name==='workspace_topics')return {instance_id:'i',items:[args.cursor?topic('b',20):topic('a',30)],next_cursor:args.cursor?null:'0:30:a'};
    if(name==='conversation')return {instance_id:'i',conversation:{topic_id:'c',unread:7,addressed:2}};
    return {instance_id:'i',topic:{...conversation,title:'Renamed Conversation'}};
  };
  await reread(pages,args=>readTopicList(read,{workspace_id:'w',...args}),1);
  assert.deepEqual(pages.items.map(t=>t.id),['a','b','c']);
  assert.deepEqual([pages.items.at(-1).title,pages.items.at(-1).unread],['Renamed Conversation',7]);
  assert.equal(calls.filter(c=>c[0]==='conversation').length,1);
});

test('835 real isolated Core records supply the ordinary conversation row without changing outcome, topic or work records',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const core=JSON.parse(execFileSync('/usr/bin/python3',[fileURLToPath(new URL('./fixtures/conversation_835.py',import.meta.url))],{encoding:'utf8'}));
  const calls=[];
  const answer=await readTopicList(async(name,args)=>{calls.push([name,args]);return core[name];},{workspace_id:'w1',limit:1});
  const pages=new TopicPages(core.topic.instance_id,'w1',core.topic.topic);
  pages.accept(answer);
  const row=pages.items.find(item=>item.id===core.topic.topic.id);
  assert.ok(row.title.endsWith('Conversation'));
  assert.equal(questionOf(row,'agent-a'),core.question);
  assert.equal(pages.items.filter(item=>item.id===row.id).length,1);
  assert.equal(pages.next,core.workspace_topics.next_cursor);
  assert.equal(pages.loaded.size,core.workspace_topics.items.length);
  assert.deepEqual(calls.map(c=>c[0]),['workspace_topics','conversation','topic']);
});
