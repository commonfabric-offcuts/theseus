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

// A tab's sessionStorage, as a stand-in: what one page keeps, the next page in the tab reads.
class Tab {
  constructor() { this.items = new Map(); }
  getItem(key) { return this.items.has(key) ? this.items.get(key) : null; }
  setItem(key, value) { this.items.set(key, String(value)); }
  removeItem(key) { this.items.delete(key); }
}

test('the presses survive a page load in the same tab: each new page goes on from the question the last one opened', () => {
  const tab = new Tab(), asks = [ask('t-new', 300), ask('t-mid', 200), ask('t-old', 100, null)];
  // Each press is made by a page loaded afresh, as on the outcome's page, whose presses load the topic and Back loads it again.
  const pressed = place => new QuestionPresses(() => tab).next(place, asks)?.topic_id;
  assert.deepEqual([1, 2, 3, 4].map(() => pressed('outcome:w1')), ['t-old', 't-mid', 't-new', 't-old']);
  assert.equal(pressed('conversation:w1'), 't-old', 'another place keeps its own presses in the tab');
  assert.equal(pressed('outcome:w1'), 't-mid');
  // What the tab keeps is the question, and no more: no title or words of the message.
  assert.deepEqual(JSON.parse(tab.getItem('waiting-question:outcome:w1')), { topic_id: 't-mid', ms: 200, message_id: 'm-t-mid' });
  // Another tab starts at its own oldest.
  assert.equal(new QuestionPresses(() => new Tab()).next('outcome:w1', asks).topic_id, 't-old');
  // A question answered since drops out across the load too.
  assert.equal(new QuestionPresses(() => tab).next('outcome:w1', [ask('t-new', 300), ask('t-old', 100)]).topic_id, 't-new');
});

test('a tab that cannot keep the presses, or keeps something that is not a question, starts at the oldest and says nothing', () => {
  const asks = [ask('t-new', 300), ask('t-old', 100)];
  const failing = { getItem() { throw new Error('read refused'); }, setItem() { throw new Error('write refused'); }, removeItem() { throw new Error('remove refused'); } };
  for (const storage of [() => failing, () => { throw new Error('SecurityError'); }, () => null, () => undefined]) {
    const page = new QuestionPresses(storage);
    assert.deepEqual([1, 2, 3].map(() => page.next('outcome:w1', asks).topic_id), ['t-old', 't-new', 't-old'], 'the page itself still goes on from press to press');
  }
  // A write the tab refuses leaves nothing older behind: the next page starts at the oldest, not after a stale press.
  const full = new Tab();
  new QuestionPresses(() => full).next('outcome:w1', asks);
  full.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(new QuestionPresses(() => full).next('outcome:w1', asks).topic_id, 't-new');
  assert.equal(full.getItem('waiting-question:outcome:w1'), null, 'the stale press is gone');
  assert.equal(new QuestionPresses(() => full).next('outcome:w1', asks).topic_id, 't-old');
  // Kept by no press of the page's (a value with no time, or not JSON): nothing comes before the oldest.
  for (const saved of ['not json', 'null', '7', '"t-new"', '{"topic_id":"","ms":1}', '{"topic_id":"t-new"}', '{"topic_id":"t-new","ms":1.5}', '{"topic_id":"t-new","ms":"300"}']) {
    const tab = new Tab(); tab.setItem('waiting-question:outcome:w1', saved);
    assert.equal(new QuestionPresses(() => tab).next('outcome:w1', asks).topic_id, 't-old', 'kept ' + saved + ' starts at the oldest');
  }
  const tab = new Tab(); tab.setItem('waiting-question:outcome:w1', JSON.stringify({ topic_id: 't-old', ms: 100, message_id: 'm-t-old' }));
  assert.equal(new QuestionPresses(() => tab).next('outcome:w1', asks).topic_id, 't-new', 'a kept question is gone on from');
});
