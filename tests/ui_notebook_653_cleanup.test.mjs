import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { releaseNotebook653, withNotebook653 } from './notebook_images_653_native.mjs';

test('item 653 Notebook release is an expression accepted by both actual native adapters', async () => {
  let releases=0;
  const context=vm.createContext({item653State:'busy',window:{item653Release:()=>{releases++;}}});
  // Both registered adapters use this exact Runtime/evaluate wrapper.
  const wrap=expression=>`(async()=>(${expression}))()`;
  await assert.rejects(async()=>vm.runInContext(wrap("item653State='normal';window.item653Release?.()"),context),/Unexpected token ';'/);
  await vm.runInContext(wrap(releaseNotebook653),context);
  assert.equal(context.item653State,'normal');assert.equal(releases,1);
});

test('item 653 Notebook action and cleanup errors remain independently visible, and close always runs',async()=>{
  const original=Error('item 653 original geometry failure'),cleanup=Error('item 653 cleanup refusal');let closes=0;
  await assert.rejects(withNotebook653({errors:[],evaluate:async()=>{throw cleanup;},close:async()=>{closes++;}},async()=>{throw original;}),error=>{
    assert.ok(error instanceof AggregateError);assert.match(error.message,/original geometry failure/);assert.match(error.message,/cleanup refusal/);return true;
  });
  assert.equal(closes,1);
  await assert.rejects(withNotebook653({errors:[],evaluate:async()=>{},close:async()=>{closes++;}},async()=>{throw original;}),error=>error===original);
  assert.equal(closes,2);
});
