import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicPages, TopicNavigation, topicPosition, routeHref, parseRoute } from '../web/topic-navigation.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { AttemptError, unreached } from '../web/api.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
// Earlier letters were active later, so a list in letter order is latest first.
const topic = (id, title = id) => ({ id, title, workspace_id: 'w1', activity_ms: 1000 - id.charCodeAt(0) });
const answer = (items, next = null) => ({ instance_id: 'i1', items, next_cursor: next === null || next.includes(':') ? next : topicPosition(topic(next)) });

test('topic pages preserve current identity and allow repeated titles without duplicate links', () => {
  const pages = new TopicPages('i1', 'w1', topic('z', 'Same title'));
  pages.accept(answer([topic('a', 'Same title'), topic('b')], 'b'), null);
  assert.deepEqual(pages.items.map(x => x.id), ['a', 'b', 'z'], 'the open topic is listed in its place by activity');
  pages.accept(answer([topic('z', 'Same title')]), pages.next);
  assert.deepEqual(pages.items.map(x => x.id), ['a', 'b', 'z']); assert.equal(pages.next, null);
  pages.current = topic('z', 'Renamed'); assert.equal(pages.items.at(-1).title, 'Renamed');
});
test('topic pages reject foreign identity, repeated cursor and malformed rows without changing links', () => {
  const pages = new TopicPages('i1', 'w1', topic('z'));
  pages.accept(answer([topic('a')], 'a'), null); const before = structuredClone(pages.items), at = pages.next;
  for (const invalid of [ { ...answer([topic('b')]), instance_id: 'other' }, answer([{ ...topic('b'), workspace_id: 'other' }]),
    answer([topic('b'), topic('b')]), answer([topic('b')], 'a'), answer([topic('b')], 'unrelated'), answer([{ ...topic('b'), title: null }]),
    // Out of order, before the cursor, without an activity time, or belonging to another list.
    answer([topic('c'), topic('b')]), answer([topic('a')]), answer([{ ...topic('b'), activity_ms: undefined }]), answer([{ ...topic('b'), activity_ms: -1 }]),
    answer([{ ...topic('b'), state: 'done' }]), answer([{ ...topic('b'), archived: true }]),
    { ...answer([topic('b')]), groups: { done: -1, archived: 0 } }, { ...answer([topic('b')]), groups: {} } ]) {
    assert.throws(() => pages.accept(invalid, at), JSON.stringify(invalid)); assert.deepEqual(pages.items, before);
  }
  assert.equal(pages.accept(answer([topic('c')]), 'stale'), false);
  // The same time orders by id, larger first, as the server does.
  const tied = new TopicPages('i1', 'w1', null);
  tied.accept(answer([{ ...topic('b'), activity_ms: 5 }, { ...topic('a'), activity_ms: 5 }]));
  assert.throws(() => tied.accept(answer([{ ...topic('a'), activity_ms: 5 }, { ...topic('b'), activity_ms: 5 }])));
  // Each list takes only its own topics, and the archived one the done ones after the rest.
  const archived = new TopicPages('i1', 'w1', null, 'archived');
  archived.accept(answer([{ ...topic('b'), archived: true }, { ...topic('a'), archived: true, state: 'done' }]));
  assert.deepEqual(archived.items.map(x => x.id), ['b', 'a']);
  assert.throws(() => archived.accept(answer([{ ...topic('a'), archived: true, state: 'done' }, { ...topic('b'), archived: true }])));
  const done = new TopicPages('i1', 'w1', { ...topic('z'), state: 'done' }, 'done');
  assert.deepEqual(done.items.map(x => x.id), ['z'], 'a done open topic is listed among the done ones');
  assert.deepEqual(new TopicPages('i1', 'w1', { ...topic('z'), state: 'done' }).items, [], 'and not among the rest');
});
// A registered writing's session, as the registry reads it: its sends and which are under way.
const owner = editor => ({ editor, sends: new Map(), underWay(id) { return this.sends.has(id); } });
function fixture() {
  const editors = ['inline', 'reply', 'note'].map((key, i) => ({ key, localVersion: i + 1, ackVersion: 0,
    submissions: [], context: { kind: i === 2 ? 'note' : 'reply' }, get dirty() { return this.localVersion > this.ackVersion; } }));
  const inline = { editors: { reply: editors[0] } }, current = { editors: { reply: editors[1], note: editors[2] } };
  const sessions = new Map(editors.map(e => [e.key, owner(e)])), saved = [], kept = [], visits = [], keptEditors = [];
  // Each writing's list of replies not sent was read, and is empty.
  const registry = { inline, current, sessions, disposed: false, hasUnprotectedWriting: false, doubt: EditorRegistry.prototype.doubt,
    pages: new Map(editors.map(e => [e.key, { items: [], next_cursor: null, through: 0 }])),
    flush: async e => { saved.push(e.key); e.ackVersion = e.localVersion; return { recorded: true, status: 'committed' }; },
    keepLocal: async p => { kept.push(p); } };
  registry.keepEditorsLocal = async editors => {
    keptEditors.push(...editors);
    for (const p of [inline,current]) if (Object.values(p.editors).some(e=>editors.includes(e))) await registry.keepLocal(p);
  };
  for (const name of ['hasInFlightSend','inDoubt']) Object.defineProperty(registry,name,{get(){return Object.getOwnPropertyDescriptor(EditorRegistry.prototype,name)?.get.call(this);}});
  return { registry, editors, saved, kept, keptEditors, visits, navigation: new TopicNavigation({ registry, topicId: 'a', navigate: id => visits.push(id) }) };
}
test('topic navigation waits for inline and Reader saves before leaving inside the debounce window', async () => {
  const f = fixture(), gate = deferred(), save = f.registry.flush;
  f.registry.flush = async e => { if (e === f.editors[0]) await gate.promise; return save(e); };
  const leaving = f.navigation.open('b'); await Promise.resolve(); assert.deepEqual(f.visits, []);
  gate.resolve(); assert.equal(await leaving, true);
  assert.deepEqual(f.saved.sort(), ['inline', 'note', 'reply']); assert.deepEqual(f.visits, ['b']);
  assert.ok(f.kept.includes(f.registry.inline) && f.kept.includes(f.registry.current));
});
for (const failure of ['rejected', 'unknown', 'transport', 'unavailable']) test(`topic navigation stays and preserves local writing on ${failure} save`, async () => {
  const f = fixture();
  f.registry.flush = async e => { if (e === f.editors[0]) {
    if (failure === 'transport') throw Error('Offline');
    if (failure === 'unavailable') e.unavailable = true;
    return failure === 'unknown' || failure === 'unavailable' ? null : { recorded: true, status: 'rejected' };
  } e.ackVersion = e.localVersion; return { recorded: true, status: 'committed' }; };
  await assert.rejects(f.navigation.open('b'), /stay|stayed|save|saved/i);
  assert.deepEqual(f.visits, []); assert.ok(f.kept.includes(f.registry.inline)); assert.equal(f.editors[0].localVersion, 1);
});
// The navigation line says why the page stayed; it goes once the page reaches
// Theseus only when what stopped the departure was about reaching it.
test('a departure stopped by a save that met no Theseus says so as such; one Core refused, or writing this device could not keep, does not', async () => {
  const lost = () => new AttemptError('Connection interrupted. Confirmation is unknown; your writing is kept.');
  const refused = () => new AttemptError('This topic is closed.', 409, { error: { code: 'CONFLICT' } });
  for (const [name, save, keep, about] of [['no answer', lost, null, true], ['Core refused', refused, null, false],
    ['no answer, and this device could not keep the writing', lost, Error('Quota exceeded'), false]]) {
    const f = fixture();
    f.registry.flush = async e => { if (e === f.editors[0]) throw save(); e.ackVersion = e.localVersion; return { recorded: true, status: 'committed' }; };
    if (keep) f.registry.keepLocal = async () => { throw keep; };
    const stopped = await f.navigation.open('b').then(() => assert.fail('the departure was meant to stop'), error => error);
    assert.equal(unreached(stopped), about, `${name}: ${stopped.message}`);
    assert.deepEqual(f.visits, []);
  }
});

