import test from 'node:test';
import assert from 'node:assert/strict';
import { boxText, cardText, parseDeck, textCard } from '../web/deck.mjs';
import { DeckPage } from '../web/deck-page.mjs';
import { routeHref, parseRoute } from '../web/topic-navigation.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const A='c-11111111111111111111111111111111';
const line=(ids=[A],color='blue')=>'<!-- theseus-card: '+JSON.stringify({id:ids[0]??null,aliases:ids.slice(1),color})+' -->';
const body='## First\n\nWords **kept**\n\n'+line()+'\n\n### Child\n\nchild words\n';

test('867 the actual card writing projection omits the hidden identity/color line',()=>{
 const card=parseDeck(body).cards[0], shown=DeckPage.prototype.written.call({},card);
 assert.equal(shown.words,'Words **kept**');
 assert.deepEqual(shown.details,[line()]);
});
test('867 closing a renamed card restores its hidden identity alongside images and replies',()=>{
 const text=boxText({written:'Renamed\nChanged',details:[line()]});
 assert.equal(text,'Renamed\nChanged\n\n'+line());
});
test('867 a copied card route round trips and forces Cards, independent of a remembered Text preference',()=>{
 const route={kind:'cards',id:'page',card:A,view:'cards'};
 assert.doesNotThrow(()=>routeHref(route));
 assert.deepEqual(parseRoute(new URL(routeHref(route),'https://fixture.invalid')),route);
});
test('867 the actual per-card control painter supplies its named overflow beside the speech bubble',()=>{
 const doc=miniDocument(),p=Object.assign(Object.create(DeckPage.prototype),{doc,deck:parseDeck(body),talks:new Map(),room:null});
 const controls=p.bubbles(0,[]),more=controls.querySelector('.deck-menu');
 assert.ok(more,'each card has its overflow even without a reply stack');
 assert.equal(more.getAttribute('aria-label'),'This card');
 assert.equal(more.getAttribute('aria-haspopup'),'menu');
});

import { applyAct, deckBody, findCard } from '../web/deck.mjs';
import { cardDetails, stripDetails, withCardDetails, detailLines } from '../web/card-details.mjs';
import { CardTextProjection, keepCardDetails } from '../web/notebook-card-text.mjs';
const B='c-22222222222222222222222222222222';
const details=(id=A,color='blue',aliases=[])=>({id,aliases,color});
const hidden=d=>'<!-- theseus-card: '+JSON.stringify(d)+' -->';
const card=(title='First',words='words',d=details())=>'## '+title+'\n\n'+words+(d?'\n\n'+hidden(d):'')+'\n\n';
for(const step of [-1,1])for(const targetHasId of [true,false])test(`867 merge ${step} keeps neighbour identity and null color; aliases survive with primary=${targetHasId}`,()=>{
 const target=card('Neighbour','target',targetHasId?details(B,null):null),moved=card('Moved','source',details());
 const raw=step<0?target+moved:moved+target,deck=parseDeck(raw),i=step<0?1:0;
 const merged=applyAct(deck,{kind:'merge',text:cardText(deck.cards[i]),near:i,step});
 const meta=cardDetails(merged.deck.cards[0].words);
 assert.equal(meta.id,targetHasId?B:null);assert.deepEqual(meta.aliases,[A]);assert.equal(meta.color,null);
 assert.equal(detailLines(merged.deck.cards[0].words).length,1);
 const undo=applyAct(parseDeck(deckBody(merged.deck)),merged.undo);
 assert.deepEqual(undo.deck.cards.map(c=>cardDetails(c.words).ids),deck.cards.map(c=>cardDetails(c.words).ids));
 assert.deepEqual(undo.deck.cards.map(c=>cardDetails(c.words).color),deck.cards.map(c=>cardDetails(c.words).color));
 assert.equal(deckBody(applyAct(parseDeck(deckBody(undo.deck)),undo.undo).deck),deckBody(merged.deck));
});
test('867 a stale act refuses another same-text card after the named identity disappears',()=>{
 const deck=parseDeck(card('Same','words',details())+card('Same','words',details(B)));
 assert.equal(findCard({cards:[deck.cards[1]]},cardText(deck.cards[0]),0),-1);
 assert.equal(findCard({cards:[deck.cards[1],deck.cards[0]]},cardText(deck.cards[0]),0),1);
 assert.equal(findCard(parseDeck(card('Changed','words',details())),cardText(deck.cards[0]),0),-1);
});
test('867 Text projection keeps exact visible spacing across rename, repeated edits, CRLF and title-only cards',()=>{
 for(const raw of [card(),card('First','',details()),card().replaceAll('\n','\r\n')]){
  let body=raw,visible=stripDetails(body);
  for(let n=0;n<3;n++){
   const next=visible.replace('First','First '+n);
   body=keepCardDetails(body,next);assert.equal(stripDetails(body),next);assert.equal(cardDetails(parseDeck(body).cards[0].words).id,A);visible=next;
  }
 }
});
test('867 Text beforeinput range preserves a changed title but drops a completely removed card and Undo restores it',()=>{
 const raw=card()+card('Second','second',details(B,'rose')),projection=new CardTextProjection();
 const visible=projection.show(raw),cut=visible.indexOf('## Second');
 const after=projection.edit(visible.slice(cut),{start:0,end:cut,inputType:'deleteContentBackward'});
 assert.deepEqual(parseDeck(after).cards.map(c=>cardDetails(c.words).ids),[[B]]);
 const undone=projection.edit(visible,{inputType:'historyUndo'});assert.equal(undone,raw);
 const redone=projection.edit(visible.slice(cut),{inputType:'historyRedo'});assert.equal(redone,after);
});

import { Element } from './fixtures/mini_dom.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';
import { NotebookWriting } from '../web/notebook-writing.mjs';
import { AGENT_PALETTE } from '../web/author-colors.mjs';
import { plainCardText } from '../web/card-menu.mjs';
// Real painters/handlers; the adapter supplies DOM storage, not native layout.
function documentPort(){
 const doc={activeElement:null,addEventListener(){},removeEventListener(){}};
 class Node extends Element{
  constructor(tag){super(tag,doc);this.style={setProperty(){}};this.nodeType=1;}
  get childNodes(){return this.children;}
  get textContent(){return this.children.map(c=>c.textContent).join('');}
  set textContent(text){this.children=[];if(text)this.append(String(text));}
  append(...nodes){super.append(...nodes.map(n=>typeof n==='string'?{nodeType:3,textContent:n}:n));}
  *descendants(){for(const n of this.children){if(n.nodeType!==3)yield n;if(n.descendants)yield* n.descendants();}}
  contains(n){for(;n;n=n.parent)if(n===this)return true;return false;}
  querySelectorAll(selector){
   const door=/^(\.deck-card\[data-index="-?\d+"\]) (\.deck-menu)$/.exec(selector);
   return door?super.querySelectorAll(door[1]).flatMap(row=>row.querySelectorAll(door[2])):super.querySelectorAll(selector);
  }
  getBoundingClientRect(){return {top:0,left:0,right:40,bottom:40};}
 }
 doc.createElement=tag=>new Node(tag);doc.createElementNS=(_,tag)=>doc.createElement(tag);
 doc.createTextNode=text=>({nodeType:3,textContent:String(text)});doc.body=doc.createElement('body');doc.body.root=true;
 return doc;
}
function menuPage(raw=card(),doc=documentPort()){
 const p=Object.assign(Object.create(NotebookPage.prototype),{doc,item:'page',host:doc.body,base:{body:raw,revision:1},deck:parseDeck(raw),
  picked:0,selected:new Set(),folded:new Set(),acts:[],undos:[],readOnly:false,header:{description:{}},list:doc.createElement('ul'),
  paint(){},show(){},save(){},keepFolds(){},say(text){this.notice=text;},listening:new AbortController()});
 p.anchor=doc.createElement('button');doc.body.append(p.list,p.anchor);return p;
}
async function writingPort(t,raw=card('First','words',null)){
 const p=menuPage(raw);let source={instance_id:'i',source_ref:{kind:'memory',id:'page',revision:1},owner_scope:{kind:'workspace',id:'w'},title:'Page',body:raw,attachments:[],references:[]},journal=null;
 const bootstrap={instance_id:'i',actor:'owner',authority:{authority_id:'a',authority_epoch:'e'}};
 const calls=[],api={view:async()=>structuredClone(source),command:async e=>{
  calls.push(e);assert.deepEqual(journal.pending,e);
  source={...source,...structuredClone(e.args),source_ref:{...source.source_ref,revision:source.source_ref.revision+1}};
  return {instance_id:'i',operation_id:e.operation_id,kind:e.kind,status:'committed',recorded:true,result:{item_id:'page',revision:source.source_ref.revision,source_ref:source.source_ref}};
 }};
 const store={get:async()=>structuredClone(journal),put:async value=>{journal=structuredClone(value);}};
 const w=p.writing=new NotebookWriting({item:'page',bootstrap,api,store,delay:60000});await w.open();t.after(()=>w.close());
 p.cardsSeen=w.capture();p.save=()=>NotebookPage.prototype.save.call(p);
 return {p,w,api,calls,source:()=>source,journal:()=>journal};
}
function clipboard(t){const saved=[],old=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>saved.push(text)}}});
 const location=globalThis.location;globalThis.location=new URL('https://fixture.invalid/');
 t.after(()=>{if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;globalThis.location=location;});return saved;
}

