// Actual app/StackFeed/renderer owners; modeled DOM/events, no native gestures
// or selection geometry. RPC fixtures return explicit receipts, never Core proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { Element } from './fixtures/mini_dom.mjs';
import { StackFeed } from '../web/stack-feed.mjs';
import { entries, stackState, reveal, headClick, forgetStackMessages, checkDossierNew } from '../web/reply-stacks.mjs';
import { Marks, paintAuthor, carriesOf, paintNoteCorner } from '../web/marks.mjs';
import { cardIn, opened, paintFold, paintOwnNoteFold } from '../web/fold.mjs';
import { newestNew } from '../web/stack-order.mjs';
import { VisitNew, paintVisitNew } from '../web/visit-new.mjs';
import { readNow, paintReading, paintAwaiting, learnAnswered, agentTalk } from '../web/card-reading.mjs';
import { paintWithdrawal } from '../web/question-withdrawal.mjs';
import { paintRemoval } from '../web/message-removal.mjs';
import { paintWhisperAuthor } from '../web/whisper-choice.mjs';
import { paintAsksYou } from '../web/outcome-conversation.mjs';
import { revisionOf, wasEdited } from '../web/message-edit-writing.mjs';
import { messageUpdateActivity, messageUpdateHost } from '../web/cover-refresh.mjs';
import { captureArchivedNew } from '../web/archive-new.mjs';
const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const slice=(a,b)=>{const x=app.indexOf(a),y=app.indexOf(b,x+a.length);assert.ok(x>=0&&y>x,'actual app block exists');return app.slice(x,y);};
const event=(target,more={})=>({target,preventDefault(){},stopPropagation(){},...more});
Element.prototype.click=function(){return this.onclick?.(event(this));};
function sorts(work){const original=Array.prototype.sort;let dossiers=0;Array.prototype.sort=function(...args){if(this.length>1&&this.every(x=>x?.head&&Array.isArray(x.replies)))dossiers++;return original.apply(this,args);};try{work();return dossiers;}finally{Array.prototype.sort=original;}}
const message=(id,seq,root=id,extra={})=>({id,seq,topic_id:'isolated1265',author_id:'writer',author_kind:'agent',body:'Exact '+id,reply_to:id===root?null:root,unread:true,revision:1,acts:{},yours:{},stack_position:{root_id:root,order_key:root==='a'?30:root==='b'?20:10,order_tie:seq,level:'open',level_revision:0,at:{messages:seq,acts:0}},...extra});
const records=()=>[message('a',1),message('a2',2,'a'),message('b',3),message('b2',4,'b'),message('c',5),message('c2',6,'c')];
function fixture(t,items=records()){
 const r=renderer799('reader'),doc=r.list.ownerDocument,previous=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=previous;});doc.body=doc.createElement('body');doc.visibilityState='visible';doc.hasFocus=()=>true;doc.getSelection=()=>({isCollapsed:true});r.list.id='messages';r.add(items);for(const item of items)r.messages.set(item.id,item);
 const calls=[],openedIds=new Set(),visit=new VisitNew('reader'),marked=new Set(),unread=item=>!readNow(item,{viewer:'reader',opened:openedIds.has(item.id),marked:marked.has(item.id)})||visit.has(item.id);
 const state=stackState(r.list);for(const root of ['a','b','c'])state.levels.set(root,'open');
 const feed=Object.assign(Object.create(StackFeed.prototype),{list:r.list,doc,messages:()=>r.messages,viewer:'reader',pending:new Map(),standIns:new Map(),drawn:new Map(),made:new WeakMap(),makes:0,headerStars:new Set(),keep:unread,unread,nameOf:id=>id,quiet:()=>false,colorOf:()=>null,hold:fn=>fn(),redrawn(){},moreChanged(){},arranged(){calls.push('arranged');},paintCoordination(){},newest:(stack,node)=>calls.push(['new',stack,node]),starDossier:stack=>calls.push(['star',stack]),startRename:stack=>calls.push(['rename',stack])});
 let arrangements=0;const arrange=feed.arrange.bind(feed);feed.arrange=()=>{arrangements++;return arrange();};feed.arrange();
 const update=ids=>typeof feed.updateReading==='function'?feed.updateReading(ids):feed.arrange();
 return {...r,doc,state,feed,calls,openedIds,visit,marked,unread,update,arrangements:()=>arrangements,section:id=>state.sections.get(id),entry:id=>entries(r.list).find(e=>e.dataset.id===id)};
}
function appFixture(t,options={}){
 const f=fixture(t),queue=[],sent=[],ports={};let serial=0;const pin={authority_id:'authority',authority_epoch:1};
 const api={command:async envelope=>{sent.push(structuredClone(envelope));if(ports.refuse)return{recorded:true,operation_id:envelope.operation_id,status:'rejected'};return{recorded:true,operation_id:envelope.operation_id,status:'committed',instance_id:'isolated',result:envelope.kind==='message.mark'?{message_id:envelope.target.message_id,mark_revision:envelope.expected.mark_revision+1,topic_id:'isolated1265'}:{topic_id:'isolated1265',from_seq:envelope.args.from_seq,seq:envelope.args.seq}};}};
 const marks=new Marks({api,instanceId:'isolated',authority:()=>pin,doc:f.doc,win:{}});
 const main={inert:false},readerDialog={open:false},context={views:{messages:f.messages,topicId:'isolated1265'},topic:{id:'isolated1265'},retired:false,listAccessEpoch:1,topicUnavailable:false,registry:{disposed:false,runtime:{current:pin}},pressHold:{down:false},authorityReviewPending:()=>false,
 visitNew:f.visit,marks,document:f.doc,bootstrap:{actor:'reader',actor_kind:'human',instance_id:'isolated'},queueMicrotask:fn=>queue.push(fn),keepListAnchor:fn=>fn(),
 $:id=>id==='messages'?f.list:id==='main'?main:id==='reader'?readerDialog:f.doc.byId(id),entries,cardIn,opened,reveal,stackState,stackFeed:f.feed,feedOf:()=>f.feed,feedMessages:()=>f.messages,
 paintReading,paintAwaiting,paintFold,paintOwnNoteFold,paintNoteCorner,learnAnswered,readNow,agentTalk,newestNew,readerItem:()=>null,whisperPeople:()=>({kindOf:()=> 'agent'}),goToMessage(){},run:fn=>fn(),openSource(){},
 messageEntries:new Map([...f.messages.keys()].map(id=>[id,f.entry(id)])),paintAuthor,displayActor:id=>id,wasEdited,carriesOf,paintWithdrawal,paintRemoval,paintWhisperAuthor,paintAsksYou,
 cardScroll:{showFull:async()=>true,revisions:new Map(),wholes:new Set(),strikes:new Map()},messageChanges:null,toggleMessageChanges(){},here:null,
 messageUpdateActivity,messageUpdateHost,updateContext:()=>({viewer:'reader',nameOf:id=>id}),paintVisitNew,reader:null,visitNew:f.visit,
 revisionOf,captureArchivedNew,attention:{refresh(){}},commitReload:null,paintReaderMark(){},marksWords:n=>String(n),
 releaseTopArrivals(){},revealSelection(){},menu:{light(){},paintMessage(){},paint(){},},onScreen:()=>true,api,crypto:{randomUUID:()=> 'read-'+ ++serial},checkDossierNew,
 stackMessages:()=>f.feed.arrange(),paintReaderThumb$(){},...ports};
 const markStart=app.includes('const paintedMarkStates =')?'const paintedMarkStates =':'function paintMarks() {';
 const code=slice('const openedIds = new Set();','// Local pending feedback')+slice('function paintMessageUpdates(', '// Generated context')+slice('function paintCardAuthor(', '// Who the composers may whisper to')+slice(markStart,'// "Start a topic from this"')+slice('const dossierNewFlights =','// A message a link on the page names')+slice('function paintThumbMessage(', '// A message the page shows');
 vm.createContext(context);vm.runInContext(code+';globalThis.owner={captureArchiveReading,clearVisitNew,openedHere,paintMarks,paintThumbMessage,openDossierNew,openedIds,paintReadChanges:typeof paintReadChanges===\'function\'?paintReadChanges:null};',context);
 // The real unread provider reads current page state and Marks for every call.
 f.feed.unread=item=>vm.runInContext('newOnPage',context)(item);f.feed.keep=f.feed.unread;f.feed.arrange();
 return {...f,context,owner:context.owner,queue,sent,marks,ports,flush:()=>{while(queue.length)queue.shift()();}};
}

