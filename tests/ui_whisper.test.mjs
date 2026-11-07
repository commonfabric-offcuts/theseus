// Whisper, Tell or Ask, the line above Send, and whispers on the page
// (docs/whispers.md, item 92). The views are painted for real into a small DOM;
// the native whisper checks show the same in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultChoice, choiceOf, chosen, naming, unnamed, sending, audienceWords, paintChoice, clearChoice, paintWhisperAuthor } from '../web/whisper-choice.mjs';
import { cardClass } from '../web/author-colors.mjs';
import { Freshness } from '../web/freshness.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { Editor } from '../web/editor.mjs';
import { Reader } from '../web/reader.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const KINDS = { fable: 'agent', 'aim-ux': 'agent', warp: 'agent', cynthia: 'human' };
const kindOf = name => KINDS[name];
const EVERYONE = ['aim-ux', 'fable', 'warp'];

function painted(t) {
  const previous = globalThis.document, document = miniDocument();
  globalThis.document = document;
  t.after(() => { globalThis.document = previous; });
  const row = Object.assign(document.createElement('div'), { id: 'intent-row' }), field = document.createElement('textarea');
  const send = document.createElement('button'), word = document.createElement('span');
  word.className = 'send-word'; word.textContent = 'Send'; send.append(word, ' ⌘↵');
  const chosenBy = [];
  const paint = (draft, names, options = {}) => paintChoice(row, { draft, names, kindOf, everyone: EVERYONE, send, field,
    onChoose: choice => chosenBy.push(choice), ...options });
  // Each choice is a chip tapped once: aria-pressed says which is on.
  const radios = () => Object.fromEntries(row.querySelectorAll('button[data-intent]').map(chip =>
    [chip.dataset.intent, { checked: chip.getAttribute('aria-pressed') === 'true', disabled: chip.disabled, why: chip.title, said: chip.querySelector('.sr-only').textContent }]));
  const line = () => row.querySelector('.audience-line');
  return { document, row, field, send, word, paint, radios, line, chosenBy };
}

test('a message starts as a whisper only when it names exactly one agent, and as a Tell in an outcome\'s conversation', () => {
  assert.equal(defaultChoice([], kindOf), 'tell', 'nobody named');
  assert.equal(defaultChoice(['fable'], kindOf), 'whisper', 'one agent');
  assert.equal(defaultChoice(['fable', 'warp'], kindOf), 'tell', 'two agents');
  assert.equal(defaultChoice(['cynthia'], kindOf), 'tell', 'one person');
  assert.equal(defaultChoice(['stranger'], kindOf), 'tell', 'someone whose kind the page does not know');
  assert.equal(defaultChoice(['fable'], kindOf, { conversation: true }), 'tell', 'in the conversation, even one agent');
  // With no choice of the person's own, the writing goes as the default shows.
  assert.deepEqual(sending({}, ['fable'], kindOf), { whisper: true, intent: null });
  assert.deepEqual(sending({}, ['fable', 'warp'], kindOf), { whisper: false, intent: 'tell' });
  assert.deepEqual(sending({}, [], kindOf), { whisper: false, intent: null }, 'a message to nobody neither asks, tells nor whispers');
  assert.deepEqual(sending({ whisper: true }, [], kindOf), { whisper: false, intent: null });
});

