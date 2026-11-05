import { hasTitle, validActorId } from './creation.mjs';
import { imageTypes } from './upload-state.mjs';

// A new topic is one actor-private opening owned by Core: saved whole with its
// expected revision and published once. This device keeps only writing Core has
// not acknowledged and the exact publish envelope it has sent or is about to send.
const copy=structuredClone;
const fields=['title','participants','body','attachments'];
const realTimers={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)};
const digest=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join('');
export const blankWriting=()=>({title:'',participants:[],body:'',attachments:[]});
export const writingOf=value=>Object.fromEntries(fields.map(key=>[key,copy(value[key])]));
export const sameWriting=(a,b)=>JSON.stringify(writingOf(a))===JSON.stringify(writingOf(b));
const validWriting=w=>Boolean(w&&typeof w.title==='string'&&typeof w.body==='string'&&Array.isArray(w.participants)&&
  w.participants.every(validActorId)&&Array.isArray(w.attachments)&&w.attachments.every(ref=>validActorId(ref?.id)));

export function checkedOpening(answer,{instanceId,opening,workspace,topic}) {
  const o=answer?.opening;
  if(answer?.instance_id!==instanceId||!o||o.id!==opening||o.workspace_id!==workspace||o.topic_id!==topic||!Number.isInteger(o.revision)||o.revision<1||
      !['open','published','discarded'].includes(o.state)||!validWriting(o))throw Error('The saved opening does not match this link.');
  return {...writingOf(o),revision:o.revision,state:o.state,publish_operation_id:o.publish_operation_id??null,receipt:copy(answer.publish_receipt??null)};
}

export class OpeningDraft {
  constructor({api,bootstrap,store,workspace,opening,topic,id=()=>crypto.randomUUID(),timers=realTimers,saveDelayMs=450,maxSaveDelayMs=2000,changed=()=>{},published=()=>{}}) {
    if(![workspace,opening,topic].every(validActorId))throw Error('This opening link is incomplete. Open the outcome and choose New topic.');
    if(!bootstrap?.instance_id||!bootstrap.actor||!bootstrap.authority?.authority_id||!bootstrap.limits)throw Error('A confirmed instance, actor and authority are required.');
    if(!(saveDelayMs>0&&maxSaveDelayMs>=saveDelayMs))throw Error('Saves need bounded idle and maximum delays.');
    Object.assign(this,{api,bootstrap:copy(bootstrap),store,workspace,opening,topic,id,timers,saveDelayMs,maxSaveDelayMs,changed,published});
    this.phase='loading';this.writing=blankWriting();this.base=0;this.localVersion=0;this.savedVersion=0;this.keptVersion=0;
    this.conflict=null;this.publish=null;this.receipt=null;this.refusal=null;this.notice=null;this.leftover=null;this.pendingSave=null;
    this.saving=false;this.saveQueue=Promise.resolve();this.timer=null;this.persisting=Promise.resolve();this.persistQueued=null;this.persistCount=0;
    this.storageError=null;this.media=new Map();this.members=[];this.membersNext=null;this.departure=null;this.discarding=false;
  }
  get dirty(){return this.localVersion>this.savedVersion;}
  get editable(){return this.phase==='editing'&&!this.discarding;}
  get status(){return this.saving?'Saving':!this.dirty&&!this.conflict&&!this.pendingSave&&this.base>0?'Saved':'Not saved yet';}
  get device(){
    if(!this.dirty&&!this.conflict&&!this.publish&&!this.leftover)return '';
    if(this.storageError)return 'Not kept on this device — keep this page open. '+this.storageError;
    return this.persistCount||this.keptVersion<this.localVersion?'Keeping on this device…':'Kept on this device only';
  }
  get unprotected(){return this.phase==='sending'||this.persistCount>0||[...this.media.values()].some(m=>m.state==='uploading')||
    Boolean(this.storageError&&(this.dirty||this.conflict||this.publish))||this.unlisted;}
  // Core lists an opening only once it has saved one; until then nothing leads back to this writing.
  get unlisted(){return ['editing','taken'].includes(this.phase)&&this.base===0&&Boolean(this.dirty||this.pendingSave);}

