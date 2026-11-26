import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { client } from '../tools/scale_1250.mjs';

const expected = { instance_id:'unread1294-fixture', topic_id:'target', commit_seq:42,
  oldest_unread:{ id:'frontier-message', seq:71, sent_ms:1700000000000 } };
const args = { topic_id:'target' };
const clone = value => JSON.parse(JSON.stringify(value));

async function fixture(t) {
  let answer = clone(expected);
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ path:request.url, body:JSON.parse(body) });
    response.writeHead(200, { 'Content-Type':'application/json', Connection:'close' });
    response.end(JSON.stringify(answer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const log = [];
  const reader = client({ origin:`http://127.0.0.1:${server.address().port}`,
    token:'isolated-fixture', instance_id:expected.instance_id, expected_unread:expected }, log);
  return { reader, log, requests, change(value) { answer = clone(value); } };
}

test('1294 real Api request reaches unread page owner and retains complete envelope', async t => {
  const f = await fixture(t);
  const row = await f.reader.read(args, 'topic_unread');
  assert.equal(row.status, 'ok');
  assert.deepEqual(row.answer, expected);
  assert.equal(row.ownerAccepted, true);
  assert.deepEqual(f.requests, [{ path:'/api/view', body:{ name:'topic_unread', args } }]);
  assert.equal(f.log.length, 1);
});

test('1294 wrong unread frontier is observed over HTTP, rejected, retained and restored', async t => {
  const f = await fixture(t), bad = clone(expected);
  bad.oldest_unread.id = 'another-message';
  f.change(bad);
  const red = await f.reader.read(args, 'topic_unread');
  assert.equal(red.status, 'failed');
  assert.match(red.error, /frontier/);
  assert.deepEqual(red.answer, bad);
  assert.equal(f.requests.length, 1);
  f.change(expected);
  assert.equal((await f.reader.read(args, 'topic_unread')).status, 'ok');
  assert.deepEqual(f.log.map(row => row.status), ['failed','ok']);
});

test('1294 instance topic commit and time faults each fail before restored success', async t => {
  const f = await fixture(t);
  for (const change of [
    a => { a.instance_id = 'another-instance'; },
    a => { a.topic_id = 'another-topic'; },
    a => { a.commit_seq += 1; },
    a => { a.oldest_unread.sent_ms += 1; },
    a => { a.oldest_unread.seq += 1; },
    a => { a.oldest_unread = null; },
  ]) {
    const bad = clone(expected); change(bad); f.change(bad);
    assert.equal((await f.reader.read(args, 'topic_unread')).status, 'failed');
  }
  f.change(expected);
  assert.equal((await f.reader.read(args, 'topic_unread')).status, 'ok');
  assert.equal(f.requests.length, 7);
  assert.deepEqual(f.log.map(row => row.status), [...Array(6).fill('failed'),'ok']);
});