test('Whisper greys out unless exactly one agent is named, and Ask while nobody is, each saying why', t => {
  const f = painted(t);
  f.paint({}, []);
  assert.deepEqual(f.radios(), {
    whisper: { checked: false, disabled: true, why: 'Name one agent to whisper to them.', said: ', Name one agent to whisper to them.' },
    tell: { checked: true, disabled: false, why: '', said: '' },
    ask: { checked: false, disabled: true, why: 'Name someone to ask them.', said: ', Name someone to ask them.' } });
  assert.equal(f.row.querySelector('.intent-choice').attributes.role, 'group');
  assert.deepEqual(f.row.querySelectorAll('input').length, 0, 'chips, never round buttons');
  assert.ok(f.row.querySelectorAll('button[data-intent]').every(chip => chip.classList.contains('choice-chip') && chip.type === 'button'));
  assert.equal(f.row.querySelector('.intent-choice').attributes['aria-label'], 'How this is sent');
  f.paint({}, ['fable']);
  assert.deepEqual(Object.fromEntries(Object.entries(f.radios()).map(([key, value]) => [key, [value.checked, value.disabled]])),
    { whisper: [true, false], tell: [false, false], ask: [false, false] });
  f.paint({}, ['cynthia']);
  assert.deepEqual([f.radios().whisper.disabled, f.radios().whisper.why, f.radios().tell.checked], [true, 'Name one agent to whisper to them.', true], 'a person is never whispered to');
  f.paint({}, ['fable', 'warp']);
  assert.deepEqual([f.radios().whisper.disabled, f.radios().whisper.why], [true, 'A whisper goes to one agent. With more than one name, choose Tell or Ask.']);
  f.paint({}, ['fable'], { readOnly: true });
  assert.ok(Object.values(f.radios()).every(radio => radio.disabled), 'writing that cannot change cannot change how it is sent');
  // A tap on a choice is handed to the composer that owns the draft; a tap on the one already on changes nothing.
  const chip = value => f.row.querySelectorAll('button[data-intent]').find(each => each.dataset.intent === value);
  chip('tell').onclick(); chip('whisper').onclick();
  assert.deepEqual(f.chosenBy, ['tell']);
  // An arrow moves the choice along the chips, as on round buttons, wrapping at either end, and passes over one that cannot be chosen.
  f.paint({ intent: 'tell' }, ['fable']);
  const key = (value, name) => { let stopped = false; f.row.querySelector('.intent-choice').listeners.keydown({ key: name, target: chip(value), preventDefault: () => { stopped = true; } }); return stopped; };
  assert.equal(key('ask', 'ArrowRight'), true); assert.equal(key('whisper', 'ArrowLeft'), true); assert.equal(key('tell', 'ArrowRight'), true);
  assert.equal(key('tell', 'Enter'), false, 'other keys are the button\'s own');
  assert.deepEqual(f.chosenBy, ['tell', 'whisper', 'ask', 'ask']);
  assert.equal(f.document.activeElement, chip('ask'), 'the focus goes with the choice');
  f.paint({ intent: 'ask' }, ['cynthia']);
  key('ask', 'ArrowRight');
  assert.deepEqual(f.chosenBy.at(-1), 'tell', 'Whisper cannot be chosen for a person, so the arrow goes on to Tell');
});

test('the line above Send says in words who will see it, for each choice, and a phone keeps who', t => {
  const f = painted(t);
  const words = () => [f.line().querySelector('strong').text, f.line().text, f.line().querySelector('.audience-more')?.text];
  f.paint({}, ['fable']);
  assert.deepEqual(words(), ['Only you and fable', 'Only you and fable will see this. No other agent gets it, and fable takes it as a question, not an instruction.',
    ' No other agent gets it, and fable takes it as a question, not an instruction.']);
  assert.equal(f.line().attributes['aria-live'], 'polite');
  f.paint({}, []);
  assert.equal(f.line().text, 'Everyone in this topic will see this. That is aim-ux, fable and warp. It goes to no one by name.');
  f.paint({ intent: 'tell' }, ['fable']);
  assert.equal(f.line().text, 'Everyone in this topic will see this. That is aim-ux, fable and warp. It goes to fable by name; nothing is owed back.');
  f.paint({ intent: 'ask' }, ['fable']);
  assert.equal(f.line().text, 'Everyone in this topic will see this, and it waits on fable until they reply. That is aim-ux, fable and warp.');
  f.paint({ intent: 'ask' }, ['fable', 'warp']);
  assert.equal(f.line().text, 'Everyone in this topic will see this, and it waits on fable and warp until each replies. That is aim-ux, fable and warp.');
  f.paint({ intent: 'tell' }, ['fable'], { answeringWhisper: true });
  assert.equal(f.line().text, 'Everyone in this topic will see this. The whisper itself stays private. That is aim-ux, fable and warp.');
  assert.deepEqual(audienceWords({ choice: 'tell', switched: false }, [], []), ['Everyone in this topic', ' will see this.', ' It goes to no one by name.']);
});

