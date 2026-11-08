// The page's lines work out from the failure they show whether it is about
// reaching Theseus, and such a line shows only while the page is not connected
// and nothing has answered since that failure (web/lines.mjs, web/api.mjs
// unreached, unanswered, contact).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Api, AttemptError, Deadline, unreached, sessionRefused, unanswered, answeredSince, answered, contact, follow } from '../web/api.mjs';
import { Live } from '../web/live.mjs';
import { PageReads } from '../web/page-reads.mjs';
import { showLine, lineText } from '../web/lines.mjs';
import { RecoveryCleanup } from '../web/cleanup.mjs';
import { RuntimeAuthority } from '../web/session.mjs';

const lost = () => new AttemptError('Connection interrupted. Confirmation is unknown; your writing is kept.');
const refusedSession = () => new AttemptError('Open this instance to establish a session.', 401, { error: { code: 'SESSION_REQUIRED', message: 'Open this instance to establish a session.' } });
const element = () => ({ textContent: '', hidden: true, dataset: {}, children: [], append(...items) { this.children.push(...items); } });
const said = line => line.hidden ? '' : line.textContent;

// What answers while Theseus restarts behind Tailscale Serve (docs/tailnet-access.md):
// the proxy's 502 with an empty body. Theseus's own answers are JSON.
const proxyDown = () => new Response('', { status: 502 });
const theseus = (status, error) => new Response(JSON.stringify({ recorded: false, error }), { status, headers: { 'Content-Type': 'application/json' } });
const nothing = () => { throw new TypeError('Failed to fetch'); };
const failureOf = promise => promise.then(() => assert.fail('the attempt was meant to fail'), error => error);
// Theseus answers a request: the sign every line waits for.
const answers = () => new Api('session', async () => theseus(200, null)).view('attention', {});

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
test('a page read that met no server leaves a notice that goes when Theseus answers; one Core refused stays', async () => {
  const source = { source_ref: { kind: 'memory', id: 'n1', revision: 2 } };
  for (const [name, fetcher] of [['nothing answered', nothing], ['the proxy answered', proxyDown]]) {
    const api = new Api('session', async () => fetcher());
    const reads = new PageReads({ send: (id, revision) => api.command({ v: 1, kind: 'memory.read', args: { id, revision } }) });
    const notice = element();
    showLine(notice, await failureOf(reads.opened(source)));
    assert.equal(notice.hidden, false, `${name}: the notice says the read failed`);
    await answers();
    assert.equal(said(notice), '', `${name}: the reader notice still says: ${notice.textContent}`);
  }
  const refusing = new PageReads({ send: async () => ({ status: 'rejected', error: { code: 'FORBIDDEN', message: 'Not yours.' } }) });
  const notice = element();
  showLine(notice, await failureOf(refusing.opened(source)));
  await answers();
  assert.equal(notice.textContent, 'Not yours. It may still show as changed.');
});

test('a line goes when Theseus answers if every failure on it was about reaching Theseus, whatever words came with them; a refusal, words alone or a control stay', () => {
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
  answered();
  assert.deepEqual([status, notice, worded].map(line => [line.textContent, line.hidden, 'unreached' in line.dataset]), [['', true, false], ['', true, false], ['', true, false]]);
  assert.deepEqual([refusal, control, words].map(line => line.hidden), [false, false, false], 'a Core refusal, a control and words alone stay');
});

test('a line written again says what it says now: a connection line replaced by another stays, and an empty line is hidden', () => {
  const status = element();
  showLine(status, lost());
  showLine(status, 'This topic is closed.');
  answered();
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
  answered();
  assert.deepEqual([both.hidden, mixed.hidden], [true, false]);
});

// A wait the page gives up on is a request that got no answer. The page's
// deadlines (a Reader open, its next or previous message, Retry access, a
// recovery read) end the request through the one place that knows whether
// Theseus answered, so the line they leave goes once Theseus answers.
// The real Api, RecoveryCleanup, RuntimeAuthority and line.
const authority = { authority_id: 'a1', authority_epoch: 'e1', continuity: 'initial' };
// A browser's fetch that never answers and ends when its request is aborted; or one that ignores the abort.
const aborted = [];
const stalled = (path, init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => { aborted.push(path); reject(new DOMException('The operation was aborted.', 'AbortError')); }, { once: true }));
const deaf = () => new Promise(() => {});
const coreRefuses = async () => theseus(409, { code: 'CONFLICT', message: 'This topic is closed.' });
const cleanupWith = (fetcher, admission = true) => new RecoveryCleanup({ api: new Api('session', fetcher), changed: () => {},
  bootstrap: admission ? { transport: { read_admission: { version: 1, header: 'X-AIM-Read-Class', foreground: { slots: 1, max_waiters: 8, queue_timeout_ms: 5000 }, background: { slots: 1, max_waiters: 2, queue_timeout_ms: 500 } } } } : {},
  journal: {}, runtime: { readTimeoutMs: 30 } });
