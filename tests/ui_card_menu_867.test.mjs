import test from 'node:test';
import assert from 'node:assert/strict';
import { boxText, cardText, parseDeck } from '../web/deck.mjs';
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
 assert.equal(projection.history.length,2,'only the deletion needs a metadata snapshot');
 projection.edit(after,{inputType:'historyUndo'});assert.equal(projection.edit(before,{inputType:'historyUndo'}),raw);
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