test('867 Copy text renders markup as plain words, lists and table cells with boundaries',()=>{
 const doc=documentPort(),words='A **bold** [link](https://example.invalid) and `code`.\n\n- one\n- two\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n> quoted **words**\n\n```js\nconst x = 1;\n```';
 assert.equal(plainCardText('Literal *title*',words,doc),'Literal *title*\n\nA bold link and code.\n\n• one\n• two\n\nA\tB\n1\t2\n\nquoted words\n\nconst x = 1;');
});
test('867 opening the real shared menu and Copy text never allocates or saves a card, nor copies children',async t=>{
 const copied=clipboard(t),raw=card('Literal *title*','**Words**',null)+'### Child\n\nChild words\n',p=menuPage(raw);
 const menu=p.openCardMenu(0,p.anchor);t.after(()=>menu?.close(false));
 assert.equal(menu.root.getAttribute('aria-label'),'This card');
 assert.deepEqual(menu.root.children.map(n=>n.textContent),['Copy text','Copy link','Delete','Set color']);
 assert.deepEqual(menu.root.children.map(n=>n.querySelector('svg').getAttribute('data-glyph')),['copy','link','drop','palette']);
 await p.cardMenuItems(p.cardRef(0),p.anchor)[0].act();assert.deepEqual(copied,['Literal *title*\n\nWords']);
 assert.equal(deckBody(p.deck),raw);assert.deepEqual(p.acts,[]);
});
test('867 Delete targets the menu card and its children, irrespective of other selected cards; one Undo restores ids/colors',()=>{
 const raw=card()+'### Child\n\nchild\n\n'+card('Other','other',details(B,'rose')),p=menuPage(raw);
 p.selected=new Set([0,2]);p.cardMenuItems(p.cardRef(0),p.anchor)[2].act();
 assert.deepEqual(p.deck.cards.map(c=>c.title),['Other']);assert.equal(p.undos.length,1);p.undo();
 assert.deepEqual(p.deck.cards.map(c=>c.title),['First','Child','Other']);assert.equal(cardDetails(p.deck.cards[0].words).id,A);assert.equal(cardDetails(p.deck.cards[2].words).color,'rose');
});
for(const state of ['readOnly','reading','conflict','deleted','closed','actionPending','actionRunning','aborted'])test('867 stale destructive menu handlers recheck '+state,()=>{
 const p=menuPage(),items=p.cardMenuItems(p.cardRef(0),p.anchor),before=deckBody(p.deck);p.writing={};
 if(state==='aborted')p.listening.abort();else p.writing[state]=true;
 items[2].act();assert.equal(items[3].act(),undefined);assert.equal(deckBody(p.deck),before);assert.deepEqual(p.acts,[]);
});
test('867 stale menu cannot delete or recolor a different same-text card after removal',()=>{
 const p=menuPage(card('Same','words',details())+card('Same','words',details(B))),items=p.cardMenuItems(p.cardRef(0),p.anchor);
 p.deck.cards.shift();items[2].act();assert.equal(items[3].act(),undefined);assert.equal(p.deck.cards.length,1);assert.deepEqual(p.acts,[]);
});
test('867 link allocation saves once before copying; rename and movement keep the route identity',async t=>{
 const copied=clipboard(t),{p,w,calls}=await writingPort(t),ref=p.cardRef(0);await p.copyCard(ref,true);
 assert.equal(calls.length,1);assert.equal(copied.length,1);const id=parseRoute(new URL(copied[0])).card;assert.match(id,/^c-[0-9a-f]{32}$/);
 assert.equal(cardDetails(parseDeck(w.base.content.body).cards[0].words).id,id);assert.equal(p.undos.length,0);
 p.act({kind:'edit',text:cardText(p.deck.cards[0]),near:0,to:'Renamed\nNew words'});await p.copyCard(ref,true);
 assert.equal(parseRoute(new URL(copied[1])).card,id);assert.equal(calls.length,2);
 p.undo();assert.equal(cardDetails(p.deck.cards[0].words).id,id);assert.equal(p.deck.cards[0].title,'First');
});
test('867 a refused new link retains the id and writing but copies no dead link',async t=>{
 const copied=clipboard(t),{p,w,api,journal}=await writingPort(t);
 api.command=async e=>({instance_id:'i',operation_id:e.operation_id,kind:e.kind,recorded:false,status:'rejected',error:{code:'AUTHORITY_CHANGED',message:'Authority changed'}});
 await p.copyCard(p.cardRef(0),true);assert.deepEqual(copied,[]);assert.match(p.notice,/not saved/);assert.equal(w.readOnly,true);
 assert.ok(cardDetails(parseDeck(w.value.body).cards[0].words).id);assert.ok(journal());
});
test('867 a lost save answer retains the exact operation and Copy link retries before announcing success',async t=>{
 const copied=clipboard(t),{p,w,api}=await writingPort(t),command=api.command;
 let sent;api.command=async e=>{sent=e;throw Error('offline');};const ref=p.cardRef(0);await p.copyCard(ref,true);
 assert.deepEqual(copied,[]);assert.deepEqual(w.pending,sent);
 api.command=async e=>{assert.deepEqual(e,sent);return command(e);};await p.copyCard(ref,true);assert.equal(copied.length,1);
});
test('867 alias-only links resolve without allocation; Copy link then allocates a distinct primary',async t=>{
 clipboard(t);const raw=card('Neighbour','words',details(null,null,[A])),{p}=await writingPort(t,raw);
 assert.equal(p.cardAt({id:A}),0);const ref=p.cardRef(0);await p.copyCard(ref,true);
 const meta=cardDetails(p.deck.cards[0].words);assert.notEqual(meta.id,A);assert.ok(meta.id);assert.deepEqual(meta.aliases,[A]);assert.equal(p.cardAt({id:A}),0);
});
test('867 shared color picker exposes all eight swatches plus No color, commits then Undo keeps the id',async t=>{
 const {p}=await writingPort(t),picker=p.cardColors(p.cardRef(0),p.anchor);t.after(()=>picker.close(false));
 const swatches=picker.root.querySelectorAll('.swatch');assert.deepEqual(swatches.map(n=>n.getAttribute('aria-label')),AGENT_PALETTE);
 assert.equal(picker.root.querySelector('.swatch-default').textContent,'No color');
 await swatches.find(n=>n.getAttribute('aria-label')==='rose').onclick();const meta=cardDetails(p.deck.cards[0].words);
 assert.equal(meta.color,'rose');assert.ok(meta.id);assert.equal(picker.root.isConnected,false);p.undo();assert.equal(cardDetails(p.deck.cards[0].words).color,null);assert.equal(cardDetails(p.deck.cards[0].words).id,meta.id);
});
test('867 color refusal keeps the picker and recovery writing visible without a committed claim',async t=>{
 const {p,api,w}=await writingPort(t);api.command=async e=>({instance_id:'i',operation_id:e.operation_id,kind:e.kind,recorded:false,status:'rejected',error:{code:'READ_ONLY',message:'Read only'}});
 const picker=p.cardColors(p.cardRef(0),p.anchor);t.after(()=>picker.close(false));await picker.root.querySelectorAll('.swatch')[0].onclick();
 assert.equal(picker.root.isConnected,true);assert.match(picker.root.querySelector('.notice').textContent,/not confirmed/);assert.equal(cardDetails(parseDeck(w.value.body).cards[0].words).color,'green');
});

