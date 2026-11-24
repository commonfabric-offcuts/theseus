// The outcome page's target (items 14, 104; docs/targets.md): the kind as two chips for the owner and words for
// everyone else, "Write the target" saved on Return with no Save button, the ask that later words carry, Reached
// on Return after its words, and the closed target line a topic opens with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDocument, buttons, named } from './targets-dom.mjs';
import { OutcomeTargets, paintTopicTarget } from '../web/targets.mjs';
import { KIND_CHIPS, KIND_QUESTION, WRITE_KEYS, REACH_WHY_FIRST, askWords, kindWords } from '../web/targets-words.mjs';

const drain = () => new Promise(resolve => setImmediate(resolve));

function view(more = {}) {
  return {
    instance_id: 'i', workspace_id: 'w1', workspace_title: 'Pitch deck', owner: 'tony', coordinator: 'fable', you_own: true, you_steer: true,
    target: null, kind: { kind: 'keep', started_by: 'tony', started_ms: null, you_change: true }, word: null, failing_check: null, reached: null,
    reach: null, rounds: 'runs', counts: { passing: 0, failing: 0, measured: 0, holding: 0, not_run: 0, waiting: 0, total: 0 }, groups: [],
    loop: null, problems: null, releases: [], relevant_versions: { checks: 3, workspace: 7 }, ...more,
  };
}

function page(t, answer, { topics = [], refuse = null } = {}) {
  const dom = installDocument(t);
  const hosts = { target: dom.host(), loop: dom.host(), problems: dom.host() };
  const sent = [], reads = [];
  let current = answer;
  const targets = new OutcomeTargets({
    hosts, workspace: 'w1', reader: 'tony',
    read: async (name, args) => { reads.push([name, args]); return name === 'workspace_topics' ? { items: topics, next_cursor: null } : current; },
    send: async (kind, target, args, expected) => { sent.push({ kind, target, args, expected }); return refuse ? { status: 'rejected', error: { message: refuse } } : { status: 'committed' }; },
  });
  return { dom, hosts, targets, sent, reads, set: value => { current = value; } };
}

const key = (field, name, more = {}) => field.dispatch('keydown', { key: name, shiftKey: false, isComposing: false, repeat: false, stopPropagation(){}, ...more });
const type = (field, words) => { field.value = words; field.dispatch('input'); };

test('the owner chooses the kind with two chips, one tap each, and the current one is pressed', async t => {
  const f = page(t, view());
  await f.targets.load();
  const chips = f.hosts.target.querySelectorAll('.kind-chip');
  assert.deepEqual(chips.map(chip => [chip.dataset.key, chip.getAttribute('aria-pressed')]), [['kind:reach', 'false'], ['kind:keep', 'true']]);
  assert.deepEqual(chips.map(chip => chip.querySelector('strong').textContent), KIND_CHIPS.map(([, label]) => label));
  assert.equal(f.hosts.target.querySelector('.kind-chips').getAttribute('role'), 'group');
  assert.equal(f.hosts.target.querySelector('.kind-chips').getAttribute('aria-labelledby'), f.hosts.target.querySelector('.kind-question').getAttribute('id'));
  assert.equal(f.hosts.target.querySelector('.kind-question').textContent, KIND_QUESTION);
  assert.equal(f.hosts.target.querySelectorAll('select').length + f.hosts.target.querySelectorAll('input').length, 0, 'chips, not a dropdown or radios');
  named(f.hosts.target, 'kind:keep').click(); await drain();
  assert.deepEqual(f.sent, [], 'the pressed chip changes nothing');
  named(f.hosts.target, 'kind:reach').click(); await drain();
  assert.deepEqual(f.sent, [{ kind: 'outcome.kind_set', target: { workspace_id: 'w1' }, args: { kind: 'reach' }, expected: { workspace_revision: 7 } }]);
});

test('anyone but the owner, and everyone once it is reached, reads the kind in words', async t => {
  for (const answer of [view({ you_own: false, kind: { kind: 'reach', started_by: 'tony', started_ms: null, you_change: false } }),
    view({ kind: { kind: 'reach', started_by: 'tony', started_ms: null, you_change: true }, reached: { ms: 1, by: 'tony', words: 'Sent', unmet: [] } })]) {
    const f = page(t, answer);
    await f.targets.load();
    assert.equal(f.hosts.target.querySelectorAll('.kind-chip').length, 0);
    assert.equal(f.hosts.target.querySelector('.tg-kind').textContent, kindWords('reach'));
  }
});

