// An attempt that did not end in an answer the page can use. details is
// Theseus's own answer, when it gave one: it answers every request it reads
// with JSON (server.py _error and send_error), so an attempt without it got no
// answer at all, or one from something in front of Theseus, such as the 502
// with an empty body Tailscale Serve gives while the server restarts
// (docs/tailnet-access.md).
export class AttemptError extends Error {
  constructor(message, status = 0, details = null, options = undefined) {
    super(message, options);
    this.name = 'AttemptError';
    this.recorded = false;
    this.status = status;
    this.details = details;
    // When it failed, and when its attempt began (its maker stamps the start
    // when it knows it), on the clock of what the page knows (contact).
    this.at = this.began = tick();
  }
}

// What the page knows now of Theseus answering it. Every fact is stamped from
// one clock that only goes forward, so which came first is exact.
// - answered: when Theseus last answered: a request it answered (a refusal of
//   its own too, but not of the page's session), the live feed coming up or
//   naming a commit, or the server handing out its session (session-renewal.mjs).
// - live: whether the live feed is up now.
// Whatever depends on these listens (heard) and works its answer out from
// them afresh each time: a connection line (lines.mjs), and what waits on
// Theseus (app.mjs owe).
let clock = 0;
const tick = () => ++clock;
export const contact = { answered: 0, live: false };
const listeners = new Set();
export const heard = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const learned = () => { for (const listener of [...listeners]) listener(); };
export function answered() { contact.answered = tick(); learned(); }
function liveIs(up) {
  contact.live = up;
  if (up) answered(); else learned();
}
// The page's live feed (live.mjs): the one it follows says whether it is up.
let followed = null;
export function follow(live) {
  if (followed === live) return;
  followed = live; doubted = false;
  liveIs(live?.state === 'live');
  live?.listen(event => {
    if (followed !== live) return;
    // A new commit, or the socket's end before or after its first number,
    // settles a doubt (unansweredAttempt), as an answered request does; the
    // down that opening it again says first does not.
    if (event.kind === 'commit' || event.kind === 'refused' || event.state === 'down') doubted = false;
    if (event.kind === 'state') liveIs(event.state === 'live');
    else if (event.kind === 'commit') answered();
  });
}
// An attempt that got no answer, when nothing has answered since it began, is
// a reason to doubt a feed that reads live: a socket left half-open (a laptop
// that slept through a restart, a network that dropped before the browser
// noticed) reads live until the browser gives up on it. The page opens its
// feed again, and the new socket says whether it is connected; until it
// answers, it is not. One still out when something answered leaves it alone.
// Each attempt is judged once, from when it began: when it fails with no
// answer (attempted), or when the page gives up waiting on it (Deadline).
// One doubt opens the feed once: until Theseus answers a request, or the
// feed opened again names a new commit, or its socket ends, a later attempt
// with no answer opens nothing more. The new socket's first number says only
// that it is connected, and reads that fail again on it are no reason to
// replace it at once, so a feed is never opened again in a loop. A request
// Theseus answers settles the doubt, so a later drop that leaves the socket
// half-open is doubted afresh, on a quiet instance too.
let doubted = false;
function unansweredAttempt(began) {
  if (away || doubted || !contact.live || contact.answered > began) return;
  followed.reopen();
  doubted = true;
}
// The page has asked the browser to load another page (in-place-navigation.mjs
// leave), and asks Theseus nothing more until it is gone or is seen to stay.
// Safari's engine runs a load a moment after the page asks for it and cancels
// the reads the page started in that moment as the load begins, which can
// lose the load itself: the page that asked stays up at its old address for
// good. The commit of the page's own write is announced in just that moment,
// and the page's lists start their reads for it. So from depart an attempt
// waits, unsent, and one still out that ends meanwhile (the browser cancels
// it as the load begins) waits too, untold. When the page goes, they go with
// it. A load can still be stopped after it is asked for (the person stops it,
// or goes back), and then the page stays (stay): what waited is sent then, and
// one cancelled meanwhile fails as it did, judged as one the page stopped
// itself, since Theseus was not left to answer it. The live feed goes on, and
// a commit it names meanwhile is read once the page stays.
let away = null;
export function depart() {
  if (away) return;
  let release;
  away = { back: new Promise(resolve => { release = resolve; }), release };
}
export function stay() {
  const was = away; away = null;
  was?.release();
}
const stayed = async () => { while (away) await away.back; };
// The attempts out now under each signal, each with when it began: what a
// Deadline gives up on when it passes.
const out = new WeakMap();

