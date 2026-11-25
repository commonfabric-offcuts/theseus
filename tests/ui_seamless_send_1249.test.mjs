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

for (const status of ['preparing','prepared','confirmed']) test('1273 frozen message submission without reply_to targets its dossier ('+status+')',t=>{
  const f=fixture(t);f.item.sourceRef={kind:'message',id:'earlier-parent'};f.item.status=status;
  f.item.replySource={sourceRef:{...f.item.sourceRef},topicId:'t',destinationId:'t',whisper:false,authority:{...pin}};
  assert.equal(Object.hasOwn(f.item.snapshot,'reply_to'),false);
  const folder=f.doc.createElement('section'),replies=f.doc.createElement('div'),later=f.doc.createElement('div'),end=f.doc.createElement('dialog');
  folder.append(replies);replies.append(later);f.host.append(folder,end);
  const before=structuredClone(f.item),seen=[];
  f.editor.context.sourceRef={kind:'message',id:'later-opened-B'};
  f.paint({target:ref=>{seen.push(ref);return ref?.id==='earlier-parent'?replies:null;},end});
  const card=f.card();assert.equal(card.parentElement,replies);assert.equal(later.nextElementSibling,card);
  assert.equal(seen[0].id,'earlier-parent');assert.deepEqual(f.item,before);assert.equal(f.editor.draft.body,'later B');
  assert.equal(card.dataset.id,undefined);assert.equal(card.dataset.seq,undefined);
});
test('1273 explicit reply wins over source while topic/Notebook sources remain root sends',t=>{
  const f=fixture(t);f.item.sourceRef={kind:'message',id:'original'};f.item.snapshot.reply_to='explicit';let ref;
  f.paint({target:value=>{ref=value;return null;}});assert.equal(ref.id,'explicit');
  delete f.item.snapshot.reply_to;
  for(const kind of ['topic','memory']){f.item.sourceRef={kind,id:'not-a-message'};f.paint({target:value=>{ref=value;return null;}});assert.equal(ref,null);}
});

test('1249 first handoff is an ordinary formatted own card, without canonical identity or controls',t=>{
  const f=fixture(t);f.paint();const card=f.card();
  assert.equal(card.classList.contains('message-card'),true);assert.equal(card.classList.contains('own-message'),true);
  assert.equal(card.querySelector('pre'),null,'the exact words use the ordinary formatter');
  assert.equal(card.querySelector('strong').text,'Exact A');assert.equal(card.querySelector('a').text,'a link');
  assert.equal(card.querySelector('.author-name').text,'person');assert.equal(card.querySelector('.pending-send-state').text,'Sending…');
  assert.equal(card.dataset.id,undefined);assert.equal(card.dataset.seq,undefined);assert.equal(card.getAttribute('role'),'article');
  assert.equal(card.querySelector('.pending-send-check').hidden,true);assert.equal(card.querySelector('[aria-pressed]'),null);
});

test('1249 repaint and unknown confirmation keep exact A, nodes and Check confirmation apart from B',t=>{
  const f=fixture(t);let checks=0;f.paint();const card=f.card(),words=card.querySelector('.message-preview'),link=card.querySelector('a');link.focus();
  f.editor.draft.body='Changed B';f.item.status='prepared';
  f.paint({underway:()=>false,check:()=>checks++});
  assert.equal(f.card(),card);assert.equal(card.querySelector('.message-preview'),words);assert.equal(card.querySelector('a'),link);assert.equal(f.doc.activeElement,link);
  assert.match(card.querySelector('.pending-send-state').text,/unknown/);assert.equal(card.querySelector('button').hidden,false);card.querySelector('button').onclick();assert.equal(checks,1);
  assert.equal(card.querySelector('strong').text,'Exact A');assert.equal(f.editor.draft.body,'Changed B');
});

test('1249 frozen reply destination places all submissions at the dossier tail above New; roots keep the composer end',t=>{
  const f=fixture(t),folder=f.doc.createElement('section'),replies=f.doc.createElement('div'),parent=f.doc.createElement('div'),later=f.doc.createElement('div'),line=f.doc.createElement('hr'),end=f.doc.createElement('dialog');
  folder.append(parent,replies);replies.append(later);f.host.append(folder,line,end);f.item.snapshot.reply_to='actual-parent';
  const target=ref=>ref?.id==='actual-parent'?replies:null;
  f.paint({target,end});const card=f.card();assert.equal(card.parentElement,replies);assert.equal(later.nextElementSibling,card);assert.equal(folder.nextElementSibling,line);
  const second={...structuredClone(f.item),id:'submission-B',sendOperationId:'send-B'};f.editor.submissions.push(second);f.paint({target,end});
  const b=f.host.querySelectorAll('[data-pending-send]')[1];assert.deepEqual(replies.children,[later,card,b]);
  let moves=0;const insert=replies.insertBefore.bind(replies);replies.insertBefore=(...args)=>{moves++;return insert(...args);};card.querySelector('a').focus();f.paint({target,end});assert.equal(moves,0);
  f.item.snapshot.reply_to=null;second.snapshot.reply_to=null;f.paint({end});assert.equal(b.nextElementSibling,end);assert.equal(card.nextElementSibling,b);
});

