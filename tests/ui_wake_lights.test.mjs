import test from 'node:test';
import assert from 'node:assert/strict';
import { WakeLights } from '../web/wake-lights.mjs';
import { PeoplePanel } from '../web/people.mjs';
import { readableTime } from '../web/topic-state.mjs';

class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], attributes: {}, hidden: true, textContent: '' }); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  focus() {}
  all() { return this.children.flatMap(node => node instanceof Element ? [node, ...node.all()] : []); }
  text() { return this.textContent + this.children.map(node => node instanceof Element ? node.text() : String(node)).join(''); }
}
function dom(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), activeElement: null };
  t.after(() => { globalThis.document = previous; });
}
const SINCE = Date.UTC(2026, 10, 5, 4, 23);
const answer = quiet => async () => ({ instance_id: 'i1', runner: { live: true }, quiet });

test('a parked agent\'s name says how much waits for it and since when', async () => {
  const lights = new WakeLights({ read: answer([{ actor_id: 'aim-core', waiting: 3, since_ms: SINCE, why: 'not_answering' }]) });
  assert.equal(lights.words('aim-core'), null, 'nothing is said before the wakes are read');
  await lights.load();
  assert.equal(lights.words('aim-core'), `not answering since ${readableTime(SINCE)} · 3 waiting`);
  assert.equal(lights.words('aim-ux'), null, 'an agent that answers says nothing');
});

test('while no runner sends wakes, a name says wakes are paused, not that the agent is silent', async () => {
  const lights = new WakeLights({ read: answer([{ actor_id: 'aim-core', waiting: 1, why: 'wakes_paused' }]) });
  await lights.load();
  assert.equal(lights.words('aim-core'), 'wakes paused · 1 waiting');
});

test('a light goes off when the next read no longer lists the agent', async () => {
  let quiet = [{ actor_id: 'aim-core', waiting: 2, since_ms: SINCE, why: 'not_answering' }];
  const lights = new WakeLights({ read: async () => ({ quiet }) });
  await lights.load();
  quiet = [];
  await lights.load();
  assert.equal(lights.words('aim-core'), null);
});

test('a failed read keeps what the names said, so a busy moment does not flicker them', async () => {
  let fail = false;
  const lights = new WakeLights({ read: async () => { if (fail) throw Error('busy'); return { quiet: [{ actor_id: 'aim-core', waiting: 2, since_ms: SINCE, why: 'not_answering' }] }; } });
  await lights.load();
  fail = true;
  assert.equal(await lights.load(), true, 'a light is never a reason to read the page again');
  assert.match(lights.words('aim-core'), /^not answering since /);
});

test('a team or participant chip carries its light after the name, and none without one', t => {
  dom(t);
  const host = new Element('div');
  const panel = new PeoplePanel({ host, label: 'Add', names: 'n', light: person => person.actor_id === 'aim-core' ? 'wakes paused · 1 waiting' : null });
  panel.paint([{ actor_id: 'aim-core' }, { actor_id: 'aim-ux' }], false);
  const [core, ux] = panel.chips.children;
  assert.equal(core.text(), 'aim-core · wakes paused · 1 waiting');
  assert.equal(core.all().find(node => node.className === 'wake-light')?.attributes.role, undefined);
  assert.equal(ux.text(), 'aim-ux');
});

const down = (runner, waiting = 2) => async () => ({ instance_id: 'i1', runner, quiet: [], ...(waiting ? { notice: { waiting_agents: waiting } } : {}) });

test('while wakes are not going out, an owner is told why, since when and how many agents wait', async () => {
  const cases = [
    [{ live: false, state: 'exited', reason: 'killed', since_ms: SINCE }, 2, `Wakes are not going out: the agent runner was killed at ${readableTime(SINCE)}. 2 agents have work waiting.`],
    [{ live: false, state: 'exited', reason: 'lease_lost', since_ms: SINCE }, 1, `Wakes are not going out: the agent runner lost its lease at ${readableTime(SINCE)}. 1 agent has work waiting.`],
    [{ live: false, state: 'exited', reason: 'failed', since_ms: SINCE }, 1, `Wakes are not going out: the agent runner failed at ${readableTime(SINCE)}. 1 agent has work waiting.`],
    [{ live: false, state: 'exited', reason: 'stopped_unrecorded', since_ms: SINCE }, 1, `Wakes are not going out: the agent runner stopped at ${readableTime(SINCE)}. 1 agent has work waiting.`],
    [{ live: false, state: 'stopped', since_ms: SINCE }, 3, `Wakes are not going out: the agent runner was stopped at ${readableTime(SINCE)}. 3 agents have work waiting.`],
    [{ live: false, state: 'unrenewed', since_ms: SINCE }, 1, `Wakes are not going out: the agent runner stopped answering at ${readableTime(SINCE)}. 1 agent has work waiting.`],
    [{ live: false, state: 'paused', reason: 'operator_pause' }, 1, 'Wakes are not going out: the agent runner was paused by an operator. 1 agent has work waiting.'],
    [{ live: false, state: 'paused', reason: 'cleanup_failed' }, 1, 'Wakes are not going out: the agent runner paused because a cleanup failed. 1 agent has work waiting.'],
    [{ live: false, state: 'never_run' }, 1, 'Wakes are not going out: no agent runner has run here. 1 agent has work waiting.'],
  ];
  for (const [runner, waiting, words] of cases) {
    const lights = new WakeLights({ read: down(runner, waiting) });
    assert.equal(lights.notice(), null, 'nothing is said before the wakes are read');
    await lights.load();
    assert.equal(lights.notice(), words);
  }
});

test('no notice without one from Core: a reader who owns no outcome, or nothing waiting', async () => {
  const lights = new WakeLights({ read: down({ live: false, state: 'exited', reason: 'killed', since_ms: SINCE }, 0) });
  await lights.load();
  assert.equal(lights.notice(), null);
});

test('the notice goes when wakes go out again, and a failed read keeps it', async () => {
  let runner = { live: false, state: 'stopped', since_ms: SINCE }, fail = false;
  const painted = [];
  const lights = new WakeLights({ read: async () => { if (fail) throw Error('busy'); return runner.live ? { runner, quiet: [] } : { runner, quiet: [], notice: { waiting_agents: 1 } }; },
    painted: () => painted.push(lights.notice()) });
  await lights.load();
  fail = true;
  await lights.load();
  assert.match(lights.notice(), /^Wakes are not going out/);
  fail = false; runner = { live: true };
  await lights.load();
  assert.equal(lights.notice(), null);
  assert.deepEqual(painted.map(Boolean), [true, true, false], 'each read paints what it leaves');
});