test('867 valid metadata alone is hidden; malformed, unknown-color, duplicate-id and fenced markers stay literal',()=>{
 const valid=hidden(details());assert.equal(stripDetails('words\n\n'+valid),'words');
 for(const invalid of [valid.replace('blue','pink'),hidden(details(A,'blue',[A])),hidden({id:A,aliases:[],color:null,extra:1}),valid.slice(0,-1)]){
  assert.equal(stripDetails('words\n\n'+invalid),'words\n\n'+invalid);
 }
 for(const fence of ['```','~~~~']){const raw=fence+'\n'+valid+'\n'+fence;assert.equal(stripDetails(raw),raw);}
});
test('867 lazy identities are kept through a word Undo created before allocation, and move/delete Undo',()=>{
 const p=menuPage(card('First','words',null)+card('Other','other',details(B)));
 p.act({kind:'edit',text:cardText(p.deck.cards[0]),near:0,to:'Renamed\nnew words'});const id=p.ensureCardId(p.cardRef(0));p.undo();
 assert.equal(p.deck.cards[0].title,'First');assert.equal(cardDetails(p.deck.cards[0].words).id,id);
 p.actOn('move',1);assert.equal(p.deck.cards[1].title,'First');assert.equal(cardDetails(p.deck.cards[1].words).id,id);p.undo();assert.equal(p.cardAt({id}),0);
 p.actOn('remove');p.undo();assert.equal(p.cardAt({id}),0);
});
test('867 color Undo refuses to replace another writer’s later color',()=>{
 const p=menuPage();p.act({kind:'details',text:cardText(p.deck.cards[0]),near:0,color:'rose',fromColor:'blue'});
 p.deck=parseDeck(card('First','words',details(A,'green')));p.undo();assert.equal(cardDetails(p.deck.cards[0].words).color,'green');assert.match(p.notice,/changed since/);
});
test('867 a card link unfolds parents and uses the navigation scroll rule; missing and duplicate ids select nothing',()=>{
 const p=menuPage('## Parent\n\n'+card('Child','words').replace('## Child','### Child'));p.folded.add('Parent');let paints=0,picked;
 p.paint=()=>paints++;p.pick=at=>{picked={at,keyed:p.keyed};};assert.equal(p.pickCardId(A),true);
 assert.equal(p.folded.has('Parent'),false);assert.deepEqual(picked,{at:1,keyed:true});assert.equal(paints,1);
 assert.equal(p.pickCardId(B),false);assert.match(p.notice,/no longer/);p.deck=parseDeck(card()+card());assert.equal(p.pickCardId(A),false);assert.equal(paints,1);
});
test('867 full page and composer inherit the same palette tint and no-color clears it on redraw',()=>{
 for(const prototype of [DeckPage.prototype,NotebookPage.prototype])for(const color of [null,...AGENT_PALETTE]){
  const doc=documentPort(),row=doc.createElement('li'),c=parseDeck(card('First','words',details(A,color))).cards[0];prototype.paintCardTint.call({},row,c);
  assert.equal(row.classList.contains('deck-tinted'),color!==null);if(color)assert.equal(row.classList.contains('agent-'+color),true);
 }
});
test('867 closing the page closes its menu and picker; saved color cannot focus a closed page',async t=>{
 const {p,w,api}=await writingPort(t);let focused=0;p.show=()=>focused++;
 const menu=p.openCardMenu(0,p.anchor);p.listening.abort();assert.equal(menu.root.isConnected,false);
 p.listening=new AbortController();const picker=p.cardColors(p.cardRef(0),p.anchor),send=api.command;let release,started;
 const arrived=new Promise(done=>started=done);api.command=async e=>{const receipt=await send(e);started();await new Promise(done=>release=done);return receipt;};
 const choosing=picker.root.querySelectorAll('.swatch')[0].onclick();await arrived;p.listening.abort();release();await choosing;
 assert.equal(picker.root.isConnected,false);assert.equal(focused,0);assert.equal(w.dirty,false);
});
test('867 read-only Copy link requires an existing primary; Copy text remains available',async t=>{
 const copied=clipboard(t),{p,w}=await writingPort(t,card());w.readOnly=true;p.readOnly=true;
 let items=p.cardMenuItems(p.cardRef(0),p.anchor);assert.deepEqual(items.map(x=>!!x.disabled),[false,false,true,true]);await items[1].act();assert.equal(copied.length,1);
 p.deck=parseDeck(card('Old','words',null));items=p.cardMenuItems(p.cardRef(0),p.anchor);assert.deepEqual(items.map(x=>!!x.disabled),[false,true,true,true]);await items[1].act();assert.equal(copied.length,1);
});
test('867 Text merge keeps an unidentified first card uncolored with aliases, and Undo splits originals',()=>{
 const raw=card('First','first',null)+card('Second','second',details(B,'rose')),projection=new CardTextProjection(),visible=projection.show(raw);
 const start=visible.indexOf('## Second'),end=start+'## Second\n'.length,text=visible.slice(0,start)+visible.slice(end);
 const merged=projection.edit(text,{start,end,inputType:'deleteContentBackward'}),meta=cardDetails(parseDeck(merged).cards[0].words);
 assert.equal(meta.id,null);assert.equal(meta.color,null);assert.deepEqual(meta.aliases,[B]);assert.equal(projection.edit(visible,{inputType:'historyUndo'}),raw);
});
test('867 long ordinary Text typing does not evict metadata needed by native deletion Undo',()=>{
 const raw=card()+card('Second','second',details(B)),projection=new CardTextProjection(),before=projection.show(raw),cut=before.indexOf('## Second'),after=before.slice(cut);
 projection.edit(after,{start:0,end:cut,inputType:'deleteContentBackward'});let text=after;
 for(let n=0;n<150;n++){text+='x';projection.edit(text,{inputType:'insertText'});}
 projection.edit(after,{inputType:'historyUndo'});assert.equal(projection.edit(before,{inputType:'historyUndo'}),raw);
});
test('867 Text Undo after a confirmed deletion keeps survivor color without reviving deleted ids',()=>{
 const raw=card()+card('Second','second',details(B,'green')),p=new CardTextProjection(),before=p.show(raw),cut=before.indexOf('## Second'),after=before.slice(0,cut);
 p.edit(after,{start:cut,end:before.length,inputType:'deleteContentBackward'});
 p.show(card('First','words',details(A,'rose')));
 for(const [text,inputType] of [[before,'historyUndo'],[after,'historyRedo'],[before,'historyUndo']]){
  const result=p.edit(text,{inputType}),cards=parseDeck(result).cards;
  assert.equal(stripDetails(result),text);assert.equal(cardDetails(cards[0].words).color,'rose');
  if(cards.length===2)assert.deepEqual(cardDetails(cards[1].words).ids,[]);
 }
});
test('867 a lazy identity allocated after Text deletion and rename survives Undo on the original card',()=>{
 const raw=card('First','words',null)+card('Second','second',details(B)),p=new CardTextProjection(),before=p.show(raw),cut=before.indexOf('## Second'),after=before.slice(0,cut);
 p.edit(after,{start:cut,end:before.length,inputType:'deleteContentBackward'});
 const renamed=after.replace('First','Renamed');p.edit(renamed,{inputType:'insertText'});
 p.show(card('Renamed','words',details(A,'rose')));
 p.edit(after,{inputType:'historyUndo'});
 const restored=parseDeck(p.edit(before,{inputType:'historyUndo'})).cards;
 assert.equal(cardDetails(restored[0].words).id,A);assert.equal(cardDetails(restored[0].words).color,'rose');assert.equal(cardDetails(restored[1].words).id,null);
});
test('867 a confirmed Text merge keeps its alias on the saved survivor when Text is split again',()=>{
 const raw=card('First','first',null)+card('Second','second',details(B,'rose')),p=new CardTextProjection(),before=p.show(raw),start=before.indexOf('## Second'),end=start+'## Second\n'.length;
 const merged=p.edit(before.slice(0,start)+before.slice(end),{start,end,inputType:'deleteContentBackward'});
 p.show(merged.replace(hidden(details(null,null,[B])),hidden(details(A,'blue',[B]))));
 const restored=parseDeck(p.edit(before,{inputType:'historyUndo'})).cards;
 assert.deepEqual(cardDetails(restored[0].words).ids,[A,B]);assert.equal(cardDetails(restored[0].words).color,'blue');
 assert.deepEqual(cardDetails(restored[1].words).ids,[]);assert.equal(cardDetails(restored[1].words).color,null);
});
test('867 Text Undo assigns a later lazy identity to the surviving duplicate, not the restored twin',()=>{
 const one=card('Same','words',null),p=new CardTextProjection(),before=p.show(one+one);
 p.edit(one,{start:0,end:one.length,inputType:'deleteContentBackward'});p.show(card('Same','words',details(A,'rose')));
 const restored=parseDeck(p.edit(before,{inputType:'historyUndo',start:0,end:0})).cards;
 assert.deepEqual(cardDetails(restored[0].words).ids,[]);assert.deepEqual(cardDetails(restored[1].words).ids,[A]);
});
test('867 Text Undo after a confirmed sole-card replacement aligns the sole saved card',()=>{
 const p=new CardTextProjection(),before=p.show(card('Old','words',null)),after=card('New','new words',null);
 p.edit(after,{start:0,end:before.length,inputType:'insertFromPaste'});p.show(card('New','new words',details(A)));
 const restored=p.edit(before,{inputType:'historyUndo'});assert.equal(stripDetails(restored),before);assert.deepEqual(cardDetails(parseDeck(restored).cards[0].words).ids,[A]);
 const redone=p.edit(after,{inputType:'historyRedo'});assert.deepEqual(cardDetails(parseDeck(redone).cards[0].words).ids,[A]);
});
test('867 actual Notebook Text owner saves visible edits with metadata and keeps the revision fence',async t=>{
 const {p,w,calls}=await writingPort(t,card());p.textSeen=w.capture();p.text={value:stripDetails(w.value.body)};
 p.textEdited();assert.equal(w.dirty,false,'opening Text is not a write');p.text.value=p.text.value.replace('First','Renamed');p.textEdited();await w.flush();
 assert.equal(calls.length,1);assert.equal(calls[0].expected.item_revision,1);assert.equal(cardDetails(parseDeck(calls[0].args.body).cards[0].words).id,A);assert.equal(parseDeck(calls[0].args.body).cards[0].title,'Renamed');
});
test('867 invalid card destinations are rejected rather than opening another route',()=>{
 for(const query of ['card=no','card='+A+'&card='+B,'card='+A+'&view=text','card='+A+'&write=new'])assert.throws(()=>parseRoute(new URL('https://fixture.invalid/?cards=page&'+query)),/incomplete|ambiguous/,query);
});

