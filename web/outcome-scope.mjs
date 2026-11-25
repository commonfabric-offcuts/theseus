// Inside an outcome the side rail shows only that outcome: "← Outcomes", then
// its own sections in one order. The list of outcomes stays on the Outcomes
// home and the new outcome page. Every page has the logo block (wordmark with
// its presence dot, Turn on notifications) at the top of its rail, or of its
// main column where it has no rail, and the rail's foot (who you are on which
// instance, the guide's ?, Health) at the end of the same; there is no header bar.

// Top to bottom. Each section shows only when it has something. The
// conversation is an ordinary topic row. The outcome's Notebook is on the
// right rail and its home page (docs/notebook-pages.md).
export const RAIL_ORDER = ['pipeline', 'topics', 'skills'];

// Page kinds inside an outcome: 'workspace' (the outcome's own page), 'topic',
// 'opening' (a new topic), 'skill' (a tool's page) and 'pipeline'. The
// outcome's own page also keeps its content in the main column;
// a tool's page read by someone outside the tool's home has nothing to put there.
export function railShown(kind, homeReadable = true) {
  return homeReadable !== false;
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

// Moves the one logo block, then the page's notices, to the top of host (the
// rail or main), and the rail's foot to its end (item 628). The notices go as
// one group (index.html #page-notices: the status line, the wakes', the
// updates' and why a move stayed), so where the rail pins them they stack one
// under the other and never draw over each other (rails.css). The nodes move,
// so their handlers stay; a foot already last stays put, keeping its focus.
export function placeBrand(host, doc = host.ownerDocument) {
  host.prepend(...[doc.querySelector('.brand'), doc.getElementById('page-notices')].filter(Boolean));
  const foot = doc.querySelector('.rail-foot');
  if (foot && host.lastElementChild !== foot) host.append(foot);
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
      let after = home;
      for (const { node } of ordered) { if (node.parentNode === rail) { after.after(node); after = node; } }
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

  // With no selection, read every section. A scoped refresh keeps each
  // selected section's own read/authority checks and result.
  async load(names = null) {
    const loaded = await Promise.all(this.sections.filter(section => !names || names.has(section.name)).map(section => section.load?.()));
    return loaded.every(read => read !== false);
  }
}
