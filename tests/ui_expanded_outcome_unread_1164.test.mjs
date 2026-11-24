import test from 'node:test';
import assert from 'node:assert/strict';
import { OutlineRail, Opened } from '../web/outline-rail.mjs';
import { TopicPages, TopicRail, paintUnread } from '../web/topic-navigation.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

// Real outcome creation, paint, disclosure and Topic rows. Only the DOM,
// transport and unrelated pencil/dossier/dimming ports are modeled. No native
// gesture, layout, timing or server read-state claim follows from this fixture.
function fixture(t, { phone = false, expanded = true, items = null } = {}) {
  const previous = globalThis.document, doc = miniDocument(), make = doc.createElement;
  doc.createElement = tag => {
    const node = make(tag); node.ownerDocument = doc;
    node.contains = other => node === other || [...node.descendants()].includes(other);
    let words = '';
    Object.defineProperties(node, {
      firstChild: { get: () => node.children[0] ?? null },
      lastChild: { get: () => node.children.at(-1) ?? null },
      textContent: { get: () => words, set: value => { words = String(value); node.replaceChildren(); } },
    });
    return node;
  };
  doc.body = doc.createElement('body'); doc.body.root = true;
  doc.defaultView = { matchMedia: () => ({ matches: phone }) };
  doc.getElementById = id => doc.body.querySelector('#' + id);
  doc.addEventListener = () => {};
  globalThis.document = doc; t.after(() => { globalThis.document = previous; });
  const node = (tag = 'div') => doc.createElement(tag), host = node('aside'); doc.body.append(host);
  const header = id => { const el = node('button'); el.id = id; doc.body.append(el); return el; };
  const outcomesHeader = header('rail-open'), buildHeader = header('things-open');
  // The real outline copies the page's pencil; only its SVG port is modeled.
  const pencilGlyph = node('svg'); pencilGlyph.cloneNode = () => node('svg');
  header('new-message').append(pencilGlyph);
  const navigated = [], reads = [], data = items ?? [
    { id: 'w1', title: 'Outcome one', unread: 9, addressed: 3, build: { unread: 4, addressed: 2 }, light: null },
  ];
  const rail = Object.assign(Object.create(OutlineRail.prototype), {
    host, doc, storage: null, run: 1, outcomes: new Map(), opened: new Opened(), filter: null, failed: false,
    pages: { items: data, started: true, next: null }, bootstrap: { instance_id: '1164-fixture', actor: 'reader' }, pageMax: 20,
    handles: { route: { kind: 'topic', id: 'current' }, workspaceId: 'w1' },
    open: (...args) => navigated.push(args),
    // Topic transport is inert by default. Individual cases supply a pending
    // read; badge paint itself must never invoke a Core read or command.
    loadTopics: outcome => { reads.push(outcome.id); return Promise.resolve(true); },
    topicLine() {}, dossiers: { sync() {} }, notebookStars: { sync() {} }, dimming: { paintRows() {} },
  });
  rail.build(); host.hidden = false;
  for (const item of data) rail.opened.set(item.id, expanded);
  rail.paint();
  return { doc, rail, data, node, reads, navigated, outcomesHeader, buildHeader, outcome: rail.outcomes.get('w1') };
}

