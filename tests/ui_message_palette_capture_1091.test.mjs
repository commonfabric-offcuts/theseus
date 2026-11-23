import test from 'node:test';
import assert from 'node:assert/strict';
import {ResponseCaptures,fixtureEvents} from './message_palette_1091_capture.mjs';

test('1091 capture keeps a navigation-lost body distinct while every unrelated body failure stays an error',async()=>{
  const report={lostToNavigation:[],captureErrors:[]},captures=new ResponseCaptures(report);
  captures.add({path:'/api/view'},()=>Promise.reject(Error('No resource with given identifier found\nResponse body is not available for a response that was navigated away from.')));
  captures.add({path:'/api/command'},()=>Promise.reject(Error('No resource with given identifier found')));
  captures.add({path:'/api/other'},()=>{throw Error('Target page, context or browser has been closed');});
  await Promise.all(captures.jobs);assert.deepEqual(report.lostToNavigation.map(x=>x.path),['/api/view']);assert.deepEqual(report.captureErrors.map(x=>x.path),['/api/command','/api/other']);
});
test('1091 close seals response job admission before drain and never invokes a late response body',async()=>{
  let resolve,lateReads=0;const pending=new Promise(r=>{resolve=r;}),report={lostToNavigation:[],captureErrors:[]},captures=new ResponseCaptures(report);
  assert.equal(captures.add({path:'/api/view'},()=>pending),true);assert.equal(captures.close(),1);
  assert.equal(captures.add({path:'/late'},()=>{lateReads++;return Promise.resolve();}),false);assert.equal(lateReads,0);assert.equal(captures.jobs.length,1);
  let drained=false;const drain=Promise.all(captures.jobs).then(()=>{drained=true;});await Promise.resolve();assert.equal(drained,false);resolve();await drain;assert.equal(drained,true);assert.deepEqual(report.captureErrors,[]);
});
test('1091 fixture event sink retains ordered events from both documents when page globals are replaced',()=>{
  let bytes='';const log=fixtureEvents(line=>{bytes+=line;});let page={documentId:'before-reload'};
  log.record({...page,type:'click',trusted:true});page={documentId:'after-reload'};log.record({...page,type:'keydown',trusted:true});
  assert.deepEqual(log.events.map(x=>x.documentId),['before-reload','after-reload']);assert.deepEqual(bytes.trimEnd().split('\n').map(JSON.parse),log.events);assert.ok(log.events.every(x=>x.trusted));
});
