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
    disposed:false,hasInFlightSend:false,inDoubt:[],hasUnprotectedWriting:false,
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
  const f=departure();
  f.registry.inDoubt=[{session:f.registry.sessions.get('writing'),editor:f.editor,ids:new Set(['s']),items:[{id:'s',status:'prepared'}],unread:false,label:'Review 1 reply'}];
  const w={kind:'workspace',id:'next'},t={kind:'topic',id:'next'};
  await assert.rejects(f.navigation.openTarget(w,'Outcome'),/“Review 1 reply”.*“Outcome” again/);
  await assert.rejects(f.navigation.openTarget(t,'Topic'),/“Review 1 reply”.*“Topic” again/);
  assert.deepEqual(f.visits,[]);
  await f.navigation.openTarget(t,'Topic');assert.deepEqual(f.visits,[t]);
});

function railFixture(t) {
  const previous=globalThis.document;
  class Element {
    constructor(){this.children=[];this.dataset={};this.attributes={};this.handlers={};this.hidden=false;this.text='';}
    // As the DOM's: text is the node's own words, then its children's, in order.
    get textContent(){return this.text+this.children.map(child=>typeof child==='string'?child:child.textContent).join('');}
    set textContent(value){this.text=String(value);this.children=[];}
    append(...nodes){for(const child of nodes){if(typeof child==='object')child.parent=this;this.children.push(child);}}
    replaceChildren(...nodes){this.children=[];this.text='';this.append(...nodes);}
    addEventListener(name,fn){this.handlers[name]=fn;}
    setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}getAttribute(k){return k in this.attributes?this.attributes[k]:null;}
    insertBefore(child,before){child.remove();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,child);child.parent=this;}
    after(...nodes){const host=this.parent;if(!host)return;for(const node of nodes)node.remove();host.children.splice(host.children.indexOf(this)+1,0,...nodes);for(const node of nodes)node.parent=host;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
    focus(){document.activeElement=this;}
    getBoundingClientRect(){return this.box;}
  }
  globalThis.document={createElement:()=>new Element(),activeElement:null};t.after(()=>globalThis.document=previous);
  const nodes=Object.fromEntries(['host','more','retry','message','empty'].map(k=>[k,new Element()]));
  // Each row says where its outcome stands (item 86): 'a' waits on the reader, any other is quiet.
  const light=id=>id==='a'?{light:'waiting',label:'Waiting on you',short:{kind:'asks',count:1},unreadable:false}
    :{light:'quiet',label:'Quiet',short:{kind:'since',ms:null},unreadable:false};
  const queue=[],calls=[],opened=[],row=id=>({id,owner_id:'owner',title:'Same',title_truncated:true,version:1,light:light(id)});
  const answer=(ids,next_cursor=null)=>({instance_id:'instance',items:ids.map(row),next_cursor});
  const broughtBack=[];let bringing=null;
  const rail=new OutcomeRail({...nodes,instanceId:'instance',current:'a',read:args=>{calls.push(args);const next=queue.shift();return typeof next==='function'?next():Promise.resolve(next);},open:(...args)=>opened.push(args),denied:error=>error.status===403,
    reader:'tony',bringBack:item=>{broughtBack.push(item.id);return bringing?bringing(item):Promise.resolve({});}});
  return {...nodes,queue,calls,opened,answer,rail,broughtBack,bringWith:fn=>{bringing=fn;}};
}
test('outcome links expose stable IDs and preserve native activation and More focus',async t=>{
  const f=railFixture(t);f.queue.push(f.answer(['a'],'a'));await f.rail.load();
  const first=f.host.children[0];assert.equal(first.children[0].textContent,'Same…');
  // The grey line under the name says where the outcome stands, not its id (item 86).
  assert.equal(first.children[1].textContent,'Waiting on you · 1 question · title shortened');
  assert.equal(first.children[1].dataset.light,'waiting');
  f.more.focus();f.queue.push(f.answer(['b']));await f.more.onclick();
  assert.equal(document.activeElement.dataset.workspaceId,'b');assert.equal(f.host.children[0],first);
  assert.equal(f.host.children[1].children[1].textContent,'Quiet · title shortened');
  let prevented=0;first.onclick({button:0,metaKey:true,preventDefault(){prevented++;}});
  assert.equal(prevented,0);assert.deepEqual(f.opened,[]);
  first.onclick({button:0,preventDefault(){prevented++;}});assert.equal(prevented,1);
  assert.deepEqual(f.opened,[[{kind:'workspace',id:'a'},'Same']]);assert.equal(first.href,'?workspace=a');
  assert.deepEqual(f.calls,[{limit:20},{limit:20,cursor:'a'}]);
});
test('reached outcomes fold into one Reached (N) line after the list, read only when it is opened',async t=>{
  const f=railFixture(t);
  const column=document.createElement();column.append(f.more);f.more.after(f.rail.reached);
  assert.equal(f.rail.reached.hidden,true);
  f.queue.push({...f.answer(['a']),reached_count:2});await f.rail.load();
  assert.equal(f.rail.reached.hidden,false);assert.equal(f.rail.reached.children[0].textContent,'Reached (2)');
  assert.deepEqual(f.calls,[{limit:20}],'nothing reached is read until the line is opened');
  f.queue.push({instance_id:'instance',items:[{id:'r1',title:'Old deck',reached_ms:Date.UTC(2026,10,1,12)},{id:'a',title:'Same',reached_ms:null}],next_cursor:null});
  f.rail.reached.open=true;f.rail.reached.ontoggle();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls.at(-1),{reached:true,limit:20});
  const links=f.rail.reached.children[1].children;
  assert.deepEqual(links.map(link=>[link.href,link.children[0].textContent]),[['?workspace=r1','Old deck'],['?workspace=a','Same']]);
  assert.match(links[0].children[1].textContent,/^Reached \S/);assert.equal(links[1].children[1].textContent,'Reached');
  assert.equal(links[1].attributes['aria-current'],'page','the open outcome is marked');
  const read=f.calls.length;f.rail.reached.open=false;f.rail.reached.ontoggle();
  assert.equal(f.calls.length,read,'closing the line reads nothing');
  f.queue.push({...f.answer(['a']),reached_count:0});await f.rail.load();
  assert.equal(f.rail.reached.hidden,true,'with none reached the line goes');
  f.queue.push(()=>Promise.reject(Object.assign(Error('Denied'),{status:403})));f.rail.reachedCount=3;await f.rail.load();
  assert.equal(f.rail.reached.hidden,true,'a reader denied the list sees no line');
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

// Item 404: archived and completed outcomes fold into one closed "Archived (N)" line directly above "Reached (N)".
test('Archived (N) sits above Reached (N), hidden at 0, and reads ended outcomes only when it is opened; the owner brings one back from its row',async t=>{
  const f=railFixture(t);
  const column=document.createElement();column.append(f.more);f.more.after(f.rail.ended,f.rail.reached);
  assert.deepEqual(column.children.map(node=>node===f.rail.ended?'ended':node===f.rail.reached?'reached':'more'),['more','ended','reached'],'directly above Reached');
  assert.equal(f.rail.ended.hidden,true);
  f.queue.push({...f.answer(['a']),reached_count:1,ended_count:0});await f.rail.load();
  assert.equal(f.rail.ended.hidden,true,'hidden at 0');
  f.queue.push({...f.answer(['a']),reached_count:1,ended_count:2});await f.rail.load();
  assert.equal(f.rail.ended.hidden,false);assert.equal(f.rail.ended.children[0].textContent,'Archived (2)');
  assert.deepEqual(f.calls,[{limit:20},{limit:20}],'nothing ended is read until the line is opened');
  const nov15=Date.UTC(2026,10,15,20);
  f.queue.push({instance_id:'instance',next_cursor:null,items:[
    {id:'e1',owner_id:'tony',title:'Garden shed',version:4,end:{state:'archived',by:'tony',ms:nov15}},
    {id:'e2',owner_id:'fable',title:'Quiet field',version:9,conversation_id:'t-e2',end:{state:'completed',by:'fable',ms:nov15}}]});
  f.rail.ended.open=true;f.rail.ended.ontoggle();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls.at(-1),{ended:true,limit:20});
  const rows=f.rail.ended.children[1].children;
  assert.deepEqual(rows.map(row=>row.children[0].children.map(node=>node.textContent)),[['Garden shed','Archived Nov 15'],['Quiet field','Completed Nov 15']]);
  assert.equal(rows[0].children.length,2,'the owner\'s row carries Bring back, outside the link');
  assert.equal(rows[1].children.length,1,'no Bring back on an outcome someone else owns');
  const button=rows[0].children[1];
  assert.deepEqual([button.textContent,button.getAttribute('aria-label'),button.getAttribute('title')],
    ['Bring back','Bring back Garden shed','Bring back this outcome: it returns to your outcomes with the topics archiving took']);
  // A press on the row opens what a home row opens: its page, or its Conversation on the home.
  let prevented=0;rows[1].children[0].onclick({button:0,preventDefault(){prevented++;}});
  assert.deepEqual(f.opened,[[{kind:'workspace',id:'e2'},'Quiet field']]);
  // Refused, the row stays and says why.
  f.bringWith(()=>Promise.reject(Error('Garden shed is archived; tony, its owner, can bring it back.')));
  await button.onclick();
  assert.equal(rows[0].children.at(-1).textContent,'Garden shed is archived; tony, its owner, can bring it back.');
  assert.equal(button.textContent,'Bring back','no longer busy');
  // Taken: the row goes, the list reads again with it back in its place, and the keys land on its row.
  f.bringWith(null);
  f.queue.push({...f.answer(['a','e1']),reached_count:1,ended_count:1});
  f.queue.push({instance_id:'instance',next_cursor:null,items:[{id:'e2',owner_id:'fable',title:'Quiet field',version:9,end:{state:'completed',by:'fable',ms:nov15}}]});
  await button.onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.broughtBack,['e1','e1']);
  assert.equal(document.activeElement?.dataset.workspaceId,'e1','the keys go to its row in the list');
  assert.equal(f.rail.ended.children[0].textContent,'Archived (1)');
  assert.deepEqual(f.rail.ended.children[1].children.map(row=>row.dataset.workspaceId),['e2'],'the open line read its rows again with the list');
});
