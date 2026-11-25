import test from 'node:test';
import assert from 'node:assert/strict';
import { OutlineRail } from '../web/outline-rail.mjs';
import { OutlineDossiers } from '../web/outline-dossiers.mjs';
let owner;
try { owner = await import('../web/sidebar-refresh.mjs'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const bootstrap = { instance_id:'fixture', actor:'reader', authority:{authority_id:'a',authority_epoch:'e'}, transport:{read_admission:{
  version:1,header:'X-AIM-Read-Class',foreground:{slots:1,max_waiters:8,queue_timeout_ms:5000},background:{slots:1,max_waiters:2,queue_timeout_ms:500}}} };
const page = (scope, cursor, items=[], seq=0, more=false) => {
  const versions=scope.kind==='actor'?{}:{[scope.kind]:1,notebook:0};
  return {instance_id:'fixture',scope,baseline:!cursor,items,has_more:more,
    continuation:more?{v:1,kind:'continuation',instance_id:'fixture',authority_id:'a',authority_epoch:'e',actor_id:'reader',scope,after_seq:seq,through_seq:seq+1,covered_versions:versions}:null,
    checkpoint:more?null:{v:1,kind:'checkpoint',instance_id:'fixture',authority_id:'a',authority_epoch:'e',actor_id:'reader',scope,after_seq:seq},covered_versions:more?null:versions};
};
const context = () => ({scopes:[{kind:'workspace',id:'w'}],topics:new Map([['t','w'],['other','w2']]),starredTopics:new Set(['t']),pages:new Map([['t',new Set(['n'])]])});
const key = (kind,id='t',seq=1) => ({seq,resource_kind:kind,resource_id:id,version:1});
const flush = async () => { for(let n=0;n<6;n++) await new Promise(setImmediate); };

function railFixture() {
  let listen, head=0, changes=[], okay=true;
  const calls=[], loads=[];
  const subject=Object.create(OutlineRail.prototype);
  Object.defineProperty(subject,'phone',{value:false});
  Object.assign(subject,{run:1,outcomes:new Map(),doc:{visibilityState:'visible',getElementById:()=>null},
    dimming:{bind(){}},opened:{read(){}},initialize(){},paint(){},changeContext:context,
    reload:async dirty=>{loads.push(dirty);return okay;}});
  const handles={bootstrap,api:{},route:{kind:'topic'},workspaceId:'w',topic:{id:'t',workspace_id:'w'},
    live:{outcomes:'first',listen:fn=>{listen=fn;return()=>{};}},
    view:async(name,args,lane)=>{calls.push({name,args,lane});return page(args.scope,args.cursor,args.cursor?changes.filter(item=>item.scope===args.scope.kind&&item.seq>args.cursor.after_seq).map(({scope,...item})=>item):[],head);}};
  subject.ready(handles);
  return {subject,loads,calls,emit:event=>listen(event),set(items,seq=1){head=seq;changes=items;},okay(value){okay=value;}};
}

test('topic Live private writing commits do not reload any sidebar projection; reconnect does',async()=>{
  const f=railFixture();await flush();assert.equal(f.loads.length,1);f.loads.length=0;f.calls.length=0;
  f.set([ {...key('draft','d'),scope:'actor'}, {...key('submission','s',2),scope:'actor'} ],2);
  f.emit({kind:'commit',outcomes:'first'});await flush();
  assert.equal(f.loads.length,0,'private send protocol work must not reread topics/stars/pages/counts');
  assert.deepEqual(f.calls.map(c=>[c.name,c.args.scope.kind,c.lane]),[['changes','actor','background'],['changes','workspace','background']]);
  f.emit({kind:'state',state:'live'});await flush();assert.equal(f.loads.length,1);assert.equal(f.loads[0],null);
});

test('an actual topic change selects its workspace and only already-starred dossier projections',async()=>{
  const f=railFixture();await flush();f.loads.length=0;
  f.set([{...key('topic'),scope:'workspace'}]);f.emit({kind:'commit',outcomes:'first'});await flush();
  assert.equal(f.loads.length,1);const dirty=f.loads[0];
  assert.deepEqual([...dirty].sort(),['counts','stars','topics']);
  assert.deepEqual([...dirty.topicWorkspaces],['w']);assert.deepEqual([...dirty.starTopics],['t']);assert.equal(dirty.has('pages'),false);
});

test('failed selected views retain their checkpoint, and a retired run publishes no selection',async()=>{
  const f=railFixture();await flush();f.loads.length=0;f.okay(false);
  f.set([{...key('acts'),scope:'actor'}]);f.emit({kind:'commit'});await flush();
  f.okay(true);f.emit({kind:'commit'});await flush();
  assert.equal(f.loads.length,2);assert.ok(f.loads.every(d=>d.has('stars')));
  assert.deepEqual(f.calls.filter(c=>c.args.scope.kind==='actor'&&c.args.cursor).map(c=>c.args.cursor.after_seq),[0,0]);
  f.subject.run++;f.loads.length=0;f.emit({kind:'commit'});await flush();assert.equal(f.loads.length,0);
});

test('scoped Notebook/private star changes and opaque outcome keys preserve exact owners',async()=>{
  assert.ok(owner,'sidebar change owner exists');
  const ctx=context();
  for(const [scope,kind,id,wanted] of [['actor','acts','other',['counts','stars']],['actor','memory_star','new-page',['pages']],['actor','memory_read','n',['pages']],['topic','memory','n',['pages']],['workspace','workspace','w',['counts','outcomes','pages','stars','topics']]]) {
    const dirty=owner.sidebarInvalidation([{scope:{kind:scope,id:scope==='workspace'?'w':'t'},items:[key(kind,id)]}],ctx);
    assert.deepEqual([...dirty].sort(),wanted);
  }
  let head=0;const changes=new owner.SidebarChanges({bootstrap,current:()=>true,context,outcomesKey:'a',read:async(_name,args)=>page(args.scope,args.cursor,[],head)});
  (await changes.next()).accept();changes.observe({outcomes:'b'});head=1;
  const first=await changes.next();assert.deepEqual([...first.dirty],['outcomes']);
  assert.deepEqual([...(await changes.next()).dirty],['outcomes']);first.accept();assert.equal((await changes.next()).dirty.size,0);
});

test('continuation failure and foreign binding cannot advance a sidebar checkpoint',async()=>{
  assert.ok(owner,'sidebar change owner exists');let broken=false,foreign=false;
  const changes=new owner.SidebarChanges({bootstrap,current:()=>true,context,read:async(_name,args)=>{
    if(broken&&args.cursor?.kind==='continuation')throw Error('lost continuation');
    const answer=page(args.scope,args.cursor,args.cursor?[key('draft')]:[],args.cursor?1:0,broken&&args.cursor?.kind==='checkpoint');
    if(foreign)answer.checkpoint.actor_id='elsewhere';return answer;
  }});
  (await changes.next()).accept();broken=true;await assert.rejects(changes.next(),/lost continuation/);
  assert.equal([...changes.cursors.values()][0].after_seq,0);
  broken=false;foreign=true;await assert.rejects(changes.next(),/different binding or scope/);assert.equal([...changes.cursors.values()][0].after_seq,0);
});

test('reload coalescing keeps target unions and broad callers widen the same projection',()=>{
  assert.ok(owner,'sidebar change owner exists');
  const a=owner.sidebarInvalidation([{scope:{kind:'actor'},items:[key('acts','t')]}],context());
  const b=owner.sidebarInvalidation([{scope:{kind:'actor'},items:[key('acts','other')]}],context());
  const pending=owner.mergeSidebarDirty(owner.mergeSidebarDirty(new Set(),a),b);
  assert.deepEqual([...pending.starTopics],['t','other']);assert.equal(pending.sidebar,true);
  owner.mergeSidebarDirty(pending,new Set(['stars']));assert.equal(pending.starTopics,null);assert.equal(pending.sidebar,false);
});

test('one topic appearing twice shares a single stars or memory_stars request per refresh',async()=>{
  for(const pages of [false,true]) {
    let count=0;const parent=()=>({dataset:{topicId:'t'},getClientRects:()=>[{}],closest:()=>null});
    const f=Object.create(OutlineDossiers.prototype);f.pageStars=pages;f.outline={list:{querySelectorAll:()=>[parent(),parent()]}};
    f.sync=()=>f.parents();f.states=new Map([['t',{id:'t'}]]);f.load=async()=>{count++;return true;};
    assert.deepEqual(await f.refresh(),[true]);assert.equal(count,1);
    count=0;await f.refresh(null,new Set(['other']));assert.equal(count,0,'unaffected topic must not be read');
  }
});

test('actual load reads changed topics/counts without reloading empty stars or Notebook projections',async()=>{
  const calls=[],subject=Object.create(OutlineRail.prototype),ctx=context();
  const handles={bootstrap,route:{kind:'topic'},workspaceId:'w',view:async()=>{throw Error('unexpected projection');}};
  Object.assign(subject,{handles,run:1,outcomesKey:'first',pages:{loaded:new Map(),order:null,next:null},
    dossiers:{states:new Map(),refresh:async()=>{calls.push('stars');return[true];}},notebookStars:{states:new Map(),refresh:async()=>{calls.push('pages');return[true];}},
    paint(){},shownItems:()=>[{id:'w'},{id:'w2'}],isOpen:()=>true,outcome:item=>item,
    loadTopics:async item=>{calls.push('topics:'+item.id);return true;},loadCounts:async()=>calls.push('counts')});
  ctx.starredTopics.clear();const dirty=owner?owner.sidebarInvalidation([{scope:{kind:'workspace',id:'w'},items:[key('topic')]}],ctx):new Set(['topics','counts']);
  await subject.load(dirty);assert.equal(subject.failed,false,String(subject.failed));assert.deepEqual(calls,['counts','topics:w']);
});

test('closed authorized outcomes keep their count scope; direct private topics keep topic scope',()=>{
  const subject=Object.create(OutlineRail.prototype);
  Object.assign(subject,{handles:{route:{kind:'topic'},topic:{id:'direct',workspace_id:'unlisted'}},pages:{loaded:new Map([['w',{}]])},
    outcomes:new Map([['w',{rail:{pages:{items:[{id:'t'}]}}}]]),isOpen:()=>false,dossiers:{states:new Map()},notebookStars:{states:new Map()}});
  assert.equal(typeof subject.changeContext,'function');
  assert.deepEqual(subject.changeContext().scopes,[{kind:'workspace',id:'w'},{kind:'topic',id:'direct'}]);
});

test('opening warms newly discovered scopes before the first unrelated private commit',async()=>{
  const f=railFixture();let discovered=false;
  f.subject.changeContext=()=>({...context(),scopes:discovered?context().scopes:[]});
  f.subject.reload=async dirty=>{f.loads.push(dirty);discovered=true;return true;};
  await flush();assert.equal(discovered,true);assert.equal(f.subject.sidebarChanges.hasNewScopes(),false);
  f.loads.length=0;f.set([{...key('draft','d'),scope:'actor'}]);f.emit({kind:'commit'});await flush();assert.equal(f.loads.length,0);
});

test('shared retained star owners publish the same authorized projection once per topic',async()=>{
  for(const pages of [false,true]) {
    const calls=[],f=Object.create(OutlineDossiers.prototype),parent=()=>({dataset:{topicId:'t'},getClientRects:()=>[{}],closest:()=>null});
    const items=pages?[{topic_id:'t',item_id:'n',star:9,title:'Current page'}]:[{topic_id:'t',star:9,dossier:{id:'m',body:'Current words',unread:2}}];
    const state={id:'t',box:{setAttribute(){}},stars:[],extent:null,next:null,busy:null,loaded:true,visible:true};
    Object.assign(f,{pageStars:pages,epoch:1,states:new Map([['t',state]]),sync(){return this.parents();},paint(){},outline:{handles:{bootstrap},list:{querySelectorAll:()=>[parent(),parent()]},
      read:async(name,args,lane)=>{calls.push({name,args,lane});return {instance_id:'fixture',items:structuredClone(items),next_cursor:null};}}});
    assert.deepEqual(await f.refresh(),[true]);assert.deepEqual(state.stars,items);
    assert.deepEqual(calls,[{name:pages?'memory_stars':'stars',args:{topic_id:'t',limit:50},lane:'foreground'}]);
  }
});

test('resync clears cursors and a new baseline remains owed until its full reads succeed',async()=>{
  assert.ok(owner,'sidebar change owner exists');let resync=false;const calls=[];
  const changes=new owner.SidebarChanges({bootstrap,current:()=>true,context,read:async(_name,args)=>{
    calls.push(args);if(resync)throw Object.assign(Error('resync'),{code:'RESYNC_REQUIRED'});return page(args.scope,args.cursor);
  }});
  (await changes.next()).accept();resync=true;await assert.rejects(changes.next(),/resync/);assert.equal(changes.cursors.size,0);
  resync=false;const baseline=await changes.next();assert.equal(baseline.dirty,null);assert.equal(changes.cursors.size,0);
  baseline.accept();assert.equal(changes.cursors.size,2);assert.ok(calls.slice(-2).every(args=>!args.cursor));
});
