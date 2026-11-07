// Inside an outcome the side rail shows only that outcome: "← Outcomes", then
// its own sections in one order. The list of outcomes stays on the Outcomes
// home and the new outcome page. Every page has the logo block (wordmark with
// its presence dot, the workspace name, Turn on notifications) at the top of
// its rail, or of its main column where it has no rail; there is no header bar.

// Top to bottom. Each section shows only when it has something; the
// conversation and the pipeline join when their pieces land.
export const RAIL_ORDER = ['conversation', 'pipeline', 'topics', 'notebook', 'skills'];

// Page kinds inside an outcome: 'workspace' (the outcome's own page), 'topic',
// 'opening' (a new topic), 'skill' (a tool's page) and 'pipeline'. The
// outcome's own page lists everything in its main column, so it has no rail;
// a tool's page read by someone outside the tool's home has nothing to put there.
export function railShown(kind, homeReadable = true) {
  return kind !== 'workspace' && homeReadable !== false;
}

// How many other outcomes wait on the reader, from the server's exact count.
export function elsewhereWaiting(answer) {
  const waiting = answer?.waiting_outcomes;
  if (!waiting || !Number.isSafeInteger(waiting.count) || waiting.count < 1) return 0;
  return Math.max(0, waiting.count - (waiting.here === true ? 1 : 0));
}

export function elsewhereWords(count) {
  return count === 1 ? '1 other outcome is waiting on you' : `${count} other outcomes are waiting on you`;
}

// The outcome's own page names other outcomes' questions in its "Also
// waiting on you" line, so there the words go while that line names as many
// outcomes as the light counts (count). The light counts every wait on the
// reader; the line names only outcomes the reader can list, the first page of
// those whose team they are on, so a wait it cannot name keeps the words.
// named: how many outcomes the line names, null until its read has settled.
// Screen readers hear the words either way.
export function wordsShown(kind, count = 0, named = null) {
  return kind !== 'workspace' || (named !== null && named < count);
}

// Moves the one logo block, then the page's status notices, to the top of
// host (the rail or main). The nodes move, so their handlers stay.
export function placeBrand(host, doc = host.ownerDocument) {
  const brand = doc.querySelector('.brand');
  const notices = ['app-status', 'wakes-status', 'updates-status'].map(id => doc.getElementById(id)).filter(Boolean);
  host.prepend(brand, ...notices);
}

// A row carrying a lit light: a topic waiting on the reader, or an outcome's
// "waiting on you" light.
const LIT = '.topic-state.mine, .outcome-light[data-light="you"]';

// At phone width a sideways strip scrolls itself so its open row sits in the
// middle; then, when a lit row would be cut at either edge, it moves by the
// least amount that shows that row whole while the open row stays whole. The
// open row wins when both cannot be whole. Only the strip's own scrollLeft is
// written, never the page's.
export function showOpenInStrip(strip) {
  const width = strip.clientWidth, room = strip.scrollWidth - width;
  if (!(room > 0)) return;
  const rows = [...strip.children].filter(row => !row.hidden);
  const open = rows.find(row => row.getAttribute('aria-current') === 'page');
  if (!open) return;
  const base = strip.getBoundingClientRect().left - strip.scrollLeft;
  const span = row => { const box = row.getBoundingClientRect(); return { start: box.left - base, end: box.right - base }; };
  const clamp = value => Math.max(0, Math.min(room, value));
  const here = span(open), whole = (part, at) => part.start >= at - 0.5 && part.end <= at + width + 0.5;
  let at = clamp((here.start + here.end) / 2 - width / 2);
  let best = null;
  for (const row of rows) {
    if (row === open || !row.querySelector(LIT)) continue;
    const part = span(row);
    const cut = part.start < at + width && part.end > at && !whole(part, at);
    if (!cut) continue;
    const move = part.start < at ? part.start - at : part.end - (at + width);
    const next = clamp(at + move);
    if (whole(part, next) && whole(here, next) && (best === null || Math.abs(move) < Math.abs(best - at))) best = next;
  }
  if (best !== null) at = best;
  strip.scrollLeft = at;
}

