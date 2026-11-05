import { WorkspacePages, routeHref } from './topic-navigation.mjs';

export class OutcomeRail {
  constructor({instanceId,current,host,more,retry,message,empty,read,open,denied}) {
    Object.assign(this,{current,host,more,retry,message,empty,read,open,isDenied:denied});
    this.pages=new WorkspacePages(instanceId);this.loading=null;this.failedMore=false;this.denied=false;
    more.onclick=()=>this.load(true);retry.onclick=()=>this.load(this.failedMore);
    host.addEventListener('touchend',event=>{
      const link=event.target.closest('a[data-workspace-id]'),touch=event.changedTouches?.[0];
      if(!link||!touch)return;
      const b=link.getBoundingClientRect();
      if(touch.clientX<b.left||touch.clientX>b.right||touch.clientY<b.top||touch.clientY>b.bottom)event.preventDefault();
    },{passive:false});
  }
  paint() {
    const items=this.pages.items,ids=new Set(items.map(x=>x.id));
    for(const link of [...this.host.children])if(!ids.has(link.dataset.workspaceId))link.remove();
    items.forEach((item,index)=>{
      let link=[...this.host.children].find(x=>x.dataset.workspaceId===item.id);
      if(!link){
        link=document.createElement('a');link.className='nav-item';link.dataset.workspaceId=item.id;
        link.href=routeHref({kind:'workspace',id:item.id});
        link.onclick=event=>{
          if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
          event.preventDefault();
          const title=this.pages.loaded.get(item.id)?.title;
          return this.open({kind:'workspace',id:item.id},title||item.id);
        };
        link.append(document.createElement('span'),document.createElement('small'));
      }
      link.children[0].textContent=item.title+(item.title_truncated?'…':'');
      link.children[1].textContent=item.id+(item.title_truncated?' · title shortened':'');
      if(item.id===this.current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
      if(this.host.children[index]!==link)this.host.insertBefore(link,this.host.children[index]??null);
    });
    this.host.hidden=this.denied;this.more.hidden=this.denied||this.pages.next===null;
    this.empty.hidden=this.denied||!this.pages.started||items.length>0;
  }
  load(more=false) {
    if(this.loading){
      if(!more&&this.loadingMore){
        if(!this.refreshQueued)this.refreshQueued=this.loading.then(()=>{this.refreshQueued=null;return this.load();});
        return this.refreshQueued;
      }
      return this.loading;
    }
    const cursor=more?this.pages.next:null;
    if(more&&cursor===null)return Promise.resolve();
    const prior=new Set(this.pages.items.map(x=>x.id));
    this.loadingMore=more;
    this.more.setAttribute('aria-disabled','true');this.retry.setAttribute('aria-disabled','true');
    this.loading=this.read({limit:20,...(cursor===null?{}:{cursor})}).then(answer=>{
      const focused=document.activeElement;
      this.pages.accept(answer,cursor);this.denied=false;this.retry.hidden=true;this.message.hidden=true;this.paint();
      if((focused===this.more||focused===this.retry)&&focused.hidden){
        ([...this.host.children].find(x=>!prior.has(x.dataset.workspaceId))??this.host.children[0]??this.empty).focus();
      }
    }).catch(error=>{
      this.denied=this.isDenied(error);this.failedMore=more&&!this.denied;
      this.paint();this.empty.hidden=true;
      this.message.textContent=error.message+' Retry outcomes.';this.message.hidden=false;this.retry.hidden=false;
      if(document.activeElement===this.more&&this.more.hidden)this.retry.focus();
    }).finally(()=>{this.loading=null;this.more.removeAttribute('aria-disabled');this.retry.removeAttribute('aria-disabled');});
    return this.loading;
  }
}
