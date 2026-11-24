import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { OutlineMenus } from '../web/outline-menus.mjs';
import { OutlineRail } from '../web/outline-rail.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';
import { NotebookRailMenu } from '../web/notebook-rail-menu.mjs';
import { notebookSheetMenuItems } from '../web/notebook-sheet.mjs';
import { RailMenuCommands } from '../web/rail-menu-commands.mjs';
import { topicMenuItems } from '../web/topic-menu-items.mjs';
import { readTopicList, TopicPages, TopicRail } from '../web/topic-navigation.mjs';
import { TopicStatePanel, topicUpdateEnvelope } from '../web/topic-state.mjs';
import { menuRouteValid, consumeMenuRoute } from '../web/menu-route.mjs';
import { shareLinksFrom } from '../web/links.mjs';
import { feedKey, headerRows } from '../web/panes.mjs';
import { paintTopicHeader } from '../web/topic-header.mjs';

function fixture(kind) {
  const r = renderer799(), doc = r.list.ownerDocument, shown = [], reads = [], sent = [];
  doc.addEventListener = () => {}; doc.defaultView = { location: { href: 'https://fixture.invalid/?workspace=w' } };
  const row = doc.createElement('a'); r.list.append(row);
  const record = kind === 'topic' ? { instance_id: 'i', topic: { id: 't', workspace_id: 'w', title: 'Topic', kind: 'topic',
    state: 'active', archived: false, reader_may_say: true, creator_id: 'reader', owner_id: 'reader', version: 2, waiting_on: [] } }
    : { instance_id: 'i', source_ref: { kind: 'memory', id: 'p', revision: 3 }, owner_scope: { kind: 'topic', id: 't' }, starred: true };
  if (kind === 'topic') { row.className = 'nav-item'; row.dataset.topicId = 't'; }
  else { row.className = 'ol-dossier ol-page'; row.dataset.pageId = 'p'; row.pageTarget = { kind: 'topic', id: 't', page: 'p' }; }
  const handles = { bootstrap: { instance_id: 'i', actor: 'reader', authority: { authority_id: 'a', authority_epoch: 'e' } },
    route: { kind: 'workspace', id: 'w' }, readable: () => true, view: async (name, args) => { reads.push([name, args]); return record; },
    api: { command: async request => { sent.push(request); return { status: 'committed' }; } },
    notebookMenu: () => [{ key: 'star', label: 'Unstar', act() {} }] };
  const outline = { list: r.list, doc, handles, message: doc.createElement('p'), outcomes: new Map(), reload() {}, open: () => assert.fail('menu opening navigated') };
  const menus = new OutlineMenus(outline, { show: options => { shown.push(options); return { close() {} }; } });
  return { ...r, doc, row, record, handles, outline, menus, shown, reads, sent };
}

test('1060 a page moved to an outcome retains its own scoped rail menu',async()=>{
 const f=fixture('page');f.record.owner_scope={kind:'workspace',id:'w'};f.row.pageTarget={kind:'workspace',id:'w',page:'p'};
 f.row.notebookScope=f.record.owner_scope;await f.menus.open(f.row);assert.equal(f.shown.length,1);assert.equal(f.sent.length,0);
});

test('862 a Topic row opens its named shared menu without navigating or sending', async () => {
  const f = fixture('topic'); await f.menus.open(f.row);
  assert.deepEqual(f.reads, [['topic', { topic_id: 't' }]]);
  assert.deepEqual(f.shown[0].items.map(x => x.label), ['Mark Done', 'Archive', 'Mark all read', 'Rename', 'Topic settings…', 'Copy Link', 'Move up', 'Move down']);
  assert.deepEqual(f.sent, []);
});

