import test from 'node:test';
import assert from 'node:assert/strict';
import {DeckPage} from '../web/deck-page.mjs';
import {NotebookPage} from '../web/notebook-page.mjs';
import {WritingInput} from '../web/writing-input.mjs';
import {cardText,deckBody,parseDeck} from '../web/deck.mjs';

// Real card/text owners with bounded field, paint and display ports. Native
// focus, selection movement and persistence are checked in the separate harness.
function fixture(body='## Parent\n\n### Card\n\n- one\n- two\n\n## Last\n') {
  const p=Object.assign(Object.create(DeckPage.prototype),{host:{},doc:{body:{}},list:{contains:()=>true},
    base:{body},deck:parseDeck(body),picked:1,selected:new Set(),folded:new Set(),acts:[],undos:[],
    header:{description:{}},readOnly:false,paint(){},show(focus){this.shown={picked:this.picked,focus};},save(){},keepFolds(){},holdPage:()=>()=>{}});
  p.open=e=>{
    const handlers=[],field={value:e.shown??e.text,selectionStart:0,selectionEnd:0,
      addEventListener(name,fn){handlers.push([name,fn]);},
      setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
      setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.setSelectionRange(start+text.length,start+text.length);},
      dispatchEvent(event){for(const [name,fn]of handlers)if(name===event.type)fn(event);}};
    field.ownerDocument={execCommand(_kind,_ui,text){field.setRangeText(text,field.selectionStart,field.selectionEnd);field.dispatchEvent({type:'input'});return true;}};
    p.editing={...e,field,input:new WritingInput({field,mac:true})};
  };
  p.write=(at=1)=>{p.picked=at;const card=p.deck.cards[at];p.open({text:cardText(card),shown:cardText(card),near:at,depth:card.depth,fresh:false});};
  return p;
}
const key=(p,name,extra={})=>{const e={key:name,target:p.editing?.field,preventDefault(){this.defaultPrevented=true;},...extra};p.key(e);return e;};
const end=f=>f.setSelectionRange(f.value.length,f.value.length);

