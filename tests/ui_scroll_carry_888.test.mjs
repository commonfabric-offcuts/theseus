import test from 'node:test';
import assert from 'node:assert/strict';
import { renderer799 } from './fixtures/renderer799.mjs';
import { arrangeStacks, entries, stackState } from '../web/reply-stacks.mjs';

// Actual renderer and reconcile; only DOM scroll/event behavior is modelled.
// A move resets connected descendants as detaching a scroll box can do.
// This counts getters/writes, not layout cost, native events or browser time.
function fixture() {
  const f = renderer799('reader'), doc = f.list.ownerDocument;
  const offsets = new WeakMap(), listeners = new WeakMap(), events = [];
  let phase = 'setup';
  function watch(node) {
    offsets.set(node, { left: 0, top: 0 }); listeners.set(node, []);
    for (const [property, axis] of [['scrollLeft', 'left'], ['scrollTop', 'top']]) Object.defineProperty(node, property, {
      get() { events.push({ kind: 'read', node, axis, phase }); return offsets.get(node)[axis]; },
      set(value) { events.push({ kind: 'write', node, axis, value, phase }); offsets.get(node)[axis] = value; },
    });
    const listen = node.addEventListener, query = node.querySelectorAll, insert = node.insertBefore;
    node.addEventListener = function(type, callback, options) { listeners.get(this).push({ type, callback, options }); listen.call(this, type, callback, options); };
    node.querySelectorAll = function(selector) { if (selector === '*') events.push({ kind: 'scan', node, phase }); return query.call(this, selector); };
    node.insertBefore = function(moving, before) {
      const connected = moving.isConnected;
      events.push({ kind: 'move', node: moving, parent: this, connected, phase });
      if (connected) for (const box of [moving, ...moving.descendants()]) {
        const position = offsets.get(box); if (position) { position.left = 0; position.top = 0; }
      }
      return insert.call(this, moving, before);
    };
    return node;
  }
  watch(f.list);
  const make = doc.createElement; doc.createElement = tag => watch(make(tag));
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  const draw = () => arrangeStacks(f.list, f.messages, { doc, viewer: 'reader' });
  const card = id => entries(f.list).find(node => node.dataset.id === id);
  // Scroll does not bubble. Deliver it only to capturing ancestors and to
  // its own target, so a missing capture option is a real assertion failure.
  function scroll(box, left, top) {
    Object.assign(offsets.get(box), { left, top });
    const path = []; for (let node = box; node; node = node.parentElement) path.unshift(node);
    for (const node of path) for (const listener of listeners.get(node) ?? []) {
      if (listener.type === 'scroll' && (node === box || listener.options === true || listener.options?.capture)) listener.callback({ target: box });
    }
  }
  const inspect = (name, action) => { events.length = 0; phase = name; action(); return [...events]; };
  return { ...f, doc, offsets, listeners, events, draw, card, scroll, inspect };
}
const message = (id, seq, reply_to = null) => ({ id, seq, topic_id: 'fixture-topic', author_id: 'fixture-writer', reply_to, acts: {} });
function reading() {
  const f = fixture(); f.add([message('a', 1), message('ar', 2, 'a'), message('b', 3), message('br', 4, 'b')]);
  const table = f.doc.createElement('div'); table.className = 'table-scroll';
  table.append(f.doc.createElement('table')); f.card('a').querySelector('.message-preview').append(table);
  const long = f.card('ar'); long.classList.add('long-message');
  f.scroll(table, 137, 0); f.scroll(long, 0, 241);
  return { ...f, table, long };
}
const order = f => [...f.list.children].filter(node => node.classList.contains('reply-stack')).map(node => node.dataset.stack);
const change = {
  move(f) { f.messages.get('a').acts.placed = 10; f.draw(); },
  join(f) { f.messages.get('a').acts.joined = { into: 'b', by: 'fixture-writer', at_ms: 1 }; f.draw(); },
  reply(f) { f.add([message('new', 5, 'a')]); },
};