  envelope(kind,expected,args,target={opening_id:this.opening},operation=this.id()) {
    const {authority_id,authority_epoch}=this.bootstrap.authority;
    return {v:1,instance_id:this.bootstrap.instance_id,operation_id:operation,kind,target,expected:{...expected,authority:{authority_id,authority_epoch}},args};
  }
  exact(receipt,envelope){return receipt?.recorded===true&&receipt.instance_id===this.bootstrap.instance_id&&receipt.operation_id===envelope.operation_id&&receipt.kind===envelope.kind;}
  row(){
    return {format:1,instanceId:this.bootstrap.instance_id,actor:this.bootstrap.actor,opening:this.opening,workspace:this.workspace,topic:this.topic,base:this.base,
      writing:this.dirty||this.conflict?copy(this.writing):this.leftover?copy(this.leftover):null,publish:this.publish?{envelope:copy(this.publish.envelope)}:null,
      save:this.pendingSave?{envelope:copy(this.pendingSave.envelope)}:null};
  }
  // An envelope captured under a replaced authority can never be accepted again.
  current(envelope){const a=envelope?.expected?.authority,b=this.bootstrap.authority;return a?.authority_id===b.authority_id&&a.authority_epoch===b.authority_epoch;}
  // Writes are serialized; a queued write captures the newest state when it runs.
  persist() {
    if(this.persistQueued)return this.persistQueued;
    ++this.persistCount;
    const next=this.persisting.catch(()=>{}).then(async()=>{
      this.persistQueued=null;
      const version=this.localVersion,row=this.row();
      try {
        await (row.writing||row.publish||row.save?this.store.put(row):this.store.remove(this.opening));
        this.keptVersion=Math.max(this.keptVersion,version);this.storageError=null;
      } catch(error){this.storageError=error.message;throw error;}
      finally{--this.persistCount;this.changed();}
    });
    this.persistQueued=next;this.persisting=next;return next;
  }

  async read() {
    const answer=await this.api.view('opening',{opening_id:this.opening},{readClass:'foreground'});
    // Opening IDs belong to their actor: Core holds nothing here until the first save.
    if(answer?.instance_id===this.bootstrap.instance_id&&answer.error?.code==='FORBIDDEN')return null;
    if(answer?.error)throw Object.assign(Error(answer.error.message??answer.error.code),{details:answer});
    return checkedOpening(answer,{instanceId:this.bootstrap.instance_id,opening:this.opening,workspace:this.workspace,topic:this.topic});
  }
  async load() {
    this.cancelSave();this.phase='loading';this.notice=null;this.changed();
    try {
      const [server,row]=await Promise.all([this.read(),this.store.get(this.opening)]);
      if(row&&(row.workspace!==this.workspace||row.topic!==this.topic||row.writing!==null&&!validWriting(row.writing)))throw Error('Writing kept on this device for this opening does not match this link. It has been kept.');
      await this.adopt(server,row);
    } catch(error){this.phase='error';this.notice=error.message;throw error;}
    finally{this.changed();}
    this.checkMedia();
    return this.phase;
  }
  async adopt(server,row) {
    this.base=server?.revision??0;this.writing=server?writingOf(server):blankWriting();this.receipt=server?.receipt??null;
    this.localVersion=this.savedVersion=this.keptVersion=0;this.conflict=this.publish=this.leftover=this.pendingSave=null;this.media.clear();
    const kept=row?.writing??null,unacknowledged=kept&&!sameWriting(kept,this.writing);
    if(server&&server.state!=='open'){
      this.phase=server.state;
      // Writing this device never got acknowledged stays visible until removed.
      if(unacknowledged)this.leftover=copy(kept);
      if(row&&(!unacknowledged||row.publish))await this.persist().catch(()=>{});
      return;
    }
    this.phase=row?.publish?'unknown':'editing';
    if(row?.publish)this.publish={envelope:copy(row.publish.envelope)};
    if(unacknowledged){
      this.writing=copy(kept);this.localVersion=this.keptVersion=1;
      const lost=row.save?.envelope;
      if(lost?.kind==='opening.save'&&lost.target?.opening_id===this.opening&&lost.expected?.opening_revision===row.base&&this.current(lost)){
        // A save whose answer was lost is re-sent first with its operation ID;
        // its receipt settles whether Core's newer revision is this device's own.
        this.base=row.base;this.pendingSave={version:sameWriting(kept,lost.args)?1:0,envelope:copy(lost)};
        if(this.phase==='editing')this.schedule();
      }
      // Newer than the revision it was based on: restore it. Otherwise Core
      // moved on elsewhere; keep both sides visible for the person to choose.
      else if(row.base===this.base){if(this.phase==='editing')this.schedule();}
      else{this.conflict={remote:server?{...writingOf(server),revision:server.revision}:null};this.base=row.base;}
    } else if(row&&(kept||row.base!==this.base))await this.persist().catch(()=>{});
  }
  async refresh() {
    if(['loading','sending'].includes(this.phase)||this.discarding)return this.phase;
    if([...this.media.values()].some(m=>m.state==='uploading'))throw Error('Wait for the image upload to finish before refreshing.');
    const unsafe=()=>(this.dirty||this.conflict)&&this.storageError;
    if(unsafe())throw Error('Keep this page open: your writing is not saved to Theseus or kept on this device.');
    const phase=this.phase;this.cancelSave();this.phase='loading';this.changed();
    await this.saveQueue;await this.persisting.catch(()=>{});
    if(unsafe()){this.phase=phase;this.changed();throw Error('Keep this page open: your writing is not saved to Theseus or kept on this device.');}
    return this.load();
  }

