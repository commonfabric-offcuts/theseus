const copy=structuredClone;
export const validActorId=value=>typeof value==='string'&&value.length>0&&[...value].length<=200&&!/[\x00-\x1f]/.test(value);
export const authorityPair=value=>({authority_id:value?.authority_id,authority_epoch:value?.authority_epoch});
const same=(a,b)=>{
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
};
const bound=(row,bootstrap)=>row.instanceId===bootstrap.instance_id&&row.actor===bootstrap.actor&&
  same(authorityPair(row.authority),authorityPair(bootstrap.authority));
const base=(id,kind,bootstrap)=>({format:1,id,kind,instanceId:bootstrap.instance_id,actor:bootstrap.actor,authority:authorityPair(bootstrap.authority)});

export async function retainOpening({journal,bootstrap,workspace,opening,topic}) {
  if(![workspace,opening,topic].every(validActorId))throw Error('The opening identity is incomplete.');
  const writable=await journal.claim(opening),existing=await journal.get(opening);
  const row=existing??{...base(opening,'opening',bootstrap),workspace,topic,sourceRef:{kind:'new_topic',id:opening,workspace_id:workspace},phase:'private'};
  if(!bound(row,bootstrap))throw Error('This opening belongs to a different runtime authority. It has not been rebound.');
  if(row.kind!=='opening'||row.workspace!==workspace||row.topic!==topic||
      !same(row.sourceRef,{kind:'new_topic',id:opening,workspace_id:workspace}))throw Error('The retained opening identity does not match this link.');
  if(!existing){if(!writable)throw Error('This opening is being initialized in another tab.');await journal.put(row);}
  return {row:copy(row),writable};
}

