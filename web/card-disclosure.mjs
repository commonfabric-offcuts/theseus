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
  constructor({doc,signal,ResizeObserver=doc.defaultView?.ResizeObserver??globalThis.ResizeObserver}) {
    Object.assign(this,{doc,records:[],entries:[],closed:false});
    this.resize=ResizeObserver?new ResizeObserver(changed=>{
      if(!this.closed)for(const {target}of changed){const entry=this.entries.find(entry=>entry.words===target);if(entry)this.measure(entry);}
    }):null;
    doc.fonts?.addEventListener?.('loadingdone',()=>this.refresh(),{signal});
    doc.defaultView?.addEventListener?.('resize',()=>this.refresh(),{signal});
    signal?.addEventListener('abort',()=>this.close(),{once:true});
  }
  reconcile(cards,continuity) {this.records=disclosureRecords(this.records,cards,continuity);}
  focused() {
    const active=this.doc.activeElement,entry=this.entries.find(entry=>entry.button===active||entry.row===active);
    return entry?{record:entry.record,button:entry.button===active}:null;
  }
  begin(cards) {
    if(this.closed)return;
    this.resize?.disconnect();this.entries=[];this.reconcile(cards);
  }
  attach(row,words,index) {
    if(this.closed)return;
    const record=this.records[index],button=this.doc.createElement('button');
    button.className='deck-disclosure';button.type='button';button.hidden=true;
    words.id||=`deck-disclosure-words-${globalThis.crypto?.randomUUID?.()??++serial}`;
    button.setAttribute('aria-controls',words.id);
    const entry={row,words,button,record};this.entries.push(entry);row.append(button);
    button.addEventListener('click',event=>{
      event.stopPropagation();if(this.closed||button.hidden||!button.isConnected)return;
      record.expanded=!record.expanded;this.measure(entry);
    });
  }
  measure(entry) {
    if(this.closed)return;
    const {words,button,row,record}=entry,focused=this.doc.activeElement===button;
    // Measure the real clamped box, even when this reader chose the whole card.
    // Detached or folded rows have no layout and never offer a control.
    words.classList.remove('deck-expanded');
    const truncated=Boolean(words.isConnected&&words.clientWidth>0&&words.getClientRects().length&&words.scrollHeight>words.clientHeight+1);
    words.classList.toggle('deck-expanded',truncated&&record.expanded);
    button.hidden=!truncated;
    const label=record.expanded?'Show less':'Show all';
    button.textContent=label;button.setAttribute('aria-expanded',String(truncated&&record.expanded));
    button.setAttribute('aria-label',`${label}: ${record.title||'Untitled'}`);
    if(focused&&!truncated&&row.isConnected&&!row.hidden)row.focus({preventScroll:true});
  }
  refresh() {if(!this.closed)for(const entry of this.entries)this.measure(entry);}
  mount(focused=null) {
    if(this.closed)return;
    this.refresh();
    for(const entry of this.entries)if(entry.words.isConnected)this.resize?.observe(entry.words);
    const entry=this.entries.find(entry=>entry.record===focused?.record&&entry.button.isConnected);
    if(entry&&focused.button&&!entry.button.hidden)entry.button.focus({preventScroll:true});
    else if(entry?.row.isConnected&&!entry.row.hidden)entry.row.focus({preventScroll:true});
  }
  close() {this.closed=true;this.resize?.disconnect();this.entries=[];this.records=[];}
}