  edit(patch) {
    if(!this.editable)throw Error(this.phase==='unknown'?'Check the unconfirmed send before changing this opening.':'This opening cannot be changed now.');
    if(!patch||Object.keys(patch).some(key=>!fields.includes(key)))throw Error('Only the title, participants, message and images can change.');
    const next={...this.writing,...copy(patch)};
    if(!validWriting(next))throw Error('This change is not valid opening writing.');
    this.writing=next;this.localVersion++;this.refusal=null;
    this.persist().catch(()=>{});
    if(!this.conflict)this.schedule();
    this.changed();
  }
  setParticipants(ids) {
    const limit=this.bootstrap.limits.topic_participants-1;
    if(!Array.isArray(ids)||!ids.every(validActorId)||new Set(ids).size!==ids.length||ids.includes(this.bootstrap.actor))throw Error('Choose each participant once; you are already included.');
    if(ids.length>limit)throw Error('The participant limit includes you. Remove someone before adding another.');
    this.edit({participants:ids});
  }
  schedule() {
    if(this.timer)this.timers.clearTimeout(this.timer.idle);
    else this.timer={maximum:this.timers.setTimeout(()=>this.save(),this.maxSaveDelayMs)};
    this.timer.idle=this.timers.setTimeout(()=>this.save(),this.saveDelayMs);
  }
  cancelSave() {
    if(!this.timer)return;
    this.timers.clearTimeout(this.timer.idle);this.timers.clearTimeout(this.timer.maximum);this.timer=null;
  }
  save() {
    this.cancelSave();
    const next=this.saveQueue.then(()=>this.saveOnce());this.saveQueue=next;return next;
  }
  // One request per call. An attempt whose answer was lost is re-sent exactly
  // before any newer writing, so its operation ID settles what Core recorded.
  async saveOnce() {
    if(this.conflict||!['editing','sending'].includes(this.phase))return;
    if(!this.pendingSave){
      if(!this.dirty)return;
      this.pendingSave={version:this.localVersion,envelope:this.envelope('opening.save',{opening_revision:this.base},
        {workspace_id:this.workspace,topic_id:this.topic,...writingOf(this.writing)})};
    }
    const entry=this.pendingSave;this.saving=true;this.changed();
    try{await this.acceptSave(entry,await this.api.command(copy(entry.envelope)));}
    catch(error){
      this.notice='Not saved to Theseus. '+error.message;
      await this.persist().catch(()=>{}); // The exact save stays on this device, so a reload re-sends it first.
    }
    finally{this.saving=false;this.changed();}
  }
  async acceptSave(entry,receipt) {
    const error=receipt?.error;
    if(this.exact(receipt,entry.envelope)&&receipt.status==='committed'){
      const r=receipt.result;
      if(r?.opening_id!==this.opening||r.state!=='open'||r.opening_revision!==entry.envelope.expected.opening_revision+1)throw Error('The save confirmation does not match this opening. Your writing is kept.');
      this.pendingSave=null;this.notice=null;this.base=r.opening_revision;this.savedVersion=Math.max(this.savedVersion,entry.version);
      if(this.dirty&&this.phase==='editing')this.schedule();
      await this.persist().catch(()=>{});return;
    }
    if(this.exact(receipt,entry.envelope)&&receipt.status==='rejected'){
      this.pendingSave=null;
      if(error?.code==='REVISION_CONFLICT')return this.readConflict();
      if(error?.code==='OPENING_CLOSED')return this.closedElsewhere(error.message);
      this.notice=(error?.message??'This save was refused.')+' Your writing is kept; change it to save again.';
      await this.persist().catch(()=>{});return;
    }
    // Nothing recorded. Only an invalid request is certain to fail again exactly.
    if(receipt?.instance_id===this.bootstrap.instance_id&&receipt.operation_id===entry.envelope.operation_id&&receipt.recorded===false&&error?.code==='INVALID_ARGUMENT')this.pendingSave=null;
    this.notice=error?.code==='AUTHORITY_CHANGED'?'The runtime changed. Reload this page; your writing is kept on this device.':'Not saved to Theseus. '+(error?.message??'The save is not confirmed.');
    await this.persist().catch(()=>{});
  }
  async readConflict() {
    this.cancelSave();this.conflict={remote:undefined};this.changed();
    try {
      const server=await this.read();
      if(server&&server.state!=='open')return this.closedElsewhere('This opening was already '+server.state+' elsewhere.');
      if(!server&&this.base===0){
        // A first save refused while Core holds no opening here: this link's topic
        // identity is already used, so it can never start a topic. Saving over it again would loop.
        this.conflict=null;this.phase='taken';await this.persist().catch(()=>{});this.changed();return;
      }
      this.conflict={remote:server?{...writingOf(server),revision:server.revision}:null};
    } catch(error){this.conflict={remote:undefined,message:error.message};}
    await this.persist().catch(()=>{});this.changed();
  }
  async closedElsewhere(message) {
    this.refusal=message;
    await this.persisting.catch(()=>{});
    if(!this.storageError)await this.load().catch(()=>{});
  }
  async resolve(choice) {
    const remote=this.conflict?.remote;
    if(!this.editable||remote===undefined)throw Error('Read the saved version before choosing.');
    if(choice==='mine'){
      // Save over exactly the revision the person was shown; a newer one conflicts again.
      this.base=remote?.revision??0;this.conflict=null;this.savedVersion=Math.min(this.savedVersion,this.localVersion-1);
      await this.persist().catch(()=>{});this.changed();return this.save();
    }
    if(choice!=='server'||!remote)throw Error('Choose your writing or the saved version.');
    this.writing=writingOf(remote);this.base=remote.revision;this.localVersion++;this.savedVersion=this.localVersion;this.conflict=null;
    await this.persist().catch(()=>{});this.changed();this.checkMedia();
  }
  async retryConflictRead() {
    if(!this.conflict||this.conflict.remote!==undefined)return;
    await this.readConflict();
  }

