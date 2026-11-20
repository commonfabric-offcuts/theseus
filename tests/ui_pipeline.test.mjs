// The pipeline's words and its small parts below the browser (item 84;
// docs/pipeline.md): every sentence the page builds from a view answer, the
// routes to the page and an item's record, the rail's Pipeline row, the outcome
// page's line, and the one-line add. The page itself is checked in the browser
// (tests/pipeline_native.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './fixtures/ui_dom.mjs';
import { AttemptError, isBusy, unconfirmed } from '../web/api.mjs';
import {
  checkPipeline, duration, eventRuns, eventWords, factBoxes, firstLine, heldWords, historyLine, listWords, placedWords, sourceRuns, typicalCell, typicalWords, waitsWords,
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

test('a piece set aside says why, where it had got to, and that an Undo leaves it set aside', () => {
  const words = { later: 'Later', now: 'Now' };
  const set_aside = { piece: 'p-1', note: 'The tests miss the real case', stages: ['Build, round 1', 'Review'], numbers: [183, 184] };
  assert.equal(placedWords({ kind: 'moved', by: 'tony', ms: at(7, 12), section: 'later', relative: null, set_aside }, 'tony', words, NOW, 183),
    'Set aside to Later with 184 by you, 7:12 AM, after Build, round 1 › Review: The tests miss the real case');
  assert.equal(placedWords({ kind: 'moved', by: 'fable', ms: at(7, 12), section: 'later', relative: { below: 183 }, set_aside }, 'tony', words, NOW, 184),
    'Set aside to Later with 183 by fable, 7:12 AM, after Build, round 1 › Review: The tests miss the real case');
  assert.equal(placedWords({ kind: 'moved', by: 'tony', ms: at(7, 20), section: 'now', undo_of: 9, set_aside_stays: 'p-1' }, 'tony', words, NOW),
    'Put back by you, 7:20 AM. Its piece stays set aside: a new piece builds it.');
  assert.equal(eventWords({ kind: 'moved', by: 'tony', ms: at(7, 12), payload: { after: { section: 'later' }, set_aside } }, 'tony', words, NOW, 183),
    'Set aside to Later with 184 by you, 7:12 AM, after Build, round 1 › Review: The tests miss the real case');
  assert.equal(eventWords({ kind: 'moved', by: 'tony', ms: at(7, 20), payload: { after: { section: 'now' }, undo_of: 9, set_aside_stays: 'p-1' } }, 'tony', words, NOW),
    'Put back by you, 7:20 AM. Its piece stays set aside: a new piece builds it.');
  assert.equal(historyLine({ name: 'Review', entered_ms: at(6), left_ms: at(7, 12), left_outcome: 'set aside', left_note: 'Set aside: The tests miss the real case' }, NOW),
    'Review: 6:00 AM to 7:12 AM, 1 h 12 min · Set aside: The tests miss the real case');
  // Items 170 and 183 together: the coordinator set the piece aside on the owner's go-ahead, and both the row and the
  // record say whose word it was, the record linking the word to its message for a reader who can open it.
  const because = { readable: true, message_id: 'm-yes', seq: 41, topic_id: 't1', topic_title: 'Pipeline', author: 'tony' };
  assert.equal(placedWords({ kind: 'moved', by: 'fable', ms: at(7, 12), section: 'later', relative: null, set_aside, because, go_ahead: 'tony' }, 'tony', words, NOW, 183),
    'Set aside to Later with 184 by fable on your word, 7:12 AM, after Build, round 1 › Review: The tests miss the real case');
  const onWord = { kind: 'moved', by: 'fable', ms: at(7, 12), because, payload: { after: { section: 'later' }, set_aside, because_message_id: 'm-yes', go_ahead: 'tony' } };
  assert.deepEqual(eventRuns(onWord, 'agent-b', words, NOW, 184).map(run => [run.text, run.message?.message_id ?? null]),
    [['Set aside to Later with 183 by fable on ', null], ["tony's word", 'm-yes'],
      [', 7:12 AM, after Build, round 1 › Review: The tests miss the real case', null]]);
  assert.deepEqual(eventRuns({ ...onWord, because: { readable: false } }, 'agent-b', words, NOW, 184).map(run => run.message ?? null), [null, null, null]);
  assert.deepEqual(eventRuns({ ...onWord, payload: { ...onWord.payload, go_ahead: undefined } }, 'tony', words, NOW, 184),
    [{ text: 'Set aside to Later with 183 by fable, 7:12 AM, after Build, round 1 › Review: The tests miss the real case' }]);
});

test('an item being built offers Set aside to Later… only when the server would take it, and asks why in one line', async () => {
  globalThis.document = Object.assign(dom(), { addEventListener() {} });
  globalThis.CSS = { escape: text => text };
  const sent = [];
  const page = new PipelinePage({ host: { addEventListener() {}, querySelector: () => null }, header: {}, reader: 'tony', instanceId: 'i1', workspace: 'w1',
    read: async () => null, send: async (...args) => { sent.push(args); return { status: 'committed', result: {} }; } });
  page.load = async () => true; page.paint = () => {};
  const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
  const pipeline = { you_steer: true, section_words: { later: 'Later' } };
  const item = { number: 183, section: 'now', version: 4, stage: { name: 'Review' } };
  const labels = piece => page.steerMenu(item, [item], 0, pipeline, true, piece).children.filter(node => node.role === 'menuitem').map(node => node.text);
  assert.deepEqual(labels({ id: 'p-1', items: [183, 184], you_set_aside: true }), ['Open its record', 'Set aside to Later…', 'Drop…']);
  assert.deepEqual(labels({ id: 'p-1', items: [183, 184], you_set_aside: false }), ['Open its record', 'Drop…'], 'never a move the server refuses');
  const menu = page.steerMenu(item, [item], 0, pipeline, true, { id: 'p-1', items: [183, 184], you_set_aside: true });
  menu.children.find(node => node.text === 'Set aside to Later…').onclick();
  assert.equal(page.asiding, 183);
  const form = page.asideLine(item, { id: 'p-1', items: [183, 184], you_set_aside: true });
  const field = walk(form).find(node => node.tagName === 'input');
  assert.deepEqual([field.placeholder, field['aria-label'], walk(form).find(node => node.tagName === 'span').text],
    ['Why set it aside?', 'Why set 183 and 184 aside to Later', 'Return sets 183 and 184 aside to Later, with their stages so far · Escape keeps them']);
  field.value = '   '; form.onsubmit({ preventDefault() {} });
  assert.deepEqual(sent, [], 'an empty line sends nothing');
  field.value = '  The tests miss the real case  '; form.onsubmit({ preventDefault() {} });
  await page.chain;
  assert.deepEqual(sent.map(args => args.slice(0, 4)), [['pipeline.item_move', { workspace_id: 'w1', number: 183 }, { section: 'later', note: 'The tests miss the real case' }, { item_revision: 4 }]]);
  assert.match(sent[0][4], /^[0-9a-f-]{36}$/, 'under an operation of its own');
  assert.equal(page.asiding, null);
  page.asiding = 183;
  field.onkeydown({ key: 'Escape', isComposing: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(page.asiding, null, 'Escape keeps the piece as it is');
  assert.equal(sent.length, 1);
});

// ---- a busy Theseus on the pipeline page (item 192) -------------------------------
// A stand-in for Theseus behind the page's read and send, answering as the real Api
// does: its view and command answers, and, while it is busy, the AttemptError the Api
// throws for the server's own 503 SERVER_BUSY, with the server's words in it.
function busyTheseus() {
  const stage = (stage_id, name) => ({ stage_id, name, done_when: '', gate: { checks: [], owner: false, words: '' }, rounds: 'none', scope: 'piece', added_note: '' });
  // Its pipeline (owned by Tony unless `youOwn`), its stages, and the items in Next.
  const theseus = { stages: [stage('build', 'Build')], items: [], title: 'Pipeline', youOwn: false, version: 3, busyReads: false, busySends: false, reads: 0, sends: 0 };
  const busy = words => new AttemptError(words, 503, { error: { code: 'SERVER_BUSY', message: words, retryable: true } });
  // A read held (holdRead): the next read to start waits on it, and once released answers as Theseus then is.
  theseus.hold = null;
  theseus.holdRead = () => {
    let started, release;
    const begun = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { release = resolve; });
    theseus.hold = { started, gate };
    return { begun, release };
  };
  theseus.read = async (name, args) => {
    theseus.reads += 1;
    const hold = theseus.hold; theseus.hold = null;
    if (hold) { hold.started(); await hold.gate; }
    if (theseus.busyReads) throw busy('This read could not enter its bounded lane.');
    // A read whose connection dropped, with the Api's own words for it, which are a change's words, not a read's.
    if (theseus.failReads) throw new AttemptError('Connection interrupted. Confirmation is unknown; your writing is kept.');
    assert.equal(name, 'pipeline');
    const pipeline = { enabled: true, sized: true, title: theseus.title, unit_one: 'item', unit_many: 'items', you_own: theseus.youOwn, you_steer: true, owner: theseus.youOwn ? 'fable' : 'tony',
      coordinator: 'fable', ships_in_releases: false, version: theseus.version, section_words: {}, stages: structuredClone(theseus.stages) };
    // A pipeline nothing has finished in yet: no Done groups, as on Tony's new outcome.
    return { instance_id: 'i1', workspace_title: 'Moments', pipeline, items: args.section === 'next' ? structuredClone(theseus.items) : [], groups: [], next_cursor: null, facts: {}, section: args.section,
      stage_times: { sized: true, rows: theseus.stages.map(({ name }) => ({ label: name, cells: Object.fromEntries(['small', 'medium', 'large'].map(size => [size, { too_few: 0, min: 3 }])) })) } };
  };
  // As Core does, it keeps the answer it recorded to each operation: the same operation sent again, as it was
  // made, is answered with that answer, and nothing is made twice. `lose` drops the connection once, as a phone's
  // on the move: 'before' Core has the change, or 'after' Core has made it and answered, with the Api's own
  // failure for a connection that dropped. While `gate` is set, a change waits on it before Core reads it.
  theseus.ops = new Map(); theseus.operations = [];
  const lost = () => new AttemptError('Connection interrupted. Confirmation is unknown; your writing is kept.');
  theseus.send = async (kind, target, args, expected, operation_id) => {
    theseus.sends += 1;
    theseus.operations.push(operation_id);
    if (theseus.gate) await theseus.gate;
    if (theseus.busySends) throw busy('This request lane is busy; retain its operation.');
    const made = JSON.stringify([kind, target, args, expected]), kept = theseus.ops.get(operation_id);
    if (kept) return kept.made === made ? kept.receipt : { status: 'rejected', recorded: false, error: { code: 'OPERATION_PAYLOAD_MISMATCH', message: 'This operation already names different content' } };
    if (theseus.lose === 'before') { theseus.lose = null; throw lost(); }
    const receipt = theseus.make(kind, target, args, expected);
    if (operation_id !== undefined && (receipt.status === 'committed' || receipt.recorded === true)) theseus.ops.set(operation_id, { made, receipt });
    if (theseus.lose === 'after') { theseus.lose = null; throw lost(); }
    return receipt;
  };
  theseus.make = (kind, target, args, expected) => {
    // A refusal Core records, so the same operation sent again is refused again.
    if (theseus.refuseRecorded) return { status: 'rejected', recorded: true, error: { code: 'FORBIDDEN', message: theseus.refuseRecorded } };
    // The store's own busy refusal comes back as a receipt, not a failed request.
    if (theseus.refuse) return { status: 'rejected', recorded: false, error: { code: 'FORBIDDEN', message: theseus.refuse } };
    if (theseus.busyReceipt) return { status: 'rejected', recorded: false, error: { code: 'DATABASE_BUSY', message: 'The database is busy; retry the command.', retryable: true } };
    if (kind === 'pipeline.item_add') {
      const number = theseus.items.reduce((most, each) => Math.max(most, each.number), 0) + 1;
      theseus.items.push({ number, title: args.title, section: args.section, version: 1, description: '', size: null, sources: [], raised_by: 'fable', placed: null, asks: [] });
      return { status: 'committed', result: { number } };
    }
    if (kind === 'pipeline.item_edit') {
      const item = theseus.items.find(each => each.number === target.number);
      assert.equal(expected.item_revision, item.version);
      Object.assign(item, args); item.version += 1;
      return { status: 'committed', result: {} };
    }
    assert.equal(expected.pipeline_revision, theseus.version);
    if (kind === 'pipeline.configure') theseus.title = args.title ?? theseus.title;
    else { assert.equal(kind, 'pipeline.stages_set'); theseus.stages = structuredClone(args.stages); }
    theseus.version += 1;
    return { status: 'committed', result: {} };
  };
  return theseus;
}

function busyPage(theseus) {
  globalThis.document = Object.assign(dom(), { addEventListener() {} });
  globalThis.CSS = { escape: text => text };
  for (const name of ['HTMLInputElement', 'HTMLTextAreaElement']) globalThis[name] ??= class {};
  const host = document.createElement('main');
  const header = { eyebrow: document.createElement('p'), title: document.createElement('h1'), description: document.createElement('p') };
  const page = new PipelinePage({ host, header, reader: 'fable', instanceId: 'i1', workspace: 'w1', read: theseus.read, send: theseus.send });
  const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
  const find = (test, from = host) => walk(from).find(test) ?? null;
  const keyed = key => find(node => node['data-key'] === key);
  return {
    page, host,
    keyed,
    text: () => host.text,
    field: (id, role) => find(node => node['data-role'] === role, keyed(`stage:${id}`)),
    stageNames: () => walk(host).filter(node => node['data-role'] === 'stage-name').map(node => node.value),
    // What the page says under a place, and the Try again it offers there.
    said: key => walk(keyed(key)).filter(node => node.role === 'status').map(node => node.text),
    again: (key = null) => find(node => node['data-role'] === 'try-again', key === null ? host : keyed(key)),
    tries: () => walk(host).filter(node => node['data-role'] === 'try-again').length,
    // A title on the Add a stage line, and Return.
    addStage: title => { const form = keyed('add-stage'); form.children[0].value = title; form.children[0].oninput(); form.onsubmit({ preventDefault() {} }); },
    // A title on a section's Add an item line, and Return.
    addItem: (section, title) => { const form = keyed(`add:${section}`); form.children[0].value = title; form.children[0].oninput(); form.onsubmit({ preventDefault() {} }); },
    line: key => keyed(key).children[0].value,
    typeOnLine: (key, text) => { const line = keyed(key).children[0]; line.value = text; line.oninput(); },
    // The one field on the page that holds these words, wherever the page put them; what is said beside it, and its Try again.
    fieldWith: text => { const found = walk(host).filter(node => node.tagName === 'input' && node.value === text); assert.ok(found.length <= 1, `“${text}” is in one field`); return found[0] ?? null; },
    // The title kept under a one-line add that holds these words, beside a stage or item that may hold them too.
    heldWith: text => { const found = walk(host).filter(node => node['data-role'] === 'held-title' && node.value === text); assert.ok(found.length <= 1, `“${text}” is held once`); return found[0] ?? null; },
    besideField: field => walk(field.parent).filter(node => node.role === 'status').map(node => node.text),
    againBeside: field => walk(field.parent).find(node => node['data-role'] === 'try-again') ?? null,
    retype: (field, text) => { field.value = text; field.oninput(); },
  };
}

// Nothing the page shows is a literal null or undefined, nor the server's own words for being busy.
// (A page's text runs its nodes together, so "null" is looked for anywhere in it.)
// Nor the Api's words for a dropped connection, which speak of a change's confirmation and are never a read's.
const unplain = /null|undefined|bounded lane|request lane|retain its operation|database is busy|Connection interrupted|Confirmation is unknown|writing is kept/;

test('a busy Theseus after a stage is added says it is saved and not shown yet, with Try again, and the page never prints null (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, said, again, tries, addStage, stageNames, keyed } = busyPage(theseus);
  assert.equal(await page.load(), true);
  assert.doesNotMatch(text(), unplain, 'a pipeline with nothing done yet shows no null under its stage times');
  page.editing = true; page.paint();
  // Tony's moment: the stage is saved, and Theseus is too busy for every read after it.
  theseus.busyReads = true;
  addStage('test');
  await page.chain;
  assert.equal(theseus.stages.at(-1).name, 'test', 'the stage was saved');
  assert.doesNotMatch(text(), unplain);
  assert.deepEqual(said('add-stage'), ['Saved. Theseus was busy, so this page does not show it yet. Try again']);
  assert.ok(again('add-stage'), 'Try again is offered where the stage was added');
  assert.equal(tries(), 1, 'and only there: said once, where it happened');
  // A live change read while still busy keeps the page as last read and says so; it is no failure of the page's.
  assert.equal(await page.load(), false, 'the commit follower reads again on the next commit');
  assert.deepEqual(said('add-stage'), ['Saved. Theseus was busy, so this page does not show it yet. Try again']);
  assert.deepEqual(stageNames(), ['Build'], 'what was last read stays');
  // Try again, once Theseus can answer: the stage shows and the busy words go.
  theseus.busyReads = false;
  await again('add-stage').onclick();
  await page.chain;
  assert.deepEqual(stageNames(), ['Build', 'test']);
  assert.equal(again(), null, 'nothing busy is left to try again');
  assert.doesNotMatch(text(), /busy/);
  assert.equal(keyed('add-stage').children[0].value, '', 'the line is clear for the next stage');
});

test('a change Theseus was too busy to take says Not saved with Try again, and keeps every word typed (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, said, again, addStage, field, stageNames, line, fieldWith, besideField, againBeside } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.busySends = true;
  // A stage's name being typed, then saved on blur: refused as busy, its words stay in its field.
  const name = field('build', 'stage-name');
  name.value = 'Build it'; name.oninput(); name.onblur();
  await page.chain;
  assert.equal(field('build', 'stage-name').value, 'Build it', 'the name typed survives the refusal and the repaint after it');
  assert.deepEqual(said('stage:build'), ['Not saved: Theseus was busy. Try again']);
  // A new stage's name is kept under its line, said as not saved beside it.
  addStage('Review');
  await page.chain;
  assert.ok(fieldWith('Review'), 'the new stage’s name is kept');
  assert.deepEqual(besideField(fieldWith('Review')), ['Not saved: Theseus was busy. Try again']);
  assert.deepEqual([line('add-stage'), said('add-stage')], ['', []], 'the line is clear for the next title, and says nothing of Review');
  assert.doesNotMatch(text(), unplain);
  // A live change read meanwhile repaints the page and leaves what is typed alone.
  await page.load();
  assert.deepEqual([field('build', 'stage-name').value, fieldWith('Review')?.['data-role']], ['Build it', 'held-title']);
  // Try again sends each one once, as Return would.
  theseus.busySends = false;
  await again('stage:build').onclick(); await page.chain;
  await againBeside(fieldWith('Review')).onclick(); await page.chain;
  assert.deepEqual(theseus.stages.map(stage => stage.name), ['Build it', 'Review']);
  assert.deepEqual(stageNames(), ['Build it', 'Review']);
  assert.equal(line('add-stage'), '');
  assert.equal(again(), null);
  const sends = theseus.sends;
  await page.chain; await page.load();
  assert.equal(theseus.sends, sends, 'nothing is sent twice');
});

