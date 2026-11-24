import test from 'node:test';
import assert from 'node:assert/strict';
import { foldFixture } from './fixtures/rail_topic_fold_1161.mjs';
const fixture = (t,options) => { const f = foldFixture(options); t.after(f.close); return f; };

test('1161 eighth row fades after seven topics while retaining all topic links and marks',t=>{
  const f=fixture(t),before=[...f.host.children];f.flush();
  assert.equal(f.area.hasAttribute('data-topic-fold'),true);
  assert.equal(f.area.style.getPropertyValue('--topic-fold-start'),'308px');
  assert.equal(f.area.style.getPropertyValue('--topic-fold-end'),'345.4px');
  assert.deepEqual(f.host.children,before);assert.equal(before[7].dataset.railFold,'peek');
  assert.equal(before[9].hidden,false);assert.equal(before[7].textContent.includes('3'),true);
});
test('1161 seven topics retain the existing unbounded view',t=>{
  const f=fixture(t,{count:7});f.flush();assert.equal(f.area.hasAttribute('data-topic-fold'),false);
  assert.equal(f.host.children.length,7);assert.equal(f.outcome.parts.host.hidden,false);
});
test('1161 fold follows the actual drawn order through held and intentional repaints',t=>{
  const f=fixture(t);f.flush();const eighth=f.host.children[7];f.rail.pointed=true;
  f.rail.pages.loaded.set('new',{...f.rows[0],id:'new',list_position:999});f.rail.paint();f.flush();
  assert.equal(f.host.children[7],eighth);
  f.rail.paint(true);f.flush();assert.equal(f.host.children[7].dataset.topicId,'t6');
  assert.equal(eighth.dataset.railFold,'past');
});
test('1161 earlier stars and a wrapped eighth supply their actual modeled extents',t=>{
  const f=fixture(t),star=f.doc.createElement('div');star.className='ol-dossiers';star.height=36;
  f.host.children[2].after(star);f.host.children[8].height=88;f.flush();
  assert.equal(f.area.style.getPropertyValue('--topic-fold-start'),'344px');
  assert.equal(f.area.style.getPropertyValue('--topic-fold-end'),'418.8px');
  assert.equal(f.host.children[8].dataset.railFold,'peek');assert.equal(star.hidden,false);
});
test('1161 filtered rows do not consume a visible topic slot',t=>{
  const f=fixture(t);f.host.children[0].hidden=true;f.flush();
  assert.equal(f.host.children[8].dataset.railFold,'peek');assert.equal(f.host.children[0].dataset.railFold,undefined);
});
test('1161 current topic beyond seven keeps the whole list open and departure releases it',t=>{
  const f=fixture(t);f.rail.updateCurrent(f.rows[9]);f.flush();
  assert.equal(f.area.hasAttribute('data-topic-current'),true);
  f.rail.updateCurrent(f.rows[0]);f.flush();assert.equal(f.area.hasAttribute('data-topic-current'),false);
});
for(const name of ['done','archived'])test('1161 current '+name+' topic opens its disclosure and the visual fold',t=>{
  const f=fixture(t),group=f.outcome.parts[name],link=f.doc.createElement('a');link.setAttribute('aria-current','page');
  group.host.append(link);group.details.open=false;f.flush();
  assert.equal(group.details.open,true);assert.equal(f.area.hasAttribute('data-topic-current'),true);
});
test('1161 phone first touch reveals the peeking topic and the next uses TopicRail navigation',t=>{
  const f=fixture(t,{phone:true});f.flush();const link=f.host.children[7];
  f.emit(link,'pointerdown',{pointerType:'touch'});const first=f.emit(link,'click');
  assert.equal(first.prevented,true);assert.equal(first.stopped,true);assert.equal(f.doc.activeElement,link);assert.deepEqual(f.opens,[]);
  f.emit(link,'pointerdown',{pointerType:'touch'});f.emit(link,'click');assert.equal(f.opens[0][0],link.dataset.topicId);
});
test('1161 keyboard activation and modified links retain their existing acts',t=>{
  const f=fixture(t,{phone:true});f.flush();const link=f.host.children[7];
  f.emit(link,'pointerdown',{pointerType:'touch'});const modified=f.emit(link,'click',{metaKey:true});
  assert.equal(modified.prevented,false);assert.deepEqual(f.opens,[]);
  f.emit(link,'click',{detail:0});assert.equal(f.opens[0][0],link.dataset.topicId);
});
test('1161 a current far topic and desktop pointer navigate on the first press',t=>{
  const f=fixture(t);f.rail.updateCurrent(f.rows[9]);f.flush();const link=f.host.children[7];
  f.emit(link,'pointerdown',{pointerType:'mouse'});f.emit(link,'click');assert.equal(f.opens[0][0],link.dataset.topicId);
});
test('1161 unread badge navigation still requests oldest unread rather than swallowing the count',t=>{
  const f=fixture(t,{phone:true});f.rail.updateCurrent(f.rows[9]);f.flush();const link=f.host.children[7];
  const badge=link.querySelector('.unread-count');badge.dataset.lands='unread';
  f.emit(link,'pointerdown',{pointerType:'touch'});const event={button:0,target:badge,preventDefault(){}};link.onclick(event);
  assert.equal(f.opens[0][3],'unread');
});
test('1161 missing geometry fails open without hiding or changing paging truth',t=>{
  const f=fixture(t);f.flush();f.host.children[7].height=NaN;f.outcome.fold?.measure();
  assert.equal(f.area.hasAttribute('data-topic-fold'),false);assert.equal(f.host.children.length,10);
  assert.equal(f.rail.pages.next,null);assert.deepEqual(f.reads,[]);
});
test('1161 observer work coalesces and disposal cancels pending measurement and listeners',t=>{
  const f=fixture(t);for(const observer of f.observers)observer.callback();assert.equal(f.frames.size,1);
  f.outcome.fold.dispose();assert.equal(f.frames.size,0);assert.equal(f.observers.every(o=>o.stopped),true);
  assert.equal(f.area.listeners.pointerdown,undefined);assert.equal(f.area.listeners.click,undefined);
});
test('1161 documents without a browsing view or animation API retain an available topic list',()=>{
  for(const view of ['none','partial']){
    const f=foldFixture({view});
    try{
      f.flush();f.outcome.fold?.soon();
      assert.equal(f.host.children.length,10);assert.equal(f.area.hasAttribute('data-topic-fold'),false);
      assert.equal(f.frames.size,0);assert.equal(f.observers.length,0);assert.deepEqual(f.reads,[]);
    }finally{f.close();}
  }
});
