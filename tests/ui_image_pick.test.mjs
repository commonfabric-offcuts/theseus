import test from 'node:test';
import assert from 'node:assert/strict';
import { imageQuery, clipboardHoldsImage } from '../web/image-pick.mjs';

test('#img opens the list at the start of a line or after a space, and what follows narrows it', () => {
  assert.deepEqual(imageQuery('#img', 4), { start: 0, filter: '' });
  assert.deepEqual(imageQuery('see #imgChart', 13), { start: 4, filter: 'chart' });
  assert.deepEqual(imageQuery('one\n#img', 8), { start: 4, filter: '' });
  assert.equal(imageQuery('word#img', 8), null, 'inside a word it is just text');
  assert.equal(imageQuery('#img done', 9), null, 'a space after it ends the query');
  assert.equal(imageQuery('#im', 3), null);
  assert.equal(imageQuery('#img later', 2), null, 'only words just before the cursor count');
});

const nav = (state, types, fail) => ({
  permissions: { query: async () => { if (fail) throw Error('no such permission'); return { state }; } },
  clipboard: { read: async () => { nav.reads++; return [{ types }]; } },
});
test('Paste image shows only when reading the clipboard needs no asking and it holds an image', async () => {
  nav.reads = 0;
  assert.equal(await clipboardHoldsImage(nav('granted', ['image/png'])), true);
  assert.equal(await clipboardHoldsImage(nav('granted', ['text/plain'])), false, 'words on the clipboard are not an image');
  assert.equal(nav.reads, 2);
  assert.equal(await clipboardHoldsImage(nav('prompt', ['image/png'])), false, 'not granted yet: never asks');
  assert.equal(await clipboardHoldsImage(nav('denied', ['image/png'])), false);
  assert.equal(nav.reads, 2, 'the clipboard is not read unless already granted');
  assert.equal(await clipboardHoldsImage(nav('granted', ['image/png'], true)), false, 'Safari and Firefox know no clipboard-read permission');
  assert.equal(await clipboardHoldsImage({}), false, 'no Async Clipboard at all');
});

// Theseus refuses a second image read while one is under way, so the page's
// reads take turns, and a picked image goes ahead of thumbnails still waiting.
test('image reads take turns, and a read the person waits on goes first', async () => {
  const { readInTurn } = await import('../web/image-pick.mjs');
  const order = [], open = new Set();
  let overlap = false;
  const gates = {};
  const read = name => () => { if (open.size) overlap = true; open.add(name); order.push(name); return new Promise(resolve => { gates[name] = () => { open.delete(name); resolve(name); }; }); };
  const a = readInTurn(read('thumb-a')), b = readInTurn(read('thumb-b')), c = readInTurn(read('thumb-c'));
  await Promise.resolve();
  const picked = readInTurn(read('picked'), { first: true });
  // Let each read finish in turn: whichever reads are under way end together.
  for (let i = 0; i < 4; i++) { await new Promise(setImmediate); for (const name of [...open]) gates[name](); }
  assert.deepEqual(order, ['thumb-a', 'picked', 'thumb-b', 'thumb-c'], 'the pick waits only for the read under way');
  assert.deepEqual(await Promise.all([a, picked, b, c]), ['thumb-a', 'picked', 'thumb-b', 'thumb-c']);
  assert.equal(overlap, false, 'never two reads at once');
  // A failed read does not stop the next.
  const failed = readInTurn(() => Promise.reject(Error('busy'))), after = readInTurn(async () => 'next');
  await assert.rejects(failed, /busy/); assert.equal(await after, 'next');
});