const lineFor = async promise => { const line = element(); showLine(line, await failureOf(promise)); return line; };

test('a read the page stopped waiting for leaves a line that goes when Theseus answers; one Core answered stays', async () => {
  const lines = {};
  for (const [name, fetcher] of [['nothing answers', stalled], ['nothing answers and the abort is not heard', deaf]]) {
    const cleanup = cleanupWith(fetcher), fg = cleanup.foreground();
    lines[`Reader open: ${name}`] = await lineFor(fg.read(options => cleanup.api.view('source', {}, options)));
    fg.release();
  }
  // Without the server's read lanes, the open waits behind a background read until its own deadline passes, and sends nothing.
  let sent = 0;
  const queued = cleanupWith(() => { ++sent; return deaf(); }, false), background = queued.read(options => queued.api.view('operation', {}, options)).catch(() => {});
  queued.runtime.readTimeoutMs = 10;
  const fg = queued.foreground();
  lines['Reader open behind a background read'] = await lineFor(fg.read(options => queued.api.view('source', {}, options)));
  assert.equal(sent, 1, 'the open that ran out of time while it waited sent no request');
  fg.release(); await background;
  // Its time ran out before it read at all (keeping the writing first took that long).
  const spent = cleanupWith(() => { ++sent; return deaf(); });
  spent.runtime.readTimeoutMs = 0;
  const late = spent.foreground();
  lines['Reader open whose time ran out before it read'] = await lineFor(late.read(options => spent.api.view('source', {}, options)));
  assert.equal(sent, 1, 'the open whose time ran out sent no request');
  late.release();
  const runtime = new RuntimeAuthority({ api: new Api('session', stalled), instanceId: 'i1', authority, readTimeoutMs: 30 });
  lines['recovery read'] = await lineFor(runtime.read(options => runtime.api.bootstrap(options)));
  for (const [name, line] of Object.entries(lines)) assert.equal(line.hidden, false, `${name}: the line says the read failed`);
  assert.deepEqual(aborted, ['/api/view', '/api/bootstrap'], 'the requests the page stopped waiting for are aborted');
  const refused = cleanupWith(coreRefuses), refusing = refused.foreground();
  const kept = await lineFor(refusing.read(options => refused.api.view('source', {}, options)));
  answered();
  assert.deepEqual(Object.entries(lines).map(([name, line]) => [name, line.hidden ? '' : line.textContent]), Object.keys(lines).map(name => [name, '']));
  assert.equal(kept.textContent, 'This topic is closed.', 'Core\'s answer stays');
});


// What the page knows of Theseus answering it decides every connection line:
// an answer of any kind since the line's failure, or the live feed up now or
// up since that failure. Nothing counts reconnections.
const gated = answer => { const gate = { open: null }; const opened = new Promise(resolve => { gate.open = resolve; });
  return { gate, api: new Api('session', async () => { await opened; return answer(); }) }; };
const ways = [['request', a => a.view('source', {})], ['upload', a => a.upload({ v: 1 }, new Blob(['x']))], ['media', a => a.media('instance', { id: 'm1' }, null)]];

test('every way the page makes an attempt says when Theseus answered it: what it asked for or a refusal of its own, not nothing, a proxy or a refused session', async () => {
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([1])))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const attachment = { id: 'm1', name: 'a.png', content_type: 'image/png', size_bytes: 1, sha256, inline: true };
  const header = JSON.stringify({ instance_id: 'instance', media_id: 'm1', ...attachment });
  const ok = { request: () => theseus(200, null), upload: () => theseus(200, null), media: () => new Response(new Uint8Array([1]), { status: 200, headers: { 'X-AIM-Media': header } }) };
  for (const [name, attempt] of [...ways.slice(0, 2), ['media', a => a.media('instance', attachment, null)]]) {
    for (const [what, answer, counts] of [['what it asked for', ok[name], true], ['a refusal of its own', () => theseus(409, { code: 'CONFLICT', message: 'Closed.' }), true],
      ['nothing', nothing, false], ['the proxy', proxyDown, false], ['a refused session', () => theseus(401, { code: 'SESSION_REQUIRED', message: 'Open this instance.' }), false]]) {
      const before = contact.answered;
      await attempt(new Api('session', async () => answer())).catch(() => {});
      assert.equal(contact.answered > before, counts, `${name}: ${what}`);
    }
  }
});

