import test from 'node:test';
import assert from 'node:assert/strict';
import { openNotebookMenu, notebookReaderMenuItems } from '../web/notebook-menu.mjs';
import { NotebookRailMenu } from '../web/notebook-rail-menu.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';
import { notebookFixture } from './fixtures/notebook_sheet_dom.mjs';
import { documentPort } from './fixtures/card_text_867.mjs';

// DOM command/focus ports only; actual geometry, gestures and paint are native.
function menu() {
 const doc=documentPort(),anchor=doc.createElement('button');doc.body.append(anchor);
 const acts=[],items=[
  {key:'star',place:'mark',label:'Unstar',glyph:'starred',checked:true,act:()=>acts.push('star')},
  {key:'none',place:'swatch',label:'No colour',glyph:'palette',color:null,checked:true,act:()=>acts.push('none')},
  {key:'copy',place:'mark',label:'Copy link',glyph:'link',act:()=>acts.push('copy')},
  {key:'text',place:'view',label:'Text',glyph:'text',checked:false,act:()=>acts.push('text')},
  {key:'cards',place:'view',label:'Cards',glyph:'stack',checked:true,act:()=>acts.push('cards')},
  {key:'topic',place:'start',label:'Topic',glyph:'topic',act:()=>acts.push('topic')},
  {key:'dossier',place:'start',label:'Dossier',glyph:'dossier',act:()=>acts.push('dossier')},
  {key:'copytext',label:'Copy text',glyph:'copy',act:()=>acts.push('copytext')},
  {key:'delete',place:'danger',label:'Delete card',glyph:'drop',disabled:true,act:()=>acts.push('delete')},
  {key:'undo',place:'key',label:'Undo',glyph:'undo',keys:'⌘Z',act:()=>acts.push('undo')},
 ];
 const open=openNotebookMenu({doc,anchor,items,label:'This card',win:{innerWidth:1000,innerHeight:900}});
 return {doc,anchor,acts,items,open};
}
const buttons=root=>root.querySelectorAll('button');
test('1096 palette groups the same live action buttons and focuses the first state row',()=>{
 const {doc,open,items,acts}=menu();
 assert.equal(doc.activeElement.dataset.notebookAction,'text');
 assert.deepEqual(buttons(open.root).map(x=>x.dataset.notebookAction),items.map(x=>x.key));
 const swatch=buttons(open.root).find(b=>b.dataset.notebookAction==='none');
 assert.equal(swatch.getAttribute('aria-label'),'No colour');assert.equal(swatch.getAttribute('aria-pressed'),'true');assert.ok(swatch.classList.contains('no-colour'));
 const topic=buttons(open.root).find(b=>b.dataset.notebookAction==='topic');topic.onclick({stopPropagation(){}});assert.deepEqual(acts,['topic']);assert.equal(open.root.isConnected,false);
});
test('1096 left/right moves across enabled controls including keys, never a disabled Delete',()=>{
 const {doc,open}=menu();
 for(let n=0;n<10;n++){open.root.listeners.keydown({key:'ArrowRight',preventDefault(){},stopPropagation(){}});assert.notEqual(doc.activeElement.dataset.notebookAction,'delete');}
 assert.equal(doc.activeElement.dataset.notebookAction,'cards');open.close(false);
});
test('1096 Reader opens on Edit before an unkeyed layout extra and still honors an explicit focus key',()=>{
 const doc=documentPort(),anchor=doc.createElement('button');doc.body.append(anchor);
 const source={source_ref:{revision:4},reader_may_write:true,reader_may_delete:true};
 const items=[...notebookReaderMenuItems(source,()=>{}),{label:'Wide layout',glyph:'layout',act:()=>{}}];
 let opened=openNotebookMenu({doc,anchor,items,label:'This page',win:{innerWidth:1000,innerHeight:900}});
 assert.equal(doc.activeElement.dataset.notebookAction,'edit');opened.close(false);
 opened=openNotebookMenu({doc,anchor,items,label:'This page',focusKey:'rename',win:{innerWidth:1000,innerHeight:900}});
 assert.equal(doc.activeElement.dataset.notebookAction,'rename');opened.close(false);
});
test('1096 sheet pencil keeps Rename after its menu row moves away',async t=>{
 const f=notebookFixture(t);await f.sheet.open('p');const page=f.page;let renamed=0;
 page.writing={pageState:{},closed:false};page.rename=()=>renamed++;page.readOnly=false;page.menuItems=()=>[];
 f.sheet.renameButton.onclick();assert.equal(renamed,1);
 page.writing.readOnly=true;f.sheet.renameButton.onclick();assert.equal(renamed,1);
});
test('1096 unopened rail starts a dossier only on the rechecked loaded page',async()=>{
 const calls=[],source={source_ref:{id:'p'},reader_may_write:true,reader_may_delete:false,draft:false,owner_scope:{kind:'topic',id:'t'}};
 const loaded=Object.assign(Object.create(NotebookPage.prototype),{item:'p',writing:{pageState:source},readOnly:false,mode:'text',inNotebookSheet:true,drafted:()=>false,startNew:kind=>calls.push(kind)});
 let current=null;const rail=new NotebookRailMenu({loaded:()=>current,mode:()=> 'text',layout:()=>({}),current:()=>true,show:()=>calls.push('menu'),open:async()=>{current=loaded;return true;}});
 const choices=rail.items(source,()=>{});assert.ok(choices.some(x=>x.key==='rename'));
 await rail.act(source,'start-dossier','Dossier',{},null,{});assert.deepEqual(calls,['dossier']);
});

test('1096 retirement cancels the sheet media and active input subscriptions',async t=>{
 const f=notebookFixture(t);await f.sheet.open('p');f.sheet.setDocked(false);
 const owned=f.sheet.still;assert.ok(owned&&!owned.signal.aborted);
 let removed=0;f.media.removeEventListener=(name,callback)=>{assert.equal(name,'change');assert.equal(callback,f.sheet.resized);removed++;};
 f.sheet.retire();assert.equal(removed,1);assert.equal(owned.signal.aborted,true);assert.equal(f.sheet.listening.signal.aborted,true);
});
