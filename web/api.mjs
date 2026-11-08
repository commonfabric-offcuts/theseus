export class AttemptError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
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
// Theseus was not reached: the attempt got no answer at all (the server is
// away), or the server refused this page's session. The one place a failure is
// known to be about reaching Theseus; reaching it again ends it (lines.mjs).
export const unreached = error => error instanceof AttemptError && (error.status === 0 || sessionRefused(error));

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
    } catch {
      throw new AttemptError('Connection interrupted. Confirmation is unknown; your writing is kept.');
    }
    let body;
    try { body = await response.json(); } catch {
      throw new AttemptError('AIM returned an unreadable response. Confirmation is unknown.', response.status);
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
    } catch { throw new AttemptError('Connection interrupted. Image confirmation is unknown.'); }
    let body;
    try { body = await response.json(); }
    catch { throw new AttemptError('Image confirmation is unreadable.', response.status); }
    if (!response.ok) throw new AttemptError(body.error?.message ?? 'Image upload was refused.', response.status, body);
    return body;
  }

  async media(instanceId, attachment, sourceRef) {
    const response = await this.fetcher('/api/media/read', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_id: attachment.id, ...(sourceRef ? { source_ref: sourceRef } : {}) }),
    });
    if (!response.ok) throw new AttemptError('This attachment is unavailable.', response.status);
    let descriptor;
    const header = response.headers.get('X-AIM-Media');
    try { if (!header || header.length > 8192) throw Error(); descriptor = JSON.parse(header); }
    catch { await response.body?.cancel(); throw Error('The attachment descriptor is unavailable.'); }
    if (descriptor.instance_id !== instanceId || descriptor.media_id !== attachment.id ||
        !['name', 'content_type', 'size_bytes', 'sha256', 'inline'].every(key => descriptor[key] === attachment[key]) ||
        !Number.isInteger(descriptor.size_bytes) || descriptor.size_bytes < 1 || descriptor.size_bytes > 64 * 1024 * 1024) {
      await response.body?.cancel(); throw Error('The attachment identity does not match this source.');
    }
    const reader = response.body.getReader(), chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > descriptor.size_bytes) throw Error('Attachment bytes exceed the verified size.');
        chunks.push(value);
      }
    } catch (error) { await reader.cancel(); throw error; }
    const inline = descriptor.inline === true && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(descriptor.content_type);
    const blob = new Blob(chunks, { type: inline ? descriptor.content_type : 'application/octet-stream' });
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (length !== descriptor.size_bytes || digest !== descriptor.sha256) throw Error('Attachment bytes do not match the verified digest.');
    return { descriptor, blob, inline };
  }
}
