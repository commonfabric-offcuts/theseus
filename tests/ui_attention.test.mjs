import test from 'node:test';
import assert from 'node:assert/strict';
import { Attention, paintSent } from '../web/attention.mjs';
import { paintUnread } from '../web/topic-navigation.mjs';

function fixture({ permission = 'granted', hidden = true, focused = false, after } = {}) {
  const shown = [], answers = [], opened = [];
  class Notice { constructor(title, options) { Object.assign(this, { title, options }); shown.push(this); } close() { this.closed = true; } }
  Notice.permission = permission;
  Notice.requestPermission = async () => { Notice.permission = 'granted'; return 'granted'; };
  const doc = { title: 'Theseus', hidden, hasFocus: () => focused };
  let reads = 0;
  const api = { view: async (name, args, options) => {
    reads++; assert.equal(name, 'attention'); assert.deepEqual(args, {}); assert.equal(options.readClass, 'foreground');
    const next = answers.shift(); if (next instanceof Error) throw next; return next;
  } };
  const attention = new Attention({ api, instanceId: 'i1', after, doc, notifications: Notice, open: item => opened.push(item.topic.id), focus: () => {} });
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

test('with the starting number from bootstrap, a failed first read never folds a later delivery into the start', async () => {
  const f = fixture({ after: 5 });
  f.answers.push(Error('busy')); await f.attention.refresh();
  f.answers.push(f.answer(2, [f.item('d7', 'Arrived after the page opened'), f.item('d5', 'Already waiting'), f.item('d4', 'Older')]));
  await f.attention.refresh();
  assert.deepEqual(f.shown.map(n => n.options.tag), ['d7'], 'only what arrived after the page opened is announced');
  const plain = fixture({ after: 'five' });
  plain.answers.push(plain.answer(1, [plain.item('d7', 'Waiting')])); await plain.attention.refresh();
  assert.deepEqual(plain.shown, [], 'without a usable starting number the first answer stands in');
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

test('a count keeps only the title\'s last character with it, a whole grapheme, so the rest of the title still wraps', t => {
  const previous = globalThis.document;
  class Node { constructor(tag) { Object.assign(this, { tag, children: [] }); } append(...nodes) { this.children.push(...nodes.map(node => typeof node === 'string' ? { nodeType: 3, data: node } : node)); }
    get lastChild() { return this.children.at(-1) ?? null; } setAttribute() {} }
  globalThis.document = { createElement: tag => new Node(tag) };
  t.after(() => { globalThis.document = previous; });
  const row = title => {
    const host = new Node('a'); host.append(title); paintUnread(host, { unread: 2, addressed: 0 });
    const together = host.children.at(-1);
    return [host.children[0].data, together.className, together.children[0].data, together.children[1].className];
  };
  assert.deepEqual(row('Plan at https://example.com/a-very-long-path  '), ['Plan at https://example.com/a-very-long-pat', 'together', 'h', 'unread-count']);
  assert.deepEqual(row('Family 👨‍👩‍👧'), ['Family ', 'together', '👨‍👩‍👧', 'unread-count']);
  assert.deepEqual(row('Café'.normalize('NFD')), ['Caf', 'together', 'e\u0301', 'unread-count']);
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

// A node knows its parent, as in a page: one appended elsewhere moves there,
// and the page's focus is lost when its node leaves the page.
class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], hidden: false, disabled: false, parent: null }); }
  // As a browser does, disabling the focused control drops its focus.
  get disabled() { return this.off; }
  set disabled(value) { this.off = value; if (value && globalThis.document?.focused === this) globalThis.document.focused = null; }
  append(...nodes) {
    for (const node of nodes) {
      if (node instanceof Element) { node.leave(); node.parent?.children.splice(node.parent.children.indexOf(node), 1); node.parent = this; }
      this.children.push(typeof node === 'string' ? { text: node } : node);
    }
  }
  replaceChildren(...nodes) { for (const node of this.children) if (node instanceof Element) { node.leave(); node.parent = null; } this.children = []; this.append(...nodes); }
  leave() { for (let at = globalThis.document.focused; at; at = at.parent) if (at === this) globalThis.document.focused = null; }
  get isConnected() { return this.root || Boolean(this.parent?.isConnected); }
  setAttribute(name, value) { (this.attributes ??= {})[name] = String(value); }
  getAttribute(name) { return this.attributes?.[name] ?? null; }
  removeAttribute(name) { delete this.attributes?.[name]; }
  focus() { globalThis.document.focused = this; globalThis.document.moves = (globalThis.document.moves ?? 0) + 1; }
  contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
  closest(tag) { for (let at = this; at; at = at.parent) if (at.tag === tag) return at; return null; }
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
  const mark = closed.all().find(node => node.tag === 'button' && node.textContent === 'Mark read');
  await mark.onclick();
  assert.deepEqual(acknowledged, ['d2']);
  assert.equal(mark.getAttribute('aria-disabled'), null, 'it is free again once the mark is settled');
});

