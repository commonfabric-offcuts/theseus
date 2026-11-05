import test from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../web/editor.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
import { OpeningComposer } from '../web/opening-view.mjs';
import { dom } from './fixtures/ui_dom.mjs';
import { recordedOpeningRefusalVisible } from './reader_navigation_native.mjs';

const context={instanceId:'instance',actor:'person',kind:'reply',sourceRef:{kind:'new_topic',id:'opening',workspace_id:'workspace'},topicId:'reserved'};
const initial=()=>new Editor(context,{id:'draft',revision:0,generation:'generation',body:'Opening words'});
test('opening card renders actual blocked phase and reason and the explicit interrupted-send limitation',t=>{
  const previous=globalThis.document;globalThis.document=dom();t.after(()=>{globalThis.document=previous;});
  const e=initial(),item={id:'a',status:'preparing',snapshot:{body:'Frozen A'},blocked:{phase:'draft.save',message:'The saved revision changed.'}};
  const sends=new Map();
  e.submissions=[item];const registry={hasInFlightSend:false,sessionFor:()=>({sends}),pending:()=>({items:[],next_cursor:null}),pendingReceipts:new Map(),pendingReason:()=>null};
  const v=Object.assign(Object.create(OpeningComposer.prototype),{presentation:{writable:true,editors:{reply:e}},registry,cards:new Map(),
    title:document.createElement('input'),people:{paint(){}},localState:document.createElement('p'),later:document.createElement('button'),history:document.createElement('section')});
  v.paint();const card=v.cards.get('a');assert.match(card.heading.textContent,/Save awaiting confirmation/);assert.equal(card.reason.hidden,false);assert.match(card.reason.textContent,/saved revision changed/);
  item.blocked={phase:'submission.prepare',message:'Preparation read timed out.'};v.paint();assert.match(card.heading.textContent,/Preparation awaiting confirmation/);assert.match(card.reason.textContent,/Preparation read timed out/);
  item.status='prepared';item.preparationConfirmed=true;item.blocked=null;sends.set(item.id,Promise.resolve());registry.hasInFlightSend=true;v.paint();
  assert.doesNotMatch(card.reason.textContent,/interrupted|unavailable in this version/,'an active publication is not described as an interrupted send');
  sends.clear();registry.hasInFlightSend=false;v.paint();
  assert.match(card.heading.textContent,/Preparation confirmed; publication not confirmed/);assert.match(card.reason.textContent,/Continuing this interrupted send is unavailable in this version/);
  assert.doesNotMatch(card.heading.textContent,/Not sent/);assert.equal(card.edit.hidden,true);assert.equal(card.check.hidden,false);
  // Use the actual rendered heading/reason nodes; this minimal DOM fixture
  // deliberately does not implement aggregate textContent or selector engines.
  const history={get textContent(){return card.heading.textContent+' '+card.reason.textContent;},querySelectorAll:selector=>selector==='h3'?[card.heading]:[]};
  assert.equal(recordedOpeningRefusalVisible(history),false,'the continuation limitation is not a recorded participant refusal');
  item.status='refused';v.paint();
  assert.equal(recordedOpeningRefusalVisible(history),true,'the native wait recognizes the terminal refusal heading');
});
test('opening metadata edits preserve W O T and refuse identity fields',()=>{
  const editor=initial();editor.editOpening({title:'Topic title',participants:['agent']});
  assert.deepEqual(editor.draft.opening,{workspace_id:'workspace',title:'Topic title',participants:['agent']});
  assert.deepEqual(editor.context,context);assert.equal(editor.sourceRef.id,'opening');
  assert.throws(()=>editor.editOpening({workspace_id:'elsewhere'}),/identity|metadata/i);
  const ordinary=new Editor({...context,sourceRef:{kind:'topic',id:'reserved'}},null);
  assert.throws(()=>ordinary.editOpening({title:'Not an opening'}),/opening/i);
});
test('an opening freezes only once and empty B never becomes an ordinary message',()=>{
  const editor=initial();editor.editOpening({title:'First topic',participants:[]});
  const first=editor.beginPrepare({prepareOperationId:'p',sendOperationId:'s',submissionId:'a'});
  assert.equal(first.snapshot.opening.title,'First topic');assert.equal(editor.draft.opening,undefined);
  first.status='confirmed';first.preparationConfirmed=true;editor.draft.generation='successor';
  // A recovered copy can carry valid metadata: prove the single-publication
  // gate itself, without accidentally passing on missing-metadata validation.
  editor.draft.opening=structuredClone(first.snapshot.opening);editor.draft.body='Retained private writing';
  assert.throws(()=>editor.beginPrepare({prepareOperationId:'p2',sendOperationId:'s2',submissionId:'b'}),/opening|already|Review/i);
  assert.throws(()=>editor.editOpening({title:'Replacement'}),/opening|already|Review/i);assert.equal(editor.submissions.length,1);
});
test('invalid title and participant identifiers refuse before opening freeze',()=>{
  for(const patch of [{title:'  ',participants:[]},{title:'\x85\x1c',participants:[]},{title:'Good',participants:['bad\nactor']},{title:'Good',participants:['🙂'.repeat(201)]}]){
    const editor=initial();editor.editOpening(patch);
    assert.throws(()=>editor.beginPrepare({prepareOperationId:'p',sendOperationId:'s',submissionId:'a'}),/title|participant/i);
    assert.equal(editor.submissions.length,0);assert.equal(editor.draft.body,'Opening words');
  }
});
test('private opening registers canonical writing without reading or inventing a public source or topic',async t=>{
  const rows=new Map(),calls=[],presented=[];
  const journal=new RecoveryJournal({put:async row=>rows.set(row.id,structuredClone(row)),get:async id=>rows.get(id),forEditor:async()=>({items:[],nextCursor:null})},'tab');
  const bootstrap={instance_id:'instance',actor:'person',authority:{authority_id:'a',authority_epoch:'e',continuity:'initial'}};
  const api={view:async(name,args)=>{
    calls.push({name,args});assert.equal(name,'editor_state');
    return {instance_id:'instance',source_ref:context.sourceRef,destination:{topic_id:'reserved'},source_available:true,destination_available:true,draft:null,note:null,submissions:{instance_id:'instance',items:[],next_cursor:null}};
  }};
  const registry=new EditorRegistry({api,bootstrap,journal,present:p=>presented.push(p)});t.after(()=>registry.dispose());
  const retained={format:1,id:'opening',kind:'opening',instanceId:'instance',actor:'person',authority:{authority_id:'a',authority_epoch:'e'},sourceRef:context.sourceRef,workspace:'workspace',topic:'reserved',phase:'private'};
  const p=await registry.initializeOpening(retained,{id:'workspace',title:'Chosen outcome'},{writable:true});
  assert.equal(p.surface,'opening');assert.equal(p.source,undefined);assert.equal(p.topic,undefined);assert.equal(p.workspace.id,'workspace');
  assert.equal(registry.isCurrent(p,p.editors.reply),true);assert.deepEqual(p.editors.reply.context,context);
  assert.deepEqual(p.editors.reply.openingBinding,retained.authority);
  assert.deepEqual(p.editors.reply.draft.opening,{workspace_id:'workspace',title:'',participants:[]});assert.equal(presented.length,1);assert.equal(calls.length,1);
});

test('opening confirmation must name the original reserved topic',()=>{
  const e=initial();e.editOpening({title:'Reserved',participants:[]});
  const a=e.beginPrepare({prepareOperationId:'p',sendOperationId:'s',submissionId:'a'});a.preparationConfirmed=true;a.status='prepared';
  const r={instance_id:'instance',operation_id:'s',kind:'topic.create_and_send',recorded:true,status:'committed',result:{submission_id:'a',topic:{id:'wrong-topic'}}};
  assert.equal(e.acceptSend(r),false);assert.equal(a.status,'prepared');
  r.result.topic.id='reserved';assert.equal(e.acceptSend(r),true);
});