test('862 a Conversation row from the actual topic list opens no empty menu', async t => {
  const f = fixture('topic'), previousDocument = globalThis.document;
  globalThis.document = f.doc; t.after(() => { globalThis.document = previousDocument; });
  Object.assign(f.record.topic, { kind: 'conversation', title: 'Conversation', list_position: 0 });
  const answer = await readTopicList(async (name, args) => {
    if (name === 'workspace_topics') return { instance_id: 'i', items: [], next_cursor: null };
    if (name === 'conversation') return { instance_id: 'i', conversation: { topic_id: 't' } };
    assert.equal(name, 'topic'); assert.deepEqual(args, { topic_id: 't' }); return f.record;
  }, { workspace_id: 'w' });
  const pages = new TopicPages('i', 'w', null);
  assert.equal(pages.accept(answer), true); assert.equal(pages.items.length, 1);
  const row = TopicRail.prototype.row.call({ links: new Map(), rowItems: new Map(), reader: 'reader', pages,
    question: () => null, activate() { assert.fail('menu opening navigated'); } }, pages.items[0]);
  f.outline.list.append(row);
  assert.equal(row.dataset.topicId, 't'); assert.equal(f.menus.row(row), row);
  await f.menus.open(row);
  assert.deepEqual(f.reads, [['topic', { topic_id: 't' }]]);
  assert.equal(f.shown.length, 0); assert.deepEqual(f.sent, []); assert.equal(f.menus.pending, null);
});

test('862 a starred Notebook row opens the existing list from one named read', async () => {
  const f = fixture('page'), choices = [{ key: 'star', label: 'Unstar', act() {} }];
  f.handles.notebookMenu = (source, row) => { assert.equal(source, f.record); assert.equal(row, f.row); return choices; };
  await f.menus.open(f.row);
  assert.deepEqual(f.reads, [['memory_current', { item_id: 'p' }]]);
  assert.equal(f.shown[0].items, choices); assert.deepEqual(f.sent, []);
});

test('893 title buttons use New message, settings, overflow order for Topic Tab and arrow reach; outcomes keep their order', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="topic-menu"[^>]*aria-label="This topic"[^>]*aria-haspopup="menu"/);
  const row = html.match(/<div class="title-row">([\s\S]*?)<\/div><p id="topic-description"/)[1];
  // These original893 cases are readers without Rename and outcome pages.
  const tags = [...row.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).filter(tag => !tag.includes('id="topic-title-rename"'));
  assert.equal(tags.length, 4);
  for (const tag of tags) {
    assert.match(tag, /type="button"/);
    assert.doesNotMatch(tag, /tabindex|style=/, 'ordinary buttons follow DOM Tab order');
  }
  for (const [route, expected] of [
    ['topic', ['new-message', 'settings-open', 'topic-menu']],
    ['outcome', ['outcome-menu', 'new-message']],
  ]) {
    // Only the route's visibility is supplied here. Order comes from the real
    // template and arrow handling from the real panes owner, not a copied list.
    const doc = { querySelector: selector => selector === '#main > .topic-header' ? header : null };
    const buttons = tags.map(tag => {
      const id = tag.match(/id="([^"]+)"/)[1];
      return { id, ownerDocument: doc, isConnected: true, closest: () => null,
        checkVisibility: () => route === 'topic' ? id !== 'outcome-menu' : !['settings-open', 'topic-menu'].includes(id),
        focus() { doc.activeElement = this; } };
    });
    const header = { querySelectorAll: () => buttons };
    const visible = headerRows(doc)[0].buttons;
    assert.deepEqual(visible.map(button => button.id), expected, route);
    for (const [key, order] of [['ArrowRight', expected], ['ArrowLeft', [...expected].reverse()]]) {
      doc.activeElement = buttons.find(button => button.id === order[0]);
      for (const id of order.slice(1)) {
        let prevented = false;
        assert.equal(feedKey({ key, target: doc.activeElement, preventDefault() { prevented = true; } }, doc), true);
        assert.equal(doc.activeElement.id, id, `${route} ${key}`);
        assert.equal(prevented, true);
      }
    }
  }
});

