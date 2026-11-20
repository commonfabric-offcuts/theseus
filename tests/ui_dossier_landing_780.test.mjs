// Focused below-browser contracts. Runs actual product function bodies with
// bounded in-memory I/O; never claims native input, selection or layout proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { OutlineDossiers } from '../web/outline-dossiers.mjs';
import { parseRoute, routeHref, routeKey, TopicNavigation } from '../web/topic-navigation.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { StackFeed } from '../web/stack-feed.mjs';
import { checkedView } from '../web/freshness.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
const source = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const between = (start, end) => {
  assert.equal(source.split(start).length, 2, start);
  const at = source.indexOf(start), stop = source.indexOf(end, at);
  assert.ok(stop > at, end);
  return source.slice(at, stop);
};
const target = (id='t') => ({kind:'topic',id,message:'root',land:true});
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(yes => resolve=yes); return {promise,resolve}; };

function app({loaded=false, readerOpen=false}={}) {
  const doc=miniDocument(), calls=[], card=doc.createElement('article');
  card.dataset.id='root'; card.scrollIntoView=options=>calls.push(['scroll',options]);
  card.focus=options=>{doc.activeElement=card; calls.push(['focus',options]);};
  const views=new TopicViews({instanceId:'i',topicId:'t'});
  const item={id:'root',topic_id:'t',seq:4,body:'root',author_id:'fixture'};
  if(loaded) views.messages.set('root',item);
  const presentation=readerOpen?{source:'existing',writing:'exact unsaved words'}:null;
  const registry={disposed:false,generation:0,current:presentation,cleanup:{foreground:()=>({read:job=>job({readClass:'foreground'}),release:()=>calls.push(['release'])})}};
  const scope={console,structuredClone,checkedView,document:doc,routeHref,
    registry,topic:{id:'t'},views,topicUnavailable:false,listAccessEpoch:0,retired:null,landingSerial:0,
    here:{page:false},reader:{dialog:{open:readerOpen}},
    $:id=>doc.byId(id),entries:()=>views.messages.has('root')?[{dataset:{id:'root'}}]:[],
    reveal:(_entry,opts)=>calls.push(['reveal',opts]),opened:()=>card,
    releaseTopArrivals:()=>calls.push(['releaseTopArrivals']),anchorHold:null,rememberListAnchor:()=>{},
    run:job=>Promise.resolve().then(job),
    openSource:async ref=>{calls.push(['openSource',copy(ref)]); scope.reader.dialog.open=true;},
    notebookReturning:()=>false,notebookSheetOf:()=>({resume:()=>calls.push(['resume'])}),
    paintConversationPage:()=>calls.push(['conversation']),
    api:{view:async(name,args,options)=>{calls.push(['read',name,copy(args),options]);
      if(name==='source')return {instance_id:'i',source_ref:{kind:'message',id:'root'},topic_id:'t',seq:4};
      if(name==='topic_messages')return {instance_id:'i',items:[item],next_cursor:4,relevant_versions:{topic:1}};
      throw Error(name);
    }},bootstrap:{instance_id:'i'},
    topicNavigation:{serial:0,openTarget:async value=>{calls.push(['navigate',copy(value)]);return true;}},
    showLine:()=>{},shell:{leave:href=>calls.push(['leave',href]),stayed:()=>calls.push(['stayed'])},stayedWhy:error=>{throw error;}
  };
  // This route fixture models one loaded card. Supply that projection to the
  // real landing resolver; full-app 891 cases cover hidden structural roots.
  scope.stackFeed=Object.create(StackFeed.prototype);
  Object.defineProperty(scope.stackFeed,'state',{get:()=>({stacks:views.messages.has('root')?[{head:views.messages.get('root'),replies:[]}]:[]})});
  scope.stackFeed.entryFor=id=>scope.entries().find(entry=>entry.dataset.id===id)??null;
  const context=vm.createContext(scope);
  vm.runInContext(between('function landOn(id,','// A message a link on the page names'),context);
  vm.runInContext(between('async function openDestination(', '// Why the page stayed,'),context);
  return {scope,calls,card,views,doc,presentation,open:route=>context.openDestination(route,'fixture'),
    initial:async route=>{
      scope.route=route;scope.topicId=route.id;scope.location={hash:''};scope.shell.rename=()=>{};
      // Observe the actual startup branch, including asynchronous work queued by run().
      const queued=[];scope.run=job=>{const promise=Promise.resolve().then(job);queued.push(promise);return promise;};
      const start=source.lastIndexOf('  if (anchored) {'),end=source.indexOf("  // A Notebook page's link opens the page in the Reader",start);
      assert.ok(start>0&&end>start);
      await vm.runInContext('(async()=>{'+between("  const anchored = route.kind === 'topic'", "  if (route.kind === 'conversation')")+source.slice(start,end)+'})()',context);
      await Promise.all(queued);
    }};
}

