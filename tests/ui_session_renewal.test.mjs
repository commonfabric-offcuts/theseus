import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionRenewal, sessionIn } from '../web/session-renewal.mjs';

// The page's own address carries the server's current session, as a Reload
// would read it; a restarted server has a new one.
const page = token => `<!doctype html><meta charset="utf-8"><meta name="aim-next-session" content="${token}"><title>Theseus</title>`;
const bootstrap = { instance_id: 'i1', actor: 'person' };
function fixture({ html = page('new'), answers = { new: bootstrap }, ok = true, fails = false } = {}) {
  const fetched = [], asked = [];
  let release = null;
  const api = { token: 'old' }, live = { token: 'old' }, adopted = [];
  const renewal = new SessionRenewal({
    api, bootstrap, live: () => live, adopted: token => adopted.push([token, api.token, live.token]),
    makeApi: token => ({ bootstrap: async () => { asked.push(token); if (!(token in answers)) throw Error('refused'); return answers[token]; } }),
    fetcher: async (url, options) => {
      fetched.push([url, options]);
      if (fixture.hold) await new Promise(resolve => { release = resolve; });
      if (fails) throw TypeError('Failed to fetch');
      return { ok, text: async () => html };
    },
  });
  return { renewal, api, live, fetched, asked, adopted, release: () => release?.() };
}

test('a page whose session the server no longer holds takes the new one, for its reads and its live feed', async () => {
  const f = fixture();
  assert.equal(await f.renewal.renew(), 'renewed');
  assert.deepEqual(f.fetched, [['/', { credentials: 'same-origin', cache: 'no-store' }]]);
  assert.deepEqual(f.asked, ['new'], 'the new session is asked who it speaks for first');
  assert.equal(f.api.token, 'new');
  assert.equal(f.live.token, 'new');
  assert.deepEqual(f.adopted, [['new', 'new', 'new']], 'told once, after the reads and the live feed hold it');
});

test('the session the page already holds is the current one, and nothing is asked of it', async () => {
  const f = fixture({ html: page('old') });
  assert.equal(await f.renewal.renew(), 'current');
  assert.deepEqual(f.asked, []);
  assert.equal(f.api.token, 'old');
  assert.deepEqual(f.adopted, []);
});

test('a new session that speaks for another instance or person is never taken', async () => {
  for (const answer of [{ instance_id: 'i2', actor: 'person' }, { instance_id: 'i1', actor: 'someone-else' }, null]) {
    const f = fixture({ answers: { new: answer } });
    assert.equal(await f.renewal.renew(), null, JSON.stringify(answer));
    assert.equal(f.api.token, 'old'); assert.equal(f.live.token, 'old'); assert.deepEqual(f.adopted, []);
  }
  const refused = fixture({ answers: {} });
  assert.equal(await refused.renewal.renew(), null, 'a new session that cannot be asked is not taken');
  assert.equal(refused.api.token, 'old');
});

test('a server that is not there, refuses the page or offers no session changes nothing', async () => {
  for (const options of [{ fails: true }, { ok: false }, { html: '<!doctype html><title>Theseus</title>' }, { html: page('__AIM_SESSION_TOKEN__') }, { html: page('') }]) {
    const f = fixture(options);
    assert.equal(await f.renewal.renew(), null, JSON.stringify(options));
    assert.equal(f.api.token, 'old'); assert.deepEqual(f.asked, []);
  }
});

test('renewals asked for while one is under way share it, and a later one reads again', async () => {
  fixture.hold = true;
  try {
    const f = fixture();
    const first = f.renewal.renew(), second = f.renewal.renew();
    assert.equal(first, second);
    await new Promise(resolve => setImmediate(resolve));
    f.release();
    assert.deepEqual(await Promise.all([first, second]), ['renewed', 'renewed']);
    assert.equal(f.fetched.length, 1);
    fixture.hold = false;
    assert.equal(await f.renewal.renew(), 'current');
    assert.equal(f.fetched.length, 2);
  } finally { fixture.hold = false; }
});

test('the session is read from the page the way the browser reads its own meta', () => {
  assert.equal(sessionIn(page('abc-_123')), 'abc-_123');
  assert.equal(sessionIn(page('__AIM_SESSION_TOKEN__')), null);
  assert.equal(sessionIn(page('a&amp;b&lt;c&gt;d&quot;e&#x27;f')), 'a&b<c>d"e\'f', 'unescaped as the server escaped it');
  assert.equal(sessionIn(page('&amp;lt;')), '&lt;', 'once, not twice');
  assert.equal(sessionIn('<meta name="other" content="x">'), null);
});