test('893/805 a renaming reader reaches title, pencil, New message, settings, overflow in template Tab order', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const row = html.match(/<div class="title-row">([\s\S]*?)<\/div><p id="topic-description"/)[1];
  const r = renderer799(), doc = r.list.ownerDocument, header = doc.createElement('header');
  r.list.append(header);
  const controls = [...row.matchAll(/<(h1|button)\b[^>]*>/g)].map(([tag, kind]) => {
    const node = doc.createElement(kind); node.id = tag.match(/id="([^"]+)"/)[1];
    node.tabIndex = kind === 'button' ? 0 : -1;
    node.hidden = node.id === 'outcome-menu'; node.checkVisibility = () => !node.hidden;
    header.append(node); return node;
  });
  const named = id => controls.find(node => node.id === id);
  doc.querySelector = selector => selector === '#main > .topic-header' ? header : null;
  // Header buttons are selected in DOM order; title is its own semantic h1
  // Tab stop, before the pencil, rather than an extra arrow-row button.
  header.querySelectorAll = () => controls.filter(node => node.tag === 'button');
  paintTopicHeader({ title: named('topic-title'), pencil: named('topic-title-rename'),
    gear: named('settings-open'), subtitle: doc.createElement('p') },
    { title: 'Topic', owner_id: 'reader', creator_id: 'reader', state: 'active', waiting_on: [] }, 'reader', { doc });
  const expected = ['topic-title', 'topic-title-rename', 'new-message', 'settings-open', 'topic-menu'];
  assert.deepEqual(controls.filter(node => !node.hidden && node.tabIndex >= 0).map(node => node.id), expected,
    'the actual permission paint makes the title and its pencil available before893 actions');
  assert.deepEqual(headerRows(doc)[0].buttons.map(node => node.id), expected.slice(1));
  for (const [key, order] of [['ArrowRight', expected.slice(1)], ['ArrowLeft', expected.slice(1).reverse()]]) {
    named(order[0]).focus();
    for (const id of order.slice(1)) {
      let prevented = false;
      assert.equal(feedKey({ key, target: doc.activeElement, preventDefault() { prevented = true; } }, doc), true);
      assert.equal(doc.activeElement.id, id, key); assert.equal(prevented, true);
    }
  }
});

test('862 topic choices follow recorded state and existing permissions; Conversations have none', () => {
  const f = fixture('topic'), topic = { ...f.record.topic, state: 'done', archived: true };
  const labels = t => topicMenuItems(t, { actor: 'reader', act() {} }).map(x => x.label);
  assert.deepEqual(labels(topic).slice(0, 2), ['Back to Active', 'Bring back']);
  const other = { ...topic, reader_may_say: false, owner_id: 'other', creator_id: 'other' };
  assert.deepEqual(labels(other), ['Mark all read', 'Topic settings…', 'Copy Link', 'Move up', 'Move down']);
  assert.deepEqual(labels({ ...topic, kind: 'conversation' }), []);
});

for (const kind of ['topic', 'page']) for (const change of ['instance', 'identity', 'navigation', 'access', 'reuse', 'dismiss']) {
  test(`862 ${kind} menu refuses ${change} before a delayed named read returns`, async () => {
    const f = fixture(kind); let resolve;
    f.handles.view = () => new Promise(r => { resolve = r; });
    const wait = f.menus.open(f.row);
    if (change === 'instance') f.record.instance_id = 'other';
    if (change === 'identity') kind === 'topic' ? f.record.topic.id = 'other' : f.record.owner_scope.id = 'other';
    if (change === 'navigation') f.outline.handles = { ...f.handles };
    if (change === 'access') f.handles.readable = () => false;
    if (change === 'reuse') kind === 'topic' ? f.row.dataset.topicId = 'other' : f.row.dataset.pageId = 'other';
    if (change === 'dismiss') f.menus.reset();
    resolve(f.record); await wait;
    assert.equal(f.shown.length, 0); assert.equal(f.sent.length, 0);
  });
}

test('862 reused topic row retires a previously drawn action', async () => {
  const f = fixture('topic'); await f.menus.open(f.row);
  f.row.dataset.topicId = 'other'; await f.shown[0].items.find(x => x.key === 'state').act();
  assert.equal(f.sent.length, 0);
});

