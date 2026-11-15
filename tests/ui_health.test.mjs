// The Health page's words and the Health link (item 109, docs/health.md): what
// is red is Core's one rule (answer.red), each red thing says why in Core's
// words, and the link lights while anything is red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HealthPage, healthLines, healthProblems } from '../web/health.mjs';
import { CHECKING_WORDS, HealthLight, LIT_WORDS, UNREAD_WORDS, standing } from '../web/health-light.mjs';

const NOW = new Date(2026, 10, 7, 9, 0).getTime();
const MIN = 60 * 1000;
const runner = (state, extra = {}) => ({ live: state === 'running', state, since_ms: NOW - 30 * MIN, ...extra });
const agent = (id, extra = {}) => ({ actor_id: id, name: id, route: 'codex_queue', waiting: 0, waiting_since_ms: null, next_due_ms: null, reached_ms: NOW - 90 * MIN, ...extra });
const failing = (reason, why, extra = {}) => ({ count: 5, since_ms: NOW - 60 * MIN, outcome: 'error', reason, why, ...extra });
const answer = (extra = {}) => ({ red: [], runner: runner('running', { started_ms: NOW - 120 * MIN }), agents: [], machine: { load: [1, 1, 1], cpus: 8 }, release: null, read_ms: NOW, ...extra });

test('the runner is a problem when Core says it is red, not by its state alone', () => {
  const stopped = answer({ runner: runner('stopped') });
  assert.deepEqual(healthProblems(stopped, { now: NOW }), [], 'a stopped runner Core does not call red is said on its line only');
  assert.equal(healthLines(stopped, { now: NOW })[0].bad, false);
  const red = { ...stopped, red: ['runner'] };
  assert.match(healthProblems(red, { now: NOW })[0], /^The agent runner was stopped at .+ and has not come back, so no wakes are going out\.$/);
  assert.equal(healthLines(red, { now: NOW })[0].bad, true);
  const paused = answer({ red: ['runner'], runner: runner('paused', { reason: 'operator_pause', why: 'an operator paused it' }) });
  assert.match(healthProblems(paused, { now: NOW })[0], /because an operator paused it, so no wakes are going out\./);
});

