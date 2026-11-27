import test from 'node:test';
import assert from 'node:assert/strict';
import { caretRevealBy, watchNotebookCaret } from '../web/notebook-caret.mjs';

test('1074 visible caret never moves the page, including either exact edge', () => {
  for (const caret of [{top:100,bottom:120},{top:280,bottom:300},{top:180,bottom:200}])
    assert.equal(caretRevealBy(caret,{top:100,bottom:300},50,500),0);
});
test('1074 reveal is the exact top or bottom deficit, bounded by the page extent', () => {
  const area={top:100,bottom:300};
  assert.equal(caretRevealBy({top:89.5,bottom:109.5},area,50,500),-10.5);
  assert.equal(caretRevealBy({top:291,bottom:311},area,50,500),11);
  assert.equal(caretRevealBy({top:291,bottom:311},area,495,500),5);
  assert.equal(caretRevealBy({top:89,bottom:109},area,5,500),-5);
});
test('1074 invalid or unusable geometry is inert', () => {
  for(const [caret,area,top,max] of [[{top:0,bottom:20},{top:1,bottom:1},0,100],
    [{top:0,bottom:20},{top:2,bottom:1},0,100],[{top:30,bottom:20},{top:0,bottom:100},0,100],
    [{top:0,bottom:200},{top:0,bottom:100},0,100],[{top:NaN,bottom:20},{top:0,bottom:100},0,100],
    [{top:0,bottom:20},{top:0,bottom:100},0,-1],[null,{top:0,bottom:100},0,100]])
    assert.equal(caretRevealBy(caret,area,top,max),0);
});

// Scheduler/lifetime check only; this does not simulate native layout or input.
test('1074 retiring an editor cancels queued reveal and removes only its own listeners', () => {
  const queued=new Map();let serial=0;
  const view={AbortController,requestAnimationFrame(fn){queued.set(++serial,fn);return serial;},cancelAnimationFrame(id){queued.delete(id);}};
  const host=new EventTarget();host.scrollTop=12;
  const field=new EventTarget();field.ownerDocument={defaultView:view};
  const stop=watchNotebookCaret(field,host);
  field.dispatchEvent(new Event('beforeinput'));field.dispatchEvent(new Event('input'));
  assert.equal(queued.size,1);host.dispatchEvent(new Event('wheel'));assert.equal(queued.size,0);
  field.dispatchEvent(new Event('beforeinput'));field.dispatchEvent(new Event('input'));
  assert.equal(queued.size,1);stop();assert.equal(queued.size,0);
  field.dispatchEvent(new Event('input'));assert.equal(queued.size,0);assert.equal(host.scrollTop,12);
});

test('1074 coalesced inputs retain the position before the first native jump', () => {
  const queued=new Map();let serial=0;
  const host=new EventTarget();Object.assign(host,{scrollTop:12,scrollHeight:2000,clientHeight:1000,clientTop:0,
    getBoundingClientRect:()=>({top:0,bottom:1000})});
  const field=new EventTarget(), body={append(){}};
  const node=()=>({style:{},setAttribute(){},append(){},remove(){},
    getBoundingClientRect:()=>({top:0}),getClientRects:()=>[{top:0,bottom:20,height:20}]});
  const view={AbortController,innerHeight:1000,CSS:{supports:()=>false},getComputedStyle:el=>el===host?{overflowY:'auto'}:{overflowY:'visible'},
    requestAnimationFrame(fn){queued.set(++serial,fn);return serial;},cancelAnimationFrame(id){queued.delete(id);}};
  const doc={defaultView:view,body,createElement:node,createTextNode:()=>({}),activeElement:field};
  Object.assign(field,{ownerDocument:doc,isConnected:true,value:'words',selectionStart:5,selectionEnd:5,scrollTop:0,
    getBoundingClientRect:()=>({top:500-host.scrollTop,width:300})});
  const stop=watchNotebookCaret(field,host);
  field.dispatchEvent(new Event('beforeinput'));field.dispatchEvent(new Event('input'));
  host.scrollTop=431; // Browser moved while both input events await one frame.
  field.dispatchEvent(new Event('beforeinput'));field.dispatchEvent(new Event('input'));
  assert.equal(queued.size,1);[...queued.values()][0]();
  assert.equal(host.scrollTop,12,'visible final caret does not retain an intervening browser jump');
  queued.clear();
  view.matchMedia=()=>({matches:true});
  field.dispatchEvent(new Event('beforeinput'));field.dispatchEvent(new Event('input'));
  host.scrollTop=13;
  assert.equal(queued.size,1);[...queued.values()][0]();
  assert.equal(host.scrollTop,13,'the phone sheet retains a native one-pixel adjustment for a visible caret');
  stop();
});
