// The Health page's words and the Health link (item 109, docs/health.md): what
// is red is Core's one rule (answer.red), each red thing says why in Core's
// words, and the link lights while anything is red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HealthPage, healthLines, healthProblems } from '../web/health.mjs';
import { HealthLight, LIT_WORDS, UNREAD_WORDS } from '../web/health-light.mjs';

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

test('what the link shows is its latest read: an answer read before a newer commit is never shown', async () => {
  // Under load the server sheds the newer read while an older one, taken before
  // the commit that made something red, is still answering "nothing is red".
  const node = link(), painted = [];
  const answers = [];
  const read = () => new Promise((resolve, reject) => answers.push({ resolve, reject }));
  const light = new HealthLight({ link: node, read });
  const paint = light.paint.bind(light);
  light.paint = () => { paint(); painted.push(node.textContent); };
  const older = light.load();
  const newer = light.load(); // the red commit comes while the first read runs
  assert.equal(newer, older, 'one read at a time; the commit asks for one more');
  assert.equal(answers.length, 1, 'the newer read waits for the older');
  answers[0].resolve({ red: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(answers.length, 2, 'then reads again, after the commit');
  answers[1].reject(new Error('503 SERVER_BUSY'));
  assert.equal(await newer, false);
  assert.deepEqual(painted, [UNREAD_WORDS], 'the older quiet answer was never shown');
  assert.equal(node.classList.contains('red'), true);
  // With no commit while it reads, the answer is shown.
  const quiet = light.load();
  answers[2].resolve({ red: [] });
  assert.equal(await quiet, true);
  assert.equal(node.textContent, 'Health');
});

test('the link says it could not check while the live feed is down, as the Health page says at its top', async () => {
  let feed = 'live';
  const node = link();
  node.textContent = 'Health · checking';
  const light = new HealthLight({ link: node, read: async () => ({ red: [] }), feed: () => feed });
  feed = 'down';
  light.paint();
  assert.deepEqual([node.textContent, node.classList.contains('red')], ['Health · checking', false], 'before the first answer it says it is checking');
  await light.load();
  assert.deepEqual([node.textContent, node.classList.contains('red'), node.attributes['aria-label']],
    [UNREAD_WORDS, true, 'Health: it could not be checked, so something may need attention'], 'a quiet answer does not stand while nothing would say a change');
  assert.deepEqual(healthProblems(answer(), { now: NOW, feed }), ['This page has lost its live connection to the server, so what it shows may be out of date.'], 'and the page agrees');
  feed = 'live';
  light.paint();
  assert.deepEqual([node.textContent, node.classList.contains('red')], ['Health', false], 'back, the answer stands again');
  // A lit answer while the feed is down is not said as all clear either.
  const lit = new HealthLight({ link: link(), read: async () => ({ red: ['runner'] }), feed: () => 'down' });
  await lit.load();
  assert.equal(lit.link.textContent, UNREAD_WORDS);
  // No feed offered: reads are what the link has, as for the page, which calls that no problem.
  const none = new HealthLight({ link: link(), read: async () => ({ red: [] }) });
  await none.load();
  assert.equal(none.link.textContent, 'Health');
  assert.deepEqual(healthProblems(answer(), { now: NOW, feed: null }), []);
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
