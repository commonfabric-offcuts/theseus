import { parseDeck, deckBody, cardText, applyAct, findCard } from './deck.mjs';
const copy = structuredClone;
const same = (a, b) => a === b || Boolean(a && b && typeof a === 'object' && typeof b === 'object' &&
  Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every(key => Object.hasOwn(b,key) && same(a[key],b[key])));
export const sameContent = (a,b) => Boolean(a && b && ['title','body','attachments','references'].every(key=>same(a[key],b[key])));
function mergeTextContent(base,mine,theirs) {
  const result={};
  for(const field of ['title','body','attachments','references']) {
    if(same(mine[field],base[field]))result[field]=copy(theirs[field]);
    else if(same(theirs[field],base[field])||same(theirs[field],mine[field]))result[field]=copy(mine[field]);
    else return null;
  }
  return result;
}
const content = source => ({ title: source.title, body: source.body ?? '',
  attachments: source.attachments.map(({ id }) => ({ id })), references: copy(source.references) });
const authority = bootstrap => ({ authority_id: bootstrap.authority.authority_id, authority_epoch: bootstrap.authority.authority_epoch });
const readOnly = new Set(['FORBIDDEN', 'OUTCOME_REACHED', 'AUTHORITY_CHANGED']);

// The one revision stream behind Text and Cards. The journal owns only local,
// unconfirmed writing. Core still owns the page and every confirmed revision.
export class NotebookWriting {
  constructor({ item, bootstrap, api, store, changed = () => {}, reconcile = () => null, localActive = () => false, delay = 600 }) {
    Object.assign(this, { item, bootstrap, api, store, changed, reconcile, localActive, delay });
    this.base = null; this.value = null; this.pending = null; this.conflict = null;
    this.error = null; this.readOnly = false; this.running = null; this.timer = null;
    this.active = false; this.closed = false; this.serial = Promise.resolve(); this.localVersion = 0; this.images = [];
    this.journalPending = 0; this.journalError = null;
  }
  get dirty() { return Boolean(this.value && !sameContent(this.value, this.base?.content)); }
  get hasLocal() { return this.dirty || this.localActive(); }
  get busy() { return Boolean(this.running || this.pending); }
  get binding() { return { instance_id: this.bootstrap.instance_id, actor_id: this.bootstrap.actor, item_id: this.item }; }
  snapshot() {
    if (!this.dirty && !this.pending && !this.conflict && !this.images.some(image => !image.removed && !image.associated)) return null;
    // Bytes are immutable and held separately by the store. Do not clone a
    // pending photograph every time a single character changes.
    const images = this.images.map(({bytes, ...image}) => ({...copy(image), bytes}));
    return { ...copy({ v: 1, binding: this.binding, base: this.base, value: this.value, pending: this.pending,
      conflict: this.conflict, localVersion: this.localVersion }), images };
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
    return { revision: source.source_ref.revision, content: content(source), source };
  }
  async open() {
    const held = await this.store.get();
    if (held) {
      if (held.v !== 1 || !same(held.binding, this.binding)) throw Error('The saved writing belongs to a different Notebook page.');
      Object.assign(this, copy({ base: held.base, value: held.value, pending: held.pending,
        conflict: held.conflict, localVersion: held.localVersion, images: held.images ?? [] }));
      // Refusals are scoped to this opening. A fresh bootstrap and a new
      // revision-fenced request decide access again, including old v1 journals.
    }
    if (this.pending) await this.flush();
    await this.refresh();
    if (this.dirty && !this.pending && !this.conflict && !this.readOnly) this.schedule();
    this.notify();
  }
  capture() { return {revision:this.base?.revision,content:copy(this.value)}; }
  edit(patch, seen, mode = 'text', acts = []) {
    // A caller must name the content it actually edited. In particular an
    // empty, not-yet-drawn surface must never borrow the current revision.
    if (!seen?.content || !Number.isInteger(seen.revision) || !this.value || this.readOnly || this.closed) return false;
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
    if (this.running || this.pending || this.closed) return false;
    try {
      const latest = await this.read();
      if (this.running || this.pending || this.closed || (this.base && latest.revision <= this.base.revision)) return true;
      this.takeLatest(latest);
      await this.persist(); this.error = null; this.notify(); return true;
    } catch (error) { this.error = `The page could not be read: ${error.message}`; this.notify(); return false; }
  }
  takeLatest(latest) {
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
    if (this.closed || this.readOnly || this.conflict || !this.base || (!this.pending && !this.dirty)) return Promise.resolve(null);
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
        const source = { ...this.base.source, ...copy(sent.args), source_ref: copy(receipt.result.source_ref),
          attachments: sent.args.attachments.map(ref => this.base.source.attachments.find(a => a.id === ref.id) ?? ref) };
        // own: the person's own revision, which Core counts as read by them (notebook-sheet.mjs reads the others).
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
  let release;
  const acquired = new Promise((resolve, reject) => {
    win.navigator.locks.request('theseus-notebook-writing:' + key, { ifAvailable: true }, async lock => {
      if (!lock) { resolve(false); return; }
      const lifetime = new Promise(done => { release = done; });
      resolve(true); await lifetime;
    }).catch(reject);
  });
  if (!await acquired) throw Error('This Notebook page is being written in another tab. Close that editor, then reload here.');
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = win.indexedDB.open('theseus-notebook-writing-v1', 2);
      request.onupgradeneeded = () => {
        const db=request.result;
        if(!db.objectStoreNames.contains('writing'))db.createObjectStore('writing');
        if(!db.objectStoreNames.contains('images'))db.createObjectStore('images').createIndex('scope','scope');
      };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  } catch (error) { release(); throw error; }
  const bytesKept = new Set();
  const transaction = (mode, act) => new Promise((resolve, reject) => {
    const tx=db.transaction(['writing','images'],mode);
    let result;
    try { result=act(tx.objectStore('writing'),tx.objectStore('images')); }
    catch(error){tx.abort();reject(error);return;}
    tx.oncomplete=()=>resolve(typeof result==='function'?result():result);
    tx.onerror=tx.onabort=()=>reject(tx.error??Error('Device storage failed.'));
  });
  const clear = () => transaction('readwrite',(writing,images)=>{
    writing.delete(key);
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
      await transaction('readwrite',(writing,images)=>{
        const metadata={...value,images:value.images.map(({bytes,...image})=>image)};
        for(const image of value.images) {
          if(image.bytes&&!bytesKept.has(image.id)) { images.put({scope:key,bytes:image.bytes},[key,image.id]);written.push(image.id); }
          if(image.removed||image.ready)images.delete([key,image.id]);
        }
        writing.put(metadata,key);
      });
      for(const id of written)bytesKept.add(id);
    },
    delete: clear,
    close: () => { db.close(); release(); }
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
  const merged={};
  for(const field of ['title','attachments','references']) {
    if(same(mine[field],base[field]))merged[field]=copy(theirs[field]);
    else if(same(theirs[field],base[field])||same(theirs[field],mine[field]))merged[field]=copy(mine[field]);
    else return null;
  }
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
  for(const r of right) {
    let identical=false;
    for(const l of left) {
      if(same(l,r)){identical=true;break;}
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
