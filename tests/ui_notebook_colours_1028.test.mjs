import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookWriting, sameContent, mergeCardContent } from '../web/notebook-writing.mjs';
import { NotebookPage, notebookMenuItems } from '../web/notebook-page.mjs';
import { NotebookThumbnailMenu } from '../web/notebook-thumbnail-menu.mjs';
import { OutcomeReferences } from '../web/outcome-references.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const content = {title:'Notebook',body:'## Card\n\nWords\n',attachments:[],references:[],draft:false,color:null};

test('1028 the page menu exposes the shared Set color door under its writer rule',()=>{
  let opened=0;
  const page={writing:{pageState:{reader_may_write:true}},mode:'cards',drafted:()=>false,
    pageColors(){opened++;}};
  const choice=notebookMenuItems(page).find(item=>item.key==='color');
  assert.ok(choice,'a page colour door exists');
  assert.equal(choice.label,'Set color');assert.equal(choice.disabled,false);
  choice.act();assert.equal(opened,1);
  page.writing.reading=true;
  assert.equal(notebookMenuItems(page).find(item=>item.key==='color').disabled,true);
  choice.act();assert.equal(opened,1,'a retained menu cannot write after access changes');
});

test('1028 colour participates in dirty state and merges separately from card words',()=>{
  const blue={...content,color:'blue'}, words={...content,body:content.body.replace('Words','Later words')};
  assert.equal(sameContent(content,blue),false,'a page colour is writing');
  assert.deepEqual(mergeCardContent(content,blue,words),{...words,color:'blue'});
  assert.equal(mergeCardContent(content,blue,{...content,color:'rose'}),null,'different concurrent colours require a choice');
});

test('1028 the writer reads the Core colour into the content it saves',async t=>{
  const source={instance_id:'fixture-1028',source_ref:{kind:'memory',id:'page',revision:1},
    ...content,color:'blue',reader_may_write:true};
  const w=new NotebookWriting({item:'page',bootstrap:{instance_id:'fixture-1028',actor:'owner'},
    api:{view:async()=>structuredClone(source)},store:{get:async()=>null,put:async()=>{},delete:async()=>{}},delay:60000});
  t.after(()=>w.close());await w.open();
  assert.equal(w.capture().content.color,'blue');
});

function writer(t) {
  const bootstrap={instance_id:'fixture-1028',actor:'owner',authority:{authority_id:'a',authority_epoch:'e'}};
  let source={instance_id:bootstrap.instance_id,source_ref:{kind:'memory',id:'page',revision:1},...content,color:'blue',reader_may_write:true},held=null;
  const calls=[],receipts=new Map(),clients=[];
  const store={get:async()=>structuredClone(held),put:async value=>{held=structuredClone(value);},delete:async()=>{held=null;}};
  const api={view:async()=>structuredClone(source),command:async request=>{
    assert.deepEqual(held.pending,request,'exact pending colour/words are journaled before dispatch');calls.push(structuredClone(request));
    if(receipts.has(request.operation_id))return structuredClone(receipts.get(request.operation_id));
    const reply={instance_id:bootstrap.instance_id,operation_id:request.operation_id,kind:request.kind,recorded:true};
    if(request.expected.item_revision!==source.source_ref.revision)Object.assign(reply,{status:'rejected',error:{code:'REVISION_CONFLICT',message:'Changed elsewhere'}});
    else {source={...source,...structuredClone(request.args),source_ref:{...source.source_ref,revision:source.source_ref.revision+1}};
      Object.assign(reply,{status:'committed',result:{item_id:'page',revision:source.source_ref.revision,source_ref:structuredClone(source.source_ref)}});}
    receipts.set(request.operation_id,structuredClone(reply));return reply;
  }};
  const make=async()=>{const w=new NotebookWriting({item:'page',bootstrap,api,store,delay:60000,reconcile:mergeCardContent});clients.push(w);await w.open();return w;};
  t.after(()=>clients.forEach(w=>w.close()));
  return {make,api,store,calls,source:()=>structuredClone(source),held:()=>structuredClone(held),
    remote:patch=>{source={...source,...patch,source_ref:{...source.source_ref,revision:source.source_ref.revision+1}};}};
}

