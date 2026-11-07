import { WritingInput } from './writing-input.mjs';
import { protectTouchBounds } from './creation-view.mjs';
import { namedPastedImage } from './writing-helpers.mjs';
import { OpeningPages } from './opening.mjs';
import { routeHref } from './topic-navigation.mjs';

const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
const button=(label,action,className)=>{const n=el('button',label,className);n.type='button';n.onclick=action;return n;};
// Rows keep their nodes across repaints so a focused control is never replaced.
function keyed(host,keys,make,update) {
  for(const node of [...host.children])if(!keys.includes(node.dataset.key))node.remove();
  keys.forEach((key,index)=>{
    let node=[...host.children].find(n=>n.dataset.key===key);
    if(!node){node=make(key);node.dataset.key=key;}
    update(node,key);
    if(host.children[index]!==node)host.insertBefore(node,host.children[index]??null);
  });
}
const plain=event=>event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey;
const describe=(w,names)=>[`Title: ${w.title||'(none)'}`,`Participants: ${w.participants.map(names).join(', ')||'only you'}`,
  `Images: ${w.attachments.length}`,'',w.body].join('\n');

// The page for one OpeningDraft. Writing lives in the draft; this adapter only
// paints it and routes input, keyboard, IME and touch to it.
export class OpeningView {
  constructor({host,draft,workspace,open}) {
    Object.assign(this,{host,draft,workspace,open});
    host.classList.add('creation-form');host.replaceChildren();protectTouchBounds(host);
    this.state=el('p','','muted');this.state.id='opening-save-state';this.state.setAttribute('role','status');
    this.notice=el('p','','notice');this.notice.id='opening-notice';this.notice.setAttribute('role','status');this.notice.hidden=true;
    const titleLabel=el('label','Topic title');this.title=el('input');this.title.id='opening-title-input';this.title.autocomplete='off';titleLabel.append(this.title);
    this.title.oninput=()=>this.run(()=>draft.edit({title:this.title.value}));
    this.chips=el('div',undefined,'chips');this.members=el('div',undefined,'member-choices');this.members.id='opening-members';
    this.moreMembers=button('More members',()=>this.run(()=>draft.loadMembers(true)));
    this.membersState=el('p','','muted');this.retryMembers=button('Retry members',()=>this.run(()=>this.loadMembers()));
    const people=el('div',undefined,'actor-choices');people.append(this.chips);
    const bodyLabel=el('label','Opening message');this.body=el('textarea');this.body.id='opening-body';this.body.rows=8;
    this.body.placeholder='Write the opening message…';this.body.spellcheck=true;bodyLabel.append(this.body);
    const writer={get draft(){return {body:draft.writing.body};},edit:({body})=>draft.edit({body})};
    this.input=new WritingInput({field:this.body,editor:()=>writer,admits:()=>draft.editable,changed:()=>this.paint()});
    this.body.addEventListener('keydown',event=>{
      if(this.input.terminalKey(event))return;
      if(event.key==='Enter'&&event.metaKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!event.repeat)this.send();}
    });
    this.body.addEventListener('paste',event=>this.paste(event));
    this.attachments=el('div',undefined,'attachments');this.attachments.id='opening-attachments';
    this.file=el('input');this.file.type='file';this.file.accept='image/png,image/jpeg,image/gif,image/webp';this.file.hidden=true;
    this.file.onchange=()=>{const file=this.file.files?.[0];this.file.value='';if(file)this.run(()=>draft.attach(file));};
    this.addImage=button('Add image',()=>{if(draft.editable&&!draft.conflict)this.file.click();});this.addImage.id='opening-add-image';
    // What this topic answers, and the topics already started from it, before anything is written.
    this.answers=el('section',undefined,'opening-answers');this.answers.id='opening-source';this.answers.hidden=true;
    this.answers.setAttribute('aria-label','The message this topic answers');
    this.conflict=el('section',undefined,'pending-card');this.conflict.id='opening-conflict';this.conflict.hidden=true;
    this.outcome=el('section',undefined,'pending-card');this.outcome.id='opening-outcome';this.outcome.hidden=true;
    this.sendButton=button('Send',()=>this.send(),'primary');this.sendButton.id='opening-send';
    const hint=el('span','⌘↵');hint.setAttribute('aria-hidden','true');this.sendButton.append(hint);
    this.later=button('Later',()=>open({kind:'workspace',id:workspace.id},workspace.title));this.later.id='opening-later';
    this.discard=button('Discard…',()=>{this.confirming=true;this.paint();this.confirm.focus();});this.discard.id='opening-discard';
    this.confirm=button('Discard this opening',()=>this.run(async()=>{this.confirming=false;await draft.discard();}));this.confirm.id='opening-discard-confirm';
    this.keep=button('Keep it',()=>{this.confirming=false;this.paint();this.discard.focus();});
    const actions=el('div',undefined,'creation-actions');actions.append(this.sendButton,this.later,this.discard,this.confirm,this.keep);
    host.append(this.state,this.notice,this.answers,titleLabel,el('h2','Topic participants'),people,this.members,this.membersState,this.moreMembers,this.retryMembers,
      el('p','Participants receive this topic’s messages. Choose from this outcome’s members.','muted'),
      bodyLabel,this.attachments,this.file,this.addImage,this.conflict,this.outcome,actions);
    draft.changed=()=>this.paint();this.paint();
  }
  async run(action){
    this.error=null;
    try{return await action();}catch(error){this.error=error.message;}finally{this.paint();}
  }
  send(){return this.run(()=>this.draft.send());}
  loadMembers(){return this.draft.loadMembers().then(()=>{this.membersError=null;},error=>{this.membersError=error.message;throw error;});}
  async paste(event) {
    const items=[...(event.clipboardData?.items??[])].filter(item=>item.type.startsWith('image/'));
    if(!items.length)return;
    event.preventDefault();
    for(const item of items){const file=item.getAsFile();await this.run(()=>{if(!file)throw Error('Could not read the pasted image. Use Add image.');return this.draft.attach(namedPastedImage(file));});}
  }
  name(id){const m=this.draft.members.find(m=>m.actor_id===id);return m?`${m.name}${m.name_truncated?'…':''}`:id;}
  paint() {
    const d=this.draft,w=d.writing,editable=d.editable,focused=document.activeElement;
    this.state.textContent=[d.phase==='loading'?'Loading…':d.status,d.device].filter(Boolean).join(' · ');
    const message=this.error??d.refusal??d.notice;this.notice.textContent=message??'';this.notice.hidden=!message;
    // Writing taken from another device keeps the focused field's caret where it was.
    for(const [field,value] of [[this.title,w.title],[this.body,w.body]]){
      if(field.value===value)continue;
      const caret=focused===field?[field.selectionStart,field.selectionEnd]:null;
      field.value=value;
      if(caret)field.setSelectionRange(Math.min(caret[0],value.length),Math.min(caret[1],value.length));
    }
    this.title.readOnly=this.body.readOnly=!editable;
    keyed(this.chips,[d.bootstrap.actor,...w.participants],id=>{
      const chip=el('span',undefined,'chip');chip.append(el('span'));
      if(id!==d.bootstrap.actor)chip.append(button('×',()=>this.run(()=>{d.setParticipants(d.writing.participants.filter(x=>x!==id));this.title.focus();})));
      return chip;
    },(chip,id)=>{
      chip.children[0].textContent=id===d.bootstrap.actor?`${id} · you`:this.name(id);
      if(chip.children[1]){chip.children[1].setAttribute('aria-label','Remove '+this.name(id));chip.children[1].disabled=!editable;}
    });
    const choices=d.members.filter(m=>m.actor_id!==d.bootstrap.actor);
    keyed(this.members,choices.map(m=>m.actor_id),id=>{
      const label=el('label',undefined,'member-choice'),box=el('input');box.type='checkbox';
      box.onchange=()=>this.run(()=>d.setParticipants(box.checked?[...d.writing.participants,id]:d.writing.participants.filter(x=>x!==id)));
      label.append(box,el('span'));return label;
    },(label,id)=>{
      const [box,text]=label.children,m=choices.find(m=>m.actor_id===id);
      box.checked=d.writing.participants.includes(id);box.disabled=!editable;text.textContent=` ${this.name(id)} · ${m.kind}`;
    });
    this.moreMembers.hidden=d.membersNext===null;this.retryMembers.hidden=!this.membersError;
    this.membersState.textContent=this.membersError?'Outcome members are unavailable. '+this.membersError:'';this.membersState.hidden=!this.membersError;
    this.paintAttachments(editable);
    this.addImage.disabled=!editable||Boolean(d.conflict);
    this.paintConflict();this.paintOutcome();this.paintAnswers();
    const open=['editing','sending','unknown','loading','error'].includes(d.phase);
    this.sendButton.hidden=!open||d.phase==='unknown';this.sendButton.disabled=!editable||Boolean(d.conflict);
    this.discard.hidden=!open||this.confirming||d.phase==='unknown';this.discard.disabled=!editable||Boolean(d.conflict);
    this.confirm.hidden=this.keep.hidden=!this.confirming||!editable;this.later.disabled=d.phase==='sending'||d.discarding;
    this.later.textContent=['published','discarded'].includes(d.phase)?'Back to outcome':'Later';
    if(focused&&focused.hidden&&[this.sendButton,this.confirm,this.keep,this.discard].includes(focused))(this.outcome.hidden?this.title:this.outcome.querySelector('button,a')??this.later)?.focus();
  }
  paintAttachments(editable) {
    const d=this.draft;
    const ids=[...new Set([...d.writing.attachments.map(ref=>ref.id),...[...d.media].filter(([,m])=>m.state==='uploading'||m.state==='failed').map(([id])=>id)])];
    keyed(this.attachments,ids,id=>{
      const row=el('div',undefined,'image-choice');
      row.append(el('span'),button('Retry upload',()=>this.run(()=>d.retryUpload(id))),button('Remove',()=>this.run(()=>{d.detach(id);this.addImage.focus();})));
      return row;
    },(row,id)=>{
      const m=d.media.get(id)??{name:'Image',state:'checking',message:''},[text,retry,remove]=row.children;
      const label={uploading:'Uploading',ready:'Ready',checking:'Checking',pending:'Upload not finished',failed:'Not uploaded',unavailable:'Unavailable'}[m.state];
      text.textContent=`${m.name} · ${label}${m.message?' — '+m.message:''}`;
      retry.hidden=!(m.state==='failed'&&m.upload);retry.disabled=!editable;remove.disabled=!editable;remove.setAttribute('aria-label','Remove '+m.name);
    });
  }
  paintAnswers() {
    const d=this.draft,host=this.answers;
    host.hidden=!d.source;
    if(!d.source){host.replaceChildren();host.dataset.key='';return;}
    const key=JSON.stringify([d.source,d.sourceMessage,d.started,d.startedRead,d.sourceError,d.phase]);
    if(host.dataset.key===key)return;host.dataset.key=key;
    const words=d.sourceMessage?d.sourceMessage.body.replace(/\s+/g,' ').trim():'';
    const quote=el('blockquote',d.sourceMessage?`${d.sourceMessage.author}: ${words.length>240?words.slice(0,239)+'…':words}`:'The message is being read…');
    host.replaceChildren(el('h2','Answers a message'),quote);
    if(d.sourceError){
      host.append(el('p','The topics already started from this message could not be read. '+d.sourceError,'notice'),
        button('Retry',()=>this.run(()=>d.loadSource())));
      return;
    }
    if(!d.startedRead)return;
    if(!d.started.length){host.append(el('p','No topic has been started from this message yet.','muted'));return;}
    const list=el('ul',undefined,'started-topics');
    for(const t of d.started){
      const title=(t.title||'Untitled topic')+(t.title_truncated?'…':''),link=el('a',title);link.href=routeHref({kind:'topic',id:t.id});link.dataset.topicId=t.id;
      link.onclick=event=>{if(!plain(event))return;event.preventDefault();this.open({kind:'topic',id:t.id},title);};
      const item=el('li');item.append(link,el('span',` · started by ${t.creator_id===d.bootstrap.actor?'you':t.creator_id} · ${t.message_count} message${t.message_count===1?'':'s'}${t.archived?' · archived':''}`,'muted'));
      list.append(item);
    }
    host.append(el('h3',d.started.length===1?'A topic was already started from this message':`${d.started.length} topics were already started from this message`),list,
      el('p',['published','discarded'].includes(d.phase)?'':'Continue there if it is the same question. Send starts this topic anyway.','muted'));
  }
  paintConflict() {
    const d=this.draft,c=d.conflict;this.conflict.hidden=!c;
    if(!c){this.conflict.replaceChildren();return;}
    const key=JSON.stringify([d.localVersion,c.remote===undefined?null:c.remote?.revision??0,c.message??null]);
    if(this.conflict.dataset.key===key)return;this.conflict.dataset.key=key;
    const mine=el('pre',describe(d.writing,id=>this.name(id)));
    this.conflict.replaceChildren(el('h3','This opening changed on another device'),
      el('p','Nothing was overwritten. Choose which version to keep; the other one is replaced only when you choose.','muted'),
      el('h3','Your writing'),mine);
    if(c.remote===undefined){
      this.conflict.append(el('p','The saved version could not be read. '+(c.message??''),'muted'),button('Retry reading',()=>this.run(()=>d.retryConflictRead())));
      return;
    }
    this.conflict.append(el('h3',c.remote?`Saved version · revision ${c.remote.revision}`:'Saved version'),
      el('pre',c.remote?describe(c.remote,id=>this.name(id)):'Theseus has no saved version of this opening.'),
      button('Keep my writing',()=>this.run(()=>d.resolve('mine')),'primary'));
    if(c.remote)this.conflict.append(button('Use the saved version',()=>this.run(()=>d.resolve('server'))));
  }
  paintOutcome() {
    const d=this.draft,host=this.outcome,key=JSON.stringify([d.phase,d.notice,Boolean(d.leftover)]);
    host.hidden=!['unknown','published','discarded','error','taken'].includes(d.phase);
    if(host.hidden||host.dataset.key===key){if(host.hidden)host.dataset.key='';return;}
    host.dataset.key=key;host.replaceChildren();
    if(d.phase==='error')host.append(el('h3','This opening could not be loaded'),button('Retry',()=>this.run(()=>d.load())));
    if(d.phase==='unknown')host.append(el('h3','Sending is not confirmed'),
      el('p','The exact send request is kept on this device only. Check reads its confirmation; Send again sends the identical request.','muted'),
      button('Check',()=>this.run(()=>d.check())),button('Send again',()=>this.run(()=>d.sendAgain())));
    if(d.phase==='published'){
      const link=el('a','Open the topic');link.href=routeHref({kind:'topic',id:d.topic});
      link.onclick=event=>{if(!plain(event))return;event.preventDefault();this.open({kind:'topic',id:d.topic},d.writing.title||'Topic');};
      host.append(el('h3','Topic created'),el('p','Further writing is a reply in the topic, or a new opening.','muted'),link);
    }
    if(d.phase==='discarded')host.append(el('h3','This opening was discarded'));
    if(d.phase==='taken')host.append(el('h3','This link can no longer start a topic'),
      el('p','Its topic already exists. Your writing is kept on this device only; move it to a new topic to save and send it.','muted'),
      button('Start a new topic with this writing',()=>this.run(async()=>{const route=await d.relocate();await this.open(route,d.writing.title||'New topic');})));
    if(d.leftover)host.append(el('p','This writing was on this device only and was not part of it:','muted'),el('pre',describe(d.leftover,id=>this.name(id))),
      button('Remove from this device',()=>this.run(()=>d.removeLeftover())));
  }
}

