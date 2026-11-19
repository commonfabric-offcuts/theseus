// Interleaved source reads must not undo a person's explicit Show full choice.
// Native reading checks hold the real geometry, menu, and page lifetime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CardScroll } from '../web/card-scroll.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const fixture = () => {
  const doc = miniDocument(); doc.createTextNode = text => ({ text });
  const card = doc.byId('message'), preview = doc.createElement('span'), cue = doc.createElement('span');
  preview.className = 'message-preview'; cue.className = 'message-preview-cue';
  preview.ownerDocument = doc; preview.getBoundingClientRect = () => ({ height: 100 });
  card.getBoundingClientRect = () => ({ height: 150 }); card.style = {}; card.scrollTop = 0;
  card.append(preview, cue);
  return { card, preview, cue, item: { id: 'm', preview: true, body: 'Excerpt' } };
};
const source = { source_ref: { id: 'm' }, body: 'The complete source.' };

test('a late hover read cannot recap a message explicitly shown full', async () => {
  const f = fixture(), reads = [], scroll = new CardScroll({ read: () => new Promise(resolve => reads.push(resolve)) });
  const hovering = scroll.expand(f.card, f.item), full = scroll.showFull(f.card, f.item);
  reads[1](source); assert.equal(await full, true);
  reads[0](source); assert.equal(await hovering, false);
  assert.equal(f.card.style.maxHeight, 'none');
  assert.equal(f.card.classList.contains('scroll-in-place'), false);
  assert.equal(f.cue.hidden, true);
  assert.ok(f.preview.text.includes(source.body));
});

test('an unavailable or wrong source preserves the excerpt and permits a later retry', async () => {
  const f = fixture(); let answer = { ...source, source_ref: { id: 'other' } };
  const scroll = new CardScroll({ read: async () => answer });
  f.preview.textContent = 'Excerpt';
  await assert.rejects(scroll.showFull(f.card, f.item), /could not be read whole/);
  assert.equal(f.preview.text, 'Excerpt'); assert.equal(f.card.dataset.full, undefined);
  answer = source; await scroll.showFull(f.card, f.item);
  assert.equal(f.card.dataset.full, 'shown'); assert.equal(f.card.style.maxHeight, 'none');
});

test('a source arriving after the feed card is retired paints nothing', async () => {
  const f = fixture(); let resolve;
  const scroll = new CardScroll({ read: () => new Promise(done => { resolve = done; }) });
  const loading = scroll.showFull(f.card, f.item);
  f.card.root = false; resolve(source);
  assert.equal(await loading, false); assert.equal(f.card.dataset.full, undefined);
});

test('item 721 an invalidated source read never caches or paints over the newer whole revision', async () => {
  const f = fixture(), reads = [], scroll = new CardScroll({ read: () => new Promise(resolve => reads.push(resolve)) });
  const old = scroll.showFull(f.card, f.item);
  const rejected = assert.rejects(old, /changed while it was being read/);
  scroll.forget('m');
  const current = scroll.showFull(f.card, f.item);
  reads[1]({ ...source, body: 'The newer complete source.' }); await current;
  reads[0](source); await rejected;
  assert.equal(scroll.known('m'), 'The newer complete source.');
  assert.ok(f.preview.text.includes('The newer complete source.'));
});

test('item 721 a whole-source read that lost its reply owner paints nothing', async () => {
  const f = fixture(); let resolve, owned = true;
  const scroll = new CardScroll({ read: () => new Promise(done => { resolve = done; }) });
  const loading = scroll.showFull(f.card, f.item, () => owned);
  owned = false; resolve(source);
  assert.equal(await loading, false); assert.equal(f.card.dataset.full, undefined);
});
