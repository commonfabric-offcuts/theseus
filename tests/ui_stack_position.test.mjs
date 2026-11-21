import test from 'node:test';
import assert from 'node:assert/strict';
import { laterPosition, positionOf } from '../web/stack-order.mjs';
import { TopicViews } from '../web/topic-views.mjs';
const position = (messages, acts, extra = {}) => ({ root_id:'root', through:4, aside_revision:1, below:true, at:{messages,acts}, ...extra });
test('cover revisions and unloaded dossier stars each refresh partial stacks without stale reads reversing either', () => {
  const views = new TopicViews({ instanceId:'i', topicId:'t' });
  const cover = { stands:'Materials chosen', waiting:[], payload:null };
  const start = position(4,1,{ below:false, cover, cover_revision:1, starred:[] });
  for (const id of ['reply-a', 'reply-b']) views.messages.set(id, { id, stack_position:start });
  const stars = position(4,2,{ ...start, at:{messages:4,acts:2}, starred:['unloaded-root'] });
  assert.equal(views.learnPositions([{ message_id:'reply-a', stack_position:stars }]), true, 'a star alone refreshes the title bar');
  const changed = { ...stars, at:{messages:4,acts:3}, cover:{ ...cover, stands:'Roof repaired' }, cover_revision:2 };
  assert.equal(views.learnPositions([{ message_id:'reply-b', stack_position:changed }]), true, 'a cover alone refreshes the sheet');
  assert.equal(views.learnPositions([{ message_id:'reply-a', stack_position:start }]), false, 'an old page reverses neither');
  for (const id of ['reply-a', 'reply-b']) assert.deepEqual(views.messages.get(id).stack_position, changed);
  const later = { ...changed, at:{messages:4,acts:4} };
  assert.equal(views.learnPositions([{ message_id:'reply-a', stack_position:later }]), false, 'a watermark alone redraws nothing');
});
test('an old page cannot hide a revived dossier or undo a newer join', () => {
  const revived = position(8,2,{below:false});
  assert.equal(laterPosition(revived, position(7,2)), revived);
  const joined = position(8,3,{root_id:'new-root',below:false});
  assert.equal(laterPosition(joined, position(9,2)), joined);
  assert.equal(laterPosition(joined, position(8,4,{through:8})).below, true);
});
test('a split read later wins though it leaves the dossier fewer messages, and an older read never does', () => {
  // `at.messages` is the dossier's newest message, so a split that takes replies away lowers it in a later act.
  const joined = position(9,3,{below:false});
  const split = position(5,4,{below:true});
  assert.equal(laterPosition(joined, split), split);
  assert.equal(laterPosition(split, joined), split);
  assert.equal(positionOf({head:{id:'root',stack_position:joined},replies:[{id:'r',stack_position:split}]}), split);
});
test('a new reply updates every loaded fragment of its dossier but no unrelated one', () => {
  const views = new TopicViews({ instanceId:'i', topicId:'t' });
  views.messages.set('a',{id:'a',reply_to:'root',stack_position:position(4,1)});
  views.messages.set('b',{id:'b',reply_to:'root',stack_position:position(4,1)});
  views.messages.set('c',{id:'c',stack_position:position(4,1,{root_id:'other'})});
  views.learnPositions([{message_id:'b',stack_position:position(5,1,{below:false})}]);
  assert.equal(views.messages.get('a').stack_position.below,false);
  assert.equal(views.messages.get('c').stack_position.below,true);
  views.learnPositions([{message_id:'a',stack_position:position(4,1)}]);
  assert.equal(views.messages.get('a').stack_position.below,false);
  assert.equal(positionOf({head:views.messages.get('a'),replies:[views.messages.get('b')]}).below,false);
});
// Item 470: the page reads positions again after a split, old's messages still carrying the dossier they left. The
// dossier it left, put aside, reads as having a newer message than old: its row, read first, never places old's.
test('a read of positions is the word on each message it reads: a dossier sharing a stale root never places another read in the same answer', () => {
  const views = new TopicViews({ instanceId:'i', topicId:'t' });
  for (const id of ['root', 'o', 'o1']) views.messages.set(id, { id, stack_position: position(9,5) });
  const own = position(0,6,{ root_id:'o', below:false, through:null, aside_revision:0 });
  views.learnPositions([{ message_id:'root', stack_position: position(9,6) }, { message_id:'o', stack_position: own }, { message_id:'o1', stack_position: own }]);
  assert.deepEqual(['root', 'o', 'o1'].map(id => views.messages.get(id).stack_position.root_id), ['root', 'o', 'o'], 'each message as its own row reads it');
  // The negative: a message the answer did not read still takes its dossier's newer read.
  views.messages.set('r', { id:'r', stack_position: position(9,5) });
  views.learnPositions([{ message_id:'root', stack_position: position(9,7) }]);
  assert.deepEqual(views.messages.get('r').stack_position.at, { messages:9, acts:7 }, 'an unread fragment of the dossier follows it');
});
test('an act that moves nothing about where a dossier sits reports no position change and draws nothing again; a move still does', async () => {
  // Each act in the topic raises at.acts in every position Core answers. The page keeps the later read, but only
  // what places a dossier is a change: its first message, through, below and aside revision. A full repaint for
  // a later snapshot of the same place lands under a finger held on the page and replaces what it pressed.
  const painted = [];
  const views = new TopicViews({ instanceId:'i', topicId:'t', paint: kind => painted.push(kind) });
  for (const id of ['a', 'b']) views.messages.set(id, { id, seq: id === 'a' ? 1 : 2, acts: {}, stack_position: position(4,1) });
  views.messages.set('c', { id:'c', seq:3, acts:{}, stack_position: position(0,1,{root_id:'other',below:false,through:null,aside_revision:0}) });
  let answer = null;
  const read = async (name, args) => name === 'message_acts' ? { instance_id:'i', topic_id:'t', version: 9, next_cursor: null, items: [] }
    : { instance_id:'i', topic_id:'t', items: args.message_ids.map(message_id => ({ message_id, stack_position: answer(message_id) })) };
  // An act elsewhere in the topic, on no loaded message: every position is read again at a later snapshot.
  answer = id => id === 'c' ? position(0,9,{root_id:'other',below:false,through:null,aside_revision:0}) : position(4,9);
  await views.readActs(9, read, () => true);
  assert.deepEqual(painted, [], 'an act that moves no dossier draws no stack again');
  assert.deepEqual(views.messages.get('a').stack_position.at, { messages: 4, acts: 9 }, 'the later read is still kept');
  assert.equal(views.learnPositions([{ message_id:'a', stack_position: position(4,10) }]), false, 'a later snapshot of the same place is no change');
  assert.deepEqual(views.messages.get('b').stack_position.at, { messages: 4, acts: 10 }, 'and it reaches every loaded message of the dossier');
  // The negative: each thing that places a dossier, changed by a later read, is a change.
  for (const [what, moved] of [['below', { below:false }], ['aside revision', { aside_revision:2 }], ['through', { through:6 }], ['first message', { root_id:'joined' }], ['dossier name (item 470)', { name:{ text:'Named', by:'owner', at_ms:1 }, name_revision:1 }],
    ['reader\'s place for it (item 550)', { placed:2.5, place_revision:1 }],
    ['dossier cover (item 624)', { cover:{ stands:'Answered', waiting:[], payload:null, by:'agent', at_ms:1, owner:'owner' }, cover_revision:1 }]]) {
    const other = new TopicViews({ instanceId:'i', topicId:'t' });
    other.messages.set('a', { id:'a', stack_position: position(4,9) });
    assert.equal(other.learnPositions([{ message_id:'a', stack_position: position(4,10,moved) }]), true, `a changed ${what} is a change`);
  }
  const fresh = new TopicViews({ instanceId:'i', topicId:'t' });
  fresh.messages.set('a', { id:'a' });
  assert.equal(fresh.learnPositions([{ message_id:'a', stack_position: position(4,1) }]), true, 'a first position is a change');
  // Bring back on another device: the page draws the stacks again.
  answer = id => id === 'c' ? position(0,11,{root_id:'other',below:false,through:null,aside_revision:0}) : position(4,11,{below:false,through:null,aside_revision:2});
  await views.readActs(9, read, () => true);
  assert.deepEqual(painted, ['acts'], 'Bring back on another device draws the stacks again');
});
// Item 426: the Reader's neighbours beyond the loaded page carry Core's place for their dossier, which another
// device's Move below More or Bring back moves with no change to the topic. An acts read that reaches a later act asks
// for them again, afresh, even when reading the places after it fails; one that reaches no later act, or is overtaken
// (no longer current), asks for nothing, so neighbours already resolved stand.
test('an acts read reaching a later act asks for the Reader\'s neighbours afresh, though reading the places fails; one at the same act or overtaken does not', async () => {
  const asked = [];
  const views = new TopicViews({ instanceId:'i', topicId:'t', invalidate: (...args) => asked.push(args) });
  views.messages.set('a', { id:'a', seq:1, acts:{}, stack_position: position(4,1) });
  const acts = { instance_id:'i', topic_id:'t', version: 7, next_cursor: null, items: [] };
  await views.readActs(7, async (name, args) => name === 'message_acts' ? acts : { instance_id:'i', topic_id:'t', items: args.message_ids.map(message_id => ({ message_id, stack_position: position(4,7) })) }, () => true);
  assert.deepEqual(asked, [['neighbors', 7, true]], 'an acts read with no change on the page still asks for the neighbours afresh');
  await assert.rejects(views.readActs(8, async name => { if (name === 'message_acts') return { ...acts, version: 8 }; throw Object.assign(Error('Freshness read was superseded.'), { code: 'CLEANUP_DEFERRED' }); }, () => true), /superseded/);
  assert.deepEqual(asked.at(-1), ['neighbors', 8, true], 'and when reading the places fails');
  await views.readActs(8, async (name, args) => name === 'message_acts' ? { ...acts, version: 8 } : { instance_id:'i', topic_id:'t', items: args.message_ids.map(message_id => ({ message_id, stack_position: position(4,8) })) }, () => true);
  await views.readActs(5, async (name, args) => name === 'message_acts' ? { ...acts, version: 8 } : { instance_id:'i', topic_id:'t', items: args.message_ids.map(message_id => ({ message_id, stack_position: position(4,8) })) }, () => true);
  assert.equal(asked.length, 2, 'an acts read reaching no later act asks for nothing: the neighbours resolved stand');
  let current = true;
  assert.equal(await views.readActs(9, async () => { current = false; return { ...acts, version: 9 }; }, () => current), false);
  assert.equal(asked.length, 2, 'a read overtaken asks for nothing');
});
// The first acts read after the page loads: each loaded message's position carries the act Core had reached when it
// read the page (at.acts), and the Reader's neighbours are read after the page. An acts read reaching only that act
// moves no dossier since, so it asks for nothing; one reaching a later act asks for the neighbours afresh.
test('the first acts read, reaching only the act the loaded page was read at, asks for no neighbours; a later act does', async () => {
  const asked = [];
  const views = new TopicViews({ instanceId:'i', topicId:'t', invalidate: (...args) => asked.push(args) });
  const item = (id, seq) => ({ id, seq, topic_id:'t', body:'Words', author_id:'agent-1', acts:{}, stack_position: position(4, 2, { root_id:id }) });
  views.messagesPage({ instance_id:'i', items:[item('a', 1), item('b', 2)], next_cursor:null, relevant_versions:{ topic:1 } }, { initial:true });
  const acts = version => ({ instance_id:'i', topic_id:'t', version, next_cursor:null, items:[] });
  const read = version => async (name, args) => name === 'message_acts' ? acts(version)
    : { instance_id:'i', topic_id:'t', items: args.message_ids.map(message_id => ({ message_id, stack_position: position(4, version, { root_id:message_id }) })) };
  await views.readActs(2, read(2), () => true);
  assert.deepEqual(asked, [], 'an acts read at the act the page was read at asks for nothing: the neighbours read since stand');
  await views.readActs(3, read(3), () => true);
  assert.deepEqual(asked, [['neighbors', 3, true]], 'a later act asks for the neighbours afresh');
});
test('the page\'s own fold, star or deal, the next act its reader heard of after the neighbours were read, asks for no neighbours; its own move, or one past an act it missed, does', async () => {
  const asked = [];
  const views = new TopicViews({ instanceId:'i', topicId:'t', invalidate: (...args) => asked.push(args) });
  const item = (id, seq) => ({ id, seq, topic_id:'t', body:'Words', author_id:'agent-1', acts:{}, stack_position: position(4, 2, { root_id:id }) });
  views.messagesPage({ instance_id:'i', items:[item('a', 1), item('b', 2)], next_cursor:null, relevant_versions:{ topic:1 } }, { initial:true });
  const read = version => async (name, args) => name === 'message_acts' ? { instance_id:'i', topic_id:'t', version, next_cursor:null, items:[] }
    : { instance_id:'i', topic_id:'t', items: args.message_ids.map(message_id => ({ message_id, stack_position: position(4, version, { root_id:message_id }) })) };
  for (const [kind, version] of [['message.fold', 3], ['message.star', 4], ['message.deal', 5]]) {
    views.ownAct(kind, { changed:true, acts_version:version, acts_before:version - 1 });
    await views.readActs(version, read(version), () => true);
  }
  assert.deepEqual(asked, [], 'the page\'s own fold, star and deal move no dossier: the neighbours read before them stand');
  views.ownAct('stack.place', { changed:true, acts_version:6, acts_before:5 });
  await views.readActs(6, read(6), () => true);
  assert.deepEqual(asked, [['neighbors', 6, true]], 'its own Move below More moves a dossier: the neighbours are asked for afresh');
  views.ownAct('message.fold', { changed:true, acts_version:8, acts_before:7 });
  await views.readActs(8, read(8), () => true);
  assert.deepEqual(asked, [['neighbors', 6, true], ['neighbors', 8, true]], 'act 7, which the neighbours were not read past, may have moved one');
  views.ownAct('message.fold', { changed:false });
  await views.readActs(9, read(9), () => true);
  assert.deepEqual(asked.at(-1), ['neighbors', 9, true], 'a fold that recorded nothing names no act, and act 9 is another\'s');
});
test('acts read again are drawn though reading the places after them fails, and places learned before a failing page are drawn too', async () => {
  // A freshness read can fail after the acts are learned (superseded, or deferred behind the page's own reads); the
  // next read then finds nothing new, so what the failed one learned must be drawn by it.
  const painted = [];
  const views = new TopicViews({ instanceId:'i', topicId:'t', paint: kind => painted.push(kind) });
  views.messages.set('a', { id:'a', seq:1, acts:{ folded:false, fold_revision:1 }, stack_position: position(4,1) });
  const superseded = () => Object.assign(Error('Freshness read was superseded.'), { code: 'CLEANUP_DEFERRED' });
  const read = async name => {
    if (name === 'message_acts') return { instance_id:'i', topic_id:'t', version: 2, next_cursor: null, items: [{ message_id:'a', seq:1, acts:{ folded:true, fold_revision:2 } }] };
    throw superseded();
  };
  await assert.rejects(views.readActs(2, read, () => true), /superseded/, 'the failure still reaches the freshness loop');
  assert.equal(views.messages.get('a').acts.folded, true, 'the fold is learned');
  assert.deepEqual(painted, ['acts'], 'and drawn, though reading the places failed');
  // The negative: read again with nothing new, it draws nothing.
  await views.readActs(2, async name => name === 'message_acts' ? { instance_id:'i', topic_id:'t', version: 2, next_cursor: null, items: [{ message_id:'a', seq:1, acts:{ folded:true, fold_revision:2 } }] }
    : { instance_id:'i', topic_id:'t', items: [{ message_id:'a', stack_position: position(4,3) }] }, () => true);
  assert.deepEqual(painted, ['acts'], 'a read that learns nothing new draws nothing');
  // 101 loaded messages take two pages of places: the first moves a dossier, the second fails.
  const many = new TopicViews({ instanceId:'i', topicId:'t', paint: kind => painted.push(kind) });
  for (let i = 0; i <= 100; i++) many.messages.set('m' + i, { id:'m' + i, seq:i + 1, stack_position: position(4,1,{ root_id:'m' + i }) });
  let pages = 0;
  await assert.rejects(many.readPositions(async (name, args) => {
    if (pages++) throw superseded();
    return { instance_id:'i', topic_id:'t', items: args.message_ids.map(message_id => ({ message_id, stack_position: position(4,2,{ root_id:message_id, below:false }) })) };
  }), /superseded/);
  assert.equal(many.messages.get('m0').stack_position.below, false, 'the first page\'s places are learned');
  assert.deepEqual(painted, ['acts', 'acts'], 'and drawn, though the second page failed');
});