test('867 typing a new card heading keeps the existing identity with the original card',()=>{
 const p=menuPage();p.act({kind:'edit',text:cardText(p.deck.cards[0]),near:0,to:'Renamed\nkept\n\n## Brand new\nnew words'});
 assert.deepEqual(p.deck.cards.map(c=>c.title),['Renamed','Brand new']);assert.equal(cardDetails(p.deck.cards[0].words).id,A);assert.deepEqual(cardDetails(p.deck.cards[1].words).ids,[]);
});
test('867 the actual Text sync hides metadata without changing the writer or replacing its full seen revision',async t=>{
 const {p,w}=await writingPort(t,card());p.text=p.doc.createElement('textarea');p.header.title=p.doc.createElement('h1');p.textSeen=null;
 p.sync(true);assert.equal(p.text.value,stripDetails(w.value.body));assert.equal(p.textSeen.content.body,w.value.body);p.sync();assert.equal(w.dirty,false);
});

// Review 12221: exercise surviving content across intermediate headings and
// whole-card moves, rather than relying on a keystroke offset as identity.
const metaOf = raw => parseDeck(raw).cards.map(c => ({title:c.title,...cardDetails(c.words)}));
for (const replacement of ['## Costs', '### Budget']) test('867 review heading retyping through a single hash preserves Budget: '+replacement,()=>{
 const raw=card('Plan','plan words',details(A))+card('Budget','budget words',details(B,'rose'));
 const p=new CardTextProjection(),before=p.show(raw),start=before.indexOf('## Budget');let text=before;
 for(const heading of ['', '#', '##', replacement]){
  const end=text.indexOf('\n',start);text=text.slice(0,start)+heading+text.slice(end);
  p.edit(text,{inputType:'insertText',start,end});
 }
 const rows=metaOf(p.body);assert.equal(rows[1].id,B);assert.equal(rows[1].color,'rose');assert.deepEqual(rows[0].ids,[A]);
});
test('867 review Option line move and cut/paste preserve content identities and directional Undo',()=>{
 const raw=card('First','first',details(A))+card('Second','second',details(B,'rose'))+card('Third','third',null);
 const p=new CardTextProjection(),before=p.show(raw),parts=parseDeck(before).cards.map(c=>c.raw),after=parts[0]+parts[2],start=parts[0].length;
 let result=p.edit(parts[1]+parts[0]+parts[2],{inputType:'insertText'});assert.deepEqual(metaOf(result).map(c=>c.id),[B,A,null]);
 p.edit(before,{inputType:'historyUndo'});
 p.edit(after,{inputType:'deleteByCut',start,end:start+parts[1].length});
 result=p.edit(before,{inputType:'insertFromPaste',start,end:start});assert.deepEqual(metaOf(result).map(c=>c.id),[A,B,null]);
 result=p.edit(after,{inputType:'historyUndo'});assert.deepEqual(metaOf(result).map(c=>c.id),[A,null]);
 result=p.edit(before,{inputType:'historyUndo'});assert.equal(result,raw,'the earlier recurrence restores the earlier state');
 result=p.edit(after,{inputType:'historyRedo'});assert.deepEqual(metaOf(result).map(c=>c.id),[A,null]);
});
test('867 review normalized textarea opening does not revise CRLF or lose middle identities',async t=>{
 const raw=(card('First','first',details(A))+card('Second','second',details(B,'rose'))).replaceAll('\n','\r\n');
 const {p,w,calls}=await writingPort(t,raw);p.textSeen=w.capture();p.text={value:stripDetails(raw).replaceAll('\r\n','\n')};
 p.textEdited();await w.flush();assert.equal(w.value.body,raw);assert.equal(w.dirty,false);assert.equal(calls.length,0);
});
for(const step of [-1,1])test('867 review merge then lazy allocation then split keeps the new link: '+step,()=>{
 const p=menuPage(card('First','first',null)+card('Second','second',details(B,'rose'))),i=step<0?1:0;
 p.act({kind:'merge',text:cardText(p.deck.cards[i]),near:i,step});
 const id=p.ensureCardId(p.cardRef(0));p.undo();
 assert.equal(p.cardAt({id}),step<0?0:1);assert.equal(cardDetails(p.deck.cards[1].words).id,B);
});
for(const fence of ['```js','~~~~'])test('867 review metadata allocation on unclosed fence stays hidden and idempotent: '+fence,()=>{
 const p=menuPage(card('Code',fence+'\nconst x = 1;',null)),before=stripDetails(deckBody(p.deck));
 const id=p.ensureCardId(p.cardRef(0));assert.equal(cardDetails(p.deck.cards[0].words).id,id);
 assert.equal(stripDetails(deckBody(p.deck)).trimEnd(),before.trimEnd());
 assert.equal(p.ensureCardId(p.cardRef(0)),id);assert.equal(detailLines(p.deck.cards[0].words).length,1);
});
test('867 review Copy text of an unpicked metadata-bearing twin excludes bookkeeping',async t=>{
 const copied=clipboard(t),raw=card('Same','first',details(A))+card('Same','second **words**',details(B,'rose')),p=menuPage(raw);
 const menu=p.openCardMenu(1,p.anchor);t.after(()=>menu?.close(false));await p.cardMenuItems(p.cardRef(1),p.anchor)[0].act();
 assert.deepEqual(copied,['Same\n\nsecond words']);assert.equal(deckBody(p.deck),raw);
});
test('867 review Copy link and color allocate on an unpicked identical twin',async t=>{
 const copied=clipboard(t),one=card('Same','same words',null),{p}=await writingPort(t,one+one);
 await p.cardMenuItems(p.cardRef(1),p.anchor)[1].act();const id=parseRoute(new URL(copied[0])).card;
 assert.equal(cardDetails(p.deck.cards[0].words).id,null);assert.equal(cardDetails(p.deck.cards[1].words).id,id);
 const anchor=p.doc.createElement('button');p.doc.body.append(anchor);const picker=p.cardColors(p.cardRef(1),anchor);t.after(()=>picker.close(false));await picker.root.querySelectorAll('.swatch')[1].onclick();
 assert.equal(cardDetails(p.deck.cards[0].words).color,null);assert.equal(cardDetails(p.deck.cards[1].words).color,AGENT_PALETTE[1]);
});
test('867 review Delete on an unpicked twin leaves the picked twin alone',()=>{
 const p=menuPage(card('Same','words',details(A))+card('Same','words',details(B,'rose')));
 p.cardMenuItems(p.cardRef(1),p.anchor)[2].act();assert.deepEqual(metaOf(deckBody(p.deck)).map(c=>c.id),[A]);p.undo();assert.deepEqual(metaOf(deckBody(p.deck)).map(c=>c.id),[A,B]);
});
test('867 review Copy link starts promised clipboard data before its save settles',async t=>{
 clipboard(t);const old=globalThis.ClipboardItem;globalThis.ClipboardItem=class {constructor(data){this.data=data;}};t.after(()=>{globalThis.ClipboardItem=old;});
 const {p,w}=await writingPort(t);let release,started=false,item;const flush=w.flush.bind(w);
 w.flush=async()=>{await new Promise(done=>release=done);return flush();};
 navigator.clipboard.write=async items=>{started=true;item=items[0];await item.data['text/plain'];};
 const copying=p.copyCard(p.cardRef(0),true);const began=started;release();await copying;
 assert.equal(began,true,'clipboard.write must start during the click');const blob=await item.data['text/plain'];assert.equal(parseRoute(new URL(await blob.text())).card,cardDetails(p.deck.cards[0].words).id);
});
import { paintChanges } from '../web/page-changes.mjs';
import { imageStandIns } from '../web/deck.mjs';
import { Reader } from '../web/reader.mjs';
import { linkedFenceNodes } from '../web/message-format.mjs';
test('867 review all Notebook readers hide metadata through the shared rule, while fenced examples remain',t=>{
 const doc=documentPort(),old=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=old;});
 const raw=card('Title','Readable words',details()),example='```\n'+line()+'\n```';
 const changed=doc.createElement('div');paintChanges(changed,'',raw,doc);assert.doesNotMatch(changed.textContent,/theseus-card|aliases/);
 assert.doesNotMatch(imageStandIns(raw),/theseus-card|aliases/);
 const host=doc.createElement('div');host.append(...linkedFenceNodes(raw,doc));assert.doesNotMatch(host.textContent,/theseus-card|aliases/);
 const reader={source:{source_ref:{kind:'memory'}},sourceBody:doc.createElement('div'),callbacks:{},placeEnd(){}};
 Reader.prototype.drawSource.call(reader,raw);assert.doesNotMatch(reader.sourceBody.textContent,/theseus-card|aliases/);
 assert.match(imageStandIns(example),/theseus-card/);
});
test('867 review conflict panel strips a valid hidden line from the actual saved version',()=>{
 const p=menuPage();p.host.style.removeProperty=()=>{};p.text={};p.paintPageState=p.paintDraft=p.paintImages=p.revisionShown=()=>{};
 p.conflictPanel=p.doc.createElement('div');p.writing={hasLocal:true,conflict:{revision:2,content:{title:'Changed',body:card()}},images:[]};
 p.writingChanged();const latest=p.conflictPanel.querySelector('.notebook-latest');assert.ok(latest);assert.match(latest.textContent,/Changed/);assert.doesNotMatch(latest.textContent,/theseus-card|aliases/);
});
test('867 review fresh card editor does not borrow the following card tint',t=>{
 const p=menuPage(card()),doc=p.doc,old=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=old;});Object.assign(p,{keyed:false,opening:doc.createElement('div'),keyLines:[],editButton:doc.createElement('button'),
  editing:{fresh:true,after:null,near:0,field:doc.createElement('textarea')},mark(){},fit(){},bubbles:()=>doc.createElement('div')});
 p.editing.field.setSelectionRange=()=>{};p.editing.field.value='New card';p.doc.body.append(p.editing.field);
 DeckPage.prototype.paint.call(p);const row=p.list.querySelector('.deck-writing');assert.ok(row);assert.equal(row.classList.contains('deck-tinted'),false);
});
test('867 review editing an identified card to an open fence does not expose the restored hidden line',()=>{
 const p=menuPage(),shown=p.written(p.deck.cards[0]);
 const written='Code\n```js\nconst x = 1;';
 const to=boxText({written,details:shown.details});
 p.act({kind:'edit',text:cardText(p.deck.cards[0]),near:0,to});
 assert.equal(cardDetails(p.deck.cards[0].words).id,A);
 assert.doesNotMatch(cardDetails(p.deck.cards[0].words).words,/theseus-card/);
 assert.equal(cardDetails(p.deck.cards[0].words).words,'```js\nconst x = 1;');
});
test('867 review a truncated Notebook excerpt does not expose a partial hidden JSON line',()=>{
 const cut=card().slice(0,card().indexOf('aliases')+5);
 assert.doesNotMatch(imageStandIns(cut,{partial:true}),/theseus-card|c-1111|alias/);
 const fenced='```\n'+cut;assert.match(imageStandIns(fenced,{partial:true}),/theseus-card/);
 assert.match(imageStandIns(cut),/theseus-card/,'unmarked incomplete writing remains literal');
});