test('a first read Theseus was too busy for says so with Try again, and Try again shows the page (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, again, stageNames } = busyPage(theseus);
  theseus.busyReads = true;
  assert.equal(await page.load(), false, 'a busy first read is no failure of the page; the commit follower reads again');
  assert.equal(text(), 'Theseus was busy, so this page could not be read yet. Try again');
  theseus.busyReads = false;
  await again().onclick(); await page.chain;
  assert.deepEqual(stageNames(), [], 'not editing: the stages are listed, not fields');
  assert.match(text(), /Build/);
  assert.doesNotMatch(text(), unplain);
});

test('a failure is a busy Theseus only by its answer’s code, whichever way the answer came (item 192)', () => {
  const answer = code => ({ error: { code, message: 'words of the server' } });
  assert.equal(isBusy(new AttemptError('x', 503, answer('SERVER_BUSY'))), true, 'a read or request lane refused');
  assert.equal(isBusy({ status: 'rejected', ...answer('DATABASE_BUSY') }), true, 'a receipt');
  assert.equal(isBusy(Object.assign(Error('x'), { details: answer('AUTHORITY_BUSY') })), true, 'a view answer checked by the page');
  assert.equal(isBusy(Error('words of the page', { cause: new AttemptError('x', 503, answer('SERVER_BUSY')) })), true, 'a failure put into the page’s own words');
  for (const other of [new AttemptError('x', 503, answer('CAPABILITIES_UNAVAILABLE')), new AttemptError('Connection interrupted.'), answer('FORBIDDEN'),
    Error('SERVER_BUSY'), null, undefined, 'SERVER_BUSY']) assert.equal(isBusy(other), false, String(other?.message ?? other));
});

