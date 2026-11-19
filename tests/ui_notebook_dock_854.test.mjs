import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { NotebookSheet } from '../web/notebook-sheet.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';
import { dossierPage, NotebookDossiers } from '../web/notebook-dossiers.mjs';
import { miniDocument, Element } from './fixtures/mini_dom.mjs';

// Actual sheet handlers with a small DOM; not native dialog or layout proof.
function fixture(t, {feed=true, wide=true, storage=new Map()}={}) {
  const doc=miniDocument(), calls=[], listeners=new Map(), saved=new Map();
  const set=(name,value)=>{saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});};
  const make=doc.createElement;
  doc.createElement=tag=>{const n=make(tag);n.style={};n.ownerDocument=doc;n.contains=other=>n===other||[...n.descendants()].includes(other);
    n.before=other=>n.parent?.insertBefore(other,n);n.getBoundingClientRect=()=>({height:80});return n;};
  doc.createElementNS=(_ns,tag)=>doc.createElement(tag);
  doc.body=doc.createElement('body');doc.body.root=true;
  doc.documentElement=doc.createElement('html');
  doc.getElementById=id=>doc.byId(id);
  for(const id of ['new-message-sheet','inline-composer','reader'])doc.body.append(doc.byId(id));
  const dialog=doc.byId('new-message-sheet');dialog.open=false;
  dialog.close=()=>{dialog.open=false;calls.push('close');};
  dialog.showModal=()=>{dialog.open=true;calls.push('modal');};
  dialog.show=()=>{dialog.open=true;calls.push('nonmodal');};
  const media={matches:wide,addEventListener:(_type,fn)=>{media.changed=fn;},removeEventListener(){}};
  doc.defaultView={getComputedStyle:()=>({marginTop:'0px',marginBottom:'0px'})};
  set('document',doc);set('location',new URL('https://fixture/?topic=t'));
  set('scrollX',0);set('scrollY',100);set('scrollTo',()=>{});
  set('getComputedStyle',()=>({overflowY:'visible',overflowX:'visible'}));
  set('sessionStorage',{getItem:key=>storage.get(key)??null,setItem:(k,v)=>storage.set(k,v),removeItem:key=>storage.delete(key)});
  set('matchMedia',()=>media);
  set('addEventListener',(type,fn,options={})=>{const row={fn,options};if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(row);});
  set('removeEventListener',()=>{});
  const emit=(type,event)=>{for(const {fn,options} of listeners.get(type)??[])if(!options.signal?.aborted)fn(event);};
  const page={host:doc.createElement('section'),text:doc.createElement('textarea'),mode:'cards',item:'p',sheetTitle:doc.createElement('span'),
    views:doc.createElement('div'),draft:doc.createElement('span'),more:doc.createElement('button'),pageNotice:doc.createElement('div'),status:doc.createElement('span'),
    load:async()=>true,paint(){},show(){},close(){calls.push('page-close');},writing:{journalPending:false}};
  const feedOptions={topicId:'t',read:async()=>({items:[],next_cursor:null}),open:async(...args)=>calls.push(['feed',...args])};
  const sheet=new NotebookSheet({doc,make:(_id,host)=>{page.host=host;return page;},fullHref:()=>'/p',openStack:async(...args)=>{calls.push(['reader',...args]);return true;},goBack(){},feed:feed?feedOptions:null});
  t.after(()=>{sheet.retire();for(const [name,descriptor] of saved)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];});
  return {sheet,page,doc,dialog,calls,media,storage,emit,feedOptions};
}
const event=(target,key)=>({target,key,button:0,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}});

