import test from 'node:test';
import assert from 'node:assert/strict';
import {TopicViews} from '../web/topic-views.mjs';
import * as stacks from '../web/reply-stacks.mjs';
import {renderer799} from './fixtures/renderer799.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const item=(id,seq,extra={})=>({id,seq,topic_id:'t1',author_id:'agent',author_kind:'agent',body:'Words '+id,revision:1,acts:{},...extra});
const page=(items,version=1)=>({instance_id:'i1',items,next_cursor:null,relevant_versions:{topic:version}});
function views(){const paints=[];const v=new TopicViews({instanceId:'i1',topicId:'t1',paint:(kind,detail)=>paints.push({kind,detail})});return {v,paints};}
test('initial and older message loading retain the existing full publication owner',()=>{
 const {v,paints}=views();v.messagesPage(page([item('first',1)]),{initial:true});assert.notEqual(paints.find(x=>x.kind==='messages').detail?.incremental,true);
});
test('one live arrival publishes only its added identities independently of loaded history',()=>{
 const {v,paints}=views();v.messagesPage(page(Array.from({length:2000},(_,i)=>item('old'+i,i+1))),{initial:true});paints.length=0;
 v.messagesPage(page([item('new',2001)],2),{live:true,cursor:2000});const detail=paints.find(x=>x.kind==='messages').detail;
 assert.equal(detail?.incremental,true);assert.deepEqual(detail.added,['new']);assert.deepEqual(detail.changed,[]);
});
test('an own-send anchored page identifies the newly admitted row while retaining changed-record identity',()=>{
 const {v,paints}=views();v.messagesPage(page([item('old',1)]),{initial:true});paints.length=0;
 v.messagesPage(page([item('old',1),item('mine',2,{author_id:'reader'})],2),{anchored:true,cursor:3});const detail=paints.find(x=>x.kind==='messages').detail;
 assert.equal(detail?.incremental,true);assert.deepEqual(detail.added,['mine']);assert.deepEqual(detail.changed,[]);
});
test('incremental stack publication does not write an unchanged dossier',()=>{
 assert.equal(typeof stacks.appendStacks,'function','the actual stack owner exposes bounded append publication');
 const f=renderer799(),doc=f.list.ownerDocument;
 f.add([item('a',1),item('b',2),item('c',3)]);const kept=stacks.stackState(f.list).sections.get('a');
 let writes=0;for(const node of [kept,...kept.descendants()]){node.dataset=new Proxy(node.dataset,{set(target,key,value){writes++;target[key]=value;return true;}});}
 const incoming=item('d',4);f.messages.set('d',incoming);const entry=doc.createElement('div');entry.dataset.id='d';entry.dataset.seq='4';entry.className='message-card';entry.append(doc.createElement('span'),doc.createElement('span'));f.list.append(entry);
 const result=stacks.appendStacks(f.list,f.messages,[incoming],{entries:new Map([['d',entry]]),viewer:'reader',doc});
 assert.equal(result,true);assert.equal(writes,0);assert.equal(stacks.stackState(f.list).sections.get('a'),kept);assert.ok(stacks.stackState(f.list).sections.has('d'));
});

function appendEntry(f,incoming){
 const doc=f.list.ownerDocument,entry=doc.createElement('button');entry.className='message-card';entry.dataset.id=incoming.id;entry.dataset.seq=String(incoming.seq);
 const author=doc.createElement('span');author.className='message-author';author.textContent=incoming.author_id;
 const body=doc.createElement('span');body.className='message-preview';entry.append(author,body);f.list.append(entry);f.messages.set(incoming.id,incoming);return entry;
}
const snapshot=node=>typeof node==='string'?node:{tag:node.tag,className:node.className,dataset:{...node.dataset},attributes:{...node.attributes},hidden:node.hidden,text:node.textContent,children:node.children.map(snapshot)};
for(const scenario of ['root','reply','folded','starred','writing','coordination','two-replies'])test('append preserves full-owner drawing: '+scenario,()=>{
 const first=item('a',1,{author_id:'person',author_kind:'human',acts:scenario==='starred'?{starred:true}:{}}),other=item('b',2);
 const f=renderer799(),control=renderer799();f.add([first,other]);control.add([first,other]);
 if(scenario==='folded'){stacks.stackState(f.list).levels.set('a','folded');stacks.stackState(control.list).levels.set('a','folded');}
 if(scenario==='writing'){f.list.querySelector('[data-id=a]').setAttribute('data-card-reply','true');control.list.querySelector('[data-id=a]').setAttribute('data-card-reply','true');}
 stacks.arrangeStacks(f.list,f.messages,{viewer:'reader'});stacks.arrangeStacks(control.list,control.messages,{viewer:'reader'});
 const arrivals=[item('new',3,scenario==='root'||scenario==='coordination'?{}:{reply_to:'a',author_id:'reader',author_kind:'human'})];
 if(scenario==='two-replies')arrivals.push(item('newer',4,{reply_to:'new',author_id:'reader',author_kind:'human'}));
 const entries=new Map(arrivals.map(incoming=>[incoming.id,appendEntry(f,incoming)]));for(const incoming of arrivals)appendEntry(control,incoming);
 const accepted=stacks.appendStacks(f.list,f.messages,arrivals,{entries,viewer:'reader'});
 assert.equal(accepted,true,'ordinary append is handled by the actual incremental owner');
 stacks.arrangeStacks(control.list,control.messages,{viewer:'reader'});
 assert.deepEqual(snapshot(f.list),snapshot(control.list),'DOM, folding, attribution, stars and dossier placement agree with the existing full owner');
});

