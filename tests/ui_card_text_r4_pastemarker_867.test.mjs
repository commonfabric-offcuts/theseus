// Retained paste-marker review probes. Decision12604 moves reprojection to the input itself;
// the next sync leaves the textarea alone. Drives the real NotebookPage Text listeners.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, hidden, A, B, C, metaOf, stripDetails, parseDeck, cardDetails } from './fixtures/card_text_867.mjs';

function watchValue(p){
  let writes=0,value=p.text.value;
  Object.defineProperty(p.text,'value',{configurable:true,get:()=>value,set:v=>{writes++;value=v;}});
  return {get writes(){return writes;},get value(){return value;}};
}
const summary=rows=>rows.map(r=>[r.title,r.id,r.aliases,r.color]);

async function pasteProbe(t,label,raw,target,pasted){
  const {p,w,input}=await text867(t,raw);
  const at=p.text.value.indexOf(target)+target.length;
  const beforeText=p.text.value;
  const rows=input(at,at,pasted,'insertFromPaste');
  const textHasMarker=p.text.value.includes('theseus-card');
  const visibleEqual=stripDetails(w.value.body)===p.text.value;
  const watch=watchValue(p);p.doc.activeElement=p.text;p.text.selectionStart=p.text.selectionEnd=at+pasted.length;
  p.sync();
  console.log(`[${label}] body after paste: ${JSON.stringify(w.value.body)}`);
  console.log(`[${label}] meta after paste: ${JSON.stringify(summary(rows))}`);
  console.log(`[${label}] textarea holds marker text after paste: ${textHasMarker}; stripDetails(body)===textarea: ${visibleEqual}`);
  console.log(`[${label}] sync() writes to text.value: ${watch.writes}; textarea after sync: ${JSON.stringify(watch.value)}`);
  console.log(`[${label}] textarea after sync === textarea before paste: ${watch.value===beforeText}; dirty=${w.dirty}`);
  return {p,w,input,rows,writes:watch.writes,value:watch.value,beforeText,textHasMarker,visibleEqual};
}

test('P1 claim: valid marker pasted after an UNIDENTIFIED card\'s words',async t=>{
  const r=await pasteProbe(t,'P1',card('One','one words',null)+card('Two','two words',details(A)),'one words','\n\n'+hidden(details(B,'rose')));
  assert.equal(r.rows[0].id,B);assert.equal(r.rows[0].color,'rose');
  assert.equal(r.textHasMarker,false,'12604: valid marker is hidden immediately');
  assert.equal(r.visibleEqual,true,'12604: projection agrees before sync');
  assert.equal(r.writes,0,'12604: next sync must not rewrite the projected textarea');
  assert.equal(r.value.includes('theseus-card'),false);
});
test('P2 variant: valid marker pasted after an IDENTIFIED card\'s words (two marker lines)',async t=>{
  const r=await pasteProbe(t,'P2',card('One','one words',details(A))+card('Two','two words',details(C)),'one words','\n\n'+hidden(details(B,'rose')));
  console.log('[P2] detail lines on One:',JSON.stringify(cardDetails(parseDeck(r.w.value.body).cards[0].words).lines));
});
test('P3 control: the same marker pasted INSIDE a fence stays words and sync leaves the textarea alone',async t=>{
  const r=await pasteProbe(t,'P3',card('One','```\ncode\n```',null)+card('Two','two words',details(A)),'code','\n'+hidden(details(B,'rose')));
  assert.equal(r.rows[0].id,null);assert.equal(r.writes,0);
});
test('P4 control: an INVALID marker (missing color) pasted outside a fence stays words and sync leaves the textarea alone',async t=>{
  const r=await pasteProbe(t,'P4',card('One','one words',null)+card('Two','two words',details(A)),'one words','\n\n<!-- theseus-card: {"id":"'+B+'","aliases":[]} -->');
  assert.equal(r.rows[0].id,null);assert.equal(r.writes,0);
});
test('P5 control: an ordinary paste (no marker) never makes sync rewrite',async t=>{
  const r=await pasteProbe(t,'P5',card('One','one words',null)+card('Two','two words',details(A)),'one words','\n\npasted paragraph  ');
  assert.equal(r.writes,0);
});
test('P6 after the paste: a confirmed save, then a keystroke, keeps the pasted identity; Text still shows no marker',async t=>{
  const {p,w,input}=await text867(t,card('One','one words',null)+card('Two','two words',details(A)));
  const at=p.text.value.indexOf('one words')+9;input(at,at,'\n\n'+hidden(details(B,'rose')),'insertFromPaste');
  await w.flush();p.sync();
  console.log('[P6] textarea after save+sync:',JSON.stringify(p.text.value));
  const rows=input(at,at,'!');console.log('[P6] meta after keystroke:',JSON.stringify(summary(rows)));
  assert.equal(rows[0].id,B);assert.equal(p.text.value.includes('theseus-card'),false);
  assert.equal(stripDetails(w.value.body),p.text.value);
});
test('P7 the same rule in the Cards writer: a marker typed into the card editor box is metadata, and the box leaves it out',async t=>{
  const { DeckPage } = await import('../web/deck-page.mjs');
  const { boxText } = await import('../web/deck.mjs');
  const written=boxText({written:'One\none words\n\n'+hidden(details(B,'rose')),details:[]});
  const deck=parseDeck('## '+written+'\n');
  const shown=DeckPage.prototype.written.call({},deck.cards[0]);
  console.log('[P7] card words via editor:',JSON.stringify(deck.cards[0].words),'-> shown:',JSON.stringify(shown));
  assert.equal(cardDetails(deck.cards[0].words).id,B);assert.equal(shown.words.includes('theseus-card'),false);
});