test('topic navigation rejects new typing, replaced owners and unrelated unprotected work while saving', async () => {
  for (const change of [f => f.editors[0].localVersion++, f => f.registry.sessions.delete('inline'),
    f => f.registry.sessions.set('inline', { editor: f.editors[0], sends: new Map() }),
    f => { f.registry.hasUnprotectedWriting = true; }]) {
    const f = fixture(), gate = deferred(), save = f.registry.flush;
    f.registry.flush = async e => { const receipt = await save(e); if (e === f.editors[0]) await gate.promise; return receipt; };
    const pending = f.navigation.open('b'); await Promise.resolve(); change(f); gate.resolve();
    await assert.rejects(pending); assert.deepEqual(f.visits, []);
  }
});
test('newer topic choice wins, current topic does nothing, and clean editors need no receipt', async () => {
  const f = fixture(); for (const e of f.editors) e.ackVersion = e.localVersion;
  f.registry.flush = async () => { throw Error('Clean writing must not be saved again'); };
  assert.equal(await f.navigation.open('a'), false); assert.deepEqual(f.kept, []);
  const gate = deferred(); f.registry.keepLocal = async p => { f.kept.push(p); await gate.promise; };
  const first = f.navigation.open('b'), second = f.navigation.open('c'); gate.resolve();
  assert.equal(await first, false); assert.equal(await second, true); assert.deepEqual(f.visits, ['c']);
});

