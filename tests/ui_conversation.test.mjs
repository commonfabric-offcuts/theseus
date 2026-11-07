// An outcome's conversation on the page (item 82, docs/conversation.md): the
// tags under each card, the waiting tags, "Asks you", the Only new chip, the
// empty words, the side rail's row, the Reader's To chips, the Answered by
// chips and the conversation's address. The views are painted for real into a
// small DOM; the native conversation checks show the same in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { itemTags, paintItemTags, paintAbout, paintAsksYou, paintOnlyNew, paintEmpty, paintConversationRow, conversationDestination,
  answererChoices, paintAnswerers, subtitle, CONVERSATION_NOTE, NOBODY_ANSWERS, switchWriting } from '../web/outcome-conversation.mjs';
import { parseRoute, routeHref, routeKey } from '../web/topic-navigation.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { Editor, WRITING_FIELDS, noWriting } from '../web/editor.mjs';
import { choiceOf, chosen, naming, sending } from '../web/whisper-choice.mjs';

const AT = Date.UTC(2026, 10, 6, 18, 0);
const words = tags => tags.map(tag => [tag.tag, tag.parts.map(part => typeof part === 'string' ? part : part.link ?? (part.time !== undefined ? '<time>' : '')).join('')]);
const item = (state, takes = []) => ({ id: 'm-item', item: { state, takes } });

test('each take is one tag under its card in the words of what became of it, and New stays while only part was taken', () => {
  assert.deepEqual(itemTags({ id: 'm-plain', item: null }, [], 'tony'), [], 'a message that is not an item has no tags');
  assert.deepEqual(words(itemTags(item('new'), [], 'tony')), [['New', '']]);
  const part = { kind: 'answer', ref: 'm-a', actor_id: 'fable', at_ms: AT, part: true };
  assert.deepEqual(words(itemTags(item('new', [part]), [], 'tony')), [['New', 'part taken so far'], ['Answered', "fable's reply · <time>"]]);
  assert.deepEqual(words(itemTags(item('settled', [{ ...part, part: false, actor_id: 'tony' }]), [], 'tony')), [['Answered', 'your reply · <time>']]);
  const topic = { kind: 'topic', ref: 't-9', title: 'Onboarding', readable: true, actor_id: 'fable', at_ms: AT, part: false };
  assert.deepEqual(words(itemTags(item('settled', [topic]), [], 'tony')), [['Taken into a topic', 'Onboarding · fable, <time>']]);
  assert.equal(itemTags(item('settled', [topic]), [], 'tony')[0].parts[0].topic, 't-9', 'the title links to its topic');
  assert.deepEqual(words(itemTags(item('settled', [{ ...topic, readable: false, title: null }]), [], 'tony')),
    [['Taken into a topic', 'a topic you cannot open · fable, <time>']]);
  assert.deepEqual(words(itemTags(item('settled', [{ ...topic, readable: false }]), [], 'tony')),
    [['Taken into a topic', 'a topic you cannot open · fable, <time>']], 'a title the reader cannot open is never shown');
  const pipeline = { kind: 'pipeline', numbers: [10, 22, 74], added: false, actor_id: 'fable', at_ms: AT, part: false };
  assert.deepEqual(words(itemTags(item('settled', [pipeline, { ...pipeline, numbers: [92], added: true }]), [], 'tony')),
    [['On the pipeline', 'as 10, 22 and 74 · fable, <time>'], ['On the pipeline', 'added to 92 · fable, <time>']]);
});

