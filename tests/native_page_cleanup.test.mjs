import test from 'node:test';
import assert from 'node:assert/strict';
import { ReleaseRule } from './release-rule.mjs';
import { protocol } from './native-calls.mjs';
import { withPageCleanup, closeNativePage, settlePageReleases } from './native-page-cleanup.mjs';

test('rail action and page errors survive a settlement timeout and target-close refusal; cleanup still runs',async()=>{
  const order=[];
  const p={errors:[{message:'independent page error'}],close:()=>closeNativePage({
    settle:async()=>{order.push('settle');throw Error('unsettled pause');},
    close:async()=>{order.push('close');throw Error('target refused');},
    forget:()=>order.push('forget'),
  })};
  await assert.rejects(withPageCleanup(p,async()=>{order.push('action');throw Error('order assertion');}),error=>{
    for(const text of ['order assertion','independent page error','unsettled pause','target refused'])assert.match(error.stack,new RegExp(text));
    return true;
  });
  assert.deepEqual(order,['action','settle','close','forget']);
});
test('rail observes a page error first reported during successful cleanup',async()=>{
  const p={errors:[],close:async()=>p.errors.push({message:'late page error'})};
  await assert.rejects(withPageCleanup(p,async()=>{}),/late page error/);
});
test('rail successful cleanup keeps the original action failure and closes once',async()=>{
  let closes=0;const original=Error('ordering failed');
  await assert.rejects(withPageCleanup({errors:[],close:async()=>{closes++;}},async()=>{throw original;}),e=>e===original);
  assert.equal(closes,1);
});
test('rail successful action still fails an unexplained settlement and always closes',async()=>{
  let closed=false,forgot=false;
  await assert.rejects(withPageCleanup({errors:[],close:()=>closeNativePage({
    settle:async()=>{throw Error('Timed out: every refused interception release settled');},
    close:async()=>{closed=true;},forget:()=>{forgot=true;},
  })},async()=>{}),/Timed out: every refused interception release settled/);
  assert.equal(closed,true);assert.equal(forgot,true);
});


test('rail settlement waits on the actual release command and handler, then observes its refused interception',async()=>{
  const errors=[],records=[],wire=[];
  const r=new ReleaseRule({failed:e=>errors.push(e)});
  r.observe({method:'Page.frameNavigated',params:{frame:{id:'main',loaderId:'old'}}});
  r.observe({method:'Network.requestWillBeSent',params:{requestId:'net',loaderId:'old'}});
  const p={errors,releaseHandlers:new Set(),pendingReleases:r.pending,unsettledReleases:r.unsettled,failedReleases:r.failed,excusedReleases:r.excused};
  const cdp=protocol({send:packet=>wire.push(JSON.parse(packet)),open:()=>true});
  const release=r.release({requestId:'pause',networkId:'net',request:{url:'/api/view'}},()=>cdp.call('Fetch.continueResponse',{requestId:'pause'}));
  const handler={};
  assert.equal(p.pendingReleases.size,1,'the command is owned before its answer');
  let probes=0;
  await settlePageReleases(p,async probe=>{
    assert.equal(probe(),false,'pending command holds settlement');probes++;
    r.observe({method:'Page.frameNavigated',params:{frame:{id:'main',loaderId:'new'}}});
    cdp.answer({id:wire[0].id,error:{message:'Invalid InterceptionId'}});
    await release;
    p.releaseHandlers.add(handler);
    assert.equal(probe(),false,'the remaining handler still owns work');probes++;
    p.releaseHandlers.delete(handler);assert.equal(probe(),true);probes++;
  },record=>records.push(record));
  assert.equal(probes,3);assert.equal(records[0].excused[0].requestId,'pause');
  assert.deepEqual([records[0].pendingCommands,records[0].pendingHandlers,records[0].pageErrors],[0,0,[]]);
});
test('rail settlement timeout retains each unresolved refusal and page error independently',async()=>{
  const records=[],p={errors:[{message:'page failed'}],releaseHandlers:new Set(),pendingReleases:new Set(),
    unsettledReleases:new Map([['pause',{requestId:'pause',networkId:'net'}]]),failedReleases:[],excusedReleases:[]};
  await assert.rejects(settlePageReleases(p,async probe=>{assert.equal(probe(),false);throw Error('settlement timed out');},r=>records.push(r)),/settlement timed out/);
  assert.deepEqual(records[0].unsettled,[{requestId:'pause',networkId:'net'}]);
  assert.deepEqual(records[0].pageErrors,[{message:'page failed'}]);
});
