import test from 'node:test';
import assert from 'node:assert/strict';
import {TopicViews} from '../web/topic-views.mjs';
function fixture(){const paints=[],views=new TopicViews({instanceId:'i',topicId:'old',paint:key=>paints.push(key)});views.memory.set('page',{seq:1,revision:1,title:'Prior title',body:'Prior body'});return {views,paints};}
for(const destination of [{kind:'workspace',id:'new'},{kind:'topic',id:'new'}])test('1060 moved page leaves old topic refresh without a malformed-response warning: '+destination.kind,async()=>{
 const {views,paints}=fixture(),calls=[];
 assert.equal(await views.refresh('memory:page',2,async(name,args)=>{calls.push([name,args]);return name==='memory_items'?{instance_id:'i',items:[],next_cursor:null,relevant_versions:{notebook:2}}:
  {instance_id:'i',source_ref:{kind:'memory',id:'page',revision:2},owner_scope:destination,deleted:false};}),true);
 assert.equal(views.memory.has('page'),false);assert.deepEqual(views.deletedMemory.get('page'),{seq:1,revision:2});assert.ok(paints.includes('memory'));assert.equal(calls.length,2);
});
test('1060 a page moved beyond a former reader disappears without carrying private destination fields',async()=>{
 const {views}=fixture();assert.equal(await views.refresh('memory:page',2,async name=>name==='memory_items'?{instance_id:'i',items:[],next_cursor:null,relevant_versions:{notebook:2}}:{instance_id:'i',error:{code:'FORBIDDEN',message:'No readable page'}}),true);
 assert.equal(views.memory.has('page'),false);assert.deepEqual(views.deletedMemory.get('page'),{seq:1,revision:2});
});
test('1060 an omitted page still in this topic remains a malformed response',async()=>{
 const {views}=fixture();await assert.rejects(views.refresh('memory:page',2,async name=>name==='memory_items'?{instance_id:'i',items:[],next_cursor:null,relevant_versions:{notebook:2}}:
  {instance_id:'i',source_ref:{kind:'memory',id:'page',revision:2},owner_scope:{kind:'topic',id:'old'},deleted:false}));assert.equal(views.memory.has('page'),true);
});
test('1060 leave-and-return between scoped and current reads retries, then learns the returned revision',async()=>{
 const {views}=fixture();
 await assert.rejects(views.refresh('memory:page',2,async name=>name==='memory_items'?
  {instance_id:'i',items:[],next_cursor:null,relevant_versions:{notebook:2}}:
  {instance_id:'i',source_ref:{kind:'memory',id:'page',revision:3},owner_scope:{kind:'topic',id:'old'},deleted:false}),{code:'RESOURCE_NOT_CURRENT'});
 assert.equal(views.memory.get('page').body,'Prior body');assert.equal(views.deletedMemory.has('page'),false);
 const returned={id:'page',seq:1,revision:3,source_ref:{kind:'memory',id:'page',revision:3},owner_scope:{kind:'topic',id:'old'},body:'Returned body'};
 assert.equal(await views.refresh('memory:page',2,async()=>({instance_id:'i',items:[returned],next_cursor:null,relevant_versions:{notebook:4}})),true);
 assert.equal(views.memory.get('page').body,'Returned body');assert.equal(views.memory.get('page').revision,3);
});
