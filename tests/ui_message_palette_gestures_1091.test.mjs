import test from 'node:test';
import assert from 'node:assert/strict';
import {readerFromSource,readReaderState,readerFromPage} from './message_palette_1091_gestures.mjs';
import vm from 'node:vm';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const turns=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
test('1091 native source setup waits for inline readiness and then Reader readiness without a third feed click',async()=>{
  const first=deferred(),reader=deferred(),calls=[];let finished=false;
  const task=readerFromSource({inlineShown:async()=>false,pressSource:async()=>calls.push('press'),waitFirst:()=>{calls.push('wait-first');return first.promise;},waitReader:()=>{calls.push('wait-reader');return reader.promise;}}).then(()=>{finished=true;});
  await turns();assert.deepEqual(calls,['press','wait-first']);assert.equal(finished,false);
  first.resolve('inline');await turns();assert.deepEqual(calls,['press','wait-first','press','wait-reader']);assert.equal(finished,false,'the dialog is opening, so no next feed click or menu action is allowed');
  await turns();assert.equal(calls.filter(x=>x==='press').length,2);assert.equal(finished,false);
  reader.resolve();await task;assert.equal(finished,true);assert.equal(calls.filter(x=>x==='press').length,2);
});
test('1091 an already shown inline reply needs one native press and still awaits the Reader own ready state',async()=>{
  const reader=deferred(),calls=[];let finished=false;
  const task=readerFromSource({inlineShown:async()=>true,pressSource:async()=>calls.push('press'),waitFirst:()=>{throw Error('must not press again or await another inline');},waitReader:()=>{calls.push('wait-reader');return reader.promise;}}).then(()=>{finished=true;});
  await turns();assert.deepEqual(calls,['press','wait-reader']);assert.equal(finished,false);reader.resolve();await task;assert.equal(finished,true);
});
test('1091 a first press that opens the Reader fallback never presses the feed underneath its dialog',async()=>{
  const reader=deferred(),calls=[];let finished=false;
  const task=readerFromSource({inlineShown:async()=>false,pressSource:async()=>calls.push('press'),waitFirst:async()=>{calls.push('wait-first');return 'reader';},waitReader:()=>{calls.push('wait-reader');return reader.promise;}}).then(()=>{finished=true;});
  await turns();assert.deepEqual(calls,['press','wait-first','wait-reader']);assert.equal(finished,false);reader.resolve();await task;assert.equal(finished,true);
});
test('1091 refused or unavailable transitions fail without a compensating press',async()=>{
  for(const transition of ['refused','unknown']) {
    const calls=[],failure=Error('source unavailable');
    await assert.rejects(readerFromSource({inlineShown:async()=>false,pressSource:async()=>calls.push('press'),waitFirst:async()=>{if(transition==='refused')throw failure;return transition;},waitReader:async()=>calls.push('reader')}),transition==='refused'?e=>e===failure:/did not reach/);
    assert.deepEqual(calls,['press']);
  }
});

const sourceDOM=()=>{
  const nodes={
    '#reader':{open:false},'#source-body':{textContent:'Alpha kept words.',getClientRects:()=>[{}]},
    '#reader-menu':{hidden:false,disabled:false},'#card > .card-reply-composer':{hidden:true},
  };
  return {nodes,document:{querySelector:selector=>nodes[selector]??null}};
};
// Serialize the exact production callback with no closure bindings, as the
// driver does. This port checks callback inputs; it is not a CSP/browser proof.
const inPage=(fn,args,document)=>{assert.equal(typeof fn,'function','CSP-safe adapter must pass a function, never an eval string');return vm.runInNewContext('('+fn.toString()+')(args)',{args,document});};
test('1091 serialized readiness callback distinguishes inline, opening and the expected ready Reader',()=>{
  const {nodes,document}=sourceDOM(),args={cardSelector:'#card',prefix:'Alpha'};
  assert.equal(inPage(readReaderState,args,document),null);
  nodes['#card > .card-reply-composer'].hidden=false;assert.equal(inPage(readReaderState,{...args,waitFor:'first'},document),'inline');
  nodes['#reader'].open=true;nodes['#reader-menu'].disabled=true;
  assert.equal(inPage(readReaderState,args,document),'opening');assert.equal(inPage(readReaderState,{...args,waitFor:'first'},document),false);
  nodes['#reader-menu'].disabled=false;assert.equal(inPage(readReaderState,{...args,waitFor:'reader'},document),true);
  assert.equal(inPage(readReaderState,{...args,prefix:'Different source',waitFor:'reader'},document),false);
  nodes['#source-body'].getClientRects=()=>[];assert.equal(inPage(readReaderState,{...args,waitFor:'reader'},document),false);
});
test('1091 actual page adapter sends only self-contained function callbacks and cannot finish at an opening dialog',async()=>{
  const {nodes,document}=sourceDOM(),reader=deferred(),calls=[];let presses=0,finished=false,error;
  const page={
    evaluate:async(fn,args)=>inPage(fn,args,document),
    waitForFunction:async(fn,args)=>{
      assert.equal(typeof fn,'function','CSP-safe adapter must pass a function, never an eval string');calls.push(args.waitFor);
      if(args.waitFor==='reader'){assert.equal(inPage(fn,args,document),false);await reader.promise;nodes['#reader-menu'].disabled=false;}
      const result=inPage(fn,args,document);assert.ok(result,'wait must resolve only on its requested ready state');return {jsonValue:async()=>result};
    },
  };
  const task=readerFromPage({page,cardSelector:'#card',prefix:'Alpha',pressSource:async()=>{
    presses++;if(presses===1)nodes['#card > .card-reply-composer'].hidden=false;
    else {assert.equal(presses,2);nodes['#reader'].open=true;nodes['#reader-menu'].disabled=true;}
  }}).then(()=>{finished=true;},e=>{error=e;});
  await turns();if(error)throw error;assert.deepEqual(calls,['first','reader']);assert.equal(presses,2);assert.equal(finished,false);
  reader.resolve();await task;assert.equal(finished,true);assert.equal(presses,2);
});