test('Send says Whisper, Send or Ask, and only a whisper\'s writing box wears the dashed line, never italics', t => {
  const f = painted(t);
  f.paint({}, ['fable']);
  assert.deepEqual([f.word.textContent, f.field.classList.contains('whispering')], ['Whisper', true]);
  f.paint({ intent: 'ask' }, ['fable']);
  assert.deepEqual([f.word.textContent, f.field.classList.contains('whispering')], ['Ask', false]);
  f.paint({ intent: 'tell' }, ['fable']);
  assert.deepEqual([f.word.textContent, f.field.classList.contains('whispering')], ['Send', false]);
  f.paint({}, ['fable']);
  clearChoice(f.row, f.field, f.send);
  assert.deepEqual([f.row.children.length, f.word.textContent, f.field.classList.contains('whispering')], [0, 'Send', false], 'a private note has no choice');
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = selector => css.split('\n').find(line => line.startsWith(selector)) ?? '';
  assert.match(rule('textarea.whispering'), /border:1px dashed var\(--whisper-line\)/);
  assert.match(rule('.message-card.whisper'), /border:1px dashed var\(--whisper-line\)/);
  assert.doesNotMatch(css.split('\n').filter(line => /whisper/.test(line)).join('\n'), /italic|border-left/, 'no italics and no coloured edge on a whisper');
});

test('a person\'s own choice is kept as names come and go; naming nobody clears it', () => {
  let draft = { ...chosen('tell') };
  assert.equal(choiceOf(draft, ['fable'], kindOf).choice, 'tell', 'Tell chosen with one agent stays Tell');
  draft = { ...draft, ...naming(draft, ['fable'], kindOf) };
  assert.deepEqual(choiceOf(draft, ['fable', 'warp'], kindOf), { choice: 'tell', switched: false });
  assert.deepEqual(choiceOf(draft, ['fable'], kindOf), { choice: 'tell', switched: false }, 'taking the second name away leaves the person\'s Tell');
  draft = { ...chosen('ask') };
  assert.equal(choiceOf(draft, ['fable'], kindOf).choice, 'ask');
  assert.equal(choiceOf(draft, ['fable', 'warp'], kindOf).choice, 'ask');
  draft = { ...draft, ...unnamed };
  assert.equal(choiceOf(draft, ['fable'], kindOf).choice, 'whisper', 'once nobody was named, one agent named again starts as a whisper');
  assert.deepEqual(chosen('whisper'), { whisper: true, intent: null });
  assert.deepEqual(chosen('ask'), { whisper: false, intent: 'ask' });
});

test('a second name moves a whisper to a Tell and says so; taking it away makes it a whisper again unless the person chose in between', t => {
  const f = painted(t);
  let draft = {};
  // Adding warp to a whisper to fable, as the composers do: the whisper is held.
  draft = { ...draft, ...naming(draft, ['fable'], kindOf) };
  assert.equal(draft.whisper, true);
  const state = f.paint(draft, ['fable', 'warp']);
  assert.deepEqual(state, { choice: 'tell', switched: true });
  assert.deepEqual([f.radios().whisper.disabled, f.radios().tell.checked], [true, true]);
  assert.equal(f.line().text, 'Everyone in this topic will see this. A whisper goes to one agent. Nothing you wrote is lost.' +
    ' Adding warp made this a Tell. To reach fable and warp privately, send each a whisper.');
  assert.ok(f.line().classList.contains('switched'));
  assert.deepEqual(sending(draft, ['fable', 'warp'], kindOf), { whisper: false, intent: 'tell' }, 'two names are never sent as a whisper');
  assert.deepEqual(f.paint(draft, ['fable']), { choice: 'whisper', switched: false }, 'taking warp away makes it a whisper again');
  assert.equal(f.line().classList.contains('switched'), false);
  // A person's click in between is kept.
  draft = { ...draft, ...chosen('tell') };
  assert.deepEqual(f.paint(draft, ['fable']), { choice: 'tell', switched: false });
  // A message that was a Tell by default is not made a whisper by naming more.
  assert.deepEqual(naming({}, ['fable', 'warp'], kindOf), {});
  assert.deepEqual(naming({}, [], kindOf), {});
});

