// The Health link that heads every page (docs/health.md): quiet while Core
// says nothing is red, and lit, in words and the alert colour, while Core says
// something is, by the same rule the Health page reads.
//
// Every answer it has is tied to the commit it is true at. Core keeps what is
// red with every commit, and the live feed sends it with that commit's number
// ({seq, health: {red, seq}}), so on a current server the link follows the
// feed alone and reads nothing. A commit that comes without it (an older
// server, or a commit Core kept none for) is read through the health_light
// view, whose answer names its commit (commit_seq). What the link shows is a
// pure function of what it has (`standing`): the answer with the highest
// commit, never an older one, and never an answer from before the feed last
// came back as if it were current.
export const LIT_WORDS = 'Health · needs attention';
export const UNREAD_WORDS = "Health · couldn't check";
export const CHECKING_WORDS = 'Health · checking';

// Whether the live feed has dropped, so what was read may be out of date. The
// Health page says so at its top by the same rule (health.mjs).
export const feedLost = feed => feed === 'down';

const keys = red => Array.isArray(red) && red.every(key => typeof key === 'string');

// What is red at a commit, from a live feed event, or null when the event carries none for its commit.
export function feedAnswer(event) {
  const health = event?.health;
  return Number.isSafeInteger(event?.seq) && health?.seq === event.seq && keys(health.red) ? { seq: event.seq, red: health.red } : null;
}

// What the link says, from its facts alone: 'checking', 'unread', 'lit' or 'quiet'.
//   best:   the answer with the highest commit it has, {seq, red}, or null;
//   known:  the highest commit number it has heard of (-1 for none);
//   floor:  the commit the feed named when it last came back: an answer from
//           before it may be out of date (-1 until the feed has spoken);
//   failed: its latest read failed and no answer has come since;
//   feed:   'live', 'down', or null when the server offers none.
export function standing({ best, known, floor, failed, feed }) {
  if (feedLost(feed)) return 'unread';
  // A failed read matters unless the feed is live and an answer, from the feed or a read, is at the latest commit.
  if (failed && (feed !== 'live' || !best || best.seq < known)) return 'unread';
  if (!best || best.seq < floor) return 'checking';
  return best.red.length ? 'lit' : 'quiet';
}

export class HealthLight {
  // read: the health_light view; feed: the live feed's state ('live', 'down', or null).
  constructor({ link, read, feed = () => null, observe = null }) {
    Object.assign(this, { link, read, feed, observe });
    this.best = null; this.known = -1; this.floor = -1; this.failed = false;
    this.running = null; this.again = false; this.asking = -1;
  }

  facts() {
    return { best: this.best, known: this.known, floor: this.floor, failed: this.failed, feed: this.feed() };
  }

  // Take an answer true at its commit: one from the feed only when it is newer
  // than what the link has; one read when it is at least as new, since a read
  // at a commit is taken after Core kept what was red at it.
  take(answer, read) {
    this.known = Math.max(this.known, answer.seq);
    if (!this.best || answer.seq > this.best.seq || (read && answer.seq === this.best.seq)) this.best = answer;
    this.failed = false;
  }

  // A live feed event: {kind: 'commit', seq, health} or {kind: 'state', state, seq, health}.
  heard(event) {
    if (Number.isSafeInteger(event?.seq)) {
      this.known = Math.max(this.known, event.seq);
      if (event.kind === 'state' && event.state === 'live') this.floor = event.seq;
    }
    const answer = feedAnswer(event);
    if (answer) this.take(answer, false);
    this.paint();
    // Behind the latest commit with nothing from the feed to say it: read it,
    // unless the read running began at that commit already.
    const behind = !this.best || this.best.seq < this.known;
    //1135 shares this read on commits/reconnects, even when the feed already
    // supplies the red keys. No second poller or parallel health read.
    const shared = this.observe && (event?.kind === 'commit' || event?.state === 'live');
    if (this.feed() === 'live' && (behind || shared) && !(this.running && this.asking >= this.known)) return this.load();
    return null;
  }

  // Read what is red; one read at a time, and one more for any asked while it
  // runs. Each answer is taken as it comes, by its commit, so a commit during a
  // read never throws an answer away.
  load() {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      let ok;
      do {
        this.again = false;
        const started = this.asking = this.known;
        ok = await this.ask(started);
        this.paint();
      } while (this.again);
      return ok;
    })().finally(() => { this.running = null; });
    return this.running;
  }

  async ask(started) {
    let answer;
    try { answer = await this.read(); } catch { answer = null; }
    if (!keys(answer?.red)) { this.failed = true; return false; }
    // A server that does not name the commit: the commit known when the read began.
    this.take({ seq: Number.isSafeInteger(answer.commit_seq) ? answer.commit_seq : started, red: answer.red }, true);
    if (this.observe && this.feed() !== 'down' && Number.isSafeInteger(answer.commit_seq) &&
        answer.commit_seq >= Math.max(this.known, this.floor)) this.observe(answer);
    return true;
  }

  paint() {
    const said = standing(this.facts());
    this.link.classList.toggle('red', said === 'lit' || said === 'unread');
    this.link.textContent = { checking: CHECKING_WORDS, unread: UNREAD_WORDS, lit: LIT_WORDS, quiet: 'Health' }[said];
    if (said === 'unread') this.link.setAttribute('aria-label', 'Health: it could not be checked, so something may need attention');
    else if (said === 'lit') this.link.setAttribute('aria-label', 'Health: something needs attention');
    else this.link.removeAttribute('aria-label');
  }
}
