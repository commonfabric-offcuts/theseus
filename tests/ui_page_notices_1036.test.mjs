import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { showLine } from '../web/lines.mjs';
import { MentionNotices } from '../web/mention-notices.mjs';
import { finishPageNotice } from '../web/page-notices.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture(){
 const doc=miniDocument(),make=doc.createElement;
 doc.createElement=tag=>{const node=make(tag);let text='';Object.defineProperties(node,{ownerDocument:{value:doc},parentElement:{get(){return this.parent;}},parentNode:{get(){return this.parent;}},textContent:{get(){return text;},set(value){text=String(value);for(const n of this.children??[])if(typeof n==='object')n.parent=null;this.children=[];}}});return node;};
 doc.getElementById=id=>doc.byId(id);
 const host=doc.byId('page-notices'),notice=doc.byId('app-status'),main=doc.byId('main');notice.className='notice';notice.hidden=true;host.append(notice);
 return {doc,host,notice,main};
}

test('1036 the actual Question withdrawn status offers a labelled corner close and stays closed on repaint',()=>{
 const {doc,notice,main}=fixture();showLine(notice,'Question withdrawn.');
 const close=notice.querySelector('button.page-notice-close');assert.ok(close,'the stuck status must be closable');assert.equal(close.getAttribute('aria-label'),'Close notice');assert.equal(close.type,'button');
 close.focus();close.onclick();assert.equal(notice.hidden,true);assert.equal(doc.activeElement,main);
 showLine(notice,'Question withdrawn.');assert.equal(notice.hidden,true,'redraw must not revive the closed status');
 const fresh=fixture();showLine(fresh.notice,'Question withdrawn.');assert.equal(fresh.notice.hidden,false,'a different page is not dismissed');
});

test('1036 actual mention paint keeps Add and replaces Dismiss by the same close box',async()=>{
 const {host,doc}=fixture();host.replaceChildren();const authority={authority_id:'a',authority_epoch:'e'};
 const owner=new MentionNotices({host,instanceId:'i',authority:()=>authority,api:{view:async()=>({instance_id:'i',message_id:'m',scope:{kind:'topic',id:'t',title:'This topic',revision:1,may_add:true},items:[{actor_id:'outside',name:'Outside',kind:'agent',may_add:true}],next_cursor:null})}});
 await owner.published(null,{id:'s',sendOperationId:'send',status:'confirmed',snapshot:{body:'Hello @outside'},receipt:{status:'committed',result:{message_id:'m'}}});
 const notice=host.children[0],close=notice.querySelector('button.page-notice-close');assert.ok(close,'the corner close replaces the trailing Dismiss');assert.ok(notice.querySelectorAll('button').some(n=>n.textContent==='Add @outside to topic'));assert.ok(!notice.querySelectorAll('button').some(n=>n.textContent==='Dismiss'));
 close.onclick();assert.equal(host.children.length,0);await owner.published(null,{id:'s',sendOperationId:'send',status:'confirmed',snapshot:{body:'Hello @outside'},receipt:{status:'committed',result:{message_id:'m'}}});assert.equal(host.children.length,0);
});

test('1036 connection-event paints cannot revive a dismissed line and non-group lines stay unchanged',async()=>{
 const {AttemptError,follow}=await import('../web/api.mjs');let emit;follow({state:'down',listen:fn=>{emit=fn;}});
 const {notice,doc,main}=fixture();showLine(notice,new AttemptError('Not connected.'));
 const close=notice.querySelector('button.page-notice-close');assert.ok(close);close.onclick();
 emit({kind:'state',state:'down'});assert.equal(notice.hidden,true,'heard() repaint after contact changes keeps dismissal');
 showLine(notice,'A later status on this page.');assert.equal(notice.hidden,true);
 const inline=doc.createElement('div');main.append(inline);showLine(inline,'Inline status.');assert.equal(inline.hidden,false);assert.equal(inline.querySelector('button.page-notice-close'),null);follow(null);
});

