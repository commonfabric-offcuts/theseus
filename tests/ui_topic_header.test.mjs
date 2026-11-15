// The top of a topic, Topic settings and the people as pills, below the
// browser: the subtitle's rules on a table of topics, the dialog's open,
// close and Tab rules on a small DOM, the people panel's pills, where it stands
// inside the dialog, and the page's order in index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { subtitleNote, paintSubtitle, paintTopicHeader } from '../web/topic-header.mjs';
import { TopicSettings } from '../web/topic-settings.mjs';
import { PeoplePanel } from '../web/people.mjs';
import { TopicStatePanel } from '../web/topic-state.mjs';

class Element {
  constructor(tag, fields = {}) { Object.assign(this, { tag, children: [], dataset: {}, attributes: {}, hidden: false, classes: new Set(), parent: null, handlers: {}, textContent: '' }, fields); }
  get classList() { return { add: name => this.classes.add(name), contains: name => this.classes.has(name), toggle: (name, on = !this.classes.has(name)) => { if (on) this.classes.add(name); else this.classes.delete(name); return on; } }; }
  set className(value) { this.classes = new Set(String(value).split(' ').filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  append(...nodes) { for (const node of nodes) { if (node instanceof Element) { node.parent?.drop(node); node.parent = this; } this.children.push(node); } }
  drop(node) { this.children = this.children.filter(child => child !== node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  prepend(...nodes) { const rest = this.children; this.children = []; this.append(...nodes); this.children.push(...rest); }
  insertBefore(node, before) { this.append(node); this.drop(node); this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node); }
  remove() { this.parent?.drop(this); this.parent = null; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  focus() { globalThis.document.activeElement = this; }
  get isConnected() { return true; }
  all() { return this.children.flatMap(node => node instanceof Element ? [node, ...node.all()] : []); }
  find(predicate) { return this.all().find(predicate); }
  filter(predicate) { return this.all().filter(predicate); }
  // What the DOM's textContent gives: its own words, or its children's.
  get text() { return this.children.length ? this.children.map(node => node instanceof Element ? node.text : String(node)).join('') : this.textContent; }
}
function dom(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), activeElement: null };
  t.after(() => { globalThis.document = previous; });
}
const topic = (fields = {}) => ({ id: 't1', version: 4, title: 'What\'s live and what\'s next', owner_id: 'tony', creator_id: 'tony', state: 'active',
  state_note: '', state_by: null, state_ms: null, waiting_on: [], archived: false, ...fields });
const ONGOING = 'Ongoing: each release and what comes next';
const FRICTION = 'Ongoing log: one friction or one of our misses per message';

test('the subtitle drops a leading "Ongoing:" only on a plainly Active topic, and every other note keeps every word', () => {
  assert.equal(subtitleNote(topic({ state_note: ONGOING })), 'Each release and what comes next');
  assert.equal(subtitleNote(topic({ state_note: 'Ongoing:   spaced' })), 'Spaced', 'the spaces after it go too');
  assert.equal(subtitleNote(topic({ state_note: FRICTION })), FRICTION, 'only that exact prefix goes');
  assert.equal(subtitleNote(topic({ state_note: 'ongoing: lower case' })), 'ongoing: lower case');
  assert.equal(subtitleNote(topic({ state_note: 'Still Ongoing: in the middle' })), 'Still Ongoing: in the middle');
  for (const state of ['waiting', 'review', 'done']) assert.equal(subtitleNote(topic({ state, state_note: ONGOING })), ONGOING, `${state} keeps the note whole`);
  assert.equal(subtitleNote(topic({ state: 'active', asks: [{ actor_id: 'tony', by: 'fable' }], state_note: ONGOING })), ONGOING, 'an Active topic with an open ask waits on someone, so it is not plainly Active');
  assert.equal(subtitleNote(topic({ state_note: 'Ongoing:' })), '', 'nothing after it, nothing left');
  assert.equal(subtitleNote(topic()), '');
});

test('the state word stands before the note, with a real space, only when the topic is not plainly Active', t => {
  dom(t);
  const paint = item => { const host = new Element('p'); paintSubtitle(host, item, 'tony'); return host; };
  const plain = paint(topic({ state_note: ONGOING }));
  assert.deepEqual([plain.hidden, plain.text, plain.find(node => node.classes.has('topic-state'))], [false, 'Each release and what comes next', undefined]);
  const done = paint(topic({ state: 'done', state_note: 'Shipped: the server owns topic openings.' }));
  assert.equal(done.text, 'Done Shipped: the server owns topic openings.', 'a screen reader says "Done, Shipped…", not "DoneShipped"');
  const word = done.children[0];
  assert.deepEqual([word.tag, word.className, word.dataset.state, word.title], ['strong', 'topic-state', 'done', 'Done']);
  const mine = paint(topic({ state: 'waiting', waiting_on: ['tony', 'fable'], state_note: ONGOING }));
  assert.equal(mine.text, 'Waiting on you, fable ' + ONGOING);
  assert.deepEqual([mine.children[0].className, mine.children[0].dataset.state], ['topic-state mine', 'waiting']);
  assert.equal(paint(topic({ state: 'review', state_note: 'Look please' })).text, 'Ready for review Look please');
  const bare = paint(topic({ state: 'done' }));
  assert.deepEqual([bare.hidden, bare.text], [false, 'Done'], 'a word alone has no trailing space');
  const empty = paint(topic());
  assert.deepEqual([empty.hidden, empty.children], [true, []], 'a plainly Active topic with no note shows no subtitle');
  // A repaint replaces what was there.
  const host = paint(topic({ state: 'done', state_note: 'Shipped' }));
  paintSubtitle(host, topic({ state_note: 'Back to work' }), 'tony');
  assert.deepEqual([host.hidden, host.text], [false, 'Back to work']);
});

// Tony, 10 Nov: a shipped piece's topic is Ready for review until he marks it
// Done, with one tap at the top of the topic.
test('a topic Ready for review shows ✅ Done after its state to a reader who may say it, and no other state or reader does', t => {
  dom(t);
  const marked = [];
  const done = () => marked.push('done');
  const paint = (item, how = done) => { const host = new Element('p'); paintSubtitle(host, item, 'tony', document, how); return host; };
  const button = host => host.find(node => node.classes.has('mark-done'));
  const review = paint(topic({ state: 'review', state_note: 'Live in release 43 since 9:05 AM Tue Nov 10' }));
  assert.equal(review.text, 'Ready for review ✅ Done Live in release 43 since 9:05 AM Tue Nov 10', 'state, ✅ Done, then the note, each a real space apart');
  const shown = button(review);
  assert.deepEqual([shown.tag, shown.type, shown.attributes['aria-label'], shown.title, shown.children[0].attributes['aria-hidden']],
    ['button', 'button', 'Mark done', 'Mark this topic done', 'true'], 'a real button named for what it does; the glyph is not read out');
  shown.onclick();
  assert.deepEqual(marked, ['done']);
  for (const state of ['active', 'waiting', 'done']) assert.equal(button(paint(topic({ state, state_note: 'A note' }))), undefined, `${state} shows no ✅`);
  assert.equal(button(paint(topic({ state: 'review', state_note: 'A note' }), null)), undefined, 'a reader who may not say where it stands sees none');
  // On a conversation, where no Topic settings apply, there is none either.
  const parts = { title: new Element('h1'), subtitle: new Element('p'), gear: new Element('button') };
  paintTopicHeader(parts, topic({ state: 'review' }), 'tony', { settings: false, done });
  assert.equal(button(parts.subtitle), undefined);
  paintTopicHeader(parts, topic({ state: 'review' }), 'tony', { done });
  assert.ok(button(parts.subtitle));
});

test('a repaint keeps the focus on ✅ Done while it shows, and gives it to the subtitle saying Done once it goes', t => {
  dom(t);
  const host = new Element('p');
  paintSubtitle(host, topic({ state: 'review' }), 'tony', document, () => {});
  host.find(node => node.classes.has('mark-done')).focus();
  paintSubtitle(host, topic({ state: 'review', version: 5 }), 'tony', document, () => {});
  const again = host.find(node => node.classes.has('mark-done'));
  assert.equal(document.activeElement, again, 'fresh data repaints it with the focus on it');
  paintSubtitle(host, topic({ state: 'done', version: 6 }), 'tony', document, () => {});
  assert.deepEqual([host.text, document.activeElement === host, host.attributes.tabindex], ['Done', true, '-1']);
  // Focus elsewhere stays where it is.
  const other = new Element('button');
  other.focus();
  paintSubtitle(host, topic({ state: 'review', version: 7 }), 'tony', document, () => {});
  paintSubtitle(host, topic({ state: 'done', version: 8 }), 'tony', document, () => {});
  assert.equal(document.activeElement, other);
});

test('the header paints the title and the subtitle, and shows the gear only where Topic settings apply', t => {
  dom(t);
  const parts = { title: new Element('h1'), subtitle: new Element('p'), gear: new Element('button', { hidden: true }) };
  paintTopicHeader(parts, topic({ state_note: ONGOING }), 'tony');
  assert.deepEqual([parts.title.textContent, parts.subtitle.text, parts.gear.hidden], ['What\'s live and what\'s next', 'Each release and what comes next', false]);
  paintTopicHeader(parts, topic({ title: 'Conversation' }), 'tony', { settings: false });
  assert.deepEqual([parts.title.textContent, parts.subtitle.hidden, parts.gear.hidden], ['Conversation', true, true]);
});

// A dialog with a box, as the browser lays it out, and its Tab stops.
function settings(t, { box = { left: 448, right: 992, top: 200, bottom: 600 }, stops = ['close', 'state', 'note', 'save'] } = {}) {
  dom(t);
  const dialog = new Element('dialog', { open: false, modal: false });
  Object.assign(dialog, {
    showModal() { this.open = true; this.modal = true; }, show() { this.open = true; this.modal = false; }, close() { this.open = false; },
    getBoundingClientRect: () => box, querySelectorAll: () => dialog.stops, querySelector: () => null });
  const control = name => Object.assign(new Element('button', { id: name, disabled: false, shown: true }), { getClientRects() { return this.shown ? [1] : []; } });
  dialog.stops = stops.map(control);
  const gear = new Element('button'), heading = new Element('h2'), close = dialog.stops[0];
  const win = { handlers: {}, addEventListener(name, fn, capture) { this.handlers[name] = [fn, capture]; } };
  const panel = new TopicSettings({ dialog, gear, heading, close, win });
  // A press that starts at down and ends at up (on the same spot unless
  // given), as the browser sends it: pointerdown on the window on its way
  // down, then the click to what holds both ends.
  const press = (down, up = down) => {
    const at = ([x, y, target = dialog]) => ({ target, clientX: x, clientY: y, button: 0, isPrimary: true });
    win.handlers.pointerdown[0](at(down)); dialog.handlers.click(at(up));
  };
  const key = (shiftKey = false) => { const event = { key: 'Tab', shiftKey, prevented: false, preventDefault() { this.prevented = true; } }; dialog.handlers.keydown(event); return event; };
  const at = () => document.activeElement?.id ?? (document.activeElement === heading ? 'heading' : document.activeElement === gear ? 'gear' : null);
  return { dialog, gear, heading, close, panel, key, at, press, win, stop: name => dialog.stops.find(node => node.id === name) };
}

test('the gear opens Topic settings as a modal dialog with the focus on its title', t => {
  const s = settings(t);
  s.gear.handlers.click();
  assert.deepEqual([s.dialog.open, s.dialog.modal, s.at()], [true, true, 'heading']);
});

test('Escape, ✕ and a press on the backdrop each close Topic settings and give the focus back to the gear', t => {
  const s = settings(t);
  s.gear.handlers.click();
  const escape = { prevented: false, preventDefault() { this.prevented = true; } };
  s.dialog.handlers.cancel(escape);
  assert.deepEqual([escape.prevented, s.dialog.open, s.at()], [true, false, 'gear'], 'Escape');
  s.gear.handlers.click();
  s.close.handlers.click();
  assert.deepEqual([s.dialog.open, s.at()], [false, 'gear'], '✕');
  s.gear.handlers.click();
  s.press([100, 400]);
  assert.deepEqual([s.dialog.open, s.at()], [false, 'gear'], 'a press on the backdrop');
  // Closed with the gear hidden (the topic became unavailable), the focus stays off it.
  s.gear.handlers.click(); s.gear.hidden = true; s.panel.close();
  assert.deepEqual([s.dialog.open, s.at()], [false, 'heading']);
});

test('only a press that starts and ends on the backdrop closes Topic settings, as it does every pop-up', t => {
  const s = settings(t);
  assert.equal(s.win.handlers.pointerdown[1], true, 'the press is seen on the window, on its way down');
  s.gear.handlers.click();
  // On the dialog's own empty space: the dialog is the target, the point inside its box.
  s.press([980, 590]);
  assert.equal(s.dialog.open, true, 'a press inside the box keeps it open');
  s.press([100, 400, s.stop('note')]);
  assert.equal(s.dialog.open, true, 'a press whose target is inside the dialog keeps it open');
  // A selection dragged from the note and let go on the backdrop: the click
  // goes to the dialog, which holds both ends, at a point outside its box.
  s.press([600, 400, s.stop('note')], [100, 400]);
  assert.equal(s.dialog.open, true, 'a drag out of the note keeps it open');
  s.press([100, 400], [600, 400, s.stop('note')]);
  assert.equal(s.dialog.open, true, 'a press from the backdrop let go inside keeps it open');
  for (const [x, y] of [[448, 200], [991, 599], [700, 400]]) { s.press([x, y]); assert.equal(s.dialog.open, true, `${x},${y} is inside`); }
  for (const [x, y] of [[447, 400], [992, 400], [700, 199], [700, 600]]) {
    s.press([x, y]);
    assert.equal(s.dialog.open, false, `${x},${y} is outside`);
    s.gear.handlers.click();
  }
});

test('on a phone the dialog fills the screen, so no tap closes it but ✕ and Escape', t => {
  const s = settings(t, { box: { left: 0, right: 390, top: 0, bottom: 844 } });
  s.gear.handlers.click();
  s.press([195, 832]);
  assert.equal(s.dialog.open, true);
});

test('Tab stays inside Topic settings: the last stop goes to the first, and Shift+Tab from the first or the title goes to the last', t => {
  const s = settings(t, { stops: ['close', 'state', 'note', 'waiting', 'save', 'title', 'rename', 'archive'] });
  s.stop('waiting').shown = false;
  s.gear.handlers.click();
  s.stop('archive').focus();
  assert.deepEqual([s.key().prevented, s.at()], [true, 'close'], 'Tab from the last stop wraps to ✕');
  assert.deepEqual([s.key(true).prevented, s.at()], [true, 'archive'], 'Shift+Tab from ✕ goes to the last stop');
  s.heading.focus();
  assert.deepEqual([s.key(true).prevented, s.at()], [true, 'archive'], 'Shift+Tab from the title goes to the last stop');
  s.heading.focus();
  assert.deepEqual([s.key().prevented, s.at()], [false, 'heading'], 'Tab from the title is the browser\'s own, to ✕');
  s.stop('note').focus();
  assert.deepEqual([s.key().prevented, s.key(true).prevented], [false, false], 'between stops the browser moves the focus');
  // The last stop is the last one shown: without the owner's row, Save.
  const reader = settings(t, { stops: ['close', 'state', 'note', 'waiting', 'save', 'archive'] });
  reader.stop('waiting').shown = false; reader.stop('archive').shown = false;
  reader.gear.handlers.click();
  reader.stop('save').focus();
  assert.deepEqual([reader.key().prevented, reader.at()], [true, 'close']);
  // With nothing to stop on, Tab goes nowhere outside.
  const none = settings(t, { stops: ['close'] });
  none.stop('close').disabled = true;
  none.gear.handlers.click();
  assert.equal(none.key().prevented, true);
});

const people = list => list.map(([actor_id, kind = 'human']) => ({ actor_id, kind }));
const pills = host => host.filter(node => node.classes.has('person-pill'));
const words = pill => pill.children.filter(node => node instanceof Element && !node.classes.has('pill-remove')).map(node => node.text).join('');

test('each person is one pill in their colour, the reader\'s own black and not a button, with the remove button inside the pill', t => {
  dom(t);
  const host = new Element('div');
  const named = person => person.kind === 'agent' && person.actor_id !== 'tony' ? new Element('button', { textContent: person.actor_id, className: 'pill-name' }) : null;
  const pill = person => person.actor_id === 'tony' ? 'own-pill' : person.kind === 'agent' ? 'agent-green' : '';
  const panel = new PeoplePanel({ host, label: 'Add', fixed: () => ['dan'], named, pill, remove: async () => ({}) });
  const list = people([['dan'], ['fable', 'agent'], ['tony']]);
  panel.paint(list, true);
  const shown = pills(host);
  assert.deepEqual(shown.map(node => [node.className, words(node)]), [['person-pill', 'dan'], ['person-pill agent-green', 'fable'], ['person-pill own-pill', 'tony']]);
  assert.deepEqual(shown.map(node => node.children[0].tag), ['span', 'button', 'span'], 'only an agent\'s name is a button');
  for (const node of shown) {
    const removers = host.filter(child => child.tag === 'button' && child.attributes['aria-label']?.startsWith('Remove '));
    const own = removers.filter(button => button.parent === node);
    if (words(node) === 'dan') assert.deepEqual(own, [], 'a fixed person keeps no remove button');
    else assert.deepEqual(own.map(button => [button.attributes['aria-label'], button.className, button.textContent]), [[`Remove ${words(node)}`, 'pill-remove', '×']], 'one remove button, inside its own pill');
  }
  assert.equal(host.filter(node => node.tag === 'button').some(button => button.find(child => child.tag === 'button')), false, 'no button holds another');
  assert.equal(host.filter(node => node.classes.has('pill-remove')).every(button => pills(host).includes(button.parent)), true, 'every remove button sits in a pill');
  panel.paint(list, false);
  assert.deepEqual(host.filter(node => node.classes.has('pill-remove')), [], 'a reader who may not manage gets no remove button');
});

// Where it stands inside Topic settings, set in place, and the hook that lets the subtitle follow it.
test('in Topic settings where it stands is chips and one line under its heading, with no form, and each painted topic reaches the subtitle', t => {
  dom(t);
  const host = new Element('section'), painted = [];
  const panel = new TopicStatePanel({ host, reader: 'fable', send: async () => ({}), painted: item => painted.push(item.version) });
  panel.paint(topic({ state: 'review', state_note: 'Look please' }), [{ actor_id: 'fable' }]);
  const shown = node => [node.tag, node.id || [...node.classes][0]];
  assert.deepEqual(host.children.map(shown), [['h3', 'stand-heading'], ['div', 'state-chips'], ['div', 'waiting-on'], ['input', 'topic-state-note'], ['p', 'muted'],
    ['div', 'settings-part'], ['p', 'notice'], ['div', 'settings-actions']], 'Where it stands, its chips, who it waits on, the note, who said it, the parts, the notice, the quiet actions');
  assert.equal(host.children[0].textContent, 'Where it stands');
  assert.equal(host.filter(node => node.tag === 'h3').length, 1, 'one heading, not a second "Change where it stands"');
  assert.equal(host.find(node => ['details', 'summary', 'select', 'textarea'].includes(node.tag)), undefined, 'no disclosure, no dropdown, no box');
  assert.equal(host.find(node => node.tag === 'button' && /Save/.test(node.textContent)), undefined, 'no Save');
  assert.equal(host.find(node => node.classes.has('topic-state')), undefined, 'no second state pill: the lit chip says it');
  assert.equal(host.children[2].hidden, true, 'Waiting on shows only while it waits');
  assert.equal(host.children[7].hidden, true, 'a participant who is neither owner nor creator gets no Rename or Archive');
  // A newer topic reaches the subtitle; an older read that lands late does not.
  panel.paint(topic({ version: 6, state: 'done' }), [{ actor_id: 'fable' }]);
  panel.paint(topic({ version: 5, state: 'active' }), [{ actor_id: 'fable' }]);
  assert.deepEqual(painted, [4, 6]);
  const owner = new TopicStatePanel({ host: new Element('section'), reader: 'tony', send: async () => ({}) });
  owner.paint(topic(), []);
  const actions = owner.host.find(node => node.classes.has('settings-actions'));
  assert.deepEqual([actions.hidden, actions.children.map(node => [node.tag, node.id ?? null, node.textContent, node.hidden])],
    [false, [['input', 'topic-rename', '', true], ['button', null, 'Rename', false], ['button', null, 'Archive', false]]], 'the owner\'s quiet Rename and Archive, the title line hidden until Rename');
});

// The page's order, as index.html lays it out.
test('the top of a topic is the eyebrow, the title row with the gear, the subtitle and the Team; the New message composer rests in the feed; where it stands is in Topic settings', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const header = main.slice(main.indexOf('<header class="topic-header">'), main.indexOf('</header>'));
  const order = ids => ids.map(id => header.indexOf(`id="${id}"`));
  const [eyebrow, title, gear, subtitle] = order(['workspace-name', 'topic-title', 'settings-open', 'topic-description']);
  assert.ok(eyebrow >= 0 && eyebrow < title && title < gear && gear < subtitle, 'eyebrow, title, gear, subtitle');
  assert.match(header, /<div class="title-row"><h1 id="topic-title"><\/h1><button id="settings-open" type="button" class="settings-gear" aria-label="Topic settings" aria-haspopup="dialog" title="Topic settings" hidden>/);
  assert.doesNotMatch(main, /This topic/);
  assert.equal(main.includes('id="topic-state"'), false, 'where it stands is not on the page');
  // Item 465: the people are the Team, in the header after the subtitle, which aim.css sets on the title row's right.
  const team = header.indexOf('id="topic-people"');
  assert.ok(team > subtitle, 'the Team follows the subtitle, in the header');
  assert.match(header, /<section id="topic-people" class="topic-people" aria-labelledby="people-heading"><h2 id="people-heading">Team<\/h2><div id="participants"/);
  assert.equal(main.slice(main.indexOf('</header>')).includes('id="topic-people"'), false, 'no People after the messages');
  // The New message composer at rest is in the feed (reply-stacks.mjs places it just above More), not after the Notebook.
  const feed = main.slice(main.indexOf('<section id="messages"'), main.indexOf('<button id="more-messages"'));
  assert.match(feed, /^<section id="messages" aria-label="Conversation">\s*<dialog id="new-message-sheet" class="composer-home"/);
  assert.ok(main.indexOf('id="new-message-sheet"') < main.indexOf('id="notebook"'), 'before the Notebook');
  const dialog = html.slice(html.indexOf('<dialog id="topic-settings"'), html.indexOf('</dialog>', html.indexOf('<dialog id="topic-settings"')));
  assert.match(dialog, /aria-labelledby="settings-title"/);
  assert.match(dialog, /<h2 id="settings-title" tabindex="-1">Topic settings<\/h2><button id="settings-close" type="button" aria-label="Close topic settings">✕<\/button>/);
  assert.match(dialog, /id="topic-state"/);
});

// D13: on a phone Topic settings fills the screen, by a rule of its own that
// wins over its laptop size; .settings-body fills it, so a press lands on it.
test('Topic settings has its own phone rule that fills the screen, and its body fills the dialog', () => {
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/dialog#topic-settings\{([^}]*)\}/g)];
  const phone = rules.find(match => css.slice(css.lastIndexOf('@media', match.index), match.index).startsWith('@media(max-width:760px){') && !css.slice(css.lastIndexOf('@media', match.index), match.index).includes('}'));
  assert.ok(phone, 'a phone rule names dialog#topic-settings');
  const rule = phone[1];
  for (const value of ['width:100%', 'max-width:100%', 'height:100dvh', 'max-height:100dvh', 'border-radius:0', 'border:0', 'margin:0']) assert.ok(rule.includes(value), value);
  assert.match(css, /dialog#topic-settings\{width:min\(34rem,calc\(100vw - 3rem\)\)/, 'sized to its few fields on a laptop');
  assert.match(css, /\.settings-body\{min-height:100%/);
});

// On the topic's own page its state is never cut short (release 20's rule for
// the panel): in the subtitle its words wrap in a box, as in Topic settings.
// Each pill is filled with no ring; only the reader's black pill has a thin
// edge, in the dark theme, so its shape shows.
test('the subtitle\'s state wraps whole, and the people\'s pills are filled with no ring', () => {
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = selector => [...rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selectors]) => selectors.split(',').map(s => s.trim()).includes(selector)).map(([, , body]) => body).join(';');
  const subtitle = declarations('.topic-subtitle .topic-state');
  for (const value of ['max-width:none', 'overflow:visible', 'white-space:normal']) assert.ok(subtitle.includes(value), `the subtitle's state: ${value}`);
  assert.doesNotMatch(subtitle, /max-width:100%|text-overflow|nowrap/);
  const pill = declarations('.person-pill');
  assert.match(pill, /background:var\(--agent-tag,#[0-9a-f]{6}\)/, 'filled with the agent\'s colour, or a person\'s neutral tint');
  assert.doesNotMatch(pill, /box-shadow|border:/, 'no ring');
  const rings = [...rules.matchAll(/([^{}]*\.person-pill[^{}]*)\{([^{}]*box-shadow[^{}]*)\}/g)].map(([, selectors, body]) => [selectors.trim(), body.match(/box-shadow:[^;}]*/)[0]]);
  assert.deepEqual(rings, [['.person-pill.own-pill', 'box-shadow:0 0 0 1px var(--line)']], 'only the reader\'s pill has an edge');
  assert.ok(css.lastIndexOf('@media(prefers-color-scheme:dark){', css.indexOf('.person-pill.own-pill{background:#000;box-shadow')) > css.indexOf('.person-pill.own-pill{background:#000;color'), 'and only in the dark theme');
});
