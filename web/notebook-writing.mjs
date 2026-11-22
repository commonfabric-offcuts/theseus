import { parseDeck, deckBody, cardText, applyAct, findCard } from './deck.mjs';
const copy = structuredClone;
const same = (a, b) => a === b || Boolean(a && b && typeof a === 'object' && typeof b === 'object' &&
  Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every(key => Object.hasOwn(b,key) && same(a[key],b[key])));
// A page's content: its words and what they carry, and its draft mark (docs/notebook-pages.md, "A draft page"),
// which the writing keeps, merges and saves as it does the words. Writing kept on a device before the mark
// existed holds no mark: it reads as unmarked.
const FIELDS = ['title','body','attachments','references','draft'];
const field = (content,key) => key === 'draft' ? content[key] === true : content[key];
export const sameContent = (a,b) => Boolean(a && b && FIELDS.every(key=>same(field(a,key),field(b,key))));
function mergeFields(fields,base,mine,theirs,result) {
  for(const key of fields) {
    if(same(field(mine,key),field(base,key)))result[key]=copy(field(theirs,key));
    else if(same(field(theirs,key),field(base,key))||same(field(theirs,key),field(mine,key)))result[key]=copy(field(mine,key));
    else return null;
  }
  return result;
}
const mergeTextContent = (base,mine,theirs) => mergeFields(FIELDS,base,mine,theirs,{});
const content = source => ({ title: source.title, body: source.body ?? '',
  attachments: source.attachments.map(({ id }) => ({ id })), references: copy(source.references), draft: source.draft === true });
const authority = bootstrap => ({ authority_id: bootstrap.authority.authority_id, authority_epoch: bootstrap.authority.authority_epoch });
export function notebookActionEnvelope(bootstrap, item, state, kind, args) {
  return { v: 1, instance_id: bootstrap.instance_id, operation_id: crypto.randomUUID(), kind, target: { item_id: item }, args: copy(args),
    expected: { authority: authority(bootstrap), ...(kind === 'memory.star' ? { star_revision: state.star_revision ?? 0 } : { item_revision: state.source_ref.revision }),
      ...(kind==='memory.copy'?{copy_revision:0}:{}) } };
}
const transferring=kind=>['memory.move','memory.copy','memory.transfer.undo'].includes(kind);
export const NOTEBOOK_UNDO_MS = 10 * 60 * 1000;
const readOnly = new Set(['FORBIDDEN', 'OUTCOME_REACHED', 'AUTHORITY_CHANGED', 'PAGE_DELETED']);

