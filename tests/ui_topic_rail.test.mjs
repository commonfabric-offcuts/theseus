import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicPages, TopicRail, topicPosition } from '../web/topic-navigation.mjs';
function fixture(t, { folds = false, storage = null, current = null } = {}) {
  const previous = globalThis.document;
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.handlers = {}; }
    addEventListener(name,fn) { this.handlers[name]=fn; }
    getBoundingClientRect() { return this.box; }
    setAttribute(k,v) { this.attributes[k] = v; } removeAttribute(k) { delete this.attributes[k]; }
    insertBefore(child, before) { child.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index,0,child); child.parent = this; }
    // As in a browser, a node taken out of the page, even to be put back elsewhere, loses focus.
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); if (document.activeElement === this) document.activeElement = null; }
    focus() { document.activeElement = this; }
    append(...nodes) { for (const node of nodes) node.parent = this; this.children.push(...nodes); }
    contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
  }
  globalThis.document = { createElement: () => new Element(), activeElement: null }; t.after(() => { globalThis.document = previous; });
  // Ids in letter order were active latest first; the open topic z was active
  // latest of all, so it heads the list wherever a page puts it.
  const at = id => 3e8 - [...id.padEnd(4, '\0')].slice(0, 4).reduce((sum, c) => sum * 128 + c.charCodeAt(0), 0);
  const item = id => ({ id, title: id, workspace_id: 'w1', activity_ms: at(id) }), pos = id => topicPosition(item(id));
  const page = (ids,next=null) => ({ instance_id: 'i1', items: ids.map(item), next_cursor: next === null ? null : pos(next) });
  const nodes = Object.fromEntries(['host','more','retry','message','area'].map(key => [key,new Element()]));
  nodes.area.append(nodes.host, nodes.more, nodes.retry);
  // The Done and Archived lines: a details element, its summary's words, its list and its More.
  const fold = () => ({ details: new Element(), label: new Element(), host: new Element(), more: new Element() });
  const lines = folds ? { done: fold(), archived: fold() } : {};
  for (const line of Object.values(lines)) { nodes.area.append(line.details); line.details.append(line.host, line.more); }
  const calls = [], opened = [], queue = [];
  const rail = new TopicRail({ ...nodes, ...lines, storage, reader: 'tony', pages: new TopicPages('i1','w1',current ?? { ...item('z'), activity_ms: 4e8 }), read: args => { calls.push(args); const r = queue.shift(); return typeof r==='function'?r():Promise.resolve(r); }, open: (id, title) => opened.push(title === id ? id : [id, title]), denied: error => error.status===403 });
  return { ...nodes, ...lines, rail, calls, opened, queue, item, page, pos };
}
test('rail paging deduplicates current and hands final More focus to newly available links', async t => {
  const f=fixture(t);f.queue.push(f.page(['a','b'],'b'));await f.rail.load();
  const current=f.host.children[0];assert.equal(current.dataset.topicId,'z');assert.equal(current.attributes['aria-current'],'page');
  f.more.focus();f.queue.push(f.page(['c','z']));await f.more.onclick();
  assert.deepEqual(f.host.children.map(x=>x.dataset.topicId),['z','a','b','c']);assert.equal(f.host.children[0],current);
  assert.equal(f.more.hidden,true);assert.equal(document.activeElement.dataset.topicId,'c','final-page keyboard focus continues on the first newly added link');
  assert.deepEqual(f.calls,[{workspace_id:'w1',limit:20},{workspace_id:'w1',limit:20,cursor:f.pos('b')}]);
});
test('rail keeps previous links after errors, hides only on workspace denial and Retry restores access', async t => {
  const f=fixture(t);f.queue.push(f.page(['a','z']));await f.rail.load();
  const first=f.host.children[1];f.queue.push(()=>Promise.reject(Error('Offline')));await f.rail.load();
  assert.equal(f.host.hidden,false);assert.equal(f.host.children[1],first);assert.equal(f.retry.hidden,false);
  f.queue.push(()=>Promise.reject(Object.assign(Error('Denied'),{status:403})));await f.retry.onclick();
  assert.equal(f.host.hidden,true);f.rail.updateCurrent({...f.item('z'),title:'Renamed'});assert.equal(f.host.hidden,true);
  f.queue.push(f.page(['a','z']));await f.retry.onclick();assert.equal(f.host.hidden,false);
  assert.equal(f.host.children[0].textContent,'a');assert.equal(f.host.children[1].textContent,'Renamed');
});
test('rail coalesces repeated More and preserves native modified-link activation', async t => {
  const f=fixture(t);f.queue.push(f.page(['a'],'a'));await f.rail.load();
  let release;f.queue.push(()=>new Promise(resolve=>release=resolve));const first=f.more.onclick(),second=f.more.onclick();
  assert.equal(first,second);assert.equal(f.calls.length,2);release(f.page(['b','z']));await first;
  const a=f.host.children.find(x=>x.dataset.topicId==='a');let prevented=0;
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
  assert.deepEqual(f.calls.map(x=>x.cursor??null),[null,f.pos('a'),null,f.pos('b')]);assert.deepEqual(f.rail.pages.items.map(x=>x.id),['z','a','b','c']);
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
  assert.deepEqual(f.calls.slice(3),[{workspace_id:'w1',limit:20},{workspace_id:'w1',limit:20,cursor:f.pos('c')}]);
  assert.deepEqual(f.rail.pages.items.map(x=>x.id),['z','a','b','b2','c','d','e','f']);
  assert.equal(f.more.hidden,false,'what lies past the loaded rows is still behind More');
  // Rows that arrived early in the list do not cut the reload short of the last row loaded.
  f.queue.push(f.page(['a','a1','a2','a3','b','b2','c'],'c'),f.page(['d','e','f','g'],'g'));await f.rail.load();
  assert.deepEqual(f.rail.pages.items.map(x=>x.id).slice(-3),['e','f','g']);
  // Past one page's worth, a reload asks for as many rows as are loaded, up to the view's maximum.
  const many=Array.from({length:45},(_,n)=>'r'+String(n).padStart(2,'0'));
  f.queue.push(f.page(many,'r44'));await f.rail.load();
  f.queue.push(f.page(many));await f.rail.load();
  assert.deepEqual(f.calls.at(-1),{workspace_id:'w1',limit:45});
  f.rail.pageMax=30;f.queue.push(f.page(many.slice(0,30),'r29'),f.page(many.slice(30)));await f.rail.load();
  assert.deepEqual(f.calls.slice(-2),[{workspace_id:'w1',limit:30},{workspace_id:'w1',limit:30,cursor:f.pos('r29')}]);
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

test('a row drawn again with what it already shows is left alone, and one whose count changed is drawn anew', async t => {
  const f = fixture(t), counted = (id, unread) => ({ ...f.item(id), unread, addressed: 0 });
  f.queue.push({ instance_id: 'i1', items: [counted('a', 2), f.item('z')], next_cursor: null }); await f.rail.load();
  const link = f.host.children.find(x => x.dataset.topicId === 'a'), drawn = [...link.children];
  assert.equal(drawn[0].textContent, '2');
  f.queue.push({ instance_id: 'i1', items: [counted('a', 2), f.item('z')], next_cursor: null }); await f.rail.load();
  assert.equal(f.host.children[1], link);
  assert.deepEqual(link.children, drawn, 'the same badge, not a second one');
  f.queue.push({ instance_id: 'i1', items: [counted('a', 3), f.item('z')], next_cursor: null }); await f.rail.load();
  assert.equal(link.children.at(-2).textContent, '3');
  // Each thing a row shows, changed alone, draws it anew.
  const base = { ...counted('a', 3), state: 'waiting', waiting_on: ['x'] };
  for (const change of [{ state: 'review' }, { waiting_on: ['y'] }, { asks: [{ actor_id: 'y', message_id: 'm1', by: 'x', since_ms: 1 }] },
    { state_note: 'note' }, { addressed: 1 }, { title: 'A' }, { work: { observed: true, seen_ms: 1, by: 'x', how: 'posted', waits: false } }]) {
    f.queue.push({ instance_id: 'i1', items: [base, f.item('z')], next_cursor: null }); await f.rail.load();
    const before = [...link.children];
    f.queue.push({ instance_id: 'i1', items: [{ ...base, ...change }, f.item('z')], next_cursor: null }); await f.rail.load();
    assert.notDeepEqual(link.children, before, JSON.stringify(change));
  }
});

test('a row shows the work dot only while the server observes work, and says when activity was last seen', async t => {
  const f = fixture(t), at = new Date(2026, 10, 5, 7, 41).getTime();
  const busy = { ...f.item('a'), work: { observed: true, seen_ms: at, by: 'fable', how: 'turn', waits: false } };
  const quiet = { ...f.item('b'), work: { observed: false, seen_ms: at, by: 'fable', how: 'posted', waits: false } };
  f.queue.push({ instance_id: 'i1', items: [busy, quiet, f.item('z')], next_cursor: null }); await f.rail.load();
  const [a, b] = ['a', 'b'].map(id => f.host.children.find(x => x.dataset.topicId === id));
  assert.deepEqual(a.children.map(node => node.className), ['topic-work', 'sr-only']);
  assert.equal(a.attributes.title, 'Activity seen 7:41 AM Thu Nov 5 (fable took a turn)');
  assert.deepEqual(b.children.map(node => node.className), ['sr-only']);
  assert.equal(b.attributes.title, 'No activity seen since 7:41 AM Thu Nov 5');
});
// The key under the topics, which says what the work ring means, shows only
// while a row wears the ring.
test('the key to the work ring shows while a row has observed work, and not otherwise', async t => {
  const f = fixture(t), key = { hidden: true };
  const rail = new TopicRail({ host: f.host, more: f.more, retry: f.retry, message: f.message, key, pages: new TopicPages('i1', 'w1', null),
    read: () => Promise.resolve(f.queue.shift()), open() {}, denied: () => false, reader: 'tony' });
  const work = observed => ({ observed, seen_ms: 1, by: 'fable', how: 'posted', waits: false });
  f.queue.push({ instance_id: 'i1', items: [{ ...f.item('a'), work: work(false) }, f.item('b')], next_cursor: null });
  await rail.load();
  assert.equal(key.hidden, true, 'no ring, no key');
  f.queue.push({ instance_id: 'i1', items: [{ ...f.item('a'), work: work(true) }, f.item('b')], next_cursor: null });
  await rail.load();
  assert.equal(key.hidden, false, 'a ring on a row: the key says what it means');
  f.queue.push({ instance_id: 'i1', items: [{ ...f.item('a'), work: work(false) }], next_cursor: null });
  await rail.load();
  assert.equal(key.hidden, true, 'the ring gone, the key goes');
});

// Done and archived topics fold into a line each, under the rest.
const shown = host => host.children.map(x => x.dataset.topicId);
const memory = () => { const kept = new Map(); return { kept, getItem: k => kept.get(k) ?? null, setItem: (k, v) => kept.set(k, v) }; };
const listed = (f, ids, groups, extra = {}) => ({ ...f.page(ids), groups, ...extra });
const as = (f, id, fields) => ({ ...f.item(id), ...fields });

test('done and archived topics fold into lines that say how many they hold and are read only when opened', async t => {
  const f = fixture(t, { folds: true, current: { ...f0('t1') } });
  function f0(id) { return { id, title: id, workspace_id: 'w1', activity_ms: 1 }; }
  f.queue.push(listed(f, ['a', 'b'], { done: 2, archived: 1 }));
  await f.rail.load();
  assert.deepEqual(f.calls, [{ workspace_id: 'w1', limit: 20 }], 'a closed line is not read');
  assert.deepEqual(shown(f.host), ['a', 'b', 't1']);
  assert.equal(f.done.details.hidden, false); assert.equal(f.done.label.textContent, 'Done (2)');
  assert.equal(f.archived.details.hidden, false); assert.equal(f.archived.label.textContent, 'Archived (1)');
  assert.deepEqual(shown(f.done.host), []);
  // Opening the Done line reads the done list, which says done to the server.
  f.done.details.open = true;
  f.queue.push({ instance_id: 'i1', items: [as(f, 'c', { state: 'done' }), as(f, 'd', { state: 'done' })], next_cursor: null, groups: { done: 2, archived: 1 } });
  f.done.details.handlers.toggle(); await f.rail.loading;
  assert.deepEqual(f.calls.at(-1), { workspace_id: 'w1', done: true, limit: 20 });
  assert.deepEqual(shown(f.done.host), ['c', 'd']);
  // A reload reads every open line again, and only those.
  f.queue.push(listed(f, ['a', 'b'], { done: 2, archived: 1 }), { instance_id: 'i1', items: [as(f, 'd', { state: 'done' })], next_cursor: null, groups: { done: 1, archived: 1 } });
  await f.rail.load();
  assert.deepEqual(f.calls.slice(-2), [{ workspace_id: 'w1', limit: 20 }, { workspace_id: 'w1', done: true, limit: 20 }]);
  assert.deepEqual(shown(f.done.host), ['d']); assert.equal(f.done.label.textContent, 'Done (1)');
  // A row in a done line opens its topic with its own title.
  f.done.host.children[0].onclick({ button: 0, preventDefault() {} });
  assert.deepEqual(f.opened, ['d']);
  // The archived line reads the archived list.
  f.archived.details.open = true;
  f.queue.push({ instance_id: 'i1', items: [as(f, 'e', { archived: true }), as(f, 'g', { archived: true, state: 'done' })], next_cursor: null, groups: { done: 1, archived: 2 } });
  f.archived.details.handlers.toggle(); await f.rail.loading;
  assert.deepEqual(f.calls.at(-1), { workspace_id: 'w1', archived: true, limit: 20 });
  assert.deepEqual(shown(f.archived.host), ['e', 'g']); assert.equal(f.archived.label.textContent, 'Archived (2)');
  // An empty line is not shown.
  f.queue.push(listed(f, ['a'], { done: 0, archived: 0 }), { instance_id: 'i1', items: [], next_cursor: null, groups: { done: 0, archived: 0 } },
    { instance_id: 'i1', items: [], next_cursor: null, groups: { done: 0, archived: 0 } });
  await f.rail.load();
  assert.equal(f.done.details.hidden, true); assert.equal(f.archived.details.hidden, true);
});

test('a line stays open or closed as the person left it, per person on this browser', async t => {
  const storage = memory();
  const f = fixture(t, { folds: true, storage });
  assert.equal(f.done.details.open, false, 'closed until opened');
  f.done.details.open = true; f.queue.push(listed(f, [], { done: 1, archived: 0 }));
  f.done.details.handlers.toggle(); await f.rail.loading;
  assert.deepEqual([...storage.kept.values()].map(v => JSON.parse(v)), [{ done: true }]);
  assert.deepEqual([...storage.kept.keys()], ['aim-next.topic-lists.i1.tony']);
  // The next page this person opens starts with Done open and reads it with the rest.
  const again = fixture(t, { folds: true, storage });
  assert.equal(again.done.details.open, true); assert.equal(again.archived.details.open, false);
  again.queue.push(listed(again, ['a'], { done: 1, archived: 0 }), { instance_id: 'i1', items: [as(again, 'c', { state: 'done' })], next_cursor: null, groups: { done: 1, archived: 0 } });
  await again.rail.load();
  assert.deepEqual(again.calls, [{ workspace_id: 'w1', limit: 20 }, { workspace_id: 'w1', done: true, limit: 20 }]);
  assert.deepEqual(shown(again.done.host), ['c']);
  // Closing it is kept too; storage that fails leaves the line working.
  again.done.details.open = false; again.done.details.handlers.toggle();
  assert.deepEqual(JSON.parse(storage.kept.get('aim-next.topic-lists.i1.tony')), { done: false });
  const broken = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  const third = fixture(t, { folds: true, storage: broken });
  assert.equal(third.done.details.open, false);
  third.done.details.open = true; third.queue.push(listed(third, [], { done: 0, archived: 0 }));
  third.done.details.handlers.toggle(); await third.rail.loading;
  assert.equal(third.calls.length, 1);
});

test('a topic that moved between lists is shown once, where the list read last puts it, and the open topic where its state puts it', async t => {
  const f = fixture(t, { folds: true });
  f.done.details.open = true;
  // b was said done between the two reads of one reload: the done list, read last, has it.
  f.queue.push(listed(f, ['a', 'b'], { done: 1, archived: 0 }), { instance_id: 'i1', items: [as(f, 'b', { state: 'done' }), as(f, 'c', { state: 'done' })], next_cursor: null, groups: { done: 2, archived: 0 } });
  await f.rail.load();
  assert.deepEqual(shown(f.host), ['z', 'a']); assert.deepEqual(shown(f.done.host), ['b', 'c']);
  // The open topic, said done on this page, moves to the done line before any list is read again.
  f.rail.updateCurrent({ ...f.item('z'), activity_ms: 4e8, state: 'done' });
  assert.deepEqual(shown(f.host), ['a']); assert.deepEqual(shown(f.done.host), ['z', 'b', 'c']);
});

// A closed line read earlier keeps its rows from then; once the counts say it
// holds nothing, those rows do not keep it on the page (review of 72-98, finding 1).
test('a closed line whose last topic left it is not shown, with nothing behind it; the open topic said done before the line was read keeps it', async t => {
  const f = fixture(t, { folds: true });
  f.done.details.open = true;
  f.queue.push(listed(f, ['a'], { done: 1, archived: 0 }), { instance_id: 'i1', items: [as(f, 'c', { state: 'done' })], next_cursor: null, groups: { done: 1, archived: 0 } });
  await f.rail.load();
  assert.deepEqual(shown(f.done.host), ['c']); assert.equal(f.done.label.textContent, 'Done (1)');
  // The person closes the line; then a message reopens c, the last done topic.
  f.done.details.open = false; f.done.details.handlers.toggle();
  f.queue.push(listed(f, ['a', 'c'], { done: 0, archived: 0 }));
  await f.rail.load();
  assert.deepEqual(f.calls.at(-1), { workspace_id: 'w1', limit: 20 }, 'the closed line is not read');
  assert.deepEqual(shown(f.host), ['z', 'a', 'c']);
  assert.equal(f.done.details.hidden, true, 'no "Done (0)" line with nothing behind it: ' + f.done.label.textContent);
  // The open topic said done on this page, before the Done line was ever read, keeps the line shown, holding it.
  const g = fixture(t, { folds: true });
  g.queue.push(listed(g, ['a'], { done: 0, archived: 0 }));
  await g.rail.load();
  assert.equal(g.done.details.hidden, true);
  g.rail.updateCurrent({ ...g.item('z'), activity_ms: 4e8, state: 'done' });
  assert.deepEqual(shown(g.done.host), ['z']);
  assert.equal(g.done.details.hidden, false, 'the open topic, now done, is in the Done line');
});

test('the outcome is empty only when no list holds a topic', async t => {
  const f = fixture(t, { folds: true, current: null });
  f.rail.pages.current = null; for (const list of f.rail.lists) list.pages.current = null;
  assert.equal(f.rail.empty, false, 'not before the list is read');
  f.queue.push(listed(f, [], { done: 1, archived: 0 })); await f.rail.load();
  assert.equal(f.rail.empty, false, 'a done topic is a topic');
  f.queue.push(listed(f, [], { done: 0, archived: 1 })); await f.rail.load();
  assert.equal(f.rail.empty, false, 'so is an archived one');
  f.queue.push(listed(f, [], { done: 0, archived: 0 })); await f.rail.load();
  assert.equal(f.rail.empty, true);
});

// The list keeps still under the pointer and around the focused row.
const moved = (f, id, activity_ms, fields = {}) => ({ ...f.item(id), activity_ms, ...fields });

test('a change found while the pointer is over the list redraws its rows in place and moves them once the pointer leaves', async t => {
  const f = fixture(t);
  f.queue.push(f.page(['a', 'b', 'c'])); await f.rail.load();
  assert.deepEqual(shown(f.host), ['z', 'a', 'b', 'c']);
  const rows = [...f.host.children];
  f.area.handlers.pointerenter?.();
  // c is written in, so it comes first after z; b is renamed; a new topic arrives.
  f.queue.push({ instance_id: 'i1', items: [moved(f, 'c', 3.5e8), moved(f, 'aa', 3.4e8), f.item('a'), { ...f.item('b'), title: 'B renamed' }], next_cursor: null });
  await f.rail.load();
  assert.deepEqual(shown(f.host), ['z', 'a', 'b', 'c'], 'nothing moves under the pointer');
  assert.deepEqual([...f.host.children], rows);
  assert.equal(rows[2].textContent, 'B renamed', 'what a row says is current');
  f.area.handlers.pointerleave?.();
  assert.deepEqual(shown(f.host), ['z', 'c', 'aa', 'a', 'b'], 'once the pointer leaves, the list takes its order');
  // A later change with the pointer away moves at once.
  f.queue.push(f.page(['a', 'b', 'c'])); await f.rail.load();
  assert.deepEqual(shown(f.host), ['z', 'a', 'b', 'c']);
});

test('what the person asks for under the pointer shows at once', async t => {
  const f = fixture(t);
  f.queue.push(f.page(['a', 'b'], 'b')); await f.rail.load();
  f.area.handlers.pointerenter?.();
  f.queue.push(f.page(['c'])); await f.more.onclick();
  assert.deepEqual(shown(f.host), ['z', 'a', 'b', 'c'], 'More adds its rows under the pointer');
  f.queue.push(() => Promise.reject(Error('Offline'))); await f.rail.load();
  f.queue.push({ instance_id: 'i1', items: [moved(f, 'c', 3.5e8), f.item('a'), f.item('b')], next_cursor: null }); await f.retry.onclick();
  assert.deepEqual(shown(f.host), ['z', 'c', 'a', 'b'], 'and so does Retry');
});

test('a focused row keeps its focus while rows move around it, and leaves its list only once focus moves on', async t => {
  const f = fixture(t, { folds: true });
  f.done.details.open = true;
  const empty = { instance_id: 'i1', items: [], next_cursor: null, groups: { done: 0, archived: 0 } };
  f.queue.push(listed(f, ['a', 'b', 'c'], { done: 0, archived: 0 }), empty); await f.rail.load();
  const b = f.host.children.find(x => x.dataset.topicId === 'b'); b.focus();
  // b is written in: it moves to the top, and keeps the focus.
  f.queue.push(listed(f, [], { done: 0, archived: 0 }, { items: [moved(f, 'b', 3.5e8), f.item('a'), f.item('c')] }), empty);
  await f.rail.load();
  assert.deepEqual(shown(f.host), ['z', 'b', 'a', 'c']);
  assert.equal(document.activeElement, b, 'the focused row was not taken out to move it');
  // b is said done elsewhere: it stays where it is, focused, until focus moves on.
  f.queue.push(listed(f, ['a', 'c'], { done: 1, archived: 0 }), { ...empty, items: [as(f, 'b', { state: 'done' })], groups: { done: 1, archived: 0 } });
  await f.rail.load();
  assert.deepEqual(shown(f.host), ['z', 'b', 'a', 'c']); assert.deepEqual(shown(f.done.host), []);
  assert.equal(document.activeElement, b);
  const a = f.host.children.find(x => x.dataset.topicId === 'a'); a.focus(); f.area.handlers.focusin?.();
  assert.deepEqual(shown(f.host), ['z', 'a', 'c']); assert.deepEqual(shown(f.done.host), ['b']);
  assert.equal(document.activeElement, a);
  // A topic that leaves every list while focused stays until focus leaves the lists.
  f.queue.push(listed(f, ['c'], { done: 1, archived: 0 }), { ...empty, items: [as(f, 'b', { state: 'done' })], groups: { done: 1, archived: 0 } });
  await f.rail.load();
  assert.deepEqual(shown(f.host), ['z', 'a', 'c']); assert.equal(document.activeElement, a);
  document.activeElement = null; f.area.handlers.focusout?.({ relatedTarget: null });
  assert.deepEqual(shown(f.host), ['z', 'c']);
});

// Focus moving from one row to another passes through no row: in a browser the
// row losing it fires focusout before the next row has it. Moving rows then
// could take away the row the focus is going to, so the lists wait for focusin.
test('focus going from one row to another moves nothing until it lands, then the row it left moves on', async t => {
  const f = fixture(t, { folds: true });
  f.done.details.open = true;
  const empty = { instance_id: 'i1', items: [], next_cursor: null, groups: { done: 0, archived: 0 } };
  f.queue.push(listed(f, ['a', 'b', 'c'], { done: 0, archived: 0 }), empty); await f.rail.load();
  const b = f.host.children.find(x => x.dataset.topicId === 'b'); b.focus();
  f.queue.push(listed(f, ['a', 'c'], { done: 1, archived: 0 }), { ...empty, items: [as(f, 'b', { state: 'done' })], groups: { done: 1, archived: 0 } });
  await f.rail.load();
  assert.deepEqual(shown(f.host), ['z', 'a', 'b', 'c'], 'b stays while it has the focus');
  // Tab to c: b loses the focus first, toward c, while nothing has it.
  const c = f.host.children.find(x => x.dataset.topicId === 'c');
  document.activeElement = null; f.area.handlers.focusout({ relatedTarget: c });
  assert.deepEqual(shown(f.host), ['z', 'a', 'b', 'c'], 'nothing moves while the focus is between two rows');
  assert.deepEqual(shown(f.done.host), []);
  c.focus(); f.area.handlers.focusin();
  assert.deepEqual(shown(f.host), ['z', 'a', 'c']); assert.deepEqual(shown(f.done.host), ['b']);
  assert.equal(document.activeElement, c, 'the focus is on the row it went to');
});

test('opening a line under the pointer shows its rows at once, whether it was read before or opens while another read runs', async t => {
  const f = fixture(t, { folds: true }), done = (...ids) => ({ instance_id: 'i1', items: ids.map(id => as(f, id, { state: 'done' })), next_cursor: null, groups: { done: ids.length, archived: 0 } });
  f.done.details.open = true;
  f.queue.push(listed(f, ['a'], { done: 1, archived: 0 }), done('c')); await f.rail.load();
  assert.deepEqual(shown(f.done.host), ['c']);
  // Closed, the line is not read; b is said done meanwhile.
  f.done.details.open = false; f.done.details.handlers.toggle();
  f.queue.push(listed(f, ['a'], { done: 2, archived: 0 })); await f.rail.load();
  // The pointer is on the list, as it is whenever the summary is clicked.
  f.area.handlers.pointerenter?.();
  f.done.details.open = true;
  f.queue.push(listed(f, ['a'], { done: 2, archived: 0 }), done('b', 'c'));
  f.done.details.handlers.toggle(); await f.rail.loading;
  assert.equal(f.done.label.textContent, 'Done (2)');
  assert.deepEqual(shown(f.done.host), ['b', 'c'], 'a line read before opens with what it holds now');
  // A line opened for the first time while another read runs reads once that one ends, and shows at once too.
  const archived = { instance_id: 'i1', items: [as(f, 'e', { archived: true })], next_cursor: null, groups: { done: 2, archived: 1 } };
  let release; f.queue.push(() => new Promise(resolve => release = resolve), done('b', 'c'));
  const running = f.rail.load();
  f.archived.details.open = true;
  f.queue.push(listed(f, ['a'], { done: 2, archived: 1 }), done('b', 'c'), archived);
  f.archived.details.handlers.toggle();
  const queued = f.rail.queued;
  release(listed(f, ['a'], { done: 2, archived: 0 })); assert.equal(await running, true, f.message.textContent); assert.equal(await queued, true, f.message.textContent);
  assert.deepEqual(shown(f.archived.host), ['e'], 'the line opened during a read shows its rows under the pointer');
  // A reload nobody asked for, after it, still keeps still under the pointer.
  f.queue.push(listed(f, ['a', 'g'], { done: 2, archived: 1 }), done('b', 'c'), archived);
  await f.rail.load();
  assert.deepEqual(shown(f.host), ['z', 'a'], 'an unasked reload still holds rows under the pointer');
  // So does an unasked reload that waits on another read: an earlier asked one does not carry over.
  f.queue.push(() => new Promise(resolve => release = resolve), done('b', 'c'), archived);
  const reading = f.rail.load(), waiting = f.rail.load();
  f.queue.push(listed(f, ['a', 'g', 'h'], { done: 2, archived: 1 }), done('b', 'c'), archived);
  release(listed(f, ['a', 'g'], { done: 2, archived: 1 })); assert.equal(await reading, true, f.message.textContent); assert.equal(await waiting, true, f.message.textContent);
  assert.deepEqual(shown(f.host), ['z', 'a'], 'a waiting reload nobody asked for holds rows under the pointer');
  f.area.handlers.pointerleave?.();
  assert.deepEqual(shown(f.host), ['z', 'a', 'g', 'h']);
});
