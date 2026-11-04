export class AttemptError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = 'AttemptError';
    this.recorded = false;
    this.status = status;
    this.details = details;
  }
}

export class Api {
  constructor(token, fetcher = globalThis.fetch.bind(globalThis)) {
    this.token = token;
    this.fetcher = fetcher;
  }

  async request(path, data) {
    let response;
    try {
      response = await this.fetcher(path, {
        method: data === undefined ? 'GET' : 'POST',
        credentials: 'same-origin', cache: 'no-store',
        headers: { Authorization: `Bearer ${this.token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
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

  bootstrap() { return this.request('/api/bootstrap'); }
  command(envelope) { return this.request('/api/command', envelope); }
  view(name, args = {}) { return this.request('/api/view', { name, args }); }

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
    const blob = new Blob(chunks, { type: descriptor.content_type });
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (length !== descriptor.size_bytes || digest !== descriptor.sha256) throw Error('Attachment bytes do not match the verified digest.');
    return { descriptor, blob, inline: descriptor.inline === true && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(descriptor.content_type) };
  }
}