test('1265 one read repaints its actual folder without global dossier sort or unrelated writes',t=>{
 const f=fixture(t),b=f.section('b'),c=f.section('c'),before=[...f.list.children],nodes=[...b.descendants()],arranged=f.arrangements();let writes=0;
 for(const node of [b,...nodes,c,...c.descendants()])for(const method of ['append','prepend','replaceChildren','insertBefore','remove']){const call=node[method];node[method]=function(...args){writes++;return call.apply(this,args);};}
 f.openedIds.add('a');const count=sorts(()=>f.update(['a']));assert.equal(f.arrangements(),arranged);assert.equal(count,0);assert.equal(writes,0);assert.deepEqual(f.list.children,before);assert.deepEqual([...b.descendants()],nodes);assert.equal(f.section('a').querySelector('.stack-new'),null);assert.ok(f.section('a').querySelector('.stack-fresh'));
});
test('1265 two distinct clears in one app microtask update both current dossiers',t=>{
 const f=appFixture(t);for(const item of f.messages.values())item.unread=false;f.visit.arrive([f.messages.get('a'),f.messages.get('b')]);f.feed.arrange();const before=f.arrangements();
 f.owner.clearVisitNew('a');f.owner.clearVisitNew('b');assert.equal(f.queue.length,1);const count=sorts(f.flush);assert.equal(f.arrangements(),before);assert.equal(count,0);assert.equal(f.section('a').querySelector('.stack-new-action'),null);assert.equal(f.section('b').querySelector('.stack-new-action'),null);
});
for(const change of ['epoch','views','retired','disposed','access'])test('1265 queued read paint rejects stale '+change+' without action or resurrection',t=>{
 const f=appFixture(t);f.visit.arrive([f.messages.get('a')]);const before=f.arrangements();f.owner.clearVisitNew('a');if(change==='epoch')f.context.listAccessEpoch++;if(change==='views')f.context.views={messages:new Map()};if(change==='retired')f.context.retired=true;if(change==='disposed')f.context.registry.disposed=true;if(change==='access')f.context.topicUnavailable=true;f.flush();assert.equal(f.arrangements(),before);
});
test('1265 a newer-page batch survives the stale batch microtask',t=>{
 const f=appFixture(t);for(const item of f.messages.values())item.unread=false;f.visit.arrive([f.messages.get('a'),f.messages.get('b')]);f.feed.arrange();f.owner.clearVisitNew('a');f.context.listAccessEpoch++;f.owner.clearVisitNew('b');assert.equal(f.queue.length,2);f.flush();assert.equal(f.section('b').querySelector('.stack-new'),null);
});
for(const kind of ['key','tie','place','join','withdrawal','member','replacement'])test('1265 real '+kind+' change uses ordinary current arrangement',t=>{
 const f=fixture(t),before=f.arrangements(),a=f.messages.get('a');
 if(kind==='key'){a.stack_position.order_key=-10;a.stack_position.at={messages:2,acts:1};}if(kind==='tie')a.stack_position.order_tie=99;if(kind==='place')a.acts={placed:-10};if(kind==='join')a.acts={joined:{into:'b',by:'writer'}};if(kind==='withdrawal')a.withdrawal={by:'writer'};
 if(kind==='member'){const next=message('new',7,'a');f.add([next]);f.messages.set(next.id,next);}
 if(kind==='replacement'){const old=f.entry('a');const node=f.doc.createElement('button');Object.assign(node.dataset,old.dataset);node.className=old.className;node.append(f.doc.createElement('span'));old.parentElement.insertBefore(node,old);old.remove();}
 const count=sorts(()=>f.update(['a']));assert.ok(f.arrangements()>before);assert.ok(count>0);if(kind==='key')assert.equal(f.state.stacks.at(-1).id,'a');
});
test('1265 unread mark and mark removal keep real app counts and target header current',t=>{
 const f=appFixture(t);for(const item of f.messages.values())item.unread=false;f.owner.paintMarks();f.flush();const before=f.arrangements();f.marks.learn('a',1,{topicId:'isolated1265',seq:1});f.owner.paintMarks();f.flush();assert.ok(f.section('a').querySelector('.stack-new'));assert.equal(f.doc.byId('topic-marks-words').textContent,'1');f.marks.learn('a',2,{topicId:'isolated1265',seq:1});f.owner.paintMarks();f.flush();assert.equal(f.section('a').querySelector('.stack-new-action'),null);assert.equal(f.arrangements(),before);
});
for(const key of ['Enter',' '])test('1265 retained New/Star '+JSON.stringify(key)+' uses current source after a read-only replacement',t=>{
 const f=fixture(t),row=f.section('a').querySelector('.stack-head'),star=row.querySelector('.stack-star'),fresh=row.querySelector('.stack-new-action'),current={...f.messages.get('a'),unread:false};f.messages.set('a',current);f.update(['a']);const newMark=row.querySelector('.stack-new-action');assert.equal(row.querySelector('.stack-star'),star);star.onkeydown(event(star,{key}));newMark.onkeydown(event(newMark,{key}));assert.equal(f.calls.at(-2)[1].head,current);assert.equal(f.calls.at(-1)[1].head,current);assert.equal(fresh.isConnected,false);
});
for(const pointerType of ['mouse','touch'])test('1265 real dossier New '+pointerType+' receipt clears selected card without sorting unrelated dossiers',async t=>{
 const f=appFixture(t);f.visit.arrive([f.messages.get('a')]);const before=f.arrangements(),row=f.section('a').querySelector('.stack-head'),mark=row.querySelector('.stack-new-action');let task;f.feed.newest=(stack,node)=>(task=f.owner.openDossierNew(stack,node));headClick(f.list,f.entry('a'),event(mark,{pointerType}));assert.ok(task);await task;f.flush();assert.equal(f.sent[0].kind,'topic.read_through');assert.equal(f.sent[0].args.seq,2);assert.equal(f.owner.openedIds.has('a2'),true);assert.equal(f.arrangements(),before);
});
test('1265 refused dossier New keeps the unread state and later exact writing',async t=>{
 const f=appFixture(t),writing=f.doc.createElement('textarea');writing.value='Later exact writing';f.list.append(writing);f.context.api.command=async envelope=>{f.sent.push(envelope);return{recorded:true,operation_id:envelope.operation_id,status:'rejected'};};await assert.rejects(f.owner.openDossierNew(f.state.stacks[0],f.section('a').querySelector('.stack-new-action')),/Reading this message was not confirmed/);assert.equal(f.sent.length,1);assert.equal(f.owner.openedIds.size,0);assert.equal(writing.value,'Later exact writing');assert.equal(f.section('a').querySelector('.stack-new').textContent,'New');
});
test('1265 pending thumb is local, confirmed thumb updates read state, taking it back stays read',t=>{
 const f=appFixture(t),before=f.arrangements();f.owner.paintThumbMessage('a',true);assert.equal(f.arrangements(),before);f.messages.get('a').reactions={version:1,thumbs:['reader'],answers:[],thumb_revision:1,answer_revision:0};f.owner.paintThumbMessage('a',false);assert.equal(f.section('a').querySelector('.stack-new'),null);f.messages.get('a').reactions={version:2,thumbs:[],answers:[],thumb_revision:2,answer_revision:0};f.owner.paintThumbMessage('a',false);assert.equal(f.section('a').querySelector('.stack-new'),null);assert.equal(f.arrangements(),before);
});
test('1265 Only new/folded rows update within affected folder and retain focused controls/images/writing',t=>{
 const f=fixture(t),section=f.section('a'),other=f.section('b'),name=other.querySelector('.stack-name'),image=f.doc.createElement('img'),writing=f.doc.createElement('textarea');writing.value='Later writing';f.entry('a').append(image,writing);f.entry('a').setAttribute('data-card-reply','true');f.state.only=f.unread;f.feed.arrange();name.focus();const before=f.arrangements();f.openedIds.add('a');f.openedIds.add('a2');f.update(['a','a2']);assert.equal(section.dataset.empty,'true');assert.equal(f.section('b'),other);assert.equal(f.doc.activeElement,name);assert.equal(image.isConnected,true);assert.equal(writing.value,'Later writing');assert.equal(f.arrangements(),before);
});
test('1265 retired list cannot run a former action; window retirement invalidates its reading frame',t=>{
 const f=fixture(t),oldStar=f.section('a').querySelector('.stack-star');f.messages.delete('a2');f.entry('a2').remove();forgetStackMessages(f.list,new Set(f.messages.keys()));const before=f.arrangements();f.update(['a']);assert.ok(f.arrangements()>before);f.list.root=false;f.list.remove();const after=f.arrangements();f.update(['a']);assert.equal(f.arrangements(),after);const calls=f.calls.length;oldStar.onclick(event(oldStar));assert.equal(f.calls.length,calls);
});

