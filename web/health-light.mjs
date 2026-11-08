// The Health link that heads every page (docs/health.md): quiet while nothing
// is red, and lit, in words and the alert colour, while Core says something
// is, by the same rule the Health page reads (the health_light view). It is
// read once when the page opens and again on every commit, as attention is,
// so it lights and goes dark with the act that changed what is red. A read
// that fails keeps what was shown.
export const LIT_WORDS = 'Health · needs attention';

export class HealthLight {
  constructor({ link, read }) { Object.assign(this, { link, read }); this.red = null; }

  async load() {
    try {
      const answer = await this.read();
      if (Array.isArray(answer?.red)) this.red = answer.red;
    } catch {}
    this.paint();
    return true;
  }

  paint() {
    const lit = Boolean(this.red?.length);
    this.link.classList.toggle('red', lit);
    this.link.textContent = lit ? LIT_WORDS : 'Health';
    if (lit) this.link.setAttribute('aria-label', 'Health: something needs attention'); else this.link.removeAttribute('aria-label');
  }
}