test('862 remote topic update preserves the same state/waiting/note fences as TopicStatePanel', async () => {
  const f = fixture('topic'), topic = f.record.topic;
  Object.assign(topic, { state: 'waiting', waiting_on: ['reader', 'other'], state_message_id: 'm', state_note: 'Exact reason' });
  await f.menus.topicAction(topic, 'state', f.handles);
  const panel = { topic, at: { said: 8 }, held: TopicStatePanel.prototype.held };
  const snapshot = TopicStatePanel.prototype.snapshot.call(panel, 'state');
  const fences = Object.fromEntries(Object.entries(snapshot).map(([key, x]) => [key, x.fence]));
  assert.deepEqual(f.sent[0].expected.topic_fields, fences);
  assert.deepEqual(fences, { state: 'waiting', waiting_on: ['reader', 'other'], note: 'Exact reason' });
  assert.deepEqual(f.sent[0].args, { state: 'done', keep_note: true });
  assert.deepEqual(f.sent[0], topicUpdateEnvelope(f.handles.bootstrap, topic, f.sent[0].args, fences, f.sent[0].operation_id));
  await f.menus.topicAction(topic, 'archive', f.handles);
  assert.deepEqual(f.sent[1].expected.topic_fields, { archived: false });
  assert.deepEqual(f.sent[1].args, { archived: true });
});

test('862 loaded topic delegates state/archive/rename to its current owner, and ordering to the outline', async () => {
  const f = fixture('topic'), calls = []; f.handles.route = { kind: 'topic', id: 't' };
  f.handles.topicMenuAction = (topic, key) => { calls.push([topic.id, key]); return true; };
  for (const key of ['state', 'archive', 'rename', 'settings']) await f.menus.topicAction(f.record.topic, key, f.handles);
  f.outline.moveTopic = (...args) => calls.push(args);
  await f.menus.topicAction(f.record.topic, 'up', f.handles);
  await f.menus.topicAction(f.record.topic, 'down', f.handles);
  assert.deepEqual(calls, [['t','state'],['t','archive'],['t','rename'],['t','settings'],['t',-1],['t',1]]);
  assert.equal(f.sent.length, 0);
});

test('862 remote Rename/Settings only request guarded UI addresses', async () => {
  const f = fixture('topic'), routes = []; f.outline.open = route => routes.push(route);
  for (const key of ['rename','settings']) await f.menus.topicAction(f.record.topic, key, f.handles);
  assert.deepEqual(routes, [{kind:'topic',id:'t',act:'topic-rename'},{kind:'topic',id:'t',act:'topic-settings'}]);
  for (const route of routes) {
    assert.equal(menuRouteValid(route), true);
    for (const extra of [{page:'p'}, {message:'m'}, {land:true}, {choice:'state'}, {at:'unread'}]) assert.equal(menuRouteValid({...route,...extra}), false);
    const win = { location: new URL('https://fixture.invalid/?topic=t#act=' + route.act), history: { state: null, replaceState(_s,_t,url) { win.location = new URL(url); } } };
    assert.equal(consumeMenuRoute(route, win), true); assert.equal(consumeMenuRoute(route, win), false);
  }
  assert.equal(menuRouteValid({kind:'topic',id:'t',act:'topic-state'}), false); assert.equal(f.sent.length, 0);
});

test('862 Mark all read retains its original boundary and operation across unknown replies and coalesces presses', async () => {
  const f = fixture('topic'); let resolve, reads = 0, unknown = true;
  f.handles.view = async (name, args) => { reads++; assert.equal(name,'topic_messages'); assert.deepEqual(args,{topic_id:'t',audience:'all',direction:'before',limit:1}); return {instance_id:'i',items:[{topic_id:'t',seq:30 + reads}]}; };
  f.handles.api.command = async request => { f.sent.push(structuredClone(request)); if (unknown) { await new Promise(r => { resolve = r; }); throw Error('lost'); } return {status:'committed'}; };
  const first = f.menus.topicAction(f.record.topic, 'read', f.handles);
  const duplicate = f.menus.topicAction(f.record.topic, 'read', f.handles);
  await Promise.resolve(); resolve(); await assert.rejects(first,/unknown/); await assert.rejects(duplicate,/unknown/);
  unknown = false; await f.menus.topicAction(f.record.topic, 'read', f.handles);
  assert.equal(reads,1); assert.equal(f.sent.length,2); assert.deepEqual(f.sent[1],f.sent[0]); assert.equal(f.sent[1].args.seq,31);
  await f.menus.topicAction(f.record.topic, 'read', f.handles);
  assert.equal(reads,2); assert.equal(f.sent[2].args.seq,32); assert.notEqual(f.sent[2].operation_id,f.sent[0].operation_id);
});

