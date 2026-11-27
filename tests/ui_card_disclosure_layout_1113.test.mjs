// Scheduling/geometry access decisions only. Actual layout cost uses a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CardDisclosure} from '../web/card-disclosure.mjs';
import {miniDocument} from './fixtures/mini_dom.mjs';

function fixture({intersection=true,count=3}={}) {
  const doc=miniDocument(),frames=new Map(),events=[];let serial=0;
  doc.body=doc.byId('body');doc.fonts=new EventTarget();doc.defaultView=new EventTarget();
  const documentEvents=new EventTarget();
  doc.addEventListener=(...args)=>documentEvents.addEventListener(...args);
  doc.dispatchEvent=(...args)=>documentEvents.dispatchEvent(...args);
  Object.assign(doc.defaultView,{innerWidth:1000,innerHeight:800,
    requestAnimationFrame(callback){frames.set(++serial,callback);return serial;},
    cancelAnimationFrame(id){frames.delete(id);}});
  class ResizeObserver {
    constructor(callback){this.callback=callback;this.targets=new Set();}
    observe(node){this.targets.add(node);}
    unobserve(node){this.targets.delete(node);}
    disconnect(){this.targets.clear();}
  }
  class IntersectionObserver extends ResizeObserver {}
  const abort=new AbortController(),controller=new CardDisclosure({doc,signal:abort.signal,ResizeObserver,
    IntersectionObserver:intersection?IntersectionObserver:null});
  const cards=Array.from({length:count},(_,i)=>({title:'Card '+i,words:'Words '+i}));
  controller.begin(cards);
  const attach=index=>{
    const row=doc.createElement('li'),words=doc.createElement('div');row.append(words);doc.body.append(row);
    const geometry={width:200,full:130,clamped:40,top:index*100};
    words.getClientRects=()=>{events.push(['read',index,'rects']);return [{}];};
    words.getBoundingClientRect=()=>{events.push(['read',index,'viewport']);return {top:geometry.top,bottom:geometry.top+40,left:0,right:200};};
    Object.defineProperties(words,{clientWidth:{get(){events.push(['read',index,'width']);return geometry.width;}},
      scrollHeight:{get(){events.push(['read',index,'scroll']);return geometry.full;}},
      clientHeight:{get(){events.push(['read',index,'height']);return words.className.includes('deck-expanded')?geometry.full:geometry.clamped;}}});
    const list=words.classList;
    Object.defineProperty(words,'classList',{value:{...list,
      remove(...names){events.push(['write',index,'remove']);list.remove(...names);},
      toggle(...args){events.push(['write',index,'toggle']);return list.toggle(...args);}}});
    controller.attach(row,words,index);
    const entry=controller.entries.at(-1);return Object.assign(entry,{geometry});
  };
  const entries=cards.map((_,i)=>attach(i));events.length=0;
  const visible=(...indices)=>controller.intersection.callback(entries.map((entry,index)=>({target:entry.words,isIntersecting:indices.includes(index)})));
  const flush=()=>{const queued=[...frames.values()];frames.clear();for(const callback of queued)callback();};
  return {doc,frames,events,abort,controller,cards,entries,attach,visible,flush};
}

