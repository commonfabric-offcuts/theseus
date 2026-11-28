import test from 'node:test';
import assert from 'node:assert/strict';
import { coverSheet, coverPills } from '../web/dossier-cover.mjs';
import { assertRows757, assertSheet757 } from './reading_item_757_oracle.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { readingItem757Checks } from './reading_item_757_native.mjs';

const cover={stands:'Cabin is booked',payload:{text:'Cabin decision',message_id:'actual-cabin-reply',kind:'decision',seq:3,done:null},
  waiting:[{text:'Choose the cabin',default:'Keep the current booking'}],owner:'synthetic-owner',items:[
    {workspace_id:'actual-workspace',number:17,title:'Make the reader clearer',state:'Build'},
    {workspace_id:'actual-workspace',number:21,title:'Speed up the feed',state:'Review'}]};
const ctx={viewer:'synthetic-owner',nameOf:id=>id,topicId:'actual-topic'};
const of=(e,cls)=>[...e.descendants()].filter(n=>n.classList.contains(cls));
const text=e=>e?.text??null;
const href=e=>e?.href??e?.getAttribute('href')??null;
const rows=e=>of(e,'cover-item').map(e=>({title:text(e.querySelector('a')),state:text(e.querySelector('.cover-item-state')),href:href(e.querySelector('a'))}));
// Read the real group hierarchy while retaining every original757 oracle.
const snapshot=e=>({rows:rows(e),order:e.children.filter(n=>n.classList.contains('cover-line')).flatMap(n=>n.classList.contains('cover-items')?n.querySelectorAll('.cover-item').map(()=>'cover-item'):[n.classList.contains('cover-heading')?'cover-stands':n.className.split(' ').find(n=>/^cover-(stands|payload|item|wait)$/.test(n))]),
  stands:text(e.querySelector('.cover-stands')),payload:text(e.querySelector('.cover-payload')?.querySelector('.cover-words')),
  cite:text(e.querySelector('.cover-src')),citeHref:href(e.querySelector('.cover-src')),acceptance:e.querySelector('.pill-payload')?.dataset.state,
  waits:of(e,'cover-wait').map(w=>({text:text(w.querySelector('.cover-words')),default:text(w.querySelector('.cover-note'))}))});

test('reading item 757 native oracle checks real mapped names routes manual order and acceptance',()=>{
  assertSheet757(snapshot(coverSheet(miniDocument(),cover,ctx)),cover);
  assertRows757(rows(coverPills(miniDocument(),cover,ctx)),cover);
});

test('reading item 757 native oracle rejects collapsed identity swapped route stage and lost default',()=>{
  const original=snapshot(coverSheet(miniDocument(),cover,ctx));
  for(const change of [s=>s.rows.pop(),s=>s.rows[1].href='?pipeline=wrong&item=17',s=>s.rows[1].state='Build',
    s=>s.waits[0].default='',s=>s.order.reverse(),s=>s.citeHref='?topic=wrong&message=wrong',s=>s.acceptance='done']) {
    const mutant=structuredClone(original);change(mutant);
    assert.throws(()=>assertSheet757(mutant,cover),{name:'AssertionError'});
  }
});

test('reading item 757 stage named Live preserves proposed payload; actual release has its own plain words',()=>{
  for(const state of ['Review, round 2','Wait','Done','Check candidate','Live','Live · release 757']) {
    const next={...cover,items:[{...cover.items[0],state},cover.items[1]]};
    const actual=snapshot(coverSheet(miniDocument(),next,ctx));
    assertSheet757(actual,next);
    assert.equal(actual.rows[0].state,state);
    assert.equal(actual.acceptance,'proposed');
  }
});

test('reading item 757 configured literal-space filter reaches all ten own cases without a browser',async()=>{
  const names=[];
  await readingItem757Checks({check:async name=>names.push(name)},{});
  assert.equal(names.length,10);
  assert.equal(new Set(names).size,10);
  assert.ok(names.every(name=>/^reading item 757/.test(name)));
  for(const device of ['laptop','phone-320','phone-375','phone'])for(const theme of ['light','dark'])
    assert.ok(names.some(name=>name.endsWith(` ${device} ${theme}`)));
});
