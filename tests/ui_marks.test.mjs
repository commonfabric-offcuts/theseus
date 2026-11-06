// Marks against the real HTTP adapter and Store, with the real EditorRegistry
// opening sources; only the page's visibility, focus and recovery journal are
// stood in for. Native clicks, keys and tabs are the browser checks' part.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Api, AttemptError } from '../web/api.mjs';
import { RecoveryJournal } from '../web/journal.mjs';
import { EditorRegistry } from '../web/app-session.mjs';
import { Marks, paintAuthor, paintMarkButton, marksWords } from '../web/marks.mjs';
import { clock } from '../web/times.mjs';

const copy = value => structuredClone(value);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settled = () => new Promise(resolve => setImmediate(resolve));

// A page: visible and focused unless told otherwise. set() changes either and
// sends the event the browser would.
function page() {
  const handlers = { visibilitychange: [], focus: [] };
  const doc = { visibilityState: 'visible', focused: true, hasFocus() { return this.focused; },
    addEventListener: (name, fn) => handlers[name].push(fn) };
  const win = { addEventListener: (name, fn) => handlers[name].push(fn) };
  const set = ({ visible = doc.visibilityState === 'visible', focused = doc.focused }) => {
    const events = [...(visible !== (doc.visibilityState === 'visible') ? handlers.visibilitychange : []), ...(focused && !doc.focused ? handlers.focus : [])];
    doc.visibilityState = visible ? 'visible' : 'hidden'; doc.focused = focused;
    for (const fn of events) fn();
  };
  return { doc, win, set };
}

async function fixture(t) {
  const child = spawn('/usr/bin/python3', ['tests/fixtures/ui_http.py', '--freshness'], { cwd: new URL('..', import.meta.url) });
  let serial = 0, errors = '';
  const pending = new Map(), rows = new Map(), calls = [], recorded = [], answers = [];
  child.stderr.on('data', data => { errors += data; });
  createInterface({ input: child.stdout }).on('line', line => {
    const result = JSON.parse(line), waiter = pending.get(result.id);
    pending.delete(result.id);
    if (result.failure) waiter.reject(Error(result.failure)); else waiter.resolve(result.answer);
  });
  const exited = new Promise(resolve => child.once('exit', code => {
    for (const waiter of pending.values()) waiter.reject(Error(`HTTP fixture exited ${code}: ${errors}`));
    resolve(code);
  }));
  const control = data => new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ ...data, id }) + '\n');
  });
  let registry;
  t.after(async () => { registry?.dispose(); child.stdin.end(); assert.equal(await exited, 0, errors); });
  const facts = await control({ method: 'ready' });
  const api = new Api(facts.token, (url, init) => fetch(new URL(url, facts.origin), { ...init, headers: { ...init.headers, Origin: facts.origin } }));
  const backend = {
    put: async row => { rows.set(row.id, copy(row)); },
    get: async id => copy(rows.get(id)),
    forEditor: async key => [...rows.values()].filter(row => row.editorKey === key).map(copy),
    currentCandidates: async (key, ids) => ids.map(id => rows.get(id)).filter(row => row?.editorKey === key).map(copy),
    removeExact: async (id, stamp) => rows.get(id)?.stamp === stamp ? rows.delete(id) : false,
  };
  const transport = {
    bootstrap: options => api.bootstrap(options),
    view: (name, args, options) => { calls.push({ type: 'view', name, args: copy(args) }); return api.view(name, args, options); },
    command: envelope => { calls.push({ type: 'command', envelope: copy(envelope) }); return api.command(envelope); },
  };
  const bootstrap = await transport.bootstrap();
  registry = new EditorRegistry({ api: transport, bootstrap, journal: new RecoveryJournal(backend, 'marks-document'), saveDelayMs: 30000, maxSaveDelayMs: 60000 });
  const screen = page();
  const marks = new Marks({ api: { command: envelope => transport.command(envelope) }, instanceId: bootstrap.instance_id,
    authority: () => registry.runtime.current, cancelOpen: () => registry.cancelOpen(), recorded: receipt => { recorded.push(receipt); answers.shift()?.(receipt); },
    doc: screen.doc, win: screen.win });
  // Two messages by an agent: a person's own message is never unread for them,
  // so it offers no mark.
  const sources = [];
  for (const index of [0, 1]) sources.push({ kind: 'message', id: (await control({ method: 'agent_message', operation_id: 'marks-source-' + index,
    body: `Source ${index} by an agent. `.repeat(20), join: index === 0 })).result.message_id });
  const source = index => sources[index];
  const open = (index, act) => marks.open(registry, source(index), { topicId: facts.topic_id }, act);
  const clears = () => calls.filter(c => c.type === 'command' && c.envelope.kind === 'message.mark');
  const revision = async index => (await api.view('editor_state', { source_ref: source(index), topic_id: facts.topic_id })).mark.mark_revision;
  // The person marks a message elsewhere; this page learns it as the card would.
  const markElsewhere = async (index, operation, marked = true) => (await control({ method: 'mark', operation_id: operation, message_ids: [source(index).id], marked }))[0];
  const known = async index => { const r = await markElsewhere(index, 'known-' + index); marks.learn(r.message_id, r.mark_revision, { topicId: r.topic_id, seq: r.seq }); return r; };
  // Holds one source read's answer until released.
  const holdSource = index => {
    const entered = deferred(), release = deferred(), original = transport.view;
    transport.view = async (name, args, options) => {
      const answer = await original(name, args, options);
      if (name === 'source' && args.id === source(index).id) { transport.view = original; entered.resolve(); await release.promise; }
      return answer;
    };
    return { entered: entered.promise, release: () => release.resolve() };
  };
  // The next answer Core records to a mark this page sent.
  const answered = () => new Promise(resolve => answers.push(resolve));
  return { registry, api, transport, marks, screen, facts, calls, recorded, answered, control, source, open, clears, revision, markElsewhere, known, holdSource };
}

