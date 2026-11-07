import test from 'node:test';
import assert from 'node:assert/strict';
import * as nav from '../web/topic-navigation.mjs';
import { OutcomeRail } from '../web/outcomes.mjs';

test('an outcome topic page has no invented current topic', () => {
  const pages = new nav.TopicPages('instance', 'w1', null);
  assert.deepEqual(pages.items, []);
  pages.accept({instance_id:'instance',items:[],next_cursor:null});
  assert.deepEqual(pages.items, []);
  pages.accept({instance_id:'instance',items:[{id:'t1',workspace_id:'w1',title:'Real topic',activity_ms:1}],next_cursor:null});
  assert.deepEqual(pages.items.map(x=>x.id),['t1']);
});

test('routes preserve typed identity, encoded IDs and refuse ambiguous destinations', () => {
  const routes=[{kind:'root'},{kind:'workspace',id:'same'},{kind:'topic',id:'same'},
    {kind:'create',intent:'i&1'},{kind:'opening',workspace:'w/1',opening:'o 1',topic:'t?1'}];
  assert.equal(typeof nav.parseRoute,'function');
  for(const route of routes) assert.deepEqual(nav.parseRoute(new URL(nav.routeHref(route),'https://fixture/')),route);
  assert.equal(new Set(routes.map(nav.routeKey)).size,routes.length);
  for(const query of ['?topic=','?workspace=w&topic=t','?topic=t&topic=x','?new=outcome',
    '?workspace=w&opening=o','?workspace=w&opening_topic=t','?new=other&intent=i','?topic=%01']) {
    assert.throws(()=>nav.parseRoute(new URL(query,'https://fixture/')),/link|destination/i,query);
  }
});

test('workspace pages use explicit continuation even on short pages and preserve duplicate labels', () => {
  assert.equal(typeof nav.WorkspacePages,'function');
  const p=new nav.WorkspacePages('instance');
  const row=id=>({id,owner_id:'owner',title:'Same',title_truncated:false,version:1});
  p.accept({instance_id:'instance',items:[row('a')],next_cursor:'a'});
  assert.equal(p.next,'a');
  p.accept({instance_id:'instance',items:[row('b')],next_cursor:null},'a');
  assert.deepEqual(p.items.map(x=>x.id),['a','b']);
  const before=structuredClone(p.items);
  for(const bad of [
    {instance_id:'wrong',items:[row('c')],next_cursor:null},
    {instance_id:'instance',items:[row('a'),row('a')],next_cursor:null},
    {instance_id:'instance',items:[],next_cursor:'a'},
    {instance_id:'instance',items:[row('c')],next_cursor:'different'},
    {instance_id:'instance',items:[{...row('c'),title:'é'.repeat(513)}],next_cursor:null},
    {instance_id:'instance',items:[{...row('c'),title_truncated:'false'}],next_cursor:null},
  ]) {assert.throws(()=>p.accept(bad));assert.deepEqual(p.items,before);}
  assert.equal(p.accept({instance_id:'instance',items:[row('c')],next_cursor:null},'stale'),false);
});
test('workspace ID order follows SQLite UTF-8 ordering across the BMP boundary',()=>{
  const pages=new nav.WorkspacePages('instance');
  const row=id=>({id,owner_id:'owner',title:id,title_truncated:false,version:1});
  pages.accept({instance_id:'instance',items:[row('\ue000'),row('😀')],next_cursor:null});
  assert.deepEqual(pages.items.map(x=>x.id),['\ue000','😀']);
});

