// The pipeline's words and its small parts below the browser (item 84;
// docs/pipeline.md): every sentence the page builds from a view answer, the
// routes to the page and an item's record, the rail's Pipeline row, the outcome
// page's line, and the one-line add. The page itself is checked in the browser
// (tests/pipeline_native.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './fixtures/ui_dom.mjs';
import {
  checkPipeline, duration, eventRuns, eventWords, factBoxes, firstLine, listWords, placedWords, sourceRuns, typicalCell, typicalWords, waitsWords,
} from '../web/pipeline-words.mjs';
import { PipelinePage, PipelineRow, paintPipelineLine, pipelineHref, titleLine } from '../web/pipeline.mjs';
import { parseRoute, routeHref } from '../web/topic-navigation.mjs';

const at = (h, m = 0) => new Date(2026, 10, 6, h, m).getTime();
const NOW = at(7, 30);

test('a message becomes a title by its first sentence, without its marks or the names it opens with', () => {
  assert.equal(firstLine('@Tony **Could** the page say which release is live? And more after.'), 'Could the page say which release is live?');
  assert.equal(firstLine('\n\n  - Make the rail one line shorter; then the rest'), 'Make the rail one line shorter');
  assert.equal(firstLine('1. @fable, @warp: Fold the shipped list by release. It is long.'), 'Fold the shipped list by release');
  assert.equal(firstLine('Short: a colon this early is kept whole'), 'Short: a colon this early is kept whole');
  const long = firstLine('word '.repeat(40));
  assert.ok(long.endsWith('…') && long.length <= 101 && !long.includes('  '), long);
  assert.equal(firstLine(''), '');
});

test('durations, lists and typical times read as a person says them', () => {
  assert.deepEqual([duration(99 * 60000), duration(25 * 60000), duration(23 * 3600000), duration(-5)], ['1 h 39 min', '25 min', '23 h', '0 min']);
  assert.deepEqual([listWords([1]), listWords([1, 2]), listWords([1, 2, 3])], ['1', '1 and 2', '1, 2 and 3']);
  assert.equal(typicalWords({ too_few: 2, min: 3 }), 'Too few past items to show a typical time for this stage: 2 so far, and it takes 3.');
  assert.equal(typicalWords({ ms: 20 * 60000, of: 3, basis: 'size', loose: true }, { size: 'large' }),
    'Past large items took 20 min in this stage (median of 3). Only a few past items, so read it loosely.');
  assert.equal(typicalWords({ ms: 3600000, of: 7, basis: 'release', loose: false }), 'Past releases took 1 h in this stage (median of the last 7).');
  assert.equal(typicalWords({ ms: 60000, of: 5, basis: 'outcome', loose: false }, { unitMany: 'decks' }),
    "Past data: this outcome's past decks took 1 min in this stage (median of 5). Not a promise.");
  assert.deepEqual([typicalCell({ too_few: 1, min: 3 }), typicalCell({ ms: 45 * 60000, of: 4 }), typicalCell(null)],
    [['Too few past items', '1 so far'], ['45 min', 'median of 4'], ['', '']]);
});

test('where an item came from reads as one line, folds past three, and names no topic the reader cannot open', () => {
  const message = (seq, author = 'fable', topic = 'Shared targets') => ({ kind: 'message', readable: true, seq, author, topic_title: topic, topic_id: 't1', message_id: 'm' + seq });
  const three = sourceRuns({ shown: [message(257, 'tony'), message(263), { kind: 'note', text: 'the wake plan, step 6' }], count: 3, messages: 2, notes: 1, yours: 1 }, 'tony');
  assert.equal(three.parts.map(part => part.text).join(''), 'Shared targets #257 (you), and #263; the wake plan, step 6');
  assert.equal(three.folds, false);
  assert.equal(three.summary, 'From Shared targets and the wake plan, step 6 · 2 messages and 1 note, 1 from you');
  const four = sourceRuns({ shown: [message(1), message(2), message(3), { kind: 'message', readable: false }], count: 9, messages: 4, notes: 0, yours: 0 }, 'tony');
  assert.equal(four.folds, true);
  assert.equal(four.more, 5);
  assert.equal(four.parts.at(-1).text, "a message you can't open");
  assert.ok(!four.parts.some(part => part.message && !part.message.readable));
});