test('a stage’s removal Theseus was too busy to take keeps the stage and never says Removed; Try again removes it, with Undo (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, said, again, tries, addStage, stageNames, keyed } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  addStage('Review'); await page.chain;
  const id = theseus.stages[1].stage_id, remove = () => keyed(`stage:${id}`).children[1].children[1].children.at(-1).children.at(-1);
  assert.equal(remove()['data-role'], 'stage-remove');
  // Too busy for the removal and for the read after it: one line says so, with one Try again.
  theseus.busySends = true; theseus.busyReads = true;
  await remove().onclick(); await page.chain;
  assert.deepEqual(stageNames(), ['Build', 'Review']);
  assert.deepEqual(said(`stage:${id}`), ['Added. Its done-when and chips are optional.', 'Not saved: Theseus was busy. Try again'], 'its note from being added, then the removal not saved');
  assert.equal(keyed('stage-undo'), null, 'nothing says Removed beside a removal that was not saved');
  assert.doesNotMatch(text(), /Removed|null|undefined/);
  assert.equal(tries(), 1);
  theseus.busySends = false; theseus.busyReads = false;
  await again(`stage:${id}`).onclick(); await page.chain;
  assert.deepEqual([stageNames(), theseus.stages.map(stage => stage.name)], [['Build'], ['Build']]);
  assert.equal(keyed('stage-undo').text, 'Removed Review. Undo');
});

test('a change the store was too busy for, answered in its receipt, says Not saved with Try again too (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, said, again, field } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.busyReceipt = true;
  await field('build', 'rounds-together').onclick(); await page.chain;
  assert.deepEqual(said('stage:build'), ['Not saved: Theseus was busy. Try again']);
  assert.doesNotMatch(text(), unplain);
  assert.equal(theseus.stages[0].rounds, 'none');
  theseus.busyReceipt = false;
  await again('stage:build').onclick(); await page.chain;
  assert.deepEqual([theseus.stages[0].rounds, said('stage:build')], ['together', ['Saved.']]);
});