  sendProblem() {
    const w=this.writing;
    if(!hasTitle(w.title))return 'Give this topic a title before sending.';
    if(!w.body.trim()&&!w.attachments.length)return 'Write the opening message or attach an image before sending.';
    if(w.participants.length>this.bootstrap.limits.topic_participants-1)return 'The participant limit includes you. Remove someone before sending.';
    const waiting=w.attachments.map(ref=>this.media.get(ref.id)??{name:'attachment'}).find(m=>m.state!=='ready');
    if(waiting)return `Finish or remove the image ${waiting.name} before sending.`;
    if([...this.media.values()].some(m=>m.state==='uploading'))return 'Wait for the image upload to finish before sending.';
    return null;
  }
  async send() {
    if(!this.editable)throw Error(this.phase==='unknown'?'Check the earlier send, or Send again with its identical request.':'This opening cannot be sent now.');
    if(this.conflict)throw Error('Choose your writing or the saved version before sending.');
    const problem=this.sendProblem();if(problem)throw Error(problem);
    this.phase='sending';this.refusal=null;this.notice=null;this.changed();
    try {
      const settling=this.pendingSave;await this.save();
      // A re-sent lost save settled first; the newer writing it predates saves now.
      if(settling&&this.phase==='sending'&&this.dirty&&!this.conflict&&!this.pendingSave)await this.save();
      // Closed elsewhere, or no longer able to start a topic: read again, nothing to publish.
      if(this.phase!=='sending')return this.phase;
      if(this.dirty||this.conflict||this.pendingSave||this.base<1)throw Error(this.notice??'Your writing is not saved to Theseus yet. It is kept; Send again when it is saved.');
      this.publish={envelope:this.envelope('opening.publish',{opening_revision:this.base},{})};
      await this.persist(); // The exact envelope is durable here before it is dispatched.
    } catch(error){
      this.publish=null;if(this.phase==='sending')this.phase='editing';this.changed();throw error;
    }
    return this.dispatch();
  }
  async dispatch() {
    this.phase='sending';this.notice=null;this.changed();
    let receipt;
    try{receipt=await this.api.command(copy(this.publish.envelope));}
    catch(error){this.phase='unknown';this.notice=error.message;this.changed();return 'unknown';}
    return this.acceptPublish(receipt);
  }
  async acceptPublish(receipt) {
    const envelope=this.publish.envelope;
    if(this.exact(receipt,envelope)&&receipt.status==='committed'){
      const r=receipt.result;
      if(r?.opening_id!==this.opening||r.topic?.id!==this.topic||!validActorId(r.message_id)||!Number.isInteger(r.opening_revision)||r.opening_revision<envelope.expected.opening_revision){
        this.phase='unknown';this.notice='The confirmation does not match this opening. Its request is kept; Check again.';this.changed();return 'unknown';
      }
      this.receipt=copy(receipt);this.phase='published';this.publish=null;
      await this.persist().catch(()=>{});this.changed();
      await this.published(copy(receipt));return 'published';
    }
    if(this.exact(receipt,envelope)&&receipt.status==='rejected'&&typeof receipt.error?.message==='string'){
      // A recorded refusal changed nothing. The next Send is a new operation.
      this.publish=null;this.phase='editing';this.refusal=receipt.error.message;
      await this.persist().catch(()=>{});
      if(['OPENING_CLOSED','REVISION_CONFLICT'].includes(receipt.error.code))await this.load().catch(()=>{});
      this.changed();return 'refused';
    }
    this.phase='unknown';
    this.notice=receipt?.error?.code==='AUTHORITY_CHANGED'?'The runtime changed. Reload this page, then Check this send.':receipt?.error?.message??'Sending is not confirmed.';
    this.changed();return 'unknown';
  }
  async check() {
    if(this.phase!=='unknown'||!this.publish)throw Error('There is no unconfirmed send to check.');
    const op=this.publish.envelope.operation_id,answer=await this.api.view('operation',{operation_id:op},{readClass:'foreground'});
    if(answer?.recorded===true)return this.acceptPublish(answer);
    if(answer?.instance_id===this.bootstrap.instance_id&&answer.operation_id===op&&answer.recorded===false&&answer.status==='unknown'){
      if(!this.current(this.publish.envelope)){
        // Never recorded, and captured under an authority this runtime replaced:
        // Core can never accept it. Return to editing; the next Send is a new operation.
        this.publish=null;this.phase='editing';this.notice='Theseus has no record of this send, and it was restored since. Send again to send this opening now.';
        await this.persist().catch(()=>{});this.changed();return 'editing';
      }
      this.notice='Theseus has no record of this send. Send again sends the identical request.';this.changed();return 'unknown';
    }
    throw Error(answer?.error?.message??'The send confirmation could not be read.');
  }
  sendAgain() {
    if(this.phase!=='unknown'||!this.publish)throw Error('There is no unconfirmed send to repeat.');
    return this.dispatch();
  }

