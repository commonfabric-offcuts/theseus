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
 root.ownerDocument=doc;field.value='';card.hasAttribute=name=>card.getAttribute(name)!==null;card.style={setProperty(){}};card.append(root);root.append(field,taller);doc.body.append(card);
 const editor={context:{kind:'reply'},draft:{...noWriting(),body},submissions:[{status,detached:false}],dirty:false,clientCycleId:'successor',localVersion:2};
 const p={source:{source_ref:{kind:'message',id:'middle'}},editors:{reply:editor},hidden:false};
 const ui={root,field,opening:Symbol(),$:()=>taller,bar:{close(){},expand(){}},drawEditor(){field.value=editor.draft.body;},paintStatus(){}};
 const row={p,ui,card,clickOpened,sourceHeight:40};
 const registry={current:readerOpen?{editors:p.editors}:null,disposed:false,pendingOpen:null,doubt:()=>({label:''})};
 const owner=Object.assign(Object.create(CardReplies.prototype),{rows:new Map([['middle',row]]),closed:new Set(),registry,changed(){}});
 return {owner,row,p,editor,registry};
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
