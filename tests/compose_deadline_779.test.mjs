// Focused fake-control checks: no browser, server, fixture or product starts.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ComposeDeadline} from '../tools/compose_deadline_775.mjs';
const root=mkdtempSync(path.join(os.tmpdir(),'compose-775-fake-'));
try {
 for(const barrier of ['action','context-close','reset-drafts','fixture-exit','seed','final-fixture-exit']) {
  const out=path.join(root,barrier);
  const script=`import {ComposeDeadline} from ${JSON.stringify(new URL('../tools/compose_deadline_775.mjs',import.meta.url).href)};
import {writeFileSync} from 'node:fs';
const evidence=${JSON.stringify(out)}, marker=${JSON.stringify(path.join(out,'later-case'))};
const first={phase:'run',engine:'chromium',name:'chromium '+${JSON.stringify(barrier)},limit_seconds:0.02};
const group={id:'fake',source:{head:'fake-source'},cases_sha256:'fake-inventory',cases:[first,{...first,name:'later'}],terminal_cleanup_seconds:0.02};
const never=()=>new Promise(()=>{}), result=[];
const gate=new ComposeDeadline({group,evidence,snapshot:()=>({results:result}),retire:async()=>{
 if(['fixture-exit','final-fixture-exit'].includes(${JSON.stringify(barrier)}))await never(); return {browserClosed:true,fixtures:[{code:0,signal:null}]};}});
if(${JSON.stringify(barrier)}==='seed')await gate.guard({stage:'seed'},.02,never);
await gate.check(first,async()=>{
 if(${JSON.stringify(barrier)}==='action'){setTimeout(()=>writeFileSync(marker,'unretired action reached later writing'),200);await never();}
 result.push({...first,passed:true});
 if(${JSON.stringify(barrier)}==='context-close')await never();
 if(${JSON.stringify(barrier)}==='reset-drafts')await never();
 if(${JSON.stringify(barrier)}==='fixture-exit')await never();
});
if(${JSON.stringify(barrier)}==='final-fixture-exit')await gate.guard({stage:'fixture-exit'},.02,never);
writeFileSync(marker,'later case ran');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
  assert.equal(child.status,1,child.stderr);assert.equal(child.signal,null);
  const receipt=JSON.parse(readFileSync(path.join(out,'group-timeout.json')));
  if(['seed','final-fixture-exit'].includes(barrier))assert.equal(receipt.terminal.stage,barrier==='seed'?'seed':'fixture-exit');
  else assert.equal(receipt.terminal.name,'chromium '+barrier);assert.equal(receipt.terminal.source.head,'fake-source');
  assert.equal(receipt.terminal.passed,false);assert.ok(receipt.terminal.started_at&&receipt.terminal.timed_out_at);
  assert.equal(receipt.complete,false);assert.equal(receipt.cleanup,false);assert.equal(receipt.browserClosed,false);
  assert.deepEqual(receipt.completed,barrier==='final-fixture-exit'?['chromium '+barrier]:[]);assert.equal(receipt.unfinished.length,barrier==='final-fixture-exit'?1:2);
  assert.equal(receipt.retirement.actionSettled,false);assert.equal(existsSync(path.join(out,'later-case')),false);
  assert.equal(receipt.results.at(-1).passed,false,'early pass taken back by timed-out ending');
  console.log('PASS terminal deadline covers '+barrier+' and no later case');
 }
 const cases=[{phase:'run',engine:'webkit',name:'one',limit_seconds:.1}];
 let retired=false;
 const gate=new ComposeDeadline({group:{id:'normal',cases},evidence:root,snapshot:()=>({}),retire:async()=>{retired=true}});
 await gate.check(cases[0],async()=>{});assert.deepEqual(gate.finish(),['one']);assert.equal(retired,false);
 await assert.rejects(gate.check(cases[0],async()=>{}),/order differs/);
 assert.throws(()=>new ComposeDeadline({group:{cases:[]}}),/empty/);
 console.log('PASS normal retirement barrier and exact nonempty order');
} finally {rmSync(root,{recursive:true,force:true});}