// The server refused this page's session, as a restarted server does, before
// Core read the request.
export const sessionRefused = error => error instanceof AttemptError && error.status === 401 &&
  error.details?.error?.code === 'SESSION_REQUIRED';
// Theseus was not reached: the attempt got no answer of Theseus's own (nothing
// answered, only something in front of it did, or the page stopped waiting:
// Deadline), or the server refused this page's session. A failure a caller put into words of its own carries the
// attempt's error as its cause and is judged by it. The one place a failure is
// known to be about reaching Theseus (lines.mjs).
export const attemptOf = error => {
  for (let at = error, seen = new Set(); typeof at === 'object' && at !== null && !seen.has(at); seen.add(at), at = at.cause) {
    if (at instanceof AttemptError) return at;
  }
  return null;
};
export function unreached(error) {
  const at = attemptOf(error);
  return Boolean(at) && (at.details === null || sessionRefused(at));
}
// Theseus answered that it was too busy to take the attempt: a full read or
// request lane, every connection taken, a busy database or authority. The one
// place these codes are known (freshness.mjs readFailure reads them here too).
// A page says a busy Theseus in plain words of its own, never the server's.
const BUSY_CODES = new Set(['SERVER_BUSY', 'DATABASE_BUSY', 'AUTHORITY_BUSY']);
export const busyCode = code => BUSY_CODES.has(code);
// A failure or a receipt that is such an answer: an attempt error's answer, a
// view answer or receipt naming one of the codes, or a failure a caller put into
// words of its own with such an answer as its cause.
export function isBusy(value) {
  for (let at = value, seen = new Set(); typeof at === 'object' && at !== null && !seen.has(at); seen.add(at), at = at.cause) {
    if (busyCode((at.details ?? at).error?.code)) return true;
  }
  return false;
}
// A change's attempt that ended with no word from Theseus on whether it was
// recorded: no answer of Theseus's own (the connection dropped, an answer that
// could not be read, a wait given up on, or a failure that is no attempt's), or
// its answer that it could not confirm the attempt (REQUEST_UNCONFIRMED). Any
// other answer of Theseus's (a busy lane, a refused session, a refusal before
// Core read it) is that this attempt was not taken. Such a change may have been
// made, so it is never said to be unsaved, and what sends it again sends it as
// it was made, under the same operation: Core answers with what it recorded.
export function unconfirmed(error) {
  const answer = attemptOf(error)?.details;
  return !answer || answer.error?.code === 'REQUEST_UNCONFIRMED';
}
// What became of a change Core did not commit, from its attempt's failure
// (error) or Core's receipt, as every act on a card says it (stack-feed.mjs):
// 'unreached', no Theseus answered (a lost connection, which lines.mjs says
// while it lasts); 'unconfirmed', Theseus could not confirm it; 'busy' and
// 'restarted', Theseus answered that it took nothing; 'conflict', it changed
// on another tab or device; 'refused', any other refusal, with its own words
// (why). Only an unreached failure is a connection's.
export function notTaken({ error = null, receipt = null }) {
  const plain = words => String(words ?? '').trim().replace(/[.;:]+$/, '');
  if (receipt) {
    if (receipt.status === 'retryable') return { kind: 'busy' };
    return receipt.error?.code === 'REVISION_CONFLICT' ? { kind: 'conflict' } : { kind: 'refused', why: plain(receipt.error?.message) };
  }
  if (isBusy(error)) return { kind: 'busy' };
  if (sessionRefused(attemptOf(error))) return { kind: 'restarted' };
  if (unconfirmed(error)) return { kind: unreached(error) ? 'unreached' : 'unconfirmed' };
  return attemptOf(error)?.details?.error?.code === 'REVISION_CONFLICT' ? { kind: 'conflict' } : { kind: 'refused', why: plain(error?.message) };
}
// Why, in the page's words, for each kind notTaken gives but 'unreached' and 'refused'.
export const NOT_TAKEN = { busy: 'Theseus was busy', restarted: 'Theseus restarted', unconfirmed: 'Theseus could not confirm it', conflict: 'it changed on another tab or device' };
// Something has answered since the failure at at. The clock only goes
// forward, so this stays true: what that failure said is over for good.
export const answeredAfter = (at, { answered } = contact) => answered > at;
// A connection line shows while it says something true now: the page is not
// connected (its live feed is down) and nothing has answered since the failure
// it describes (at).
export const unanswered = (at, facts = contact) => !facts.live && !answeredAfter(at, facts);
// Theseus has answered since the attempt that failed began: what it held up can be done again.
export const answeredSince = error => contact.answered > attemptOf(error).began;
// The connection itself failed: no answer came.
const interrupted = (message, error) => new AttemptError(message, 0, null, { cause: error });
// Reconnect found no server to give this page a session.
export const notAnswering = () => new AttemptError('Theseus is not answering yet. Your writing is kept; this page reconnects when it is back.');

