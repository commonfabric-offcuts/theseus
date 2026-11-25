// A restarted server hands out a new session, and the open page's old one is
// refused everywhere (reads, saves, the live feed). The page's own address
// carries the server's current session, as a Reload would read it, so the page
// reads it again and goes on with the same writing, lists and Reader.
//
// renew() settles 'renewed' when the page now holds a newer session, 'current'
// when the session it holds is the server's, and null when the server cannot
// be reached or offers no session for this instance and person (so nothing
// changed). Renewals asked for while one runs share it.
import { answered } from './api.mjs';

const PLACEHOLDER = '__AIM_SESSION_TOKEN__';
// The server writes the token HTML-escaped (Python's html.escape with quotes).
const ESCAPED = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" };

export function sessionIn(html) {
  const found = /<meta name="aim-next-session" content="([^"]*)">/.exec(html);
  const token = found?.[1].replace(/&(?:amp|lt|gt|quot|#x27);/g, entity => ESCAPED[entity]);
  return token && token !== PLACEHOLDER ? token : null;
}

export class SessionRenewal {
  // adopted(token) is told each newer session the page takes, after api and live hold it.
  constructor({ api, live = () => null, bootstrap, makeApi, adopted = () => {}, fetcher = (...args) => globalThis.fetch(...args) }) {
    Object.assign(this, { api, live, bootstrap, makeApi, adopted, fetcher });
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
    // The server answered with its session (api.mjs contact).
    answered();
    if (token === this.api.token) return 'current';
    // The new session must speak for the same instance and person before any
    // writing or read goes through it.
    let answer;
    try { answer = await this.makeApi(token).bootstrap(); } catch { return null; }
    if (answer?.instance_id !== this.bootstrap.instance_id || answer.actor !== this.bootstrap.actor) return null;
    this.api.adoptReadFormats?.(answer);
    this.api.token = token;
    const live = this.live();
    if (live) live.token = token;
    this.adopted(token);
    return 'renewed';
  }
}
