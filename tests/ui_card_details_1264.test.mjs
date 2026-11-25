// Actual painters, stack renderer and bounded app/menu owners. Synthetic
// DOM/events model their contracts; native gestures/ranges/speed are separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { Element } from './fixtures/mini_dom.mjs';
import { replyLine, paintReplyLine } from '../web/replies.mjs';
import { paintRemoval } from '../web/message-removal.mjs';
import { paintWhisperAuthor } from '../web/whisper-choice.mjs';
import { paintAsksYou } from '../web/outcome-conversation.mjs';
import { paintAuthor, carriesOf } from '../web/marks.mjs';
import { paintWithdrawal } from '../web/question-withdrawal.mjs';
import { wasEdited, revisionOf } from '../web/message-edit-writing.mjs';
import { messageUpdateActivity, messageUpdateHost } from '../web/cover-refresh.mjs';
import { arrangeStacks, stackState, headClick, paintHeadCarries, paintHeadReading, checkDossierNew, entryOf } from '../web/reply-stacks.mjs';
import { paintPendingSends, adoptPendingSend } from '../web/pending-sends.mjs';
import { openLinksWith } from '../web/links.mjs';
import { cardIn } from '../web/fold.mjs';
import { menuDoor } from '../web/outline-menus.mjs';
import { clock, repaintTimes } from '../web/times.mjs';
const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
Element.prototype.click = function() { return this.onclick?.(event(this)); };
const event = (target, extra={}) => ({ target, preventDefault(){this.prevented=true;}, stopPropagation(){this.stopped=true;}, ...extra });
const slice = (start,end) => { const a=app.indexOf(start),b=app.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,'actual app owner exists');return app.slice(a,b); };
const removal={kind:'retracted',by:'writer',at_ms:1795620000000};
const item=(id='root',seq=1,extra={})=>({id,seq,topic_id:'isolated-1264',author_id:'writer',author_kind:'agent',body:'Exact opening\nCurrent suffix',reply_to:null,acts:{},yours:{},sent_ms:1795610000000,revision:1,...extra});
function fixture(t, items=[item(),item('reply',2,{reply_to:'root',author_id:'other'})], options={}) {
 const r=renderer799('reader'),doc=r.list.ownerDocument,previous=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=previous;});
 r.list.id='messages';doc.querySelectorAll=selector=>r.list.querySelectorAll(selector);r.add(items);
 for(const record of items)r.messages.set(record.id,record);
 const state=stackState(r.list),calls=[];state.levels.set('root','open');
 const on={star:stack=>calls.push(['star',stack]),newest:(stack,node)=>calls.push(['new',stack,node]),rename:stack=>calls.push(['rename',stack]),...options.on};
 const draw=(changed={})=>arrangeStacks(r.list,r.messages,{doc,viewer:'reader',unread:m=>m.fresh===true,nameOf:id=>'Name '+id,on,...options,...changed});draw();
 const entry=id=>r.list.querySelectorAll('[data-id]').find(n=>n.dataset.id===id);
 const row=()=>r.list.querySelector('.stack-head');
 return {...r,doc,state,calls,on,draw,entry,row};
}
function spy(node) {
 const counts={remove:0,replaceChildren:0,append:0,prepend:0,insertBefore:0,text:0};
 for(const name of ['remove','replaceChildren','append','prepend','insertBefore']){const original=node[name];node[name]=function(...args){counts[name]++;return original.apply(this,args);};}
 let words=node.textContent;Object.defineProperty(node,'textContent',{configurable:true,get:()=>words,set:value=>{counts.text++;words=value;}});
 return counts;
}
const noWrites=(counts,label)=>assert.deepEqual(counts,{remove:0,replaceChildren:0,append:0,prepend:0,insertBefore:0,text:0},label);
function authorFixture(t, data=item()) {
 const f=fixture(t,[data]),card=cardIn(f.entry(data.id)),author=card.querySelector('.message-author');
 const env={messageEntries:new Map([[data.id,card]]),cardScroll:null,messageChanges:null,toggleMessageChanges(){},revisionOf,
 paintAuthor,displayActor:id=>id,marks:null,wasEdited,carriesOf,paintWithdrawal,paintRemoval,document:f.doc,here:{conversation:true,view:{waits:[]}},
 bootstrap:{actor:'reader'},paintWhisperAuthor,paintAsksYou,stackFeed:null,messageUpdateActivity,updateContext:()=>({nameOf:id=>id,topicId:data.topic_id}),messageUpdateHost,cardIn,paintVisitNew(){},visitNew:null};
 const code=slice('function paintCardAuthor(', '// Who the composers may whisper to');
 const paint=new Function(...Object.keys(env),code+';return paintCardAuthor;')(...Object.values(env));
 return {...f,card,author,env,paint};
}

