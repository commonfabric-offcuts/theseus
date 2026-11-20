// A card's lazy identity and tint, kept in its Notebook words (docs/decks.md).
// Only a complete, valid line outside fences is metadata; anything else is writing.
import { fenceEnd, fenceOpen } from './fences.mjs';
import { AGENT_PALETTE } from './author-colors.mjs';

export const validCardId = value => typeof value === 'string' && /^c-[0-9a-f]{32}$/.test(value);
const marker = /^\s*<!-- theseus-card: (\{.*\}) -->\s*$/;
export function detailsLine(details) {
  const {id, aliases, color} = details ?? {};
  if (!(id === null || validCardId(id)) || !Array.isArray(aliases) || !aliases.every(validCardId) ||
      (!id && !aliases.length) || new Set([...(id ? [id] : []), ...aliases]).size !== aliases.length + (id ? 1 : 0) ||
      !(color === null || AGENT_PALETTE.includes(color)))
    throw Error('A card needs valid identities and a palette color.');
  return '<!-- theseus-card: '+JSON.stringify({id,aliases,color})+' -->';
}
export function detailLines(text, {partial=false}={}) {
  const lines=String(text??'').split('\n'), found=[];
  let fence=null,offset=0;
  lines.forEach((raw,i)=>{
    const line=raw.replace(/\r$/,''),before=fence;
    if(fence){if(fenceEnd(line,fence)>=0)fence=null;}
    else {const open=fenceOpen(line,(lines[i+1]??'').replace(/\r$/,''));if(open&&open.end<0)fence=open;}
    const match=!before&&!fence&&marker.exec(line);
    if(match)try {
      const value=JSON.parse(match[1]);
      if(Object.keys(value).length===3&&Object.hasOwn(value,'id')&&Object.hasOwn(value,'aliases')&&Object.hasOwn(value,'color')) {
        detailsLine(value);found.push({...value,line:line.trim(),start:offset,end:offset+raw.length+(i<lines.length-1?1:0)});
      }
    }catch{/* An invalid marker remains ordinary writing. */}
    if(partial&&i===lines.length-1&&!before&&!fence&&(line.trim().length>=2&&('<!-- theseus-card: '.startsWith(line.trim())||/^\s*<!-- theseus-card: \{/.test(line)))&&!line.trimEnd().endsWith('-->'))
      found.push({start:offset,end:offset+raw.length,partial:true});
    offset+=raw.length+1;
  });
  return found;
}
export function detailRanges(text, options) {
  return detailLines(text,options).map(row=>{
    let start=row.start,end=row.end;
    // The blank separator written with the hidden line belongs to it. Leave
    // the following line break so projecting/restoring never grows blank lines.
    const prefix=text.slice(Math.max(0,start-4),start);
    if(prefix.endsWith('\r\n\r\n'))start-=4;
    else if(prefix.endsWith('\n\n'))start-=2;
    if(start!==row.start){
      if(text.slice(end-2,end)==='\r\n')end-=2;
      else if(text[end-1]==='\n')end--;
    }
    // Metadata before an open fence owns its following blank separator.
    if(start===0){if(text.slice(end,end+2)==='\r\n')end+=2;else if(text[end]==='\n')end++;}
    return {start,end};
  });
}
export function stripDetails(text, options) {
  let kept='',at=0;
  for(const {start,end} of detailRanges(text,options)){kept+=text.slice(at,Math.max(at,start));at=end;}
  return kept+text.slice(at);
}
export function cardDetails(text) {
  const rows=detailLines(text),id=rows[0]?.id??null;
  const ids=[...new Set(rows.flatMap(row=>[...(row.id?[row.id]:[]),...row.aliases]))];
  return {words:rows.length?stripDetails(text).replace(/^(?:[ \t]*\n)+/,'').trimEnd():text,
    id, aliases:ids.filter(each=>each!==id), ids, color:rows[0]?.color??null, lines:rows.map(row=>row.line)};
}
export function withCardDetails(words, details) {
  const visible=cardDetails(words).words;
  if(!details.id&&!details.aliases?.length)return visible;
  // The first line is outside every fence, including an unfinished one.
  let fence=null;const lines=visible.split('\n');
  for(let i=0;i<lines.length;i++){
    const line=lines[i].replace(/\r$/,'');
    if(fence){if(fenceEnd(line,fence)>=0)fence=null;}
    else {const open=fenceOpen(line,lines[i+1]?.replace(/\r$/,'')??'');if(open&&open.end<0)fence=open;}
  }
  const parts=fence?[detailsLine(details),visible]:[visible,detailsLine(details)];
  return parts.filter(Boolean).join('\n\n');
}
export function mergeDetails(target, moved) {
  return {id:target.id, aliases:[...new Set([...target.aliases,...moved.ids])].filter(id=>id!==target.id),color:target.color};
}

// Keep each visible part an exact source substring for Core quote validation.
export function detailParts(text) {
  const parts=[];let at=0;
  for(const {start,end} of detailRanges(text)){if(start>at)parts.push(text.slice(at,start));at=end;}
  if(at<text.length)parts.push(text.slice(at));
  return parts.filter(part=>/\S/.test(part));
}
