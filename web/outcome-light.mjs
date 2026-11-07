// Where each outcome stands, on the page (item 86, docs/outcome-light.md): the
// light and its words on every outcome row, the peek that opens from a row on
// a laptop, the "Where it stands" card at the top of an outcome's page, and the one quiet line naming other outcomes' questions there. The
// words are outcome-light-words.mjs; the server decides every value. Nothing
// here sets a timer: the rows and the panel are read again on every commit
// the live feed announces, and spoken times follow the day through
// repaintTimes.
import { spokenNode, spokenTime } from './times.mjs';
import { SOURCE, UNREADABLE_PEEK, alsoWords, factParts, lampKind, lastLine, leadWords, lightName, shortPieces } from './outcome-light-words.mjs';

const element = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children); return node;
};
// Parts as plain words, and as nodes whose times follow the day.
export const partsText = parts => parts.map(part => typeof part === 'string' ? part : spokenTime(part.ms, part.form)).join('');
const partsNodes = parts => parts.map(part => typeof part === 'string' ? part : spokenNode(part.ms, part.form, document));

// The light itself: lit (filled, with a halo) only when the outcome waits on
// the reader; a hollow ring, a ✓ or a dashed ring in the quiet grey
// otherwise; nothing when its facts could not be read. Its words are always
// beside it, so it is never colour alone.
export function lightNode(light) {
  const lamp = element('span', { className: 'outcome-light' });
  lamp.dataset.light = lampKind(light); lamp.setAttribute('aria-hidden', 'true');
  return lamp;
}

// An outcome row's grey line: the light and its short words, in two pieces
// that each stay whole.
export function paintRowLight(small, light) {
  small.className = 'standing'; small.dataset.light = lampKind(light);
  const [what, when] = shortPieces(light);
  const parts = [element('span', { className: 'what' }, lightNode(light), ...partsNodes(what))];
  if (when.length) parts.push(' ', element('span', { className: 'when' }, ...partsNodes(when)));
  small.replaceChildren(...parts);
}

const followed = (link, open) => event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); open(link.topic, link.text);
};
// One fact as a list item: a topic is a link and its detail follows, muted, after " — ".
function factItem(fact, open) {
  const parts = factParts(fact);
  if (!parts.link) return element('li', {}, ...partsNodes(parts.text));
  const name = parts.link.topic && open
    ? element('a', { href: '?topic=' + encodeURIComponent(parts.link.topic), textContent: parts.link.text, onclick: followed(parts.link, open) })
    : element('span', { textContent: parts.link.text });
  return element('li', {}, name, element('span', { className: 'muted' }, ' — ', ...partsNodes(parts.detail)));
}
// The Last line: "Last: fable in “No header bar, and the side rail…”", the
// title one line long and cut with an ellipsis where it does not fit. A topic
// is a link when open is given; plain words otherwise (the peek).
function lastNode(answer, open, tag = 'p') {
  const line = lastLine(answer);
  if (!line) return null;
  if (!line.link) return element(tag, { className: 'standing-last' }, ...partsNodes(line.text));
  const name = line.link.topic && open
    ? element('a', { href: '?topic=' + encodeURIComponent(line.link.topic), textContent: line.link.text, onclick: followed(line.link, open) })
    : element('span', { textContent: line.link.text });
  name.className = 'title';
  return element(tag, { className: 'standing-last' },
    element('span', { className: 'label' }, line.label), ' ', `${line.by ? `${line.by} in` : 'In'} “`, name, '”');
}

// "Where it stands", at the top of an outcome's page: the light with its name
// and time, and the Last line. That is the whole card; what the light is made
// of (the lead, the facts, the also-lines and where it comes from) opens in
// place from the small ⓘ, and stays open across the repaint on each commit.
export function paintStanding(host, answer, { open, retry, outcome = '' } = {}) {
  const light = answer?.light ?? null, facts = Array.isArray(answer?.facts) ? answer.facts : [], also = Array.isArray(answer?.also) ? answer.also : [];
  const unreadable = !light || light.light === null;
  const more = [];
  const lead = leadWords(answer?.lead, facts, outcome);
  if (lead.length) more.push(element('p', { className: 'lead' }, ...partsNodes(lead)));
  if (facts.length) more.push(element('ul', { className: 'standing-facts' }, ...facts.map(fact => factItem(fact, open))));
  for (const line of also) more.push(element('p', { className: 'also' }, ...partsNodes(alsoWords(line))));
  // A reached outcome's topics are closed and readable: nothing more to say about them.
  if (!unreadable && answer?.lead?.kind !== 'reached') more.push(element('p', { className: 'muted source', textContent: SOURCE }));
  const shown = host.dataset.more === 'open';
  const details = element('div', { id: 'standing-more', className: 'standing-more', hidden: !shown }, ...more);
  const info = element('button', { type: 'button', className: 'standing-info', textContent: 'i', title: 'What this is made of' });
  info.setAttribute('aria-label', 'What this is made of'); info.setAttribute('aria-controls', 'standing-more');
  info.setAttribute('aria-expanded', String(shown));
  info.onclick = () => {
    const now = details.hidden;
    details.hidden = !now; info.setAttribute('aria-expanded', String(now));
    if (now) host.dataset.more = 'open'; else delete host.dataset.more;
  };
  const children = [
    element('div', { className: 'standing-head' }, element('h2', { id: 'standing-heading', textContent: 'Where it stands' }), info),
    element('p', { className: 'state-line' }, lightNode(light), element('span', {}, ...partsNodes(lightName(light)))),
  ];
  const last = unreadable ? null : lastNode(answer, open);
  if (last) children.push(last);
  if (unreadable && retry) children.push(element('button', { type: 'button', className: 'retry', textContent: 'Try again', onclick: retry }));
  host.replaceChildren(...children, details);
  host.hidden = false;
}

