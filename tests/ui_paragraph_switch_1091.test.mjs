import test from 'node:test';
import assert from 'node:assert/strict';
import {ParagraphSwitch} from '../web/paragraph-switch.mjs';
import {TextDisplayPreferences} from '../web/text-display-rules.mjs';
import {miniDocument} from './fixtures/mini_dom.mjs';

const id='break-out-paragraphs',storageKey=JSON.stringify(['aim-next','i','actor','text-display',id]);
function fixture({storage,withFoot=true,current=()=>true}={}) {
  const doc=miniDocument();doc.body=doc.byId('body');doc.documentElement=doc.body;
  const make=doc.createElement;doc.createElement=tag=>{const node=make(tag);Object.defineProperty(node,'parentElement',{get(){return this.parent;}});return node;};
  doc.querySelector=selector=>doc.body.querySelector(selector);doc.querySelectorAll=selector=>doc.body.querySelectorAll(selector);
  const foot=doc.createElement('div');foot.className='rail-foot';if(withFoot)doc.body.append(foot);
  class Observer {constructor(callback){this.callback=callback;this.connected=false;}observe(){this.connected=true;}disconnect(){this.connected=false;}}
  const preferences=new TextDisplayPreferences('i','actor',storage),changes=[];
  const control=new ParagraphSwitch({doc,preferences,current,changed:()=>changes.push([...preferences.enabled]),MutationObserver:Observer});
  return {doc,foot,preferences,changes,control};
}
const press=(f,value)=>f.control.element.querySelectorAll('button').find(button=>button.dataset.value===value).listeners.click();
const states=f=>f.control.element.querySelectorAll('button').map(b=>[b.textContent,b.getAttribute('aria-pressed')]);

test('1091 Paragraphs defaults Joined and writes only the existing exact preference key on a changed choice',()=>{
  const values=new Map(),writes=[],storage={getItem:k=>values.get(k),setItem(k,v){writes.push([k,v]);values.set(k,v);}},f=fixture({storage});
  assert.deepEqual(states(f),[['Joined','true'],['Broken out','false']]);assert.deepEqual(writes,[]);
  press(f,'on');assert.deepEqual(writes,[[storageKey,'on']]);assert.deepEqual(f.changes,[[id]]);
  press(f,'on');assert.equal(writes.length,1);assert.equal(f.changes.length,1);
  press(f,'off');assert.deepEqual(writes,[[storageKey,'on'],[storageKey,'off']]);assert.deepEqual(f.changes,[[id],[]]);f.control.dispose();
});
test('1091 Paragraphs reload reads its existing choice without rewriting it',()=>{
  const storage={getItem:k=>k===storageKey?'on':null,setItem(){assert.fail('mount is not a preference write');}},f=fixture({storage});
  assert.deepEqual(states(f),[['Joined','false'],['Broken out','true']]);assert.deepEqual(f.changes,[]);f.control.dispose();
});
test('1091 replacement rail foot gets one live switch with its existing choice; copied controls are discarded',()=>{
  const f=fixture();press(f,'on');const own=f.control.element;
  f.foot.remove();f.control.observer.callback();assert.equal(own.isConnected,false);
  const next=f.doc.createElement('div');next.className='rail-foot';
  const copied=f.doc.createElement('span');copied.className='look-switch';copied.dataset.switch='paragraphs';next.append(copied);f.doc.body.append(next);
  f.control.observer.callback();f.control.observer.callback();
  assert.equal(f.control.element,own);assert.equal(own.parentElement,next);assert.equal(copied.isConnected,false);
  assert.equal(f.doc.querySelectorAll('.look-switch[data-switch="paragraphs"]').length,1);
  assert.deepEqual(states(f),[['Joined','false'],['Broken out','true']]);assert.equal(f.changes.length,1);f.control.dispose();
});
test('1091 a late foot mounts, and retirement disconnects observation and defeats a stale button action',()=>{
  const f=fixture({withFoot:false});assert.equal(f.control.element,null);assert.equal(f.control.observer.connected,true);
  f.doc.body.append(f.foot);f.control.observer.callback();const button=f.control.element.querySelectorAll('button')[1],stale=button.listeners.click;
  f.control.dispose();assert.equal(f.control.observer.connected,false);assert.equal(f.control.listening.signal.aborted,true);
  f.control.observer.callback();stale();assert.equal(f.control.element.isConnected,false);assert.deepEqual(f.preferences.enabled,[]);assert.deepEqual(f.changes,[]);
});
test('1091 denied storage still offers an in-memory choice; a retired app run cannot change it',()=>{
  let current=true;const storage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}},f=fixture({storage,current:()=>current});
  press(f,'on');assert.deepEqual(states(f),[['Joined','false'],['Broken out','true']]);assert.deepEqual(f.preferences.enabled,[id]);
  current=false;press(f,'off');assert.deepEqual(f.preferences.enabled,[id]);assert.equal(f.changes.length,1);f.control.dispose();
});
