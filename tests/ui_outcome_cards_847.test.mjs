import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { TopicPages, TopicRail, WorkspacePages, topicPosition } from '../web/topic-navigation.mjs';
import { OutlineRail } from '../web/outline-rail.mjs';
import { OutcomeTopicCards } from '../web/outcome-topic-cards.mjs';
import { OutcomeReferences } from '../web/outcome-references.mjs';
import { NotebookViews } from '../web/notebook-view.mjs';
import { NotebookPage } from '../web/notebook-page.mjs';

function dom(t) {
  const prior = [globalThis.document, globalThis.getComputedStyle], doc = miniDocument();
  doc.addEventListener = () => {};
  const make = doc.createElement;
  doc.createElement = tag => {
    const node = make(tag); node.ownerDocument = doc;
    node.before = () => {}; node.after = () => {};
    node.contains = other => { for (let at = other; at; at = at.parent) if (at === node) return true; return false; };
    let words = '';
    Object.defineProperty(node, 'textContent', { get: () => words, set: value => { words = value; node.children = []; } });
    return node;
  };
  globalThis.document = doc;
  // A DOM oracle of the outline's computed display, not a browser or a copy
  // of the filter: the test supplies the CSS result on the actual rail row.
  globalThis.getComputedStyle = node => ({ display: node.cssHidden ? 'none' : 'block' });
  t.after(() => { [globalThis.document, globalThis.getComputedStyle] = prior; });
  return doc;
}
function railFixture(t) {
  const doc = dom(t), node = tag => doc.createElement(tag ?? 'div');
  const parts = Object.fromEntries(['host','more','retry','message','area'].map(key => [key,node()]));
  const done = { details: node('details'), label: node(), host: node(), more: node('button') };
  done.details.append(done.label, done.host, done.more);
  const host = node(), cards = new OutcomeTopicCards({host}), calls = [], queue = [], opened = [];
  let rail;
  rail = new TopicRail({...parts, done, reader:'reader', pages:new TopicPages('847-test','w',null,'active',true),
    read: args => { calls.push(args); const answer = queue.shift(); return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer); },
    open: (...args) => opened.push(args), denied: error => error.status === 403, painted: () => { if (rail) cards.paint(rail.presentation()); }});
  const item = (id, position, extra={}) => ({id, title:`Topic ${id}`,workspace_id:'w',list_position:position,activity_ms:1795120000000,message_count:7,...extra});
  const page = (items,next=null) => ({instance_id:'847-test',items,next_cursor:next === null ? null : topicPosition(next),groups:{done:1,archived:0}});
  const ids = () => host.querySelectorAll('a.outcome-topic-card').map(row => row.dataset.topicId);
  return { doc, node, parts, done, host, cards, calls, queue, opened, rail, item, page, ids };
}

test('847 cards use the actual outline rows, held order, CSS filter, marks and native link destinations', async t => {
  const f = railFixture(t), a=f.item('a',3,{unread:2,asks:[{actor_id:'reader',message_id:'q'}]}), b=f.item('b',2);
  f.queue.push(f.page([a,b])); await f.rail.load();
  assert.deepEqual(f.ids(), ['a','b']); assert.equal(f.calls.length,1); assert.equal(f.calls[0].build,false);
  const values=f.rail.presentation();
  const noNodes=value=>{if(!value||typeof value!=='object')return;assert.equal('ownerDocument' in value,false);for(const child of Object.values(value))noNodes(child);};
  noNodes(values);
  f.rail.links.get('a').textContent='An unrelated markup change';f.cards.paint(values);
  const card=f.host.querySelector('a.outcome-topic-card');
  assert.match(card.text,/Topic a/);assert.match(card.text,/7 messages/);assert.equal(card.querySelector('time').dataset.ms,String(a.activity_ms));
  card.onclick({button:0,target:card,preventDefault(){}});assert.deepEqual(f.opened[0],['a','Topic a','q']);
  card.onclick({button:0,target:card.querySelector('.unread-count'),preventDefault(){}});assert.equal(f.opened[1][3],'unread');
  card.onclick({button:0,metaKey:true,preventDefault(){throw Error('modified link captured');}});assert.equal(f.opened.length,2);
  f.rail.pointed=true;f.queue.push(f.page([f.item('b',4),a]));await f.rail.load();
  assert.deepEqual(f.ids(),['a','b'],'the cards follow the rows actually held under the pointer');
  f.rail.pointed=false;f.rail.paint();assert.deepEqual(f.ids(),['b','a']);
  f.rail.links.get('b').cssHidden=true;f.cards.paint(f.rail.presentation());assert.deepEqual(f.ids(),['a'],'the outline filter is the only visibility rule');
  f.done.details.cssHidden=true;f.cards.paint(f.rail.presentation());assert.equal(f.host.querySelectorAll('.outcome-topic-toggle').filter(n=>!n.hidden).length,0);
});

