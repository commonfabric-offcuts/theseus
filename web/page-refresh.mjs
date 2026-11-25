// One read-only change window per topic page. Existing owners keep every
// record, operation, paint and retry; this owner only distributes scoped keys.
import { checkedView, scopedChangesPage, readFailure } from './freshness.mjs';

const keyOf = scope => `${scope.kind}:${scope.id}`;
const copy = structuredClone;
const clocks = { setTimeout:(fn,ms)=>setTimeout(fn,ms), clearTimeout:id=>clearTimeout(id) };
const invalid = () => Object.assign(Error('The page changes could not be confirmed.'), {code:'INVALID_FRESHNESS_VIEW'});

export class PageRefresh {
  constructor({api, bootstrap, topicId, workspaceId, checkpoint, actorCheckpoint, workspaces=()=>[],
    publish, read=work=>work({readClass:'background'}), current=()=>true, failed=()=>{}, visible=()=>true, connected=()=>true, timers=clocks}) {
    Object.assign(this,{api,bootstrap:copy(bootstrap),topicId,workspaceId,workspaces,publish,read,current,failed,visible,connected,timers});
    this.cursors=new Map(); this.listeners=new Set(); this.pending=false; this.force=false; this.running=null; this.timer=null; this.failures=0;
    const first=Math.min(...[checkpoint,actorCheckpoint].filter(Boolean).map(x=>x.after_seq));
    this.seed=checkpoint && Number.isSafeInteger(first) ? {...copy(checkpoint),after_seq:first} : null;
    if(checkpoint)this.cursors.set(keyOf({kind:'topic',id:topicId}),copy(checkpoint));
    if(actorCheckpoint)this.cursors.set(keyOf({kind:'actor',id:bootstrap.actor}),copy(actorCheckpoint));
  }
  listen(fn) { this.listeners.add(fn);return()=>this.listeners.delete(fn); }
  scopes() {
    const spaces=[...new Set([this.workspaceId,...this.workspaces()].filter(Boolean))];
    const scopes=[{kind:'actor',id:this.bootstrap.actor},{kind:'topic',id:this.topicId},...spaces.map(id=>({kind:'workspace',id}))];
    if(scopes.length>(this.bootstrap.limits?.page_max??100))throw invalid();
    return scopes;
  }
  dispose() {this.disposed=true;if(this.timer!==null)this.timers.clearTimeout(this.timer);this.listeners.clear();}
  request(force=false) {
    if(this.stopped&&!force)return Promise.resolve();
    if(force)this.stopped=false;
    this.pending=true;this.force||=force;
    if(this.timer!==null)this.timers.clearTimeout(this.timer);this.timer=null;
    if(this.disposed||!this.current()||!this.visible())return Promise.resolve();
    if(!this.running)this.running=this.drain().finally(()=>{
      this.running=null;
      if(this.disposed||!this.current()||!this.visible())return;
      if(this.pending||!this.connected())this.timer=this.timers.setTimeout(()=>{this.timer=null;this.request();},Math.min(5000,500*2**Math.min(this.failures,4)));
    });
    return this.running;
  }
  async drain() {
    while(this.pending&&!this.disposed&&this.current()&&this.visible()) {
      this.pending=false;const force=this.force;this.force=false;
      try {
        const scopes=this.scopes();
        const windows=scopes.map(scope=>{
          const cursor=this.cursors.get(keyOf(scope))??(this.seed?{...copy(this.seed),scope:copy(scope)}:null);
          return {scope,...(cursor?{cursor}:{})};
        });
        const answer=checkedView(await this.read(options=>this.api.view('changes',{windows,project:true},{...options,readClass:'background'})),this.bootstrap.instance_id);
        if(this.disposed||!this.current())return;
        if(!Array.isArray(answer.windows)||answer.windows.length!==windows.length||!Array.isArray(answer.topics)||!Array.isArray(answer.counts))throw invalid();
        answer.windows.forEach((page,index)=>scopedChangesPage(page,this.bootstrap,windows[index].scope,windows[index].cursor??null));
        const spaces=new Set(scopes.filter(scope=>scope.kind==='workspace').map(scope=>scope.id));
        if(answer.topics.some(item=>typeof item?.id!=='string'||!spaces.has(item.workspace_id))||
          answer.counts.some(item=>!spaces.has(item?.id))||new Set(answer.topics.map(item=>item.id)).size!==answer.topics.length||
          new Set(answer.counts.map(item=>item.id)).size!==answer.counts.length)throw invalid();
        // Publish before accepting frontiers. Any failure replays the exact
        // window; existing version fences make repeated keys idempotent.
        const published=await this.publish(answer,force);
        if(this.disposed||!this.current())return;
        const results=[published,...await Promise.all([...this.listeners].map(fn=>fn(answer,force)))];
        if(this.disposed||!this.current())return;
        if(results.some(x=>x===false))throw Object.assign(Error('Some page updates remain pending.'),{code:'RESOURCE_NOT_CURRENT'});
        for(const page of answer.windows)this.cursors.set(keyOf(page.scope),copy(page.continuation??page.checkpoint));
        this.pending||=answer.windows.some(page=>page.has_more);
        this.failures=0;
      } catch(error) {
        if(this.disposed||!this.current())return;
        const failure=readFailure(error?.code==='CLEANUP_DEFERRED'&&error.cause?error.cause:error);
        if(failure.kind==='resync'){this.cursors.clear();this.seed=null;this.force=true;this.pending=true;}
        else if(['retry','defer','superseded'].includes(failure.kind)){this.pending=true;this.failures++;}
        else {this.pending=false;this.stopped=true;}
        this.failed(failure);return;
      }
    }
  }
}

export function actorItems(batch) {return batch.windows.filter(page=>page.scope.kind==='actor').flatMap(page=>page.items);}
export function topicItems(batch,id) {return batch.windows.filter(page=>page.scope.kind==='topic'&&page.scope.id===id).flatMap(page=>page.items);}
export function workspaceItems(batch,id) {return batch.windows.filter(page=>page.scope.kind==='workspace'&&page.scope.id===id).flatMap(page=>page.items);}