// Keeps a strip's open row in view: when its rows or its open row change, and
// when its size changes. A repaint that leaves the same rows leaves the
// person's own scrolling alone.
export function followStrip(strip, win = strip.ownerDocument.defaultView) {
  const phone = win.matchMedia?.('(max-width: 760px)');
  let shown = null;
  const signature = () => JSON.stringify([...strip.children].map(row => [row.dataset.topicId ?? row.getAttribute('href'), row.getAttribute('aria-current'),
    Boolean(row.querySelector(LIT))]));
  const place = force => {
    if (!phone?.matches) return;
    const now = signature();
    if (!force && now === shown) return;
    shown = now; showOpenInStrip(strip);
  };
  new win.MutationObserver(() => place(false)).observe(strip, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'class'] });
  if (win.ResizeObserver) new win.ResizeObserver(() => place(true)).observe(strip);
  phone?.addEventListener?.('change', () => place(true));
  place(true);
}

// One page inside an outcome. sections: [{name, node, load}] in any order;
// they are placed in RAIL_ORDER under "← Outcomes" when the rail is shown,
// and load() reads each. attention: the page's Attention, told which outcome
// this is so its answer says whether that outcome is one of those waiting;
// only answers read about this outcome are painted.
export class OutcomeScope {
  constructor({ workspaceId, kind, rail, home, attention = null, sections = [], open, homeReadable = true, doc = rail.ownerDocument }) {
    Object.assign(this, { workspaceId, kind, rail, home, attention, sections, open, doc, count: 0, named: null });
    this.shown = railShown(kind, homeReadable);
    const navigation = doc.getElementById('outcome-navigation');
    if (navigation) navigation.hidden = true;
    rail.setAttribute('aria-label', 'This outcome');
    const toRoot = event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); return open({ kind: 'root' }, 'Outcomes');
    };
    home.onclick = toRoot;
    const wordmark = doc.querySelector('.wordmark');
    if (wordmark) wordmark.onclick = toRoot;
    this.paintHome(0);
    if (this.shown) {
      const ordered = RAIL_ORDER.flatMap(name => sections.filter(section => section.name === name));
      let after = doc.getElementById('topic-navigation-status') ?? home;
      for (const { node } of ordered) { if (node.parentNode === rail) { after.after(node); after = node; } }
      for (const strip of rail.querySelectorAll('#topics, .topic-list, #outcome-references-list')) followStrip(strip);
    }
    if (attention) {
      // Only an answer read about this outcome says whether it is one of
      // those waiting; one read before the page knew it would count it as other.
      const paint = () => { if (attention.last && attention.lastHere === workspaceId) this.paintHome(elsewhereWaiting(attention.last)); };
      attention.here = workspaceId;
      attention.listen(paint);
      paint();
      attention.refresh();
    }
  }

  // "← Outcomes", with the lit light and its words when another outcome
  // waits on the reader.
  paintHome(count) {
    const doc = this.doc, home = this.home;
    this.count = count;
    let arrow = home.querySelector('.home-words'), light = home.querySelector('.outcome-light'), words = home.querySelector('.elsewhere-words');
    if (!arrow) {
      arrow = doc.createElement('span'); arrow.className = 'home-words'; arrow.textContent = '← Outcomes';
      light = doc.createElement('span'); light.className = 'outcome-light'; light.dataset.light = 'you'; light.setAttribute('aria-hidden', 'true');
      words = doc.createElement('span'); words.className = 'elsewhere-words'; words.setAttribute('aria-hidden', 'true');
      home.replaceChildren(arrow, light, words);
    }
    const said = count > 0 ? elsewhereWords(count) : '';
    light.hidden = !said;
    words.textContent = said; words.hidden = !said || !wordsShown(this.kind, count, this.named);
    if (said) home.setAttribute('aria-label', `Outcomes. ${said}.`); else home.removeAttribute('aria-label');
  }

  // How many other outcomes the page's "Also waiting on you" line names, each
  // time it is painted; 0 when the list it is read from could not be read.
  alsoNamed(named) {
    this.named = named;
    this.paintHome(this.count);
  }

  // Reads every section; settles false when any could not be read.
  async load() {
    const loaded = await Promise.all(this.sections.map(section => section.load?.()));
    return loaded.every(read => read !== false);
  }
}