test('a whisper\'s card keeps its author\'s colour, adds the dashed line, says whom it is to from the viewer\'s side, and "no answer yet" only on the viewer\'s own', t => {
  const document = miniDocument();
  assert.equal(cardClass({ author_id: 'tony', whisper: true }, 'tony'), 'message-card own-message whisper');
  assert.equal(cardClass({ author_id: 'fable', author_kind: 'agent', whisper: true }, 'tony', () => 'teal'), 'message-card agent-card agent-teal whisper');
  assert.equal(cardClass({ author_id: 'fable', author_kind: 'agent', whisper: false }, 'tony', () => 'teal'), 'message-card agent-card agent-teal');
  const card = (item, viewer) => {
    const host = document.createElement('article'); host.className = 'message-card';
    const author = document.createElement('div'), time = document.createElement('span');
    time.className = 'message-time'; time.textContent = ' · 6:50 AM'; author.append(item.author_id, time); host.append(author);
    paintWhisperAuthor(author, item, viewer, document);
    return { host, author };
  };
  const own = card({ author_id: 'tony', private_to: 'aim-ux', no_answer: true, body: 'Is the copy final?' }, 'tony');
  assert.equal(own.author.text, 'tony · whisper to aim-ux · 6:50 AM · no answer yet');
  assert.equal(own.host.attributes['aria-label'], 'tony, whisper to aim-ux, 6:50 AM. Is the copy final?');
  const theirs = card({ author_id: 'aim-ux', private_to: 'tony', body: 'Not yet.' }, 'tony');
  assert.equal(theirs.author.text, 'aim-ux · whisper to you · 6:50 AM', 'to the viewer, without "no answer yet"');
  const answered = card({ author_id: 'tony', private_to: 'aim-ux', no_answer: false, body: 'Is the copy final?' }, 'tony');
  assert.equal(answered.author.text, 'tony · whisper to aim-ux · 6:50 AM');
  // Painting again, as a repaint or an answer does, keeps one of each.
  paintWhisperAuthor(own.author, { author_id: 'tony', private_to: 'aim-ux', no_answer: true, body: 'Is the copy final?' }, 'tony', document);
  paintWhisperAuthor(own.author, { author_id: 'tony', private_to: 'aim-ux', no_answer: false, body: 'Is the copy final?' }, 'tony', document);
  assert.equal(own.author.text, 'tony · whisper to aim-ux · 6:50 AM');
});

function reader(t, { source, offered = ['fable'], kinds = kindOf } = {}) {
  const previous = { document: globalThis.document, window: globalThis.window };
  const document = miniDocument();
  globalThis.document = document; globalThis.window = { getSelection: () => null };
  t.after(() => Object.assign(globalThis, previous));
  const context = { instanceId: 'fixture', actor: 'tony', sourceRef: source.source_ref, topicId: 't1', kind: 'reply' };
  const reply = new Editor(context, { id: 'reply', revision: 1, generation: 'g', body: '' });
  reply.offerAddressees(offered);
  const sent = [];
  const send = document.createElement('button');
  const r = Object.assign(Object.create(Reader.prototype), {
    sessions: { reply }, mode: 'reply', presentation: {}, source, field: document.createElement('textarea'),
    sourceBody: document.createElement('div'), $: id => id === 'send-reply' ? send : document.byId(id), disarm() {},
    callbacks: { admits: () => true, writes: () => true, edit() {}, reach: () => ({ reachable: true }), actor: () => 'tony',
      people: () => ({ kindOf: kinds, everyone: EVERYONE }), send: editor => { sent.push({ ...editor.draft }); return Promise.resolve(); } },
  });
  send.append(Object.assign(document.createElement('span'), { className: 'send-word', textContent: 'Send' }));
  const checked = () => document.byId('intent-row').querySelectorAll('button[data-intent]').find(chip => chip.getAttribute('aria-pressed') === 'true')?.dataset.intent;
  return { r, reply, sent, checked, line: () => document.byId('intent-row').querySelector('.audience-line').text, document, send };
}