test('1249 moving a focused connected pending child to BODY restores focus and place without stealing later writing',t=>{
  const f=fixture(t);f.paint();const card=f.card(),link=card.querySelector('a');link.focus();let y=40,scrolls=[];
  pending.keepPendingSendPlace(f.host,()=>{f.doc.activeElement=f.doc.body;y=-1200;},{top:()=>y,scroll:delta=>scrolls.push(delta)});
  assert.equal(link.isConnected,true);assert.equal(f.doc.activeElement,link);assert.deepEqual(scrolls,[-1240]);
  const writing=f.doc.createElement('textarea');f.host.append(writing);link.focus();scrolls=[];
  pending.keepPendingSendPlace(f.host,()=>{writing.focus();y=70;},{top:()=>y,scroll:delta=>scrolls.push(delta)});
  assert.equal(f.doc.activeElement,writing);assert.deepEqual(scrolls,[]);
  link.focus();scrolls=[];let current=true;
  pending.keepPendingSendPlace(f.host,()=>{f.doc.activeElement=f.doc.body;current=false;y=90;},{current:()=>current,top:()=>y,scroll:delta=>scrolls.push(delta)});
  assert.equal(f.doc.activeElement,f.doc.body);assert.deepEqual(scrolls,[]);
});

for (const separateEditor of [false,true]) test(`1249 two root submissions repaint without moves or lost focused children (${separateEditor?'two editors':'one editor'})`,t=>{
  const f=fixture(t),end=f.doc.createElement('dialog');f.host.append(end);
  const second={...structuredClone(f.item),id:'submission-B',sendOperationId:'send-B',snapshot:{body:'**Frozen B**',attachments:[]}};
  const next={...f.editor,key:'editor-B',draft:{body:'later C'},submissions:[second]};
  const editors=separateEditor?[f.editor,next]:[f.editor];if(!separateEditor)f.editor.submissions.push(second);
  const before=structuredClone({second,draft:f.editor.draft,nextDraft:next.draft});
  const paint=()=>pending.paintPendingSends(f.host,editors,{topicId:'t',underway:()=>false,end});
  paint();const a=f.card(),b=f.host.querySelectorAll('[data-pending-send]')[1],link=a.querySelector('a'),check=a.querySelector('button');
  assert.deepEqual(f.host.children,[a,b,end]);
  const moves=[],insert=f.host.insertBefore.bind(f.host);f.host.insertBefore=(node,where)=>{moves.push({node,where});return insert(node,where);};
  for(const focused of [link,check]){
    focused.focus();paint();
    assert.equal(moves.length,0,'an already-correct root group must not be removed and reinserted');
    assert.deepEqual(f.host.children,[a,b,end]);assert.equal(f.doc.activeElement,focused);
    assert.equal(a.querySelector('a'),link);assert.equal(a.querySelector('button'),check);
  }
  assert.deepEqual({second,draft:f.editor.draft,nextDraft:next.draft},before);
  assert.equal(b.querySelector('strong').text,'Frozen B');
});

test('1249 receipt alone keeps the local card; matching canonical admission adopts the same node once',t=>{
  const f=fixture(t);f.paint();const card=f.card(),words=card.querySelector('.message-preview'),link=card.querySelector('a');link.focus();
  const message=confirm(f);f.paint();assert.equal(f.card(),card,'a committed receipt alone is not placement');
  assert.equal(typeof pending.adoptPendingSend,'function');const adopted=pending.adoptPendingSend(f.host,[f.editor],message,{topicId:'t'});
  assert.equal(adopted.card,card);assert.equal(adopted.refocus,true);assert.equal(card.dataset.pendingSend,undefined);
  content.paintCardWords(card,message,content.cardWordOptions(message,{revision:1}));
  assert.equal(card.querySelector('.message-preview'),words);assert.equal(card.querySelector('a'),link);assert.equal(f.doc.activeElement,link);
  f.paint({placed:()=>false});assert.equal(f.host.children.filter(n=>n.classList.contains('message-card')).length,1,'retained confirmed history cannot recreate a pending card after eviction');
  assert.equal(pending.adoptPendingSend(f.host,[f.editor],message,{topicId:'t'}),null);
});