// The panel when its read failed: no light, no guess, and a way to try again.
export function paintStandingFailed(host, retry) {
  paintStanding(host, { light: null, lead: { kind: 'unreadable' }, facts: [], also: [] }, { retry });
}

// On an outcome's page, other outcomes' questions in one quiet line:
// "Also waiting on you: 2 in Building Theseus ›, 1 in Pitch deck ›", in the
// sidebar's order, each counted as that outcome's own row counts them.
// items null: the list could not be read, so there is no line. Returns how
// many outcomes the line names.
export function paintAlsoWaiting(host, items, current, open) {
  const others = (Array.isArray(items) ? items : []).filter(item => item.id !== current && item.light?.light === 'waiting' && item.light.short?.kind === 'asks');
  if (!others.length) { host.hidden = true; host.replaceChildren(); return 0; }
  const parts = ['Also waiting on you: '];
  others.forEach((item, index) => {
    if (index) parts.push(', ');
    const link = element('a', { href: '?workspace=' + encodeURIComponent(item.id), textContent: `${item.light.short.count} in ${item.title}${item.title_truncated ? '…' : ''} ›` });
    link.onclick = event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); open(item.id, item.title);
    };
    parts.push(link);
  });
  host.replaceChildren(...parts);
  host.hidden = false;
  return others.length;
}

// The peek: on a laptop, hovering an outcome row or focusing it by keyboard
// opens the light's name and time and its Last line. It touches its row, so the pointer can
// move onto it; it stays open while the pointer is on either, and closes on
// leaving both, on Escape, on scrolling (unless the row is focused and still
// in view), and when the row loses focus. It
// reads outcome_light once when it opens, and again on each commit while it
// is open (refresh). A phone has no peek: the row's words are always there,
// and the outcome's page says the whole of it.
export class LightPeek {
  constructor({ host, read, hover = window.matchMedia('(hover: hover)') }) {
    Object.assign(this, { host, read, hover, link: null, item: null, answer: null, serial: 0 });
    host.addEventListener('mouseleave', event => { if (!this.link?.contains(event.relatedTarget)) this.hide(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') this.hide(); });
    window.addEventListener('scroll', event => this.scrolled(event), { passive: true, capture: true });
  }

  // A scroll closes the peek, except the one that brings a row focused by
  // keyboard into view as it takes focus: while its row has focus and is
  // wholly inside what scrolled, the peek follows it there.
  scrolled(event) {
    const link = this.link;
    if (!link || document.activeElement !== link) return this.hide();
    const box = link.getBoundingClientRect(), frame = event.target?.getBoundingClientRect?.() ?? { top: 0, bottom: window.innerHeight };
    if (box.top >= frame.top && box.bottom <= frame.bottom) this.place(); else this.hide();
  }

  attach(link, item) {
    link.lightItem = item;
    if (link.dataset.peek) return;
    link.dataset.peek = 'true';
    link.addEventListener('mouseenter', () => this.show(link));
    link.addEventListener('mouseleave', event => { if (!this.host.contains(event.relatedTarget)) this.hide(); });
    link.addEventListener('focus', () => { if (link.matches(':focus-visible')) this.show(link); });
    link.addEventListener('blur', () => this.hide());
    link.addEventListener('click', () => this.hide());
  }

  show(link) {
    if (!this.hover.matches) return;
    if (this.link === link && !this.host.hidden) return;
    this.link = link; this.item = link.lightItem; this.answer = null;
    this.paint(); this.refresh();
  }

  async refresh() {
    if (!this.link || this.host.hidden) return;
    const serial = ++this.serial, link = this.link;
    try {
      const answer = await this.read(link.lightItem.id);
      if (serial !== this.serial || this.link !== link) return;
      this.answer = answer;
    } catch {
      if (serial !== this.serial || this.link !== link) return;
      this.answer = { light: null, lead: { kind: 'unreadable' }, facts: [], also: [] };
    }
    this.item = link.lightItem; this.paint();
  }

  // The peek says what the card says: the light with its name and time, and
  // the Last line once its read is in.
  paint() {
    const answer = this.answer, light = answer ? answer.light : this.item?.light;
    const unreadable = !light || light.light === null;
    const children = [element('strong', {}, lightNode(light), element('span', {}, ...partsNodes(lightName(light))))];
    const last = answer && !unreadable ? lastNode(answer, null, 'div') : null;
    if (last) children.push(last);
    if (unreadable) children.push(element('div', { className: 'foot', textContent: UNREADABLE_PEEK }));
    this.host.replaceChildren(...children);
    this.host.hidden = false;
    this.place();
  }

  place() {
    const box = this.link.getBoundingClientRect(), width = this.host.offsetWidth, height = this.host.offsetHeight;
    // Against the row's right edge, overlapping it by 2 px; under it where the
    // window is too narrow, or above it where there is no room below, so it
    // never covers the row it is about.
    let left = box.right - 2, top = box.top;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, box.left); top = box.bottom - 2;
      if (top + height > window.innerHeight - 8 && box.top + 2 - height >= 8) top = box.top + 2 - height;
    }
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - height);
    this.host.style.left = `${left}px`; this.host.style.top = `${top}px`;
  }

  hide() {
    this.serial += 1; this.link = null; this.answer = null;
    this.host.hidden = true; this.host.replaceChildren();
  }
}