test('a wait on an item sits beside its takes, says who asked, and is "Waiting on you" only for whoever it waits on', () => {
  const answered = item('settled', [{ kind: 'answer', ref: 'm-a', actor_id: 'fable', at_ms: AT, part: false }]);
  const long = 'Which of the two launch dates should the announcement and the store listing both use from now on?';
  const waits = [{ ask_message_id: 'm-ask', on: 'tony', by: 'fable', since_ms: AT, item_id: 'm-item', excerpt: long },
    { ask_message_id: 'm-other', on: 'tony', by: 'fable', since_ms: AT, item_id: 'm-elsewhere', excerpt: 'Elsewhere?' }];
  const mine = itemTags(answered, waits, 'tony');
  assert.deepEqual(mine.map(tag => [tag.tag, Boolean(tag.mine)]), [['Answered', false], ['Waiting on you', true]], 'a wait on another item is not here');
  assert.equal(mine[1].parts[1].link, `${long.slice(0, 59).trimEnd()}…`, 'the ask in sixty characters');
  assert.equal(mine[1].parts[1].message, 'm-ask');
  const theirs = itemTags(answered, waits, 'cynthia');
  assert.deepEqual(theirs.map(tag => [tag.tag, Boolean(tag.mine)]), [['Answered', false], ['Waiting on tony', false]]);
  assert.equal(theirs[1].parts[0], 'fable asked: ');
});

test('the tags paint at the foot of the card, a link follows without opening the card, and no tags leave no row', () => {
  const doc = miniDocument(), card = doc.createElement('article'), opened = [];
  const topic = { kind: 'topic', ref: 't-9', title: 'Onboarding', readable: true, actor_id: 'fable', at_ms: AT, part: false };
  paintItemTags(card, item('settled', [topic]), [], 'tony', (kind, id) => opened.push([kind, id]), doc);
  const row = card.querySelector(':scope > .item-tags');
  assert.ok(row);
  assert.deepEqual(row.querySelectorAll('.item-tag').map(tag => tag.textContent), ['Taken into a topic']);
  let stopped = false;
  row.querySelector('.item-link').onclick({ stopPropagation: () => { stopped = true; }, preventDefault() {} });
  assert.deepEqual(opened, [['topic', 't-9']]);
  assert.ok(stopped, 'the card under the link is not opened as well');
  paintItemTags(card, { id: 'm-item', item: null }, [], 'tony', () => {}, doc);
  assert.equal(card.querySelector(':scope > .item-tags'), null);
});

test('a message sent from another topic says which message it is about, unless the reader cannot open it', () => {
  const doc = miniDocument(), card = doc.createElement('article'), opened = [];
  card.append(doc.createElement('p'));
  const about = { message_id: 'm-src', topic_id: 't-1', topic_title: 'Agent loop', author_id: 'fable' };
  paintAbout(card, { about }, 'tony', (kind, id) => opened.push([kind, id]), doc);
  const line = card.children[0];
  assert.equal(line.className, 'about-line');
  assert.equal(line.text, "About fable's message in Agent loop");
  line.querySelector('.item-link').onclick({ stopPropagation() {}, preventDefault() {} });
  assert.deepEqual(opened, [['message', 'm-src']]);
  paintAbout(card, { about: { ...about, author_id: 'tony' } }, 'tony', () => {}, doc);
  assert.equal(card.querySelectorAll(':scope > .about-line').length, 1, 'repainting keeps one line');
  assert.equal(card.children[0].text, 'About your message in Agent loop');
  paintAbout(card, { about: { hidden: true } }, 'tony', () => {}, doc);
  assert.equal(card.querySelector(':scope > .about-line'), null, 'nothing of a message the reader cannot open');
});

test('"Asks you" follows the author only while an open ask on that card waits on the reader', () => {
  const doc = miniDocument(), author = doc.createElement('div'), time = doc.createElement('time');
  time.className = 'message-time'; author.append('fable', time);
  const wait = { ask_message_id: 'm-ask', on: 'tony', item_id: null };
  paintAsksYou(author, { id: 'm-ask' }, [wait], 'tony', doc);
  assert.equal(author.children[1].textContent, 'Asks you');
  assert.equal(author.children[2], time, 'before the time');
  paintAsksYou(author, { id: 'm-ask' }, [wait], 'cynthia', doc);
  assert.equal(author.querySelector('.asks-you'), null, 'not for someone it does not wait on');
  paintAsksYou(author, { id: 'm-other' }, [wait], 'tony', doc);
  assert.equal(author.querySelector('.asks-you'), null, 'not on another card');
  paintAsksYou(author, { id: 'm-ask' }, [wait], 'tony', doc);
  paintAsksYou(author, { id: 'm-ask' }, [], 'tony', doc);
  assert.equal(author.querySelector('.asks-you'), null, 'gone once answered');
});