test('the coordinator writes the first words in place: Return saves them, and the box has no Save button', async t => {
  const f = page(t, view({ you_own: false, kind: { kind: 'keep', started_by: 'tony', started_ms: null, you_change: false } }));
  await f.targets.load();
  named(f.hosts.target, 'write-open').click();
  const field = named(f.hosts.target, 'writer');
  assert.equal(f.dom.document.activeElement, field, 'the box opens in place with the caret in it');
  assert.deepEqual(buttons(f.hosts.target).map(button => button.textContent).filter(text => /save/i.test(text)), [], 'Return saves; no Save button');
  assert.equal(f.hosts.target.querySelector('.tg-write-keys').textContent, WRITE_KEYS);
  key(field, 'Enter'); await drain();
  assert.deepEqual(f.sent, [], 'no words, nothing sent');
  type(field, 'The deck is ready to send.');
  key(field, 'Enter', { shiftKey: true }); await drain();
  assert.deepEqual(f.sent, [], 'Shift+Return is a new line');
  key(field, 'Enter'); await drain(); await drain();
  assert.deepEqual(f.sent, [{ kind: 'target.propose', target: { workspace_id: 'w1' }, args: { text: 'The deck is ready to send.' }, expected: { target_revision: 3 } }]);
  assert.equal(named(f.hosts.target, 'writer'), null, 'the box closes once saved');
});

test('Escape saves exact changed words while explicit Cancel still sends nothing', async t => {
  const f = page(t, view({ target: { text: 'Old words.', revision: 1, written_by: 'tony', written_ms: 1, earlier: [] } }));
  await f.targets.load();
  named(f.hosts.target, 'write-open').click();
  const field = named(f.hosts.target, 'writer');
  assert.equal(field.value, 'Old words.');
  key(field, 'Enter'); await drain();
  assert.deepEqual(f.sent, [], 'the same words again are no change');
  type(field, 'New words.');
  key(field, 'Escape'); await drain();
  assert.equal(named(f.hosts.target, 'writer'), null);
  named(f.hosts.target, 'write-open').click();
  assert.equal(named(f.hosts.target, 'writer-cancel').className, 'link-button');
  named(f.hosts.target, 'writer-cancel').click(); await drain();
  assert.equal(f.dom.document.activeElement, named(f.hosts.target, 'write-open'), 'explicit Cancel returns focus to its opener');
  assert.deepEqual(f.sent, [{kind:'target.propose',target:{workspace_id:'w1'},args:{text:'New words.'},expected:{target_revision:3}}]);
});

test('later words by the coordinator carry an ask to the owner in a topic chosen by tapping its name', async t => {
  const topics = [{ id: 't-new', title: 'Newest' }, { id: 't-old', title: 'Older' }];
  const f = page(t, view({ you_own: false, target: { text: 'Old words.', revision: 1, written_by: 'fable', written_ms: 1, earlier: [] },
    kind: { kind: 'keep', started_by: 'tony', started_ms: null, you_change: false } }), { topics });
  await f.targets.load();
  named(f.hosts.target, 'write-open').click(); await drain();
  assert.deepEqual(f.reads.filter(([name]) => name === 'workspace_topics'), [['workspace_topics', { workspace_id: 'w1', limit: 4 }]]);
  const chips = f.hosts.target.querySelectorAll('.tg-topic-chip');
  assert.deepEqual(chips.map(chip => [chip.textContent, chip.getAttribute('aria-pressed')]), [['Newest', 'true'], ['Older', 'false']]);
  named(f.hosts.target, 'ask-topic:t-old').click();
  const field = named(f.hosts.target, 'writer');
  type(field, 'New words.');
  key(field, 'Enter'); await drain(); await drain();
  assert.deepEqual(f.sent.map(sent => sent.args), [{ text: 'New words.', ask: { topic_id: 't-old', body: askWords('New words.') } }]);
});

test('with no topic to ask in, Return sends nothing and the box says to start one', async t => {
  const f = page(t, view({ you_own: false, target: { text: 'Old words.', revision: 1, written_by: 'fable', written_ms: 1, earlier: [] },
    kind: { kind: 'keep', started_by: 'tony', started_ms: null, you_change: false } }));
  await f.targets.load();
  named(f.hosts.target, 'write-open').click(); await drain();
  const field = named(f.hosts.target, 'writer');
  type(field, 'New words.');
  key(field, 'Enter'); await drain();
  assert.deepEqual(f.sent, []);
  assert.match(f.hosts.target.querySelector('.tg-topics').textContent, /No topic in this outcome yet/);
});