// Queue42: item 635's star can move a dossier, unlike an ordinary item 426 star.
test('a star that brings its dossier back refreshes neighbours despite being the page own act', async () => {
  const asked = [];
  const views = new TopicViews({ instanceId:'i', topicId:'t', invalidate: (...args) => asked.push(args) });
  views.messages.set('a', { id:'a', seq:1, acts:{}, stack_position:position(4,2) });
  views.neighborsAt = 2;
  views.ownAct('message.star', { changed:true, acts_before:2, acts_version:4, brought_back:{ root_id:'root', aside_revision:2 } });
  await views.readActs(4, async (name, args) => name === 'message_acts'
    ? { instance_id:'i', topic_id:'t', version:4, next_cursor:null, items:[] }
    : { instance_id:'i', topic_id:'t', items:args.message_ids.map(message_id => ({ message_id, stack_position:position(4,4,{ through:null, below:false, aside_revision:2 }) })) }, () => true);
  assert.deepEqual(asked, [['neighbors', 4, true]], 'the star and Bring back moved the dossier: old neighbours cannot stand');
});

test('queue42 cover stars and both personal place shapes independently refresh partial dossier positions', () => {
  for (const delta of [{cover_revision:2}, {starred:['older-unloaded']}, {place_revision:2}, {places:[{message_id:'old',placed:2,place_revision:1,at_ms:5}]}]) {
    const views = new TopicViews({instanceId:'i',topicId:'t'});
    const start = position(4,1,{cover_revision:1,starred:[],place_revision:1,places:[]});
    for (const id of ['a','b']) views.messages.set(id,{id,stack_position:start});
    const changed = {...start,...delta,at:{messages:4,acts:2}};
    assert.equal(views.learnPositions([{message_id:'a',stack_position:changed}]),true,JSON.stringify(delta));
    assert.deepEqual(views.messages.get('b').stack_position,changed,'all fragments take the combined position');
    assert.equal(views.learnPositions([{message_id:'b',stack_position:start}]),false,'late input reverses none');
    assert.equal(views.learnPositions([{message_id:'a',stack_position:{...changed,at:{messages:4,acts:3}}}]),false,'a watermark alone redraws nothing');
  }
});

test('item 731 an order key refreshes every loaded branch and a stale page cannot reverse it', () => {
  const views = new TopicViews({instanceId:'i',topicId:'t'});
  const first = position(0,1,{below:false,order_key:5,order_tie:1,order_entry_key:5});
  for (const id of ['reply-a','reply-b']) views.messages.set(id,{id,stack_position:first});
  const moved = {...first,order_key:8,at:{messages:0,acts:2}};
  assert.equal(views.learnPositions([{message_id:'reply-a',stack_position:moved}]),true);
  for (const id of ['reply-a','reply-b']) assert.equal(views.messages.get(id).stack_position.order_key,8);
  assert.equal(views.learnPositions([{message_id:'reply-b',stack_position:first}]),false);
  const onlyKey = {...moved,order_key:9};
  assert.equal(views.learnPositions([{message_id:'reply-a',stack_position:onlyKey}]),true,'order data itself invalidates the arranged page');
});