test('a connection line shows only while the page is not connected and nothing has answered since its failure', async () => {
  const line = element(), other = element();
  // Nothing answered since: it shows, and goes at the first answer, of a request or of the live feed.
  showLine(line, lost()); showLine(other, ['Could not open.', Error('In words of its own.', { cause: refusedSession() })]);
  assert.deepEqual([said(line), 'unreached' in line.dataset, said(other)], [lost().message, true, 'Could not open. In words of its own.']);
  await failureOf(new Api('session', async () => nothing()).view('x', {}));
  assert.equal(said(line), lost().message, 'a request that got no answer is no answer');
  await answers();
  assert.deepEqual([said(line), line.hidden, 'unreached' in line.dataset, said(other)], ['', true, false, ''], 'a request Theseus answered');
  // The live feed: up now hides every connection line; one it hid shows again
  // when it goes down if nothing has answered since its failure, and one that
  // something answered after never comes back.
  const feed = new Live({ token: 'session', socket: () => ({ close() {} }), timers: { setTimeout: () => 1, clearTimeout() {} }, origin: 'https://fixture' });
  follow(feed); feed.start();
  showLine(line, lost());
  assert.equal(said(line), lost().message, 'a feed that has not come up says nothing');
  feed.current.socket.onmessage({ data: JSON.stringify({ seq: 1 }) });
  assert.deepEqual([contact.live, said(line), 'unreached' in line.dataset], [true, '', false], 'the live feed came up');
  showLine(line, lost());
  assert.deepEqual([said(line), 'unreached' in line.dataset], ['', false], 'a failure while the live feed is up');
  feed.current.socket.onclose();
  assert.deepEqual([contact.live, said(line), 'unreached' in line.dataset], [false, lost().message, true], 'the feed goes down and nothing has answered since that failure: the line shows again');
  feed.start(); feed.current.socket.onmessage({ data: JSON.stringify({ seq: 1 }) });
  assert.equal(said(line), '', 'the feed came up: an answer after it');
  feed.current.socket.onclose();
  assert.equal(said(line), '', 'answered after it: it never comes back');
  feed.start(); feed.current.socket.onmessage({ data: JSON.stringify({ seq: 2 }) });
  const whileUp = lost();
  feed.current.socket.onmessage({ data: JSON.stringify({ seq: 3 }) });
  const afterCommit = lost();
  feed.current.socket.onclose();
  showLine(line, ['Could not open.', whileUp]);
  assert.equal(said(line), '', 'a commit the feed named came after it');
  showLine(line, ['Could not open.', afterCommit]);
  assert.equal(said(line), 'Could not open. ' + lost().message, 'a failure while the feed was up, after its last message, written once it went down');
  // A refused session is no answer; the session handed out again is (session-renewal.mjs).
  await failureOf(new Api('session', async () => theseus(401, { code: 'SESSION_REQUIRED', message: 'Open this instance.' })).view('x', {}));
  assert.equal(said(line), 'Could not open. ' + lost().message, 'a refused session');
  follow(null);
});

test('a line\'s latest failure decides it, and a line with a control of its own or an answer Theseus gave stays', () => {
  const old = lost();
  answered();
  const line = element(), control = element(), button = { id: 'again' };
  showLine(line, [old, lost()]);
  assert.equal(said(line), lost().message, 'one failure answered since and one not: the line still says so');
  showLine(control, [lost(), button]);
  answered();
  assert.deepEqual([said(line), control.hidden, control.children], ['', false, [' ', button]], 'a control the line offers keeps it');
  // Written after an answer for a failure from before it: no line at all.
  const stale = lost(); answered();
  showLine(line, ['Could not open.', stale]);
  assert.deepEqual([line.hidden, line.textContent, 'unreached' in line.dataset], [true, '', false]);
  // The pure rule itself: not connected now, and nothing answered since. Nothing else.
  assert.equal(unanswered(5, { answered: 4, live: false }), true);
  assert.equal(unanswered(5, { answered: 6, live: false }), false, 'answered since');
  assert.equal(unanswered(5, { answered: 4, live: true }), false, 'connected now');
});