test('a stage name saved while Theseus is too busy to read the page back stays in its field, never the old name, until a read shows it (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, said, again, field, tries } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.busyReads = true;
  const name = field('build', 'stage-name');
  name.value = 'test'; name.oninput(); name.onblur();
  await page.chain;
  assert.equal(theseus.stages[0].name, 'test', 'saved');
  assert.equal(field('build', 'stage-name').value, 'test', 'the name typed stays in its field, not the name it replaced');
  assert.deepEqual(said('stage:build'), ['Saved. Theseus was busy, so this page does not show it yet. Try again'], 'said once: no second Saved beside it');
  assert.equal(tries(), 1);
  assert.doesNotMatch(text(), unplain);
  // A live change read while still busy repaints and keeps it.
  assert.equal(await page.load(), false);
  assert.equal(field('build', 'stage-name').value, 'test');
  theseus.busyReads = false;
  await again('stage:build').onclick(); await page.chain;
  assert.deepEqual([field('build', 'stage-name').value, said('stage:build')], ['test', ['Saved.']]);
  // Once a read has shown it, the field shows what Theseus holds: a rename made elsewhere shows.
  theseus.stages[0].name = 'Built elsewhere';
  await page.load();
  assert.equal(field('build', 'stage-name').value, 'Built elsewhere');
});

test('a change made while the page does not show the last one saved is not sent on a revision it never read: Theseus busy, it says Not saved and keeps the words (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, said, again, addStage, field, stageNames } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.busyReads = true;
  addStage('Review'); await page.chain;
  const sends = theseus.sends;
  // The name of the stage still shown, typed and saved on blur: the page reads first, and Theseus is still busy.
  const name = field('build', 'stage-name');
  name.value = 'Build it'; name.oninput(); name.onblur();
  await page.chain;
  assert.equal(theseus.sends, sends, 'nothing is sent on a revision the page has not read');
  assert.deepEqual([said('stage:build'), said('add-stage')],
    [['Not saved: Theseus was busy. Try again'], ['Saved. Theseus was busy, so this page does not show it yet. Try again']],
    'the name is not saved, and Review still is: each said where it was made');
  assert.equal(field('build', 'stage-name').value, 'Build it');
  assert.doesNotMatch(text(), unplain);
  // Theseus answers again: Try again reads the page, then saves the name on the revision it now shows.
  theseus.busyReads = false;
  await again('stage:build').onclick(); await page.chain;
  assert.deepEqual([theseus.stages.map(stage => stage.name), stageNames()], [['Build it', 'Review'], ['Build it', 'Review']]);
  assert.equal(again(), null);
});

test('a repaint while a stage name is being typed saves nothing and says nothing, busy or not, as in Chrome (item 192)', async () => {
  const theseus = busyTheseus(), { page, host, said, field } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  // Chrome fires blur on the field that has focus when a repaint takes it away; the fake page does the same.
  const replace = host.replaceChildren.bind(host);
  host.replaceChildren = (...kids) => { const had = document.activeElement; replace(...kids); if (had && !kids.includes(had)) had.onblur?.(); };
  const name = field('build', 'stage-name');
  name.focus(); name.value = 'Build i'; name.oninput();
  for (const busyReads of [true, false]) {
    theseus.busyReads = busyReads;
    const sends = theseus.sends;
    await page.load(); await page.chain;
    assert.equal(theseus.sends, sends, `a ${busyReads ? 'busy' : 'live'} repaint sends nothing`);
    assert.deepEqual(said('stage:build'), [], 'and says nothing on the stage being typed');
    assert.equal(field('build', 'stage-name').value, 'Build i', 'the half-typed name stays as typed');
  }
  assert.deepEqual(theseus.stages.map(stage => stage.name), ['Build']);
});

test('an item’s words and the title, saved while Theseus is too busy to read them back, stay as saved; a repaint while words are typed saves nothing (item 192)', async () => {
  const theseus = busyTheseus();
  theseus.youOwn = true;
  theseus.items = [{ number: 1, title: 'Fold the list', section: 'next', version: 1, description: '', size: null, sources: [], raised_by: 'tony', placed: null, asks: [] }];
  const { page, host, keyed, text } = busyPage(theseus);
  // The header holds the owner's title field across repaints, by its child nodes.
  Object.defineProperties(page.header.title, { childNodes: { get() { return this.children; } }, firstChild: { get() { return this.children[0] ?? null; } } });
  await page.load();
  const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
  const words = () => walk(keyed('item:1')).find(node => node['data-role'] === 'words') ?? null;
  page.toggleDetails(1);
  // Chrome fires blur on the field that has focus when a repaint takes it away; the fake page does the same.
  const replace = host.replaceChildren.bind(host);
  host.replaceChildren = (...kids) => { const had = document.activeElement; replace(...kids); if (had && !kids.includes(had)) had.onblur?.(); };
  theseus.busyReads = true;
  const area = words();
  area.focus(); area.value = 'Half'; area.oninput();
  const sends = theseus.sends;
  await page.load(); await page.chain;
  assert.equal(theseus.sends, sends, 'a repaint while the words are typed sends nothing');
  assert.equal(words().value, 'Half', 'and leaves them as typed');
  // The owner's title, saved on blur while every read back is refused as busy, stays as saved.
  const title = page.header.title.children[0];
  title.value = 'Release pipeline'; title.oninput(); title.onblur();
  await page.chain;
  assert.equal(theseus.title, 'Release pipeline', 'the title was saved');
  await page.load();
  assert.equal(page.header.title.children[0].value, 'Release pipeline', 'the title saved stays, not the one it replaced');
  // A read goes through; then, busy again, the words saved on blur stay in their box.
  theseus.busyReads = false; await page.load(); theseus.busyReads = true;
  document.activeElement = null;
  words().value = 'Folded past three.'; words().oninput(); words().onblur();
  await page.chain;
  assert.equal(theseus.items[0].description, 'Folded past three.', 'the words were saved');
  await page.load();
  assert.equal(words().value, 'Folded past three.', 'the words saved stay in their box, not what the page last read');
  assert.doesNotMatch(text(), /null|undefined|bounded lane/);
  // Once a read goes through, the page shows Theseus's own.
  theseus.busyReads = false;
  await page.load();
  assert.deepEqual([words().value, page.header.title.children[0].value], ['Folded past three.', 'Release pipeline']);
});

// The reviewer's case: a one-line add made while the page does not show the last change saved there, and the read
// the page makes first is refused as busy, so the add is never sent. The title typed goes back on its line, the
// line says the earlier change is saved and this one is not, and Try again sends what is on the line, once.
test('a one-line add the page could not send, because Theseus was too busy for the read before it, keeps its title, and Try again adds it; the change before stays said as saved (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, said, again, tries, addStage, stageNames, line, fieldWith, besideField, againBeside } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.busyReads = true;
  addStage('test'); await page.chain;
  assert.deepEqual(theseus.stages.map(stage => stage.name), ['Build', 'test'], 'test is saved');
  const sends = theseus.sends;
  addStage('Ship'); await page.chain;
  assert.equal(theseus.sends, sends, 'Ship is not sent on a revision the page has not read');
  assert.ok(fieldWith('Ship'), 'the title typed is kept');
  assert.deepEqual([said('add-stage'), besideField(fieldWith('Ship'))],
    [['Saved. Theseus was busy, so this page does not show it yet.'], ['Not saved: Theseus was busy. Try again']],
    'test is said to be saved under the line, Ship not saved beside its words: one Try again');
  assert.equal(tries(), 1);
  assert.doesNotMatch(text(), unplain);
  // Try again while Theseus is still busy reads again, sends nothing and keeps the title.
  await againBeside(fieldWith('Ship')).onclick(); await page.chain;
  assert.deepEqual([theseus.sends, besideField(fieldWith('Ship'))], [sends, ['Not saved: Theseus was busy. Try again']]);
  // Theseus answers: Try again reads the page, then adds the title, once.
  theseus.busyReads = false;
  await againBeside(fieldWith('Ship')).onclick(); await page.chain;
  assert.equal(theseus.sends, sends + 1, 'Try again sends it once');
  assert.deepEqual([theseus.stages.map(stage => stage.name), stageNames()], [['Build', 'test', 'Ship'], ['Build', 'test', 'Ship']]);
  assert.equal(line('add-stage'), '', 'the line clears once Ship is added');
  assert.equal(again(), null);
  assert.doesNotMatch(text(), /busy/);
});