// The one revision stream behind Text and Cards. The journal owns only local,
// writing and temporary Undo targets. Core owns the page and every confirmed revision.
export class NotebookWriting {
  constructor({ item, bootstrap, api, store, changed = () => {}, reconcile = () => null, localActive = () => false, delay = 600 }) {
    Object.assign(this, { item, bootstrap, api, store, changed, reconcile, localActive, delay });
    this.base = null; this.value = null; this.pending = null; this.conflict = null;
    this.error = null; this.readOnly = false; this.running = null; this.timer = null;
    this.active = false; this.closed = false; this.serial = Promise.resolve(); this.localVersion = 0; this.images = [];
    // described: each attachment as Core last described it this visit, so one taken off the page and put back on it
    // (Undo after × in a card) is described as before once the revision carrying it is saved.
    this.described = new Map();
    this.journalPending = 0; this.journalError = null;
    // reading: Core does not let this person write the page (its reader_may_write), so nothing new is written
    // here; writing already kept on this device still goes, and Core answers it.
    this.deleteUndo = null; this.actionKept = null;
    this.reading = false; this.actionPending = null; this.actionRunning = null; this.pageState = null; this.deleted = false;
  }
  get dirty() { return Boolean(this.value && !sameContent(this.value, this.base?.content)); }
  get hasLocal() { return this.dirty || this.localActive(); }
  get busy() { return Boolean(this.running || this.pending || this.actionRunning || this.actionPending); }
  get binding() { return { instance_id: this.bootstrap.instance_id, actor_id: this.bootstrap.actor, item_id: this.item }; }
  snapshot() {
    if (!this.deleteUndo && !this.dirty && !this.pending && !this.actionPending && !this.conflict && !this.images.some(image => !image.removed && !image.associated)) return null;
    // Bytes are immutable and held separately by the store. Do not clone a
    // pending photograph every time a single character changes.
    const images = this.images.map(({bytes, ...image}) => ({...copy(image), bytes}));
    return { ...copy({ v: 1, binding: this.binding, base: this.base, value: this.value, pending: this.pending,
      conflict: this.conflict, actionPending: this.actionPending, deleteUndo: this.deleteUndo, actionError:this.actionError, pageState:this.pageState, localVersion: this.localVersion }), images };
  }
  persist() {
    const snapshot = this.snapshot();
    this.journalPending++;
    const next = this.serial.catch(() => {}).then(() => (snapshot === null && this.store.delete ? this.store.delete() : this.store.put(snapshot)))
      .then(result => {this.journalError=null;return result;}, error=>{this.journalError=error.message;throw error;})
      .finally(()=>{this.journalPending--;this.notify();});
    this.serial = next;
    return next;
  }
  notify() { this.changed(this); }
  async read() {
    const source = await this.api.view('memory_current', { item_id: this.item });
    if (source.instance_id !== this.bootstrap.instance_id || source.source_ref?.kind !== 'memory' ||
        source.source_ref.id !== this.item || !Number.isInteger(source.source_ref.revision)) throw Error('This is not the requested Notebook page.');
    // Each read of the page as it stands says whether Core lets this person write it now (refresh, a newer
    // revision answering a save, Discard my writing): no path that takes the latest page back can miss it.
    this.observe(source);
    return { revision: source.source_ref.revision, content: content(source), source };
  }
  async readStatus() {
    if(this.closed||this.pending||this.running||this.actionPending||this.actionRunning)return;
    const state=await this.api.view('memory_status',{item_id:this.item});
    if(state.instance_id!==this.bootstrap.instance_id||state.source_ref?.kind!=='memory'||state.source_ref.id!==this.item||
        !Number.isSafeInteger(state.source_ref.revision))throw Error('The page status could not be confirmed.');
    this.observe(state);this.notify();
  }
  async open(beforeRetry = async () => {}) {
    const held = await this.store.get();
    if (held) {
      if (held.v !== 1 || !same(held.binding, this.binding)) throw Error('The saved writing belongs to a different Notebook page.');
      Object.assign(this, copy({ base: held.base, value: held.value, pending: held.pending,
        conflict: held.conflict, actionPending: held.actionPending ?? null, deleteUndo: held.deleteUndo ?? null, actionError:held.actionError??null, localVersion: held.localVersion, images: held.images ?? [] }));
      if(held.pageState??held.base?.source)this.observe(held.pageState??held.base.source);
      // Refusals are scoped to this opening. A fresh bootstrap and a new
      // revision-fenced request decide access again, including old v1 journals.
    }
    await beforeRetry(this);
    if (this.actionPending) await this.retryAction();
    if (this.deleteUndo?.undoRequested) await this.finishDeleteUndo();
    if (this.pending) await this.flush();
    await this.refresh();
    if (this.dirty && !this.pending && !this.actionPending && !this.conflict && !this.readOnly) this.schedule();
    this.notify();
  }
  capture() { return {revision:this.base?.revision,content:copy(this.value)}; }
  edit(patch, seen, mode = 'text', acts = []) {
    // A caller must name the content it actually edited. In particular an
    // empty, not-yet-drawn surface must never borrow the current revision.
    if (!seen?.content || !Number.isInteger(seen.revision) || !this.value || this.readOnly || this.reading || this.deleted || this.actionPending || this.actionRunning || this.closed) return false;
    const next = { ...seen.content, ...copy(patch) };
    if (sameContent(next, seen.content)) return false;
    let merged;
    if(sameContent(seen.content,this.value)) merged=next;
    else if(mode==='cards' && acts.length && applyCardActs(seen.content.body,acts)===next.body) {
      // Structural gestures retain their card identity across a delayed redraw.
      const body=rebaseCardActs(seen.content.body,this.value.body,acts);
      merged=body===null?null:mergeTextContent({...seen.content,body},{...next,body},{...this.value,body});
    } else merged=(mode === 'cards' ? mergeCardContent : mergeTextContent)(seen.content,next,this.value);
    if(merged === null) {
      this.conflict ??= this.base;
      this.value = {...this.value,...copy(patch)};
    } else this.value = merged;
    this.localVersion++; this.error = null;
    this.persist().then(() => this.schedule()).catch(error => { this.error = `Device copy unavailable: ${error.message}. Keep this page open.`; this.notify(); });
    this.notify(); return true;
  }
  schedule() {
    clearTimeout(this.timer);
    if (!this.dirty) this.dirtySince=null;
    if (!this.dirty || this.pending || this.conflict || this.readOnly || this.closed) return;
    this.dirtySince ??= Date.now();
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, Math.max(0,Math.min(this.delay,3000-(Date.now()-this.dirtySince))));
  }
  async refresh() {
    if (this.running || this.pending || this.actionRunning || this.actionPending || this.closed) return false;
    try {
      const latest = await this.read();
      if (this.running || this.pending || this.actionRunning || this.actionPending || this.closed || (this.base && latest.revision <= this.base.revision)) return true;
      this.takeLatest(latest);
      await this.persist(); this.error = null; this.notify(); return true;
    } catch (error) { this.error = `The page could not be read: ${error.message}`; this.notify(); return false; }
  }
  observe(source) {
    if (this.pageState && source.source_ref.revision < this.pageState.source_ref.revision) return;
    const laterStar=(this.pageState?.star_revision??0)>(source.star_revision??0)?{starred:this.pageState.starred,star_revision:this.pageState.star_revision}:{};
    this.pageState = {...this.pageState,...copy(source),...laterStar}; this.deleted = source.deleted === true;
    this.reading = source.reader_may_write === false;
  }
  takeLatest(latest) {
    // A tombstone hides content but never replaces unfinished writing with an empty body.
    if (latest.source.deleted && this.base) {
      this.base = {...this.base, revision:latest.revision, source:latest.source};
      return;
    }
    if (this.base && this.hasLocal) {
      const merged = this.reconcile(this.base.content, this.value, latest.content);
      if (merged === null) { this.conflict = latest; return; }
      this.base = latest; this.value = merged; this.conflict = null;
    } else { this.base = latest; this.value = copy(latest.content); this.conflict = null; }
  }
  envelope() {
    return { v: 1, instance_id: this.bootstrap.instance_id, operation_id: crypto.randomUUID(), kind: 'memory.revise',
      target: { item_id: this.item }, expected: { authority: authority(this.bootstrap), item_revision: this.base.revision }, args: copy(this.value) };
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (this.running) return this.running;
    if (this.closed || this.deleted || this.actionPending || this.actionRunning || this.readOnly || this.conflict || !this.base || (!this.pending && !this.dirty)) return Promise.resolve(null);
    this.running = this.send().finally(() => { this.running = null; this.notify(); if (!this.error) this.schedule(); });
    this.notify(); return this.running;
  }
  async send() {
    try {
      this.pending ??= this.envelope();
      // The full frozen envelope is durable before any request leaves.
      await this.persist();
      const sent = copy(this.pending), receipt = await this.api.command(sent);
      if (receipt?.instance_id !== sent.instance_id || receipt.operation_id !== sent.operation_id || receipt.kind !== sent.kind ||
          !['committed', 'rejected', 'retryable'].includes(receipt.status)) throw Error('Save confirmation does not match the request.');
      if (receipt.status === 'retryable') throw Error(receipt.error?.message ?? 'Theseus is busy.');
      if (receipt.status === 'committed') {
        if (receipt.recorded !== true) throw Error('Save confirmation is uncertain.');
        if (receipt.result?.item_id !== this.item || receipt.result.revision !== sent.expected.item_revision + 1 ||
            receipt.result.source_ref?.kind !== 'memory' || receipt.result.source_ref.id !== this.item ||
            receipt.result.source_ref.revision !== receipt.result.revision) throw Error('The saved revision does not match this page.');
        for (const described of this.base.source.attachments) if (described.name) this.described.set(described.id, described);
        const source = { ...this.base.source, ...copy(sent.args), source_ref: copy(receipt.result.source_ref),
          attachments: sent.args.attachments.map(ref => this.described.get(ref.id) ?? ref) };
        // own: the person's own revision, which Core counts as read by them (notebook-sheet.mjs reads the others).
        if (this.pageState?.source_ref.revision > receipt.result.revision) {
          this.pending=null; await this.persist(); this.notify(); return receipt;
        }
        this.observe(source);
        this.base = { revision: receipt.result.revision, content: copy(sent.args), source, own: true };
        this.pending = null; this.error = null; this.dirtySince=null;
        await this.persist(); this.notify();
        return receipt;
      }
      this.pending = null;
      if (receipt.error?.code === 'REVISION_CONFLICT') this.takeLatest(await this.read());
      else {
        this.refusalCode = receipt.error?.code;
        this.readOnly = readOnly.has(this.refusalCode);
        this.error = receipt.error?.message ?? 'Theseus did not save the page.';
      }
      await this.persist(); this.notify(); return receipt;
    } catch (error) { this.error = `Not saved yet: ${error.message}`; this.notify(); return null; }
  }
  async action(kind, args, undo = null) {
    if (this.closed || this.actionRunning || this.actionPending || !this.pageState) return null;
    if (kind === 'memory.delete' && args.deleted || transferring(kind)) {
      await this.flush();
      if (this.dirty || this.pending || this.running || this.conflict || this.error || this.journalError ||
          this.images.some(i=>!i.removed&&!i.associated)) {
        this.actionError='Your writing is kept. Finish saving it before changing this page.'; this.notify(); return null;
      }
    }
    const state=this.pageState;
    if(['memory.move','memory.copy'].includes(kind))undo??={title:this.value.title,scope:state.owner_scope,mode:'text'};
    this.actionPending=notebookActionEnvelope(this.bootstrap,this.item,state,kind,args);
    if(undo && (kind==='memory.delete' && args.deleted || transferring(kind))) this.deleteUndo={
      ...copy(undo),at:Date.now(),phase:'pending',operation:this.actionPending.operation_id,
      kind,...(transferring(kind)?{destination:copy(args.owner_scope),copy_id:args.copy_id}:{}),
      authority:authority(this.bootstrap),undoRequested:false};
    return this.retryAction();
  }
  retryAction() {
    if (this.closed || !this.actionPending) return Promise.resolve(null);
    if (this.actionRunning) return this.actionRunning;
    this.actionRunning=this.sendAction().finally(()=>{this.actionRunning=null;this.notify();this.schedule();});
    this.notify(); return this.actionRunning;
  }
  async sendAction() {
    try {
      await this.persist();
      const sent=copy(this.actionPending);
      if(this.deleteUndo && (sent.kind==='memory.delete' && sent.args.deleted || ['memory.move','memory.copy'].includes(sent.kind))) await this.actionKept?.();
      // A full-page departure hands this durable request to the destination's writer.
      if(this.closed)return null;
      const r=await this.api.command(sent);
      if(r?.instance_id!==sent.instance_id||r.operation_id!==sent.operation_id||r.kind!==sent.kind||
          !['committed','rejected','retryable'].includes(r.status)) throw Error('The confirmation does not match this page action.');
      if(r.status==='retryable')throw Error(r.error?.message??'Theseus is busy.');
      if(r.status==='committed') {
        if(r.recorded!==true||r.result?.item_id!==this.item)throw Error('The page action is not confirmed.');
        if(sent.kind==='memory.star') {
          if(r.result.starred!==sent.args.starred||!Number.isSafeInteger(r.result.star_revision)||r.result.star_revision<=sent.expected.star_revision)
            throw Error('The star confirmation is uncertain.');
          this.pageState={...this.pageState,starred:r.result.starred,star_revision:r.result.star_revision};
        } else if(transferring(sent.kind)) {
          this.acceptTransfer(sent,r.result);
        } else {
          if(r.result.deleted!==sent.args.deleted||r.result.revision!==sent.expected.item_revision+1||
            r.result.source_ref?.id!==this.item||r.result.source_ref?.kind!=='memory'||r.result.source_ref?.revision!==r.result.revision)
            throw Error('The deletion confirmation is uncertain.');
          this.observe({...this.pageState,source_ref:copy(r.result.source_ref),deleted:r.result.deleted,
            reader_may_write:!r.result.deleted&&this.pageState.reader_may_write});
          if(this.base&&r.result.deleted)this.base={...this.base,revision:r.result.revision,source:copy(this.pageState)};
        }
        if(this.deleteUndo && sent.kind==='memory.delete') {
          this.deleteUndo={...this.deleteUndo,phase:sent.args.deleted?'committed':'undone',
            revision:r.result.revision,...(sent.args.deleted?{expires:Date.now()+NOTEBOOK_UNDO_MS}:{})};
        }
        this.actionPending=null;this.actionError=null;
        try {await this.persist();} catch(error) {this.actionPending=sent;throw error;}
        if(transferring(sent.kind)&&!this.closed) {
          // Core owns reciprocal link words. Read them through the same writer;
          // do not reconstruct a product body or edit an unobserved revision.
          try {const latest=await this.read();this.takeLatest(latest);await this.persist();}
          catch(error){this.readOnly=true;this.error='The change is kept; the current page could not be read. Retry before writing: '+error.message;}
        }
        // Refresh the same operation's confirmed state; an older read cannot reverse it.
        this.notify();return r;
      }
      if(this.deleteUndo && (sent.kind==='memory.delete'||transferring(sent.kind)))this.deleteUndo={...this.deleteUndo,
        phase:sent.kind==='memory.transfer.undo'||sent.kind==='memory.delete'&&!sent.args.deleted?'restore_rejected':'rejected'};
      this.actionPending=null;this.actionError=r.error?.message??'The page was not changed.';
      try {await this.persist();} catch(error) {this.actionPending=sent;throw error;}this.notify();return r;
    } catch(error) {this.actionError='Not confirmed yet: '+error.message;this.notify();return null;}
  }
  acceptTransfer(sent,result) {
    const u=this.deleteUndo,inverse=sent.kind==='memory.transfer.undo',copying=inverse?u?.kind==='memory.copy':sent.kind==='memory.copy';
    const original=u?.scope??this.pageState.owner_scope,destination=inverse?original:sent.args.owner_scope;
    const owns=copying?original:destination,from=inverse?(copying?original:u?.destination):original;
    if(!u||result.transfer_id!==sent.operation_id||result.revision!==sent.expected.item_revision+1||
       result.source_ref?.kind!=='memory'||result.source_ref.id!==this.item||result.source_ref.revision!==result.revision||
       !same(result.owner_scope,owns)||!same(result.from_scope,from)||!same(result.to_scope,destination)||
       !Number.isSafeInteger(result.committed_ms)||result.committed_ms<=0||inverse&&result.undo_of!==u.operation)
      throw Error('The Notebook transfer confirmation is uncertain.');
    if(copying) {
      const c=result.copy,id=inverse?u.copy_id:sent.args.copy_id,revision=inverse?sent.expected.copy_revision+1:1;
      if(c?.item_id!==id||c.revision!==revision||c.source_ref?.kind!=='memory'||c.source_ref.id!==id||c.source_ref.revision!==revision||
         !same(c.owner_scope,u.destination)||inverse&&c.deleted!==true)throw Error('The copy confirmation is uncertain.');
    }
    this.deleteUndo={...u,phase:inverse?'undone':'committed',revision:result.revision,
      ...(copying?{copy_revision:result.copy.revision}:{}),
      ...(!inverse?{firstReceiptAt:result.committed_ms,expires:result.committed_ms+NOTEBOOK_UNDO_MS}:{})};
    this.observe({...this.pageState,owner_scope:copy(result.owner_scope),source_ref:copy(result.source_ref)});
  }
  async undoDelete() {
    if(!this.deleteUndo || this.deleteUndo.phase==='undone' || this.deleteUndo.phase==='rejected' ||
        this.deleteUndo.phase==='restore_rejected')return null;
    if(!same(this.deleteUndo.authority,authority(this.bootstrap)))throw Error('This page change belongs to an earlier runtime.');
    if(!this.deleteUndo.undoRequested && this.deleteUndo.phase==='committed' && Date.now()>=this.deleteUndo.expires)return null;
    this.deleteUndo.undoRequested=true;await this.persist();this.notify();
    if(this.actionRunning)await this.actionRunning;
    return this.finishDeleteUndo();
  }
  async finishDeleteUndo() {
    if(this.actionRunning&&(this.actionPending?.kind==='memory.transfer.undo'||this.actionPending?.kind==='memory.delete'&&!this.actionPending.args.deleted))return this.actionRunning;
    if(this.actionPending || this.actionRunning || !this.deleteUndo?.undoRequested || this.deleteUndo.phase!=='committed')return null;
    if(!same(this.deleteUndo.authority,authority(this.bootstrap)))return null;
    // The deletion's confirmed revision, never a newer observation, fences its Undo.
    if(this.pageState.source_ref.revision!==this.deleteUndo.revision) {
      this.deleteUndo.phase='restore_rejected';this.actionError='This page changed after '+(['memory.move','memory.copy'].includes(this.deleteUndo.kind)?'the transfer':'deletion')+'. Open it to read the current page.';
      await this.persist();this.notify();return null;
    }
    if(['memory.move','memory.copy'].includes(this.deleteUndo.kind)) {
      const u=this.deleteUndo;
      this.actionPending={v:1,instance_id:this.bootstrap.instance_id,operation_id:crypto.randomUUID(),kind:'memory.transfer.undo',
        target:{transfer_id:u.operation},args:{},expected:{authority:copy(u.authority),item_revision:u.revision,
          ...(u.kind==='memory.copy'?{copy_revision:u.copy_revision}:{})}};
      return this.retryAction();
    }
    return this.action('memory.delete',{deleted:false});
  }
  async forgetDeleteUndo() {this.deleteUndo=null;await this.persist();this.notify();}
  async resolve(useMine) {
    if (!this.conflict || this.pending || this.running || this.readOnly) return;
    const keep = useMine && this.hasLocal;
    this.base = this.conflict; this.conflict = null;
    if (!keep) this.value = copy(this.base.content);
    this.error = null; this.localVersion++;
    await this.persist(); this.notify(); this.schedule();
  }
  async retry() {
    if(this.closed || this.pending || this.running) return;
    if(this.refusalCode === 'AUTHORITY_CHANGED') { this.error='Reload this page to read the current authority before writing again.'; this.notify(); return; }
    this.readOnly=false; this.refusalCode=null; this.error=null;
    if(await this.refresh()) await this.flush();
  }
  async discard() {
    if(this.closed || this.pending || this.running) return false;
    try {
      const latest=await this.read();
      this.discardVersion=(this.discardVersion??0)+1;
      for(const image of this.images){image.removed=true;image.bytes=null;}
      this.base=latest;this.value=copy(latest.content);this.conflict=null;this.images=[];this.error=null;
      this.readOnly=false;this.refusalCode=null;
      this.localVersion++;await this.persist();this.notify();return true;
    } catch(error) { this.error='Your writing is kept: '+error.message;this.notify();return false; }
  }
  close() { this.closed = true; clearTimeout(this.timer); this.timer = null; }
}