// Review 12306: real textarea listeners, with only a memory writer/DOM port.
async function text867(t,raw){
 const f=await writingPort(t,raw),doc=documentPort(),make=doc.createElement;
 doc.createElement=tag=>{const n=make(tag);n.before=x=>n.parent?.insertBefore(x,n);n.after=(...xs)=>{const next=n.parent?.children[n.parent.children.indexOf(n)+1];for(const x of xs)n.parent?.insertBefore(x,next);};return n;};
 const p=new NotebookPage({doc,host:doc.body,item:'page',mode:'text',bootstrap:{},viewPreference:{get:()=> 'text',set(){}},header:{title:doc.createElement('h1')}});
 Object.assign(p,{writing:f.w,deck:parseDeck(raw),base:{revision:1,body:raw},paint(){},keepNamed(){}});p.sync(true);
 const input=(start,end,insert,inputType='insertText')=>{p.text.selectionStart=start;p.text.selectionEnd=end;p.text.listeners.beforeinput({inputType});p.text.value=p.text.value.slice(0,start)+insert+p.text.value.slice(end);p.text.listeners.input({inputType});return metaOf(f.w.value.body);};
 return {...f,p,input};
}
for(const words of ['TBD','https://example.invalid','same'])test('867 R3 deleting a whole card never makes its id an alias: '+words,async t=>{
 const {p,w,input}=await text867(t,card('Monday','Standup\n'+words,details(A))+card('Tuesday',words,details(B,'rose')));
 const at=p.text.value.indexOf('## Tuesday');const rows=input(at,p.text.value.length,'','deleteContentBackward');assert.deepEqual(rows.map(r=>r.ids),[[A]]);assert.equal(rows[0].color,'blue');
});
test('867 R3 deleting a title-only card cannot lend its id or color to a later new heading',async t=>{
 const {p,w,input}=await text867(t,card('Plan','',details(A))+card('Deleted','',details(B,'rose')));const at=p.text.value.indexOf('## Deleted');input(at,p.text.value.length,'','deleteContentBackward');await w.flush();
 const rows=input(p.text.value.length,p.text.value.length,'## Brand new\n\n');assert.equal(rows[1].id,null);assert.equal(rows[1].color,null);
});
for(const heading of ['## Costs','### Budget'])test('867 R3 title-only Plan and Budget retype each heading key: '+heading,async t=>{
 const {p,input}=await text867(t,card('Plan','',details(A))+card('Budget','budget words',details(B,'rose')));const start=p.text.value.indexOf('## Budget');let rows;
 for(const h of ['','#','##',heading])rows=input(start,p.text.value.indexOf('\n',start),h);
 assert.deepEqual(rows.map(r=>r.ids),[[A],[B]]);assert.equal(rows[1].color,'rose');
});
test('867 R3 deleting one exact twin keeps only the surviving identity',async t=>{
 const {p,input}=await text867(t,card('Same','same',details(A))+card('Same','same',details(B,'rose')));const second=p.text.value.indexOf('## Same',1);assert.deepEqual(input(0,second,'','deleteContentBackward').map(r=>r.ids),[[B]]);
});
test('867 R3 untitled card first keystroke preserves identity',async t=>{
 const {p,input}=await text867(t,card('','',details(A)));const at=p.text.value.indexOf('\n');assert.deepEqual(input(at,at,'First').map(r=>r.ids),[[A]]);
});
test('867 R3 canonical metadata stays after words during Text typing and after confirmed merge',async t=>{
 const {p,w,input}=await text867(t,card('First','first',details(A))+card('Second','second',details(B,'rose')));
 const at=p.text.value.indexOf('## Second');input(at,at+'## Second\n'.length,'','deleteContentBackward');assert.deepEqual(metaOf(w.value.body)[0].aliases,[B]);await w.flush();
 input(p.text.value.length,p.text.value.length,'later');const row=metaOf(w.value.body)[0];assert.deepEqual(row.aliases,[B]);assert.ok(w.value.body.indexOf('later')<w.value.body.indexOf('<!-- theseus-card:'));
});
for(const prefix of ['<!','<!--','<!-- theseus-ca'])test('867 R3 excerpt hides incomplete marker '+prefix,()=>{assert.equal(imageStandIns('words\n\n'+prefix,{partial:true}),'words');});
test('867 R3 card editor restores canonical metadata from two noncanonical lines before an open fence',()=>{
 const d1='<!-- theseus-card: {"color":"blue","aliases":[],"id":"'+A+'"} -->',d2=hidden(details(B,'rose'));
 const to=boxText({written:'Code\n```js\nvalue',details:[d1,d2]});assert.equal(to.split('\n')[0],'Code');const row=cardDetails(textCard(to).words);assert.deepEqual(row.ids,[A,B]);assert.equal(row.words,'```js\nvalue');
});
test('867 R3 Cards Undo finds a card with metadata directly below its title',()=>{
 const raw='## First\n\n'+hidden(details())+'\n\nwords\n';const p=menuPage(raw);p.act({kind:'edit',text:cardText(p.deck.cards[0]),near:0,to:'First\nchanged'});p.undo();assert.equal(cardDetails(p.deck.cards[0].words).words,'words');assert.equal(cardDetails(p.deck.cards[0].words).id,A);
});
for(const action of ['Copy link','Set color'])test('867 R3 '+action+' waits for its own change behind an earlier save',async t=>{
 const copied=clipboard(t),{p,w,api,calls}=await writingPort(t),send=api.command;let release,arrive;const arrived=new Promise(r=>arrive=r);
 api.command=async e=>{const receipt=await send(e);if(calls.length===1){arrive();await new Promise(r=>release=r);}return receipt;};
 w.edit({title:'Earlier save'},w.capture());const saving=w.flush();await arrived;
 let acted,picker;if(action==='Copy link')acted=p.copyCard(p.cardRef(0),true);else {picker=p.cardColors(p.cardRef(0),p.anchor);t.after(()=>picker.close(false));acted=picker.root.querySelectorAll('.swatch')[0].onclick();}
 release();await saving;await acted;assert.equal(calls.length,2);assert.ok(metaOf(w.base.content.body)[0].id);
 if(action==='Copy link')assert.equal(copied.length,1);else {assert.equal(metaOf(w.base.content.body)[0].color,'green');assert.equal(picker.root.isConnected,false);}
});
for(const action of ['Copy text','Copy link','Delete'])test('867 R3 unpicked card menu owns '+action,async t=>{
 const copied=clipboard(t),p=menuPage(card('Picked','one',details(A))+card('Unpicked','two',details(B)));p.picked=0;
 const menu=p.openCardMenu(1,p.anchor);t.after(()=>menu.close(false));const button=menu.root.children.find(n=>n.textContent===action);assert.ok(button);await button.onclick({preventDefault(){},stopPropagation(){}});
 if(action==='Copy text')assert.deepEqual(copied,['Unpicked\n\ntwo']);else if(action==='Copy link')assert.equal(parseRoute(new URL(copied[0])).card,B);else assert.deepEqual(p.deck.cards.map(c=>c.title),['Picked']);
});
test('867 R3 downward merge allocates lazily on the lower survivor before split Undo',()=>{
 const p=menuPage(card('Upper','upper',details(B,'rose'))+card('Lower','lower',null));p.act({kind:'merge',text:cardText(p.deck.cards[0]),near:0,step:1});const id=p.ensureCardId(p.cardRef(0));p.undo();assert.equal(p.cardAt({id}),1);assert.equal(p.cardAt({id:B}),0);
});

