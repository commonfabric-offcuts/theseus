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
}
