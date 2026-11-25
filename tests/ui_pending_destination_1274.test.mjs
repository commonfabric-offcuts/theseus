import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Editor,restoreEditor} from '../web/editor.mjs';
import {EditorSession} from '../web/session.mjs';
import {EditorRegistry} from '../web/app-session.mjs';
import {RecoveryJournal} from '../web/journal.mjs';
import {Reader} from '../web/reader.mjs';
import * as pending from '../web/pending-sends.mjs';
import {timingCall} from '../web/action-timing.mjs';
import {miniDocument} from './fixtures/mini_dom.mjs';
const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const copy=value=>structuredClone(value), pin={authority_id:'a',authority_epoch:'e',continuity:'initial'};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function actual(name){const a=app.indexOf('function '+name+'('),b=app.indexOf('\n}',a);assert.ok(a>=0&&b>a,name);return app.slice(app.slice(a-6,a)==='async '?a-6:a,b+2);}
function dom(t){
 const doc=miniDocument(),old=globalThis.document,observer=globalThis.IntersectionObserver;const make=doc.createElement;
 doc.createElement=tag=>{const n=make(tag);n.ownerDocument=doc;n.nodeType=1;
  Object.defineProperties(n,{parentElement:{get(){return this.parent;}},parentNode:{get(){return this.parent;}},childNodes:{get(){return this.children;}},nextElementSibling:{get(){const a=this.parent?.children??[];return a[a.indexOf(this)+1]??null;}}});
  n.getClientRects=()=>n.hidden?[]:[{}];n.getBoundingClientRect=()=>({top:40,bottom:100,height:60,left:0,width:600});n.contains=other=>n===other||[...n.descendants()].includes(other);n.scrollIntoView=()=>{};return n;};
 doc.createElementNS=(_ns,tag)=>doc.createElement(tag);doc.createTextNode=text=>Object.assign(doc.createElement('text'),{nodeType:3,data:String(text),textContent:String(text)});
 doc.body=doc.createElement('body');doc.body.root=true;doc.defaultView={innerHeight:900,scrollBy(){}};doc.getSelection=()=>({isCollapsed:true});
 globalThis.document=doc;globalThis.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
 t.after(()=>{globalThis.document=old;globalThis.IntersectionObserver=observer;});
 const host=doc.createElement('div'),folder=doc.createElement('section'),replies=doc.createElement('div'),later=doc.createElement('div'),end=doc.createElement('dialog');
 later.textContent='Later sibling';folder.append(replies);replies.append(later);host.append(folder,end);doc.body.append(host);
 return{doc,host,replies,later,end};
}
function fixture(t,{kind='message',sourceTopic='t',sourceWhisper=false,sendWhisper=false,explicit=null,sourceChange=()=>{},outcome='confirmed',fromCard=false}={}){
 const d=dom(t),sourceRef={kind,id:kind==='message'?'parent':kind==='topic'?'t':'root'},context={instanceId:'i',actor:'person',sourceRef,topicId:'t',kind:'reply'};
 const editor=new Editor(context,{id:'draft',generation:'A',revision:1,...(explicit?{reply_to:explicit}:{})});editor.edit({body:'**Exact A** and [link](https://example.test)',whisper:sendWhisper,addressees:sendWhisper?['agent']:[]});
 const source={instance_id:'i',source_ref:copy(sourceRef),topic_id:sourceTopic,whisper:sourceWhisper,body:sourceWhisper?'Private original':'Public original'};
 const p={surface:'reader',source,sourceAuthority:copy(pin),sourceUnavailable:false,destinationAvailable:true,editors:{reply:editor},mode:'reply',fromCardReply:fromCard};sourceChange(p);
 const rows=new Map(),gate=deferred(),entered=deferred(),envelopes=[],errors=[];let serial=0,closed=0;
 const journal=new RecoveryJournal({put:async row=>rows.set(row.id,copy(row)),get:async id=>copy(rows.get(id))},'tab-1274');
 const api={command:async envelope=>{envelopes.push(copy(envelope));entered.resolve();await gate.promise;let result;
  if(envelope.kind==='draft.save')result={draft_id:'draft',generation:'A',draft_revision:2};
  else if(envelope.kind==='submission.prepare')result={submission_id:envelope.args.submission_id,send_operation_id:envelope.args.send_operation_id,next_draft:{id:'draft',generation:'B',revision:3}};
  else {if(outcome==='unknown')throw Error('lost send receipt');if(outcome==='refused')return{instance_id:'i',operation_id:envelope.operation_id,kind:envelope.kind,recorded:true,status:'rejected',error:{code:'FORBIDDEN',message:'refused'}};result={submission_id:envelope.args.submission_id,message_id:'sent',seq:20};}
  return{instance_id:'i',operation_id:envelope.operation_id,kind:envelope.kind,recorded:true,status:'committed',result};
 },view:async(_name,args)=>({instance_id:'i',operation_id:args.operation_id,recorded:false,status:'unknown'})};
 const registry=new EditorRegistry({api,journal,bootstrap:{instance_id:'i',actor:'person',authority:pin},closed:()=>closed++});
 const session=new EditorSession(editor,{api,journal,authority:pin,runtime:registry.runtime,id:()=>`op-${++serial}`,changed:()=>registry.changed(editor)});
 registry.sessions.set(editor.key,session);registry.current=p;
 const parent={id:'parent',topic_id:sourceTopic,author_id:'source-author',body:source.body,whisper:sourceWhisper};
 const explicitParent={id:'override',topic_id:'t',author_id:'explicit-author',body:'Explicit words',whisper:false};
 const messages=new Map([['parent',parent],['override',explicitParent]]),topic={id:'t'};
 const c=vm.createContext({timingCall,document:d.doc,window:d.doc.defaultView,registry,bootstrap:{actor_kind:'human'},topic,views:{messages:new Map()},messageEntries:new Map(),listAccessEpoch:0,retired:false,topicUnavailable:false,authorityReviewPending:()=>false,roomy:null,
  $:id=>({messages:d.host,'new-message-sheet':d.end})[id],feedMessages:()=>messages,displayActor:id=>id,displayRules:()=>[],drawn:()=>false,run:job=>job(),status:e=>errors.push(e),restoredSendViews:new WeakSet(),inline:null,cardReplies:null,cardIn:n=>n,
  stackFeed:{stackFor:id=>['parent','override'].includes(id)?{id:'stack'}:null},stackState:()=>({sections:new Map([['stack',{isConnected:true,querySelector:()=>d.replies}]])}),...pending});
 for(const name of ['pendingSendCard','restorePendingSendPlace','pendingSendTarget','focusPendingSend','handoffReaderSend','paintSubmittedWriting'])vm.runInContext(actual(name),c,{filename:'actual-app:'+name});
 registry.activity=()=>c.paintSubmittedWriting();registry.changed=()=>c.paintSubmittedWriting();
 // Upload bytes are not this contract's transport; no attachment is requested here.
 const send=()=>registry.send(editor,{presentation:p,stay:true});
 const readerSend=()=>{
  const ui={sessions:p.editors,editor,presentation:p,source,viewToken:1,mode:'reply',disarm(){},admits:()=>registry.isCurrent(p,editor),writes:()=>true,names:()=>[],kindOf:()=>null,answering:Reader.prototype.answering,compose:{holdSend:()=>false,panel:null},naming:{sheet:{open:false}},field:{focus(){}},drawEditor(){},callbacks:{send:(e,o)=>registry.send(e,{...o,presentation:p}),error:e=>errors.push(e),pending:(...args)=>c.handoffReaderSend(...args)}};
  return Reader.prototype.send.call(ui,false);
 };
 t.after(()=>gate.resolve());
 return{...d,c,editor,p,source,registry,session,journal,rows,envelopes,errors,gate,entered,send,readerSend,parent,explicitParent,closed:()=>closed,item:()=>editor.submissions[0],paint:()=>c.paintSubmittedWriting(),card:()=>d.host.querySelector('[data-pending-send]')};
}
async function settle(f,sending){f.gate.resolve();await sending;assert.equal(f.envelopes.filter(e=>e.kind==='message.send').length,1);}
for(const status of ['preparing','prepared','confirmed','refused'])test('1274 same-topic frozen public context through '+status,async t=>{
 const f=fixture(t),sending=f.send(),item=f.item();item.status=status;f.paint();
 assert.equal(pending.pendingSendReplyTo(item),'parent');assert.equal(f.card().parentElement,f.replies);assert.equal(f.later.nextElementSibling,f.card());
 assert.match(f.card().querySelector('.message-reply-to').text,/Public original/);assert.equal(item.replySource?.topicId,'t');
 item.status='preparing';await settle(f,sending);
});
for(const [name,options]of [['Conversation about-only',{sourceTopic:'elsewhere'}],['ordinary other-topic',{sourceTopic:'another'}],['public-from-whisper',{sourceWhisper:true}],['other-topic whisper',{sourceTopic:'other',sourceWhisper:true,sendWhisper:true}]])test('1274 '+name+' has no reply label, excerpt or dossier target',async t=>{
 const f=fixture(t,options),sending=f.send();f.paint();const item=f.item(),visual=pending.pendingSendVisual(f.editor,item,{parent:f.parent});
 assert.equal(pending.pendingSendReplyTo(item),null);assert.equal(visual.reply_to,null);assert.equal(visual.reply_to_excerpt,undefined);assert.equal(visual.reply_to_author,undefined);
 assert.equal(f.card().querySelector('.message-reply-to'),null);assert.equal(f.card().parentElement,f.host);assert.equal(f.card().nextElementSibling,f.end);await settle(f,sending);
});
test('1274 same-topic whisper reply keeps eligible private context',async t=>{
 const f=fixture(t,{sourceWhisper:true,sendWhisper:true}),sending=f.send();f.paint();assert.equal(pending.pendingSendReplyTo(f.item()),'parent');assert.match(f.card().querySelector('.message-reply-to').text,/Private original/);await settle(f,sending);
});
for(const [name,change]of Object.entries({authority:p=>p.sourceAuthority.authority_epoch='other',unknownAuthority:p=>delete p.sourceAuthority,missing:p=>delete p.source,privacy:p=>delete p.source.whisper,unavailable:p=>p.sourceUnavailable=true,unconfirmed:p=>p.availabilityUnconfirmed=true,instance:p=>p.source.instance_id='other',identity:p=>p.source.source_ref.id='other',withheld:p=>p.source.withheld=true}))test('1274 unknown '+name+' source does not invent implicit context',async t=>{
 const f=fixture(t,{sourceChange:change}),sending=f.send();f.paint();assert.equal(pending.pendingSendReplyTo(f.item()),null);assert.equal(f.card().querySelector('.message-reply-to'),null);assert.equal(f.card().parentElement,f.host);await settle(f,sending);
});
test('1274 explicit frozen reply wins over an ineligible source',async t=>{
 const f=fixture(t,{sourceTopic:'elsewhere',sourceWhisper:true,explicit:'override'}),sending=f.send();f.paint();assert.equal(pending.pendingSendReplyTo(f.item()),'override');assert.match(f.card().querySelector('.message-reply-to').text,/Explicit words/);assert.doesNotMatch(f.card().text,/Private original/);assert.equal(f.card().parentElement,f.replies);await settle(f,sending);
});
for(const kind of ['topic','memory'])test('1274 '+kind+' remains a root submission',async t=>{
 const f=fixture(t,{kind}),sending=f.send();f.paint();assert.equal(pending.pendingSendReplyTo(f.item()),null);assert.equal(f.card().parentElement,f.host);assert.equal(f.card().querySelector('.message-reply-to'),null);await settle(f,sending);
});
for(const outcome of ['unknown','refused'])test('1274 '+outcome+' outcome retains A context while later B changes',async t=>{
 const f=fixture(t,{outcome}),sending=f.send(),item=f.item(),frozen=copy(item.replySource);f.editor.edit({body:'Later B',caret:{start:3,end:4}});f.source.source_ref.id='later-source';f.source.topic_id='other';f.source.whisper=true;
 await settle(f,sending);f.paint();assert.deepEqual(item.replySource,frozen);assert.equal(pending.pendingSendReplyTo(item),'parent');assert.equal(f.editor.draft.body,'Later B');assert.deepEqual(f.editor.draft.caret,{start:3,end:4});assert.equal(item.status,outcome==='unknown'?'prepared':'refused');
 assert.equal(f.card().querySelector('.pending-send-check').hidden,false);const saved=await f.journal.own(f.editor.key);assert.deepEqual(saved.snapshot.submissions[0].replySource,frozen);
 const restored=restoreEditor(f.editor.context,null,saved.snapshot);assert.equal(pending.pendingSendReplyTo(restored.submissions[0]),'parent');
});
for(const field of ['authority','destinationId','sourceRef'])test('1274 mismatched frozen '+field+' cannot derive a reply',async t=>{
 const f=fixture(t),sending=f.send(),item=f.item();assert.ok(item.replySource);
 if(field==='authority')item.replySource.authority.authority_epoch='wrong';else if(field==='destinationId')item.replySource.destinationId='elsewhere';else item.replySource.sourceRef.id='wrong';
 f.paint();assert.equal(pending.pendingSendReplyTo(item),null);assert.equal(f.card().querySelector('.message-reply-to'),null);await settle(f,sending);
});
test('1274 old retained implicit submission without source facts is unknown',async t=>{
 const f=fixture(t),sending=f.send();delete f.item().replySource;f.paint();assert.equal(pending.pendingSendReplyTo(f.item()),null);assert.equal(f.card().parentElement,f.host);await settle(f,sending);
});
for(const [name,alter]of Object.entries({identity:p=>p.id='unrelated',topic:p=>p.topic_id='other',privacy:p=>p.whisper=true,unknown:p=>delete p.whisper}))test('1274 explicit parent '+name+' cannot supply source words',async t=>{
 const f=fixture(t,{explicit:'override'}),sending=f.send();alter(f.explicitParent);const v=pending.pendingSendVisual(f.editor,f.item(),{parent:f.explicitParent});assert.equal(v.reply_to,'override');assert.equal(v.reply_to_excerpt,undefined);assert.equal(v.reply_to_author,undefined);await settle(f,sending);
});
for(const fromCard of [false,true])for(const sourceWhisper of [false,true])test(`1274 actual Reader/app handoff ${fromCard?'card':'Reader'} ${sourceWhisper?'public-from-whisper':'eligible public'}`,async t=>{
 const f=fixture(t,{fromCard,sourceWhisper,outcome:'unknown'}),sending=f.readerSend();await f.entered.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(f.closed(),1);assert.equal(f.registry.current,null);
 assert.equal(f.card().parentElement,sourceWhisper?f.host:f.replies);assert.equal(Boolean(f.card().querySelector('.message-reply-to')),!sourceWhisper);const saved=await f.journal.own(f.editor.key);assert.deepEqual(saved.snapshot.submissions[0].replySource,f.item().replySource);
 f.gate.resolve();await sending;assert.equal(f.errors.length,0);assert.equal(f.envelopes.filter(e=>e.kind==='message.send').length,1);assert.equal(f.item().status,'prepared');
});
for(const method of ['open','initializeCard'])test('1274 actual Registry '+method+' retains the source-read authority before Send',async t=>{
 const f=fixture(t),registry=f.registry;registry.current=null;registry.activity=()=>{};registry.changed=()=>{};
 registry.cleanup.foreground=()=>({read:work=>work(),release(){}});
 const original=registry.api.view;registry.api.view=async(name,args)=>name==='source'?copy(f.source):name==='editor_state'?{instance_id:'i',source_ref:copy(f.editor.sourceRef),destination:{topic_id:'t'},source_available:true,destination_available:true,draft:null,note:null,submissions:{instance_id:'i',items:[],next_cursor:null}}:original(name,args);
 registry.register=async context=>{if(context.kind!=='note')return f.editor;const note=new Editor(context,{});registry.sessions.set(note.key,new EditorSession(note,{api:registry.api,journal:f.journal,authority:pin,runtime:registry.runtime}));return note;};
 const p=method==='open'?await registry.open(f.editor.sourceRef,{topicId:'t'}):await registry.initializeCard(f.editor.sourceRef,{id:'t'});
 assert.deepEqual(p.sourceAuthority,pin);assert.notEqual(p.sourceAuthority,registry.runtime.current);
 const sending=registry.send(f.editor,{presentation:p,stay:true});assert.equal(pending.pendingSendReplyTo(f.item()),'parent');
 for(const envelope of f.envelopes)assert.equal(Object.hasOwn(envelope.args,'replySource'),false);
 await settle(f,sending);for(const envelope of f.envelopes)assert.equal(Object.hasOwn(envelope.args,'replySource'),false);
});
test('1274 authority changed during actual source read is not relabeled with the new pin',async t=>{
 const f=fixture(t,{outcome:'refused'}),registry=f.registry;registry.current=null;registry.activity=()=>{};registry.changed=()=>{};
 registry.cleanup.foreground=()=>({read:work=>work(),release(){}});
 const original=registry.api.view;registry.api.view=async(name,args)=>{
  if(name==='source'){registry.runtime.current={...pin,authority_epoch:'new'};return copy(f.source);}
  if(name==='editor_state')return{instance_id:'i',source_ref:copy(f.editor.sourceRef),destination:{topic_id:'t'},source_available:true,destination_available:true,draft:null,note:null,submissions:{instance_id:'i',items:[],next_cursor:null}};
  return original(name,args);
 };
 registry.register=async context=>{if(context.kind!=='note')return f.editor;const note=new Editor(context,{});registry.sessions.set(note.key,new EditorSession(note,{api:registry.api,journal:f.journal,authority:pin,runtime:registry.runtime}));return note;};
 const p=await registry.open(f.editor.sourceRef,{topicId:'t'});assert.equal(p.sourceAuthority.authority_epoch,'e');assert.equal(registry.runtime.current.authority_epoch,'new');
 f.session.authority={...pin,authority_epoch:'new'};const sending=registry.send(f.editor,{presentation:p,stay:true});assert.equal(pending.pendingSendReplyTo(f.item()),null);assert.equal(f.item().replySource,undefined);await settle(f,sending);
});
