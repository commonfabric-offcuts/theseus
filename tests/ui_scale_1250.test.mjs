import test from 'node:test';
import assert from 'node:assert/strict';
import { protocol, decide, median, client } from '../tools/scale_1250.mjs';

const records=(ratio=1)=>Array.from({length:9},(_,n)=>({block:n,order:n%2?'large-small':'small-large',
  small:{status:'ok',ms:n+1},large:{status:'ok',ms:(n+1)*ratio}}));
test('1250 frozen estimator uses all nine pairs and exact 1.5 median boundary',()=>{
  assert.equal(decide(records(1.5)).passed,true);assert.equal(decide(records(1.5001)).passed,false);
  assert.deepEqual(protocol,{blocks:9,warmups:2,ratio:1.5,stratum:'warm',osCache:'uncontrolled'});
});
test('1250 timing tails and every paired ratio remain visible',()=>{
  const rows=records();rows[8].large.ms=9999;const answer=decide(rows);
  assert.equal(answer.maxLarge,9999);assert.equal(answer.pairedRatios.length,9);
  assert.equal(rows[8].large.ms,9999);
});
test('1250 missing, changed-order, failed and invalid samples cannot pass',()=>{
  assert.throws(()=>decide(records().slice(1)),/nine/);
  const order=records();order[0].order='large-small';assert.throws(()=>decide(order),/order/);
  const failure=records();failure[0].large.status='failed';assert.equal(decide(failure).passed,false);
  assert.throws(()=>median([0,1,2]),/invalid/);assert.throws(()=>median([1,NaN]),/invalid/);
});
test('1250 an undeclared request shape fails before a request is made',async()=>{
  const api=client({origin:'http://127.0.0.1:1',token:'synthetic',instance_id:'fixture'});
  await assert.rejects(api.read({topic_id:'target',limit:100}),/Unlisted/);
});
