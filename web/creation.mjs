const copy=structuredClone;
export const validActorId=value=>typeof value==='string'&&value.length>0&&[...value].length<=200&&!/[\x00-\x1f]/.test(value);
export const hasTitle=value=>typeof value==='string'&&/[^\t\n\v\f\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/.test(value);
export const authorityPair=value=>({authority_id:value?.authority_id,authority_epoch:value?.authority_epoch});
const same=(a,b)=>{
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
};
const bound=(row,bootstrap)=>row.instanceId===bootstrap.instance_id&&row.actor===bootstrap.actor&&
  same(authorityPair(row.authority),authorityPair(bootstrap.authority));
const base=(id,kind,bootstrap)=>({format:1,id,kind,instanceId:bootstrap.instance_id,actor:bootstrap.actor,authority:authorityPair(bootstrap.authority)});

// Outcome creation is an intent, not an editor. Its frozen public request is
// durable before dispatch. New topics are server-owned openings (opening.mjs).
export class OutcomeCreation {
  constructor({api,bootstrap,journal,intentId,id=()=>crypto.randomUUID(),changed=()=>{}}) {
    if(!validActorId(intentId))throw Error('A creation intent needs a stable identity.');
    Object.assign(this,{api,bootstrap:copy(bootstrap),journal,intentId,id,changed});
    this.pending=null;this.queue=Promise.resolve();this.retryAllowed=false;this.writable=false;this.version=0;this.savedVersion=-1;
  }
  load() {
    return this.perform(async()=>{
      this.acquiring=true;
      try {
        await this.queue;
        const writable=await this.journal.claim(this.intentId);
        // Another tab holds the form: wait for its lock to end, then load again here.
        if(!writable)this.awaitClaim();
        let row=await this.journal.get(this.intentId);
        if(!row){
          if(!writable)throw Error('This outcome form is being started in another tab. It opens here when that tab closes.');
          row={...base(this.intentId,'create',this.bootstrap),workspace:null,phase:'draft',form:{title:'',purpose:'',team:[]},envelope:null,receipt:null,history:[]};
          await this.journal.put(row);
        }
        if(row.kind!=='create'||row.instanceId!==this.bootstrap.instance_id||row.actor!==this.bootstrap.actor)throw Error('This creation belongs to a different instance or actor.');
        // Adopt the validated form before publishing ownership. The view paints
        // this row while the shared busy gate still prevents input/publication.
        this.row=row;this.parked=!bound(row,this.bootstrap);this.writable=writable;
        this.savedVersion=this.version;this.changed();return this;
      } finally {this.acquiring=false;}
    });
  }
  get readOnly(){return !this.writable||this.parked||Boolean(this.pending)||Boolean(this.row?.envelope&&this.row.phase!=='rejected');}
  get dirty(){return this.savedVersion<this.version;}
  owns(){if(this.acquiring)throw Error('The form is busy loading its current saved version.');if(!this.writable)throw Error('Open in another tab — read-only until that tab closes.');if(this.parked)throw Error('The runtime authority changed. This act is kept without rebinding.');}
  persist() {
    if(this.acquiring)return Promise.reject(Error('The form is busy loading its current saved version.'));
    const row=copy(this.row),version=this.version;
    const next=this.queue.catch(()=>{}).then(()=>this.journal.put(row)).then(()=>{this.savedVersion=Math.max(this.savedVersion,version);this.storageError=null;},error=>{this.storageError=error.message;throw error;});
    this.queue=next;return next;
  }
  async edit(patch) {
    this.owns();if(this.readOnly)throw Error('This creation is locked. Check its original confirmation.');
    this.notice=null;
    if(this.row.phase==='rejected'){
      this.row.history.push({envelope:copy(this.row.envelope),receipt:copy(this.row.receipt)});
      this.row.envelope=null;this.row.receipt=null;this.row.workspace=null;this.row.phase='draft';this.retryAllowed=false;
    }
    for(const key of ['title','purpose','team'])if(Object.hasOwn(patch,key))this.row.form[key]=copy(patch[key]);
    this.version++;this.changed();await this.persist();this.changed();
  }
  validate() {
    const {title,purpose,team}=this.row.form,limits=this.bootstrap.limits;
    if(!hasTitle(title))throw Error('Give this outcome a title before creating it.');
    if(typeof purpose!=='string'||[title,purpose].some(s=>new TextEncoder().encode(s).length>limits.body_utf8_bytes))throw Error('The title or purpose is too long.');
    if(!Array.isArray(team)||!team.every(validActorId))throw Error('Use valid known actor IDs for the team.');
    if(new Set([this.bootstrap.actor,...team]).size>limits.workspace_members)throw Error('The team limit includes the owner.');
  }
  perform(action) {
    if(this.pending)return this.pending;
    this.notice=null;
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
      await this.checkAuthority();
      const workspace=this.id();
      const envelope={v:1,instance_id:this.bootstrap.instance_id,operation_id:this.id(),kind:'workspace.create',target:{},
        expected:{workspace_revision:0,authority:copy(this.row.authority)},
        args:{id:workspace,title:this.row.form.title,purpose:this.row.form.purpose,team:[...new Set([this.bootstrap.actor,...this.row.form.team])]}};
      if(new TextEncoder().encode(JSON.stringify(envelope)).length>this.bootstrap.limits.http_envelope_bytes)throw Error('The complete creation request is too large. Shorten the title or purpose.');
      this.row.workspace=workspace;this.row.phase='uncertain';this.retryAllowed=false;this.row.envelope=envelope;
      this.version++;return this.dispatch();
    });
  }
  accept(receipt) {
    const envelope=this.row.envelope;
    if(this.row.receipt?.recorded===true&&!same(this.row.receipt,receipt))return false;
    if(receipt?.recorded!==true||receipt.instance_id!==this.row.instanceId||receipt.operation_id!==envelope.operation_id||receipt.kind!==envelope.kind)return false;
    if(receipt.status==='committed'){
      const w=receipt.result?.workspace;
      if(Object.hasOwn(receipt,'error')||w?.id!==envelope.args.id||w.owner_id!==this.row.actor||w.title!==envelope.args.title||w.version!==1)return false;
      this.row.phase='confirmed';
    }else if(receipt.status==='rejected'&&typeof receipt.error?.code==='string'&&receipt.error.code&&typeof receipt.error.message==='string')this.row.phase='rejected';
    else return false;
    this.row.receipt=copy(receipt);this.retryAllowed=false;this.notice=null;return true;
  }
  async dispatch() {
    await this.persist(); // Also protects explicit Retry after a storage failure.
    try {const receipt=await this.api.command(copy(this.row.envelope));if(!this.accept(receipt)){this.row.phase='uncertain';this.notice=receipt?.error?.message??'No matching confirmation was returned. Check the original creation.';}}
    catch(error){this.row.phase='uncertain';this.notice=error.message;}
    this.version++;await this.persist();return this.row.phase;
  }
  check() {
    return this.perform(async()=>{
      this.owns();if(!this.row.envelope)throw Error('There is no creation to check.');await this.checkAuthority();this.retryAllowed=false;
      const receipt=await this.api.view('operation',{operation_id:this.row.envelope.operation_id},{readClass:'foreground'});
      if(!this.accept(receipt)){
        const unknown=same(receipt,{instance_id:this.row.instanceId,operation_id:this.row.envelope.operation_id,status:'unknown',recorded:false});
        if(this.row.receipt?.recorded===true||!unknown)throw Error(receipt?.error?.message??'The confirmation read disagrees with the retained evidence. The original recorded result is kept.');
        this.row.phase='uncertain';this.retryAllowed=true;
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
  // The browser grants the form's lock when the tab holding it closes or
  // leaves it; this is that event, not a poll. Settles true once the form has
  // loaded here, false when the journal closed first or loading failed.
  awaitClaim() {
    this.waiting??=this.journal.claimWhenFree(this.intentId).then(async granted=>{
      this.waiting=null;
      if(!granted)return false;
      // A load still under way read the form before the grant; this one reads it after.
      await this.pending?.catch(()=>{});
      await this.load();return true;
    }).catch(error=>{this.waiting=null;this.notice=error.message;this.changed();return false;});
    return this.waiting;
  }
  // After saving on this browser failed, the person can try once more; a form
  // this tab does not hold is refused before anything is written.
  get canSaveAgain(){return Boolean(this.storageError)&&this.writable&&!this.parked&&!this.row?.envelope;}
  saveAgain() {return this.perform(()=>{this.owns();return this.persist();});}
  async leave(destination,title) {
    const previous=this.departureChoice;this.departureChoice=null;
    if(this.pending)throw Error('Wait for creation or its confirmation check to finish before leaving.');
    const version=this.version,envelope=JSON.stringify(this.row.envelope);
    if(this.writable&&!this.parked)await this.persist();
    if(version!==this.version||this.pending||this.writable&&this.storageError)throw Error('The form changed while saving. Keep this page open, then choose the destination again.');
    if(this.row.phase==='uncertain'&&!(previous?.destination===destination&&previous.version===version&&previous.envelope===envelope)){
      this.departureChoice={destination,version,envelope};
      throw Error(`Creation is unconfirmed; its exact request is kept on this browser. Choose “${title}” again to leave without resolving it. Use Check confirmation when you return.`);
    }
  }
}
