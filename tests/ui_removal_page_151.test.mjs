// 151 Build2 page return: real bounded owners, no Core, HTTP or browser.
// These checks do not execute app.mjs's startup or its generic integration file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderer799 } from './fixtures/renderer799.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { DossierHeads } from '../web/stack-order.mjs';
import { arrangeStacks, stackState } from '../web/reply-stacks.mjs';
import { cardIn, paintFoldWords } from '../web/fold.mjs';
import { paintAuthor, carriesOf } from '../web/marks.mjs';
import { wasEdited } from '../web/message-edit-writing.mjs';
import { paintWithdrawal, withdrawalItem, Withdrawals } from '../web/question-withdrawal.mjs';
import { removalItem, paintRemoval, readRemoval, Removals } from '../web/message-removal.mjs';
import { replyLine, paintReplyLine } from '../web/replies.mjs';
import { Freshness, checkedView, bindingOf } from '../web/freshness.mjs';

const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/stack-look.css', import.meta.url), 'utf8');
const act = Object.freeze({ kind: 'retracted', by: 'owner', at_ms: 1234567890000 });
const identity = { instance_id: 'fixture151-page', actor: 'owner', actor_kind: 'human',
  authority: { authority_id: 'fixture-authority', authority_epoch: 'fixture-epoch' },
  transport: { read_admission: { version: 1, header: 'X-AIM-Read-Class',
    foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 },
    background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } } } };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const position = root => ({ root_id: root, can_move: true, at: { acts: 1, messages: 50 } });
const message = (id, seq, extra = {}) => ({ id, seq, topic_id: 'topic', author_id: 'owner', author_kind: 'human',
  body: 'Original words of ' + id, addressees: [], removal: null, removal_action: 'unsend', revision: 1,
  stack_position: position('root'), ...extra });
const page = items => ({ instance_id: identity.instance_id, items, next_cursor: null, relevant_versions: { topic: 1 } });
function section(start, end) {
  const first = app.indexOf(start), last = app.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, 'SETUP: exact app owner boundaries must exist: ' + start);
  return app.slice(first, last);
}
const learnedCode = section('function learnMessageRemoval(', '// Who may edit which message here');
const headCode = section('function refreshDossierHeads(', 'function stackMessages(');
const authorCode = section('function paintCardAuthor(', '// Who the composers may whisper to');
const readerCode = section('function readerMessageMenuItems(p)', '// A message\'s withdrawal is permanent');
const sharedCode = section('function sharedMessageMenuItems(', '// A feed action that needs the full source');
const freshnessCode = section('function enableFreshness(', '// What could not be done for want of Theseus');
const availabilityCode = section('async function checkAvailability(', 'async function checkInlineAvailability(');
const removalConstruction = section('  const withdrawalPage = shell.page;', "  mountFeedFences($('messages'));");
function evaluate(env, code, returned) {
  return new Function(...Object.keys(env), code + '\nreturn ' + returned + ';')(...Object.values(env));
}

