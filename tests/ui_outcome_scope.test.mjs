// Inside an outcome the side rail shows only that outcome, under the logo
// block that tops every page now that there is no header bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { OutcomeScope, RAIL_ORDER, railShown, elsewhereWaiting, elsewhereWords, wordsShown, placeBrand, showOpenInStrip } from '../web/outcome-scope.mjs';

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
  const doc = { body, getElementById: id => byId.get(id) ?? null, querySelector: selector => body.querySelector(selector), createElement: tag => new Node(tag),
    // A laptop-width window: the strips follow their open row only at phone width.
    defaultView: { matchMedia: () => ({ matches: false, addEventListener() {} }), MutationObserver: class { observe() {} } } };
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
  const notebook = el('section', 'outcome-references', '', rail);
  // Sections the conversation, pipeline and skills pieces add, as nodes in the rail.
  const conversation = el('section', 'conversation-row', '', rail), pipeline = el('section', 'pipeline-row', '', rail), skills = el('section', 'skills-navigation', '', rail);
  return { doc, rail, main, brand, wordmark, home, outcomes, topics, notebook, conversation, pipeline, skills, byId };
}
const ids = host => host.children.map(node => node.id || node.className);
const attention = () => ({ here: null, last: null, refreshed: 0, listeners: [], listen(fn) { this.listeners.push(fn); }, refresh() { this.refreshed++; },
  answer(value) { this.last = value; for (const fn of this.listeners) fn(value); } });

test('inside an outcome the rail hides the outcomes list, says "This outcome", and orders its sections', () => {
  const p = page(), opened = [];
  const sections = [{ name: 'skills', node: p.skills }, { name: 'notebook', node: p.notebook }, { name: 'topics', node: p.topics },
    { name: 'pipeline', node: p.pipeline }, { name: 'conversation', node: p.conversation }];
  new OutcomeScope({ workspaceId: 'w1', kind: 'topic', rail: p.rail, home: p.home, sections, open: (target, title) => opened.push([target, title]) });
  assert.equal(p.outcomes.hidden, true, 'no list of outcomes, no Outcomes heading, no New outcome');
  assert.equal(p.topics.hidden, false); assert.equal(p.byId.get('new-topic').hidden, false, 'New topic stays');
  assert.equal(p.rail.getAttribute('aria-label'), 'This outcome');
  assert.deepEqual(RAIL_ORDER, ['conversation', 'pipeline', 'topics', 'notebook', 'skills']);
  assert.deepEqual(ids(p.rail).filter(id => id !== 'outcome-navigation'),
    ['brand', 'app-status', 'wakes-status', 'updates-status', 'outcomes-home', 'topic-navigation-status', 'conversation-row', 'pipeline-row', 'topic-navigation', 'outcome-references', 'skills-navigation']);
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
    sections: [{ name: 'notebook', node: p.notebook, load: () => { loads.push('notebook'); return true; } }, { name: 'topics', node: p.topics, load: () => { loads.push('topics'); return false; } }] });
  const at = id => ids(p.rail).indexOf(id);
  assert.ok(at('topic-navigation-status') < at('topic-navigation') && at('topic-navigation') < at('outcome-references'), 'topics, then the Notebook, under "← Outcomes"');
  assert.equal(await scope.load(), false, 'a section that could not be read makes the load false');
  assert.deepEqual(loads.sort(), ['notebook', 'topics']);
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
  assert.equal(wordsShown('workspace'), false);
  for (const kind of ['topic', 'opening', 'pipeline', 'skill']) assert.equal(wordsShown(kind), true, kind);
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
  const p = page(), a = attention(); a.last = { waiting_outcomes: { count: 3, here: false } };
  new OutcomeScope({ workspaceId: 'w1', kind: 'topic', rail: p.rail, home: p.home, attention: a, open() {} });
  assert.equal(p.home.querySelector('.elsewhere-words').textContent, '3 other outcomes are waiting on you', 'an answer already read paints at once');
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

// A sideways strip whose rows have fixed boxes: each row is 100px wide with
// no gap, the strip shows 250px.
function strip(count, { open, lit = [], width = 250 }) {
  const rows = Array.from({ length: count }, (_, i) => ({ i, hidden: false, getAttribute: name => name === 'aria-current' && i === open ? 'page' : null,
    querySelector: selector => lit.includes(i) && selector.includes('.topic-state.mine') ? {} : null,
    getBoundingClientRect() { return { left: i * 100 - host.scrollLeft, right: i * 100 + 100 - host.scrollLeft }; },
    scrollIntoView() { host.pageMoved = true; } }));
  const host = { children: rows, clientWidth: width, scrollWidth: count * 100, scrollLeft: 0, pageMoved: false, getBoundingClientRect: () => ({ left: 0 }) };
  return host;
}
const shows = (host, i) => i * 100 >= host.scrollLeft - 0.5 && i * 100 + 100 <= host.scrollLeft + host.clientWidth + 0.5;

test('a phone strip shows its open row whole near the middle, and never cuts a lit neighbour when it can show both', () => {
  let s = strip(12, { open: 8 }); showOpenInStrip(s);
  assert.equal(s.scrollLeft, 725, 'the open row centred'); assert.ok(shows(s, 8));
  // The lit row before it is cut at the left edge once centred: the least move shows it whole, the open row still whole.
  s = strip(12, { open: 8, lit: [7] }); showOpenInStrip(s);
  assert.ok(shows(s, 7) && shows(s, 8), 'both whole'); assert.equal(s.scrollLeft, 700, 'by the least move');
  s = strip(12, { open: 8, lit: [9] }); showOpenInStrip(s);
  assert.ok(shows(s, 9) && shows(s, 8)); assert.equal(s.scrollLeft, 750);
  // Lit rows wholly out of view are not cut, so the strip stays centred.
  s = strip(12, { open: 8, lit: [6, 10] }); showOpenInStrip(s);
  assert.equal(s.scrollLeft, 725);
  // A strip too narrow for a lit neighbour beside the open row: the open row wins.
  s = strip(12, { open: 8, lit: [7], width: 150 }); showOpenInStrip(s);
  assert.equal(s.scrollLeft, 775, 'the open row stays whole and centred'); assert.ok(shows(s, 8));
  s = strip(12, { open: 0 }); showOpenInStrip(s); assert.equal(s.scrollLeft, 0, 'the first row clamps to the start');
  s = strip(12, { open: 11 }); showOpenInStrip(s); assert.equal(s.scrollLeft, 950, 'the last row clamps to the end');
  assert.equal(s.pageMoved, false, 'only the strip\'s own scrollLeft is written, never the page');
  assert.deepEqual(s.children.map(row => row.i), [...Array(12).keys()], 'the order of the rows is unchanged');
});