// Each outcome page lists the person's unfinished openings from Core, so any
// device can resume one.
export class UnfinishedOpenings {
  constructor({host,instanceId,workspace,read,open}) {
    Object.assign(this,{host,read,open});this.pages=new OpeningPages(instanceId,workspace);this.loading=null;
    this.list=el('div');this.message=el('p','','muted');this.message.setAttribute('role','status');
    this.more=button('More unfinished topics',()=>this.load(true));this.more.hidden=true;
    host.setAttribute('aria-label','Unfinished topics');protectTouchBounds(host);
    host.replaceChildren(el('h2','Unfinished topics'),el('p','Private openings you started in this outcome, on any device.','muted'),this.list,this.message,this.more);
  }
  load(more=false) {
    if(this.loading)return this.loading;
    const cursor=more?this.pages.next:null;
    if(more&&cursor===null)return Promise.resolve();
    this.more.disabled=true;
    this.loading=this.read({workspace_id:this.pages.workspace,limit:20,...(cursor===null?{}:{cursor})}).then(answer=>{
      if(answer?.error)throw Error(answer.error.message??answer.error.code);
      this.pages.accept(answer,cursor);this.paint();
    }).catch(error=>{this.message.textContent=error.message;this.more.textContent='Retry unfinished topics';this.more.hidden=false;this.failedMore=more;
      this.more.onclick=()=>this.load(this.failedMore);
    }).finally(()=>{this.loading=null;this.more.disabled=false;});
    return this.loading;
  }
  paint() {
    this.list.replaceChildren();
    for(const item of this.pages.items){
      const route={kind:'opening',workspace:item.workspace_id,opening:item.id,topic:item.topic_id},title=item.title?item.title+(item.title_truncated?'…':''):'Untitled topic';
      const link=el('a',`Resume ${title}`,'nav-item');link.href=routeHref(route);link.dataset.openingId=item.id;
      link.onclick=event=>{if(!plain(event))return;event.preventDefault();this.open(route,title);};
      this.list.append(link);
    }
    this.message.textContent=this.pages.items.length?'':'No unfinished topics.';
    this.more.textContent='More unfinished topics';this.more.onclick=()=>this.load(true);this.more.hidden=this.pages.next===null;
  }
}
