// The actual native mutant runner, with in-memory files and a frozen server
// build: verifies evidence accounting and filter isolation below the browser.
import test from 'node:test';
import {pencilMutantsEnabled} from './pencil-selection.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const native=readFileSync(new URL('./reader_compose_native.mjs',import.meta.url),'utf8');
const runner=native.slice(native.indexOf('async function runPencilMutants()'),native.indexOf('// How the run ended,'));
const original=new Map([
  ['web/aim.css',readFileSync(new URL('../web/aim.css',import.meta.url),'utf8')],
  ['web/inline-composer.mjs',readFileSync(new URL('../web/inline-composer.mjs',import.meta.url),'utf8')],
]);
const cases=[
  ['floats at the bottom','the pencil backdrop does not blur'],
  ['starts at one line','one line initially'],
  ['inline agent menu keeps compact','compact menu spacing'],
  ['unavailable composer stays disabled','unavailable recovery rows never overlap'],
  ['sends once and closes','successful send closes the pencil sheet'],
  ['loaded access visible','rows stay separate'],
  ['Send late confirmation keeps newer capturing image writing','older confirmation keeps newer image writing open'],
  ['publication rejected','sheet stays open'],
  ['Send late confirmation keeps newer memory-only image writing','image opener center is not covered by Remove'],
  ['Send late confirmation keeps newer agent menu presentation','older confirmation keeps newer presentation open'],
];
async function run(filter, survived='') {
  const files=new Map(original),served=new Map(original),results=[],calls=[],mutations=[];
  const context=vm.createContext({pencilCleanup:async(_label,action,restore)=>{try{await action();}finally{await restore();}},pencilMutantsEnabled,assert,createHash,path,root:'',filter,results,pencilMutations:mutations,pencilPhase:'',engine:'chromium',facts:{origin:'http://fixture'},
    pencilCases:new Map(cases.map(([name])=>[`item 673 topic phone-320 light: ${name}`,()=>{}])),
    readFile:async file=>files.get(file),writeFile:async(file,value)=>files.set(file,value),
    control:async({method})=>{calls.push(method);if(method==='server_start'){served.clear();for(const entry of files)served.set(...entry);}},
    fetch:async url=>({text:async()=>served.get('web/'+url.split('/').at(-1))}),
    console:{log(){}},
    check:async name=>{
      const phase=context.pencilPhase;
      const mutant=phase.startsWith('mutant '),rule=phase.split(' ')[1];
      const expected=rule==='full-height'?'empty sheet floats below the context':rule==='move-cards'?'opening moves no feed card':cases.find(([part])=>name.includes(part))[1];
      results.push({name,passed:!mutant||rule===survived,...(mutant&&rule!==survived?{error:expected}:{})});
    },
  });
  await vm.runInContext(runner+'\nrunPencilMutants()',context);
  return {files,served,results,calls,mutations};
}
test('item 673: a narrow ledger filter runs no built-in mutant or restoration',async()=>{
  const r=await run('item 673 topic phone-320 light: floats at the bottom');
  assert.deepEqual(r.calls,[]);
  assert.deepEqual(r.results,[]);
});
test('item 673: caught failures count as passing evidence while preserving the observed failure and exact restore',async()=>{
  const r=await run('item 673');
  assert.equal(r.mutations.length,12);
  assert.ok(r.mutations.every(m=>m.applied&&m.caught));
  assert.ok(r.mutations.every(m=>m.proof.originalSha256===m.proof.restoredSha256&&m.proof.mutantSha256===m.proof.servedMutantSha256&&m.proof.originalSha256===m.proof.servedRestoredSha256),'complete served bytes and exact restored bytes are bound');
  assert.ok(r.results.every(x=>x.passed),'compose counters see successful mutation checks as passed');
  assert.ok(r.results.filter(x=>x.expectedFailure).every(x=>x.observedPassed===false&&x.mutationCaught));
  assert.equal(r.calls.filter(x=>x==='server_start').length,24,'each mutant and restored control gets a fresh frozen build');
  assert.deepEqual(r.files,original);assert.deepEqual(r.served,original);
});
test('item 673: a surviving mutant stays a failed check and the production files are restored',async()=>{
  const r=await run('item 673','fixed-field');
  const missed=r.results.find(x=>x.expectedFailure&&!x.mutationCaught);
  assert.ok(missed);assert.equal(missed.passed,false);assert.equal(missed.observedPassed,true);
  assert.deepEqual(r.files,original);assert.deepEqual(r.served,original);
});
