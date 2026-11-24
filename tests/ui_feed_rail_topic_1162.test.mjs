import test from 'node:test';
import assert from 'node:assert/strict';
import { OutlineRail, Opened } from '../web/outline-rail.mjs';
import { KeyTree } from '../web/key-tree.mjs';
import { panes, feedKey } from '../web/panes.mjs';
import { miniDocument, matches } from './fixtures/mini_dom.mjs';

// Real pane routing, outline rows/opening/focus and roving tree methods.
// DOM visibility, repaint and transport are bounded ports, not native input.
function fixture(t, { state = 'visible', top = 430, missing = false, topic = true } = {}) {
  const doc = miniDocument(), make = doc.createElement;
  doc.createElement = tag => {
    const el = make(tag);
    Object.defineProperties(el, { ownerDocument: { get: () => doc }, parentElement: { get: () => el.parent } });
    el.hasAttribute = name => el.getAttribute(name) !== null;
    el.contains = node => el === node || [...el.descendants()].includes(node);
    el.matches = selector => selector.split(',').some(part => {
      const simple = part.trim(); return !simple.includes(' ') && !simple.includes('>') && matches(el, simple);
    });
    el.closest = selector => { for (let at = el; at; at = at.parent) if (at.matches(selector)) return at; return null; };
    el.checkVisibility = () => {
      for (let at = el; at; at = at.parent) {
        if (at.hidden) return false;
        if (at.tagName === 'DETAILS' && !at.open && el !== at.querySelector(':scope > summary')) return false;
      }
      return true;
    };
    el.getBoundingClientRect = () => el.box ?? { left: 0, right: 280, top: 100, bottom: 140, width: 280, height: 40 };
    el.getClientRects = () => el.checkVisibility() ? [el.getBoundingClientRect()] : [];
    return el;
  };
  doc.body = doc.createElement('body'); doc.body.root = true; doc.documentElement = doc.body;
  doc.defaultView = { innerWidth: 1400, innerHeight: 900, matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ position: 'static', overflowY: 'visible', overflowX: 'visible' }), scrollBy() {} };
  doc.getElementById = id => doc.body.querySelector('#' + id);
  doc.querySelector = selector => selector.startsWith('#main >') ? null : doc.body.querySelector(selector);
  const host = doc.createElement('aside'), list = doc.createElement('ul'), newOutcome = doc.createElement('button');
  host.id = 'outline'; host.box = { left: 0, right: 280, top: 0, bottom: 900, width: 280, height: 900 };
  host.append(newOutcome, list); doc.body.append(host);
  const rail = Object.assign(Object.create(OutlineRail.prototype), { host, list, newOutcome, doc, run: 1,
    handles: { route: { kind: topic ? 'topic' : 'conversation' }, workspaceId: 'here', topic: topic ? { id: 'current', workspace_id: 'here' } : null },
    opened: new Opened(), filter: state === 'filtered' ? 'new' : null, outcomes: new Map(), reads: [] });
  const outcome = id => {
    const li = doc.createElement('li'), name = doc.createElement('a'), topics = doc.createElement('div'), newTopic = doc.createElement('button');
    li.dataset.workspaceId = id; name.setAttribute('href', '?outcome=' + id); topics.append(newTopic); li.append(name, topics); list.append(li);
    const row = { id, li, name, topics, newTopic }; rail.outcomes.set(id, row); return row;
  };
  const other = outcome('other'), here = outcome('here');
  const previous = doc.createElement('a'); previous.dataset.topicId = 'previous'; previous.setAttribute('href', '?topic=previous'); other.topics.append(previous);
  const current = doc.createElement('a'); current.dataset.topicId = 'current'; current.setAttribute('href', '?topic=current'); current.setAttribute('aria-current', 'page');
  let group = null;
  if (state === 'done' || state === 'archived') {
    group = doc.createElement('details'); group.className = 'topic-group'; group.open = false;
    const summary = doc.createElement('summary'); group.append(summary); here.topics.append(group);
  }
  if (!missing) (group ?? here.topics).append(current);
  rail.opened.set('other', true); rail.opened.set('here', state !== 'folded');
  // Paint only projects the kept open/filter state onto these supplied rows.
  rail.paint = () => {
    for (const row of rail.outcomes.values()) {
      row.li.hidden = row.id === 'here' && rail.filter === 'new';
      const open = rail.isOpen(row.id); row.li.toggleAttribute('data-open', open); row.topics.hidden = !open;
    }
  };
  rail.loadTopics = async row => { rail.reads.push(row.id); };
  rail.paint();
  rail.tree = Object.assign(Object.create(KeyTree.prototype), { doc, root: list, rows: () => rail.treeRows(),
    current: previous, currentKey: 'other|topic:previous', chosen: true, wanted: false, marked: new Set(), placing: false });
  const main = doc.createElement('main'), messages = doc.createElement('div'), card = doc.createElement('article');
  main.id = 'main'; messages.id = 'messages'; card.className = 'message-card'; card.dataset.id = 'message';
  card.box = { left: 320, right: 1000, top, bottom: top + 40, width: 680, height: 40 };
  messages.append(card); main.append(messages); doc.body.append(main);
  const kept = { outline: panes.outline, center: panes.center, things: panes.things, notebook: panes.notebook };
  Object.assign(panes, { outline: rail, center: null, things: null, notebook: null }); t.after(() => Object.assign(panes, kept));
  let navigated = 0;
  const press = (extra = {}) => {
    const event = { key: 'ArrowLeft', target: doc.activeElement, ...extra, preventDefault() { this.defaultPrevented = true; } };
    const moved = feedKey(event, doc, () => { navigated++; }); return { event, moved };
  };
  card.focus(); return { doc, rail, current, previous, here, other, group, card, host, press, navigation: () => navigated };
}