test('847 paging, group folds, failures and Retry belong to the same rail', async t => {
  const f=railFixture(t),a=f.item('a',3),b=f.item('b',2);
  f.queue.push(f.page([a],a));await f.rail.load();
  const more=f.host.querySelector('.outcome-topic-more');more.focus();
  f.queue.push(f.page([b]));await more.onclick();
  assert.deepEqual(f.ids(),['a','b']);assert.equal(f.calls.length,2);assert.equal(f.calls[1].cursor,topicPosition(a));
  assert.equal(f.doc.activeElement.dataset.topicId,'b','a final More hands focus to the new card');
  f.done.details.open=true;f.queue.push(f.page([f.item('d',1,{state:'done'})]));await f.rail.load(f.rail.lists[1]);
  assert.deepEqual(f.ids(),['a','b','d']);
  f.done.details.open=false;f.done.details.listeners.toggle();assert.deepEqual(f.ids(),['a','b'],'closing removes previously read cards immediately');
  f.queue.push(Error('Offline'));await f.rail.load();assert.deepEqual(f.ids(),['a','b']);assert.match(f.cards.notice.textContent,/Offline/);
  f.queue.push(Object.assign(Error('Denied'),{status:403}));await f.cards.retry.onclick();assert.deepEqual(f.ids(),[]);assert.equal(f.cards.retry.hidden,false);
  f.queue.push(f.page([a]));await f.cards.retry.onclick();assert.deepEqual(f.ids(),['a']);assert.equal(f.cards.notice.hidden,true);
});

test('847 outline publishes only this outcome and clears its projection on fold, filter or denial', t => {
  const f=railFixture(t), seen=[], outcome={rail:f.rail,li:{hidden:false},topics:{hidden:false}};
  const outline=Object.assign(Object.create(OutlineRail.prototype),{outcomes:new Map([['w',outcome]]),handles:{route:{kind:'workspace'},workspaceId:'w',readable:()=>true,outcomeTopics:rail=>seen.push(rail)}});
  const values=f.rail.presentation();f.rail.presentation=()=>values;
  outline.publishTopics();assert.equal(seen.at(-1),values);
  for(const part of [outcome.li,outcome.topics]) {part.hidden=true;outline.publishTopics();assert.equal(seen.at(-1)===null,true);part.hidden=false;}
  outline.handles.readable=()=>false;outline.publishTopics();assert.equal(seen.at(-1)===null,true);
  outline.handles.route={kind:'topic'};const n=seen.length;outline.publishTopics();assert.equal(seen.length,n);
});

test('847 a directly reached outcome uses its provisional outline row as the topic-list owner', async () => {
  const read=[], outline=Object.assign(Object.create(OutlineRail.prototype),{
    handles:{workspaceId:'outside',workspaceTitle:'Outside',view:async()=>({instance_id:'847-test',items:[],next_cursor:null})},run:1,
    pages:new WorkspacePages('847-test'),paint(){},isOpen:()=>true,outcome:item=>item,
    loadTopics:item=>read.push(['topics',item.id]),readConversation:item=>read.push(['conversation',item.id]),
    dossiers:{refresh:async()=>[]},notebookStars:{refresh:async()=>[]}});
  await outline.load();
  assert.deepEqual(read,[['topics','outside'],['conversation','outside']]);
});