test('Only new is one chip with its count, pressed while on, and away while nothing is new and it is off', () => {
  const doc = miniDocument(), host = doc.createElement('div'), shown = [];
  paintOnlyNew(host, { view: { new_items: 2 }, onlyNew: false, show: value => shown.push(value), doc });
  const chip = host.querySelector('button');
  assert.deepEqual([chip.textContent, chip.getAttribute('aria-pressed'), host.hidden], ['Only new (2)', 'false', false]);
  chip.onclick();
  assert.deepEqual(shown, [true]);
  paintOnlyNew(host, { view: { new_items: 0 }, onlyNew: true, show: value => shown.push(value), doc });
  assert.deepEqual([host.querySelector('button'), chip.getAttribute('aria-pressed'), host.hidden], [chip, 'true', false], 'pressed stays to be turned off');
  chip.onclick();
  assert.deepEqual(shown, [true, false]);
  paintOnlyNew(host, { view: { new_items: 0 }, onlyNew: false, show() {}, doc });
  assert.equal(host.hidden, true);
});

test('an empty conversation says what it is for, who answers, and which topics it replaced', () => {
  const doc = miniDocument(), host = doc.createElement('div');
  paintEmpty(host, { view: { coordinator: { actor_id: 'fable' }, replaced: [] }, doc });
  assert.deepEqual(host.children.map(node => node.textContent), ['Nothing here yet.',
    'Write below to ask where things stand, or to raise a friction or a request. fable answers each one here or takes it into a topic, and the card says which.']);
  paintEmpty(host, { view: { coordinator: null, replaced: [{ title: "What's live and what's next" }, { title: 'Friction log' }] }, doc });
  assert.equal(host.children[1].textContent, `Write below to ask where things stand, or to raise a friction or a request. ${NOBODY_ANSWERS}`);
  assert.equal(host.children[2].textContent,
    "What's live and what's next, and Friction log, were closed when this conversation started. Both stay readable under Archived topics.");
  paintEmpty(host, { view: { coordinator: null, replaced: [{ title: 'Friction log' }] }, doc });
  assert.equal(host.children[2].textContent, 'Friction log was closed when this conversation started. It stays readable under Archived topics.');
  paintEmpty(host, { view: { coordinator: null, replaced: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }, doc });
  assert.equal(host.children[2].textContent, 'A, B, and C, were closed when this conversation started. They stay readable under Archived topics.');
});

test('the side rail row counts what is unread, says Waiting on you, and never lights for new items', () => {
  const doc = miniDocument(), host = doc.createElement('div'), opened = [];
  assert.equal(paintConversationRow(host, { view: null, title: 'Launch', reader: 'tony', href: '?conversation=w1', open() {}, doc }), false);
  assert.deepEqual(host.children, []);
  const quiet = { unread: 0, addressed: 0, new_items: 3, waits: [], work: null };
  assert.equal(paintConversationRow(host, { view: quiet, title: 'Launch', reader: 'tony', href: '?conversation=w1', open: () => opened.push(1), doc }), true);
  const row = host.children[0];
  assert.equal(row.text, 'LaunchStatus, friction, requests');
  assert.equal(row.querySelector('.unread-count'), null, 'three new items light nothing (D5)');
  assert.equal(row.querySelector('.topic-state'), null);
  row.onclick({ button: 0, preventDefault() {} });
  row.onclick({ button: 0, metaKey: true, preventDefault() {} });
  assert.deepEqual(opened, [1], 'a modified click is left to the browser');
  const busy = { unread: 2, addressed: 1, new_items: 0, waits: [{ on: 'tony', ask_message_id: 'm-ask' }], work: null };
  paintConversationRow(host, { view: busy, title: 'Launch', reader: 'tony', current: true, href: '?conversation=w1', open() {}, doc });
  const now = host.children[0];
  assert.equal(now.querySelector('.unread-count').className, 'unread-count addressed');
  assert.equal(now.querySelector('.unread-count').textContent, '2');
  assert.equal(now.querySelector('.topic-state').textContent, 'Waiting on you');
  assert.equal(now.getAttribute('aria-current'), 'page');
  paintConversationRow(host, { view: busy, title: 'Launch', reader: 'cynthia', href: '?conversation=w1', open() {}, doc });
  assert.equal(host.children[0].querySelector('.topic-state'), null, 'a wait on someone else is not on the reader');
});

