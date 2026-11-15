// Inside an outcome the side rail shows only that outcome, under the logo
// block that tops every page now that there is no header bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OutcomeScope, RAIL_ORDER, railShown, elsewhereWaiting, elsewhereWords, wordsShown, placeBrand } from '../web/outcome-scope.mjs';
import { Attention } from '../web/attention.mjs';

// A small tree: enough of the DOM for the rail's nodes to move, never copy.
function page() {
  const byId = new Map();
  class Node {
    constructor(tag, id = '', className = '') { Object.assign(this, { tagName: tag, id, className, children: [], parentNode: null, hidden: false, attributes: {}, dataset: {}, textContent: '' }); if (id) byId.set(id, this); }
    get ownerDocument() { return doc; }
    cloneNode() { return new Node(this.tagName, '', this.className); }
    append(...items) { for (const item of items) { item.parentNode?.children.splice(item.parentNode.children.indexOf(item), 1); item.parentNode = this; this.children.push(item); } }
    prepend(...items) { for (const item of items) { item.parentNode?.children.splice(item.parentNode.children.indexOf(item), 1); item.parentNode = this; } this.children.unshift(...items); }
    after(...items) { const host = this.parentNode; for (const item of items) { item.parentNode?.children.splice(item.parentNode.children.indexOf(item), 1); item.parentNode = host; } host.children.splice(host.children.indexOf(this) + 1, 0, ...items); }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelector(selector) { return this.all().find(node => matches(node, selector)) ?? null; }
    querySelectorAll(selector) { return this.all().filter(node => selector.split(',').some(part => matches(node, part.trim()))); }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
  }
  const matches = (node, selector) => selector.startsWith('#') ? node.id === selector.slice(1) : selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1)) : false;
  const body = new Node('body');
  const doc = { body, getElementById: id => byId.get(id) ?? null, querySelector: selector => body.querySelector(selector), createElement: tag => new Node(tag) };
  const el = (tag, id, className, host) => { const node = new Node(tag, id, className); host.append(node); return node; };
  const rail = el('nav', '', 'rail', body), main = el('main', 'main', '', body);
  rail.setAttribute('aria-label', 'Outcomes and topics');
  const brand = el('div', '', 'brand', rail), wordmark = el('a', '', 'wordmark', brand);
  el('span', 'instance-label', '', brand); el('button', 'notify', '', brand);
  for (const id of ['app-status', 'wakes-status', 'updates-status']) el('div', id, 'notice', rail);
  const home = el('a', 'outcomes-home', '', rail); home.textContent = '← Outcomes';
  el('div', 'topic-navigation-status', 'notice', rail);
  const outcomes = el('section', 'outcome-navigation', '', rail); el('h2', 'outcomes-heading', '', outcomes); el('button', 'new-outcome', '', outcomes);
  const topics = el('section', 'topic-navigation', '', rail); el('button', 'new-topic', '', topics); el('div', 'topics', '', topics);
  // Sections the conversation, pipeline and skills pieces add, as nodes in the rail.
  const conversation = el('section', 'conversation-row', '', rail), pipeline = el('section', 'pipeline-row', '', rail), skills = el('section', 'skills-navigation', '', rail);
  return { doc, rail, main, brand, wordmark, home, outcomes, topics, conversation, pipeline, skills, byId };
}
const ids = host => host.children.map(node => node.id || node.className);
// lastHere: the outcome the last answer was read about (null: none).
const attention = () => ({ here: null, last: null, lastHere: null, refreshed: 0, listeners: [], listen(fn) { this.listeners.push(fn); }, refresh() { this.refreshed++; },
  answer(value, about = this.here) { this.last = value; this.lastHere = about; for (const fn of this.listeners) fn(value); } });

