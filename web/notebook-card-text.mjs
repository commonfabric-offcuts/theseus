import { parseDeck } from './deck.mjs';
import { cardDetails, detailLines, detailRanges, detailsLine, stripDetails, mergeDetails } from './card-details.mjs';
import { fenceOpen, fenceEnd } from './fences.mjs';

export const cardTextValue = text => String(text ?? '').replace(/\r\n?/g, '\n');

// Every displayed UTF-16 boundary has a raw boundary. CRLF occupies one
// textarea position; hidden ranges occupy none. No saved row is an identity key.
function plainMap(raw) {
  let text='';const offsets=[0];
  for(let at=0;at<raw.length;){
    const c=raw[at++];if(c==='\r'&&raw[at]==='\n')at++;
    text+=c==='\r'?'\n':c;offsets.push(at);
  }
  return {raw,text,offsets};
}
function rowsOf(text) {
  const deck=parseDeck(text);let start=deck.opening.length;
  return deck.cards.map(card=>{
    const row={card,start,end:start+card.raw.length};start=row.end;
    row.inkEnd=row.start+card.raw.trimEnd().length;
    row.tail=row.start+card.raw.replace(/\n+$/,'').length;
    row.signature=JSON.stringify([card.title,cardDetails(card.words).words.trim()]);
    return row;
  });
}
function bodyMap(body) {
  let plain='',at=0;const hidden=[],spans=[];
  const rows=rowsOf(body),lines=detailLines(body);
  for(const range of detailRanges(body)){
    const start=Math.max(at,range.start),end=Math.max(start,range.end);
    spans.push({start:at,end:start,plain:plain.length});plain+=body.slice(at,start);
    const row=rows.findIndex(r=>range.end>r.start&&range.start<r.end);
    hidden.push({at:cardTextValue(plain).length,raw:body.slice(start,end),row,
      lines:lines.filter(l=>l.start>=start&&l.start<end).map(l=>body.slice(l.start,l.end).replace(/\r?\n$/,''))});
    at=end;
  }
  spans.push({start:at,end:body.length,plain:plain.length});plain+=body.slice(at);
  const map=plainMap(plain);
  const visibleAt=offset=>{
    let count=0;
    for(const span of spans){
      if(offset<=span.start)return count;
      count+=cardTextValue(body.slice(span.start,Math.min(span.end,offset))).length;
      if(offset<=span.end)return count;
    }
    return count;
  };
  const rawAt=offset=>{
    const p=map.offsets[offset];
    for(const span of spans)if(p<=span.plain+span.end-span.start)return span.start+p-span.plain;
    return body.length;
  };
  return {...map,hidden,rawAt,visibleAt,rows:rows.map((r,i)=>({
    ...r,index:i,start:visibleAt(r.start),end:visibleAt(r.end),
    inkEnd:visibleAt(r.start)+cardTextValue(stripDetails(r.card.raw)).trimEnd().length,
    signature:JSON.stringify([r.card.title,cardTextValue(cardDetails(r.card.words).words).trim()])
  }))};
}
function changedRange(before,after,change) {
  const {start,end}=change??{},inserted=after.length-before.length+(end-start);
  if(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>=start&&end<=before.length&&inserted>=0&&
      before.slice(0,start)===after.slice(0,start)&&before.slice(end)===after.slice(start+inserted))
    return {start,end,text:after.slice(start,start+inserted)};
  let startAt=0,tail=0;
  while(startAt<before.length&&startAt<after.length&&before[startAt]===after[startAt])startAt++;
  while(tail<before.length-startAt&&tail<after.length-startAt&&before.at(-tail-1)===after.at(-tail-1))tail++;
  return {start:startAt,end:before.length-tail,text:after.slice(startAt,after.length-tail)};
}
function endingBefore(body,at) {
  const found=body.slice(0,at).match(/\r\n|\r|\n/g);return found?.at(-1)??'\n';
}
function fenceAt(text,position) {
  const lines=text.split('\n');let fence=null,opening=-1,at=0;
  for(let i=0;i<lines.length&&at<=position;i++){
    const line=lines[i].replace(/\r$/,'');
    if(fence){if(fenceEnd(line,fence)>=0){fence=null;opening=-1;}}
    else {const next=fenceOpen(line,(lines[i+1]??'').replace(/\r$/,''));if(next&&next.end<0){fence=next;opening=at;}}
    at+=lines[i].length+1;
  }
  return opening;
}
function placeHidden(raw,text,tokens) {
  const map=plainMap(raw),rows=rowsOf(text);
  for(const token of tokens){
    // A swallowed heading is no longer a card boundary. Its marker stays in
    // the fenced writing; only a surviving owner can relocate its own line.
    const row=rows.find(r=>r.start===token.ownerStart);
    const opening=row&&fenceAt(text.slice(row.start,row.end),token.at-row.start);
    if(opening!==undefined&&opening>=0){
      let at=row.start+opening;
      while(at>row.start&&text[at-1]==='\n')at--;
      const nl=endingBefore(raw,map.offsets[at]);
      token.at=at;token.raw=nl+nl+token.lines.join(nl);
    }
  }
  let body='',previous=0;const ownedLines=new Set(),insertions=[];
  for(const token of tokens.map((t,i)=>({...t,order:i})).sort((a,b)=>a.at-b.at||a.order-b.order)){
    const at=map.offsets[token.at];body+=raw.slice(previous,at);
    if(!token.imported)for(const line of detailLines(token.raw))ownedLines.add(body.length+line.start);
    insertions.push({start:body.length,end:body.length+token.raw.length,at:token.at});
    body+=token.raw;previous=at;
  }
  return {body:body+raw.slice(previous),ownedLines,insertions};
}
function removeRanges(body,ranges) {
  const merged=[];
  for(const range of [...ranges].sort((a,b)=>a.start-b.start)){
    const last=merged.at(-1);
    if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);
    else merged.push({...range});
  }
  let text='',previous=0;
  for(const {start,end} of merged){text+=body.slice(previous,start);previous=end;}
  return {body:text+body.slice(previous),at:offset=>offset-merged.reduce((n,r)=>n+Math.max(0,Math.min(offset,r.end)-r.start),0)};
}

