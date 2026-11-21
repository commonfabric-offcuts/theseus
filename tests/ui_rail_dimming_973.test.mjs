import test from 'node:test';
import assert from 'node:assert/strict';
import { DimChoices, dimmingKey } from '../web/rail-dimming.mjs';
const storage = () => { const rows = new Map(); return { rows, getItem: key => rows.get(key) ?? null, setItem: (key,value) => rows.set(key,value) }; };
function choices(kept=storage(), instance='fixture', actor='reader') { const c=new DimChoices(kept); c.bind(instance,actor); return c; }
test('973 starts at0, a toggle edits1, and an outcome includes topics loaded later',()=>{
 const c=choices(); assert.equal(c.selected,0); assert.equal(c.dimmed('w','t'),false);
 c.toggle('w'); assert.equal(c.selected,1); assert.equal(c.dimmed('w'),true); assert.equal(c.dimmed('w','later'),true); assert.equal(c.dimmed('else','t'),false);
 c.toggle('w'); assert.equal(c.dimmed('w'),false); assert.equal(c.dimmed('w','later'),false);
});
test('973 one topic changes alone, an outcome edit resets its child overrides, a child can be restored',()=>{
 const c=choices(); c.toggle('w','a'); assert.equal(c.dimmed('w'),false); assert.equal(c.dimmed('w','a'),true); assert.equal(c.dimmed('w','b'),false);
 c.toggle('w'); assert.equal(c.dimmed('w','a'),true); assert.equal(c.dimmed('w','b'),true);
 c.toggle('w','a'); assert.equal(c.dimmed('w','a'),false); assert.equal(c.dimmed('w','b'),true);
 c.toggle('w'); assert.equal(c.dimmed('w','a'),false); assert.equal(c.dimmed('w','b'),false);
});
test('973 inverse topic keeps its outcome and only that topic bright, including future outcomes',()=>{
 const c=choices(); c.toggle('w','a',true); assert.equal(c.selected,1); assert.equal(c.dimmed('w'),false); assert.equal(c.dimmed('w','a'),false);
 assert.equal(c.dimmed('w','sibling'),true); assert.equal(c.dimmed('future'),true); assert.equal(c.dimmed('future','later'),true);
 c.toggle('future'); assert.equal(c.dimmed('future','later'),false); assert.equal(c.dimmed('w','sibling'),true);
});
test('973 inverse outcome keeps its entire branch and resets only the current set',()=>{
 const c=choices(); c.toggle('old','topic'); c.toggle('w',null,true); assert.equal(c.dimmed('w','any'),false); assert.equal(c.dimmed('old','topic'),true); assert.equal(c.dimmed('other'),true);
});
test('973 two independent views survive switching,0 reveals all and editing0 returns to1',()=>{
 const c=choices(); c.toggle('w','a'); c.select(2); assert.equal(c.dimmed('w','a'),false); c.toggle('w','b'); c.select(1);
 assert.equal(c.dimmed('w','a'),true); assert.equal(c.dimmed('w','b'),false); c.select(0); assert.equal(c.dimmed('w','a'),false);
 c.toggle('w','b'); assert.equal(c.selected,1); assert.equal(c.dimmed('w','a'),true); assert.equal(c.dimmed('w','b'),true);
 c.select(2); assert.equal(c.dimmed('w','a'),false); assert.equal(c.dimmed('w','b'),true);
});
test('973 reload keeps the selected set while another actor, instance or browser sees none',()=>{
 const s=storage(),c=choices(s); c.select(2); c.toggle('w'); const reloaded=choices(s); assert.equal(reloaded.selected,2); assert.equal(reloaded.dimmed('w','t'),true);
 for(const other of [choices(s,'fixture','another'),choices(s,'another','reader'),choices()]) {assert.equal(other.selected,0);assert.equal(other.dimmed('w'),false);}
 assert.notEqual(dimmingKey('fixture','reader'),dimmingKey('fixture','another'));
});
test('973 unavailable storage retains this page and same-binding ready does not erase it',()=>{
 const s={getItem(){throw Error('denied');},setItem(){throw Error('full');}},c=choices(s); assert.equal(c.selected,0); c.toggle('w'); assert.equal(c.dimmed('w'),true); assert.equal(c.kept,false);
 c.bind('fixture','reader'); assert.equal(c.dimmed('w'),true); c.bind('fixture','different'); assert.equal(c.dimmed('w'),false);
});
test('973 malformed or foreign-version saved state starts undimmed and cannot inject ids',()=>{
 const s=storage(); for(const raw of ['{','null','[]',JSON.stringify({version:2,selected:1}),JSON.stringify({version:1,selected:3,sets:[]}),JSON.stringify({version:1,selected:1,sets:[{focus:null,outcomes:[['w',true],['w',false]],topics:[]}, {focus:null,outcomes:[],topics:[]}]})]) {
 s.rows.set(dimmingKey('fixture','reader'),raw); const c=choices(s); assert.equal(c.selected,0); assert.equal(c.dimmed('w'),false);
 }
});
test('973 another tab refresh uses current storage, not a late event payload',()=>{
 const s=storage(),a=choices(s),b=choices(s); a.toggle('w','a'); b.refresh(); assert.equal(b.dimmed('w','a'),true);
 b.toggle('w','b'); a.refresh(); assert.equal(a.dimmed('w','b'),true); assert.equal(a.dimmed('w','a'),true);
});
test('973 invalid choices or incomplete bindings change no view or storage',()=>{
 const s=storage(),c=new DimChoices(s); assert.equal(c.toggle('w'),false); assert.equal(s.rows.size,0); c.bind('fixture','reader');
 for(const n of [-1,3,'1',null])assert.equal(c.select(n),false);
 for(const args of [[''],[null],['w',''],['w','t\n']])assert.equal(c.toggle(...args),false);
 assert.equal(c.selected,0); assert.equal(s.rows.size,0);
});