// A journal for this instance, person and page only. A Web Lock prevents a
// second tab from replacing this tab's unconfirmed request. Another device
// is still fenced by the expected Core revision.
export async function notebookStore(binding, win = globalThis) {
  if (!win.navigator?.locks || !win.indexedDB) throw Error('Safe Notebook writing needs device storage and tab ownership.');
  const key = JSON.stringify(binding);
  let release,ownership;
  const acquired = new Promise((resolve, reject) => {
    ownership=win.navigator.locks.request('theseus-notebook-writing:' + key, { ifAvailable: true }, async lock => {
      if (!lock) { resolve(false); return; }
      const lifetime = new Promise(done => { release = done; });
      resolve(true); await lifetime;
    }).catch(reject);
  });
  if (!await acquired) throw Error('This Notebook page is being written in another tab. Close the page in the other tab, then reload this one, or keep reading here.');
  let db;
  try {
    db = await openNotebookDB(win);
  } catch (error) { release(); throw error; }
  const bytesKept = new Set();
  const transaction = (mode, act) => new Promise((resolve, reject) => {
    const tx=db.transaction(['writing','images','deletions'],mode);
    let result;
    try { result=act(tx.objectStore('writing'),tx.objectStore('images'),tx.objectStore('deletions')); }
    catch(error){tx.abort();reject(error);return;}
    tx.oncomplete=()=>resolve(typeof result==='function'?result():result);
    tx.onerror=tx.onabort=()=>reject(tx.error??Error('Device storage failed.'));
  });
  const clear = () => transaction('readwrite',(writing,images,deletions)=>{
    writing.delete(key);deletions.delete(key);
    const cursor=images.index('scope').openKeyCursor(win.IDBKeyRange.only(key));
    cursor.onsuccess=()=>{if(cursor.result){images.delete(cursor.result.primaryKey);cursor.result.continue();}};
  }).then(()=>bytesKept.clear());
  return {
    get: async () => transaction('readonly',(writing,images)=>{
      let value=null;
      const request=writing.get(key);
      request.onsuccess=()=>{
        value=request.result??null;
        for(const image of value?.images??[]) {
          // A v1 entry may still contain bytes. The next put migrates them.
          if(image.bytes)continue;
          if(image.removed||image.ready)continue;
          const bytes=images.get([key,image.id]);
          bytes.onsuccess=()=>{image.bytes=bytes.result?.bytes??null;if(image.bytes)bytesKept.add(image.id);};
        }
      };
      return ()=>value;
    }),
    put: async value => {
      if(value===null)return clear();
      const written=[];
      await transaction('readwrite',(writing,images,deletions)=>{
        const metadata={...value,images:value.images.map(({bytes,...image})=>image)};
        for(const image of value.images) {
          if(image.bytes&&!bytesKept.has(image.id)) { images.put({scope:key,bytes:image.bytes},[key,image.id]);written.push(image.id); }
          if(image.removed||image.ready)images.delete([key,image.id]);
        }
        writing.put(metadata,key);
        if(value.deleteUndo)deletions.put({scope:JSON.stringify([binding.instance_id,binding.actor_id]),at:value.deleteUndo.at,key,
          binding,undo:copy(value.deleteUndo),error:value.actionError??null},key);
        else deletions.delete(key);
      });
      for(const id of written)bytesKept.add(id);
    },
    delete: clear,
    close: () => { db.close(); release(); return ownership; }
  };
}

