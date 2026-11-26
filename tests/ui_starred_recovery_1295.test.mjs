import test from 'node:test';
import assert from 'node:assert/strict';
import { Api, answered } from '../web/api.mjs';
import { SessionRenewal } from '../web/session-renewal.mjs';
import { OutlineDossiers } from '../web/outline-dossiers.mjs';
import { miniDocument } from './fixtures/mini_dom.mjs';

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
const star = (n, id = 'd' + n, pages = false) => ({ star: n, topic_id: 't', ...(pages
  ? { item_id: id, title: id, owner_scope: { kind: 'topic', id: 't' } }
  : { dossier: { id, name: id, body: id } }) });
const page = (items = [], next_cursor = null) => ({ instance_id: 'instance', items, next_cursor });
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const offline = () => { throw TypeError('isolated connection failure'); };
function fixture(t, pages = false) {
  const jobs = [], calls = [], doc = miniDocument(); doc.visibilityState = 'visible';
  const host = doc.byId('outline'), parent = doc.createElement('a'), box = doc.createElement('div');
  parent.dataset.topicId = 't'; host.append(parent, box);
  const bootstrap = { instance_id: 'instance', actor: 'reader', authority: { authority_id: 'a', authority_epoch: 'e' } };
  const api = new Api('old', async (path, options) => {
    calls.push({ path, token: options.headers.Authorization, ...JSON.parse(options.body) });
    assert.equal(path, '/api/view', 'recovery never sends a command or reloads');
    assert.ok(jobs.length, 'every read has a declared outcome');
    const result = await jobs.shift()();
    return result?.json ? result : response(result);
  });
  const handles = { bootstrap, api, topicReadAllowed: () => true };
  const subject = Object.create(OutlineDossiers.prototype);
  const state = { id: 't', parent, box, stars: [], next: null, extent: null, links: new Map(), loaded: false, busy: null, error: null, visible: true };
  Object.assign(subject, { epoch: 1, pageStars: pages, states: new Map([['t', state]]),
    outline: { handles, doc, read: (name, args, lane) => api.view(name, args, { readClass: lane }) } });
  t.after(() => subject.begin());
  return { subject, state, api, handles, doc, parent, box, jobs, calls, load: more => subject.load(state, more),
    queue: (items = [], next = null) => jobs.push(() => page(items, next)) };
}

for (const pages of [false, true]) test(`1295 ${pages ? 'Notebook pages' : 'dossiers'} recover once after newer contact, preserving another control's focus`, async t => {
  const f = fixture(t, pages), writing = f.doc.byId('writing'); writing.value = 'Exact kept writing'; writing.focus();
  f.jobs.push(offline); await f.load(); assert.ok(f.state.error);
  await flush(); assert.equal(f.calls.length, 1, 'no automatic loop without contact');
  f.queue([star(3, 'kept', pages)]); answered(); answered(); answered(); await flush();
  assert.equal(f.calls.length, 2, 'contact bursts coalesce for this group');
  assert.equal(f.state.error, null); assert.equal(f.state.stars.length, 1);
  assert.equal(f.doc.activeElement, writing); assert.equal(writing.value, 'Exact kept writing');
  assert.ok(f.calls.every(c => c.name === (pages ? 'memory_stars' : 'stars') && c.args.limit === 50));
});

test('1295 a failure arriving after server return recovers without another commit', async t => {
  const f = fixture(t); let reject;
  f.jobs.push(() => new Promise((_, no) => { reject = no; }));
  const reading = f.load(); await flush();
  answered(); f.queue([star(4)]); reject(TypeError('late failed response')); await reading; await flush();
  assert.equal(f.calls.length, 2); assert.equal(f.state.stars[0].dossier.id, 'd4');
});

test('1295 a second outage waits for a newer answer, then recovers', async t => {
  const f = fixture(t); f.jobs.push(offline); await f.load();
  f.jobs.push(offline); answered(); await flush(); assert.equal(f.calls.length, 2);
  await flush(); assert.equal(f.calls.length, 2, 'the failed retry cannot use the same contact twice');
  f.queue([star(5)]); answered(); await flush(); assert.equal(f.calls.length, 3); assert.equal(f.state.error, null);
});

test('1295 several failed visible groups each recover only once', async t => {
  const a = fixture(t), b = fixture(t, true);
  a.jobs.push(offline); b.jobs.push(offline); await Promise.all([a.load(), b.load()]);
  a.queue([star(1)]); b.queue([star(2, 'page', true)]); answered(); answered(); await flush();
  assert.deepEqual([a.calls.length, b.calls.length], [2, 2]);
  assert.equal(a.state.error, null); assert.equal(b.state.error, null);
});

test('1295 a refused session waits for validated same-person adoption', async t => {
  const f = fixture(t); f.jobs.push(() => response({ error: { code: 'SESSION_REQUIRED' } }, 401)); await f.load();
  const renewal = new SessionRenewal({ api: f.api, bootstrap: f.handles.bootstrap,
    makeApi: () => ({ bootstrap: async () => ({ instance_id: 'other', actor: 'reader' }) }),
    fetcher: async () => ({ ok: true, text: async () => '<meta name="aim-next-session" content="new">' }) });
  assert.equal(await renewal.renew(), null); answered(); await flush();
  assert.equal(f.calls.length, 1); assert.equal(f.api.token, 'old');
  renewal.makeApi = () => ({ bootstrap: async () => f.handles.bootstrap });
  f.queue([star(6)]); assert.equal(await renewal.renew(), 'renewed');
  answered(); await flush();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].token, 'Bearer new'); assert.equal(f.state.error, null);
});

