import { validActorId } from './creation.mjs';
import { routeHref } from './topic-navigation.mjs';

const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const button=(text,action)=>{const node=el('button',text);node.type='button';node.onclick=action;return node;};
// A finger lifted off a button or link taps nothing. A button that holds its
// own press (an image row's, image-rows.mjs) is left to the browser: the page
// may have moved it from under a finger that never moved.
export function protectTouchBounds(host) {
  host.addEventListener('touchend',event=>{
    const target=event.target.closest('button,a'),touch=event.changedTouches?.[0];if(!target||!touch||'holdsPress' in target.dataset)return;
    const b=target.getBoundingClientRect();if(touch.clientX<b.left||touch.clientX>b.right||touch.clientY<b.top||touch.clientY>b.bottom)event.preventDefault();
  },{passive:false});
}

// Actor chips are form metadata. Writing remains in the shared message composer.
export class ActorChoices {
  constructor({host,label,owner,get,set,readOnly,limit,notice}) {
    Object.assign(this,{host,owner,get,set,readOnly,limit,notice});
    this.chips=el('div');this.chips.className='chips';this.input=el('input');this.input.placeholder='Add a name';this.input.autocomplete='off';this.input.setAttribute('list','directory-names');
    this.input.setAttribute('aria-label',label);this.add=button('Add',()=>this.addActor());
    this.input.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();if(!event.repeat)this.addActor();}};
    host.append(this.chips,this.input,this.add);this.paint();
  }
  addActor(){
    if(this.readOnly())return;const id=this.input.value.trim();
    if(!validActorId(id)){this.notice('Enter a known actor ID of at most 200 characters, without control characters.');return;}
    const next=[...new Set([this.owner,...this.get(),id])];
    if(next.length>this.limit){this.notice('The limit includes you. Remove a name before adding another.');return;}
    this.set(next.filter(x=>x!==this.owner));this.input.value='';this.paint();this.input.focus();
  }
  paint(){
    this.chips.replaceChildren();const locked=this.readOnly();
    for(const id of [...new Set([this.owner,...this.get()])]){
      const chip=el('span',id+(id===this.owner?' · you':''));chip.className='chip';
      if(id!==this.owner){const remove=button('×',()=>{if(this.readOnly())return;this.set(this.get().filter(x=>x!==id));this.paint();this.input.focus();});remove.setAttribute('aria-label','Remove '+id);remove.disabled=locked;chip.append(remove);}
      this.chips.append(chip);
    }
    this.input.disabled=locked;this.add.disabled=locked;
  }
}