test('a move, a drop, an Undo and an edit say who did it and when', () => {
  const words = { next: 'Next', later: 'Later' };
  assert.equal(placedWords({ kind: 'moved', by: 'tony', ms: at(7, 12), section: 'next', relative: { above: 72 } }, 'tony', words, NOW), 'Moved above 72 by you, 7:12 AM.');
  assert.equal(placedWords({ kind: 'moved', by: 'fable', ms: at(6, 35), section: 'later', relative: null,
    because: { author: 'tony', topic_title: 'Friction log' } }, 'tony', words, NOW), 'Moved to Later by fable, 6:35 AM, from your Friction log message.');
  assert.equal(placedWords({ kind: 'moved', by: 'tony', ms: at(7), section: 'dropped' }, 'tony', words, NOW), 'Dropped by you, 7:00 AM.');
  assert.equal(placedWords({ kind: 'moved', by: 'tony', ms: at(7), section: 'next', undo_of: 4 }, 'tony', words, NOW), 'Put back by you, 7:00 AM.');
  assert.equal(placedWords({ kind: 'added', by: 'tony', ms: at(7) }, 'tony', words, NOW), null, 'an added item says nothing on its row');
  assert.equal(eventWords({ kind: 'edited', by: 'fable', ms: at(6), payload: { after: { description: 'x', size: 'small' } } }, 'tony', words, NOW),
    'Edited by fable, 6:00 AM: its words and its size.');
  assert.equal(eventWords({ kind: 'added', by: 'fable', ms: at(6), payload: { imported: true } }, 'tony', words, NOW), 'Added by fable, 6:00 AM, from the hand-written page.');
  assert.equal(waitsWords([{ number: 88, shipped: false }, { number: 12, shipped: true }]), ' · waits for 88');
  assert.equal(waitsWords([{ number: 88, shipped: true }]), '', 'once 88 ships, nothing waits');
});

