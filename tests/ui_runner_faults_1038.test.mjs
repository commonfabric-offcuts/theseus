import test from 'node:test';
import assert from 'node:assert/strict';
import {healthLines, healthProblems} from '../web/health.mjs';

const now = Date.now();
const fault = {exception_class:'OperationalError', message:'database is locked'};
const answer = runner => ({runner, red:['runner'], agents:[], machine:{load:null,cpus:null}, release:null});

test('1038 Health puts the kept fault beside the actual pause reason', () => {
  const value = answer({state:'paused',live:false,why:'of a storage fault',fault});
  assert.match(healthProblems(value,{now})[0], /storage fault \(OperationalError: database is locked\)/);
  assert.match(healthLines(value,{now})[0].summary, /OperationalError: database is locked/);
});
test('1038 Health preserves previous fault after resume and keeps a legacy answer readable', () => {
  const value = answer({state:'running',live:true,started_ms:now,prior:{state:'paused',ended_ms:now-1000,why:'of a storage fault',fault}});
  const line = healthLines(value,{now})[0];
  assert.doesNotMatch(line.summary, /OperationalError/);
  assert.match(line.details[0], /OperationalError: database is locked/);
  assert.doesNotMatch(healthLines(answer({state:'paused',live:false,why:'of a storage fault'}),{now})[0].summary, /undefined|null/);
});
