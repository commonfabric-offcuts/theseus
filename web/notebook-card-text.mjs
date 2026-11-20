import { parseDeck } from './deck.mjs';
import { cardDetails, detailLines, detailsLine, stripDetails, mergeDetails, withCardDetails } from './card-details.mjs';

export const cardTextValue = text => String(text ?? '').replace(/\r\n?/g, '\n');
const wordsOf = card => cardTextValue(cardDetails(card.words).words).trim();
const rowsOf = text => {
  const deck = parseDeck(text); let start = deck.opening.length;
  return deck.cards.map(card => {
    const row = { card, start, end: start + card.raw.length, title: card.title, words: wordsOf(card) };
    row.signature = JSON.stringify([row.title, row.words]); start = row.end; return row;
  });
};
const patch = (before, after, change) => {
  const start = change?.start, end = change?.end, inserted = after.length - before.length + (end - start);
  if (Number.isInteger(start) && Number.isInteger(end) && start <= end && inserted >= 0 &&
      before.slice(0,start) === after.slice(0,start) && before.slice(end) === after.slice(start+inserted))
    return {start,end,shift:inserted-(end-start)};
  let left=0,tail=0;
  while(left<before.length&&left<after.length&&before[left]===after[left])left++;
  while(tail<before.length-left&&tail<after.length-left&&before.at(-tail-1)===after.at(-tail-1))tail++;
  return {start:left,end:before.length-tail,shift:after.length-before.length};
};
const emptyDetails = () => ({id:null,aliases:[],ids:[],color:null});
const joined = words => words.trim().replace(/\n(?:[ \t]*\n)+/g,'\n\n');

