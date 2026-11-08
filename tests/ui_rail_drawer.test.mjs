// The phone rail's drawer (item 117, web/rail-drawer.mjs) on a small page of
// its own: what opens it, what closes it, where the focus goes, and that it
// opens on the open topic in the middle. The native rail checks
// (tests/outcome_rail_native.mjs) press the same controls in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { railDrawer } from '../web/rail-drawer.mjs';

// Only the selectors the drawer uses; any other is a mistake in the check.
const SIMPLE = {
  'a[href]': e => e.tag === 'a' && 'href' in e.attrs,
  '.nav-item': e => e.classes.includes('nav-item'),
  '#new-topic': e => e.id === 'new-topic',
  'a[aria-current="page"]': e => e.tag === 'a' && e.attrs['aria-current'] === 'page',
  'button:not([disabled])': e => e.tag === 'button' && !e.disabled,
};
const matches = (e, selector) => selector.split(', ').some(one => {
  if (!SIMPLE[one]) throw Error('unexpected selector ' + one);
  return SIMPLE[one](e);
});

function page({ current = 't2' } = {}) {
  const doc = { activeElement: null, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } };
  class El {
    constructor(tag, { id = '', classes = [], attrs = {}, disabled = false } = {}) {
      Object.assign(this, { tag, id, classes, attrs, disabled, children: [], parent: null, handlers: {}, hidden: false, inert: false, scrolled: [], focusedWith: null });
      this.classList = { contains: name => this.classes.includes(name),
        toggle: (name, on) => { this.classes = this.classes.filter(c => c !== name); if (on) this.classes.push(name); return on; } };
    }
    add(...kids) { for (const kid of kids) { kid.parent = this; this.children.push(kid); } return this; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    setAttribute(name, value) { this.attrs[name] = value; }
    contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
    closest(selector) { for (let at = this; at; at = at.parent) if (matches(at, selector)) return at; return null; }
    all() { return this.children.flatMap(kid => [kid, ...kid.all()]); }
    querySelector(selector) { return this.all().find(e => matches(e, selector)) ?? null; }
    focus(options) { doc.activeElement = this; this.focusedWith = options ?? {}; }
    scrollIntoView(options) { this.scrolled.push(options); }
  }
  const topic = id => new El('a', { classes: ['nav-item'], attrs: { href: '/?topic=' + id, ...(id === current ? { 'aria-current': 'page' } : {}) } }).add(new El('span'));
  const wordmark = new El('a', { classes: ['wordmark'], attrs: { href: '/' } });
  const home = new El('a', { id: 'outcomes-home', attrs: { href: '/' } });
  const heading = new El('h2'), newTopic = new El('button', { id: 'new-topic' });
  const notebookPage = new El('button', { classes: ['nav-item'] });
  const topics = ['t1', 't2', 't3'].map(topic);
  // What opens in the drawer itself: New topic's title line, More topics, Retry, the Done group.
  const topicLine = new El('input', { id: 'new-topic-title' }), moreTopics = new El('button', { id: 'more-topics' });
  const retryTopics = new El('button', { id: 'retry-topics' }), done = new El('summary');
  const section = new El('section').add(heading, newTopic, topicLine, ...topics, moreTopics, retryTopics, new El('details').add(done));
  const rail = new El('nav', { id: 'rail', classes: ['rail'] }).add(new El('div', { classes: ['brand'] }).add(wordmark), home,
    section, new El('section').add(notebookPage));
  const control = new El('button', { id: 'rail-open', attrs: { 'aria-expanded': 'false' } });
  const backdrop = new El('div', { id: 'rail-backdrop' }); backdrop.hidden = true;
  const main = new El('main', { id: 'main' }).add(new El('header').add(control));
  const byId = { rail, 'rail-open': control, 'rail-backdrop': backdrop, main };
  doc.getElementById = id => byId[id] ?? null;
  const phone = { matches: true, listeners: [], addEventListener(name, fn) { assert.equal(name, 'change'); this.listeners.push(fn); } };
  const win = { matchMedia: query => { assert.equal(query, '(max-width: 760px)'); return phone; } };
  const drawer = railDrawer(doc, win);
  const state = () => ({ open: rail.classList.contains('open'), backdrop: !backdrop.hidden, inert: main.inert, expanded: control.attrs['aria-expanded'] });
  const tap = target => rail.handlers.click({ target });
  const key = (name, taken = false) => { const event = { key: name, defaultPrevented: taken, prevented: false, preventDefault() { this.prevented = true; } }; doc.handlers.keydown(event); return event; };
  return { doc, drawer, rail, control, backdrop, main, topics, wordmark, home, heading, newTopic, topicLine, moreTopics, retryTopics, done, notebookPage, phone, state, tap, key };
}
const OPEN = { open: true, backdrop: true, inert: true, expanded: 'true' }, SHUT = { open: false, backdrop: false, inert: false, expanded: 'false' };

