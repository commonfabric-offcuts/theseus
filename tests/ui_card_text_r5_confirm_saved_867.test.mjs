import test from 'node:test';
import assert from 'node:assert/strict';
import { A, card, details, metaOf, text867 } from './fixtures/card_text_867.mjs';

// Hold the receipt of the next command until released; the server has already applied it.
function holdNext(api){
 const send=api.command;let release,arrive;const arrived=new Promise(r=>arrive=r);let armed=true;
 api.command=async e=>{const receipt=await send(e);if(armed){armed=false;arrive();await new Promise(r=>release=r);}return receipt;};
 return {arrived,release:()=>{api.command=send;release();}};
}
async function setColorInFlight(t,p,api,index,color){
 const held=holdNext(api);
 const picker=p.cardColors(p.cardRef(index),p.text);t.after(()=>picker.close(false));
 const choosing=picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')===color).onclick();
 await Promise.race([held.arrived,choosing.then(()=>{throw Error('Color fixture ended before reaching the command: '+picker.root.querySelector('.notice')?.textContent);})]);
 return {choosing,release:held.release};
}

test('r5 review B: a save confirming another card\'s first id, then deleting the first card\'s words, must keep the first card\'s id and color',async t=>{
 const {p,w,api,input,calls,source}=await text867(t,card('','two',details(A,'rose'))+card('Same','two',null)+card('Plan','alpha',null));
 p.header.description=p.doc.createElement('p');p.switchView('cards');
 const {choosing,release}=await setColorInFlight(t,p,api,1,'rose');
 const minted=metaOf(w.value.body)[1].id;assert.ok(minted);
 p.switchView('text');
 const paste=p.text.value.indexOf('## Plan');input(paste,paste,'## Budget\n\n','insertFromPaste');
 release();await choosing;await w.flush();
 assert.deepEqual(metaOf(w.base.content.body).map(r=>[r.title,r.id,r.color]),[['',A,'rose'],['Same',minted,'rose'],['Budget',null,null],['Plan',null,null]],'the save confirmed the paste and the new id');
 const at=p.text.value.indexOf('two');const rows=input(at,at+3,'','deleteContentBackward');await w.flush();console.log('SAVED BASE after flush:',JSON.stringify(metaOf(w.base.content.body).map(r=>[r.title,r.id,r.color])),'calls:',calls.length,'revision:',source().source_ref.revision);
 assert.deepEqual(rows.map(r=>[r.title,r.id,r.color]),[['',A,'rose'],['Same',minted,'rose'],['Budget',null,null],['Plan',null,null]]);
 assert.deepEqual(metaOf(w.base.content.body).map(r=>[r.title,r.id,r.color]),rows.map(r=>[r.title,r.id,r.color]),'confirmed saved base preserves the edited identities');
});
