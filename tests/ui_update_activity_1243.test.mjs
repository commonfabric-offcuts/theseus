import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { paintAuthor, carriesOf } from '../web/marks.mjs';
import { revisionOf, wasEdited } from '../web/message-edit-writing.mjs';
import { paintWithdrawal } from '../web/question-withdrawal.mjs';
import { paintRemoval } from '../web/message-removal.mjs';
import { configureCoverRefresh, messageUpdateActivity, messageUpdateHost, updateMenuItem } from '../web/cover-refresh.mjs';
const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const authorCode=app.slice(app.indexOf('function paintCardAuthor('),app.indexOf('// Who the composers may whisper to'));
const updatesCode=app.slice(app.indexOf('function paintMessageUpdates()'),app.indexOf('// Generated context may quote'));
let serial=0;
const pending={request_id:'request',operation_id:'operation',state:'pending',by:'viewer',recipient:'agent',root_id:'message',observed_revision:1,at_ms:1795580000000};
function fixture(t,refresh=null){
 const r=renderer799(),doc=r.list.ownerDocument,kept=new Map(),sent=[];
 const before=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=before;configureCoverRefresh(null);});
 doc.defaultView={localStorage:{getItem:k=>kept.get(k)??null,setItem:(k,v)=>kept.set(k,v),removeItem:k=>kept.delete(k)}};
 doc.querySelectorAll=s=>r.list.querySelectorAll(s);
 const bootstrap={instance_id:'activity1243-'+ ++serial,actor:'viewer',authority:{authority_id:'authority',authority_epoch:'epoch'}};
 const reply={run:async()=>{throw Error('interrupted');}};
 configureCoverRefresh(()=>({bootstrap,api:{command:async e=>{sent.push(e);return reply.run(e);}},changed(){}}));
 const card=doc.createElement('article'),author=doc.createElement('span'),folded=doc.createElement('span');
 card.className='message-card';author.className='message-author';folded.className='message-folded';card.append(author,folded);r.list.append(card);
 const item={id:'message',topic_id:'topic',author_id:'agent',author_kind:'agent',revision:1,sent_ms:1795580000000,acts:{message_refresh:refresh,message_refresh_revision:refresh?1:0}};
 const records=new Map([[item.id,item]]),entries=new Map([[item.id,card]]);
 const context={viewer:'viewer',nameOf:id=>id,topicId:'topic'};
 const ports={document:doc,cardScroll:null,revisionOf,messageChanges:null,toggleMessageChanges(){},paintAuthor,displayActor:id=>id,marks:null,wasEdited,carriesOf,paintWithdrawal,paintRemoval,bootstrap,here:null,stackFeed:null,messageUpdateActivity,messageUpdateHost,updateContext:()=>context,visitNew:null,paintVisitNew(){},messageEntries:entries,views:{messages:records},cardIn:e=>e,reader:null};
 const methods=new Function(...Object.keys(ports),authorCode+updatesCode+';return {paintCardAuthor,paintMessageUpdates};')(...Object.values(ports));
 return {...r,doc,card,author,folded,item,records,context,kept,sent,reply,bootstrap,paint:()=>methods.paintCardAuthor(author,item),updates:()=>methods.paintMessageUpdates()};
}
test('1243 actual cached author has one stable hidden activity after 32 paints',t=>{
 const f=fixture(t);f.paint();const host=f.author.querySelector('.message-update'),name=f.author.querySelector('.author-name');
 assert.ok(host);const children=[...host.children];
 for(let i=0;i<32;i++)f.paint();
 assert.equal(f.card.querySelectorAll('.message-update').length,1);assert.equal(f.author.querySelector('.message-update'),host);
 assert.equal(f.author.querySelector('.author-name'),name);assert.equal(host.hidden,true);assert.deepEqual(host.children,children);assert.equal(f.sent.length,0);
});
test('1243 actual author and update pass retain pending descendants and modeled focus',t=>{
 const f=fixture(t,pending);f.paint();const host=f.author.querySelector('.message-update'),control=host.querySelector('.message-update-activity'),line=host.querySelector('.refresh-request-line');control.focus();
 for(let i=0;i<32;i++){f.paint();f.updates();}
 assert.equal(f.card.querySelectorAll('.message-update').length,1);assert.equal(f.author.querySelector('.message-update'),host);
 assert.equal(host.querySelector('.message-update-activity'),control);assert.equal(host.querySelector('.refresh-request-line'),line);assert.equal(f.doc.activeElement,control);
 assert.equal(host.hidden,false);assert.match(host.text,/viewer asked agent/);
});
test('1243 completed and stale request reads update one host without reviving pending',t=>{
 const f=fixture(t,pending);f.paint();const host=f.author.querySelector('.message-update');
 const done={...pending,state:'completed',completed_by:'agent',completed_ms:pending.at_ms+60000,completed_revision:2};
 f.item.revision=2;f.item.acts={message_refresh:done,message_refresh_revision:2};f.updates();
 assert.equal(f.author.querySelector('.message-update'),host);assert.match(host.text,/agent updated this message/);const line=host.querySelector('.refresh-request-line');
 for(let i=0;i<12;i++){f.item.acts={message_refresh:{...done},message_refresh_revision:2};f.updates();}
 assert.equal(host.querySelector('.refresh-request-line'),line,'equal display state preserves descendants');
 f.item.acts={message_refresh:pending,message_refresh_revision:1};f.updates();assert.equal(f.author.querySelector('.message-update'),host);assert.doesNotMatch(host.text,/viewer asked/);
});
test('1243 folded row reuses activity and removes historical duplicate hosts',t=>{
 const f=fixture(t,pending);f.paint();const host=f.author.querySelector('.message-update');f.author.append(messageUpdateActivity(f.doc,f.item,f.context));
 f.card.dataset.folded='true';f.updates();assert.equal(f.card.querySelectorAll('.message-update').length,1);assert.equal(f.folded.querySelector('.message-update'),host);
 f.card.dataset.folded='false';f.updates();assert.equal(f.author.querySelector('.message-update'),host);
});
test('1243 actual update eligibility keeps recorded activity but adds no action for self/human/unknown',t=>{
 const f=fixture(t);for(const change of [{author_id:'viewer'},{author_kind:'human'},{author_kind:null}]){
 const item={...f.item,...change};assert.equal(updateMenuItem(f.doc,item,f.context),null);assert.equal(messageUpdateActivity(f.doc,item,f.context),null);}
 assert.ok(updateMenuItem(f.doc,f.item,f.context));
});
test('1243 actual menu request keeps the exact unknown operation for retry and fences authority',async t=>{
 const f=fixture(t);f.paint();const act=updateMenuItem(f.doc,f.item,f.context);await act.act();assert.equal(f.sent.length,1);assert.equal(f.kept.size,1);
 const original=structuredClone(f.sent[0]);await act.act();assert.deepEqual(f.sent[1],original);
 f.bootstrap.authority={authority_id:'new',authority_epoch:'epoch'};await act.act();assert.equal(f.sent.length,2,'no saved operation crosses authority');assert.equal(f.kept.size,1);
 f.bootstrap.authority=original.expected.authority;f.reply.run=async e=>({...e,status:'committed',recorded:true,result:{refresh:{...pending,operation_id:e.operation_id},refresh_revision:1}});
 await act.act();assert.deepEqual(f.sent[2],original);assert.equal(f.kept.size,0);assert.equal(f.card.querySelectorAll('.message-update').length,1);assert.equal(f.author.querySelector('.message-update').hidden,false);
});