test('the drawer starts closed, and "☰ Topics" opens it over the topic, on the open topic in its middle', () => {
  const p = page();
  assert.deepEqual(p.state(), SHUT, 'closed as the page starts');
  p.control.handlers.click();
  assert.deepEqual(p.state(), OPEN, 'open, the topic behind it dimmed and out of reach');
  assert.equal(p.doc.activeElement, p.topics[1], 'the focus is on the open topic');
  assert.deepEqual(p.topics[1].focusedWith, { preventScroll: true }, 'focusing it does not scroll on its own');
  assert.deepEqual(p.topics[1].scrolled, [{ block: 'center' }], 'the open topic is brought to the middle, so a lit topic beside it shows whole');
  p.control.handlers.click();
  assert.deepEqual(p.state(), SHUT, '"☰ Topics" again closes it');
});

test('with no open topic in it, the drawer opens on the first place it can go', () => {
  const p = page({ current: null });
  p.control.handlers.click();
  assert.equal(p.doc.activeElement, p.wordmark);
});

test('a tap on anything in the drawer that goes somewhere closes it and gives "☰ Topics" the focus; a tap on a heading does not', () => {
  const p = page();
  p.control.handlers.click();
  p.tap(p.heading);
  assert.deepEqual(p.state(), OPEN, 'a heading goes nowhere, so the drawer stays');
  for (const [name, target] of [['a topic, pressed on its words', p.topics[2].children[0]], ['the logo', p.wordmark], ['← Outcomes', p.home], ['a Notebook page', p.notebookPage]]) {
    if (!p.state().open) p.control.handlers.click();
    target.focus();
    p.tap(target);
    assert.deepEqual(p.state(), SHUT, name + ' closes it');
    assert.equal(p.doc.activeElement, p.control, name + ': the focus leaves the closed drawer for "☰ Topics"');
    assert.deepEqual(p.control.focusedWith, { preventScroll: true });
  }
  p.tap(p.topics[0]);
  assert.deepEqual(p.state(), SHUT, 'a tap in a closed drawer changes nothing');
});

// New topic's one line opens in the drawer, under the Topics heading, and takes
// the focus (release 23's lineFromButton): the same tap closing the drawer
// would hide the line and move the focus to "☰ Topics", so the tap would seem
// to do nothing. So with everything that opens in the drawer itself.
test('a tap on what opens in the drawer itself (New topic, More topics, Retry, Done) leaves it open with the focus where that tap put it', () => {
  const p = page();
  p.control.handlers.click();
  for (const [name, target, focused] of [['New topic', p.newTopic, p.topicLine], ['its title line', p.topicLine, p.topicLine], ['More topics', p.moreTopics, p.moreTopics],
    ['Retry topics', p.retryTopics, p.retryTopics], ['the Done group', p.done, p.done]]) {
    focused.focus();
    p.tap(target);
    assert.deepEqual(p.state(), OPEN, name + ' leaves the drawer open');
    assert.equal(p.doc.activeElement, focused, name + ': the focus stays where the tap put it');
  }
});

test('a tap on the dimmed page beside the drawer closes it and gives "☰ Topics" the focus back', () => {
  const p = page();
  p.control.handlers.click();
  // A press on the dimmed page takes the focus off the drawer before its click, as a browser does.
  p.doc.activeElement = null;
  p.backdrop.handlers.click();
  assert.deepEqual(p.state(), SHUT);
  assert.equal(p.doc.activeElement, p.control);
});

test('Escape closes the drawer once; an Escape something else took, another key, or an Escape with it closed is left alone', () => {
  const p = page();
  p.control.handlers.click();
  assert.equal(p.key('Enter').prevented, false); assert.deepEqual(p.state(), OPEN, 'another key leaves it open');
  assert.equal(p.key('Escape', true).prevented, false); assert.deepEqual(p.state(), OPEN, 'an Escape already taken leaves it open');
  const escape = p.key('Escape');
  assert.deepEqual([escape.prevented, p.state()], [true, SHUT], 'Escape closes it and is taken');
  assert.equal(p.doc.activeElement, p.control, 'and the focus goes back to "☰ Topics"');
  assert.equal(p.key('Escape').prevented, false, 'with the drawer closed, Escape is left for others');
});

test('widening the window past a phone closes the drawer; narrowing it does not open it', () => {
  const p = page();
  p.control.handlers.click();
  p.phone.matches = false; p.phone.listeners.forEach(fn => fn());
  assert.deepEqual(p.state(), SHUT, 'at desktop width the rail stands beside the topic again');
  p.phone.matches = true; p.phone.listeners.forEach(fn => fn());
  assert.deepEqual(p.state(), SHUT, 'back at phone width it stays closed');
});

test('the drawer refuses to start without its rail, its control, its backdrop or the page', () => {
  for (const missing of ['rail', 'rail-open', 'rail-backdrop', 'main']) {
    const doc = { getElementById: id => id === missing ? null : { addEventListener() {} }, addEventListener() {} };
    assert.throws(() => railDrawer(doc, { matchMedia: () => ({ addEventListener() {} }) }), /needs its rail, its control, its backdrop and the page/, missing);
  }
});
