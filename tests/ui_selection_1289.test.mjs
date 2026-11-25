import test from 'node:test';
import assert from 'node:assert/strict';
import { renderer799 } from './fixtures/renderer799.mjs';
import { arrangeStacks, entries } from '../web/reply-stacks.mjs';

// Actual arrangement; this model implements live-Range retargeting during a
// connected insertBefore. It is not native selection/gesture acceptance.
function fixture(backward = false) {
  const f = renderer799('reader'), doc = f.list.ownerDocument, ranges = new Set(), events = new Map();
  doc.body = doc.createElement('body'); doc.body.root = true;
  doc.addEventListener = (name, cb) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(cb); };
  doc.removeEventListener = (name, cb) => events.get(name)?.delete(cb);
  const emit = (name, target) => { for (const cb of events.get(name) ?? []) cb({ target, type: name }); };
  const range = (node, start, end) => {
    const r = { startContainer: node, startOffset: start, endContainer: node, endOffset: end,
      cloneRange() { const c = range(this.startContainer, this.startOffset, this.endOffset); c.endContainer = this.endContainer; return c; },
      detach() { ranges.delete(this); } };
    ranges.add(r); return r;
  };
  const selection = { current: null, backward, writes: 0,
    get rangeCount() { return this.current ? 1 : 0; },
    get isCollapsed() { return !this.current || this.anchorNode === this.focusNode && this.anchorOffset === this.focusOffset; },
    get anchorNode() { return this.current?.[this.backward ? 'endContainer' : 'startContainer']; },
    get focusNode() { return this.current?.[this.backward ? 'startContainer' : 'endContainer']; },
    get anchorOffset() { return this.current?.[this.backward ? 'endOffset' : 'startOffset']; },
    get focusOffset() { return this.current?.[this.backward ? 'startOffset' : 'endOffset']; },
    getRangeAt() { return this.current; },
    setBaseAndExtent(a, ao, z, zo) { this.writes++; this.backward = ao > zo; this.current = range(a, Math.min(ao,zo), Math.max(ao,zo)); this.current.endContainer = z; },
  };
  doc.getSelection = () => selection;
  let afterMove = () => {}, moves = 0;
  function watch(node) {
    const insert = node.insertBefore;
    node.insertBefore = function(moving, before) {
      if (moving.isConnected) {
        moves++;
        const old = moving.parentElement, index = old.children.indexOf(moving);
        for (const r of ranges) for (const end of ['start', 'end']) if (moving.contains(r[end+'Container'])) {
          r[end+'Container'] = old; r[end+'Offset'] = index;
        }
        if (moving.contains(doc.activeElement)) doc.activeElement = doc.body;
        const result = insert.call(this,moving,before); afterMove(moving); return result;
      }
      return insert.call(this,moving,before);
    };
    return node;
  }
  const make = doc.createElement; doc.createElement = tag => watch(make(tag)); watch(f.list);
  const message = (id,seq,reply_to=null) => ({ id,seq,topic_id:'fixture',author_id:'writer',reply_to,acts:{} });
  f.add([message('a',1),message('ar',2,'a'),message('b',3),message('br',4,'b')]);
  const card = id => entries(f.list).find(e=>e.dataset.id===id);
  const words = doc.createTextNode('selected cover words'); card('a').querySelector('.message-preview').append(words);
  selection.current = range(words,2,10); selection.writes=0; moves=0;
  return { ...f,doc,selection,words,card,ranges,events,emit,
    focus(node) { doc.activeElement=node; emit('focusin',node); },
    hook(fn) { afterMove=fn; }, get moves() { return moves; },
    draw(on) { arrangeStacks(f.list,f.messages,{doc,viewer:'reader',on}); },
    move() { f.messages.get('a').acts.placed=10; this.draw(); },
  };
}
for (const backward of [false,true]) test('1289 actual connected ancestor move retains '+(backward?'backward':'forward')+' endpoints and direction',()=>{
  const f=fixture(backward); f.move();
  assert.ok(f.moves>0,'real reconciliation moved an ancestor');
  assert.equal(f.selection.anchorNode,f.words); assert.equal(f.selection.focusNode,f.words);
  assert.equal(f.selection.anchorOffset,backward?10:2); assert.equal(f.selection.focusOffset,backward?2:10);
});
test('1289 settled no-op leaves the selected Range object untouched',()=>{
  const f=fixture(), original=f.selection.current; f.draw(); assert.equal(f.moves,0); assert.equal(f.selection.current,original); assert.equal(f.selection.writes,0);
});
for (const mode of ['collapse','new-range','same-range','clear','changed-text','removed-endpoint']) test('1289 does not reclaim '+mode+' during a move',()=>{
  const f=fixture(); let called=false;
  f.hook(()=>{if(called)return;called=true;
    if(mode==='collapse') f.selection.setBaseAndExtent(f.words,4,f.words,4);
    if(mode==='new-range') f.selection.setBaseAndExtent(f.words,5,f.words,8);
    if(mode==='same-range') { f.selection.current.startContainer=f.words;f.selection.current.startOffset=4; }
    if(mode==='clear') f.selection.current=null;
    if(mode==='changed-text') f.words.data='replacement';
    if(mode==='removed-endpoint') f.words.remove();
  });
  f.move(); assert.ok(called); assert.equal(f.selection.writes,mode==='collapse'||mode==='new-range'?1:0);
});
test('1289 collapsed selection before arrangement remains collapsed',()=>{const f=fixture();f.selection.setBaseAndExtent(f.words,4,f.words,4);f.selection.writes=0;f.move();assert.equal(f.selection.writes,0);});
test('1289 deliberate focus change in arranged callback survives',()=>{
  const f=fixture(), old=f.card('a'), next=f.card('b');f.doc.activeElement=old;
  f.messages.get('a').acts.placed=10;f.draw({arranged(){f.focus(next);}});assert.equal(f.doc.activeElement,next);
  assert.ok([...f.events.values()].every(set=>set.size===0),'temporary focus listeners released');
});
test('1289 a detached focused card regains focus without scrolling',()=>{const f=fixture(), old=f.card('a');f.doc.activeElement=old;f.move();assert.equal(f.doc.activeElement,old);});

test('1289 deliberate focus to body inside the actual move is not reclaimed',()=>{
  const f=fixture(), old=f.card('a');f.doc.activeElement=old;let chosen=false;
  f.hook(()=>{if(!chosen){chosen=true;f.focus(f.doc.body);}});f.move();
  assert.equal(f.doc.activeElement,f.doc.body);assert.equal(f.selection.writes,0);
});
test('1289 deliberate input during move fences selection restore',()=>{
  const f=fixture();f.hook(()=>f.emit('pointerdown',f.words));f.move();assert.equal(f.selection.writes,0);
});
test('1289 changed selection before a later move becomes that move current selection',()=>{
  const f=fixture();f.selection.setBaseAndExtent(f.words,5,f.words,9);f.selection.writes=0;f.move();
  assert.equal(f.selection.anchorNode,f.words);assert.equal(f.selection.anchorOffset,5);assert.equal(f.selection.focusOffset,9);
});
test('1289 exception releases focus and live witness listeners',()=>{
  const f=fixture();f.doc.activeElement=f.card('a');f.hook(()=>{throw Error('fixture paint failure');});
  assert.throws(()=>f.move(),/fixture paint failure/);assert.ok([...f.events.values()].every(set=>set.size===0));
});