test('a current-topic choice cancels an older pending departure', async () => {
  const f = fixture(), gate = deferred();
  f.registry.keepLocal = async () => gate.promise;
  const first = f.navigation.open('b'); await Promise.resolve();
  assert.equal(await f.navigation.open('a'), false); gate.resolve();
  assert.equal(await first, false); assert.deepEqual(f.visits, []);
});

test('durable but unpublished selected images keep active writing here even without dirty text', async () => {
  const f = fixture(); for (const e of f.editors) e.ackVersion = e.localVersion;
  const editor = f.editors[0]; editor.clientCycleId = 'cycle'; editor.draft = { attachments: [] };
  editor.uploadState = { entries: [{ selected: true, owner: { kind: 'cycle', id: 'cycle' }, bytes_state: 'durable' }] };
  await assert.rejects(f.navigation.open('b'), /image|saved/i); assert.deepEqual(f.visits, []);
  assert.ok(f.kept.includes(f.registry.inline));
});

test('canonical attachments, removed selections and prior-submission images allow leaving', async () => {
  const f = fixture(); for (const e of f.editors) e.ackVersion = e.localVersion;
  const editor = f.editors[0]; editor.clientCycleId = 'cycle'; editor.draft = { attachments: [{ id: 'ready' }] };
  editor.uploadState = { entries: [
    { selected: true, owner: { kind: 'cycle', id: 'cycle' }, ready_descriptor: { media_id: 'ready' }, association: { cycle_id: 'cycle', media_id: 'ready' } },
    { selected: false, owner: { kind: 'cycle', id: 'cycle' }, bytes_state: 'durable' },
    { selected: true, owner: { kind: 'submission', id: 'old' }, bytes_state: 'durable' },
  ] };
  assert.equal(await f.navigation.open('b'), true); assert.deepEqual(f.visits, ['b']);
});

test('a new selected image during preservation prevents departure at the final boundary', async () => {
  const f = fixture(), editor = f.editors[0];
  f.registry.keepLocal = async () => {
    editor.clientCycleId = 'cycle'; editor.draft = { attachments: [] };
    editor.uploadState = { entries: [{ selected: true, owner: { kind: 'cycle', id: 'cycle' }, bytes_state: 'durable' }] };
  };
  await assert.rejects(f.navigation.open('b'), /image|saved/i); assert.deepEqual(f.visits, []);
});

test('a saved version still needs a committed receipt, while an already reconciled null save is allowed', async () => {
  for (const receipt of [{ recorded: true, status: 'rejected' }, { recorded: false, status: 'committed' }, null]) {
    const f = fixture(); f.registry.flush = async e => { e.ackVersion = e.localVersion; return receipt; };
    if (receipt === null) { assert.equal(await f.navigation.open('b'), true); assert.deepEqual(f.visits, ['b']); }
    else { await assert.rejects(f.navigation.open('b'), /saved/i); assert.deepEqual(f.visits, []); }
  }
});

test('failed local preservation stays even after canonical acknowledgement', async () => {
  const f = fixture(); f.registry.keepLocal = async () => { throw Error('Storage unavailable'); };
  await assert.rejects(f.navigation.open('b'), /Keep this page open/); assert.deepEqual(f.visits, []);
});