test('in the Reader a reply to one agent\'s message starts as a whisper, whether that message was a whisper, a Tell or an Ask', t => {
  for (const [kind, source] of [['whisper', { whisper: true, private_to: 'tony', author: 'fable' }], ['tell', { whisper: false, intent: 'tell', author: 'fable' }],
    ['ask', { whisper: false, intent: 'ask', author: 'fable' }], ['nobody', { whisper: false, intent: null, author: 'fable' }]]) {
    const f = reader(t, { source: { source_ref: { kind: 'message', id: 'm-' + kind }, body: 'Words', ...source } });
    f.r.paintChoice();
    assert.equal(f.checked(), 'whisper', `a reply to a ${kind} from fable`);
    assert.equal(f.send.querySelector('.send-word').textContent, 'Whisper');
  }
  const person = reader(t, { source: { source_ref: { kind: 'message', id: 'm-person' }, body: 'Words', author: 'cynthia' }, offered: ['cynthia'] });
  person.r.paintChoice();
  assert.equal(person.checked(), 'tell', 'a reply to a person is a Tell');
});

test('a Tell answering a whisper says the whisper stays private, and each reply goes with the choice it shows', async t => {
  const f = reader(t, { source: { source_ref: { kind: 'message', id: 'm-w' }, body: 'Is the copy final?', whisper: true, private_to: 'tony', author: 'fable' } });
  f.r.paintChoice();
  assert.equal(f.line(), 'Only you and fable will see this. No other agent gets it, and fable takes it as a question, not an instruction.');
  f.reply.edit({ body: 'Yes, final.' });
  await f.r.send(false);
  assert.deepEqual([f.sent[0].addressees, f.sent[0].whisper, f.sent[0].intent], [['fable'], true, null], 'the default goes as a whisper');
  f.r.choose('tell');
  assert.equal(f.line(), 'Everyone in this topic will see this. The whisper itself stays private. That is aim-ux, fable and warp.');
  await f.r.send(false);
  assert.deepEqual([f.sent[1].whisper, f.sent[1].intent], [false, 'tell'], 'Tell goes as a tell');
  f.r.choose('ask');
  await f.r.send(false);
  assert.deepEqual([f.sent[2].whisper, f.sent[2].intent], [false, 'ask']);
  // Adding a second agent to a whisper, then taking them away, in the Reader's own controls.
  f.r.choose('whisper');
  f.document.byId('recipient-input').value = 'warp'; f.r.addRecipient();
  assert.equal(f.checked(), 'tell');
  assert.match(f.line(), /^Everyone in this topic will see this\. A whisper goes to one agent\. Nothing you wrote is lost\./);
  const chip = f.document.byId('recipient-chips').children.find(node => node.dataset.name === 'warp');
  chip.querySelector('button').onclick();
  assert.equal(f.checked(), 'whisper', 'with warp gone it is a whisper again');
});

test('the Reader says a whisper is one, from the reader\'s side, and its words wear the dashed line', t => {
  const f = reader(t, { source: { source_ref: { kind: 'message', id: 'm-w' }, body: 'Words', author: 'fable' } });
  const origin = () => f.document.byId('reader-origin').text;
  f.r.paintTone = () => {};
  f.r.paintOrigin({ author: 'fable', source_ref: { kind: 'message', id: 'm-w' }, whisper: true, private_to: 'tony' });
  assert.deepEqual([origin(), f.r.sourceBody.classList.contains('whispering')], ['fable · Whisper to you', true]);
  f.r.paintOrigin({ author: 'tony', source_ref: { kind: 'message', id: 'm-v' }, whisper: true, private_to: 'aim-ux' });
  assert.equal(origin(), 'tony · Whisper to aim-ux');
  f.r.paintOrigin({ author: 'fable', source_ref: { kind: 'message', id: 'm-t' }, whisper: false });
  assert.deepEqual([origin(), f.r.sourceBody.classList.contains('whispering')], ['fable · Message', false]);
});