test('a move made on the owner’s word says so, and the item’s record links that word to the message it was said in', () => {
  // Item 170: the coordinator moved an item the owner placed, on the owner's go-ahead.
  const words = { next: 'Next', later: 'Later' };
  const because = { readable: true, message_id: 'm-yes', seq: 41, topic_id: 't-friction', topic_title: 'Friction log', author: 'tony' };
  const moved = { kind: 'moved', by: 'fable', ms: at(6, 35), seq: 9, because,
    payload: { after: { section: 'later' }, relative: null, because_message_id: 'm-yes', go_ahead: 'tony' } };
  assert.equal(eventWords(moved, 'tony', words, NOW), 'Moved to Later by fable on your word, 6:35 AM.');
  assert.equal(eventWords(moved, 'fable', words, NOW), "Moved to Later by you on tony's word, 6:35 AM.");
  assert.deepEqual(eventRuns(moved, 'fable', words, NOW).map(run => [run.text, run.message?.message_id ?? null]),
    [['Moved to Later by you on ', null], ["tony's word", 'm-yes'], [', 6:35 AM.', null]]);
  const dropped = { ...moved, payload: { ...moved.payload, after: { section: 'dropped' } } };
  assert.equal(eventWords(dropped, 'agent-b', words, NOW), "Dropped by fable on tony's word, 6:35 AM.");
  // A reader who cannot open the message is told whose word it was, with nothing to follow.
  const unreadable = { ...moved, because: { readable: false }, payload: { ...moved.payload, because_message_id: null } };
  assert.deepEqual(eventRuns(unreadable, 'agent-b', words, NOW).map(run => [run.text, run.message ?? null]),
    [['Moved to Later by fable on ', null], ["tony's word", null], [', 6:35 AM.', null]]);
  // A move with a because that is not a go-ahead reads as before, and the row says the word too.
  const plain = { ...moved, payload: { ...moved.payload, go_ahead: undefined } };
  assert.deepEqual(eventRuns(plain, 'tony', words, NOW), [{ text: 'Moved to Later by fable, 6:35 AM.' }]);
  assert.equal(placedWords({ kind: 'moved', by: 'fable', ms: at(6, 35), section: 'later', relative: null, because, go_ahead: 'tony' }, 'tony', words, NOW),
    'Moved to Later by fable on your word, 6:35 AM.');
  assert.equal(placedWords({ kind: 'moved', by: 'fable', ms: at(6, 35), section: 'later', relative: null, because }, 'tony', words, NOW),
    'Moved to Later by fable, 6:35 AM, from your Friction log message.');

  // The item's record paints the line with the word as a link to that message, which the Reader opens.
  globalThis.document = Object.assign(dom(), { addEventListener() {} });
  const host = { addEventListener() {}, replaceChildren(...nodes) { this.children = nodes; } };
  const header = { eyebrow: {}, title: {}, description: {} };
  const page = new PipelinePage({ host, header, reader: 'agent-b', instanceId: 'i1', workspace: 'w1', item: 5, read: async () => null, send: async () => null });
  page.record = { workspace_title: 'Theseus', pipeline: { title: 'Pipeline', section_words: words, sized: false },
    item: { number: 5, title: 'Say which release is live', description: '', section: 'dropped', glyph: 'dropped', needs: [], asks: [], shipped: null,
      raised_by: 'fable', raised_note: '', sources: { shown: [], count: 0, messages: 0, notes: 0, yours: 0, topics: [] }, gathering: null, pieces: [],
      events: [{ kind: 'added', by: 'fable', ms: at(6), seq: 8, payload: {} }, dropped] } };
  page.paintRecord(NOW);
  const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
  const lines = walk({ children: host.children }).filter(node => node.tagName === 'li');
  const line = lines.find(node => node.text.startsWith('Dropped'));
  assert.equal(line.text, "Dropped by fable on tony's word, 6:35 AM.");
  const link = walk(line).find(node => node.tagName === 'a');
  assert.ok(link, 'the word is a link');
  assert.equal(link.text, "tony's word");
  assert.deepEqual(parseRoute(new URL(link.href, 'http://theseus.test/')), { kind: 'topic', id: 't-friction', message: 'm-yes' });
  page.record.item.events = [{ kind: 'added', by: 'fable', ms: at(6), seq: 8, payload: {} }, { ...dropped, because: { readable: false } }];
  page.paintRecord(NOW);
  const hidden = walk({ children: host.children }).filter(node => node.tagName === 'li').find(node => node.text.startsWith('Dropped'));
  assert.equal(hidden.text, "Dropped by fable on tony's word, 6:35 AM.");
  assert.equal(walk(hidden).some(node => node.tagName === 'a'), false, 'nothing to follow to a message the reader cannot open');
});

test('the facts boxes say what is live, what is next and what is being built, or an unsized pipeline’s own', () => {
  const pipeline = { ships_in_releases: true, unit_one: 'item', unit_many: 'items' };
  assert.deepEqual(factBoxes({ pipeline, facts: { live: { release: 22, deployed_ms: at(5, 41) }, next_release: null, approved_waiting: [35],
    building: { items: [37, 34], pieces: 1 } } }, NOW),
  [['Live now', 'Release 22', 'deployed 5:41 AM'], ['Next release', 'Nothing combined yet', '35 is approved and waits to be combined.'],
    ['Being built', '2 items in 1 piece', '37, 34']]);
  assert.deepEqual(factBoxes({ pipeline, facts: {} }, NOW)[0], ['Live now', 'Nothing released yet', '']);
  assert.deepEqual(factBoxes({ pipeline: { ships_in_releases: false, unit_one: 'deck', unit_many: 'decks' }, facts: { building: { items: [3], pieces: 1 }, done: 2 } }, NOW),
    [['Being prepared', '1 deck', '3'], ['Done', '2 decks', 'Since this outcome began.']]);
});