const receiptFor = (envelope, extra) => ({ instance_id: 'i1', operation_id: envelope.operation_id, kind: 'message.mark', affected: [], ...extra });
function offline(commands) {
  const sent = [];
  const marks = new Marks({ api: { command: async envelope => { sent.push(envelope); return commands.shift()(envelope); } },
    instanceId: 'i1', authority: () => authority, doc: null, win: null });
  let authority = { authority_id: 'a1', authority_epoch: 'e1' };
  return { marks, sent, setAuthority: value => { authority = value; } };
}

test('a mark sent again after a lost answer is the same envelope, and a recorded answer retires it', async () => {
  const committed = envelope => receiptFor(envelope, { status: 'committed', recorded: true,
    result: { message_id: 'm1', topic_id: 't1', seq: 4, marked: true, mark_revision: 1, changed: true } });
  const f = offline([() => { throw new AttemptError('Connection interrupted.'); },
    envelope => receiptFor(envelope, { status: 'retryable', recorded: false, error: { code: 'DATABASE_BUSY', retryable: true } }),
    committed, committed]);
  await assert.rejects(f.marks.send('m1', true, 0), /Connection interrupted/);
  await f.marks.send('m1', true, 0);
  await f.marks.send('m1', true, 0);
  assert.deepEqual(f.sent[1], f.sent[0], 'kept after a transport throw');
  assert.deepEqual(f.sent[2], f.sent[0], 'kept after an answer Core did not record');
  assert.deepEqual(f.sent[0], { v: 1, instance_id: 'i1', operation_id: f.sent[0].operation_id, kind: 'message.mark', target: { message_id: 'm1' },
    expected: { mark_revision: 0, authority: { authority_id: 'a1', authority_epoch: 'e1' } }, args: { marked: true } });
  assert.deepEqual(f.marks.state('m1'), { marked: true, mark_revision: 1 }, 'the receipt is learned');
  await f.marks.send('m1', true, 0);
  assert.notEqual(f.sent[3].operation_id, f.sent[0].operation_id, 'dropped once Core recorded an answer');
});

test('a mark under another authority is a new envelope', async () => {
  const lost = () => { throw new AttemptError('Connection interrupted.'); };
  const f = offline([lost, lost]);
  await assert.rejects(f.marks.send('m1', true, 0));
  f.setAuthority({ authority_id: 'a1', authority_epoch: 'e2' });
  await assert.rejects(f.marks.send('m1', true, 0));
  assert.notEqual(f.sent[1].operation_id, f.sent[0].operation_id);
  assert.deepEqual(f.sent[1].expected.authority, { authority_id: 'a1', authority_epoch: 'e2' });
});

test('a clear at a newer revision is its own envelope, never the lost one at an older revision', async () => {
  const lost = () => { throw new AttemptError('Connection interrupted.'); };
  const f = offline([lost, lost]);
  await assert.rejects(f.marks.send('m1', false, 1));
  await assert.rejects(f.marks.send('m1', false, 3));
  assert.notEqual(f.sent[1].operation_id, f.sent[0].operation_id);
  assert.deepEqual(f.sent.map(envelope => envelope.expected.mark_revision), [1, 3]);
});