test('an agent that cannot be woken says why, in Core\'s words, at the top and on its line', () => {
  const why = "the helper that puts a wake in the Codex app's queue failed (it exited with an error)";
  const page = answer({ red: ['failing:codex-a'], agents: [agent('codex-a', { waiting: 12, failing: failing('broker_exit', why) })] });
  const [problem] = healthProblems(page, { now: NOW });
  assert.match(problem, /^codex-a can't be woken: every wake since .+ failed \(5 times\)\. Why: the helper that puts a wake in the Codex app's queue failed \(it exited with an error\)\. 12 messages are waiting for codex-a\. Its wakes go through the Codex app's queue/);
  const line = healthLines(page, { now: NOW }).find(item => item.key === 'agent:codex-a');
  assert.equal(line.bad, true);
  assert.match(line.details[0], /^Every wake since .+ failed \(5 times\)\. Why: the helper that puts/);
  assert.doesNotMatch(healthProblems(answer({ agents: [agent('codex-a')] }), { now: NOW }).join(' '), /Why:/, 'an agent that is not failing says no why');
});

test('an agent not answering is said from Health\'s own facts, never what the scheduler will do', () => {
  const page = answer({ red: ['parked:hosted-a'], agents: [agent('hosted-a', { route: 'codex_hosted', waiting: 2, not_answering: { count: 3, since_ms: NOW - 30 * MIN } })] });
  const line = healthLines(page, { now: NOW }).find(item => item.key === 'agent:hosted-a');
  assert.equal(line.bad, true);
  assert.match(line.details[0], /^Its last 3 wakes reached it and it has not answered since .+\.$/);
  assert.doesNotMatch(line.details.join(' '), /woken only|new work/, 'the scheduler keeps its own count, so the page does not say when it wakes');
  // A turn Codex failed is a wake that did not get through, with Codex's code as why (health.py).
  const failed = answer({ red: ['failing:hosted-a'], agents: [agent('hosted-a', { route: 'codex_hosted', failing: failing('serverOverloaded', 'its Codex turn failed (server overloaded)', { outcome: 'failed', count: 3 }) })] });
  assert.match(healthProblems(failed, { now: NOW })[0], /^hosted-a can't be woken: no wake since .+ has got through \(3 times\)\. Why: its Codex turn failed \(server overloaded\)\.$/);
});

test('only a wake helper that could not start Codex or got no answer asks whether the ChatGPT app is open', () => {
  // Core says which (failing.ask_app_open); an answer from a Core that predates it asks, as before.
  const question = /look there first: is the ChatGPT app open\?/;
  const words = 'the Codex app is now version 0.167.0-alpha.3.2, but Theseus has been reviewed only with version 0.163.0-alpha.10.2: a new Codex version needs a review before wakes resume';
  const updated = answer({ red: ['failing:codex-a'], agents: [agent('codex-a', { failing: failing('codex_version:0.167.0-alpha.3.2:0.163.0-alpha.10.2', words, { ask_app_open: false }) })] });
  const [problem] = healthProblems(updated, { now: NOW });
  assert.match(problem, /Why: the Codex app is now version 0\.167\.0-alpha\.3\.2, but Theseus has been reviewed only with version 0\.163\.0-alpha\.10\.2: a new Codex version needs a review before wakes resume\.$/);
  assert.doesNotMatch(problem, question);
  const spawn = answer({ red: ['failing:codex-a'], agents: [agent('codex-a', { failing: failing('codex_spawn', 'the Codex app-server could not be started', { ask_app_open: true }) })] });
  assert.match(healthProblems(spawn, { now: NOW })[0], question);
  const older = answer({ red: ['failing:codex-a'], agents: [agent('codex-a', { failing: failing('broker_exit', 'the helper failed') })] });
  assert.match(healthProblems(older, { now: NOW })[0], question);
  const mixed = answer({ agents: [agent('a', { failing: failing('codex_spawn', 'x', { ask_app_open: true }) }), agent('b', { failing: failing('codex_spawn', 'x', { ask_app_open: false }) })] });
  assert.doesNotMatch(healthProblems(mixed, { now: NOW })[0], question, 'a group asks only when every agent in it does');
});

test('agents whose failures began together for one reason are said together; another reason is said apart', () => {
  const deadline = failing('deadline', 'the Codex app did not answer in time');
  const same = answer({ agents: [agent('a', { failing: deadline }), agent('b', { failing: { ...deadline, since_ms: deadline.since_ms + MIN } })] });
  const together = healthProblems(same, { now: NOW });
  assert.equal(together.length, 1);
  assert.match(together[0], /^a and b can't be woken: .+ Why: the Codex app did not answer in time\. Their failures began together/);
  const apart = answer({ agents: [agent('a', { failing: deadline }), agent('b', { failing: failing('broker_exit', 'the helper failed', { since_ms: deadline.since_ms + MIN }) })] });
  assert.equal(healthProblems(apart, { now: NOW }).length, 2, 'the same moment, different reasons: two causes');
});

class ClassList {
  constructor() { this.names = new Set(); }
  toggle(name, on) { if (on) this.names.add(name); else this.names.delete(name); }
  contains(name) { return this.names.has(name); }
}
const link = () => ({ classList: new ClassList(), textContent: 'Health', attributes: {},
  setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; } });

test('the Health link lights while anything is red and goes quiet when nothing is', async () => {
  let reply = { red: ['failing:codex-a'] };
  const node = link();
  const light = new HealthLight({ link: node, read: async () => reply });
  await light.load();
  assert.equal(node.textContent, LIT_WORDS);
  assert.equal(LIT_WORDS, 'Health · needs attention');
  assert.equal(node.classList.contains('red'), true);
  assert.equal(node.attributes['aria-label'], 'Health: something needs attention');
  reply = { red: [] };
  await light.load();
  assert.equal(node.textContent, 'Health');
  assert.equal(node.classList.contains('red'), false);
  assert.equal(node.attributes['aria-label'], undefined);
});

test('a link that cannot read what is red says it could not check, never quiet', async () => {
  assert.equal(UNREAD_WORDS, "Health · couldn't check");
  const unread = node => {
    assert.equal(node.textContent, UNREAD_WORDS);
    assert.equal(node.classList.contains('red'), true, 'in the alert colour: something may be red that it cannot see');
    assert.equal(node.attributes['aria-label'], 'Health: it could not be checked, so something may need attention');
  };
  // The first read fails: the link has never been told that nothing is red.
  const first = link();
  assert.equal(await new HealthLight({ link: first, read: async () => { throw new Error('Unsupported view'); } }).load(), false);
  unread(first);
  // An answer with no list of what is red is a failed read, not a quiet one.
  for (const reply of [{ instance_id: 'x' }, { error: { code: 'UNKNOWN_VIEW' } }, { red: 'runner' }, null]) {
    const node = link();
    await new HealthLight({ link: node, read: async () => reply }).load();
    unread(node);
  }
  // Quiet, then every read fails: it does not stay quiet.
  let reply = { red: [] }, fail = false;
  const node = link();
  const light = new HealthLight({ link: node, read: async () => { if (fail) throw new Error('BUSY'); return reply; } });
  assert.equal(await light.load(), true);
  assert.equal(node.textContent, 'Health');
  fail = true;
  await light.load();
  await light.load();
  unread(node);
  // Lit, then a read fails: it says it could not check, not what it last read.
  fail = false; reply = { red: ['runner'] };
  await light.load();
  assert.equal(node.textContent, LIT_WORDS);
  fail = true;
  await light.load();
  unread(node);
  // A read that answers again says what it answers.
  fail = false; reply = { red: [] };
  await light.load();
  assert.equal(node.textContent, 'Health');
  assert.equal(node.classList.contains('red'), false);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
const shown = node => [node.textContent, node.classList.contains('red')];
// A light whose reads the test answers one by one, and a feed the test moves.
function harness() {
  const answers = [], node = link();
  let feed = 'live';
  const light = new HealthLight({ link: node, feed: () => feed, read: () => new Promise((resolve, reject) => answers.push({ resolve, reject })) });
  return { light, node, answers, setFeed: state => { feed = state; } };
}

test('on a current server the link follows what is red with each commit from the feed, and reads nothing for it', async () => {
  const { light, node, answers } = harness();
  light.heard({ kind: 'state', state: 'live', seq: 4, health: { red: [], seq: 4 } });
  assert.deepEqual(shown(node), ['Health', false]);
  light.heard({ kind: 'commit', seq: 5, health: { red: ['runner'], seq: 5 } });
  assert.deepEqual(shown(node), [LIT_WORDS, true]);
  light.heard({ kind: 'commit', seq: 6, health: { red: [], seq: 6 } });
  assert.deepEqual(shown(node), ['Health', false]);
  assert.equal(answers.length, 0, 'no read');
  // What is red for another commit is not what is red for this one: it is read.
  light.heard({ kind: 'commit', seq: 7, health: { red: [], seq: 6 } });
  assert.equal(answers.length, 1);
  answers[0].resolve({ red: ['failing:a'], commit_seq: 7 });
  await tick();
  assert.deepEqual(shown(node), [LIT_WORDS, true]);
});

test('reads that each answer red, each overlapped by a commit, light the link (the reviewer\'s starved reads)', async () => {
  // A server whose feed does not say what is red: one read per commit, and
  // under load a commit lands during every read.
  const { light, node, answers } = harness();
  light.heard({ kind: 'state', state: 'live', seq: 1 });
  answers[0].resolve({ red: [], commit_seq: 1 });
  await tick();
  assert.deepEqual(shown(node), ['Health', false]);
  for (let seq = 2; seq <= 21; seq++) {
    light.heard({ kind: 'commit', seq });
    await tick();
    light.heard({ kind: 'commit', seq: seq + 100 });
    answers[answers.length - 1].resolve({ red: ['runner'], commit_seq: seq });
    await tick();
    assert.deepEqual(shown(node), [LIT_WORDS, true], `read ${seq} answered red`);
  }
  // A server that does not name the commit: the commit known when the read began.
  const old = harness();
  old.light.heard({ kind: 'commit', seq: 3 });
  old.light.heard({ kind: 'commit', seq: 4 });
  old.answers[0].resolve({ red: ['runner'] });
  await tick();
  assert.deepEqual(shown(old.node), [LIT_WORDS, true], 'taken as of the commit known when it began, and shown');
  assert.equal(old.answers.length, 2, 'then read again for the commit that came during it');
  old.answers[1].resolve({ red: [] });
  await tick();
  assert.deepEqual(shown(old.node), ['Health', false]);
});

test('an answer older than the one shown is never shown', async () => {
  const { light, node, answers } = harness();
  light.load();
  light.heard({ kind: 'commit', seq: 9, health: { red: ['runner'], seq: 9 } });
  answers[0].resolve({ red: [], commit_seq: 8 }); // read before the commit that made the runner red
  await tick();
  assert.deepEqual(shown(node), [LIT_WORDS, true]);
  assert.equal(light.best.seq, 9);
  // A read at the same commit is taken: Core settled that commit before it was read.
  light.load();
  answers[1].resolve({ red: [], commit_seq: 9 });
  await tick();
  assert.deepEqual(shown(node), ['Health', false]);
});

test('when the feed comes back, an answer from before it dropped is never shown as all clear (the reviewer\'s reconnect)', async () => {
  const { light, node, answers, setFeed } = harness();
  light.heard({ kind: 'state', state: 'live', seq: 1, health: { red: [], seq: 1 } });
  assert.deepEqual(shown(node), ['Health', false]);
  setFeed('down');
  light.heard({ kind: 'state', state: 'down' });
  assert.deepEqual([...shown(node), node.attributes['aria-label']], [UNREAD_WORDS, true, 'Health: it could not be checked, so something may need attention']);
  assert.deepEqual(healthProblems(answer(), { now: NOW, feed: 'down' }), ['This page has lost its live connection to the server, so what it shows may be out of date.'], 'and the page agrees');
  // Back on a current server: the first number says what is red at once.
  setFeed('live');
  light.heard({ kind: 'state', state: 'live', seq: 5, health: { red: ['runner'], seq: 5 } });
  light.heard({ kind: 'commit', seq: 5, health: { red: ['runner'], seq: 5 } });
  assert.deepEqual(shown(node), [LIT_WORDS, true]);
  assert.equal(answers.length, 0);
  // Back on a server whose feed does not say: not the old answer, but "checking" until a read says.
  setFeed('down'); light.heard({ kind: 'state', state: 'down' });
  setFeed('live');
  light.heard({ kind: 'state', state: 'live', seq: 8 });
  assert.deepEqual(shown(node), [CHECKING_WORDS, false], 'nothing read since it came back');
  light.heard({ kind: 'commit', seq: 8 });
  answers[0].resolve({ red: [], commit_seq: 8 });
  await tick();
  assert.deepEqual(shown(node), ['Health', false]);
  // Back with no commit missed: the answer it has is the answer at that commit.
  setFeed('down'); light.heard({ kind: 'state', state: 'down' });
  setFeed('live'); light.heard({ kind: 'state', state: 'live', seq: 8 });
  assert.deepEqual(shown(node), ['Health', false]);
  assert.equal(answers.length, 1);
  // No feed offered: reads are what the link has, as for the page, which calls that no problem.
  const none = new HealthLight({ link: link(), read: async () => ({ red: [] }) });
  await none.load();
  assert.equal(none.link.textContent, 'Health');
  assert.deepEqual(healthProblems(answer(), { now: NOW, feed: null }), []);
});

test('what the link says is one pure function of what it has', () => {
  const quiet = { seq: 5, red: [] }, lit = { seq: 5, red: ['runner'] };
  const cases = [
    [{ best: null, known: -1, floor: -1, failed: false, feed: null }, 'checking'],
    [{ best: null, known: -1, floor: -1, failed: true, feed: null }, 'unread'],
    [{ best: quiet, known: 5, floor: 5, failed: false, feed: 'down' }, 'unread'],
    [{ best: quiet, known: 5, floor: 6, failed: false, feed: 'live' }, 'checking'],
    [{ best: quiet, known: 7, floor: 5, failed: false, feed: 'live' }, 'quiet'],
    [{ best: quiet, known: 7, floor: 5, failed: true, feed: 'live' }, 'unread'],
    [{ best: quiet, known: 5, floor: 5, failed: true, feed: 'live' }, 'quiet'],
    [{ best: quiet, known: 5, floor: -1, failed: true, feed: null }, 'unread'],
    [{ best: lit, known: 5, floor: 5, failed: false, feed: 'live' }, 'lit'],
  ];
  for (const [facts, said] of cases) assert.equal(standing(facts), said, JSON.stringify(facts));
});

test('a server with no live feed says on its line what that costs', () => {
  const server = live_feed => healthLines(answer({ server: { started_ms: NOW - MIN, pid: 1, live_feed }, schema_version: '30' }), { now: NOW, feed: null }).find(item => item.key === 'server');
  assert.match(server(false).summary, /no live updates$/);
  assert.match(server(false).details[1], /^Without live updates, this page and the Health link read again only when opened or shown, and a runner that stops answering is told to the team by the next act/);
  assert.deepEqual(server(true).details, ['It serves database version 30.']);
});

test('the Mac\'s load or core count that could not be read is said, never left out or called light', () => {
  const noLoad = healthLines(answer({ machine: { load: null, cpus: 8 } }), { now: NOW }).find(item => item.key === 'machine');
  assert.ok(noLoad, 'the Mac has a line');
  assert.equal(noLoad.summary, 'Its load could not be read · 8 cores');
  assert.equal(noLoad.bad, false);
  assert.deepEqual(healthProblems(answer({ machine: { load: null, cpus: 8 } }), { now: NOW }), []);
  const noCores = healthLines(answer({ machine: { load: [9, 9, 9], cpus: null } }), { now: NOW }).find(item => item.key === 'machine');
  assert.equal(noCores.summary, 'Load 9 on a core count that could not be read · how busy is not known');
  assert.equal(noCores.bad, false);
  const missing = healthLines(answer({ machine: undefined }), { now: NOW }).find(item => item.key === 'machine');
  assert.equal(missing.summary, 'Its load could not be read · a core count that could not be read');
  const busy = healthLines(answer({ machine: { load: [9, 9, 9], cpus: 8 } }), { now: NOW }).find(item => item.key === 'machine');
  assert.deepEqual([busy.summary, busy.bad], ['Load 9 on 8 cores · overloaded', true]);
});

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.className = ''; this.dataset = {}; this.attributes = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  querySelectorAll() { return []; }
}
const texts = node => [node.textContent, ...node.children.flatMap(texts)].filter(Boolean);

test('a health answer that does not say what is red is a failed read, never "everything is working"', async () => {
  // First the answers an unchecked page would call healthy: no list of what is red, or no list of agents.
  for (const reply of [{ runner: { live: true }, agents: [] }, { red: [], runner: { live: true } }, { instance_id: 'x' }, { red: [], agents: [] }]) {
    const host = new Node('section');
    const page = new HealthPage({ host, read: async () => reply, doc: { createElement: tag => new Node(tag) } });
    assert.equal(await page.load(), false, JSON.stringify(reply));
    const said = texts(host).join(' ');
    assert.doesNotMatch(said, /Everything is working/);
    assert.match(said, /^Health could not be read/);
  }
  const host = new Node('section');
  const page = new HealthPage({ host, read: async () => answer(), doc: { createElement: tag => new Node(tag) } });
  assert.equal(await page.load(), true);
  assert.match(texts(host).join(' '), /Everything is working/);
});

test('the Health page says it is reading again, never "everything is working", from an answer older than the feed\'s return', async () => {
  const host = new Node('section'), reads = [];
  let feed = 'live';
  const page = new HealthPage({ host, feed: () => feed, read: () => new Promise(resolve => reads.push(resolve)), doc: { createElement: tag => new Node(tag) } });
  page.heard({ kind: 'state', state: 'live', seq: 3 });
  const first = page.load();
  reads[0](answer({ commit_seq: 3 }));
  await first;
  assert.match(texts(host).join(' '), /Everything is working/);
  feed = 'down'; page.heard({ kind: 'state', state: 'down' });
  assert.match(texts(host).join(' '), /lost its live connection/);
  feed = 'live'; page.heard({ kind: 'state', state: 'live', seq: 6 });
  const said = texts(host).join(' ');
  assert.doesNotMatch(said, /Everything is working/);
  assert.match(said, /reading Health again now that its live connection is back/);
  const second = page.load();
  reads[1](answer({ commit_seq: 6 }));
  await second;
  assert.match(texts(host).join(' '), /Everything is working/);
});

test('a light whose page has gone paints nothing more: the link it painted stays with the next page (item 463), so an answer still on its way to the old page never lands there', async () => {
  let answer = null;
  const node = link();
  const light = new HealthLight({ link: node, feed: () => 'live', read: () => new Promise(resolve => { answer = resolve; }) });
  const loading = light.load();
  light.stop();
  answer({ red: ['failing:codex-a'], commit_seq: 5 });
  assert.equal(await loading, true, 'the read it had out still finishes');
  assert.deepEqual(shown(node), ['Health', false], 'and its answer does not reach the link');
  light.heard({ kind: 'commit', seq: 6, health: { red: ['runner'], seq: 6 } });
  assert.deepEqual(shown(node), ['Health', false], 'nor does anything the feed says after');
  // A light still running paints as before (the negative).
  const live = new HealthLight({ link: link(), feed: () => 'live', read: async () => ({ red: [] }) });
  live.heard({ kind: 'commit', seq: 6, health: { red: ['runner'], seq: 6 } });
  assert.deepEqual(shown(live.link), [LIT_WORDS, true]);
});
