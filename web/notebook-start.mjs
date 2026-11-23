import { TopicStart, OneLine } from './quick-create.mjs';

// A page/card link is ordinary opening writing, never a fabricated source
// message. The same object keeps the exact request after a lost answer.
export class NotebookLinkStart {
  constructor({api,bootstrap,read,kind,scope,link}) {
    Object.assign(this,{api,bootstrap,read,kind,scope,link});
  }
  async destination() {
    if(this.destinationValue)return this.destinationValue;
    let topicId=this.scope.kind==='topic'?this.scope.id:null,workspace=this.scope.kind==='workspace'?this.scope.id:null;
    if(topicId)workspace=(await this.read('topic',{topic_id:topicId})).topic?.workspace_id;
    else topicId=(await this.read('conversation',{workspace_id:workspace})).conversation?.topic_id;
    if(!workspace||!topicId)throw Error('The page’s topic or outcome could not be confirmed.');
    return this.destinationValue={workspace,topicId};
  }
  async start(title) {
    if(!title.trim())throw Error('Type the first words, then press Return.');
    const destination=await this.destination();
    if(this.kind==='topic') {
      this.topic??=new TopicStart({api:this.api,bootstrap:this.bootstrap,workspace:destination.workspace,body:this.link});
      const id=await this.topic.start(title);return {kind:'topic',id};
    }
    if(this.pending&&this.pending.args.body!==title+'\n\n'+this.link)throw Error('Confirm the earlier writing first. Restore it and press Return again.');
    const {authority_id,authority_epoch}=this.bootstrap.authority;
    this.pending??={v:1,instance_id:this.bootstrap.instance_id,operation_id:crypto.randomUUID(),kind:'message.post',target:{topic_id:destination.topicId},
      expected:{authority:{authority_id,authority_epoch}},args:{body:title+'\n\n'+this.link,attachments:[],addressees:[]}};
    const request=this.pending;let receipt;
    try{receipt=await this.api.command(structuredClone(request));}catch(error){throw Error('Not confirmed. Press Return to try the same writing again.');}
    const exact=receipt?.instance_id===request.instance_id&&receipt.operation_id===request.operation_id&&receipt.kind===request.kind;
    if(!exact||receipt.recorded!==true)throw Error('Not confirmed. Press Return to try the same writing again.');
    if(receipt.status!=='committed'){this.pending=null;throw Error(receipt.error?.message??'The dossier was not started.');}
    const id=receipt.result?.message_id;if(!id)throw Error('The dossier’s opening could not be confirmed.');
    return {kind:'topic',id:destination.topicId,message:id};
  }
}

// This line lives beside the page's notice, or in the Reader. Closing it
// keeps its controller/writing for the next opening; it never borrows or
// overwrites the current message composer.
export class NotebookStarts {
  constructor({api,bootstrap,read,open}) {Object.assign(this,{api,bootstrap,read,open});this.lines=new Map();}
  show({kind,source,link,host,anchor,current=()=>true}) {
    const key=kind+':'+link;let line=this.lines.get(key);
    if(!line) {
      const job=new NotebookLinkStart({api:this.api,bootstrap:this.bootstrap,read:this.read,kind,scope:source.owner_scope,link});
      line=new OneLine({id:'notebook-start-'+crypto.randomUUID(),label:kind==='topic'?'Title of the new topic':'First words of the new dossier',value:source.title??'Notebook page',
        className:'notebook-start-line',submit:async title=>{
          const target=await job.start(title);this.lines.delete(key);line.root.remove();if(line.current())await this.open(target,title);
        }});
      this.lines.set(key,line);
    }
    line.current=current;
    line.cancel=()=>{line.root.remove();if(anchor?.isConnected!==false)anchor?.focus();};
    const close=host.ownerDocument.createElement('button');close.type='button';close.textContent='Cancel';close.onclick=line.cancel;
    line.root.querySelector('button')?.remove();line.root.append(close);host.append(line.root);line.focus();return line;
  }
}
