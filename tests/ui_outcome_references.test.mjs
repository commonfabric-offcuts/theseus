import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OutcomeReferences } from '../web/outcome-references.mjs';

function fixture(t, { pageMax } = {}) {
  const previous = globalThis.document;
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.hidden = false; this.textContent = ''; }
    append(...nodes) { for (const child of nodes) { child.remove(); child.parent = this; this.children.push(child); } }
    insertBefore(child, before) { child.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, child); child.parent = this; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; }
    setAttribute(name, value) { (this.attributes ??= {})[name] = value; } removeAttribute(name) { delete this.attributes?.[name]; }
    focus() { globalThis.document.activeElement = this; }
  }
  globalThis.document = { createElement: () => new Element(), activeElement: null }; t.after(() => globalThis.document = previous);
  const nodes = Object.fromEntries(['host', 'list', 'more', 'message'].map(k => [k, new Element()]));
  nodes.host.hidden = true; nodes.message.hidden = true;
  const queue = [], calls = [], opened = [], seen = [];
  const item = (seq, title = `Item ${seq}`, revision = 1) => ({ id: `m${seq}`, seq, title, revision, owner_scope: { kind: 'workspace', id: 'w1' }, source_ref: { kind: 'memory', id: `m${seq}`, revision } });
  const answer = (items, next_cursor = null) => ({ instance_id: 'instance', items, next_cursor });
  const references = new OutcomeReferences({ ...nodes, scope: 'w1', ...(pageMax ? { pageMax } : {}),
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
  assert.ok(f.list.children.every(row => row.className === 'nav-item reference'), 'each page is a row like a topic\'s');
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
  assert.equal(await f.references.load(), true, 'a denial is an answer, not a failure to retry');
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
  const bad = (change, next_cursor = null) => { const one = f.item(1, 'Changed'); change(one); return f.answer([one], next_cursor); };
  for (const [name, answer] of [
    ['no sequence', bad(one => { delete one.seq; })],
    ['another scope', bad(one => { one.owner_scope = { kind: 'topic', id: 't1' }; })],
    ['another outcome', bad(one => { one.owner_scope = { kind: 'workspace', id: 'w2' }; })],
    ['another item opened', bad(one => { one.source_ref = { ...one.source_ref, id: 'other' }; })],
    ['another revision opened', bad(one => { one.revision = 3; })],
    ['an id twice', f.answer([f.item(1), { ...f.item(2), id: 'm1', source_ref: { kind: 'memory', id: 'm1', revision: 1 } }])],
    ['out of order', f.answer([f.item(2), f.item(1)])],
    ['a cursor behind its items', f.answer([f.item(1), f.item(2)], 1)],
  ]) {
    f.queue.push(answer);
    assert.equal(await f.references.load(), false, name);
    assert.match(f.message.textContent, /malformed/, name);
    assert.deepEqual(f.titles(), ['Architecture'], name);
  }
  f.queue.push(f.answer([f.item(1, 'Architecture')]));
  assert.equal(await f.references.load(), true);
  assert.equal(f.message.hidden, true); assert.equal(f.list.children[0], row);
});

test('a reload keeps every item More brought in, and shows a revision under the same row', async t => {
  const f = fixture(t, { pageMax: 50 });
  f.queue.push(f.answer([f.item(1), f.item(2)], 2));
  await f.references.load();
  assert.equal(f.more.hidden, false);
  f.queue.push(f.answer([f.item(3)], null));
  await f.more.onclick();
  assert.deepEqual(f.titles(), ['Item 1', 'Item 2', 'Item 3']); assert.equal(f.more.hidden, true);
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

test('a continuation that does not move forward is refused, not read forever', async t => {
  const f = fixture(t);
  f.queue.push(f.answer([f.item(1), f.item(2)], 2));
  await f.references.load();
  f.queue.push(f.answer([f.item(3), f.item(5)], 5));
  await f.more.onclick();
  f.queue.push(f.answer([f.item(1)], 1), f.answer([], 1));
  assert.equal(await f.references.load(), false);
  assert.match(f.message.textContent, /malformed/);
  assert.equal(f.calls.length, 4);
});

test('More, once nothing is left to bring, hands focus to the first item it brought', async t => {
  const f = fixture(t);
  f.queue.push(f.answer([f.item(1), f.item(2)], 2));
  await f.references.load();
  f.more.focus();
  let finish;
  f.queue.push(() => new Promise(resolve => { finish = resolve; }));
  const brought = f.more.onclick();
  assert.equal(f.more.attributes['aria-disabled'], 'true', 'More is marked busy while it reads');
  finish(f.answer([f.item(3), f.item(4)], null));
  await brought;
  assert.equal(globalThis.document.activeElement, f.list.children[2]);
  assert.equal(f.more.attributes['aria-disabled'], undefined);
  // A More that leaves more to bring keeps its focus.
  f.queue.push(f.answer([f.item(1), f.item(2), f.item(3), f.item(4)], 4));
  await f.references.load();
  f.queue.push(f.answer([f.item(5)], 5));
  f.more.hidden = false; f.references.next = 4; f.more.focus();
  await f.more.onclick();
  assert.equal(globalThis.document.activeElement, f.more);
});

test('the Notebook pages sit in the sidebar beside the topics, with the failure said above their rows', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const rail = /<nav class="rail"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
  const section = /<section id="outcome-references"[^>]*>([\s\S]*?)<\/section>/.exec(rail)?.[1] ?? '';
  assert.ok(section, 'the Notebook is in the sidebar');
  assert.doesNotMatch(main, /outcome-references/, 'and no longer a closed line above the topic');
  assert.ok(rail.indexOf('id="outcome-references"') > rail.indexOf('id="topic-navigation"'), 'after the topics');
  assert.match(section, /<h2 id="notebook-heading">Notebook<\/h2>/);
  assert.doesNotMatch(section, /<details/);
  assert.ok(section.indexOf('id="outcome-references-status"') < section.indexOf('id="outcome-references-list"'));
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  assert.match(css, /#outcome-references-list \.nav-item\{min-height:44px;/, 'a page row is as tall as a topic row');
  assert.match(css, /@media\(max-width:760px\)\{#outcome-references\{[^}]*\}#outcome-references-list\{display:flex;overflow:auto;/, 'and scrolls sideways on a phone as topics do');
});
