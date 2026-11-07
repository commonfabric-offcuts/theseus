// A restarted server hands out a new session, and the open page's old one is
// refused everywhere (reads, saves, the live feed). The page's own address
// carries the server's current session, as a Reload would read it, so the page
// reads it again and goes on with the same writing, lists and Reader.
//
// renew() settles 'renewed' when the page now holds a newer session, 'current'
// when the session it holds is the server's, and null when the server cannot
// be reached or offers no session for this instance and person (so nothing
// changed). Renewals asked for while one runs share it.
const PLACEHOLDER = '__AIM_SESSION_TOKEN__';

export function sessionIn(html) {
  const found = /<meta name="aim-next-session" content="([^"]*)">/.exec(html);
  if (!found) return null;
  const area = typeof document === 'undefined' ? null : document.createElement('textarea');
  // The server escapes the token as HTML; read it back the way the page's own meta did.
  const token = area ? (area.innerHTML = found[1], area.value) : found[1];
  return token && token !== PLACEHOLDER ? token : null;
}

export class SessionRenewal {
  constructor({ api, live = () => null, bootstrap, makeApi, fetcher = (...args) => globalThis.fetch(...args) }) {
    Object.assign(this, { api, live, bootstrap, makeApi, fetcher });
    this.running = null;
  }
  renew() {
    if (!this.running) this.running = this.read().finally(() => { this.running = null; });
    return this.running;
  }
  async read() {
    let token;
    try {
      const response = await this.fetcher('/', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return null;
      token = sessionIn(await response.text());
    } catch { return null; }
    if (!token) return null;
    if (token === this.api.token) return 'current';
    // The new session must speak for the same instance and person before any
    // writing or read goes through it.
    let answer;
    try { answer = await this.makeApi(token).bootstrap(); } catch { return null; }
    if (answer?.instance_id !== this.bootstrap.instance_id || answer.actor !== this.bootstrap.actor) return null;
    this.api.token = token;
    const live = this.live();
    if (live) live.token = token;
    const meta = document.querySelector('meta[name="aim-next-session"]');
    if (meta) meta.content = token;
    return 'renewed';
  }
}
