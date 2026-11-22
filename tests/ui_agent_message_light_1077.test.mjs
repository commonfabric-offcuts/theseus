// Passage lifecycle checks; native input and rendered paint are separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedPassages } from '../web/feed-passages.mjs';
import { formatWords } from '../web/message-format.mjs';
import { doc as textDoc } from './text_display_768_fixtures.mjs';

function specimen(options={}) {
  const revision=Object.hasOwn(options,'revision')?options.revision:3;
  const observers=[],root={dataset:{}},entry={},words=textDoc.createElement('div');
  const first='Paired passage sentence. Another sentence begins';
  formatWords(words,first,{revision});words.isConnected=true;
  const doc={documentElement:root,getSelection:()=>({rangeCount:0,isCollapsed:true}),addEventListener(){},defaultView:{addEventListener(){},MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this)}observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}},Highlight:class{},CSS:{highlights:new Map()}}};
  let eligible=true,paints=0;
  const p=new FeedPassages({host:{addEventListener(){}},doc,entryOf:()=>entry,wordsOf:()=>words,lights:()=>eligible});
  p.paint=()=>paints++;
  p.light(entry,{words,span:{start:0,end:25}});
  return {p,entry,words,root,first,paintCount:()=>paints,eligible:v=>eligible=v,redraw(text,revision){formatWords(words,text,{revision});p.redrawn.fn();}};
}

test('1077 whole-source extension keeps an already lit complete passage of the same revision',()=>{
  const f=specimen();const chosen=f.p.chosen(f.entry),before=f.paintCount();
  f.redraw(f.first+' here. A later paragraph.',3);
  assert.deepEqual(f.p.chosen(f.entry),chosen,'the original quote bytes, revision and offsets survive');
  assert.equal(f.paintCount(),before+1,'rebuild the highlight on the replacement word nodes');
  f.redraw(f.first+' here. A later paragraph. Still more words.',3);
  assert.deepEqual(f.p.chosen(f.entry),chosen,'a second verified extension has the same quote');
});

test('1077 an edited revision, changed prefix or missing revision clears the old passage',()=>{
  for(const mode of['revision','changed-prefix','later-changed','missing-before','missing-after','null-revision','zero-revision','shorter']){
    const revision=mode==='missing-before'?undefined:mode==='null-revision'?null:mode==='zero-revision'?0:3;
    const f=specimen({revision});
    const text=mode==='changed-prefix'?'Changed passage sentence. More words.':mode==='later-changed'?f.first.replace('Another','Changed')+' here.':mode==='shorter'?'Paired passage sentence.':f.first+' here.';
    f.redraw(text,mode==='revision'?4:mode==='missing-after'?undefined:revision);
    assert.equal(f.p.chosen(f.entry),null,mode+' cannot keep a stale quote');
  }
});

test('1077 a passage cut at the excerpt boundary must be chosen afresh from the whole sentence',()=>{
  const f=specimen();f.p.light(f.entry,{words:f.words,span:{start:25,end:f.first.length}});
  f.redraw(f.first+' here. Another complete sentence.',3);
  assert.equal(f.p.chosen(f.entry),null);
});

test('1077 expansion cannot restore a light after writing ownership or Light off takes it',()=>{
  for(const mode of['writing','off']){
    const f=specimen();if(mode==='writing')f.eligible(false);else f.root.dataset.pointerLight='off';
    f.redraw(f.first+' here.',3);assert.equal(f.p.lit,null,mode);
  }
});
