import test from 'node:test';
import assert from 'node:assert/strict';
import { leavingReadCancellation, cases1010 } from './pointer_light_1010_native.mjs';
const cancelled={stack:'Fetch API cannot load http://127.0.0.1:51000/api/view due to access control checks.\nNative fetch cancellation'};
test('1010 native cancellation classification is bounded to WebKit leaving the old main document',()=>{
 assert.equal(leavingReadCancellation(cancelled,'webkit',true),true);
 for(const [engine,leaving]of[['webkit',false],['chromium',true],['chromium',false]])assert.equal(leavingReadCancellation(cancelled,engine,leaving),false);
 for(const stack of ['TypeError: real app defect','Fetch API cannot load x due to access control checks. EXTRA','NetworkError: failed read','',undefined])assert.equal(leavingReadCancellation({stack},'webkit',true),false,'unexpected errors stay failures');
});
test('1010 native inventory covers both looks/themes at laptop and every named phone width',()=>{
 const cases=cases1010();assert.equal(cases.length,16);assert.equal(new Set(cases.map(c=>c.name)).size,16);
 for(const size of['laptop','w320','w375','w390'])for(const theme of['light','dark'])for(const look of['bookends','paper'])assert.ok(cases.some(c=>c.size===size&&c.theme===theme&&c.look===look));
});
