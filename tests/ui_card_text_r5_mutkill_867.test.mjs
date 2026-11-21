// Retained review source SHA256 1c9ff7f6d633032ec4a60006d136857052bf819a670ed6c35f967597bef91305; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, A, B, C, metaOf, parseDeck, CardTextProjection } from './fixtures/card_text_867.mjs';
const sh=rows=>rows.map(r=>`${r.title}:${r.id?r.id.slice(2,3):'-'}/${r.color??'-'}`).join('  ');
const span=(v,i)=>{const d=parseDeck(v);let s=d.opening.length;for(let k=0;k<i;k++)s+=d.cards[k].raw.length;return {start:s,end:s+d.cards[i].raw.length,raw:d.cards[i].raw};};
const editWords=(h,i,from,to)=>{const v=h.p.text.value,s=span(v,i),k=s.raw.indexOf(from);assert.ok(k>=0);return h.input(s.start+k,s.start+k+from.length,to);};

test('K1 (M14) offline Set color, type in that card, Undo back to the base text: the unconfirmed color stays',async t=>{
 const h=await text867(t,card('One','one',details(A))+card('Two','two',null));
 h.p.header.description=h.p.doc.createElement('p');h.p.switchView('cards');
 const send=h.api.command;h.api.command=async()=>{throw Error('offline');};
 const picker=h.p.cardColors(h.p.cardRef(1),h.p.text);t.after(()=>picker.close(false));
 await (picker.root.querySelectorAll('.swatch').find(n=>n.getAttribute('aria-label')==='green')??picker.root.querySelectorAll('.swatch')[0]).onclick();
 const id=metaOf(h.w.value.body)[1].id;assert.ok(id);h.p.switchView('text');
 const at=h.p.text.value.indexOf('two')+3;h.input(at,at,'x');
 const rows=h.input(at,at+1,'','historyUndo');console.log('K1 undone',sh(rows));
 assert.deepEqual(rows.map(r=>[r.id,r.color]),[[A,'blue'],[id,'green']]);
 h.api.command=send;await h.w.flush();await h.w.flush();
 assert.deepEqual(metaOf(h.w.base.content.body).map(r=>[r.id,r.color]),[[A,'blue'],[id,'green']]);
});
test('K2 (M14) twins: type in twin 1, Undo back to the base text, then type in twin 0',async t=>{
 const h=await text867(t,card('Same','same',details(A))+card('Same','same',details(B,'rose')));
 const v=h.p.text.value,at=v.lastIndexOf('same')+4;
 h.input(at,at,'?');h.input(at,at+1,'','historyUndo');
 const first=v.indexOf('same')+4;const rows=h.input(first,first,'!');console.log('K2',sh(rows));
 assert.deepEqual(rows.map(r=>[r.id,r.color]),[[A,'blue'],[B,'rose']]);
});
test('K2b (M14) module: edit, edit back to base, edit the other twin',()=>{
 const p=new CardTextProjection();const text=p.show(card('Same','same',details(A))+card('Same','same',details(B,'rose')));
 const at=text.lastIndexOf('same')+4;p.edit(text.slice(0,at)+'?'+text.slice(at),{start:at,end:at});p.edit(text,{start:at,end:at+1});
 const first=text.indexOf('same')+4;const out=p.edit(text.slice(0,first)+'!'+text.slice(first),{start:first,end:first});
 console.log('K2b',sh(metaOf(out)));assert.deepEqual(metaOf(out).map(r=>r.id),[A,B]);
});
test('K3 (M4e, revised by12592/7) a whole-range paste pairs Mid exactly and leaves rewritten Notes id-less',async t=>{
 const h=await text867(t,card('Notes','alpha',details(A))+card('Mid','mid',details(C,'green'))+card('Notes','beta',details(B,'rose')));
 const v=h.p.text.value,end=v.indexOf('beta')+4;
 const rows=h.input(0,end,'## Mid\n\nmid\n\n## Notes\n\nbeta!','insertFromPaste');console.log('K3',sh(rows));
 assert.deepEqual(rows.map(r=>[r.id,r.color]),[[C,'green'],[null,null]]);
});