async function colourUndoPage(t) {
  const f = writer(t), writing = await f.make(), doc = miniDocument();
  const create = doc.createElement, events = new EventTarget();
  doc.addEventListener = (...args) => events.addEventListener(...args);
  doc.removeEventListener = (...args) => events.removeEventListener(...args);
  doc.createElement = tag => {
    const node = create(tag); node.ownerDocument = doc; node.style = {};
    node.contains = target => node === target || [...node.descendants()].includes(target);
    // Only the picker's positioning adapter uses this box; no geometry claim.
    node.getBoundingClientRect = () => ({ top: 10, bottom: 30, left: 10, right: 30, width: 20, height: 20 });
    return node;
  };
  doc.body = doc.createElement('body'); doc.body.root = true;
  const more = doc.createElement('button'); doc.body.append(more);
  const previousCard = { kind: 'edit', text: 'Previous card act' }, cardUndos = [], notices = [];
  const page = Object.assign(Object.create(NotebookPage.prototype), { writing, doc, more, host: doc.body,
    readOnly: false, mode: 'cards', undos: [previousCard], listening: new AbortController(),
    textEdited() {}, act: act => { cardUndos.push(act); return true; }, say: words => notices.push(words) });
  const picker = page.pageColors(); t.after(() => picker?.close(false));
  await picker.root.querySelector('.agent-rose').onclick();
  assert.equal(f.source().color, 'rose', 'the actual picker/writer confirmed the choice');
  return { f, page, writing, previousCard, cardUndos, notices };
}

test('1028 page colour Undo reverses its own confirmed choice and preserves the previous card act', async t => {
  const f = await colourUndoPage(t); f.page.undo();
  assert.deepEqual(f.cardUndos, [], 'Undo after Set color must not consume the previous card act');
  assert.deepEqual(f.page.undos, [f.previousCard]); assert.equal(f.writing.value.color, 'blue');
  assert.equal(f.writing.value.body, content.body); await f.writing.flush(); assert.equal(f.f.source().color, 'blue');
});

test('1028 page colour Undo refuses a changed colour without undoing an older card', async t => {
  const f = await colourUndoPage(t);
  f.writing.edit({ color: 'olive' }, f.writing.capture()); f.page.undo();
  assert.deepEqual(f.cardUndos, []); assert.deepEqual(f.page.undos, [f.previousCard]);
  assert.equal(f.writing.value.color, 'olive'); assert.match(f.notices.at(-1), /color changed/);
});

test('1028 page colour Undo command reaches its own act from the picker return button in Text view', async t => {
  const f = await colourUndoPage(t); f.page.mode = 'text';
  const event = { target: f.page.more, key: 'z', metaKey: true,
    preventDefault() { this.prevented = true; }, stopPropagation() {} };
  f.page.key(event);
  assert.equal(event.prevented, true);
  assert.equal(f.writing.value.color, 'blue'); assert.deepEqual(f.cardUndos, []);
  assert.deepEqual(f.page.undos, [f.previousCard]);
});

test('1028 unknown colour reply reloads the same envelope and keeps later colour and words',async t=>{
  const f=writer(t),w=await f.make(),send=f.api.command;
  f.api.command=async request=>{await send(request);throw Error('Lost answer');};
  w.edit({color:'rose'},w.capture());await w.flush();const pending=structuredClone(w.pending);
  w.edit({color:'green',body:'Later words'},w.capture());await w.serial;w.close();f.api.command=send;
  const recovered=await f.make();assert.deepEqual(f.calls[1],pending);assert.equal(recovered.value.color,'green');assert.equal(recovered.value.body,'Later words');
  await recovered.flush();assert.equal(f.source().color,'green');assert.equal(f.source().body,'Later words');assert.equal(f.source().source_ref.revision,3);
});

test('1028 a late colour confirmation cannot reverse a later explicit clear',async t=>{
  const f=writer(t),w=await f.make(),send=f.api.command;let release,arrived;
  const wait=new Promise(resolve=>{arrived=resolve;});
  f.api.command=async request=>{const reply=await send(request);arrived();await new Promise(resolve=>{release=resolve;});return reply;};
  w.edit({color:'rose'},w.capture());const saving=w.flush();await wait;
  w.edit({color:null},w.capture());release();await saving;assert.equal(w.value.color,null);assert.equal(w.base.content.color,'rose');
  f.api.command=send;await w.flush();assert.equal(f.source().color,null);
});

