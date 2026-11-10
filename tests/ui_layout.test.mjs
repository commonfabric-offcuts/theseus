import test from 'node:test';
import assert from 'node:assert/strict';
import { ReaderLayout } from '../web/layout.mjs';

function fixture() {
  const data = new Map([['unrelated', 'keep me'], ['aim-modal-split', '.7']]);
  const writes = [];
  return { data, writes, storage: {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { writes.push(['set', key]); data.set(key, String(value)); },
    removeItem: key => { writes.push(['remove', key]); data.delete(key); },
  } };
}

test('layout preferences are exact instance keys; only the wide layout keeps a share, since a stacked reply is as tall as its writing', () => {
  const f = fixture(), first = new ReaderLayout('one', f.storage), second = new ReaderLayout('two', f.storage);
  assert.equal(first.mode, 'stacked');
  first.setMode('wide'); first.setShare(.62, 'wide'); first.setShare(.54, 'stacked');
  const reopened = new ReaderLayout('one', f.storage);
  assert.equal(reopened.mode, 'wide'); assert.equal(reopened.share('wide'), .62); assert.equal(reopened.share('stacked'), undefined);
  assert.deepEqual(Object.keys(first.keys), ['mode', 'wide'], 'no stacked share is stored');
  assert.equal(second.mode, 'stacked'); assert.equal(second.share('wide'), .45);
  assert.equal(f.data.get('unrelated'), 'keep me'); assert.equal(f.data.get('aim-modal-split'), '.7');
  assert.deepEqual(new Set(f.writes.map(([, key]) => key)), new Set(Object.values(first.keys)));
  assert.ok(Object.values(first.keys).every(key => !Object.values(second.keys).includes(key)));
});

test('reset removes only the chosen split key, retaining the layout and every other preference', () => {
  const f = fixture(), layout = new ReaderLayout('one', f.storage);
  layout.setMode('wide'); layout.setShare(.63, 'wide'); layout.setShare(.58, 'stacked');
  const before = new Map(f.data);
  layout.resetShare('wide');
  before.delete(layout.keys.wide);
  assert.deepEqual(f.data, before);
  assert.equal(layout.share('wide'), .45);
  assert.deepEqual(f.writes.at(-1), ['remove', layout.keys.wide]);
});

test('malformed or unavailable preferences keep a usable layout without writing repairs', () => {
  const f = fixture(), keys = new ReaderLayout('one', f.storage).keys;
  f.data.set(keys.mode, 'unknown'); f.data.set(keys.wide, '9');
  const layout = new ReaderLayout('one', f.storage);
  assert.equal(layout.mode, 'stacked'); assert.equal(layout.share('wide'), .45);
  assert.equal(f.writes.length, 0);
  const unavailable = new ReaderLayout('other', { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
  unavailable.setMode('wide'); unavailable.setShare(.65);
  assert.equal(unavailable.mode, 'wide'); assert.equal(unavailable.share(), .65);
  assert.throws(() => new ReaderLayout('', f.storage), /instance/);
});