test('a refused mark adopts the revision Core names and is announced like a committed one', async () => {
  const f = offline([envelope => receiptFor(envelope, { status: 'rejected', recorded: true,
    error: { code: 'REVISION_CONFLICT', message: 'changed', retryable: false, current_versions: { mark_revision: 3 } } })]);
  const announced = [];
  f.marks.recorded = receipt => announced.push(receipt.error.code);
  f.marks.learn('m1', 1);
  await f.marks.send('m1', false, 1);
  assert.deepEqual(f.marks.state('m1'), { marked: true, mark_revision: 3 });
  assert.deepEqual(announced, ['REVISION_CONFLICT']);
});

test('the highest revision wins, whatever order the answers come in', () => {
  const { marks } = offline([]);
  marks.learn('m1', 3, { topicId: 't1', seq: 2 }); marks.learn('m1', 2); marks.learn('m1', 1);
  assert.deepEqual(marks.state('m1'), { marked: true, mark_revision: 3 });
  marks.learn('m1', 4);
  assert.deepEqual(marks.state('m1'), { marked: false, mark_revision: 4 });
  assert.deepEqual(marks.marked('t1'), []);
});

test('marks load reads every page, drops a mark no longer listed, and keeps one learned while it read', async () => {
  const { marks } = offline([]);
  marks.learn('gone', 1, { topicId: 't1', seq: 1 });
  marks.learn('elsewhere', 1, { topicId: 't2', seq: 1 });
  const reads = [], gate = deferred();
  const item = (id, seq, mark_revision = 1) => ({ message_id: id, seq, mark_revision });
  const pages = [{ instance_id: 'i1', topic_id: 't1', items: [item('a', 3), item('b', 5)], next_cursor: 5 },
    { instance_id: 'i1', topic_id: 't1', items: [item('c', 9, 3)], next_cursor: null }];
  const read = async args => { reads.push(args); if (reads.length === 2) await gate.promise; return pages.shift(); };
  const loading = marks.load('t1', read);
  await settled();
  // Marked here while the read was on its way: the read cannot know it.
  marks.learn('late', 1, { topicId: 't1', seq: 7 });
  gate.resolve();
  assert.equal(await loading, true);
  assert.deepEqual(reads, [{ topic_id: 't1', limit: 50 }, { topic_id: 't1', limit: 50, cursor: 5 }]);
  assert.deepEqual(marks.marked('t1').map(m => [m.messageId, m.seq, m.revision]), [['a', 3, 1], ['b', 5, 1], ['late', 7, 1], ['c', 9, 3]]);
  assert.deepEqual(marks.state('gone'), { marked: false, mark_revision: 2 }, 'cleared since: at least one revision on');
  assert.deepEqual(marks.state('elsewhere'), { marked: true, mark_revision: 1 }, 'another topic is left alone');
  assert.equal(await marks.load('t1', async () => ({ instance_id: 'i1', topic_id: 't1', items: [item('x', 2), item('y', 2)], next_cursor: null })), false,
    'a page out of order is refused');
});

test('a card or Read it clears the mark at the revision the page knew when the person acted', async t => {
  const f = await fixture(t);
  const mark = await f.known(1);
  const act = f.marks.capture(mark.message_id);
  assert.deepEqual(act, { messageId: mark.message_id, revision: 1 });
  const answered = f.answered(), p = await f.open(1, act);
  assert.equal(p.mark.marked, true);
  assert.deepEqual(f.clears().map(c => [c.envelope.args.marked, c.envelope.expected.mark_revision]), [[false, 1]]);
  assert.equal((await answered).status, 'committed');
  assert.deepEqual(f.marks.state(mark.message_id), { marked: false, mark_revision: 2 });
  assert.equal(await f.revision(1), 2);
  assert.equal(f.recorded.length, 1, 'the page is told to refresh what it shows');
});

test('an open that is not a reading open, or one whose page knew of no mark, clears nothing', async t => {
  const f = await fixture(t);
  const mark = await f.known(1);
  await f.open(1, null);
  // Marked elsewhere, unknown to this page: editor_state says marked, but the act saw nothing.
  await f.markElsewhere(0, 'unseen');
  assert.equal(f.marks.capture(f.source(0).id), null);
  const p = await f.open(0, f.marks.capture(f.source(0).id));
  assert.equal(p.mark.marked, true);
  await settled();
  assert.deepEqual(f.clears(), []);
  assert.equal(await f.revision(1), mark.mark_revision);
  assert.equal(await f.revision(0), 1);
});

