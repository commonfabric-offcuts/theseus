import test from 'node:test';
import assert from 'node:assert/strict';
import { OutcomeReferences } from '../web/outcome-references.mjs';

function fixture(t, { pageMax } = {}) {
  const previous = globalThis.document;
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.hidden = false; this.textContent = ''; }
    append(...nodes) { for (const child of nodes) { child.remove(); child.parent = this; this.children.push(child); } }
    insertBefore(child, before) { child.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, child); child.parent = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; }
  }
  globalThis.document = { createElement: () => new Element() }; t.after(() => globalThis.document = previous);
  const nodes = Object.fromEntries(['host', 'count', 'list', 'more', 'message'].map(k => [k, new Element()]));
  nodes.host.hidden = true; nodes.message.hidden = true;
  const queue = [], calls = [], opened = [], seen = [];
  const item = (seq, title = `Item ${seq}`, revision = 1) => ({ id: `m${seq}`, seq, title, revision, source_ref: { kind: 'memory', id: `m${seq}`, revision } });
  const answer = (items, next_cursor = null) => ({ instance_id: 'instance', items, next_cursor });
  const references = new OutcomeReferences({ ...nodes, ...(pageMax ? { pageMax } : {}),
    read: args => { calls.push(args); const next = queue.shift(); return typeof next === 'function' ? next() : Promise.resolve(next); },
    open: (...args) => opened.push(args), denied: error => error.status === 403, seen: items => seen.push(items.map(x => x.id)) });
  const titles = () => nodes.list.children.map(row => row.textContent);
  return { ...nodes, queue, calls, opened, seen, item, answer, references, titles };
}

test('the outcome Notebook is listed by title in order, and each title opens its exact revision', async t => {
  const f = fixture(t);
  f.queue.push(f.answer([f.item(1, 'Architecture'), f.item(2, ''), f.item(3, 'How we work', 4)]));
  assert.equal(await f.references.load(), true);
  assert.equal(f.host.hidden, false); assert.equal(f.more.hidden, true);
  assert.deepEqual(f.titles(), ['Architecture', 'Notebook item', 'How we work']);
  assert.equal(f.count.textContent, '3');
  f.list.children[2].onclick();
  assert.deepEqual(f.opened, [[{ kind: 'memory', id: 'm3', revision: 4 }, f.list.children[2]]]);
  assert.deepEqual(f.seen, [['m1', 'm2', 'm3']]);
});

test('an outcome with no Notebook items, or one the reader cannot list, shows nothing', async t => {
  const f = fixture(t);
  f.queue.push(f.answer([]));
  assert.equal(await f.references.load(), true);
  assert.equal(f.host.hidden, true);
  f.queue.push(f.answer([f.item(1)]));
  await f.references.load();
  assert.equal(f.host.hidden, false);
  f.queue.push(() => Promise.reject(Object.assign(Error('Denied'), { status: 403 })));
  assert.equal(await f.references.load(), false);
  assert.equal(f.host.hidden, true); assert.deepEqual(f.titles(), []); assert.equal(f.message.hidden, true);
});

test('a read that fails says so and keeps the titles already shown; the next read clears it', async t => {
  const f = fixture(t);
  f.queue.push(f.answer([f.item(1, 'Architecture')]));
  await f.references.load();
  const row = f.list.children[0];
  f.queue.push(() => Promise.reject(Error('Offline.')));
  assert.equal(await f.references.load(), false);
  assert.equal(f.host.hidden, false); assert.equal(f.message.hidden, false);
  assert.match(f.message.textContent, /Offline\..*could not be read/);
  assert.equal(f.list.children[0], row);
  f.queue.push({ instance_id: 'instance', items: [{ id: 'm1', title: 'No sequence', source_ref: { kind: 'memory', id: 'm1', revision: 1 } }], next_cursor: null });
  assert.equal(await f.references.load(), false);
  assert.match(f.message.textContent, /malformed/);
  assert.deepEqual(f.titles(), ['Architecture']);
  f.queue.push(f.answer([f.item(1, 'Architecture')]));
  assert.equal(await f.references.load(), true);
  assert.equal(f.message.hidden, true); assert.equal(f.list.children[0], row);
});

test('a reload keeps every item More brought in, and shows a revision under the same row', async t => {
  const f = fixture(t, { pageMax: 50 });
  f.queue.push(f.answer([f.item(1), f.item(2)], 2));
  await f.references.load();
  assert.equal(f.more.hidden, false); assert.equal(f.count.textContent, '2+');
  f.queue.push(f.answer([f.item(3)], null));
  await f.more.onclick();
  assert.deepEqual(f.titles(), ['Item 1', 'Item 2', 'Item 3']); assert.equal(f.more.hidden, true); assert.equal(f.count.textContent, '3');
  const rows = [...f.list.children];
  f.queue.push(f.answer([f.item(1), f.item(2, 'Revised', 2)], 2), f.answer([f.item(3)], null));
  await f.references.load();
  assert.deepEqual(f.calls.slice(2), [{ limit: 20 }, { limit: 20, cursor: 2 }]);
  assert.deepEqual(f.titles(), ['Item 1', 'Revised', 'Item 3']);
  assert.deepEqual([...f.list.children], rows);
  rows[1].onclick();
  assert.deepEqual(f.opened.at(-1)[0], { kind: 'memory', id: 'm2', revision: 2 });
  f.queue.push(f.answer([f.item(1), f.item(3)], null));
  await f.references.load();
  assert.deepEqual(f.titles(), ['Item 1', 'Item 3']); assert.equal(rows[1].parent, null);
});

test('a reload asked for during a read runs once after it, and a More during a read shares it', async t => {
  const f = fixture(t);
  let finish;
  f.queue.push(() => new Promise(resolve => { finish = resolve; }));
  const first = f.references.load(), more = f.references.load(true), again = f.references.load(), twice = f.references.load();
  assert.equal(more, first); assert.equal(again, twice);
  f.queue.push(f.answer([f.item(1, 'Later')]));
  finish(f.answer([f.item(1, 'Sooner')]));
  await again;
  assert.equal(f.calls.length, 2); assert.deepEqual(f.titles(), ['Later']);
});
