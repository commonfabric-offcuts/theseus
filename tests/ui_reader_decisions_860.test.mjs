// Reader and card rendering below the browser; no native gesture or layout claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paintReactions, paintReaderReactions, paintReaderThumb } from '../web/reactions.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';
const reactions = more => ({ version: 3, thumbs: [], answers: [], thumb_revision: 1, answer_revision: 2, ...more });
const ask = more => ({ id: 'ask860', author_id: 'builder', go_ahead: true, addressees: ['reader', 'another'], reactions: reactions(), ...more });
const fixture = () => { const doc = miniDocument(), line = doc.createElement('p'), card = doc.createElement('button'); line.ownerDocument = doc; return { doc, line, card }; };
const choices = line => line.children.filter(child => ['yes', 'no'].includes(child.dataset.react));
const said = line => line.children.find(child => child.className === 'reaction-said')?.text ?? '';

test('860 Reader offers actual decision buttons with the same selected and other answers as a card', () => {
  const { doc, line, card } = fixture(), calls = [];
  const item = ask({ reactions: reactions({ answers: [{ actor_id: 'reader', answer: 'no' }, { actor_id: 'another', answer: 'yes' }] }) });
  paintReaderReactions(line, item, 'reader', 'human', { answer: (...args) => calls.push(args) });
  paintReactions(card, item, 'reader', 'human', doc);
  assert.equal(line.hidden, false);
  assert.deepEqual(choices(line).map(button => [button.tagName, button.type, button.text, button.getAttribute('aria-pressed')]),
    [['BUTTON', 'button', '✅ Go ahead', 'false'], ['BUTTON', 'button', "🚫 Don't", 'true']]);
  assert.deepEqual(choices(line).map(button => [button.dataset.react, button.classList.contains('mine')]),
    choices(card.querySelector(':scope > .message-reactions')).map(part => [part.dataset.react, part.classList.contains('mine')]));
  assert.equal(said(line), '✅ another'); choices(line)[0].onclick(); assert.deepEqual(calls, [['ask860', 'yes']]);
});

test('860 Reader preserves thumb count, names, and the separate own thumb button', () => {
  const { doc, line } = fixture(), thumb = doc.createElement('button');
  const item = ask({ reactions: reactions({ thumbs: [{ actor_id: 'reader' }, { actor_id: 'another' }] }) });
  paintReaderReactions(line, item, 'reader', 'human'); paintReaderThumb(thumb, item, 'reader');
  assert.match(line.text, /👍 2 you, another/); assert.equal(line.title, '👍 you, another: read and understood');
  assert.equal(choices(line).length, 2); assert.equal(thumb.hidden, false); assert.equal(thumb.getAttribute('aria-pressed'), 'true');
  paintReaderReactions(line, ask(), 'reader', 'human');
  assert.doesNotMatch(line.text, /👍/); assert.equal(line.getAttribute('title'), null);
});

test('860 Reader and card share outsider, agent, Tell, withdrawal and prior-answer rules', () => {
  for (const [item, viewer, kind, expected] of [
    [ask(), 'outsider', 'human', 'Asks for a go-ahead'], [ask(), 'reader', 'agent', 'Asks for a go-ahead'],
    [ask({ go_ahead: false }), 'reader', 'human', ''], [ask({ withdrawal: { reason: 'Superseded' } }), 'reader', 'human', ''],
    [ask({ withdrawal: { reason: 'Superseded' }, reactions: reactions({ answers: [{ actor_id: 'reader', answer: 'no' }] }) }), 'reader', 'human', '🚫 you'],
  ]) {
    const { doc, line, card } = fixture();
    paintReaderReactions(line, item, viewer, kind); paintReactions(card, item, viewer, kind, doc);
    assert.equal(choices(line).length, 0); assert.equal(said(line), expected);
    assert.equal(said(card.querySelector(':scope > .message-reactions') ?? { children: [] }), expected);
    assert.equal(line.hidden, expected === '');
  }
});

test('860 Reader disables pending decisions and clears controls for a non-message source', () => {
  const { line } = fixture(); paintReaderReactions(line, ask(), 'reader', 'human', { busy: true });
  assert.equal(choices(line).length, 2); assert.ok(choices(line).every(button => button.disabled));
  paintReaderReactions(line, ask(), 'reader', 'human', { busy: false }); assert.ok(choices(line).every(button => !button.disabled));
  paintReaderReactions(line, null, 'reader', 'human'); assert.equal(line.hidden, true); assert.equal(line.children.length, 0);
});
