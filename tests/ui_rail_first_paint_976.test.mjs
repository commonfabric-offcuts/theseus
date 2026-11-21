// Structural owner checks only; actual paint is in rail_first_paint_976_native.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Element, matches } from './fixtures/mini_dom.mjs';
import { OutlineRail } from '../web/outline-rail.mjs';
import { retiredIds } from '../web/in-place-navigation.mjs';

function fixture() {
  class Dom extends Element {
    matches(selector) { return matches(this,selector); }
    removeAttribute(name) { super.removeAttribute(name); if(name === 'id') this.id = ''; }
  }
  const doc = {}, make = (tag, id='', className='') => { const node=Object.assign(new Dom(tag,doc),{id,className}); if(id)node.setAttribute('id',id); return node; };
  doc.body=make('body');doc.body.root=true;
  doc.querySelector=selector=>selector==='#main > .topic-header'?null:doc.body.querySelector(selector);
  doc.getElementById=id=>doc.body.querySelector('#'+id);
  const aside=make('aside','rail'), host=make('section','outline'), adopted=make('div','topic-navigation','ol-adopted');
  adopted.dataset.pagePart='';
  const topics=make('div','topics'), link=make('a','','nav-item'), more=make('button','more-topics');
  link.dataset.topicId='kept-topic';link.textContent='The retained topic';
  topics.append(link);adopted.append(topics,more);host.append(adopted);aside.append(host);doc.body.append(aside);
  const untouched=make('div','','topic-list');host.append(untouched);
  const calls=[], rail=Object.assign(Object.create(OutlineRail.prototype),{host,doc,run:0,
    menus:{reset:()=>calls.push('menus')},dossiers:{begin:()=>calls.push('dossiers')},notebookStars:{begin:()=>calls.push('stars')},
    outcomes:new Map([['w1',{adopted}]]),paintHeader:()=>calls.push('header')});
  return {doc,make,host,adopted,topics,link,more,untouched,rail,calls};
}

test('976 the visible retired list retains its styling identity until its replacement arrives',()=>{
  const f=fixture();f.rail.begin(true);
  assert.equal(f.topics.classList.contains('topic-list'),true,'the same list remains matched by rail styles after its page ID retires');
  assert.equal(f.adopted.inert,true);assert.equal(f.link.isConnected,true);
  assert.equal(f.link.parent,f.topics);assert.equal(f.link.textContent,'The retained topic');
  assert.equal(f.untouched.className,'topic-list','another outcome retains its own list');
  f.rail.begin(true);assert.equal(f.topics.classList.contains('topic-list'),true,'the idless retained list survives another begin');
});

test('976 styling retention preserves945 fresh-ID lookup and the retired run callback owner',()=>{
  const f=fixture(), retired=retiredIds(f.doc);
  assert.equal(retired.get('topics'),f.topics);assert.equal(retired.get('more-topics'),f.more);
  f.rail.begin(true);
  const fresh=f.make('div','topics'),nav=f.make('div','topic-navigation');nav.append(fresh);f.host.append(nav);
  assert.equal(f.doc.getElementById('topics'),fresh);assert.equal(f.doc.getElementById('topic-navigation'),nav);
  assert.equal(f.adopted.id,'');assert.equal(f.topics.id,'');assert.equal(f.more.id,'');
  retired.get('topics').textContent='late retired response';
  assert.equal(f.topics.textContent,'late retired response');assert.equal(fresh.textContent,'');
  assert.deepEqual(f.calls,['menus','dossiers','stars','header']);
});
