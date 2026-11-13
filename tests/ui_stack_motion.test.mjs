import test from 'node:test';
import assert from 'node:assert/strict';
import { StackMotion, arrivalIds, belowAnchor } from '../web/stack-motion.mjs';
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

test('visibility cancels motion and catch-up stays static until native attention resumes', () => {
  const doc = new EventTarget(), win = new EventTarget(), media = new EventTarget();
  doc.visibilityState = 'visible'; media.matches = false; win.matchMedia = () => media;
  const list = {ownerDocument:doc,closest:()=>null};
  const motion = new StackMotion({list,win});
  assert.equal(motion.allowed(),true);
  let finished = 0; motion.active.add({finish:()=>{finished++;motion.active.clear();}});
  doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(finished,1); assert.equal(motion.allowed(),false);
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(motion.allowed(),false,'catch-up after return cannot deal in');
  doc.dispatchEvent(new Event('keydown')); assert.equal(motion.allowed(),true);
  media.matches=true; media.dispatchEvent(new Event('change')); assert.equal(motion.allowed(),false);
  motion.dispose(); media.matches=false; assert.equal(motion.allowed(),false);
});