test('1028 colour versus remote words merges; competing colours require the existing choice',async t=>{
  const f=writer(t),w=await f.make();w.edit({color:'rose'},w.capture());f.remote({body:'Remote words'});await w.flush();
  assert.equal(w.conflict,null);assert.equal(w.value.color,'rose');assert.equal(w.value.body,'Remote words');await w.flush();
  w.edit({color:'green'},w.capture());f.remote({color:'olive'});await w.flush();
  assert.equal(w.value.color,'green');assert.equal(w.conflict.content.color,'olive');
  await w.resolve(false);assert.equal(w.value.color,'olive');assert.equal(w.dirty,false);
});

test('1028 definite refusal keeps the chosen colour and device record without claiming it saved',async t=>{
  const f=writer(t),w=await f.make();
  f.api.command=async request=>({instance_id:'fixture-1028',operation_id:request.operation_id,kind:request.kind,recorded:true,status:'rejected',error:{code:'FORBIDDEN',message:'No longer writable'}});
  w.edit({color:'rose'},w.capture());await w.flush();assert.equal(w.pending,null);assert.equal(w.readOnly,true);
  assert.equal(w.value.color,'rose');assert.equal(f.held().value.color,'rose');assert.equal(f.source().color,'blue');assert.equal(w.dirty,true);
});

test('1028 old pending envelope omits colour exactly while settlement preserves its known Core colour',async t=>{
  const f=writer(t),w=await f.make();w.edit({body:'Old pending words'},w.capture());await w.serial;
  const held=f.held(),request=w.envelope();delete request.args.color;delete held.base.content.color;delete held.value.color;
  held.pending=request;w.close();await f.store.put(held);
  const recovered=await f.make();assert.deepEqual(f.calls[0],request,'no new field was put into the old operation');
  assert.equal(f.source().color,'blue');assert.equal(recovered.value.color,'blue');assert.equal(recovered.base.content.color,'blue');assert.equal(recovered.dirty,false);
});

test('1028 a failed device journal prevents the colour request leaving',async t=>{
  const f=writer(t),w=await f.make(),command=f.api.command;let attempts=0;
  f.api.command=request=>{attempts++;return command(request);};f.store.put=async()=>{throw Error('Device full');};
  w.edit({color:'rose'},w.capture());await w.flush();assert.equal(attempts,0,'no API attempt before the device journal succeeds');assert.equal(f.calls.length,0);assert.equal(w.value.color,'rose');assert.equal(f.source().color,'blue');
});

function thumbnail() {
  const doc=new EventTarget(),row={dataset:{id:'page'},ownerDocument:doc,isConnected:true,contains:node=>node===row};
  const source={instance_id:'fixture-1028',source_ref:{kind:'memory',id:'page',revision:2},owner_scope:{kind:'workspace',id:'outcome'},title:'Page',reader_may_write:true};
  const item={id:'page',owner_scope:source.owner_scope},reads=[],shown=[],opened=[],notices=[];let current=true,loaded=null,picked=0;
  const page={writing:{pageState:source},mode:'cards',drafted:()=>false,pageColors:()=>{picked++;},menuItems(){return notebookMenuItems(this);}};
  const menus=new NotebookThumbnailMenu({bootstrap:{instance_id:'fixture-1028'},api:{command(){assert.fail('opening wrote');}},
    read:async(name,args)=>{reads.push([name,args]);return source;},open:async(id,options)=>{opened.push([id,options.opener]);loaded=page;return true;},
    loaded:()=>loaded,mode:()=> 'cards',current:()=>current,notice:words=>notices.push(words),changed(){},
    show:options=>{shown.push(options);return {root:{contains:()=>false},close(){}};}});
  return {doc,row,source,item,reads,shown,opened,notices,menus,picked:()=>picked,leave:()=>{current=false;}};
}