  async discard() {
    if(!this.editable)throw Error('Only an unsent opening can be discarded.');
    if(this.conflict)throw Error('Choose your writing or the saved version before discarding.');
    this.cancelSave();this.discarding=true;this.notice=null;this.changed();
    try {
      if(this.pendingSave){await this.save();if(this.pendingSave)throw Error('An earlier save is not confirmed. Retry before discarding.');}
      if(this.conflict)throw Error('This opening changed elsewhere. Choose a version before discarding.');
      if(this.base>0){
        const envelope=this.envelope('opening.discard',{opening_revision:this.base},{}),receipt=await this.api.command(envelope);
        if(!this.exact(receipt,envelope)||receipt.status!=='committed'||receipt.result?.opening_id!==this.opening||receipt.result.state!=='discarded'){
          throw Error((receipt?.error?.message??'Discarding is not confirmed.')+' The opening is kept; Refresh shows its current state.');
        }
      }
      this.phase='discarded';this.savedVersion=this.localVersion;this.leftover=null;this.publish=null;
      await this.persist();
      return 'discarded';
    } finally{this.discarding=false;this.changed();}
  }
  async removeLeftover() {
    if(!['published','discarded'].includes(this.phase))throw Error('Only writing left from a closed opening can be removed.');
    this.leftover=null;await this.persist();
  }
  async leave(destination,title) {
    const previous=this.departure;this.departure=null;
    if(this.phase==='sending'||this.discarding)throw Error('Wait for Send to finish before leaving.');
    if([...this.media.values()].some(m=>m.state==='uploading'))throw Error('Wait for the image upload to finish, or remove it, before leaving.');
    if(this.editable&&!this.conflict&&(this.dirty||this.pendingSave))await this.save();
    await this.persisting.catch(()=>{});
    if((this.dirty||this.conflict||this.publish||this.leftover)&&this.storageError)throw Error('Keep this page open: your writing is not saved to Theseus or kept on this device.');
    if(this.phase==='unknown'&&previous!==destination){
      this.departure=destination;
      throw Error(`Sending is not confirmed; its exact request is kept on this device. Choose “${title}” again to leave without resolving it, and Check when you return.`);
    }
    if(this.unlisted&&previous!==destination){
      this.departure=destination;
      throw Error(`This topic is not saved to Theseus yet, so no page will list it; its writing is kept on this device only. Choose “${title}” again to leave it here.`);
    }
  }
  // Writing on a link whose topic identity is taken moves to a new opening with
  // fresh IDs; that opening restores it from this device and saves it as usual.
  async relocate() {
    if(this.phase!=='taken'||!this.dirty)throw Error('Only writing on a link that can no longer start a topic can move.');
    const opening=this.id(),topic=this.id();
    await this.store.put({...this.row(),opening,topic,base:0,writing:copy(this.writing),publish:null,save:null});
    this.savedVersion=this.localVersion;await this.persist();this.changed();
    return {kind:'opening',workspace:this.workspace,opening,topic};
  }

