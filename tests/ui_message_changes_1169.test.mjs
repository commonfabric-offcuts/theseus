import test from 'node:test';
import assert from 'node:assert/strict';
import { CardScroll } from '../web/card-scroll.mjs';
import { MessageChanges, editChangeMark } from '../web/message-changes.mjs';
import { formatWords, drawPassages, redrawMessageWords, drawnText, drawnRevision, sourcePosition, rangeOf } from '../web/message-format.mjs';
import { constructCases, doc, walk, byClass, visible } from './message_changes_fixture_1169.mjs';

const cases = constructCases(CardScroll);
const positions = host => walk(host).filter(node => node.nodeType === 3)
  .filter(node => sourcePosition(node, 0) !== sourcePosition(node, node.data.length, true))
  .flatMap(node => Array.from({ length: node.data.length + 1 }, (_, k) => sourcePosition(node, k, k === node.data.length)))
  .filter((at, i, all) => i === 0 || at !== all[i - 1]);

test('1169 added marks cross bold and named links without moving quote positions', () => {
  const { host, plain } = cases[0], body = '**new** [words](https://example.com)';
  formatWords(plain, body);
  formatWords(host, body, { struck: { revision: 1, cuts: [{ at: 0, words: 'old' }], added: [{ start: 0, end: body.length }] } });
  assert.equal(visible(host), 'old new words');
  assert.equal(byClass(host, 'added-words').map(visible).join(''), 'new words');
  assert.deepEqual(positions(host), positions(plain));
  assert.equal(byClass(host, 'struck-words')[0].childNodes[0].textContent, 'removed: ');
  assert.ok(byClass(host, 'added-words').every(ins => ins.childNodes[0].textContent === 'added: '));
  const range = rangeOf(host, 0, body.length);
  assert.equal(body.slice(sourcePosition(...range.start), sourcePosition(...range.end, true)), body);
});

test('1169 Reader passages keep UTF16 positions and spans across added list words', () => {
  const { host, plain } = cases[1], body = '- 🚀 new\n- more words';
  drawPassages(plain, body, doc);
  drawPassages(host, body, doc, { struck: { revision: 1, cuts: [], added: [{ start: 5, end: body.length }] } });
  assert.deepEqual(host.childNodes.map(node => [node.dataset.start, node.dataset.end]), plain.childNodes.map(node => [node.dataset.start, node.dataset.end]));
  assert.deepEqual(positions(host), positions(plain));
  assert.ok(byClass(host, 'added-words').some(ins => visible(ins).includes('words')));
});

test('1169 hide and show redraw cached words with revision and source positions intact', () => {
  const { host, source } = cases[2];
  formatWords(host, source.body, { revision: 2, struck: source.struck, displayRules: [] });
  assert.equal(byClass(host, 'added-words').length, 1);
  redrawMessageWords(host, [], { showChanges: false });
  assert.equal(visible(host), source.body);
  assert.equal(byClass(host, 'added-words').length + byClass(host, 'struck-words').length, 0);
  assert.equal(drawnRevision(host), 2); assert.equal(drawnText(host), source.body);
  redrawMessageWords(host, [], { showChanges: true });
  assert.equal(visible(host), 'Before old new words after.');
  assert.equal(byClass(host, 'added-words').length, 1);
});

test('1169 hidden choice survives reload, isolates identity and resets for a later revision', () => {
  const { storage } = cases[3], choice = new MessageChanges('instance', 'reader', storage);
  assert.equal(choice.shown('m', 2), true); choice.toggle('m', 2);
  assert.equal(new MessageChanges('instance', 'reader', storage).shown('m', 2), false);
  assert.equal(choice.shown('m', 3), true);
  assert.equal(choice.shown('another-message', 2), true);
  assert.equal(new MessageChanges('instance', 'another-reader', storage).shown('m', 2), true);
  assert.equal(new MessageChanges('another-instance', 'reader', storage).shown('m', 2), true);
  const unavailable = new MessageChanges('instance', 'reader', { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } });
  unavailable.toggle('m', 2); assert.equal(unavailable.shown('m', 2), false);
});

test('1169 byline switch is keyboard-operable and stops enclosing card and quote actions', () => {
  const { host, source, storage, event } = cases[4], choice = new MessageChanges('instance', 'reader', storage);
  const mark = editChangeMark(doc, true, { struck: source.struck, shown: () => choice.shown('m', 2), toggle: () => choice.toggle('m', 2) });
  host.append(mark);
  const button = byClass(host, 'message-changes-toggle')[0];
  assert.equal(byClass(button, 'message-changes-glyph')[0].textContent, '✓');
  assert.equal(button.attributes.role, 'button');
  assert.equal(button.title, 'Accept changes');
  assert.equal(button.attributes['aria-label'], 'Accept changes');
  assert.equal(button.attributes['aria-pressed'], 'false');
  button.onkeydown(event);
  assert.equal(button.title, 'Show changes');
  assert.equal(button.attributes['aria-label'], 'Show changes');
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.deepEqual([event.prevented, event.stopped], [1, 1]);
  assert.equal(byClass(editChangeMark(doc, true), 'message-changes-toggle').length, 0);
  assert.equal(editChangeMark(doc, false), null);
});

test('1169 full-source cache keeps additions beyond an excerpt and respects the hidden revision', async () => {
  const { card, preview, source, owner } = cases[5];
  const item = { id: 'm', revision: 2, body: 'Before', preview: true, struck: null };
  assert.equal(await owner.showFull(card, item), true);
  assert.equal(byClass(preview, 'added-words').length, 1);
  assert.deepEqual(owner.strikes.get('m'), source.struck);
  owner.changes = { shown: () => false };
  assert.equal(await owner.showFull(card, item), true);
  assert.equal(visible(preview), source.body);
  assert.equal(byClass(preview, 'added-words').length + byClass(preview, 'struck-words').length, 0);
  owner.forget('m'); assert.equal(owner.strikes.has('m'), false);
});
