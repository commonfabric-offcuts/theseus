import test from 'node:test';
import assert from 'node:assert/strict';
import { outline1163, star1163, press1163 } from './fixtures/starred_unread_1163.mjs';

test('1163 a dossier count and Return use its oldest unread through the existing outline opener', t => {
  const f = outline1163(t); f.paint([star1163('root')]);
  const link = f.state.links.get('root'), badge = link.querySelector('.unread-count');
  assert.ok(badge); assert.equal(badge.textContent, '2');
  assert.equal(badge.getAttribute('aria-hidden'), 'true');
  assert.equal(badge.title, 'Show the oldest unread message');
  assert.equal(link.tabIndex, -1); assert.equal(badge.getAttribute('tabindex'), null);
  assert.match(link.getAttribute('aria-label'), /Starred dossier: Orchard plan, 2 unread/);
  assert.equal(link.href, '?topic=topic&message=root&land=dossier');
  press1163(link); press1163(link, badge); press1163(link, link, { detail: 0 });
  assert.deepEqual(f.calls.map(c => c.target), [
    { kind: 'topic', id: 'topic', message: 'root', land: 'dossier' },
    { kind: 'topic', id: 'topic', message: 'oldest', land: true },
    { kind: 'topic', id: 'topic', message: 'oldest', land: true },
  ]);
});

test('1163 zero unread removes the badge and stale destination while preserving the focused row', t => {
  const f = outline1163(t); f.paint([star1163('root')]);
  const link = f.state.links.get('root'); link.focus();
  f.paint([star1163('root', 0, null, 'New orchard name')]);
  assert.equal(f.state.links.get('root'), link); assert.equal(f.doc.activeElement, link);
  assert.equal(link.querySelector('.unread-count'), null); assert.equal(link.unreadTarget, null);
  assert.equal(link.getAttribute('aria-label'), 'Starred dossier: New orchard name');
  press1163(link, link, { detail: 0 });
  assert.equal(f.calls[0].target.message, 'root');
});

test('1163 equal names retain distinct dossier counts and duplicate stars retain one row', t => {
  const f = outline1163(t);
  f.paint([star1163('pear', 3, 'pear-old'), star1163('apple', 1, 'apple-old'), star1163('pear', 3, 'pear-old')]);
  assert.equal(f.state.links.size, 2);
  assert.deepEqual(f.state.box.children.map(n => n.dataset.dossierId), ['pear', 'apple']);
  for (const [id, oldest] of [['pear', 'pear-old'], ['apple', 'apple-old']]) {
    const link = f.state.links.get(id); press1163(link, link.querySelector('.unread-count'));
    assert.equal(f.calls.at(-1).target.message, oldest);
  }
});

test('1163 modified pointers keep the ordinary root href and invoke no outline navigation', t => {
  const f = outline1163(t); f.paint([star1163('root')]);
  const link = f.state.links.get('root'), badge = link.querySelector('.unread-count');
  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    assert.equal(press1163(link, badge, extra).defaultPrevented, false);
  }
  assert.deepEqual(f.calls, []); assert.equal(link.href, '?topic=topic&message=root&land=dossier');
});

test('1163 a newly arrived count replaces its oldest target and never adds a second badge', t => {
  const f = outline1163(t); f.paint([star1163('root', 1, 'before')]);
  const link = f.state.links.get('root');
  f.paint([star1163('root', 4, 'after')]);
  assert.equal(link.querySelectorAll('.unread-count').length, 1);
  assert.equal(link.querySelector('.unread-count').textContent, '4');
  press1163(link, link, { detail: 0 }); assert.equal(f.calls[0].target.message, 'after');
});

test('1163 Notebook page stars keep their original page route and have no dossier unread badge', t => {
  const f = outline1163(t, { pages: true });
  f.paint([{ item_id: 'page', owner_scope: { kind: 'workspace', id: 'outcome' }, title: 'Notebook', unread: 7 }]);
  const link = f.state.links.get('page');
  assert.equal(link.querySelector('.unread-count'), null);
  assert.equal(link.getAttribute('aria-label'), 'Starred page: Notebook');
  press1163(link, link, { detail: 0 });
  assert.deepEqual(f.calls[0].target, { kind: 'workspace', id: 'outcome', page: 'page' });
});