test('1249 wrong identity/topic/author/sequence, refused, detached or retired input cannot adopt',t=>{
  const f=fixture(t);f.paint();const card=f.card(),message=confirm(f);assert.equal(typeof pending.adoptPendingSend,'function');
  for(const patch of [{id:'wrong'},{topic_id:'other'},{author_id:'other'},{seq:43}])assert.equal(pending.adoptPendingSend(f.host,[f.editor],{...message,...patch},{topicId:'t'}),null);
  for(const [key,value] of [['status','refused'],['detached',true]]){const before=f.item[key];f.item[key]=value;assert.equal(pending.adoptPendingSend(f.host,[f.editor],message,{topicId:'t'}),null);f.item[key]=before;}
  assert.equal(pending.adoptPendingSend(f.host,[f.editor],message,{topicId:'t',current:()=>false}),null);assert.equal(f.card(),card);
  assert.equal(pending.adoptPendingSend(f.host,[f.editor],message,{topicId:'t',authority:{authority_id:'other',authority_epoch:'e'}}),null);
  for(const [key,value] of [['instance_id','foreign'],['operation_id','different-operation']]) {
    const before=f.item.receipt[key];f.item.receipt[key]=value;assert.equal(pending.adoptPendingSend(f.host,[f.editor],message,{topicId:'t'}),null);f.item.receipt[key]=before;
  }
});

test('1249 canonical changed content wins while the outer card remains',t=>{
  const f=fixture(t);f.paint();const card=f.card(),old=card.querySelector('strong');const message={...confirm(f),body:'**Server canonical**'};
  assert.ok(pending.adoptPendingSend);assert.equal(pending.adoptPendingSend(f.host,[f.editor],message,{topicId:'t'}).card,card);
  content.paintCardWords(card,message,content.cardWordOptions(message,{revision:2}));assert.equal(card.querySelector('strong').text,'Server canonical');assert.notEqual(card.querySelector('strong'),old);
});

test('1249 original submission links choose A images instead of current B',t=>{
  const f=fixture(t);f.item.snapshot.attachments=[{id:image.id}];
  f.editor.uploadState={submission_links:{[f.item.id]:{refs:[{selection_id:'A',media_id:image.id}]}},entries:[
    {selection_id:'A',ready_descriptor:{...image,media_id:image.id,media_revision:2,state:'ready'}},
    {selection_id:'B',selected:true,ready_descriptor:{...image,media_id:'image-B',name:'B.png',media_revision:2,state:'ready'}}]};
  assert.ok(pending.pendingSendVisual);const visual=pending.pendingSendVisual(f.editor,f.item);assert.deepEqual(visual.attachments,[image]);
  f.paint();assert.equal(f.card().querySelectorAll('.card-image').length,1);assert.equal(f.card().querySelector('.card-image').title,'A.png');
  assert.equal(f.editor.uploadState.entries[1].selected,true);assert.equal(f.item.snapshot.attachments[0].id,image.id);
});

test('1249 identical displayed images retain their host and focused picture at canonical adoption',t=>{
  const f=fixture(t);f.item.snapshot.attachments=[image];f.paint();const card=f.card(),host=card.querySelector('.card-image');
  const picture=f.doc.createElement('img');picture.className='image-thumb';picture.src='blob:already-authorized-A';picture.hidden=false;host.prepend(picture);picture.focus();
  const message={...confirm(f),attachments:[image]};assert.ok(pending.adoptPendingSend);pending.adoptPendingSend(f.host,[f.editor],message,{topicId:'t'});
  imageOwner.adoptCardImages(card,message,async()=>{throw Error('identical loaded picture must not reread');});imageOwner.paintCardImages(card,message,async()=>null);
  assert.equal(card.querySelector('.card-image'),host);assert.equal(card.querySelector('img'),picture);assert.equal(picture.dataset.key,'m-real:image-A');assert.equal(f.doc.activeElement,picture);
});

