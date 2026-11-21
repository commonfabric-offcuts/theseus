// Review r5 of 867: after a save confirms a card's FIRST id (minted by Set color while the card was id-less in the base),
// the next Text keystroke mis-pairs rows, because confirm() maps id-less old rows to id-less new rows by content only.
// Helpers are copied from tests/ui_card_menu_867.test.mjs (menuPage, writingPort, text867, documentPort).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardText, parseDeck, applyAct } from '../web/deck.mjs';
import { cardDetails, stripDetails, detailLines } from '../web/card-details.mjs';
import { Element } from './fixtures/mini_dom.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';
import { NotebookWriting } from '../web/notebook-writing.mjs';
const A='c-11111111111111111111111111111111',B='c-22222222222222222222222222222222';
const details=(id=A,color='blue',aliases=[])=>({id,aliases,color});
const hidden=d=>'<!-- theseus-card: '+JSON.stringify(d)+' -->';
const card=(title='First',words='words',d=details())=>'## '+title+'\n\n'+(words?words+'\n\n':'')+(d?hidden(d)+'\n\n':'');
const metaOf = raw => parseDeck(raw).cards.map(c => ({title:c.title,...cardDetails(c.words)}));
function documentPort(){
 const doc={activeElement:null,addEventListener(){},removeEventListener(){}};
 class Node extends Element{
  constructor(tag){super(tag,doc);this.style={setProperty(){}};this.nodeType=1;this.selectionStart=0;this.selectionEnd=0;}
  // Store the requested range for the real beforeinput/input handlers. This
  // memory port does not claim browser selection, focus or keyboard behavior.
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  get childNodes(){return this.children;}
  get textContent(){return this.children.map(c=>c.textContent).join('');}
  set textContent(text){this.children=[];if(text)this.append(String(text));}
  append(...nodes){super.append(...nodes.map(n=>typeof n==='string'?{nodeType:3,textContent:n}:n));}
  *descendants(){for(const n of this.children){if(n.nodeType!==3)yield n;if(n.descendants)yield* n.descendants();}}
  contains(n){for(;n;n=n.parent)if(n===this)return true;return false;}
  querySelectorAll(selector){const door=/^(\.deck-card\[data-index="-?\d+"\]) (\.deck-menu)$/.exec(selector);return door?super.querySelectorAll(door[1]).flatMap(row=>row.querySelectorAll(door[2])):super.querySelectorAll(selector);}
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
async function text867(t,raw){
 const f=await writingPort(t,raw),doc=documentPort(),make=doc.createElement;
 doc.createElement=tag=>{const n=make(tag);n.before=x=>n.parent?.insertBefore(x,n);n.after=(...xs)=>{const next=n.parent?.children[n.parent.children.indexOf(n)+1];for(const x of xs)n.parent?.insertBefore(x,next);};return n;};
 const p=new NotebookPage({doc,host:doc.body,item:'page',mode:'text',bootstrap:{},viewPreference:{get:()=> 'text',set(){}},header:{title:doc.createElement('h1')}});
 Object.assign(p,{writing:f.w,deck:parseDeck(raw),base:{revision:1,body:raw},paint(){},keepNamed(){}});p.sync(true);
 const input=(start,end,insert,inputType='insertText')=>{
  p.text.setSelectionRange(start,end);
  assert.deepEqual([p.text.selectionStart,p.text.selectionEnd],[start,end],'adapter retains the requested selection before beforeinput');
  const event={inputType,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
  p.text.listeners.beforeinput(event);
  if(!event.defaultPrevented){
   assert.deepEqual([p.textChange.start,p.textChange.end],[start,end],'the real beforeinput handler captures the requested replacement');
   p.text.value=p.text.value.slice(0,start)+insert+p.text.value.slice(end);
   const caret=start+insert.length;p.text.setSelectionRange(caret,caret);
   assert.deepEqual([p.text.selectionStart,p.text.selectionEnd],[caret,caret],'adapter retains the post-edit caret before input');
   p.text.listeners.input({inputType});
  }
  return metaOf(f.w.value.body);
 };
 return {...f,p,input};
}
// Hold the receipt of the next command until released; the server has already applied it.
function holdNext(api){
 const send=api.command;let release,arrive;const arrived=new Promise(r=>arrive=r);let armed=true;
 api.command=async e=>{const receipt=await send(e);if(armed){armed=false;arrive();await new Promise(r=>release=r);}return receipt;};
 return {arrived,release:()=>{api.command=send;release();}};
}
async function setColorInFlight(t,p,api,index,color){
 const held=holdNext(api);
 const picker=p.cardColors(p.cardRef(index),p.text);t.after(()=>picker.close(false));
 const choosing=picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')===color).onclick();
 await Promise.race([held.arrived,choosing.then(()=>{throw Error('Color fixture ended before reaching the command: '+picker.root.querySelector('.notice')?.textContent);})]);
 return {choosing,release:held.release};
}

test('r5 review A: a save confirming a new twin\'s first id, then retyping that twin\'s heading, must not give its id to the id-less twin',async t=>{
 const {p,w,api,input}=await text867(t,card('Todo','',null)+card('Same','alpha',details(B,'green')));
 p.header.description=p.doc.createElement('p');p.switchView('cards');
 assert.ok(p.act({kind:'add',after:cardText(p.deck.cards[0]),text:'Todo',depth:p.deck.cards[0].depth,near:0}),'Cards adds a second Todo');
 await w.flush();assert.deepEqual(parseDeck(w.base.content.body).cards.map(c=>c.title),['Todo','Todo','Same']);
 assert.deepEqual(metaOf(w.base.content.body).map(r=>r.id),[null,null,B]);
 const {choosing,release}=await setColorInFlight(t,p,api,1,'green');
 const minted=metaOf(w.value.body)[1].id;assert.ok(minted,'Set color minted the new twin\'s id');
 p.switchView('text'); // Text shown against the old base, while the color save is in flight
 release();await choosing;await w.flush();
 assert.deepEqual(metaOf(w.base.content.body).map(r=>r.id),[null,minted,B],'the save confirmed the new id');
 const at=p.text.value.indexOf('## Todo',1)+3;const rows=input(at,at+4,'','deleteContentBackward'); // second "## Todo" -> "## "
 assert.deepEqual(rows.map(r=>r.title),['Todo','','Same']);
 assert.equal(new Set(rows.map(r=>r.id).filter(Boolean)).size,rows.map(r=>r.id).filter(Boolean).length,'one id per card: '+JSON.stringify(rows.map(r=>r.id)));
 assert.deepEqual(rows.map(r=>r.id),[null,minted,B]);
});

test('r5 review B: a save confirming another card\'s first id, then deleting the first card\'s words, must keep the first card\'s id and color',async t=>{
 const {p,w,api,input}=await text867(t,card('','two',details(A,'rose'))+card('Same','two',null)+card('Plan','alpha',null));
 p.header.description=p.doc.createElement('p');p.switchView('cards');
 const {choosing,release}=await setColorInFlight(t,p,api,1,'rose');
 const minted=metaOf(w.value.body)[1].id;assert.ok(minted);
 p.switchView('text');
 const paste=p.text.value.indexOf('## Plan');input(paste,paste,'## Budget\n\n','insertFromPaste');
 release();await choosing;await w.flush();
 assert.deepEqual(metaOf(w.base.content.body).map(r=>[r.title,r.id,r.color]),[['',A,'rose'],['Same',minted,'rose'],['Budget',null,null],['Plan',null,null]],'the save confirmed the paste and the new id');
 const at=p.text.value.indexOf('two');const rows=input(at,at+3,'','deleteContentBackward');
 assert.deepEqual(rows.map(r=>[r.title,r.id,r.color]),[['',A,'rose'],['Same',minted,'rose'],['Budget',null,null],['Plan',null,null]]);
});

// Review 6: actual NotebookPage input doors. This adapter dispatches cancellable
// beforeinput and the resulting input; it does not claim native gestures.
function edit(h,start,end,text,inputType='insertText') {
 const field=h.p.text;field.setSelectionRange(start,end);
 assert.deepEqual([field.selectionStart,field.selectionEnd],[start,end],'adapter retains the requested edit selection');
 const event={inputType,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
 field.listeners.beforeinput(event);
 if(!event.defaultPrevented){
  assert.deepEqual([h.p.textChange.start,h.p.textChange.end],[start,end],'beforeinput captures the edit range');
  field.value=field.value.slice(0,start)+text+field.value.slice(end);
  const caret=start+text.length;field.setSelectionRange(caret,caret);
  assert.deepEqual([field.selectionStart,field.selectionEnd],[caret,caret],'adapter retains the post-edit caret');
  field.listeners.input({inputType});
 }
 return event;
}
function history(h,inputType='historyUndo') {
 const event={inputType,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
 h.p.text.listeners.beforeinput(event);
 assert.equal(event.defaultPrevented,true,'Text owns history; native textarea history is prevented');
 return metaOf(h.w.value.body);
}
function cut(h,start,end) {
 const field=h.p.text,visible=field.value.slice(start,end);field.setSelectionRange(start,end);
 const written=[];field.listeners.cut?.({clipboardData:{setData:(kind,value)=>written.push([kind,value])},preventDefault(){}});
 edit(h,start,end,'','deleteByCut');
 for(const [kind,value] of written){assert.equal(kind,'text/plain');assert.doesNotMatch(value,/theseus-card/);}
 return visible;
}
function paste(h,at,text) {
 const field=h.p.text;field.setSelectionRange(at,at);
 const event={clipboardData:{getData:kind=>kind==='text/plain'?text:''},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
 field.listeners.paste?.(event);
 if(!event.defaultPrevented)edit(h,at,at,text,'insertFromPaste');
 return metaOf(h.w.value.body);
}

test('867 R6 Text Undo restores whole-card hidden bytes, CRLF and selection after select-all Delete',async t=>{
 const raw=card('First','words',details()).replaceAll('\n','\r\n'),h=await text867(t,raw),visible=h.p.text.value;
 edit(h,0,visible.length,'','deleteContentBackward');assert.equal(h.w.value.body,'');
 history(h);assert.equal(h.w.value.body,raw);assert.equal(h.p.text.value,visible);
 assert.deepEqual([h.p.text.selectionStart,h.p.text.selectionEnd],[0,visible.length]);
 history(h,'historyRedo');assert.equal(h.w.value.body,'');
 history(h);await h.w.flush();assert.equal(h.calls.length,0,'returning to exact source owes no revision');
});
test('867 R6 Text keyboard Undo and Redo restore one applied input each',async t=>{
 const h=await text867(t,card()),raw=h.w.value.body;
 let at=h.p.text.value.indexOf('words')+5;edit(h,at,at,'1');const once=h.w.value.body;
 edit(h,at+1,at+1,'2');const twice=h.w.value.body;
 const key=shift=>{let prevented=false;h.p.key({target:h.p.text,key:'z',metaKey:true,ctrlKey:false,shiftKey:shift,altKey:false,preventDefault(){prevented=true;},stopPropagation(){}});assert.equal(prevented,true);};
 key(false);assert.equal(h.w.value.body,once);key(false);assert.equal(h.w.value.body,raw);key(true);assert.equal(h.w.value.body,once);key(true);assert.equal(h.w.value.body,twice);
});
test('867 R6 cut moves raw identity once; repeated clipboard paste is an id-less copy',async t=>{
 const h=await text867(t,card('First','words',details(A))+card('Second','other',details(B,'rose')));
 const end=h.p.text.value.indexOf('## Second'),text=cut(h,0,end);
 assert.deepEqual(metaOf(h.w.value.body).map(r=>r.id),[B]);
 let rows=paste(h,h.p.text.value.length,text);assert.deepEqual(rows.map(r=>[r.id,r.color]),[[B,'rose'],[A,'blue']]);
 rows=paste(h,h.p.text.value.length,text);assert.deepEqual(rows.map(r=>r.id),[B,A,null]);
});
test('867 R6 Undo restoring a cut invalidates its raw transfer before another paste',async t=>{
 const h=await text867(t,card('First','words',details(A))+card('Second','other',details(B)));
 const text=cut(h,0,h.p.text.value.indexOf('## Second'));history(h);
 assert.deepEqual(metaOf(h.w.value.body).map(r=>r.id),[A,B]);
 assert.deepEqual(paste(h,h.p.text.value.length,text).map(r=>r.id),[A,B,null]);
});
test('867 R6 Text history and cut transfer end on switching away from Text',async t=>{
 const h=await text867(t,card('First','words',details(A))+card('Second','other',details(B)));
 const text=cut(h,0,h.p.text.value.indexOf('## Second'));h.p.header.description=h.p.doc.createElement('p');
 h.p.switchView('cards');h.p.switchView('text');const body=h.w.value.body;
 history(h);assert.equal(h.w.value.body,body,'a new Text opening has no previous Undo');
 assert.deepEqual(paste(h,h.p.text.value.length,text).map(r=>r.id),[B,null]);
});
test('867 R6 new typed newline inherits the nearest preceding CRLF without rewriting other bytes',async t=>{
 const raw=card('First','words',details(A)).replaceAll('\n','\r\n'),h=await text867(t,raw);
 const at=h.p.text.value.indexOf('words')+5;edit(h,at,at,'\ntail','insertLineBreak');
 assert.equal(h.w.value.body,raw.replace('words','words\r\ntail'));
 history(h);assert.equal(h.w.value.body,raw);
});
test('867 R6 newline inheritance is local in a mixed-ending body and defaults to LF before its first break',async t=>{
 const raw='Opening\n'+card('First','words',details(A)).replaceAll('\n','\r\n'),h=await text867(t,raw);
 const at=h.p.text.value.indexOf('words')+5;edit(h,at,at,'\nnew');assert.equal(h.w.value.body,raw.replace('words','words\r\nnew'));
 history(h);edit(h,0,0,'new\n');assert.equal(h.w.value.body,'new\n'+raw);
});
test('867 R6 heading-only deletion uses the Cards alias-only metadata bytes for a null survivor',async t=>{
 const raw=card('First','first',null)+card('Second','second',details(B,'rose')),h=await text867(t,raw),deck=parseDeck(raw);
 const fromCards=applyAct(deck,{kind:'merge',text:cardText(deck.cards[1]),near:1,step:-1}).deck.cards[0];
 const at=h.p.text.value.indexOf('## Second');edit(h,at,at+'## Second\n'.length,'','deleteContentBackward');
 const row=metaOf(h.w.value.body)[0];assert.equal(row.id,null);assert.equal(row.color,null);assert.deepEqual(row.aliases,[B]);
 assert.deepEqual(detailLines(parseDeck(h.w.value.body).cards[0].words).map(r=>r.line),detailLines(fromCards.words).map(r=>r.line));
 history(h);assert.equal(h.w.value.body,raw);
});
test('867 R6 a newly typed open fence cannot expose a hidden line or take it to another card',async t=>{
 const h=await text867(t,card('First','words',details(A))),at=h.p.text.value.indexOf('words')+5;
 edit(h,at,at,'\n```js\ncode');const body=h.w.value.body;
 assert.equal(detailLines(body).length,1,'the metadata remains outside fences');
 assert.equal(metaOf(body)[0].id,A);assert.ok(body.indexOf('<!-- theseus-card:')<body.indexOf('```js'));
 assert.equal(stripDetails(body),h.p.text.value);assert.doesNotMatch(h.p.text.value,/theseus-card/);
 history(h);assert.equal(h.w.value.body,card('First','words',details(A)));
});
test('867 R6 a copied exact card cannot steal its original id and color on the next word edit',async t=>{
 const h=await text867(t,card('Same','same',details(A))),copy=h.p.text.value;
 paste(h,copy.length,copy);const at=h.p.text.value.indexOf('same')+4;edit(h,at,at,'!');
 assert.deepEqual(metaOf(h.w.value.body).map(r=>[r.id,r.color]),[[A,'blue'],[null,null]]);
});
test('867 R6 input after Undo replaces the redo branch without losing raw identity',async t=>{
 const h=await text867(t,card()),at=h.p.text.value.indexOf('words')+5;
 edit(h,at,at,'1');edit(h,at+1,at+1,'2');history(h);edit(h,at+1,at+1,'3');
 const body=h.w.value.body;history(h,'historyRedo');assert.equal(h.w.value.body,body);assert.equal(metaOf(body)[0].id,A);assert.match(body,/words13/);
});
test('867 R6 typing then Text Undo restores exact mixed raw bytes without another revision',async t=>{
 const raw='Opening\r\n\r\n'+card('First','words',details(A))+'## Idless\r\n\r\nplain\r\n',h=await text867(t,raw);
 const at=h.p.text.value.indexOf('words')+5;edit(h,at,at,'!');history(h);assert.equal(h.w.value.body,raw);
 await h.w.flush();assert.equal(h.calls.length,0);assert.equal(h.w.base.revision,1);
});

// 12604: keep review P1/P6, with immediate projection instead of next-sync hiding.
test('867 R6 P1 a pasted valid new marker becomes metadata immediately and keeps the projected caret',async t=>{
 const h=await text867(t,card('One','one words',null)+card('Two','two words',details(A))),before=h.p.text.value;
 const at=before.indexOf('one words')+9;paste(h,at,'\n\n'+hidden(details(B,'rose')));
 assert.deepEqual(metaOf(h.w.value.body).map(r=>[r.id,r.color]),[[B,'rose'],[A,'blue']]);
 assert.equal(h.p.text.value,before);assert.deepEqual([h.p.text.selectionStart,h.p.text.selectionEnd],[at,at]);
 let writes=0,value=h.p.text.value;Object.defineProperty(h.p.text,'value',{get:()=>value,set:v=>{writes++;value=v;}});
 h.p.sync();assert.equal(writes,0,'the next sync has no deferred textarea rewrite');
});
test('867 R6 P6 saving an explicitly pasted new marker then typing keeps its identity hidden',async t=>{
 const h=await text867(t,card('One','one words',null)+card('Two','two words',details(A))),at=h.p.text.value.indexOf('one words')+9;
 paste(h,at,'\n\n'+hidden(details(B,'rose')));await h.w.flush();h.p.sync();edit(h,at,at,'!');
 assert.equal(metaOf(h.w.value.body)[0].id,B);assert.doesNotMatch(h.p.text.value,/theseus-card/);assert.equal(stripDetails(h.w.value.body),h.p.text.value);
});
test('867 R6 an explicit pasted marker cannot duplicate an existing card identity',async t=>{
 const h=await text867(t,card('Original','words',details(A)));
 paste(h,h.p.text.value.length,card('Copy','words',details(A,'rose')));
 assert.deepEqual(metaOf(h.w.value.body).map(r=>[r.id,r.color]),[[A,'blue'],[null,null]]);
 assert.equal(detailLines(h.w.value.body).length,1);assert.doesNotMatch(h.p.text.value,/theseus-card/);
});
test('867 R6 pasted fenced and invalid markers remain literal writing',async t=>{
 const h=await text867(t,card('Code','```js\ncode\n```',details(A))),at=h.p.text.value.indexOf('code')+4;
 paste(h,at,'\n'+hidden(details(B)));assert.ok(h.p.text.value.includes(hidden(details(B))));assert.equal(metaOf(h.w.value.body)[0].id,A);
 const invalid='\n<!-- theseus-card: {"id":"'+B+'"} -->';paste(h,h.p.text.value.length,invalid);
 assert.ok(h.p.text.value.endsWith(invalid));assert.equal(stripDetails(h.w.value.body),h.p.text.value);
});
test('867 R6 a cut event that does not delete cannot lend the source identity to a paste',async t=>{
 const h=await text867(t,card('First','words',details(A))),visible=h.p.text.value;
 h.p.text.setSelectionRange(0,visible.length);h.p.text.listeners.cut({});
 assert.deepEqual(paste(h,visible.length,visible).map(r=>r.id),[A,null]);
});
test('867 R6 cutting only words leaves the identity on the source card',async t=>{
 const h=await text867(t,card('First','words',details(A))+card('Second','other',details(B))),at=h.p.text.value.indexOf('words');
 const text=cut(h,at,at+5);paste(h,h.p.text.value.indexOf('other')+5,text);
 assert.deepEqual(metaOf(h.w.value.body).map(r=>r.id),[A,B]);assert.equal(detailLines(h.w.value.body).length,2);
});

// Exact body captured by grant12784 at R4-S1 round4/step4; ruling12797.
const swallowedFenceBody = "## One\n\none\n\n<!-- theseus-card: {\"id\":\"c-11111111111111111111111111111111\",\"aliases\":[],\"color\":\"blue\"} -->\n\n## #Two\n\nt\n\nwo\n\n<!-- theseus-card: {\"id\":\"c-22222222222222222222222222222222\",\"aliases\":[],\"color\":\"rose\"} -->\n\n##\t Three\n\nthree\n\n";
test('867 R6 a fence swallowing every heading retains marker bytes as writing and Undo restores ids',async t=>{
 const raw=swallowedFenceBody,h=await text867(t,raw),before=h.p.text.value;
 edit(h,0,0,'~~~');
 assert.equal(h.w.value.body,'~~~'+raw,'no marker moves or is retired');
 assert.equal(h.p.text.value,'~~~'+raw,'fenced marker bytes are visible writing');
 assert.deepEqual(metaOf(h.w.value.body),[]);
 assert.deepEqual([h.p.text.selectionStart,h.p.text.selectionEnd],[3,3]);
 let writes=0,value=h.p.text.value;Object.defineProperty(h.p.text,'value',{configurable:true,get:()=>value,set:v=>{writes++;value=v;}});
 h.p.sync();assert.equal(writes,0,'reprojection occurs during input, not next sync');
 await h.w.flush();assert.equal(h.w.base.content.body,'~~~'+raw);
 history(h);assert.equal(h.w.value.body,raw);assert.equal(h.p.text.value,before);
 assert.deepEqual(metaOf(h.w.value.body).map(r=>[r.id,r.color]),[[A,'blue'],[B,'rose'],[null,null]]);
 await h.w.flush();assert.equal(h.w.base.content.body,raw);
 edit(h,0,0,'~~~');edit(h,0,3,'','deleteContentBackward');
 assert.equal(h.w.value.body,raw);assert.equal(h.p.text.value,before);
 assert.deepEqual(metaOf(h.w.value.body).map(r=>[r.id,r.color]),[[A,'blue'],[B,'rose'],[null,null]]);
 assert.deepEqual([h.p.text.selectionStart,h.p.text.selectionEnd],[0,0]);
});
test('867 R6 a closing fence appended after every swallowed heading leaves every row literal',async t=>{
 const raw=swallowedFenceBody,h=await text867(t,raw);edit(h,0,0,'~~~');
 const end=h.p.text.value.length;edit(h,end,end,'~~~\n');
 assert.equal(h.w.value.body,'~~~'+raw+'~~~\n');
 assert.equal(h.p.text.value,h.w.value.body);assert.deepEqual(metaOf(h.w.value.body),[]);
 assert.deepEqual([h.p.text.selectionStart,h.p.text.selectionEnd],[end+4,end+4]);
 await h.w.flush();assert.equal(h.w.base.content.body,h.w.value.body);
 history(h);assert.equal(h.w.value.body,'~~~'+raw);
 history(h);assert.equal(h.w.value.body,raw);
});
test('867 R6 closing a swallowed fence before a later heading restores only later cards',async t=>{
 const raw=swallowedFenceBody,h=await text867(t,raw);edit(h,0,0,'~~~');
 const at=h.p.text.value.indexOf('## #Two');edit(h,at,at,'~~~\n\n');
 const expected='~~~'+raw.slice(0,at-3)+'~~~\n\n'+raw.slice(at-3);
 assert.equal(h.w.value.body,expected,'all bytes except the actual closing edit stay in place');
 assert.deepEqual(metaOf(expected).map(r=>[r.title,r.id,r.color]),[['#Two',B,'rose'],['Three',null,null]]);
 assert.equal(h.p.text.value,stripDetails(expected));
 assert.ok(h.p.text.value.includes(hidden(details(A))),'A remains writing before the closer');
 assert.ok(!h.p.text.value.includes(hidden(details(B,'rose'))),'B is metadata after the closer');
 assert.deepEqual([h.p.text.selectionStart,h.p.text.selectionEnd],[at+5,at+5]);
 history(h);assert.equal(h.w.value.body,'~~~'+raw);
 history(h);assert.equal(h.w.value.body,raw);
});
test('867 R6 a surviving card relocates only its own marker when a fence swallows a later card',async t=>{
 const raw=card('One','one',details(A))+card('Two','two',details(B,'rose')),h=await text867(t,raw);
 const at=h.p.text.value.indexOf('one')+3;edit(h,at,at,'\n~~~');
 const body=h.w.value.body;
 assert.equal(metaOf(body).length,1);assert.deepEqual(metaOf(body)[0].ids,[A]);
 assert.ok(body.indexOf(hidden(details(A)))<body.indexOf('~~~'),'A stays hidden in its own card before its fence');
 assert.ok(body.indexOf(hidden(details(B,'rose')))>body.indexOf('## Two'),'B stays at its original fenced words');
 assert.ok(h.p.text.value.includes(hidden(details(B,'rose'))));
 assert.equal(h.p.text.value,stripDetails(body));
 history(h);assert.equal(h.w.value.body,raw);
});
