// Read only explicit retained native records. Never rerun a browser or rewrite a receipt.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {assertBuild783} from './cover_783_comparator.mjs';
const frozen=execFileSync('git',['show','75b7a721:tests/cover_783_oracle.mjs'],{encoding:'utf8'});
const old=await import('data:text/javascript;base64,'+Buffer.from(frozen).toString('base64'));
const root='/Users/commonfabric/.local/share/theseus/fable-tools/codex/pool-results';
for(const [group,run] of [['783-tests9806','783-reading9810-frozen1'],['783-tests9806','783-webkit9810-frozen1'],['783-fix9912','783-corrected-chr9912-frozen1'],['783-fix9912','783-corrected-wk9912-frozen1']]) {
  const file=`${root}/${group}/${run}/${run}-1/evidence/native.json`,bytes=fs.readFileSync(file),j=JSON.parse(bytes);
  const failures=j.results.filter(r=>!r.passed);
  const observations=j.observations.filter(o=>/failure state|actual caught assertion/.test(o.name));
  if(group==='783-tests9806') {assert.equal(failures.length,9);for(const r of failures)assert.match(r.error,/WHISPER_SHAPE/);}
  else {
    assert.equal(failures.length,1);assert.match(failures[0].error,/783 native oracle catches the specific applied source regression/);
    const at=observations.find(o=>o.phase==='original'&&o.at)?.at;assert.ok(at);
    let prior;try{old.assertLook783(at);}catch(error){prior=error;}
    assert.equal(prior.code,'ERR_ASSERTION');assert.equal(prior.actual,false);assert.equal(prior.expected,true);assert.equal(prior.operator,'strictEqual');
    assert.notEqual(prior.message,'783 cover is first child','old comparator actually reproduces red');
    console.log(JSON.stringify({run,old:{message:prior.message,actual:prior.actual,expected:prior.expected,operator:prior.operator},corrected:assertBuild783(at,'original')}));
  }
  console.log(JSON.stringify({file,sha256:createHash('sha256').update(bytes).digest('hex'),counts:{passed:j.results.length-failures.length,failed:failures.length},failures,observations}));
}