for (const when of ['before editor_state answers', 'after editor_state answered']) {
  test(`a mark renewed while the open is under way survives (${when})`, async t => {
    const f = await fixture(t);
    const mark = await f.known(1), act = f.marks.capture(mark.message_id), answered = f.answered();
    let opening;
    if (when === 'before editor_state answers') {
      const entered = deferred(), release = deferred(), original = f.transport.view;
      f.transport.view = async (name, args, options) => {
        if (name === 'editor_state') { f.transport.view = original; entered.resolve(); await release.promise; }
        return original(name, args, options);
      };
      opening = f.open(1, act); await entered.promise;
      await f.markElsewhere(1, 'renewed');
      release.resolve();
    } else {
      const held = f.holdSource(1);
      opening = f.open(1, act); await held.entered;
      await f.markElsewhere(1, 'renewed');
      held.release();
    }
    const p = await opening;
    if (when === 'before editor_state answers') assert.equal(p.mark.mark_revision, 3, 'the open saw the renewal');
    assert.equal((await answered).error?.code, 'REVISION_CONFLICT');
    // Nothing follows the refusal: the page never retries at a newer fence.
    await settled();
    assert.deepEqual(f.clears().map(c => c.envelope.expected.mark_revision), [1], 'fenced on the act, not the answer, and sent once');
    assert.equal(await f.revision(1), 3, 'the newer reminder stays');
    assert.deepEqual(f.marks.state(mark.message_id), { marked: true, mark_revision: 3 });
  });
}

for (const [name, interrupt] of [
  ['a newer open supersedes it', f => f.open(0, null)],
  ['the Reader is closed', f => f.registry.close(f.registry.current, { explicit: true })],
  ['Escape cancels it before the Reader shows', f => { assert.equal(f.registry.cancelOpen(), true); }],
  ['the page leaves', f => { f.marks.leave(); }],
]) {
  test(`no clear when ${name} while the source is read`, async t => {
    const f = await fixture(t);
    if (name === 'the Reader is closed') await f.open(0, null);
    const mark = await f.known(1), held = f.holdSource(1);
    const opening = f.open(1, f.marks.capture(mark.message_id));
    await held.entered;
    await interrupt(f);
    held.release();
    assert.equal(await opening, null, 'the open was dropped');
    await settled();
    assert.deepEqual(f.clears(), []);
    assert.equal(await f.revision(1), 1);
  });
}

test('no clear when the source is unavailable', async t => {
  const f = await fixture(t);
  // Writing kept for the source is what lets an unavailable source open.
  const first = await f.open(1, null), editor = first.editors.reply;
  editor.edit({ body: 'Kept' }); await f.registry.edited(editor); await f.registry.flush(editor);
  await f.open(0, null);
  const mark = await f.known(1), view = f.transport.view;
  f.transport.view = async (name, args, options) => {
    if (name === 'source' && args.id === f.source(1).id) return { instance_id: f.facts.instance_id, error: { code: 'FORBIDDEN', message: 'Gone' } };
    const answer = await view(name, args, options);
    if (name === 'editor_state' && args.source_ref.id === f.source(1).id) answer.source_available = false;
    return answer;
  };
  const p = await f.open(1, f.marks.capture(mark.message_id));
  assert.equal(p.sourceUnavailable, true); assert.equal(p.mark.marked, true);
  await settled();
  assert.deepEqual(f.clears(), []);
});

test('a page in the background clears when shown, and only while that open is still shown', async t => {
  const f = await fixture(t);
  const mark = await f.known(1);
  f.screen.set({ visible: false });
  await f.open(1, f.marks.capture(mark.message_id));
  assert.deepEqual(f.clears(), [], 'hidden: waits');
  f.screen.set({ visible: true, focused: false });
  assert.deepEqual(f.clears(), [], 'shown but without focus: still waits');
  const answered = f.answered();
  f.screen.set({ focused: true });
  assert.deepEqual(f.clears().map(c => c.envelope.expected.mark_revision), [1], 'sent in front, at the revision captured before the wait');
  assert.equal((await answered).status, 'committed');
  assert.equal(await f.revision(1), 2);

  const again = await f.markElsewhere(1, 'again');
  f.marks.learn(again.message_id, again.mark_revision);
  f.screen.set({ focused: false });
  await f.open(1, f.marks.capture(again.message_id));
  await f.registry.close(f.registry.current, { explicit: true });
  f.screen.set({ focused: true });
  await settled();
  assert.equal(f.clears().length, 1, 'the Reader closed while away: nothing is sent');
  assert.equal(await f.revision(1), 3);
});

