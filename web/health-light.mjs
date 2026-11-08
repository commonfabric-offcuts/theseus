// The Health link that heads every page (docs/health.md): quiet while Core
// says nothing is red, and lit, in words and the alert colour, while Core says
// something is, by the same rule the Health page reads (the health_light
// view). It is read when the page opens and again on every commit, as
// attention is, so it lights and goes dark with the act that changed what is
// red.
//
// What it shows is the answer to its latest read, and only while the live feed
// can say that answer still stands. Reads run one at a time: a commit that
// comes while one runs asks for one more, and an answer read before the latest
// commit is never shown. While the feed is down nothing would say a change, so
// the link says it could not check, as it does before the first answer and
// after a read that fails or answers without a list of what is red: something
// may be red that it cannot see.
export const LIT_WORDS = 'Health · needs attention';
export const UNREAD_WORDS = "Health · couldn't check";

// Whether the live feed has dropped, so what was read may be out of date. The
// Health page says so at its top by the same rule (health.mjs).
export const feedLost = feed => feed === 'down';

export class HealthLight {
  // feed: the live feed's state ('live', 'down', or null when none is offered).
  constructor({ link, read, feed = () => null }) {
    Object.assign(this, { link, read, feed });
    // red: undefined until the first read answers, while the link says "checking".
    this.red = undefined; this.running = null; this.again = false;
  }

  load() {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      let red;
      do { this.again = false; red = await this.ask(); } while (this.again);
      this.red = red; this.paint();
      return this.red !== null;
    })().finally(() => { this.running = null; });
    return this.running;
  }

  // What is red, by key, or null when the read failed or did not say.
  async ask() {
    try {
      const answer = await this.read();
      return Array.isArray(answer?.red) ? answer.red : null;
    } catch {
      return null;
    }
  }

  paint() {
    if (this.red === undefined) return;
    const unread = this.red === null || feedLost(this.feed()), lit = !unread && this.red.length > 0;
    this.link.classList.toggle('red', lit || unread);
    this.link.textContent = unread ? UNREAD_WORDS : lit ? LIT_WORDS : 'Health';
    if (unread) this.link.setAttribute('aria-label', 'Health: it could not be checked, so something may need attention');
    else if (lit) this.link.setAttribute('aria-label', 'Health: something needs attention');
    else this.link.removeAttribute('aria-label');
  }
}
