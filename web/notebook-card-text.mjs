import { parseDeck } from './deck.mjs';
import { cardDetails, detailsLine, stripDetails, mergeDetails } from './card-details.mjs';

const spans=body=>{
  const deck=parseDeck(body);let at=deck.opening.length;
  return deck.cards.map(card=>{const start=at;at+=card.raw.length;return {card,start,end:at,last:start+card.raw.trimEnd().length};});
};
// Reattach invisible metadata to the card containing its surviving writing.
// A whole card cut from Text loses its id; native Undo restores the exact prior
// projection from the visit's structural edit history. A heading-only edit/rename keeps it.
export function keepCardDetails(body, text, change=null) {
  const before=stripDetails(body);if(before===text)return body;
  let start=change?.start,end=change?.end;
  let inserted=text.length-before.length+(end-start);
  if(!Number.isInteger(start)||!Number.isInteger(end)||start>end||inserted<0||
      before.slice(0,start)!==text.slice(0,start)||before.slice(end)!==text.slice(start+inserted)){
    start=0;while(start<before.length&&start<text.length&&before[start]===text[start])start++;
    let suffix=0;while(suffix<before.length-start&&suffix<text.length-start&&before[before.length-1-suffix]===text[text.length-1-suffix])suffix++;
    end=before.length-suffix;inserted=text.length-suffix-start;
  }
  const old=spans(before),fresh=spans(text),original=parseDeck(body).cards,kept=new Map(),delta=inserted-(end-start);
  for(let i=0;i<old.length;i++){
    const detail=cardDetails(original[i].words),span=old[i];
    if(start<=span.start&&end>=span.last)continue;
    const anchor=span.start<start?span.start:span.start>=end?span.start+delta:end<span.last?start+inserted:start;
    const into=fresh.findIndex(row=>row.start<=anchor&&anchor<row.end);
    if(into<0)continue;
    const previous=kept.get(into);kept.set(into,previous?{...mergeDetails(previous,detail),ids:[...new Set([...previous.ids,...detail.ids])]}:detail);
  }
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
  constructor(){this.history=[];}
  show(body){
    const text=stripDetails(body);
    // A different visible value is assigned by sync, which also replaces the
    // textarea's native undo value. Keep metadata history within that text visit.
    if(this.text!==undefined&&this.text!==text)this.history=[];
    this.body=body;this.text=text;return text;
  }
  remember(text,body){
    if(this.history.at(-1)?.body!==body)this.history.push({text,body});
  }
  edit(text,change){
    const historical=/^history(Undo|Redo)$/.test(change?.inputType??'')?[...this.history].reverse().find(x=>x.text===text):null;
    const body=historical?.body??keepCardDetails(this.body,text,change);
    // Ordinary keystrokes need no extra copy of the whole page. Keep both sides
    // only when an edit changes card structure/metadata, so long typing runs do
    // not evict the identities needed to undo an earlier deletion or merge.
    if(identityShape(body)!==identityShape(this.body)){
      this.remember(this.text,this.body);this.remember(text,body);
    }
    this.body=body;this.text=text;return body;
  }
}