test('1028 thumbnail borrows current descriptors and opens the actual page writer only at Set color',async()=>{
  const f=thumbnail();await f.menus.open(f.item,f.row);
  assert.deepEqual(f.reads,[['memory_current',{item_id:'page'}]]);assert.deepEqual(f.opened,[]);
  await f.shown[0].items.find(item=>item.key==='color').act();
  assert.deepEqual(f.opened,[['page',f.row]]);assert.equal(f.picked(),1);
  f.menus.menu.close(false);
});

for(const mismatch of ['instance','page','scope','revision'])test('1028 thumbnail refuses '+mismatch+' before presenting choices',async()=>{
  const f=thumbnail();
  if(mismatch==='instance')f.source.instance_id='foreign';
  if(mismatch==='page')f.source.source_ref.id='other-page';
  if(mismatch==='scope')f.source.owner_scope={kind:'topic',id:'foreign'};
  if(mismatch==='revision')f.source.source_ref.revision=0;
  await f.menus.open(f.item,f.row);assert.deepEqual(f.shown,[]);assert.deepEqual(f.opened,[]);assert.match(f.notices[0].message,/could not be confirmed/);
});

for(const departure of ['Escape','Tab','navigation','row-reuse'])test('1028 delayed thumbnail metadata cannot reopen after '+departure,async()=>{
  const f=thumbnail();let release;f.menus.read=()=>new Promise(resolve=>{release=resolve;});const opening=f.menus.open(f.item,f.row);
  if(departure==='navigation')f.leave();else if(departure==='row-reuse')f.row.dataset.id='other';else {const event=new Event('keydown');Object.assign(event,{key:departure});f.doc.dispatchEvent(event);}
  release(f.source);await opening;assert.deepEqual(f.shown,[]);assert.deepEqual(f.opened,[]);
});

test('1028 a retained thumbnail choice cannot act after leaving its outcome',async()=>{
  const f=thumbnail();await f.menus.open(f.item,f.row);const choose=f.shown[0].items.find(item=>item.key==='color');
  f.leave();await choose.act();assert.deepEqual(f.opened,[]);assert.equal(f.picked(),0);f.menus.menu.close(false);
});

test('1028 actual thumbnail repaint keeps colour, keyboard and ordinary navigation owners distinct',t=>{
  const doc=miniDocument(),make=doc.createElement;doc.createElement=tag=>{const node=make(tag);node.ownerDocument=doc;return node;};
  let collapsed=true;doc.getSelection=()=>({isCollapsed:collapsed});const previous=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=previous;});
  const node=tag=>doc.createElement(tag??'div'),list=node(),opened=[],menus=[];list.root=true;
  const refs=new OutcomeReferences({scope:'outcome',host:node(),list,more:node('button'),message:node(),read:async()=>{},open:(...args)=>opened.push(args),menu:(...args)=>menus.push(args)});
  const item={id:'page',title:'Page',source_ref:{kind:'memory',id:'page',revision:2},color:'blue'};refs.items=[item];refs.paint();const row=list.children[0];row.classList.add('other-owner');
  assert.equal(row.classList.contains('agent-blue'),true);
  const e=extra=>({target:row,preventDefault(){this.prevented=true;},stopPropagation(){},...extra});
  const emit=(kind,extra={})=>{const event=e(extra);list.listeners[kind](event);return event;};
  emit('pointerdown',{pointerType:'mouse'});const secondary=emit('contextmenu',{clientX:20,clientY:30});assert.equal(secondary.prevented,true);assert.equal(menus.length,1);
  //16064 replaces the hand-rolled pointerdown snapshot with the shared door:
  // the selection that exists at the context/keyboard event stays native.
  collapsed=false;emit('pointerdown',{pointerType:'mouse'});emit('contextmenu');assert.equal(menus.length,1,'selected text remains native');
  collapsed=true;emit('keydown',{key:'F10',shiftKey:true});emit('contextmenu');assert.equal(menus.length,2);assert.equal(opened.length,0);
  row.onclick(e({button:0}));assert.equal(opened[0][0],item.source_ref);
  item.color=null;refs.paint();assert.equal(list.children[0],row);assert.equal(row.classList.contains('agent-blue'),false);assert.equal(row.classList.contains('other-owner'),true);
});
