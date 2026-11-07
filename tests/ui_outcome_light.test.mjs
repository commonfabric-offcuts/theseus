// The outcome light below the browser (item 86, docs/outcome-light.md): every
// word of mockup 86's After column from each light, lead, fact and also kind,
// the times said out loud, the rail row's pieces, the panel, the "Also waiting
// on you" line and the peek's rules. The fixture's times are the mockup's: it
// is 6:47 AM on Friday 6 November 2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clock, spokenTime } from '../web/times.mjs';
import { alsoWords, factParts, lastLine, leadWords, lightName, shortPieces, SOURCE, MAYBE } from '../web/outcome-light-words.mjs';
import { LightPeek, paintAlsoWaiting, paintRowLight, paintStanding, paintStandingFailed, partsText } from '../web/outcome-light.mjs';

const NOW = new Date(2026, 10, 6, 6, 47).getTime();
clock.now = () => NOW;
const at = (day, hour, minute, year = 2026, month = 10) => new Date(year, month, day, hour, minute).getTime();
const TODAY_640 = at(6, 6, 40), TODAY_615 = at(6, 6, 15), YESTERDAY_315 = at(5, 15, 15), TUESDAY_410 = at(3, 16, 10);
const words = parts => partsText(parts);
const light = (name, short, extra = {}) => ({ light: name, label: { waiting: 'Waiting on you', built: 'Being worked on', done: 'Done', quiet: 'Quiet' }[name] ?? null, short, unreadable: false, ...extra });
const pieces = value => shortPieces(value).map(words);