test('1264 unchanged reply context keeps original text/link nodes without structural writes',t=>{
 const f=fixture(t),line=f.doc.createElement('span');line.root=true;
 const message=item('child',3,{reply_to:'parent',reply_to_author:'writer',reply_to_excerpt:'Exact https://example.test/parent words'});
 paintReplyLine(line,message,{viewer:'reader'});const children=[...line.children],link=line.querySelector('a'),counts=spy(line);assert.ok(link);
 paintReplyLine(line,{...message},{viewer:'reader',parent:{id:'parent'}});
 assert.deepEqual(line.children,children);assert.equal(line.querySelector('a'),link);noWrites(counts,'unchanged reply keeps selected words/links');
});
test('1264 reply facts change current excerpt/link/retraction and retire a missing parent context',t=>{
 const f=fixture(t),line=f.doc.createElement('span');line.root=true;
 let message=item('child',3,{reply_to:'parent',reply_to_author:'writer',reply_to_excerpt:'Old https://example.test/old'});
 paintReplyLine(line,message);message={...message,reply_to_author:'new writer',reply_to_excerpt:'New https://example.test/new words',reply_to_removal:removal};paintReplyLine(line,message);
 assert.match(line.text,/Replying to new writer: New/);assert.equal(line.querySelector('a').href,'https://example.test/new');assert.ok(line.querySelector('.reply-parent-words').classList.contains('retracted-words'));assert.equal(line.querySelector('time').dataset.ms,String(removal.at_ms));
 paintReplyLine(line,{...message,reply_to:null});assert.equal(line.children.length,0);
});
test('1264 withdrawn own-parent context hides the old excerpt on changed access projection',t=>{
 const f=fixture(t),line=f.doc.createElement('span'),message=item('child',3,{reply_to:'parent',reply_to_author:'reader',reply_to_excerpt:'Private old question'});
 paintReplyLine(line,message,{viewer:'reader'});paintReplyLine(line,message,{viewer:'reader',parent:{intent:'ask',author_id:'reader',withdrawal:{by:'reader'}}});
 assert.equal(line.text,'Replying to reader');assert.equal(line.querySelector('.reply-parent-words'),null);
});
test('1264 unchanged Retracted marker and time keep nodes and day-owner updates the same time',t=>{
 const f=fixture(t),line=f.doc.createElement('span');f.list.append(line);paintRemoval(line,{removal},f.doc);
 const label=line.querySelector('.message-retracted'),time=label.querySelector('time'),counts=spy(label);
 paintRemoval(line,{removal:{...removal}},f.doc);assert.equal(line.querySelector('time'),time);noWrites(counts,'retracted time/range stays');
 const before=clock.now;clock.now=()=>removal.at_ms+86400000;t.after(()=>{clock.now=before;});repaintTimes(f.doc);assert.equal(line.querySelector('time'),time);assert.match(time.textContent,/Yesterday/);
});
test('1264 changed Retracted timestamp/position updates; terminal absence removes marker',t=>{
 const f=fixture(t),line=f.doc.createElement('span');line.root=true;paintRemoval(line,{removal},f.doc);
 paintRemoval(line,{removal:{...removal,at_ms:removal.at_ms+1000}},f.doc,true);assert.equal(line.querySelector('time').dataset.ms,String(removal.at_ms+1000));assert.match(line.text,/^Retracted/);
 paintRemoval(line,{removal:{kind:'unsent'}},f.doc);assert.equal(line.querySelector('.message-retracted'),null);
});
test('1264 unchanged whisper audience/wait and accessibility text preserve selected nodes',t=>{
 const f=fixture(t),card=f.doc.createElement('div'),author=f.doc.createElement('span');card.className='message-card';card.root=true;card.append(author);
 const message=item('private',3,{whisper:true,private_to:'reader',no_answer:true});paintWhisperAuthor(author,message,'reader',f.doc);
 const label=author.querySelector('.whisper-label'),wait=author.querySelector('.whisper-wait'),counts=spy(label),waitCounts=spy(wait),spoken=card.getAttribute('aria-label');
 paintWhisperAuthor(author,{...message},'reader',f.doc);assert.equal(author.querySelector('.whisper-label'),label);assert.equal(author.querySelector('.whisper-wait'),wait);assert.equal(card.getAttribute('aria-label'),spoken);noWrites(counts,'audience retained');noWrites(waitCounts,'wait retained');
});
test('1264 changed whisper audience/viewer/wait/body refreshes current accessible values',t=>{
 const f=fixture(t),card=f.doc.createElement('div'),author=f.doc.createElement('span');card.className='message-card';card.root=true;card.append(author);
 paintWhisperAuthor(author,item('private',3,{whisper:true,private_to:'reader',no_answer:true}),'reader',f.doc);
 paintWhisperAuthor(author,item('private',3,{whisper:true,private_to:'different',no_answer:false,body:'New exact body'}),'reader',f.doc);
 assert.equal(author.querySelector('.whisper-label').textContent,' · whisper to different');assert.equal(author.querySelector('.whisper-wait'),null);assert.match(card.getAttribute('aria-label'),/different.*New exact body/);
});
test('1264 unchanged Asks you keeps its label; changed wait/reader removes it',t=>{
 const f=fixture(t),author=f.doc.createElement('span'),message=item('ask'),wait={on:'reader',ask_message_id:'ask'};author.root=true;
 paintAsksYou(author,message,[wait],'reader',f.doc);const label=author.querySelector('.asks-you'),counts=spy(label);
 paintAsksYou(author,{...message},[{...wait}],'reader',f.doc);assert.equal(author.querySelector('.asks-you'),label);noWrites(counts,'asks label stays');
 paintAsksYou(author,message,[wait],'other',f.doc);assert.equal(author.querySelector('.asks-you'),null);
});
for(const terminal of ['resolved','superseded','withdrawn','removed'])test('1264 terminal '+terminal+' cannot revive Asks you from stale waits',t=>{
 const f=fixture(t),author=f.doc.createElement('span'),message=item('ask'),wait=[{on:'reader',ask_message_id:'ask'}];author.root=true;
 paintAsksYou(author,message,wait,'reader',f.doc);assert.ok(author.querySelector('.asks-you'));
 const current=terminal==='removed'?{...message,removal}:{...message,question:{state:terminal}};paintAsksYou(author,current,wait,'reader',f.doc);assert.equal(author.querySelector('.asks-you'),null);
});
test('1264 actual card-author repaint preserves details across unchanged and changed core facts; images stay',t=>{
 const message=item('private',1,{whisper:true,private_to:'reader',no_answer:true,removal}),f=authorFixture(t,message);
 f.paint(f.author,message);const label=f.author.querySelector('.whisper-label'),wait=f.author.querySelector('.whisper-wait'),removed=f.author.querySelector('.message-retracted'),time=removed.querySelector('time');
 const image=f.doc.createElement('img');f.card.append(image);const counts=[spy(label),spy(wait),spy(removed)];
 f.paint(f.author,{...message});for(const c of counts)noWrites(c,'unchanged detail');
 f.paint(f.author,{...message,author_id:'new author',sent_ms:message.sent_ms+1000});
 assert.equal(f.author.querySelector('.whisper-label'),label);assert.equal(f.author.querySelector('.whisper-wait'),wait);assert.equal(f.author.querySelector('.message-retracted'),removed);assert.equal(removed.querySelector('time'),time);assert.equal(image.parentElement,f.card);assert.equal(image.isConnected,true);
 for(const c of counts)assert.equal(c.remove,0,'core author changes never detach retained details');
});
test('1264 actual card-author removal/withdrawal clears the prior Asks you label',t=>{
 const message=item('ask'),f=authorFixture(t,message);f.env.here.view.waits=[{on:'reader',ask_message_id:'ask'}];f.paint(f.author,message);assert.ok(f.author.querySelector('.asks-you'));
 f.paint(f.author,{...message,withdrawal:{by:'reader'}});assert.equal(f.author.querySelector('.asks-you'),null);
});
function titleFixture(t,extra={}) {
 const records=[item('root',1,{fresh:true,attachments:[{content_type:'image/png'}],acts:{name:{text:'Exact dossier',by:'writer',minted:true}},...extra}),item('reply',2,{reply_to:'root',fresh:true,author_id:'other'})];return fixture(t,records);
}
test('1264 unchanged dossier title/count/marks/New/Star/hide keep every component and focused text',t=>{
 const f=titleFixture(t),row=f.row(),nodes=[...row.descendants()],parts=nodes.filter(n=>n.classList.contains('stack-name')||n.classList.contains('stack-meta')||n.classList.contains('stack-count')||n.classList.contains('stack-who')||n.classList.contains('stack-pen')||n.classList.contains('stack-star')||n.classList.contains('card-carries')||n.classList.contains('stack-named')||n.classList.contains('stack-new-action')||n.classList.contains('stack-hide'));
 assert.ok(parts.length>=10);const counts=parts.map(spy),star=row.querySelector('.stack-star');star.focus();f.draw();assert.deepEqual([...row.descendants()],nodes);assert.equal(f.doc.activeElement,star);for(const c of counts)noWrites(c,'unchanged title component has zero structural/text writes');
});
test('1264 title changed facts refresh current visible/accessibility values and dropped components',t=>{
 const f=titleFixture(t),row=f.row(),root=f.messages.get('root');f.messages.set('root',{...root,fresh:false,author_id:'new writer',attachments:[],acts:{starred:true,name:{text:'New dossier',by:'other'}}});f.messages.set('reply',{...f.messages.get('reply'),fresh:false});f.draw();
 assert.equal(row.querySelector('.stack-name').textContent,'New dossier');assert.equal(row.querySelector('.stack-who').textContent,'Name new writer');assert.equal(row.querySelector('.stack-star').getAttribute('aria-label'),'Unstar');assert.equal(row.querySelector('.card-carries'),null);assert.equal(row.querySelector('.stack-named'),null);assert.equal(row.querySelector('.stack-new-action'),null);
});
for(const key of ['Enter',' '])test('1264 current Star/New keyboard '+JSON.stringify(key)+' binding after an unchanged repaint',t=>{
 const f=titleFixture(t),row=f.row(),star=row.querySelector('.stack-star'),fresh=row.querySelector('.stack-new-action');const current={...f.messages.get('root'),body:'Exact opening\nUpdated source suffix',revision:2};f.messages.set('root',current);f.draw();
 assert.equal(row.querySelector('.stack-star'),star);assert.equal(row.querySelector('.stack-new-action'),fresh);star.onkeydown(event(star,{key}));fresh.onkeydown(event(fresh,{key}));assert.equal(f.calls[0][0],'star');assert.equal(f.calls[0][1].head,current);assert.equal(f.calls[1][0],'new');assert.equal(f.calls[1][1].head,current);
});
test('1264 pointer click/tap title controls use current callback/stack; later refusal is not cached',t=>{
 const f=titleFixture(t),row=f.row(),star=row.querySelector('.stack-star'),fresh=row.querySelector('.stack-new-action');let allowed=true,acted=0;
 const on={...f.on,star:stack=>{if(allowed){acted++;assert.equal(stack.head,f.messages.get('root'));}}};f.draw({on});star.onclick(event(star,{pointerType:'mouse'}));allowed=false;star.onclick(event(star,{pointerType:'touch'}));assert.equal(acted,1);
 headClick(f.list,f.entry('root'),event(fresh,{pointerType:'touch'}));assert.equal(f.calls.at(-1)[0],'new');assert.equal(f.calls.at(-1)[1].head,f.messages.get('root'));
});
test('1264 removed or retired title controls cannot call their previous keyboard/action binding',t=>{
 const f=titleFixture(t),row=f.row(),fresh=row.querySelector('.stack-new-action'),star=row.querySelector('.stack-star');for(const [id,record]of f.messages)f.messages.set(id,{...record,fresh:false});f.draw();const before=f.calls.length;fresh.onkeydown(event(fresh,{key:'Enter'}));assert.equal(f.calls.length,before);f.list.root=false;f.list.remove();star.onclick(event(star));assert.equal(f.calls.length,before);
});
test('1264 singleton rename click and keyboard keep focus/target across repeated paints',t=>{
 const f=fixture(t,[item('root')]),row=f.row(),name=row.querySelector('.stack-name');name.focus();const current={...f.messages.get('root'),revision:2};f.messages.set('root',current);f.draw();assert.equal(f.row().querySelector('.stack-name'),name);assert.equal(f.doc.activeElement,name);row.onclick(event(name));name.onkeydown(event(name,{key:'Enter'}));name.onkeydown(event(name,{key:' '}));assert.equal(f.calls.length,3);assert.ok(f.calls.every(call=>call[0]==='rename'&&call[1].head===current));
});
for(const path of ['contextmenu','ContextMenu','Shift-F10','touch-hold','scroll-cancel','focus-selection'])test('1264 actual delegated menu '+path+' survives unchanged title repaint',t=>{
 const f=titleFixture(t),row=f.row(),star=row.querySelector('.stack-star'),opened=[],timers=new Map();let serial=0;
 f.doc.getSelection=()=>({isCollapsed:path!=='focus-selection'});
 const options={doc:f.doc,clock:{setTimeout(fn){timers.set(++serial,fn);return serial;},clearTimeout(id){timers.delete(id);}}};
 const door=slice('  const cancelDossierHold = menuDoor(', "  $('messages').addEventListener('contextmenu'");
 const stop=new Function('$','menuDoor','messageContextMenu',door+';return cancelDossierHold;')(id=>id==='messages'?f.list:null,(root,locate,open)=>menuDoor(root,locate,open,options),event=>opened.push([event.target,{x:event.clientX,y:event.clientY}]));t.after(stop);
 if(path==='contextmenu'||path==='focus-selection')f.list.listeners.contextmenu(event(star,{clientX:12,clientY:20}));
 else if(path==='ContextMenu')f.list.listeners.keydown(event(star,{key:'ContextMenu'}));
 else if(path==='Shift-F10')f.list.listeners.keydown(event(star,{key:'F10',shiftKey:true}));
 else {f.list.listeners.pointerdown(event(star,{pointerType:'touch',isPrimary:true,clientX:12,clientY:20}));f.draw();if(path==='scroll-cancel')f.list.listeners.scroll(event(f.list));else for(const fn of [...timers.values()])fn();}
 assert.equal(f.row(),row);assert.equal(f.row().querySelector('.stack-star'),star);assert.equal(opened.length,['scroll-cancel','focus-selection'].includes(path)?0:1);if(opened.length)assert.equal(opened[0][0],row.closest('.reply-stack'));
});
test('1264 hover/accessibility labels and passive scroll/image/layout repaint preserve current row',t=>{
 const f=titleFixture(t),row=f.row(),name=row.querySelector('.stack-name'),pen=row.querySelector('.stack-pen'),star=row.querySelector('.stack-star'),before=[name.title,pen.title,star.title,star.getAttribute('aria-label')];
 for(const cause of ['hover','scroll','image-complete','acts','edit']){f.draw();assert.equal(f.row(),row,cause);assert.equal(row.querySelector('.stack-name'),name,cause);assert.deepEqual([name.title,pen.title,star.title,star.getAttribute('aria-label')],before,cause);}
});