test('a refused save keeps the words in the box and says why', async t => {
  const f = page(t, view(), { refuse: 'Someone changed the target; read it again.' });
  await f.targets.load();
  named(f.hosts.target, 'write-open').click();
  const field = named(f.hosts.target, 'writer');
  type(field, 'Words.');
  key(field, 'Enter'); await drain(); await drain();
  assert.equal(named(f.hosts.target, 'writer'), field);
  assert.equal(field.value, 'Words.');
  assert.match(f.hosts.target.querySelector('.tg-write').querySelector('.notice').textContent, /Someone changed the target/);
});

test('Reached opens in place, needs his words first, and Return marks it, confirming what is not met when he ticks it', async t => {
  const reach = { offered: false, unmet: [{ check_id: 'units', name: 'Unit checks', why: 'not_run' }] };
  const f = page(t, view({ kind: { kind: 'reach', started_by: 'tony', started_ms: null, you_change: true }, word: 'not_there', reach }));
  await f.targets.load();
  named(f.hosts.target, 'say-reached').click();
  const words = named(f.hosts.target, 'reach-words');
  key(words, 'Enter'); await drain();
  assert.deepEqual(f.sent, []);
  assert.equal(f.hosts.target.querySelector('.tg-reach').querySelector('.notice').textContent, REACH_WHY_FIRST);
  type(words, 'The deck went out.');
  key(words, 'Enter'); await drain(); await drain();
  assert.deepEqual(f.sent.map(sent => sent.args), [{ words: 'The deck went out.' }], 'unticked, nothing is confirmed for him');
  f.sent.length = 0;
  named(f.hosts.target, 'say-reached').click();
  const again = named(f.hosts.target, 'reach-words');
  const anyway = named(f.hosts.target, 'reach-anyway');
  anyway.checked = true; anyway.dispatch('change');
  type(again, 'Sent anyway.');
  key(again, 'Enter'); await drain(); await drain();
  assert.deepEqual(f.sent.map(sent => [sent.kind, sent.args, sent.expected]), [['outcome.reach', { words: 'Sent anyway.', unmet_confirmed: true }, { workspace_revision: 7 }]]);
});

test('a topic opens with its outcome\'s target as one closed line, and none for an outcome with nothing to say', async t => {
  const dom = installDocument(t), host = dom.host();
  paintTopicTarget(host, null, () => {});
  assert.equal(host.hidden, true);
  const target = { kind: 'keep', word: 'not_on_target', text: 'Releases are quick.', workspace_id: 'w1', workspace_title: 'Theseus',
    counts: { passing: 3, failing: 1, measured: 0, holding: 0, not_run: 0, waiting: 0, total: 4 } };
  let opened = 0;
  paintTopicTarget(host, target, () => { opened += 1; });
  const details = host.querySelector('details');
  assert.equal(host.hidden, false);
  assert.equal(details.open, false, 'closed at first');
  assert.match(details.querySelector('summary').textContent, /^Target Not on target yet Theseus/);
  assert.equal(details.querySelector('.tg-text').textContent, 'Releases are quick.');
  details.open = true;
  paintTopicTarget(host, { ...target, word: 'on_target' }, () => {});
  assert.equal(host.querySelector('details').open, true, 'a repaint keeps it open');
  paintTopicTarget(host, { ...target, text: null, word: 'not_there', kind: 'reach' }, () => { opened += 1; });
  assert.equal(host.querySelector('.tg-text').textContent, 'No target written yet.');
  host.querySelector('a').click();
  assert.equal(opened, 1);
});

test('with nothing checking the outcome, Reached still asks him to confirm and sends his confirmation', async t => {
  const f = page(t, view({ kind: { kind: 'reach', started_by: 'tony', started_ms: null, you_change: true }, word: 'not_there', reach: { offered: false, unmet: [] } }));
  await f.targets.load();
  named(f.hosts.target, 'say-reached').click();
  const anyway = named(f.hosts.target, 'reach-anyway');
  assert.ok(anyway, 'the box offers Mark it reached anyway');
  assert.match(anyway.parentElement.textContent, /nothing checks it yet/);
  anyway.checked = true; anyway.dispatch('change');
  const words = named(f.hosts.target, 'reach-words');
  type(words, 'The office moved.');
  key(words, 'Enter'); await drain(); await drain();
  assert.deepEqual(f.sent.map(sent => sent.args), [{ words: 'The office moved.', unmet_confirmed: true }]);
});

