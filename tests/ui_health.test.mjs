// The Health page's words and the Health link (item 109, docs/health.md): what
// is red is Core's one rule (answer.red), each red thing says why in Core's
// words, and the link lights while anything is red.
import test from 'node:test';
import assert from 'node:assert/strict';
import { healthLines, healthProblems } from '../web/health.mjs';
import { HealthLight, LIT_WORDS } from '../web/health-light.mjs';

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

test('a read of the light that fails keeps what the link said', async () => {
  let fail = false;
  const node = link();
  const light = new HealthLight({ link: node, read: async () => { if (fail) throw new Error('offline'); return { red: ['runner'] }; } });
  await light.load();
  fail = true;
  await light.load();
  assert.equal(node.textContent, LIT_WORDS, 'an unreadable light is not a green one');
  const fresh = link();
  await new HealthLight({ link: fresh, read: async () => ({ error: { code: 'UNKNOWN_VIEW' } }) }).load();
  assert.equal(fresh.textContent, 'Health', 'a reply with no red list lights nothing');
});