// Outcome creation is an intent, not an editor. Its frozen public request is
// durable before dispatch; message writing continues to use EditorSession.
export class OutcomeCreation {
  constructor({api,bootstrap,journal,intentId,id=()=>crypto.randomUUID(),changed=()=>{}}) {
    if(!validActorId(intentId))throw Error('A creation intent needs a stable identity.');
    Object.assign(this,{api,bootstrap:copy(bootstrap),journal,intentId,id,changed});
    this.pending=null;this.queue=Promise.resolve();this.retryAllowed=false;this.writable=false;this.version=0;this.savedVersion=-1;
  }
  async load() {
    this.writable=await this.journal.claim(this.intentId);
    this.row=await this.journal.get(this.intentId);
    if(!this.row){
      if(!this.writable)throw Error('This outcome form is being initialized in another tab.');
      this.row={...base(this.intentId,'create',this.bootstrap),workspace:null,phase:'draft',form:{title:'',purpose:'',team:[]},envelope:null,receipt:null,history:[]};
      await this.persist();
    }
    if(this.row.kind!=='create'||!bound(this.row,this.bootstrap))throw Error('This creation belongs to a different runtime authority. It has not been rebound.');
    this.savedVersion=this.version;this.changed();return this;
  }
  get readOnly(){return !this.writable||this.parked||Boolean(this.pending)||Boolean(this.row?.envelope&&this.row.phase!=='rejected');}
  get dirty(){return this.savedVersion<this.version;}
  owns(){if(!this.writable)throw Error('Open in another tab — this form is read-only.');if(this.parked)throw Error('The runtime authority changed. This act is kept without rebinding.');}
  persist() {
    const row=copy(this.row),version=this.version;
    const next=this.queue.catch(()=>{}).then(()=>this.journal.put(row)).then(()=>{this.savedVersion=Math.max(this.savedVersion,version);this.storageError=null;},error=>{this.storageError=error.message;throw error;});
    this.queue=next;return next;
  }
  async edit(patch) {
    this.owns();if(this.readOnly)throw Error('This creation is locked. Check its original confirmation.');
    if(this.row.phase==='rejected'){
      this.row.history.push({envelope:copy(this.row.envelope),receipt:copy(this.row.receipt)});
      this.row.envelope=null;this.row.receipt=null;this.row.workspace=null;this.row.phase='draft';this.retryAllowed=false;
    }
    for(const key of ['title','purpose','team'])if(Object.hasOwn(patch,key))this.row.form[key]=copy(patch[key]);
    this.version++;this.changed();await this.persist();this.changed();
  }
  validate() {
    const {title,purpose,team}=this.row.form,limits=this.bootstrap.limits;
    if(typeof title!=='string'||!title.trim())throw Error('Give this outcome a title before creating it.');
    if(typeof purpose!=='string'||[title,purpose].some(s=>new TextEncoder().encode(s).length>limits.body_utf8_bytes))throw Error('The title or purpose is too long.');
    if(!Array.isArray(team)||!team.every(validActorId))throw Error('Use valid known actor IDs for the team.');
    if(new Set([this.bootstrap.actor,...team]).size>limits.workspace_members)throw Error('The team limit includes the owner.');
  }
  perform(action) {
    if(this.pending)return this.pending;
    const pending=Promise.resolve().then(action);this.pending=pending;this.changed();
    const finish=()=>{if(this.pending===pending)this.pending=null;this.changed();};pending.then(finish,finish);return pending;
  }
  async checkAuthority() {
    const current=await this.api.bootstrap({readClass:'foreground'});
    if(!bound(this.row,current)){this.parked=true;this.changed();throw Error('The runtime authority changed. The original act is kept without rebinding.');}
  }
  create() {
    return this.perform(async()=>{
      this.owns();if(this.row.envelope)throw Error('Check the original creation before starting another act.');this.validate();
      const workspace=this.id();
      this.row.workspace=workspace;this.row.phase='uncertain';this.retryAllowed=false;
      this.row.envelope={v:1,instance_id:this.bootstrap.instance_id,operation_id:this.id(),kind:'workspace.create',target:{},
        expected:{workspace_revision:0,authority:copy(this.row.authority)},
        args:{id:workspace,title:this.row.form.title,purpose:this.row.form.purpose,team:[...new Set([this.bootstrap.actor,...this.row.form.team])]}};
      this.version++;await this.checkAuthority();return this.dispatch();
    });
  }
  accept(receipt) {
    const envelope=this.row.envelope;
    if(receipt?.recorded!==true||receipt.instance_id!==this.row.instanceId||receipt.operation_id!==envelope.operation_id||receipt.kind!==envelope.kind)return false;
    if(receipt.status==='committed'){
      const w=receipt.result?.workspace;
      if(Object.hasOwn(receipt,'error')||w?.id!==envelope.args.id||w.owner_id!==this.row.actor||w.title!==envelope.args.title||w.version!==1)return false;
      this.row.phase='confirmed';
    }else if(receipt.status==='rejected'&&typeof receipt.error?.code==='string'&&receipt.error.code&&typeof receipt.error.message==='string')this.row.phase='rejected';
    else return false;
    this.row.receipt=copy(receipt);this.retryAllowed=false;return true;
  }
  async dispatch() {
    await this.persist(); // Also protects explicit Retry after a storage failure.
    try {if(!this.accept(await this.api.command(copy(this.row.envelope))))this.row.phase='uncertain';}
    catch(error){this.row.phase='uncertain';this.notice=error.message;}
    this.version++;await this.persist();return this.row.phase;
  }
  check() {
    return this.perform(async()=>{
      this.owns();if(!this.row.envelope)throw Error('There is no creation to check.');await this.checkAuthority();this.retryAllowed=false;
      const receipt=await this.api.view('operation',{operation_id:this.row.envelope.operation_id},{readClass:'foreground'});
      if(!this.accept(receipt)){
        this.row.phase='uncertain';
        this.retryAllowed=same(receipt,{instance_id:this.row.instanceId,operation_id:this.row.envelope.operation_id,status:'unknown',recorded:false});
      }
      this.version++;await this.persist();return this.row.phase;
    });
  }
  retry() {
    return this.perform(async()=>{
      this.owns();if(!this.retryAllowed||this.row.phase!=='uncertain')throw Error('Check the original creation before retrying it.');
      await this.checkAuthority();this.retryAllowed=false;return this.dispatch();
    });
  }
  async leave(destination,title) {
    const previous=this.departureChoice;this.departureChoice=null;
    if(this.pending)throw Error('Wait for creation or its confirmation check to finish before leaving.');
    const version=this.version,envelope=JSON.stringify(this.row.envelope);
    if(this.writable)await this.persist();
    if(version!==this.version||this.pending||this.storageError)throw Error('The form changed while saving. Keep this page open, then choose the destination again.');
    if(this.row.phase==='uncertain'&&!(previous?.destination===destination&&previous.version===version&&previous.envelope===envelope)){
      this.departureChoice={destination,version,envelope};
      throw Error(`Creation is unconfirmed; its exact request is kept on this browser. Choose “${title}” again to leave without resolving it. Use Check confirmation when you return.`);
    }
  }
}
