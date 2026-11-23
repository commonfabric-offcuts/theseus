// Real NotebookPage / NotebookWriting memory ports for retained 867 review cases.
import { CardTextProjection, cardTextValue } from '../../web/notebook-card-text.mjs';
import assert from 'node:assert/strict';
import { cardText, parseDeck, applyAct, deckBody } from '../../web/deck.mjs';
import { cardDetails, stripDetails, detailLines } from '../../web/card-details.mjs';
import { Element } from './mini_dom.mjs';
import { NotebookPage } from '../../web/notebook-page.mjs';
import { NotebookWriting } from '../../web/notebook-writing.mjs';
const C='c-33333333333333333333333333333333';
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
  cloneNode(deep=false){const n=doc.createElement(this.tag);for(const [key,value]of Object.entries(this.attributes))n.setAttribute(key,value);n.className=this.className;if(deep)n.append(...this.children.map(c=>c.nodeType===3?c.textContent:c.cloneNode(true)));return n;}
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
 doc.getElementById=id=>doc.body.querySelector('#'+id);const pencil=doc.createElement('button');pencil.id='new-message';const svg=doc.createElement('svg'),path=doc.createElement('path');svg.setAttribute('viewBox','0 0 24 24');path.setAttribute('d','M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z M13.5 6.5l4 4');svg.append(path);pencil.append(svg);doc.body.append(pencil);
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
 const host=doc.createElement('section');doc.body.append(host);
 const p=new NotebookPage({doc,host,item:'page',mode:'text',bootstrap:{},viewPreference:{get:()=> 'text',set(){}},header:{title:doc.createElement('h1')}});
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

export { A, B, C, card, details, hidden, metaOf, text867, writingPort, documentPort, menuPage, NotebookPage, deckBody, cardText, parseDeck, cardDetails, stripDetails, CardTextProjection, cardTextValue };