// Apply one edit to the current raw body. Whole removed rows can pair only
// with exact signatures in this replacement, each old occurrence used once.
function replaceBody(body,value,change,transfer=null,selection=[]) {
  const map=bodyMap(body),text=cardTextValue(value),edit=changedRange(map.text,text,change);
  const {start,end}=edit,shift=edit.text.length-(end-start),after=rowsOf(text);
  const nl=endingBefore(body,map.rawAt(start));
  const inserted=transfer?.plain??edit.text.replaceAll('\n',nl);
  const plain=map.raw.slice(0,map.offsets[start])+inserted+map.raw.slice(map.offsets[end]);
  const removed=new Set(map.rows.filter(r=>start<=r.start&&end>=r.inkEnd&&end>start).map(r=>r.index));
  const pairs=new Map(),available=new Map();
  for(const r of map.rows)if(removed.has(r.index)){
    const list=available.get(r.signature)??[];list.push(r.index);available.set(r.signature,list);
  }
  if(transfer===null)for(const r of after)if(r.start>=start&&r.inkEnd<=start+edit.text.length){
    const old=available.get(r.signature)?.shift();if(old!==undefined)pairs.set(old,r);
  }
  const counts=new Map();for(const t of map.hidden)counts.set(t.row,(counts.get(t.row)??0)+1);
  const tokens=[];
  for(const token of map.hidden){
    const r=map.rows[token.row];let at,ownerStart;
    if(removed.has(token.row)){
      const paired=pairs.get(token.row);if(!paired)continue;
      at=paired.tail;ownerStart=paired.start;
    }else{
      at=token.at<start?token.at:token.at>=end?token.at+shift:start+edit.text.length;
      ownerStart=r&&(r.start<start?r.start:r.start>=end?r.start+shift:start);
      // A single row's own marker follows its words, not an inserted heading.
      // Secondary lines retain their exact positions while a heading is retyped.
      if(r&&counts.get(token.row)===1&&((start<r.end&&end>r.start)||
          (start===end&&start===map.text.length&&r.end===start))){
        const current=after.find(row=>row.start===ownerStart);
        if(current)at=current.tail;
      }
    }
    tokens.push({...token,at:Math.max(0,Math.min(text.length,at)),ownerStart});
  }
  if(transfer!==null){
    for(const token of transfer.tokens)tokens.push({...token,at:start+token.at,ownerStart:start+token.ownerStart,row:-1,imported:true});
  }
  // Merge when a deletion removes the heading boundary, even without its
  // newline or one character at a time. A remaining valid heading is a rename.
  const lower=map.rows.find(r=>{
    const raw=cardTextValue(r.card.raw),ownerStart=Math.min(r.start,start);
    return r.index>0&&!removed.has(r.index)&&edit.text===''&&end>r.start&&
      start<r.start+raw.split('\n')[0].length&&
      end<=r.start+raw.indexOf(cardTextValue(cardDetails(r.card.words).words))&&
      !after.some(row=>row.start===ownerStart);
  });
  if(lower){
    const upper=map.rows.slice(0,lower.index).filter(r=>!removed.has(r.index)).at(-1);
    const target=upper&&after.find(r=>r.start===upper.start);
    if(target){
      const merged=mergeDetails(cardDetails(upper.card.words),cardDetails(lower.card.words));
      for(let i=tokens.length-1;i>=0;i--)if(tokens[i].row===upper.index||tokens[i].row===lower.index)tokens.splice(i,1);
      if(merged.id||merged.aliases.length){const line=detailsLine(merged);tokens.push({at:target.tail,raw:nl+nl+line,lines:[line],row:upper.index,ownerStart:target.start});}
    }
  }
  const placed=placeHidden(plain,text,tokens),lines=detailLines(placed.body),ranges=detailRanges(placed.body);
  const ids=new Set(lines.filter(line=>placed.ownedLines.has(line.start)).flatMap(line=>[line.id,...line.aliases]).filter(Boolean));
  const duplicates=[];
  for(let i=0;i<lines.length;i++)if(!placed.ownedLines.has(lines[i].start)){
    const incoming=[lines[i].id,...lines[i].aliases].filter(Boolean);
    if(incoming.some(id=>ids.has(id)))duplicates.push(ranges[i]);
    else for(const id of incoming)ids.add(id);
  }
  const result=removeRanges(placed.body,duplicates);
  // A fence may turn retained marker bytes into visible writing (12797).
  // Account for only those exact restored spans inside a fence; every user
  // character still has to survive the same shared projection as a Reader.
  const revealed=placed.insertions.filter(span=>!lines.some(line=>line.start>=span.start&&line.start<span.end)&&fenceAt(placed.body,span.start)>=0);
  const writing=removeRanges(placed.body,[...duplicates,...revealed]).body;
  if(cardTextValue(stripDetails(writing))!==cardTextValue(stripDetails(text)))throw Error('Notebook input did not preserve its visible words.');
  const rawMap=plainMap(plain),projected=bodyMap(result.body);
  return {body:result.body,selection:selection.map(at=>{
    const rawAt=rawMap.offsets[at]+placed.insertions.reduce((n,span)=>n+(span.at<at?span.end-span.start:0),0);
    return projected.visibleAt(result.at(rawAt));
  })};
}