test('an item added on a section’s line the page could not send, Theseus busy for the read before it or that read failing, keeps its title, and Try again adds it (item 192)', async () => {
  const theseus = busyTheseus();
  theseus.items = [{ number: 1, title: 'Fold the list', section: 'next', version: 1, description: '', size: null, sources: [], raised_by: 'tony', placed: null, asks: [] }];
  const { page, text, said, tries, addItem, line, fieldWith, besideField, againBeside } = busyPage(theseus);
  await page.load();
  theseus.busyReads = true;
  addItem('next', 'Make the rail shorter'); await page.chain;
  assert.deepEqual(theseus.items.map(item => item.title), ['Fold the list', 'Make the rail shorter'], 'the first item is saved');
  const sends = theseus.sends;
  addItem('next', 'Fold the shipped list'); await page.chain;
  assert.equal(theseus.sends, sends, 'not sent');
  assert.ok(fieldWith('Fold the shipped list'), 'the title typed is kept');
  assert.deepEqual([said('add:next'), besideField(fieldWith('Fold the shipped list'))],
    [['Saved. Theseus was busy, so this page does not show it yet.'], ['Not saved: Theseus was busy. Try again']]);
  assert.equal(tries(), 1);
  // The read before it failing in some other way (the connection dropped) keeps the title too: it was not sent, so it
  // is not saved, and Try again reads first again; the item before stays said as saved, as the read failed now.
  theseus.busyReads = false; theseus.failReads = true;
  await againBeside(fieldWith('Fold the shipped list')).onclick(); await page.chain;
  assert.deepEqual([theseus.sends, said('add:next'), besideField(fieldWith('Fold the shipped list')), tries()], [sends,
    ['Saved. This page could not be read again, so it does not show it yet.'], ['Not saved: this page could not be read again first. Try again'], 1]);
  assert.doesNotMatch(text(), unplain);
  // Return on the title kept, once Theseus answers, adds it, once.
  theseus.failReads = false;
  const kept = fieldWith('Fold the shipped list');
  kept.parent.onsubmit({ preventDefault() {} }); await page.chain;
  assert.equal(theseus.sends, sends + 1);
  assert.deepEqual(theseus.items.map(item => item.title), ['Fold the list', 'Make the rail shorter', 'Fold the shipped list']);
  assert.equal(line('add:next'), '');
});

test('a change at a place whose last change is saved and not shown yet, not sent because Theseus was busy, says both: the saved one stays said (item 192)', async () => {
  const theseus = busyTheseus(), { page, said, again, tries, field } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.busyReads = true;
  const name = field('build', 'stage-name');
  name.value = 'test'; name.oninput(); name.onblur(); await page.chain;
  assert.equal(theseus.stages[0].name, 'test');
  const sends = theseus.sends;
  await field('build', 'rounds-together').onclick(); await page.chain;
  assert.equal(theseus.sends, sends);
  assert.deepEqual(said('stage:build'), ['Saved. Theseus was busy, so this page does not show it yet.', 'Not saved: Theseus was busy. Try again']);
  assert.equal(tries(), 1);
  theseus.busyReads = false;
  await again('stage:build').onclick(); await page.chain;
  assert.deepEqual([theseus.stages[0].name, theseus.stages[0].rounds, said('stage:build')], ['test', 'together', ['Saved.']]);
});

test('a change refused for its own reason, with the read after it too busy, says the refusal first, then that the page may be behind (item 192)', async () => {
  const theseus = busyTheseus(), { page, said, tries, field } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.refuse = 'Only Tony changes this stage.'; theseus.busyReads = true;
  await field('build', 'rounds-together').onclick(); await page.chain;
  assert.deepEqual(said('stage:build'), ['Only Tony changes this stage.', 'Theseus was busy, so this page may not show the latest changes. Try again'], 'what happened, in the order it happened');
  assert.equal(tries(), 1);
});

// A one-line add's title, not saved, is never lost and never stands in for other words: whatever is typed
// on the line since stays there, each title not saved stays where it can be read and changed, and its
// Try again adds the words it then shows, once. (The reviewer's RVE, RVB, RVF and RVA.)
test('RVE: a stage title not saved, corrected where it stands, is added as corrected by Try again (item 192)', async () => {
  const theseus = busyTheseus(), { page, addStage, fieldWith, againBeside, retype, line } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.busySends = true;
  addStage('Shp'); await page.chain;
  const held = fieldWith('Shp');
  assert.ok(held, 'the title not saved is kept where it can be changed');
  retype(held, 'Ship');
  theseus.busySends = false;
  await againBeside(fieldWith('Ship')).onclick(); await page.chain;
  assert.deepEqual(theseus.stages.map(stage => stage.name), ['Build', 'Ship'], 'the words shown when Try again was tapped are what is added');
  assert.equal(line('add-stage'), '');
  assert.equal(page.host.text.includes('Shp'), false, 'nothing is left of the old words');
});

test('RVB: words typed on the Add a stage line while a title is added stay there when that title is not saved, and Try again adds only the title (item 192)', async () => {
  const theseus = busyTheseus(), { page, addStage, fieldWith, besideField, againBeside, typeOnLine, line } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.busySends = true;
  addStage('Ship'); typeOnLine('add-stage', 'Rev'); await page.chain;
  assert.equal(line('add-stage'), 'Rev', 'what was typed since stays on the line');
  const held = fieldWith('Ship');
  assert.ok(held, 'and Ship, not saved, is still on the page');
  assert.deepEqual(besideField(held), ['Not saved: Theseus was busy. Try again'], 'said beside Ship itself');
  theseus.busySends = false;
  await againBeside(held).onclick(); await page.chain;
  assert.deepEqual([theseus.stages.map(stage => stage.name), line('add-stage')], [['Build', 'Ship'], 'Rev'], 'Ship added once, Rev still on the line');
  assert.equal(fieldWith('Ship')?.['data-role'], 'stage-name', 'Ship is now a stage, and held nowhere else');
});

test('RVF: words typed on Next’s Add an item line while an item is added stay there when it is not saved, and Try again adds only that item (item 192)', async () => {
  const theseus = busyTheseus(), { page, addItem, fieldWith, againBeside, typeOnLine, line } = busyPage(theseus);
  await page.load();
  theseus.busySends = true;
  addItem('next', 'Fold the shipped list'); typeOnLine('add:next', 'Shorter rail'); await page.chain;
  assert.equal(line('add:next'), 'Shorter rail');
  const held = fieldWith('Fold the shipped list');
  assert.ok(held, 'the item not added is still on the page');
  theseus.busySends = false;
  await againBeside(held).onclick(); await page.chain;
  assert.deepEqual([theseus.items.map(item => item.title), line('add:next')], [['Fold the shipped list'], 'Shorter rail']);
});

