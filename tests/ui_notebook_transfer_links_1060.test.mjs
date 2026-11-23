import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTopicLink} from '../web/topic-link-route.mjs';
const oldTopic='t-'+'a'.repeat(32),nextTopic='t-'+'b'.repeat(32);
for(const route of [{kind:'topic',id:oldTopic,page:'page'},{kind:'workspace',id:'old-outcome',page:'page',revision:'1'}])
test('1060 initial id link follows current Core ownership from '+route.kind,async()=>{
 const reads=[],result=await resolveTopicLink(route,{instanceId:'i',read:async(name,args)=>{reads.push([name,args]);return {instance_id:'i',source_ref:{kind:'memory',id:'page',revision:3},owner_scope:{kind:'topic',id:nextTopic}};}});
 assert.deepEqual(result,{...route,kind:'topic',id:nextTopic});assert.deepEqual(reads,[['memory_current',{item_id:'page'}]]);
});
test('1060 a former reader cannot resolve a moved page through its old id link',async()=>{
 await assert.rejects(resolveTopicLink({kind:'topic',id:oldTopic,page:'page'},{instanceId:'i',read:async()=>({instance_id:'i',error:{code:'FORBIDDEN',message:'No readable page'}})}));
});