test('1113 mount defers geometry and observer callbacks coalesce into one frame',()=>{
  const f=fixture();f.controller.mount();
  assert.deepEqual(f.events,[],'mount must not synchronously measure cards');
  f.visible(0,1);f.controller.refresh();f.controller.resize.callback([{target:f.entries[0].words}]);
  assert.deepEqual(f.events,[],'observers only queue work');assert.equal(f.frames.size,1);
  f.flush();assert.equal(f.entries[0].button.hidden,false);assert.equal(f.entries[1].button.hidden,false);
  assert.equal(f.entries[2].button.hidden,true);f.abort.abort();
});
test('1113 all clamp writes precede all geometry reads and all expansion writes follow',()=>{
  const f=fixture();f.controller.mount();f.visible(0,1);f.flush();
  const kinds=f.events.map(([kind,,detail])=>kind==='read'?'read':detail);
  const firstRead=kinds.indexOf('read'),lastRead=kinds.lastIndexOf('read');
  assert.deepEqual(kinds.slice(0,firstRead),['remove','remove']);
  assert.ok(kinds.slice(firstRead,lastRead+1).every(kind=>kind==='read'));
  assert.deepEqual(kinds.slice(lastRead+1),['toggle','toggle']);
  assert.ok(f.events.every(([,index])=>index!==2),'off-screen words never measured');f.abort.abort();
});
test('1113 scrolling observes newly visible cards and resize never measures synchronously',()=>{
  const f=fixture();f.controller.mount();f.visible(0);f.flush();f.events.length=0;
  f.visible(1);assert.deepEqual(f.events,[]);assert.equal(f.controller.resize.targets.has(f.entries[0].words),false);
  assert.equal(f.controller.resize.targets.has(f.entries[1].words),true);f.flush();
  assert.ok(f.events.every(([,index])=>index===1));f.events.length=0;
  f.entries[1].geometry.full=20;f.entries[1].geometry.clamped=20;
  f.controller.resize.callback([{target:f.entries[1].words},{target:f.entries[0].words}]);
  assert.deepEqual(f.events,[]);assert.equal(f.frames.size,1);f.flush();
  assert.equal(f.entries[1].button.hidden,true);assert.ok(f.events.every(([,index])=>index===1));f.abort.abort();
});
test('1113 an offered pill responds immediately using known overflow without a layout read',()=>{
  const f=fixture();f.controller.mount();f.visible(0);f.flush();const entry=f.entries[0];entry.button.focus();
  f.events.length=0;entry.button.listeners.click({stopPropagation(){}});
  assert.equal(entry.words.classList.contains('deck-expanded'),true);assert.equal(entry.button.textContent,'Show less');
  assert.equal(f.doc.activeElement,entry.button);assert.ok(f.events.every(([kind])=>kind==='write'));
  entry.button.listeners.click({stopPropagation(){}});assert.equal(entry.words.classList.contains('deck-expanded'),false);
  assert.equal(entry.button.textContent,'Show all');f.abort.abort();
});
test('1113 repaint and close cancel stale frames and late observers cannot read detached words',()=>{
  const f=fixture();f.controller.mount();f.visible(0);const stale=[...f.frames.values()][0],old=f.entries[0];
  f.controller.begin(f.cards);old.row.remove();f.events.length=0;stale();
  f.controller.resize.callback([{target:old.words}]);f.controller.intersection.callback([{target:old.words,isIntersecting:true}]);
  assert.deepEqual(f.events,[]);assert.equal(f.frames.size,0);
  const next=f.attach(0);f.controller.mount();f.controller.intersection.callback([{target:next.words,isIntersecting:true}]);
  const closing=[...f.frames.values()][0];f.abort.abort();closing();
  assert.deepEqual(f.events,[['write',0,'toggle']]);assert.equal(f.frames.size,0);
  assert.equal(f.controller.resize.targets.size,0);assert.equal(f.controller.intersection.targets.size,0);
});
test('a previously measured disclosure keeps its space during redraw',()=>{
  const f=fixture();
  f.controller.mount();f.visible(0,1);f.flush();
  f.entries[1].button.listeners.click({stopPropagation(){}});
  assert.equal(f.entries[1].button.textContent,'Show less');
  f.controller.begin(f.cards.map(card=>({...card})));
  for(const entry of f.entries)entry.row.remove();
  const collapsed=f.attach(0),expanded=f.attach(1),unmeasured=f.attach(2);
  assert.equal(collapsed.button.hidden,false);
  assert.equal(collapsed.button.textContent,'Show all');
  assert.equal(expanded.button.hidden,false);
  assert.equal(expanded.button.textContent,'Show less');
  assert.equal(expanded.words.classList.contains('deck-expanded'),true);
  assert.equal(unmeasured.button.hidden,true);
  collapsed.geometry.full=collapsed.geometry.clamped;
  f.controller.mount();
  f.controller.intersection.callback([{target:collapsed.words,isIntersecting:true}]);
  f.flush();
  assert.equal(collapsed.button.hidden,true,'a fresh measurement can remove a control no longer needed');
  f.abort.abort();
});
test('1113 deferred repaint restores the same control and respects a later focus choice',()=>{
  for(const moved of [false,true]){
    const f=fixture();f.controller.mount();f.visible(0);f.flush();f.entries[0].button.focus();
    const focus=f.controller.focused();f.controller.begin(f.cards);for(const e of f.entries)e.row.remove();
    const next=f.attach(0),outside=f.doc.createElement('textarea');f.doc.body.append(outside);f.doc.body.focus();
    f.controller.mount(focus);f.controller.intersection.callback([{target:next.words,isIntersecting:true}]);
    if(moved)outside.focus();f.flush();assert.equal(f.doc.activeElement,moved?outside:next.button);f.abort.abort();
  }
});
test('1113 fallback batches viewport reads and keeps an off-screen expansion choice',()=>{
  const f=fixture({intersection:false});f.entries[2].geometry.top=900;f.entries[2].record.expanded=true;
  f.entries[2].words.classList.add('deck-expanded');f.events.length=0;
  f.controller.mount();assert.deepEqual(f.events,[]);f.flush();
  assert.equal(f.entries[0].button.hidden,false);assert.equal(f.entries[2].button.hidden,true);
  assert.equal(f.entries[2].words.classList.contains('deck-expanded'),true);
  assert.ok(f.events.filter(([,index,detail])=>index===2).every(([, ,detail])=>detail==='viewport'));
  const firstWrite=f.events.findIndex(([kind])=>kind==='write');
  assert.equal(f.events.slice(0,firstWrite).filter(([, ,detail])=>detail==='viewport').length,3);f.abort.abort();
});

