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
const answer = quiet => async () => ({ instance_id: 'i1', wakes_live: true, quiet });

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