test('an answer that is not this instance’s pipeline is refused loudly', () => {
  const good = { instance_id: 'i1', pipeline: { stages: [] }, items: [] };
  assert.equal(checkPipeline(good, 'i1'), good);
  assert.equal(checkPipeline({ instance_id: 'i1', pipeline: null }, 'i1').pipeline, null);
  for (const bad of [null, { error: { message: 'No access' } }, { ...good, instance_id: 'i2' }, { ...good, pipeline: { stages: null } }, { ...good, items: {} }])
    assert.throws(() => checkPipeline(bad, 'i1'), JSON.stringify(bad));
});

test('the pipeline and an item’s record have their own addresses', () => {
  assert.deepEqual(parseRoute(new URL('https://x/?pipeline=building-theseus')), { kind: 'pipeline', id: 'building-theseus' });
  assert.deepEqual(parseRoute(new URL('https://x/?pipeline=w1&item=84')), { kind: 'item', id: 'w1', item: '84' });
  for (const bad of ['?pipeline=w1&item=0', '?pipeline=w1&item=x', '?pipeline=w1&item=84&topic=t1'])
    assert.throws(() => parseRoute(new URL('https://x/' + bad)), bad);
  assert.equal(routeHref({ kind: 'pipeline', id: 'w1' }), '?pipeline=w1');
  assert.equal(routeHref({ kind: 'item', id: 'w1', item: '84' }), '?pipeline=w1&item=84');
  assert.deepEqual([pipelineHref('w1'), pipelineHref('w1', 84)], ['?pipeline=w1', '?pipeline=w1&item=84']);
});

test('the rail’s Pipeline row shows while the pipeline is on, with Waiting on you, and says when it could not be read', async () => {
  globalThis.document = dom();
  const section = document.createElement('section'), host = document.createElement('div');
  let answer = { pipeline: null, you_own: true, you_steer: true };
  const row = new PipelineRow({ section, host, workspace: 'w1', current: true, read: async () => answer, reader: 'tony' });
  assert.equal(await row.load(), true);
  assert.deepEqual([section.hidden, row.on, host.children.length], [true, false, 0]);
  answer = { pipeline: { title: 'Release pipeline', asks: 1, work: null } };
  await row.load();
  const [link] = host.children;
  assert.deepEqual([section.hidden, row.on, link.text, link.href, link['aria-current']], [false, true, 'Release pipelineWaiting on you', '?pipeline=w1', 'page']);
  answer = { error: { message: 'busy' } };
  assert.equal(await row.load(), false);
  assert.equal(host.children[0], link, 'a failed read keeps what was shown');
});

test('the outcome page’s line links the pipeline, or offers Turn on to whoever steers it while it is off', async () => {
  globalThis.document = dom();
  const host = document.createElement('p');
  const paint = answer => paintPipelineLine(host, { workspace: 'w1', read: async () => answer });
  assert.equal(await paint({ pipeline: { title: 'Release pipeline', asks: 0 } }), true);
  assert.deepEqual([host.hidden, host.text, host.children[1].href], [false, 'Pipeline: Release pipeline ›', '?pipeline=w1']);
  await paint({ pipeline: null, you_own: false, you_steer: true });
  assert.deepEqual([host.hidden, host.text], [false, 'Pipeline: off · Turn on'], 'the coordinator turns it on too');
  await paint({ pipeline: null, you_own: false, you_steer: false });
  assert.equal(host.hidden, true, 'a member who does not steer sees no line while it is off');
  assert.equal(await paint({ error: { message: 'busy' } }), false);
});

