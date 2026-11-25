import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as pending from '../web/pending-sends.mjs';
import * as imageOwner from '../web/card-images.mjs';
import { Uploads } from '../web/uploads.mjs';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';
let content;
try { content = await import('../web/message-card-content.mjs'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const pin={authority_id:'a',authority_epoch:'e'};
const image={id:'image-A',name:'A.png',content_type:'image/png',size_bytes:3,sha256:'aaa',inline:true};
const fixture = t => {
  const doc=miniDocument(), observers=[], oldDoc=globalThis.document, oldObserver=globalThis.IntersectionObserver;
  const make=doc.createElement;
  doc.createElement=tag=>{
    const n=make(tag);n.ownerDocument=doc;n.nodeType=1;
    Object.defineProperties(n,{parentElement:{get(){return this.parent;}},parentNode:{get(){return this.parent;}},childNodes:{get(){return this.children;}},
      nextElementSibling:{get(){const children=this.parent?.children??[];return children[children.indexOf(this)+1]??null;}},
      previousElementSibling:{get(){const children=this.parent?.children??[];return children[children.indexOf(this)-1]??null;}},firstElementChild:{get(){return this.children.find(c=>typeof c==='object')??null;}},lastElementChild:{get(){return this.children.filter(c=>typeof c==='object').at(-1)??null;}}});
    n.getClientRects=()=>n.hidden?[]:[{top:40,bottom:80}];
    n.contains=other=>n===other||[...n.descendants()].includes(other);
    n.after=(...nodes)=>{for(const node of nodes)n.parent.insertBefore(node,n.nextElementSibling);};
    n.before=node=>n.parent.insertBefore(node,n);
    return n;
  };
  doc.createTextNode=text=>Object.assign(doc.createElement('text'),{nodeType:3,data:String(text),textContent:String(text)});
  doc.createElementNS=(_ns,tag)=>doc.createElement(tag);
  doc.body=doc.createElement('body');doc.body.root=true;doc.defaultView={scrollBy(){}};
  globalThis.document=doc;
  globalThis.IntersectionObserver=class {constructor(callback){this.callback=callback;observers.push(this);}observe(){}unobserve(){}disconnect(){}};
  t.after(()=>{globalThis.document=oldDoc;globalThis.IntersectionObserver=oldObserver;});
  const host=doc.createElement('div');doc.body.append(host);
  const item={id:'submission-A',sendOperationId:'send-A',presentPending:true,topicId:'t',sourceRef:{kind:'topic',id:'t'},authority:{...pin},status:'preparing',
    snapshot:{body:'**Exact A** and [a link](https://example.test/)',attachments:[]}};
  const editor={key:'editor-A',context:{instanceId:'i',actor:'person',topicId:'t'},draft:{body:'later B'},submissions:[item]};
  const paint=options=>pending.paintPendingSends(host,[editor],{topicId:'t',underway:()=>true,...options});
  const card=()=>host.querySelector('[data-pending-send]');
  return {doc,host,item,editor,paint,card,observers};
};
const confirm = f => {
  f.item.status='confirmed';f.item.receipt={instance_id:'i',operation_id:'send-A',kind:'message.send',status:'committed',recorded:true,result:{message_id:'m-real',seq:42}};
  return {id:'m-real',topic_id:'t',seq:42,author_id:'person',author_kind:'human',body:f.item.snapshot.body,attachments:[],revision:1};
};


// Execute complete actual app functions. Only page/observer/read ports are modeled.
const appSource = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
function appFunction(name) {
  const start=appSource.indexOf('function '+name+'(');
  assert.ok(start>=0, name+' exists');
  return appSource.slice(start,appSource.indexOf('\n}',start)+2);
}
function appFixture(t) {
  const f=fixture(t), main=f.doc.createElement('main');
  f.doc.body.append(main);main.append(f.host);
  const win=f.doc.defaultView;win.scrollY=100;win.innerHeight=900;
  const styles=new Map(),priorities=new Map();
  f.host.style={getPropertyValue:key=>styles.get(key)??'',getPropertyPriority:key=>priorities.get(key)??'',
    setProperty(key,value,priority=''){styles.set(key,String(value));priorities.set(key,priority);},removeProperty:key=>{styles.delete(key);priorities.delete(key);}};
  const padding=()=>parseFloat(f.host.style.getPropertyValue('padding-top'))||0;
  const scrolls=[];win.scrollBy=({top})=>{scrolls.push(top);win.scrollY=Math.max(0,Math.min(f.doc.documentElement.scrollHeight-900,win.scrollY+top));};
  const rect=(node,position=148,height=160)=>{
    node.docTop=position;node.boxHeight=height;
    node.compareDocumentPosition=other=>[...f.doc.body.descendants()].indexOf(node)<[...f.doc.body.descendants()].indexOf(other)?4:2;
    node.getBoundingClientRect=()=>({top:node.docTop+(node!==f.host&&f.host.contains(node)?padding():0)-win.scrollY,bottom:node.docTop+(node!==f.host&&f.host.contains(node)?padding():0)-win.scrollY+node.boxHeight,
      left:0,right:600,width:600,height:node.boxHeight});
    return node;
  };
  rect(main,0,2000);rect(f.host,0,2000);
  const canonical=rect(f.doc.createElement('div'),20,100);canonical.dataset.id='old';f.host.append(canonical);
  const home=f.doc.createElement('dialog');home.open=false;f.host.append(home);
  const map=new Map(), views={messages:new Map()};
  f.doc.documentElement={get scrollHeight(){return 5000+padding()+(parseFloat(f.host.style.getPropertyValue('padding-bottom'))||0);}};
  f.doc.getSelection=()=>({isCollapsed:true});
  f.doc.querySelectorAll=()=>[canonical];
  const elements={main,messages:f.host,'new-message-sheet':home};
  const registry={sessions:new Map([[f.editor.key,{editor:f.editor}]]),runtime:{current:pin},disposed:false,
    sessionFor:()=>({underWay:()=>f.item.status==='preparing',uploads:{previewSubmission:async()=>null}})};
  const c=vm.createContext({...pending,document:f.doc,window:win,innerHeight:900,innerWidth:1512,Node:{DOCUMENT_POSITION_FOLLOWING:4},
    getComputedStyle:()=>({getPropertyValue:()=>0}),$:id=>elements[id],registry,views,topic:{id:'t'},bootstrap:{actor_kind:'human'},
    retired:false,topicUnavailable:false,authorityReviewPending:()=>false,inline:null,anchorActing:false,listActAnchor:null,
    roomy:null,anchorHold:null,restoredSendViews:new WeakSet(),messageEntries:map,displayActor:id=>id,displayRules:()=>[],
    feedMessages:()=>views.messages,pendingSendTarget:()=>null,drawn:()=>true,entries:()=>[canonical],
    typingField:n=>/^(INPUT|TEXTAREA|SELECT)$/.test(n?.tagName),cardIn:n=>n,stackState:()=>({stacks:[]}),
    actedListCard:()=>null,loadedAfter:()=>null,retainArrivalAnchor:()=>{},releaseTopArrivals:()=>{},
    newAbove:new Set(),recordListArrivals:s=>{s.arrivals=new Map();},rememberListAnchor:()=>{},anchorDepth:0,listAccessEpoch:0});
  const names=['pendingSendCard','restorePendingSendPlace','paintSubmittedWriting','inView','firstInView',
    'captureListAnchor','restoreListAnchor','holdRoom','keepListAnchor'];
  for(const n of names)vm.runInContext(appFunction(n),c,{filename:'app.mjs:'+n});
  const call=(name,...args)=>c[name](...args);
  call('paintSubmittedWriting');
  const card=rect(f.card()),picture=f.doc.createElement('img');picture.className='image-thumb';picture.src='blob:decoded-A';picture.naturalWidth=48;
  return {...f,main,win,scrolls,card,canonical,home,rect,c,call,map,views,picture};
}
for(const focus of ['card','link','outside'])test('1270 background list restoration keeps visible pending '+focus,t=>{
  const f=appFixture(t);
  const owner=focus==='card'?f.card:focus==='link'?f.card.querySelector('a'):f.doc.createElement('button');
  if(focus==='outside')f.main.append(owner);owner.focus();
  const before=f.card.getBoundingClientRect().top;
  // A canonical neighbor moves during an unrelated real list paint. Its
  // geometry is deliberately independent of the local submission's.
  f.call('keepListAnchor',()=>{f.canonical.docTop+=100;});
  assert.equal(f.card.getBoundingClientRect().top,before);
  assert.equal(f.doc.activeElement,owner);
});
for(const kind of ['textarea','input','select','contenteditable','selection'])test('1270 later '+kind+' retains its list owner',t=>{
  const f=appFixture(t),field=f.rect(f.doc.createElement(kind==='selection'?'button':kind==='contenteditable'?'div':kind),150,30);
  if(kind==='contenteditable')field.isContentEditable=true;
  f.main.append(field);field.focus();
  if(kind==='selection')f.doc.getSelection=()=>({isCollapsed:false});
  const captured=f.call('captureListAnchor');
  assert.notEqual(captured.anchor,f.card,'a pending card cannot claim later writing/selection');
});
for(const focus of ['link','outside'])test('1270 receipt/status repaint before canonical page retains '+focus+' and image',t=>{
  const f=appFixture(t);f.item.snapshot.attachments=[image];f.call('paintSubmittedWriting');
  const host=f.card.querySelector('.card-image');host.prepend(f.picture);
  const owner=focus==='link'?f.card.querySelector('a'):f.doc.createElement('button');
  if(focus==='outside')f.main.append(owner);owner.focus();
  const before=f.card.getBoundingClientRect().top,check=f.card.querySelector('.pending-send-check');
  let hidden=check.hidden;
  Object.defineProperty(check,'hidden',{get:()=>hidden,set:value=>{
    if(hidden&&!value){f.card.docTop+=49;f.card.boxHeight+=49;}hidden=value;
  }});
  confirm(f);f.call('paintSubmittedWriting');
  assert.equal(f.card.getBoundingClientRect().top,before,'capture precedes status/control layout');
  assert.equal(f.doc.activeElement,owner);assert.equal(f.card.querySelector('img'),f.picture);
  assert.equal(f.picture.naturalWidth,48);assert.equal(check.hidden,false,'committed-placement recovery remains reachable');
  assert.equal(f.card.dataset.pendingSend,f.item.id,'no canonical page is invented');
});
test('1270 authority retirement clears local visuals without a position hold',t=>{
  const f=appFixture(t);f.card.focus();f.c.topicUnavailable=true;f.call('paintSubmittedWriting');
  assert.equal(f.host.querySelector('[data-pending-send]'),null);assert.deepEqual(f.scrolls,[]);
  assert.equal(f.item.presentPending,true);
});
test('1270 explicit list action keeps its canonical anchor instead of pending',t=>{
  const f=appFixture(t);f.card.focus();f.c.anchorActing=true;
  assert.notEqual(f.call('captureListAnchor').anchor,f.card);
});

test('1270 background pending hold uses natural edge and does not retain send padding',t=>{
  const f=appFixture(t);f.win.scrollY=0;f.card.docTop=200;f.card.focus();
  f.call('keepListAnchor',()=>{f.card.docTop-=100;});
  assert.equal(f.card.getBoundingClientRect().top,100);assert.equal(f.win.scrollY,0);
  assert.equal(f.host.style.getPropertyValue('padding-top'),'');assert.equal(f.host.style.getPropertyValue('padding-bottom'),'');
});
test('1270 explicit unresolved navigation action keeps ownership over the pending card',t=>{
  const f=appFixture(t);f.card.focus();const before=f.card.getBoundingClientRect().top;
  f.call('keepListAnchor',()=>{f.card.docTop+=40;},{id:'not-on-this-page',anchor:f.main});
  assert.equal(f.card.getBoundingClientRect().top,before+40);assert.equal(f.doc.activeElement,f.card);
});
test('1270 later B acquired during status paint retains text caret and focus without restoration',t=>{
  const f=appFixture(t),field=f.rect(f.doc.createElement('textarea'),180,40);f.main.append(field);field.value='Later B exact';field.selectionStart=3;field.selectionEnd=5;
  f.card.querySelector('a').focus();const check=f.card.querySelector('.pending-send-check');let hidden=check.hidden;
  Object.defineProperty(check,'hidden',{get:()=>hidden,set:value=>{if(hidden&&!value){field.focus();f.card.docTop+=49;}hidden=value;}});
  confirm(f);f.call('paintSubmittedWriting');
  assert.equal(f.doc.activeElement,field);assert.equal(field.value,'Later B exact');assert.equal(field.selectionStart,3);assert.equal(field.selectionEnd,5);assert.deepEqual(f.scrolls,[]);
});
test('1270 selected text acquired elsewhere during status paint retains its owner',t=>{
  const f=appFixture(t),text=f.doc.createElement('span');f.main.append(text);f.card.querySelector('a').focus();
  let selection={isCollapsed:true};f.doc.getSelection=()=>selection;
  const check=f.card.querySelector('.pending-send-check');let hidden=check.hidden;
  Object.defineProperty(check,'hidden',{get:()=>hidden,set:value=>{if(hidden&&!value){selection={isCollapsed:false,anchorNode:text,focusNode:text};f.card.docTop+=49;}hidden=value;}});
  confirm(f);f.call('paintSubmittedWriting');assert.deepEqual(f.scrolls,[]);assert.equal(selection.anchorNode,text);
});
test('1270 nested ordinary list paint grants one pending restoration owner',t=>{
  const f=appFixture(t);f.card.focus();const before=f.card.getBoundingClientRect().top,original=f.c.restorePendingSendPlace;let restores=0;
  f.c.restorePendingSendPlace=(...args)=>{restores++;return original(...args);};
  f.call('keepListAnchor',()=>f.call('keepListAnchor',()=>{f.canonical.docTop+=100;}));
  assert.equal(f.card.getBoundingClientRect().top,before);assert.equal(restores,1);
});
test('1270 changed access epoch during status paint refuses old pending restoration',t=>{
  const f=appFixture(t);f.card.focus();const check=f.card.querySelector('.pending-send-check');let hidden=check.hidden;
  Object.defineProperty(check,'hidden',{get:()=>hidden,set:value=>{if(hidden&&!value){f.c.listAccessEpoch++;f.card.docTop+=49;}hidden=value;}});
  confirm(f);f.call('paintSubmittedWriting');assert.deepEqual(f.scrolls,[]);
});

test('1270 existing selection inside the pending card retains its own repaint hold',t=>{
  const f=appFixture(t),link=f.card.querySelector('a');link.focus();const before=f.card.getBoundingClientRect().top;
  const selection={isCollapsed:false,anchorNode:link,focusNode:link};f.doc.getSelection=()=>selection;
  const check=f.card.querySelector('.pending-send-check');let hidden=check.hidden;
  Object.defineProperty(check,'hidden',{get:()=>hidden,set:value=>{if(hidden&&!value)f.card.docTop+=49;hidden=value;}});
  confirm(f);f.call('paintSubmittedWriting');
  assert.equal(f.card.getBoundingClientRect().top,before);assert.equal(f.doc.activeElement,link);assert.equal(selection.anchorNode,link);
});
