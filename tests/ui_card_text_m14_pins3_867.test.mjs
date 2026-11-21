// Retained review source SHA256 b3459c6122368d954e4e85fe137da24b0c85f326f84c869710884032a0cbc42d; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, A, B, metaOf, stripDetails } from './fixtures/card_text_867.mjs';
const sh=rows=>rows.map(r=>`${r.title}:${r.id?r.id.slice(2,3):'-'}/${r.color??'-'}`).join('  ');
const tail=s=>JSON.stringify(s.slice(-40));
test('P2 page: base shaped by a confirmed Set color; then an offline Set color, a Text keystroke in that card, native Undo',async t=>{
 const raw=card('One','one',details(A))+card('Two','typo',details(B,'blue'));
 const {p,w,api,input}=await text867(t,raw),send=api.command;
 p.header.description=p.doc.createElement('p');p.switchView('cards');
 let picker=p.cardColors(p.cardRef(1),p.text);await picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='rose').onclick();
 await w.flush();await w.flush();
 assert.equal(metaOf(w.base.content.body)[1].color,'rose','rose is confirmed into the base');
 console.log('P2 base tail ',tail(stripDetails(w.base.content.body)));
 api.command=async()=>{throw Error('offline');};
 picker=p.cardColors(p.cardRef(1),p.text);t.after(()=>picker.close(false));
 await picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='green').onclick();
 assert.equal(metaOf(w.value.body)[1].color,'green');assert.equal(metaOf(w.base.content.body)[1].color,'rose','green is unconfirmed');
 console.log('P2 value tail',tail(stripDetails(w.value.body)));
 p.switchView('text');const at=p.text.value.indexOf('typo');input(at,at+4,'fixed');
 const undone=input(at,at+5,'typo','historyUndo');
 console.log('P2 undone',sh(undone),'| textarea===base.text:',p.text.value===p.textProjection.base.text);
 assert.equal(p.text.value,p.textProjection.base.text,'the branch under test is reached');
 assert.deepEqual([undone[1].id,undone[1].color],[B,'green'],'the unconfirmed color survives the undone keystroke');
 api.command=send;
});
