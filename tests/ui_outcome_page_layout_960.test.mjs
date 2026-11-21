import test from 'node:test';
import assert from 'node:assert/strict';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { OutcomePageLayout } from '../web/outcome-page-layout.mjs';

function fixture() {
  const doc = miniDocument(), make = doc.createElement;
  doc.createElement = tag => {
    const node = make(tag); node.ownerDocument = doc;
    Object.defineProperty(node, 'parentNode', { get: () => node.parent });
    Object.defineProperty(node, 'nextSibling', { get: () => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null });
    return node;
  };
  const header = doc.createElement('header'), team = doc.createElement('section'), host = doc.createElement('main');
  header.append(team);
  return { header, team, host, doc, cards: { filter() {} }, reader: 'reader', color: () => 'olive' };
}

test('960 a host without matchMedia draws the existing narrow layout and disposes safely', t => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  Object.defineProperty(globalThis, 'matchMedia', { value: undefined, writable: true, configurable: true });
  t.after(() => { if (before) Object.defineProperty(globalThis, 'matchMedia', before); else delete globalThis.matchMedia; });
  const f = fixture(); let page;
  assert.doesNotThrow(() => { page = new OutcomePageLayout(f); });
  const modes = []; page.setPurpose({ layout: wide => modes.push(wide) });
  assert.equal(f.team.parentNode, f.header);
  assert.equal(f.host.getAttribute('data-outcome-wide'), null);
  assert.equal(f.host.children.length, 0, 'the narrow page gains no wide-only section');
  assert.deepEqual(modes, [false]);
  assert.doesNotThrow(() => page.dispose());
});

test('960 a media result without event methods can draw and dispose', () => {
  const f = fixture(), page = new OutcomePageLayout({ ...f, media: { matches: true } });
  assert.equal(f.team.parentNode, page.section);
  assert.equal(f.host.getAttribute('data-outcome-wide'), '');
  assert.doesNotThrow(() => page.dispose());
});

test('960 a real media change restores Team and its purpose owner, then removes its listener', () => {
  const f = fixture(), events = new Map(), media = { matches: true,
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name, callback) => { assert.equal(events.get(name), callback); events.delete(name); } };
  const page = new OutcomePageLayout({ ...f, media }), modes = [];
  page.setPurpose({ layout: wide => modes.push(wide) });
  media.matches = false; events.get('change')();
  assert.equal(f.team.parentNode, f.header); assert.deepEqual(modes, [true, false]);
  assert.equal(page.section.parentNode, null);
  assert.equal(f.host.getAttribute('data-outcome-wide'), null);
  page.dispose(); assert.equal(events.size, 0);
});

// 997: below 1100px the bench is three tabs. The layout names the chosen tab on its host (the style sheet shows that
// part alone), counts each part, keeps the choice per outcome for the visit, and hides a part the reader cannot see.
const tabsOf = page => Object.fromEntries([...page.tabButtons].map(([key, { button, count }]) => [key, { selected: button.getAttribute('aria-selected'), hidden: Boolean(button.hidden), count: count.textContent }]));
const presentation = (active, more = null, done = 0) => ({ groups: [
  { name: 'active', toggle: null, more, rows: Array.from({ length: active }, (_, n) => ({ item: { id: `t${n}` } })) },
  { name: 'done', toggle: () => {}, more: null, rows: Array.from({ length: done }, (_, n) => ({ item: { id: `d${n}` } })) }] });