test('924 app card creation and loaded-reply repaint use the shared parent removal painter', () => {
  const doc = renderer799().list.ownerDocument, card = doc.createElement('div');
  const item = message('reply', 2, { reply_to: 'parent', reply_to_author: 'owner', reply_to_excerpt: 'Original parent words' });
  const node = (tag, text, cls) => { const result = doc.createElement(tag); result.className = cls; if (text !== undefined) result.textContent = text; return result; };
  card.append(node('span', item.body, 'message-preview'));
  const code = section('function paintReplyContext(', 'function paintCardAuthor(');
  const paint = evaluate({ node, replyLine, paintReplyLine, bootstrap: identity, feedMessages: () => new Map() }, code, 'paintReplyContext');
  paint(card, item);
  const line = card.querySelector('.message-reply-to');
  assert.equal(line.text, 'Replying to owner: Original parent words');
  item.reply_to_removal = act;
  paint(card, item);
  decorated(line, 'Original parent words', 'REPLY_PARENT', '.reply-parent-words');
  assert.equal(line.classList.contains('retracted-words'), false, 'author prefix and act remain undecorated');
});
function documentFor(t, doc) {
  const before = globalThis.document;
  globalThis.document = doc;
  t.after(() => { globalThis.document = before; });
}
function renderFixture(t, items, options = {}) {
  const r = renderer799('owner'), doc = r.list.ownerDocument;
  documentFor(t, doc);
  r.add(items);
  // Renderer799's grouping fixture intentionally supplies no body. This test
  // owns these explicit words; install them before testing their real painter.
  for (const item of items) Object.assign(r.messages.get(item.id), structuredClone(item));
  const state = stackState(r.list);
  const arrange = () => arrangeStacks(r.list, r.messages, { viewer: 'owner', doc, ...options });
  arrange();
  return { ...r, doc, state, arrange, entry: id => [...r.list.descendants()].find(node => node.dataset.id === id) };
}
function decorated(row, original, prefix, wordSelector = '.folded-words') {
  assert.ok(row, 'SETUP: actual compact row exists');
  const words = row.querySelector(wordSelector);
  assert.ok(words, 'SETUP: compact original-word node exists');
  assert.match(words.text, new RegExp(original), 'SETUP: fixture original words actually reached the painter');
  assert.equal(words.classList.contains('retracted-words'), true, prefix + '_WORDS: original words must be struck/dimmed');
  assert.equal(row.querySelectorAll('.message-retracted').length, 1, prefix + '_LABEL: one terminal label');
  const label = row.querySelector('.message-retracted'), time = label.querySelector('time');
  assert.ok(time, prefix + '_TIME: terminal label carries its time');
  assert.equal(time.dataset.ms, String(act.at_ms), prefix + '_TIME: exact acted time');
  assert.equal(label.closest('.retracted-words') === null, true, prefix + '_ANCESTOR: label must not inherit strike/dimming');
  assert.equal(time.closest('.retracted-words') === null, true, prefix + '_ANCESTOR: time must not inherit strike/dimming');
}
function cardEnvironment(t, { views, heads = null, entries = new Map(), registry = null, doc = null } = {}) {
  doc ??= renderer799().list.ownerDocument;
  documentFor(t, doc);
  const writing = { body: 'Exact private reply\nkept', caret: { start: 2, end: 4 } };
  registry ??= { current: null, disposed: false, cancelSave() {} };
  const counts = { author: 0, origin: 0, menu: 0, hidden: 0 };
  const env = { views, dossierHeads: heads, messageEntries: entries, registry, document: doc, bootstrap: identity,
    topicUnavailable: false, authorityReviewPending: () => false,
    feedMessages: () => heads?.messages(views.messages) ?? views.messages,
    cardIn, clearVisitNew() {}, paintFoldWords, paintAwaiting() {}, paintReactions() {},
    paintAuthor, displayActor: id => id, marks: null, wasEdited, carriesOf, paintWithdrawal, paintRemoval,
    here: null, stackFeed: null, messageUpdateActivity: () => null, updateContext: () => ({}),
    visitNew: null, paintVisitNew() {}, cardObserver: null, middleObserver: null,
    menu: { paint() { counts.menu++; } },
    reader: { paintOrigin() { counts.origin++; }, hideUnavailableSource() { counts.hidden++; } },
    revokeMedia() {}, paintReaderMark() {}, paintReaderThumb$() {},
  };
  const methods = evaluate(env, headCode + authorCode + learnedCode,
    '{ learnMessageRemoval, refreshDossierHeads, syncDossierHeads, paintCardAuthor }');
  return { env, methods, counts, writing, doc };
}
async function headFixture(t, { delayed = false } = {}) {
  const root = message('root', 1), other = message('other-root', 2, { stack_position: position('other-root') });
  const replies = [message('reply', 40, { reply_to: 'root' }),
    message('other-reply', 50, { reply_to: other.id, stack_position: position(other.id) })];
  const doc = renderer799().list.ownerDocument, entries = new Map(), requests = [], gate = deferred();
  let learned = null, count = 0, f;
  const views = new TopicViews({ instanceId: identity.instance_id, topicId: 'topic' });
  views.messagesPage(page(replies), { initial: true });
  const heads = new DossierHeads({ topicId: 'topic', read: async (name, args) => {
    requests.push([name, structuredClone(args)]);
    assert.equal(name, 'topic_messages', 'SETUP: supplemental head uses existing read');
    assert.equal(args.topic_id, 'topic');
    if (args.message_ids.includes(root.id) && ++count === 1 && delayed) return gate.promise;
    return page(args.message_ids.flatMap(id => id === other.id ? [structuredClone(other)] :
      learned?.kind === 'unsent' ? [] : [{ ...root, removal: learned, removal_action: learned ? null : 'unsend' }]));
  }, changed: () => paint() });
  const paint = () => {
    if (!f) return;
    const combined = heads.messages(views.messages);
    for (const [id, card] of entries) if (!combined.has(id)) { card.remove(); entries.delete(id); }
    for (const item of combined.values()) {
      let card = entries.get(item.id);
      if (!card) {
        card = doc.createElement('article'); card.className = 'message-card'; card.dataset.id = item.id;
        const author = doc.createElement('span'); author.className = 'message-author';
        const body = doc.createElement('span'); body.className = 'message-preview'; body.textContent = item.body;
        card.append(author, body); entries.set(item.id, card);
      }
      f.methods.paintCardAuthor(card.querySelector('.message-author'), item);
    }
  };
  f = cardEnvironment(t, { views, heads, entries, doc });
  views.paint = () => paint();
  heads.sync(views.messages); await tick();
  if (!delayed) await heads.readTail;
  t.after(() => { gate.resolve(page([root])); });
  return { ...f, root, other, heads, views, entries, requests, gate,
    terminal(value) { learned = value; f.methods.learnMessageRemoval({ message_id: root.id, removal: value }); } };
}