test('1036 moving the same host preserves close state, fresh notices and existing controls remain independent',()=>{
 const {host,notice,main,doc}=fixture(),retry=doc.createElement('button');let calls=0;retry.textContent='Reload';retry.onclick=()=>calls++;
 showLine(notice,['Theseus updated.',retry]);retry.onclick();assert.equal(calls,1);
 notice.querySelector('button.page-notice-close').onclick();main.append(host);showLine(notice,['Theseus updated.',retry]);assert.equal(notice.hidden,true);assert.equal(calls,1,'closing never presses the existing action');
 const next=doc.createElement('div');next.className='notice';host.append(next);showLine(next,'A different notice.');assert.equal(next.hidden,false);assert.ok(next.querySelector('button.page-notice-close'));
});

test('1036 closing an Add in flight keeps its real operation and prevents its late result repaint',async()=>{
 const {host}=fixture();host.replaceChildren();let resolve,request;const pending=new Promise(r=>resolve=r);
 const owner=new MentionNotices({host,instanceId:'i',authority:()=>({authority_id:'a',authority_epoch:'e'}),api:{view:async()=>({instance_id:'i',message_id:'m',scope:{kind:'topic',id:'t',title:'This topic',revision:1,may_add:true},items:[{actor_id:'outside',name:'Outside',kind:'agent',may_add:true}],next_cursor:null}),command:args=>{request=args;return pending;}}});
 await owner.published(null,{id:'s',sendOperationId:'send',status:'confirmed',snapshot:{body:'@outside'},receipt:{status:'committed',result:{message_id:'m'}}});
 const notice=host.children[0],add=notice.querySelectorAll('button').find(n=>n.textContent.startsWith('Add @'));const adding=add.onclick();assert.equal(add.disabled,true);notice.querySelector('button.page-notice-close').onclick();
 resolve({instance_id:'i',operation_id:request.operation_id,status:'committed',result:{actor_id:'outside',present:true,topic_id:'t'}});await adding;assert.equal(host.children.length,0);assert.equal(request.kind,'participation.set');owner.paint(owner.entries.get('send'));assert.equal(host.children.length,0);
});

test('1036 actual updateStatus keeps Retry/authority/manual behavior and a closed update never reopens',()=>{
 const {doc,host}=fixture(),get=id=>doc.byId(id);for(const id of ['updates-status','updates-message','updates-retry'])get(id);
 const notice=get('updates-status');notice.className='notice';host.append(notice);notice.append(get('updates-message'),get('updates-retry'));
 const source=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8'),body=source.match(/^function updateStatus\(state\) \{[\s\S]*?^\}/m)?.[0];assert.ok(body);
 let reconnects=0;const update=vm.runInNewContext(body+';updateStatus',{$:get,finishPageNotice,updateState:null,reconnectRetried:null,listAccessEpoch:0,dossierHeads:null,views:null,run:fn=>fn(),reconnect:()=>reconnects++});
 update({kind:'retry'});assert.equal(notice.hidden,false);assert.equal(get('updates-retry').textContent,'Retry updates');assert.equal(get('updates-retry').hidden,false);
 const close=notice.querySelector('button.page-notice-close');assert.ok(close);close.onclick();
 for(const kind of ['current','retry','manual','authority','forbidden','reconnect']){update({kind,message:'Manual state'});assert.equal(notice.hidden,true,kind);}
 assert.equal(reconnects,1,'underlying recovery still runs after presentation is closed');
});

test('1036 actual WakeLights paint keeps a dismissed wake warning hidden across fresh wake facts',()=>{
 const {doc,host}=fixture(),notice=doc.byId('wakes-status');notice.className='notice';host.append(notice);
 const source=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');const bodies=[...source.matchAll(/painted: \(\) => \{ const words = wakeLights\.notice\(\);[^\n]+?\}/g)];assert.equal(bodies.length,1);
 let words='No wakes are going out.';const paint=vm.runInNewContext('('+bodies[0][0].slice('painted: '.length)+')',{$:id=>doc.byId(id),finishPageNotice,wakeLights:{notice:()=>words}});
 paint();assert.equal(notice.hidden,false);notice.querySelector('button.page-notice-close').onclick();
 for(const next of [null,'One agent is paused.','No wakes are going out.']){words=next;paint();assert.equal(notice.hidden,true);}
});
