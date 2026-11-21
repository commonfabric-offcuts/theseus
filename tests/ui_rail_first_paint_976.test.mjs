// Structural owner checks only; current native retention is in solid_left_rail_1005_native.mjs.
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
  const aside=make('aside','rail'),host=make('section','outline'),own=make('div','','ol-own');
  const topics=make('div','','topic-list'),link=make('a','','nav-item');
  link.dataset.topicId='kept-topic';link.textContent='The retained topic';topics.append(link);own.append(topics);host.append(own);aside.append(host);doc.body.append(aside);
  const oldPage=make('div','topic-navigation'),oldTopics=make('div','topics');oldPage.append(oldTopics);aside.append(oldPage);
  const calls=[],rail=Object.assign(Object.create(OutlineRail.prototype),{host,doc,run:0,
    menus:{reset:()=>calls.push('menus')},dossiers:{begin:()=>calls.push('dossiers')},notebookStars:{begin:()=>calls.push('stars')},
    outcomes:new Map([['w1',{own,rail:{invalidate:()=>calls.push('invalidate')}}]]),paintHeader:()=>calls.push('header')});
  return{doc,make,host,aside,own,topics,link,oldPage,oldTopics,rail,calls};
}
test('1005/976 navigation retains the actual styled list and row instead of a retired copy',()=>{
 const f=fixture(),own=f.own;f.rail.begin(true);
 assert.equal(f.own,own);assert.equal(f.own.inert,undefined);assert.equal(f.link.isConnected,true);
 assert.equal(f.link.parent,f.topics);assert.equal(f.topics.classList.contains('topic-list'),true);assert.equal(f.link.textContent,'The retained topic');
 f.rail.begin(true);assert.equal(f.link.parent,f.topics);assert.equal(f.calls.filter(x=>x==='invalidate').length,2);
});
test('1005/976 page ID retirement excludes retained outline rows and late callbacks stay with the old page',()=>{
 const f=fixture(),retired=retiredIds(f.doc);assert.equal(retired.get('topics'),f.oldTopics);
 assert.equal([...retired.values()].includes(f.link),false);f.rail.begin(true);f.oldPage.remove();
 const fresh=f.make('div','topics'),nav=f.make('div','topic-navigation');nav.append(fresh);f.aside.append(nav);
 assert.equal(f.doc.getElementById('topics'),fresh);retired.get('topics').textContent='late old response';
 assert.equal(f.link.textContent,'The retained topic');assert.equal(fresh.textContent,'');assert.equal(f.link.parent,f.topics);
 assert.deepEqual(f.calls,['menus','dossiers','stars','invalidate','header']);
});
