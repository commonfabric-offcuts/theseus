import test from 'node:test';import assert from 'node:assert/strict';
import { text867, card, details, A, B, metaOf } from './fixtures/card_text_867.mjs';
const show=b=>JSON.stringify(b);
test('peek: CRLF all identified, type then undo: intermediate bodies',async t=>{
 const raw=('# Page\n\nopening\n\n'+card('Old','no id',details(A))+card('Two','two',details(B,'rose'))).replaceAll('\n','\r\n');
 const h=await text867(t,raw);const at=h.p.text.value.indexOf('no id')+5;
 h.input(at,at,'!');console.log('typed  ',show(h.w.value.body));
 h.input(at,at+1,'','historyUndo');console.log('undone ',show(h.w.value.body));console.log('equal raw',h.w.value.body===raw);
 assert.equal(h.w.value.body,raw);assert.equal(h.w.dirty,false,'exact raw Undo owes no revision');
});