// A small DOM: elements with children, text, attributes and listeners.
class Element {
  constructor(tag) { Object.assign(this, { tag, children: [], dataset: {}, attributes: {}, hidden: false, className: '', listeners: {}, style: {}, parent: null }); }
  append(...nodes) { for (const node of nodes) { if (node instanceof Element) node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  dispatch(name, event = {}) { for (const fn of this.listeners[name] ?? []) fn(event); }
  contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
  matches() { return true; }
  all() { return this.children.flatMap(node => node instanceof Element ? [node, ...node.all()] : []); }
  get text() { return (this.textContent ?? '') + this.children.map(node => node instanceof Element ? node.text : String(node)).join(''); }
  getBoundingClientRect() { return this.box; }
  focus(options) { globalThis.document.activeElement = this; globalThis.document.focusOptions = options; }
}
function dom(t, { hover = true, width = 1440, height = 900 } = {}) {
  const previous = { document: globalThis.document, window: globalThis.window };
  const listeners = {};
  globalThis.document = { createElement: tag => new Element(tag), addEventListener: (name, fn) => (listeners['document:' + name] ??= []).push(fn) };
  globalThis.window = { innerWidth: width, innerHeight: height, matchMedia: () => ({ matches: hover }), addEventListener: (name, fn) => (listeners['window:' + name] ??= []).push(fn) };
  t.after(() => Object.assign(globalThis, previous));
  return { fire: (name, event = {}) => { for (const fn of listeners[name] ?? []) fn(event); } };
}

test('times said out loud, in each form, for today, yesterday, two to six days ago, a week ago and another year', () => {
  const forms = ['at', 'since', 'short', 'day', 'dayShort'];
  const said = ms => forms.map(form => spokenTime(ms, form));
  assert.deepEqual(said(at(6, 6, 45)), ['at 6:45 AM', '6:45 AM', '6:45 AM', '6:45 AM', '6:45 AM']);
  assert.deepEqual(said(at(5, 21, 40)), ['yesterday at 9:40 PM', 'yesterday at 9:40 PM', 'yesterday 9:40 PM', 'yesterday', 'yesterday']);
  assert.deepEqual(said(at(4, 16, 10)), ['Wednesday at 4:10 PM', 'Wednesday at 4:10 PM', 'Wed 4:10 PM', 'Wednesday', 'Wed']);
  assert.deepEqual(said(TUESDAY_410), ['Tuesday at 4:10 PM', 'Tuesday at 4:10 PM', 'Tue 4:10 PM', 'Tuesday', 'Tue']);
  assert.deepEqual(said(at(31, 16, 10, 2026, 9)), ['Saturday at 4:10 PM', 'Saturday at 4:10 PM', 'Sat 4:10 PM', 'Saturday', 'Sat'], 'six days ago');
  assert.deepEqual(said(at(30, 16, 10, 2026, 9)), ['on Oct 30 at 4:10 PM', 'Oct 30 at 4:10 PM', 'Oct 30 4:10 PM', 'Oct 30', 'Oct 30'], 'seven days ago is dated');
  assert.deepEqual(said(at(3, 16, 10, 2025)), ['on Nov 3, 2025 at 4:10 PM', 'Nov 3, 2025 at 4:10 PM', 'Nov 3, 2025 4:10 PM', 'Nov 3, 2025', 'Nov 3, 2025'], 'another year says its year');
  // Talk in the last hour, by the part of the day.
  assert.equal(spokenTime(TODAY_615, 'part'), 'this morning');
  assert.equal(spokenTime(at(6, 14, 0), 'part', at(6, 21, 0)), 'this afternoon');
  assert.equal(spokenTime(at(6, 19, 0), 'part', at(6, 21, 0)), 'this evening');
  assert.equal(spokenTime(at(5, 23, 50), 'part'), 'yesterday');
});

test('the rail row says each light as a state and a time, in two pieces', () => {
  assert.deepEqual(pieces(light('waiting', { kind: 'asks', count: 1 })), ['Waiting on you ·', '1 question']);
  assert.deepEqual(pieces(light('waiting', { kind: 'asks', count: 2 })), ['Waiting on you ·', '2 questions']);
  assert.deepEqual(pieces(light('built', { kind: 'seen', ms: TODAY_640 })), ['Worked on', 'at 6:40 AM']);
  assert.deepEqual(pieces(light('done', { kind: 'checks_pass' })), ['Done', ''], 'Done alone: what makes it done is behind the ⓘ');
  assert.deepEqual(pieces(light('done', { kind: 'reached', ms: YESTERDAY_315 })), ['Done ·', 'reached yesterday']);
  assert.deepEqual(pieces(light('quiet', { kind: 'since', ms: YESTERDAY_315 })), ['Quiet since', 'yesterday 3:15 PM']);
  assert.deepEqual(pieces(light('quiet', { kind: 'since', ms: TUESDAY_410 })), ['Quiet since', 'Tue 4:10 PM']);
  assert.deepEqual(pieces(light('quiet', { kind: 'talk', ms: TODAY_615, how: 'posted', since_ms: TUESDAY_410 })), ['Quiet since', 'Tue 4:10 PM']);
  assert.deepEqual(pieces(light('quiet', { kind: 'no_topics' })), ['No topics yet', '']);
  assert.deepEqual(pieces(light('quiet', { kind: 'since', ms: null })), ['Quiet', ''], 'no time known: Quiet alone');
  assert.deepEqual(pieces({ light: null, label: null, short: null, unreadable: true }), ['Couldn’t check', 'where it stands']);
});

test('talk outside Now is quiet since the last work in Now: the row and the name say that state and time alone, never the talk', () => {
  for (const how of ['turn', 'posted']) {
    const talk = light('quiet', { kind: 'talk', ms: TODAY_615, how, since_ms: TUESDAY_410 });
    assert.deepEqual(pieces(talk), ['Quiet since', 'Tue 4:10 PM']);
    assert.equal(words(lightName(talk)), 'Quiet since Tuesday at 4:10 PM');
    for (const text of [...pieces(talk), words(lightName(talk))]) assert.doesNotMatch(text, /post|work|apart|6:15/, 'the talk is the Last line\'s, not the light\'s');
  }
  // The talk form's "since" is the last work in Now, never the talk's own time: with none, Quiet alone.
  const never = light('quiet', { kind: 'talk', ms: TODAY_615, how: 'posted', since_ms: null });
  assert.deepEqual(pieces(never), ['Quiet', '']);
  assert.equal(words(lightName(never)), 'Quiet');
});

test('the light\'s name with its time, at the top of the peek and the card', () => {
  assert.equal(words(lightName(light('waiting', { kind: 'asks', count: 1 }))), 'Waiting on you · 1 question');
  assert.equal(words(lightName(light('waiting', { kind: 'asks', count: 2 }))), 'Waiting on you · 2 questions');
  assert.equal(words(lightName(light('waiting', { kind: 'other' }))), 'Waiting on you', 'no count, no count said');
  assert.equal(words(lightName(light('built', { kind: 'seen', ms: TODAY_640 }))), 'Worked on at 6:40 AM');
  assert.equal(words(lightName(light('built', { kind: 'seen', ms: YESTERDAY_315 }))), 'Worked on yesterday at 3:15 PM');
  assert.equal(words(lightName(light('built', { kind: 'seen', ms: null }))), 'Being worked on', 'no time known');
  assert.equal(words(lightName(light('done', { kind: 'checks_pass' }))), 'Done');
  assert.equal(words(lightName(light('done', { kind: 'reached', ms: YESTERDAY_315 }))), 'Done · reached yesterday');
  assert.equal(words(lightName(light('quiet', { kind: 'since', ms: YESTERDAY_315 }))), 'Quiet since yesterday at 3:15 PM');
  assert.equal(words(lightName(light('quiet', { kind: 'since', ms: null }))), 'Quiet');
  assert.equal(words(lightName(light('quiet', { kind: 'no_topics' }))), 'No topics yet');
  assert.equal(words(lightName({ light: null, short: null, unreadable: true })), 'Couldn’t check where it stands');
});

test('the Last line names who did the newest thing and where: a question first, then work, then the last activity, then who started it', () => {
  const ask = { kind: 'ask', topic_id: 't-notes', title: 'Speaker notes', title_truncated: false, by: 'fable', ms: at(6, 6, 20) };
  const topicWork = { kind: 'topic_work', topic_id: 't-rail', title: 'No header bar, and the side rail', title_truncated: true, by: 'fable', how: 'posted', ms: TODAY_640 };
  const itemWork = { kind: 'item_work', item: 69, title: 'Notebook pages', by: 'warp', how: 'turn', ms: TODAY_640 };
  const activity = { kind: 'last_activity', by: 'aim-spec', how: 'posted', topic_id: 't-who', topic_title: 'Who answers where', title_truncated: false, ms: YESTERDAY_315 };
  assert.deepEqual(lastLine({ lead: { kind: 'asks', count: 1 }, facts: [ask] }), { label: 'Asked:', by: 'fable', link: { topic: 't-notes', text: 'Speaker notes' } });
  assert.deepEqual(lastLine({ lead: { kind: 'topics_work' }, facts: [topicWork] }), { label: 'Last:', by: 'fable', link: { topic: 't-rail', text: 'No header bar, and the side rail…' } }, 'a cut title says so');
  assert.deepEqual(lastLine({ lead: { kind: 'now_work' }, facts: [itemWork, { kind: 'more_items', numbers: [1] }] }), { label: 'Last:', by: 'warp', link: { item: 69, text: '69. Notebook pages' } });
  assert.deepEqual(lastLine({ lead: { kind: 'now_quiet' }, facts: [{ ...itemWork, kind: 'last_now_work' }] }), { label: 'Last:', by: 'warp', link: { item: 69, text: '69. Notebook pages' } });
  assert.deepEqual(lastLine({ lead: { kind: 'topics_quiet' }, facts: [activity] }), { label: 'Last:', by: 'aim-spec', link: { topic: 't-who', text: 'Who answers where' } });
  assert.equal(lastLine({ lead: { kind: 'topics_quiet' }, facts: [{ ...activity, title_truncated: true }] }).link.text, 'Who answers where…');
  // Facts that say nothing of who did what are passed over; the first that does is the line.
  assert.equal(lastLine({ lead: { kind: 'done' }, facts: [{ kind: 'all_shipped', count: 12, last_release_ms: TUESDAY_410 }, { kind: 'checks_pass', count: 7, last_run_ms: YESTERDAY_315 }, activity] }).link.topic, 't-who');
  assert.deepEqual(lastLine({ lead: { kind: 'no_topics' }, facts: [{ kind: 'created', by: 'tony', ms: null }] }), { text: ['Started by tony.'] });
  assert.deepEqual(lastLine({ lead: { kind: 'reached', by: 'tony', ms: YESTERDAY_315, words: 'Done.' }, facts: [activity] }), { text: ['tony said it was reached'] }, 'a reached outcome says who said so');
  assert.equal(lastLine({ lead: { kind: 'done' }, facts: [{ kind: 'checks_pass', count: 7, last_run_ms: YESTERDAY_315 }] }), null, 'nothing to add: no line');
  assert.equal(lastLine({ lead: { kind: 'unreadable' }, facts: [] }), null);
  assert.equal(lastLine(null), null);
});

test('each lead in mockup 86\'s words', () => {
  const lead = (value, facts = [], outcome = '') => words(leadWords(value, facts, outcome));
  assert.equal(lead({ kind: 'asks', count: 1 }), 'A question is waiting for your answer:');
  assert.equal(lead({ kind: 'asks', count: 2 }), '2 questions are waiting for your answer:');
  assert.equal(lead({ kind: 'now_work', seen: 4, of: 15 }), '4 of the 15 items in Now were worked on in the last hour:');
  assert.equal(lead({ kind: 'now_work', seen: 1, of: 15 }), '1 of the 15 items in Now was worked on in the last hour:');
  assert.equal(lead({ kind: 'now_work', seen: 1, of: 1 }), 'Its one item in Now was worked on in the last hour:');
  assert.equal(lead({ kind: 'now_work', seen: 9, of: 15 }, [{ kind: 'more_items', numbers: [1] }]), '9 of the 15 items in Now were worked on in the last hour. The latest:');
  assert.equal(lead({ kind: 'topics_work' }), 'It has no pipeline, so work in any of its open topics counts. Worked on in the last hour:');
  assert.equal(lead({ kind: 'done', pipeline: true }), 'Everything in its pipeline has shipped, and all its checks pass:');
  assert.equal(lead({ kind: 'done', pipeline: false }), 'All its checks pass:');
  assert.equal(lead({ kind: 'reached', by: 'tony', ms: at(5, 16, 10), words: 'Done.' }, [], 'Pitch deck'), 'tony said Pitch deck was reached, yesterday at 4:10 PM:');
  assert.equal(lead({ kind: 'topics_quiet' }), 'Nothing has been posted or worked on in its open topics since then, and no one is waiting on an answer.');
  const lastNow = [{ kind: 'last_now_work', item: 4, title: 'Phone sign-in survives a restart', by: 'warp', how: 'posted', ms: TUESDAY_410 }];
  assert.equal(lead({ kind: 'now_quiet', of: 15, ever: true }, lastNow), 'None of its 15 items in Now has been worked on since then, and no one is waiting on an answer. The last one worked on:');
  assert.equal(lead({ kind: 'now_quiet', of: 1, ever: true }), 'Its one item in Now has not been worked on since then, and no one is waiting on an answer.');
  assert.equal(lead({ kind: 'now_quiet', of: 15, ever: false }), 'None of its 15 items in Now has been worked on yet, and no one is waiting on an answer.');
  assert.equal(lead({ kind: 'now_quiet', of: 0, ever: false }), 'Nothing is in Now, and no one is waiting on an answer.');
  assert.equal(lead({ kind: 'now_quiet_talk', of: 3, since_ms: TUESDAY_410, talk_ms: TODAY_615, how: 'posted' }),
    'None of its 3 items in Now has been worked on since Tuesday, and no one is waiting on an answer. Someone posted this morning, outside Now:');
  assert.equal(lead({ kind: 'now_quiet_talk', of: 3, since_ms: TUESDAY_410, talk_ms: TODAY_615, how: 'turn' }),
    'None of its 3 items in Now has been worked on since Tuesday, and no one is waiting on an answer. Someone worked in a topic this morning, outside Now:');
  assert.equal(lead({ kind: 'no_topics' }), 'There’s nothing to show until it has a topic.');
  assert.equal(lead({ kind: 'unreadable' }), 'Theseus couldn’t read this outcome’s pipeline just now, so it isn’t guessing. Questions for you are checked separately: if one were waiting, you’d still see it.');
});

test('each fact in mockup 86\'s words, a topic or item first and its detail after " — "', () => {
  const fact = value => { const parts = factParts(value); return parts.link ? `${parts.link.text} — ${words(parts.detail)}` : words(parts.text); };
  assert.equal(fact({ kind: 'item_work', item: 69, title: 'Notebook pages beside topics, marked when they change', by: 'fable', how: 'turn', ms: TODAY_640 }),
    '69. Notebook pages beside topics, marked when they change — fable worked on it at 6:40 AM');
  assert.equal(fact({ kind: 'item_work', item: 91, title: 'The colours, tuned by Warp’s eye', by: 'warp', how: 'posted', ms: at(6, 6, 31) }),
    '91. The colours, tuned by Warp’s eye — warp posted at 6:31 AM');
  assert.equal(fact({ kind: 'topic_work', topic_id: 't1', title: 'How a release ships', by: 'aim-spec', how: 'posted', ms: at(6, 6, 2) }), 'How a release ships — aim-spec posted at 6:02 AM');
  assert.equal(fact({ kind: 'topic_work', topic_id: 't2', title: 'Slide order', by: 'funding', how: 'turn', ms: at(6, 6, 5) }), 'Slide order — funding worked on it at 6:05 AM');
  assert.equal(fact({ kind: 'ask', topic_id: 't3', title: 'Speaker notes', by: 'fable', ms: at(6, 6, 20) }), 'Speaker notes — fable asked at 6:20 AM');
  assert.equal(fact({ kind: 'ask', topic_id: 't4', title: 'Friction log', by: 'warp', ms: at(5, 21, 40) }), 'Friction log — warp asked yesterday at 9:40 PM');
  assert.equal(fact({ kind: 'more_items', numbers: [35, 37, 47, 48, 88, 91] }), 'and 6 more: 35, 37, 47, 48, 88 and 91');
  assert.equal(fact({ kind: 'all_shipped', count: 12, last_release_ms: at(3, 16, 5) }), 'All 12 items have shipped. The last went out Tuesday at 4:05 PM.');
  assert.equal(fact({ kind: 'checks_pass', count: 7, last_run_ms: at(5, 23, 2) }), 'All 7 checks passed when they last ran, yesterday at 11:02 PM.');
  assert.equal(fact({ kind: 'last_activity', by: 'fable', how: 'posted', topic_title: 'Who answers where', ms: YESTERDAY_315 }),
    'The last thing that happened: fable posted in Who answers where, yesterday at 3:15 PM.');
  assert.equal(fact({ kind: 'last_now_work', item: 4, title: 'Phone sign-in survives a restart', by: 'warp', how: 'posted', ms: TUESDAY_410 }),
    '4. Phone sign-in survives a restart — warp posted about it Tuesday at 4:10 PM');
  assert.equal(fact({ kind: 'last_now_work', item: 69, title: 'Notebook pages beside topics, marked when they change', by: 'fable', how: 'turn', ms: at(5, 23, 58) }),
    '69. Notebook pages beside topics, marked when they change — fable worked on it yesterday at 11:58 PM');
  assert.equal(fact({ kind: 'created', by: 'tony', ms: at(6, 6, 30) }), 'Started by tony at 6:30 AM.');
  assert.equal(fact({ kind: 'created', by: 'tony', ms: null }), 'Started by tony.', 'an outcome made before release 21 kept no start time');
});

test('each also-line in mockup 86\'s words', () => {
  const also = value => words(alsoWords(value));
  assert.equal(also({ kind: 'outside_now', by: 'aim-spec', how: 'posted', topic_title: 'Friction log', ms: at(6, 6, 45) }), 'Outside Now, aim-spec posted in Friction log at 6:45 AM.');
  assert.equal(also({ kind: 'also_built', seen: 4, of: 15 }), 'Work is going on too: 4 of the 15 items in Now were worked on in the last hour.');
  assert.equal(also({ kind: 'last_now_work', by: 'warp', how: 'posted', topic_title: 'Phone sign-in', ms: TUESDAY_410 }), 'The last work on anything in Now was warp’s post in Phone sign-in, Tuesday at 4:10 PM.');
  assert.equal(also({ kind: 'last_now_work', by: 'fable', how: 'turn', topic_title: 'Phone sign-in', ms: TUESDAY_410 }), 'The last work on anything in Now was fable’s work in Phone sign-in, Tuesday at 4:10 PM.');
  assert.equal(also({ kind: 'may_be_stalled' }), 'It might be stuck, or someone may be working on it outside Theseus.');
  assert.equal(also({ kind: 'done_again_when', shipped: 12, checks: 7, waiting_on: [13] }), 'Its other 12 items have shipped and all 7 checks pass. It shows Done again when 13 ships and the checks still pass.');
  // No line ever says nobody is working.
  for (const text of [MAYBE, SOURCE]) assert.doesNotMatch(text, /nobody|no one is working/i);
});

test('a rail row keeps each piece whole, the light with the first, and breaks only between them', t => {
  dom(t);
  const small = new Element('small');
  paintRowLight(small, light('quiet', { kind: 'since', ms: YESTERDAY_315 }));
  assert.equal(small.className, 'standing');
  assert.equal(small.dataset.light, 'quiet');
  const [what, gap, when] = small.children;
  assert.deepEqual([what.className, gap, when.className], ['what', ' ', 'when'], 'two pieces with a breakable space between them');
  assert.equal(what.children[0].className, 'outcome-light', 'the light stays with the first piece');
  assert.equal(what.children[0].dataset.light, 'quiet');
  assert.equal(what.children[0].attributes['aria-hidden'], 'true', 'its words say it; the shape is not read out');
  assert.equal(small.text, 'Quiet since yesterday 3:15 PM');
  assert.equal(when.children[0].tag, 'time', 'its time follows the day');
  assert.equal(when.children[0].dataset.form, 'short');
  // The stylesheet keeps each piece on one line.
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  assert.match(css, /#workspaces a small\.standing :is\(\.what,\.when\)\{white-space:nowrap\}/);
  // A light with no time is one piece.
  paintRowLight(small, light('quiet', { kind: 'no_topics' }));
  assert.equal(small.children.length, 1);
  assert.equal(small.text, 'No topics yet');
  // Couldn't check: no light shape, its own words.
  paintRowLight(small, { light: null, short: null, unreadable: true });
  assert.equal(small.dataset.light, 'unknown');
  assert.equal(small.text, 'Couldn’t check where it stands');
});

test('"Where it stands" is two lines, the light with its name and time and the Last line as a link; what it is made of opens in place from the ⓘ', t => {
  dom(t);
  const host = new Element('section'), opened = [];
  host.hidden = true;
  const visible = () => host.children.filter(node => !node.hidden).map(node => node.text);
  const more = () => host.children.find(node => node.id === 'standing-more');
  const info = () => host.all().find(node => node.className === 'standing-info');
  const waiting = { light: light('waiting', { kind: 'asks', count: 1 }), lead: { kind: 'asks', count: 1 },
    facts: [{ kind: 'ask', topic_id: 't-notes', title: 'Speaker notes', title_truncated: false, by: 'fable', ms: at(6, 6, 20) }], also: [{ kind: 'also_built', seen: 4, of: 15 }] };
  const paint = (answer, options = { open: (id, title) => opened.push([id, title]), retry: () => {}, outcome: 'Pitch deck' }) => paintStanding(host, answer, options);
  paint(waiting);
  assert.equal(host.hidden, false);
  // The whole card: its heading with the ⓘ, the light and its name with the time, and one Last line.
  assert.deepEqual(visible(), ['Where it standsi', 'Waiting on you · 1 question', 'Asked: fable in “Speaker notes”']);
  assert.equal(host.children[1].children[0].dataset.light, 'waiting', 'the light leads its name');
  // The Last line's topic is a link that opens it in place; a modified click keeps the browser default.
  const last = host.children.find(node => node.className === 'standing-last');
  const link = last.all().find(node => node.tag === 'a');
  assert.ok(link, 'the Last line\'s topic is a link');
  assert.deepEqual([link.href, link.className], ['?topic=t-notes', 'title'], 'the title is the link, cut to one line by the stylesheet');
  let prevented = false;
  link.onclick({ button: 0, preventDefault: () => { prevented = true; } });
  link.onclick({ button: 0, metaKey: true, preventDefault: () => assert.fail('a modified click keeps the browser default') });
  assert.equal(prevented, true);
  assert.deepEqual(opened, [['t-notes', 'Speaker notes']]);
  // What the light is made of waits, closed, behind the ⓘ.
  assert.equal(more().hidden, true);
  assert.deepEqual([info().tag, info().attributes['aria-label'], info().title, info().attributes['aria-controls'], info().attributes['aria-expanded']],
    ['button', 'What this is made of', 'What this is made of', 'standing-more', 'false']);
  assert.equal(more().text, 'A question is waiting for your answer:Speaker notes — fable asked at 6:20 AMWork is going on too: 4 of the 15 items in Now were worked on in the last hour.' + SOURCE);
  assert.equal(host.all().some(node => node.className === 'retry'), false, 'nothing to try again');
  // The ⓘ opens it in place, and it stays open across the repaint on each commit.
  info().onclick();
  assert.deepEqual([more().hidden, info().attributes['aria-expanded']], [false, 'true']);
  paint(waiting);
  assert.deepEqual([more().hidden, info().attributes['aria-expanded']], [false, 'true'], 'a commit repaints the card; what is open stays open');
  assert.equal(more().all().filter(node => node.tag === 'a')[0].href, '?topic=t-notes', 'its facts link their topics');
  // A second press closes it, and it stays closed across the next repaint.
  info().onclick();
  assert.equal(more().hidden, true);
  paint(waiting);
  assert.deepEqual([more().hidden, info().attributes['aria-expanded']], [true, 'false']);
  // Quiet: the last activity names its topic as a link; behind the ⓘ, someone may be working outside Theseus.
  paint({ light: light('quiet', { kind: 'since', ms: YESTERDAY_315 }), lead: { kind: 'topics_quiet' },
    facts: [{ kind: 'last_activity', by: 'fable', how: 'posted', topic_id: 't-who', topic_title: 'No header bar, and the side rail', title_truncated: true, ms: YESTERDAY_315 }], also: [{ kind: 'may_be_stalled' }] });
  assert.deepEqual(visible(), ['Where it standsi', 'Quiet since yesterday at 3:15 PM', 'Last: fable in “No header bar, and the side rail…”']);
  assert.equal(host.all().find(node => node.tag === 'a').href, '?topic=t-who');
  assert.equal(more().text, 'Nothing has been posted or worked on in its open topics since then, and no one is waiting on an answer.' +
    'The last thing that happened: fable posted in No header bar, and the side rail, yesterday at 3:15 PM.' + MAYBE + SOURCE);
  // An item is named as plain text until it has a page of its own.
  paint({ light: light('built', { kind: 'seen', ms: TODAY_640 }), lead: { kind: 'now_work', seen: 1, of: 1 },
    facts: [{ kind: 'item_work', item: 69, title: 'Notebook pages', by: 'fable', how: 'turn', ms: TODAY_640 }], also: [] }, { open: () => assert.fail('no link') });
  assert.deepEqual(visible(), ['Where it standsi', 'Worked on at 6:40 AM', 'Last: fable in “69. Notebook pages”']);
  assert.equal(host.all().some(node => node.tag === 'a'), false);
  // No topics yet: who started it, with nothing to link.
  paint({ light: light('quiet', { kind: 'no_topics' }), lead: { kind: 'no_topics' }, facts: [{ kind: 'created', by: 'tony', ms: null }], also: [] });
  assert.deepEqual(visible(), ['Where it standsi', 'No topics yet', 'Started by tony.']);
  // Nothing to add: the light's line alone.
  paint({ light: light('done', { kind: 'checks_pass' }), lead: { kind: 'done', pipeline: false }, facts: [{ kind: 'checks_pass', count: 7, last_run_ms: YESTERDAY_315 }], also: [] });
  assert.deepEqual(visible(), ['Where it standsi', 'Done']);
});

test('a card that could not read says so with Try again, its reasons behind the ⓘ, and claims no source; a reached outcome says who said so and adds no small print', t => {
  dom(t);
  const host = new Element('section');
  const visible = () => host.children.filter(node => !node.hidden).map(node => node.text);
  const more = () => host.children.find(node => node.id === 'standing-more');
  let retried = 0;
  paintStandingFailed(host, () => retried++);
  assert.deepEqual(visible(), ['Where it standsi', 'Couldn’t check where it stands', 'Try again']);
  assert.equal(more().text, 'Theseus couldn’t read this outcome’s pipeline just now, so it isn’t guessing. Questions for you are checked separately: if one were waiting, you’d still see it.',
    'why, behind the ⓘ, with no claim of where it comes from');
  const button = host.all().find(node => node.className === 'retry');
  button.onclick();
  assert.equal(retried, 1);
  assert.equal(host.children[1].children[0].dataset.light, 'unknown', 'no light at all');
  // The server's own unreadable answer, with a question still waiting, keeps the question.
  paintStanding(host, { light: light('waiting', { kind: 'asks', count: 1 }, { unreadable: true }), lead: { kind: 'asks', count: 1 }, facts: [], also: [] }, { retry: () => {} });
  assert.equal(host.children[1].text, 'Waiting on you · 1 question');
  // Reached: who said so is the Last line; his words wait behind the ⓘ, with no footnote after them.
  paintStanding(host, { light: light('done', { kind: 'reached', ms: at(5, 16, 10) }), lead: { kind: 'reached', by: 'tony', ms: at(5, 16, 10), words: 'Done.' }, facts: [], also: [] },
    { outcome: 'Pitch deck' });
  assert.deepEqual(visible(), ['Where it standsi', 'Done · reached yesterday', 'tony said it was reached']);
  assert.equal(more().text, 'tony said Pitch deck was reached, yesterday at 4:10 PM:');
});

test('a control on the card that held focus keeps it when a commit repaints the card; focus anywhere else stays where it is', t => {
  dom(t);
  const host = new Element('section'), elsewhere = new Element('input');
  const answer = { light: light('waiting', { kind: 'asks', count: 1 }), lead: { kind: 'asks', count: 1 },
    facts: [{ kind: 'ask', topic_id: 't-notes', title: 'Speaker notes', title_truncated: false, by: 'fable', ms: at(6, 6, 20) }], also: [] };
  const paint = () => paintStanding(host, answer, { open() {}, retry() {} });
  const find = test => host.all().find(test);
  const controls = {
    'the ⓘ': () => find(node => node.className === 'standing-info'),
    'the Last line\'s link': () => find(node => node.tag === 'a' && node.parent.className === 'standing-last'),
    'a fact\'s link': () => find(node => node.tag === 'a' && node.parent.tag === 'li'),
  };
  paint();
  for (const [name, control] of Object.entries(controls)) {
    const before = control();
    before.focus(); paint();
    assert.notEqual(control(), before, `${name} is drawn anew`);
    assert.equal(document.activeElement, control(), `${name} keeps focus across the repaint`);
    assert.deepEqual(document.focusOptions, { preventScroll: true }, `${name} takes focus without scrolling the page to it`);
  }
  // Try again, on a card that could not read, keeps it as well.
  paintStandingFailed(host, () => {});
  const retry = () => find(node => node.className === 'retry');
  const was = retry(); was.focus(); paintStandingFailed(host, () => {});
  assert.notEqual(retry(), was);
  assert.equal(document.activeElement, retry(), 'Try again keeps focus across the repaint');
  // Focus outside the card, or nowhere, is left alone.
  elsewhere.focus(); paint();
  assert.equal(document.activeElement, elsewhere, 'a repaint never takes focus from outside the card');
  document.activeElement = null; paint();
  assert.equal(document.activeElement, null, 'nor gives it when nothing held it');
});

test('"Also waiting on you" names other outcomes\' questions once, in the sidebar\'s order, as each row counts them', t => {
  dom(t);
  const host = new Element('p'), opened = [];
  const row = (id, title, value) => ({ id, title, title_truncated: false, light: value });
  const waiting = count => light('waiting', { kind: 'asks', count });
  const quiet = light('quiet', { kind: 'since', ms: YESTERDAY_315 });
  // On Building Theseus's page, with questions in Pitch deck only.
  paintAlsoWaiting(host, [row('w-build', 'Building Theseus', quiet), row('w-pitch', 'Pitch deck', waiting(1))], 'w-build', (id, title) => opened.push([id, title]));
  assert.equal(host.hidden, false);
  assert.equal(host.text, 'Also waiting on you: 1 in Pitch deck ›');
  const [link] = host.all().filter(node => node.tag === 'a');
  assert.equal(link.href, '?workspace=w-pitch');
  link.onclick({ button: 0, preventDefault() {} });
  assert.deepEqual(opened, [['w-pitch', 'Pitch deck']]);
  // On the handbook's page, two others, in the sidebar's order, each counted as its own row counts.
  paintAlsoWaiting(host, [row('w-build', 'Building Theseus', waiting(2)), row('w-hand', 'Team handbook', quiet), row('w-pitch', 'Pitch deck', waiting(1))], 'w-hand', () => {});
  assert.equal(host.text, 'Also waiting on you: 2 in Building Theseus ›, 1 in Pitch deck ›');
  assert.deepEqual(host.all().filter(node => node.tag === 'a').map(node => node.href), ['?workspace=w-build', '?workspace=w-pitch']);
  // The open outcome is never in the line; with no other outcome waiting there is no line at all.
  paintAlsoWaiting(host, [row('w-build', 'Building Theseus', waiting(2)), row('w-pitch', 'Pitch deck', quiet)], 'w-build', () => {});
  assert.equal(host.hidden, true);
  assert.deepEqual(host.children, []);
});

test('the peek reads when it opens, touches its row, stays while the pointer is on either, and closes on leaving both, Escape or a scroll', async t => {
  const page = dom(t, { width: 1440 });
  const host = new Element('div'), reads = [];
  host.hidden = true;
  let answer = { light: light('quiet', { kind: 'since', ms: YESTERDAY_315 }), lead: { kind: 'topics_quiet' }, facts: [], also: [{ kind: 'may_be_stalled' }] };
  const peek = new LightPeek({ host, read: async id => { reads.push(id); return answer; } });
  host.offsetWidth = 300; host.offsetHeight = 120;
  const row = new Element('a'), other = new Element('a');
  row.box = { left: 0, right: 280, top: 100, bottom: 150 };
  peek.attach(row, { id: 'w1', title: 'Handbook', light: answer.light });
  peek.attach(other, { id: 'w2', title: 'Other', light: answer.light });
  peek.attach(row, { id: 'w1', title: 'Handbook', light: answer.light });
  assert.equal(row.listeners.mouseenter.length, 1, 'attached once, however often the row is painted');
  assert.equal(host.hidden, true, 'no row hovered, no peek');
  row.dispatch('mouseenter');
  assert.equal(host.hidden, false);
  assert.deepEqual([host.style.left, host.style.top], ['278px', '100px'], 'against the row\'s right edge, overlapping it by 2 px, top aligned');
  await new Promise(setImmediate);
  assert.deepEqual(reads, ['w1'], 'read once when it opens');
  assert.equal(host.children[0].text, 'Quiet since yesterday at 3:15 PM');
  assert.equal(host.children.length, 1, 'the card\'s first line and nothing more, with no Last line to say');
  // From the row onto the peek, and back: still open.
  row.dispatch('mouseleave', { relatedTarget: host.children[0] });
  assert.equal(host.hidden, false);
  host.dispatch('mouseleave', { relatedTarget: row });
  assert.equal(host.hidden, false);
  // A commit while it is open reads again; the peek says what the card says, the Last line in plain words.
  answer = { ...answer, light: light('built', { kind: 'seen', ms: TODAY_640 }), lead: { kind: 'topics_work' },
    facts: [{ kind: 'topic_work', topic_id: 't-rail', title: 'Side rail', title_truncated: true, by: 'fable', how: 'posted', ms: TODAY_640 }] };
  await peek.refresh();
  assert.deepEqual(reads, ['w1', 'w1']);
  assert.deepEqual(host.children.map(node => node.text), ['Worked on at 6:40 AM', 'Last: fable in “Side rail…”']);
  assert.equal(host.all().some(node => node.tag === 'a'), false, 'no link in the peek: the row is the way in');
  assert.doesNotMatch(host.text, /This comes from|worked on in the last hour/, 'what the light is made of stays on the outcome\'s page');
  // Leaving both closes it.
  host.dispatch('mouseleave', { relatedTarget: null });
  assert.equal(host.hidden, true);
  await peek.refresh();
  assert.deepEqual(reads, ['w1', 'w1'], 'a closed peek reads nothing');
  // Escape, and a scroll, close it.
  row.dispatch('mouseenter'); assert.equal(host.hidden, false);
  page.fire('document:keydown', { key: 'Escape' }); assert.equal(host.hidden, true);
  row.dispatch('mouseenter'); assert.equal(host.hidden, false);
  page.fire('window:scroll'); assert.equal(host.hidden, true);
  // Focus by keyboard opens it, blur closes it.
  row.dispatch('focus'); assert.equal(host.hidden, false);
  row.dispatch('blur'); assert.equal(host.hidden, true);
});

test('a row focused by keyboard keeps its peek as the rail scrolls it into view; a scroll that takes it out of view, or a scroll under a hovered row, closes it', t => {
  const page = dom(t, { width: 1440 });
  const host = new Element('div'), rail = new Element('nav');
  host.hidden = true; host.offsetWidth = 300; host.offsetHeight = 120;
  const peek = new LightPeek({ host, read: async () => ({ light: light('quiet', { kind: 'since', ms: null }), lead: { kind: 'no_topics' }, facts: [], also: [] }) });
  const row = new Element('a');
  rail.box = { left: 0, right: 280, top: 200, bottom: 600 };
  row.box = { left: 0, right: 280, top: 650, bottom: 700 };
  peek.attach(row, { id: 'w1', title: 'One', light: light('quiet', { kind: 'since', ms: null }) });
  // Tab gives the row focus; the browser then scrolls the rail to show it.
  document.activeElement = row; row.dispatch('focus');
  assert.equal(host.hidden, false);
  row.box = { left: 0, right: 280, top: 550, bottom: 600 };
  page.fire('window:scroll', { target: rail });
  assert.equal(host.hidden, false, 'the scroll that brings the focused row into view keeps its peek');
  assert.deepEqual([host.style.left, host.style.top], ['278px', '550px'], 'and the peek follows the row');
  // The reader scrolls the focused row out of the rail: the peek closes.
  row.box = { left: 0, right: 280, top: 580, bottom: 630 };
  page.fire('window:scroll', { target: rail });
  assert.equal(host.hidden, true, 'a focused row scrolled out of view closes its peek');
  // A row hovered and not focused: any scroll closes it.
  document.activeElement = null; row.box = { left: 0, right: 280, top: 300, bottom: 350 };
  row.dispatch('mouseenter'); assert.equal(host.hidden, false);
  page.fire('window:scroll', { target: rail });
  assert.equal(host.hidden, true, 'a scroll under a hovered row closes its peek');
});

test('the peek opens under its row where the window is too narrow (above it with no room below), a read that fails says to open the outcome, and an old answer never paints', async t => {
  dom(t, { width: 500, height: 400 });
  const host = new Element('div');
  host.hidden = true; host.offsetWidth = 300; host.offsetHeight = 120;
  let release;
  const peek = new LightPeek({ host, read: () => new Promise((resolve, reject) => { release = { resolve, reject }; }) });
  const row = new Element('a'), other = new Element('a');
  row.box = { left: 10, right: 280, top: 100, bottom: 150 }; other.box = row.box;
  peek.attach(row, { id: 'w1', title: 'One', light: light('quiet', { kind: 'since', ms: null }) });
  peek.attach(other, { id: 'w2', title: 'Two', light: light('quiet', { kind: 'since', ms: null }) });
  row.dispatch('mouseenter');
  assert.deepEqual([host.style.left, host.style.top], ['10px', '148px'], 'under the row, overlapping its bottom edge');
  // A row low in the window: no room below, so above it, overlapping its top edge, never over the row.
  const low = new Element('a');
  low.box = { left: 10, right: 280, top: 300, bottom: 350 };
  peek.attach(low, { id: 'w3', title: 'Low', light: light('quiet', { kind: 'since', ms: null }) });
  low.dispatch('mouseenter');
  assert.deepEqual([host.style.left, host.style.top], ['10px', '182px'], 'above the row, overlapping its top edge');
  row.dispatch('mouseenter');
  const first = release;
  other.dispatch('mouseenter');
  first.resolve({ light: light('built', { kind: 'seen', ms: TODAY_640 }), lead: { kind: 'topics_work' }, facts: [], also: [] });
  await new Promise(setImmediate);
  assert.equal(host.children[0].text, 'Quiet', 'the first row\'s late answer does not paint the second row\'s peek');
  release.reject(Error('offline'));
  await new Promise(setImmediate);
  assert.equal(host.children[0].text, 'Couldn’t check where it stands');
  assert.equal(host.children.at(-1).text, 'Open the outcome to try again.');
});

test('on a phone there is no peek: the row\'s words are always there', t => {
  dom(t, { hover: false });
  const host = new Element('div'), reads = [];
  host.hidden = true;
  const peek = new LightPeek({ host, read: async id => reads.push(id) });
  const row = new Element('a');
  peek.attach(row, { id: 'w1', title: 'One', light: light('quiet', { kind: 'since', ms: null }) });
  row.dispatch('mouseenter'); row.dispatch('focus');
  assert.equal(host.hidden, true);
  assert.deepEqual(reads, []);
});

test('the light sets no timer: the page reads it again on each commit, and spoken times follow the day through repaintTimes', async t => {
  dom(t);
  const scheduled = [], real = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval };
  globalThis.setTimeout = (...args) => { scheduled.push('setTimeout'); return real.setTimeout(...args); };
  globalThis.setInterval = (...args) => { scheduled.push('setInterval'); return real.setInterval(...args); };
  t.after(() => Object.assign(globalThis, real));
  const host = new Element('div'), row = new Element('a'), small = new Element('small'), panel = new Element('section'), line = new Element('p');
  host.hidden = true; host.offsetWidth = 100; host.offsetHeight = 50; row.box = { left: 0, right: 100, top: 0, bottom: 20 };
  const answer = { light: light('built', { kind: 'seen', ms: TODAY_640 }), lead: { kind: 'topics_work' }, facts: [{ kind: 'topic_work', topic_id: 't', title: 'T', by: 'fable', how: 'posted', ms: TODAY_640 }], also: [] };
  const peek = new LightPeek({ host, read: async () => answer });
  peek.attach(row, { id: 'w1', title: 'One', light: answer.light });
  row.dispatch('mouseenter');
  await peek.refresh();
  paintRowLight(small, answer.light);
  paintStanding(panel, answer, { open() {}, retry() {} });
  paintAlsoWaiting(line, [{ id: 'w2', title: 'Two', title_truncated: false, light: light('waiting', { kind: 'asks', count: 1 }) }], 'w1', () => {});
  peek.hide();
  assert.deepEqual(scheduled, []);
  const source = readFileSync(new URL('../web/outcome-light.mjs', import.meta.url), 'utf8') + readFileSync(new URL('../web/outcome-light-words.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /setTimeout|setInterval|requestAnimationFrame/);
});