for(const placement of ['end','under-title'])test('867 R3 Reader Quote and lit Copy omit metadata with exact source substrings: '+placement,async t=>{
 const copied=clipboard(t),oldWindow=globalThis.window;t.after(()=>{globalThis.window=oldWindow;});globalThis.window={getSelection:()=>({isCollapsed:true,rangeCount:0,removeAllRanges(){}})};
 const raw=placement==='end'?card():`## First\n\n${hidden(details())}\n\nwords\n`;
 const editor={draft:{body:'',quotes:[]},edit(patch){Object.assign(this.draft,patch);}},field={value:'',focus(){},setSelectionRange(){}};
 const p=Object.assign(Object.create(Reader.prototype),{source:{source_ref:{kind:'memory',id:'page',revision:1},body:raw},hover:{start:0,end:raw.length},field,mode:'reply',mac:true,
  sessions:{reply:editor},writes:()=>true,narrow:{matches:true},notice(){},quotedPlace:()=>null,insertText(text){field.value+=text;},disarm(){},keepAbove(){}});
 p.quote();assert.doesNotMatch(field.value,/theseus-card|aliases/);assert.ok(editor.draft.quotes.length>0);for(const q of editor.draft.quotes){assert.ok(raw.includes(q.excerpt));assert.doesNotMatch(q.excerpt,/theseus-card|aliases/);}
 const target={closest:()=>null};p.key({key:'c',code:'KeyC',metaKey:true,target,preventDefault(){}});await Promise.resolve();assert.equal(copied.length,1);assert.doesNotMatch(copied[0],/theseus-card|aliases/);
});
test('867 R3 untitled writing body first keystroke preserves its identity',async t=>{
 const {p,input}=await text867(t,'##\n\noriginal\n\n'+hidden(details())+'\n');const at=p.text.value.indexOf('original');assert.deepEqual(input(at,at+8,'changed').map(r=>r.ids),[[A]]);
});
test('867 R3 Cards Undo accepts the same hidden line under the title after Text placement',()=>{
 const p=menuPage(card());p.act({kind:'edit',text:cardText(p.deck.cards[0]),near:0,to:'First\nchanged'});
 p.deck=parseDeck('## First\n\n'+hidden(details())+'\n\nchanged\n');p.undo();assert.equal(cardDetails(p.deck.cards[0].words).words,'words');assert.equal(cardDetails(p.deck.cards[0].words).id,A);
});
test('867 R3 empty words do not pair a gap of unrelated renamed headings',async t=>{
 const {p,input}=await text867(t,card('Old one','',details(A))+card('Old two','',details(B,'rose')));
 assert.deepEqual(input(0,p.text.value.length,card('New one','',null)+card('New two','',null),'insertFromPaste').map(r=>r.ids),[[],[]]);
});
test('867 R3 whole-card move crosses exact anchors without borrowing identity',async t=>{
 const raw=card('One','one',details(A))+card('Two','two',details(B,'rose'))+card('Three','three',null),{p,input}=await text867(t,raw),parts=parseDeck(p.text.value).cards.map(c=>c.raw);
 assert.deepEqual(input(0,p.text.value.length,parts[1]+parts[0]+parts[2],'insertFromPaste').map(r=>r.ids),[[B],[A],[]]);
});
for(const action of ['Delete','move','merge'])test('867 R3 Cards '+action+' survives a confirmed save then command-Z restores link and color',async t=>{
 const copied=clipboard(t),alias='c-33333333333333333333333333333333',raw=card('First','first',details(A,'blue',[alias]))+card('Second','second',details(B,'rose')),{p,w}=await writingPort(t,raw);
 await p.copyCard(p.cardRef(0),true);const route=parseRoute(new URL(copied[0]));
 if(action==='Delete'){const menu=p.openCardMenu(0,p.anchor);t.after(()=>menu.close(false));menu.root.children.find(n=>n.textContent==='Delete').onclick({stopPropagation(){}});}else p.key({key:'ArrowDown',metaKey:true,shiftKey:action==='merge',target:p.list,preventDefault(){}});
 await w.flush();assert.equal(w.dirty,false);p.key({key:'z',metaKey:true,target:p.list,preventDefault(){}});await w.flush();
 assert.deepEqual(metaOf(w.base.content.body).map(c=>[c.id,c.aliases,c.color]),[[A,[alias],'blue'],[B,[],'rose']]);
 p.pick=i=>{p.picked=i;};assert.equal(p.pickCardId(route.card),true);assert.equal(p.picked,0);assert.equal(p.cardAt({id:alias}),0);
});

// Review 12400: selections, saved twins, local Cards metadata and painted doors.
for(const tail of [' ', '  ', '\t', ' \n\n'])test('867 R4 trailing writing survives metadata projection and sync: '+JSON.stringify(tail),async t=>{
 const {p,w,input}=await text867(t,card());const at=p.text.value.indexOf('words')+5;
 input(at,at,tail);const wanted=p.text.value;assert.equal(stripDetails(w.value.body),wanted);
 let writes=0,value=wanted;Object.defineProperty(p.text,'value',{configurable:true,get:()=>value,set:v=>{writes++;value=v;}});
 p.doc.activeElement=p.text;p.sync();assert.equal(writes,0,'sync must leave the actual textarea untouched');assert.equal(value,wanted);
});
test('867 R4 a confirmed save between twin keystrokes retains the edited twin identity',async t=>{
 const {p,w,input}=await text867(t,card('Same','same',details(A))+card('Same','same',details(B,'rose')));
 const at=p.text.value.indexOf('same');input(at,at+4,'changed');await w.flush();input(at,at+7,'same');
 assert.deepEqual(metaOf(w.value.body).map(r=>[r.id,r.color]),[[A,'blue'],[B,'rose']]);
});
test('867 R4 a confirmed save preserves the second twin when it becomes identical again',async t=>{
 const {p,w,input}=await text867(t,card('Same','same',details(A))+card('Same','same',details(B,'rose')));
 const at=p.text.value.lastIndexOf('same');input(at,at+4,'changed');await w.flush();input(at,at+7,'same');
 assert.deepEqual(metaOf(w.value.body).map(r=>[r.id,r.color]),[[A,'blue'],[B,'rose']]);
});