test('1249 a focused handoff holds one card; later writing and retired pages do not scroll',t=>{
  const f=fixture(t);f.paint();const card=f.card();card.focus();let y=100,reads=0,scrolls=[];
  assert.ok(pending.keepPendingSendPlace);pending.keepPendingSendPlace(f.host,()=>{y=150;},{top:()=>{reads++;return y;},scroll:delta=>scrolls.push(delta)});
  assert.deepEqual(scrolls,[50]);assert.equal(reads,2);
  const writing=f.doc.createElement('textarea');f.host.append(writing);writing.focus();reads=0;scrolls=[];
  pending.keepPendingSendPlace(f.host,()=>{y=200;},{top:()=>{reads++;return y;},scroll:delta=>scrolls.push(delta)});assert.equal(reads,0);assert.deepEqual(scrolls,[]);
});

test('1249 access retirement disposes local visuals without erasing submission or successor',t=>{
  const f=fixture(t);f.paint();const before=structuredClone(f.item);f.paint({current:()=>false});assert.equal(f.card(),null);
  assert.deepEqual(f.item,before);assert.equal(f.editor.draft.body,'later B');
});

test('1249 a canonical page arriving before its receipt reconciles at the local position without a duplicate',t=>{
  const f=fixture(t);f.paint();const local=f.card();local.focus();
  const message=confirm(f),canonical=f.doc.createElement('div');canonical.dataset.id=message.id;canonical.className='message-card';f.host.prepend(canonical);
  let top=100,scrolls=[];assert.ok(pending.reconcilePlacedSend);
  pending.keepPendingSendPlace(f.host,()=>{const result=pending.reconcilePlacedSend(f.host,[f.editor],message,canonical,{topicId:'t'});top=120;return result;},
    {top:()=>top,scroll:delta=>scrolls.push(delta)});
  assert.equal(f.host.children.length,1);assert.equal(f.host.children[0],canonical);assert.equal(f.doc.activeElement,canonical);assert.deepEqual(scrolls,[20]);
  f.paint({placed:()=>true});assert.equal(f.host.children.length,1);
});

test('1249 retained image preview checks frozen operation binding before and after an asynchronous read',async()=>{
  assert.equal(typeof Uploads.prototype.previewSubmission,'function');
  const editor={key:'key',context:{instanceId:'i',actor:'person'},uploadState:{submission_links:{s:{refs:[{selection_id:'A',media_id:image.id}]}},entries:[]}};
  const entry={selection_id:'A',binding:{instance_id:'i',actor_id:'person',editor_key:'key',topic_id:'t',authority:{...pin}},ready_descriptor:{media_id:image.id}};editor.uploadState.entries.push(entry);
  const item={id:'s',topicId:'t',authority:{...pin},snapshot:{attachments:[image]}};
  const uploads=Object.assign(Object.create(Uploads.prototype),{editor,session:{authority:{...pin}},registry:{runtime:{current:{...pin}}},valid:()=>true});
  let release,reads=0;uploads.preview=async id=>{reads++;assert.equal(id,'A');return new Promise(resolve=>release=resolve);};
  const read=uploads.previewSubmission(item,image);item.detached=true;release(new Blob(['A']));assert.equal(await read,null);assert.equal(reads,1);
  item.detached=false;uploads.registry.runtime.current={authority_id:'other',authority_epoch:'e'};assert.equal(await uploads.previewSubmission(item,image),null);assert.equal(reads,1);
});


test('1254 a visible pending card keeps its place with focus on an outside button',t=>{
  const f=fixture(t);f.paint();const card=f.card(),button=f.doc.createElement('button');f.host.append(button);button.focus();let y=40,scrolls=[];
  pending.keepPendingSendPlace(f.host,()=>{y=-1200;},{top:()=>y,scroll:delta=>scrolls.push(delta)});
  assert.equal(f.doc.activeElement,button);assert.deepEqual(scrolls,[-1240]);
});

test('1254 two registered editors keep first-handed submission order when the older editor sends later',t=>{
  const f=fixture(t),end=f.doc.createElement('dialog');f.host.append(end);f.item.presentPending=false;
  const second={...structuredClone(f.item),id:'first-handed-B',presentPending:true},b={...f.editor,key:'editor-B',submissions:[second]};
  const paint=()=>pending.paintPendingSends(f.host,[f.editor,b],{topicId:'t',underway:()=>true,end});
  paint();const first=f.card();f.item.presentPending=true;paint();
  assert.deepEqual(f.host.querySelectorAll('[data-pending-send]').map(card=>card.dataset.pendingSend),['first-handed-B',f.item.id]);
  assert.equal(f.host.children[0],first);first.querySelector('a').focus();paint();assert.equal(f.doc.activeElement,first.querySelector('a'));
});