export function applyCardActs(body, acts) {
  let deck=parseDeck(body);
  for(const act of acts) {
    const result=applyAct(deck,act);if(!result)return null;
    deck=parseDeck(deckBody(result.deck));
  }
  return deckBody(deck);
}

// Replay gestures on the new deck. The target's text identifies what was
// acted on. An insertion's anchor only names a position, so its words may
// have changed. A remove or merge may not silently consume changed children.
export function rebaseCardActs(before, latest, acts) {
  for(const act of acts) {
    if(act.kind==='many') {
      latest=rebaseCardActs(before,latest,act.acts);
      if(latest===null)return null;
      before=applyCardActs(before,act.acts);continue;
    }
    const prior=parseDeck(before),current=parseDeck(latest),after=applyCardActs(before,[act]);
    if(after===null)return null;
    const remaining=parseDeck(after).cards.map(cardText);
    for(const card of prior.cards) {
      if(!remaining.includes(cardText(card))&&findCard(current,cardText(card),card.at)<0)return null;
    }
    const rebased={...act};
    if(act.after!==undefined&&act.after!==null&&findCard(current,act.after,act.near)<0) {
      const anchor=prior.cards[findCard(prior,act.after,act.near)];
      const matches=anchor?current.cards.filter(c=>c.title===anchor.title&&c.depth===anchor.depth):[];
      if(matches.length!==1)return null;
      rebased.after=cardText(matches[0]);
    }
    latest=applyCardActs(latest,[rebased]);if(latest===null)return null;
    before=after;
  }
  return latest;
}

