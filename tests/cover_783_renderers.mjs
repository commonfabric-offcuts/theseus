// Actual feed/Reader drawing in a minimal DOM; deliberately no layout/gesture claim.
import assert from 'node:assert/strict';
import { miniDocument, Element, matches } from './fixtures/mini_dom.mjs';
import { arrangeStacks, stackState } from '../web/reply-stacks.mjs';
import { Reader } from '../web/reader.mjs';
import { assertWords783, WORDS783 } from './cover_783_oracle.mjs';
const originalQuery = Element.prototype.querySelectorAll;
Element.prototype.querySelectorAll = function(selector) {
  if(selector.includes(','))return [...new Set(selector.split(',').flatMap(s=>this.querySelectorAll(s.trim())))];
  if(/\[[^\]]+=/.test(selector)) {
    const own=selector.startsWith(':scope > ');const sel=selector.replace(':scope > ','');
    const match=/^(.*?)\[([\w-]+)=['"]?([^'"\]]+)['"]?\]$/.exec(sel);
    if(!match)throw Error('unsupported fixture selector '+selector);
    return (own?this.children:[...this.descendants()]).filter(n=>typeof n==='object'&&(!match[1]||matches(n,match[1]))&&
      (match[2].startsWith('data-')?n.dataset[match[2].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:n.getAttribute(match[2]))===match[3]);
  }
  if(selector === '*')return [...this.descendants()];
  if(selector.startsWith(':scope > ') && selector.slice(9).includes(' > ')){const [a,...rest]=selector.slice(9).split(' > ');return this.querySelectorAll(':scope > '+a).flatMap(n=>n.querySelectorAll(':scope > '+rest.join(' > ')));}
  if(selector.startsWith(':scope > '))return originalQuery.call(this,selector);
  if(selector.includes(' > ')) {
    const [parent,child]=selector.split(' > ');return originalQuery.call(this,parent).flatMap(n=>n.querySelectorAll(':scope > '+child));
  }
  return originalQuery.call(this,selector);
};
Object.defineProperties(Element.prototype, {
  firstElementChild: {get(){return this.children.find(n=>typeof n==='object')??null;}},
  nextElementSibling: {get(){const a=this.parent?.children??[];return a.slice(a.indexOf(this)+1).find(n=>typeof n==='object')??null;}},
  parentElement: {get(){return this.parent;}},
  ownerDocument: {get(){return this.document;}},
});
Element.prototype.contains=function(node){return node===this||[...this.descendants()].includes(node);};
Element.prototype.matches=function(s){return matches(this,s);};
Element.prototype.after=function(node){this.parent.insertBefore(node,this.nextElementSibling);};
Element.prototype.getClientRects=function(){return this.hidden?[]:[{}];};
export function renderedWords783(sheet) {
  return { stands:sheet.querySelector('.cover-stands')?.text,
    payload:sheet.querySelector('.cover-payload')?.querySelector('.cover-words')?.text,
    waits:sheet.querySelectorAll('.cover-wait').map(n=>n.text),
    links:sheet.querySelectorAll('a').map(n=>({text:n.text,href:n.getAttribute('href')??n.href})) };
}
export function rendererFixture783(rows, actor, arrange = arrangeStacks, getState = stackState, ReaderClass = Reader) {
  const doc=miniDocument();doc.getElementById=()=>null;
  const list=doc.createElement('div');const messages=new Map(rows.map(m=>[m.id,m]));
  for(const item of rows){const card=doc.createElement('article');card.className='message-card';card.dataset.id=item.id;card.dataset.seq=String(item.seq);
    const author=doc.createElement('div');author.className='message-author';author.textContent=item.author_id;card.append(author);list.append(card);}
  const paint=()=>arrange(list,messages,{doc,viewer:actor,unread:m=>m.unread,nameOf:id=>id});
  paint();
  const host=doc.createElement('details'),summary=doc.createElement('summary');host.append(summary);
  let found=null;
  const reader=Object.assign(Object.create(ReaderClass.prototype),{$:id=>id==='reader-cover'?host:summary,
    callbacks:{actor:()=>actor,dossierCover:()=>found,actorName:id=>id}});
  const drawReader=cover=>{found={rootId:rows[0].id,topicId:rows[0].topic_id,cover};const previous=globalThis.document;globalThis.document=doc;
    try{reader.paintCover({source_ref:{kind:'message'}});}finally{globalThis.document=previous;}};
  return {doc,list,messages,paint,host,summary,drawReader,state:getState(list)};
}
export function checkRenderers783(f, root, cover, words=WORDS783) {
  const section=f.state.sections.get(root);
  assert.ok(section,'actual feed folder exists');
  const sheet=section.querySelector(':scope > .dossier-cover');
  assert.ok(sheet,'actual feed sheet exists');
  const feed=renderedWords783(sheet);assertWords783(feed,words);
  f.drawReader(cover);const reader=renderedWords783(f.host.querySelector('.dossier-cover'));assertWords783(reader,words);
  assert.equal(f.host.children[0],f.summary,'Reader summary remains first');
  assert.ok(f.summary.text.includes(words.stands),'actual Reader summary literal LF');
  return {first:section.firstElementChild===sheet,feed,reader,fold:section.dataset.fold,children:section.children.map(n=>n.className)};
}
