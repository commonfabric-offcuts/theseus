// A page that has asked to load another asks Theseus nothing more until it is
// gone or is seen to stay (api.mjs depart, stay). These hold the module's one
// live feed and its departure, so they run in a file of their own: node runs
// each test file in a process of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Api, AttemptError, contact, depart, follow, heard, stay } from '../web/api.mjs';
import { Live } from '../web/live.mjs';

const turns = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };
// A WebSocket the test drives.
function feed() {
  const sockets = [];
  const live = new Live({ token: 't', origin: 'http://127.0.0.1:5192', random: () => 0, now: () => 0,
    timers: { setTimeout: () => 0, clearTimeout() {} },
    socket: () => { const s = { closed: false, close() { s.closed = true; } }; sockets.push(s); return s; } });
  return { live, sockets, say: seq => sockets.at(-1).onmessage({ data: JSON.stringify({ seq }) }) };
}
// Whether a promise has settled after a few turns.
const settled = promise => { const seen = { settled: false }; promise.then(() => { seen.settled = true; }, () => { seen.settled = true; }); return seen; };
const noAnswer = async () => { throw new TypeError('Load cancelled'); };

test('a feed that reads live is opened again once for each doubt, never in a loop, and an answered request settles a doubt; then a page that departs sends nothing until it stays, tells no one of attempts the browser cancels as it goes, and once it stays sends what waited and reads as before', async () => {
  const { live, sockets, say } = feed();
  live.start(); say(4); follow(live);
  assert.equal(contact.live, true);

  // Where it should: an attempt with no answer, begun after the feed's last answer, opens the feed again.
  const api = new Api('t', noAnswer);
  await assert.rejects(api.view('topic', {}), AttemptError);
  assert.equal(sockets.length, 2, 'the doubted feed is opened again');
  say(4);
  assert.equal(contact.live, true, 'the new socket answers with the number it came back with');
  // Where it should not: reads that fail again on the socket opened again do not replace it, however many.
  for (let n = 0; n < 5; n++) await assert.rejects(api.view('topic', {}), AttemptError);
  assert.equal(sockets.length, 2, 'one doubt opens the feed once');
  // A request Theseus answers settles the doubt, with no commit since: a
  // later drop that leaves the socket half-open is doubted afresh.
  // A refusal of Theseus's own is an answer too.
  let answer = () => new Response('{"ok":true}', { status: 200 });
  const flaky = new Api('t', async () => { if (answer) return answer(); throw new TypeError('network'); });
  await flaky.view('topic', {});
  answer = null;
  await assert.rejects(flaky.view('topic', {}), AttemptError);
  assert.equal(sockets.length, 3, 'after an answered request the feed may be doubted again');
  say(4);
  for (let n = 0; n < 5; n++) await assert.rejects(flaky.view('topic', {}), AttemptError);
  assert.equal(sockets.length, 3, 'and that doubt, too, opens the feed once');
  answer = () => new Response(JSON.stringify({ recorded: false, error: { code: 'TOPIC_CLOSED', message: 'This topic is closed.' } }), { status: 409 });
  await assert.rejects(flaky.view('topic', {}), AttemptError);
  answer = null;
  await assert.rejects(flaky.view('topic', {}), AttemptError);
  assert.equal(sockets.length, 4, 'after a refusal of its own the feed may be doubted again');
  say(4);
  // A new commit settles the doubt: the next attempt with no answer opens it again.
  say(5);
  await assert.rejects(api.view('topic', {}), AttemptError);
  assert.equal(sockets.length, 5, 'after a new commit the feed may be doubted again');
  say(5);

  // An attempt out as the page departs, which the browser then cancels.
  let cancel;
  const outApi = new Api('t', () => new Promise((_, reject) => { cancel = () => reject(new TypeError('Load cancelled')); }));
  const outRead = outApi.view('workspace_topics', {}), out = settled(outRead);
  await turns(1);
  const learned = [];
  const unhear = heard(() => learned.push(contact.live));
  const sent = [];
  const after = new Api('t', async path => { sent.push(path); return new Response('{}', { status: 200 }); });

  depart();
  const commits = [];
  const unlisten = live.listen(event => { if (event.kind === 'commit') commits.push(event.seq); });
  const askedFor = [after.view('topic', {}), after.command({}), after.bootstrap(), after.upload({}, new Blob(['x'])), after.media('i', { id: 'm' })];
  const asked = askedFor.map(settled);
  cancel();
  await turns();
  assert.deepEqual(sent, [], 'nothing asked after departing is sent');
  assert.deepEqual(asked.map(seen => seen.settled), [false, false, false, false, false], 'and nothing asked settles while the page is leaving');
  assert.equal(out.settled, false, 'an attempt cancelled as the page goes tells whoever asked nothing');
  assert.equal(sockets.length, 5, 'and is no reason to doubt the feed');
  say(6);
  assert.deepEqual([commits, learned.at(-1), sockets.at(-1).closed], [[6], true, false], 'the live feed goes on: a commit it names is heard, to be read once the page stays');

  // The load was stopped (the person stopped it, went back, or chose to stay): the page stays.
  stay();
  await turns();
  assert.deepEqual(sent.sort(), ['/api/bootstrap', '/api/command', '/api/media/read', '/api/media/upload', '/api/view'], 'what waited is sent once the page stays');
  assert.deepEqual(asked.map(seen => seen.settled), [true, true, true, true, true], 'and settles');
  await assert.rejects(outRead, AttemptError, 'the attempt cancelled meanwhile fails as it did');
  assert.equal(sockets.length, 5, 'judged as one the page stopped itself: the feed is left alone');
  // Where it should: the page that stayed doubts its feed as before.
  await assert.rejects(api.view('topic', {}), AttemptError);
  assert.equal(sockets.length, 6, 'an attempt with no answer on the page that stayed opens the feed again');
  unlisten(); unhear();
});
