import test from 'node:test';
import assert from 'node:assert/strict';
import {assertReaderDestination} from './outline_stars_oracle.mjs';

const snapshot=()=>({open:true,source:{kind:'message',id:'root'},topic:'topic',
  context:{sourceRef:{kind:'message',id:'root'},topicId:'topic'},url:'https://fixture.invalid/?topic=topic'});
test('item 715 oracle accepts the actual Reader after the message URL is consumed',()=>{
  assertReaderDestination(snapshot(),'root','topic');
});
test('item 715 oracle rejects a wrong Reader even when the URL names the expected root',()=>{
  const actual=snapshot(); actual.url+='&message=root'; actual.source.id='wrong';
  assert.throws(()=>assertReaderDestination(actual,'root','topic'),/canonical root/);
});
test('item 715 oracle rejects stale closed Readers and wrong reply destinations',()=>{
  for(const change of [a=>a.open=false,a=>a.context.topicId='other',a=>a.context.sourceRef.id='wrong',a=>a.topic='other']){
    const actual=snapshot();change(actual);
    assert.throws(()=>assertReaderDestination(actual,'root','topic'));
  }
});