// What a failure held up is done again once Theseus has answered since its
// attempt began: an attempt still out when an answer came, or a wait the page
// bounds that was set before it, is done again at once; one begun after waits.
test('Theseus has answered since an attempt began, for every way the page makes one and for a wait it bounds', async () => {
  for (const [name, attempt] of ways) {
    const before = gated(nothing), out = failureOf(attempt(before.api));
    answered(); before.gate.open();
    const failure = await out;
    assert.equal(answeredSince(Error('In words of its own.', { cause: failure })), true, `${name}: begun before an answer`);
    const after = gated(nothing); after.gate.open();
    assert.equal(answeredSince(await failureOf(attempt(after.api))), false, `${name}: begun after`);
  }
  const early = new Deadline(0, 'Reader request timed out. Your writing is kept.');
  answered();
  const ranOut = await failureOf(early.bound(new Promise(() => {}))), late = await failureOf(new Deadline(0, 'Reader request timed out. Your writing is kept.').bound(new Promise(() => {})));
  assert.deepEqual([answeredSince(ranOut), answeredSince(late), unreached(ranOut)], [true, false, true], 'a deadline set before an answer, and one set after');
});

// A socket can read 'live' over a connection that is gone (a laptop that slept
// through a restart, a network that dropped before the browser noticed). An
// attempt that got no answer, when nothing has answered since it began, is the
// page's reason to doubt it: it opens its feed again, and until the new socket
// answers the page is not connected, so the line says what happened. An
// attempt still out when something answered, one Theseus answered, or one made
// while the feed is already down leaves the feed alone.
test('an attempt that got no answer, with nothing answered since it began, makes the page open its live feed again; nothing else does', async () => {
  const sockets = [];
  const feed = new Live({ token: 'session', socket: () => { const socket = { closed: false, close() { this.closed = true; } }; sockets.push(socket); return socket; },
    timers: { setTimeout: () => 1, clearTimeout() {} }, origin: 'https://fixture' });
  follow(feed); feed.start();
  const up = () => { if (!feed.current) feed.start(); feed.current.socket.onmessage({ data: JSON.stringify({ seq: 1 }) }); };
  const line = element();
  for (const [name, attempt] of [...ways, ['a wait the page bounds', () => new Deadline(0, 'Reader request timed out. Your writing is kept.').bound(new Promise(() => {}))]]) {
    for (const [what, answer] of [['nothing', nothing], ['the proxy', proxyDown], ['a refused session', () => theseus(401, { code: 'SESSION_REQUIRED', message: 'Open this instance.' })]]) {
      if (name === 'a wait the page bounds' && what !== 'nothing') continue;
      up();
      const before = sockets.length, doubted = sockets.at(-1);
      showLine(line, await failureOf(attempt(new Api('session', async () => answer()))));
      assert.deepEqual([sockets.length - before, doubted.closed, feed.state, said(line) !== ''], [1, true, 'down', true],
        `${name}, ${what}: the feed reads live, nothing answered since the attempt began, yet it got no answer: the feed is opened again and the line shows`);
      up();
      assert.equal(said(line), '', `${name}, ${what}: the new socket answered`);
    }
  }
  // Theseus answered: a refusal of its own.
  up();
  let before = sockets.length;
  await failureOf(new Api('session', async () => theseus(409, { code: 'CONFLICT', message: 'Closed.' })).view('x', {}));
  assert.equal(sockets.length, before, 'Theseus answered: the feed is left alone');
  // Still out when the feed named a commit: something answered since it began.
  const out = gated(nothing), failing = failureOf(out.api.view('x', {}));
  feed.current.socket.onmessage({ data: JSON.stringify({ seq: 2 }) });
  out.gate.open();
  showLine(line, await failing);
  assert.deepEqual([sockets.length, feed.state, said(line)], [before, 'live', ''], 'answered while it was out: the feed is left alone, and the page is connected');
  // Down already: the feed's own retry is not hurried.
  feed.current.socket.onclose();
  before = sockets.length;
  await failureOf(new Api('session', async () => nothing()).view('x', {}));
  assert.equal(sockets.length, before, 'the feed is down: nothing is opened');
  follow(null);
});