test('a page that leaves drops the clear waiting for it to be shown', async t => {
  const f = await fixture(t);
  const mark = await f.known(1);
  f.screen.set({ visible: false });
  await f.open(1, f.marks.capture(mark.message_id));
  f.marks.leave();
  f.screen.set({ visible: true });
  await settled();
  assert.deepEqual(f.clears(), []);
  assert.equal(await f.revision(1), 1);
});

test('the Reader button names the state and is pressed while marked', () => {
  const button = { hidden: false, textContent: '', attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; } };
  paintMarkButton(button, { marked: false, mark_revision: 2, busy: false });
  assert.deepEqual([button.hidden, button.textContent, button.attributes], [false, 'Mark unread', { 'aria-pressed': 'false' }]);
  paintMarkButton(button, { marked: true, mark_revision: 3, busy: true });
  assert.deepEqual([button.hidden, button.textContent, button.attributes], [false, 'Marked unread', { 'aria-pressed': 'true', 'aria-disabled': 'true' }]);
  paintMarkButton(button, null);
  assert.equal(button.hidden, true);
  assert.deepEqual([marksWords(1), marksWords(3)], ['1 message marked unread', '3 messages marked unread']);
});

test('a card\'s Unread pill keeps the name\'s last character with it, and leaves with the mark', t => {
  const previous = globalThis.document;
  class Node {
    constructor(tag) { Object.assign(this, { tag, children: [], dataset: {}, attributes: {} }); }
    append(...nodes) { this.children.push(...nodes.map(node => typeof node === 'string' ? { nodeType: 3, data: node } : node)); }
    replaceChildren() { this.children = []; }
    setAttribute(k, v) { this.attributes[k] = v; }
  }
  globalThis.document = { createElement: tag => new Node(tag) };
  t.after(() => { globalThis.document = previous; });
  const author = new Node('span');
  const shape = () => author.children.map(child => child.nodeType === 3 ? child.data
    : [child.className, ...child.children.map(c => c.nodeType === 3 ? c.data : [c.className, c.textContent ?? c.children.map(x => x.data).join(''), c.attributes['aria-hidden'] ?? null])]);
  const now = clock.now; t.after(() => { clock.now = now; });
  clock.now = () => new Date(2026, 10, 5, 18, 0).getTime();
  const sent = new Date(2026, 10, 5, 15, 4).getTime();
  paintAuthor(author, 'agent-👨‍👩‍👧', sent, true);
  assert.deepEqual(shape(), [['author-name author-name-start', 'agent-'], ['together', ['author-name author-name-end', '👨‍👩‍👧', null], ['unread-mark', 'Unread', 'true'], ['sr-only', ', marked unread', null]], ['message-time', ' · ', [undefined, '3:04 PM', null]]]);
  const time = author.children[2].children[1];
  assert.deepEqual([time.tag, time.title, time.dataset.ms], ['time', '3:04 PM Thu Nov 5', String(sent)], 'sent today: the time alone, its title dated');
  paintAuthor(author, 'agent-👨‍👩‍👧', sent, false);
  assert.deepEqual(shape(), [['author-name', 'agent-👨‍👩‍👧'], ['message-time', ' · ', [undefined, '3:04 PM', null]]]);
  // Painted again the next day, the same card says it was yesterday.
  clock.now = () => new Date(2026, 10, 6, 0, 1).getTime();
  paintAuthor(author, 'agent-👨‍👩‍👧', sent, false);
  assert.equal(author.children[1].children[1].textContent, 'Yesterday 3:04 PM');
  paintAuthor(author, 'alice', null, true);
  assert.deepEqual(shape(), [['author-name author-name-start', 'alic'], ['together', ['author-name author-name-end', 'e', null], ['unread-mark', 'Unread', 'true'], ['sr-only', ', marked unread', null]]]);
});

test('a superseded open cannot discard the current reading open deferred until focus', async t => {
  const f = await fixture(t);
  const first = await f.known(0), second = await f.known(1);
  const held = f.holdSource(0);
  const openingA = f.open(0, f.marks.capture(first.message_id));
  await held.entered;
  const openingB = f.open(1, f.marks.capture(second.message_id));
  f.screen.set({ visible: false, focused: false });
  const p = await openingB;
  assert.equal(f.registry.current, p);
  assert.ok(f.marks.deferred, 'the successful current open is waiting for visibility');
  held.release();
  assert.equal(await openingA, null, 'the stale source answer does not present A');
  f.screen.set({ visible: true, focused: true });
  await settled();
  assert.deepEqual(f.clears().map(c => [c.envelope.target.message_id, c.envelope.expected.mark_revision]),
    [[second.message_id, second.mark_revision]], 'the current message must clear when it is shown');
});