  // Image adapter over the existing media commands. Bytes stay in memory until
  // Core confirms them ready; the opening keeps only {id} references.
  async attach(file) {
    if(!this.editable||this.conflict)throw Error('Choose a version before adding an image.');
    const l=this.bootstrap.limits;
    if(!(file instanceof Blob)||!Number.isInteger(file.size)||file.size<1)throw Error('An empty image cannot be attached.');
    if(!imageTypes.has(file.type))throw Error('Choose a PNG, JPEG, GIF or WebP image.');
    if(!file.name||new TextEncoder().encode(file.name).length>l.media_name_utf8_bytes)throw Error('The image name is too long or empty.');
    if(file.size>l.image_bytes)throw Error('This image exceeds the attachment size limit.');
    const count=new Set([...this.writing.attachments.map(ref=>ref.id),...[...this.media].filter(([,m])=>m.state==='uploading').map(([id])=>id)]).size;
    if(count>=l.attachment_count)throw Error('Remove an image before adding another.');
    const mediaId=this.id(),entry={name:file.name,state:'uploading',message:'',file};
    this.media.set(mediaId,entry);this.changed();
    try {
      const sha256=await digest(file),publishId=this.id(),target={media_id:mediaId};
      const begin=this.envelope('media.begin',{media_revision:0},{name:file.name,content_type:file.type,size_bytes:file.size,sha256,publish_operation_id:publishId},target);
      const begun=await this.api.command(begin);
      if(!this.exact(begun,begin)||begun.status!=='committed'||begun.result?.media_id!==mediaId||begun.result.media_revision!==1)throw Error(begun?.error?.message??'The image upload could not be started.');
      if(this.media.get(mediaId)!==entry)return null;
      entry.upload={envelope:this.envelope('media.publish',{media_revision:1},{},target,publishId),sha256};
      this.edit({attachments:[...this.writing.attachments,{id:mediaId}]});
      await this.upload(mediaId,entry);
      return mediaId;
    } catch(error){if(this.media.get(mediaId)===entry){entry.state='failed';entry.message=error.message;}throw error;}
    finally{this.changed();}
  }
  async upload(mediaId,entry) {
    entry.state='uploading';entry.message='';this.changed();
    const done=await this.api.upload(copy(entry.upload.envelope),entry.file),d=done?.result;
    if(!this.exact(done,entry.upload.envelope)||done.status!=='committed'||d?.media_id!==mediaId||d.state!=='ready'||d.media_revision!==2||
        d.sha256!==entry.upload.sha256||d.size_bytes!==entry.file.size)throw Error(done?.error?.message??'The image upload is not confirmed.');
    if(this.media.get(mediaId)===entry)Object.assign(entry,{state:'ready',message:'',file:null,upload:null,descriptor:copy(d)});
  }
  async retryUpload(mediaId) {
    const entry=this.media.get(mediaId);
    if(!entry?.upload||!entry.file||entry.state!=='failed')throw Error('This image cannot be retried here. Remove it and choose the file again.');
    try{await this.upload(mediaId,entry);}
    catch(error){if(this.media.get(mediaId)===entry){entry.state='failed';entry.message=error.message;}throw error;}
    finally{this.changed();}
  }
  detach(mediaId) {
    if(!this.editable)throw Error('This opening cannot be changed now.');
    this.media.delete(mediaId);
    if(this.writing.attachments.some(ref=>ref.id===mediaId))this.edit({attachments:this.writing.attachments.filter(ref=>ref.id!==mediaId)});
    else this.changed();
  }
  checkMedia() {
    for(const {id} of this.writing.attachments){
      if(this.media.has(id))continue;
      const entry={name:'Image',state:'checking',message:''};this.media.set(id,entry);
      this.api.view('media',{media_id:id},{readClass:'foreground'}).then(answer=>{
        if(answer?.instance_id!==this.bootstrap.instance_id||answer.media_id!==id||answer.error)throw Error(answer?.error?.message??'This image could not be checked.');
        Object.assign(entry,{name:answer.name,state:answer.state==='ready'?'ready':'pending',
          message:answer.state==='ready'?'':'Its upload did not finish on this page. Remove it and choose the file again.',descriptor:copy(answer)});
      }).catch(error=>{entry.state='unavailable';entry.message=error.message;}).finally(()=>this.changed());
    }
  }