test('997 the tabs open on Topics, count each part, and name the chosen part on the host', () => {
  const f = fixture(), page = new OutcomePageLayout({ ...f, scope: 'w997-counts', media: { matches: true } });
  assert.ok(f.host.children.includes(page.tabs), 'the tabs belong to the bench');
  assert.equal(f.host.dataset.outcomeTab, 'topics');
  page.topics(presentation(25, () => {}, 3)); page.members([{ actor_id: 'reader', kind: 'human' }, { actor_id: 'a1', kind: 'agent' }]);
  page.notes({ count: 6, more: false, shown: true });
  assert.deepEqual(tabsOf(page), { topics: { selected: 'true', hidden: false, count: '25+' }, agents: { selected: 'false', hidden: false, count: '2' }, notes: { selected: 'false', hidden: false, count: '6' } });
  page.topics(presentation(4, null, 3));
  assert.equal(tabsOf(page).topics.count, '4', 'done topics are not counted, and no + without more to load');
  page.tabButtons.get('notes').button.onclick();
  assert.equal(f.host.dataset.outcomeTab, 'notes');
  assert.deepEqual(Object.values(tabsOf(page)).map(tab => tab.selected), ['false', 'false', 'true']);
});

test('997 the chosen tab is kept per outcome for the visit, and a new outcome opens on Topics', () => {
  const f = fixture(), first = new OutcomePageLayout({ ...f, scope: 'w997-kept', media: { matches: true } });
  first.members([{ actor_id: 'a1', kind: 'agent' }]); first.choose('agents'); first.dispose();
  const again = fixture(), back = new OutcomePageLayout({ ...again, scope: 'w997-kept', media: { matches: true } });
  assert.equal(again.host.dataset.outcomeTab, 'agents', 'before the team has loaded, the kept tab already shows');
  back.members([{ actor_id: 'a1', kind: 'agent' }]);
  assert.equal(again.host.dataset.outcomeTab, 'agents');
  const other = fixture(); new OutcomePageLayout({ ...other, scope: 'w997-other', media: { matches: true } });
  assert.equal(other.host.dataset.outcomeTab, 'topics');
});

test('997 a part the reader cannot see has no tab, and its chosen tab falls back to Topics', () => {
  const f = fixture(), page = new OutcomePageLayout({ ...f, scope: 'w997-hidden', media: { matches: true } });
  page.members([{ actor_id: 'a1', kind: 'agent' }]); page.notes({ count: 2, more: true, shown: true });
  page.choose('notes'); assert.equal(tabsOf(page).notes.count, '2+');
  page.notes({ count: 0, more: false, shown: false });
  assert.equal(tabsOf(page).notes.hidden, true); assert.equal(f.host.dataset.outcomeTab, 'topics');
  page.notes({ count: 1, more: false, shown: true });
  assert.equal(f.host.dataset.outcomeTab, 'notes', 'the choice stands for when the part returns');
  page.members([]); assert.equal(tabsOf(page).agents.hidden, true);
});

test('997 arrow keys move between the visible tabs; picking an agent shows its topics', () => {
  const f = fixture(); let filtered = 'unset'; f.cards = { filter: actor => { filtered = actor; } };
  const page = new OutcomePageLayout({ ...f, scope: 'w997-keys', media: { matches: true } });
  page.members([{ actor_id: 'a1', kind: 'agent', name: 'auditor' }]); page.notes({ count: 1, more: false, shown: true });
  const key = name => { let stopped = false; page.tabs.listeners.keydown({ key: name, preventDefault: () => { stopped = true; } }); return stopped; };
  assert.equal(key('ArrowRight'), true); assert.equal(f.host.dataset.outcomeTab, 'agents');
  key('ArrowRight'); assert.equal(f.host.dataset.outcomeTab, 'notes');
  key('ArrowRight'); assert.equal(f.host.dataset.outcomeTab, 'topics', 'the arrows wrap');
  key('ArrowLeft'); assert.equal(f.host.dataset.outcomeTab, 'notes');
  assert.equal(key('Enter'), false, 'other keys are left alone'); assert.equal(f.host.dataset.outcomeTab, 'notes');
  page.choose('agents'); page.rows.get('a1').button.onclick();
  assert.equal(filtered, 'a1'); assert.equal(f.host.dataset.outcomeTab, 'topics');
  page.choose('agents'); page.rows.get('a1').button.onclick();
  assert.equal(filtered, null); assert.equal(f.host.dataset.outcomeTab, 'agents', 'clearing the filter stays where you are');
});