test('a message in a topic the reader has lost can be read whole where it is listed, and stays read across repaints', async t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = previous; });
  const f = fixture();
  const lost = { ...f.item('d2', 'The start of a long message', 't9'), topic_readable: false, source_ref: { kind: 'message', id: 'm-2' } };
  lost.message = { ...lost.message, id: 'm-2', preview: true };
  const kept = f.item('d3', 'Your call');
  const answer = { addressed: 2, latest_addressed: [kept, lost] };
  let settle, reads = 0;
  const shown = [];
  const actions = {
    open() {}, acknowledge: async () => {},
    read: item => { reads++; assert.deepEqual(item.source_ref, { kind: 'message', id: 'm-2' }); return new Promise(resolve => { settle = resolve; }); },
    attachment: (attachment, sourceRef) => { shown.push([attachment.id, sourceRef.id]); return new Element('span'); },
  };
  const host = new Element('section');
  const closed = () => host.all().filter(node => node.tag === 'li')[1];
  const button = name => closed().all().find(node => node.tag === 'button' && node.textContent === name);
  paintSent(host, answer, actions);
  assert.equal(host.all().filter(node => node.tag === 'li')[0].all().some(node => node.textContent === 'Read it here'), false,
    'a topic the reader can open is read there, not here');
  const pressed = button('Read it here').onclick();
  assert.equal(button('Read it here'), undefined, 'while it reads, the button says so');
  button('Reading…').onclick();
  assert.equal(reads, 1, 'a second press while reading asks nothing more');
  paintSent(host, answer, actions);
  button('Reading…').onclick();
  assert.equal(reads, 1, 'nor does a press on the button drawn again while reading');
  settle({ body: 'The start of a long message, and all the rest of it', source_ref: { kind: 'message', id: 'm-2' }, attachments: [{ id: 'media-1', name: 'plan.png' }] });
  await pressed;
  assert.match(closed().text, /all the rest of it/);
  assert.equal(button('Read it here'), undefined);
  assert.ok(button('Mark read'), 'it can still be marked read');
  assert.deepEqual(shown, [['media-1', 'm-2']], 'each attachment is offered from the message source');
  paintSent(host, answer, actions);
  assert.match(closed().text, /all the rest of it/, 'a repaint keeps the whole message shown');
  paintSent(host, { addressed: 1, latest_addressed: [kept] }, actions);
  paintSent(host, answer, actions);
  assert.ok(button('Read it here'), 'once no longer listed it is forgotten');
  const failing = { ...actions, read: async () => { throw Error('No readable source'); } };
  paintSent(host, answer, failing);
  await button('Read it here').onclick();
  assert.match(closed().text, /No readable source/, 'a refused read says why');
  assert.ok(button('Read it here'), 'and can be tried again');
  const other = { ...actions, read: async () => ({ body: 'Another message', source_ref: { kind: 'message', id: 'm-9' }, attachments: [] }) };
  paintSent(host, answer, other);
  await button('Read it here').onclick();
  assert.match(closed().text, /could not be confirmed/, 'an answer for another message is refused');
  assert.doesNotMatch(closed().text, /Another message/);
  paintSent(host, answer, actions);
  const retried = button('Read it here').onclick();
  assert.doesNotMatch(closed().text, /could not be confirmed|No readable source/, 'a new try clears at once what the last one said');
  settle({ body: 'All of it at last', source_ref: { kind: 'message', id: 'm-2' }, attachments: [] });
  await retried;
  assert.match(closed().text, /All of it at last/);
  assert.doesNotMatch(closed().text, /could not be confirmed/, 'and a read that succeeds says nothing more');
});