test('867 R4 appending after a confirmed twin edit retains both identities',async t=>{
 const {p,w,input}=await text867(t,card('Same','same',details(A))+card('Same','same',details(B,'rose')));
 const at=p.text.value.indexOf('same');input(at,at+4,'changed');await w.flush();input(at+7,at+7,'!');
 assert.deepEqual(metaOf(w.value.body).map(r=>[r.id,r.color]),[[A,'blue'],[B,'rose']]);
});
for(const state of ['color','restored'])test('867 R4 Text keeps unconfirmed Cards metadata on an unchanged card: '+state,()=>{
 const base=card('First','words',null)+card('Second','second',details(B,'rose'));
 const current=card('First','words',details(A,'green'))+card('Second','second',details(B,'rose'));
 const p=new CardTextProjection(),text=p.show(current,state==='color'?base:card('Second','second',details(B,'rose')));
 const after=p.edit(text.replace('second','changed'));
 assert.equal(stripDetails(after),text.replace('second','changed'));assert.deepEqual(metaOf(after).map(r=>[r.id,r.color]),[[A,'green'],[B,'rose']]);
});
test('867 R4 moving the last card above renamed cards keeps the longest ordered anchors',()=>{
 const C='c-33333333333333333333333333333333',D='c-44444444444444444444444444444444';
 const p=new CardTextProjection();p.show(card('One','one',details(A))+card('Two','two',details(B))+card('Three','three',details(C))+card('Four','four',details(D)));
 const after=p.edit(card('Four','four',null)+card('Renamed','one',null)+card('Two','two',null)+card('Three','three',null));
 assert.deepEqual(metaOf(after).map(r=>r.id),[D,A,B,C]);
});
test('867 R4 an empty intermediate card cannot prove a Text merge alias',()=>{
 const C='c-33333333333333333333333333333333',p=new CardTextProjection();p.show(card('First','one',details(A))+card('Empty','',details(B))+card('Third','two',details(C)));
 const after=p.edit(card('First','one\n\ntwo',null));assert.deepEqual(metaOf(after).map(r=>r.ids),[[A]]);
});
function painted867(t,p){
 p.header.description??=p.doc.createElement('p');
 const old=globalThis.document;globalThis.document=p.doc;t.after(()=>{p.listening.abort();globalThis.document=old;});
 Object.assign(p,{talks:new Map(),room:null,keyed:false,opening:p.doc.createElement('div'),keyLines:[],editButton:p.doc.createElement('button'),mark(){},fit(){}});
 p.paint=()=>DeckPage.prototype.paint.call(p);return p;
}
function edit867(p,at,written){
 const c=p.deck.cards[at],shown=p.written(c),field=p.doc.createElement('textarea');field.value=written??cardText({title:c.title,words:shown.words});
 p.editing={text:cardText(c),shown:cardText({title:c.title,words:shown.words}),near:at,depth:c.depth,fresh:false,field,details:shown.details,stacks:[],images:[],kept:''};p.doc.body.append(field);
}
function press867(p,at){
 const button=p.list.children[at].querySelector('.deck-menu');assert.ok(button,'painted overflow');button.listeners.click({target:button,stopPropagation(){}});
 const menu=p.doc.body.querySelector('[role="menu"]');assert.ok(menu,'real shared menu');return menu;
}
function choice867(menu,label){const button=menu.children.find(n=>n.textContent===label);assert.ok(button);return button.onclick({preventDefault(){},stopPropagation(){}});}
test('867 R4 writing holder menu follows its own card after another writer inserts above',async t=>{
 const {p,w,api,source}=await text867(t,card('Budget','words',details(A)));painted867(t,p);p.mode='cards';edit867(p,0);p.paint();
 api.view=async()=>({...source(),body:card('Incoming','other',details(B))+card('Budget','words',details(A)),source_ref:{...source().source_ref,revision:2}});
 await w.refresh();p.sync();assert.equal(p.picked,0);assert.ok(p.list.children[1].classList.contains('deck-writing'));
 choice867(press867(p,1),'Delete');assert.deepEqual(p.deck.cards.map(c=>c.title),['Incoming']);assert.deepEqual(metaOf(w.value.body).map(r=>r.id),[B]);
});
for(const written of ['', 'Changed\nnew\n\n## Added\nmore'])test('867 R4 an unpicked twin menu survives finishing another editor: '+JSON.stringify(written),async t=>{
 const copied=clipboard(t),p=painted867(t,menuPage(card('Editing','edit',null)+card('Same','same',null)+card('Same','same',null)));
 edit867(p,0,written);p.paint();const menu=press867(p,2);choice867(menu,'Delete');
 assert.deepEqual(p.deck.cards.map(c=>c.title),written?['Changed','Added','Same']:['Same']);
 // Delete's Undo records which occurrence survived, not just an identical body.
 assert.equal(p.undos.at(-1).near,written?2:0);
});
test('867 R4 Set color through the unpicked painted idless twin menu allocates only on that twin',async t=>{
 const {p,w}=await writingPort(t,card('Same','same',null)+card('Same','same',null));painted867(t,p);p.paint();p.picked=0;
 choice867(press867(p,1),'Set color');const picker=p.doc.body.querySelector('.color-picker');assert.ok(picker);await picker.querySelectorAll('.swatch')[1].onclick();
 const rows=metaOf(w.base.content.body);assert.deepEqual(rows[0].ids,[]);assert.equal(rows[0].color,null);assert.ok(rows[1].id);assert.equal(rows[1].color,AGENT_PALETTE[1]);
});
for(const action of ['Copy link','Set color'])test('867 R4 '+action+' awaits its own save after a pending resend',async t=>{
 const copied=clipboard(t),{p,w,api,calls}=await writingPort(t),send=api.command;api.command=async()=>{throw Error('offline');};
 w.edit({title:'Earlier'},w.capture());await w.flush();assert.ok(w.pending);assert.equal(w.running,null);const operation=w.pending.operation_id;api.command=send;
 if(action==='Copy link'){await p.copyCard(p.cardRef(0),true);assert.equal(copied.length,1);}
 else {const picker=p.cardColors(p.cardRef(0),p.anchor);t.after(()=>picker.close(false));await picker.root.querySelectorAll('.swatch')[0].onclick();assert.equal(picker.root.isConnected,false);}
 assert.equal(calls.length,2);assert.equal(calls[0].operation_id,operation);assert.notEqual(calls[1].operation_id,operation);assert.ok(metaOf(w.base.content.body)[0].id);assert.equal(w.dirty,false);
});
function reader867(t,raw,kind,start,end){
 const copied=clipboard(t),old=globalThis.window;globalThis.window={getSelection:()=>({isCollapsed:true,rangeCount:0,removeAllRanges(){}})};t.after(()=>{globalThis.window=old;});
 const editor={draft:{body:'',quotes:[]},edit(patch){Object.assign(this.draft,patch);}},field={value:'',focus(){},setSelectionRange(){}};
 const p=Object.assign(Object.create(Reader.prototype),{source:{source_ref:{kind,id:'source',revision:1},body:raw},hover:{start,end},field,mode:'reply',mac:true,sessions:{reply:editor},writes:()=>true,narrow:{matches:true},notice(){},quotedPlace:()=>null,insertText(text){field.value+=text;},disarm(){},keepAbove(){}});
 return {p,copied,editor,field};
}
for(const kind of ['memory','message'])test('867 R4 Reader quote and lit Copy use whole-source fence state for '+kind,async t=>{
 const raw='```\nexample\n'+line()+'\n```\n\nAfter\n\n'+hidden(details(B))+'\n',start=raw.indexOf('example'),end=raw.length;
 const {p,copied,editor,field}=reader867(t,raw,kind,start,end);p.quote();
 assert.ok(field.value.includes(line()),'the marker inside the fence is visible writing');
 assert.equal(field.value.includes(hidden(details(B))),kind==='message','only memory metadata is hidden');
 for(const q of editor.draft.quotes)assert.ok(raw.includes(q.excerpt));
 p.key({key:'c',code:'KeyC',metaKey:true,target:{closest:()=>null},preventDefault(){}});await Promise.resolve();
 assert.ok(copied[0].includes(line()));assert.equal(copied[0].includes(hidden(details(B))),kind==='message');
});
test('867 R4 Reader held selection keeps its exact range among equal fenced and hidden markers',t=>{
 const raw='```\n'+line()+'\n```\n\n'+line()+'\n';const start=raw.lastIndexOf(line()),{p,editor}=reader867(t,raw,'memory',start,raw.length);
 p.held={excerpt:raw.slice(start),range:{start,end:raw.length}};p.hover=null;p.quote();assert.deepEqual(editor.draft.quotes,[]);
});
test('867 R4 Reader whole message Copy retains marker-shaped writing',async t=>{
 const raw='Literal\n\n'+line(),{p,copied}=reader867(t,raw,'message',0,raw.length);p.hover=null;
 p.key({key:'C',code:'KeyC',metaKey:true,shiftKey:true,target:{closest:()=>null},preventDefault(){}});await Promise.resolve();assert.deepEqual(copied,[raw]);
});
import { formatWords } from '../web/message-format.mjs';
test('867 R4 Reader selected message Copy retains marker-shaped writing with display rules',t=>{
 const raw='Literal\n\n'+line(),{p}=reader867(t,raw,'message',0,raw.length),doc=documentPort(),old=globalThis.document;
 globalThis.document=doc;t.after(()=>{globalThis.document=old;});p.dialog={open:true};p.sourceBody=doc.createElement('div');formatWords(p.sourceBody,raw,{doc,displayRules:['break-out-paragraphs']});
 globalThis.window.getSelection=()=>({rangeCount:1,isCollapsed:false,getRangeAt:()=>({startContainer:p.sourceBody,startOffset:0,endContainer:p.sourceBody,endOffset:raw.length})});
 p.sourceOffset=(_,offset)=>offset;let copied;
 p.copySelection({defaultPrevented:false,preventDefault(){},clipboardData:{setData(type,text){assert.equal(type,'text/plain');copied=text;}}});assert.equal(copied,raw);
});

