import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tabRemovalMutation, tabToComposerEdge } from './composer_width_focus.mjs';
const width = () => readFileSync(new URL('./composer_width_native.mjs', import.meta.url),'utf8');

test('650 baseline uses one full Build, separate caches and exact restoration even on failure', async () => {
  const source=width();
  assert.ok(!source.includes('baseline ? execFileSync'), 'historical adapters cannot overlay current app');
  assert.ok(!source.includes('`${BASE}:web/aim.css`'), 'historical CSS cannot overlay current app');
  assert.match(source,/baseline \? baselineResponses : staticResponses/);
  const start=source.indexOf('const baselineCase = async');
  assert.ok(start>0,'full-build baseline wrapper exists');
  const scope=source.slice(start,source.indexOf('\n  for (const surface',start));
  const calls=[], selected={commit:'base',tree:'tree',web_tree:'web',ordered_parents:['p'],files:{'app.mjs':{sha256:'old'}},candidate_hashes:{'app.mjs':'current'},candidate_csp_sha256:'csp'};
  const run=new Function('control','writeFile','path','evidence','assert','BASE','baseBinding','baseHashes','hashes','engine',`${scope}; return baselineCase;`)(
    async x=>{calls.push(x.phase); return x.phase==='baseline'?selected:{restored:true,hashes:selected.candidate_hashes,csp_sha256:'csp'};},
    async()=>{},path,'/evidence',assert,'base',{tree:'tree',web_tree:'web',ordered_parents:['p']},{'web/app.mjs':'old'},{'web/app.mjs':'current'},'contract');
  await run(async()=>calls.push('action'));assert.deepEqual(calls,['baseline','action','restored']);calls.length=0;
  await assert.rejects(run(async()=>{throw Error('action failed');}),/action failed/);assert.deepEqual(calls,['baseline','restored']);calls.length=0;
  selected.files['app.mjs'].sha256='mixed';await assert.rejects(run(async()=>assert.fail('must not execute')),/every baseline file/);assert.deepEqual(calls,['baseline','restored']);
});

test('Tab removal changes effective source state, rejects unknown overwrites and preserves original bytes', async () => {
  const source=readFileSync(new URL('../web/composer-width.mjs',import.meta.url),'utf8');
  const constructor='edge.tabIndex = 0;';
  const m=tabRemovalMutation(constructor);assert.equal(m.old,constructor);
  const integrated=source;
  const effective=tabRemovalMutation(integrated);assert.equal(effective.old,'edge.tabIndex = embedded ? -1 : 0;');
  // Execute assignment order to distinguish the historically ineffective mutant.
  const assign=text=>new Function('edge',`const embedded=false; ${text.match(/edge\.tabIndex = [^;]+;/g).join('\n')} return edge.tabIndex;`)({});
  assert.equal(assign(integrated.replace(m.old,m.new)),0,'constructor mutation is overwritten');
  assert.equal(assign(integrated.replace(effective.old,effective.new)),-1,'effective mutation survives placement');
  assert.throws(()=>tabRemovalMutation(constructor+'\n'+constructor),/one effective/);
  assert.throws(()=>tabRemovalMutation(source+'\n'+effective.old),/one effective/);
  assert.throws(()=>tabRemovalMutation(source+'\nedge.tabIndex = 1;'),/unaccounted/);
  assert.equal(readFileSync(new URL('../web/composer-width.mjs',import.meta.url),'utf8'),source,'source remains untouched');
  assert.ok(/tabRemovalMutation\(/.test(width()),'native harness uses effective selector');
});

function focusPage(stops) {
  let index=-1,presses=0;
  return { get presses(){return presses;},keyboard:{async press(key){assert.ok(['Tab','Alt+Tab'].includes(key));index=(index+1)%stops.length;presses++;}},
    async evaluate(fn){ const text=fn.toString(); if(text.includes("querySelectorAll('*')"))return stops.length+1;
      if(text.includes('requestAnimationFrame'))return;
      return {...stops[index],ring:true}; } };
}
test('native traversal helper reaches an edge beyond 12 stops and rejects a repeated unreachable cycle', async () => {
  const stops=Array.from({length:19},(_,i)=>({index:i,id:'stop'+i,side:null}));
  stops.push({index:19,id:'edge',side:'left'});
  const p=focusPage(stops);assert.equal((await tabToComposerEdge(p,{dialog:'#reader'},'left','chromium')).length,20);
  assert.equal(p.presses,20);
  const missing=focusPage(stops.slice(0,-1));await assert.rejects(tabToComposerEdge(missing,{dialog:'#reader'},'left','webkit'),/native Tab reaches.*repeats/);
  assert.equal(missing.presses,20,'stops at actual repeat');
  assert.ok(/tabToComposerEdge\(/.test(width()),'native harness uses finite traversal');
});

test('650 reopening helper uses one tap for an already lit card and two for an unlit card', async () => {
  const { openComposerReader } = await import('./composer_width_focus.mjs');
  for(const initial of [false,true]) {
    let lit=initial,opened=false,taps=0;
    const card={classList:{contains:()=>lit}}, reader={get open(){return opened;}}, source={textContent:'Second agent passage'};
    const document={querySelector:s=>s==='#reader'?reader:s==='#source-body'?source:card,getAnimations:()=>[]};
    const p={touch:true,locator:s=>({async scrollIntoViewIfNeeded(){},async tap(){taps++;if(lit)opened=true;else lit=true;},async evaluate(fn){return fn(reader);}})};
    const until=async(_,fn,label,arg)=>{
      const result=new Function('document','arg',`return (${fn.toString()})(arg);`)(document,arg);
      assert.equal(result,true,label);
    };
    await openComposerReader(p,'message',until);
    assert.equal(taps,initial?1:2,'only native taps needed for current state');
  }
});
