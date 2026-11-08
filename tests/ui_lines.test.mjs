// The page's lines work out from the failure they show whether it is about
// reaching Theseus, and only such a line goes when the page reaches Theseus
// again (web/lines.mjs, web/api.mjs unreached).
import test from 'node:test';
import assert from 'node:assert/strict';
import { AttemptError, unreached, sessionRefused } from '../web/api.mjs';
import { showLine, clearUnreached, lineText } from '../web/lines.mjs';

const lost = () => new AttemptError('Connection interrupted. Confirmation is unknown; your writing is kept.');
const refusedSession = () => new AttemptError('Open this instance to establish a session.', 401, { error: { code: 'SESSION_REQUIRED', message: 'Open this instance to establish a session.' } });
const element = () => ({ textContent: '', hidden: true, dataset: {}, children: [], append(...items) { this.children.push(...items); } });
const page = (...lines) => ({ querySelectorAll: selector => selector === '[data-unreached]' ? lines.filter(line => 'unreached' in line.dataset) : [] });

test('a failure is about reaching Theseus when nothing answered or the server refused this page\'s session, and not otherwise', () => {
  assert.equal(unreached(lost()), true, 'no answer');
  assert.equal(unreached(refusedSession()), true, 'a restarted server refused the session');
  assert.equal(sessionRefused(refusedSession()), true);
  assert.equal(unreached(new AttemptError('Refused.', 401, { error: { code: 'OTHER' } })), false, 'a 401 that is not the session');
  assert.equal(sessionRefused(new AttemptError('Refused.', 403, { error: { code: 'SESSION_REQUIRED' } })), false, 'the code alone is not a session refusal');
  assert.equal(unreached(new AttemptError('This topic is closed.', 409, { error: { code: 'CONFLICT' } })), false, 'Core answered');
  assert.equal(unreached(new AttemptError('AIM returned an unreadable response. Confirmation is unknown.', 502)), false, 'something answered');
  assert.equal(unreached(Object.assign(Error('Connection interrupted.'), { status: 0 })), false, 'only an attempt\'s own error says so');
  assert.equal(unreached({ code: 'CONNECTION_UNKNOWN', message: 'Connection interrupted.' }), false, 'a receipt\'s error is an answer');
});

test('a line that says only that Theseus could not be reached goes when the page reaches it; one that says more stays', () => {
  const status = element(), notice = element(), words = element(), refusal = element(), control = element(), button = { id: 'again' };
  showLine(status, lost());
  showLine(notice, refusedSession());
  showLine(words, ['What changed since revision 2 could not be read.', lost()]);
  showLine(refusal, new AttemptError('This topic is closed.', 409, { error: { code: 'CONFLICT' } }));
  showLine(control, [lost(), button]);
  assert.deepEqual([status.textContent, status.hidden], ['Connection interrupted. Confirmation is unknown; your writing is kept.', false]);
  assert.equal(words.textContent, 'What changed since revision 2 could not be read. Connection interrupted. Confirmation is unknown; your writing is kept.');
  assert.deepEqual(control.children, [' ', button], 'a control the line offers follows its words');
  clearUnreached(page(status, notice, words, refusal, control));
  assert.deepEqual([status, notice].map(line => [line.textContent, line.hidden, 'unreached' in line.dataset]), [['', true, false], ['', true, false]]);
  assert.deepEqual([words, refusal, control].map(line => line.hidden), [false, false, false], 'words of the page\'s own, a Core refusal and a control stay');
});

test('a line written again says what it says now: a connection line replaced by another stays, and an empty line is hidden', () => {
  const status = element();
  showLine(status, lost());
  showLine(status, 'This topic is closed.');
  clearUnreached(page(status));
  assert.deepEqual([status.textContent, status.hidden], ['This topic is closed.', false]);
  showLine(status, '');
  assert.deepEqual([status.textContent, status.hidden], ['', true]);
});

test('several failures are said once each, and go only when every one was about reaching Theseus', () => {
  const both = element(), mixed = element();
  showLine(both, [lost(), lost()]);
  assert.equal(both.textContent, lost().message);
  showLine(mixed, [lost(), new AttemptError('Image upload was refused.', 413)]);
  assert.equal(lineText([lost(), 'kept']), lost().message + ' kept');
  clearUnreached(page(both, mixed));
  assert.deepEqual([both.hidden, mixed.hidden], [true, false]);
});