for (const bad of [{instance_id:'wrong',items:[{topic_id:'t',seq:2}]}, {instance_id:'i',items:[{topic_id:'wrong',seq:2}]}, {instance_id:'i',items:[{topic_id:'t',seq:-1}]}, {instance_id:'i',items:[{topic_id:'t',seq:2},{topic_id:'t',seq:3}]}]) {
  test('862 Mark all read rejects a malformed or foreign boundary '+JSON.stringify(bad), async () => {
    const f = fixture('topic'); f.handles.view = async () => bad;
    await assert.rejects(f.menus.topicAction(f.record.topic,'read',f.handles),/boundary/); assert.equal(f.sent.length,0);
  });
}
test('862 Mark all read cannot send after navigation while its boundary read waits', async () => {
  const f=fixture('topic'); let resolve; f.handles.view=()=>new Promise(r=>{resolve=r;});
  const wait=f.menus.topicAction(f.record.topic,'read',f.handles); f.outline.handles={...f.handles};
  resolve({instance_id:'i',items:[{topic_id:'t',seq:10}]}); await wait; assert.equal(f.sent.length,0);
});

function notebookPorts(source) {
  const calls=[], shown=[], notices=[], handles=fixture('page').handles; let loaded=null, current=true;
  const rail=new NotebookRailMenu({loaded:()=>loaded,open:async()=>{calls.push('open');return true;},layout:()=>({docked:true,dossiers:true,canDock:()=>true}),mode:()=> 'cards',
    current:()=>current,changed:()=>calls.push('changed'),notice:x=>notices.push(x),copy:async link=>{calls.push(['copy',link]);return true;},show:options=>shown.push(options)});
  return {rail, calls, shown, notices, handles, source, setLoaded:page=>{loaded=page;}, depart:()=>{current=false;}};
}
const notebookSource=()=>({instance_id:'i',source_ref:{kind:'memory',id:'p',revision:6},owner_scope:{kind:'topic',id:'t'},draft:true,starred:true,star_revision:4,reader_may_write:true,reader_may_delete:true});

test('862 unopened Notebook menu shares actual page and sheet descriptors without creating a writer or changing Draft', () => {
  const source=notebookSource(), f=notebookPorts(source);
  const page={writing:{pageState:source,value:{draft:true}},readOnly:false,mode:'cards',drafted:NotebookPage.prototype.drafted,
    menuExtras:position=>notebookSheetMenuItems({dossiers:{toggle(){}},docked:true,canDock:()=>true},position)};
  const signature=items=>items.map(({key,label,glyph,checked,disabled})=>({key,label,glyph,checked,disabled}));
  assert.deepEqual(signature(f.rail.items(source,()=>{})),signature(NotebookPage.prototype.menuItems.call(page)));
  assert.equal(f.rail.items(source,()=>{}).find(x=>x.key==='draft').checked,true);assert.deepEqual(f.calls,[]);assert.equal(source.draft,true);
  source.reader_may_write=false;
  const readonly=f.rail.items(source,()=>{});assert.equal(readonly.find(x=>x.key==='draft').disabled,true);assert.equal(readonly.find(x=>x.key==='image').disabled,true);assert.ok(!readonly.some(x=>x.key==='rename'));
  source.deleted=true;assert.deepEqual(f.rail.items(source,()=>{}).map(x=>x.key),['restore']);
});