test("the Reader's To is two chips, this topic and the conversation, with the chosen one pressed", () => {
  const doc = miniDocument(), host = doc.createElement('span');
  const topic = { id: 't-1', title: 'Agent loop' };
  conversationDestination(host, { topic, conversation: 't-conv', outcome: 'Launch', chosen: 't-1', doc });
  assert.deepEqual(host.children.map(chip => [chip.textContent, chip.dataset.destination, chip.getAttribute('aria-pressed'), chip.title]),
    [['This topic', 't-1', 'true', 'This topic: Agent loop'], ['Conversation', 't-conv', 'false', 'Launch conversation']]);
  conversationDestination(host, { topic, conversation: 't-conv', outcome: 'Launch', chosen: 't-conv', doc });
  assert.deepEqual(host.children.map(chip => chip.getAttribute('aria-pressed')), ['false', 'true']);
  assert.equal(CONVERSATION_NOTE('fable'), "Goes to the outcome's conversation with a link to this message. fable answers there; nobody in this topic is woken.");
  assert.equal(CONVERSATION_NOTE(null), "Goes to the outcome's conversation with a link to this message; nobody in this topic is woken.");
});

// The Reader's To switch (docs/conversation.md): switchWriting(left, there,
// keep) with real editors, keep standing for "kept on this device", each call
// recorded with the writing it kept.
const CONTEXT = { instanceId: 'i-1', actor: 'tony', sourceRef: { kind: 'message', id: 'm-1' }, topicId: 't1', kind: 'reply' };
const at = (topicId, fields = {}, state = {}) => Object.assign(new Editor({ ...CONTEXT, topicId }, { ...noWriting(), ...fields }), state);
const writingOf = editor => Object.fromEntries(WRITING_FIELDS.map(field => [field, editor.draft[field] ?? noWriting()[field]]));
const switched = async (left, there) => {
  const kept = [], before = [writingOf(left), writingOf(there)];
  const stayed = await switchWriting(left, there, async editor => { kept.push([editor.context.topicId, writingOf(editor)]); });
  return { stayed, kept, before, after: [writingOf(left), writingOf(there)] };
};
const QUOTE = { source_ref: { kind: 'message', id: 'm-1' }, excerpt: 'the launch' };
// One value for each field the editor takes as writing; a field added to the
// editor fails here until this list, and so the switch, knows it.
const WRITTEN = { body: 'Which build is it?', quotes: [QUOTE], addressees: ['fixture-planning-agent'], intent: 'ask', whisper: false, attachments: [{ id: 'media-1' }] };
// An image chosen for the writing, in every state the editor holds one.
const entry = (selected, kind) => ({ selected, owner: { kind, id: 'c-1' } });
const IMAGES = { attached: [{ attachments: [{ id: 'media-1' }] }, {}], 'chosen, uploading or failed': [{}, { uploadState: { entries: [entry(true, 'cycle')] } }],
  'image state that cannot be read': [{}, { uploadState: { entries: 'unreadable' } }],
  ...Object.fromEntries(['imageBusy', 'imageReservation', 'adopting', 'uploadOpaque'].map(busy => [busy, [{}, { [busy]: 1 }]])) };

