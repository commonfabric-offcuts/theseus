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
  card.ownerDocument = preview.ownerDocument = doc; preview.getBoundingClientRect = () => ({ height: 100 });
  card.getBoundingClientRect = () => ({ height: 150 }); card.style = {}; card.scrollTop = 0;
  card.append(preview, cue);
  return { card, preview, cue, item: { id: 'm', preview: true, body: 'Excerpt' } };
};
const source = { source_ref: { id: 'm' }, body: 'The complete source.' };
const busy = () => Object.assign(Error('Busy'), { status: 503, details: { error: { code: 'SERVER_BUSY' } } });

test('636 a focused preview recovers from a busy background lane through one foreground source read', async () => {
  const f = fixture(), reads = []; f.card.ownerDocument.activeElement = f.card;
  const scroll = new CardScroll({ read: async (id, readClass) => {
    reads.push([id, readClass]); if (readClass === 'background') throw busy(); return source;
  } });
  assert.equal(await scroll.expand(f.card, f.item), true);
  assert.deepEqual(reads, [['m', 'background'], ['m', 'foreground']]);
  assert.equal(f.card.dataset.whole, 'shown'); assert.ok(f.preview.text.includes(source.body));
});

test('636 a second busy answer preserves the excerpt without a third attempt', async () => {
  const f = fixture(), reads = []; f.card.ownerDocument.activeElement = f.card; f.preview.textContent = 'Excerpt';
  const scroll = new CardScroll({ read: async (id, readClass) => { reads.push(readClass); throw busy(); } });
  assert.equal(await scroll.expand(f.card, f.item), false);
  assert.deepEqual(reads, ['background', 'foreground']); assert.equal(f.preview.text, 'Excerpt');
  assert.equal(f.card.dataset.whole, undefined);
});

test('636 focus loss, retirement, hidden preview and edited epoch prevent foreground recovery', async () => {
  for (const change of ['focus', 'retire', 'hide', 'edit']) {
    const f = fixture(), reads = []; f.card.ownerDocument.activeElement = f.card;
    const scroll = new CardScroll({ read: async (id, readClass) => {
      reads.push(readClass);
      if (change === 'focus') f.card.ownerDocument.activeElement = null;
      if (change === 'retire') f.card.root = false;
      if (change === 'hide') f.preview.getBoundingClientRect = () => ({ height: 0 });
      if (change === 'edit') scroll.forget(id);
      throw busy();
    } });
    assert.equal(await scroll.expand(f.card, f.item), false, change);
    assert.deepEqual(reads, ['background'], change); assert.equal(f.card.dataset.whole, undefined, change);
  }
});

test('636 permission and authority refusals and unfocused hover never enter foreground', async () => {
  for (const code of ['FORBIDDEN', 'INVALID_BINDING', 'AUTHORITY_CHANGED', 'SERVER_BUSY']) {
    const f = fixture(), reads = []; if (code !== 'SERVER_BUSY') f.card.ownerDocument.activeElement = f.card;
    const scroll = new CardScroll({ read: async (id, readClass) => {
      reads.push(readClass); throw Object.assign(Error(code), { details: { error: { code } } });
    } });
    assert.equal(await scroll.expand(f.card, f.item), false, code);
    assert.deepEqual(reads, ['background'], code);
  }
});

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

test('838 a late hover read retains the source height measured before the reply docked', async () => {
  const f = fixture(); let resolve;
  const scroll = new CardScroll({ read: () => new Promise(done => { resolve = done; }) });
  const loading = scroll.expand(f.card, f.item);
  f.card.style.getPropertyValue = name => name === '--reply-card-height' ? '150px' : '';
  f.card.getBoundingClientRect = () => ({ height: 450 });
  resolve(source);
  assert.equal(await loading, true);
  assert.equal(f.card.style.maxHeight, '150px', 'undocking must not leave a composer-sized message');
  assert.equal(f.card.dataset.full, undefined, 'loading the whole text does not expand the card');
});
