import { parseDeck } from './deck.mjs';
import { cardDetails, detailsLine, stripDetails, mergeDetails } from './card-details.mjs';

const spans=body=>{
  const deck=parseDeck(body);let at=deck.opening.length;
  return deck.cards.map(card=>{const start=at;at+=card.raw.length;return {card,start,end:at,last:start+card.raw.trimEnd().length};});
};
// Reattach invisible metadata to the card containing its surviving writing.
// A whole card cut from Text loses its id; native Undo restores the exact prior
// projection from the visit's structural edit history. A heading-only edit/rename keeps it.
function projectEdit(body, text, change=null) {
  const before=stripDetails(body);
  if(before===text)return {body,parents:parseDeck(body).cards.map((_,i)=>i)};
  let start=change?.start,end=change?.end;
  let inserted=text.length-before.length+(end-start);
  if(!Number.isInteger(start)||!Number.isInteger(end)||start>end||inserted<0||
      before.slice(0,start)!==text.slice(0,start)||before.slice(end)!==text.slice(start+inserted)){
    start=0;while(start<before.length&&start<text.length&&before[start]===text[start])start++;
    let suffix=0;while(suffix<before.length-start&&suffix<text.length-start&&before[before.length-1-suffix]===text[text.length-1-suffix])suffix++;
    end=before.length-suffix;inserted=text.length-suffix-start;
  }
  const old=spans(before),fresh=spans(text),original=parseDeck(body).cards,kept=new Map(),parents=fresh.map(()=>null),delta=inserted-(end-start);
  for(let i=0;i<old.length;i++){
    const detail=cardDetails(original[i].words),span=old[i];
    if(start<=span.start&&end>=span.last)continue;
    const anchor=span.start<start?span.start:span.start>=end?span.start+delta:end<span.last?start+inserted:start;
    const into=fresh.findIndex(row=>row.start<=anchor&&anchor<row.end);
    if(into<0)continue;
    if(parents[into]===null)parents[into]=i;
    const previous=kept.get(into);kept.set(into,previous?{...mergeDetails(previous,detail),ids:[...new Set([...previous.ids,...detail.ids])]}:detail);
  }
  return {body:putDetails(text,fresh,kept),parents};
}
export function keepCardDetails(body,text,change=null){return projectEdit(body,text,change).body;}
function putDetails(text,fresh,kept){
  // Insert only hidden bytes. Every visible character stays exactly as typed.
  let result=text;
  for(const [i,details] of [...kept].sort((a,b)=>b[0]-a[0])){
    if(!details.id&&!details.aliases.length)continue;
    const at=fresh[i].last;result=result.slice(0,at)+'\n\n'+detailsLine(details)+result.slice(at);
  }
  return result;
}

const identityShape=body=>JSON.stringify(parseDeck(body).cards.map(card=>{
  const {id,aliases,color}=cardDetails(card.words);return {id,aliases,color};
}));
export class CardTextProjection {
  constructor(){this.history=[];this.serial=0;this.lineages=[];}
  show(body){
    const text=stripDetails(body);
    // A different visible value is assigned by sync, which also replaces the
    // textarea's native undo value. Keep metadata history within that text visit.
    if(this.text!==text){this.history=[];this.lineages=parseDeck(body).cards.map(()=>this.serial++);}
    else if(this.body!==body){
      // Cards can allocate an id or change a tint without replacing the visible
      // textarea. Keep those later metadata acts when native Text Undo restores
      // an earlier deletion/merge. Lineages distinguish a surviving card from
      // its merged aliases, even before it has a durable identity.
      const previous=parseDeck(this.body).cards.map(card=>cardDetails(card.words));
      const changes=parseDeck(body).cards.map((card,i)=>{
        const next=cardDetails(card.words),fields=['id','aliases','color'].filter(key=>JSON.stringify(next[key])!==JSON.stringify(previous[i][key]));
        return {lineage:this.lineages[i],next,fields};
      }).filter(change=>change.fields.length);
      for(const entry of this.history){
        const kept=new Map(parseDeck(entry.body).cards.map((card,i)=>[i,cardDetails(card.words)]));let changed=false;
        for(const change of changes){
          const i=entry.lineages.indexOf(change.lineage);if(i<0)continue;
          const detail=kept.get(i);for(const key of change.fields)detail[key]=change.next[key];changed=true;
        }
        if(changed)entry.body=putDetails(entry.text,spans(entry.text),kept);
      }
    }
    this.body=body;this.text=text;return text;
  }
  remember(text,body,lineages){
    if(this.history.at(-1)?.body!==body)this.history.push({text,body,lineages:[...lineages]});
  }
  edit(text,change){
    const historical=/^history(Undo|Redo)$/.test(change?.inputType??'')?[...this.history].reverse().find(x=>x.text===text):null;
    const projected=historical?null:projectEdit(this.body,text,change);
    const body=historical?.body??projected.body;
    const lineages=historical?.lineages??projected.parents.map(i=>i===null?this.serial++:this.lineages[i]);
    // Ordinary keystrokes need no extra copy of the whole page. Keep both sides
    // only when an edit changes card structure/metadata, so long typing runs do
    // not evict the identities needed to undo an earlier deletion or merge.
    if(identityShape(body)!==identityShape(this.body)||JSON.stringify(lineages)!==JSON.stringify(this.lineages)){
      this.remember(this.text,this.body,this.lineages);this.remember(text,body,lineages);
    }
    this.body=body;this.text=text;this.lineages=lineages;return body;
  }
}