for(const id of ['a','b2'])test('1265 individual Reader/opened read '+id+' paints only its dossier',t=>{
 const f=appFixture(t),before=f.arrangements(),other=f.section('c'),nodes=[...other.descendants()];f.owner.openedHere(id);assert.equal(f.owner.openedIds.has(id),true);const count=sorts(f.flush);assert.equal(count,0);assert.equal(f.arrangements(),before);assert.deepEqual([...other.descendants()],nodes);assert.equal(f.entry(id).dataset.read,'');assert.equal(f.entry(id).dataset.unread,undefined);
});
test('1265 confirmed archive read projection updates only captured dossier read/New presentation',t=>{
 const f=appFixture(t),before=f.arrangements(),other=f.section('b');const apply=f.owner.captureArchiveReading('a',2);assert.equal(apply(),true);assert.equal(f.messages.get('a').unread,false);assert.equal(f.messages.get('a2').unread,false);assert.equal(f.section('a').querySelector('.stack-new-action'),null);assert.equal(f.section('b'),other);assert.equal(f.arrangements(),before);assert.equal(apply(),false);
});
test('1265 a late New receipt after page epoch changes cannot clear or steal later writing',async t=>{
 const f=appFixture(t),writing=f.doc.createElement('textarea');writing.value='Later writing';f.list.append(writing);let release;
 f.context.api.command=envelope=>new Promise(resolve=>{f.sent.push(envelope);release=()=>resolve({recorded:true,operation_id:envelope.operation_id,status:'committed',result:{topic_id:'isolated1265',from_seq:envelope.args.from_seq,seq:envelope.args.seq}});});
 const pending=f.owner.openDossierNew(f.state.stacks[0],f.section('a').querySelector('.stack-new-action'));for(let n=0;n<6&&!release;n++)await Promise.resolve();assert.equal(typeof release,'function');f.context.listAccessEpoch++;writing.focus();release();await pending;f.flush();assert.equal(f.owner.openedIds.size,0);assert.equal(writing.value,'Later writing');assert.equal(f.doc.activeElement,writing);
});