// History is raw snapshots for this opening, not a catalog of former headings.
export class CardTextProjection {
  constructor(){this.history=[];this.position=0;this.cut=null;}
  confirm(body){this.base={body,text:cardTextValue(stripDetails(body))};}
  show(body,confirmed=body){
    this.confirm(confirmed);this.body=body;this.text=cardTextValue(stripDetails(body));return this.text;
  }
  close(){this.history=[];this.position=0;this.cut=null;}
  rememberCut(start,end){
    const map=bodyMap(this.body),visible=map.text.slice(start,end);
    if(start===end)return '';
    const selected=new Set(map.rows.filter(r=>start<=r.start&&end>=r.inkEnd).map(r=>r.index));
    const tokens=map.hidden.filter(token=>selected.has(token.row)).map(token=>({...token,at:Math.min(end,token.at)-start,ownerStart:map.rows[token.row].start-start}));
    const plain=map.raw.slice(map.offsets[start],map.offsets[end]);
    const raw=placeHidden(plain,visible,tokens).body;
    this.cut={visible,raw,plain,tokens,position:this.position,body:this.body,start,end};
    return this.cut.visible;
  }
  undo(direction=-1){
    const entry=this.history[direction<0?this.position-1:this.position];
    if(!entry)return null;
    const state=direction<0?entry.before:entry.after;this.position+=direction;
    if(this.cut&&direction<0&&this.position<=this.cut.position)this.cut=null;
    this.body=state.body;this.text=cardTextValue(stripDetails(this.body));
    return {...state,selection:[...state.selection]};
  }
  edit(value,change={}){
    if(change?.inputType==='historyUndo'||change?.inputType==='historyRedo'){
      this.undo(change.inputType==='historyUndo'?-1:1);return this.body;
    }
    const text=cardTextValue(value);if(text===this.text)return this.body;
    const range=changedRange(this.text,text,change),selection=[change?.start??range.start,change?.end??range.end];
    if(change?.inputType==='deleteByCut'&&
        (!this.cut||this.cut.body!==this.body||this.cut.start!==range.start||this.cut.end!==range.end))
      this.rememberCut(range.start,range.end);
    const transfer=change?.inputType==='insertFromPaste'&&this.cut?.removed&&this.cut.visible===range.text?this.cut:null;
    const before={body:this.body,selection};
    const caret=change?.selection??[range.start+range.text.length,range.start+range.text.length];
    const result=replaceBody(this.body,text,range,transfer,caret),body=result.body;
    if(change?.inputType==='deleteByCut'&&this.cut)this.cut.removed=true;
    if(transfer)this.cut=null;
    this.history.length=this.position;
    this.selection=result.selection;
    this.history.push({before,after:{body,selection:this.selection}});this.position++;
    this.body=body;this.text=cardTextValue(stripDetails(body));return body;
  }
}
export function keepCardDetails(body,text,change=null){const p=new CardTextProjection();p.show(body);return p.edit(text,change);}