function departure() {
  const visits=[], editor={key:'writing',localVersion:1,ackVersion:0,submissions:[],get dirty(){return this.localVersion>this.ackVersion;}};
  const owner={editor,sends:new Map()};
  const registry={sessions:new Map([['writing',owner]]),inline:{editors:{reply:editor}},current:null,
    disposed:false,hasInFlightSend:false,unconfirmedSends:[],hasUnprotectedWriting:false,
    flush:async()=>{editor.ackVersion=editor.localVersion;return {recorded:true,status:'committed'};},keepEditorsLocal:async()=>{}};
  const navigation=new nav.TopicNavigation({registry,current:{kind:'topic',id:'same'},navigateTarget:route=>visits.push(route)});
  return {navigation,registry,editor,visits};
}
test('typed outcome/root departures use the same save/send guard and do not alias a topic', async () => {
  for(const destination of [{kind:'root'},{kind:'workspace',id:'same'},{kind:'create',intent:'i'},
    {kind:'opening',workspace:'w',opening:'o',topic:'t'}]) {
    const f=departure();assert.equal(typeof f.navigation.openTarget,'function');
    f.registry.hasInFlightSend=true;
    await assert.rejects(f.navigation.openTarget(destination,'Chosen outcome'),/send/i);assert.deepEqual(f.visits,[]);
    f.registry.hasInFlightSend=false;
    assert.equal(await f.navigation.openTarget(destination,'Chosen outcome'),true);
    assert.deepEqual(f.visits,[destination]);assert.equal(f.editor.ackVersion,1);
  }
});
test('the informed second choice is bound to destination kind as well as id', async () => {
  const f=departure(),item={id:'s',status:'prepared',prepareOperationId:'p',sendOperationId:'send',authority:{id:'a'}};
  f.registry.unconfirmedSends=[{session:f.registry.sessions.get('writing'),editor:f.editor,item}];
  const w={kind:'workspace',id:'next'},t={kind:'topic',id:'next'};
  await assert.rejects(f.navigation.openTarget(w,'Outcome'),/unconfirmed/i);
  await assert.rejects(f.navigation.openTarget(t,'Topic'),/unconfirmed/i);
  assert.deepEqual(f.visits,[]);
  await f.navigation.openTarget(t,'Topic');assert.deepEqual(f.visits,[t]);
});

