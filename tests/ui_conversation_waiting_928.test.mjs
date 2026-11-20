import test from 'node:test';
import assert from 'node:assert/strict';
import { paintState } from '../web/topic-state.mjs';
import { paintSubtitle } from '../web/topic-header.mjs';
import { questionOf, TopicRail } from '../web/topic-navigation.mjs';

class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], dataset: {}, attributes: {}, classes: new Set() }); }
  get classList() { return { add: name => this.classes.add(name) }; }
  set className(value) { this.classes = new Set(value.split(' ')); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
}
function dom(t) {
  const old = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = old; });
}
const ask = (actor_id, message_id, excerpt) => ({ actor_id, message_id, by: 'asker', excerpt, since_ms: null });
const conversation = { id: 'conversation', kind: 'conversation', state: 'waiting', state_note: '', waiting_on: [],
  asks: [ask('agent', 'q-agent', 'Which build should ship?')] };

test('928 both pill hovers name the actual question; ordinary hand-set workflow keeps its note', t => {
  dom(t);
  const row = new Element('a'); paintState(row, conversation, 'owner');
  assert.match(row.children[0].title, /Which build should ship\?/);
  const subtitle = new Element('p'); paintSubtitle(subtitle, conversation, 'owner');
  assert.match(subtitle.children[0].title, /Which build should ship\?/);
  const manual = new Element('a'); paintState(manual, { state: 'waiting', waiting_on: ['agent'], state_note: 'Need a date' }, 'owner');
  assert.equal(manual.children[0].title, 'Waiting on agent · Need a date');
});

test('928 Conversation pill reaches a real question for a reader who was not asked, preferring their own ask', () => {
  assert.equal(questionOf(conversation, 'owner'), 'q-agent');
  assert.equal(questionOf({ ...conversation, asks: [...conversation.asks, ask('owner', 'q-owner', 'Which date?')] }, 'owner'), 'q-owner');
  assert.equal(questionOf({ ...conversation, kind: 'topic' }, 'owner'), null, 'ordinary topic navigation keeps its existing rule');
  assert.equal(questionOf({ ...conversation, state: 'active', asks: [] }, 'owner'), null);
  const opened = [];
  const rail = { question: () => questionOf(conversation, 'owner'), title: () => 'Conversation', open: (...args) => opened.push(args) };
  TopicRail.prototype.activate.call(rail, conversation.id, { button: 0, target: { closest: () => null }, preventDefault() {} });
  assert.deepEqual(opened, [['conversation', 'Conversation', 'q-agent']]);
});

test('928 header pill is a real question link, and a settled Conversation leaves no Waiting mark', t => {
  dom(t);
  const subtitle = new Element('p'); paintSubtitle(subtitle, conversation, 'owner');
  assert.equal(subtitle.children[0].tag, 'a');
  assert.equal(subtitle.children[0].href, '?topic=conversation&message=q-agent');
  paintSubtitle(subtitle, { ...conversation, state: 'active', asks: [] }, 'owner');
  assert.equal(subtitle.children.length, 0); assert.equal(subtitle.hidden, true);
});

test('928 a withheld question never supplies hover words', t => {
  dom(t);
  const row = new Element('a'); paintState(row, { ...conversation, asks: [{ ...conversation.asks[0], withheld: true, excerpt: 'held words' }] }, 'owner');
  assert.doesNotMatch(row.children[0].title, /held words/);
});
