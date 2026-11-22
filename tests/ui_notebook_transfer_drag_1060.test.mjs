import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookTransferDrag} from '../web/notebook-transfer-drag.mjs';

// Event-adapter checks, not a native gesture claim. Native CFT/WebKit checks
// must separately use actual pointer/keyboard input and inspect Core effects.
function fixture(){
 const listeners=new Map(),calls=[],errors=[],classes=new Set();let active=true,selected=false;
 const rail={contains:r=>r===row,append:()=>{}},row={dataset:{topicId:'destination'},title:'Destination',classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)},closest:()=>null};
 const doc={addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k),getSelection:()=>({isCollapsed:!selected}),
  createElement:()=>({setAttribute(){},remove(){}})};
 const source={dataset:{pageId:'page'},closest:()=>null};
 const node=target=>({closest:q=>q.startsWith('input')?null:q.includes('data-notebook-page-id')?target===source?source:null:target===row?row:null});
 const values=new Map(),transfer={types:[],setData(k,v){values.set(k,v);this.types=[...values.keys()];},getData:k=>values.get(k)};
 const event=(target,altKey=false)=>({target:node(target),altKey,dataTransfer:transfer,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}});
 const dispose=notebookTransferDrag({doc,bootstrap:{instance_id:'i',actor:'a'},rail:()=>rail,current:()=>active,
  perform:(...args)=>calls.push(args),refused:e=>errors.push(e)});
 return {listeners,calls,errors,classes,row,source,event,transfer,dispose,retire:()=>active=false,select:()=>selected=true};
}
test('1060 drag adapter defaults to move and samples Option again at drop',async()=>{
 for(const alt of [false,true]){const f=fixture();f.listeners.get('dragstart')(f.event(f.source));const hover=f.event(f.row,false);f.listeners.get('dragover')(hover);
  assert.equal(hover.defaultPrevented,true);assert.equal(f.transfer.dropEffect,'move');assert.ok(f.classes.has('notebook-drop-target'));
  f.listeners.get('drop')(f.event(f.row,alt));await Promise.resolve();assert.deepEqual(f.calls,[['page',alt?'memory.copy':'memory.move',{kind:'topic',id:'destination'}]]);assert.equal(f.classes.size,0);f.dispose();}
});
test('1060 drag adapter preserves selected words and refuses foreign or retired drags',async()=>{
 for(const mode of ['selection','foreign','retired']){const f=fixture();if(mode==='selection')f.select();
  if(mode!=='foreign')f.listeners.get('dragstart')(f.event(f.source));if(mode==='retired')f.retire();
  const event=f.event(f.row);f.listeners.get('drop')(event);await Promise.resolve();assert.deepEqual(f.calls,[]);assert.equal(event.defaultPrevented,undefined);f.dispose();}
});