test('862 remote Notebook Unstar preserves its star fence and exact unknown request without opening the editor', async () => {
  const f=notebookPorts(notebookSource()), commands=new RailMenuCommands(), sent=[]; let unknown=true;
  f.handles.api.command=async request=>{sent.push(structuredClone(request));if(unknown)throw Error('lost');return {status:'committed'};};
  await assert.rejects(f.rail.act(f.source,'star','Unstar',{},commands,f.handles),/unknown/);
  unknown=false;f.source.star_revision=5;
  await f.rail.act(f.source,'star','Unstar',{},commands,f.handles);
  assert.deepEqual(sent[0],sent[1]);assert.deepEqual(sent[0].args,{starred:false});assert.equal(sent[0].expected.star_revision,4);
  assert.equal(sent[0].expected.item_revision,undefined);assert.equal(sent[0].kind,'memory.star');assert.deepEqual(f.calls,['changed']);assert.equal(f.source.draft,true);
});

test('862 unopened Notebook Delete opens the actual owner and runs its rechecked Delete there', async () => {
  const f=notebookPorts(notebookSource()), page={more:{},doc:{},menuItems:()=>[{key:'delete',label:'Delete page',act:()=>f.calls.push('deleted')}]};
  f.rail.open=async()=>{f.calls.push('open');f.setLoaded(page);return true;};
  await f.rail.act(f.source,'delete','Delete page',{},new RailMenuCommands(),f.handles);
  assert.deepEqual(f.calls,['open','deleted']);assert.equal(f.shown.length,0);
  page.menuItems=()=>[{key:'delete',label:'Delete page',disabled:true,act:()=>assert.fail('a revoked Delete ran')}];f.setLoaded(null);
  await assert.rejects(f.rail.act(f.source,'delete','Delete page',{},new RailMenuCommands(),f.handles),/page changed/);
});

for (const key of ['draft','image','restore']) test(`862 unopened Notebook ${key} opens the actual owner and focuses a fresh press`, async () => {
  const f=notebookPorts(notebookSource()), choice={key,label:key,act:()=>assert.fail('record action ran on arrival')}, page={more:{},doc:{},menuItems:()=>[choice]};
  f.rail.open=async()=>{f.calls.push('open');f.setLoaded(page);return true;};
  await f.rail.act(f.source,key,key,{},new RailMenuCommands(),f.handles);
  assert.deepEqual(f.calls,['open']);assert.equal(f.shown.length,1);assert.equal(f.shown[0].focusKey,key);assert.equal(f.shown[0].anchor,page.more);
});

test('862 Notebook UI choices reuse the loaded owner; late opens and revoked choices do not act', async () => {
  const f=notebookPorts(notebookSource()), page={menuItems:()=>[{key:'rename',label:'Rename',act:()=>f.calls.push('rename')}]};
  f.setLoaded(page); await f.rail.act(f.source,'rename','Rename',{},null,f.handles);assert.deepEqual(f.calls,['rename']);
  f.setLoaded(null);f.rail.open=async()=>{f.setLoaded(page);return true;};await f.rail.act(f.source,'rename','Rename',{},null,f.handles);assert.deepEqual(f.calls,['rename','rename']);
  page.menuItems=()=>[{key:'rename',label:'Rename',disabled:true,act:()=>assert.fail('revoked act')}];
  await assert.rejects(f.rail.act(f.source,'rename','Rename',{},null,f.handles),/page changed/);
  page.menuItems=()=>[{key:'rename',label:'Rename',act:()=>assert.fail('late open invoked a departed owner')}];
  f.setLoaded(null);f.rail.open=async()=>{f.setLoaded(page);f.depart();return true;};
  assert.equal(await f.rail.act(f.source,'rename','Rename',{},null,f.handles),false);assert.equal(f.shown.length,0);
});

