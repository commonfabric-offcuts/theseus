import test from 'node:test';
import assert from 'node:assert/strict';
import {DeckPage} from '../web/deck-page.mjs';
import {parseDeck,deckBody} from '../web/deck.mjs';

// Real owner and deck state with bounded paint/field ports; native input is
// separately exercised by cards_link_return_990_native.mjs.
function fixture() {
  const body='## First\n\n[Destination](?topic=landing)\n\n## Last\n';
  const p=Object.assign(Object.create(DeckPage.prototype),{host:{},doc:{body:{}},
    list:{contains:()=>true},base:{body},deck:parseDeck(body),picked:0,
    selected:new Set(),folded:new Set(),acts:[],readOnly:false,show(){},paint(){},
    open(editing){this.editing=editing;}});
  return p;
}
function key(p,target,extra={}) {
  const event={key:'Enter',target,preventDefault(){this.defaultPrevented=true;},...extra};
  p.key(event);return event;
}
const anchor={closest:selector=>selector==='a[href]'?anchor:null};
for(const [label,mods] of [['plain',{}],['Command',{metaKey:true}],['Control',{ctrlKey:true}],
  ['Option',{altKey:true}],['Shift',{shiftKey:true}]]) {
  test(`990 ${label} Return on a focused anchor leaves native activation and saved cards intact`,()=>{
    const p=fixture(),before=deckBody(p.deck),event=key(p,anchor,mods);
    assert.equal(Boolean(event.defaultPrevented),false);
    assert.equal(p.editing,undefined,'link Return must not start or edit a card');
    assert.equal(deckBody(p.deck),before);assert.deepEqual(p.acts,[]);
  });
}
for(const target of ['row','anchor without href'])test('990 Return on '+target+' still starts a fresh card',()=>{
  const p=fixture(),before=deckBody(p.deck),event=key(p,{closest:()=>null});
  assert.equal(event.defaultPrevented,true);assert.equal(p.editing.fresh,true);
  assert.equal(p.editing.text,'');assert.equal(deckBody(p.deck),before);
});
test('990 Return in writing keeps its newline default and exact field',()=>{
  const p=fixture(),field={value:'Kept words',closest:()=>null};
  p.editing={field,input:{writingKey:()=>false,indentKey:()=>false}};
  const editing=p.editing,event=key(p,field);
  assert.equal(Boolean(event.defaultPrevented),false);assert.equal(p.editing,editing);
  assert.equal(field.value,'Kept words');
});
test('990 anchor arrow remains the deck navigation key',()=>{
  const p=fixture(),moves=[];p.pick=index=>moves.push(index);
  const event=key(p,anchor,{key:'ArrowDown'});
  assert.equal(event.defaultPrevented,true);assert.deepEqual(moves,[1]);
});
test('990 speech-bubble Return keeps its native control default',()=>{
  const p=fixture(),bubble={closest:s=>s==='.deck-bubble'?bubble:null};
  assert.equal(Boolean(key(p,bubble).defaultPrevented),false);assert.equal(p.editing,undefined);
});