for (const top of [60, 430, 930]) for (const state of ['folded', 'done', 'archived', 'filtered']) {
  test(`1162 feed at ${top} enters current Topic through ${state}`, t => {
    const f = fixture(t, { top, state }), result = f.press();
    assert.equal(f.doc.activeElement, f.current);
    assert.equal(result.moved, true); assert.equal(result.event.defaultPrevented, true);
    assert.equal(f.rail.tree.currentKey, 'here|topic:current'); assert.equal(f.navigation(), 1);
    assert.equal(f.rail.isOpen('here'), true); assert.equal(f.rail.isOpen('other'), true);
    assert.equal(f.rail.filter, null); if (f.group) assert.equal(f.group.open, true);
  });
}

test('1162 an already visible current Topic wins over the rail previous row', t => {
  const f = fixture(t); f.press(); assert.equal(f.doc.activeElement, f.current); assert.equal(f.navigation(), 1);
});
test('1162 entry leaves a visible current Topic under the existing Waiting filter', t => {
  const f = fixture(t); f.rail.filter = 'waiting'; f.press();
  assert.equal(f.doc.activeElement, f.current); assert.equal(f.rail.filter, 'waiting'); assert.deepEqual(f.rail.reads, []);
});
test('1162 ordinary rail entry keeps its previous row and folded outcome', t => {
  const f = fixture(t, { state: 'folded' }); f.rail.focus();
  assert.equal(f.doc.activeElement, f.previous); assert.equal(f.rail.isOpen('here'), false);
});
test('1162 a Conversation without a current Topic keeps the existing fallback', t => {
  const f = fixture(t, { topic: false, state: 'folded', missing: true }); f.press();
  assert.equal(f.doc.activeElement, f.previous); assert.equal(f.rail.isOpen('here'), false);
});
test('1162 a current Topic not owned by the left rail creates no replacement row', t => {
  const f = fixture(t, { missing: true }); const before = f.here.topics.children.length; f.press();
  assert.equal(f.doc.activeElement, f.previous); assert.equal(f.here.topics.children.length, before);
});
test('1162 writing composition modifiers and an open dialog retain their own keys', t => {
  const f = fixture(t, { state: 'folded' }), field = f.doc.createElement('textarea'); field.value = 'Kept words'; f.card.append(field);
  field.focus(); assert.equal(f.press().moved, false); assert.equal(f.doc.activeElement, field); assert.equal(field.value, 'Kept words');
  f.card.focus();
  for (const extra of [{ isComposing: true }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) assert.equal(f.press(extra).moved, false);
  const dialog = f.doc.createElement('dialog'); dialog.setAttribute('open', ''); f.doc.body.append(dialog);
  assert.equal(f.press().moved, false); assert.equal(f.doc.activeElement, f.card); assert.equal(f.rail.isOpen('here'), false); assert.equal(f.navigation(), 0);
});
test('1162 a hidden or inert left rail is not opened by feed entry', t => {
  const f = fixture(t, { state: 'folded' });
  f.host.hidden = true; assert.equal(f.press().moved, false); f.host.hidden = false;
  f.host.setAttribute('inert', ''); assert.equal(f.press().moved, false);
  assert.equal(f.doc.activeElement, f.card); assert.equal(f.rail.isOpen('here'), false); assert.equal(f.navigation(), 0);
});