const pendingItem = (id='pending') => ({ id, status:'preparing', prepareOperationId:id+'-prepare', sendOperationId:id+'-send', detached:false });
test('active sends and a send started during preservation block departure', async () => {
  for (const late of [false,true]) {
    const f=fixture(), session=f.registry.sessions.get('inline');
    const start=()=>session.sends.set('active',Promise.resolve());
    if(late) f.registry.keepLocal=async()=>start(); else start();
    await assert.rejects(f.navigation.open('b','Design'),/send/i);assert.deepEqual(f.visits,[]);
  }
});
test('closed registered editors are flushed and preserved too', async () => {
  const f=fixture();f.registry.current=null;
  assert.equal(await f.navigation.open('b'),true);
  assert.deepEqual(f.saved.sort(),['inline','note','reply']);
  assert.ok(f.keptEditors.includes(f.editors[1]) && f.keptEditors.includes(f.editors[2]));
});
test('new registered session during preservation invalidates departure', async () => {
  const f=fixture();f.registry.keepLocal=async()=>f.registry.sessions.set('new',owner({key:'new',submissions:[],localVersion:0,context:{kind:'note'}}));
  await assert.rejects(f.navigation.open('b'));assert.deepEqual(f.visits,[]);
});
test('settled unconfirmed send requires a named informed second choice and no replay', async () => {
  const f=fixture();f.editors[0].submissions.push(pendingItem());
  await assert.rejects(f.navigation.open('b','Design'),/Use “Review 1 reply” to check.*“Design” again/s);assert.deepEqual(f.visits,[]);
  assert.ok(f.keptEditors.includes(f.editors[0]));
  assert.equal(await f.navigation.open('b','Design'),true);assert.deepEqual(f.visits,['b']);
});
test('informed departure choice invalidates on destination, writing, owner, session, item or operation changes', async () => {
  for (const change of [
    f=>{f.destination='c';},f=>f.editors[0].localVersion++,
    f=>f.registry.sessions.set('inline',owner(f.editors[0])),
    f=>f.registry.sessions.set('new',owner({key:'new',submissions:[],localVersion:0,context:{kind:'note'}})),
    f=>f.editors[0].submissions.push(pendingItem('new')),
    f=>f.editors[0].submissions.push({...pendingItem('new-confirmed'),status:'confirmed'}),
    f=>{f.editors[0].submissions[0].status='prepared';},
    f=>{f.editors[0].submissions[0].sendOperationId='changed';},
    f=>{f.editors[0].submissions[0].prepareOperationId='changed';},
    async f=>{await f.navigation.open('a');},
  ]) {
    const f=fixture();f.editors[0].submissions.push(pendingItem());
    await assert.rejects(f.navigation.open('b','Design'),/Use “Review 1 reply” to check/);await change(f);
    await assert.rejects(f.navigation.open(f.destination??'b','Design'),/Use “Review \d+ repl(y|ies)” to check/);assert.deepEqual(f.visits,[]);
  }
});
// Item 118: leaving asks about exactly the replies a Review button shows: a
// refused or earlier runtime's reply has one, and a reply that went has none.
test('confirmed history permits departure, refused and detached replies ask as their Review button shows; resolution releases a prior choice', async () => {
  for(const [item,label] of [[{...pendingItem(),status:'confirmed'},null],[{...pendingItem(),status:'refused'},'Review 1 reply'],[{...pendingItem(),detached:true},'Review 1 reply']]) {
    const f=fixture();f.editors[0].submissions.push(item);
    assert.equal(f.registry.doubt(f.editors[0]).label,label);
    if(label)await assert.rejects(f.navigation.open('b'),new RegExp(`Use “${label}” to check`));else assert.equal(await f.navigation.open('b'),true);
  }
  const f=fixture(),item=pendingItem();f.editors[0].submissions.push(item);
  await assert.rejects(f.navigation.open('b'),/Review 1 reply/);item.status='confirmed';assert.equal(await f.navigation.open('b'),true);
});
test('settled-send consent never bypasses a required unavailable draft save', async () => {
  const f=fixture();f.editors[0].submissions.push(pendingItem());
  await assert.rejects(f.navigation.open('b'),/Review 1 reply/);
  f.editors[0].localVersion++;f.editors[0].unavailable=true;f.registry.flush=async()=>null;
  await assert.rejects(f.navigation.open('b'),/saved/i);assert.deepEqual(f.visits,[]);
});
test('departure choice is not armed before the warning can be shown', async () => {
  const f=fixture(),gate=deferred();let calls=0;f.editors[0].submissions.push(pendingItem());
  f.registry.keepEditorsLocal=async()=>{if(++calls===2)await gate.promise;};
  const first=f.navigation.open('b');
  for(let n=0;n<20&&calls<2;n++)await Promise.resolve();assert.equal(calls,2);
  const second=f.navigation.open('b');await assert.rejects(second,/Review 1 reply/);
  gate.resolve();await first;assert.deepEqual(f.visits,[]);
});


test('a new Notebook page opens its empty card editor through an exact cards route', () => {
  const route = {kind:'cards', id:'n-first', write:'new'};
  assert.equal(routeHref(route), '?cards=n-first&write=new');
  assert.deepEqual(parseRoute(new URL('https://example.test/?cards=n-first&write=new')), route);
  assert.throws(() => parseRoute(new URL('https://example.test/?cards=n-first&write=anything')), /incomplete|ambiguous/);
});

test('Notebook writing links name Text or Cards without changing the page identity',()=>{
  for(const view of ['text','cards']){
    const route={kind:'cards',id:'n-notes',view};
    assert.equal(routeHref(route),'?cards=n-notes&view='+view);
    assert.deepEqual(parseRoute(new URL('https://example.test/'+routeHref(route))),route);
  }
  assert.throws(()=>parseRoute(new URL('https://example.test/?cards=n-notes&view=unknown')),/incomplete|ambiguous/);
});
