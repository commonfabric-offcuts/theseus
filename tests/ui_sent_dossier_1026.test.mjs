import test from 'node:test';
import assert from 'node:assert/strict';
import { InlineComposer } from '../web/inline-composer.mjs';
import { noWriting } from '../web/editor.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

function pencil() {
  const doc=miniDocument(), root=doc.createElement('div'), field=doc.createElement('textarea');root.ownerDocument=doc;root.contains=el=>el===root||[...root.descendants()].includes(el);root.append(field);field.focus();
  let resolve;const answer=new Promise(r=>resolve=r),landed=[],editor={draft:{...noWriting(),body:'Sent words'},context:{kind:'reply'},localVersion:1,clientCycleId:'first',submissions:[],edit(patch){Object.assign(this.draft,patch);}};
  const ui=Object.assign(Object.create(InlineComposer.prototype),{root,field,presentation:{editors:{reply:editor}},kind:'message',opening:Symbol(),
    admits:()=>!ui.disposed,state:()=>({sendDisabled:false}),names:()=>[],
    bar:{panel:null,holdSend:()=>false,fold(){this.folded=true;}},naming:{sheet:{open:false}},drawEditor(){},paintRecipients(){},paintStatus(){},paintChoice(){},notice(e){throw e;},
    callbacks:{send(){editor.draft=noWriting();editor.clientCycleId='successor';return answer;},sent(p,result,current){landed.push({p,result,current});}}});
  return {ui,editor,doc,root,field,resolve,landed};
}
test('1026 resting publication folds once and guards a delayed exact-message landing',async()=>{
  const f=pencil(),done=f.ui.send();f.resolve({status:'confirmed'});await done;
  assert.equal(f.ui.bar.folded,true);assert.equal(f.landed.length,1);assert.equal(f.landed[0].current(),true);
  f.doc.createElement('button').focus();assert.equal(f.landed[0].current(),false);
});
for(const status of ['preparing','prepared','unknown','refused'])test(`1026 ${status} keeps pencil controls and never lands`,async()=>{
  const f=pencil(),done=f.ui.send();f.resolve({status});await done;assert.equal(f.landed.length,0);assert.equal(f.ui.bar.folded,undefined);
});
for(const [name,change]of Object.entries({writing:f=>{f.editor.localVersion++;f.editor.draft.body='Later';},cycle:f=>f.editor.clientCycleId='later',opening:f=>f.ui.opening=Symbol(),
  mode:f=>f.ui.kind='note-card',disposed:f=>f.ui.disposed=true,authority:f=>f.editor.authorityRecovery={},image:f=>f.editor.imageReservation={},picker:f=>f.ui.imagePicker={},
  panel:f=>f.ui.bar.panel='who',naming:f=>f.ui.naming.sheet.open=true,notice:f=>f.ui.noticeVersion=1}))test(`1026 late confirmation yields to ${name}`,async()=>{
  const f=pencil(),done=f.ui.send();change(f);f.resolve({status:'confirmed'});await done;assert.equal(f.landed.length,0);assert.equal(f.ui.bar.folded,undefined);
});
test('1026 background confirmed pencil folds without taking another control focus',async()=>{
  const f=pencil(),done=f.ui.send();f.doc.createElement('button').focus();f.resolve({status:'confirmed'});await done;
  assert.equal(f.ui.bar.folded,true);assert.equal(f.landed.length,0);
});
test('1026 exact reconciled publication lands once; another submission cannot finish it',async()=>{
  const f=pencil(),item={status:'preparing',id:'sent'},done=(f.editor.submissions=[item],f.ui.send());
  item.status='prepared';f.resolve(item);await done;assert.equal(f.landed.length,0);
  f.ui.published({status:'confirmed',id:'other'});assert.equal(f.landed.length,0);
  item.status='confirmed';f.ui.published(item);await Promise.resolve();assert.equal(f.landed.length,1);
  f.ui.published(item);assert.equal(f.landed.length,1);
});
test('1026 detached publication cannot fold or route',async()=>{
  const f=pencil(),done=f.ui.send();f.resolve({status:'confirmed',detached:true});await done;assert.equal(f.landed.length,0);assert.equal(f.ui.bar.folded,undefined);
});

test('1026 accepts native restoration to the captured modal opener and guards later focus',async()=>{
  const f=pencil(),opener=f.doc.createElement('main');f.ui.popped=true;f.ui.popOpener=opener;
  f.ui.bar.fold=()=>opener.focus();const done=f.ui.send();f.resolve({status:'confirmed'});await done;
  assert.equal(f.landed.length,1);assert.equal(f.landed[0].current(),true);
  f.doc.createElement('button').focus();assert.equal(f.landed[0].current(),false);
});
