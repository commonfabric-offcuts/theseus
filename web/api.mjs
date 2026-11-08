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
  }
}

// The server refused this page's session, as a restarted server does, before
// Core read the request.
export const sessionRefused = error => error instanceof AttemptError && error.status === 401 &&
  error.details?.error?.code === 'SESSION_REQUIRED';
// Theseus was not reached: the attempt got no answer of Theseus's own (nothing
// answered, only something in front of it did, or the page stopped waiting:
// Deadline), or the server refused this page's session. A failure a caller put into words of its own carries the
// attempt's error as its cause and is judged by it. The one place a failure is
// known to be about reaching Theseus; reaching it again ends it (lines.mjs).
export function unreached(error) {
  for (let at = error, seen = new Set(); typeof at === 'object' && at !== null && !seen.has(at); seen.add(at), at = at.cause) {
    if (at instanceof AttemptError) return at.details === null || sessionRefused(at);
  }
  return false;
}
// The connection itself failed: no answer came.
const interrupted = (message, error) => new AttemptError(message, 0, null, { cause: error });
// Reconnect found no server to give this page a session.
export const notAnswering = () => new AttemptError('Theseus is not answering yet. Your writing is kept; this page reconnects when it is back.');

// How long the page waits for Theseus to answer. A wait it gives up on got no
// answer, so the deadline is kept here, beside the rule that says so: when it
// passes it aborts the requests made with its signal and ends the wait with a
// failure of no answer, whether or not what was awaited heard the abort.
export class Deadline {
  constructor(ms, words, code = undefined) {
    this.at = Date.now() + ms; this.words = words; this.code = code; this.controller = new AbortController();
  }
  get signal() { return this.controller.signal; }
  get passed() { return Date.now() >= this.at; }
  failure() {
    this.controller.abort();
    return Object.assign(new AttemptError(this.words, 0, null), this.code ? { code: this.code } : {});
  }
  // What the wait settles with, or this deadline's failure once it passes.
  async bound(wait) {
    let timer;
    const passed = new Promise((_, reject) => { timer = setTimeout(() => reject(this.failure()), this.at - Date.now()); });
    try { return await Promise.race([wait, passed]); } finally { clearTimeout(timer); }
  }
}
// Theseus's JSON answer to a response, or null when what answered was not Theseus.
const answerOf = response => response.json().catch(() => null);

export class Api {
  constructor(token, fetcher = globalThis.fetch.bind(globalThis)) {
    this.token = token;
    this.fetcher = fetcher;
  }

  async request(path, data, { signal, readClass } = {}) {
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

  async upload(envelope, blob, { signal } = {}) {
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

  async media(instanceId, attachment, sourceRef) {
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
