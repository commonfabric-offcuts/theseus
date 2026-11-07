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

const key = (field, name, more = {}) => field.dispatch('keydown', { key: name, shiftKey: false, isComposing: false, repeat: false, ...more });
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

test('Escape and Cancel leave the words as they were and send nothing', async t => {
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
  assert.equal(f.dom.document.activeElement, named(f.hosts.target, 'write-open'), 'the focus goes back to the button that opened it');
  named(f.hosts.target, 'write-open').click();
  assert.equal(named(f.hosts.target, 'writer-cancel').className, 'link-button');
  named(f.hosts.target, 'writer-cancel').click(); await drain();
  assert.deepEqual(f.sent, []);
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
