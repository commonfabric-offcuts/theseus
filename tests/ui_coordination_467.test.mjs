import test from 'node:test';
import assert from 'node:assert/strict';
import { renderer799 } from './fixtures/renderer799.mjs';
import { StackFeed } from '../web/stack-feed.mjs';
import { drawn, reveal, shownStacks } from '../web/reply-stacks.mjs';
import { agentTalk } from '../web/card-reading.mjs';
import { placeNewLine } from '../web/unanswered.mjs';
import { feedKey, onStackControls, messagesSideways } from '../web/panes.mjs';

const tab = (saved = new Map(), name = '') => ({ name, sessionStorage: {
  getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key),
}, crypto: { randomUUID: () => `tab-${++serial}` }, saved });
let serial = 0;
const agent = (id, seq, extra = {}) => ({ id, seq, author_id: 'builder', author_kind: 'agent', addressees: ['reviewer'], ...extra });
const person = (id, seq, extra = {}) => ({ id, seq, author_id: 'reader', author_kind: 'human', addressees: [], ...extra });
function page({ view = tab(), viewer = 'reader', instanceId = 'instance', items = [], news = new Set() } = {}) {
  const r = renderer799(viewer), doc = r.list.ownerDocument;
  doc.body = doc.createElement('body'); doc.defaultView = view; r.list.id = 'messages';
  const host = doc.createElement('div'); host.id = 'agent-coordination-show';
  doc.body.append(host, r.list); r.add(items);
  const commands = [], feed = new StackFeed({ list: r.list, messages: () => r.messages, viewer, instanceId, doc,
    filterHost: host, keep: item => news.has(item.id), unread: item => news.has(item.id), nameOf: id => id,
    quiet: item => agentTalk(item, viewer, 'human', id => ['builder', 'reviewer'].includes(id) ? 'agent' : 'human'),
    send: command => { commands.push(command); throw Error('No Core command belongs to this view choice'); } });
  // No geometry/native input is simulated. These tests exercise the real view/controller callbacks.
  feed.arrange();
  return { ...r, doc, view, host, feed, state: feed.state, commands, news,
    button: () => host.querySelector('button'), add: items => { r.add(items); feed.arrange(); },
    entry: id => [...r.list.descendants()].find(node => node.dataset.id === id) };
}

test('467 starts off, an explicit flip survives reload in this tab, a fresh or opener-cloned tab starts off', () => {
  const view = tab(), f = page({ view, items: [agent('a', 1)] });
  assert.equal(f.state.showCoordination, false, 'off is the shipped default');
  assert.equal(drawn(f.list, 'a'), false);
  f.button().onclick(); assert.equal(f.state.showCoordination, true); assert.equal(drawn(f.list, 'a'), true);
  const reload = page({ view: tab(view.saved, view.name), items: [agent('a', 1)] });
  assert.equal(reload.state.showCoordination, true, 'reload retains explicit On');
  for (const next of [tab(), tab(new Map(view.saved))]) {
    assert.equal(page({ view: next, items: [agent('a', 1)] }).state.showCoordination, false, 'new tab starts Off, including copied opener storage');
  }
  assert.equal(page({ view, viewer: 'another-reader' }).state.showCoordination, false);
  assert.equal(page({ view, instanceId: 'another-instance' }).state.showCoordination, false);
  reload.button().onclick(); assert.equal(page({ view: tab(view.saved, view.name) }).state.showCoordination, false, 'explicit Off also survives reload');
  assert.deepEqual(f.commands, []);
});

test('467 a link reveals only its target dossier for the visit and does not remember On', () => {
  const view = tab(), f = page({ view, items: [agent('a', 1), agent('b', 2)] });
  f.state.showCoordination = false; f.feed.arrange();
  reveal(f.entry('a'));
  assert.equal(drawn(f.list, 'a'), true, 'linked target is reachable');
  assert.equal(drawn(f.list, 'b'), false, 'other coordination stays hidden');
  assert.equal(f.button().getAttribute('aria-pressed'), 'false', 'link does not flip the pill');
  assert.equal(page({ view: tab(view.saved, view.name), items: [agent('a', 1)] }).state.showCoordination, false);
  f.button().onclick(); f.button().onclick();
  assert.equal(drawn(f.list, 'a'), false, 'explicit Off clears the visit reveal');
  assert.deepEqual(f.commands, []);
});

test('467 arrivals update count and news without flipping, revealing, lifting or reordering coordination', () => {
  const f = page({ items: [person('p', 3), agent('a', 1)] });
  f.state.showCoordination = false; f.feed.arrange();
  f.news.add('r'); f.add([agent('r', 4, { reply_to: 'a', reply_to_author: 'builder' })]);
  assert.equal(f.button().textContent, 'Show agent coordination (1)');
  assert.equal(f.button().dataset.news, 'true', 'new reply lights news even with unchanged dossier count');
  assert.equal(f.state.showCoordination, false); assert.equal(drawn(f.list, 'r'), false);
  assert.deepEqual(shownStacks(f.state).map(stack => stack.id), ['p']);
  f.add([agent('b', 5)]); assert.equal(f.button().textContent, 'Show agent coordination (2)');
  const ordered = f.state.stacks.map(stack => stack.id);
  f.button().onclick(); assert.deepEqual(shownStacks(f.state).map(stack => stack.id), ordered, 'On keeps the existing interleaved order');
  f.add([agent('s', 6, { reply_to: 'a', reply_to_author: 'builder' })]); assert.equal(f.state.showCoordination, true);
  f.button().onclick();
  f.add([agent('human-directed', 7, { reply_to: 'a', reply_to_author: 'builder', addressees: ['reader'] })]);
  assert.equal(drawn(f.list, 'human-directed'), true, 'human-directed reply ceases to be hidden coordination');
  assert.deepEqual(f.commands, []);
});