// How long the page waits for Theseus to answer. A wait it gives up on got no
// answer, so the deadline is kept here, beside the rule that says so: when it
// passes it aborts the requests made with its signal and ends the wait with a
// failure of no answer, whether or not what was awaited heard the abort.
// What it gave up on are the attempts out under its signal at that moment:
// each got no answer, and the failure began when the latest of them did, so
// what it held up is done again once Theseus answers after that
// (answeredSince). With none out, Theseus was asked nothing: the failure
// begins as it is made and doubts nothing.
export class Deadline {
  constructor(ms, words, code = undefined) {
    this.at = Date.now() + ms; this.words = words; this.code = code; this.controller = new AbortController();
  }
  get signal() { return this.controller.signal; }
  get passed() { return Date.now() >= this.at; }
  failure() {
    for (const attempt of out.get(this.signal) ?? []) this.began = Math.max(this.began ?? attempt.began, attempt.began);
    if (this.began !== undefined) unansweredAttempt(this.began);
    this.controller.abort();
    return Object.assign(new AttemptError(this.words, 0, null), this.began === undefined ? {} : { began: this.began }, this.code ? { code: this.code } : {});
  }
  // What the wait settles with, or this deadline's failure once it passes.
  async bound(wait) {
    let timer;
    const passed = new Promise((_, reject) => { timer = setTimeout(() => reject(this.failure()), Math.max(0, this.at - Date.now())); });
    try { return await Promise.race([wait, passed]); } finally { clearTimeout(timer); }
  }
}
// Theseus's JSON answer to a response, or null when what answered was not Theseus.
const answerOf = response => response.json().catch(() => null);
// Every attempt an Api makes: when it began, and, when Theseus answered it
// (what it asked for, or a refusal of Theseus's own), that it did (contact).
// One that got no answer may say the feed is gone; one the server refused for
// the Api's session is told to whoever holds that session (refused). While it
// is out it is listed under its signal (out). One that ends because its signal
// was aborted was judged already, or is not to be: a Deadline that gave up on
// it judged it from when it began, and one the page stopped itself (a
// foreground read stopping a background one, an image removed) was not left
// to Theseus to answer. While the page is leaving (depart), one waits before
// it begins, and one that fails waits for the page to stay and is not judged.
async function attempted(api, attempt, signal) {
  if (away) await stayed();
  const began = clock, entry = { began };
  if (signal) { if (!out.has(signal)) out.set(signal, new Set()); out.get(signal).add(entry); }
  try { const result = await attempt(); doubted = false; answered(); return result; }
  catch (error) {
    if (away) { out.get(signal)?.delete(entry); await stayed(); if (error instanceof AttemptError) error.began = began; throw error; }
    if (error instanceof AttemptError) {
      error.began = began;
      if (!unreached(error)) { doubted = false; answered(); }
      else if (!signal?.aborted) unansweredAttempt(began);
      if (sessionRefused(error)) api.refused(error);
    }
    throw error;
  } finally { out.get(signal)?.delete(entry); }
}

export class Api {
  constructor(token, fetcher = globalThis.fetch.bind(globalThis)) {
    this.token = token;
    this.fetcher = fetcher;
    // Told when the server refused this Api's session, as a restarted server
    // does: the page renews its session then (app.mjs).
    this.refused = () => {};
  }