test('when Reached is offered, nothing needs confirming', async t => {
  const f = page(t, view({ kind: { kind: 'reach', started_by: 'tony', started_ms: null, you_change: true }, word: 'not_there', reach: { offered: true, unmet: [] } }));
  await f.targets.load();
  assert.equal(named(f.hosts.target, 'say-reached').className, 'primary', 'an offered Reached is the primary action');
  named(f.hosts.target, 'say-reached').click();
  assert.equal(named(f.hosts.target, 'reach-anyway'), null);
});

// Every commit anywhere reads the panels again. A repaint that replaced their nodes would lose a press held across
// it (a click needs its down and its up on the same node), so a repaint keeps every node it draws again, carries
// what changed onto it, and replaces or removes only what did change.
function busyView(more = {}) {
  const reading = (words, at) => ({ run_id: 'r-' + at, release: 20, candidate: false, label: 'Release 20', at_ms: at, value: 18, words, detail: {}, source: 'release-check', note: '' });
  const check = (words, at) => ({ check_id: 'duration', name: 'Release check time', status: 'measured', proves: '', source: 'release-check:duration', unit: 'min',
    latest: reading(words, at), readings: [reading(words, at)], chart: true, rule: null, explain: '' });
  const words = more.words ?? '18 minutes', at = more.at ?? 1000;
  const worse = { check_id: 'duration', name: 'Release check time', kind: 'failed', why: 'moved the wrong way by more than its rule allows', now: 25, base: 18, unit: 'min', fix_topic: null, accepted: null };
  return view({
    kind: { kind: 'reach', started_by: 'tony', started_ms: null, you_change: true }, word: 'not_there', reach: { offered: false, unmet: [] },
    counts: { passing: 0, failing: 0, measured: 1, holding: 0, not_run: 0, waiting: 0, total: 1 },
    groups: [{ name: 'Measures', open: false, counts: { passing: 0, failing: 0, measured: 1, holding: 0, not_run: 0, waiting: 0, total: 1 }, checks: [check(words, at)] }],
    loop: { live: { release: 19 }, left_behind: null, candidate: { label: 'Release 20 candidate', release: 20, state: 'stopped', started_ms: 1, steps: [], steps_total: 0,
      commit: 'c'.repeat(40), worse: [worse], likely_cause: null, account: null, run_id: 'r-cand', you_accept: true } },
    problems: { releases: [{ release: 20, counts: { defect: 1, design_miss: 0 }, closed: 0, problems: [] }] },
    ...more,
  });
}

test('a repaint after a commit leaves every control in place, carries what changed onto it, and keeps the newest handler', async t => {
  const f = page(t, busyView());
  await f.targets.load();
  const controls = () => ({
    write: named(f.hosts.target, 'write-open'), reach: named(f.hosts.target, 'kind:reach'), keep: named(f.hosts.target, 'kind:keep'),
    reached: named(f.hosts.target, 'say-reached'), group: f.hosts.target.querySelector('[data-fold="group:Measures"] > summary'),
    check: f.hosts.target.querySelector('[data-fold="check:duration"] > summary'), accept: f.hosts.loop.querySelector('[data-fold="accept:duration"] > summary'),
    mark: f.hosts.loop.querySelector('rect'), problems: f.hosts.problems.querySelector('[data-fold="problems"] > summary'),
  });
  const before = controls();
  for (const [name, node] of Object.entries(before)) assert.ok(node, `${name} is drawn`);
  // A commit elsewhere: the same view again.
  await f.targets.load();
  for (const [name, node] of Object.entries(controls())) assert.equal(node, before[name], `${name} is the same node after a repaint that changes nothing`);
  // A commit that changes what the panel shows: a new reading and a newer revision.
  f.set(busyView({ words: '17 minutes', at: 2000, relevant_versions: { checks: 4, workspace: 8 } }));
  await f.targets.load();
  for (const [name, node] of Object.entries(controls())) assert.equal(node, before[name], `${name} is the same node after a repaint that changes the panel`);
  assert.match(before.check.textContent, /17 minutes/, 'what changed is carried onto the shown node');
  assert.doesNotMatch(f.hosts.target.textContent, /18 minutes/, 'and the old words are gone');
  before.keep.click(); await drain();
  assert.deepEqual(f.sent.map(sent => sent.expected), [{ workspace_revision: 8 }], 'the shown chip sends with the newest revision');
});

