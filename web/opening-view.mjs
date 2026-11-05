import { InlineComposer } from './inline-composer.mjs';
import { ActorChoices, protectTouchBounds } from './creation-view.mjs';
import { hasTitle } from './creation.mjs';

const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const button=(label,action)=>{const n=el('button',label);n.type='button';n.onclick=action;return n;};

// Metadata surrounds the existing composer. The Editor/Session/Uploads owners
// retain all writing; this adapter never holds another editable body.
export class OpeningComposer {
  constructor({host,root,registry,bootstrap,presentation,open,review,needsReview,notice,confirmed}) {
    Object.assign(this,{host,root,registry,bootstrap,presentation,open,notice,confirmed});
    this.cards=new Map();host.classList.add('creation-form');host.replaceChildren();protectTouchBounds(host);protectTouchBounds(root);
    const label=el('label','Topic title');this.title=el('input');this.title.id='opening-title-input';label.append(this.title);host.append(label);
    this.title.oninput=()=>this.edit({title:this.title.value});
    const people=el('div');people.className='actor-choices';host.append(el('h2','Topic participants'),people);
    this.people=new ActorChoices({host:people,label:'Add topic participant',owner:bootstrap.actor,get:()=>this.metadata().participants??[],
      set:participants=>this.edit({participants}),readOnly:()=>this.locked(),limit:bootstrap.limits.topic_participants,notice});
    host.append(el('p','Participants receive this topic’s messages. The outcome team is not automatically included.'));
    this.localState=el('p');this.localState.className='muted';this.localState.setAttribute('role','status');host.append(this.localState);
    this.history=el('section');this.history.id='opening-history';this.history.setAttribute('aria-label','Submitted opening');host.append(this.history);
    this.composer=new InlineComposer({admits:(p,e)=>registry.isCurrent(p,e),uploads:e=>registry.sessionFor(e).uploads,
      edit:(e,p)=>this.run(()=>registry.isCurrent(p,e)?registry.edited(e):null),status:e=>registry.status(e),needsReview,
      send:(e,p)=>this.send(e,p),review,renderPending:()=>{},retry:()=>this.run(()=>this.check())},
      {root,destination:p=>'In '+p.workspace.title,readOnly:()=>this.locked()});
    this.composer.$('writing-title').textContent='Opening message';this.composer.field.setAttribute('aria-label','Opening message');
    this.composer.field.placeholder='Write the opening message…';
    this.composer.$('recipient-input').closest('.audience').hidden=true;
    this.later=button('Later',()=>open({kind:'workspace',id:presentation.workspace.id},presentation.workspace.title));this.later.id='opening-later';root.append(this.later);
    this.composer.show(presentation);this.paint();this.title.focus();
  }
  get editor(){return this.presentation.editors.reply;}
  metadata(){return this.editor.draft.opening??this.editor.submissions.at(-1)?.snapshot.opening??{};}
  locked(){return !this.presentation.writable||this.editor.openingLocked||this.editor.unavailable||Boolean(this.editor.authorityRecovery);}
  edit(patch){
    if(this.locked())return;
    try{this.editor.editOpening(patch);this.run(()=>this.registry.edited(this.editor));}catch(error){this.notice(error.message);}
  }
  async run(action){try{return await action();}catch(error){this.notice(error.message);}finally{this.paint();}}
  send(editor,p){
    const {limits}=this.bootstrap,opening=editor.draft.opening;
    if(this.locked())throw Error('Review this opening before sending.');
    if(!opening||!hasTitle(opening.title))throw Error('Give this topic a title before sending.');
    if(new TextEncoder().encode(opening.title).length>limits.body_utf8_bytes)throw Error('The topic title is too long.');
    if(new Set([this.bootstrap.actor,...opening.participants]).size>limits.topic_participants)throw Error('The participant limit includes you.');
    const followFocus=[this.composer.field,this.composer.$('send')].includes(document.activeElement);
    return this.registry.send(editor,{presentation:p,stay:true}).finally(()=>{
      this.paint();
      if(followFocus&&[document.body,this.composer.field,this.composer.$('send')].includes(document.activeElement)){
        const card=this.cards.get(editor.submissions.at(-1)?.id);
        [card?.open,card?.edit,card?.check].find(control=>control&&!control.hidden&&!control.disabled)?.focus();
      }
    });
  }
  async check(){
    await this.registry.checkConfirmation(this.editor);
    for(const row of this.registry.pending(this.editor).items)if(!this.editor.submissions.some(item=>item.id===row.id&&!item.serverObserved))await this.registry.checkPending(this.editor,row.id);
    if(this.confirmationFailed){this.confirming=false;this.confirmationFailed=false;}
    this.paint();
  }
  paint(){
    const e=this.editor,metadata=this.metadata(),locked=this.locked();
    if(this.title.value!==(metadata.title??''))this.title.value=metadata.title??'';
    this.title.readOnly=locked;this.people.paint();
    this.localState.textContent=!this.presentation.writable?'Open in another tab — this opening is read-only':e.openingLocked?
      'This opening is frozen. Review its writing and confirmation below.':'Private opening · saved writing does not create a topic until you Send.';
    this.composer?.paintStatus();
    if(this.composer){
      this.composer.field.hidden=Boolean(e.openingLocked&&!e.draft.body);
      this.composer.$('writing-hint').hidden=Boolean(e.openingLocked);
    }
    this.later.disabled=this.registry.hasInFlightSend;
    const local=new Map(e.submissions.map(item=>[item.id,item]));
    const entries=[...local.values(),...this.registry.pending(e).items.filter(item=>!local.has(item.id))];
    const names={preparing:'Preparing — writing kept',prepared:'Confirmation unknown',confirmed:'Topic created',refused:'Not sent — writing kept',unknown:'Confirmation unknown',committed:'Topic created',rejected:'Not sent — writing kept'};
    for(const item of entries){
      let card=this.cards.get(item.id);
      if(!card){
        const section=el('section');section.className='pending-card';section.dataset.id=item.id;
        const heading=el('h3'),body=el('pre'),reason=el('p'),read=button('Read submitted writing',()=>this.run(async()=>{await this.registry.inspectPending(e,item.id);})),
          check=button('Check confirmation',()=>this.run(async()=>{await this.registry.checkPending(e,item.id);})),
          edit=button('Edit opening',()=>this.run(async()=>{
            const current=e.submissions.find(x=>x.id===item.id),session=this.registry.sessionFor(e);
            const state=await session.api.view('editor_state',{source_ref:e.sourceRef,topic_id:e.context.topicId});
            this.registry.validateState(state,e.sourceRef,e.context.topicId);
            await session.correctOpening(current,state.draft,e.localVersion);this.composer.drawEditor();this.title.focus();
          })),open=button('Open topic',()=>this.open({kind:'topic',id:e.context.topicId},this.metadata().title||'Topic'));
        section.append(heading,body,reason,read,check,edit,open);this.history.append(section);
        card={section,heading,body,reason,read,check,edit,open};this.cards.set(item.id,card);
      }
      const status=item.status??item.send_status,full=local.get(item.id),receipt=full?.receipt??this.registry.pendingReceipts.get(JSON.stringify([e.key,item.id,item.send_operation_id]));
      card.heading.textContent=names[status]??'Confirmation unknown';card.body.textContent=full?.snapshot.body??'';card.body.hidden=!full;
      card.reason.textContent=this.registry.pendingReason(e,item)??'';card.reason.hidden=!card.reason.textContent;
      card.read.hidden=Boolean(full);card.check.hidden=status==='confirmed'||status==='committed';
      card.edit.hidden=!(full&&!full.openingCorrected&&!full.detached&&receipt?.kind==='topic.create_and_send'&&receipt.status==='rejected'&&['INVALID_RECIPIENT','TOO_MANY_PARTICIPANTS'].includes(receipt.error?.code));
      card.edit.id=card.edit.hidden?'':'opening-edit';
      card.edit.disabled=!this.presentation.writable||this.registry.hasInFlightSend;
      card.open.hidden=!(full?.status==='confirmed'&&full.receipt?.result?.topic?.id===e.context.topicId);
      card.open.id=card.open.hidden?'':'opening-open-topic';
      if(!card.open.hidden&&!this.confirming){
        this.confirming=true;
        this.run(async()=>{try{await this.confirmed(full.receipt);}catch(error){this.confirmationFailed=true;throw error;}});
      }
    }
    this.history.querySelector('[data-more]')?.remove();
    if(this.registry.pending(e).next_cursor!==null){const more=button('More submitted openings',()=>this.run(()=>this.registry.morePending(e)));more.dataset.more='';this.history.append(more);}
  }
}
