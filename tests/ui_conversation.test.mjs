// Reply destinations and saved writing survive retiring the special page (835).
import test from 'node:test';
import assert from 'node:assert/strict';
import { paintAbout, paintAsksYou, conversationDestination,
  answererChoices, paintAnswerers, CONVERSATION_NOTE, switchWriting } from '../web/outcome-conversation.mjs';
import { parseRoute, routeHref, routeKey } from '../web/topic-navigation.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { Editor, WRITING_FIELDS, noWriting, written } from '../web/editor.mjs';
import { choiceOf, chosen, sending } from '../web/whisper-choice.mjs';

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

// The page reads the conversation again on every commit, its own reports of
// what was read among them, and paints each card's tags and About line again.
// A link that is replaced as the person presses it, or that holds the focus,
// is lost under them; so a paint that changes nothing keeps every link.
test('a read that changes nothing on a card keeps its About link, so a press or the focus on one lands; a change paints them anew', () => {
  const doc = miniDocument(), card = doc.createElement('article'), opened = [];
  const about = { message_id: 'm-src', topic_id: 't-1', topic_title: 'Agent loop', author_id: 'fable' };
  paintAbout(card, { about }, 'tony', () => {}, doc);
  const aboutLink = card.querySelector(':scope > .about-line').querySelector('.item-link');
  paintAbout(card, { about: { ...about } }, 'tony', (kind, id) => opened.push(['about', kind, id]), doc);
  assert.equal(card.querySelector(':scope > .about-line').querySelector('.item-link'), aboutLink, 'the same About link');
  aboutLink.onclick({ stopPropagation() {}, preventDefault() {} });
  assert.deepEqual(opened.at(-1), ['about', 'message', 'm-src']);
  paintAbout(card, { about: { ...about, topic_title: 'Codex hosting' } }, 'tony', () => {}, doc);
  assert.equal(card.querySelector(':scope > .about-line').querySelector('.item-link').textContent, 'Codex hosting', 'a change is painted');
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
// keep, shown) with real editors, keep standing for "kept on this device", each
// call recorded with the writing it kept, and shown saying how the Reader shows
// the writing where it was: who is an agent, and whether it was written for the
// conversation (w1-conversation here).
const CONTEXT = { instanceId: 'i-1', actor: 'tony', sourceRef: { kind: 'message', id: 'm-1' }, topicId: 't1', kind: 'reply' };
const CONVERSATION = 'w1-conversation';
const kindOf = name => name.endsWith('-agent') ? 'agent' : 'person';
const at = (topicId, fields = {}, state = {}) => Object.assign(new Editor({ ...CONTEXT, topicId }, { ...noWriting(), ...fields }), state);
const writingOf = editor => Object.fromEntries(WRITING_FIELDS.map(field => [field, editor.draft[field] ?? noWriting()[field]]));
// Who the Reader shows the writing going to: a name offered, then those it names.
const namesOf = editor => [...editor.offeredAddressees, ...editor.draft.addressees];
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
    // A name alone, with no choice made, is a Tell in both places: it arrives as it is, with no choice written down.
    const arrived = before[0];
    assert.deepEqual([stayed, after], [false, [noWriting(), arrived]], `${field} alone is writing, and it moves`);
    assert.deepEqual(kept, [['w1-conversation', arrived], ['t1', noWriting()]], `${field}: kept where it went before the draft it left is emptied`);
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

test("Whisper, Tell or Ask is never mixed between drafts: onto writing it stays apart, and into an empty draft it moves as it is, with the same default in both places", async () => {
  const agent = 'fixture-planning-agent';
  const one = [agent], two = [agent, 'fixture-agent'];
  const states = { whisper: chosen('whisper'), tell: chosen('tell'), ask: chosen('ask'), 'held by a second name': { whisper: true }, none: { whisper: null, intent: null } };
  const sends = (draft, names) => [choiceOf(draft, names, kindOf), sending(draft, names, kindOf)];
  for (const [fromName, fromChoice] of Object.entries(states)) {
    for (const names of [one, two]) for (const [from, to] of [['t1', CONVERSATION], [CONVERSATION, 't1']]) {
      const writing = { ...noWriting(), body: 'Private note.', addressees: names, ...fromChoice };
      const moved = at(to);
      await switched(at(from, writing), moved);
      assert.deepEqual(writingOf(moved), writingOf(at(to, writing)), `${fromName}, ${names.length} named, from ${from}: moved as it is, no choice written down`);
      assert.deepEqual(sends(moved.draft, namesOf(moved)), sends(writing, names), `${fromName}, ${names.length} named, from ${from} into an empty draft in ${to}`);
      for (const [toName, toChoice] of Object.entries(states)) {
        const r = await switched(at(from, writing), at(to, { body: 'Old question.', addressees: names, ...toChoice }));
        assert.deepEqual([r.stayed, r.after], [true, r.before], `${fromName} onto ${toName}, ${names.length} named, from ${from} to ${to}`);
      }
    }
  }
  // One agent named and no choice made is a Tell in a topic and in the conversation alike, so it arrives as the same Tell.
  for (const [from, to] of [['t1', CONVERSATION], [CONVERSATION, 't1']]) {
    const there = at(to);
    await switched(at(from, { body: 'Status, please.', addressees: one }), there);
    assert.deepEqual([there.draft.whisper ?? null, there.draft.intent ?? null], [null, null], `from ${from}: nothing is written down for it`);
    assert.deepEqual(sends(there.draft, namesOf(there))[1], { whisper: false, intent: 'tell' }, `from ${from}: a Tell where it was written is sent as a Tell`);
  }
  // Whisper chosen before a word is written, to the author the reply is offered to: it goes on to that author.
  for (const offeredThere of [true, false]) {
    const left = at('t1', chosen('whisper')); left.offerAddressees([agent]);
    const there = at(CONVERSATION); if (offeredThere) there.offerAddressees([agent]);
    assert.deepEqual(sends(left.draft, namesOf(left))[1], { whisper: true, intent: null }, 'the Reader shows a Whisper to the author');
    assert.equal(await switchWriting(left, there, async () => {}), false, 'a choice alone is writing, and it moves');
    assert.deepEqual([namesOf(there), sends(there.draft, namesOf(there))[1]], [[agent], { whisper: true, intent: null }],
      `still a Whisper to ${agent} where it arrived (${offeredThere ? 'offered there too' : 'not offered there'})`);
    assert.deepEqual([namesOf(left), writingOf(left)], [[agent], noWriting()], 'and the place it left offers the author again, with nothing written');
    assert.deepEqual([written(there.draft), written(left.draft)], [false, false], 'a choice moved is not writing: on both sides nothing is written, so 👍 stays beside Send');
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

test('conversation answerer labels use current names and still toggle the canonical recipient', () => {
  const doc = miniDocument(), host = doc.createElement('span'), toggled = [];
  const shown = paintAnswerers(host, { coordinator: 'codex-worker', members: ['warp'], names: [], reader: 'tony', doc,
    nameOf: id => id === 'codex-worker' ? 'codex' : 'Warp', toggle: (id, on) => toggled.push([id, on]) });
  assert.deepEqual(shown, ['codex-worker', 'warp']);
  assert.equal(host.children[0].textContent, 'codex');
  assert.equal(host.children[0].title, 'codex answers when you name nobody');
  host.children[1].onclick(); assert.deepEqual(toggled, [['warp', true]]);
});

test("legacy conversation addresses stay valid and unambiguous", () => {
  // A refused address is its words, so a missing route fails as an assertion.
  const parsed = search => { try { return parseRoute(new URL(`https://aim.test/${search}`)); } catch (error) { return error.message; } };
  assert.deepEqual(parsed('?conversation=w1'), { kind: 'conversation', id: 'w1' });
  assert.equal(routeHref({ kind: 'conversation', id: 'w1' }), '?conversation=w1');
  assert.deepEqual(parseRoute(new URL('https://aim.test/?topic=t-1')), { kind: 'topic', id: 't-1' });
  assert.throws(() => routeKey({ kind: 'conversation', id: 'w1', extra: 'x' }));
  assert.throws(() => parseRoute(new URL('https://aim.test/?conversation=w1&topic=t-1')));
});