// A refusal of the page's session, as a restarted server gives, is told to
// whoever holds the session (app.mjs renews it), from that Api alone.
test('an Api tells its holder when the server refused its session, and on nothing else', async () => {
  for (const [what, answer, told] of [['a refused session', () => theseus(401, { code: 'SESSION_REQUIRED', message: 'Open this instance.' }), 1],
    ['another 401', () => theseus(401, { code: 'OTHER', message: 'No.' }), 0], ['a refusal of its own', () => theseus(409, { code: 'CONFLICT', message: 'Closed.' }), 0],
    ['nothing', nothing, 0], ['the proxy', proxyDown, 0], ['an answer', () => theseus(200, null), 0]]) {
    for (const [name, attempt] of ways) {
      const api = new Api('session', async () => answer()), other = new Api('session', async () => answer());
      let heardOf = 0;
      api.refused = () => { heardOf++; };
      await attempt(api).catch(() => {});
      assert.equal(heardOf, told, `${name}: ${what}`);
      await attempt(other).catch(() => {});
      assert.equal(heardOf, told, `${name}: ${what}, through another Api`);
    }
  }
});

// The page stops requests of its own: a foreground read stops the background
// read in flight where the server keeps the lanes apart (cleanup.mjs
// foreground), and removing an image stops its upload. Theseus was not asked
// to answer, so none of these says anything of the live feed: it is left
// alone, and a line hidden while the page was connected stays hidden. A wait
// the page gives up on is different: nothing answered in time, so a
// background read that runs out doubts the feed as a Reader open's deadline does.
test('a request the page stopped itself leaves the live feed alone; one it gave up waiting for makes the page open the feed again', async () => {
  const sockets = [];
  const feed = new Live({ token: 'session', socket: () => { const socket = { closed: false, close() { this.closed = true; } }; sockets.push(socket); return socket; },
    timers: { setTimeout: () => 1, clearTimeout() {} }, origin: 'https://fixture' });
  follow(feed); feed.start();
  const up = () => feed.current.socket.onmessage({ data: JSON.stringify({ seq: 1 }) });
  const turns = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  // A browser's fetch to a server that answers every request, when let to, and ends when its request is aborted.
  const answering = [];
  const browser = (path, init) => new Promise((resolve, reject) => {
    answering.push(() => resolve(theseus(200, null)));
    init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
  });
  const silent = (path, init) => new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true }));
  const stoppedBy = async (start) => { const controller = new AbortController(), failing = failureOf(start(controller.signal)); await turns(); controller.abort(); return failing; };
  const line = element();
  for (const [what, stop] of [
    ['a foreground read stopped the background read in flight', async () => {
      const cleanup = cleanupWith(browser); cleanup.runtime.readTimeoutMs = 60000;
      const background = failureOf(cleanup.read(options => cleanup.api.view('changes', {}, options)));
      await turns();
      const foreground = cleanup.foreground(), opening = foreground.read(options => cleanup.api.view('source', {}, options));
      await background; await turns();
      const after = [sockets.length, feed.state];
      answering.at(-1)(); await opening; foreground.release();
      return after;
    }],
    ['a request the page aborted', async () => { await stoppedBy(signal => new Api('session', browser).view('source', {}, { signal })); return [sockets.length, feed.state]; }],
    ['an upload the person removed', async () => { await stoppedBy(signal => new Api('session', browser).upload({ v: 1 }, new Blob(['x']), { signal })); return [sockets.length, feed.state]; }],
    ['a request the page aborted while its answer was read', async () => {
      await stoppedBy(signal => new Api('session', (path, init) => new Response(new ReadableStream({ start(body) {
        init.signal.addEventListener('abort', () => body.error(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
      } }), { status: 200 })).view('source', {}, { signal }));
      return [sockets.length, feed.state];
    }],
  ]) {
    up();
    const before = sockets.length;
    showLine(line, lost());
    assert.equal(said(line), '', `${what}: a failure while connected is hidden`);
    assert.deepEqual(await stop(), [before, 'live'], `${what}: Theseus was never left unanswering, yet the page let its live feed go and opened another`);
    assert.deepEqual([sockets.length, feed.state, said(line)], [before, 'live', ''], `${what}: the feed is left alone and the hidden line stays hidden`);
  }
  for (const [what, giveUp] of [
    ['a background read that ran out', () => { const cleanup = cleanupWith(silent); return failureOf(cleanup.read(options => cleanup.api.view('changes', {}, options))); }],
    ['a Reader open that ran out', async () => {
      const cleanup = cleanupWith(silent), foreground = cleanup.foreground();
      try { return await failureOf(foreground.read(options => cleanup.api.view('source', {}, options))); } finally { foreground.release(); }
    }],
  ]) {
    up();
    const before = sockets.length, doubted = sockets.at(-1);
    showLine(line, await giveUp());
    assert.deepEqual([sockets.length - before, doubted.closed, feed.state, said(line) !== ''], [1, true, 'down', true],
      `${what}: nothing answered in time, so the feed is opened again and the line shows`);
  }
  follow(null);
});