test('inside an outcome the rail hides the outcomes list, says "This outcome", and orders its sections', () => {
  const p = page(), opened = [];
  const sections = [{ name: 'skills', node: p.skills }, { name: 'topics', node: p.topics },
    { name: 'pipeline', node: p.pipeline }, { name: 'conversation', node: p.conversation }];
  new OutcomeScope({ workspaceId: 'w1', kind: 'topic', rail: p.rail, home: p.home, sections, open: (target, title) => opened.push([target, title]) });
  assert.equal(p.outcomes.hidden, true, 'no list of outcomes, no Outcomes heading, no New outcome');
  assert.equal(p.topics.hidden, false); assert.equal(p.byId.get('new-topic').hidden, false, 'New topic stays');
  assert.equal(p.rail.getAttribute('aria-label'), 'This outcome');
  // The outcome's Notebook is no section of the side rail (item 464): the right rail and the outcome's own page list it.
  assert.deepEqual(RAIL_ORDER, ['conversation', 'pipeline', 'topics', 'skills']);
  assert.deepEqual(ids(p.rail).filter(id => id !== 'outcome-navigation'),
    ['brand', 'app-status', 'wakes-status', 'updates-status', 'outcomes-home', 'topic-navigation-status', 'conversation-row', 'pipeline-row', 'topic-navigation', 'skills-navigation']);
  for (const control of [p.home, p.wordmark]) {
    assert.equal(typeof control.onclick, 'function', 'each opens the Outcomes home');
    let prevented = false;
    control.onclick({ button: 0, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    control.onclick({ button: 0, metaKey: true, preventDefault() { throw Error('a modified click is the browser\'s'); } });
  }
  assert.deepEqual(opened, [[{ kind: 'root' }, 'Outcomes'], [{ kind: 'root' }, 'Outcomes']], '← Outcomes and the wordmark open the Outcomes home');
});

test('the rail places only the sections it is given, and loads each one', async () => {
  const p = page(), loads = [];
  const scope = new OutcomeScope({ workspaceId: 'w1', kind: 'opening', rail: p.rail, home: p.home, open() {},
    sections: [{ name: 'skills', node: p.skills, load: () => { loads.push('skills'); return true; } }, { name: 'topics', node: p.topics, load: () => { loads.push('topics'); return false; } }] });
  const at = id => ids(p.rail).indexOf(id);
  assert.ok(at('topic-navigation-status') < at('topic-navigation') && at('topic-navigation') < at('skills-navigation'), 'topics, then skills, under "← Outcomes"');
  assert.equal(await scope.load(), false, 'a section that could not be read makes the load false');
  assert.deepEqual(loads.sort(), ['skills', 'topics']);
});

test('how many other outcomes wait on the reader', () => {
  const answer = (count, here) => ({ waiting_outcomes: { count, here } });
  assert.equal(elsewhereWaiting(answer(1, true)), 0, 'only this outcome waits');
  assert.equal(elsewhereWaiting(answer(1, false)), 1);
  assert.equal(elsewhereWaiting(answer(0, false)), 0);
  assert.equal(elsewhereWaiting(answer(7, true)), 6);
  assert.equal(elsewhereWaiting(answer(7, false)), 7);
  assert.equal(elsewhereWaiting({}), 0, 'an older server says nothing waits elsewhere');
  assert.equal(elsewhereWords(1), '1 other outcome is waiting on you');
  assert.equal(elsewhereWords(2), '2 other outcomes are waiting on you');
});

test('the rail shows on every page inside an outcome but the outcome\'s own, and a tool page the reader cannot see the home of', () => {
  for (const kind of ['topic', 'opening', 'pipeline', 'skill']) assert.equal(railShown(kind), true, kind);
  assert.equal(railShown('workspace'), false);
  assert.equal(railShown('skill', false), false, 'a non-member\'s tool page');
  assert.equal(railShown('skill', true), true, 'a member\'s tool page');
  assert.equal(wordsShown('workspace'), false, 'the outcome page before its Also-waiting line has been read');
  for (const kind of ['topic', 'opening', 'pipeline', 'skill']) assert.equal(wordsShown(kind), true, kind);
  // On the outcome page: the words show while the line names fewer outcomes than the light counts.
  assert.equal(wordsShown('workspace', 1, 0), true);
  assert.equal(wordsShown('workspace', 2, 1), true);
  assert.equal(wordsShown('workspace', 2, 2), false);
  assert.equal(wordsShown('workspace', 1, null), false);
  for (const kind of ['topic', 'opening', 'pipeline', 'skill']) assert.equal(wordsShown(kind, 1, 1), true, kind + ' whatever a line names');
});

// The light counts every wait on the reader; the outcome page's "Also waiting
// on you" line names only outcomes the reader can list (those whose team they
// are on, the first page of them). A wait the line cannot name is said by the
// light's own words, there as everywhere else.
test('on its own page "← Outcomes" says its words whenever the Also-waiting line names fewer outcomes than the light counts', () => {
  const p = page(), a = attention();
  const scope = new OutcomeScope({ workspaceId: 'w5', kind: 'workspace', rail: p.rail, home: p.home, attention: a, open() {} });
  const light = p.home.querySelector('.outcome-light'), words = p.home.querySelector('.elsewhere-words');
  // A wait in w6, whose team the reader is not on: the light counts it.
  a.answer({ waiting_outcomes: { count: 1, here: false } });
  assert.equal(light.hidden, false, 'the light');
  assert.equal(words.hidden, true, 'until the line has been read the page does not guess, so nothing jumps');
  scope.alsoNamed(0);
  assert.equal(words.hidden, false, 'the line names none of them: the words say it');
  assert.equal(words.textContent, '1 other outcome is waiting on you');
  // Two others, one past the outcomes the page reads.
  a.answer({ waiting_outcomes: { count: 3, here: true } });
  scope.alsoNamed(1);
  assert.equal(words.hidden, false, 'the line names one of two');
  assert.equal(words.textContent, '2 other outcomes are waiting on you');
  scope.alsoNamed(2);
  assert.equal(words.hidden, true, 'the line names them all: the light without its words');
  assert.equal(light.hidden, false);
  assert.equal(p.home.getAttribute('aria-label'), 'Outcomes. 2 other outcomes are waiting on you.', 'screen readers hear them either way');
  // A new wait the line has not named yet, from the light's side.
  a.answer({ waiting_outcomes: { count: 3, here: false } });
  assert.equal(words.hidden, false, 'a third wait brings the words back');
  assert.equal(words.textContent, '3 other outcomes are waiting on you');
  // The line could not be read (it names none).
  scope.alsoNamed(3); assert.equal(words.hidden, true);
  scope.alsoNamed(0); assert.equal(words.hidden, false, 'a line that could not be read names nothing');
  a.answer({ waiting_outcomes: { count: 0, here: false } });
  assert.equal(light.hidden, true, 'nothing waits: no light'); assert.equal(words.hidden, true, 'and no words');
  // Inside an outcome's topic the words always show.
  const q = page(), b = attention();
  const topic = new OutcomeScope({ workspaceId: 'w5', kind: 'topic', rail: q.rail, home: q.home, attention: b, open() {} });
  b.answer({ waiting_outcomes: { count: 1, here: false } }); topic.alsoNamed(1);
  assert.equal(q.home.querySelector('.elsewhere-words').hidden, false);
});

test('"← Outcomes" lights up when another outcome waits on the reader: with words inside an outcome, without them on its own page', () => {
  for (const [kind, visible] of [['topic', true], ['skill', true], ['pipeline', true], ['workspace', false]]) {
    const p = page(), a = attention();
    new OutcomeScope({ workspaceId: 'w1', kind, rail: p.rail, home: p.home, attention: a, open() {} });
    assert.equal(a.here, 'w1', 'attention asks about this outcome'); assert.equal(a.refreshed, 1);
    const light = p.home.querySelector('.outcome-light'), words = p.home.querySelector('.elsewhere-words');
    assert.equal(light.hidden, true); assert.equal(words.hidden, true); assert.equal(p.home.getAttribute('aria-label'), null);
    a.answer({ waiting_outcomes: { count: 2, here: true } });
    assert.equal(light.hidden, false, `${kind}: the light`);
    assert.equal(words.textContent, '1 other outcome is waiting on you');
    assert.equal(words.hidden, !visible, `${kind}: the words ${visible ? 'show' : 'stay unseen'}`);
    assert.equal(p.home.getAttribute('aria-label'), 'Outcomes. 1 other outcome is waiting on you.', 'screen readers hear them either way');
    a.answer({ waiting_outcomes: { count: 1, here: true } });
    assert.equal(light.hidden, true, 'only this outcome waits: no light'); assert.equal(words.hidden, true);
    assert.equal(p.home.getAttribute('aria-label'), null);
  }
  const p = page(), a = attention(); a.last = { waiting_outcomes: { count: 3, here: false } }; a.lastHere = 'w1';
  new OutcomeScope({ workspaceId: 'w1', kind: 'topic', rail: p.rail, home: p.home, attention: a, open() {} });
  assert.equal(p.home.querySelector('.elsewhere-words').textContent, '3 other outcomes are waiting on you', 'an answer already read about this outcome paints at once');
  for (const about of [null, 'w2']) {
    const q = page(), b = attention(); b.last = { waiting_outcomes: { count: 3, here: false } }; b.lastHere = about;
    new OutcomeScope({ workspaceId: 'w1', kind: 'topic', rail: q.rail, home: q.home, attention: b, open() {} });
    assert.equal(q.home.querySelector('.outcome-light').hidden, true, `an answer read about ${about ?? 'no outcome'} is not painted`);
    assert.equal(q.home.getAttribute('aria-label'), null);
  }
});

// The page reads attention before it knows its outcome, so the first answer
// says here:false whatever waits in this outcome. Only an answer read about
// this outcome can say how many others wait.
test('"← Outcomes" counts only other outcomes: an answer read before the page knew its outcome is not painted', async () => {
  const answers = [];
  const view = async (name, args) => {
    const next = answers.shift();
    if (next instanceof Error) throw next;
    await next.hold;
    return { instance_id: 'i1', unread: 0, addressed: 0, latest_addressed: [], waiting_outcomes: next(args.workspace_id) };
  };
  const shown = p => { const light = p.home.querySelector('.outcome-light'), words = p.home.querySelector('.elsewhere-words');
    return { light: !light.hidden, words: words.textContent, label: p.home.getAttribute('aria-label') }; };
  const none = { light: false, words: '', label: null };
  const scope = (p, a) => new OutcomeScope({ workspaceId: 'w1', kind: 'topic', rail: p.rail, home: p.home, attention: a, open() {} });
  const reader = () => new Attention({ api: { view }, instanceId: 'i1', doc: { title: 'Theseus', hidden: false, hasFocus: () => true }, notifications: null });
  // The server's answer: waits in the outcomes listed, here when asked about one of them.
  const waits = (...outcomes) => about => ({ count: outcomes.length, here: outcomes.includes(about) });

  // Waited on only in w1. The start-up read (no outcome) answers before the scope exists.
  let p = page(), a = reader();
  answers.push(waits('w1'), waits('w1'));
  await a.refresh();
  scope(p, a);
  assert.deepEqual(shown(p), none, 'the start-up answer is not painted on the page inside w1');
  await a.running;
  assert.deepEqual(shown(p), none, 'the answer about w1: only this outcome waits');

  // The read about w1 fails: the start-up answer still is not painted.
  p = page(); a = reader();
  answers.push(waits('w1'), Error('offline'));
  await a.refresh(); scope(p, a); await a.running;
  assert.deepEqual(shown(p), none, 'a failed read about w1 leaves no false light');

  // The start-up read is still in flight when the scope arrives: its answer is
  // not painted either. The read about w1 waits until that answer is checked.
  p = page(); a = reader();
  let release; const later = Object.assign(waits('w1'), { hold: new Promise(resolve => { release = resolve; }) });
  answers.push(waits('w1'), later);
  const first = a.refresh(); scope(p, a);
  await new Promise(resolve => a.listen(resolve));
  assert.equal(a.lastHere, null, 'the start-up answer has landed, read about no outcome');
  assert.deepEqual(shown(p), none, 'an answer read without the outcome, landing after the scope, is not painted');
  release(); await first;
  assert.equal(a.lastHere, 'w1');
  assert.deepEqual(shown(p), none);

  // Waits here and in two others: the count is two, never three.
  p = page(); a = reader();
  answers.push(waits('w1', 'w2', 'w3'), waits('w1', 'w2', 'w3'));
  await a.refresh(); scope(p, a);
  assert.deepEqual(shown(p), none, 'nothing painted from the start-up answer');
  await a.running;
  assert.deepEqual(shown(p), { light: true, words: '2 other outcomes are waiting on you', label: 'Outcomes. 2 other outcomes are waiting on you.' });

  // Waits elsewhere only: the answer about w1 lights it with the exact count.
  p = page(); a = reader();
  answers.push(waits('w2'), waits('w2'));
  await a.refresh(); scope(p, a); await a.running;
  assert.deepEqual(shown(p), { light: true, words: '1 other outcome is waiting on you', label: 'Outcomes. 1 other outcome is waiting on you.' });
});

test('the one logo block, then the page\'s notices, move to the top of the rail or of the main column', () => {
  const p = page(), notify = p.byId.get('notify'), status = p.byId.get('app-status');
  let pressed = 0; notify.onclick = () => pressed++;
  p.rail.prepend(p.home);
  placeBrand(p.rail);
  assert.deepEqual(ids(p.rail).slice(0, 5), ['brand', 'app-status', 'wakes-status', 'updates-status', 'outcomes-home']);
  // The outcome's own page: "← Outcomes" heads main, then the block goes above it.
  p.main.prepend(p.home); placeBrand(p.main);
  assert.deepEqual(ids(p.main).slice(0, 5), ['brand', 'app-status', 'wakes-status', 'updates-status', 'outcomes-home']);
  assert.equal(p.rail.querySelectorAll('.brand').length + p.main.querySelectorAll('.brand').length, 1, 'one block, moved, never copied');
  assert.equal(p.main.querySelector('#notify'), notify); assert.equal(p.main.querySelector('#app-status'), status);
  p.main.querySelector('#notify').onclick(); assert.equal(pressed, 1, 'its handlers still fire');
});