test('RVA: two titles sent with Return while Theseus is busy are both kept, each said as not saved, and each Try again adds its own (item 192)', async () => {
  const theseus = busyTheseus(), { page, addStage, fieldWith, besideField, againBeside, line, tries } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.busySends = true;
  addStage('Ship'); addStage('Review'); await page.chain;
  for (const title of ['Ship', 'Review']) {
    assert.ok(fieldWith(title), `${title} is kept`);
    assert.deepEqual(besideField(fieldWith(title)), ['Not saved: Theseus was busy. Try again'], `${title} is said as not saved, beside its own words`);
  }
  assert.equal(line('add-stage'), '', 'the line is the person’s, clear for the next title');
  assert.equal(tries(), 2, 'one Try again for each title');
  theseus.busySends = false;
  await againBeside(fieldWith('Review')).onclick(); await page.chain;
  await againBeside(fieldWith('Ship')).onclick(); await page.chain;
  assert.deepEqual(theseus.stages.map(stage => stage.name), ['Build', 'Review', 'Ship'], 'each added once, in the order tried');
  assert.equal(tries(), 0);
});

test('Escape on a title not saved lets that one go, sends nothing, and leaves the line and every other title kept as they are (item 192)', async () => {
  const theseus = busyTheseus(), { page, addStage, fieldWith, typeOnLine, line, tries } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.busySends = true;
  addStage('Ship'); addStage('Review'); typeOnLine('add-stage', 'Rev'); await page.chain;
  const sends = theseus.sends;
  fieldWith('Ship').onkeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  await page.chain;
  assert.equal(fieldWith('Ship'), null, 'Ship is let go');
  assert.deepEqual([fieldWith('Review')?.['data-role'], line('add-stage'), tries(), theseus.sends], ['held-title', 'Rev', 1, sends], 'Review and the line stay; nothing is sent');
  theseus.busySends = false; await page.load();
  assert.deepEqual(theseus.stages.map(stage => stage.name), ['Build']);
});

// A title whose answer was lost (the reviewer's case: Tony on his phone over the tailnet, the connection dropping
// while a stage is added that Core then has). A failure with no answer of Theseus's is no proof of what Core
// recorded, so the page never says "not saved" of it, and what sends it again sends the same change, under the
// same operation, so Core answers with what it recorded, or makes it then: once either way.
const UNCONFIRMED = 'Not known whether this was saved: Theseus did not confirm it.';

test('a stage added whose answer was lost, though Core has it, is said as not known to be saved, kept as sent, and Return sends that same change: Core has it once (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, addStage, heldWith, besideField, stageNames, line, tries } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.lose = 'after';
  addStage('Ship'); await page.chain;
  assert.deepEqual(theseus.stages.map(stage => stage.name), ['Build', 'Ship'], 'Core has it');
  assert.deepEqual(stageNames(), ['Build', 'Ship'], 'and the page read it again');
  const held = heldWith('Ship');
  assert.ok(held, 'the title is kept, as it was sent');
  assert.deepEqual({ label: held['aria-label'], readonly: held.readonly === '', said: besideField(held), hint: held.parent.text },
    { label: 'Add a stage, not known if saved', readonly: true, said: [`${UNCONFIRMED} Try again`], hint: `Return sends it again · Escape lets it go${UNCONFIRMED} Try again` },
    'never said as not saved; its words are what was sent, not to be changed under the same change');
  assert.doesNotMatch(text(), /not saved|Not saved/);
  assert.doesNotMatch(text(), unplain);
  held.parent.onsubmit({ preventDefault() {} }); await page.chain;
  assert.deepEqual(theseus.stages.map(stage => stage.name), ['Build', 'Ship'], 'Core has Ship once');
  assert.deepEqual([stageNames(), heldWith('Ship'), tries(), line('add-stage')], [['Build', 'Ship'], null, 0, '']);
  assert.equal(new Set(theseus.operations).size, 1, 'Return sent the same operation again');
});

test('a stage added whose answer was lost, with the read after it busy too, offers one Try again, on the title kept, and nothing more under Add a stage (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, said, tries, addStage, heldWith, besideField, againBeside } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.lose = 'after'; theseus.busyReads = true;
  addStage('Ship'); await page.chain;
  assert.deepEqual(theseus.stages.map(stage => stage.name), ['Build', 'Ship'], 'Core has it');
  const held = heldWith('Ship');
  assert.ok(held, 'the title is kept, as it was sent');
  assert.deepEqual([said('add-stage'), besideField(held), tries()], [[], [`${UNCONFIRMED} Try again`], 1],
    'the title kept is the place’s Try again: the busy read adds no line and no Try again of its own under Add a stage');
  assert.doesNotMatch(text(), /not saved|Not saved/);
  assert.doesNotMatch(text(), unplain);
  // That one Try again sends the same change, and reads the page again once Theseus can.
  theseus.busyReads = false;
  await againBeside(held).onclick(); await page.chain;
  assert.deepEqual([theseus.stages.map(stage => stage.name), heldWith('Ship'), tries()], [['Build', 'Ship'], null, 0]);
  assert.equal(new Set(theseus.operations).size, 1, 'Try again sent the same operation again');
});

test('an item added on Next’s line whose answer was lost, though Core has it, is not known to be saved, and Try again sends that same change: one item (item 192)', async () => {
  const theseus = busyTheseus(), { page, addItem, heldWith, besideField, againBeside, line } = busyPage(theseus);
  await page.load();
  theseus.lose = 'after';
  addItem('next', 'Fold the shipped list'); await page.chain;
  assert.deepEqual(theseus.items.map(item => item.title), ['Fold the shipped list']);
  const held = heldWith('Fold the shipped list');
  assert.deepEqual([held?.['aria-label'], besideField(held)], ['Add an item to Next, not known if saved', [`${UNCONFIRMED} Try again`]]);
  await againBeside(held).onclick(); await page.chain;
  assert.deepEqual(theseus.items.map(item => item.title), ['Fold the shipped list'], 'one item, not two');
  assert.deepEqual([heldWith('Fold the shipped list'), line('add:next')], [null, '']);
  assert.equal(new Set(theseus.operations).size, 1);
});

test('a title whose answer was lost before Core had it stays not known through a busy Try again, and is made once when Theseus takes it (item 192)', async () => {
  const theseus = busyTheseus(), { page, addItem, heldWith, besideField, againBeside } = busyPage(theseus);
  await page.load();
  theseus.lose = 'before';
  addItem('next', 'Fold the shipped list'); await page.chain;
  assert.deepEqual(theseus.items, [], 'Core does not have it');
  assert.deepEqual(besideField(heldWith('Fold the shipped list')), [`${UNCONFIRMED} Try again`], 'the page cannot know that, and does not say it');
  // Busy now: this attempt was not taken, but the first may have been, so it is still not known.
  theseus.busySends = true;
  await againBeside(heldWith('Fold the shipped list')).onclick(); await page.chain;
  assert.deepEqual(besideField(heldWith('Fold the shipped list')), [`${UNCONFIRMED} Try again`], 'a busy answer to the second attempt says nothing of the first');
  theseus.busySends = false;
  await againBeside(heldWith('Fold the shipped list')).onclick(); await page.chain;
  assert.deepEqual(theseus.items.map(item => item.title), ['Fold the shipped list']);
  assert.equal(heldWith('Fold the shipped list'), null);
  assert.deepEqual([theseus.operations.length, new Set(theseus.operations).size], [3, 1], 'three attempts, one operation');
});