// A remote text edit is applied to that card wherever a local gesture moved
// it. This also handles a gesture awaiting autosave (and a restored journal):
// moving past a changed neighbor never treats the neighbor as deleted.
function mergeRewrittenCards(before, mine, theirs) {
  const base=parseDeck(before),left=parseDeck(mine),right=parseDeck(theirs);
  if(base.cards.length!==right.cards.length || base.cards.some((c,i)=>c.title!==right.cards[i].title||c.depth!==right.cards[i].depth))return undefined;
  if(base.opening!==right.opening) {
    if(left.opening!==base.opening&&left.opening!==right.opening)return null;
    left.opening=right.opening;
  }
  for(let i=0;i<base.cards.length;i++) {
    const a=base.cards[i],b=right.cards[i];
    if(a.raw===b.raw)continue;
    const at=findCard(left,cardText(a),i);
    if(at<0) {
      if(findCard(left,cardText(b),i)>=0)continue;
      return null;
    }
    const old=left.cards[at],trim=s=>s.replace(/\n*$/,'');
    if(trim(old.raw)!==trim(a.raw)&&trim(old.raw)!==trim(b.raw))return null;
    const baseEnd=/\n*$/.exec(a.raw)[0],newEnd=/\n*$/.exec(b.raw)[0],ownEnd=/\n*$/.exec(old.raw)[0];
    if(baseEnd!==newEnd&&ownEnd!==baseEnd&&ownEnd!==newEnd)return null;
    left.cards[at]={...old,raw:trim(b.raw)+(baseEnd!==newEnd?newEnd:ownEnd)};
  }
  return deckBody(left);
}