// Identity is always derived from the confirmed body, never learned from a
// transient heading. Previous positions only break ties between exact twins.
export class CardTextProjection {
  confirm(body) {
    if(this.base?.body===body)return;
    const text=cardTextValue(stripDetails(body));
    const confirmed=this.base?this.align(text):new Map(),next=new Map([...confirmed].map(([i,j])=>[j,i]));
    const pairs=new Map([...(this.pairs??[])].filter(([,j])=>next.has(j)).map(([i,j])=>[i,next.get(j)]));
    this.base={body,text,rows:rowsOf(text),raw:rowsOf(body)};
    this.pairs=pairs;
  }
  show(body, confirmed=body) {
    this.confirm(confirmed);
    this.body=body;this.text=cardTextValue(stripDetails(body));
    this.pairs=this.align(this.text);return this.text;
  }
  align(text,change) {
    const before=this.base.rows,after=rowsOf(text),chosen=new Map(),used=new Set();
    const choose=(i,j)=>{chosen.set(i,j);used.add(j);};
    const preferences=new Map();
    if(this.text!==undefined){
      const edit=patch(this.text,text,change),positions=new Map(after.map((r,i)=>[r.start,i]));
      rowsOf(this.text).forEach((row,i)=>{
        const j=this.pairs?.get(i);if(j===undefined||row.signature!==before[j]?.signature)return;
        const at=row.end<=edit.start?row.start:row.start>=edit.end?row.start+edit.shift:-1,k=positions.get(at);
        if(k!==undefined&&after[k].signature===row.signature)preferences.set(k,j);
      });
    }
    const bySignature=new Map();
    before.forEach((r,j)=>{const list=bySignature.get(r.signature)??[];list.push(j);bySignature.set(r.signature,list);});
    // Longest ordered matches: a card moved above the rest must not strand
    // all the cards it passed. Reverse candidates keep each row in one chain.
    const reserved=new Set(preferences.values()),tails=[];
    after.forEach((r,i)=>{
      const preferred=preferences.get(i),matches=preferred!==undefined?[preferred]:
        (bySignature.get(r.signature)??[]).filter(j=>!reserved.has(j));
      for(const j of [...matches].reverse()){
        let lo=0,hi=tails.length;
        while(lo<hi){const mid=(lo+hi)>>1;if(tails[mid].j<j)lo=mid+1;else hi=mid;}
        tails[lo]={i,j,previous:lo?tails[lo-1]:null};
      }
    });
    const anchors=[];
    for(let node=tails.at(-1);node;node=node.previous)anchors.push([node.i,node.j]);
    anchors.reverse();for(const [i,j] of anchors)choose(i,j);
    const bounds=[[-1,-1],...anchors,[after.length,before.length]];
    for(let n=1;n<bounds.length;n++){
      const [a,b]=bounds[n-1],[z,y]=bounds[n];
      for(const field of ['title','words'])for(let i=a+1;i<z;i++){
        if(chosen.has(i)||!after[i][field])continue;
        for(let j=b+1;j<y;j++)if(!used.has(j)&&before[j][field]===after[i][field]){choose(i,j);break;}
      }
      const left=[],right=[];
      for(let j=b+1;j<y;j++)if(!used.has(j))left.push(j);
      for(let i=a+1;i<z;i++)if(!chosen.has(i))right.push(i);
      if(left.length===1&&right.length===1)choose(right[0],left[0]);
    }
    // A move can cross the anchors. Only a fully unchanged card pairs here.
    after.forEach((r,i)=>{if(!chosen.has(i)){
      const j=bySignature.get(r.signature)?.find(j=>!used.has(j));if(j!==undefined)choose(i,j);
    }});
    return chosen;
  }
  render(text,pairs,written) {
    const rows=rowsOf(written),used=new Set(pairs.values()),current=rowsOf(this.body),kept=new Set();let body=written;
    for(let i=rows.length-1;i>=0;i--){
      const row=rows[i],j=pairs.get(i),base=j===undefined?null:this.base.raw[j];
      // Equal words are not enough: current metadata must belong to this
      // same confirmed card, or an edited twin can borrow its sibling's ID.
      const same=current.map((r,k)=>({r,k})).filter(({r,k})=>!kept.has(k)&&r.signature===row.signature&&this.pairs?.get(k)===j)
        .sort((a,b)=>Math.abs(a.k-i)-Math.abs(b.k-i))[0];
      if(same)kept.add(same.k);
      const source=same?.r??base;
      let detail=source?cardDetails(source.card.words):emptyDetails();
      if(base){
        let combined=this.base.rows[j].words;const merged=[];
        for(let k=j+1;k<this.base.rows.length&&!used.has(k);k++){
          const moved=this.base.rows[k];if(!moved.words)break;
          combined=[combined,moved.words].filter(Boolean).join('\n\n');merged.push(k);
          if(joined(row.words)===joined(combined)){
            for(const k of merged)detail=mergeDetails(detail,cardDetails(this.base.raw[k].card.words));break;
          }
        }
      }
      if(!detail.id&&!detail.aliases.length)continue;
      if(source&&cardTextValue(stripDetails(source.card.raw))===cardTextValue(row.card.raw)&&
        JSON.stringify(detail.aliases)===JSON.stringify(cardDetails(source.card.words).aliases)){
        body=body.slice(0,row.start)+source.card.raw+body.slice(row.end);continue;
      }
      const line=detailsLine(detail),firstBreak=row.card.raw.indexOf('\n');
      const oldLine=base&&detailLines(base.card.raw)[0];
      const underTitle=oldLine&&stripDetails(base.card.raw.slice(0,oldLine.start)).trim()===base.card.raw.split('\n')[0].trim();
      const openFence=withCardDetails(row.card.words,detail).startsWith(line+'\n\n');
      let at=row.start+(underTitle||openFence?(firstBreak<0?row.card.raw.length:firstBreak):row.card.raw.replace(/(?:\r?\n)+$/,'').length);
      if(written[at-1]==='\r')at--;
      const newline=written.includes('\r\n')?'\r\n':'\n';
      body=body.slice(0,at)+newline+newline+line+body.slice(at);
    }
    return body;
  }
  edit(value,change) {
    const text=cardTextValue(value);
    if(text===this.text)return this.body;
    const pairs=this.align(text,change),body=this.render(text,pairs,value);
    this.text=text;this.pairs=pairs;return this.body=body;
  }
}
export function keepCardDetails(body,text,change=null){const p=new CardTextProjection();p.show(body);return p.edit(text,change);}
