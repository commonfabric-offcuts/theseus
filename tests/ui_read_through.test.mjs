import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadThrough, UNKNOWN } from '../web/read-through.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const calls = [], answers = [];
  let inFlight = 0, most = 0;
  const reads = new ReadThrough({ send: (topicId, from, through) => {
    calls.push([topicId, from, through]); most = Math.max(most, ++inFlight);
    let settleAnswer;
    const answer = new Promise((resolve, reject) => { settleAnswer = { resolve, reject }; }).finally(() => { --inFlight; });
    answers.push(settleAnswer); return answer;
  } });
  return { reads, calls, answers, most: () => most };
}

test('read-through reports exactly the range seen, never what lies below or above it', async () => {
  const f = fixture();
  f.reads.seen('t1', 4, 9); await settle();
  assert.deepEqual(f.calls, [['t1', 4, 9]]);
  f.answers[0].resolve({ recorded: true }); await settle();
  f.reads.seen('t1', 5, 7); f.reads.seen('t1', 4, 9); await settle();
  assert.deepEqual(f.calls, [['t1', 4, 9]], 'a confirmed range is not reported again');
  f.reads.seen('t1', 2, 3); await settle();
  assert.deepEqual(f.calls, [['t1', 4, 9], ['t1', 2, 3]], 'older messages seen later are their own range');
  for (const bad of [[0, 3], [5, 4], [1.5, 3], ['1', 3]]) f.reads.seen('t1', ...bad);
  await settle();
  assert.equal(f.calls.length, 2, 'an invalid range is never sent');
});

test('a failed or unrecorded report is sent again the next time the same messages are seen', async () => {
  const f = fixture();
  f.reads.seen('t1', 5, 6); await settle();
  f.answers[0].reject(Error('Connection interrupted')); await settle();
  assert.deepEqual(f.calls, [['t1', 5, 6]], 'no timer retries it');
  f.reads.seen('t1', 5, 6); await settle();
  assert.deepEqual(f.calls, [['t1', 5, 6], ['t1', 5, 6]], 'seeing the same messages again sends again');
  f.answers[1].resolve({ recorded: false, status: 'retryable', error: { code: 'DATABASE_BUSY', retryable: true } }); await settle();
  f.reads.seen('t1', 5, 6); await settle();
  assert.equal(f.calls.length, 3, 'a receipt that recorded nothing confirms nothing');
  f.answers[2].resolve({ recorded: true, status: 'committed' }); await settle();
  f.reads.seen('t1', 5, 6); await settle();
  assert.equal(f.calls.length, 3);
});

test('ranges seen during a request coalesce, one request per topic at a time', async () => {
  const f = fixture();
  f.reads.seen('t1', 2, 3); f.reads.seen('t1', 2, 3); f.reads.seen('t1', 5, 8); f.reads.seen('t1', 4, 6); f.reads.seen('t1', 20, 21); await settle();
  assert.deepEqual(f.calls, [['t1', 2, 3]], 'one request in flight per topic; the same range is not queued twice');
  f.reads.seen('t2', 1, 1); await settle();
  assert.deepEqual(f.calls, [['t1', 2, 3], ['t2', 1, 1]], 'another topic has its own request');
  f.answers[0].resolve({ recorded: true }); await settle();
  assert.deepEqual(f.calls.at(-1), ['t1', 4, 8], 'overlapping and touching ranges merge, a separate one waits');
  f.answers[2].resolve({ recorded: true }); await settle();
  assert.deepEqual(f.calls.at(-1), ['t1', 20, 21]);
  f.answers[3].resolve({ recorded: true }); f.answers[1].resolve({ recorded: true }); await settle();
  assert.equal(f.calls.length, 4, 'nothing more to send');
  f.reads.seen('t1', 2, 8); await settle();
  assert.equal(f.calls.length, 4, 'confirmed ranges that touch cover the range between them');
  assert.equal(f.most(), 2, 'never two requests at once for one topic');
});

// Each call answers with the receipt of the report that carries its range, so
// the page can tell what its own sighting settled (TopicViews.sighted): null
// only when the call reported nothing new, and UNKNOWN when the report failed,
// since its answer may have been lost after Core recorded it.
test('each sighting is answered with the receipt of the report that carries it, null when it reported nothing new, unknown when the report failed', async () => {
  const f = fixture();
  const answered = [];
  const watch = (name, receipt) => { receipt.then(value => answered.push([name, value === UNKNOWN ? 'unknown' : value?.n ?? null])); };
  watch('first', f.reads.seen('t1', 4, 6)); await settle();
  watch('in flight', f.reads.seen('t1', 5, 6));
  watch('waits', f.reads.seen('t1', 8, 9));
  watch('already waiting', f.reads.seen('t1', 8, 8));
  watch('joins', f.reads.seen('t1', 9, 10));
  watch('invalid', f.reads.seen('t1', 3, 2)); await settle();
  assert.deepEqual(answered, [['in flight', null], ['already waiting', null], ['invalid', null]], 'what is in flight or waiting already is nothing new');
  f.answers[0].resolve({ recorded: true, n: 1 }); await settle();
  assert.deepEqual(f.calls, [['t1', 4, 6], ['t1', 8, 10]]);
  assert.deepEqual(answered.slice(3), [['first', 1]], 'the first report\'s receipt answers the range it carried');
  watch('confirmed', f.reads.seen('t1', 4, 5)); await settle();
  f.answers[1].reject(Error('Connection interrupted')); await settle();
  assert.deepEqual(answered.slice(4).sort(), [['confirmed', null], ['joins', 'unknown'], ['waits', 'unknown']], 'confirmed already, nothing new; a failed report answers unknown to each range it carried');
  watch('again', f.reads.seen('t1', 8, 10)); await settle();
  watch('after it', f.reads.seen('t1', 11, 12)); await settle();
  // #4..#6 confirmed, #8..#10 in flight, #11..#12 waiting: together they hold
  // every message of #8..#12 and of #4..#12 but #7.
  watch('spans flight and waiting', f.reads.seen('t1', 9, 12));
  watch('spans a gap', f.reads.seen('t1', 4, 12)); await settle();
  assert.deepEqual(answered.slice(7), [['spans flight and waiting', null]], 'nothing new across what is in flight and waiting');
  f.answers[2].resolve({ recorded: true, n: 3 }); await settle();
  assert.deepEqual(answered.slice(8), [['again', 3]], 'sent again, its receipt answers');
  assert.deepEqual(f.calls.at(-1), ['t1', 4, 12], '#7 is new: the range that holds it goes out, joined with what waited');
  f.answers[3].resolve({ recorded: true, n: 3 }); await settle();
  assert.deepEqual(answered.slice(9).sort(), [['after it', 3], ['spans a gap', 3]]);
  watch('answered nothing', f.reads.seen('t1', 30, 30)); await settle();
  f.answers[4].resolve(undefined); await settle();
  assert.deepEqual(answered.slice(11), [['answered nothing', 'unknown']], 'a report answered with nothing is unknown, not nothing new');
});