// Fallback for text edits/additions in both copies, with exact separators.
// Structural UI gestures use rebaseCardActs, and a remote card rewrite uses
// card identity above. LCS is only the remaining unambiguous text delta.
function cardEdits(before, after) {
  const equal=(a,b)=>a===b;
  let start=0,end=before.length,tail=after.length;
  while(start<end&&start<tail&&equal(before[start],after[start]))start++;
  while(end>start&&tail>start&&equal(before[end-1],after[tail-1])){end--;tail--;}
  const a=before.slice(start,end),b=after.slice(start,tail);
  if(a.length*b.length>1000000)return null; // ambiguous large reconstruction stays an explicit choice
  const rows=Array.from({length:a.length+1},()=>new Uint32Array(b.length+1));
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)rows[i][j]=equal(a[i],b[j])?1+rows[i+1][j+1]:Math.max(rows[i+1][j],rows[i][j+1]);
  const edits=[];let i=0,j=0,current=null;
  const flush=()=>{if(current){edits.push(current);current=null;}};
  while(i<a.length||j<b.length) {
    if(i<a.length&&j<b.length&&equal(a[i],b[j])){flush();i++;j++;continue;}
    current??={start:start+i,end:start+i,put:[]};
    if(j<b.length&&(i===a.length||rows[i][j+1]>=rows[i+1][j]))current.put.push(b[j++]);
    else {i++;current.end=start+i;}
  }
  flush();return edits;
}
export function mergeCardContent(base, mine, theirs) {
  const merged=mergeFields(FIELDS.filter(key=>key!=='body'),base,mine,theirs,{});
  if(merged===null)return null;
  if(mine.body===base.body) return {...merged,body:theirs.body};
  if(theirs.body===base.body||mine.body===theirs.body)return {...merged,body:mine.body};
  const byCard=mergeRewrittenCards(base.body,mine.body,theirs.body);
  if(byCard!==undefined)return byCard===null?null:{...merged,body:byCard};
  const chunks=body=>{const deck=parseDeck(body);return [deck.opening,...deck.cards.flatMap(card=>{
    const end=/\n*$/.exec(card.raw)[0];return [card.raw.slice(0,card.raw.length-end.length),end];
  })];};
  const original=chunks(base.body),left=cardEdits(original,chunks(mine.body)),right=cardEdits(original,chunks(theirs.body));
  if(!left||!right)return null;
  const all=[...left];
  // An identical replacement can begin a larger hunk that also removes its
  // neighbour. Keep the shared replacement once and merge the remaining edit.
  const startsWithEdit=(whole,part)=>part.start===whole.start&&part.end<=whole.end&&
    part.end>part.start&&part.put.length===part.end-part.start&&
    part.put.every((chunk,i)=>chunk===whole.put[i]);
  for(let r of right) {
    let identical=false;
    for(const l of left) {
      if(same(l,r)){identical=true;break;}
      if(startsWithEdit(l,r)){identical=true;break;}
      if(startsWithEdit(r,l)){r={...r,start:l.end,put:r.put.slice(l.put.length)};continue;}
      const li=l.start===l.end,ri=r.start===r.end;
      if((li&&ri&&l.start===r.start)||(!li&&!ri&&l.start<r.end&&r.start<l.end)||
        (li&&l.start>r.start&&l.start<r.end)||(ri&&r.start>l.start&&r.start<l.end))return null;
    }
    if(!identical)all.push(r);
  }
  // At the same boundary apply a replacement first, then the insertion.
  for(const edit of all.sort((a,b)=>b.start-a.start||b.end-a.end))original.splice(edit.start,edit.end-edit.start,...edit.put);
  return {...merged,body:original.join('')};
}