test('1264 incremental carries/reading owners share retained title parts with full arrange',t=>{
 const f=titleFixture(t),card=cardIn(f.entry('root')),row=f.row(),image=row.querySelector('.card-carries');assert.ok(image);
 paintHeadCarries(card,f.messages.get('root'));assert.equal(row.querySelector('.card-carries'),image);
 const current={...f.messages.get('root'),attachments:[],yours:{note:true}};f.messages.set('root',current);paintHeadCarries(card,current);
 const note=row.querySelector('.card-carries');assert.ok(note);assert.notEqual(note,image);f.draw();assert.equal(row.querySelector('.card-carries'),note);
 const name=row.querySelector('.stack-name'),star=row.querySelector('.stack-star');paintHeadReading(card,f.messages,()=>false,id=>'Name '+id);
 assert.equal(row.querySelector('.stack-name'),name);assert.equal(row.querySelector('.stack-star'),star);assert.equal(row.querySelector('.stack-new-action'),null);
});
for(const freshHead of [true,false])test('1264 '+(freshHead?'head-New':'reply-New')+' checked animation keeps its control and current later source',async t=>{
 const f=titleFixture(t,{fresh:freshHead}),row=f.row(),mark=row.querySelector('.stack-new-action');assert.ok(mark);let release;
 mark.animate=()=>({finished:new Promise(resolve=>{release=resolve;})});const checked=checkDossierNew(f.list,f.state.stacks[0],mark);
 assert.equal(f.row().querySelector('.stack-new-action'),mark);assert.equal(mark.textContent,'✓');
 const current={...f.messages.get('root'),revision:2};f.messages.set('root',current);f.draw();assert.equal(f.row().querySelector('.stack-new-action'),mark);mark.onkeydown(event(mark,{key:'Enter'}));assert.equal(f.calls.at(-1)[1].head,current);
 release();await checked;assert.equal(f.state.checking.size,0);assert.equal(f.row().querySelector('.stack-new-action'),mark);
});
for(const pointerType of ['mouse','touch'])test('1264 '+pointerType+' title rename/hide/fold routes derive the current head',t=>{
 const f=titleFixture(t),row=f.row(),current={...f.messages.get('root'),revision:2};f.messages.set('root',current);f.draw();
 assert.equal(headClick(f.list,f.entry('root'),event(row.querySelector('.stack-name'),{pointerType})),true);assert.equal(f.calls.at(-1)[0],'rename');assert.equal(f.calls.at(-1)[1].head,current);
 assert.equal(headClick(f.list,f.entry('root'),event(row.querySelector('.stack-hide'),{pointerType})),true);assert.equal(f.state.levels.get('root'),'folded');assert.equal(f.row().querySelector('.stack-hide'),null);
 headClick(f.list,f.entry('root'),event(f.row(),{pointerType}));assert.equal(f.state.levels.get('root'),'open');
});
test('1264 own-withdrawal reheading removes the old target without stale actions',t=>{
 const f=titleFixture(t),old=f.row(),oldName=old.querySelector('.stack-name'),oldStar=old.querySelector('.stack-star');
 f.messages.set('root',{...f.messages.get('root'),author_id:'reader',intent:'ask',withdrawal:{by:'reader'}});f.draw();assert.equal(f.state.stacks[0].head.id,'reply');
 const current=f.state.sections.get('reply').querySelector('.stack-head');assert.notEqual(current,old);assert.equal(f.entry('root').hidden,true);assert.equal(oldName.isConnected,true,'withdrawn record keeps its hidden connected DOM');
 const before=f.calls.length;oldStar.onclick(event(oldStar));assert.equal(f.calls.length,before,'hidden old target cannot invoke its former action');
});
test('1264 retained reply-context links preserve external click/tap target',t=>{
 const f=fixture(t),line=f.doc.createElement('span'),previous=globalThis.location;globalThis.location=new URL('https://isolated.test/');t.after(()=>{globalThis.location=previous;openLinksWith(null);});
 const message=item('child',3,{reply_to:'parent',reply_to_author:'writer',reply_to_excerpt:'https://example.test/place words'});
 paintReplyLine(line,message);const link=line.querySelector('a');assert.ok(link);let stopped=0;
 for(const pointerType of ['mouse','touch']){paintReplyLine(line,{...message});assert.equal(line.querySelector('a'),link);link.listeners.click(event(link,{pointerType,button:0,stopPropagation(){stopped++;}}));}
 assert.equal(stopped,2);assert.equal(link.href,'https://example.test/place');assert.equal(link.target,'_blank');
});
test('1264 pending unknown/refused/confirmed adoption retains reply context and later writing',t=>{
 const f=fixture(t),host=f.list,parent=item('parent',1,{body:'Parent exact opening'}),topicId='isolated-1264';
 const submission={id:'submission',topicId,presentPending:true,status:'unknown',snapshot:{body:'Submitted exact words',reply_to:'parent',attachments:[]},sendOperationId:'send-op'};
 const editor={context:{instanceId:'isolated',actor:'writer'},submissions:[submission]};
 const draw=()=>paintPendingSends(host,[editor],{topicId,visual:()=>item('local',3,{reply_to:'parent',reply_to_author:parent.author_id,reply_to_excerpt:parent.body,body:submission.snapshot.body})});
 const writing=f.doc.createElement('textarea');writing.value='Later exact writing';host.append(writing);writing.focus();draw();const card=host.querySelector('[data-pending-send]'),line=card.querySelector('.message-reply-to'),nodes=[...line.children],counts=spy(line);
 for(const status of ['unknown','refused','confirmed']){submission.status=status;draw();assert.equal(card.querySelector('.message-reply-to'),line);assert.deepEqual(line.children,nodes);noWrites(counts,'unchanged local reply context');assert.equal(writing.value,'Later exact writing');assert.equal(f.doc.activeElement,writing);}
 const message=item('confirmed',4,{reply_to:'parent',reply_to_author:parent.author_id,reply_to_excerpt:parent.body,body:submission.snapshot.body});submission.receipt={status:'committed',recorded:true,kind:'message.send',instance_id:'isolated',operation_id:'send-op',result:{message_id:message.id,seq:4}};
 const adopted=adoptPendingSend(host,[editor],message,{topicId});assert.equal(adopted.card,card);paintReplyLine(line,message);assert.deepEqual(line.children,nodes);noWrites(counts,'canonical adoption keeps same context');
});
function appMenuOwner(f,env) {
 const code=slice('function messageContextMenu(', 'async function copyOutcomeLink(');
 const ports={$:id=>id==='messages'?f.list:null,entryOf,cardIn,views:{messages:f.messages},window:{getSelection:()=>({isCollapsed:true})},menu:null,retired:false,...env};
 return (...args)=>new Function(...Object.keys(ports),code+';return messageContextMenu;')(...Object.values(ports))(...args);
}
test('1264 actual app right-click menu keeps current target and refuses retired/access-changed choices',t=>{
 const f=titleFixture(t),opened=[],row=f.row(),star=row.querySelector('.stack-star'),open=appMenuOwner(f,{messageMenuItems:item=>[{key:'act',label:item.body}],openMessageMenu:menu=>opened.push(menu)});
 const current={...f.messages.get('root'),body:'Changed source'};f.messages.set('root',current);f.draw();open(event(star,{clientX:12,clientY:20}));assert.equal(opened.length,1);assert.equal(opened[0].items[0].label,current.body);assert.equal(opened[0].anchor,cardIn(f.entry('root')));
 const code=slice('function runDossierMenuChoice(', 'function openDossierMenuRoute('),env={retired:false,topicUnavailable:false,views:{messages:f.messages},topic:{id:current.topic_id},messageMenuItems:()=>choices};let acted=0,choices=[{key:'act',label:'Act',act:()=>acted++}];
 const choose=()=>new Function(...Object.keys(env),code+';return runDossierMenuChoice;')(...Object.values(env))('root','act','Act',star);
 assert.equal(choose(),true);choices=[{key:'act',label:'Act',disabled:true,act:()=>acted++}];assert.equal(choose(),false);choices=[];assert.equal(choose(),false);env.retired=true;assert.equal(choose(),false);env.retired=false;env.topicUnavailable=true;assert.equal(choose(),false);assert.equal(acted,1);
});
