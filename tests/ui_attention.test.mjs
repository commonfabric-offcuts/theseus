import test from 'node:test';
import assert from 'node:assert/strict';
import { Attention, paintSent } from '../web/attention.mjs';
import { paintUnread } from '../web/topic-navigation.mjs';

function fixture({ permission = 'granted', hidden = true, focused = false } = {}) {
  const shown = [], answers = [], opened = [];
  class Notice { constructor(title, options) { Object.assign(this, { title, options }); shown.push(this); } close() { this.closed = true; } }
  Notice.permission = permission;
  Notice.requestPermission = async () => { Notice.permission = 'granted'; return 'granted'; };
  const doc = { title: 'Theseus', hidden, hasFocus: () => focused };
  let reads = 0;
  const api = { view: async (name, args, options) => {
    reads++; assert.equal(name, 'attention'); assert.deepEqual(args, {}); assert.equal(options.readClass, 'background');
    const next = answers.shift(); if (next instanceof Error) throw next; return next;
  } };
  const attention = new Attention({ api, instanceId: 'i1', doc, notifications: Notice, open: item => opened.push(item.topic.id), focus: () => {} });
  // A delivery's number follows its id: d3 arrived after d2.
  const item = (id, body, topic = 't1') => ({ id, seq: Number(id.slice(1)), message: { author_id: 'agent-a', body }, topic: { id: topic, title: 'Plans', title_truncated: false }, reasons: ['addressed'], topic_readable: true });
  const answer = (unread, latest) => ({ instance_id: 'i1', unread, addressed: latest.length, latest_addressed: latest });
  return { attention, doc, shown, answers, opened, Notice, item, answer, reads: () => reads };
}

test('the tab title carries the unread count and returns to its name at zero', async () => {
  const f = fixture();
  f.answers.push(f.answer(3, [])); await f.attention.refresh();
  assert.equal(f.doc.title, '(3) Theseus');
  f.answers.push(f.answer(0, [])); await f.attention.refresh();
  assert.equal(f.doc.title, 'Theseus');
});

test('only a message sent by name after the first answer raises a notification, oldest first', async () => {
  const f = fixture();
  f.answers.push(f.answer(1, [f.item('d1', 'Already waiting')])); await f.attention.refresh();
  assert.deepEqual(f.shown, [], 'what was waiting at load is not announced');
  f.answers.push(f.answer(3, [f.item('d3', 'Newest'), f.item('d2', 'Newer'), f.item('d1', 'Already waiting')])); await f.attention.refresh();
  assert.deepEqual(f.shown.map(n => [n.title, n.options.body, n.options.tag]), [['agent-a in Plans', 'Newer', 'd2'], ['agent-a in Plans', 'Newest', 'd3']]);
  f.answers.push(f.answer(3, [f.item('d3', 'Newest'), f.item('d2', 'Newer')])); await f.attention.refresh();
  assert.equal(f.shown.length, 2, 'a delivery is announced once');
  f.shown[1].onclick();
  assert.deepEqual(f.opened, ['t1']); assert.equal(f.shown[1].closed, true);
});

test('no notification while the page is in front, or without permission; the title still counts', async () => {
  for (const options of [{ hidden: false, focused: true }, { permission: 'default' }, { permission: 'denied' }]) {
    const f = fixture(options);
    f.answers.push(f.answer(0, [])); await f.attention.refresh();
    f.answers.push(f.answer(1, [f.item('d1', 'Hello')])); await f.attention.refresh();
    assert.deepEqual(f.shown, [], JSON.stringify(options));
    assert.equal(f.doc.title, '(1) Theseus');
  }
  const f = fixture({ hidden: false, focused: false });
  f.answers.push(f.answer(0, [])); await f.attention.refresh();
  f.answers.push(f.answer(1, [f.item('d1', 'Hello')])); await f.attention.refresh();
  assert.equal(f.shown.length, 1, 'a visible page in an unfocused window still announces');
});

test('a failed or malformed read keeps what is shown, and a later answer still announces what is new', async () => {
  const f = fixture();
  f.answers.push(f.answer(2, [])); await f.attention.refresh();
  f.answers.push(Error('offline')); await f.attention.refresh();
  f.answers.push({ instance_id: 'i1', unread: '5', addressed: 0, latest_addressed: [] }); await f.attention.refresh();
  f.answers.push({ instance_id: 'other', unread: 9, addressed: 0, latest_addressed: [] }); await f.attention.refresh();
  assert.equal(f.doc.title, '(2) Theseus');
  f.answers.push(f.answer(3, [f.item('d1', 'After the gap')])); await f.attention.refresh();
  assert.equal(f.shown.length, 1);
});