for(const name of ['ArrowLeft','ArrowRight'])test(`1058 ${name} at its collapsed leaf boundary finishes the same card`,()=>{
  const p=fixture();p.write();const f=p.editing.field;if(name==='ArrowRight')end(f);
  const before=deckBody(p.deck);assert.equal(key(p,name).defaultPrevented,true);
  assert.equal(p.editing,null);assert.equal(p.picked,1);assert.deepEqual(p.shown,{picked:1,focus:true});
  assert.equal(deckBody(p.deck),before);assert.deepEqual(p.acts,[]);
});
test('1058 end Shift-Tab outdents the card and its subtree while preserving its editor and exact Undo',()=>{
  const p=fixture('## Parent\n\n### Card\n\n- one\n- two\n\n#### Child\n\nKept.\n\n## Last\n');p.write();
  const original=deckBody(p.deck),e=p.editing,f=e.field;end(f);const before=[f.value,f.selectionStart,f.selectionEnd];
  assert.equal(key(p,'Tab',{shiftKey:true}).defaultPrevented,true);
  assert.deepEqual(p.deck.cards.map(c=>c.depth),[0,0,1,0]);assert.equal(p.editing,e);
  assert.deepEqual([f.value,f.selectionStart,f.selectionEnd],before);assert.equal(p.acts.at(-1).kind,'outdent');
  p.editing=null;p.undo();assert.equal(deckBody(p.deck),original);
});
for(const name of ['ArrowLeft','ArrowRight'])for(const folded of [false,true])test(`1058 ${name} finishes a parent without toggling its ${folded?'folded':'open'} subtree`,()=>{
  const p=fixture('## Parent\n\nWords.\n\n### Child\n\n## Last\n');p.write(0);if(folded)p.folded.add('Parent');
  const f=p.editing.field;if(name==='ArrowRight')end(f);key(p,name);
  assert.equal(p.editing,null);assert.equal(p.picked,0);assert.equal(p.folded.has('Parent'),folded);
});
for(const name of ['ArrowLeft','ArrowRight'])test(`1058 ${name} finishes changed words through the real card act`,()=>{
  const p=fixture();p.write();const f=p.editing.field;f.value+=' kept';if(name==='ArrowRight')end(f);else f.setSelectionRange(0,0);
  key(p,name);assert.equal(p.editing,null);assert.equal(p.picked,1);assert.equal(p.acts.at(-1).kind,'edit');
  assert.equal(cardText(p.deck.cards[1]),'Card\n- one\n- two kept');
});
for(const name of ['ArrowLeft','ArrowRight'])test(`1058 empty fresh ${name} finishes without creating a blank card`,()=>{
  const p=fixture(),before=deckBody(p.deck);p.start();key(p,name);
  assert.equal(p.editing,null);assert.equal(deckBody(p.deck),before);assert.deepEqual(p.acts,[]);
});
test('1058 end outdent of fresh words changes placement then saves there on finish',()=>{
  const p=fixture();p.picked=1;p.start();const e=p.editing,f=e.field;f.value='Fresh';end(f);
  key(p,'Tab',{shiftKey:true});assert.equal(p.editing,e);assert.equal(e.depth,0);assert.equal(f.value,'Fresh');
  assert.deepEqual([f.selectionStart,f.selectionEnd],[5,5]);assert.deepEqual(p.acts,[]);
  key(p,'Escape');assert.deepEqual(p.deck.cards.map(c=>[c.title,c.depth]),[['Parent',0],['Card',1],['Fresh',0],['Last',0]]);
});
for(const guard of ['top-level','page readonly','field readonly','writer readonly','missing base'])test('1058 end outdent blocked by '+guard+' preserves editor and words',()=>{
  const p=fixture();p.write(guard==='top-level'?0:1);const e=p.editing,f=e.field;end(f);const before=deckBody(p.deck),range=[f.selectionStart,f.selectionEnd];
  if(guard==='page readonly')p.readOnly=true;if(guard==='field readonly')f.readOnly=true;
  if(guard==='writer readonly')e.input.surfaceReadOnly=()=>true;if(guard==='missing base')p.base=null;
  key(p,'Tab',{shiftKey:true});assert.equal(p.editing,e);assert.equal(deckBody(p.deck),before);
  assert.deepEqual([f.selectionStart,f.selectionEnd],range);assert.equal(f.value,e.shown);assert.deepEqual(p.acts,[]);
});
for(const name of ['ArrowLeft','ArrowRight'])for(const guard of ['interior','selection','shift','meta','ctrl','alt','composition','229','prevented','foreign','hidden'])test(`1058 ${name} boundary guard: ${guard}`,()=>{
  const p=fixture();p.write();const e=p.editing,f=e.field;end(f);if(name==='ArrowLeft')f.setSelectionRange(0,0);
  const extra={};if(guard==='interior')f.setSelectionRange(3,3);if(guard==='selection')f.setSelectionRange(0,f.value.length);
  if(['shift','meta','ctrl','alt'].includes(guard))extra[guard+'Key']=true;
  if(guard==='composition')extra.isComposing=true;if(guard==='229')extra.keyCode=229;
  if(guard==='prevented')extra.defaultPrevented=true;if(guard==='foreign')extra.target={};if(guard==='hidden')p.host.hidden=true;
  key(p,name,extra);assert.equal(p.editing,e);assert.equal(f.value,e.shown);assert.deepEqual(p.acts,[]);
});
test('1058 selections reaching either end keep line Shift-Tab semantics and card placement',()=>{
  const p=fixture();p.write();const e=p.editing,f=e.field;f.setSelectionRange(0,f.value.length);
  key(p,'Tab',{shiftKey:true});assert.equal(p.editing,e);assert.deepEqual(p.acts,[]);assert.equal(p.deck.cards[1].depth,1);
});
for(const name of ['ArrowLeft','ArrowRight'])test(`1058 Notebook ${name} finishes without propagating to spatial navigation`,()=>{
  const p=fixture();Object.setPrototypeOf(p,NotebookPage.prototype);p.mode='cards';p.write();if(name==='ArrowRight')end(p.editing.field);
  const e=key(p,name,{stopPropagation(){this.stopped=true;}});
  assert.equal(e.stopped,true);assert.equal(e.defaultPrevented,true);assert.equal(p.editing,null);assert.equal(p.shown.picked,1);
});