for(const intersection of [false,true])test(`1113 a queued measurement stops when its document loses its window, intersection=${intersection}`,()=>{
  const f=fixture({intersection});f.controller.mount();if(intersection)f.visible(0);
  const stale=[...f.frames.values()][0];assert.ok(stale);
  f.doc.defaultView=null;
  assert.doesNotThrow(()=>f.flush());assert.deepEqual(f.events,[],'detached document has no geometry work');
  f.controller.resize.callback([{target:f.entries[0].words}]);
  f.controller.intersection?.callback([{target:f.entries[0].words,isIntersecting:true}]);stale();
  assert.deepEqual(f.events,[]);assert.equal(f.frames.size,0);assert.equal(f.controller.closed,true);
  assert.equal(f.controller.resize.targets.size,0);assert.equal(f.controller.intersection?.targets.size??0,0);
  f.abort.abort();
});
test('1113 close cancels a detached document frame through the window that scheduled it',()=>{
  const f=fixture({intersection:false});f.controller.mount();assert.equal(f.frames.size,1);
  const stale=[...f.frames.values()][0];f.doc.defaultView=null;f.controller.close();
  assert.equal(f.frames.size,0,'the original window must actually cancel its queued frame');
  stale();assert.deepEqual(f.events,[]);assert.equal(f.abort.signal.aborted,false);f.abort.abort();
});
test('1113 explicit close releases document scroll, window resize and font listeners before parent abort',()=>{
  const f=fixture({intersection:false}),view=f.doc.defaultView;let calls=0;
  f.controller.refresh=()=>calls++;
  const dispatch=()=>{f.doc.dispatchEvent(new Event('scroll'));view.dispatchEvent(new Event('resize'));f.doc.fonts.dispatchEvent(new Event('loadingdone'));};
  dispatch();assert.equal(calls,3,'all three actual EventTarget subscriptions were installed');
  f.controller.close();assert.equal(f.abort.signal.aborted,false);calls=0;dispatch();
  assert.equal(calls,0,'explicit close must remove listeners without waiting on the parent');f.abort.abort();
});