export async function notebookDeleted(bootstrap, win=globalThis, after=null) {
  const db=await openNotebookDB(win);
  try {return await new Promise((resolve,reject)=>{
    const tx=db.transaction('deletions','readonly'),rows=[];let cursor=null,lastKey=null;
    const scope=JSON.stringify([bootstrap.instance_id,bootstrap.actor]);
    const r=tx.objectStore('deletions').index('scope').openCursor(win.IDBKeyRange.bound([scope],after??[scope,Number.MAX_SAFE_INTEGER,'\uffff'],false,Boolean(after)),'prev');
    r.onsuccess=()=>{const c=r.result;if(!c)return;if(rows.length===20){cursor=lastKey;return;}rows.push({...c.value,key:c.primaryKey});lastKey=c.key;c.continue();};
    tx.oncomplete=()=>resolve({rows,cursor});tx.onerror=tx.onabort=()=>reject(tx.error??Error('Saved deletions could not be read.'));
  });} finally {db.close();}
}

function openNotebookDB(win) {
  return new Promise((resolve,reject)=>{
    let blocked=false;const r=win.indexedDB.open('theseus-notebook-writing-v1',3);
    r.onupgradeneeded=()=>{
      if(!r.result.objectStoreNames.contains('writing'))r.result.createObjectStore('writing');
      if(!r.result.objectStoreNames.contains('images'))r.result.createObjectStore('images').createIndex('scope','scope');
      if(!r.result.objectStoreNames.contains('deletions'))r.result.createObjectStore('deletions').createIndex('scope',['scope','at','key']);
    };
    r.onblocked=()=>{blocked=true;reject(Error('Close older Notebook tabs, then reload to update safe device storage.'));};
    r.onsuccess=()=>{if(blocked){r.result.close();return;}r.result.onversionchange=()=>r.result.close();resolve(r.result);};
    r.onerror=()=>reject(r.error);
  });
}