test("switching To into an empty draft moves the whole writing there, every field as it is, and only then empties the draft it left", async () => {
  for (const field of WRITING_FIELDS.filter(field => field !== 'caret')) {
    assert.ok(Object.hasOwn(WRITTEN, field), `the switch knows ${field}`);
    if (field === 'attachments') continue;
    const left = at('t1', { [field]: WRITTEN[field] }), there = at('w1-conversation');
    const { stayed, kept, before, after } = await switched(left, there);
    assert.deepEqual([stayed, after], [false, [noWriting(), before[0]]], `${field} alone is writing, and it moves`);
    assert.deepEqual(kept, [['w1-conversation', before[0]], ['t1', noWriting()]], `${field}: kept where it went before the draft it left is emptied`);
  }
  const whole = { ...WRITTEN, attachments: [], ...chosen('whisper'), caret: { start: 5, end: 5 } };
  const left = at('t1', whole), there = at('w1-conversation');
  assert.deepEqual((await switched(left, there)).after, [noWriting(), whole], 'the words, quotes, names, Whisper and the caret, as one unit');
  assert.deepEqual((await switched(at('t1', { body: '   ' }), at('w1-conversation'))).after, [noWriting(), { ...noWriting(), body: '   ' }], 'spaces move too');
  const empty = await switched(at('t1'), at('w1-conversation', { body: 'kept' }));
  assert.deepEqual([empty.stayed, empty.kept, empty.after], [false, [], empty.before], 'nothing written, nothing moves, nothing is said');
  // A name offered where the writing arrives is not added to it.
  const offered = at('w1-conversation'); offered.offerAddressees(['fixture-agent']);
  await switched(at('t1', { body: 'words' }), offered);
  assert.deepEqual([offered.draft.body, offered.draft.addressees, offered.offeredAddressees], ['words', [], []]);
  const named = at('w1-conversation'); named.offerAddressees(['fixture-agent']);
  await switched(at('t1', { body: 'words', addressees: ['fixture-agent'] }), named);
  assert.deepEqual(named.draft.addressees, ['fixture-agent'], 'and one the writing names is named once');
});

test('switching To onto a draft that holds writing merges nothing: both drafts stay exactly as they were, and the switch says the writing stayed', async () => {
  for (const field of WRITING_FIELDS.filter(field => field !== 'caret' && field !== 'attachments')) {
    const r = await switched(at('t1', { body: 'New words.', quotes: [{ ...QUOTE, excerpt: 'other' }], addressees: ['warp'], ...chosen('whisper') }), at('w1-conversation', { [field]: WRITTEN[field] }));
    assert.deepEqual([r.stayed, r.kept, r.after], [true, [], r.before], `the other draft holds only ${field}: nothing moves`);
  }
  for (const [state, [fields, held]] of Object.entries(IMAGES)) {
    const there = await switched(at('t1', { body: 'New words.' }), at('w1-conversation', fields, held));
    assert.deepEqual([there.stayed, there.kept, there.after], [true, [], there.before], `the other draft holds an image (${state}): nothing moves`);
  }
  for (const state of ['unavailable', 'conflict', 'authorityRecovery']) {
    const r = await switched(at('t1', { body: 'New words.' }), at('w1-conversation', {}, { [state]: { error: 1 } }));
    assert.deepEqual([r.stayed, r.kept, r.after], [true, [], r.before], `the other place cannot take writing (${state}): it stays`);
  }
});

test('writing with an image in any state stays where the image was chosen: attached, uploading, failed, or an image action under way', async () => {
  for (const [state, [fields, held]] of Object.entries(IMAGES)) {
    const r = await switched(at('t1', { body: 'With a picture.', ...fields }, held), at('w1-conversation'));
    assert.deepEqual([r.stayed, r.kept, r.after], [true, [], r.before], state);
  }
  const gone = await switched(at('t1', { body: 'Words.' }, { uploadState: { entries: [entry(false, 'cycle'), entry(true, 'submission')] } }), at('w1-conversation'));
  assert.equal(gone.stayed, false, 'an image removed, or sent with an earlier message, is not this writing\'s: the words move');
});

test('an interrupted switch leaves the writing in the draft it was written in', async () => {
  const left = at('t1', { body: 'Not lost.', addressees: ['warp'], ...chosen('ask') }), there = at('w1-conversation');
  await assert.rejects(switchWriting(left, there, async editor => { if (editor === there) throw Error('This device could not keep it.'); }), /could not keep it/);
  assert.deepEqual(writingOf(left), { ...noWriting(), body: 'Not lost.', addressees: ['warp'], ...chosen('ask') });
});

