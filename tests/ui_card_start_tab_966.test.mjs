import test from 'node:test';
import assert from 'node:assert/strict';
import {cardText, deckBody, parseDeck} from '../web/deck.mjs';
import {DeckPage} from '../web/deck-page.mjs';
import {WritingInput} from '../web/writing-input.mjs';

// Real deck and writing handlers with bounded field/paint ports; not native gestures.
function page(body='## Parent\n\n## Card\n\n- one\n- two\n\n### Child\n\n## Last\n') {
  const p=Object.assign(Object.create(DeckPage.prototype),{host:{},doc:{body:{}},list:{contains:()=>true},
    base:{body},deck:parseDeck(body),picked:1,selected:new Set(),folded:new Set(),acts:[],undos:[],header:{description:{}},
    readOnly:false,paint(){},show(){},save(){},keepFolds(){},holdPage:()=>()=>{}});
  p.open=e=>{
    const handlers=[],field={value:e.shown??e.text,selectionStart:0,selectionEnd:0,
      addEventListener(name,fn){handlers.push([name,fn]);},
      setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
      setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.setSelectionRange(start+text.length,start+text.length);},
      dispatchEvent(event){for(const [name,fn] of handlers)if(name===event.type)fn(event);}};
    field.ownerDocument={execCommand(_kind,_ui,text){field.setRangeText(text,field.selectionStart,field.selectionEnd);field.dispatchEvent({type:'input'});return true;}};
    p.editing={...e,field,input:new WritingInput({field,mac:true})};
  };
  p.write=(at=1)=>{p.picked=at;const card=p.deck.cards[at];p.open({text:cardText(card),near:at,depth:card.depth,fresh:false});};
  return p;
}
function key(p,extra={}){const e={key:'Tab',target:p.editing?.field,preventDefault(){this.defaultPrevented=true;},...extra};p.key(e);return e;}
const depths=p=>p.deck.cards.map(c=>c.depth);

test('966 collapsed zero caret moves the saved card with children and exact undo',()=>{
  const p=page(),original=deckBody(p.deck);p.write();const e=p.editing,f=e.field,before=f.value;
  assert.equal(key(p).defaultPrevented,true);assert.deepEqual(depths(p),[0,1,2,0]);
  assert.equal(p.editing,e);assert.equal(f.value,before);assert.deepEqual([f.selectionStart,f.selectionEnd],[0,0]);
  assert.equal(p.acts.at(-1).kind,'indent');
  key(p,{shiftKey:true});assert.equal(deckBody(p.deck),original);assert.equal(p.acts.at(-1).kind,'outdent');
  key(p);p.editing=null;p.undo();assert.equal(deckBody(p.deck),original);
});
test('966 Command-Return finishes, then display Return and Tab place the empty new box under the preceding card',()=>{
  const p=page();p.write();key(p,{key:'Enter',metaKey:true});assert.equal(p.editing,null);
  key(p,{key:'Enter',target:p.list});const e=p.editing,f=e.field;
  assert.equal(e.fresh,true);assert.equal(f.value,'');assert.equal(e.depth,0);
  key(p);assert.equal(e.depth,1);assert.equal(f.value,'');assert.equal(p.editing,e);
  f.value='New card';key(p,{key:'Escape'});
  assert.deepEqual(p.deck.cards.map(c=>[c.title,c.depth]),[['Parent',0],['Card',0],['Child',1],['New card',1],['Last',0]]);
});
test('966 fresh indent then outdent changes only placement until words exist',()=>{
  const p=page(),before=deckBody(p.deck);p.start();const e=p.editing;
  key(p);assert.equal(e.depth,1);key(p,{shiftKey:true});assert.equal(e.depth,0);
  assert.equal(deckBody(p.deck),before);assert.deepEqual(p.acts,[]);assert.equal(e.field.value,'');
});
for(const fresh of [false,true])for(const shift of [false,true])test(`966 blocked ${fresh?'fresh':'saved'} ${shift?'top-level outdent':'first indent'} keeps exact words and zero caret`,()=>{
  const p=page();if(fresh){p.picked=0;p.start(true);}else p.write(0);
  const e=p.editing,before=e.field.value,body=deckBody(p.deck);key(p,{shiftKey:shift});
  assert.equal(e.field.value,before);assert.equal(e.depth,0);assert.equal(deckBody(p.deck),body);
  assert.deepEqual([e.field.selectionStart,e.field.selectionEnd],[0,0]);assert.deepEqual(p.acts,[]);
});
for(const where of ['inside title','line start','selection from zero'])test('966 line indentation unchanged for '+where,()=>{
  const p=page();p.write();const f=p.editing.field,before=f.value;
  const at=where==='inside title'?2:where==='line start'?before.indexOf('- two'):0,end=where==='selection from zero'?4:at;
  f.setSelectionRange(at,end);key(p);assert.deepEqual(depths(p),[0,0,1,0]);assert.deepEqual(p.acts,[]);
  assert.notEqual(f.value,before);key(p,{shiftKey:true});assert.equal(f.value,before);
});
for(const fresh of [false,true])for(const guard of ['page readonly','field readonly','writer readonly','missing base','meta','ctrl','alt','composition','229','prevented','foreign','hidden'])test(`966 ${fresh?'fresh':'saved'} shortcut guard: ${guard}`,()=>{
  const p=page();if(fresh)p.start();else p.write();const e=p.editing,f=e.field,before=f.value,body=deckBody(p.deck),extra={};
  if(guard==='page readonly')p.readOnly=true;
  if(guard==='field readonly')f.readOnly=true;
  if(guard==='writer readonly')e.input.surfaceReadOnly=()=>true;
  if(guard==='missing base')p.base=null;
  if(guard==='meta')extra.metaKey=true;
  if(guard==='ctrl')extra.ctrlKey=true;
  if(guard==='alt')extra.altKey=true;
  if(guard==='composition')extra.isComposing=true;
  if(guard==='229')extra.keyCode=229;
  if(guard==='prevented')extra.defaultPrevented=true;
  if(guard==='foreign')extra.target={};
  if(guard==='hidden')p.host.hidden=true;
  key(p,extra);assert.equal(f.value,before);assert.equal(p.editing,e);assert.equal(e.depth,0);
  assert.equal(deckBody(p.deck),body);assert.deepEqual(p.acts,[]);
});
