import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { TopicPages } from '../web/topic-navigation.mjs';
import { waitForDepartureList } from './reader_departure_native.mjs';

const named={method:'Network.webSocketFrameReceived',params:{response:{payloadData:'{"seq":42}'}}};
const read={method:'Network.requestWillBeSent',params:{requestId:'topics-after',request:{postData:'{"name":"workspace_topics","args":{"workspace_id":"w","build":false}}'}}};
const response={method:'Network.responseReceived',params:{requestId:'topics-after',response:{status:200}}};
const finished={method:'Network.loadingFinished',params:{requestId:'topics-after'}};
const expected={workspace:'w',ids:['t3','t2','t1'],target:'t2',document:'same-document',message:{id:'reply-42',body:'The exact reply'}};
function fixture() {
  const pages=new TopicPages('i','w',{id:'t1',workspace_id:'w',list_position:1,activity_ms:1});
  pages.accept({instance_id:'i',items:[3,2,1].map(n=>({id:'t'+n,title:'Topic '+n,workspace_id:'w',list_position:n,activity_ms:n})),next_cursor:null});
  // An actual TopicPages current-topic update: activity changes, position does not.
  pages.current={...pages.current,activity_ms:42};
  const state={busy:false,painted:true,reply:true,document:'same-document',frames:0};
  const node=id=>({dataset:{topicId:id},closest:()=>null,getClientRects:()=>state.painted?[{}]:[],getBoundingClientRect:()=>({width:100,height:44})});
  const document={querySelectorAll:()=>pages.items.map(item=>node(item.id)),querySelector:selector=>{
    if(selector==='#more-topics')return {hasAttribute:()=>state.busy};
    if(selector==='#topic-navigation')return {dataset:{listing:state.document}};
    if(selector.startsWith('#messages'))return state.reply?{textContent:expected.message.body,getClientRects:()=>[{}]}:null;
    if(selector.startsWith('#topics'))return state.painted?node('t2'):null;
    throw Error('Unexpected DOM read: '+selector);
  }};
  const p={network:[named,read,response,finished],evaluate:async expression=>structuredClone(await vm.runInNewContext(expression,{document,requestAnimationFrame:callback=>{state.frames++;callback();}}))};
  const until=async probe=>{const value=await probe();assert.ok(value,'readiness still pending');return value;};
  return {p,state,pages,until};
}
test('item 641 departure waits for the reply commit and painted unchanged order from real TopicPages',async()=>{
  const f=fixture();await waitForDepartureList(f.p,expected,42,f.until,'committed stable list');
  assert.ok(f.state.frames>=2,'a completed read is followed by a paint boundary');
});
test('item 641 departure rejects activity-driven movement from real TopicPages',async()=>{
  const f=fixture();
  Object.defineProperty(f.pages,'items',{get(){return [...this.loaded.values()].map(item=>item.id==='t1'?this.current:item).sort((a,b)=>b.activity_ms-a.activity_ms);}});
  await assert.rejects(waitForDepartureList(f.p,expected,42,f.until,'activity moved the list'));
});
for(const boundary of ['feed missing','old read','unfinished read','failed read','foreign outcome read','build-only read','busy','reply absent','target absent','new document'])test('item 641 departure cannot press across '+boundary,async()=>{
  const f=fixture();
  if(boundary==='feed missing')f.p.network=[read,response,finished];
  if(boundary==='old read')f.p.network=[read,response,finished,named];
  if(boundary==='unfinished read')f.p.network=[named,read];
  if(boundary==='failed read')f.p.network=[named,read,{...response,params:{...response.params,response:{status:503}}},finished];
  if(['foreign outcome read','build-only read'].includes(boundary)){const q=JSON.parse(read.params.request.postData);if(boundary==='foreign outcome read')q.args.workspace_id='another';else q.args.build=true;f.p.network=[named,{...read,params:{...read.params,request:{postData:JSON.stringify(q)}}},response,finished];}
  if(boundary==='busy')f.state.busy=true;
  if(boundary==='reply absent')f.state.reply=false;
  if(boundary==='target absent')f.state.painted=false;
  if(boundary==='new document')f.state.document='replacement';
  await assert.rejects(waitForDepartureList(f.p,expected,42,f.until,boundary));
});