test("Whisper, Tell or Ask is never mixed between drafts: onto writing it stays apart, and into an empty draft the moved choice is sent as chosen", async () => {
  const agent = 'fixture-planning-agent', kindOf = name => name.endsWith('-agent') ? 'agent' : 'person';
  const one = [agent], two = [agent, 'fixture-agent'];
  const held = { ...noWriting(), ...naming(noWriting(), one, kindOf), addressees: two };
  assert.deepEqual([held.whisper, held.intent], [true, null], 'a second name on a default whisper holds the whisper');
  const states = { whisper: chosen('whisper'), tell: chosen('tell'), ask: chosen('ask'), 'held by a second name': { whisper: true }, none: { whisper: null, intent: null } };
  const sends = (draft, names, options) => [choiceOf(draft, names, kindOf, options), sending(draft, names, kindOf, options)];
  for (const [fromName, fromChoice] of Object.entries(states)) {
    for (const names of [one, two]) for (const conversation of [true, false]) {
      const options = { conversation }, from = { ...noWriting(), body: 'Private note.', addressees: names, ...fromChoice };
      const moved = at('w1-conversation');
      await switched(at('t1', from), moved);
      assert.deepEqual(sends(moved.draft, names, options), sends(from, names, options), `${fromName} into an empty draft, ${names.length} named`);
      for (const [toName, toChoice] of Object.entries(states)) {
        const r = await switched(at('t1', from), at('w1-conversation', { body: 'Old question.', addressees: names, ...toChoice }));
        assert.deepEqual([r.stayed, r.after], [true, r.before], `${fromName} onto ${toName}, ${names.length} named, ${conversation ? 'into' : 'out of'} the conversation`);
      }
    }
  }
});

test('Answered by offers the coordinator first, then the team; with nobody named the coordinator is pressed and stays so', () => {
  assert.deepEqual(answererChoices({ coordinator: 'fable', members: ['warp', 'fable', 'tony'], names: [], reader: 'tony' }),
    [{ id: 'fable', pressed: true, fallback: true }, { id: 'warp', pressed: false, fallback: false }]);
  assert.deepEqual(answererChoices({ coordinator: 'fable', members: ['warp'], names: ['warp'], reader: 'tony' }),
    [{ id: 'fable', pressed: false, fallback: false }, { id: 'warp', pressed: true, fallback: false }], 'naming someone frees the coordinator');
  assert.deepEqual(answererChoices({ coordinator: null, members: ['warp'], names: [], reader: 'tony' }), [{ id: 'warp', pressed: false, fallback: false }]);
  const doc = miniDocument(), host = doc.createElement('span'), toggled = [];
  const shown = paintAnswerers(host, { coordinator: 'fable', members: ['warp'], names: [], reader: 'tony', toggle: (id, on) => toggled.push([id, on]), doc });
  assert.deepEqual(shown, ['fable', 'warp']);
  const [fable, warp] = host.children;
  assert.equal(fable.title, 'fable answers when you name nobody');
  fable.onclick();
  assert.deepEqual(toggled, [], 'a tap on the coordinator changes nothing while nobody is named');
  warp.onclick();
  paintAnswerers(host, { coordinator: 'fable', members: ['warp'], names: ['warp'], reader: 'tony', toggle: (id, on) => toggled.push([id, on]), doc });
  host.children[1].onclick();
  assert.deepEqual(toggled, [['warp', true], ['warp', false]]);
});

test("the conversation's heading names who answers, and its address is ?conversation=OUTCOME", () => {
  assert.equal(subtitle('fable'), 'Ask where things stand, or raise a friction or a request. fable answers here; others answer only when you name them.');
  assert.equal(subtitle(null), `Ask where things stand, or raise a friction or a request. ${NOBODY_ANSWERS}`);
  // A refused address is its words, so a missing route fails as an assertion.
  const parsed = search => { try { return parseRoute(new URL(`https://aim.test/${search}`)); } catch (error) { return error.message; } };
  assert.deepEqual(parsed('?conversation=w1'), { kind: 'conversation', id: 'w1' });
  assert.equal(routeHref({ kind: 'conversation', id: 'w1' }), '?conversation=w1');
  assert.deepEqual(parseRoute(new URL('https://aim.test/?topic=t-1')), { kind: 'topic', id: 't-1' });
  assert.throws(() => routeKey({ kind: 'conversation', id: 'w1', extra: 'x' }));
  assert.throws(() => parseRoute(new URL('https://aim.test/?conversation=w1&topic=t-1')));
});
