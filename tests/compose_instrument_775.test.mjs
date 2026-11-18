// Execute only a synthetic harness with fake controls and fake browser objects.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const dir=mkdtempSync(path.join(os.tmpdir(),'compose-775-instrument-'));
try {
 const source=path.join(dir,'source.mjs'),target=path.join(dir,'patched.mjs');
 const text=`import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const [chrome, evidence, filter = ''] = process.argv.slice(2);
const results=[],calls=[];
let browser,engine;
const fakeBrowser={version:()=>'synthetic-only',close:async()=>calls.push('browser-close')};
const playwright={chromium:{launch:async()=>fakeBrowser},webkit:{launch:async()=>fakeBrowser}};
const fixture={stdin:{end(){calls.push('fixture-end')}}},shortFixture=fixture;
const fixtureExit=Promise.resolve({code:0,signal:null}),shortExit=fixtureExit;
const seed=async()=>calls.push('seed');
async function check(name,action){const full=\`\${engine} \${name}\`;if(filter&&!full.includes(filter))return;await action();results.push({name:full,passed:true});}
async function runItem721(){await check('retained',async()=>calls.push('RETAINED-REPLAY'));}
async function run(){await check('omitted',async()=>calls.push('OMITTED'));await check('chosen',async()=>calls.push('CHOSEN'));}
async function runAnswering(){await check('answer',async()=>calls.push('ANSWER'));}
async function runSending(){await check('send',async()=>calls.push('SEND'));}
const ENGINES=['chromium','webkit'];
const PHASES=[[runItem721],[run],[runAnswering,()=>calls.push('coordinator')],[runSending]];
const plannedPhases = PHASES.flatMap(([phase]) => ENGINES.map(name => \`\${phase.name}:\${name}\`)), completedPhases = [];
let browserClosed = true, harnessCompleted = false;
try {
 await seed();
 for(const [phase,before] of PHASES){
 if (before) await before();
 for (engine of ENGINES) {
 browserClosed=false;
 browser = engine === 'chromium' ? await playwright.chromium.launch({ executablePath: chrome, headless: true }) : await playwright.webkit.launch({ headless: true });
 try { await phase(); } finally { await browser.close(); browserClosed = true; }
 completedPhases.push(\`\${phase.name}:\${engine}\`);
 }}
 harnessCompleted = true;
} finally {
 fixture.stdin.end();shortFixture.stdin.end();
 await Promise.all([fixtureExit, shortExit]);
 await writeFile(path.join(evidence,'fake.json'),JSON.stringify({results,browserClosed, harnessCompleted, plannedPhases, completedPhases,calls}));
}
assert.ok(results.length&&results.every(r=>r.passed));`;
 writeFileSync(source,text);
 const emitted=spawnSync(process.execPath,['tools/compose_instrument.cjs',source,target,new URL('../tools/compose_deadline_775.mjs',import.meta.url).href],{encoding:'utf8'});
 assert.equal(emitted.status,0,emitted.stderr);
 const patched=readFileSync(target,'utf8');
 if(process.env.COMPOSE_DEBUG_COPY)writeFileSync(process.env.COMPOSE_DEBUG_COPY,patched);
 assert.ok(patched.includes("async function run(){await check('omitted',async()=>calls.push('OMITTED'));await check('chosen',async()=>calls.push('CHOSEN'));}"),'action/oracle content remains byte exact');
 for(const [phase,name,expected]of [['run','chosen','CHOSEN'],['runSending','send','SEND']]){
 const group={id:'synthetic',phase,engine:'webkit',source:{head:'synthetic'},cases:[{phase,engine:'webkit',name:'webkit '+name,limit_seconds:1}],seed_seconds:1,launch_seconds:1,phase_seconds:1,final_seconds:1,terminal_cleanup_seconds:.05};
 const groupPath=path.join(dir,'group.json');writeFileSync(groupPath,JSON.stringify(group));
 const child=spawnSync(process.execPath,[target,'/fake-chrome',dir],{env:{...process.env,AIM_COMPOSE_GROUP:groupPath},encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);
 const receipt=JSON.parse(readFileSync(path.join(dir,'fake.json')));
 assert.deepEqual(receipt.results.map(r=>r.name),['webkit '+name]);
 assert.deepEqual(receipt.completedPhases,[phase+':webkit/group:synthetic']);
 assert.deepEqual(receipt.plannedPhases,[phase+':webkit/group:synthetic']);
 assert.equal(receipt.calls.includes('OMITTED'),false);assert.equal(receipt.calls.includes('RETAINED-REPLAY'),false);
 assert.ok(receipt.calls.includes(expected));assert.equal(receipt.calls.filter(x=>x==='coordinator').length,phase==='runSending'?1:0);
 assert.equal(receipt.harnessCompleted,false);assert.ok(receipt.scope775.groupCompleted&&receipt.browserClosed);
 assert.equal(receipt.scope775.originalWholeCompleted,false);
 assert.deepEqual(receipt.scope775.runtime.map(r=>r.version),['synthetic-only']);
 const supervised=spawnSync(process.execPath,['tools/compose_worker_775.mjs',target,'/fake-chrome',dir,groupPath],{env:{...process.env,AIM_COMPOSE_GROUP:groupPath},encoding:'utf8'});
 assert.equal(supervised.status,0,supervised.stderr);
 const supervisedReceipt=JSON.parse(readFileSync(path.join(dir,'fake.json')));
 assert.deepEqual(supervisedReceipt.results.map(r=>r.name),['webkit '+name]);
 assert.equal(supervisedReceipt.harnessCompleted,false);
 console.log('PASS exact synthetic '+phase+' selection, seed, coordinator and phase truth');
 }
}finally{rmSync(dir,{recursive:true,force:true});}
