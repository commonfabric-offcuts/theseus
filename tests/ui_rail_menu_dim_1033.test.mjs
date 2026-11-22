import test from 'node:test';
import assert from 'node:assert/strict';
import { renderer799 } from './fixtures/renderer799.mjs';
import { RailDimming } from '../web/rail-dimming.mjs';
import { DimChoices } from '../web/dim-choices.mjs';
import { OutlineMenus } from '../web/outline-menus.mjs';
import { GLYPH_NAMES } from '../web/glyphs.mjs';
function fixture(kind='topic'){
 const {list}=renderer799(),doc=list.ownerDocument,shown=[],writes=[];doc.addEventListener=()=>{};
 doc.defaultView={location:{href:'https://scratch.invalid/?topic=other'}};
 const group=doc.createElement('li');group.className='ol-outcome';group.dataset.workspaceId='w';list.append(group);
 const row=doc.createElement('a');row.className=kind==='topic'?'nav-item':'ol-name';row.setAttribute('href','?'+kind);
 if(kind==='topic')row.dataset.topicId='t';else row.dataset.workspaceId='w';group.append(row);
 const c=new DimChoices({getItem:()=>null,setItem(){}});c.bind('scratch1033','reader');c.syncEdit=x=>writes.push(structuredClone(x));
 const dimming=Object.assign(Object.create(RailDimming.prototype),{host:list,doc,choices:c,enabled:()=>true,paint(){}});
 const topic={id:'t',title:'Topic',kind:'topic',reader_may_say:true,state:'active',owner_id:'reader'},workspace={id:'w',title:'Outcome',owner_id:'reader'};
 const handles={bootstrap:{instance_id:'scratch1033',actor:'reader'},readable:()=>true,view:async(name)=>({instance_id:'scratch1033',...(name==='topic'?{topic}:{workspace})})};
 const outline={list,doc,handles,dimming,outcomes:new Map(),message:doc.createElement('p'),open(){assert.fail('Dim must not navigate');}};
 const menus=new OutlineMenus(outline,{show:options=>{shown.push(options);return {close(){}};}});
 const open=async()=>{await menus.open(row);assert.ok(shown.at(-1),'existing rail menu opened');assert.ok(shown.at(-1).items.some(x=>x.key==='copy'),'existing Copy Link is present');return shown.at(-1).items.find(x=>x.key==='dim');};
 return {row,c,dimming,handles,outline,menus,writes,open};
}
for(const kind of ['topic','outcome'])test(`1033 ${kind} menu Dim and Undim use existing semantic writer`,async()=>{
 const f=fixture(kind),item=await f.open();assert.ok(item,'missing Dim menu door');assert.equal(item.label,'Dim');assert.ok(GLYPH_NAMES.includes(item.glyph));
 await item.act();assert.equal(f.c.dimmed('w',kind==='topic'?'t':null),true);assert.equal(f.writes.length,1);assert.equal(f.writes[0].kind,'choice');assert.equal(f.writes[0].topic,kind==='topic'?'t':null);
 const undo=await f.open();assert.equal(undo.label,'Undim');await undo.act();assert.equal(f.c.dimmed('w',kind==='topic'?'t':null),false);assert.equal(f.writes.length,2);
});
test('1033 menu and Command-click produce identical kept intent and selected-set state',async()=>{
 const a=fixture(),b=fixture();a.c.select(2);b.c.select(2);a.writes.length=b.writes.length=0;
 const item=await a.open();assert.ok(item);await item.act();b.dimming.act({target:b.row,shiftKey:false,preventDefault(){},stopPropagation(){}});
 assert.deepEqual(a.c.value,b.c.value);assert.deepEqual(a.writes,b.writes);assert.equal(a.c.selected,2);
});
test('1033 menu label reads existing choice rather than temporary waiting paint',async()=>{
 const f=fixture();f.c.toggle('w','t');f.row.dataset.dimmed='false';const item=await f.open();assert.ok(item);assert.equal(item.label,'Undim');
 f.c.toggle('w','t');assert.equal((await f.open()).label,'Dim');
});
test('1033 stale menu never toggles after navigation, access loss or row reuse',async()=>{
 for(const change of ['navigation','access','row']){const f=fixture(),item=await f.open();assert.ok(item);
  if(change==='navigation')f.outline.handles={...f.handles};if(change==='access')f.handles.readable=()=>false;if(change==='row')f.row.dataset.topicId='different';
  await item.act();assert.deepEqual(f.writes,[],change);
 }
});
test('1033 one public choice preserves owner target/readiness guards and inverse gesture',()=>{
 const f=fixture();assert.equal(typeof f.dimming.toggle,'function');const other=f.row.ownerDocument.createElement('a');assert.equal(f.dimming.toggle(other),false);
 f.dimming.enabled=()=>false;assert.equal(f.dimming.toggle(f.row),false);assert.deepEqual(f.writes,[]);f.dimming.enabled=()=>true;
 f.dimming.act({target:f.row,shiftKey:true,preventDefault(){},stopPropagation(){}});assert.equal(f.writes[0].kind,'inverse');assert.deepEqual(f.c.value.sets[0].focus,['w','t']);
});
