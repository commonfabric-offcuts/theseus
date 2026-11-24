// Modelled DOM contracts only. Native input and geometry have their own bounded cell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MovedDossiers, movedGroups } from '../web/moved-dossiers.mjs';
import { parseRoute, routeHref, topicTarget } from '../web/topic-navigation.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const pointer = (id, topic = 'destination') => ({ id, root_id: `root-${id}`, topic_id: topic,
  title: `Topic ${topic}`, name: `Dossier ${id}`, actor_id: 'mover', at_ms: 1700000000000 + id });
function fixture() {
  const doc = miniDocument(), host = doc.createElement('div');
  host.root = true;
  const panel = new MovedDossiers({ doc, actorName: id => id === 'mover' ? 'Fixture mover' : id,
    href: (topic, root) => routeHref(root ? topicTarget(topic, root) : { kind: 'topic', id: topic }) });
  return { doc, host, panel };
}

test('1170 admitted roots are grouped by destination once in their returned order', () => {
  const rows = [pointer(1), pointer(2, 'other'), pointer(3), { ...pointer(1), name: 'Latest row' }];
  const groups = movedGroups(rows);
  assert.deepEqual(groups.map(group => [group.id, group.items.map(row => row.root_id)]),
    [['destination', ['root-1', 'root-3']], ['other', ['root-2']]]);
  assert.equal(groups[0].items[0].name, 'Latest row');
});

test('1170 one panel shows admitted totals, recorded names and mover/time as text', () => {
  const { host, panel } = fixture();
  panel.paint(host, [{ ...pointer(1), name: '<img src=x onerror=bad()>' }, { ...pointer(2), name: null }]);
  assert.equal(host.children.length, 1);
  assert.equal(panel.total.textContent, '2');
  const state = panel.groups.get('destination');
  assert.equal(state.items.get('root-1').name.textContent, '<img src=x onerror=bad()>');
  assert.equal(state.items.get('root-2').name.textContent, 'Unnamed dossier');
  assert.ok(state.items.get('root-1').metadata.text.includes('Fixture mover · '));
  assert.equal(state.items.get('root-1').metadata.querySelector('time').dataset.ms, String(pointer(1).at_ms));
  assert.equal(panel.root.querySelector('img'), null);
});

test('1170 four rows remain visible; five show three then expand to the next dossier', () => {
  const { doc, host, panel } = fixture();
  panel.paint(host, [1, 2, 3, 4].map(id => pointer(id)));
  const state = panel.groups.get('destination');
  assert.equal(state.more.hidden, true);
  assert.ok([...state.items.values()].every(item => !item.row.hidden));
  panel.paint(host, [1, 2, 3, 4, 5].map(id => pointer(id)));
  assert.equal(state.more.textContent, '2 more');
  assert.equal(state.more.hidden, false);
  assert.deepEqual([...state.items.values()].map(item => item.row.hidden), [false, false, false, true, true]);
  state.more.onclick();
  assert.ok([...state.items.values()].every(item => !item.row.hidden));
  assert.equal(state.more.hidden, true);
  assert.equal(doc.activeElement, state.items.get('root-4').link);
});

test('1170 refresh preserves expanded controls and focused rows; revoked pointers disappear', () => {
  const { doc, host, panel } = fixture(), pointers = [1, 2, 3, 4, 5].map(id => pointer(id));
  panel.paint(host, pointers);
  const state = panel.groups.get('destination'), row = state.items.get('root-4').link;
  state.more.onclick();
  panel.paint(host, pointers.map(item => ({ ...item, name: 'Renamed ' + item.id })));
  assert.equal(panel.groups.get('destination'), state);
  assert.equal(state.items.get('root-4').link, row);
  assert.equal(doc.activeElement, row);
  assert.equal(state.items.get('root-4').name.textContent, 'Renamed 4');
  assert.equal(state.more.hidden, true);
  panel.paint(host, [pointer(2, 'other')]);
  assert.equal(panel.groups.has('destination'), false);
  assert.equal(row.isConnected, false);
  assert.equal(panel.total.textContent, '1');
  panel.paint(host, []);
  assert.equal(host.children.length, 0);
});

test('1170 destination chips open the topic and dossier rows retain root landing intent', () => {
  const { host, panel } = fixture();
  panel.paint(host, [pointer(1)]);
  const state = panel.groups.get('destination');
  assert.deepEqual(parseRoute(new URL(state.destination.href, 'https://fixture/')), { kind: 'topic', id: 'destination' });
  assert.deepEqual(parseRoute(new URL(state.items.get('root-1').link.href, 'https://fixture/')), topicTarget('destination', 'root-1'));
});

// Give this one model case the two native element properties it exercises.
test('1170 repaint keeps moved panel after a later inserted card', () => {
  const { doc, host, panel } = fixture();
  Object.defineProperty(panel.root, 'parentElement', { get: () => panel.root.parent });
  Object.defineProperty(host, 'lastElementChild', { get: () => host.children.at(-1) ?? null });
  const pointers = [pointer(1)];
  panel.paint(host, pointers);
  const card = doc.createElement('article');
  card.className = 'message-card'; card.dataset.seq = '1';
  host.append(card);
  panel.paint(host, pointers);
  assert.equal(host.lastElementChild, panel.root);
});
