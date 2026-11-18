// Isolate the producer's JS thread. This independent clock also covers a
// synchronous stall that cannot service the harness's own async deadline.
import {Worker} from 'node:worker_threads';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const [harness,chrome,evidence,groupFile]=process.argv.slice(2);
const group=JSON.parse(readFileSync(groupFile,'utf8'));
const worker=new Worker(pathToFileURL(harness),{argv:[chrome,evidence]});
let timer,terminal=false,snapshot={results:[],completed:[]};
const clocks=new Map([['overall',{identity:{stage:'group-wall'},started_at:new Date().toISOString(),seconds:group.wall_seconds??5400,deadline:Date.now()+(group.wall_seconds??5400)*1000}],['bootstrap',{identity:{stage:'module-bootstrap'},started_at:new Date().toISOString(),seconds:group.seed_seconds,deadline:Date.now()+group.seed_seconds*1000}]]);
function arm(){
 clearTimeout(timer);if(terminal)return;
 const next=[...clocks.values()].sort((a,b)=>a.deadline-b.deadline)[0];if(!next)return;
 timer=setTimeout(async()=>{
  terminal=true;
  const red={...next.identity,passed:false,timeout:true,source:group.source,started_at:next.started_at,
    timed_out_at:new Date().toISOString(),limit_seconds:next.seconds,error:'Producer worker did not retire by its deadline'};
  const record={group:group.id,source:group.source,cases_sha256:group.cases_sha256,complete:false,passed:false,
    cleanup:false,browserClosed:false,harnessCompleted:false,terminal:red,
    completed:snapshot.completed||[],unfinished:group.cases.filter(r=>!(snapshot.completed||[]).includes(r.name)),
    results:[...(snapshot.results||[]).filter(r=>r.name!==red.name),red],
    retirement:{producerWorkerStopped:false,actionSettled:false,ownedCleanup:'unproven; synchronous stall'},
    runtime:{node:process.version,platform:process.platform,arch:process.arch},rawSnapshot:snapshot};
  mkdirSync(evidence,{recursive:true});
  const save=()=>writeFileSync(path.join(evidence,'group-timeout.json'),JSON.stringify(record,null,2));
  save();appendFileSync(path.join(evidence,'case-progress.jsonl'),JSON.stringify(red)+'\n');
  // Terminate only this producer's owned Worker. No OS signal, process search,
  // inherited checkout or later case. Browser/fixture closure stays unproven.
  const retirementLimit=setTimeout(()=>{record.retirement.workerTermination='unproven-at-host-exit';save();process.exit(1);},(group.worker_exit_seconds??5)*1000);
  await worker.terminate();clearTimeout(retirementLimit);record.retirement.producerWorkerStopped=true;save();process.exit(1);
 },Math.max(1,next.deadline-Date.now()));
}
worker.on('message',message=>{
 if(terminal)return;
 if(message.kind==='compose775-begin'){
  clocks.delete('bootstrap');clocks.delete('between-guards');
  clocks.set(message.token,{identity:message.identity,started_at:message.started_at,seconds:message.seconds,
    deadline:Date.now()+(message.seconds+group.terminal_cleanup_seconds+(group.watchdog_grace_seconds??5))*1000});
  snapshot=message.snapshot;arm();
 }else if(message.kind==='compose775-end'){
  clocks.delete(message.token);snapshot=message.snapshot;
  if(!clocks.size)clocks.set('between-guards',{identity:{stage:'final-output-or-between-guards'},started_at:new Date().toISOString(),seconds:group.final_seconds||120,deadline:Date.now()+((group.final_seconds||120)+group.terminal_cleanup_seconds+5)*1000});
  arm();
 }
});
worker.on('error',error=>{console.error(error);process.exitCode=1});
worker.on('exit',code=>{if(!terminal){clearTimeout(timer);process.exit(code);}});
arm();
