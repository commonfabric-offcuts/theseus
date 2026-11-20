// Retained review source SHA256 40bc9f608a3d794fa69e5c3fb2c2b0e64c78ecaa34acf3bdfd396ab2668140cd; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, A, B, metaOf, parseDeck, cardDetails, CardTextProjection } from './fixtures/card_text_867.mjs';
const sh=rows=>rows.map(r=>`${r.title}:${r.id?r.id.slice(2,3):'-'}/${r.color??'-'}`).join('  ');
// K1/K2/K2b: the claim's tests (scratch-r5-text/zz_r5_mutkill.test.mjs), unchanged in substance.
test('K1 offline Set color, type in that card, Undo back to the base text: the unconfirmed color stays',async t=>{
 const h=await text867(t,card('One','one',details(A))+card('Two','two',null));
 h.p.header.description=h.p.doc.createElement('p');h.p.switchView('cards');
 const send=h.api.command;h.api.command=async()=>{throw Error('offline');};
 const picker=h.p.cardColors(h.p.cardRef(1),h.p.text);t.after(()=>picker.close(false));
 await (picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='green')??picker.root.querySelectorAll('.swatch')[0]).onclick();
 const id=metaOf(h.w.value.body)[1].id;assert.ok(id);h.p.switchView('text');
 const at=h.p.text.value.indexOf('two')+3;h.input(at,at,'x');
 const rows=h.input(at,at+1,'','historyUndo');console.log('K1 undone',sh(rows));
 assert.deepEqual(rows.map(r=>[r.id,r.color]),[[A,'blue'],[id,'green']]);
 h.api.command=send;
});
test('K2 twins: type in twin 1, Undo back to the base text, then type in twin 0',async t=>{
 const h=await text867(t,card('Same','same',details(A))+card('Same','same',details(B,'rose')));
 const v=h.p.text.value,at=v.lastIndexOf('same')+4;
 h.input(at,at,'?');h.input(at,at+1,'','historyUndo');
 const first=v.indexOf('same')+4;const rows=h.input(first,first,'!');console.log('K2',sh(rows));
 assert.deepEqual(rows.map(r=>[r.id,r.color]),[[A,'blue'],[B,'rose']]);
});
test('K2b module: edit, edit back to base, edit the other twin',()=>{
 const p=new CardTextProjection();const text=p.show(card('Same','same',details(A))+card('Same','same',details(B,'rose')));
 const at=text.lastIndexOf('same')+4;p.edit(text.slice(0,at)+'?'+text.slice(at),{start:at,end:at});p.edit(text,{start:at,end:at+1});
 const first=text.indexOf('same')+4;const out=p.edit(text.slice(0,first)+'!'+text.slice(first),{start:first,end:first});
 console.log('K2b',sh(metaOf(out)));assert.deepEqual(metaOf(out).map(r=>r.id),[A,B]);
});
// B1/B2: the earlier reviewer's pins (scratch-r5-m14pin), aimed at the render() placement.
test('B1 projection: Text Undo back to the base text keeps unconfirmed current metadata',()=>{
 const base=card('Same','one',details(A,'green'))+card('Plan','one',details(B,'rose'));
 const current=card('Same','one',details(A,'rose'))+card('Plan','one',details(B,'rose'));
 const p=new CardTextProjection(),text=p.show(current,base),at=text.indexOf('## Plan')+3;
 p.edit(text.slice(0,at)+text.slice(at+4),{start:at,end:at+4,inputType:'deleteContentBackward'});
 const undone=p.edit(text,{start:at,end:at,inputType:'historyUndo'});
 console.log('B1 undone',sh(metaOf(undone)));
 assert.equal(cardDetails(parseDeck(undone).cards[0].words).color,'rose','Same keeps its unconfirmed rose');
 assert.equal(undone,current);
});
// Decision12781 retires saved-base text equality; the raw pre-keystroke snapshot is the oracle.
test('B2 page, identified card: offline recolor, Text keystroke, owned Undo restores the raw/text snapshot and unconfirmed color',async t=>{
 const raw=card('One','one',details(A))+card('Two','typo',details(B,'blue'));
 const {p,w,api,input}=await text867(t,raw),send=api.command;
 p.header.description=p.doc.createElement('p');p.switchView('cards');
 api.command=async()=>{throw Error('offline');};
 const picker=p.cardColors(p.cardRef(1),p.text);t.after(()=>picker.close(false));
 await picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='green').onclick();
 assert.deepEqual([metaOf(w.value.body)[1].id,metaOf(w.value.body)[1].color],[B,'green']);
 assert.equal(metaOf(w.base.content.body)[1].color,'blue','green is unconfirmed');
 p.switchView('text');const snapshot={body:w.value.body,text:p.text.value};
 const at=p.text.value.indexOf('typo');input(at,at+4,'fixed');
 const undone=input(at,at+5,'typo','historyUndo');console.log('B2 undone',sh(undone));
 assert.equal(p.text.value,snapshot.text,'Undo restores exactly the displayed text before the keystroke');
 assert.equal(w.value.body,snapshot.body,'Undo restores the raw pre-keystroke body, including its line endings');
 assert.deepEqual([undone[1].id,undone[1].color],[B,'green']);
 assert.deepEqual([metaOf(w.base.content.body)[1].id,metaOf(w.base.content.body)[1].color],[B,'blue'],'the saved base remains blue');
 api.command=send;
});
