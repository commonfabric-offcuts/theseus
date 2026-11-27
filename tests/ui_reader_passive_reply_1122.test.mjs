import test from 'node:test';
import assert from 'node:assert/strict';
import { CardReplies } from '../web/card-replies.mjs';
import { noWriting } from '../web/editor.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

// Actual CardReplies lifecycle with memory-only view ports. No native
// geometry, real send or stack-foot assertion is claimed by these checks.
function fixture({status='confirmed',body='',clickOpened=false,readerOpen=false}={}) {
 const doc=miniDocument();doc.body=doc.createElement('body');doc.body.root=true;doc.activeElement=doc.body;
 const card=doc.createElement('article'),root=doc.createElement('div'),field=doc.createElement('textarea'),taller=doc.createElement('button');
 root.ownerDocument=doc;root.contains=node=>node===field||node===taller;field.value='';card.hasAttribute=name=>card.getAttribute(name)!==null;card.style={setProperty(){}};card.append(root);root.append(field,taller);doc.body.append(card);
 const editor={context:{kind:'reply'},draft:{...noWriting(),body},submissions:[{status,detached:false}],dirty:false,clientCycleId:'successor',localVersion:2};
 const p={source:{source_ref:{kind:'message',id:'middle'}},editors:{reply:editor},hidden:false};
 const ui={root,field,opening:Symbol(),$:()=>taller,bar:{close(){},expand(){}},drawEditor(){field.value=editor.draft.body;},paintStatus(){},published(){}};
 const row={p,ui,card,clickOpened,sourceHeight:40};
 const registry={current:readerOpen?{editors:p.editors}:null,disposed:false,pendingOpen:null,doubt:()=>({label:''}),isCurrent:()=>!registry.current&&!registry.pendingOpen,saveSign:()=>({state:'saved'})};
 const changes=[];
 const owner=Object.assign(Object.create(CardReplies.prototype),{rows:new Map([['middle',row]]),closed:new Set(),readerHandoffs:new WeakMap(),registry,changed:id=>changes.push(id)});
 return {owner,row,p,editor,registry,changes};
}
test('1122 a passive empty inline reply closes after direct Reader publication and close',()=>{
 const f=fixture();
 f.owner.readerClosed({source:f.p.source,editors:f.p.editors,fromCardReply:false});f.owner.paint();
 assert.equal(f.row.ui.root.hidden,true,'confirmed empty passive composer must not remain in the dossier');
 assert.equal(f.row.card.hasAttribute('data-card-reply'),false);assert.equal(f.owner.closed.has('middle'),true);
});
for(const status of ['preparing','prepared','unknown','refused'])test('1122 passive '+status+' keeps its recovery surface',()=>{
 const f=fixture({status});f.owner.paint();assert.equal(f.row.ui.root.hidden,false);assert.equal(f.owner.closed.has('middle'),false);
});
test('1122 newer writing, image reservation and selected recipients survive old publication',()=>{
 for(const change of [f=>f.editor.draft.body='New reply',f=>f.editor.imageReservation={},f=>f.editor.draft.addressees=['chosen'],f=>f.editor.dirty=true]) {
  const f=fixture();change(f);f.owner.paint();assert.equal(f.row.ui.root.hidden,false);assert.equal(f.owner.closed.has('middle'),false);
 }
});
test('1122 a deliberately reopened empty composer and an active Reader retain ownership',()=>{
 for(const options of [{clickOpened:true},{readerOpen:true}]){const f=fixture(options);f.owner.paint();assert.equal(f.owner.closed.has('middle'),false);assert.equal(f.p.hidden,false);}
});

for(const receiptFirst of [false,true])test('a Reader handoff retires its empty card reply only after both close and publication, receiptFirst='+receiptFirst,()=>{
 const f=fixture({status:'prepared',clickOpened:true,readerOpen:true});
 const item=f.editor.submissions[0], presentation={...f.p,fromCardReply:true};
 const completed=f.owner.trackReaderHandoff(presentation,f.editor,item);
 const close=()=>{f.registry.current=null;f.owner.readerClosed(presentation);f.owner.paint();completed(true);};
 const publish=()=>{item.status='confirmed';f.owner.published(f.editor,item);};
 (receiptFirst?publish:close)();
 assert.equal(f.p.hidden,false);
 (receiptFirst?close:publish)();
 assert.equal(f.p.hidden,true);
 assert.equal(f.row.card.hasAttribute('data-card-reply'),false);
 assert.deepEqual(f.changes,['middle']);
});

test('Reader handoff confirmation leaves a new opening or later writing alone',()=>{
 for(const newer of [
   f=>{f.row.ui.opening=Symbol();},
   f=>{f.editor.draft.body='Later words';f.editor.localVersion++;},
   f=>{f.row.composing=true;},
   f=>{f.registry.pendingOpen={};},
   f=>{f.editor.submissions[0].detached=true;},
   (_f,completed)=>completed(false),
 ]){
  const f=fixture({status:'prepared',clickOpened:true,readerOpen:true});
  const item=f.editor.submissions[0],presentation={...f.p,fromCardReply:true};
  const completed=f.owner.trackReaderHandoff(presentation,f.editor,item);
  f.registry.current=null;f.owner.readerClosed(presentation);f.owner.paint();
  completed(true);newer(f,completed);item.status='confirmed';f.owner.published(f.editor,item);
  assert.equal(f.p.hidden,false);assert.deepEqual(f.changes,[]);
 }
});

test('an asynchronous composer close cannot close the opening that replaced it', async()=>{
 const f=fixture({clickOpened:true}), waiting=Promise.withResolvers();
 f.registry.hideCard=async(p,{current})=>{
  assert.equal(p,f.p);assert.equal(current(),true);
  await waiting.promise;
  return current();
 };
 const closing=f.owner.close('middle');
 f.row.ui.opening=Symbol();
 waiting.resolve();
 assert.equal(await closing,false);
 assert.equal(f.p.hidden,false);
});
