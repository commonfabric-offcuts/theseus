import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { TopicViews } from '../web/topic-views.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { mayAnswer } from '../web/reactions.mjs';
import { foldCard, paintFoldWords } from '../web/fold.mjs';
import { OutlineDossiers } from '../web/outline-dossiers.mjs';

const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const removal = await import('../web/message-removal.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const own = { id: 'message', author_id: 'owner', topic_id: 'topic', removal_action: 'unsend' };

function menu(item, actorKind = 'human') {
  const start = app.indexOf('function sharedMessageMenuItems('), end = app.indexOf('async function withMenuSource(', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    window: { matchMedia: () => ({ matches: false }) }, document: {}, topicUnavailable: false, outcomeReached: false,
    editRights: () => ({ actor: 'owner', actorKind }), stackFeed: null, topic: null, cardIn: () => null,
    messageEntries: new Map(), cardScroll: null, mayEdit: () => false, messageEdit: null, updateMenuItem: () => null,
    updateContext: () => ({}), withdrawalItem: () => null, removalItem: removal.removalItem,
    removals: { remove() {} }, marks: null, bootstrap: { actor: 'owner' }, mayStartFrom: () => false,
    textDisplayMenuItems: () => [], run: f => f(),
  };
  const found = runInNewContext(app.slice(start, end) + '; sharedMessageMenuItems', context);
  return Array.from(found(item), choice => choice.label);
}

test('the existing shared menu offers the Core-chosen human Unsend or Retract once', () => {
  assert.equal(menu(own).filter(label => label === 'Unsend').length, 1);
  assert.equal(menu({ ...own, removal_action: 'retract' }).filter(label => label === 'Retract').length, 1);
  for (const item of [{ ...own, author_id: 'other' }, { ...own, removal_action: null },
    { ...own, removal: { kind: 'retracted', by: 'owner', at_ms: 10 } }])
    assert.equal(menu(item).some(label => ['Unsend', 'Retract'].includes(label)), false);
  assert.equal(menu(own, 'agent').some(label => ['Unsend', 'Retract'].includes(label)), false);
});

test('unknown removal retries its exact operation and stale Unsend only offers a new Retract', async () => {
  const requests = [], learned = [], says = [], refreshed = [];
  let reply = null;
  const control = new removal.Removals({ api: { command: async request => {
    requests.push(structuredClone(request)); if (!reply) throw Error('lost response'); return reply;
  } }, instanceId: 'fixture', authority: () => ({ authority_id: 'authority', authority_epoch: 'epoch' }),
  learned: value => learned.push(value), say: words => says.push(words), refresh: item => refreshed.push(item.id) });
  const item = { ...own };
  await control.remove(item);
  assert.match(says.at(-1), /unknown.*Press Unsend again/);
  reply = { status: 'rejected', recorded: false, error: { code: 'MESSAGE_SEEN', message: 'Seen: you can retract it instead.' } };
  await control.remove(item);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests.length, 2, 'a refusal never silently retracts');
  assert.deepEqual(learned, []); assert.deepEqual(refreshed, ['message']);
  assert.equal(item.removal_action, 'retract');
  assert.equal(control.pending.size, 0);
  reply = { status: 'committed', result: { message_id: item.id, removal: { kind: 'retracted', by: 'owner', at_ms: 123 } } };
  await control.remove(item);
  assert.equal(requests[2].kind, 'message.retract');
  assert.notEqual(requests[2].operation_id, requests[1].operation_id);
  assert.deepEqual(learned, [reply.result]);
});

test('pending removal serializes presses and a result from an old page paints nothing', async () => {
  let current = true, finish;
  const learned = [], requests = [];
  const control = new removal.Removals({ api: { command: request => {
    requests.push(request); return new Promise(resolve => { finish = resolve; });
  } }, instanceId: 'fixture', authority: () => ({}), current: () => current, learned: x => learned.push(x) });
  const pending = control.remove({ ...own });
  assert.equal(await control.remove({ ...own }), null);
  assert.equal(requests.length, 1);
  current = false;
  finish({ status: 'committed', result: { message_id: own.id, removal: { kind: 'unsent', by: 'owner', at_ms: 123 } } });
  await pending;
  assert.deepEqual(learned, []);
  assert.equal(control.busy.size, 0);
});

