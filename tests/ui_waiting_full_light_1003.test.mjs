import test from 'node:test';
import assert from 'node:assert/strict';
import { DimChoices, RailDimming } from '../web/rail-dimming.mjs';
import { paintState } from '../web/topic-state.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

// Real dim choices/paint and topic-state marks, bounded DOM ports; no layout claim.
function fixture(t) {
  const doc=miniDocument(),make=doc.createElement,prior=globalThis.document;doc.createElement=tag=>{const el=make(tag);el.hasAttribute=name=>el.getAttribute(name)!==null;return el;};globalThis.document=doc;t.after(()=>{globalThis.document=prior;});
  const host=doc.createElement('ul'),outcome=doc.createElement('li');outcome.className='ol-outcome';outcome.dataset.workspaceId='w';host.append(outcome);
  const row=doc.createElement('a');row.className='nav-item';row.dataset.topicId='target';outcome.append(row);
  const quiet=doc.createElement('a');quiet.className='nav-item';quiet.dataset.topicId='quiet';outcome.append(quiet);
  const saved=new Map(),writes=[];
  const choices=new DimChoices({getItem:k=>saved.get(k),setItem:(k,v)=>{saved.set(k,v);writes.push([k,v]);}});choices.bind('fixture','reader');
  const dim=Object.assign(Object.create(RailDimming.prototype),{host,choices,enabled:()=>true});
  const mark=(kind,alsoCover=false)=>{
    row.replaceChildren();row.removeAttribute('data-cover-waiting');
    const item={state:'active',asks:[]};
    if(kind==='named')Object.assign(item,{state:'waiting',waiting_on:['reader']});
    if(kind==='ask')item.asks=[{actor_id:'reader',by:'agent',message_id:'question'}];
    if(kind==='other')Object.assign(item,{state:'waiting',waiting_on:['someone-else']});
    paintState(row,item,'reader');
    if(kind==='cover'||alsoCover)row.setAttribute('data-cover-waiting','');
  };
  const snapshot=()=>JSON.stringify({value:choices.value,writes});
  return {host,outcome,row,quiet,choices,dim,mark,snapshot};
}
for(const kind of ['named','ask','cover'])for(const policy of ['topic','outcome','inverse'])
test(`1003 ${kind} reader wait overrides ${policy} dimming in both saved views and clearing restores it`,t=>{
  const f=fixture(t);
  for(const selected of [1,2]){
    f.choices.select(selected);
    if(policy==='topic')f.choices.toggle('w','target');
    if(policy==='outcome')f.choices.toggle('w');
    if(policy==='inverse')f.choices.toggle('elsewhere',null,true);
    f.mark(null);f.dim.paintRows();assert.equal(f.row.dataset.dimmed,'true','actual saved view dims before the wait');
    const saved=f.snapshot();f.mark(kind);f.dim.paintRows();assert.equal(f.row.dataset.dimmed,'false','a reader wait keeps full light');
    assert.equal(f.snapshot(),saved,'transient wait does not edit saved choices');
    f.mark(null);f.dim.paintRows();assert.equal(f.row.dataset.dimmed,'true','clear returns the saved view');assert.equal(f.snapshot(),saved);
  }
});

test('1003 the last remaining reader wait keeps a row bright',t=>{
  const f=fixture(t);f.choices.toggle('w','target');f.mark('ask',true);const saved=f.snapshot();
  f.dim.paintRows();assert.equal(f.row.dataset.dimmed,'false');
  f.mark('cover');f.dim.paintRows();assert.equal(f.row.dataset.dimmed,'false','clearing ask leaves cover wait');
  f.mark('named');f.dim.paintRows();assert.equal(f.row.dataset.dimmed,'false','clearing cover leaves named wait');
  f.mark(null);f.dim.paintRows();assert.equal(f.row.dataset.dimmed,'true');assert.equal(f.snapshot(),saved);
});

test('1003 waiting pill retains its own quiet-row dimming at0 and leaves outcome dimming alone',t=>{
  const f=fixture(t);f.choices.toggle('w');f.mark('named');f.host.dataset.only='waiting';
  f.dim.paintRows();assert.equal(f.row.dataset.dimmed,'false');assert.equal(f.quiet.dataset.dimmed,'true');assert.equal(f.outcome.dataset.dimmed,'true');
  f.choices.select(0);const saved=f.snapshot();f.dim.paintRows();assert.equal(f.row.dataset.dimmed,'false');assert.equal(f.quiet.dataset.dimmed,'true');
  delete f.host.dataset.only;f.dim.paintRows();assert.equal(f.quiet.dataset.dimmed,'false');assert.equal(f.snapshot(),saved);
});

test('1003 another person\'s named wait keeps the reader\'s dim choice',t=>{
  const f=fixture(t);f.choices.toggle('w','target');f.mark('other');const saved=f.snapshot();
  f.dim.paintRows();assert.equal(f.row.dataset.dimmed,'true');assert.equal(f.snapshot(),saved);
});
