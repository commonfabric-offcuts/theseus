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
    append(...nodes) { this.children.push(...nodes); }
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

test('topic Refresh during More queues exactly one reread of what is loaded',async t=>{
  const f=fixture(t);f.queue.push(f.page(['a'],'a'));await f.rail.load();let release;
  f.queue.push(()=>new Promise(resolve=>release=resolve));const more=f.rail.load(true);
  const first=f.rail.load(),second=f.rail.load();assert.equal(first,second);f.queue.push(f.page(['a','b'],'b'),f.page(['c']));
  release(f.page(['b','c']));await more;await first;
  assert.deepEqual(f.calls.map(x=>x.cursor??null),[null,'a',null,'b']);assert.deepEqual(f.rail.pages.items.map(x=>x.id),['z','a','b','c']);
});

// A reload is asked for because something committed; a read already sent may
// not show it, so a reload never only joins one.
test('a reload asked for while a reload is reading runs once more after it, however many are asked', async t => {
  const f=fixture(t);let release;
  f.queue.push(()=>new Promise(resolve=>release=resolve),f.page(['a','b']));
  const refresh=f.rail.retry.onclick();
  const reload=f.rail.load(),again=f.rail.load();
  assert.notEqual(reload,refresh,'the reload does not settle with the read sent before it');assert.equal(reload,again);
  release(f.page(['a']));await refresh;await reload;
  assert.equal(f.calls.length,2,'one more read, made after the first');
  assert.deepEqual(f.rail.pages.items.map(x=>x.id),['z','a','b']);
  await f.rail.load();assert.equal(f.calls.length,3,'a later reload reads again');
});

test('a reload keeps the topics loaded with More: it reads them again, in pages as large as the view allows', async t => {
  const f=fixture(t);f.rail.pageMax=100;
  f.queue.push(f.page(['a','b'],'b'));await f.rail.load();
  f.queue.push(f.page(['c','d'],'d'));await f.rail.load(true);
  f.queue.push(f.page(['e','f'],'f'));await f.rail.load(true);
  // A row arrived inside what is loaded: the extent, not the count, says where to stop.
  f.queue.push(f.page(['a','b','b2','c'],'c'),f.page(['d','e','f'],'f'));
  await f.rail.load();
  assert.deepEqual(f.calls.slice(3),[{workspace_id:'w1',limit:20},{workspace_id:'w1',limit:20,cursor:'c'}]);
  assert.deepEqual(f.rail.pages.items.map(x=>x.id),['z','a','b','b2','c','d','e','f']);
  assert.equal(f.more.hidden,false,'what lies past the loaded rows is still behind More');
  // Past one page's worth, a reload asks for as many rows as are loaded, up to the view's maximum.
  const many=Array.from({length:45},(_,n)=>'r'+String(n).padStart(2,'0'));
  f.queue.push(f.page(many,'r44'));await f.rail.load();
  f.queue.push(f.page(many));await f.rail.load();
  assert.deepEqual(f.calls.at(-1),{workspace_id:'w1',limit:45});
  f.rail.pageMax=30;f.queue.push(f.page(many.slice(0,30),'r29'),f.page(many.slice(30)));await f.rail.load();
  assert.deepEqual(f.calls.slice(-2),[{workspace_id:'w1',limit:30},{workspace_id:'w1',limit:30,cursor:'r29'}]);
  assert.equal(f.rail.pages.loaded.size,45);
});

test('a reload whose later page fails leaves the list as it was and says so', async t => {
  const f=fixture(t);
  f.queue.push(f.page(['a'],'a'));await f.rail.load();
  f.queue.push(f.page(['b']));await f.rail.load(true);
  f.queue.push(f.page(['a'],'a'),()=>Promise.reject(Error('Offline')));
  assert.equal(await f.rail.load(),false);
  assert.deepEqual(f.rail.pages.items.map(x=>x.id),['z','a','b']);assert.equal(f.retry.hidden,false);
});

test('the open topic\'s row carries the count the list read for it', async t => {
  const f=fixture(t),unread=(id,count,addressed=0)=>({...f.item(id),unread:count,addressed});
  f.queue.push({instance_id:'i1',items:[unread('a',1),unread('z',3,1)],next_cursor:null});await f.rail.load();
  const row=f.host.children.find(x=>x.dataset.topicId==='z');
  assert.equal(row.children[0]?.textContent,'3');assert.match(row.children[1]?.textContent,/3 unread, 1 sent to you by name/);
  assert.equal(f.rail.pages.items.find(x=>x.id==='z').title,'z','the open topic still shows what the page knows of it');
});