test('888 each feed owns one capturing passive scroll listener across repeated arrangements', () => {
  const f = reading(); f.draw(); f.draw();
  const registered = f.listeners.get(f.list).filter(each => each.type === 'scroll');
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0].options, { capture: true, passive: true });
});
test('888 a captured scroll reads only its target once per axis, including a box added after opening', () => {
  const f = reading(), later = f.doc.createElement('div'); f.card('b').querySelector('.message-preview').append(later);
  const trace = f.inspect('scroll', () => f.scroll(later, 15, 26));
  assert.deepEqual(trace.filter(event => event.kind === 'read').map(event => event.axis), ['left', 'top']);
  assert.ok(trace.every(event => event.node === later));
  assert.equal(trace.filter(event => event.kind === 'scan' || event.kind === 'write').length, 0);
  f.messages.get('b').acts.joined = { into: 'a', by: 'fixture-writer', at_ms: 2 }; f.draw();
  assert.deepEqual(f.offsets.get(later), { left: 15, top: 26 });
});
for (const action of ['move', 'join', 'reply']) {
  test('888 actual ' + action + ' preserves the scrolled table and long message with no position reads or subtree scans', t => {
    const f = reading(), initialTable = f.table, initialLong = f.long;
    assert.deepEqual(order(f), ['b', 'a']);
    const trace = f.inspect(action, () => change[action](f));
    t.diagnostic('888 reconcile trace ' + JSON.stringify({ action, moves: trace.filter(event => event.kind === 'move').length,
      connectedMoves: trace.filter(event => event.kind === 'move' && event.connected).length,
      scrollReads: trace.filter(event => event.kind === 'read').length, descendantScans: trace.filter(event => event.kind === 'scan').length,
      restoreWrites: trace.filter(event => event.kind === 'write').length, table: f.offsets.get(f.table), longMessage: f.offsets.get(f.long) }));
    assert.ok(trace.some(event => event.kind === 'move' && event.connected), 'the real reconcile moved a connected subtree');
    assert.deepEqual(order(f), action === 'join' ? ['b'] : ['a', 'b']);
    assert.equal(f.table, initialTable); assert.equal(f.card('ar'), initialLong);
    assert.deepEqual(f.offsets.get(f.table), { left: 137, top: 0 });
    assert.deepEqual(f.offsets.get(f.long), { left: 0, top: 241 });
    assert.equal(trace.filter(event => event.kind === 'read').length, 0, 'no scroll getter during the entire arrangement');
    assert.equal(trace.filter(event => event.kind === 'scan').length, 0, 'no descendant scan to discover scroll boxes');
    const writes = trace.filter(event => event.kind === 'write');
    assert.ok(writes.every(event => event.node === f.table || event.node === f.long), 'only tracked boxes are restored');
    assert.equal(new Set(writes.map(event => event.node)).size, 2, 'both tracked boxes are restored');
    const lastMove = trace.findLastIndex(event => event.kind === 'move');
    assert.ok(writes.length && trace.findIndex(event => event.kind === 'write') > lastMove, 'restoration follows all nested and outer moves');
  });
}
test('888 scroll events replace both offsets, including negative horizontal positions', () => {
  const f = reading(); f.scroll(f.table, -37, 19); f.scroll(f.long, 8, 366);
  const trace = f.inspect('move', () => change.move(f));
  assert.deepEqual(f.offsets.get(f.table), { left: -37, top: 19 }); assert.deepEqual(f.offsets.get(f.long), { left: 8, top: 366 });
  assert.equal(trace.filter(event => event.kind === 'read').length, 0);
});
test('888 a box scrolled back to zero leaves the tracked set and receives no restore writes', () => {
  const f = reading(); f.scroll(f.table, 0, 0);
  const trace = f.inspect('move', () => change.move(f));
  assert.deepEqual(f.offsets.get(f.table), { left: 0, top: 0 }); assert.deepEqual(f.offsets.get(f.long), { left: 0, top: 241 });
  assert.equal(trace.filter(event => event.kind === 'write' && event.node === f.table).length, 0);
  assert.equal(trace.filter(event => event.kind === 'read').length, 0);
});
test('888 returning only one axis to zero keeps the other axis tracked', () => {
  const f = reading(); f.scroll(f.table, 32, 49); f.scroll(f.table, 0, 49);
  f.inspect('join', () => change.join(f)); assert.deepEqual(f.offsets.get(f.table), { left: 0, top: 49 });
});
test('888 detached tracked boxes are forgotten and reinserting their node cannot restore an old offset', () => {
  const f = reading(); f.table.remove();
  let trace = f.inspect('removed', () => f.draw());
  assert.equal(trace.filter(event => event.kind === 'write' && event.node === f.table).length, 0);
  Object.assign(f.offsets.get(f.table), { left: 0, top: 0 }); f.card('a').querySelector('.message-preview').append(f.table);
  trace = f.inspect('reinserted', () => change.move(f));
  assert.deepEqual(f.offsets.get(f.table), { left: 0, top: 0 });
  assert.equal(trace.filter(event => event.kind === 'write' && event.node === f.table).length, 0);
});
test('888 a feed without any scroll events makes no scroll reads or writes while moving cards', () => {
  const f = fixture(); f.add([message('a', 1), message('b', 2)]);
  const trace = f.inspect('move', () => change.move(f)); assert.deepEqual(order(f), ['a', 'b']);
  assert.ok(trace.some(event => event.kind === 'move' && event.connected));
  assert.equal(trace.filter(event => ['read', 'write', 'scan'].includes(event.kind)).length, 0);
});
test('888 two feed owners preserve only their own scrolled boxes', () => {
  const a = reading(), b = reading(); b.scroll(b.table, 73, 0); b.scroll(b.long, 0, 81);
  a.inspect('join', () => change.join(a)); const trace = b.inspect('move', () => change.move(b));
  assert.deepEqual(a.offsets.get(a.table), { left: 137, top: 0 }); assert.deepEqual(a.offsets.get(a.long), { left: 0, top: 241 });
  assert.deepEqual(b.offsets.get(b.table), { left: 73, top: 0 }); assert.deepEqual(b.offsets.get(b.long), { left: 0, top: 81 });
  assert.equal(trace.filter(event => event.kind === 'read').length, 0);
  assert.notEqual(stackState(a.list), stackState(b.list));
});
