// Core authority and an exact pending-write cache for the existing Dim owner.
import { applyDimIntent, decodeDimming, dimmingKey, freshDimming } from './dim-choices.mjs';
import { checkedView, scopedChangesPage, readFailure } from './freshness.mjs';
import { openDimJournal } from './dim-journal.mjs';

const copy = value => structuredClone(value);
const equal = (a,b) => a === b || Boolean(a && b && typeof a === 'object' && typeof b === 'object' &&
  Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every(key=>Object.hasOwn(b,key) && equal(a[key],b[key])));
const revision = n => Number.isSafeInteger(n) && n >= 0;
const diagnostic = words => Object.assign(Error(words), { code: 'DIM_CONFIRMATION_UNKNOWN' });
export const dimCacheKey = (instance, actor, authority) => `aim-next.rail-dimming.core.v1:${JSON.stringify([instance, actor, authority?.authority_id, authority?.authority_epoch])}`;

export class DimmingSync {
  constructor({ choices, storage = choices.storage, journalFactory = openDimJournal, visible = () => true,
    timers = {setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)}, changed = () => {}, id = () => crypto.randomUUID() }) {
    Object.assign(this, { choices, storage, journalFactory, visible, timers, changed, id }); this.epoch = 0; this.key = null; this.retryTimer=null; this.failures=0;
  }
  get pending() { return this.prepared?.[0] ?? null; }
  connect({ api, bootstrap, live = null }) {
    const { instance_id, actor, authority } = bootstrap;
    const key = JSON.stringify([instance_id, actor, authority?.authority_id, authority?.authority_epoch]);
    this.api = api; this.liveOff?.();
    if (this.key !== key) {
      if(this.retryTimer!==null)this.timers.clearTimeout(this.retryTimer);this.retryTimer=null;this.failures=0;
      this.journal?.close(); this.journal = null; this.journalReady = null; this.journalError = null;
      this.epoch++; this.key = key; this.bootstrap = bootstrap; this.limit = bootstrap.limits?.rail_dim_choices;
      this.choices.limit = Number.isSafeInteger(this.limit) && this.limit > 0 ? this.limit : 0;
      this.choices.bind(instance_id, actor);
      this.cacheKey = dimCacheKey(instance_id, actor, authority); this.confirmed = null; this.intents = []; this.prepared = [];
      this.legacy = null; this.cursor = null; this.initialized = false; this.error = null; this.cacheKept = true;
      try { const raw = this.storage?.getItem(dimmingKey(instance_id, actor)); if (raw) this.legacy = decodeDimming(raw); } catch { /* No valid legacy import. */ }
      this.restore(); this.task = null;
      this.choices.syncEdit = action => {
        this.intents.push({ id: this.id(), action: copy(action) }); this.error = null; this.transientError=false;
        if(this.retryTimer!==null)this.timers.clearTimeout(this.retryTimer);this.retryTimer=null;this.failures=0;
        this.persist(); this.paint(); this.wake();
      };
      this.paint();
    }
    this.liveOff = live?.listen(event => {
      if (this.visible() && (event.kind === 'commit' || event.kind === 'state' && event.state === 'live')) this.wake();
    }) ?? null;
    return this.wake();
  }
  disconnect() { this.epoch++;if(this.retryTimer!==null)this.timers.clearTimeout(this.retryTimer);this.retryTimer=null; this.journal?.close(); this.journal = null; this.liveOff?.(); this.liveOff = null; this.choices.syncEdit = null; this.key = null; }
  restore() {
    try {
      const raw = this.storage?.getItem(this.cacheKey);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.version !== 1) throw diagnostic('Invalid Dim cache');
        if (cached.confirmed !== null) this.accept(cached.confirmed);
      }
    } catch { this.cacheKept = false; }
  }
  snapshot() { return copy({version:1,confirmed:this.confirmed,intents:this.intents,prepared:this.prepared}); }
  validValue(value) { return decodeDimming(JSON.stringify(value), this.limit); }
  mergeRecovered(snapshots) {
    const entries = new Map(), prepared = new Map();
    for (const cache of [...snapshots,this.snapshot()]) {
      if (cache?.version !== 1 || !Array.isArray(cache.intents)) throw diagnostic('Invalid Dim cache');
      if (cache.confirmed !== null) {
        if (!revision(cache.confirmed?.dim_revision)) throw diagnostic('Invalid Dim revision');
        this.validValue(cache.confirmed.value);
      }
      for (const entry of cache.intents) {
        if (typeof entry?.id !== 'string' || !entry.id || !this.apply(freshDimming(), entry.action, 0)) throw diagnostic('Invalid cached Dim edit');
        if (entries.has(entry.id) && !equal(entries.get(entry.id),entry)) throw diagnostic('A cached Dim edit identity disagrees.');
        entries.set(entry.id,copy(entry));
      }
      if (!Array.isArray(cache.prepared)) throw diagnostic('Invalid prepared Dim saves');
      for (const pending of cache.prepared) {
        const e = pending?.envelope;
        if (!e || e.v !== 1 || e.instance_id !== this.bootstrap.instance_id || e.kind !== 'rail.dimming_set' ||
            typeof e.operation_id !== 'string' || !e.operation_id || !equal(e.target,{}) || !revision(e.expected?.dim_revision) ||
            typeof e.expected?.authority?.authority_id !== 'string' || typeof e.expected.authority.authority_epoch !== 'string' ||
            !Array.isArray(pending.ids) || !pending.ids.length || new Set(pending.ids).size !== pending.ids.length ||
            !pending.ids.every(id=>cache.intents.some(x=>x.id===id))) throw diagnostic('Invalid pending Dim save');
        this.validValue(e.args?.value);
        if (prepared.has(e.operation_id) && !equal(prepared.get(e.operation_id),pending)) throw diagnostic('A pending Dim operation identity disagrees.');
        prepared.set(e.operation_id,copy(pending));
      }
      if (cache.confirmed) this.accept(cache.confirmed);
    }
    this.intents = [...entries.values()]; this.prepared = [...prepared.values()];
  }
  async prepareJournal(epoch) {
    if (this.journal || this.journalReady) return this.journalReady;
    const task = Promise.resolve().then(()=>this.journalFactory({storage:this.storage,
      scope:this.key,id:this.id})).then(journal=>{
      if (epoch !== this.epoch) { journal.close(); return; }
      try {
        this.mergeRecovered(journal.recovered);
        journal.completeRecovery(this.snapshot()); this.journal = journal; this.journalError = null;
      } catch (error) { journal.close(); throw error; }
    }).catch(error=>{if(epoch===this.epoch){this.journalError=error.message;this.cacheKept=false;}})
      .finally(()=>{if(this.journalReady===task)this.journalReady=null;});
    this.journalReady = task; return task;
  }
  persist() {
    let pendingKept = false;
    try {
      if (!this.journal) throw Error(this.journalError ?? 'Pending Dim changes are not yet kept.');
      this.journal.save(this.snapshot()); pendingKept = true;
    } catch (error) { this.journalError = error.message; }
    this.cacheKept = pendingKept;
    try {
      if (!this.storage) throw Error('No cache');
      let prior=null;try{prior=JSON.parse(this.storage.getItem(this.cacheKey)??'null')?.confirmed;}catch{ /* Replace only the confirmed cache, never journals. */ }
      if (this.confirmed && (!revision(prior?.dim_revision) || prior.dim_revision <= this.confirmed.dim_revision))
        this.storage.setItem(this.cacheKey,JSON.stringify({version:1,confirmed:this.confirmed}));
    }
    catch { this.cacheKept = false; }
    return pendingKept;
  }
  apply(value, action, rev) {
    if (action?.kind === 'import') return rev === 0 ? this.validValue(action.value) : value;
    return applyDimIntent(value, action, this.limit);
  }
  projected() {
    let value = copy(this.confirmed?.value ?? this.legacy ?? freshDimming());
    for (const entry of this.intents) {
      const next = this.apply(value,entry.action,this.confirmed?.dim_revision ?? 0);
      if (!next) throw diagnostic('These Dim edits exceed the view limit; the saved choice has not changed.');
      value = next;
    }
    return value;
  }
  paint() {
    try { this.choices.value = this.projected(); }
    catch (error) { this.error = error.message; }
    this.choices.kept = Boolean(this.confirmed && !this.intents.length && !this.pending);
    this.status = this.error ?? (this.intents.length && this.journalError ? this.journalError : this.choices.kept ? 'Dim views are kept in Core on your devices' : 'Dim changes are not yet confirmed in Core');
    if (!this.cacheKept) this.status += '; this browser could not keep the offline copy';
    this.changed();
  }
  accept(answer) {
    if (!revision(answer?.dim_revision)) throw diagnostic('The Dim revision could not be confirmed.');
    const value = this.validValue(answer.value);
    if (!this.confirmed || answer.dim_revision >= this.confirmed.dim_revision) this.confirmed = { value:copy(value), dim_revision:answer.dim_revision };
  }
  async readCurrent(epoch) {
    const answer = checkedView(await this.api.view('rail_dimming',{}, {readClass:'background'}),this.bootstrap.instance_id);
    if (epoch !== this.epoch) return;
    this.accept(answer);
    if (!this.pending && answer.dim_revision > 0) this.intents = this.intents.filter(x=>x.action.kind!=='import');
    this.persist(); this.paint();
  }
  async changes(input, epoch) {
    const scope = {kind:'actor',id:this.bootstrap.actor};
    const answer = await this.api.view('changes',{scope,limit:50,...(input?{cursor:input}:{})},{readClass:'background'});
    if (epoch !== this.epoch) return null;
    return scopedChangesPage(answer,this.bootstrap,scope,input);
  }
  wake() {
    this.again = true;
    if(this.retryTimer!==null)return Promise.resolve();
    if (this.task) return this.task;
    const epoch = this.epoch;
    const task = Promise.resolve().then(()=>this.drain(epoch)).catch(error=>{
      if (epoch === this.epoch) {
        this.again = false; this.error = error.message || 'Dim save is unconfirmed; retry when connected.';
        this.transientError=readFailure(error).kind==='retry';this.persist();this.paint();
        // Failure-driven bounded backoff, not an idle polling loop. Uncertain
        // writes keep their original operation ID through these attempts.
        if(this.transientError&&this.failures<3){const delay=100*2**this.failures++;
          this.retryTimer=this.timers.setTimeout(()=>{this.retryTimer=null;if(epoch===this.epoch&&this.visible())this.wake();},delay);}
      }
    }).finally(()=>{ if (this.task === task) { this.task = null; if (this.again && epoch === this.epoch) this.wake(); } });
    this.task = task; return task;
  }
  retry() { this.error = null; this.transientError=false;this.failures=0;if(this.retryTimer!==null)this.timers.clearTimeout(this.retryTimer);this.retryTimer=null;return this.wake(); }
  async idle() { while (this.task) await this.task; }
  async drain(epoch) {
    let conflicts = 0;
    if (!Number.isSafeInteger(this.limit) || this.limit < 1) throw diagnostic('The Core Dim choice limit is unavailable.');
    await this.prepareJournal(epoch); if(epoch!==this.epoch)return;
    while (this.again && epoch === this.epoch) {
      this.again = false;
      if (!this.initialized) {
        const baseline = await this.changes(null,epoch); if (epoch !== this.epoch) return;
        this.cursor = copy(baseline.checkpoint);
        await this.readCurrent(epoch); if (epoch !== this.epoch) return;
        if (!this.pending && !this.intents.length && this.confirmed.dim_revision === 0 && this.legacy) {
          this.intents.push({id:this.id(),action:{kind:'import',value:copy(this.legacy)}}); this.legacy = null; this.persist();
        }
        this.initialized = true;
      } else if(!this.pending&&!this.intents.length) {
        let input = this.cursor, changed = false, page;
        do {
          page = await this.changes(input,epoch); if (epoch !== this.epoch) return;
          changed ||= page.items.some(x=>x.resource_kind==='rail_dimming' || ['workspace','participation'].includes(x.resource_kind));
          input = page.continuation;
        } while (page.has_more);
        if (changed) await this.readCurrent(epoch);
        if (epoch !== this.epoch) return;
        this.cursor = copy(page.checkpoint);
        if(this.transientError){this.error=null;this.transientError=false;}this.failures=0;
      }
      if (!this.pending && this.intents.length) {
        this.prepared.push({ ids:this.intents.map(x=>x.id), envelope:{v:1,instance_id:this.bootstrap.instance_id,operation_id:this.id(),
          kind:'rail.dimming_set',target:{},expected:{dim_revision:this.confirmed.dim_revision,authority:{authority_id:this.bootstrap.authority.authority_id,authority_epoch:this.bootstrap.authority.authority_epoch}},
          args:{value:this.projected()}} });
      }
      if (!this.pending) { this.paint(); continue; }
      if (!this.persist()) throw diagnostic(this.journalError ?? 'Pending Dim changes could not be kept; retry before saving.');
      const pending = copy(this.pending), envelope = copy(pending.envelope);
      const receipt = await this.api.command(envelope); if (epoch !== this.epoch) return;
      if (receipt?.instance_id !== envelope.instance_id || receipt.operation_id !== envelope.operation_id || receipt.kind !== envelope.kind)
        throw diagnostic('The Dim save could not be confirmed. Retry keeps its exact request.');
      if (!['committed','rejected'].includes(receipt.status) || receipt.status === 'rejected' &&
          (typeof receipt.error?.code !== 'string' || typeof receipt.error?.message !== 'string'))
        throw diagnostic('The Dim save outcome is unreadable. Retry keeps its exact request.');
      if (receipt.status === 'committed') {
        const r = receipt.result;
        if (receipt.recorded !== true || typeof r?.changed !== 'boolean' || !equal(r.value,envelope.args.value) ||
            r.dim_revision !== envelope.expected.dim_revision + Number(r.changed)) throw diagnostic('The Dim save receipt disagrees. Retry keeps its exact request.');
        this.accept(r); const ids=new Set(pending.ids); this.intents=this.intents.filter(x=>!ids.has(x.id)); this.prepared.shift(); this.error = null;
      } else if (receipt.recorded === true || receipt.recorded === false && receipt.error.code === 'INVALID_ARGUMENT') {
        this.prepared.shift();
        if (receipt.error?.code === 'REVISION_CONFLICT') {
          await this.readCurrent(epoch); if (epoch !== this.epoch) return;
          if (++conflicts >= 3) throw diagnostic('Dim kept changing on another device; retry your retained edits.');
        } else {
          // A known refusal rolls back only its own batch, preserving newer edits.
          // Core validation can definitively refuse before writing a ledger row.
          const ids=new Set(pending.ids);this.intents=this.intents.filter(x=>!ids.has(x.id)); this.error = receipt.error?.message ?? 'This Dim change was not saved.';
          await this.readCurrent(epoch); if (epoch !== this.epoch) return;
        }
      } else throw diagnostic(receipt.error?.message ?? 'Dim save is unconfirmed; retry keeps its exact request.');
      this.persist(); this.paint();
      if (this.intents.length) this.again = true;
    }
  }
}
