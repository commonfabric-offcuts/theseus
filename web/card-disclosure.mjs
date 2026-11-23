import {cardDetails} from './card-details.mjs';
import {cardText} from './deck.mjs';

// View identity only. Never create a stored card id or write a preference.
export function disclosureRecords(previous, cards, continuity = null) {
  const before=previous.map(record=>({...record})), next=cards.map(card=>({card,id:cardDetails(card.words).id,text:cardText(card),title:card.title}));
  const matched=new Array(cards.length), used=new Set();
  const compatible=(a,b)=>!a.id||!b.id||a.id===b.id;
  const take=(at,old)=>{if(old>=0&&!used.has(old)&&compatible(before[old],next[at])){matched[at]=previous[old];used.add(old);}};
  const objects=new Map(before.map((record,index)=>[record.card,index]));
  next.forEach((record,index)=>take(index,objects.get(record.card)??-1));
  if(continuity){const at=cards.indexOf(continuity.to);if(at>=0&&!matched[at])take(at,objects.get(continuity.from)??-1);}
  for(const key of ['id','text','title']) {
    const old=new Map(), current=new Map();
    before.forEach((record,index)=>{const value=record[key];if(value)old.set(value,old.has(value)?-1:index);});
    next.forEach((record,index)=>{const value=record[key];if(value)current.set(value,current.has(value)?-1:index);});
    next.forEach((record,index)=>{if(!matched[index]&&current.get(record[key])===index)take(index,old.get(record[key])??-1);});
  }
  // A repaint/reparse of the same sequence keeps identical legacy occurrences.
  // Ambiguous external structural replacement gets fresh collapsed records.
  if(before.length===next.length&&before.every((record,i)=>record.text===next[i].text))
    next.forEach((_record,index)=>{if(!matched[index])take(index,index);});
  return next.map((record,index)=>Object.assign(matched[index]??{expanded:false},record));
}

