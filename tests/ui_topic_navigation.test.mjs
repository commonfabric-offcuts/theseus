import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicPages, TopicNavigation, topicPosition, routeHref, parseRoute } from '../web/topic-navigation.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { AttemptError, unreached } from '../web/api.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
// Earlier letters have newer stable positions, so a list in letter order is latest first.
const topic = (id, title = id) => ({ id, title, workspace_id: 'w1', list_position: 1000 - id.charCodeAt(0) });
const answer = (items, next = null) => ({ instance_id: 'i1', items, next_cursor: next === null || next.includes(':') ? next : topicPosition(topic(next)) });

test('topic pages preserve current identity and allow repeated titles without duplicate links', () => {
  const pages = new TopicPages('i1', 'w1', topic('z', 'Same title'));
  pages.accept(answer([topic('a', 'Same title'), topic('b')], 'b'), null);
  assert.deepEqual(pages.items.map(x => x.id), ['a', 'b', 'z'], 'the open topic is listed in its place by stable position');
  pages.accept(answer([topic('z', 'Same title')]), pages.next);
  assert.deepEqual(pages.items.map(x => x.id), ['a', 'b', 'z']); assert.equal(pages.next, null);
  pages.current = topic('z', 'Renamed'); assert.equal(pages.items.at(-1).title, 'Renamed');
});
test('topic pages reject foreign identity, repeated cursor and malformed rows without changing links', () => {
  const pages = new TopicPages('i1', 'w1', topic('z'));
  pages.accept(answer([topic('a')], 'a'), null); const before = structuredClone(pages.items), at = pages.next;
  for (const invalid of [ { ...answer([topic('b')]), instance_id: 'other' }, answer([{ ...topic('b'), workspace_id: 'other' }]),
    answer([topic('b'), topic('b')]), answer([topic('b')], 'a'), answer([topic('b')], 'unrelated'), answer([{ ...topic('b'), title: null }]),
    // Out of order, before the cursor, without an stable position, or belonging to another list.
    answer([topic('c'), topic('b')]), answer([topic('a')]), answer([{ ...topic('b'), list_position: undefined }]), answer([{ ...topic('b'), list_position: -1 }]),
    answer([{ ...topic('b'), state: 'done' }]), answer([{ ...topic('b'), archived: true }]),
    { ...answer([topic('b')]), groups: { done: -1, archived: 0 } }, { ...answer([topic('b')]), groups: {} } ]) {
    assert.throws(() => pages.accept(invalid, at), JSON.stringify(invalid)); assert.deepEqual(pages.items, before);
  }
  assert.equal(pages.accept(answer([topic('c')]), 'stale'), false);
  // The same time orders by id, larger first, as the server does.
  const tied = new TopicPages('i1', 'w1', null);
  tied.accept(answer([{ ...topic('b'), list_position: 5 }, { ...topic('a'), list_position: 5 }]));
  assert.throws(() => tied.accept(answer([{ ...topic('a'), list_position: 5 }, { ...topic('b'), list_position: 5 }])));
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
// The move the guard clears may wait before it is made (in-place-navigation.mjs reads the build the server serves
// first), and the person may write on meanwhile. The guard hands the move its last look, still(), which the move asks
// again where it is made: it throws why the page stays when what it cleared has changed, and answers false once a newer
// choice has taken the move's place.
test('topic navigation hands the move its last look, which refuses new typing, a replaced owner, unprotected work, a send or an unready image once they come, and gives way to a newer choice', async () => {
  const keep = /Keep this page open until your writing and selected images are safely saved/;
  for (const [what, change, refusal] of [['new typing', f => f.editors[0].localVersion++, keep], ['a replaced owner', f => f.registry.sessions.delete('inline'), keep],
    ['the Reader replaced', f => { f.registry.current = { editors: {} }; }, keep], ['unprotected work', f => { f.registry.hasUnprotectedWriting = true; }, keep],
    ['a send', f => { f.registry.sessions.get('inline').sends.set('s1', {}); }, /Wait for the send to finish/],
    ['an unready image', f => { const e = f.editors[0]; e.clientCycleId = 'cycle'; e.draft = { attachments: [] };
      e.uploadState = { entries: [{ selected: true, owner: { kind: 'cycle', id: 'cycle' }, bytes_state: 'durable' }] }; }, keep]]) {
    const f = fixture(), looks = [];
    const navigation = new TopicNavigation({ registry: f.registry, topicId: 'a', navigate: (id, still) => { f.visits.push(id); looks.push(still); } });
    assert.equal(await navigation.open('b'), true, what);
    assert.deepEqual(f.visits, ['b']);
    assert.equal(typeof looks[0], 'function', `${what}: the move is handed the guard's last look`);
    assert.equal(looks[0](), true, `${what}: as the guard hands it over, it stands`);
    change(f);
    assert.throws(() => looks[0](), refusal, `${what}: once it comes, the move is refused`);
  }
  const f = fixture(), looks = [];
  const navigation = new TopicNavigation({ registry: f.registry, topicId: 'a', navigate: (id, still) => { f.visits.push(id); looks.push(still); } });
  assert.equal(await navigation.open('b'), true);
  const later = navigation.open('c');
  assert.equal(looks[0](), false, 'a newer choice takes the waiting move\'s place, which then stays without a word');
  assert.equal(await later, true); assert.equal(looks[1](), true, 'and the newer one stands');
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

// Item 548, review B4: an image the draft names and Theseus already holds (a reply set aside put it back, or the
// draft came from another page) is retained from the draft; while this page is still checking it, leaving loses
// nothing, so it holds no press. One the draft no longer names, and a chosen file not yet published, still hold.
test('an image retained from the draft lets the page leave while it is still being checked; one the draft does not name holds', async () => {
  const leave = async (entry, attachments) => {
    const f = fixture(); for (const e of f.editors) e.ackVersion = e.localVersion;
    const editor = f.editors[1]; editor.clientCycleId = 'cycle'; editor.draft = { attachments };
    editor.uploadState = { entries: [{ selected: true, owner: { kind: 'cycle', id: 'cycle' }, ready_descriptor: null, association: null, ...entry }] };
    const left = await f.navigation.open('b').catch(error => error.message);
    return [left, f.visits];
  };
  const retained = { origin: 'retained-ref', retained_ref: { id: 'kept' }, bytes_state: 'released' };
  assert.deepEqual(await leave(retained, [{ id: 'kept' }]), [true, ['b']], 'still being checked, it goes');
  assert.deepEqual(await leave({ ...retained, local_error: 'Retained attachment is unavailable — check or remove it' }, [{ id: 'kept' }]), [true, ['b']],
    'one this page could not check is still the draft\'s, so it goes');
  const [held, visits] = await leave(retained, [{ id: 'other' }]);
  assert.match(held, /image/); assert.deepEqual(visits, [], 'one the draft does not name holds');
  const [file, none] = await leave({ origin: 'file', bytes_state: 'durable' }, [{ id: 'kept' }]);
  assert.match(file, /image/); assert.deepEqual(none, [], 'a chosen file not yet published holds');
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
// Item 547: a reply whose send is not confirmed holds no move. Leaving goes at
// the first choice, keeps the writing on this device first, and sends nothing.
test('a settled unconfirmed send holds no move: the first choice leaves, its writing kept here first, nothing replayed', async () => {
  const f=fixture(),item=pendingItem();f.editors[0].submissions.push(item);
  assert.equal(f.registry.doubt(f.editors[0]).label,'Review 1 reply');
  assert.equal(await f.navigation.open('b','Design'),true);assert.deepEqual(f.visits,['b']);
  assert.ok(f.keptEditors.includes(f.editors[0]),'kept on this device before the page went');
  assert.deepEqual([f.editors[0].submissions.length,item.status],[1,'preparing'],'nothing sent again, nothing discarded');
});
// Item 118's Review buttons still answer as before; none of them holds a move.
test('confirmed, refused and detached replies all leave at the first choice', async () => {
  for(const [item,label] of [[{...pendingItem(),status:'confirmed'},null],[{...pendingItem(),status:'refused'},'Review 1 reply'],[{...pendingItem(),detached:true},'Review 1 reply']]) {
    const f=fixture();f.editors[0].submissions.push(item);
    assert.equal(f.registry.doubt(f.editors[0]).label,label);
    assert.equal(await f.navigation.open('b'),true);assert.deepEqual(f.visits,['b']);
  }
});
test('a reply in doubt never lets a move past a required unavailable draft save', async () => {
  const f=fixture();f.editors[0].submissions.push(pendingItem());
  f.editors[0].localVersion++;f.editors[0].unavailable=true;f.registry.flush=async()=>null;
  await assert.rejects(f.navigation.open('b'),/saved/i);assert.deepEqual(f.visits,[]);
  await assert.rejects(f.navigation.open('b'),/saved/i,'nor at a second choice');assert.deepEqual(f.visits,[]);
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

// A draft Notebook page wears a light "draft" after its title wherever it is listed, with the mark's tooltip; a page
// not marked wears none (item 391; docs/notebook-pages.md, "A draft page").
test('a draft page is marked in a listing and a page not marked is not', async () => {
  const { paintChanged, DRAFT_TIP } = await import('../web/topic-navigation.mjs');
  const previous = globalThis.document;
  class Node { constructor() { this.children = []; } append(...nodes) { this.children.push(...nodes); } get lastChild() { return this.children.at(-1) ?? null; } }
  globalThis.document = { createElement: () => new Node() };
  try {
    const marked = new Node(), plain = new Node();
    paintChanged(marked, { revision: 2, read_revision: 2, draft: true });
    paintChanged(plain, { revision: 2, read_revision: 2, draft: false });
    assert.deepEqual(marked.children.map(n => [n.className, n.textContent, n.title]), [['draft-mark', 'draft', DRAFT_TIP]]);
    assert.match(DRAFT_TIP, /agents do not read this page until the mark is cleared/);
    assert.deepEqual(plain.children, []);
  } finally { globalThis.document = previous; }
});


test('item 641 the current topic and a page cursor keep their positions when activity changes', () => {
  const a = { ...topic('a'), list_position: 10, activity_ms: 1 };
  const b = { ...topic('b'), list_position: 20, activity_ms: 2 };
  const pages = new TopicPages('i1', 'w1', a);
  pages.accept({ instance_id: 'i1', items: [b], next_cursor: topicPosition(b) });
  const cursor = pages.next;
  pages.current = { ...a, activity_ms: 1000 };
  assert.deepEqual(pages.items.map(item => item.id), ['b', 'a'], 'the open topic never jumps on a live topic read');
  assert.equal(topicPosition(pages.current), topicPosition(a), 'activity cannot move a cursor');
  pages.accept({ instance_id: 'i1', items: [{ ...a, activity_ms: 1000 }], next_cursor: null }, cursor);
  assert.deepEqual(pages.items.map(item => item.id), ['b', 'a'], 'More lists the same topics once');
});
