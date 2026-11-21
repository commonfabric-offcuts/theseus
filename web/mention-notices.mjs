import { checkedView, readFailure } from './freshness.mjs';

const pair = value => ({authority_id:value?.authority_id,authority_epoch:value?.authority_epoch});
const same = (a,b) => a?.authority_id === b?.authority_id && a?.authority_epoch === b?.authority_epoch;
const element = (doc,tag,text) => { const node=doc.createElement(tag); if(text!==undefined)node.textContent=text; return node; };

// Advice after durable publication, shared by every EditorRegistry composer.
// This owner never sends a message or changes the editor/confirmation state.
export class MentionNotices {
  constructor({host,api,instanceId,authority,current=()=>true}) {
    Object.assign(this,{host,api,instanceId,authority,current}); this.entries=new Map();
  }
  live(entry) { return !this.disposed && this.current() && same(entry.authority,this.authority()); }
  published(_editor,item) {
    if(this.disposed || !this.current() || item?.status!=='confirmed' || item.detached || item.snapshot?.whisper ||
       item.receipt?.status!=='committed' || !item.receipt?.result?.message_id || !item.snapshot?.body?.includes('@'))return null;
    if(this.entries.has(item.sendOperationId))return this.entries.get(item.sendOperationId).task;
    const entry={id:item.id,operation:item.sendOperationId,message:item.receipt.result.message_id,
      authority:pair(this.authority()),people:new Map(),dismissed:false};
    this.entries.set(item.sendOperationId,entry);
    return this.check(entry);
  }
  check(entry) {
    if(entry.checking || entry.dismissed || !this.live(entry))return entry.task;
    entry.checking=true;
    entry.task=(async()=>{
      try {
        let cursor=0;const people=new Map();
        do {
          const page=checkedView(await this.api.view('submission_mention_reach',
            {submission_id:entry.id,cursor,limit:32},{readClass:'background'}),this.instanceId);
          if(!this.live(entry) || entry.dismissed)return;
          if(page.message_id!==entry.message || !Array.isArray(page.items) || page.items.length>32 ||
             !page.scope || !['topic','outcome'].includes(page.scope.kind) || typeof page.scope.id!=='string' ||
             typeof page.scope.title!=='string' || typeof page.scope.may_add!=='boolean' || !Number.isSafeInteger(page.scope.revision) ||
             page.next_cursor!==null && (!Number.isSafeInteger(page.next_cursor) || page.next_cursor<=cursor))throw Error('The mention check could not be confirmed.');
          for(const person of page.items) {
            if(typeof person.actor_id!=='string' || typeof person.name!=='string' || !['human','agent'].includes(person.kind) || typeof person.may_add!=='boolean')throw Error('The mention check could not be confirmed.');
            people.set(person.actor_id,{...person});
          }
          entry.scope=page.scope;cursor=page.next_cursor;
        }while(cursor!==null);
        entry.people=people;entry.error=false;this.paint(entry);
      } catch(error) {
        if(this.live(entry) && !entry.dismissed){
          if(['retry','defer','resync','superseded'].includes(readFailure(error).kind)){entry.error=true;this.paint(entry);}
          else {entry.dismissed=true;entry.node?.remove();}
        }
      } finally {entry.checking=false;}
    })();
    return entry.task;
  }
  paint(entry) {
    if(!this.live(entry) || entry.dismissed)return;
    if(!entry.error && !entry.people.size){entry.node?.remove();return;}
    const doc=this.host.ownerDocument;
    if(!entry.node){entry.node=element(doc,'div');entry.node.className='notice mention-notice';entry.node.dataset.sendOperation=entry.operation;entry.node.setAttribute('role','status');this.host.append(entry.node);}
    entry.node.replaceChildren();
    const button=(label,action)=>{const node=element(doc,'button',label);node.type='button';node.onclick=action;return node;};
    if(entry.error)entry.node.append(element(doc,'p','Sent. Mention membership could not be checked.'),button('Check again',()=>this.check(entry)));
    else {
      entry.node.append(element(doc,'p',`Sent. These mentions are outside this message’s audience in ${entry.scope.title}:`));
      const list=element(doc,'ul');entry.node.append(list);
      for(const person of entry.people.values()) {
        const row=element(doc,'li'), label=person.name===person.actor_id?`@${person.actor_id}`:`${person.name} (@${person.actor_id})`;
        row.append(element(doc,'span',label));list.append(row);
        if(entry.scope.kind==='outcome' && person.kind==='agent')row.append(element(doc,'p','Team membership does not subscribe an agent to this Conversation. Name them in To on future messages.'));
        if(person.refused)row.append(element(doc,'p',person.refused));
        else if(person.added)row.append(element(doc,'p',`Added to ${entry.scope.kind} · not resent`));
        else if(entry.scope.may_add && person.may_add!==false) {
          const add=button(`Add @${person.actor_id} to ${entry.scope.kind}`,()=>this.add(entry,person,add));
          add.title=`Add to ${entry.scope.kind} for future ${entry.scope.kind==='outcome' && person.kind==='agent'?'addressing':'messages'}. This message will not be resent.`;row.append(add);
        }
      }
    }
    entry.node.append(button('Dismiss',()=>{entry.dismissed=true;entry.node.remove();}));
  }
  async add(entry,person,button) {
    if(!this.live(entry) || entry.dismissed || person.busy || person.added || person.refused)return;
    const scope=entry.scope,outcome=scope.kind==='outcome',field=outcome?'workspace_revision':'topic_revision';
    const make=revision=>({v:1,instance_id:this.instanceId,operation_id:crypto.randomUUID(),
      kind:outcome?'workspace.member_set':'participation.set',target:outcome?{workspace_id:scope.id}:{topic_id:scope.id},
      args:{actor_id:person.actor_id,present:true},expected:{[field]:revision,authority:structuredClone(entry.authority)}});
    person.request??=make(scope.revision);person.busy=true;button.disabled=true;button.textContent='Adding…';
    try {
      let receipt;
      for(let attempt=0;attempt<2;attempt++) {
        if(!this.live(entry))return;
        const request=person.request;
        receipt=await this.api.command(structuredClone(request));
        if(receipt?.instance_id!==this.instanceId || receipt?.operation_id!==request.operation_id)throw Error('The add could not be confirmed.');
        if(!this.live(entry) || entry.dismissed)return;
        if(receipt.status==='committed') {
          if(receipt.result?.actor_id!==person.actor_id || receipt.result?.present!==true ||
             receipt.result?.[outcome?'workspace_id':'topic_id']!==scope.id)throw Error('The add could not be confirmed.');
          person.added=true;person.request=null;button.textContent=`Added to ${scope.kind} · not resent`;return;
        }
        if(receipt.status==='rejected') {
          person.request=null;
          const revision=receipt.error?.code==='REVISION_CONFLICT'?receipt.error.current_versions?.[field]:null;
          if(attempt===0 && Number.isSafeInteger(revision) && revision!==request.expected[field]) {person.request=make(revision);continue;}
          person.refused=receipt.error?.message??'Adding this person was refused.';this.paint(entry);return;
        }
        throw Error('The add could not be confirmed.');
      }
    } catch(error) {
      if(this.live(entry) && !entry.dismissed){button.textContent=person.request?`Check add @${person.actor_id}`:`Try add @${person.actor_id} again`;button.title=error.message;}
    } finally {person.busy=false;if(this.live(entry) && !entry.dismissed)button.disabled=Boolean(person.added || person.refused);}
  }
  dispose(){this.disposed=true;for(const entry of this.entries.values())entry.node?.remove();}
}
