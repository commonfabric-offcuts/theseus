import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Editor } from '../web/editor.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { Uploads } from '../web/uploads.mjs';
import { imageBarrier } from '../web/upload-state.mjs';
import { writingState } from '../web/writing-helpers.mjs';
import { reviewDifferences } from '../web/review-differences.mjs';
const copy=structuredClone,pin={authority_id:'authority',authority_epoch:'epoch'};
const context={instanceId:'1044-isolated',actor:'fixture-person',kind:'reply',sourceRef:{kind:'topic',id:'topic'},topicId:'topic'};
function fixture(){
 const e=new Editor(context,{id:'draft',generation:'g1',revision:1,body:'Current visible writing'});
 e.uploadState={format:2,revision:1,client_cycle_id:e.clientCycleId,entries:[],submission_links:{}};
 const r={id:'other-copy',stamp:'stamp',writerId:'other',active:1,availability:'available',snapshot:{...e.snapshot(),draft:{...copy(e.draft),body:'Alternate unsent writing'}}};
 e.imageCopies=new Map([[r.id,r]]);e.recoveryServerDraft=copy(e.draft);return{e,r};
}
const selected=e=>({selection_id:'image',origin:'file',binding:{},owner:{kind:'cycle',id:e.clientCycleId},version:1,selected:true,file:{name:'pending.png',size:4,type:'image/png'},bytes_ref:'bytes',bytes_state:'durable',choice:null,attempts:[],ready_descriptor:null,association:null});
for(const shape of ['selected-image-copy','refused-copy','unreadable-copy','other-tab-copy','more-copies'])test('1044 an alternate '+shape+' retains recovery without blocking current Send',()=>{
 const{e,r}=fixture();if(shape==='selected-image-copy')r.snapshot.uploadState.entries=[selected(e)];if(shape==='refused-copy')r.snapshot.submissions=[{id:'earlier',status:'refused',snapshot:copy(e.draft),receipt:{kind:'submission.prepare'}}];if(shape==='unreadable-copy')Object.assign(r,{availability:'unreadable',snapshot:null});if(shape==='other-tab-copy')Object.assign(r,{availability:'open-in-another-tab',snapshot:null,uploadPresent:true});if(shape==='more-copies')e.imageCopiesNext={cursor:'more'};
 e.recoveryDiscovery=true;const saved=copy(r),state=writingState(e);assert.equal(imageBarrier(e),null);assert.equal(state.sendDisabled,false);assert.equal(state.readOnly,false);assert.equal(state.addDisabled,false);
 const item=e.beginPrepare({prepareOperationId:'prepare-current',sendOperationId:'send-current',submissionId:'current'});assert.equal(item.snapshot.body,'Current visible writing');assert.equal(item.sendOperationId,'send-current');assert.deepEqual(r,saved,'the alternate is not changed or marked sent');
});
test('1044 current unfinished image still prevents preparation, independently of alternatives',()=>{
 const{e}=fixture();e.uploadState.entries=[selected(e)];assert.match(imageBarrier(e),/Finish or remove the image pending.png/);assert.equal(writingState(e).sendDisabled,true);assert.throws(()=>e.beginPrepare({prepareOperationId:'p',sendOperationId:'s',submissionId:'a'}),/Finish or remove/);assert.equal(e.submissions.length,0);
});
test('1044 Keep current writing cannot clear a currently selected unfinished image',async()=>{
 const{e,r}=fixture();r.snapshot.submissions=[{id:'old-refusal',status:'refused',snapshot:copy(e.draft),receipt:{kind:'submission.prepare'}}];e.uploadState.entries=[selected(e)];e.recoveryDiscovery=true;
 const session={editor:e,authority:pin,uploads:{validateRetained:async()=>{}}};const registry=Object.create(EditorRegistry.prototype);Object.assign(registry,{sessions:new Map([[e.key,session]]),disposed:false,changed:()=>{},cleanup:{enqueue:(_key,run)=>Promise.resolve().then(run)},journal:{writerId:'current-writer',inspectCandidate:async()=>copy(r),keepCandidate:async(_key,row,choice,guard)=>{assert.ok(guard());return{...copy(row),stamp:'new-stamp',reviewChoice:{...copy(choice),stamp:'new-stamp'}};}}});
 const snapshot=copy(r.snapshot);const kept=await registry.keepCurrentWriting(e,r);assert.deepEqual(kept.snapshot,snapshot);assert.match(imageBarrier(e),/Finish or remove the image pending.png/);assert.equal(e.draft.body,'Current visible writing');assert.equal(e.submissions.length,0);
});
for(const flag of ['authorityRecovery','conflict','unavailable','adopting'])test('1044 preserves current '+flag+' admission',()=>{const{e}=fixture();e[flag]=flag==='conflict'?{error:{code:'CONFLICT'}}:true;assert.equal(writingState(e).sendDisabled,true);});
for(const different of [false,true])test('1044 recovery control says Check recovery for saved differences='+different,()=>{
 const{e,r}=fixture();if(!different)r.snapshot.draft=copy(e.draft);else r.snapshot.localVersion++;
 if(!different)r.availability='open-in-another-tab';
 const candidates=new Map([[e.key,{items:[r]}]]),source=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('const reviewState = editor =>'),source.indexOf('const paintVersionButton ='));
 const scope={candidates,differences:editor=>reviewDifferences(editor,[r]),editor:e};vm.runInNewContext(code+';globalThis.state=reviewState(editor);',scope);assert.equal(scope.state.hidden,false);assert.equal(scope.state.text,'Check recovery');
});

test('1044 alternate discovery leaves a plain current field writable before its first edit',()=>{
 const{e}=fixture();delete e.uploadState;e.recoveryDiscovery=true;const state=writingState(e);assert.equal(state.readOnly,false);assert.equal(state.sendDisabled,false);assert.equal(state.addDisabled,false);
});
function uploadsFixture(){const{e,r}=fixture(),session={editor:e,authority:pin};const registry={disposed:false,sessions:new Map([[e.key,session]]),isCurrent:()=>true,changed:()=>{},runtime:{current:pin},bootstrap:{limits:{media_name_utf8_bytes:128,image_bytes:4096,media_file_bytes:4096,attachment_count:4,attachment_bytes:8192}}};return{e,r,u:new Uploads(session,registry)};}
test('1044 alternate-copy discovery does not block a new current image choice',()=>{
 const{e,u}=uploadsFixture();e.recoveryDiscovery=true;const token=u.reserve({});assert.equal(e.imageReservation,token);u.cancel(token);assert.equal(e.imageReservation,null);assert.doesNotThrow(()=>u.admit(new File(['image'],'current.png',{type:'image/png'})));
});
test('1044 malformed current upload state still prevents choosing another image',()=>{
 const{e,u}=uploadsFixture();e.uploadOpaque=true;assert.throws(()=>u.reserve({}),/image/i);assert.throws(()=>u.admit(new File(['image'],'current.png',{type:'image/png'})),/image/i);
});
test('1044 identical available saved writing alone draws no recovery control',()=>{
 const{e,r}=fixture();r.snapshot.draft=copy(e.draft);const candidates=new Map([[e.key,{items:[r]}]]),source=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');const code=source.slice(source.indexOf('const reviewState = editor =>'),source.indexOf('const paintVersionButton ='));const scope={candidates,differences:editor=>reviewDifferences(editor,[r]),editor:e};vm.runInNewContext(code+';globalThis.state=reviewState(editor);',scope);assert.equal(scope.state.hidden,true);
});