test('a repaint removes what is no longer drawn and moves the pressed chip, on the same nodes', async t => {
  const f = page(t, busyView());
  await f.targets.load();
  const reach = named(f.hosts.target, 'kind:reach'), keep = named(f.hosts.target, 'kind:keep');
  f.set(busyView({ kind: { kind: 'keep', started_by: 'tony', started_ms: null, you_change: true }, you_steer: false }));
  await f.targets.load();
  assert.equal(named(f.hosts.target, 'kind:reach'), reach);
  assert.deepEqual([reach.getAttribute('aria-pressed'), keep.getAttribute('aria-pressed')], ['false', 'true']);
  assert.equal(named(f.hosts.target, 'say-reached'), null, 'an outcome to keep is never said to be reached');
  assert.equal(named(f.hosts.target, 'write-open'), null, 'nor written by someone who does not steer it');
});

test('the topic\'s target line keeps its summary across a repaint', t => {
  const dom = installDocument(t), host = dom.host();
  const target = { kind: 'keep', word: 'not_on_target', text: 'Releases are quick.', workspace_id: 'w1', workspace_title: 'Theseus',
    counts: { passing: 3, failing: 1, measured: 0, holding: 0, not_run: 0, waiting: 0, total: 4 } };
  paintTopicTarget(host, target, () => {});
  const summary = host.querySelector('summary');
  paintTopicTarget(host, target, () => {});
  paintTopicTarget(host, { ...target, word: 'on_target' }, () => {});
  assert.equal(host.querySelector('summary'), summary);
  assert.match(summary.textContent, /On target/);
});

test('a fold the reader opened stays open across a repaint that lands before its toggle event, and one he never touched follows the page', async t => {
  const f = page(t, busyView());
  await f.targets.load();
  const accept = f.hosts.loop.querySelector('[data-fold="accept:duration"]'), group = f.hosts.target.querySelector('[data-fold="group:Measures"]');
  const numbers = f.hosts.loop.querySelector('.chart-numbers');
  assert.deepEqual([accept.open, group.open, numbers.open], [false, false, false]);
  // His click opens them; the browser's toggle event comes later, after the commit's repaint here.
  accept.open = true; numbers.open = true;
  await f.targets.load();
  assert.equal(accept.open, true, 'Ship it anyway stays open');
  assert.equal(f.hosts.loop.querySelector('.chart-numbers').open, true, 'a chart\'s numbers stay open');
  assert.equal(group.open, false, 'a fold he did not touch is left as the page draws it');
  // The page opens a group itself when one of its checks fails, and closes it again when none does.
  const failing = busyView();
  failing.groups[0].open = true;
  f.set(failing); await f.targets.load();
  assert.equal(group.open, true);
  f.set(busyView()); await f.targets.load();
  assert.equal(group.open, false);
  assert.equal(accept.open, true, 'while his own choice stays');
});

// Item 404: Complete · Archive, two quiet words for the owner of an outcome neither reached nor ended; one press each,
// with no confirm step; Bring back gives the keys to the word that ended it.
function endPage(t, answer, { refuse = null } = {}) {
  const dom = installDocument(t);
  const hosts = { target: dom.host(), loop: dom.host(), problems: dom.host() };
  const sent = [], changes = [];
  let current = answer, release = null;
  const targets = new OutcomeTargets({
    hosts, workspace: 'w1', reader: 'tony', read: async () => current,
    send: (kind, target, args, expected) => { sent.push({ kind, target, args, expected }); return new Promise(resolve => { release = () => resolve(refuse ? { status: 'rejected', error: { message: refuse } } : { status: 'committed', result: {} }); }); },
    changed: async change => { changes.push(change); },
  });
  return { hosts, targets, sent, changes, set: value => { current = value; }, release: () => release() };
}