test('867 R4 Reader actual hold retains the selected occurrence of equal markers',t=>{
 const raw='```\n'+line()+'\n```\n\n'+line()+'\n';const start=raw.lastIndexOf(line()),{p,editor}=reader867(t,raw,'memory',start,raw.length);
 Object.defineProperty(p,'chosen',{value:true});p.paintQuote=()=>{};p.hold('quote-selection');p.hover=null;p.quote();assert.deepEqual(editor.draft.quotes,[]);
});

// Review 12516: real input, writer confirmation, Cards acts and painted menus.
const C867='c-33333333333333333333333333333333';
test('867 R5 an in-flight twin save cannot duplicate ids after a later edit and paste',async t=>{
 const raw=card('Same','same',details(A))+card('Same','same',details(B,'rose'))+card('Same','same',details(C867,'green'));
 const {p,w,api,input}=await text867(t,raw),send=api.command;let release,arrive,first=true;
 const arrived=new Promise(r=>arrive=r);
 api.command=async e=>{const receipt=await send(e);if(first){first=false;arrive();await new Promise(r=>release=r);}return receipt;};
 const second=p.text.value.indexOf('same',p.text.value.indexOf('same')+4);input(second,second+4,'changed two');
 const saving=w.flush();await arrived;
 try {const third=p.text.value.lastIndexOf('same');input(third,third+4,'changed three');}
 finally {release();await saving;}
 const third=p.text.value.lastIndexOf('## Same');input(third,third,card('Same','same',null),'insertFromPaste');await w.flush();
 const rows=metaOf(w.base.content.body);assert.deepEqual(rows.map(r=>r.id),[A,B,null,C867]);
 assert.equal(new Set(rows.flatMap(r=>r.ids)).size,3);p.sync();p.pick=at=>{p.picked=at;};
 for(const [id,at] of [[A,0],[B,1],[C867,3]]){assert.equal(p.pickCardId(id),true);assert.equal(p.picked,at);}
});
test('867 R5 a pasted twin cannot replace the preferred anchor beside an unsaved rename',async t=>{
 const {p,w,input}=await text867(t,card('Same','same',details(A))+card('Same','same',details(B,'rose')));
 input(3,7,'Renamed');input(p.text.value.length,p.text.value.length,card('Same','same',null),'insertFromPaste');await w.flush();
 assert.deepEqual(metaOf(w.base.content.body).map(r=>r.id),[A,B,null]);
 assert.deepEqual(parseDeck(w.base.content.body).cards.map(r=>r.title),['Renamed','Same','Same']);
});
test('867 R5 CRLF typing then Undo restores every original byte and owes no revision',async t=>{
 const raw=('Opening\n\n'+card('One','one',null)+card('Two','two',details(B,'rose'))+card('Three','three',null)).replaceAll('\n','\r\n');
 const {p,w,input,calls,source}=await text867(t,raw),at=p.text.value.indexOf('one');
 input(at,at,'x');input(at,at+1,'','historyUndo');await w.flush();
 assert.equal(w.value.body,raw);assert.equal(source().body,raw);assert.equal(calls.length,0);assert.equal(source().source_ref.revision,1);
});
for(const state of ['offline','in-flight','Cards Undo'])test('867 R5 typing in a card keeps its unconfirmed metadata: '+state,async t=>{
 const raw=card('One','one',details(A))+card('Two','typo',state==='Cards Undo'?details(B,'green'):null);
 const {p,w,api,input,calls}=await text867(t,raw),send=api.command;let release,choosing,picker,id;
 p.header.description=p.doc.createElement('p');
 p.switchView('cards');
 if(state==='Cards Undo'){
  p.act({kind:'remove',text:cardText(p.deck.cards[1]),near:1});await w.flush();p.key({key:'z',metaKey:true,target:p.list,preventDefault(){}});id=B;
 }else {
  let arrive;const arrived=new Promise(r=>arrive=r);
  api.command=state==='offline'?async()=>{throw Error('offline');}:async e=>{const receipt=await send(e);arrive();await new Promise(r=>release=r);return receipt;};
  picker=p.cardColors(p.cardRef(1),p.text);t.after(()=>picker.close(false));choosing=picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='green').onclick();
  if(state==='offline')await choosing;else await Promise.race([arrived,choosing.then(()=>{throw Error('Color fixture ended before reaching the command: '+picker.root.querySelector('.notice')?.textContent);})]);
  id=metaOf(w.value.body)[1].id;
 }
 const pending=state==='offline'?structuredClone(w.pending):null;let edited;
 if(state==='offline')assert.ok(pending,'offline color leaves its exact request pending');
 try {p.switchView('text');const at=p.text.value.indexOf('typo');input(at,at+4,'fixed');edited=metaOf(w.value.body)[1];}
 finally {api.command=send;if(release)release();if(choosing)await choosing;}
 assert.ok(id);assert.deepEqual([edited.id,edited.color],[id,'green']);
 if(pending){
  // Retry the frozen failed color request before saving the newer words.
  assert.deepEqual(w.pending,pending);await w.flush();assert.deepEqual(calls[0],pending);
  assert.equal(cardDetails(parseDeck(w.base.content.body).cards[1].words).words,'typo');
  assert.equal(cardDetails(parseDeck(w.value.body).cards[1].words).words,'fixed');
 }
 await w.flush();
 assert.deepEqual(metaOf(w.base.content.body).map(r=>[r.id,r.color]),[[A,'blue'],[id,'green']]);
 assert.equal(cardDetails(parseDeck(w.base.content.body).cards[1].words).words,'fixed');
});
function fresh867(p,at,written){edit867(p,at,written);Object.assign(p.editing,{fresh:true,after:cardText(p.deck.cards[at]),near:at,details:[],stacks:[],images:[]});}
function pressExisting867(p,index){
 const row=p.list.children.find(n=>!n.classList.contains('deck-writing')&&n.dataset.index===String(index)),button=row?.querySelector('.deck-menu');
 assert.ok(button,'the pressed existing card is painted');button.listeners.click({target:button,stopPropagation(){}});
 const menu=p.doc.body.querySelector('[role="menu"]');assert.ok(menu,'real shared menu');return menu;
}
for(const state of ['fresh anchor deleted','edited card deleted'])test('867 R5 menu keeps its target when '+state,async t=>{
 const p=painted867(t,menuPage(card('Anchor','anchor',null)+card('Target','target',details(B))+card('End','end',null)));
 if(state==='fresh anchor deleted')fresh867(p,0,'New\nnew writing');else edit867(p,0,'New\nnew writing');
 // A later read deleted the anchor/editor card while its box was kept open.
 p.deck=parseDeck(card('Target','target',details(B))+card('End','end',null));p.paint();
 choice867(pressExisting867(p,0),'Delete');
 assert.deepEqual(p.deck.cards.map(c=>c.title),['New','End']);assert.equal(p.deck.cards[0].words,'new writing');assert.equal(p.cardAt({id:B}),-1);
 p.undo();assert.equal(p.cardAt({id:B}),state==='fresh anchor deleted'?0:1);
});
test('867 R5 a menu above the editor keeps its target after the editor adds a card',t=>{
 const p=painted867(t,menuPage(card('Target','target',details(A))+card('Editing','words',null)));
 edit867(p,1,'Changed\nnew\n\n## Added\nmore');p.paint();choice867(pressExisting867(p,0),'Delete');
 assert.deepEqual(p.deck.cards.map(c=>c.title),['Changed','Added']);assert.equal(p.cardAt({id:A}),-1);
});
test('867 R5 a menu beside a fresh card keeps the pressed identical twin',t=>{
 const p=painted867(t,menuPage(card('Anchor','anchor',null)+card('Same','same',null)+card('Same','same',null)));
 fresh867(p,0,'New\nnew');p.paint();choice867(pressExisting867(p,2),'Delete');
 assert.deepEqual(p.deck.cards.map(c=>c.title),['Anchor','New','Same']);assert.equal(p.undos.at(-1).near,2);
});
for(const child of [false,true])test('867 R5 a menu on the cleared editor opens no replacement menu, child='+child,t=>{
 const p=painted867(t,menuPage(card('Cleared','words',details(A))+(child?'### Child\n\nchild\n\n':'')+card('Survivor','stay',details(B))));
 edit867(p,0,'');p.paint();const button=p.list.children[0].querySelector('.deck-menu');assert.ok(button);
 button.listeners.click({target:button,stopPropagation(){}});
 assert.equal(p.doc.body.querySelector('[role="menu"]'),null);assert.deepEqual(p.deck.cards.map(c=>c.title),['Survivor']);assert.equal(p.cardAt({id:B}),0);
});
