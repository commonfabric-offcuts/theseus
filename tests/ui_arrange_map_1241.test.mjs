import test from 'node:test';
import assert from 'node:assert/strict';
import { StackFeed } from '../web/stack-feed.mjs';
import { DossierHeads } from '../web/stack-order.mjs';
import { stackState } from '../web/reply-stacks.mjs';
import { cardIn } from '../web/fold.mjs';
import { renderer799 } from './fixtures/renderer799.mjs';

// Actual owners with selector-only DOM ports: no native input/layout claim.
function fixture(count = 3) {
  const r = renderer799(), doc = r.list.ownerDocument;
  r.list.id = 'messages'; doc.body = doc.createElement('body'); doc.body.append(r.list);
  doc.querySelector = selector => doc.body.querySelector(selector);
  doc.defaultView = { name: '', sessionStorage: { getItem() { return null; }, setItem() {} } };
  r.add(Array.from({ length: count }, (_, i) => ({ id: 'm' + i, seq: i + 1, author_id: 'person', author_kind: 'human', acts: {} })));
  let loaded = r.messages, copies = 0;
  const heads = new DossierHeads({ topicId: 't', read: () => { throw Error('No source read in this fixture'); } });
  const feed = new StackFeed({ list: r.list, messages: () => { copies++; return heads.messages(loaded); },
    doc, viewer: 'reader', instanceId: 'fixture1241', nameOf: id => id, keep: () => false,
    unread: item => item.id === 'm1', send() { throw Error('Gesture must stay with its command owner'); } });
  return { ...r, doc, feed, heads, copies: () => copies, reset: () => { copies = 0; },
    replace(change) { loaded = new Map([...loaded].map(([id, item]) => [id, change(item)])); return loaded; } };
}

test('1241 actual arrange takes one DossierHeads map for 1, 40 and 300 cards including header and card stars', () => {
  const counts = [];
  for (const n of [1, 40, 300]) {
    const f = fixture(n); f.feed.arrange(); counts.push([n, f.copies()]);
    assert.equal(f.feed.state.stacks.length, n);
    assert.equal(f.feed.drawn.size, n);
  }
  console.log('1241 provider copies', JSON.stringify(counts));
  assert.deepEqual(counts, [[1, 1], [40, 1], [300, 1]]);
});

test('1241 next authoritative map and pending acts replace projections without stale stars or order', () => {
  const f = fixture(); f.feed.arrange();
  const originalOrder = f.feed.state.stacks.map(stack => stack.id);
  f.replace(item => item.id === 'm0' ? { ...item, acts: { starred: true, star_revision: 2 } } : item);
  f.feed.pending.set('m1', [{ starred: true }]); f.reset(); f.feed.arrange();
  assert.deepEqual(f.feed.state.stacks.map(stack => stack.id), originalOrder);
  for (const id of ['m0', 'm1']) assert.equal(cardIn(f.feed.entryFor(id)).querySelector('.card-star').getAttribute('aria-pressed'), 'true');
  assert.equal(f.copies(), 1);
  f.replace(item => ({ ...item, acts: { starred: false, star_revision: 3 } }));
  f.feed.pending.clear(); f.reset(); f.feed.arrange();
  assert.equal(f.copies(), 1);
  assert.equal(cardIn(f.feed.entryFor('m0')).querySelector('.card-star').getAttribute('aria-pressed'), 'false');
});

test('1241 held-place and root level name aside projections retain pending and stand-in truth', () => {
  const f = fixture(), position = { root_id: 'm0', level: null, level_revision: 1, places: [
    { message_id: 'outside', placed: 8, place_revision: 1, at_ms: 1 }], at: { messages: 3, acts: 1 }, order_key: 4, order_entry_key: 4 };
  f.replace(item => item.id === 'm1' ? { ...item, reply_to: 'm0', stack_position: position } : item);
  f.feed.standIns.set('outside', { id: 'outside', dossier: 'm0', acts: { placed: 9, place_revision: 2 } });
  f.feed.pending.set('m0', [{ level: 'open', name: { text: 'Kept' }, aside: null, placed: 2 }]);
  f.feed.pending.set('outside', [{ placed: 3 }]);
  const mark = f.feed.pending.get('outside')[0]; f.feed.made.set(mark, 1);
  let projected; f.feed.arranged = () => { projected = f.feed.shownMessages().get('m1'); };
  f.feed.arrange();
  assert.equal(projected.stack_position.level, 'open');
  assert.equal(projected.stack_position.name.text, 'Kept');
  assert.equal(projected.stack_position.through, null);
  assert.equal(projected.stack_position.placed, 2);
  assert.deepEqual(projected.stack_position.places.map(p => [p.message_id, p.placed]), [['outside', 3]]);
  assert.equal(f.copies(), 1);
});

