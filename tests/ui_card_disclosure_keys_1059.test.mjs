import test from 'node:test';
import assert from 'node:assert/strict';
import {DeckPage} from '../web/deck-page.mjs';

function fixture(control=true,pill=true) {
  const row={querySelector:()=>pill?target:null};
  const target={closest:selector=>selector==='.deck-card'?row:control===true&&selector==='.deck-disclosure'||control==='bubble'&&selector==='.deck-bubble'?target:null};
  const calls=[],selected=new Set([0,1]);
  const page=Object.assign(Object.create(DeckPage.prototype),{host:{},doc:{body:{}},list:{contains:()=>true},
    deck:{cards:[{title:'A',words:'Kept.'}]},picked:0,selected,start:()=>calls.push('start'),edit:()=>calls.push('edit'),actOn:kind=>{calls.push(kind);return true;}});
  return {page,target,calls,selected};
}
for(const [name,key,extra]of [['Return','Enter',{}],['Command-Return','Enter',{metaKey:true}],['Space',' ',{}],['Tab','Tab',{}],['Shift-Tab','Tab',{shiftKey:true}]])
 test('1059 disclosure '+name+' retains native control activation without editing or selection changes',()=>{
  const f=fixture(),event={key,target:f.target,preventDefault(){this.defaultPrevented=true;},...extra};
  f.page.key(event);
  assert.deepEqual(f.calls,[]);assert.equal(event.defaultPrevented,undefined);assert.equal(f.page.selected,f.selected);
 });
test('1059 a card row still uses Return to create a new card',()=>{
 const f=fixture(false),event={key:'Enter',target:f.target,preventDefault(){this.defaultPrevented=true;}};
 f.page.key(event);assert.deepEqual(f.calls,['start']);assert.equal(event.defaultPrevented,true);
});
test('1059 native Tab from adjacent card controls can reach the pill without indenting the card',()=>{
 const f=fixture('bubble'),event={key:'Tab',target:f.target,preventDefault(){this.defaultPrevented=true;}};
 f.page.key(event);assert.deepEqual(f.calls,[]);assert.equal(event.defaultPrevented,undefined);
});
test('1059 the existing card Tab shortcut stays independent of the new control',()=>{
 for(const [kind,control,pill]of [['row',false,true],['old menu','bubble',false]]){
  const f=fixture(control,pill),event={key:'Tab',target:f.target,preventDefault(){this.defaultPrevented=true;}};
  f.page.key(event);assert.deepEqual(f.calls,['indent'],kind);assert.equal(event.defaultPrevented,true);
 }
});