test('old pages and late edits never revive an unsent message or clear Retracted', () => {
  const views = new TopicViews({ instanceId: 'fixture', topicId: 'topic' });
  const item = { ...own, seq: 1, body: 'Original words', revision: 1, removal: null };
  const page = entry => ({ instance_id: 'fixture', items: [entry], next_cursor: null, relevant_versions: { topic: 1 } });
  views.messagesPage(page({ ...item }), { initial: true });
  views.learnRemoval(item.id, { kind: 'unsent', by: 'owner', at_ms: 123 });
  views.messagesPage(page({ ...item }), { initial: true });
  assert.equal(views.messages.has(item.id), false);
  assert.equal(views.learnRevision({ ...item, revision: 2, body: 'Earlier edit read late' }), false);
  const other = { ...item, id: 'other', seq: 2, go_ahead: true, blocks: 'piece', no_answer: true, awaiting_reply: true, no_agent_notified: true };
  views.messagesPage(page({ ...other }), { initial: true });
  const removed = { kind: 'retracted', by: 'owner', at_ms: 456 };
  views.learnRemoval(other.id, removed);
  views.messagesPage(page({ ...other }), { initial: true });
  assert.deepEqual(views.messages.get(other.id).removal, removed);
  assert.equal(views.messages.get(other.id).removal_action, null);
  for (const key of ['go_ahead', 'no_answer', 'awaiting_reply', 'no_agent_notified']) assert.equal(views.messages.get(other.id)[key], false, key);
  assert.equal(views.messages.get(other.id).blocks, null);
  assert.equal(views.learnQuoted({ ...item, revision: 2 }), false);
  assert.equal(views.showAlone(item.id, item.seq), false);
});

test('a Starred page arriving after Unsend cannot put its removed dossier back', async () => {
  const views = new TopicViews({ instanceId: 'fixture', topicId: 'topic' });
  let finish;
  const pending = views.readStarred(() => new Promise(resolve => { finish = resolve; }), () => true);
  views.learnRemoval('message', { kind: 'unsent', by: 'owner', at_ms: 123 });
  finish({ instance_id: 'fixture', items: [{ topic_id: 'topic', message_id: 'message', dossier: { id: 'message' }, star: 1 }], next_cursor: null });
  assert.equal(await pending, true);
  assert.equal(views.starRoots.has('message'), false);
});

test('Retraction keeps original words, shows its act time once and ceases to offer a decision', () => {
  const doc = miniDocument(), line = doc.createElement('span');
  const item = { ...own, body: 'Original words', go_ahead: true, addressees: ['reader'], removal: { kind: 'retracted', by: 'owner', at_ms: 123 } };
  removal.paintRemoval(line, item, doc, true); removal.paintRemoval(line, item, doc, true);
  assert.equal(line.querySelectorAll('.message-retracted').length, 1);
  assert.match(line.text, /^Retracted/);
  assert.equal(line.querySelector('time').dataset.ms, '123');
  assert.equal(item.body, 'Original words');
  assert.equal(mayAnswer(item, 'reader', 'human'), false);
});

test('late removal updates only its source and keeps newer private writing', () => {
  const start = app.indexOf('function learnMessageRemoval('), end = app.indexOf('// Who may edit', start);
  assert.ok(start >= 0 && end > start);
  const source = { source_ref: { kind: 'message', id: 'other' }, body: 'Other source' };
  const writing = { body: 'My newer private reply' }, registry = { current: { source, editors: { reply: writing } } };
  const removed = [], painted = [], decisions = [];
  const views = { learnRemoval: (...args) => removed.push(args), messages: new Map() };
  const learned = runInNewContext('(' + app.slice(start, end).trim() + ')', {
    views, dossierHeads: null, feedMessages: () => views.messages, messageEntries: new Map(), cardIn: () => null,
    clearVisitNew() {}, registry, menu: { paint() {} }, reader: { paintOrigin: item => painted.push(item) },
    paintReaderThumb$: () => decisions.push(source.source_ref.id),
  });
  const removalValue = { kind: 'retracted', by: 'owner', at_ms: 123 };
  learned({ message_id: 'message', removal: removalValue });
  assert.deepEqual(removed, [['message', removalValue]]);
  assert.equal(source.removal, undefined); assert.deepEqual(painted, []);
  assert.deepEqual(decisions, []);
  assert.equal(writing.body, 'My newer private reply');
  source.source_ref.id = 'message'; learned({ message_id: 'message', removal: removalValue });
  assert.deepEqual(source.removal, removalValue); assert.deepEqual(painted, [source]);
  assert.deepEqual(decisions, ['message'], 'the current Reader immediately removes its old decision buttons');
  assert.equal(writing.body, 'My newer private reply');
});

