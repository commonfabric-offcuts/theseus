import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicStatePanel, paintState, paintWaiting, readableTime, stateLabel } from '../web/topic-state.mjs';

class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], dataset: {}, attributes: {}, hidden: false, classes: new Set() }); }
  get classList() { return { add: name => this.classes.add(name) }; }
  set className(value) { this.classes = new Set(value.split(' ').filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  append(...nodes) { this.children.push(...nodes.map(node => typeof node === 'string' ? { text: node } : node)); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  querySelector(selector) { return this.all().find(node => node.tag === selector) ?? null; }
  all() { return this.children.flatMap(node => node instanceof Element ? [node, ...node.all()] : []); }
  get text() { return (this.textContent ?? '') + this.children.map(node => node instanceof Element ? node.text : node.text).join(''); }
  find(predicate) { return this.all().find(predicate); }
}
function dom(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = previous; });
}
const topic = (fields = {}) => ({ id: 't1', version: 4, title: 'Naming', owner_id: 'tony', creator_id: 'tony', state: 'active',
  state_note: '', state_by: null, state_ms: null, waiting_on: [], archived: false, ...fields });

test('a time reads like 7:41 AM Thu Nov 5 in the reader\'s zone', () => {
  assert.equal(readableTime(new Date(2026, 10, 5, 7, 41).getTime()), '7:41 AM Thu Nov 5');
  assert.equal(readableTime(new Date(2026, 10, 5, 17, 4).getTime()), '5:04 PM Thu Nov 5');
});

test('labels name who a topic waits on, the reader as you', () => {
  assert.equal(stateLabel(topic({ state: 'waiting', waiting_on: ['tony', 'fable'] }), 'tony'), 'Waiting on you, fable');
  assert.equal(stateLabel(topic({ state: 'waiting' }), 'tony'), 'Waiting');
  assert.equal(stateLabel(topic({ state: 'review' }), 'tony'), 'Ready for review');
  assert.equal(stateLabel(topic({ state: 'done' }), 'tony'), 'Done');
  assert.equal(stateLabel(topic({ state: 'unknown' }), 'tony'), 'Active');
});

test('a row is marked unless its topic is simply active, and marked as mine when it waits on the reader', t => {
  dom(t);
  const row = item => { const host = new Element('a'); paintState(host, item, 'tony'); return host.children.map(c => [c.className, c.textContent, c.dataset.state, c.title ?? null]); };
  assert.deepEqual(row(topic()), []);
  assert.deepEqual(row({}), []);
  assert.deepEqual(row(topic({ state: 'waiting', waiting_on: ['tony'], state_note: 'Pick one' })), [['topic-state mine', 'Waiting on you', 'waiting', 'Pick one']]);
  assert.deepEqual(row(topic({ state: 'waiting', waiting_on: ['fable'] })), [['topic-state', 'Waiting on fable', 'waiting', null]]);
  assert.deepEqual(row(topic({ state: 'done' })), [['topic-state', 'Done', 'done', null]]);
});

test('the panel line says who said it and when; only those who may change it get the form', t => {
  dom(t);
  const host = new Element('section'), sent = [];
  const panel = new TopicStatePanel({ host, reader: 'fable', send: async (...args) => { sent.push(args); return { status: 'committed', result: {} }; } });
  const said = topic({ state: 'waiting', waiting_on: ['tony'], state_note: 'Which name?', state_by: 'fable', state_ms: new Date(2026, 10, 5, 7, 41).getTime() });
  panel.paint(said, [{ actor_id: 'fable' }]);
  assert.equal(host.hidden, false);
  assert.equal(host.children[0].text, 'Waiting on tony · Which name? — you, 7:41 AM Thu Nov 5');
  const form = host.find(node => node.tag === 'details');
  assert.ok(form, 'a participant may say where it stands');
  assert.equal(host.find(node => node.id === 'topic-rename'), undefined, 'a participant who is not its creator or owner cannot rename it');
  panel.paint(said, [{ actor_id: 'someone-else' }]);
  assert.equal(host.find(node => node.tag === 'details'), undefined, 'a reader who does not work in it gets no form');
  const owner = new TopicStatePanel({ host: new Element('section'), reader: 'tony', send: async () => ({}) });
  owner.paint(said, []);
  assert.ok(owner.host.find(node => node.id === 'topic-rename'));
  assert.equal(owner.host.find(node => node.textContent === 'Archive')?.tag, 'button');
});

test('Save sends the chosen state, its note, and who it waits on only while waiting', async t => {
  dom(t);
  const host = new Element('section'), sent = [], saved = [];
  const panel = new TopicStatePanel({ host, reader: 'tony', saved: result => saved.push(result),
    send: async (current, args) => { sent.push([current.id, current.version, args]); return { status: 'committed', result: { state: args.state } }; } });
  panel.paint(topic(), []);
  const choice = host.find(node => node.id === 'topic-state-choice'), note = host.find(node => node.id === 'topic-state-note');
  const waiting = host.find(node => node.id === 'topic-state-waiting'), save = host.find(node => node.textContent === 'Save');
  choice.value = 'waiting'; choice.onchange(); note.value = 'Your call'; waiting.value = 'fable, tony, fable,';
  await save.onclick();
  choice.value = 'done'; choice.onchange(); note.value = '';
  await save.onclick();
  assert.deepEqual(sent, [['t1', 4, { state: 'waiting', note: 'Your call', waiting_on: ['fable', 'tony'] }], ['t1', 4, { state: 'done', note: '' }]]);
  assert.deepEqual(saved, [{ state: 'waiting' }, { state: 'done' }]);
});

test('a refused or failed change is shown and the panel keeps its topic', async t => {
  dom(t);
  const host = new Element('section'), answers = [{ status: 'rejected', error: { message: 'No permission for this topic' } }, Error('offline')];
  const panel = new TopicStatePanel({ host, reader: 'tony', send: async () => { const next = answers.shift(); if (next instanceof Error) throw next; return next; } });
  panel.paint(topic(), []);
  await panel.submit({ archived: true });
  assert.equal(host.find(node => node.classes.has('notice')).textContent, 'No permission for this topic');
  await panel.submit({ archived: true });
  assert.equal(host.find(node => node.classes.has('notice')).textContent, 'offline');
  assert.equal(panel.topic.id, 't1');
});

test('the waiting list names each topic, opens it, and hides when nothing waits', t => {
  dom(t);
  const host = new Element('section'), opened = [];
  paintWaiting(host, { waiting_on_me: 0, latest_waiting: [] }, () => {});
  assert.equal(host.hidden, true);
  paintWaiting(host, { waiting_on_me: 7, latest_waiting: [{ id: 't9', title: 'Naming', title_truncated: false, note: 'Pick one', state_by: 'fable', state_ms: null }] },
    (id, title) => opened.push([id, title]));
  assert.equal(host.hidden, false);
  assert.equal(host.children[0].textContent, 'Waiting on you (7, newest 1 shown)');
  const link = host.find(node => node.tag === 'a');
  assert.equal(link.href, '?topic=t9');
  let prevented = false;
  link.onclick({ button: 0, preventDefault: () => { prevented = true; } });
  link.onclick({ button: 0, metaKey: true, preventDefault: () => assert.fail('a modified click keeps the browser default') });
  assert.equal(prevented, true);
  assert.deepEqual(opened, [['t9', 'Naming']]);
  assert.equal(host.find(node => node.tag === 'li').text, 'Naming Pick one — fable');
});