const badgeCount = host => host.querySelectorAll('.unread-count').length;
const noOutcomeUnread = outcome => {
  assert.equal(badgeCount(outcome.title), 0, 'expanded outcome has no visual unread badge');
  assert.equal(outcome.title.querySelector('.sr-only') === null, true, 'expanded outcome has no spoken unread count');
  assert.equal(outcome.title.text, outcome.item.title, 'only the outcome title remains');
};
const foldedCount = (outcome, unread, addressed) => {
  const badge = outcome.title.querySelector('.unread-count');
  assert.equal(badgeCount(outcome.title), 1, 'folded outcome has one total badge');
  assert.equal(badge.textContent, String(unread));
  assert.equal(badge.classList.contains('addressed'), addressed > 0);
  assert.equal(outcome.title.querySelector('.sr-only').textContent,
    `, ${unread} unread` + (addressed ? `, ${addressed} sent to you by name` : ''));
};
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('1164 initially expanded desktop outcome omits Build unread and spoken count', t => {
  const f = fixture(t); noOutcomeUnread(f.outcome);
  assert.equal(f.outcome.disclosure.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(f.reads, []); assert.deepEqual(f.navigated, []);
});

test('1164 initially expanded phone outcome omits Build unread and spoken count', t => {
  const f = fixture(t, { phone: true }); noOutcomeUnread(f.outcome);
  assert.equal(f.buildHeader.querySelector('.unread-count').textContent, '4');
  assert.equal(f.buildHeader.getAttribute('aria-label'), 'Pipeline & pages, 4 new in Build topics');
});

test('1164 disclosure removes an existing folded badge immediately', async t => {
  const f = fixture(t, { expanded: false }); foldedCount(f.outcome, 9, 3);
  f.outcome.disclosure.onclick({ button: 0, preventDefault() {}, stopPropagation() {} });
  try {
    noOutcomeUnread(f.outcome); assert.equal(f.outcome.topics.hidden, false);
    assert.deepEqual(f.reads, ['w1']);
  } finally { await settle(); }
  noOutcomeUnread(f.outcome);
  assert.deepEqual(f.navigated, []);
});

test('1164 pending Topic load and its completion cannot restore the expanded badge', async t => {
  const f = fixture(t, { expanded: false }); let release;
  f.rail.loadTopics = () => new Promise(resolve => { release = resolve; });
  f.rail.setOpen(f.outcome, true);
  try {
    noOutcomeUnread(f.outcome);
    f.data[0] = { ...f.data[0], unread: 15, addressed: 5, build: { unread: 7, addressed: 2 } };
  } finally { release(true); await settle(); }
  noOutcomeUnread(f.outcome);
  assert.equal(f.rail.newCount.textContent, '15');
});

test('1164 live count refresh keeps an expanded outcome silent while totals update', t => {
  const f = fixture(t), source = structuredClone(f.data[0]);
  f.data[0] = { ...source, unread: 18, addressed: 6, build: { unread: 11, addressed: 4 } };
  const refreshed = structuredClone(f.data[0]); f.rail.paint(); noOutcomeUnread(f.outcome);
  assert.equal(f.rail.newCount.textContent, '18');
  assert.equal(f.outcomesHeader.querySelector('.unread-count').textContent, '18');
  assert.equal(f.buildHeader.querySelector('.unread-count').textContent, '11');
  assert.deepEqual(f.data[0], refreshed, 'painting does not alter Core-supplied counts');
  assert.deepEqual(f.reads, []); assert.deepEqual(f.navigated, []);
});

test('1164 folding restores latest outcome total and addressed words rather than Build subtotal', t => {
  const f = fixture(t);
  f.data[0] = { ...f.data[0], unread: 17, addressed: 5, build: { unread: 2, addressed: 1 } };
  f.rail.paint(); f.rail.setOpen(f.outcome, false); foldedCount(f.outcome, 17, 5);
  assert.equal(f.outcome.disclosure.getAttribute('aria-expanded'), 'false');
  assert.equal(f.outcome.topics.hidden, true); assert.deepEqual(f.reads, []);
});

test('1164 repeated paint and disclosure cycles leave no stale or duplicated unread nodes', async t => {
  const f = fixture(t);
  for (let n = 0; n < 3; n++) {
    f.rail.paint(); noOutcomeUnread(f.outcome);
    f.rail.setOpen(f.outcome, false); f.rail.paint(); foldedCount(f.outcome, 9, 3);
    f.rail.setOpen(f.outcome, true); await settle(); f.rail.paint(); noOutcomeUnread(f.outcome);
  }
  assert.equal(f.rail.outcomes.get('w1') === f.outcome, true, 'same retained outcome owner');
});

test('1164 open all and fold all apply the same badge rule to each outcome', async t => {
  const f = fixture(t, { expanded: false, items: [
    { id: 'w1', title: 'One', unread: 9, addressed: 3, build: { unread: 4 } },
    { id: 'w2', title: 'Two', unread: 6, addressed: 0, build: { unread: 2 } },
  ] });
  f.rail.setAll(true); await settle();
  for (const outcome of f.rail.outcomes.values()) noOutcomeUnread(outcome);
  f.rail.setAll(false);
  foldedCount(f.outcome, 9, 3); foldedCount(f.rail.outcomes.get('w2'), 6, 0);
  assert.equal(f.rail.newCount.textContent, '15');
});

test('1164 New filter retains an outcome whose only unread is in Build topics', t => {
  const f = fixture(t, { expanded: false, items: [
    { id: 'w1', title: 'Build only', unread: 4, addressed: 2, build: { unread: 4, addressed: 2 } },
    { id: 'w2', title: 'Quiet', unread: 0, addressed: 0, build: { unread: 0 } },
  ] });
  f.rail.filter = 'new'; f.rail.paint(); noOutcomeUnread(f.outcome);
  assert.equal(f.outcome.li.hidden, false); assert.equal(f.outcome.li.getAttribute('data-fresh'), '');
  assert.equal(f.rail.outcomes.get('w2').li.hidden, true);
  assert.equal(f.rail.onlyNew.getAttribute('aria-pressed'), 'true');
  assert.equal(f.rail.onlyNew.disabled, false); assert.equal(f.rail.newCount.textContent, '4');
  assert.equal(f.buildHeader.querySelector('.unread-count').textContent, '4');
});

test('1164 child Topic Conversation and dossier unread nodes survive outcome repaint and folding', async t => {
  const f = fixture(t), topic = { id: 't-child', workspace_id: 'w1', title: 'Child Topic', list_position: 2, unread: 3, addressed: 1 };
  const conversation = { id: 't-conversation', workspace_id: 'w1', title: 'Conversation', list_position: 1, unread: 2, addressed: 0 };
  const owner = f.rail.ownRail(f.outcome);
  owner.pages.accept({ instance_id: '1164-fixture', items: [topic, conversation], next_cursor: null }); owner.paint();
  const child = owner.links.get(topic.id), chat = owner.links.get(conversation.id);
  const dossier = f.node('a'); dossier.className = 'dossier-row'; dossier.textContent = 'Kept dossier';
  paintUnread(dossier, { unread: 5, addressed: 1 }); f.outcome.topics.append(dossier);
  const childBadge = child.querySelector('.unread-count'), chatBadge = chat.querySelector('.unread-count'), dossierBadge = dossier.querySelector('.unread-count');
  const facts = JSON.stringify(owner.pages.items);
  f.rail.paint(); noOutcomeUnread(f.outcome); f.rail.setOpen(f.outcome, false); f.rail.setOpen(f.outcome, true); await settle();
  noOutcomeUnread(f.outcome);
  assert.equal(owner instanceof TopicRail, true); assert.equal(owner.pages instanceof TopicPages, true);
  assert.equal(f.outcome.rail === owner, true); assert.equal(owner.links.get(topic.id) === child, true);
  assert.equal(child.querySelector('.unread-count') === childBadge, true); assert.equal(childBadge.textContent, '3');
  assert.equal(chat.querySelector('.unread-count') === chatBadge, true); assert.equal(chatBadge.textContent, '2');
  assert.equal(dossier.querySelector('.unread-count') === dossierBadge, true); assert.equal(dossierBadge.textContent, '5');
  assert.equal(JSON.stringify(owner.pages.items), facts, 'outcome paint never consumes child unread facts');
});

test('1164 disclosure preserves focused outcome name navigation and its pencil', async t => {
  const f = fixture(t, { expanded: false }), name = f.outcome.name, pencil = f.outcome.newTopic, href = name.href;
  name.focus(); f.rail.setOpen(f.outcome, true); await settle(); noOutcomeUnread(f.outcome);
  assert.equal(f.doc.activeElement === name, true); assert.equal(f.outcome.name === name, true);
  assert.equal(f.outcome.newTopic === pencil, true); assert.equal(name.href, href);
  assert.equal(f.outcome.name.getAttribute('aria-controls'), f.outcome.topics.id);
  assert.deepEqual(f.navigated, []);
});

test('1164 outcome standing waiting light and aggregate questions survive badge removal', async t => {
  const f = fixture(t, { phone: true, expanded: false, items: [
    { id: 'w1', title: 'Waiting outcome', unread: 8, addressed: 3, build: { unread: 4 },
      light: { light: 'waiting', short: { kind: 'asks', count: 2 } }, cover_waiting: 1 },
  ] });
  const words = f.outcome.standing.text; f.rail.setOpen(f.outcome, true); await settle(); noOutcomeUnread(f.outcome);
  assert.equal(f.outcome.standing.text, words); assert.equal(f.outcome.standing.dataset.light, 'waiting');
  assert.equal(f.outcome.waiting.hidden, false); assert.equal(f.outcome.li.getAttribute('data-waiting'), '');
  assert.equal(f.rail.waitingCount.textContent, '3'); assert.equal(f.rail.onlyWaiting.disabled, false);
  assert.equal(f.outcomesHeader.getAttribute('aria-label'), 'Outcomes, 8 new, 3 waiting on you');
});
