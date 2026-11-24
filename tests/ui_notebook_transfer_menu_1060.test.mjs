import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookDestinations,chooseNotebookDestination} from '../web/notebook-transfer.mjs';
import {NotebookPage,notebookMenuItems} from '../web/notebook-page.mjs';
const topic=(id,position=10)=>({id,title:id==='a'?'A':id,workspace_id:'outcome',list_position:position,state:'active',archived:false,build:false});
const empty=name=>name==='workspace'?{instance_id:'i',workspace:{id:'w',title:'W'}}:name==='conversation'?{instance_id:'i',conversation:null}:{instance_id:'i',items:[],next_cursor:null};

test('1060 destination reads follow actual source outcome and page topics without a write',async()=>{
 const calls=[],read=async(name,args)=>{calls.push([name,args]);return name==='topic'?{instance_id:'i',topic:topic('source')}:name==='workspace'?{instance_id:'i',workspace:{id:'outcome',title:'Outcome'}}:{instance_id:'i',items:[topic('a')],next_cursor:'0:10:a'};};
 const list=await notebookDestinations(read,{kind:'topic',id:'source'},'0:20:previous');
 assert.deepEqual(list,{outcome:{scope:{kind:'workspace',id:'outcome'},label:'Outcome'},topics:[{scope:{kind:'topic',id:'a'},label:'A'}],cursor:'0:10:a'});
 assert.deepEqual(calls.at(-1),['workspace_topics',{workspace_id:'outcome',build:false,limit:20,cursor:'0:20:previous'}]);assert.equal(calls.length,3);
});
test('1060 current Notebook move is disabled while same Notebook copy stays available',async()=>{
 const actions=[],w={pageState:{owner_scope:{kind:'workspace',id:'w'}}},page={writing:w,doc:{},more:{},say:assert.fail,
  read:async name=>empty(name),transferPage:(kind,scope)=>actions.push([kind,scope])};
 let menu;await chooseNotebookDestination(page,'memory.move',null,m=>menu=m);assert.equal(menu.items[0].disabled,true);
 await chooseNotebookDestination(page,'memory.copy',null,m=>menu=m);assert.equal(menu.items[0].disabled,false);menu.items[0].act();assert.deepEqual(actions,[['memory.copy',{kind:'workspace',id:'w'}]]);
});
test('1060 a departed writer cannot open or act on a destination picker',async()=>{
 let release,shown=false;const w={pageState:{owner_scope:{kind:'workspace',id:'w'}}},page={writing:w,doc:{},more:{},say:assert.fail,
   read:async name=>{if(name==='workspace')await new Promise(r=>release=r);return empty(name);}};
 const load=chooseNotebookDestination(page,'memory.move',null,()=>shown=true);w.closed=true;release();await load;assert.equal(shown,false);
});
test('1060 Done and Archived destinations stay scoped, paged and explicitly chosen',async()=>{
 for(const list of ['done','archived']){const reads=[];await notebookDestinations(async(name,args)=>{reads.push([name,args]);return empty(name);},{kind:'workspace',id:'w'},'0:20:cursor',list);
   assert.deepEqual(reads.at(-1),['workspace_topics',{workspace_id:'w',[list]:true,limit:20,cursor:'0:20:cursor'}]);}
});
test('1060 shared page menu offers distinct move/copy and Copy link doors with current write gate',()=>{
 const w={pageState:{source_ref:{id:'page'}},reading:false},page={writing:w,mode:'text',drafted:()=>false,chooseTransfer:()=>{}};
 const items=notebookMenuItems(page);assert.deepEqual(items.filter(x=>['move-page','copy-page','copy'].includes(x.key)).map(x=>[x.key,x.label]),[['copy','Copy link'],['move-page','Move to…'],['copy-page','Copy to…']]);
 w.reading=true;assert.ok(notebookMenuItems(page).filter(x=>['move-page','copy-page'].includes(x.key)).every(x=>x.disabled));
});
test('1060 transfer paints the writer-owned linked body without a second unowned read',async()=>{
 const calls=[],page={writing:{closed:false},textEdited:()=>calls.push('capture'),deleteUI:{transfer:async()=>calls.push('transfer')},
  load:()=>assert.fail('the writer already owns receipt/body reads'),sync:()=>calls.push('sync'),writingChanged:()=>calls.push('paint')};
 await NotebookPage.prototype.transferPage.call(page,'memory.copy',{kind:'topic',id:'t'});
 assert.deepEqual(calls,['capture','transfer','sync','paint']);
});