test('854 cross-topic landing resumes the kept Notebook after landing, not in a Reader',async()=>{
  const f=app();f.scope.notebookReturning=()=>true;
  await f.initial(target('t'));
  assert.ok(f.calls.findIndex(call=>call[0]==='resume')>f.calls.findIndex(call=>call[0]==='reveal'));
  assert.equal(f.calls.filter(call=>call[0]==='openSource').length,0);
});

test('780 outline emits landing intent for pointer/Return/tap path and native href fallback',()=>{
  const doc=miniDocument(),calls=[],subject=Object.create(OutlineDossiers.prototype);
  subject.outline={doc,open:value=>calls.push(value)};
  const state={id:'t',links:new Map(),box:doc.createElement('div'),loaded:true,next:null,stars:[{dossier:{id:'root',name:'Dossier'}}]};
  subject.paint(state);
  const link=state.links.get('root');let prevented=false;
  link.onclick({button:0,preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.deepEqual(calls,[target()]);
  assert.deepEqual(parseRoute(new URL(link.href,'https://fixture/')),target());
});

test('780 landing route survives serialization, exact guard preservation and late guard refusal',async()=>{
  const destination=target('other');assert.doesNotThrow(()=>routeKey(destination));
  assert.deepEqual(parseRoute(new URL(routeHref(destination),'https://fixture/')),destination);
  assert.notEqual(routeKey(destination),routeKey({kind:'topic',id:'other',message:'root'}));
  const editor={key:'draft',localVersion:1,ackVersion:0,dirty:true,submissions:[],draft:{body:'Exact writing',attachments:[]}};
  const owner={editor},kept=[],moves=[];
  const registry={inline:null,current:null,sessions:new Map([['draft',owner]]),disposed:false,
    flush:async e=>{e.dirty=false;e.ackVersion=1;return {recorded:true,status:'committed'};},
    keepEditorsLocal:async editors=>kept.push(...editors)};
  const nav=new TopicNavigation({registry,current:{kind:'topic',id:'t'},navigateTarget:(to,still)=>moves.push({to,still})});
  assert.equal(await nav.openTarget(destination),true);
  assert.deepEqual(moves[0].to,destination);assert.equal(moves[0].still(),true);
  assert.deepEqual(kept,[editor]);assert.equal(editor.draft.body,'Exact writing');
  editor.localVersion++;assert.throws(()=>moves[0].still(),/writing|saved/i);
  registry.flush=async()=>{throw Error('save refused');};editor.dirty=true;
  await assert.rejects(nav.openTarget(destination),/saved/i);assert.equal(moves.length,1);
  assert.equal(editor.draft.body,'Exact writing');
});

test('780 rejects malformed landing routes and preserves ordinary message routes',()=>{
  const ordinary={kind:'topic',id:'t',message:'root'};
  assert.deepEqual(parseRoute(new URL(routeHref(ordinary),'https://fixture/')),ordinary);
  for(const route of [{kind:'topic',id:'t',land:'only'},{...target(),land:'yes'},{...target(),at:'unread'},
    {kind:'workspace',id:'w',land:'only'},{...target(),land:'only'}]) assert.throws(()=>routeKey(route),/incomplete|ambiguous/);
});

for(const loaded of [true,false]) test(`780 same-topic ${loaded?'loaded':'unloaded'} lands full, scrolls/selects, opens nothing`,async()=>{
  const f=app({loaded});await f.open(target());
  assert.equal(f.scope.reader.dialog.open,false);
  assert.equal(f.calls.some(c=>c[0]==='openSource'),false);
  assert.equal(f.doc.activeElement,f.card);
  assert.deepEqual(f.calls.filter(c=>c[0]==='reveal').map(c=>copy(c[1])),[{full:true}]);
  assert.equal(f.calls.filter(c=>c[0]==='scroll').length,1);
  if(!loaded){assert.ok(f.views.messages.has('root'));const reads=f.calls.filter(c=>c[0]==='read');
    assert.deepEqual(reads.map(c=>c[1]),['source','topic_messages']);
    assert.equal(reads[1][2].limit,30);assert.equal(reads[1][2].cursor,5);}
});

test('780 cross-topic initial anchor retains landing intent after URL consumption and opens no Reader',async()=>{
  const f=app();await f.initial(target());
  assert.equal(f.scope.reader.dialog.open,false);assert.equal(f.doc.activeElement,f.card);
  assert.equal(f.calls.some(c=>c[0]==='openSource'),false);
  assert.deepEqual(copy(f.calls.find(c=>c[0]==='reveal')?.[1]),{full:true});
});

for(const initial of [false,true]) test(`780 ordinary ${initial?'initial':'same-topic'} message still opens Reader`,async()=>{
  const f=app();const route={kind:'topic',id:'t',message:'root'};
  await (initial?f.initial(route):f.open(route));
  assert.equal(f.scope.reader.dialog.open,true);assert.equal(f.calls.filter(c=>c[0]==='openSource').length,1);
});

test('780 existing same-topic Reader keeps exact source and writing with no extra open or close',async()=>{
  const f=app({readerOpen:true});await f.open(target());
  assert.equal(f.scope.registry.current,f.presentation);assert.equal(f.presentation.writing,'exact unsaved words');
  assert.equal(f.scope.reader.dialog.open,true);assert.equal(f.calls.some(c=>c[0]==='openSource'),false);
});

for(const change of ['retired','access','unavailable','newer destination']) test(`780 unloaded landing ignores late result after ${change}`,async()=>{
  const f=app(),gate=deferred(),read=f.scope.api.view;
  f.scope.api.view=async(...args)=>{if(args[0]==='source')await gate.promise;return read(...args);};
  const pending=f.open(target());await new Promise(resolve=>setImmediate(resolve));
  if(change==='retired')f.scope.retired=new Map();
  if(change==='access')f.scope.listAccessEpoch++;
  if(change==='unavailable')f.scope.topicUnavailable=true;
  if(change==='newer destination')await f.open({kind:'topic',id:'elsewhere'});
  gate.resolve();await pending;
  assert.equal(f.doc.activeElement,null);assert.equal(f.calls.some(c=>c[0]==='openSource'),false);
  assert.equal(f.calls.filter(c=>c[0]==='read'&&c[1]==='topic_messages').length,0);
});

for(const bad of ['topic','message','instance']) test(`780 unloaded source refuses mismatched ${bad}`,async()=>{
  const f=app(),read=f.scope.api.view;
  f.scope.api.view=async(...args)=>{const result=await read(...args);if(args[0]==='source'){
    if(bad==='topic')result.topic_id='elsewhere';if(bad==='message')result.source_ref.id='wrong';if(bad==='instance')result.instance_id='wrong';}return result;};
  await assert.rejects(f.open(target()));assert.equal(f.doc.activeElement,null);assert.equal(f.scope.reader.dialog.open,false);
});

test('780 landing route cancelled by a newer current-topic choice keeps draft and never navigates',async()=>{
  const gate=deferred(),moves=[],editor={key:'d',localVersion:1,ackVersion:1,dirty:false,submissions:[],draft:{body:'Kept exact words',attachments:[]}};
  const registry={sessions:new Map([['d',{editor}]]),keepEditorsLocal:async()=>gate.promise};
  const nav=new TopicNavigation({registry,current:{kind:'topic',id:'t'},navigateTarget:to=>moves.push(to)});
  const pending=nav.openTarget(target('other'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await nav.openTarget({kind:'topic',id:'t'}),false);gate.resolve();
  assert.equal(await pending,false);assert.deepEqual(moves,[]);assert.equal(editor.draft.body,'Kept exact words');
});

test('780 app passes cross-topic landing route to its existing departure guard',async()=>{
  const f=app();await f.open(target('other'));
  assert.deepEqual(copy(f.calls.find(c=>c[0]==='navigate')?.[1]),target('other'));
  assert.equal(f.calls.some(c=>c[0]==='openSource'),false);
});

test('780 anchored fetch preserves newest page and paging frontier',async()=>{
  const f=app();
  f.views.messagesPage({instance_id:'i',items:[{id:'new',seq:40,topic_id:'t',body:'New',author_id:'fixture'}],next_cursor:40,relevant_versions:{topic:1}},{initial:true});
  await f.open(target());
  assert.equal(f.views.olderCursor,40);assert.equal(f.views.newest,40);
  assert.notEqual(f.views.runOf('root'),f.views.runOf('new'));
});

for(const change of ['access','generation','newer destination']) test(`780 page answer after ${change} cannot merge or select`,async()=>{
  const f=app(),entered=deferred(),release=deferred(),read=f.scope.api.view;
  f.scope.api.view=async(...args)=>{if(args[0]==='topic_messages'){entered.resolve();await release.promise;}return read(...args);};
  const pending=f.open(target());await entered.promise;
  if(change==='access')f.scope.listAccessEpoch++;
  if(change==='generation')f.scope.registry.generation++;
  if(change==='newer destination')await f.open({kind:'topic',id:'elsewhere'});
  release.resolve();await pending;
  assert.equal(f.views.messages.has('root'),false);assert.equal(f.doc.activeElement,null);
  assert.equal(f.calls.filter(c=>c[0]==='release').length,1);
});