test('the one-line add: Return sends the trimmed title, an empty line sends nothing, Escape clears it first', () => {
  globalThis.document = dom();
  const sent = [], cancelled = [];
  const form = titleLine({ key: 'add:next', label: 'Add an item to Next', hint: 'Return adds it to Next · Escape clears', submit: title => sent.push(title),
    cancel: had => cancelled.push(had) });
  const [field, hint] = form.children;
  assert.deepEqual([field.placeholder, field['aria-label'], field.maxlength, hint.text], ['Add an item…', 'Add an item to Next', '500', 'Return adds it to Next · Escape clears']);
  const submit = () => form.onsubmit({ preventDefault() {} });
  field.value = '   '; submit();
  assert.deepEqual(sent, []);
  field.value = '  Say which release is live  '; submit();
  assert.deepEqual(sent, ['Say which release is live']);
  const escape = () => field.onkeydown({ key: 'Escape', isComposing: false, preventDefault() {}, stopPropagation() {} });
  escape(); escape();
  assert.deepEqual([field.value, cancelled], ['', [true, false]]);
});

test('a refused act says why under its row and reads the page again, so what it shows is how things stand', async () => {
  const listeners = [], host = { addEventListener: (...args) => listeners.push(args), querySelector: () => null };
  globalThis.document = Object.assign(dom(), { addEventListener() {} });
  globalThis.CSS = { escape: text => text };
  const page = new PipelinePage({ host, header: {}, reader: 'tony', instanceId: 'i1', workspace: 'w1', read: async () => null, send: async () => null });
  let reads = 0, painted = 0;
  page.load = async () => { reads += 1; return true; };
  page.paint = () => { painted += 1; };
  await page.act('item:7', async () => { throw Error('7 moved since this page read it. It is shown where it is now.'); });
  assert.equal(page.errors.get('item:7'), '7 moved since this page read it. It is shown where it is now.');
  assert.equal(reads, 1, 'the page reads again after a refusal');
  await page.act('item:7', async () => {});
  assert.deepEqual([page.errors.has('item:7'), reads], [false, 2], 'an act that goes through clears its refusal and reads again');
  page.load = async () => { throw Error('busy'); };
  await page.act('item:8', async () => { throw Error('refused'); });
  assert.deepEqual([page.errors.get('item:8'), painted > 0], ['refused', true], 'a read that fails still shows the refusal');
});

test('Change stages offers the owner’s word only to the owner: the coordinator sees it on a stage and cannot take it off or remove that stage', () => {
  globalThis.document = Object.assign(dom(), { addEventListener() {} });
  const stages = [{ stage_id: 'build', name: 'Build', done_when: '', gate: { checks: [], owner: false, words: '' }, rounds: 'none', scope: 'piece' },
    { stage_id: 'tony-reads', name: 'Tony reads it', done_when: '', gate: { checks: [], owner: true, words: '' }, rounds: 'none', scope: 'piece' }];
  const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
  const lines = (reader, you_own) => {
    const page = new PipelinePage({ host: { addEventListener() {} }, header: {}, reader, instanceId: 'i1', workspace: 'w1', read: async () => null, send: async () => null });
    const list = page.stageLines({ owner: 'tony', you_own, you_steer: true, stages, version: 3 });
    return Object.fromEntries(walk(list).filter(node => String(node['data-key'] ?? '').startsWith('stage:')).map(line => {
      const roles = walk(line).filter(node => node['data-role']);
      const word = roles.find(node => node['data-role'] === 'gate-owner');
      return [line['data-key'], { word: word ? [word.tagName, word.text, word.title ?? ''] : null, remove: roles.some(node => node['data-role'] === 'stage-remove') }];
    }));
  };
  const owner = lines('tony', true);
  assert.deepEqual(Object.values(owner).map(line => [line.word[0], line.word[1], line.remove]), [['button', 'Your word', true], ['button', 'Your word', true]],
    'the owner taps their word on or off on every stage, and removes any stage');
  const coordinator = lines('fable', false);
  assert.deepEqual(coordinator['stage:build'], { word: null, remove: true }, 'a stage without the owner’s word offers the coordinator no word to give');
  assert.deepEqual(coordinator['stage:tony-reads'].word.slice(0, 2), ['span', 'Tony’s word'], 'the coordinator sees the owner’s word as a fact, not a chip to tap');
  assert.doesNotMatch(coordinator['stage:tony-reads'].word[2], /tap/i);
  assert.equal(coordinator['stage:tony-reads'].remove, false, 'nor removes the stage that waits on it');
});