test('a folded message keeps its words visibly retracted and the act time through repaint', () => {
  const doc = miniDocument(), make = doc.createElement;
  doc.createElement = tag => Object.assign(make(tag), { ownerDocument: doc });
  const card = doc.createElement('article');
  const item = { ...own, body: 'Original folded words', addressees: ['other'], removal: { kind: 'retracted', by: 'owner', at_ms: 123 } };
  const fold = foldCard(card, item, doc);
  paintFoldWords(fold, item);
  assert.equal(fold.querySelector('.fold-words').classList.contains('retracted-words'), true);
  assert.equal(fold.querySelectorAll('.message-retracted').length, 1);
  assert.equal(fold.querySelector('time').dataset.ms, '123');
  assert.match(fold.text, /Original folded words/);
});

test('a terminal refresh handles both thrown and returned source denial but propagates transient failures', async () => {
  assert.equal(typeof removal.readRemoval, 'function');
  for (const read of [async () => ({ error: { code: 'FORBIDDEN' } }), async () => { throw { details: { error: { code: 'FORBIDDEN' } } }; }])
    assert.deepEqual(await removal.readRemoval(read, 'message'), { kind: 'unsent' });
  await assert.rejects(removal.readRemoval(async () => { throw Object.assign(Error('busy'), { code: 'DATABASE_BUSY' }); }, 'message'), /busy/);
  const act = { kind: 'retracted', by: 'owner', at_ms: 123 };
  assert.deepEqual(await removal.readRemoval(async () => ({ removal: act }), 'message'), act);
});

test('the surviving outline Starred owner shows the original excerpt, Retracted and the act time', () => {
  const doc = miniDocument(), act = { kind: 'retracted', by: 'owner', at_ms: 123 };
  const star = { message_id: 'message', author_id: 'owner', topic_id: 'topic', workspace_id: 'workspace',
    excerpt: 'Original starred words', star_revision: 1, removal: act,
    dossier: { id: 'message', body: 'Original starred words', name: '', removal: act } };
  const opened = [], outline = { doc, open: (...args) => opened.push(args) }, state = { id: 'topic', stars: [star], links: new Map(), box: doc.createElement('div'), next: null, loaded: true };
  OutlineDossiers.prototype.paint.call({ outline, pageStars: false }, state);
  const link = state.links.get('message'), href = link.href;
  link.focus();
  OutlineDossiers.prototype.paint.call({ outline, pageStars: false }, state);
  assert.equal(state.links.get('message'), link, 'repaint keeps the link identity');
  assert.equal(doc.activeElement, link, 'repaint keeps focus on that link');
  assert.equal(link.href, href);
  let prevented = false;
  link.onclick({ button: 0, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(opened, [[{ kind: 'topic', id: 'topic', message: 'message', land: true }, 'Original starred words']]);
  for (const host of [state.box]) {
    assert.match(host.text, /Original starred words/);
    assert.equal(host.querySelectorAll('.message-retracted').length, 1);
    assert.equal(host.querySelector('time').dataset.ms, '123');
    assert.match(host.querySelector('.retracted-words').text, /Original starred words/);
    for (const node of [host.querySelector('.message-retracted'), host.querySelector('time')])
      assert.equal(node.closest('.retracted-words'), null, 'terminal label and time have no struck/dimmed ancestor');
  }
});
