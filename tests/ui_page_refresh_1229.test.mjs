import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../web/page-refresh.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const bootstrap={instance_id:'i1',actor:'reader',authority:{authority_id:'a1',authority_epoch:'e1'},limits:{page_max:100}};
const cursor=(scope,seq=1)=>({v:1,kind:'checkpoint',instance_id:'i1',actor_id:'reader',authority_id:'a1',authority_epoch:'e1',scope,after_seq:seq});
const topic={kind:'topic',id:'open'},actor={kind:'actor',id:'reader'};
const timers=()=>({calls:[],setTimeout(fn,ms){this.calls.push({fn,ms});return this.calls.length;},clearTimeout(){}});
function answer(windows,seq=2){return {instance_id:'i1',windows:windows.map(({scope,cursor:input})=>({instance_id:'i1',scope,baseline:!input,items:[],has_more:false,continuation:null,checkpoint:cursor(scope,seq),covered_versions:scope.kind==='actor'?{}:{[scope.kind]:1,notebook:0}})),topics:[],counts:[]};}
function setup(extra={}){
  assert.equal(typeof module.PageRefresh,'function','the shared bounded page-refresh owner exists');
  const calls=[],published=[],clock=timers(),failed=[];
  const feed=new module.PageRefresh({bootstrap,topicId:'open',workspaceId:'w1',checkpoint:cursor(topic),actorCheckpoint:cursor(actor),timers:clock,
    api:{async view(name,args){calls.push({name,args});return answer(args.windows,2);}},publish:batch=>{published.push(batch);},failed:x=>failed.push(x),...extra});
  return {feed,calls,published,clock,failed};
}
test('one unrelated change shares one bounded read across topic actor and visible outcome scopes',async()=>{
  const {feed,calls,published}=setup({workspaces:()=>['w1','w2','w2']});
  const listeners=[];feed.listen(batch=>listeners.push(batch));
  await feed.request();
  assert.equal(calls.length,1);assert.equal(calls[0].name,'changes');
  assert.deepEqual(calls[0].args.windows.map(x=>x.scope),[actor,topic,{kind:'workspace',id:'w1'},{kind:'workspace',id:'w2'}]);
  assert.equal(published.length,1);assert.equal(listeners[0],published[0]);feed.dispose();
});
test('a failed resource keeps every original frontier and retries in a later bounded pass',async()=>{
  let refuse=true;const {feed,calls,clock}=setup({publish:()=>!refuse});
  await feed.request();assert.equal(calls.length,1);assert.equal(clock.calls.length,1);assert.equal(clock.calls[0].ms,1000);
  refuse=false;await feed.request();
  assert.deepEqual(calls[1].args.windows,calls[0].args.windows);
  await feed.request();assert.equal(calls[2].args.windows[0].cursor.after_seq,2);feed.dispose();
});
test('multiple commits during a held read coalesce without losing the later read',async()=>{
  let release;const held=new Promise(resolve=>{release=resolve;});let count=0;
  const {feed}=setup({api:{async view(name,args){if(++count===1)await held;return answer(args.windows,count+1);}}});
  const first=feed.request();feed.request();feed.request();release();await first;
  assert.equal(count,2);feed.dispose();
});
test('a retired page cannot publish or accept a delayed answer',async()=>{
  let release;const held=new Promise(resolve=>{release=resolve;});let entered;
  const started=new Promise(resolve=>{entered=resolve;});let painted=0;
  const {feed}=setup({api:{async view(name,args){entered();await held;return answer(args.windows);}},publish:()=>painted++});
  const job=feed.request();await started;feed.dispose();release();await job;assert.equal(painted,0);
});
test('malformed binding or foreign projected rows stop without paint; explicit retry retains the old cursor',async()=>{
  let bad=true;const calls=[];
  const {feed,published,failed}=setup({api:{async view(name,args){calls.push(args);const result=answer(args.windows);if(bad)result.topics=[{id:'foreign',workspace_id:'private'}];return result;}}});
  await feed.request();assert.equal(published.length,0);assert.equal(failed[0].kind,'diagnostic');
  await feed.request();assert.equal(calls.length,1);
  bad=false;await feed.request(true);assert.deepEqual(calls[1].windows,calls[0].windows);feed.dispose();
});
test('hidden work catches up from the original frontier after becoming visible',async()=>{
  let visible=false;const {feed,calls}=setup({visible:()=>visible});
  await feed.request();assert.equal(calls.length,0);visible=true;await feed.request();
  assert.equal(calls[0].args.windows[0].cursor.after_seq,1);feed.dispose();
});
test('topic publication completes before rail listeners use its current version',async()=>{
  const order=[];const {feed}=setup({publish:async()=>{order.push('feed');await Promise.resolve();order.push('version');}});
  feed.listen(()=>order.push('rail'));await feed.request();assert.deepEqual(order,['feed','version','rail']);feed.dispose();
});

for(const [code,kind] of [['AUTHORITY_CHANGED','authority'],['FORBIDDEN','forbidden'],['SESSION_REQUIRED','reconnect'],['INVALID_ARGUMENT','diagnostic']]){
  test(`a deferred changes read retains its typed ${code} cause and stops its frontier`,async()=>{
    const error=Object.assign(Error('deferred typed refusal'),{code:'CLEANUP_DEFERRED',cause:Object.assign(Error(code),{code,status:503})});
    const {feed,calls,published,failed,clock}=setup({read:async()=>{throw error;}});
    await feed.request();assert.equal(failed[0].kind,kind);assert.equal(feed.stopped,true);assert.equal(published.length,0);assert.equal(clock.calls.length,0);
    assert.equal(feed.cursors.get('actor:reader').after_seq,1);feed.dispose();
  });
}

test('a visible outcome peek keeps last truth, retries without a new commit and retires its timer on hide',async()=>{
  const {LightPeek}=await import('../web/outcome-light.mjs');
  const jobs=new Map();let id=0,reads=0;const old={light:{light:'quiet'}},next={light:{light:'waiting'}};
  const peek=Object.assign(Object.create(LightPeek.prototype),{link:{lightItem:{id:'w1'}},host:{hidden:false,replaceChildren(){}},answer:old,serial:0,retryTimer:null,failures:0,
    timers:{setTimeout(fn,ms){jobs.set(++id,{fn,ms});return id;},clearTimeout(id){jobs.delete(id);}},
    async read(){if(++reads===1)throw Object.assign(Error('busy'),{code:'SERVER_BUSY'});return next;},paint(){}});
  await peek.refresh();assert.equal(peek.answer,old);assert.equal(jobs.size,1);
  const [key,job]=[...jobs][0];jobs.delete(key);assert.equal(job.ms,500);await job.fn();await Promise.resolve();
  assert.equal(reads,2);assert.equal(peek.answer,next);
  peek.read=async()=>{throw Object.assign(Error('busy'),{code:'SERVER_BUSY'});};await peek.refresh();assert.equal(jobs.size,1);
  peek.hide();assert.equal(jobs.size,0);assert.equal(peek.link,null);
});