let serial=0;
export class CardDisclosure {
  constructor({doc,signal,ResizeObserver=doc.defaultView?.ResizeObserver??globalThis.ResizeObserver,
    IntersectionObserver=doc.defaultView?.IntersectionObserver??globalThis.IntersectionObserver}) {
    Object.assign(this,{doc,records:[],entries:[],closed:false,dirty:new Set(),byWords:new Map(),frame:null});
    this.resize=ResizeObserver?new ResizeObserver(changed=>{
      if(!this.closed)for(const {target}of changed){const entry=this.byWords.get(target);if(entry)this.measure(entry);}
    }):null;
    this.intersection=IntersectionObserver?new IntersectionObserver(changed=>{
      if(this.closed)return;
      for(const {target,isIntersecting}of changed){
        const entry=this.byWords.get(target);if(!entry)continue;
        entry.visible=isIntersecting;
        if(isIntersecting){this.resize?.observe(target);this.measure(entry);}
        else {this.resize?.unobserve?.(target);this.dirty.delete(entry);}
      }
    }):null;
    doc.fonts?.addEventListener?.('loadingdone',()=>this.refresh(),{signal});
    doc.defaultView?.addEventListener?.('resize',()=>this.refresh(),{signal});
    // The fallback only serves browsers without IntersectionObserver.
    if(!this.intersection)doc.addEventListener?.('scroll',()=>this.refresh(),{signal,capture:true,passive:true});
    signal?.addEventListener('abort',()=>this.close(),{once:true});
  }
  reconcile(cards,continuity) {this.records=disclosureRecords(this.records,cards,continuity);}
  focused() {
    const active=this.doc.activeElement,entry=this.entries.find(entry=>entry.button===active||entry.row===active);
    return entry?{record:entry.record,button:entry.button===active}:null;
  }
  cancel() {
    if(this.frame?.id!==undefined)this.doc.defaultView?.cancelAnimationFrame?.(this.frame.id);
    this.frame=null;this.dirty.clear();this.pendingFocus=null;
  }
  begin(cards) {
    if(this.closed)return;
    this.cancel();this.resize?.disconnect();this.intersection?.disconnect();
    this.entries=[];this.byWords.clear();this.reconcile(cards);
  }
  attach(row,words,index) {
    if(this.closed)return;
    const record=this.records[index],button=this.doc.createElement('button');
    button.className='deck-disclosure';button.type='button';button.hidden=true;
    words.id||=`deck-disclosure-words-${globalThis.crypto?.randomUUID?.()??++serial}`;
    button.setAttribute('aria-controls',words.id);
    // An off-screen expanded card retains its height while awaiting visibility.
    words.classList.toggle('deck-expanded',record.expanded);
    const entry={row,words,button,record,visible:!this.intersection};
    this.entries.push(entry);this.byWords.set(words,entry);row.append(button);
    button.addEventListener('click',event=>{
      event.stopPropagation();if(this.closed||button.hidden||!button.isConnected)return;
      // Its visible pill already establishes overflow. Respond to the press
      // immediately; any resulting reflow is measured in the next batch.
      record.expanded=!record.expanded;this.present(entry,true);
    });
  }
  measure(entry) {
    if(this.closed||!entry.visible||this.byWords.get(entry.words)!==entry)return;
    this.dirty.add(entry);this.schedule();
  }
  schedule() {
    if(this.frame||this.closed)return;
    const frame={};this.frame=frame;
    const run=()=>{if(this.frame!==frame||this.closed)return;this.frame=null;this.flush();};
    const view=this.doc.defaultView;
    if(view?.requestAnimationFrame)frame.id=view.requestAnimationFrame(run);
    else queueMicrotask(run);
  }
  flush() {
    let entries=[...this.dirty].filter(entry=>entry.visible&&entry.words.isConnected&&this.byWords.get(entry.words)===entry);
    this.dirty.clear();
    if(!this.intersection){
      // All viewport reads precede clamp writes, including this legacy fallback.
      const view=this.doc.defaultView;
      entries=entries.filter(({words})=>{
        if(!words.getBoundingClientRect)return true;
        const r=words.getBoundingClientRect();
        return r.bottom>0&&r.right>0&&r.top<view.innerHeight&&r.left<view.innerWidth;
      });
    }
    // Never interleave a card's clamp write with the next card's geometry read.
    for(const {words}of entries)words.classList.remove('deck-expanded');
    const measured=entries.map(entry=>({entry,focused:this.doc.activeElement===entry.button,
      truncated:Boolean(entry.words.clientWidth>0&&entry.words.getClientRects().length&&entry.words.scrollHeight>entry.words.clientHeight+1)}));
    for(const {entry,focused,truncated}of measured){
      const {button,row}=entry;this.present(entry,truncated);
      if(focused&&!truncated&&row.isConnected&&!row.hidden)row.focus({preventScroll:true});
    }
    const pending=this.pendingFocus;
    if(pending){
      const entry=this.entries.find(entry=>entry.record===pending.focused.record);
      if(entry&&measured.some(result=>result.entry===entry)){
        this.pendingFocus=null;
        if(this.doc.activeElement===pending.active){
          if(pending.focused.button&&!entry.button.hidden)entry.button.focus({preventScroll:true});
          else if(entry.row.isConnected&&!entry.row.hidden)entry.row.focus({preventScroll:true});
        }
      }
    }
  }
  present({words,button,record},truncated) {
    words.classList.toggle('deck-expanded',truncated&&record.expanded);
    button.hidden=!truncated;
    const label=record.expanded?'Show less':'Show all';
    button.textContent=label;button.setAttribute('aria-expanded',String(truncated&&record.expanded));
    button.setAttribute('aria-label',`${label}: ${record.title||'Untitled'}`);
  }
  refresh() {if(!this.closed)for(const entry of this.entries)this.measure(entry);}
  mount(focused=null) {
    if(this.closed)return;
    this.pendingFocus=focused?{focused,active:this.doc.activeElement}:null;
    for(const entry of this.entries)if(entry.words.isConnected){
      if(this.intersection)this.intersection.observe(entry.words);
      else this.resize?.observe(entry.words);
    }
    this.refresh();
  }
  close() {
    this.closed=true;this.cancel();this.resize?.disconnect();this.intersection?.disconnect();
    this.entries=[];this.records=[];this.byWords.clear();
  }
}