test('1265 hidden source-root title refresh keeps its current head without sorting',t=>{
 const items=records();items[0]={...items[0],author_id:'reader',intent:'ask',withdrawal:{by:'reader'},acts:{name:{text:'Hidden root',by:'writer'}}};const f=fixture(t,items),stack=f.state.stacks.find(s=>s.dossier==='a');assert.equal(stack.id,'a2');const before=f.arrangements();f.messages.set('a',{...f.messages.get('a'),acts:{name:{text:'Renamed root',by:'writer'}}});assert.equal(sorts(()=>f.update(['a2'])),0);assert.equal(f.arrangements(),before);assert.equal(f.section('a2').querySelector('.stack-name').textContent,'Renamed root');
});

test('1265 current name and cover repaint within the affected folder without sorting',t=>{
 const f=fixture(t),before=f.arrangements(),other=f.section('b');f.messages.get('a').acts={name:{text:'Current dossier',by:'writer'},cover:{stands:'Changed current cover',waiting:[],revision:1}};assert.equal(sorts(()=>f.update(['a'])),0);assert.equal(f.arrangements(),before);assert.equal(f.section('b'),other);assert.equal(f.section('a').querySelector('.stack-name').textContent,'Current dossier');assert.equal(f.section('a').querySelector('.cover-stands').textContent,'Changed current cover');
});