  request(path, data, options) { return attempted(this, () => this.attempt(path, data, options), options?.signal); }
  async attempt(path, data, { signal, readClass } = {}) {
    let response;
    try {
      response = await this.fetcher(path, {
        method: data === undefined ? 'GET' : 'POST',
        credentials: 'same-origin', cache: 'no-store',
        headers: { Authorization: `Bearer ${this.token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...((path === '/api/view' || path === '/api/bootstrap') && readClass ? { 'X-AIM-Read-Class': readClass } : {}) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw interrupted('Connection interrupted. Confirmation is unknown; your writing is kept.', error);
    }
    let body;
    try { body = await response.json(); } catch (error) {
      throw new AttemptError('AIM returned an unreadable response. Confirmation is unknown.', response.status, null, { cause: error });
    }
    if (!response.ok) throw new AttemptError(body.error?.message ?? `This connection attempt was refused (${response.status}).`, response.status, body);
    return body;
  }

  bootstrap(options) { return this.request('/api/bootstrap', undefined, options); }
  command(envelope) { return this.request('/api/command', envelope); }
  view(name, args = {}, options) { return this.request('/api/view', { name, args }, options); }

  upload(envelope, blob, options) { return attempted(this, () => this.sendUpload(envelope, blob, options), options?.signal); }
  async sendUpload(envelope, blob, { signal } = {}) {
    const command = JSON.stringify(envelope).replace(/[\u007f-\uffff]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
    let response;
    try {
      response = await this.fetcher('/api/media/upload', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/octet-stream', 'X-AIM-Command': command },
        body: blob, ...(signal ? { signal } : {}),
      });
    } catch (error) { throw interrupted('Connection interrupted. Image confirmation is unknown.', error); }
    let body;
    try { body = await response.json(); }
    catch (error) { throw new AttemptError('Image confirmation is unreadable.', response.status, null, { cause: error }); }
    if (!response.ok) throw new AttemptError(body.error?.message ?? 'Image upload was refused.', response.status, body);
    return body;
  }

  media(instanceId, attachment, sourceRef) { return attempted(this, () => this.readMedia(instanceId, attachment, sourceRef)); }
  async readMedia(instanceId, attachment, sourceRef) {
    let response;
    try {
      response = await this.fetcher('/api/media/read', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_id: attachment.id, ...(sourceRef ? { source_ref: sourceRef } : {}) }),
      });
    } catch (error) { throw interrupted('Connection interrupted. This attachment could not be read.', error); }
    if (!response.ok) throw new AttemptError('This attachment is unavailable.', response.status, await answerOf(response));
    let descriptor;
    const header = response.headers.get('X-AIM-Media');
    try { if (!header || header.length > 8192) throw Error(); descriptor = JSON.parse(header); }
    catch (error) { await response.body?.cancel(); throw Error('The attachment descriptor is unavailable.', { cause: error }); }
    if (descriptor.instance_id !== instanceId || descriptor.media_id !== attachment.id ||
        !['name', 'content_type', 'size_bytes', 'sha256', 'inline'].every(key => descriptor[key] === attachment[key]) ||
        !Number.isInteger(descriptor.size_bytes) || descriptor.size_bytes < 1 || descriptor.size_bytes > 64 * 1024 * 1024) {
      await response.body?.cancel(); throw Error('The attachment identity does not match this source.');
    }
    const reader = response.body.getReader(), chunks = [];
    let length = 0;
    try {
      while (true) {
        let chunk;
        try { chunk = await reader.read(); }
        catch (error) { throw interrupted('Connection interrupted while this attachment was read.', error); }
        const { done, value } = chunk; if (done) break;
        length += value.byteLength;
        if (length > descriptor.size_bytes) throw Error('Attachment bytes exceed the verified size.');
        chunks.push(value);
      }
    } catch (error) {
      // A stream that already failed refuses its cancel with that same failure; the one caught here says what happened.
      await reader.cancel().catch(() => {}); throw error;
    }
    const inline = descriptor.inline === true && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(descriptor.content_type);
    const blob = new Blob(chunks, { type: inline ? descriptor.content_type : 'application/octet-stream' });
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (length !== descriptor.size_bytes || digest !== descriptor.sha256) throw Error('Attachment bytes do not match the verified digest.');
    return { descriptor, blob, inline };
  }
}