function railFixture(t) {
  const previous=globalThis.document;
  class Element {
    constructor(){this.children=[];this.dataset={};this.attributes={};this.handlers={};this.hidden=false;}
    append(...nodes){for(const child of nodes){child.parent=this;this.children.push(child);}}
    addEventListener(name,fn){this.handlers[name]=fn;}
    setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}
    insertBefore(child,before){child.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,child);child.parent=this;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
    focus(){document.activeElement=this;}
    getBoundingClientRect(){return this.box;}
  }
  globalThis.document={createElement:()=>new Element(),activeElement:null};t.after(()=>globalThis.document=previous);
  const nodes=Object.fromEntries(['host','more','retry','message','empty'].map(k=>[k,new Element()]));
  const queue=[],calls=[],opened=[],row=id=>({id,owner_id:'owner',title:'Same',title_truncated:true,version:1});
  const answer=(ids,next_cursor=null)=>({instance_id:'instance',items:ids.map(row),next_cursor});
  const rail=new OutcomeRail({...nodes,instanceId:'instance',current:'a',read:args=>{calls.push(args);const next=queue.shift();return typeof next==='function'?next():Promise.resolve(next);},open:(...args)=>opened.push(args),denied:error=>error.status===403});
  return {...nodes,queue,calls,opened,answer,rail};
}
test('outcome links expose stable IDs and preserve native activation and More focus',async t=>{
  const f=railFixture(t);f.queue.push(f.answer(['a'],'a'));await f.rail.load();
  const first=f.host.children[0];assert.equal(first.children[0].textContent,'Same…');assert.match(first.children[1].textContent,/a.*title shortened/);
  f.more.focus();f.queue.push(f.answer(['b']));await f.more.onclick();
  assert.equal(document.activeElement.dataset.workspaceId,'b');assert.equal(f.host.children[0],first);
  assert.equal(f.host.children[1].children[1].textContent,'b · title shortened');
  let prevented=0;first.onclick({button:0,metaKey:true,preventDefault(){prevented++;}});
  assert.equal(prevented,0);assert.deepEqual(f.opened,[]);
  first.onclick({button:0,preventDefault(){prevented++;}});assert.equal(prevented,1);
  assert.deepEqual(f.opened,[[{kind:'workspace',id:'a'},'Same']]);assert.equal(first.href,'?workspace=a');
  assert.deepEqual(f.calls,[{limit:20},{limit:20,cursor:'a'}]);
});
test('outcome error and empty recovery leave focus on visible choices',async t=>{
  const f=railFixture(t);f.queue.push(f.answer(['a'],'a'));await f.rail.load();
  const first=f.host.children[0];f.queue.push(()=>Promise.reject(Error('Offline')));await f.rail.load();
  assert.equal(f.host.hidden,false);assert.equal(f.host.children[0],first);assert.equal(f.retry.hidden,false);
  f.more.focus();f.queue.push(()=>Promise.reject(Object.assign(Error('Denied'),{status:403})));await f.rail.load();
  assert.equal(f.host.hidden,true);assert.equal(document.activeElement,f.retry);
  f.queue.push(f.answer([]));await f.retry.onclick();assert.equal(f.empty.hidden,false);assert.equal(document.activeElement,f.empty);
});
test('a refreshed outcome link names its current title in the departure choice',async t=>{
  const f=railFixture(t);f.queue.push(f.answer(['a']));await f.rail.load();
  const first=f.host.children[0], renamed=f.answer(['a']);renamed.items[0].title='Renamed outcome';
  f.queue.push(renamed);await f.rail.load();
  assert.equal(f.host.children[0],first,'refresh retains the focused link');
  first.onclick({button:0,preventDefault(){}});
  assert.deepEqual(f.opened,[[{kind:'workspace',id:'a'},'Renamed outcome']]);
});
test('outcome touch gaps do nothing and repeated More shares one read',async t=>{
  const f=railFixture(t);f.queue.push(f.answer(['a'],'a'));await f.rail.load();
  const first=f.host.children[0];first.box={left:10,right:100,top:10,bottom:60};let prevented=0;
  const touch=y=>({target:{closest:()=>first},changedTouches:[{clientX:40,clientY:y}],preventDefault(){prevented++;}});
  f.host.handlers.touchend(touch(65));assert.equal(prevented,1);
  f.host.handlers.touchend(touch(40));assert.equal(prevented,1);
  let release;f.queue.push(()=>new Promise(resolve=>release=resolve));const one=f.more.onclick(),two=f.more.onclick();
  assert.equal(one,two);release(f.answer(['b']));await one;assert.equal(f.calls.length,2);
});
test('a reload during More queues one first page rather than silently dropping the reload',async t=>{
  const f=railFixture(t);f.queue.push(f.answer(['a'],'a'));await f.rail.load();
  let release;f.queue.push(()=>new Promise(resolve=>release=resolve),f.answer(['new']));
  const more=f.rail.load(true),refresh=f.rail.load(),again=f.rail.load();assert.equal(refresh,again);
  release(f.answer(['b']));await Promise.all([more,refresh]);
  assert.deepEqual(f.calls,[{limit:20},{limit:20,cursor:'a'},{limit:20}]);assert.deepEqual(f.rail.pages.items.map(x=>x.id),['new']);
});
test('an outcome reload asked for while one is reading runs once more after it, never only joining it',async t=>{
  const f=railFixture(t);let release;
  f.queue.push(()=>new Promise(resolve=>release=resolve),f.answer(['a','b']));
  const refresh=f.retry.onclick(),reload=f.rail.load(),again=f.rail.load();
  assert.notEqual(reload,refresh);assert.equal(reload,again);
  release(f.answer(['a']));await refresh;assert.equal(await reload,true);
  assert.equal(f.calls.length,2);assert.deepEqual(f.rail.pages.items.map(x=>x.id),['a','b']);
});
test('an outcome reload keeps the outcomes loaded with More',async t=>{
  const f=railFixture(t);f.rail.pageMax=100;
  f.queue.push(f.answer(['a'],'a'));await f.rail.load();
  f.queue.push(f.answer(['b'],'b'));await f.rail.load(true);
  f.queue.push(f.answer(['a'],'a'),f.answer(['b','c'],'c'));await f.rail.load();
  assert.deepEqual(f.calls.slice(2),[{limit:20},{limit:20,cursor:'a'}]);
  assert.deepEqual(f.rail.pages.items.map(x=>x.id),['a','b','c']);assert.equal(f.more.hidden,false);
});
