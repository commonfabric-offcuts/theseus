import test from 'node:test';
import assert from 'node:assert/strict';
import { TopicPages, TopicRail, parseRoute } from '../web/topic-navigation.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

async function fixture(t, { unread = 2, question = null } = {}) {
  const previous = globalThis.document, doc = miniDocument(), create = doc.createElement;
  // This view redraws by textContent. Match the browser's child replacement,
  // which mini_dom's plain textContent property does not supply.
  doc.createElement = tag => {
    const node = create(tag); let words = '';
    Object.defineProperty(node, 'textContent', { get: () => words, set(value) { words = String(value); node.replaceChildren(); } });
    return node;
  };
  globalThis.document = doc;
  t.after(() => { globalThis.document = previous; });
  const nodes = Object.fromEntries(['host', 'more', 'retry', 'message', 'area'].map(name => [name, doc.createElement('div')]));
  nodes.area.append(nodes.host, nodes.more, nodes.retry);
  let item = { id: 'beds', title: 'Spring beds', workspace_id: 'fixture-1174', list_position: 100, unread,
    ...(question ? { asks: [{ actor_id: 'reader', message_id: question, by: 'sender', since_ms: 1 }] } : {}) };
  const opened = [];
  const rail = new TopicRail({ ...nodes, reader: 'reader', pages: new TopicPages('fixture-1174', item.workspace_id, null),
    read: async () => ({ instance_id: 'fixture-1174', items: [item], next_cursor: null }),
    open: (...args) => opened.push(args), denied: () => false });
  t.after(() => rail.disposeProjection());
  await rail.load();
  const row = () => nodes.host.children.find(node => node.dataset.topicId === item.id);
  return { rail, opened, row, badge: () => row().querySelector('.unread-count[data-lands]'),
    refresh: async count => { item = { ...item, unread: count }; await rail.load(); } };
}
const press = (row, target = row, overrides = {}) => {
  let prevented = 0;
  row.onclick({ button: 0, detail: 1, target, preventDefault() { prevented++; }, ...overrides });
  return prevented;
};

for (const question of [null, 'question']) test(`1174 pointer row and badge share one unread opening${question ? ' ahead of its waiting question' : ''}`, async t => {
  const f = await fixture(t, { question });
  assert.ok(f.badge());
  assert.equal(press(f.row()), 1);
  assert.equal(press(f.row(), f.badge()), 1);
  assert.deepEqual(f.opened, [['beds', 'Spring beds', null, 'unread'], ['beds', 'Spring beds', null, 'unread']]);
  assert.deepEqual(parseRoute(new URL(f.row().href, 'https://fixture.invalid/')), { kind: 'topic', id: 'beds', at: 'unread' });
});

test('1174 no-unread row preserves plain and waiting-question destinations', async t => {
  const f = await fixture(t, { unread: 0 });
  assert.equal(f.badge(), null); press(f.row());
  assert.deepEqual(f.opened, [['beds', 'Spring beds', null]]);
  const waiting = await fixture(t, { unread: 0, question: 'question' });
  assert.equal(waiting.badge(), null); press(waiting.row());
  assert.deepEqual(waiting.opened, [['beds', 'Spring beds', 'question']]);
  assert.deepEqual(parseRoute(new URL(waiting.row().href, 'https://fixture.invalid/')), { kind: 'topic', id: 'beds', message: 'question' });
});

test('1174 refreshed drawn counts change the row destination without replacing its owner', async t => {
  const f = await fixture(t, { unread: 0, question: 'question' }), row = f.row();
  await f.refresh(2); assert.equal(f.row(), row); assert.ok(f.badge()); press(row);
  await f.refresh(0); assert.equal(f.row(), row); assert.equal(f.badge(), null); press(row);
  assert.deepEqual(f.opened, [['beds', 'Spring beds', null, 'unread'], ['beds', 'Spring beds', 'question']]);
});

test('1174 modified presses remain browser-owned and retain the unread link', async t => {
  const f = await fixture(t, { question: 'question' });
  for (const overrides of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    assert.equal(press(f.row(), f.row(), overrides), 0);
    assert.equal(press(f.row(), f.badge(), overrides), 0);
  }
  assert.deepEqual(f.opened, []);
  assert.equal(f.row().href, '?topic=beds&at=unread');
});

test('1174 Return keeps the existing single unread activation', async t => {
  const f = await fixture(t, { question: 'question' });
  assert.equal(press(f.row(), f.row(), { detail: 0 }), 1);
  assert.deepEqual(f.opened, [['beds', 'Spring beds', null, 'unread']]);
});
