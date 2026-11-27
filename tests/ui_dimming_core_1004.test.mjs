import test from 'node:test';
import assert from 'node:assert/strict';
import { DimChoices, dimmingKey, freshDimming } from '../web/dim-choices.mjs';
import { DimmingSync, dimCacheKey } from '../web/dimming-sync.mjs';
import { openDimJournal } from '../web/dim-journal.mjs';
import { RailReadOrder } from '../web/rail-read-order.mjs';

const clone=structuredClone;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const storage=()=>{const rows=new Map();return {rows,get length(){return rows.size;},key:n=>[...rows.keys()][n]??null,getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};};
const storageLocks=new WeakMap();
function locksFor(storage){
  if(!storageLocks.has(storage)){
    const held=new Set();storageLocks.set(storage,{async request(name,options,callback){
      if(held.has(name))return callback(null);held.add(name);
      try{return await callback({name});}finally{held.delete(name);}
    }});
  }return storageLocks.get(storage);
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const turn=()=>new Promise(r=>setImmediate(r));
const bootstrap=actor=>({instance_id:'scratch-1004',actor,limits:{rail_dim_choices:2048},authority:{authority_id:'authority-1004',authority_epoch:'epoch-1004',continuity:'initial'}});
function server(binding=bootstrap) {
  const states=new Map(),ledger=new Map(),changes=[],calls=[];let seq=0;
  const api=actor=>({
    async view(name,args){
      calls.push({actor,name,args:clone(args)});const b=binding(actor),scope={kind:'actor',id:actor};
      if(name==='rail_dimming')return canonical({instance_id:b.instance_id,...clone(states.get(actor)??{value:freshDimming(),dim_revision:0}),...(args.candidate&&!states.has(actor)?{candidate:clone(args.candidate)}:{})});
      assert.equal(name,'changes');
      return {instance_id:b.instance_id,scope,baseline:!args.cursor,items:args.cursor?clone(changes.filter(x=>x.actor===actor&&x.seq>args.cursor.after_seq).map(({actor,...x})=>x)):[],has_more:false,continuation:null,covered_versions:{},
        checkpoint:{v:1,kind:'checkpoint',instance_id:b.instance_id,actor_id:actor,authority_id:b.authority.authority_id,authority_epoch:b.authority.authority_epoch,scope,after_seq:seq}};
    },
    async command(e){
      calls.push({actor,envelope:clone(e)});const key=actor+':'+e.operation_id;
      if(ledger.has(key))return clone(ledger.get(key));
      const old=states.get(actor)??{value:freshDimming(),dim_revision:0};
      const head={instance_id:e.instance_id,operation_id:e.operation_id,kind:e.kind,recorded:true};let receipt;
      if(e.expected.dim_revision!==old.dim_revision)receipt={...head,status:'rejected',error:{code:'REVISION_CONFLICT',message:'Changed elsewhere'}};
      else {
        const changed=!states.has(actor)||JSON.stringify(canonical(old.value))!==JSON.stringify(canonical(e.args.value));
        const next={value:clone(e.args.value),dim_revision:old.dim_revision+Number(changed)};states.set(actor,next);
        if(changed)changes.push({actor,seq:++seq,resource_kind:'rail_dimming',resource_id:actor,version:next.dim_revision});
        receipt=canonical({...head,status:'committed',result:{...next,changed}});
      }
      ledger.set(key,receipt);return clone(receipt);
    }
  });
  return {api,states,calls,changes,other(actor,value){return api(actor).command({v:1,instance_id:'scratch-1004',operation_id:'other-'+(seq+1),kind:'rail.dimming_set',target:{},expected:{dim_revision:states.get(actor)?.dim_revision??0,authority:bootstrap(actor).authority},args:{value}});}};
}
let serial=0;
function device(core,actor='reader',kept=storage(),api=core.api(actor),options={}) {
  const choices=new DimChoices(kept),sync=new DimmingSync({choices,storage:kept,journalFactory:opts=>openDimJournal({...opts,locks:locksFor(kept)}),id:()=>`device-op-${++serial}`,...options});
  const ready=sync.connect({api,bootstrap:options.bootstrap??bootstrap(actor)});
  return {choices,sync,kept,ready};
}

test('1004 fresh Core imports a valid973 cache once; existing Core wins and another device/actor is independent',async()=>{
  const core=server(),s=storage(),legacy=new DimChoices(s);legacy.bind('scratch-1004','reader');legacy.select(2);legacy.toggle('w','a');
  const a=device(core,'reader',s);await a.ready;assert.equal(core.states.get('reader').dim_revision,1);assert.equal(a.choices.dimmed('w','a'),true);
  const secondStorage=storage(),stale=new DimChoices(secondStorage);stale.bind('scratch-1004','reader');stale.select(1);stale.toggle('other');
  const b=device(core,'reader',secondStorage);await b.ready;assert.equal(b.choices.selected,2);assert.equal(b.choices.dimmed('w','a'),true);assert.equal(b.choices.dimmed('other'),false);
  const other=device(core,'someone');await other.ready;assert.equal(other.choices.selected,0);
  assert.equal(core.calls.filter(x=>x.envelope).length,1);
});

test('1004 Core choice limits drive editing and malformed capabilities prevent publication',async()=>{
  const core=server(),b=bootstrap('reader');b.limits={rail_dim_choices:1};
  const a=device(core,'reader',storage(),core.api('reader'),{bootstrap:b});await a.ready;
  assert.equal(a.choices.toggle('w','a'),true);await a.sync.idle();
  assert.equal(a.choices.toggle('w','b'),false);assert.equal(core.states.get('reader').dim_revision,1);
  const bad=device(core,'different',storage(),core.api('different'),{bootstrap:{...bootstrap('different'),limits:{rail_dim_choices:0}}});await bad.ready;
  bad.choices.select(2);await bad.sync.idle();assert.equal(core.states.has('different'),false);assert.match(bad.sync.status,/limit/i);
});

test('1004 retryable admission failures back off finitely, coalesce wakes and never create idle polling',async()=>{
  const core=server(),api=core.api('reader'),queue=new Map(),delays=[],cursors=[];let serial=0,fail=false,reads=0;
  const timers={setTimeout(fn,ms){const id=++serial;queue.set(id,fn);delays.push(ms);return id;},clearTimeout(id){queue.delete(id);}};
  const denied={command:api.command,async view(name,args){reads++;if(fail){cursors.push(clone(args.cursor));throw Object.assign(Error('bounded lane full'),{code:'SERVER_BUSY'});}return api.view(name,args);}};
  const a=device(core,'reader',storage(),denied,{timers});await a.ready;assert.equal(queue.size,0);
  const before=clone(a.sync.cursor),confirmed=clone(a.sync.confirmed);
  const runTimer=async()=>{assert.equal(queue.size,1);const [id,fn]=[...queue][0];queue.delete(id);fn();await a.sync.idle();};
  const next=freshDimming();next.selected=2;await core.other('reader',next);
  fail=true;await a.sync.retry();await a.sync.wake();assert.equal(queue.size,1);
  for(let n=0;n<3;n++)await runTimer();
  assert.deepEqual(delays,[100,200,400,3000]);
  assert.deepEqual(cursors,[before,before,before,before]);
  assert.deepEqual(a.sync.cursor,before);assert.deepEqual(a.sync.confirmed,confirmed);
  fail=false;await runTimer();
  assert.equal(a.choices.selected,2);assert.equal(a.sync.error,null);assert.equal(queue.size,0);
  const count=reads;await turn();assert.equal(reads,count);
  fail=true;await a.sync.retry();fail=false;await runTimer();
  assert.deepEqual(delays,[100,200,400,3000,100]);assert.equal(queue.size,0);
});

test('39 a refused trailing Dim read waits for activation, and another refusal adds no timer',async()=>{
  const core=server(),api=core.api('reader'),queue=new Map(),delays=[];let serial=0,fail=false,reads=0;
  const timers={setTimeout(fn,ms){const id=++serial;queue.set(id,fn);delays.push(ms);return id;},clearTimeout(id){queue.delete(id);}};
  const read={command:api.command,async view(name,args){reads++;if(fail)throw Object.assign(Error('busy'),{code:'SERVER_BUSY'});return api.view(name,args);}};
  const a=device(core,'reader',storage(),read,{timers});await a.ready;
  fail=true;await a.sync.wake();
  for(let n=0;n<4;n++){assert.equal(queue.size,1);const [key,fn]=[...queue][0];queue.delete(key);fn();await a.sync.idle();}
  assert.deepEqual(delays,[100,200,400,3000]);assert.equal(queue.size,0);
  const quiet=reads;await a.sync.wakeBehindRail();await turn();assert.equal(reads,quiet);
  await a.sync.activate();assert.equal(reads,quiet+1);assert.equal(queue.size,0);
  fail=false;await a.sync.activate();assert.equal(reads,quiet+2);assert.equal(a.sync.error,null);assert.equal(queue.size,0);
});

test('39 authority change and disposal cancel the old trailing Dim read',async()=>{
  let bound=bootstrap('reader'),fail=false,epochReads=0,reads=0,sequence=0;
  const core=server(()=>bound),api=core.api('reader'),queue=new Map();
  const timers={setTimeout(fn,ms){const id=++sequence;queue.set(id,{fn,ms});return id;},clearTimeout(id){queue.delete(id);}};
  const read={command:api.command,async view(name,args){
    reads++;if(fail)throw Object.assign(Error('busy'),{code:'SERVER_BUSY'});
    if(bound.authority.authority_epoch==='changed')epochReads++;
    return api.view(name,args);
  }};
  const a=device(core,'reader',storage(),read,{timers});await a.ready;
  const waitForTrailing=async()=>{
    fail=true;await a.sync.wake();
    for(let n=0;n<3;n++){const [key,{fn}]=[...queue][0];queue.delete(key);fn();await a.sync.idle();}
    assert.equal(queue.size,1);
    const entry=[...queue.values()][0];assert.equal(entry.ms,3000);return entry.fn;
  };
  const old=await waitForTrailing();
  bound={...bound,authority:{...bound.authority,authority_epoch:'changed'}};
  fail=false;await a.sync.connect({api:read,bootstrap:bound});
  assert.equal(epochReads,2);assert.equal(queue.size,0);
  old();await turn();assert.equal(epochReads,2);
  const disposed=await waitForTrailing();
  a.sync.disconnect();assert.equal(queue.size,0);
  const before=reads;disposed();await turn();assert.equal(reads,before);
});
test('1004 an explicit saved Dim0 prevents a later stale device import',async()=>{
  const core=server(),a=device(core);await a.ready;a.choices.select(0);await a.sync.idle();
  assert.equal(core.states.get('reader').dim_revision,1);
  const s=storage(),legacy=new DimChoices(s);legacy.bind('scratch-1004','reader');legacy.select(2);
  const b=device(core,'reader',s);await b.ready;assert.equal(b.choices.selected,0);assert.equal(core.states.get('reader').dim_revision,1);
});
test('a visible rail pass holds passive Dim sync and a local edit still saves', async () => {
  const core = server(), deviceState = device(core), gate = deferred();
  const order = new RailReadOrder();
  let committed;
  await deviceState.ready;
  await deviceState.sync.connect({ api: core.api('reader'), bootstrap: bootstrap('reader'), railReadOrder: order,
    live: { listen(listener) { committed = listener; return () => {}; } } });
  core.calls.length = 0;
  const rail = order.whileVisible(() => gate.promise);
  try {
    for (const seq of [1, 2, 3]) committed({ kind: 'commit', seq });
    await turn();
    assert.deepEqual(core.calls, [], 'passive commit reads wait');
    assert.equal(deviceState.choices.toggle('w', 'a'), true);
    await turn();
    assert.equal(core.calls.filter(call => call.envelope).length, 1, 'the local edit reaches Core while the rail waits');
    await deviceState.sync.idle();
    assert.equal(core.states.get('reader').dim_revision, 1);
  } finally { gate.resolve(); await rail; }
  await turn();
  await deviceState.sync.idle();
  assert.equal(core.calls.filter(call => call.name === 'changes').length, 1, 'queued commits coalesce into one scan');
});
test('1004 conflict replays an absolute edit over another device without replacing its unrelated choice',async()=>{
  const core=server(),a=device(core);await a.ready;
  const other=freshDimming();other.selected=1;other.sets[0].topics=[['w','b',true]];await core.other('reader',other);
  a.choices.toggle('w','a');assert.equal(a.choices.dimmed('w','a'),true);await a.sync.idle();
  assert.equal(a.choices.dimmed('w','b'),true);assert.equal(core.states.get('reader').dim_revision,2);
  const b=device(core);await b.ready;assert.equal(b.choices.dimmed('w','a'),true);assert.equal(b.choices.dimmed('w','b'),true);
});
test('1004 a lost committed answer survives reload and retries the exact original envelope',async()=>{
  const core=server(),api=core.api('reader'),calls=[];let lose=true;
  const broken={view:api.view,async command(e){calls.push(clone(e));const r=await api.command(e);if(lose){lose=false;throw Error('Connection lost');}return r;}};
  const s=storage(),a=device(core,'reader',s,broken);await a.ready;a.choices.toggle('w');await a.sync.idle();
  assert.equal(a.choices.kept,false);assert.match(a.sync.status,/Connection lost/);assert.equal(core.states.get('reader').dim_revision,1);
  a.sync.disconnect();const b=device(core,'reader',s,broken);await b.ready;assert.deepEqual(calls[1],calls[0]);
  assert.equal(core.states.get('reader').dim_revision,1);assert.equal(b.choices.dimmed('w'),true);assert.equal(b.choices.kept,true);
  assert.equal([...s.rows.keys()].some(k=>k.startsWith('aim-next.rail-dimming.pending.v1:')),false);
});
test('1004 a late committed receipt never erases newer edits from the same device',async()=>{
  const core=server(),api=core.api('reader'),gate=deferred();let first=true;
  const held={view:api.view,async command(e){const r=await api.command(e);if(first){first=false;await gate.promise;}return r;}};
  const a=device(core,'reader',storage(),held);await a.ready;a.choices.toggle('w','a');await turn();
  a.choices.toggle('w','b');assert.equal(a.choices.dimmed('w','a'),true);assert.equal(a.choices.dimmed('w','b'),true);
  gate.resolve();await a.sync.idle();assert.equal(a.choices.dimmed('w','a'),true);assert.equal(a.choices.dimmed('w','b'),true);assert.equal(core.states.get('reader').dim_revision,2);
});
test('1004 a recorded refusal rolls back only its batch and keeps newer edits',async()=>{
  const core=server(),api=core.api('reader'),gate=deferred();let first=true;
  const refusal={view:api.view,async command(e){if(first){first=false;await gate.promise;return {instance_id:e.instance_id,operation_id:e.operation_id,kind:e.kind,recorded:true,status:'rejected',error:{code:'FORBIDDEN',message:'No permission'}};}return api.command(e);}};
  const a=device(core,'reader',storage(),refusal);await a.ready;a.choices.toggle('w','a');await turn();a.choices.toggle('w','b');
  gate.resolve();await a.sync.idle();assert.equal(a.choices.dimmed('w','a'),false);assert.equal(a.choices.dimmed('w','b'),true);assert.equal(core.states.get('reader').dim_revision,1);
});
test('1004 unrelated actor keys cause no preference/list reads, while a Dim change refreshes only its owner',async()=>{
  const core=server(),a=device(core);await a.ready;let count=core.calls.filter(x=>x.name==='rail_dimming').length;
  core.changes.push({actor:'reader',seq:0,resource_kind:'yours',resource_id:'unrelated',version:1});await a.sync.retry();
  assert.equal(core.calls.filter(x=>x.name==='rail_dimming').length,count);
  const changed=freshDimming();changed.selected=2;await core.other('reader',changed);await a.sync.retry();
  assert.equal(a.choices.selected,2);assert.equal(core.calls.filter(x=>x.name==='rail_dimming').length,count+1);
  assert.equal(core.calls.some(x=>x.name&&!['rail_dimming','changes'].includes(x.name)),false);
});
test('1004 old actor responses are fenced; refused cache stays usable and never claims an offline copy',async()=>{
  const core=server(),api=core.api('reader'),gate=deferred();
  const slow={async view(name,args){const r=await api.view(name,args);if(name==='rail_dimming')await gate.promise;return r;},command:api.command};
  const a=device(core,'reader',storage(),slow);await turn();await a.sync.connect({api:core.api('different'),bootstrap:bootstrap('different')});
  gate.resolve();await a.ready;assert.equal(a.choices.selected,0);assert.equal(a.sync.bootstrap.actor,'different');
  const denied={getItem(){throw Error('denied');},setItem(){throw Error('full');}},b=device(core,'reader',denied);await b.ready;
  b.choices.toggle('w');await b.sync.idle();assert.equal(b.choices.dimmed('w'),true);assert.equal(b.choices.kept,false);assert.match(b.sync.status,/keep|full/);
});
test('1004 replacement authority reads its own revision and preserves older unknown writes without republishing them',async()=>{
  const old=server(),s=storage(),api=old.api('reader');let offline=false;
  const a=device(old,'reader',s,{view:api.view,async command(e){if(offline)throw Error('offline');return api.command(e);}});await a.ready;
  a.choices.select(1);await a.sync.idle();a.choices.select(2);await a.sync.idle();
  offline=true;a.choices.toggle('w','pending');await a.sync.idle();const original=clone(a.sync.pending.envelope);
  const replacement=actor=>({...bootstrap(actor),authority:{authority_id:'replacement-authority',authority_epoch:'replacement-epoch'}});
  const restored=server(replacement);
  await a.sync.connect({api:restored.api('reader'),bootstrap:replacement('reader')});
  assert.equal(a.sync.confirmed.dim_revision,0);assert.equal(a.choices.selected,0);
  assert.equal(restored.calls.some(x=>x.envelope),false);
  assert.ok([...s.rows].some(([key,raw])=>key.startsWith('aim-next.rail-dimming.pending.v1:')&&raw.includes(original.operation_id)), 'old uncertain request is preserved under its original authority');
});
test('1004 two tabs keep independent durable queues; reopening recovers both exact operations',async()=>{
  const core=server(),browser=storage(),api=core.api('reader');
  const offline={view:api.view,async command(){throw Error('offline');}};
  const a=device(core,'reader',browser,offline),b=device(core,'reader',browser,offline);await Promise.all([a.ready,b.ready]);
  a.choices.toggle('w','a');b.choices.toggle('w','b');await Promise.all([a.sync.idle(),b.sync.idle()]);
  const rows=[...browser.rows].filter(([k])=>k.startsWith('aim-next.rail-dimming.pending.v1:')).map(([,v])=>JSON.parse(v));
  assert.equal(rows.length,2);const pendingA=rows[0].snapshot.prepared[0].envelope,pendingB=rows[1].snapshot.prepared[0].envelope;
  assert.notEqual(pendingA.operation_id,pendingB.operation_id);assert.equal(JSON.parse(browser.getItem(dimCacheKey('scratch-1004','reader',bootstrap('reader').authority))).pending,undefined);
  a.sync.disconnect();b.sync.disconnect();
  const restoredB=device(core,'reader',browser,api);await restoredB.ready;
  assert.deepEqual(core.calls.find(x=>x.envelope?.operation_id===pendingA.operation_id).envelope,pendingA);
  assert.deepEqual(core.calls.find(x=>x.envelope?.operation_id===pendingB.operation_id).envelope,pendingB);
  assert.equal(restoredB.choices.dimmed('w','a'),true);assert.equal(restoredB.choices.dimmed('w','b'),true);
});
test('1004 interrupted journal transfer preserves duplicate copies and publishes nothing until exact recovery',async()=>{
  const core=server(),s=storage(),api=core.api('reader');
  const offline={view:api.view,async command(){throw Error('offline');}};
  const a=device(core,'reader',s,offline),other=device(core,'reader',s,offline);await Promise.all([a.ready,other.ready]);
  a.choices.toggle('w','a');other.choices.toggle('w','b');await Promise.all([a.sync.idle(),other.sync.idle()]);
  const original=clone(a.sync.pending.envelope);a.sync.disconnect();other.sync.disconnect();
  const remove=s.removeItem;let fail=true;s.removeItem=key=>{if(fail&&key.startsWith('aim-next.rail-dimming.pending.v1:'))throw Error('interrupted transfer');remove(key);};
  const b=device(core,'reader',s,api);await b.ready;assert.equal(core.states.has('reader'),false);assert.ok([...s.rows.keys()].filter(k=>k.startsWith('aim-next.rail-dimming.pending.v1:')).length>=2);
  fail=false;await b.sync.retry();assert.equal(core.states.get('reader').dim_revision,2);
  assert.deepEqual(core.calls.find(x=>x.envelope?.operation_id===original.operation_id).envelope,original);assert.equal(b.choices.dimmed('w','a'),true);assert.equal(b.choices.dimmed('w','b'),true);
});
test('1004 one abandoned journal recovers in place when quota cannot hold a second full copy',async()=>{
  const core=server(),s=storage(),api=core.api('reader');
  const a=device(core,'reader',s,{view:api.view,async command(){throw Error('offline');}});await a.ready;
  a.choices.toggle('w','a');await a.sync.idle();const original=clone(a.sync.pending.envelope);a.sync.disconnect();
  const set=s.setItem,prefix='aim-next.rail-dimming.pending.v1:';
  s.setItem=(key,raw)=>{if(key.startsWith(prefix)&&!s.rows.has(key)&&[...s.rows.keys()].some(k=>k.startsWith(prefix)))throw Error('quota: no room for duplicate');set(key,raw);};
  const b=device(core,'reader',s,api);await b.ready;
  assert.equal(core.states.get('reader')?.dim_revision,1);assert.equal(b.choices.dimmed('w','a'),true);
  assert.deepEqual(core.calls.find(x=>x.envelope).envelope,original);
});
test('1004 a crash after receipt before journal cleanup retries the old operation without reverting newer Core',async()=>{
  const core=server(),s=storage(),api=core.api('reader'),remove=s.removeItem;let refuse=false;
  s.removeItem=key=>{if(refuse&&key.startsWith('aim-next.rail-dimming.pending.v1:'))throw Error('cleanup unavailable');remove(key);};
  const a=device(core,'reader',s,{view:api.view,async command(e){const r=await api.command(e);refuse=true;return r;}});await a.ready;
  a.choices.toggle('w');await a.sync.idle();const envelope=clone(core.calls.find(x=>x.envelope).envelope);a.sync.disconnect();
  const later=freshDimming();later.selected=2;await core.other('reader',later);refuse=false;
  const b=device(core,'reader',s,api);await b.ready;assert.equal(core.states.get('reader').dim_revision,2);assert.equal(b.choices.selected,2);
  const replay=core.calls.filter(x=>x.envelope?.operation_id===envelope.operation_id);assert.equal(replay.length,2);assert.deepEqual(replay[1].envelope,envelope);
});
test('1004 unreadable receipts retain the exact request instead of treating them as a refusal',async()=>{
  const core=server(),api=core.api('reader');let bad=true;
  const a=device(core,'reader',storage(),{view:api.view,async command(e){return bad?{instance_id:e.instance_id,operation_id:e.operation_id,kind:e.kind,recorded:true,status:'unexpected'}:api.command(e);}});
  await a.ready;a.choices.toggle('w');await a.sync.idle();const held=clone(a.sync.pending.envelope);
  assert.match(a.sync.status,/unreadable/);assert.equal(a.choices.dimmed('w'),true);assert.equal(core.states.has('reader'),false);
  bad=false;await a.sync.retry();assert.deepEqual(core.calls.find(x=>x.envelope).envelope,held);assert.equal(a.choices.kept,true);
});
test('1004 a definite validation refusal without a ledger record rolls back only its own edits',async()=>{
  const core=server(),api=core.api('reader'),gate=deferred();let first=true;
  const invalid={view:api.view,async command(e){if(first){first=false;await gate.promise;return {instance_id:e.instance_id,operation_id:e.operation_id,kind:e.kind,recorded:false,status:'rejected',error:{code:'INVALID_ARGUMENT',message:'Input exceeds the command envelope limit'}};}return api.command(e);}};
  const a=device(core,'reader',storage(),invalid);await a.ready;a.choices.toggle('w','a');await turn();a.choices.toggle('w','b');
  gate.resolve();await a.sync.idle();
  assert.equal(a.choices.dimmed('w','a'),false);assert.equal(a.choices.dimmed('w','b'),true);
  assert.equal(core.states.get('reader')?.dim_revision,1);assert.equal(a.sync.pending,null);
});
test('15008 legacy import drops revoked places once and retires its exact973 key when Core owns the choice',async()=>{
  const core=server(),api=core.api('reader'),s=storage(),legacy=freshDimming();legacy.selected=2;
  legacy.sets[1]={focus:['gone',null],outcomes:[['gone',true]],topics:[['w','allowed',true],['w','revoked',true]]};
  const key=dimmingKey('scratch-1004','reader');s.setItem(key,JSON.stringify(legacy));
  const pruned=freshDimming();pruned.selected=2;pruned.sets[1].topics=[['w','allowed',true]];
  const filtered={async view(name,args){const r=await api.view(name,args);if(name==='rail_dimming'&&args.candidate)return {...r,candidate:clone(pruned)};return r;},async command(e){
    if(JSON.stringify(e.args.value).includes('revoked')||JSON.stringify(e.args.value).includes('gone'))return {instance_id:e.instance_id,operation_id:e.operation_id,kind:e.kind,status:'rejected',recorded:true,error:{code:'FORBIDDEN',message:'One old place is unreadable'}};
    return api.command(e);
  }};
  const a=device(core,'reader',s,filtered);await a.ready;
  assert.deepEqual(core.states.get('reader')?.value,pruned);assert.equal(s.getItem(key),null);
  assert.equal(core.calls.filter(x=>x.envelope).length,1);
  const stale=storage();stale.setItem(key,JSON.stringify(legacy));const b=device(core,'reader',stale,filtered);await b.ready;
  assert.deepEqual(b.choices.value,pruned);assert.equal(stale.getItem(key),null);assert.equal(core.calls.filter(x=>x.envelope).length,1);
});
test('15008 a click during the initial Core read keeps the legacy set and its newer explicit edit',async()=>{
  const core=server(),api=core.api('reader'),s=storage(),legacy=new DimChoices(s),gate=deferred();legacy.bind('scratch-1004','reader');legacy.toggle('w','old');
  let first=true;const slow={command:api.command,async view(name,args){const r=await api.view(name,args);if(name==='rail_dimming'&&first){first=false;await gate.promise;}return r;}};
  const a=device(core,'reader',s,slow);await turn();a.choices.toggle('w','new');gate.resolve();await a.ready;await a.sync.idle();
  assert.equal(a.choices.dimmed('w','old'),true);assert.equal(a.choices.dimmed('w','new'),true);
  assert.deepEqual(core.states.get('reader').value.sets[0].topics,[['w','old',true],['w','new',true]]);
});
test('15008 malformed and foreign-version writer rows remain untouched and unlocked while good saves continue',async()=>{
  const core=server(),s=storage(),b=bootstrap('reader'),scope=JSON.stringify([b.instance_id,b.actor,b.authority.authority_id,b.authority.authority_epoch]);
  const prefix='aim-next.rail-dimming.pending.v1:'+scope+':';
  const bad=[['bad-json','{'],['foreign-version',JSON.stringify({version:2,scope,writer:'foreign-version',saved_ms:1,snapshot:{}})],['bad-snapshot',JSON.stringify({version:1,scope,writer:'bad-snapshot',saved_ms:1,snapshot:{version:1,intents:'unreadable',prepared:[]}})]];
  for(const [name,raw]of bad)s.setItem(prefix+name,raw);
  const a=device(core,'reader',s);await a.ready;a.choices.select(2);await a.sync.idle();
  assert.equal(core.states.get('reader')?.value.selected,2);
  for(const [name,raw]of bad){assert.equal(s.getItem(prefix+name),raw);await locksFor(s).request('aim-next-dim-writer:'+prefix+name,{ifAvailable:true},lock=>assert.ok(lock,'bad row lock is released'));}
});
test('15008 a successful journal save clears the previous failure for later pending edits',async()=>{
  const core=server(),s=storage(),api=core.api('reader'),set=s.setItem,gate=deferred();let fail=false,commands=0;
  s.setItem=(key,raw)=>{if(fail&&key.startsWith('aim-next.rail-dimming.pending.v1:'))throw Error('quota-test');set(key,raw);};
  const a=device(core,'reader',s,{view:api.view,async command(e){const r=await api.command(e);if(++commands===2)await gate.promise;return r;}});await a.ready;
  fail=true;a.choices.select(1);await a.sync.idle();assert.match(a.sync.status,/quota-test/);
  fail=false;await a.sync.retry();assert.equal(a.sync.journalError,null);
  a.choices.toggle('w','a');await turn();assert.doesNotMatch(a.sync.status,/quota-test/);gate.resolve();await a.sync.idle();
});
test('15008 a known own Dim revision causes no preference reread or repaint; a newer device revision does',async()=>{
  const core=server();let paints=0;const a=device(core,'reader',storage(),core.api('reader'),{changed:()=>paints++});await a.ready;
  a.choices.select(2);await a.sync.idle();core.calls.length=0;const painted=paints;await a.sync.retry();
  assert.deepEqual(core.calls.map(x=>x.name),['changes']);assert.equal(paints,painted);
  const other=freshDimming();other.selected=1;await core.other('reader',other);core.calls.length=0;await a.sync.retry();
  assert.deepEqual(core.calls.map(x=>x.name),['changes','rail_dimming']);assert.equal(a.choices.selected,1);
});