const admission = { version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } };
const bootstrap = { instance_id: 'i1', actor: 'tony', authority: { authority_id: 'a1', authority_epoch: 'e1' }, transport: { read_admission: admission } };
const binding = { instance_id: 'i1', actor_id: 'tony', authority_id: 'a1', authority_epoch: 'e1' };
const cursor = (scope, seq) => ({ v: 1, kind: 'checkpoint', ...binding, scope, after_seq: seq });

test('a whisper in the open topic, seen in the reader\'s own changes on a commit, loads the topic\'s newest messages; one elsewhere does not, and an idle page reads one scope', async () => {
  const topic = { kind: 'topic', id: 't1' }, actor = { kind: 'actor', id: 'tony' }, reads = [], refreshed = [];
  let head = 20;
  let actorItems = [{ seq: 11, resource_kind: 'whisper', resource_id: 't1', version: 40 }, { seq: 12, resource_kind: 'whisper', resource_id: 't2', version: 41 },
    { seq: 13, resource_kind: 'delivery', resource_id: 'd-1', version: 1 }];
  const api = { view: async (name, args) => {
    reads.push({ name, scope: args.scope, after: args.cursor?.after_seq });
    if (args.scope.kind === 'topic') return { instance_id: 'i1', scope: topic, baseline: false, items: [], has_more: false, continuation: null, checkpoint: cursor(topic, head), covered_versions: { topic: 1, notebook: 0 } };
    const items = actorItems; actorItems = [];
    return { instance_id: 'i1', scope: actor, baseline: false, items, has_more: false, continuation: null, checkpoint: cursor(actor, head), covered_versions: {} };
  } };
  const f = new Freshness({ api, bootstrap, topicId: 't1', checkpoint: cursor(topic, 10), actorCheckpoint: cursor(actor, 10),
    timers: { setTimeout: () => 0, clearTimeout() {} }, read: action => action({ readClass: 'background' }), binding: () => bootstrap,
    keys: () => [], refresh: async key => { refreshed.push(key); return true; }, yieldRead: async () => {} });
  await f.request();
  assert.deepEqual(refreshed, ['whisper:40'], 'only the whisper in this topic asks for a read');
  assert.deepEqual(reads, [{ name: 'changes', scope: topic, after: 10 }, { name: 'changes', scope: actor, after: 10 }]);
  head = 25;
  await f.request();
  assert.deepEqual(reads.slice(2), [{ name: 'changes', scope: topic, after: 20 }, { name: 'changes', scope: actor, after: 20 }], 'the next commit reads on from where the last stopped');
  assert.deepEqual(refreshed, ['whisper:40']);
  // With nothing committed anywhere since, a pass reads the topic's changes alone, as an idle page did before whispers.
  await f.request(); await f.request();
  assert.deepEqual(reads.slice(4), [{ name: 'changes', scope: topic, after: 25 }, { name: 'changes', scope: topic, after: 25 }]);
});

test('a whisper\'s key reads the topic\'s newest messages down to it, and is done once it is loaded', async () => {
  const views = new TopicViews({ instanceId: 'i1', topicId: 't1' });
  const item = (seq, extra = {}) => ({ id: 'm-' + seq, seq, topic_id: 't1', body: 'Words ' + seq, author_id: 'fable', ...extra });
  views.messagesPage({ instance_id: 'i1', items: [item(3)], next_cursor: null, relevant_versions: { topic: 1 } }, { initial: true });
  const reads = [];
  const read = async (name, args) => { reads.push([name, args]); return { instance_id: 'i1', items: [item(5, { whisper: true, private_to: 'tony' })], next_cursor: null, relevant_versions: { topic: 1 } }; };
  assert.equal(await views.refresh('whisper:5', 5, read), true);
  assert.deepEqual(reads, [['topic_messages', { topic_id: 't1', audience: 'all', direction: 'after', cursor: 3, limit: 30 }]]);
  assert.equal(views.messages.get('m-5').whisper, true);
  assert.equal(await views.refresh('whisper:5', 5, read), true, 'already loaded');
  assert.equal(reads.length, 1, 'and not read again');
});