test('1265 a position observation clock change selects the genuine current key',t=>{
 const items=records();items[0].stack_position.order_key=-10;const f=fixture(t,items),before=f.arrangements();assert.equal(f.state.stacks[0].id,'a');f.messages.get('a').stack_position.at={messages:2,acts:1};f.update(['a']);assert.ok(f.arrangements()>before);assert.equal(f.state.stacks.at(-1).id,'a');
});

test('1265 an own withdrawn head uses ordinary reheading and retires its old action',t=>{
 const items=records();items[0]={...items[0],author_id:'reader',intent:'ask'};const f=fixture(t,items),before=f.arrangements(),oldStar=f.section('a').querySelector('.stack-star');f.messages.get('a').withdrawal={by:'reader'};f.update(['a']);assert.ok(f.arrangements()>before);assert.equal(f.state.stacks.find(s=>s.dossier==='a').id,'a2');const calls=f.calls.length;oldStar.onclick(event(oldStar));assert.equal(f.calls.length,calls);
});

test('1265 read paint preserves the selected body node and the later writing value',t=>{
 const f=appFixture(t),body=f.entry('a').querySelector('.message-preview'),writing=f.doc.createElement('textarea');assert.ok(body);writing.value='Exact later writing';f.entry('a').append(writing);const selection={isCollapsed:false,anchorNode:body,focusNode:body,anchorOffset:1,focusOffset:3};f.doc.getSelection=()=>selection;f.owner.openedHere('a');f.flush();assert.equal(f.entry('a').querySelector('.message-preview'),body);assert.equal(f.doc.getSelection(),selection);assert.equal(writing.value,'Exact later writing');assert.equal(writing.isConnected,true);
});

test('1265 a loaded supplemental root reads through the current feed provider, not only canonical page records',t=>{
 const f=appFixture(t);const canonical=new Map(f.messages);canonical.delete('a');f.context.views.messages=canonical;const before=f.arrangements();f.owner.openedHere('a');f.flush();assert.equal(f.entry('a').dataset.read,'');assert.equal(f.section('a').querySelector('.stack-new'),null);assert.equal(f.arrangements(),before);
});