// The actual app anchor functions run below the browser with a modeled hit
// test and geometry. Native CSS, input and performance remain Flex's proof.
const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
function geometry(count=2000){
 let calls=0,queries=0;const nodes=[],win={scrollY:300,addEventListener(){},scrollBy({top}){this.scrollY+=top;}};
 const node=(id,y,h=160)=>({dataset:{id,seq:String(nodes.length+1)},isConnected:true,hidden:false,y,h,children:[],contains(n){return n===this||this.children.includes(n);},getBoundingClientRect(){calls++;return {top:this.y-win.scrollY,bottom:this.y+this.h-win.scrollY,left:20,width:400,height:this.h};},getClientRects(){return this.hidden?[]:[this.getBoundingClientRect()];},compareDocumentPosition(n){return nodes.indexOf(n)>nodes.indexOf(this)?4:0;},closest(){return this;},querySelectorAll(){return [];}});
 for(let i=0;i<count;i++)nodes.push(node('m'+i,250+i*200));
 const list=node('list',100);list.contains=n=>nodes.includes(n);list.style={setProperty(){},removeProperty(){}};
 const main={contains:n=>nodes.includes(n)},home={contains:()=>false};
 const document={activeElement:null,documentElement:{scrollHeight:count*200},addEventListener(){},elementsFromPoint:()=>[nodes[0]],caretPositionFromPoint:()=>null};
 const views={messages:new Map(nodes.map(n=>[n.dataset.id,{id:n.dataset.id,topic_id:'t1',seq:Number(n.dataset.seq),author_id:'outside'}]))};
 const ctx=vm.createContext({window:win,document,innerHeight:800,innerWidth:600,Node:{DOCUMENT_POSITION_FOLLOWING:4,TEXT_NODE:3},inline:null,registry:{},retired:null,topicUnavailable:false,authorityReviewPending:()=>false,views,bootstrap:{actor:'reader'},topic:{id:'t1'},messageEntries:new Map(nodes.map(n=>[n.dataset.id,n])),typingField:()=>false,drawn:(l,id)=>nodes.some(n=>n.dataset.id===id&&!n.hidden),entries:()=>{queries++;throw Error('bounded capture must not enumerate loaded entries');},cardIn:n=>n,stackState:()=>({stacks:[]}),$:id=>({messages:list,main,'new-message-sheet':home})[id]});
 const cut=app.slice(app.indexOf('let roomy = null, listAnchor'),app.indexOf('// The New line, just below the oldest message'));
 vm.runInContext(cut+`;renderedNewest=${count};for(const entry of messageEntries.values())if(Number(entry.dataset.seq)<=3)visibleFeedEntries.add(entry);globalThis.anchor1229={captureListAnchor,restoreListAnchor,recordListArrivals,arrivalLayout,change:entry=>renderedChanges.push(entry)};`,ctx);
 return {ctx,api:ctx.anchor1229,nodes,node,list,main,document,win,views,calls:()=>calls,queries:()=>queries};
}
test('visible anchor geometry stays bounded as loaded history grows and holds an arriving row',()=>{
 for(const size of [30,2000]){const f=geometry(size),held=f.nodes[0],top=held.getBoundingClientRect().top,before=f.calls(),saved=f.api.captureListAnchor();
 assert.equal(saved.bounded,true);assert.ok(f.calls()-before<=6);assert.ok(saved.held.length<=2);assert.equal(f.queries(),0);
 const arrival=f.node('arrival',200,80);arrival.dataset.seq=String(size+1);f.nodes.unshift(arrival);f.ctx.messageEntries.set('arrival',arrival);f.views.messages.set('arrival',{id:'arrival',seq:size+1,topic_id:'t1',author_id:'outside'});f.api.change(arrival);for(const n of f.nodes)if(n!==arrival)n.y+=80;
 f.api.recordListArrivals(saved);f.api.restoreListAnchor(saved);assert.equal(held.getBoundingClientRect().top,top);assert.equal(f.queries(),0);}
});
test('bounded capture keeps actual writing and the visible successor when the first card vanishes',()=>{
 const f=geometry(),field=f.node('field',400);f.document.activeElement=field;f.ctx.inline={root:{contains:n=>n===field},field};f.ctx.registry={inline:{},isCurrent:()=>true};
 const saved=f.api.captureListAnchor(),top=field.getBoundingClientRect().top;field.y+=70;f.api.restoreListAnchor(saved);assert.equal(field.getBoundingClientRect().top,top,'writing is not mistaken for a message card');
 const g=geometry(),next=g.nodes[1],before=next.getBoundingClientRect().top,edge=g.api.captureListAnchor();g.nodes[0].hidden=true;next.y+=55;g.api.restoreListAnchor(edge);assert.equal(next.getBoundingClientRect().top,before,'first hidden hands its hold to the actual visible successor');
});
