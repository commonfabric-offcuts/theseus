import test from 'node:test';
import assert from 'node:assert/strict';
import { laterPosition, positionOf } from '../web/stack-order.mjs';
import { TopicViews } from '../web/topic-views.mjs';
const position = (messages, acts, extra = {}) => ({ root_id:'root', through:4, aside_revision:1, below:true, at:{messages,acts}, ...extra });
test('an old page cannot hide a revived dossier or undo a newer join', () => {
  const revived = position(8,2,{below:false});
  assert.equal(laterPosition(revived, position(7,2)), revived);
  const joined = position(8,3,{root_id:'new-root',below:false});
  assert.equal(laterPosition(joined, position(9,2)), joined);
  assert.equal(laterPosition(joined, position(8,4,{through:8})).below, true);
});
test('a split read later wins though it leaves the dossier fewer messages, and an older read never does', () => {
  // `at.messages` is the dossier's newest message, so a split that takes replies away lowers it in a later act.
  const joined = position(9,3,{below:false});
  const split = position(5,4,{below:true});
  assert.equal(laterPosition(joined, split), split);
  assert.equal(laterPosition(split, joined), split);
  assert.equal(positionOf({head:{stack_position:joined},replies:[{stack_position:split}]}), split);
});
test('a new reply updates every loaded fragment of its dossier but no unrelated one', () => {
  const views = new TopicViews({ instanceId:'i', topicId:'t' });
  views.messages.set('a',{id:'a',stack_position:position(4,1)});
  views.messages.set('b',{id:'b',stack_position:position(4,1)});
  views.messages.set('c',{id:'c',stack_position:position(4,1,{root_id:'other'})});
  views.learnPositions([{message_id:'b',stack_position:position(5,1,{below:false})}]);
  assert.equal(views.messages.get('a').stack_position.below,false);
  assert.equal(views.messages.get('c').stack_position.below,true);
  views.learnPositions([{message_id:'a',stack_position:position(4,1)}]);
  assert.equal(views.messages.get('a').stack_position.below,false);
  assert.equal(positionOf({head:views.messages.get('a'),replies:[views.messages.get('b')]}).below,false);
});