test('854 head and menu dock the same writing, close and Escape undock before dismissing',async t=>{
  const f=fixture(t);await f.sheet.open('p');
  const editor=f.doc.createElement('textarea');editor.value='Exact unsaved card';f.page.host.append(editor);f.page.editing={field:editor};editor.focus();
  assert.ok(f.sheet.dockButton,'head offers docking');assert.equal(f.sheet.dockButton.hidden,false);
  f.sheet.dockButton.onclick();assert.equal(f.sheet.docked,true);assert.equal(f.calls.at(-1),'nonmodal');
  assert.equal(f.sheet.current,f.page);assert.equal(editor.value,'Exact unsaved card');
  assert.equal(f.doc.activeElement,editor);assert.equal(f.sheet.dossierButton.hidden,false);
  f.sheet.closer.onclick();assert.equal(f.sheet.docked,false);assert.equal(f.sheet.showing,true);assert.equal(f.calls.at(-1),'modal');
  const menu=NotebookPage.prototype.menuItems.call({writing:{pageState:{}},readOnly:true,menuExtras:f.page.menuExtras});
  const dock=menu.find(x=>x.label==='Beside the feed');assert.ok(dock);dock.act();assert.equal(f.sheet.docked,true);
  f.emit('keydown',event(editor,'Escape'));assert.equal(f.sheet.docked,false);assert.equal(f.sheet.showing,true);
  f.sheet.close();assert.equal(f.sheet.showing,false);assert.equal(editor.value,'Exact unsaved card');
});

test('854 docking is topic-only, width-gated and remembered without losing preference on resize',async t=>{
  const f=fixture(t);await f.sheet.open('p');f.sheet.dockButton.onclick();
  assert.equal(JSON.parse(f.storage.get('notebook-docked')),true);
  f.media.matches=false;f.media.changed();assert.equal(f.sheet.docked,false);assert.equal(f.sheet.dockButton.hidden,true);
  assert.deepEqual(f.page.menuExtras(),[]);assert.equal(JSON.parse(f.storage.get('notebook-docked')),true);
  f.media.matches=true;f.media.changed();assert.equal(f.sheet.docked,true);
  f.sheet.retire();assert.equal(f.doc.body.classList.contains('notebook-docked'),false);
});
for(const options of [{feed:false},{wide:false}])test(`854 no dock on ${options.feed===false?'non-topic':'narrow'} page`,async t=>{
  const f=fixture(t,{...options,storage:new Map([['notebook-docked','true']])});await f.sheet.open('p');
  assert.equal(f.sheet.dockButton.hidden,true);assert.equal(f.sheet.docked,false);assert.equal(f.calls.at(-1),'modal');
});

test('854 docked bubble uses feed, modal bubble uses Reader; feed scrolling is released',async t=>{
  const f=fixture(t);await f.sheet.open('p');f.sheet.dockButton.onclick();
  const link=f.doc.createElement('a');link.className='deck-bubble';link.href='/?topic=t&message=root';f.page.host.append(link);
  f.page.host.listeners.click(event(link));await Promise.resolve();
  assert.deepEqual(f.calls.at(-1),['feed','t','root']);assert.equal(f.sheet.showing,true);
  const wheel={target:f.doc.body,deltaY:20,preventDefault(){this.defaultPrevented=true;}};f.emit('wheel',wheel);assert.equal(wheel.defaultPrevented,undefined);
  f.sheet.dockButton.onclick();f.emit('wheel',wheel);assert.equal(wheel.defaultPrevented,true);
  f.page.host.listeners.click(event(link));await Promise.resolve();assert.ok(f.calls.some(call=>JSON.stringify(call)===JSON.stringify(['reader','t','root',false])));
});

test('854 app wires topic feed to bounded dossier reads and existing landing route',()=>{
  const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
  const sheet=app.slice(app.indexOf('function notebookSheetOf()'),app.indexOf('function openNotebook('));
  assert.match(sheet,/feed: topic && views \?/);assert.match(sheet,/land: true/);assert.match(sheet,/pipelineView/);
  const css=readFileSync(new URL('../web/aim.css',import.meta.url),'utf8');assert.match(css,/notebook-docked/);
});

test('854 actual app sheet constructor routes picker and bubbles through the current topic adapter',async()=>{
  const text=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
  const code=text.slice(text.indexOf('function notebookSheetOf()'),text.indexOf('function openNotebook('));
  const calls=[], scope={notebookSheet:null,topic:{id:'t'},views:{},retired:false,
    NotebookSheet:class{constructor(options){Object.assign(this,options);}},
    shell:{guard(){}},pipelineView:async(...args)=>calls.push(['read',...args]),
    openDestination:async target=>calls.push(['open',target]),pageReads:null,pageHere:null};
  vm.createContext(scope);vm.runInContext(code,scope);const sheet=scope.notebookSheetOf();
  assert.equal(sheet.feed.topicId,'t');await sheet.feed.read('topic_messages',{topic_id:'t'});
  await sheet.feed.open('t','root');assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    ['read','topic_messages',{topic_id:'t'}],['open',{kind:'topic',id:'t',message:'root',land:true}]]);
  await sheet.openStack('other','reply',true);assert.equal(calls.at(-1)[1].land,true);
  scope.notebookSheet=null;scope.topic=null;assert.equal(scope.notebookSheetOf().feed,null);
});