test('a read survives the list being drawn again, keeps its focus, and ends on the row now shown', async t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), focused: null, get activeElement() { return this.focused?.isConnected ? this.focused : null; } };
  t.after(() => { globalThis.document = previous; });
  const f = fixture();
  const lost = { ...f.item('d2', 'The start', 't9'), topic_readable: false, source_ref: { kind: 'message', id: 'm-2' } };
  lost.message = { ...lost.message, id: 'm-2', preview: true };
  const answer = { addressed: 1, latest_addressed: [lost] };
  const later = { addressed: 2, latest_addressed: [f.item('d5', 'Newer'), lost] };
  let settle;
  const notices = [], controls = [];
  const actions = {
    open() {}, acknowledge: async () => {},
    read: () => new Promise(resolve => { settle = resolve; }),
    attachment: (attachment, sourceRef, notice) => {
      notices.push(notice);
      const control = new Element('span'); control.append(Object.assign(new Element('button'), { textContent: `Open ${attachment.name}` }));
      controls.push(control); return control;
    },
  };
  const host = new Element('section'); host.root = true;
  const closed = () => host.all().filter(node => node.tag === 'li').at(-1);
  const button = name => closed().all().find(node => node.tag === 'button' && node.textContent === name);
  paintSent(host, answer, actions);
  button('Read it here').focus();
  const pressed = button('Read it here').onclick();
  assert.equal(document.activeElement, button('Reading…'), 'pressing keeps focus on the button');
  paintSent(host, later, actions);
  assert.equal(document.activeElement, button('Reading…'), 'the button drawn again takes the focus');
  settle({ body: 'The start, and the whole rest', source_ref: { kind: 'message', id: 'm-2' }, attachments: [{ id: 'media-1', name: 'plan.txt' }, { id: 'media-2', name: 'notes.txt' }] });
  await pressed;
  assert.match(closed().text, /the whole rest/, 'the row on the page shows the whole message');
  assert.equal(document.activeElement, button('Mark read'), 'focus moves on to Mark read');
  assert.equal(host.text.includes('Newer'), true, 'the list it ended on is the latest one');
  const opened = controls[0].children[0];
  opened.focus();
  paintSent(host, later, actions);
  assert.equal(controls.length, 2, 'each attachment control is made once');
  assert.equal(closed().all().includes(opened), true, 'and is kept, with whatever it opened');
  assert.equal(document.activeElement, opened, 'keeping its focus');
  notices[0]('This attachment is unavailable.');
  notices[1]('This attachment is unavailable.');
  assert.match(closed().text, /plan\.txt: This attachment is unavailable\. notes\.txt: This attachment is unavailable\./, 'each attachment\'s refusal is said on its row, by name');
  notices[1]('');
  notices[0]('The attachment could not be read');
  assert.match(closed().text, /The attachment could not be read/);
  notices[1]('');
  assert.match(closed().text, /could not be read/, 'another attachment opening leaves it said');
  notices[0]('');
  assert.doesNotMatch(closed().text, /could not be read/, 'and it is gone once its own attachment opens');
  // Focus elsewhere on the page stays there.
  const outside = new Element('input'); outside.root = true; outside.focus();
  const moves = document.moves;
  paintSent(host, later, actions);
  assert.equal(document.activeElement, outside);
  assert.equal(document.moves, moves, 'and the paint moves no focus');
});

test('a read that ends after its message has left the list draws nothing back', async t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag) };
  t.after(() => { globalThis.document = previous; });
  const f = fixture();
  const lost = { ...f.item('d2', 'The start', 't9'), topic_readable: false, source_ref: { kind: 'message', id: 'm-2' } };
  lost.message = { ...lost.message, id: 'm-2', preview: true };
  let settle, offered = 0;
  const actions = { open() {}, acknowledge: async () => {}, read: () => new Promise(resolve => { settle = resolve; }), attachment: () => { offered++; return new Element('span'); } };
  const host = new Element('section');
  paintSent(host, { addressed: 1, latest_addressed: [lost] }, actions);
  const pressed = host.all().find(node => node.textContent === 'Read it here').onclick();
  paintSent(host, { addressed: 0, latest_addressed: [] }, actions);
  settle({ body: 'The whole', source_ref: { kind: 'message', id: 'm-2' }, attachments: [{ id: 'media-1' }] });
  await pressed;
  assert.equal(host.hidden, true);
  assert.deepEqual(host.children, [], 'the emptied list stays empty');
  assert.equal(offered, 0, 'and its attachments are not offered');
  paintSent(host, { addressed: 1, latest_addressed: [lost] }, actions);
  assert.ok(host.all().some(node => node.textContent === 'Read it here'), 'listed again, it starts afresh');
});

