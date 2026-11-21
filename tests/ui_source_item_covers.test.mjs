// Focused mapping/freshness controls. No browser, gestures or measured layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { coverSheet, coverPills, coverKey, coverSummary } from '../web/dossier-cover.mjs';
import { laterActs, laterPosition, stackCover, compareCoverReads } from '../web/stack-order.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { Freshness } from '../web/freshness.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
import { configureCoverRefresh, firstCoverTarget, firstCoverMenuItem } from '../web/cover-refresh.mjs';
const context = { viewer: 'owner', nameOf: id => id, topicId: 't1' };
const rows = [{ workspace_id: 'w1', number: 1, title: 'Make the reader clearer', state: 'Build', sources: ['actual-source'], piece_id: 'actual-piece' },
  { workspace_id: 'w1', number: 2, title: 'Speed up the feed', state: 'Review', sources: ['actual-source'], piece_id: 'second-piece' }];
const cover = { stands: 'Cabin is booked', payload: { text: 'Cabin decision', message_id: 'actual-source', seq: 7, done: null },
  waiting: [{ text: 'Choose the cabin', default: 'Keep the current booking' }], owner: 'owner', items: rows,
  refresh: null, refresh_revision: 0 };
const of = (node, cls) => [...node.descendants()].filter(node => node.classList.contains(cls));
const href = node => node.href ?? node.getAttribute('href');

