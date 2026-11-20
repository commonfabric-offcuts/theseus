import { arrange, paintMarks } from './topic-navigation.mjs';
import { timeNode } from './times.mjs';
import { revealSelection } from './reveal.mjs';

// No read function or rail DOM: TopicRail.presentation() supplies values and
// acts from the outline's one list owner, independent of its markup.
export class OutcomeTopicCards {
  constructor({ host, doc = host.ownerDocument }) {
    Object.assign(this, { host, doc });
    this.sections = new Map(); this.cards = new Map();
  }
  node(tag, className, text) {
    const node = this.doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  stops() { return [...this.host.querySelectorAll('a.outcome-topic-card')]; }
  ownsKeys(at) { return this.stops().includes(at); }
  reach(card, navigate = () => {}) {
    if (!card) return false;
    card.focus({ preventScroll: true });
    if (this.doc.activeElement !== card) return false;
    this.lastTopicId = card.dataset.topicId;
    revealSelection(card); navigate(); return true;
  }
  focus({ first = false } = {}, navigate) {
    const rows = this.stops();
    return this.reach((!first && rows.find(row => row.dataset.topicId === this.lastTopicId)) || rows[0], navigate);
  }
  key(action, navigate) {
    if (!['up', 'down', 'left', 'right', 'first', 'last'].includes(action)) return false;
    const cards = this.stops(), at = this.doc.activeElement;
    if (action === 'first' || action === 'last' || !cards.includes(at)) {
      return this.reach(action === 'last' ? cards.at(-1) : cards[0], navigate);
    }
    // CSS grid rows share their top edge. Read geometry for every press, so
    // resizing, filtering and a changed order never leave a cached column count.
    const tolerance = .5, from = at.getBoundingClientRect(), center = box => (box.left + box.right) / 2;
    const boxes = cards.filter(card => card !== at).map(card => ({ card, box: card.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0);
    const horizontal = action === 'left' || action === 'right', sign = action === 'right' || action === 'down' ? 1 : -1;
    const ahead = boxes.filter(({ box }) => horizontal
      ? Math.abs(box.top - from.top) <= tolerance && sign * (center(box) - center(from)) > tolerance
      : sign * (box.top - from.top) > tolerance);
    const rowDistance = horizontal ? 0 : Math.min(...ahead.map(({ box }) => Math.abs(box.top - from.top)));
    const next = ahead.filter(({ box }) => horizontal || Math.abs(Math.abs(box.top - from.top) - rowDistance) <= tolerance)
      .sort((a, b) => Math.abs(center(a.box) - center(from)) - Math.abs(center(b.box) - center(from)) || a.box.left - b.box.left)[0]?.card;
    // At an edge the card still owns the arrow; neither a rail nor the
    // page-wide fallback may take it. No movement notification is sent.
    return next ? this.reach(next, navigate) : true;
  }
  paint(presentation) {
    const sections = [], ids = new Set();
    for (const list of presentation?.groups ?? []) {
      let section = this.sections.get(list.name);
      if (!section) {
        const host = this.node('section', 'outcome-topic-group');
        const toggle = this.node('button', 'outcome-topic-toggle'); toggle.type = 'button';
        const grid = this.node('div', 'outcome-topic-grid');
        const more = this.node('button', 'outcome-topic-more', 'More topics'); more.type = 'button';
        host.append(toggle, grid, more); section = { host, toggle, grid, more }; this.sections.set(list.name, section);
      }
      const { host, toggle, grid, more } = section;
      toggle.hidden = !list.toggle;
      if (list.toggle) {
        toggle.textContent = list.label;
        toggle.setAttribute('aria-expanded', String(list.opened));
        toggle.onclick = list.toggle;
      }
      const rows = list.rows.map(({ href, activate, item }) => {
        ids.add(item.id);
        let card = this.cards.get(item.id);
        if (!card) { card = this.node('a', 'outcome-topic-card'); card.dataset.topicId = item.id; this.cards.set(item.id, card); }
        card.href = href; card.onclick = activate;
        card.onfocus = () => { this.lastTopicId = item.id; };
        const signature = JSON.stringify([item, href]);
        if (card.drawn !== signature) {
          const title = this.node('span', 'outcome-topic-title', item.title);
          paintMarks(title, item, presentation.reader);
          const meta = this.node('span', 'outcome-topic-meta');
          const n = Number.isSafeInteger(item.message_count) ? item.message_count : 0;
          meta.append(this.node('span', '', `${n} message${n === 1 ? '' : 's'}`));
          if (Number.isSafeInteger(item.activity_ms) && item.activity_ms > 0) {
            const time = timeNode(item.activity_ms, this.doc); time.setAttribute('aria-label', `Last activity: ${time.title}`); meta.append(time);
          }
          card.replaceChildren(title, meta); card.drawn = signature;
        }
        return card;
      });
      arrange(grid, rows, this.doc.activeElement);
      more.hidden = !list.more;
      more.onclick = async () => {
        const before = new Set(this.cards.keys());
        await list.more?.();
        if (this.doc.activeElement === more && more.hidden) {
          ([...this.cards].find(([id]) => !before.has(id))?.[1] ?? grid.children[0])?.focus();
        }
      };
      more.setAttribute('aria-disabled', String(presentation.busy));
      sections.push(host);
    }
    for (const [id] of this.cards) if (!ids.has(id)) this.cards.delete(id);
    this.notice ??= this.node('p', 'notice'); this.notice.setAttribute('role', 'status');
    this.notice.hidden = !presentation?.message;
    this.notice.textContent = presentation?.message ?? '';
    this.retry ??= this.node('button', '', 'Retry topics'); this.retry.type = 'button';
    this.retry.hidden = !presentation?.retry; this.retry.onclick = presentation?.retry;
    this.empty ??= this.node('p', 'empty'); this.empty.hidden = ids.size > 0 || !this.notice.hidden;
    this.empty.textContent = presentation && !presentation.started ? 'Loading topics…' : 'No topics shown by the outline.';
    arrange(this.host, [...sections, this.notice, this.retry, this.empty]);
  }
}