test('151 page heads: Retract refreshes a separately read head without filling history', async t => {
  const f = await headFixture(t), frontiers = structuredClone([f.views.olderCursor, f.views.newest, [...f.views.runs]]);
  assert.equal(f.views.messages.has('root'), false, 'SETUP: head is genuinely separate from loaded page');
  assert.equal(f.heads.messages(f.views.messages).get('root').body, f.root.body);
  const other = f.heads.records.get('other-root'), prior = f.requests.length;
  f.terminal(act); await f.heads.readTail;
  const combined = f.heads.messages(f.views.messages), card = f.entries.get('root');
  assert.deepEqual(combined.get('root')?.removal, act, 'H1_SUPPLEMENTAL_TERMINAL: combined owner must know Retract');
  assert.ok(card?.classList.contains('retracted-message'), 'H1_CARD: separately loaded card must repaint terminal');
  assert.equal(card.querySelectorAll('.message-retracted').length, 1, 'H1_LABEL: exact head label');
  assert.equal(card.querySelector('.message-preview').text, f.root.body, 'H1_WORDS: readable original retained');
  assert.equal(f.heads.records.get('other-root'), other, 'H1_SCOPE: unrelated head is not invalidated');
  assert.ok(f.requests.slice(prior).every(([, args]) => args.message_ids.every(id => id === 'root')), 'H1_SCOPE: bounded exact-head refresh only');
  assert.deepEqual([f.views.olderCursor, f.views.newest, [...f.views.runs]], frontiers, 'H1_FRONTIER: no history fill');
});

test('151 page heads: delayed supplemental reads cannot revive a terminal head', async t => {
  for (const terminal of [act, { ...act, kind: 'unsent' }]) {
    t.diagnostic('H2 variant ' + terminal.kind);
    const f = await headFixture(t, { delayed: true });
    assert.equal(f.heads.records.get('root').state, 'loading', 'SETUP: actual supplemental read is pending');
    f.terminal(terminal); f.gate.resolve(page([structuredClone(f.root)]));
    await f.heads.readTail;
    const held = f.heads.messages(f.views.messages).get('root');
    if (terminal.kind === 'unsent') {
      assert.equal(held, undefined, 'H2_UNSENT: delayed read must not revive readable head');
      assert.equal(f.entries.has('root'), false, 'H2_UNSENT: no stale card');
    } else assert.deepEqual(held?.removal, act, 'H2_RETRACTED: delayed read must retain terminal fact');
    assert.equal(f.views.messages.has('root'), false, 'H2_FRONTIER: supplemental source stays separate');
  }
});

test('151 page compact: a saved folded message strikes only original words', t => {
  const f = renderFixture(t, [message('root', 1), message('folded', 2, { reply_to: 'root', removal: act,
    body: 'Saved folded original', acts: { folded: true, fold_revision: 1 } })]);
  for (let paint = 0; paint < 2; ++paint) {
    f.arrange(); const entry = f.entry('folded');
    assert.equal(entry.dataset.folded, 'true', 'SETUP: saved fold uses actual row owner');
    decorated(entry.querySelector('.message-folded'), 'Saved folded original', 'D1');
    assert.match(css, /\.message-card\[data-folded=true\]>:not\(\.message-folded,\.stack-head\)\{display:none!important\}/,
      'D1_CSS: label must be within the visible folded child');
  }
  assert.deepEqual(f.messages.get('folded').acts, { folded: true, fold_revision: 1 }, 'D1_ACT: repaint changes no personal fold act');
});

