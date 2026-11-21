import test from 'node:test';
import assert from 'node:assert/strict';
import { card, details, A, B, menuPage, painted867, press867, choice867, parseDeck, DeckPage } from './fixtures/card_menu_867.mjs';

function page(t) {
  const p=painted867(t,menuPage(card('First','one',details(A))+card('Second','two',details(B))));
  p.room={agents:['fixture-agent'],topicId:'fixture-topic'};p.paint();
  return p;
}
function key(p,target,key,extra={}) {
  const event={target,key,preventDefault(){this.defaultPrevented=true;},...extra};
  p.key(event);return event;
}
const chat=menu=>menu.children.find(n=>n.textContent==='Chat about this…');

test('927 the real painted menu contains Chat and the card has no standalone ask glyph',t=>{
  const p=page(t);
  assert.equal(p.list.querySelector('.deck-ask'),null);
  const menu=press867(p,1);assert.ok(chat(menu));assert.equal(chat(menu).disabled,false);
  let asked=null;p.ask=at=>{asked=at;};choice867(menu,'Chat about this…');
  assert.equal(asked,1,'the pressed card owns chat even when another card is picked');
});
for(const mode of ['reorder','removed'])test(`927 a menu opened before its card is ${mode} resolves the same card`,t=>{
  const p=page(t), menu=press867(p,0);let asked=null;p.ask=at=>{asked=p.deck.cards[at].title;};
  p.deck=parseDeck(mode==='reorder'?card('Second','two',details(B))+card('First','one',details(A)):card('Second','two',details(B)));
  choice867(menu,'Chat about this…');assert.equal(asked,mode==='reorder'?'First':null);
});
for(const mode of ['readOnly','draft','no agents','asking'])test(`927 Chat is unavailable with ${mode}`,t=>{
  const p=page(t);
  if(mode==='readOnly')p.readOnly=true;
  if(mode==='draft')p.writing={value:{draft:true}};
  if(mode==='no agents')p.room=null;
  if(mode==='asking')p.asking={};
  const menu=press867(p,0);assert.equal(chat(menu)?.disabled,true);
  let asked=false;p.ask=()=>{asked=true;};chat(menu).onclick({stopPropagation(){}});assert.equal(asked,false);
});
for(const [name,extra] of [['ContextMenu',{}],['F10',{shiftKey:true}]])test(`927 ${name} opens the focused card menu; arrows stay in the menu and Escape restores the card`,t=>{
  const p=page(t),row=p.list.children[1];row.focus();
  assert.equal(key(p,row,name,extra).defaultPrevented,true);
  const menu=p.doc.body.querySelector('[role="menu"]');assert.ok(menu);assert.equal(p.doc.activeElement.textContent,'Copy text');
  const menuKey=key=>menu.listeners.keydown({key,stopPropagation(){},preventDefault(){}});
  menuKey('ArrowDown');assert.equal(p.doc.activeElement.textContent,'Copy link');
  menuKey('ArrowUp');assert.equal(p.doc.activeElement.textContent,'Copy text');
  menuKey('End');assert.equal(p.doc.activeElement,chat(menu));
  menuKey('Escape');assert.equal(menu.isConnected,false);assert.equal(p.doc.activeElement,row);
  assert.equal(p.picked,1,'cursor control continues from the menu card');
  key(p,row,'ArrowUp');assert.equal(p.picked,0);
});
test('927 menu keys leave card writing, chat writing, and modified F10 alone',t=>{
  const p=page(t),field=p.doc.createElement('textarea');p.doc.body.append(field);
  p.editing={field,input:{writingKey:()=>false,indentKey:()=>false}};
  assert.equal(key(p,field,'F10',{shiftKey:true}).defaultPrevented,undefined);p.editing=null;
  p.asking={form:field,field};assert.equal(key(p,field,'F10',{shiftKey:true}).defaultPrevented,undefined);p.asking=null;
  for(const extra of [{},{shiftKey:true,metaKey:true},{shiftKey:true,ctrlKey:true},{shiftKey:true,altKey:true}])
    assert.equal(key(p,p.list.children[0],'F10',extra).defaultPrevented,undefined);
  assert.equal(p.doc.body.querySelector('[role="menu"]'),null);
});
test('927 existing conversation links still show and Chat invokes the existing composer',t=>{
  const p=page(t),controls=p.bubbles(0,[{topicId:'fixture-topic',messageId:'fixture-message'}]);
  assert.ok(controls.querySelector('a.deck-bubble'));assert.ok(controls.querySelector('.deck-menu'));
  assert.equal(controls.querySelector('.deck-ask'),null);
  const menu=press867(p,0), chosen=chat(menu);assert.ok(chosen);
  // The availability is checked again by the existing composer at activation.
  p.readOnly=true;choice867(menu,'Chat about this…');assert.equal(p.asking,undefined);
  assert.equal(p.ask,DeckPage.prototype.ask);
});
