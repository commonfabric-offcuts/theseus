// Actual click-time opener/resolver bodies with bounded I/O; native gestures
// and geometry are covered separately by unfound_links_958_native.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolveTopicLink, topicLinkNeedsLookup } from '../web/topic-link-route.mjs';
import { parseRoute, routeHref } from '../web/topic-navigation.mjs';
const source=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function openDestination('), end=source.indexOf('// Why the page stayed,',start);
assert.ok(start>=0&&end>start);
const canonical='t-'+ 'a'.repeat(32), pageId='n-'+ 'b'.repeat(32);
const query=text=>parseRoute(new URL(text,'https://fixture/'));
const refusal=code=>Object.assign(Error('Read refused'),{details:{error:{code}}});
function fixture({surface='message',read=async()=>{throw refusal('FORBIDDEN');}}={}) {
  const calls=[], notices=[], writing={body:'Exact unsaved writing',selection:[3,8]}, opener={isConnected:true};
  const context=vm.createContext({resolveTopicLink,topicLinkNeedsLookup,routeHref,
    landingSerial:0,retired:false,topic:{id:'t-current',workspace_id:'w1'},views:{},
    bootstrap:{instance_id:'i'},linkOwnerScope:null,pageHereOutcome:null,
    api:{view:async(name,args,options)=>{calls.push(['read',name,args,options]);return read(name,args);}},
    topicNavigation:{serial:0,cancelPending(){this.serial++;},async openTarget(route){calls.push(['navigate',route]);return true;}},
    notebookSheet:surface==='sheet'?{showing:true,current:{say:words=>notices.push(['sheet',words])}}:null,
    linkNotice:surface==='cards'?words=>notices.push(['cards',words]):null,
    stayedWhy:error=>notices.push([surface,error.message]),
    shell:{handles:{},leave:href=>calls.push(['leave',href]),stayed:()=>{}},
    registry:{current:{opener,writing}},document:{activeElement:opener},
    $:()=>({}),showLine:()=>{},run:job=>job(),
    openNotebook:async id=>calls.push(['openNotebook',id]),
    pageSource:async page=>page,openSource:async ref=>calls.push(['openSource',ref]),
  });
  vm.runInContext(source.slice(start,end),context,{filename:'app.mjs:openDestination'});
  return {calls,notices,writing,context,open:(route,written=true)=>context.openDestination(route,'words',opener,written)};
}
const invalidQueries=[
  '?topic=Name&page=n-…',
  '?topic='+canonical,
  '?topic='+canonical+'&page='+pageId,
  '?topic=t-current&page='+pageId,
  '?workspace=w1&page='+pageId,
  '?cards='+pageId,
  '?topic=Landing&page='+pageId+'&revision=99',
];
for(const target of invalidQueries) test('958 unavailable query stays and explains: '+target,async()=>{
  const f=fixture();assert.equal(await f.open(query(target)),false);
  assert.equal(f.calls.some(c=>['navigate','leave','openNotebook','openSource'].includes(c[0])),false);
  assert.equal(f.notices.length,1);assert.match(f.notices[0][1],/could not be found|not available/i);
  assert.deepEqual(f.writing,{body:'Exact unsaved writing',selection:[3,8]});
});
for(const surface of ['reader','sheet','cards','item','cover']) test('958 refusal is said at '+surface,async()=>{
  const f=fixture({surface});await f.open(query('?topic=Name&page=n-…'));
  assert.equal(f.notices[0]?.[0],surface);assert.equal(f.calls.some(c=>c[0]==='navigate'),false);
});
for(const code of ['INVALID_ARGUMENT','INVALID_SOURCE','NOT_FOUND','TOPIC_NOT_FOUND','FORBIDDEN']) test('958 confirmed Core refusal never navigates: '+code,async()=>{
  const f=fixture({read:async()=>{throw refusal(code);}});await f.open(query('?topic=Name&page=n-…'));
  assert.equal(f.calls.some(c=>c[0]==='navigate'),false);assert.equal(f.notices.length,1);
});
for(const bad of ['identity','instance','owner','deleted','revision']) test('958 invalid page result cannot become a destination: '+bad,async()=>{
  const result={instance_id:'i',source_ref:{kind:'memory',id:pageId,revision:3},owner_scope:{kind:'topic',id:'actual'}};
  if(bad==='identity')result.source_ref.id='wrong';
  if(bad==='instance')result.instance_id='wrong';
  if(bad==='owner')result.owner_scope.kind='message';
  if(bad==='deleted')result.deleted=true;
  if(bad==='revision')result.source_ref.revision=4;
  const f=fixture({read:async()=>result});await f.open(query('?topic=Name&page='+pageId+'&revision=3'));
  assert.equal(f.calls.some(c=>c[0]==='navigate'),false);assert.equal(f.notices.length,1);
});
test('958 good named page follows its actual owner and requested revision',async()=>{
  const f=fixture({read:async()=>({instance_id:'i',source_ref:{kind:'memory',id:pageId,revision:3},owner_scope:{kind:'topic',id:'actual'}})});
  await f.open(query('?topic=StaleLabel&page='+pageId+'&revision=3'));
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(c=>c[0]==='navigate')[1])),{kind:'topic',id:'actual',page:pageId,revision:'3'});
  assert.equal(f.calls[0][1],'source');assert.deepEqual(f.notices,[]);
});
test('958 plain unknown topic names keep their existing refusal',async()=>{
  const f=fixture({read:async(name)=>{
    if(name==='topic')throw refusal('FORBIDDEN');
    if(name==='conversation')return {instance_id:'i',conversation:null};
    if(name==='workspaces')return {instance_id:'i',items:[],next_cursor:null};
    return {instance_id:'i',items:[],next_cursor:null,groups:{done:0,archived:0}};
  }});await f.open(query('?topic=Missing958'));
  assert.match(f.notices[0]?.[1],/No topic is named Missing958/);assert.equal(f.calls.some(c=>c[0]==='navigate'),false);
});
test('958 good canonical topic is confirmed; current topic and ordinary routes keep their path',async()=>{
  const f=fixture({read:async(_name,args)=>({instance_id:'i',topic:{id:args.topic_id,workspace_id:'w1'}})});
  await f.open(query('?topic='+canonical));assert.equal(f.calls.filter(c=>c[0]==='read').length,1);
  f.calls.length=0;await f.open(query('?topic=t-current'));assert.equal(f.calls.filter(c=>c[0]==='read').length,0);
  f.calls.length=0;await f.open(query('?topic='+canonical),false);assert.equal(f.calls.filter(c=>c[0]==='read').length,0);
});
test('958 late unavailable page cannot overwrite a newer destination',async()=>{
  let reject;const held=new Promise((_yes,no)=>reject=no);const f=fixture({read:()=>held});
  const pending=f.open(query('?topic=Name&page='+pageId));
  await f.open({kind:'root'},false);reject(refusal('FORBIDDEN'));await pending;
  assert.deepEqual(f.notices,[]);assert.equal(f.calls.filter(c=>c[0]==='navigate').length,1);
});
test('958 an interrupted lookup is not misreported as a missing destination',async()=>{
  const f=fixture({read:async()=>{throw Object.assign(Error('Connection interrupted'),{code:'REQUEST_UNCONFIRMED'});}});
  await f.open(query('?topic=Name&page='+pageId));
  assert.equal(f.notices.some(([,words])=>/could not be found|not available/i.test(words)),false);
});
