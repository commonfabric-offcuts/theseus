import test from 'node:test';
import assert from 'node:assert/strict';
import { card, menuPage, painted867, press867 } from './fixtures/card_menu_867.mjs';

for (const [condition, expected] of [
  ['outcome without agents', /No agent in this outcome.s Conversation yet/],
  ['topic without agents', /No agent in this topic yet/],
  ['private draft', /draft/i],
  ['read only', /write|read.only|permission/i],
  ['already asking', /already|current|finish/i],
]) test('1042 disabled card Chat explains '+condition, t => {
  const p=painted867(t,menuPage(card()));
  p.source={owner_scope:{kind:condition.startsWith('topic')?'topic':'workspace',id:'fixture-scope'}};
  p.room={topicId:'fixture-topic',agents:['fixture-agent']};
  if(condition.includes('without agents'))p.room={topicId:'fixture-topic',agents:[]};
  if(condition==='private draft')p.writing={value:{draft:true}};
  if(condition==='read only')p.readOnly=true;
  p.paint();
  if(condition==='already asking')p.asking={};
  const menu=press867(p,0),chat=menu.children.find(n=>n.textContent.startsWith('Chat about this…'));
  assert.ok(chat);assert.equal(chat.disabled,true);assert.match(chat.textContent,expected);
});

for(const failed of [true,false])test('1042 '+(failed?'a failed room read stays unconfirmed':'a confirmed missing Conversation explains its absent agent'),async t=>{
 const p=painted867(t,menuPage(card()));p.source={owner_scope:{kind:'workspace',id:'fixture-scope'}};p.room=null;p.paint();
 p.askIn=()=>failed?Promise.reject(Error('participant read failed')):Promise.resolve(null);
 await p.readRoom();const menu=press867(p,0),chat=menu.children.find(n=>n.textContent.startsWith('Chat about this…'));
 assert.equal(chat.disabled,true);
 if(failed){assert.match(chat.textContent,/not confirmed/i);assert.doesNotMatch(chat.textContent,/No agent/);}
 else assert.match(chat.textContent,/No agent in this outcome.s Conversation yet/);
});
