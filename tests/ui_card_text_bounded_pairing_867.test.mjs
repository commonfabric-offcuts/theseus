// Decision12614 replaces the removed M4e/M4f gap-pairing mutations with
// behavioral pins for the exact, occurrence-ordered pairing inside one edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { A, B, C, card, details, metaOf, text867 } from './fixtures/card_text_867.mjs';

const D='c-44444444444444444444444444444444';
const E='c-55555555555555555555555555555555';

test('867 R6 M4e boundary: a renamed replacement cannot borrow an exact card identity across an untouched anchor',async t=>{
  const prefix=card('Notes','alpha',details(A,'blue'))+card('Anchor','still here',details(C,'green'));
  const suffix=card('Tail','after',details(D,'rose'));
  const h=await text867(t,prefix+card('Other','alpha',details(B,'rose'))+suffix);
  const start=h.p.text.value.indexOf('## Other'),end=h.p.text.value.indexOf('## Tail');
  assert.ok(start>=0&&end>start);
  const rows=h.input(start,end,card('Notes','alpha',null),'insertFromPaste');
  assert.deepEqual(rows.map(r=>[r.id,r.color]),[[A,'blue'],[C,'green'],[null,null],[D,'rose']]);
  assert.ok(h.w.value.body.startsWith(prefix),'the outside donor and anchor retain their exact raw bytes');
  assert.ok(h.w.value.body.endsWith(suffix),'the following card retains its exact raw bytes');
  await h.w.flush();
  assert.deepEqual(metaOf(h.source().body).map(r=>r.id),[A,C,null,D]);
});

test('867 R6 M4f exactness: conflicting title and words matches cannot beat an exact local signature',async t=>{
  const prefix=card('Notes','beta',details(A,'blue'))+card('Anchor','still here',details(D,'green'));
  const suffix=card('Tail','after',details(E,'rose'));
  const h=await text867(t,prefix+card('Notes','alpha',details(B,'rose'))+card('Other','beta',details(C,'green'))+suffix);
  const start=h.p.text.value.indexOf('## Notes\n\nalpha'),end=h.p.text.value.indexOf('## Tail');
  assert.ok(start>=0&&end>start);
  // Notes/beta shares a title with B and words with C, but has no exact
  // match in the removed range. The other row is an exact C match.
  const rows=h.input(start,end,card('Notes','beta',null)+card('Other','beta',null),'insertFromPaste');
  assert.deepEqual(rows.map(r=>[r.id,r.color]),[[A,'blue'],[D,'green'],[null,null],[C,'green'],[E,'rose']]);
  assert.ok(h.w.value.body.startsWith(prefix),'the exact signature outside the replacement stays outside it');
  assert.ok(h.w.value.body.endsWith(suffix));
  await h.w.flush();
  assert.deepEqual(metaOf(h.source().body).map(r=>r.id),[A,D,null,C,E]);
});
