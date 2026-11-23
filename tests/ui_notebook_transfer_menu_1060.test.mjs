import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookDestinations,chooseNotebookDestination} from '../web/notebook-transfer.mjs';
import {NotebookPage,notebookMenuItems} from '../web/notebook-page.mjs';

test('1060 destination reads follow actual source outcome and page topics without a write',async()=>{
 const calls=[],read=async(name,args)=>{calls.push([name,args]);return name==='topic'?{topic:{id:'source',workspace_id:'outcome'}}:name==='workspace'?{workspace:{id:'outcome',title:'Outcome'}}:{items:[{id:'a',title:'A'}],next_cursor:'next'};};
 const list=await notebookDestinations(read,{kind:'topic',id:'source'},'previous');
 assert.deepEqual(list,{outcome:{scope:{kind:'workspace',id:'outcome'},label:'Outcome'},topics:[{scope:{kind:'topic',id:'a'},label:'A'}],cursor:'next'});
 assert.deepEqual(calls.at(-1),['workspace_topics',{workspace_id:'outcome',limit:50,cursor:'previous'}]);assert.equal(calls.length,3);
});
test('1060 current Notebook move is disabled while same Notebook copy stays available',async()=>{
 const actions=[],w={pageState:{owner_scope:{kind:'workspace',id:'w'}}},page={writing:w,doc:{},more:{},say:assert.fail,
  read:async name=>name==='workspace'?{workspace:{id:'w',title:'W'}}:{items:[],next_cursor:null},transferPage:(kind,scope)=>actions.push([kind,scope])};
 let menu;await chooseNotebookDestination(page,'memory.move',null,m=>menu=m);assert.equal(menu.items[0].disabled,true);
 await chooseNotebookDestination(page,'memory.copy',null,m=>menu=m);assert.equal(menu.items[0].disabled,false);menu.items[0].act();assert.deepEqual(actions,[['memory.copy',{kind:'workspace',id:'w'}]]);
});
test('1060 a departed writer cannot open or act on a destination picker',async()=>{
 let release,shown=false;const w={pageState:{owner_scope:{kind:'workspace',id:'w'}}},page={writing:w,doc:{},more:{},say:assert.fail,
  read:async name=>{if(name==='workspace')await new Promise(r=>release=r);return name==='workspace'?{workspace:{id:'w',title:'W'}}:{items:[]};}};
 const load=chooseNotebookDestination(page,'memory.move',null,()=>shown=true);w.closed=true;release();await load;assert.equal(shown,false);
});
test('1060 Done and Archived destinations stay scoped, paged and explicitly chosen',async()=>{
 for(const list of ['done','archived']){const reads=[];await notebookDestinations(async(name,args)=>{reads.push([name,args]);return name==='workspace'?{workspace:{id:'w',title:'W'}}:{items:[]};},{kind:'workspace',id:'w'},'cursor',list);
  assert.deepEqual(reads.at(-1),['workspace_topics',{workspace_id:'w',limit:50,[list]:true,cursor:'cursor'}]);}
});
test('1060 shared page menu offers distinct move/copy and Copy Link doors with current write gate',()=>{
 const w={pageState:{source_ref:{id:'page'}},reading:false},page={writing:w,mode:'text',drafted:()=>false,chooseTransfer:()=>{}};
 const items=notebookMenuItems(page);assert.deepEqual(items.filter(x=>['move-page','copy-page','copy'].includes(x.key)).map(x=>x.label),['Move to…','Copy to…','Copy Link']);
 w.reading=true;assert.ok(notebookMenuItems(page).filter(x=>['move-page','copy-page'].includes(x.key)).every(x=>x.disabled));
});
test('1060 transfer paints the writer-owned linked body without a second unowned read',async()=>{
 const calls=[],page={writing:{closed:false},textEdited:()=>calls.push('capture'),deleteUI:{transfer:async()=>calls.push('transfer')},
  load:()=>assert.fail('the writer already owns receipt/body reads'),sync:()=>calls.push('sync'),writingChanged:()=>calls.push('paint')};
 await NotebookPage.prototype.transferPage.call(page,'memory.copy',{kind:'topic',id:'t'});
 assert.deepEqual(calls,['capture','transfer','sync','paint']);
});