test('a row that leaves the list hands its focus to the row now in its place, or else the one before', async t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), focused: null, get activeElement() { return this.focused?.isConnected ? this.focused : null; } };
  t.after(() => { globalThis.document = previous; });
  const f = fixture();
  const lost = (id, body) => { const item = { ...f.item(id, body, 't9'), topic_readable: false, source_ref: { kind: 'message', id: 'm-' + id } }; item.message = { ...item.message, id: 'm-' + id }; return item; };
  const [a, b, c] = [lost('d1', 'First'), lost('d2', 'Second'), lost('d3', 'Third')];
  const actions = { open() {}, acknowledge: async () => {}, read: async () => {}, attachment: () => new Element('span') };
  const host = new Element('section'); host.root = true;
  const control = (body, text) => host.all().find(node => node.tag === 'li' && node.text.includes(body)).all().find(node => node.textContent === text);
  // Pressing Mark read marks it busy while the list is read again without it.
  actions.acknowledge = async () => { paintSent(host, { addressed: 2, latest_addressed: [a, c] }, actions); };
  paintSent(host, { addressed: 3, latest_addressed: [a, b, c] }, actions);
  control('Second', 'Mark read').focus();
  const pressed = control('Second', 'Mark read');
  const settled = pressed.onclick();
  assert.equal(pressed.onclick(), undefined, 'a second press while busy does nothing');
  await settled;
  assert.equal(globalThis.document.activeElement, control('Third', 'Read it here'), 'the row now in its place');
  control('Third', 'Mark read').focus();
  paintSent(host, { addressed: 1, latest_addressed: [a] }, actions);
  assert.equal(globalThis.document.activeElement, control('First', 'Read it here'), 'the last row gives way to the one before');
  // Focus elsewhere on the page stays where it is when a row leaves.
  const outside = new Element('input'); outside.root = true; outside.focus();
  const moves = globalThis.document.moves;
  paintSent(host, { addressed: 0, latest_addressed: [] }, actions);
  paintSent(host, { addressed: 1, latest_addressed: [b] }, actions);
  assert.equal(globalThis.document.activeElement, outside); assert.equal(globalThis.document.moves, moves);
  // So does focus on something in the list that stands for no row, such as its heading.
  host.children[0].focus();
  const heading = globalThis.document.moves;
  paintSent(host, { addressed: 1, latest_addressed: [b] }, actions);
  assert.equal(globalThis.document.moves, heading);
});

test('a list drawn again with what it already shows is left alone, so a press under way ends on the button it began on', async t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), focused: null, get activeElement() { return this.focused?.isConnected ? this.focused : null; } };
  t.after(() => { globalThis.document = previous; });
  const f = fixture();
  const lost = { ...f.item('d2', 'Before you left', 't9'), topic_readable: false, source_ref: { kind: 'message', id: 'm-2' } };
  const actions = { open() {}, acknowledge: async () => {}, read: async () => {}, attachment: () => new Element('span') };
  const host = new Element('section'); host.root = true;
  paintSent(host, { addressed: 1, latest_addressed: [lost] }, actions);
  const mark = host.all().find(node => node.textContent === 'Mark read');
  paintSent(host, { addressed: 1, latest_addressed: [structuredClone(lost)] }, actions);
  assert.equal(host.all().find(node => node.textContent === 'Mark read'), mark);
  paintSent(host, { addressed: 2, latest_addressed: [lost] }, actions);
  assert.notEqual(host.all().find(node => node.textContent === 'Mark read'), mark, 'a change draws it anew');
});

test('focus on the last row to leave goes to the page\'s main region, and on a row whose neighbours all left, to the first row', async t => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), focused: null, get activeElement() { return this.focused?.isConnected ? this.focused : null; } };
  t.after(() => { globalThis.document = previous; });
  const f = fixture();
  const lost = (id, body) => { const item = { ...f.item(id, body, 't9'), topic_readable: false, source_ref: { kind: 'message', id: 'm-' + id } }; item.message = { ...item.message, id: 'm-' + id }; return item; };
  const actions = { open() {}, acknowledge: async () => {}, read: async () => {}, attachment: () => new Element('span') };
  const main = new Element('main'); main.root = true;
  const host = new Element('section'); main.append(host);
  const control = (body, text) => host.all().find(node => node.tag === 'li' && node.text.includes(body)).all().find(node => node.textContent === text);
  paintSent(host, { addressed: 1, latest_addressed: [lost('d1', 'Only')] }, actions);
  control('Only', 'Mark read').focus();
  paintSent(host, { addressed: 0, latest_addressed: [] }, actions);
  assert.equal(host.hidden, true);
  assert.equal(globalThis.document.activeElement, main, 'not the body');
  paintSent(host, { addressed: 1, latest_addressed: [lost('d2', 'Old')] }, actions);
  control('Old', 'Mark read').focus();
  paintSent(host, { addressed: 2, latest_addressed: [lost('d3', 'New one'), lost('d4', 'New two')] }, actions);
  assert.equal(globalThis.document.activeElement, control('New one', 'Read it here'));
});