test('862 loaded Notebook actions preserve actual writer guards and current unsaved Draft', async () => {
  const f=notebookPorts(notebookSource()), edits=[];
  const page={writing:{pageState:f.source,value:{draft:false}},readOnly:false,mode:'cards',drafted:NotebookPage.prototype.drafted,
    markDraft:value=>edits.push(value),menuItems:NotebookPage.prototype.menuItems,pageAction:()=>f.calls.push('writer-star')};
  f.setLoaded(page);const items=f.rail.items(f.source,()=>{});assert.equal(items.find(x=>x.key==='draft').checked,false);
  await f.rail.act(f.source,'draft','Private draft',{},null,f.handles);assert.deepEqual(edits,[true]);
  page.writing.readOnly=true;await assert.rejects(f.rail.act(f.source,'draft','Private draft',{},null,f.handles),/page changed/);
  await f.rail.act(f.source,'star','Unstar',{},null,f.handles);assert.deepEqual(f.calls,['writer-star']);
});

test('862 Notebook Copy Link uses the current scope without opening a writer and ignores late clipboard replies', async t => {
  shareLinksFrom('https://fixture.invalid');t.after(()=>shareLinksFrom(null));
  const f=notebookPorts(notebookSource()); let resolve;
  // links.mjs uses the same share root as the actual page owner.
  f.rail.copy=link=>{f.calls.push(['copy',link]);return new Promise(r=>{resolve=r;});};
  const task=f.rail.act(f.source,'copy','Copy Link',{},null,f.handles);
  await Promise.resolve();f.depart();resolve(true);await task;
  assert.match(f.calls[0][1],/topic=t.*page=p/);assert.equal(f.calls.length,1);assert.deepEqual(f.notices,[]);
});

// Execute the actual application's small integration functions against supplied
// owners. These are handler/wiring checks, never native gesture or layout proof.
const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
function appFunction(start,end,env,name) { const text=app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));return new Function(...Object.keys(env),text+';return '+name)(...Object.values(env)); }
test('862 actual topic title click uses the rail owner and refuses stale or unavailable routes', () => {
  const f=fixture('topic'), title=f.doc.createElement('button'), opened=[], shell={handles:{route:{kind:'topic',id:'t'}}};
  const env={$:()=>title,bootstrap:f.handles.bootstrap,topicState:{says:true},paintTopicHeader(){},panes:{outline:{menus:{open:row=>opened.push(row)}}},shell,retired:false,topicUnavailable:false};
  const paint=extra=>appFunction('function paintHeader(current)', '// Messages sent before times', {...env,...extra},'paintHeader');
  paint()(f.record.topic);title.onclick();assert.equal(opened.length,1);assert.equal(opened[0],title);assert.equal(title.hidden,false);assert.equal(title.dataset.topicId,'t');
  shell.handles.route.id='other';title.onclick();assert.equal(opened.length,1);
  paint({topicUnavailable:true})(f.record.topic);assert.equal(title.hidden,true);title.onclick();assert.equal(opened.length,1);
  paint()({...f.record.topic,kind:'conversation'});assert.equal(title.hidden,true);
});
test('862 actual loaded topic menu invokes TopicStatePanel and existing settings, preserving permissions', async () => {
  const f=fixture('topic'), calls=[], panel={topic:f.record.topic,says:true,controls:{managed:{}},tap:(...args)=>calls.push([args[0],args[1](),args[2]]),renaming:value=>calls.push(['rename',value])};
  const env={retired:false,topicUnavailable:false,topicState:panel,settings:{open:()=>calls.push(['settings'])}};
  const act=appFunction('function runTopicMenuAction(', 'function readyRails(',env,'runTopicMenuAction');
  await act({...f.record.topic,state:'done'},'state');await act(f.record.topic,'archive');await act(f.record.topic,'rename');
  assert.deepEqual(calls,[['state','active',true],['archived',true,true],['settings'],['rename',true]]);
  panel.says=false;assert.throws(()=>act(f.record.topic,'state'),/no longer/);panel.controls.managed=null;assert.throws(()=>act(f.record.topic,'archive'),/no longer/);assert.throws(()=>act(f.record.topic,'rename'),/no longer/);
  assert.equal(act({...f.record.topic,id:'other'},'state'),false);
});
test('862 actual rail wiring provides shared Notebook owners and topic arrivals consume their address first', () => {
  const f=fixture('page'), calls=[], closing=[], shell={ready:handles=>calls.push(handles)}, menu={items:(source,choose)=>[source,choose],act:(...args)=>calls.push(args)};
  // readyRails closes over this module-level service in the real app. Supply
  // its owner explicitly, so this extracted-function check has no global/order dependency.
  const topicClosing={start(){assert.equal(calls.length,1,'rails are ready before recovery starts');closing.push(['start']);},send(...args){closing.push(['send',...args]);return 'kept';}};
  const env={shell,topicClosing,api:{},bootstrap:{},live:{},$:()=>({textContent:'Outcome'}),pageMax:()=>20,checkedView(){},openDestination(){},notebookCreator(){},railDossierMenu(){},runDossierMenuChoice(){},runTopicMenuAction(){},notebookRailMenu:()=>menu,markFromRail(){},freshness:null};
  appFunction('function readyRails(', '// A notification opens',env,'readyRails')('w');
  const ports=calls[0],choose=()=>{};assert.deepEqual(ports.notebookMenu(f.record,f.row,choose),[f.record,choose]);assert.equal(ports.topicMenuAction,env.runTopicMenuAction);
  assert.deepEqual(closing,[['start']]);
  const current={id:'t',workspace_id:'w'},envelope={operation_id:'kept-topic-close'};
  assert.equal(ports.closeTopic(current,envelope),'kept');
  assert.equal(closing[1][1],current,'the close owner receives the actual topic');assert.equal(closing[1][2],envelope,'the exact envelope reaches its owner');
  const start=app.indexOf("  if (['topic-rename', 'topic-settings'].includes(route.act)"),end=app.indexOf('\n',start),order=[];
  const invoke=route=>new Function('route','topic','consumeMenuRoute','run','runTopicMenuAction',app.slice(start,end))(route,f.record.topic,()=>{order.push('consume');return true;},fn=>fn(),(_topic,key)=>order.push(key));
  invoke({act:'topic-rename'});assert.deepEqual(order,['consume','rename']);order.length=0;invoke({act:'topic-state'});assert.deepEqual(order,[]);
});

