import { same } from './cleanup.mjs';
import { validActorId } from './creation.mjs';

const copy=structuredClone;
const pin=a=>({authority_id:a?.authority_id,authority_epoch:a?.authority_epoch});
const fields=['id','revision','generation','body','attachments','quotes','addressees','opening','reply_to','exchange_id'];
export const sameOpeningDraft=(a,b)=>Boolean(a&&b&&fields.every(k=>same(a[k],b[k])));
export const emptyOpeningDraft=d=>Boolean(d&&!d.body&&!(d.attachments?.length||d.quotes?.length||d.addressees?.length)&&!d.opening&&!d.reply_to&&!d.exchange_id);
const metadata=(d,source)=>d?.opening?.workspace_id===source.workspace_id&&typeof d.opening.title==='string'&&
  Array.isArray(d.opening.participants)&&d.opening.participants.every(validActorId)&&!d.reply_to&&!d.exchange_id;

// Evidence for this private W/O/T only. Each action advances one page, then at
// most three validation reads. Reading evidence never authorizes a replay.
export class OpeningProof {
  constructor(session){this.session=session;this.editor=session.editor;this.mode='fresh';this.items=[];this.cursor=null;this.known=new Set();}
  get source(){return this.editor.context.sourceRef;}
  get topic(){return this.editor.context.topicId;}
  laterLocal(pending=null){return this.editor.submissions.some(s=>s!==pending&&!s.detached&&!this.known.has(s.id));}
  locked(){
    if(this.busy||this.editor.openingReadOnly||this.editor.authorityRecovery||this.editor.conflict||this.laterLocal()||this.session.unsettledSave()?.error)return true;
    if(this.mode==='fresh')return this.items.length!==0;
    return !['saved','restored'].includes(this.mode)||this.editor.draft.id!==this.next?.id||this.editor.draft.generation!==this.next?.generation;
  }
  state(answer){
    if(!this.session.validPrivateState(answer)||!same(answer.source_ref,this.source)||answer.note!==null)throw Error('The saved opening identity or destination could not be confirmed.');
    return answer;
  }
  page(answer,previous=null){
    if(answer?.instance_id!==this.editor.context.instanceId||!Array.isArray(answer.items)||answer.items.length>20||
      !(answer.next_cursor===null||Number.isInteger(answer.next_cursor)&&answer.next_cursor>0&&(previous===null||answer.next_cursor>previous)))throw Error('The opening history page could not be confirmed.');
    for(const row of answer.items)if(!validActorId(row.id)||!same(row.source_ref,this.source)||row.topic_id!==this.topic||
      !validActorId(row.prepare_operation_id)||!validActorId(row.send_operation_id)||!Number.isInteger(row.draft_revision)||
      !validActorId(row.draft_id)||!validActorId(row.draft_generation)||!['unknown','committed','rejected'].includes(row.send_status))throw Error('The opening history contains a mismatched act.');
    return answer;
  }
  read(name,args){return this.session.runtime.read(()=>this.session.api.view(name,args,{readClass:'foreground'}));}
  refresh(options={}){
    if(this.busy)return this.busy;
    const run=this.load(options).catch(error=>{this.mode='error';this.message=error.message;return this;});
    this.busy=run;this.session.changed(this.editor);
    const done=()=>{if(this.busy===run)this.busy=null;this.session.changed(this.editor);};run.then(done,done);return run;
  }
  async load({state=null,more=false,pending=null}={}){
    this.message=null;this.mode='loading';this.detail=null;this.prepare=null;this.next=null;
    if(!same(pin(this.session.authority),pin(this.session.runtime.current))||this.editor.authorityRecovery){this.mode='parked';return this;}
    let page;
    if(more&&this.base&&this.cursor!==null){
      const old=this.cursor;page=this.page(await this.read('submissions',{source_ref:this.source,topic_id:this.topic,cursor:old,limit:20}),old);
      const ids=new Set(this.items.map(row=>row.id));if(page.items.some(row=>ids.has(row.id)))throw Error('Opening history repeated a prior item. Retry from the beginning.');
      this.items.push(...copy(page.items));
    }else{
      this.base=copy(this.state(state??await this.read('editor_state',{source_ref:this.source,topic_id:this.topic,limit:20})));
      page=this.page(this.base.submissions);this.items=copy(page.items);
    }
    this.cursor=page.next_cursor;this.known=new Set(this.items.map(row=>row.id));this.onPage?.({instance_id:this.editor.context.instanceId,items:copy(this.items),next_cursor:this.cursor});
    if(this.cursor!==null){this.mode='incomplete';this.message='More submitted openings must be read before editing. Your writing is kept.';return this;}
    if(pending&&!sameOpeningDraft(pending.snapshot,this.base.draft))throw Error('The saved opening changed before preparation. Its original writing is kept for review.');
    const latest=this.items.at(-1);
    if(!latest){
      // An interrupted local save/prepare can precede any canonical submission.
      // Check one original receipt; never dispatch it or invent its successor.
      const attempt=!pending&&this.session.attempts.find(a=>!a.receipt&&!a.detached);
      if(attempt)await this.session.apply(attempt,await this.read('operation',{operation_id:attempt.envelope.operation_id}));
      this.mode='fresh';return this;
    }
    const detail=await this.read('submission',{submission_id:latest.id});
    if(detail?.instance_id!==this.editor.context.instanceId||detail.id!==latest.id||!same(detail.source_ref,this.source)||detail.topic_id!==this.topic||
      detail.prepare_operation_id!==latest.prepare_operation_id||detail.send_operation_id!==latest.send_operation_id||
      detail.draft_id!==latest.draft_id||detail.draft_revision!==latest.draft_revision||detail.draft_generation!==latest.draft_generation||
      !same(detail.authority,latest.authority)||!same(detail.authority,pin(this.session.authority))||!metadata(detail,this.source))throw Error('The latest submitted opening could not be confirmed.');
    this.detail=copy(detail);
    const prepared=await this.read('operation',{operation_id:detail.prepare_operation_id}),result=prepared?.result,next=result?.next_draft;
    if(!this.editor.matches(prepared,detail.prepare_operation_id,'submission.prepare')||prepared.status!=='committed'||prepared.error||
      result?.submission_id!==detail.id||result.send_operation_id!==detail.send_operation_id||result.draft_id!==detail.draft_id||result.draft_revision!==detail.draft_revision||
      next?.id!==detail.draft_id||next?.revision!==detail.draft_revision+1||!validActorId(next?.generation)||next.generation===detail.draft_generation)throw Error('The original preparation successor could not be confirmed.');
    const current=this.state(await this.read('editor_state',{source_ref:this.source,topic_id:this.topic,limit:20}));
    if(!same(current.draft,this.base.draft)){
      this.base=null;this.cursor=null;throw Error('Saved opening changed while reading history. Retry from the beginning; neither version was replaced.');
    }
    this.prepare=copy(prepared);this.next=copy(next);
    const local=this.editor.submissions.find(s=>s.id===detail.id),prepareAttempt=this.session.attempts.find(a=>a.envelope.operation_id===detail.prepare_operation_id);
    if(prepareAttempt&&!prepareAttempt.receipt)await this.session.apply(prepareAttempt,prepared);
    const receipt=detail.send_receipt;
    if(receipt){
      if(!this.editor.matches(receipt,detail.send_operation_id,'topic.create_and_send')||!['committed','rejected'].includes(receipt.status)||
        (receipt.status==='committed'&&(receipt.error||receipt.result?.submission_id!==detail.id||receipt.result?.topic?.id!==this.topic))||
        (receipt.status==='rejected'&&typeof receipt.error?.message!=='string'))throw Error('The original publication receipt could not be confirmed.');
      const sendAttempt=this.session.attempts.find(a=>a.envelope.operation_id===detail.send_operation_id);
      if(sendAttempt&&!sendAttempt.receipt)await this.session.apply(sendAttempt,receipt);
      else if(local?.serverObserved)this.editor.acceptSend(receipt);
    }
    this.mode='closed';
    if(receipt?.status!=='rejected'||!['INVALID_RECIPIENT','TOO_MANY_PARTICIPANTS'].includes(receipt.error?.code))return this;
    const draft=current.draft;
    if(!draft||draft.id!==next.id||draft.generation!==next.generation||draft.revision<next.revision||
      !same(draft.source_ref,this.source)||this.laterLocal(pending)||this.session.unsettledSave()||this.editor.conflict||(!pending&&this.editor.dirty)||
      !sameOpeningDraft(pending?.snapshot??this.editor.draft,draft)){this.message='Current writing needs review; it has not been replaced.';return this;}
    if(draft.revision===next.revision&&emptyOpeningDraft(draft))this.mode='empty';
    else if(draft.revision>next.revision&&metadata(draft,this.source))this.mode='saved';
    return this;
  }
  canRestore(item){return !this.busy&&this.mode==='empty'&&this.detail?.id===item?.id&&!this.laterLocal()&&!this.editor.openingReadOnly&&!this.editor.authorityRecovery;}
  restored(){this.mode='restored';}
}