for (const [name, make] of [
  ['unreadable200', () => ({ ok: true, status: 200, json: async () => { throw SyntaxError('bad json'); } })],
  ['forbidden', () => response({ error: { code: 'FORBIDDEN' } }, 403)],
  ['authority', () => response({ error: { code: 'AUTHORITY_CHANGED' } }, 409)],
  ['busy answer', () => response({ error: { code: 'DATABASE_BUSY', retryable: true } }, 503)],
  ['malformed', () => page(null)],
]) test('1295 ' + name + ' stays explicit rather than becoming outage recovery', async t => {
  const f = fixture(t); f.jobs.push(make); await f.load(); assert.ok(f.state.error);
  answered(); await flush(); assert.equal(f.calls.length, 1); assert.ok(f.state.error);
});

test('1295 a failed More resumes its exact cursor and keeps prior extent', async t => {
  const f = fixture(t); f.queue([star(10), star(9)], 9); await f.load();
  f.jobs.push(offline); await f.load(true); assert.equal(f.state.extent, 9);
  f.queue([star(8), star(7)], 7); answered(); await flush();
  assert.deepEqual(f.calls.map(c => c.args.cursor ?? null), [null, 9, 9]);
  assert.deepEqual(f.state.stars.map(s => s.star), [10, 9, 8, 7]); assert.equal(f.state.extent, 7);
});

for (const retirement of ['navigation', 'actor', 'authority', 'hidden group', 'hidden parent', 'hidden document', 'removed', 'topic access'])
  test('1295 recovery is retired by ' + retirement, async t => {
    const f = fixture(t); f.jobs.push(offline); await f.load();
    if (retirement === 'navigation') f.subject.begin();
    if (retirement === 'actor') f.handles.bootstrap.actor = 'someone-else';
    if (retirement === 'authority') f.handles.bootstrap.authority.authority_epoch = 'later';
    if (retirement === 'hidden group') f.state.visible = false;
    if (retirement === 'hidden parent') f.parent.getClientRects = () => [];
    if (retirement === 'hidden document') f.doc.visibilityState = 'hidden';
    if (retirement === 'removed') f.box.remove();
    if (retirement === 'topic access') f.handles.topicReadAllowed = () => false;
    answered(); await flush(); assert.equal(f.calls.length, 1);
  });

test('1295 a late recovery answer cannot publish after navigation', async t => {
  const f = fixture(t); f.jobs.push(offline); await f.load(); let resolve;
  f.jobs.push(() => new Promise(yes => { resolve = yes; })); answered(); await flush();
  assert.equal(f.calls.length, 2); f.subject.begin(); resolve(page([star(99)])); await flush();
  assert.deepEqual(f.state.stars, []);
});

for (const hiding of ['group', 'parent', 'document', 'removed', 'topic access'])
  test('1295 hiding ' + hiding + ' after recovery starts releases its busy slot and allows a same-run reveal', async t => {
    const f = fixture(t); f.jobs.push(offline); await f.load(); let resolve;
    f.jobs.push(() => new Promise(yes => { resolve = yes; })); answered(); await flush();
    assert.equal(f.calls.length, 2); assert.ok(f.state.busy);
    if (hiding === 'group') f.state.visible = false;
    if (hiding === 'parent') f.parent.getClientRects = () => [];
    if (hiding === 'document') f.doc.visibilityState = 'hidden';
    if (hiding === 'removed') f.box.remove();
    if (hiding === 'topic access') f.handles.topicReadAllowed = () => false;
    resolve(page([star(99)])); await flush();
    assert.deepEqual(f.state.stars, [], 'the hidden recovery never publishes');
    assert.equal(f.state.busy, null, 'settlement releases this request even when publication is ineligible');
    f.state.visible = true; f.parent.getClientRects = () => [{}]; f.doc.visibilityState = 'visible';
    if (hiding === 'removed') f.parent.parent.append(f.box);
    f.handles.topicReadAllowed = () => true;
    f.queue([star(7)]); await f.load();
    assert.equal(f.calls.length, 3); assert.equal(f.state.stars[0].dossier.id, 'd7');
  });

test('1295 an old recovery settling cannot release a newer run\'s busy owner', async t => {
  const f = fixture(t); f.jobs.push(offline); await f.load(); let oldAnswer, newAnswer;
  f.jobs.push(() => new Promise(yes => { oldAnswer = yes; })); answered(); await flush();
  f.subject.begin();
  f.jobs.push(() => new Promise(yes => { newAnswer = yes; })); const next = f.load(); await flush();
  const busy = f.state.busy; oldAnswer(page([star(99)])); await flush();
  assert.equal(f.state.busy, busy); assert.deepEqual(f.state.stars, []);
  newAnswer(page([star(7)])); await next;
  assert.equal(f.state.busy, null); assert.equal(f.state.stars[0].dossier.id, 'd7');
});

test('1295 pointer/key/touch Retry callback and More keep their existing owners; a focused Retry returns to the topic', async t => {
  const f = fixture(t); f.jobs.push(offline); await f.load();
  const retry = f.box.querySelector('[data-retry]'); assert.ok(retry); retry.focus();
  f.queue([star(10)], 10); answered(); await flush();
  assert.equal(f.doc.activeElement, f.parent, 'a removed focused retry has a connected fallback');
  const more = f.box.querySelector('button'); assert.equal(more.textContent, 'More starred dossiers');
  f.queue([star(9)]); await more.onclick(); await flush(); assert.equal(f.state.stars.length, 2);
  for (const input of ['click', 'keyboard', 'touch']) {
    f.jobs.push(offline); await f.load();
    const retry = f.box.querySelector('[data-retry]'); f.queue([star(8)]);
    await retry.onclick({ type: input }); await flush(); assert.equal(f.state.error, null);
  }
});
