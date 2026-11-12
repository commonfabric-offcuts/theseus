// Waiting on you takes the reader to the question (item 148,
// docs/outcome-light.md): the oldest first, then each press the next, round
// to the oldest again; a question answered since drops out without moving the
// presses back to the start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionPresses, nextQuestion, oldestFirst, questionTarget } from '../web/waiting-questions.mjs';

const ask = (topic, ms, message = 'm-' + topic) => ({ topic_id: topic, ms, ...(message ? { message_id: message } : {}) });

test('the oldest question comes first, whatever order the server lists them in, and ties keep one order', () => {
  const newestFirst = [ask('t-c', 300), ask('t-b', 200), ask('t-a', 100)];
  assert.deepEqual(oldestFirst(newestFirst).map(q => q.topic_id), ['t-a', 't-b', 't-c']);
  assert.deepEqual(newestFirst.map(q => q.topic_id), ['t-c', 't-b', 't-a'], 'the list given is left as it was');
  assert.deepEqual(oldestFirst([ask('t-b', 100), ask('t-a', 100, 'm-2'), ask('t-a', 100, 'm-1')]).map(q => q.message_id), ['m-1', 'm-2', 'm-t-b']);
  assert.equal(nextQuestion([]), null);
  assert.equal(nextQuestion(null), null);
});

test('each press opens the next question, round to the oldest after the newest; places keep their own presses', () => {
  const presses = new QuestionPresses(), asks = [ask('t-new', 300), ask('t-mid', 200), ask('t-old', 100)];
  assert.deepEqual([1, 2, 3, 4].map(() => presses.next('outcome:w1', asks).topic_id), ['t-old', 't-mid', 't-new', 't-old']);
  assert.equal(presses.next('outcome:w2', asks).topic_id, 't-old', 'another place starts at its own oldest');
  // The question opened last is answered: the next press goes on to the one after it, not back to the start.
  assert.equal(presses.next('outcome:w1', asks).topic_id, 't-mid');
  assert.equal(presses.next('outcome:w1', [ask('t-new', 300), ask('t-old', 100)]).topic_id, 't-new');
  assert.equal(presses.next('outcome:w1', []), null, 'nothing waits');
  assert.equal(presses.next('outcome:w1', [ask('t-old', 100)]).topic_id, 't-old', 'after nothing waited, the press goes on from where it stood, round to the oldest');
});

test('a question opens at its message, and a wait said on the topic with no message opens the topic', () => {
  assert.deepEqual(questionTarget(ask('t-a', 1)), { kind: 'topic', id: 't-a', message: 'm-t-a' });
  assert.deepEqual(questionTarget(ask('t-a', 1, null)), { kind: 'topic', id: 't-a' });
});
