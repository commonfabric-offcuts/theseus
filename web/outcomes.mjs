import { WorkspacePages, routeHref, paintUnread, reread, PAGE } from './topic-navigation.mjs';
import { paintRowLight } from './outcome-light.mjs';

export class OutcomeRail {
  // peek, when given, opens what a row's light is made of (outcome-light.mjs);
  // painted hears the rows after every read, so a line that counts them
  // agrees, and null when they could not be read, so it shows no stale rows.
  // opens: what a press on an outcome opens, its page ('workspace') or, on the
  // Outcomes home, its Conversation ('conversation'; its page while it has none).
  constructor({instanceId,current,host,more,retry,message,empty,read,open,denied,pageMax=PAGE,peek=null,painted=()=>{},opens='workspace'}) {
    Object.assign(this,{current,host,more,retry,message,empty,open,isDenied:denied,pageMax,peek,painted,opens});
    // Reached outcomes fold into one "Reached (N)" line at the end of the list, which opens them (D42).
    this.reachedCount=0;
    this.read=async args=>{const answer=await read(args);this.reachedCount=Number.isSafeInteger(answer?.reached_count)?answer.reached_count:0;return answer;};
    this.reached=document.createElement('details');this.reached.className='reached-outcomes';this.reached.hidden=true;
    const summary=document.createElement('summary'),list=document.createElement('div');this.reached.append(summary,list);this.reachedLine=summary;
    this.reached.ontoggle=()=>{
      if(!this.reached.open)return;
      list.textContent='Reading…';
      read({reached:true,limit:PAGE}).then(answer=>{list.replaceChildren(...answer.items.map(item=>{
        const link=document.createElement('a');link.className='nav-item';link.href=routeHref(this.target(item));
        const name=document.createElement('span'),when=document.createElement('small');name.textContent=item.title;
        when.textContent=item.reached_ms?'Reached '+new Date(item.reached_ms).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'Reached';
        link.append(name,when);if(item.id===this.current)link.setAttribute('aria-current','page');return link;}));
      }).catch(error=>{list.textContent=error.message;});
    };
    more.after(this.reached);
    this.pages=new WorkspacePages(instanceId);this.loading=null;this.queued=null;this.failedMore=false;this.denied=false;
    more.onclick=()=>this.load(true);retry.onclick=()=>this.load(this.failedMore);
    host.addEventListener('touchend',event=>{
      const link=event.target.closest('a[data-workspace-id]'),touch=event.changedTouches?.[0];
      if(!link||!touch)return;
      const b=link.getBoundingClientRect();
      if(touch.clientX<b.left||touch.clientX>b.right||touch.clientY<b.top||touch.clientY>b.bottom)event.preventDefault();
    },{passive:false});
  }
  // Where a press on an outcome goes (opens).
  target(item) {
    return this.opens==='conversation'&&typeof item.conversation_id==='string'?{kind:'conversation',id:item.id}:{kind:'workspace',id:item.id};
  }
  paint() {
    const items=this.pages.items,ids=new Set(items.map(x=>x.id));
    for(const link of [...this.host.children])if(!ids.has(link.dataset.workspaceId))link.remove();
    items.forEach((item,index)=>{
      let link=[...this.host.children].find(x=>x.dataset.workspaceId===item.id);
      if(!link){
        link=document.createElement('a');link.className='nav-item';link.dataset.workspaceId=item.id;
        link.onclick=event=>{
          if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
          event.preventDefault();
          const loaded=this.pages.loaded.get(item.id)??item;
          return this.open(this.target(loaded),loaded.title||item.id);
        };
        link.append(document.createElement('span'),document.createElement('small'));
      }
      link.href=routeHref(this.target(item));
      link.children[0].textContent=item.title+(item.title_truncated?'…':'');
      // The grey line carries where the outcome stands (item 86); the id stays at the top of its own page.
      paintRowLight(link.children[1],item.light);
      if(item.title_truncated)link.children[1].append(' · title shortened');
      this.peek?.attach(link,item);
      paintUnread(link.children[0],item);
      if(item.id===this.current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
      if(this.host.children[index]!==link)this.host.insertBefore(link,this.host.children[index]??null);
    });
    this.host.hidden=this.denied;this.more.hidden=this.denied||this.pages.next===null;
    this.reached.hidden=this.denied||!this.reachedCount;this.reachedLine.textContent=`Reached (${this.reachedCount})`;
    this.empty.hidden=this.denied||!this.pages.started||items.length>0;
    this.peek?.refresh();
  }
  // As TopicRail.load: a More shares a running read, a reload runs once more
  // after it, and a reload reads again every page the reader has loaded.
  load(more=false) {
    if(this.loading){
      if(more)return this.loading;
      this.queued??=this.loading.then(()=>{this.queued=null;return this.load();});
      return this.queued;
    }
    const cursor=more?this.pages.next:null;
    if(more&&cursor===null)return Promise.resolve(true);
    const prior=new Set(this.pages.items.map(x=>x.id));
    this.more.setAttribute('aria-disabled','true');this.retry.setAttribute('aria-disabled','true');
    this.loading=(more?this.read({limit:PAGE,cursor}).then(answer=>{this.pages.accept(answer,cursor);}):reread(this.pages,this.read,this.pageMax)).then(()=>{
      const focused=document.activeElement;
      this.denied=false;this.retry.hidden=true;this.message.hidden=true;this.paint();this.painted(this.pages.items);
      if((focused===this.more||focused===this.retry)&&focused.hidden){
        ([...this.host.children].find(x=>!prior.has(x.dataset.workspaceId))??this.host.children[0]??this.empty).focus();
      }
      return true;
    }).catch(error=>{
      this.denied=this.isDenied(error);this.failedMore=more&&!this.denied;
      this.paint();this.empty.hidden=true;this.painted(null);
      this.message.textContent=error.message+' Retry outcomes.';this.message.hidden=false;this.retry.hidden=false;
      if(document.activeElement===this.more&&this.more.hidden)this.retry.focus();
      return false;
    }).finally(()=>{this.loading=null;this.more.removeAttribute('aria-disabled');this.retry.removeAttribute('aria-disabled');});
    return this.loading;
  }
}
