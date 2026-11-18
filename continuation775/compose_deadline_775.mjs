// Terminal deadline: the group ends before any later case can inherit work.
// Only the future isolated group producer exits; no signals or process lookup.
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import {parentPort} from 'node:worker_threads';
let serial775=0;
export class ComposeDeadline {
  constructor({ group, evidence, snapshot, retire, terminate = code => process.exit(code) }) {
    if (!group.cases?.length || new Set(group.cases.map(r => r.name)).size !== group.cases.length)
      throw Error('empty or duplicate compose selection');
    Object.assign(this, {group, evidence, snapshot, retire, terminate});
    this.completed = []; this.terminal = false; this.active = null;
  }
  async guard(identity, seconds, action) {
    if (this.terminal) throw Error('compose group already terminal');
    if (!(Number.isFinite(seconds) && seconds > 0)) throw Error('invalid deadline');
    const started = new Date().toISOString();
    const token=++serial775;
    const send=kind=>parentPort?.postMessage({kind,token,identity,seconds,started_at:started,snapshot:{...this.snapshot(),completed:this.completed.slice()}});
    send('compose775-begin');
    const previous = this.active;
    this.active = {identity, started, seconds};
    let timer;
    // Timeout never resolves back to a running phase. Termination is mandatory.
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        if (this.terminal) return;
        this.terminal = true;
        const active = this.active || {identity, started, seconds};
        const red = { ...active.identity, passed:false, timeout:true, started_at:active.started,
          timed_out_at:new Date().toISOString(), limit_seconds:active.seconds,
          error:'Compose deadline exceeded; group terminated before later cases', source:this.group.source };
        const state = { group:this.group.id, source:this.group.source, cases_sha256:this.group.cases_sha256,
          complete:false, passed:false, cleanup:false, harnessCompleted:false, browserClosed:false,
          terminal:red, completed:this.completed.slice(),
          unfinished:this.group.cases.filter(r=>!this.completed.includes(r.name)),
          runtime:{node:process.version,platform:process.platform,arch:process.arch},
          results:[...(this.snapshot().results || []).filter(r=>r.name!==red.name),red],
          retirement:{actionSettled:false, ownedCleanup:'pending'}, rawSnapshot:this.snapshot() };
        mkdirSync(this.evidence,{recursive:true});
        const save=()=>writeFileSync(path.join(this.evidence,'group-timeout.json'),JSON.stringify(state,null,2));
        save();
        appendFileSync(path.join(this.evidence,'case-progress.jsonl'),JSON.stringify(red)+'\n');
        // Cleanup may unblock the old action, but that action never authorizes
        // continuation. Even successful close is not proof it finished restoring.
        let finished=false;
        const stop=()=>{if(finished)return;finished=true;save();this.terminate(1);reject(Error(red.error));};
        const cleanupTimer=setTimeout(()=>{state.retirement.ownedCleanup='deadline-exceeded';stop();},this.group.terminal_cleanup_seconds*1000);
        Promise.resolve().then(()=>this.retire()).then(value=>{
          state.retirement.ownedCleanup=value; clearTimeout(cleanupTimer);stop();
        },error=>{state.retirement.ownedCleanup={error:String(error)};clearTimeout(cleanupTimer);stop();});
      }, seconds*1000);
    });
    try {
      const result=await Promise.race([Promise.resolve().then(action),deadline]);
      if(this.terminal) return await deadline; // never release an action that raced cleanup
      return result;
    } finally { clearTimeout(timer); if(!this.terminal){this.active=previous;send('compose775-end');} }
  }
  async check(row, action) {
    const next=this.group.cases[this.completed.length];
    if (!next || next.name!==row.name || next.phase!==row.phase || next.engine!==row.engine)
      throw Error('compose selected case order differs');
    await this.guard(row,row.limit_seconds,action);
    if(this.terminal)throw Error('compose terminal');
    this.completed.push(row.name);
  }
  finish() {
    if(this.terminal || this.completed.length!==this.group.cases.length)throw Error('compose inventory unfinished');
    return this.completed.slice();
  }
}