export class CreateOutcomeView {
  constructor({host,creation,open,confirmed}) {
    Object.assign(this,{host,creation,open,confirmed});host.classList.add('creation-form');host.replaceChildren();
    protectTouchBounds(host);
    this.notice=el('p');this.notice.className='notice';this.notice.setAttribute('role','status');this.notice.hidden=true;
    const field=(label,tag,id)=>{const container=el('label',label),input=el(tag);input.id=id;container.append(input);host.append(container);return input;};
    this.title=field('Outcome title','input','outcome-title-input');this.title.value=creation.row.form.title;
    this.purpose=field('Purpose (optional)','textarea','outcome-purpose-input');this.purpose.rows=3;this.purpose.value=creation.row.form.purpose;
    this.title.oninput=()=>this.run(()=>creation.edit({title:this.title.value}));this.purpose.oninput=()=>this.run(()=>creation.edit({purpose:this.purpose.value}));
    // Return in the title creates the outcome, as Create outcome does.
    this.title.onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();if(!event.repeat&&!this.create.hidden&&!this.create.disabled)this.run(()=>creation.create());}};
    host.append(el('p','Owner: '+creation.row.actor));
    const team=el('div');team.className='actor-choices';host.append(el('h2','Team'),team);
    this.team=new ActorChoices({host:team,label:'Add outcome team member',owner:creation.row.actor,get:()=>creation.row.form.team,
      set:team=>this.run(()=>creation.edit({team})),readOnly:()=>creation.readOnly,limit:creation.bootstrap.limits.workspace_members,notice:text=>this.message(text)});
    host.append(el('p','Team members can access this outcome. Choose topic participants separately to receive its messages.'),
      el('p','Choose registered people and agents. The owner can change the team later on the outcome page.'));
    this.saveState=el('p');this.saveState.className='muted';this.saveState.setAttribute('role','status');
    this.create=button('Create outcome',()=>this.run(()=>creation.create()));this.create.id='create-outcome';this.create.className='primary';
    this.check=button('Check confirmation',()=>this.run(()=>creation.check()));this.check.id='check-outcome';
    this.retry=button('Retry this creation',()=>this.run(()=>creation.retry()));this.retry.id='retry-outcome';
    this.start=button('Start first topic',()=>open({kind:'opening',workspace:creation.row.workspace,opening:crypto.randomUUID(),topic:crypto.randomUUID()},'Start first topic'));this.start.id='start-first-topic';
    this.later=button('Later',()=>open(creation.row.phase==='confirmed'?{kind:'workspace',id:creation.row.workspace}:{kind:'root'},creation.row.phase==='confirmed'?'Outcome':'Outcomes'));this.later.id='creation-later';
    this.saveAgain=button('Try saving again',()=>this.run(()=>creation.saveAgain()));this.saveAgain.id='save-outcome-form';
    const actions=el('div');actions.className='creation-actions';actions.append(this.create,this.check,this.retry,this.saveAgain,this.start,this.later);
    host.append(this.notice,this.saveState,actions);creation.changed=()=>this.paint();this.paint();this.title.focus();
  }
  message(text){this.notice.textContent=text;this.notice.hidden=!text;}
  async run(action){try{this.error=null;this.message('');await action();if(this.creation.row.phase==='confirmed')await this.confirmed(this.creation.row);}catch(error){this.error=error.message;}finally{this.paint();}}
  paint(){
    const focused=document.activeElement;
    const c=this.creation,phase=c.row.phase;
    if(this.adoptedRow!==c.row){this.title.value=c.row.form.title;this.purpose.value=c.row.form.purpose;this.adoptedRow=c.row;}
    this.title.readOnly=this.purpose.readOnly=c.readOnly;this.team.paint();
    this.saveAgain.hidden=!c.canSaveAgain;this.saveAgain.disabled=Boolean(c.pending);
    this.create.hidden=Boolean(c.row.envelope);this.create.disabled=c.readOnly;
    this.check.hidden=!c.row.envelope||phase==='confirmed';this.check.disabled=!c.writable||Boolean(c.pending)||c.parked;
    this.retry.hidden=!c.retryAllowed;this.retry.disabled=!c.writable||Boolean(c.pending)||c.parked;
    this.start.hidden=phase!=='confirmed';this.later.disabled=Boolean(c.pending);
    if([this.create,this.retry,this.check].includes(focused)&&focused.hidden)(phase==='confirmed'?this.start:phase==='rejected'?this.title:this.check).focus();
    this.message(this.error??c.notice??(phase==='rejected'?c.row.receipt.error.message+' Edit the fields to make a new creation request.':''));
    this.saveState.textContent=c.parked?'Runtime changed — this act is kept without rebinding':!c.writable?'Open in another tab — read-only until that tab closes':c.storageError?'Keep this page open — '+c.storageError:
      c.pending?'Checking creation…':phase==='confirmed'?'Outcome created':phase==='uncertain'?'Creation not confirmed — the original request is kept on this browser':c.dirty?'Saving on this browser…':'Form saved on this browser';
  }
}

// Outcome creations kept on this browser. Unfinished topic openings are Core
// records, listed per outcome by opening-view.mjs.
export async function showUnfinished({host,journal,workspace=null,open}) {
  host.replaceChildren(el('h2','Unfinished on this browser'),el('p','Outcome forms started in another browser are not listed here.'));
  const list=el('div'),message=el('p'),more=button('More unfinished work',()=>load(cursor));let cursor=null,busy=false;
  host.append(list,message,more);protectTouchBounds(host);
  async function load(after){
    if(busy)return;busy=true;more.disabled=true;
    try{
      const page=await journal.page({workspace,cursor:after,limit:20});cursor=page.nextCursor;
      for(const item of page.items){
        const route={kind:'create',intent:item.id};
        const link=el('a','Resume '+item.title);link.className='nav-item';link.href=routeHref(route);
        link.onclick=event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();open(route,item.title);};list.append(link);
      }
      message.textContent=!list.children.length&&cursor===null?'No unfinished work on this browser.':'';
      more.textContent='More unfinished work';more.hidden=cursor===null;
    }catch(error){message.textContent=error.message;more.textContent='Retry unfinished work';more.hidden=false;}
    finally{busy=false;more.disabled=false;}
  }
  await load(null);
}
