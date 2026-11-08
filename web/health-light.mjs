// The Health link that heads every page (docs/health.md): quiet while Core
// says nothing is red, and lit, in words and the alert colour, while Core says
// something is, by the same rule the Health page reads (the health_light
// view). It is read once when the page opens and again on every commit, as
// attention is, so it lights and goes dark with the act that changed what is
// red. Quiet is said only after a read that says so: before the first answer,
// and after a read that fails or answers without a list of what is red, the
// link says it could not check, in the alert colour, because something may be
// red that it cannot see.
export const LIT_WORDS = 'Health · needs attention';
export const UNREAD_WORDS = "Health · couldn't check";

export class HealthLight {
  constructor({ link, read }) { Object.assign(this, { link, read }); this.red = null; }

  async load() {
    try {
      const answer = await this.read();
      this.red = Array.isArray(answer?.red) ? answer.red : null;
    } catch {
      this.red = null;
    }
    this.paint();
    return this.red !== null;
  }

  paint() {
    const unread = this.red === null, lit = Boolean(this.red?.length);
    this.link.classList.toggle('red', lit || unread);
    this.link.textContent = unread ? UNREAD_WORDS : lit ? LIT_WORDS : 'Health';
    if (unread) this.link.setAttribute('aria-label', 'Health: it could not be checked, so something may need attention');
    else if (lit) this.link.setAttribute('aria-label', 'Health: something needs attention');
    else this.link.removeAttribute('aria-label');
  }
}
