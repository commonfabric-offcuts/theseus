import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicPages, TopicRail } from '../web/topic-navigation.mjs';
function fixture(t) {
  const previous = globalThis.document;
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.handlers = {}; }
    addEventListener(name,fn) { this.handlers[name]=fn; }
    getBoundingClientRect() { return this.box; }
    setAttribute(k,v) { this.attributes[k] = v; } removeAttribute(k) { delete this.attributes[k]; }
    insertBefore(child, before) { child.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index,0,child); child.parent = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
    focus() { document.activeElement = this; }
  }
  globalThis.document = { createElement: () => new Element(), activeElement: null }; t.after(() => { globalThis.document = previous; });
  const item = id => ({ id, title: id, workspace_id: 'w1' }), page = (ids,next_cursor=null) => ({ instance_id: 'i1', items: ids.map(item), next_cursor });
  const nodes = Object.fromEntries(['host','more','retry','message'].map(key => [key,new Element()]));
  const calls = [], opened = [], queue = [];
  const rail = new TopicRail({ ...nodes, pages: new TopicPages('i1','w1',item('z')), read: args => { calls.push(args); const r = queue.shift(); return typeof r==='function'?r():Promise.resolve(r); }, open: id => opened.push(id), denied: error => error.status===403 });
  return { ...nodes, rail, calls, opened, queue, item, page };
}
test('rail paging deduplicates current and hands final More focus to newly available links', async t => {
  const f=fixture(t);f.queue.push(f.page(['a','b'],'b'));await f.rail.load();
  const current=f.host.children[0];assert.equal(current.dataset.topicId,'z');assert.equal(current.attributes['aria-current'],'page');
  f.more.focus();f.queue.push(f.page(['c','z']));await f.more.onclick();
  assert.deepEqual(f.host.children.map(x=>x.dataset.topicId),['a','b','c','z']);assert.equal(f.host.children[3],current);
  assert.equal(f.more.hidden,true);assert.equal(document.activeElement.dataset.topicId,'c','final-page keyboard focus continues on the first newly added link');
  assert.deepEqual(f.calls,[{workspace_id:'w1',limit:20},{workspace_id:'w1',limit:20,cursor:'b'}]);
});
test('rail keeps previous links after errors, hides only on workspace denial and Retry restores access', async t => {
  const f=fixture(t);f.queue.push(f.page(['a','z']));await f.rail.load();
  const first=f.host.children[0];f.queue.push(()=>Promise.reject(Error('Offline')));await f.rail.load();
  assert.equal(f.host.hidden,false);assert.equal(f.host.children[0],first);assert.equal(f.retry.hidden,false);
  f.queue.push(()=>Promise.reject(Object.assign(Error('Denied'),{status:403})));await f.retry.onclick();
  assert.equal(f.host.hidden,true);f.rail.updateCurrent({...f.item('z'),title:'Renamed'});assert.equal(f.host.hidden,true);
  f.queue.push(f.page(['a','z']));await f.retry.onclick();assert.equal(f.host.hidden,false);
  assert.equal(f.host.children[0].textContent,'a');assert.equal(f.host.children[1].textContent,'Renamed');
});
test('rail coalesces repeated More and preserves native modified-link activation', async t => {
  const f=fixture(t);f.queue.push(f.page(['a'],'a'));await f.rail.load();
  let release;f.queue.push(()=>new Promise(resolve=>release=resolve));const first=f.more.onclick(),second=f.more.onclick();
  assert.equal(first,second);assert.equal(f.calls.length,2);release(f.page(['b','z']));await first;
  const a=f.host.children[0];let prevented=0;
  a.onclick({button:0,metaKey:true,preventDefault(){prevented++;}});assert.equal(prevented,0);assert.deepEqual(f.opened,[]);
  a.onclick({button:0,preventDefault(){prevented++;}});assert.equal(prevented,1);assert.deepEqual(f.opened,['a']);assert.equal(a.href,'?topic=a');
});

 test('rail ignores a touch retargeted from the gap but retains a deliberate link tap', t => {
  const f=fixture(t),link=f.host.children[0];link.box={left:50,right:150,top:10,bottom:54};let prevented=0;
  const touch=x=>({target:{closest:()=>link},changedTouches:[{clientX:x,clientY:25}],preventDefault(){prevented++;}});
  assert.equal(typeof f.host.handlers.touchend,'function');
  f.host.handlers.touchend(touch(45));assert.equal(prevented,1);
  f.host.handlers.touchend(touch(75));assert.equal(prevented,1,'an actual tap inside the link keeps its native click');
});