  async loadMembers(more=false) {
    const cursor=more?this.membersNext:null;
    if(more&&cursor===null)return;
    const answer=await this.api.view('workspace_members',{workspace_id:this.workspace,limit:50,...(cursor===null?{}:{cursor})},{readClass:'foreground'});
    if(answer?.error)throw Object.assign(Error(answer.error.message??answer.error.code),{details:answer});
    if(answer?.instance_id!==this.bootstrap.instance_id||!Array.isArray(answer.items)||!(answer.next_cursor===null||validActorId(answer.next_cursor))||
        !answer.items.every(m=>validActorId(m?.actor_id)&&typeof m.kind==='string'&&typeof m.name==='string')||
        answer.next_cursor!==null&&answer.next_cursor!==answer.items.at(-1)?.actor_id)throw Error('The outcome members could not be confirmed.');
    const known=new Set(more?this.members.map(m=>m.actor_id):[]);
    this.members=[...(more?this.members:[]),...answer.items.filter(m=>!known.has(m.actor_id)).map(m=>copy(m))];
    this.membersNext=answer.next_cursor;this.changed();
  }
}

// The person's unfinished openings in one outcome, as Core lists them.
export class OpeningPages {
  constructor(instanceId,workspace){Object.assign(this,{instanceId,workspace});this.items=[];this.next=null;this.started=false;}
  accept(answer,cursor=null) {
    if(cursor!==null&&(!this.started||cursor!==this.next))return false;
    const ids=new Set(cursor===null?[]:this.items.map(item=>item.id));
    if(answer?.instance_id!==this.instanceId||!Array.isArray(answer.items)||!(answer.next_cursor===null||validActorId(answer.next_cursor))||
        !answer.items.every(item=>validActorId(item?.id)&&!ids.has(item.id)&&ids.add(item.id)&&item.workspace_id===this.workspace&&validActorId(item.topic_id)&&
          Number.isInteger(item.revision)&&item.revision>=1&&typeof item.title==='string'&&typeof item.title_truncated==='boolean')||
        answer.next_cursor!==null&&answer.next_cursor!==answer.items.at(-1)?.id)throw Error('The unfinished topic list could not be confirmed. Retry.');
    this.items=[...(cursor===null?[]:this.items),...answer.items.map(item=>copy(item))];this.next=answer.next_cursor;this.started=true;return true;
  }
}