test('1241 renderer More Earlier fold and reveal continuation takes a new current map per pass', () => {
  const f = fixture(); f.feed.arrange(); const again = f.feed.state.again;
  f.replace(item => ({ ...item, acts: { starred: true } })); f.reset(); again();
  assert.equal(f.copies(), 1);
  assert.equal(cardIn(f.feed.entryFor('m0')).querySelector('.card-star').getAttribute('aria-pressed'), 'true');
  assert.equal(f.feed.arrangeMessages, undefined);
});

test('1241 deferred menu and click Return Space star handlers read current truth after the pass', () => {
  const f = fixture(), seen = []; f.feed.arrange();
  const stack = f.feed.state.stacks.find(s => s.id === 'm0');
  const star = cardIn(f.feed.entryFor('m0')).querySelector('.card-star');
  f.feed.menu = item => seen.push(item.acts.star_revision);
  f.feed.star = item => seen.push(item.acts.star_revision);
  f.replace(item => ({ ...item, acts: { star_revision: 7 } }));
  f.feed.state.on.menu(stack, null);
  star.onclick({ stopPropagation() {} });
  for (const key of ['Enter', ' ']) star.onkeydown({ key, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(seen, [7, 7, 7, 7]);
  assert.equal(f.feed.arrangeMessages, undefined);
});

test('1241 nested arrange restores its outer snapshot and releases both maps afterwards', () => {
  const f = fixture(), seen = []; let nested = false;
  f.feed.arranged = () => {
    seen.push(Boolean(f.feed.actsOf('m0').starred));
    if (!nested) {
      nested = true; f.replace(item => ({ ...item, acts: { starred: true } })); f.feed.arrange();
      seen.push(Boolean(f.feed.actsOf('m0').starred));
    }
  };
  f.feed.arrange();
  assert.deepEqual(seen, [false, true, false]);
  assert.equal(f.copies(), 2);
  assert.equal(f.feed.arrangeMessages, undefined);
  assert.equal(f.feed.actsOf('m0').starred, true);
});

test('1241 failed paint releases its map before the next action and successful arrangement', () => {
  const f = fixture(); f.feed.hold = paint => { paint(); throw Error('paint interrupted'); };
  assert.throws(() => f.feed.arrange(), /paint interrupted/);
  assert.equal(f.feed.arrangeMessages, undefined);
  f.replace(item => ({ ...item, acts: { starred: true } }));
  assert.equal(f.feed.actsOf('m0').starred, true);
  f.feed.hold = paint => paint(); f.reset(); f.feed.arrange(); assert.equal(f.copies(), 1);
});

test('1241 held and New choices survive redraw and raw renderer callers retain their fallback', () => {
  const f = fixture(); f.feed.state.kept.add('m0'); f.feed.state.waiting.add('m1');
  f.feed.state.here.set('m0', { place: 4 }); f.feed.arrange(); f.reset(); f.feed.state.again();
  assert.equal(f.copies(), 1);
  assert.equal(f.feed.state.kept.has('m0'), true);
  assert.equal(f.feed.state.waiting.has('m1'), true);
  assert.equal(f.feed.state.here.get('m0').place, 4);
  const r = renderer799(); r.add([{ id: 'raw', seq: 1 }]);
  const state = stackState(r.list); state.again(); assert.deepEqual(state.stacks.map(s => s.id), ['raw']);
});

test('1241 actual dossier toggle callback enters one current-map arrangement and keeps its level owner', () => {
  const f = fixture(), saved = [];
  f.replace(item => item.id === 'm1' ? { ...item, reply_to: 'm0' } : item);
  f.feed.setDossierLevel = (stack, level) => saved.push([stack.id, level]);
  f.feed.arrange();
  const toggle = f.feed.state.sections.get('m0').querySelector('.stack-toggle');
  assert.ok(toggle);
  const before = toggle.dataset.state;
  f.replace(item => ({ ...item, acts: { starred: true } })); f.reset();
  toggle.onclick();
  assert.equal(saved.length, 1); assert.equal(saved[0][0], 'm0');
  assert.notEqual(toggle.dataset.state, before);
  assert.equal(cardIn(f.feed.entryFor('m0')).querySelector('.card-star').getAttribute('aria-pressed'), 'true');
  assert.equal(f.copies(), 1);
});