test('151 page compact: a closed dossier tab distinguishes original title from typed name', t => {
  for (const mode of ['closed', 'singleton', 'only-new']) for (const named of [null, { text: 'Typed dossier identity', by: 'owner' }, { text: 'Minted dossier identity', by: 'agent', minted: true }]) {
    t.diagnostic('D2 variant ' + mode + ' / ' + (named?.text ?? 'fallback'));
    const root = message('root', 1, { removal: act, body: 'Original dossier title', acts: named ? { name: named } : {} });
    const f = renderFixture(t, [root, ...(mode === 'singleton' ? [] : [message('reply', 2, { reply_to: 'root' })])]);
    f.state.levels.set('root', 'folded'); if (mode === 'only-new') f.state.only = () => true;
    for (let paint = 0; paint < 2; ++paint) {
      f.arrange(); const row = f.state.sections.get('root').querySelector('.stack-head'), name = row.querySelector('.stack-name');
      assert.match(name.text, new RegExp(named?.text ?? root.body), 'SETUP: actual dossier identity is rendered');
      if (named) {
        assert.equal(name.classList.contains('retracted-words'), false, 'D2_TYPED: typed identity is not original message words');
        assert.equal(name.querySelector('.retracted-words'), null, 'D2_TYPED: typed identity contains no struck words');
        assert.equal(row.querySelectorAll('.message-retracted').length, 1, 'D2_LABEL: typed tab still names terminal head');
      } else decorated(row, root.body, 'D2', '.stack-name');
      const label = row.querySelector('.message-retracted'), time = label?.querySelector('time');
      assert.equal(time?.dataset.ms, String(act.at_ms), 'D2_TIME: exact terminal time inside visible tab');
      assert.equal(label.closest('.retracted-words') === null, true, 'D2_ANCESTOR: terminal label is unstruck');
      assert.equal(time.closest('.retracted-words') === null, true, 'D2_ANCESTOR: terminal time is unstruck');
      assert.equal(row.parentElement.classList.contains('stack-head-card'), true, 'D2_VISIBLE: actual head child survives closed-head hiding');
    }
  }
});