test('467 shared row preserves Archived counting and opening under the latest ruling', () => {
  const below = id => ({ root_id: id, below: true, through: 20, aside_revision: 1, at: { acts: 1, messages: 20 } });
  const f = page({ items: [person('p', 1, { stack_position: below('p') }), agent('a', 2, { stack_position: below('a') })] });
  f.state.showCoordination = false; f.feed.arrange();
  assert.equal(f.state.more.textContent, 'Archived (1)');
  assert.ok(f.host.parentElement === f.state.more.parentElement, 'coordination and Archived share one row');
  assert.equal(f.host.parentElement.className, 'stack-controls');
  assert.deepEqual(f.host.parentElement.children, [f.state.more, f.host], 'Archived left, pill right');
  f.state.more.onclick(); assert.equal(f.state.moreOpen, true); assert.equal(drawn(f.list, 'a'), false);
  f.button().onclick(); assert.equal(f.state.more.textContent, 'Archived (2)'); assert.equal(drawn(f.list, 'a'), true);
  f.state.more.onclick(); assert.equal(drawn(f.list, 'a'), false); assert.equal(f.state.showCoordination, true);
  const only = page({ items: [agent('a', 2, { stack_position: below('a') })] });
  assert.equal(only.host.hidden, false, 'pill appears without ordinary archived dossiers');
  assert.ok(!only.state.more?.isConnected, 'hidden archived coordination does not count');
  only.button().onclick(); assert.equal(only.state.more.textContent, 'Archived (1)');
  assert.equal(drawn(only.list, 'a'), false, 'Archived still opens archived coordination');
  only.state.more.onclick(); assert.equal(drawn(only.list, 'a'), true);
});

test('467 links into archived coordination reveal one dossier without opening Archived or saving a choice', () => {
  const position = id => ({ root_id: id, below: true, through: 10, aside_revision: 1, at: { acts: 1, messages: 10 } });
  const f = page({ items: [agent('a', 1, { stack_position: position('a') }), agent('b', 2, { stack_position: position('b') })] });
  reveal(f.entry('a'));
  assert.equal(drawn(f.list, 'a'), true); assert.equal(drawn(f.list, 'b'), false);
  assert.equal(Boolean(f.state.moreOpen), false); assert.equal(f.state.showCoordination, false);
  assert.equal(f.view.saved.size, 0, 'link writes no tab preference'); assert.deepEqual(f.commands, []);
});

test('467 the New line stays above the shared controls and archived dossiers', () => {
  const f = page({ items: [person('p', 10), person('old', 20, { stack_position: { root_id: 'old', below: true, through: 20, aside_revision: 1, at: { acts: 1, messages: 20 } } })] });
  const line = placeNewLine(f.list, 5, f.doc, () => {});
  const index = f.list.children.indexOf(f.state.controls);
  assert.ok(f.list.children[index - 1] === line, 'More new below stops above the Archive row');
});

test('467 blocked tab storage keeps the visit choice without a Core write or an older recalled value', () => {
  const view = tab(); view.name = 'existing-window';
  const f = page({ view, items: [agent('a', 1)] }); f.button().onclick();
  assert.ok(view.name.startsWith('existing-window;'), 'existing window name is retained');
  view.sessionStorage.setItem = () => { throw Error('storage blocked'); };
  f.button().onclick(); assert.equal(f.state.showCoordination, false);
  assert.equal(page({ view: tab(view.saved, view.name) }).state.showCoordination, false, 'failed Off clears only its stale On key');
  f.button().onclick(); assert.equal(f.state.showCoordination, true, 'the current visit still responds');
  assert.deepEqual(f.commands, []);
});

test('467 left and right move between the actual shared-row controls', () => {
  const f = page({ items: [person('p', 1, { stack_position: { root_id: 'p', below: true, through: 1, aside_revision: 1, at: { acts: 1, messages: 1 } } }), agent('a', 2)] });
  // Only policy/focus calls: rectangles below do not prove native geometry or keyboard events.
  f.doc.querySelector = () => null; f.doc.getSelection = () => ({ isCollapsed: true });
  Object.assign(f.view, { innerHeight: 800, getComputedStyle: () => ({}), scrollBy() {} });
  const oldGet = f.doc.getElementById; f.doc.getElementById = id => id === 'messages' ? f.list : oldGet(id);
  for (const button of [f.state.more, f.button()]) {
    const closest = button.closest.bind(button); button.closest = selector => selector.includes('input,') || selector === '.reply-stack > .stack-tools' ? null : closest(selector);
    button.getClientRects = () => [{}]; button.scrollIntoView = () => {};
    button.getBoundingClientRect = () => ({ top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20 });
  }
  f.state.more.focus(); assert.equal(onStackControls(f.doc.activeElement), true); assert.equal(messagesSideways(f.doc.activeElement, f.doc), false);
  const press = key => ({ key, target: f.doc.activeElement, preventDefault() { this.defaultPrevented = true; } });
  const right = press('ArrowRight'); assert.equal(feedKey(right, f.doc), true); assert.ok(f.doc.activeElement === f.button()); assert.equal(right.defaultPrevented, true);
  const left = press('ArrowLeft'); assert.equal(feedKey(left, f.doc), true); assert.ok(f.doc.activeElement === f.state.more);
});