test('the owner sees Complete · Archive as two quiet named words in the kind block; a press sends once, reads Completing… and a second press sends nothing', async t => {
  const f = endPage(t, view({ kind: { kind: 'reach', started_by: 'tony', started_ms: null, you_change: true } }));
  await f.targets.load();
  const line = f.hosts.target.querySelector('.tg-end');
  assert.ok(line, 'the line is there for the owner');
  const complete = named(f.hosts.target, 'end:completed'), archive = named(f.hosts.target, 'end:archived');
  assert.deepEqual([complete.textContent, archive.textContent], ['Complete', 'Archive']);
  assert.equal(line.textContent, 'Complete · Archive');
  for (const [button, title] of [[complete, 'Complete this outcome: it leaves your outcomes, and you can bring it back'],
    [archive, 'Archive this outcome: you’re not pursuing it; it leaves your outcomes, and you can bring it back']]) {
    assert.deepEqual([button.getAttribute('type'), button.getAttribute('title'), button.getAttribute('aria-label')], ['button', title, title]);
    assert.ok(button.className.split(' ').includes('link-button'), 'a quiet word, not a boxed button');
  }
  const kindBlock = f.hosts.target.querySelector('.tg-kind').parent;
  assert.ok(kindBlock.contains(line) && kindBlock.children.indexOf(line) > kindBlock.children.indexOf(f.hosts.target.querySelector('.tg-kind')),
    'after the kind chips and "Say it is reached"');
  complete.click(); await drain();
  assert.deepEqual(f.sent, [{ kind: 'outcome.end_set', target: { workspace_id: 'w1' }, args: { state: 'completed' }, expected: { workspace_revision: 7 } }],
    'one press does it: no confirm step, no words to type');
  assert.equal(named(f.hosts.target, 'end:completed').textContent, 'Completing…');
  named(f.hosts.target, 'end:completed').click(); named(f.hosts.target, 'end:archived').click(); await drain();
  assert.equal(f.sent.length, 1, 'a second press sends nothing');
  f.set(view({ kind: { kind: 'reach', started_by: 'tony', started_ms: null, you_change: false }, end: { state: 'completed', by: 'tony', ms: 1 } }));
  f.release(); await drain(); await drain(); await drain();
  assert.deepEqual(f.changes, [{ state: 'completed', refused: false }], 'the page reads again, so Where it stands says it');
  assert.equal(f.hosts.target.querySelector('.tg-end'), null, 'once completed, the line goes');
  assert.equal(named(f.hosts.target, 'say-reached'), null, '"Say it is reached" is not offered');
  assert.equal(f.hosts.target.querySelector('.tg-kind').textContent, kindWords('reach'), 'the kind in words only');
  assert.equal(named(f.hosts.target, 'write-open'), null, 'no new words are offered while it is kept to read');
});

test('Core\'s refusal shows in the card\'s notice and the card reads again; nobody but the owner, and no reached outcome, is offered the line', async t => {
  const f = endPage(t, view(), { refuse: 'Only tony, this outcome\'s owner, archives, completes or brings it back' });
  await f.targets.load();
  named(f.hosts.target, 'end:archived').click(); await drain();
  f.release(); await drain(); await drain(); await drain();
  assert.equal(f.hosts.target.querySelector('.notice').textContent, 'Only tony, this outcome\'s owner, archives, completes or brings it back');
  assert.deepEqual(f.changes, [{ state: 'archived', refused: true }], 'a refused press reads the page again too, as a stale one must');
  assert.equal(named(f.hosts.target, 'end:archived').textContent, 'Archive', 'no longer busy');
  for (const answer of [view({ you_own: false, kind: { kind: 'keep', started_by: 'tony', started_ms: null, you_change: false } }),
    view({ kind: { kind: 'reach', started_by: 'tony', started_ms: null, you_change: false }, reached: { ms: 1, by: 'tony', words: 'Sent', unmet: [] } })]) {
    const g = endPage(t, answer);
    await g.targets.load();
    assert.equal(g.hosts.target.querySelector('.tg-end'), null);
    assert.equal(named(g.hosts.target, 'end:completed'), null);
  }
});

test('Bring back sends open with the page\'s revision, and the keys land on the word that ended it', async t => {
  const f = endPage(t, view({ kind: { kind: 'keep', started_by: 'tony', started_ms: null, you_change: false }, end: { state: 'archived', by: 'tony', ms: 1 } }));
  await f.targets.load();
  const back = f.targets.bringBack(); await drain();
  assert.deepEqual(f.sent, [{ kind: 'outcome.end_set', target: { workspace_id: 'w1' }, args: { state: 'open' }, expected: { workspace_revision: 7 } }]);
  f.targets.bringBack(); await drain();
  assert.equal(f.sent.length, 1, 'a second press sends nothing');
  f.set(view());
  f.release(); await back;
  assert.deepEqual(f.changes, [{ state: 'open', refused: false }]);
  assert.equal(document.activeElement, named(f.hosts.target, 'end:archived'), 'the keys go to Archive, which ended it');
});