test('151 page compact: earlier-message rows retain retraction through reveal', t => {
  const items = [message('root', 1), ...Array.from({ length: 9 }, (_, i) => message('reply' + (i + 2), i + 2,
    { reply_to: 'root', ...(i === 0 ? { body: 'Earlier original words', removal: act } : {}) }))];
  const f = renderFixture(t, items), before = [...f.messages].map(([id, item]) => [id, structuredClone(item.acts ?? {})]);
  const reveal = f.state.sections.get('root').querySelector('.stack-earlier');
  assert.ok(reveal, 'SETUP: actual more-than-seven stack offers Earlier messages');
  reveal.onclick({ pointerType: 'mouse' });
  for (let paint = 0; paint < 2; ++paint) {
    f.arrange(); const entry = f.entry('reply2');
    assert.equal(entry.dataset.earlier, 'true', 'SETUP: reveal uses actual earlier-row branch');
    decorated(entry.querySelector('.message-earlier'), 'Earlier original words', 'D3');
    assert.match(css, /\[data-earlier=true\][^{]+>:not\(\.message-earlier\):not\(\.stack-head\)\{display:none\}/,
      'D3_CSS: terminal label belongs inside the visible earlier row');
  }
  assert.deepEqual([...f.messages].map(([id, item]) => [id, item.acts ?? {}]), before, 'D3_ACT: reveal records no fold');
});

test('151 page compact: the automatically shown parent reply line retains retraction', t => {
  const f = renderFixture(t, [message('root', 1), message('parent', 2, { reply_to: 'root', body: 'Context parent original', removal: act }),
    message('new-reply', 3, { reply_to: 'parent', author_id: 'other', unread: true })], { unread: item => item.id === 'new-reply' });
  f.state.levels.set('root', 'folded');
  for (let paint = 0; paint < 2; ++paint) {
    f.arrange();
    assert.ok(f.state.contextRows.has('parent'), 'SETUP: actual new-reply context owner selected its parent');
    assert.equal(f.messages.get('parent').acts?.folded, undefined, 'SETUP: there is no saved fold');
    decorated(f.entry('parent').querySelector('.message-folded'), 'Context parent original', 'D4');
  }
});

function freshnessFixture(t, sourceRead, { denyTopic = false } = {}) {
  const doc = renderer799().list.ownerDocument; documentFor(t, doc);
  const views = new TopicViews({ instanceId: identity.instance_id, topicId: 'topic' });
  const ask = message('ask', 1, { intent: 'ask', withdrawal: { by: 'owner', at_ms: 12 } });
  views.messagesPage(page([ask]), { initial: true });
  const writing = { body: 'Other private writing remains exact', caret: { start: 3, end: 7 }, context: { kind: 'reply', topicId: 'topic' } };
  const source = { ...ask, source_ref: { kind: 'message', id: 'ask' }, author: 'owner' };
  const registry = { current: { source, editors: { reply: writing } }, sessions: new Map([['private', { editor: writing }]]),
    runtime: { current: identity.authority }, disposed: false, cancelSave() {},
    cleanup: { read: op => op({ readClass: 'background' }), foregroundListeners: new Set() },
    parkAuthority: async () => { parked++; } };
  const clock = { jobs: new Map(), next: 0, setTimeout(fn, ms) { const id = ++this.next; this.jobs.set(id, { fn, ms }); return id; }, clearTimeout(id) { this.jobs.delete(id); } };
  const states = [], calls = []; let f, parked = 0;
  const cursor = () => ({ v: 1, kind: 'checkpoint', ...bindingOf(identity), scope: { kind: 'topic', id: 'topic' }, after_seq: 0 });
  const api = { view: async (name, args) => {
    calls.push([name, structuredClone(args)]); assert.ok(calls.length < 25, 'SETUP: finite in-memory view budget');
    if (name === 'changes') return { instance_id: identity.instance_id, scope: args.scope, baseline: false,
      items: [], has_more: false, continuation: null, checkpoint: cursor(), covered_versions: { topic: 1, notebook: 0 } };
    if (name === 'topic') {
      if (denyTopic) throw Object.assign(Error('Topic denied'), { details: { error: { code: 'FORBIDDEN' } } });
      return { instance_id: identity.instance_id, topic: { id: 'topic' } };
    }
    assert.equal(name, 'source', 'SETUP: only the exact source is read'); assert.equal(args.id, 'ask');
    return sourceRead();
  } };
  const base = cardEnvironment(t, { views, registry, doc });
  const env = { ...base.env, api, topic: { id: 'topic' }, freshness: null,
    Freshness: class extends Freshness { constructor(options) { super({ ...options, timers: clock, random: () => 0, yieldRead: async () => {} }); f = this; } },
    checkedView, bindingOf, readRemoval, updateStatus: state => states.push(state), live: null,
    document: Object.assign(doc, { visibilityState: 'hidden', addEventListener() {} }), window: { addEventListener() {} },
    listAccessEpoch: 1, shell: { topicChanged() {} }, drawFeed() {}, dropCardImages() {}, settings: null,
    paintMarks() {}, changed() {}, $: id => doc.byId(id),
    checkInlineAvailability: async read => checkedView(await read('topic', { topic_id: 'topic' }), identity.instance_id),
    checkSourceAvailability: async () => {},
    learnQuestionWithdrawal() { assert.fail('SETUP: a denied source cannot supply a withdrawal body'); },
  };
  const owner = evaluate(env, learnedCode + availabilityCode + freshnessCode,
    '{ enableFreshness, isUnavailable: () => topicUnavailable }');
  owner.enableFreshness(cursor());
  f.dirty.clear(); // Ignore unrelated initial Starred discovery; these reads own only the named invalidations.
  f.visible = true;
  t.after(() => f.dispose());
  return { f, owner, states, calls, views, writing, registry, clock, parked: () => parked };
}
async function withdrawnDenied(t, thrown) {
  const answer = { instance_id: identity.instance_id, error: { code: 'FORBIDDEN', message: 'Source gone' } };
  const f = freshnessFixture(t, async () => { if (thrown) throw Object.assign(Error('Source gone'), { details: answer }); return answer; });
  const words = structuredClone({ body: f.writing.body, caret: f.writing.caret });
  f.f.invalidate('withdrawal:ask', 1); f.f.invalidate('removal:ask', 1);
  await f.f.request();
  const prefix = thrown ? 'F2' : 'F1';
  assert.equal(f.f.stopped, false, prefix + '_TOPIC: unreadable withdrawal source must not stop a readable topic');
  assert.equal(f.owner.isUnavailable(), false, prefix + '_DENIAL: source is not topic denial');
  assert.equal(f.states.some(state => state.kind === 'forbidden'), false, prefix + '_STATUS: no global unavailable status');
  assert.equal(f.views.messages.has('ask'), false, prefix + '_REMOVAL: separate terminal owner discards exact source');
  assert.equal(f.registry.current.sourceUnavailable, true, prefix + '_SOURCE: Reader retains a source-local explanation');
  assert.deepEqual({ body: f.writing.body, caret: f.writing.caret }, words, prefix + '_WRITING: private words and caret stay exact');
  assert.equal(f.f.dirty.size, 0, prefix + '_SETTLED: both named resources consumed');
}
test('151 page freshness: returned withdrawn-source denial does not deny the topic', t => withdrawnDenied(t, false));
test('151 page freshness: thrown withdrawn-source denial does not deny the topic', t => withdrawnDenied(t, true));
test('151 page freshness: source failures keep retry authority and real-topic-denial boundaries', async t => {
  const busy = freshnessFixture(t, async () => { throw Object.assign(Error('Busy'), { details: { error: { code: 'DATABASE_BUSY', retryable: true } } }); });
  busy.f.invalidate('withdrawal:ask', 1); await busy.f.request();
  assert.equal(busy.f.stopped, false, 'F3_RETRY: transient read remains retryable');
  assert.equal(busy.f.dirty.has('withdrawal:ask'), true, 'F3_RETRY: failed exact resource stays dirty');
  assert.ok(busy.states.some(x => x.kind === 'retry')); assert.equal(busy.owner.isUnavailable(), false);
  const denied = freshnessFixture(t, async () => { throw Error('Unexpected source'); }, { denyTopic: true });
  denied.f.invalidate('availability', 1); await denied.f.request();
  assert.equal(denied.f.stopped, true, 'F3_TOPIC: actual topic denial still stops freshness');
  assert.equal(denied.owner.isUnavailable(), true, 'F3_TOPIC: actual topic denial still hides the topic');
  const authority = freshnessFixture(t, async () => { throw Object.assign(Error('Authority changed'), { details: { error: { code: 'AUTHORITY_CHANGED' } } }); });
  authority.f.invalidate('withdrawal:ask', 1); await authority.f.request();
  assert.equal(authority.f.stopped, true, 'F3_AUTHORITY: authority loss still stops'); assert.equal(authority.parked(), 1);
  const gate = deferred(), stale = freshnessFixture(t, () => gate.promise);
  stale.f.invalidate('withdrawal:ask', 1); const running = stale.f.request();
  await tick();
  assert.ok(stale.calls.some(([name]) => name === 'source'), 'SETUP: obsolete-control source read actually started');
  stale.f.interrupt(); gate.resolve({ instance_id: identity.instance_id, withdrawal: { by: 'owner', at_ms: 12 } });
  await running;
  assert.equal(stale.views.messages.has('ask'), true, 'F3_STALE: obsolete read paints no terminal state');
  assert.equal(stale.owner.isUnavailable(), false, 'F3_STALE: obsolete read cannot deny topic');
});

function readerFixture(t, { loaded = true, command = async () => ({ status: 'rejected', recorded: false,
  error: { code: 'MESSAGE_SEEN', message: 'Already seen; retract instead.' } }) } = {}) {
  const r = renderer799(), doc = r.list.ownerDocument; documentFor(t, doc);
  const item = message('root', 1), source = { ...item, author: 'owner', source_ref: { kind: 'message', id: 'root' } };
  const writing = { body: 'Private reply stays exact', note: 'Private note stays exact', caret: { start: 2, end: 8 } };
  const p = { source, sourceUnavailable: false, editors: { reply: writing } };
  const views = new TopicViews({ instanceId: identity.instance_id, topicId: 'topic' });
  if (loaded) views.messagesPage(page([item]), { initial: true });
  const registry = { current: p, runtime: { current: identity.authority }, cancelSave() {}, disposed: false };
  const shell = { page: {} }, sent = [], notices = [], anchor = doc.createElement('button'); let shown;
  const base = cardEnvironment(t, { views, registry, doc });
  const env = { ...base.env, shell, topic: { id: 'topic' }, removals: null, withdrawals: null, Removals, Withdrawals,
    api: { command: async request => { sent.push(structuredClone(request)); return command(request); } },
    window: { matchMedia: () => ({ matches: false }) }, outcomeReached: false,
    editRights: () => ({ actor: 'owner', actorKind: 'human', unavailable: false, reached: false }),
    cardScroll: null, mayEdit: () => false, messageEdit: null, updateMenuItem: () => null, updateContext: () => ({}),
    removalItem, withdrawalItem, learnQuestionWithdrawal() {}, run: action => action(),
    mayStartFrom: () => false, textDisplayMenuItems: () => [],
    reader: { dialog: { open: true }, quotable: false, layoutChoice: null, notice: words => notices.push(words) },
    readerFeedItem: () => views.messages.get(registry.current?.source?.source_ref?.id) ?? null,
    openMessageMenu: options => { shown = options; }, $: () => anchor,
    attention: null, commitReload: null, status: words => notices.push(words),
  };
  const owner = evaluate(env, learnedCode + sharedCode + readerCode + removalConstruction,
    '{ openReaderMenu, control: removals }');
  return { owner, source, p, views, registry, writing, shell, sent, notices,
    choices() { owner.openReaderMenu(); return shown.items; } };
}
async function refusedReader(t, loaded) {
  const f = readerFixture(t, { loaded }), before = structuredClone(f.writing), offered = f.choices();
  const unsend = offered.filter(choice => choice.label === 'Unsend');
  assert.equal(unsend.length, 1, 'SETUP: actual Reader owner offers initial Unsend');
  await unsend[0].act();
  assert.equal(f.notices.at(-1), 'Already seen; retract instead.', 'SETUP: real controller completed the refusal branch');
  const prefix = loaded ? 'R1' : 'R2', labels = f.choices().map(choice => choice.label);
  assert.equal(f.sent.length, 1, prefix + '_COMMAND: refused Unsend never automatically retracts');
  assert.equal(f.sent[0].kind, 'message.unsend');
  assert.equal(f.source.removal_action, 'retract', prefix + '_SOURCE: actual presentation learns the refusal');
  if (loaded) assert.equal(f.views.messages.get('root').removal_action, 'retract', prefix + '_FEED: actual feed owner learns refusal');
  assert.equal(labels.filter(label => label === 'Retract').length, 1, prefix + '_MENU: next More offers Retract exactly once');
  assert.equal(labels.includes('Unsend'), false, prefix + '_MENU: next More no longer offers Unsend');
  assert.equal(f.owner.control.pending.size, 0, prefix + '_PENDING: refused operation was cleared');
  assert.deepEqual(f.writing, before, prefix + '_WRITING: reply/note/caret unchanged');
}
test('151 page Reader: refused Unsend updates the loaded source and feed owners', t => refusedReader(t, true));
test('151 page Reader: refused Unsend updates an independently opened source', t => refusedReader(t, false));
test('151 page Reader: late refusal preserves a newer source and terminal state', async t => {
  for (const variant of ['other-source', 'old-page', 'terminal']) {
    t.diagnostic('R3 variant ' + variant);
    const gate = deferred(), f = readerFixture(t, { command: () => gate.promise });
    const waiting = f.choices().find(choice => choice.label === 'Unsend').act();
    assert.equal(f.sent.length, 1, 'SETUP: actual controller request is pending');
    if (variant === 'other-source') f.registry.current = { source: { ...f.source, source_ref: { kind: 'message', id: 'other' }, body: 'Other actual source' }, editors: { reply: { body: 'Newer private writing' } } };
    if (variant === 'old-page') f.shell.page = {};
    if (variant === 'terminal') {
      f.source.removal = act; f.source.removal_action = null;
      Object.assign(f.views.messages.get('root'), { removal: act, removal_action: null });
    }
    const before = structuredClone(f.registry.current);
    gate.resolve({ status: 'rejected', recorded: false, error: { code: 'MESSAGE_SEEN', message: 'Seen' } });
    await waiting;
    assert.equal(f.notices.at(-1), variant === 'old-page' ? 'Unsending…' : 'Seen', 'SETUP: no caught fixture error masquerades as a refusal');
    assert.deepEqual(f.registry.current, before, 'R3_CURRENT: late refusal preserves newer source, terminal state and private writing');
    assert.equal(f.sent.length, 1, 'R3_COMMAND: one request only');
    if (variant === 'terminal') assert.equal(f.views.messages.get('root').removal_action, null, 'R3_TERMINAL: feed terminal state not downgraded');
  }
});