test('overlapping refreshes share one read and ask once more after it', async () => {
  const f = fixture();
  f.answers.push(f.answer(1, []), f.answer(2, []));
  const first = f.attention.refresh(), second = f.attention.refresh(), third = f.attention.refresh();
  assert.equal(first, second); assert.equal(second, third);
  await first;
  assert.equal(f.reads(), 2); assert.equal(f.doc.title, '(2) Theseus');
});

test('asking for permission is offered only while undecided', async () => {
  const f = fixture({ permission: 'default' });
  assert.equal(f.attention.canAsk, true);
  await f.attention.ask();
  assert.equal(f.attention.canAsk, false);
  assert.equal(new Attention({ api: {}, instanceId: 'i1', doc: { title: '' }, notifications: undefined }).canAsk, false);
});

test('a row shows its unread count, marks a count sent by name, and shows nothing at zero', t => {
  const previous = globalThis.document;
  class Element { constructor() { this.children = []; this.attributes = {}; } append(...nodes) { this.children.push(...nodes); } setAttribute(k, v) { this.attributes[k] = v; } }
  globalThis.document = { createElement: () => new Element() }; t.after(() => { globalThis.document = previous; });
  const row = item => { const host = new Element(); paintUnread(host, item); return host.children.map(c => [c.className, c.textContent, c.attributes['aria-hidden'] ?? null]); };
  assert.deepEqual(row({ unread: 4, addressed: 0 }), [['unread-count', '4', 'true'], ['sr-only', ', 4 unread', null]]);
  assert.deepEqual(row({ unread: 4, addressed: 1 }), [['unread-count addressed', '4', 'true'], ['sr-only', ', 4 unread, 1 sent to you by name', null]]);
  for (const item of [{ unread: 0, addressed: 0 }, {}, { unread: '3' }, { unread: -1 }]) assert.deepEqual(row(item), [], JSON.stringify(item));
});

test('a message that was waiting when the page opened is never announced, even when newer ones are read first', async () => {
  const f = fixture();
  const waiting = [7, 6, 5, 4, 3].map(n => f.item('d' + n, 'Named ' + n));
  f.answers.push(f.answer(7, waiting)); await f.attention.refresh();
  // The newest five are read elsewhere; the two older ones come into view.
  f.answers.push(f.answer(2, [f.item('d2', 'Named 2'), f.item('d1', 'Named 1')])); await f.attention.refresh();
  assert.deepEqual(f.shown, []);
  f.answers.push(f.answer(3, [f.item('d8', 'New'), f.item('d2', 'Named 2'), f.item('d1', 'Named 1')])); await f.attention.refresh();
  assert.deepEqual(f.shown.map(n => n.options.tag), ['d8']);
});

class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], hidden: false, disabled: false }); }
  append(...nodes) { this.children.push(...nodes.map(node => typeof node === 'string' ? { text: node } : node)); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  all() { return this.children.flatMap(node => node instanceof Element ? [node, ...node.all()] : []); }
  get text() { return (this.textContent ?? '') + this.children.map(node => node instanceof Element ? node.text : node.text).join(''); }
}

test('the sent list links a topic the reader can open, and marks read one they have lost', async t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = previous; });
  const host = new Element('section'), opened = [], acknowledged = [];
  const actions = { open: item => opened.push(item.id), acknowledge: async item => { acknowledged.push(item.id); } };
  paintSent(host, { addressed: 0, latest_addressed: [] }, actions);
  assert.equal(host.hidden, true);
  const f = fixture();
  const lost = { ...f.item('d2', 'Before you left', 't9'), topic_readable: false };
  paintSent(host, { addressed: 7, latest_addressed: [f.item('d3', 'Your call'), lost] }, actions);
  assert.equal(host.hidden, false);
  assert.equal(host.children[0].textContent, 'Sent to you by name (7, newest 2 shown)');
  const [open, closed] = host.all().filter(node => node.tag === 'li');
  const link = open.all().find(node => node.tag === 'a');
  assert.equal(link.href, '?topic=t1');
  link.onclick({ button: 0, preventDefault() {} });
  link.onclick({ button: 0, metaKey: true, preventDefault: () => assert.fail('a modified click keeps the browser default') });
  assert.deepEqual(opened, ['d3']);
  assert.equal(open.all().some(node => node.tag === 'button'), false, 'reading the open topic settles it');
  assert.equal(closed.all().some(node => node.tag === 'a'), false, 'a lost topic is not linked');
  assert.match(closed.text, /you can no longer open this topic/);
  const mark = closed.all().find(node => node.tag === 'button');
  await mark.onclick();
  assert.deepEqual(acknowledged, ['d2']);
  assert.equal(mark.disabled, false);
});
