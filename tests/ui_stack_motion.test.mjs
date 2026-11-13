import test from 'node:test';
import assert from 'node:assert/strict';
import { arrivalIds, belowAnchor } from '../web/stack-motion.mjs';
import { TopicViews } from '../web/topic-views.mjs';

test('only fresh accepted live IDs can enter; initial, older and duplicate pages never replay', () => {
  const handled = new Set();
  assert.deepEqual(arrivalIds({ initial:true, addedIds:['a'] }, handled), []);
  assert.deepEqual(arrivalIds({ live:true, addedIds:['a','b'] }, handled), ['b']);
  assert.deepEqual(arrivalIds({ live:true, addedIds:['b'] }, handled), []);
  assert.deepEqual(arrivalIds({ live:false, addedIds:['c'] }, handled), []);
  assert.deepEqual(arrivalIds({ live:true, addedIds:['c'] }, handled), []);
});
test('growth above the held reading or writing region cannot animate', () => {
  assert.equal(belowAnchor(250, {top:100,bottom:200}), true);
  assert.equal(belowAnchor(150, {top:100,bottom:200}), false);
  assert.equal(belowAnchor(100, null), true);
});
test('TopicViews carries provenance computed before merging, never new DOM or a read replay', () => {
  const paints = [], views = new TopicViews({ instanceId:'i1', topicId:'t1', paint:(kind, data)=>paints.push({kind,data}) });
  const msg = seq => ({id:'m'+seq,seq,topic_id:'t1',body:'body',author_id:'agent'});
  const page = items => ({instance_id:'i1',items,next_cursor:null,relevant_versions:{topic:1}});
  views.messagesPage(page([msg(2)]), {initial:true});
  views.messagesPage(page([msg(3)]), {live:true,cursor:2});
  views.messagesPage(page([msg(2),msg(3)]), {initial:true});
  assert.deepEqual(paints.filter(p=>p.kind==='messages').map(p=>p.data), [
    {initial:true,live:false,addedIds:['m2']},{initial:false,live:true,addedIds:['m3']},{initial:true,live:false,addedIds:[]},
  ]);
});
