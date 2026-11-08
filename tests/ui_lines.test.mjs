// The page's lines work out from the failure they show whether it is about
// reaching Theseus, and only such a line goes when the page reaches Theseus
// again (web/lines.mjs, web/api.mjs unreached).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Api, AttemptError, unreached, sessionRefused } from '../web/api.mjs';
import { PageReads } from '../web/page-reads.mjs';
import { showLine, clearUnreached, lineText } from '../web/lines.mjs';

const lost = () => new AttemptError('Connection interrupted. Confirmation is unknown; your writing is kept.');
const refusedSession = () => new AttemptError('Open this instance to establish a session.', 401, { error: { code: 'SESSION_REQUIRED', message: 'Open this instance to establish a session.' } });
const element = () => ({ textContent: '', hidden: true, dataset: {}, children: [], append(...items) { this.children.push(...items); } });
const page = (...lines) => ({ querySelectorAll: selector => selector === '[data-unreached]' ? lines.filter(line => 'unreached' in line.dataset) : [] });

// What answers while Theseus restarts behind Tailscale Serve (docs/tailnet-access.md):
// the proxy's 502 with an empty body. Theseus's own answers are JSON.
const proxyDown = () => new Response('', { status: 502 });
const theseus = (status, error) => new Response(JSON.stringify({ recorded: false, error }), { status, headers: { 'Content-Type': 'application/json' } });
const nothing = () => { throw new TypeError('Failed to fetch'); };
const failureOf = promise => promise.then(() => assert.fail('the attempt was meant to fail'), error => error);

test('a failure is about reaching Theseus when nothing answered, only something in front of it did, or the server refused this page\'s session; and not otherwise', () => {
  assert.equal(unreached(lost()), true, 'no answer');
  assert.equal(unreached(refusedSession()), true, 'a restarted server refused the session');
  assert.equal(sessionRefused(refusedSession()), true);
  assert.equal(unreached(new AttemptError('AIM returned an unreadable response. Confirmation is unknown.', 502)), true, 'a proxy answered, not Theseus');
  assert.equal(unreached(new AttemptError('Refused.', 401, { error: { code: 'OTHER' } })), false, 'a 401 that is not the session');
  assert.equal(sessionRefused(new AttemptError('Refused.', 403, { error: { code: 'SESSION_REQUIRED' } })), false, 'the code alone is not a session refusal');
  assert.equal(unreached(new AttemptError('This topic is closed.', 409, { error: { code: 'CONFLICT' } })), false, 'Core answered');
  assert.equal(unreached(new AttemptError('Server busy.', 503, { error: { code: 'SERVER_BUSY' } })), false, 'Theseus answered that it is busy');
  assert.equal(unreached(Object.assign(Error('Connection interrupted.'), { status: 0 })), false, 'only an attempt\'s own error says so');
  assert.equal(unreached({ code: 'CONNECTION_UNKNOWN', message: 'Connection interrupted.' }), false, 'a receipt\'s error is an answer');
});

test('a failure a caller put into words of its own is judged by the attempt it carries as its cause', () => {
  assert.equal(unreached(Error('Could not read this page.', { cause: lost() })), true);
  assert.equal(unreached(Error('Outer words.', { cause: Error('Inner words.', { cause: refusedSession() }) })), true, 'through every wrapping');
  assert.equal(unreached(Error('Could not read this page.', { cause: new AttemptError('This topic is closed.', 409, { error: { code: 'CONFLICT' } }) })), false, 'Core answered underneath');
  assert.equal(unreached(Error('Could not read this page.', { cause: new TypeError('x is undefined') })), false, 'a fault of the page\'s own');
  assert.equal(unreached(Error('Could not read this page.')), false, 'words alone');
  const looped = Error('One.'); looped.cause = Error('Two.', { cause: looped });
  assert.equal(unreached(looped), false, 'a cause that loops ends');
});