test('757 generated-only rows keep first-cover header menu and sheet controls', t => {
  const doc = miniDocument(), create = doc.createElement, storage = new Map();
  doc.createElement = tag => {
    const node = create(tag); node.style = {};
    node.contains = other => { for (let at = other; at; at = at.parent) if (at === node) return true; return false; };
    return node;
  };
  const host = doc.createElement('div'); host.root = true;
  doc.querySelectorAll = selector => host.querySelectorAll(selector);
  doc.defaultView = { localStorage: { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  configureCoverRefresh(() => ({ bootstrap: { instance_id: '757-first-' + t.name, actor: 'owner', authority: { authority_id: 'a', authority_epoch: 1 } }, api: {}, changed() {} }));
  t.after(() => configureCoverRefresh(null));
  const generated = { ...cover, stands: null, payload: null, by: null, root_id: 'root', revision: 0, waiting: [] };
  const stack = { id: 'root', dossier: 'root', head: { id: 'root', topic_id: 't1', acts: { cover: generated, cover_revision: 0 } }, replies: [] };
  assert.equal(firstCoverTarget(stack)?.first, true, 'an item row is not an authored cover');
  assert.equal(firstCoverMenuItem(doc, stack)?.label, 'Ask for a cover');
  const sheet = coverSheet(doc, generated, context); host.append(sheet);
  assert.equal(sheet.querySelector('.cover-refresh-glyph')?.title, 'Ask for a cover');
  const pending = { ...generated, refresh_revision: 1, refresh: { state: 'pending', request_id: 'request757', recipient: 'writer', by: 'owner', at_ms: 1795240000000 } };
  const asked = coverSheet(doc, pending, context); host.append(asked);
  assert.equal(asked.querySelector('.cover-refresh-glyph')?.title, 'Asked writer to write a cover');
  assert.ok(asked.text.includes('owner asked writer to write a cover'), 'the visible footer agrees with the first-cover control');
});

test('757 an answer without a cover clock clears the former root projection after a join', () => {
  const known = { cover, cover_revision: 0, cover_read_seq: [8, 20, 40] };
  const joined = { cover: null, cover_revision: 0, joined: { into: 'other-root' }, join_revision: 1 };
  const answer = laterActs(known, joined);
  assert.equal(answer.cover, null);
  assert.equal(answer.cover_read_seq, undefined);
});

test('757 sheet preserves manual lines before and after two independently linked item rows', () => {
  const sheet = coverSheet(miniDocument(), cover, context);
  assert.deepEqual(sheet.children.map(n => n.className), ['cover-line cover-heading', 'cover-line cover-payload', 'cover-line cover-item', 'cover-line cover-item', 'cover-line cover-wait']);
  assert.deepEqual(of(sheet, 'cover-item').map(n => n.text), ['Make the reader clearer · Build', 'Speed up the feed · Review']);
  assert.deepEqual(of(sheet, 'cover-item').map(n => href(n.querySelector('a'))), ['?pipeline=w1&item=1', '?pipeline=w1&item=2']);
  assert.ok(sheet.text.includes('Cabin is booked'));
  assert.ok(sheet.text.includes('Cabin decision'));
  assert.ok(sheet.text.includes('Choose the cabin'));
  assert.ok(sheet.text.includes('Default: Keep the current booking.'));
  assert.equal(of(sheet, 'cover-src').length, 1, 'only the actual manual payload has a message citation');
});

test('757 singleton and Reader summary retain separate rows without inventing payload acceptance', () => {
  const pills = coverPills(miniDocument(), cover, context);
  assert.equal(of(pills, 'cover-item').length, 2);
  assert.deepEqual(pills.children.map(n => n.className), ['row-pill pill-payload', 'cover-item', 'cover-item', 'row-pill pill-waits'], 'singleton keeps generated rows before manual waits');
  assert.equal(of(pills, 'pill-payload').length, 1);
  const generated = { ...cover, stands: null, payload: null, waiting: [] };
  assert.equal(coverSummary(generated), 'Make the reader clearer · Build; Speed up the feed · Review');
  assert.equal(of(coverPills(miniDocument(), generated, context), 'pill-payload').length, 0);
  const newer = { ...cover, items: [rows[0], { ...rows[1], state: 'Wait' }] };
  assert.notEqual(coverKey(cover, context), coverKey(newer, context), 'stage change redraws the cover');
});

test('757 newer projected positions draw rows even with no cover act and refuse late snapshots', () => {
  const position = { root_id: 'root', cover, cover_revision: 0, cover_read_seq: 9, at: { acts: 0, messages: 0 } };
  const stale = { ...position, cover: null, cover_read_seq: 8 };
  const head = { id: 'root', acts: { cover: null, cover_revision: 0, cover_read_seq: 8 }, stack_position: position };
  assert.equal(stackCover({ head, replies: [{}] }), cover);
  assert.equal(stackCover({ head, replies: [] }, { alone: true }), cover);
  assert.equal(laterPosition(position, stale), position, 'late position cannot erase newer generated rows');
  const acts = { cover, cover_revision: 0, cover_read_seq: 9 };
  assert.deepEqual(laterActs(acts, { cover: null, cover_revision: 0, cover_read_seq: 8 }).cover, cover);
  const views = new TopicViews({ instanceId: 'synthetic', topicId: 't1', reader: 'owner' });
  views.messages.set('root', { ...head, stack_position: stale });
  assert.equal(views.learnPositions([{ message_id: 'root', stack_position: position }]), true, 'generated-only change paints the cover');
});

test('757 opaque source-cover change refreshes only this loaded topic and forces equal-version rereads', async () => {
  // Exercise the real scoped actor-change consumer, with a normal bounded
  // response and no handler/event synthesis. UI-only synthetic identities.
  const bootstrap = { instance_id: 'synthetic', actor: 'owner', authority: { authority_id: 'a', authority_epoch: 'e' } };
  const scope = { kind: 'actor', id: 'owner' };
  const checkpoint = after_seq => ({ v: 1, kind: 'checkpoint', instance_id: 'synthetic', actor_id: 'owner', authority_id: 'a', authority_epoch: 'e', scope, after_seq });
  const f = new Freshness({ bootstrap, topicId: 't1', checkpoint: { after_seq: 4 }, actorCheckpoint: checkpoint(1) });
  const invalidated = [];
  f.invalidate = (...args) => invalidated.push(args);
  await f.readWhispers(async () => ({ instance_id: 'synthetic', scope, items: [
    { resource_kind: 'source_cover', resource_id: 'elsewhere', version: 1 },
    { resource_kind: 'source_cover', resource_id: 't1', version: 1 }], has_more: false, checkpoint: checkpoint(4) }), () => true);
  assert.deepEqual(invalidated, [['acts', 0, true]], 'only loaded relevant topic refreshes, even without a new cover act');
});


test('757 admitted cover clock orders real split shapes and decimal boundaries without dropping its fence', () => {
  const old = {root_id:'source',cover,cover_revision:1,cover_read_seq:[9,90,300],at:{acts:9,messages:0}};
  const split = {...old,cover:{...cover,items:[rows[0]]},cover_read_seq:[10,90,2],at:{acts:10,messages:0}};
  assert.equal(compareCoverReads(split.cover_read_seq,old.cover_read_seq),1,'later split wins with a smaller newest member sequence');
  assert.equal(laterPosition(old,split),split);
  assert.equal(laterPosition(split,old),split);
  assert.deepEqual(laterActs(split,old).cover,split.cover,'late joined rows cannot reappear after split');
  const lifecycle = {...split,cover:{...split.cover,items:[{...rows[0],state:'Review'}]},cover_read_seq:[10,100,2]};
  assert.equal(laterPosition(lifecycle,split),lifecycle,'numeric 100 follows 90, independent of string collation');
  assert.deepEqual(laterActs(lifecycle,split).cover,lifecycle.cover);
  assert.equal(stackCover({head:{id:'source',acts:split,stack_position:lifecycle},replies:[{}]}),lifecycle.cover);
});