test('854 dossier discovery is bounded, canonical, named and paged without scanning',async()=>{
  const calls=[];
  const message=(id,root,body,name=null)=>({id,topic_id:'t',body,stack_position:{root_id:root,name:name?{text:name}:null}});
  const read=async(name,args)=>{calls.push([name,args]);return args.message_ids ?
    {items:[message('root','root','Root words','Chosen dossier')]}:
    {items:[message('reply','root','Reply words'),message('joined','root','Joined words'),message('single','single','Single first line')],next_cursor:2};};
  const page=await dossierPage(read,'t');assert.equal(calls.length,2);
  assert.deepEqual(calls[0],['topic_messages',{topic_id:'t',direction:'before',audience:'all',limit:30}]);
  assert.deepEqual(calls[1],['topic_messages',{topic_id:'t',message_ids:['root']}]);
  assert.deepEqual(page,{next:2,items:[{id:'single',title:'Single first line'},{id:'root',title:'Chosen dossier'}]});
  await assert.rejects(()=>dossierPage(async()=>({items:[message('wrong','root','secret')].map(x=>({...x,topic_id:'other'})),next_cursor:null}),'t'),/confirmed/);
});

test('854 picker drops late answers, retries errors, deduplicates More and opens only the selected root',async t=>{
  const f=fixture(t);await f.sheet.open('p');f.sheet.dockButton.onclick();
  const picker=f.sheet.dossiers, selected=[];picker.choose=id=>selected.push(id);
  const row={id:'root',topic_id:'t',body:'Named',stack_position:{root_id:'root',name:{text:'Dossier'}}};
  let resolve;picker.read=()=>new Promise(yes=>resolve=yes);
  const pending=picker.toggle();picker.close();resolve({items:[row],next_cursor:null});await pending;
  assert.equal(picker.root.hidden,true);assert.equal(picker.list.children.length,0);
  picker.read=async()=>{throw Error('Offline');};await picker.toggle();assert.equal(picker.retry.hidden,false);
  picker.read=async(_name,args)=>({items:[row],next_cursor:args.cursor?null:2});await picker.retry.onclick();
  assert.equal(picker.list.children[0].textContent,'Dossier');assert.equal(picker.more.hidden,false);
  await picker.more.onclick();assert.equal(picker.list.children.length,1);assert.equal(picker.more.hidden,true);
  picker.list.children[0].onclick();assert.deepEqual(selected,['root']);assert.equal(picker.root.hidden,true);
});

test('854 cross-topic bubble keeps return intent and page keys yield outside docked sheet',async t=>{
  const f=fixture(t);await f.sheet.open('p');f.sheet.dockButton.onclick();
  f.sheet.openStack=async(topic,id,land)=>{f.calls.push(['cross',topic,id,land]);return false;};
  await f.sheet.openInFeed('other','reply');
  assert.deepEqual(f.calls.at(-1),['cross','other','reply',true]);
  assert.equal(JSON.parse(f.storage.get('notebook-return')).land,true);assert.equal(f.sheet.showing,false);
  f.sheet.resume();await Promise.resolve();assert.equal(f.sheet.showing,true);assert.equal(f.sheet.docked,true);
  assert.equal(f.page.keyScope(f.doc.body),false);assert.equal(f.page.keyScope(f.page.host),true);
  assert.doesNotThrow(()=>NotebookPage.prototype.key.call({keyScope:f.page.keyScope},event(f.doc.body,'ArrowDown')));
  f.sheet.retire();const e=event(f.doc.body,'Escape');f.emit('keydown',e);assert.equal(e.defaultPrevented,undefined);
});