test('a title not known to be saved that Core then refuses, recording why, is not saved: it says why, can be changed, and Return adds the new words as a new change (item 192)', async () => {
  const theseus = busyTheseus(), { page, addStage, heldWith, besideField, againBeside, retype } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.lose = 'before';
  addStage('Ship'); await page.chain;
  theseus.refuseRecorded = 'Only Tony changes these stages.';
  await againBeside(heldWith('Ship')).onclick(); await page.chain;
  const held = heldWith('Ship');
  assert.deepEqual({ label: held['aria-label'], readonly: held.readonly, said: besideField(held) },
    { label: 'Add a stage, not saved', readonly: undefined, said: ['Only Tony changes these stages.'] }, 'Core’s recorded answer settles it: not saved, and why');
  theseus.refuseRecorded = null;
  retype(held, 'Ship it');
  heldWith('Ship it').parent.onsubmit({ preventDefault() {} }); await page.chain;
  assert.deepEqual(theseus.stages.map(stage => stage.name), ['Build', 'Ship it']);
  assert.equal(heldWith('Ship it'), null);
  assert.equal(new Set(theseus.operations).size, 2, 'the corrected words went as a change of their own');
});

test('a title kept under the line is not on the page while it is sent, so it cannot be sent twice (item 192)', async () => {
  const theseus = busyTheseus(), { page, addStage, heldWith, againBeside, tries } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.busySends = true;
  addStage('Ship'); await page.chain;
  theseus.busySends = false;
  let open; theseus.gate = new Promise(resolve => { open = resolve; });
  againBeside(heldWith('Ship')).onclick();
  assert.deepEqual([heldWith('Ship'), tries()], [null, 0], 'while Ship is sent, neither it nor its Try again is there to tap again');
  open(); theseus.gate = null; await page.chain;
  assert.deepEqual(theseus.stages.map(stage => stage.name), ['Build', 'Ship']);
});

test('a change is not known to be saved exactly when no answer of Theseus’s says whether its attempt was taken (item 192)', () => {
  const answer = (status, code) => new AttemptError('words of the server', status, { recorded: false, error: { code, message: 'words of the server' } });
  // An answer of Theseus's that it did not take the attempt: known, whichever way it came.
  for (const [taken, why] of [[answer(503, 'SERVER_BUSY'), 'a full request lane'], [answer(503, 'AUTHORITY_BUSY'), 'a busy authority'],
    [answer(401, 'SESSION_REQUIRED'), 'a refused session'], [answer(403, 'FORBIDDEN'), 'a refusal before Core read it'],
    [Error('words of the page', { cause: answer(503, 'SERVER_BUSY') }), 'one put into the page’s own words']]) assert.equal(unconfirmed(taken), false, why);
  // No word on it: unknown.
  for (const [unknown, why] of [[new AttemptError('Connection interrupted. Confirmation is unknown; your writing is kept.'), 'a dropped connection'],
    [answer(500, 'REQUEST_UNCONFIRMED'), 'Theseus could not confirm it'], [Error('words of the page', { cause: new AttemptError('Connection interrupted.') }), 'one put into words'],
    [new TypeError('Failed to fetch'), 'a failure that is no attempt’s']]) assert.equal(unconfirmed(unknown), true, why);
});

// A change saved, and the read right after it failing another way than busy: the connection drops a moment after
// Theseus answers (the reviewer's case, a phone on the move). The change is saved, so the page says so where it was
// made, with a Try again that reads the page again; never the read's own failure as if it described the change, which
// would ask the person to make it again. Every read that fails while a saved change is not shown says the same.
const SAVED_UNREAD = 'Saved. This page could not be read again, so it does not show it yet.';

test('a stage added and saved, with the read after it dropped, is said as saved where it was added, and Try again reads the page and sends nothing (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, said, again, tries, addStage, stageNames, line, heldWith } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.failReads = true;
  addStage('Ship'); await page.chain;
  assert.deepEqual(theseus.stages.map(stage => stage.name), ['Build', 'Ship'], 'Core has it');
  assert.deepEqual([stageNames(), said('add-stage'), tries(), heldWith('Ship'), line('add-stage')], [['Build'], [`${SAVED_UNREAD} Try again`], 1, null, ''],
    'saved, said so under the line it was added on, with one Try again; the title is not held as if it were not');
  assert.doesNotMatch(text(), unplain);
  // A live change read while the connection is still down keeps the page as last read and the words where they were.
  assert.equal(await page.load().catch(error => `threw: ${error.message}`), false, 'the commit follower reads again on the next commit, and no failure of its own is raised');
  assert.deepEqual(said('add-stage'), [`${SAVED_UNREAD} Try again`]);
  // Try again while it still fails sends nothing and says the same.
  const sends = theseus.sends;
  await again('add-stage').onclick(); await page.chain;
  assert.deepEqual([theseus.sends, said('add-stage'), tries()], [sends, [`${SAVED_UNREAD} Try again`], 1]);
  assert.doesNotMatch(text(), unplain);
  // Once a read goes through, the page shows Ship, once.
  theseus.failReads = false;
  await again('add-stage').onclick(); await page.chain;
  assert.deepEqual([theseus.sends, theseus.stages.map(stage => stage.name), stageNames(), again()], [sends, ['Build', 'Ship'], ['Build', 'Ship'], null]);
  assert.deepEqual(new Set(theseus.operations).size, 1, 'one change was made, under one operation');
});

test('an item added on Next’s line and saved, with the read after it dropped, says Added and Saved, never the read’s failure, and Try again shows it once (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, said, again, tries, addItem, line, heldWith } = busyPage(theseus);
  await page.load();
  theseus.failReads = true;
  addItem('next', 'Ship'); await page.chain;
  assert.deepEqual(theseus.items.map(item => item.title), ['Ship'], 'Core has it');
  assert.deepEqual([said('add:next'), tries(), heldWith('Ship'), line('add:next')],
    [['Added 1, last in Next. Words and a size are optional; set them on it below.', `${SAVED_UNREAD} Try again`], 1, null, '']);
  assert.doesNotMatch(text(), unplain);
  theseus.failReads = false;
  const sends = theseus.sends;
  await again('add:next').onclick(); await page.chain;
  assert.deepEqual([theseus.sends, theseus.items.map(item => item.title), again()], [sends, ['Ship'], null]);
  assert.match(text(), /Ship/);
});

test('a stage name saved while a busy read leaves it unshown, then a Try again whose read drops, stays said as saved, never the read’s failure (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, said, again, tries, field } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.busyReads = true;
  const name = field('build', 'stage-name');
  name.value = 'test'; name.oninput(); name.onblur(); await page.chain;
  assert.deepEqual(said('stage:build'), ['Saved. Theseus was busy, so this page does not show it yet. Try again']);
  theseus.busyReads = false; theseus.failReads = true;
  await again('stage:build').onclick(); await page.chain;
  assert.deepEqual([said('stage:build'), tries(), field('build', 'stage-name').value], [[`${SAVED_UNREAD} Try again`], 1, 'test'], 'how the read failed now, and still saved');
  assert.doesNotMatch(text(), unplain);
  theseus.failReads = false;
  await again('stage:build').onclick(); await page.chain;
  assert.deepEqual([field('build', 'stage-name').value, said('stage:build'), again()], ['test', ['Saved.'], null]);
});

test('a change refused for its own reason, with the read after it dropped, says the refusal, then that the page may be behind; its Try again reads (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, said, again, tries, field } = busyPage(theseus);
  await page.load(); page.editing = true; page.paint();
  theseus.refuse = 'Only Tony changes this stage.'; theseus.failReads = true;
  await field('build', 'rounds-together').onclick(); await page.chain;
  const behind = 'This page could not be read again, so it may not show the latest changes. Try again';
  assert.deepEqual([said('stage:build'), tries()], [['Only Tony changes this stage.', behind], 1], 'what happened, in the order it happened');
  // The same, after a busy read whose Try again then drops: the refusal stays, and the read's failure is the page's.
  theseus.failReads = false; theseus.busyReads = true;
  await field('build', 'rounds-together').onclick(); await page.chain;
  assert.deepEqual(said('stage:build'), ['Only Tony changes this stage.', 'Theseus was busy, so this page may not show the latest changes. Try again']);
  theseus.busyReads = false; theseus.failReads = true;
  await again('stage:build').onclick(); await page.chain;
  assert.deepEqual([said('stage:build'), tries()], [['Only Tony changes this stage.', behind], 1]);
  assert.doesNotMatch(text(), unplain);
  theseus.failReads = false;
  await again('stage:build').onclick(); await page.chain;
  assert.deepEqual([said('stage:build'), again()], [['Only Tony changes this stage.'], null]);
});