for (const kind of ['topic','page']) test(`862 ${kind} row participates in existing menu doors without admitting edit fields`, () => {
  const f=fixture(kind);assert.equal(f.menus.row(f.row),f.row);
  const input=f.doc.createElement('input');f.row.append(input);assert.equal(f.menus.row(input),null);
  f.outline.handles=null;assert.equal(f.menus.row(f.row),null);
});
test('862 topic move delegates to existing visible ordering and names an absent row without writing', () => {
  const row={el:{dataset:{topicId:'t'}}},calls=[],outline={handles:{},treeRows:()=>[row],tree:{say:words=>calls.push(words)},reorder:(...args)=>calls.push(args)};
  assert.equal(OutlineRail.prototype.moveTopic.call(outline,'t',-1),true);assert.deepEqual(calls[0],[row,-1]);
  assert.equal(OutlineRail.prototype.moveTopic.call(outline,'absent',1),false);assert.equal(calls.length,2);assert.match(calls[1],/Open this topic/);
});
test('862 actual Notebook rail adapter only reads layout and view preferences while drawing', () => {
  let constructed=0;const shell={handles:{}},source=notebookSource();
  const env={railNotebook:null,NotebookRailMenu,notebookSheet:null,topic:{id:'t'},views:{},notebookViewsOf:()=>({get:()=> 'text'}),notebookDockWanted:()=>true,
    globalThis:{matchMedia:()=>({matches:true})},retired:false,shell,panes:{},openNotebook:()=>{constructed++;assert.fail('drawing opened Notebook');}};
  const make=appFunction('function notebookRailMenu()', 'function openNotebook(',env,'notebookRailMenu');
  const owner=make(),items=owner.items(source,()=>{});
  assert.equal(items.find(x=>x.key==='text').checked,true);assert.ok(!items.some(x=>x.key==='layout'),'1096 leaves layout in the sheet header');assert.equal(items.find(x=>x.key==='draft').checked,true);assert.equal(constructed,0);
});
