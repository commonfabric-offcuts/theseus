import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../web/editor.mjs';
import { EditorRegistry } from '../web/app-session.mjs';

test('registry unload protection follows active sends, not settled or historical submissions', () => {
  const registry=Object.create(EditorRegistry.prototype);registry.sessions=new Map();registry.localWrites=new Map();
  const editor=new Editor({instanceId:'i',actor:'fixture',sourceRef:{kind:'topic',id:'t'},topicId:'t',kind:'reply'},{id:'d',revision:0,generation:'g'});
  const session={editor,sends:new Map()};registry.sessions.set(editor.key,session);
  editor.edit({body:'Exact send'});const item=editor.beginPrepare({prepareOperationId:'p',sendOperationId:'s',submissionId:'sub'});
  assert.equal(editor.dirty,false,'actual beginPrepare makes the successor clean');
  session.sends.set(item.id,Promise.resolve());assert.equal(registry.hasUnprotectedWriting,true,'beforeunload protects an active chain');
  assert.equal(registry.hasInFlightSend,true);session.sends.clear();
  assert.equal(registry.hasUnprotectedWriting,false,'settled preparation alone does not trap reload');
  assert.equal(registry.unconfirmedSends[0].item,item);
  for(const state of ['confirmed','refused']) {item.status=state;assert.deepEqual(registry.unconfirmedSends,[]);assert.equal(registry.hasUnprotectedWriting,false);}
  item.status='prepared';item.detached=true;assert.deepEqual(registry.unconfirmedSends,[]);
  registry.localWrites.set(editor.key,{pending:true});assert.equal(registry.hasUnprotectedWriting,true,'existing durability guard remains');
});