// How a read that did not go through is said, Theseus too busy for it or its connection dropped: the words for each.
const MISSED = {
  busyReads: { saved: 'Saved. Theseus was busy, so this page does not show it yet.', behind: 'Theseus was busy, so this page may not show the latest changes.' },
  failReads: { saved: SAVED_UNREAD, behind: 'This page could not be read again, so it may not show the latest changes.' },
};

test('a first read too busy, whose Try again drops, says the page could not be read yet, and a later Try again shows it (item 192)', async () => {
  const theseus = busyTheseus(), { page, text, again, tries } = busyPage(theseus);
  theseus.busyReads = true;
  assert.equal(await page.load(), false);
  assert.equal(text(), 'Theseus was busy, so this page could not be read yet. Try again');
  theseus.busyReads = false; theseus.failReads = true;
  await again().onclick(); await page.chain;
  assert.deepEqual([text(), tries()], ['This page could not be read yet. Try again', 1], 'how this read failed, in the page’s own words, with one Try again');
  theseus.failReads = false;
  await again().onclick(); await page.chain;
  assert.match(text(), /Build/);
  assert.equal(again(), null);
  assert.doesNotMatch(text(), unplain);
});

for (const fails of ['busyReads', 'failReads']) {
  test(`the read after an act that does not go through is said where that act was made, never where an earlier read’s was (${fails}, item 192)`, async () => {
    const theseus = busyTheseus(), { page, text, said, tries, field, addItem } = busyPage(theseus);
    await page.load(); page.editing = true; page.paint();
    // The Rounds chip on Build, refused for its own reason, and the read after it does not go through.
    theseus.refuse = 'Only Tony changes this stage.'; theseus[fails] = true;
    await field('build', 'rounds-together').onclick(); await page.chain;
    assert.deepEqual(said('stage:build'), ['Only Tony changes this stage.', `${MISSED[fails].behind} Try again`]);
    // Ship added on Next's line, saved, and the read after it does not go through either: it is said there, as saved.
    theseus.refuse = null;
    addItem('next', 'Ship'); await page.chain;
    assert.deepEqual(theseus.items.map(item => item.title), ['Ship'], 'Core has it');
    assert.deepEqual([said('stage:build'), said('add:next'), tries()], [['Only Tony changes this stage.'],
      ['Added 1, last in Next. Words and a size are optional; set them on it below.', `${MISSED[fails].saved} Try again`], 1],
      'the refused stage says only why; never Saved beside a change refused');
    assert.doesNotMatch(text(), unplain);
  });

  test(`a read that fails after a newer one is shown leaves the page as shown and says nothing (${fails}, item 192)`, async () => {
    // The read after Ship is added at Add a stage is held; a commit follower's read, newer, goes through and shows Ship.
    const theseus = busyTheseus(), { page, text, tries, addStage, stageNames, said } = busyPage(theseus);
    await page.load(); page.editing = true; page.paint();
    const acts = theseus.holdRead();
    addStage('Ship'); await acts.begun;
    assert.equal(await page.load(), true);
    assert.deepEqual(stageNames(), ['Build', 'Ship']);
    // Then the act's own read, older, does not go through: the page stays as shown.
    theseus[fails] = true; acts.release(); await page.chain;
    assert.deepEqual([stageNames(), said('add-stage'), tries()], [['Build', 'Ship'], [], 0]);
    assert.doesNotMatch(text(), unplain);
    // The other way round: the commit follower's read is held, and the act's read after it, newer, shows Shipped.
    theseus[fails] = false;
    const follower = theseus.holdRead(), read = page.load();
    await follower.begun;
    addStage('Shipped'); await page.chain;
    assert.deepEqual(stageNames(), ['Build', 'Ship', 'Shipped']);
    // The follower's older read does not go through: it is told what the newer read found, and nothing is said.
    theseus[fails] = true; follower.release();
    assert.equal(await read.catch(error => `threw: ${error.message}`), true);
    assert.deepEqual([stageNames(), said('add-stage'), tries()], [['Build', 'Ship', 'Shipped'], [], 0]);
    assert.doesNotMatch(text(), unplain);
  });
}

test('a piece or release an ask holds says Held, who it waits on and the ask\'s first line (item 259)', () => {
  assert.deepEqual(heldWords({ waiting_on: ['tony'], line: 'Please restart fseventsd' }, 'fable'),
    { lead: 'Held: waiting on tony', line: 'Please restart fseventsd' });
  assert.deepEqual(heldWords({ waiting_on: ['tony', 'warp'], line: 'Both look' }, 'tony'), { lead: 'Held: waiting on you and warp', line: 'Both look' });
  assert.deepEqual(heldWords({ waiting_on: [], line: '' }, 'tony'), { lead: 'Held: waiting on an answer', line: 'their answer' });
});

test('a piece\'s Held lines keep the order Core gives them, newest first, not the order they were asked (item 259)', () => {
  globalThis.document = Object.assign(dom(), { addEventListener() {} });
  const page = new PipelinePage({ host: { addEventListener() {} }, header: {}, reader: 'tony', instanceId: 'i1', workspace: 'w1', read: async () => null, send: async () => null });
  const now = Date.UTC(2026, 10, 6, 12), walk = node => [node, ...(node.children ?? []).flatMap(walk)];
  const held = (message, minutes, line) => ({ message_id: message, topic_id: 't1', by: 'fable', since_ms: now - minutes * 60000, waiting_on: ['tony'], line });
  const piece = { id: 'p-1', version: 1, size: 'small', stage: { name: 'Build', entered_ms: now - 3600000 }, stages_so_far: [], ahead: [],
    held: [held('m2', 5, 'May I squash it?'), held('m1', 30, 'May I rebase it?')] };
  const box = page.stageBox(piece, { owner: 'tony', unit_many: 'items' }, now, false);
  assert.deepEqual(walk(box).filter(node => node.className === 'pl-held').map(node => node['data-message']), ['m2', 'm1']);
});

test('864 item record description admits authored query links and keeps surrounding text literal', async t => {
  const { miniDocument } = await import('./fixtures/mini_dom.mjs');
  const doc = miniDocument(), oldDocument = globalThis.document, oldLocation = globalThis.location;
  globalThis.document = doc; globalThis.location = new URL('https://theseus.example/?pipeline=w1&item=1');
  t.after(() => { globalThis.document = oldDocument; globalThis.location = oldLocation; });
  const header = { eyebrow: doc.createElement('p'), title: doc.createElement('h1'), description: doc.createElement('p') };
  // mini_dom keeps own text separate; native replaceChildren removes it too.
  const replace = header.description.replaceChildren.bind(header.description);
  header.description.replaceChildren = (...nodes) => { header.description.textContent = ''; replace(...nodes); };
  PipelinePage.prototype.paintHeader.call({ header }, 'Outcome', '1. Written record', 'Keep **literal**: [The smoke checks](?topic=Landing&page=n-864)');
  const links = [...header.description.descendants()].filter(node => node.tag === 'a');
  assert.equal(links.length, 1); assert.equal(links[0].text, 'The smoke checks');
  assert.equal(header.description.text, 'Keep **literal**: The smoke checks');
});