test('every way the page reaches Theseus says so the same: a request, an image upload and an attachment read', async () => {
  const api = answer => new Api('session', async () => answer());
  for (const [name, attempt] of [['request', a => a.view('source', {})], ['upload', a => a.upload({ v: 1 }, new Blob(['x']))],
    ['media', a => a.media('instance', { id: 'm1' }, null)]]) {
    assert.equal(unreached(await failureOf(attempt(api(nothing)))), true, `${name}: nothing answered`);
    assert.equal(unreached(await failureOf(attempt(api(proxyDown)))), true, `${name}: the proxy answered 502 while Theseus was down`);
    assert.equal(unreached(await failureOf(attempt(api(() => theseus(503, { code: 'SERVER_BUSY', message: 'Busy.' }))))), false, `${name}: Theseus answered`);
  }
  const refused = await failureOf(api(() => theseus(404, { code: 'NOT_FOUND', message: 'No such attachment.' })).media('instance', { id: 'm1' }, null));
  assert.deepEqual([refused.status, unreached(refused)], [404, false], 'an attachment Theseus refused');
  // The server stops while the attachment's bytes come.
  const header = JSON.stringify({ instance_id: 'instance', media_id: 'm1', name: 'a.png', content_type: 'image/png', size_bytes: 4, sha256: '0'.repeat(64), inline: true });
  const cut = new ReadableStream({ pull(controller) { controller.error(new TypeError('network error')); } });
  const halfway = await failureOf(api(() => new Response(cut, { status: 200, headers: { 'X-AIM-Media': header } }))
    .media('instance', { id: 'm1', name: 'a.png', content_type: 'image/png', size_bytes: 4, sha256: '0'.repeat(64), inline: true }, null));
  assert.equal(unreached(halfway), true, 'cut off on the way');
});

// The Reader's notice for a Notebook page that comes forward while the server
// is down: the real Api, the real PageReads and the real line.
test('a page read that met no server leaves a notice that goes when the page reaches Theseus; one Core refused stays', async () => {
  const source = { source_ref: { kind: 'memory', id: 'n1', revision: 2 } };
  for (const [name, fetcher] of [['nothing answered', nothing], ['the proxy answered', proxyDown]]) {
    const api = new Api('session', async () => fetcher());
    const reads = new PageReads({ send: (id, revision) => api.command({ v: 1, kind: 'memory.read', args: { id, revision } }) });
    const notice = element();
    showLine(notice, await failureOf(reads.opened(source)));
    assert.equal(notice.hidden, false, `${name}: the notice says the read failed`);
    clearUnreached(page(notice));
    assert.equal(notice.hidden ? '' : notice.textContent, '', `${name}: the reader notice still says: ${notice.textContent}`);
  }
  const refusing = new PageReads({ send: async () => ({ status: 'rejected', error: { code: 'FORBIDDEN', message: 'Not yours.' } }) });
  const notice = element();
  showLine(notice, await failureOf(refusing.opened(source)));
  clearUnreached(page(notice));
  assert.equal(notice.textContent, 'Not yours. It may still show as changed.');
});

test('a line goes when every failure on it was about reaching Theseus, whatever words came with them; a refusal, words alone or a control stay', () => {
  const status = element(), notice = element(), worded = element(), refusal = element(), control = element(), words = element(), button = { id: 'again' };
  showLine(status, lost());
  showLine(notice, refusedSession());
  showLine(worded, ['What changed since revision 2 could not be read.', lost()]);
  showLine(refusal, new AttemptError('This topic is closed.', 409, { error: { code: 'CONFLICT' } }));
  showLine(control, [lost(), button]);
  showLine(words, 'Write a reply before sending.');
  assert.deepEqual([status.textContent, status.hidden], ['Connection interrupted. Confirmation is unknown; your writing is kept.', false]);
  assert.equal(worded.textContent, 'What changed since revision 2 could not be read. Connection interrupted. Confirmation is unknown; your writing is kept.');
  assert.deepEqual(control.children, [' ', button], 'a control the line offers follows its words');
  clearUnreached(page(status, notice, worded, refusal, control, words));
  assert.deepEqual([status, notice, worded].map(line => [line.textContent, line.hidden, 'unreached' in line.dataset]), [['', true, false], ['', true, false], ['', true, false]]);
  assert.deepEqual([refusal, control, words].map(line => line.hidden), [false, false, false], 'a Core refusal, a control and words alone stay');
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
  showLine(mixed, [lost(), new AttemptError('Image upload was refused.', 413, { error: { code: 'TOO_LARGE' } })]);
  assert.equal(lineText([lost(), 'kept']), lost().message + ' kept');
  clearUnreached(page(both, mixed));
  assert.deepEqual([both.hidden, mixed.hidden], [true, false]);
});
