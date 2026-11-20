// Retained review source SHA256 6f94a697a01d60cee98d7ed905bf63ecd6eb87394a3b205f1767cc4bd33fae97; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, A, B, metaOf, parseDeck, deckBody } from './fixtures/card_text_867.mjs';
const sh=rows=>rows.map(r=>`${r.title}:${r.id?r.id.slice(2,3):'-'}/${r.color??'-'}`).join('  ');
// Decision12781: Text Undo restores the displayed raw snapshot, not saved-base text.
test('P page: offline Set color, Text keystroke, owned Undo restores the pre-keystroke raw/text snapshot and unconfirmed color',async t=>{
 const raw=deckBody(parseDeck(card('One','one',details(A))+card('Two','typo',details(B,'blue'))));
 const {p,w,api,input}=await text867(t,raw),send=api.command;
 p.header.description=p.doc.createElement('p');p.switchView('cards');
 api.command=async()=>{throw Error('offline');};
 const picker=p.cardColors(p.cardRef(1),p.text);t.after(()=>picker.close(false));
 await picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='green').onclick();
 assert.equal(metaOf(w.value.body)[1].color,'green');assert.equal(metaOf(w.base.content.body)[1].color,'blue','green is unconfirmed');
 p.switchView('text');const snapshot={body:w.value.body,text:p.text.value};
 const at=p.text.value.indexOf('typo');input(at,at+4,'fixed');
 const undone=input(at,at+5,'typo','historyUndo');console.log('P undone',sh(undone));
 assert.equal(p.text.value,snapshot.text,'Undo restores exactly the displayed text before the keystroke');
 assert.equal(w.value.body,snapshot.body,'Undo restores the raw pre-keystroke body, including its line endings');
 assert.deepEqual([undone[1].id,undone[1].color],[B,'green'],'the unconfirmed color survives the undone keystroke');
 assert.deepEqual([metaOf(w.base.content.body)[1].id,metaOf(w.base.content.body)[1].color],[B,'blue'],'the saved base remains blue');
 api.command=send;
});