const memory=()=>{const held=new Map();return{getItem:key=>held.get(key),setItem:(key,value)=>held.set(key,value)};};
test('847 NotebookPage opens in the remembered view and records a real view switch', t => {
  const doc=dom(t), node=()=>doc.createElement('div'), views=new NotebookViews({instance_id:'i',actor:'a'},memory());
  views.set('p','text');
  const page=new NotebookPage({host:node(),header:{title:node(),eyebrow:node(),description:node()},item:'p',viewPreference:views});
  assert.equal(page.mode,'text');
  page.sync=()=>{};page.paint=()=>{};page.switchView('cards');assert.equal(views.get('p'),'cards');
});
test('847 Notebook view persists per page, actor and instance, with safe storage fallback', () => {
  const storage=memory(), scope={instance_id:'instance',actor:'reader'}, views=new NotebookViews(scope,storage);
  assert.equal(views.get('a'),'cards');views.set('a','text');assert.equal(new NotebookViews(scope,storage).get('a'),'text');
  assert.equal(views.get('b'),'cards');assert.equal(new NotebookViews({...scope,actor:'other'},storage).get('a'),'cards');
  assert.equal(new NotebookViews({...scope,instance_id:'other'},storage).get('a'),'cards');
  const broken=new NotebookViews(scope,{getItem(){throw Error();},setItem(){throw Error();}});
  assert.equal(broken.get('a'),'cards');broken.set('a','text');assert.equal(broken.get('a'),'text');
});

test('847 existing Notebook list updates its document icon on a real page view switch, without another read or command', async t => {
  const doc=dom(t), node=()=>doc.createElement('div'), scope={instance_id:'instance',actor:'reader'}, views=new NotebookViews(scope,memory());
  let reads=0,commands=0;const opened=[],list=node();
  const refs=new OutcomeReferences({scope:'w',host:node(),list,more:node(),message:Object.assign(node(),{hidden:true}),viewPreference:views,
    read:async()=>{reads++;return{items:[{id:'p',seq:1,title:'Notes',revision:2,draft:true,owner_scope:{kind:'workspace',id:'w'},source_ref:{kind:'memory',id:'p',revision:2}}],next_cursor:null};},
    open:(...args)=>opened.push(args),denied:()=>false});
  await refs.load();const row=list.children[0];assert.equal(row.dataset.mode,'cards');assert.equal(row.querySelector('.notebook-document').dataset.mode,'cards');
  const options={host:node(),header:{title:node(),eyebrow:node(),description:node()},item:'p',bootstrap:scope,viewPreference:views,send:()=>{commands++;}};
  const page=new NotebookPage(options);
  // The real switch and its real preference update; drawing/writing syncing
  // are covered by the existing Notebook checks, and require a loaded page.
  page.sync=()=>{};page.paint=()=>{};page.switchView('text');
  assert.equal(list.children[0],row);assert.equal(row.dataset.mode,'text');assert.equal(row.querySelector('.notebook-document').dataset.mode,'text');
  assert.equal(row.querySelector('.draft-mark').textContent,'draft');assert.equal(reads,1);assert.equal(commands,0);
  row.onclick();assert.equal(opened[0][0].id,'p');assert.equal(opened[0][1],row);
  const reopened=new NotebookPage({...options,host:node()});assert.equal(reopened.mode,'text');
  const explicit=new NotebookPage({...options,host:node(),mode:'cards'});assert.equal(explicit.mode,'cards');assert.equal(row.dataset.mode,'cards');
});

test('847 composition has one topic query owner, shared Team renderer, and explicit column/strip styles', () => {
  const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8'), html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8'),css=readFileSync(new URL('../web/aim.css',import.meta.url),'utf8');
  const body=app.slice(app.indexOf('async function initializeOutcomePage'),app.indexOf('// The pipeline\'s views and commands'));
  assert.doesNotMatch(body,/new TopicRail|new TopicPages|topicRail\.load/);
  assert.match(body,/outcomeTopics: values => topicCards.paint\(values\)/);
  assert.ok(body.indexOf("$('outcome-references'),$('outcome-team')")>0);
  assert.match(app,/pill:participantPill,dismissible:true/);assert.match(html,/id="outcome-team" class="outcome-team topic-people"/);
  assert.match(css,/\.outcome-topic-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:760px\)\{\.outcome-topic-grid\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/background:var\(--stack-folder\);box-shadow:var\(--stack-cover-inset\)/);
  assert.match(css,/#outcome-references-list\{display:flex;gap:[^;]+;overflow-x:auto/);
});
