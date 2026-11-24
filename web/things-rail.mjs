// The right rail of a topic or an outcome's Conversation (docs/rails.md).
// Notebook, Pull requests and Images come first; Waiting for…, Previews and
// Skills and tools show when present; Pipeline is last. A topic always lists
// its own pages and references. There is no scope switch, name row or Starred
// section. The Conversation is a topic too; the app resolves its old address
// before Shell.ready hands this rail its topic route.
//
// Everything comes from what Core already serves: pipeline, workspace_topics
// for Build topics, topic_messages, topic_images, memory_items, and topic_tools
// for the tools linked to this topic (docs/skills-and-tools.md).
// Previews and pull requests are the links people posted in messages; Core
// keeps no record of a pull request's state, so the rail says what it cannot
// know rather than guess.
//
// Like the outline it is the shell's (in-place-navigation.mjs): one element
// across moves, which reads through the page that is up. On a phone it is a
// sheet from the bottom, at middle widths a panel from the right, and beside
// the page when there is room; it reads only while it shows. What it shows
// is drawn for one topic: when it changes, what was shown goes at once, and a
// read for a topic left behind draws nothing.
import { paintChanged, paintMarks, questionOf, nextQuestionOf, landsOnUnread } from './topic-navigation.mjs';
import { paintThumb } from './image-pick.mjs';
import { clock, shownTime, datedTime } from './times.mjs';
import { readFailure } from './freshness.mjs';
import { pipelineHref } from './pipeline.mjs';
import { reloader } from './live.mjs';
import { listen } from './in-place-navigation.mjs';
import { KeyTree } from './key-tree.mjs';
import { panes } from './panes.mjs';
import { ImageRailMenu } from './image-rail-menu.mjs';
import { WorkspaceLinks } from './workspace-links.mjs';
import { keyAction } from './pane-keys.mjs';
import { revealSelection } from './reveal.mjs';
import { nearest } from './arrow-reach.mjs';
import { glyph } from './glyphs.mjs';

// A Notebook page's first words: its body's lines without Markdown marks, joined, after its own title when it opens with
// it as a heading. The rail clamps them to three lines; this keeps no more than it could show.
export function openingWords(body, title) {
  const text = String(body ?? '').split(/\n+/).map(line => line.replace(/^#+\s*|[*_`>]/g, '').trim()).filter(Boolean).join(' ');
  const name = String(title ?? '').trim();
  const rest = name && text.toLowerCase().startsWith(name.toLowerCase()) ? text.slice(name.length).replace(/^[\s:.\u2014-]+/, '') : text;
  return rest.slice(0, 220);
}
import { book, orderOf, placeIn, scopeOf } from './outline-order.mjs';

export const SECTIONS = [
  ['notebook', 'Notebook'], ['prs', 'Pull requests'], ['images', 'Images'],
  ['waiting', 'Waiting for…'], ['previews', 'Links'], ['tools', 'Skills and tools'], ['pipeline', 'Pipeline'],
];
// How far back the rail looks for links in the current topic.
export const MESSAGES = 50;
// How many Notebook pages the section lists at first, and how many more each More pages brings.
export const NOTEBOOK_PAGE = 20;
// How many Build topics the Pipeline section lists at first, and how many more each More topics brings.
export const BUILD_PAGE = 20;

// The outcome's Build topics (item 297), each once, as the Pipeline section
// shows them: under Now one row for each topic a piece is being built in, its
// topic's row as the outline would draw it; then the Build topics Ready for
// review, until they are Done and fold into the outline's Done group; then any
// other. Each group is in the reader's own order where they placed its topics,
// as the outline keeps it (outline-order.mjs), and Core's otherwise.
// pieces: the pipeline's pieces in Now; builds: the Build topics Core lists,
// in its order; building: Core's open Build topics holding a piece under way,
// whatever page of builds they would fall on (null while the pipeline is off,
// when no topic is a Build topic and Now is the pipeline's own list). A piece
// whose topic is not among them is in a topic Done or archived, which is the
// outline's alone; saved: the reader's own order of the outcome's topics.
export function buildRows(pieces, builds, { titles = new Map(), building = null, saved = [] } = {}) {
  const rows = new Map([...(builds ?? []), ...(building ?? [])].map(item => [item.id, item]));
  const shown = new Set();
  const placed = list => { const byKey = new Map(list.map((row, at) => [row.topic ?? `\u0000${at}`, row])); return placeIn([...byKey.keys()], saved).map(key => byKey.get(key)); };
  const now = placed((pieces ?? []).filter(piece => {
    const topic = piece.topic?.id ?? null;
    if (topic === null) return true;
    if (shown.has(topic) || (building && !rows.has(topic))) return false;
    shown.add(topic);
    return true;
  }).map(piece => ({
    title: piece.topic?.title || (piece.items ?? []).map(number => titles.get(number) ?? `Item ${number}`).join(', '),
    topic: piece.topic?.id ?? null, stage: piece.stage?.name ?? null, since: piece.stage?.entered_ms ?? null, item: rows.get(piece.topic?.id) ?? null })));
  const rest = placed((builds ?? []).filter(item => !shown.has(item.id)).map(item => ({ title: item.title, topic: item.id, item })));
  return { now, review: rest.filter(row => row.item.state === 'review'), other: rest.filter(row => row.item.state !== 'review') };
}

// Every web address in a message's words, with the words a Markdown link gave
// it, without the punctuation that ends a sentence after it.
const LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'`]+)/g;
export function linksIn(body) {
  const found = [];
  for (const match of String(body ?? '').matchAll(LINK)) {
    let url = match[2] ?? match[3], text = match[1] ?? null;
    url = url.replace(/[.,;:!?…]+$/, '');
    while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
    try { found.push({ url: new URL(url).href, text }); } catch { /* not an address */ }
  }
  return found;
}
// A pull request's address: its repository and number.
export function pullRequest(url) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
  return match ? { repo: match[2], number: Number(match[3]), href: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` } : null;
}
// A preview: a build served on this team's private network (a tailnet name,
// or this machine), or a page whose address says it is a preview or a mockup.
export function isPreview(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (pullRequest(url) || parsed.hostname === 'github.com') return false;
  return parsed.hostname.endsWith('.ts.net') || ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || /\/(previews?|mockups?)(\/|$)/i.test(parsed.pathname);
}
const shortAddress = url => { try { const u = new URL(url); return (u.host + u.pathname).replace(/\/$/, ''); } catch { return url; } };
// The previews and pull requests in messages, newest first, each once: the
// newest message that carries it names where it came from.
export function thingsIn(messages) {
  const previews = new Map(), prs = new Map();
  for (const message of [...messages].sort((a, b) => (b.sent_ms ?? 0) - (a.sent_ms ?? 0))) {
    for (const { url, text } of linksIn(message.body)) {
      const pr = pullRequest(url);
      if (pr) {
        const key = pr.href;
        if (!prs.has(key)) prs.set(key, { ...pr, title: text ?? `${pr.repo} #${pr.number}`, message });
        else if (text && prs.get(key).title === `${pr.repo} #${pr.number}`) prs.get(key).title = text;
      } else if (isPreview(url) && !previews.has(url)) previews.set(url, { url, title: text ?? shortAddress(url), message });
    }
  }
  return { previews: [...previews.values()], prs: [...prs.values()] };
}
// What the reader asked for and where it stands: the pipeline items they
// raised in this topic that are in Now or Next, at their stage.
export function waitingFor({ reader, now = [], next = [], topic }) {
  const rows = [];
  for (const item of [...now, ...next]) {
    if (item.raised_by !== reader || item.shipped) continue;
    if (item.pieceTopic !== topic) continue;
    rows.push({ what: item.title, where: item.stage?.name ? { stage: item.stage.name, since: item.stage.entered_ms } : { words: item.section === 'now' ? 'In Now' : 'Next' }, item });
  }
  return rows;
}

// Which sections this person keeps open, on this browser; each is open until
// they fold it.
export class SectionFolds {
  constructor(storage, key) { Object.assign(this, { storage, key }); }
  read() { try { const value = JSON.parse(this.storage?.getItem(this.key) ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
  isOpen(name) { return this.read()[name] !== false; }
  set(name, open) { try { this.storage?.setItem(this.key, JSON.stringify({ ...this.read(), [name]: open })); } catch { /* kept for this page only */ } }
}

const element = (doc, tag, props = {}, ...children) => {
  const node = Object.assign(doc.createElement(tag), props);
  node.append(...children.filter(child => child !== null && child !== undefined && child !== false));
  return node;
};
const plainClick = event => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
const settle = promise => promise.then(value => ({ value }), error => ({ error }));

export class ThingsRail {
  constructor({ host, backdrop, storage = null, doc = host.ownerDocument, win = doc.defaultView }) {
    Object.assign(this, { host, backdrop, storage, doc, win });
    this.handles = null; this.unlisten = null; this.stale = false; this.serial = 0; this.folds = null;
    // The Notebook section's current-topic pencil; how many of its
    // pages the person has asked to see; and the first page More brought, which takes the focus from More.
    this.creators = new Map(); this.notebookWant = NOTEBOOK_PAGE; this.notebookFrom = null;
    // How many of the outcome's Build topics the person has asked to see, and the rows shown when More topics was pressed.
    this.buildWant = BUILD_PAGE; this.buildFrom = null;
    // Each place's messages and images, with the version of the topic they were read at (readPlace).
    this.kept = new Map();
    this.reload = reloader(() => this.load());
    this.build();
    this.imageMenus = new ImageRailMenu(this);
    this.links = new WorkspaceLinks(this);
    // The keys move through the sections and their rows as one tree
    // (key-tree.mjs): ↑ ↓ between them, → and ⌘→ ⌘← open and fold a
    // section, Return opens a row, and plain ← goes back to the messages
    // without folding. The generic arrow owner reaches only controls
    // actually present; this rail has no scope controls or name row.
    // Thumbnail grids answer their plain arrows before the tree's linear step (1007).
    // The shelf is a sibling of the sections: the whole rail is one cursor
    // owner, including replicas that its own scroller currently hides.
    this.host.addEventListener('keydown', event => this.gridKey(event), true);
    this.tree = new KeyTree({ root: this.host, doc, label: 'The topic\'s things', column: this.host, rows: () => this.treeRows(), fallback: (...args) => this.missingRow(...args), act: (action, row, rows) => this.act(action, row, rows) });
    // The sheet closes with Escape, its ✕ and a tap beside it; the shell keeps these across moves.
    listen(doc, 'keydown', event => { if (!event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && event.key === 'Escape' && this.isOpen()) { event.preventDefault(); this.close(true); } });
    listen(backdrop, 'click', () => this.close(true));
    this.wide = win.matchMedia?.('(min-width: 1181px)') ?? null;
    if (this.wide) listen(this.wide, 'change', () => { if (this.wide.matches) this.close(false); if (this.stale && this.shows()) this.reload(); });
  }
  build() {
    const doc = this.doc;
    this.heading = element(doc, 'h2', { id: 'things-heading', textContent: 'In this topic' });
    this.closer = element(doc, 'button', { type: 'button', className: 'quiet things-close', id: 'things-close', textContent: '✕' });
    this.closer.setAttribute('aria-label', 'Close');
    this.closer.onclick = () => this.close(true);
    this.sections = new Map();
    const holder = this.holder = element(doc, 'div', { className: 'things-sections' });
    for (const [key, label] of SECTIONS) {
      const sum = element(doc, 'span', { className: 'sum' }), body = element(doc, 'div', { className: 'things-body' });
      const disclosure = element(doc, 'button', { type: 'button', className: 'things-disclosure ol-disclosure', tabIndex: 0 }, glyph('chevron', doc));
      const summary = element(doc, 'summary', {}, disclosure, element(doc, 'span', { className: 'things-section-name', textContent: label }), sum);
      const details = element(doc, 'details', { className: 'things-sec', hidden: true }, summary, body);
      details.dataset.key = key;
      body.id = 'things-' + key + '-body';
      disclosure.setAttribute('aria-controls', body.id);
      const paintDisclosure = () => {
        disclosure.setAttribute('aria-expanded', String(Boolean(details.open)));
        disclosure.setAttribute('aria-label', `${details.open ? 'Fold' : 'Open'} ${label}`);
      };
      const part = { details, summary, disclosure, sum, body, drawn: null, paintDisclosure };
      disclosure.onclick = event => {
        if (!plainClick(event)) return;
        event.preventDefault(); event.stopPropagation();
        details.open = !details.open; paintDisclosure();
      };
      disclosure.onkeydown = event => this.sectionKey(event, part);
      summary.onkeydown = event => { if (keyAction(event) === 'left') this.sectionKey(event, part); };
      paintDisclosure();
      // What the person folds or opens is kept; the rail sets a fold only as its section appears (paint).
      details.addEventListener('toggle', () => { paintDisclosure(); if (this.folds) this.folds.set(key, details.open); });
      holder.append(details);
      this.sections.set(key, part);
    }
    this.nothing = element(doc, 'p', { className: 'things-empty', hidden: true });
    this.message = element(doc, 'p', { className: 'notice', hidden: true }); this.message.setAttribute('role', 'status');
    this.retry = element(doc, 'button', { type: 'button', textContent: 'Try again', hidden: true });
    this.retry.onclick = () => this.reload();
    this.host.replaceChildren(element(doc, 'div', { className: 'things-head' }, this.heading, this.closer), holder, this.nothing, this.message, this.retry);
    this.host.hidden = true;
  }
  // A disclosure is its own stop, like the outline's. Its ↑/↓ continue at
  // the heading's place in the tree; → retains the Notebook pencil's stop.
  sectionKey(event, part) {
    const action = keyAction(event), { details, summary, disclosure } = part;
    const consume = () => { event.preventDefault(); event.stopPropagation(); };
    if (action === 'left') { consume(); panes.step('things', 'left', this.doc); return; }
    if (event.target !== disclosure) return;
    if (!event.defaultPrevented && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && ['Enter', ' '].includes(event.key)) {
      consume();
      if (!event.repeat) { details.open = !details.open; part.paintDisclosure(); }
      return;
    }
    const rows = this.tree.list(), at = rows.findIndex(row => row.el === summary);
    if (action === 'up' || action === 'down') {
      const next = rows[at + (action === 'up' ? -1 : 1)];
      if (next) { consume(); this.tree.go(next); }
    } else if (action === 'right') {
      const control = [...summary.querySelectorAll('button:not([disabled]), a[href]')]
        .find(el => el !== disclosure && el.isConnected && (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length));
      if (control) { consume(); control.focus({ preventScroll: true }); revealSelection(control); }
    }
  }
  // Real positions define the row and column, including after a resize. Only
  // this grid owns its arrows; menus, writing and the rest of the tree keep theirs.
  gridKey(event) {
    const action = keyAction(event);
    if (!['left', 'right', 'up', 'down'].includes(action)) return;
    const target = event.target.closest?.('a[href], button'), grid = target?.closest('.things-thumbs, .archive-shelf-row');
    if (!grid || !this.host.contains(grid) || Object.hasOwn(target?.dataset ?? {}, 'linkMenu')) return;
    const rows = this.tree.list(), byElement = new Map(rows.map(row => [row.el, row]));
    const cells = [...grid.querySelectorAll('a[href], button')].filter(el => byElement.has(el) && !el.disabled && !el.closest('[inert], [aria-hidden=true]'))
      .map(el => ({ el, box: el.getBoundingClientRect() })).filter(({ box }) => box.width > 0 && box.height > 0);
    const from = cells.find(cell => cell.el === target);
    if (!from) return;
    const returning = this.imageReturn; this.imageReturn = null;
    const consume = () => { event.preventDefault(); event.stopPropagation(); };
    const go = el => {
      const row = byElement.get(el); if (!row) return;
      const before = this.doc.activeElement;
      this.tree.go(row);
      // The picture keeps its existing Return/new-tab action, including after menu Escape.
      const image = el?.querySelector('img.image-thumb:not([hidden])');
      if (image?.isConnected) { image.focus({ preventScroll: true }); revealSelection(image); }
      if (this.doc.activeElement !== before) consume();
    };
    const overlap = (a, b, lo, hi) => Math.min(a[hi], b[hi]) - Math.max(a[lo], b[lo]) > .5;
    const horizontal = action === 'left' || action === 'right';
    let candidates;
    if (horizontal) candidates = cells.filter(cell => cell !== from && overlap(cell.box, from.box, 'top', 'bottom'));
    else {
      const down = action === 'down', gap = box => down ? box.top - from.box.bottom : from.box.top - box.bottom;
      const beyond = cells.filter(cell => cell !== from && gap(cell.box) >= -.5);
      const adjacent = beyond.reduce((best, cell) => !best || gap(cell.box) < gap(best.box) ? cell : best, null);
      if (!adjacent) {
        // The whole-grid boundary owns the key even when no exit exists.
        // Otherwise KeyTree would step sideways from the pressed cell.
        consume();
        const first = Math.min(...cells.map(cell => rows.indexOf(byElement.get(cell.el))));
        const last = Math.max(...cells.map(cell => rows.indexOf(byElement.get(cell.el))));
        if (!down && grid.classList.contains('archive-shelf-row')) {
          // Geometry crosses to Images only when it is the immediately
          // preceding section; intervening rows keep their tree order.
          if (!rows[first - 1]?.el.closest('.things-thumbs')) {
            go(rows[first - 1]?.el);
            return;
          }
          const images = rows.filter(row => row.el.closest('.things-thumbs')).map(row => ({ el: row.el, box: row.el.getBoundingClientRect() }))
            .filter(cell => cell.box.width > 0 && cell.box.height > 0);
          const bottom = Math.max(...images.map(cell => cell.box.top));
          const lastImages = images.filter(cell => Math.abs(cell.box.top - bottom) < 1);
          const remembered = returning?.archive === byElement.get(target)?.key &&
            lastImages.find(cell => byElement.get(cell.el)?.key === returning.image);
          const aligned = lastImages.filter(cell => overlap(cell.box, from.box, 'left', 'right'));
          const middle = box => (box.left + box.right) / 2;
          const next = remembered || (aligned.length ? aligned : lastImages).sort((a, b) => Math.abs(middle(a.box) - middle(from.box)) - Math.abs(middle(b.box) - middle(from.box)))[0];
          if (next) go(next.el);
        } else if (!down) go(byElement.get(target)?.parent);
        else {
          const next = rows[last + 1];
          if (next && grid.classList.contains('things-thumbs') && next.el.classList.contains('shelf-dossier'))
            this.imageReturn = { archive: next.key, image: byElement.get(target).key };
          go(next?.el);
        }
        return;
      }
      candidates = beyond.filter(cell => overlap(cell.box, adjacent.box, 'top', 'bottom') && overlap(cell.box, from.box, 'left', 'right'));
    }
    const next = nearest(from.box, candidates, action);
    if (next) go(next);
    // 1007's explicit partial Images row exception (Warp16397): an
    // unmatched column stays put; actual grid exits still reach the tree.
    else if (!horizontal && grid.classList.contains('things-thumbs')) consume();
    else if (action === 'left' && panes.step('things', 'left', this.doc)) consume();
  }
  // The shared tree chooses a neighbour only for an Archive dossier that
  // vanished. Other missing rows retain KeyTree's normal place fallback.
  missingRow(key, previous, rows) {
    if (!key?.startsWith('archive:')) return null;
    const at = previous.findIndex(row => row.key === key);
    if (at < 0) return null;
    const present = new Map(rows.map(row => [row.key, row]));
    // A whole shelf hidden by layout keeps its place for when it returns.
    // Only an individual removal among surviving old dossiers reanchors.
    if (!previous.some(row => row.key.startsWith('archive:') && present.has(row.key))) return null;
    return [...previous.slice(at + 1), ...previous.slice(0, at).reverse()]
      .map(row => present.get(row.key)).find(Boolean) ?? null;
  }
  // Each section shown, and under an open one what can be pressed in it.
  treeRows() {
    const rows = [];
    for (const [key, part] of this.sections) {
      if (part.details.hidden) continue;
      const summary = part.details.querySelector(':scope > summary');
      rows.push({ el: summary, level: 1, set: this.holder, key: 'section:' + key, parent: null, expanded: part.details.open });
      if (!part.details.open) continue;
      for (const el of part.body.querySelectorAll('a[href], button')) {
        if (Object.hasOwn(el.dataset, 'linkMenu')) continue;
        // Several images can share their message's link; the attachment
        // identity keeps each picture its own cursor place across refresh.
        const identity = el.dataset.railImage ? 'image:' + el.dataset.railImage : el.getAttribute('href') ?? el.textContent.trim();
        rows.push({ el, level: 2, set: part.details, key: `section:${key}|${identity}`, parent: summary });
      }
    }
    const shelf = this.host.querySelector('.archive-shelf');
    if (this.drawnOnce && shelf && !shelf.hidden) for (const el of shelf.querySelectorAll('.shelf-dossier')) {
      rows.push({ el, level: 1, set: shelf, key: 'archive:' + el.dataset.id, parent: null });
    }
    return rows;
  }
  act(action, row, rows) {
    const section = row.level === 1 ? row.el.parentElement : row.el.closest('details');
    // A plain Left always crosses the pane; folding is an explicit action.
    if (action === 'left') { panes.step('things', 'left', this.doc); return; }
    if (action === 'right') { this.tree.stepIn(row, rows, each => { each.el.parentElement.open = true; }); return; }
    // ⌘Return: a new message in the page's place, the panel over the page put away first.
    if (action === 'write') { this.leave(); panes.write?.(null); return; }
    if (action === 'open' && section?.matches('details')) { section.open = true; return; }
    if (action === 'fold' && section?.matches('details')) { section.open = false; this.tree.go(this.tree.list().find(each => each.el === section.querySelector(':scope > summary'))); }
  }
  // The keys come to the rail, on the row they were last on.
  focus() { return this.tree.focus(); }
  isOpen() { return this.doc.documentElement.hasAttribute('data-things-open'); }
  // Whether the rail is on screen: beside the page, or open as a sheet or panel.
  shows() { return !this.host.hidden && (this.wide?.matches || this.isOpen()); }
  open() {
    if (this.host.hidden) return;
    this.doc.documentElement.setAttribute('data-things-open', '');
    this.backdrop.hidden = false;
    this.cover(!this.wide?.matches);
    this.control()?.setAttribute('aria-expanded', 'true');
    this.closer.focus();
    if (this.stale || !this.drawnOnce) this.reload();
  }
  close(focus) {
    if (!this.isOpen()) return;
    this.doc.documentElement.removeAttribute('data-things-open');
    this.backdrop.hidden = true;
    this.cover(false);
    const control = this.control();
    control?.setAttribute('aria-expanded', 'false');
    if (focus) control?.focus();
  }
  // Open over the dimmed page, the rail is all that can be reached: the page
  // and the outline under it take no keys, focus or presses, as under the
  // outline's drawer (rail-drawer.mjs), so a key never acts on what it covers.
  cover(on) { for (const id of ['main', 'rail']) { const part = this.doc.getElementById(id); if (part) part.inert = on; } }
  // The keys leave the rail (panes.mjs): open over the page, it closes first.
  leave() { this.close(false); }
  control() { return this.doc.getElementById('things-open'); }
  // A run starts: on a topic or a Conversation the rail shows, and the page's
  // header gets the button that opens it where it is not beside the page.
  begin(feed, route = null) {
    this.close(false);
    const shown = feed && route?.kind !== 'workspace';
    this.host.hidden = !shown;
    this.unlisten?.(); this.unlisten = null; this.handles = null;
    for (const creator of this.creators.values()) creator.remove();
    this.creators.clear(); this.notebookWant = NOTEBOOK_PAGE; this.buildWant = BUILD_PAGE;
    this.serial += 1;
    this.clear();
    if (!shown) { this.control()?.remove(); return; }
    const row = this.doc.querySelector('#main .eyebrow-row');
    if (row && !this.control()) {
      const button = element(this.doc, 'button', { type: 'button', id: 'things-open', className: 'things-open', textContent: 'Pipeline & pages' });
      button.setAttribute('aria-controls', 'things'); button.setAttribute('aria-expanded', 'false');
      button.onclick = () => (this.isOpen() ? this.close(true) : this.open());
      row.append(button);
    }
  }
  ready(handles) {
    if (handles.route?.kind !== 'topic') { this.begin(false, handles.route); return; }
    if (!handles.topic) return;
    this.handles = handles;
    this.folds ??= new SectionFolds(this.storage, `aim-next.things.${handles.bootstrap.instance_id}.${handles.bootstrap.actor}`);
    this.clear();
    this.unlisten = handles.live?.listen(event => { if (event.kind === 'commit' || event.state === 'live') this.changed(); }) ?? null;
    // A new Notebook page starts from the pencil beside this section's heading
    // (docs/notebook-pages.md): always this topic's. It goes as the next run begins.
    const details = this.sections.get('notebook').details, make = handles.notebookCreate;
    if (make) this.creators.set('topic', make(details, { kind: 'topic', id: handles.topic.id }));
    for (const creator of this.creators.values()) creator.setAvailable(false);
    this.stale = true;
    if (this.shows()) this.reload();
  }
  changed() { this.stale = true; if (this.shows() && this.doc.visibilityState === 'visible') this.reload(); }
  // The page has read its topic again, or can no longer read it. A topic it
  // can no longer read is hidden at once, as the page hides its messages:
  // what the rail shows and keeps of it goes before anything is read again.
  topicChanged() {
    if (!this.handles) return;
    const id = this.handles.topic?.id;
    if (this.handles.readable?.() === false) {
      if (id) this.kept.delete(id); else this.kept.clear();
      this.serial += 1; this.clear();
    }
    this.changed();
  }
  // A message was edited (docs/message-edit.md): its words, and the previews, pull requests and lines read from
  // them, are kept with the version of its topic, which an edit does not move. Each place holding it is read again.
  messageEdited(id) {
    let held = false;
    for (const [place, kept] of this.kept) if (kept.value.messages.some(message => message.id === id)) { this.kept.delete(place); held = true; }
    if (held) this.changed();
    return held;
  }
  shown() { if (this.handles && this.stale && this.shows()) this.reload(); }
  // Nothing of the topic before stays on screen: every section goes,
  // with its words, until this one's read lands.
  clear() {
    this.imageMenus?.reset(); this.imageReturn = null; this.links?.reset();
    for (const part of this.sections.values()) { part.drawn = null; part.details.hidden = true; part.body.replaceChildren(); part.sum.textContent = ''; }
    for (const creator of this.creators.values()) creator.setAvailable(false);
    this.nothing.hidden = true; this.message.hidden = true; this.retry.hidden = true;
    this.drawnOnce = false; this.holder.setAttribute('aria-busy', 'true');
  }
  get topicId() { return this.handles?.topic?.id ?? null; }
  // Everything the sections show, read again, through the run that is up
  // (its reads still waiting when it goes are never sent). A read overtaken
  // by a newer one, or by a move, says nothing; one that fails keeps what was
  // shown and offers Try again.
  async load() {
    const handles = this.handles;
    if (!handles) return true;
    const serial = ++this.serial, workspace = handles.workspaceId, topicId = this.topicId;
    const view = (name, args) => handles.view(name, args);
    this.stale = false;
    // A topic the page can no longer read (its updates refused) is not read here either.
    const readable = id => id !== handles.topic?.id || handles.readable?.() !== false;
    const pipeline = settle(this.readPipeline(view, workspace));
    const tools = !readable(topicId) ? settle(Promise.resolve(null))
      : settle(view('topic_tools', { topic_id: topicId }).then(answer => answer.linked.map(tool => ({ ...tool, home: tool.home_workspace_id }))));
    const notebook = !readable(topicId) ? settle(Promise.resolve(null)) : settle(this.readNotebook(view, { kind: 'topic', id: topicId }));
    const links = this.links ? settle(readable(topicId) ? this.links.read(handles) : Promise.resolve(null)) : settle(Promise.resolve(undefined));
    const places = [this.topicPlace(handles)].filter(place => readable(place.id));
    if (serial !== this.serial || handles !== this.handles) return true;
    const reads = places.map(place => settle(this.readPlace(view, place, 24)));
    const [pipe, notes, toolsRead, linksRead, ...found] = await Promise.all([pipeline, notebook, tools, links, ...reads]);
    if (serial !== this.serial || handles !== this.handles) return true;
    const failed = [pipe, notes, toolsRead, linksRead, ...found].filter(read => read.error && !denied(read.error));
    const messages = found.flatMap(read => read.value ? read.value.messages.map(message => ({ ...message, place: read.value.place })) : []);
    const images = new Map();
    for (const read of found) for (const image of read.value?.images ?? []) if (!images.has(image.attachment.id)) images.set(image.attachment.id, { ...image, place: read.value.place });
    this.paint({ topicId, pipeline: pipe.value ?? (pipe.error ? undefined : null), notebook: notes.value === null ? null : notes.value?.items ?? (notes.error ? undefined : []),
      links: linksRead.value ?? (linksRead.error && denied(linksRead.error) ? null : undefined),
      notebookMayWrite: notes.value?.reader_may_write === true, notebookNext: notes.value?.next ?? null,
      messages, images: [...images.values()].sort((a, b) => (b.sent_ms ?? 0) - (a.sent_ms ?? 0)),
      tools: toolsRead.value === null ? [] : toolsRead.value ?? (toolsRead.error ? undefined : []) });
    this.drawnOnce = true; this.holder.removeAttribute('aria-busy');
    this.message.hidden = this.retry.hidden = !failed.length;
    if (failed.length) this.message.textContent = 'Some of this could not be read just now; what shows is what was read last.';
    return !failed.length;
  }
  // The open topic alone, at the version the page last read it at (it says when that moves: topicChanged).
  topicPlace(handles) {
    const topic = handles.currentTopic?.() ?? handles.topic;
    return { id: topic.id, title: topic.title, version: topic.version };
  }
  // One place's newest messages and its images, read again only when its
  // topic has moved on since (a message, a state), so a commit elsewhere
  // reads nothing here.
  async readPlace(view, place, limit) {
    const kept = this.kept.get(place.id);
    if (kept && place.version !== undefined && kept.version === place.version && kept.limit === limit) return { ...kept.value, place };
    const [messages, images] = await Promise.all([
      view('topic_messages', { topic_id: place.id, direction: 'before', limit: MESSAGES }),
      view('topic_images', { topic_id: place.id, limit }),
    ]);
    const value = { place, messages: messages.items ?? [], images: (images.items ?? []).filter(image => image.topic_id === place.id) };
    this.kept.set(place.id, { version: place.version, limit, value });
    return value;
  }
  // The Notebook's pages from its first, as many as the person has asked for
  // (NOTEBOOK_PAGE, and as many again for each More pages), in Core's pages;
  // next says whether there are more, and whether the reader may write in it
  // comes with the first page.
  async readNotebook(view, owner_scope, want = this.notebookWant) {
    const items = [], most = this.handles?.pageMax ?? NOTEBOOK_PAGE;
    let cursor = null, mayWrite;
    do {
      const answer = await view('memory_items', { owner_scope, limit: Math.max(1, Math.min(most, want - items.length)), ...(cursor === null ? {} : { cursor }) });
      items.push(...(answer.items ?? [])); cursor = answer.next_cursor ?? null; mayWrite ??= answer.reader_may_write;
    } while (cursor !== null && items.length < want);
    return { items, next: cursor, reader_may_write: mayWrite };
  }
  notebookName(item) { return item.title || 'Notebook page'; }
  // A deliberate Note choice needs every destination, including pages beyond
  // the rail's More boundary. Same scoped reader/order, bounded calls, no poll.
  async notebookPages(topicId) {
    const handles = this.handles;
    if (!handles || this.topicId !== topicId || handles.readable?.() === false) throw Error('This topic is no longer available.');
    const answer = await this.readNotebook((name, args) => handles.view(name, args, 'foreground'), { kind: 'topic', id: topicId }, Infinity);
    if (handles !== this.handles || handles.readable?.() === false) throw Error('This topic is no longer available.');
    return answer.items.map(item => ({ id: item.id, name: this.notebookName(item) }));
  }
  async readPipeline(view, workspace) {
    const now = await view('pipeline', { workspace_id: workspace, section: 'now', limit: 100 });
    if (now.pipeline === null) return null;
    const next = await view('pipeline', { workspace_id: workspace, section: 'next', limit: 20 });
    // A pipeline that is on has Build topics (item 297); Core lists none for one that is off.
    const builds = now.pipeline?.enabled ? await this.readBuilds(view, workspace) : { items: [], next: null, fresh: 0 };
    return { now, next, builds };
  }
  // The outcome's Build topics not Done, from the first, as many as the
  // person has asked for (BUILD_PAGE, and as many again for each More topics),
  // in Core's pages and order; next says whether there are more, fresh how
  // many messages in all of them are new to the reader (Core's builds), and
  // building the ones a piece is being built in, whatever page they are on.
  // The reader's own order of the outcome's topics, which every page carries,
  // is learned as the outline learns it (outline-order.mjs).
  async readBuilds(view, workspace) {
    const items = [], want = this.buildWant, most = this.handles?.pageMax ?? BUILD_PAGE;
    let cursor = '', fresh = 0, building = null;
    do {
      const answer = await view('workspace_topics', { workspace_id: workspace, build: true, limit: Math.max(1, Math.min(most, want - items.length)), cursor });
      items.push(...(answer.items ?? [])); cursor = answer.next_cursor ?? null;
      fresh = Number.isSafeInteger(answer.builds?.unread) && answer.builds.unread > 0 ? answer.builds.unread : 0;
      building = Array.isArray(answer.building) ? answer.building : null;
      book.learn(scopeOf(workspace), orderOf(answer));
    } while (cursor !== null && items.length < want);
    return { items, next: cursor, fresh, building };
  }
  // Each section's words, drawn only when they change, so the pointer's hover
  // and focus stay where they were. A section takes its kept fold as it
  // appears, and is left as the person has it after that.
  paint(found) {
    const reader = this.handles.bootstrap.actor, nowMs = clock.now();
    const items = found.pipeline ? this.pipelineRows(found.pipeline, book.ids(scopeOf(this.handles.workspaceId))) : null;
    const { previews, prs } = thingsIn(found.messages);
    // The pencil of the Notebook listed shows only to someone Core lets write it (reader_may_write).
    if (found.notebook !== undefined) for (const creator of this.creators.values()) creator.setAvailable(found.notebook !== null && found.notebookMayWrite);
    const shown = {
      pipeline: found.pipeline === undefined ? undefined : this.pipelineSection(items, found, nowMs),
      waiting: items ? this.waitingSection(waitingFor({ reader, now: items.now, next: items.next, topic: found.topicId }), nowMs) : null,
      notebook: found.notebook === undefined ? undefined : this.notebookSection(found.notebook, found),
      previews: this.links ? this.links.section(previews, found.links) : this.linkSection(previews, nowMs, reader, preview => preview.url),
      prs: this.linkSection(prs, nowMs, reader, pr => pr.href, 'Whether each is open or merged is not recorded here.'),
      images: this.imageSection(found.images, reader),
      tools: found.tools === undefined ? undefined : this.toolSection(found.tools),
    };
    const linkFocus = this.links?.focusKey();
    let any = false;
    for (const [key] of SECTIONS) {
      const part = this.sections.get(key), section = shown[key];
      if (section === undefined) continue; // not read this time: what showed stays
      const appears = part.details.hidden && Boolean(section);
      part.details.hidden = !section;
      if (!section) { part.drawn = null; part.body.replaceChildren(); continue; }
      // An empty Notebook kept for its pencil is not something the place refers to.
      if (section.key !== 'note-none') any = true;
      part.sum.textContent = section.sum;
      if (part.drawn !== section.key) {
        part.drawn = section.key;
        part.body.replaceChildren(section.node());
      }
      if (appears) part.details.open = this.folds.isOpen(key);
    }
    // More pages and More topics, pressed with the focus on them, hand the focus to the first row they brought once they have gone.
    const brought = this.notebookFrom === null ? null : this.sections.get('notebook').body.querySelectorAll('.things-list a.row')[this.notebookFrom];
    if (brought) {
      this.notebookFrom = null;
      if (!this.doc.activeElement || this.doc.activeElement === this.doc.body) brought.focus();
    }
    const builtFrom = this.buildFrom === null ? null : [...this.sections.get('pipeline').body.querySelectorAll('.pipe-builds a.row')].find(row => !this.buildFrom.has(row.getAttribute('href')));
    if (builtFrom) {
      this.buildFrom = null;
      if (!this.doc.activeElement || this.doc.activeElement === this.doc.body) builtFrom.focus();
    }
    this.links?.restoreFocus(linkFocus);
    this.nothing.hidden = any;
    this.nothing.textContent = 'This topic refers to nothing yet.';
  }
  pipelineRows({ now, next, builds }, saved = []) {
    const titles = new Map((now.items ?? []).map(item => [item.number, item.title]));
    const pieceTopic = new Map();
    for (const piece of now.pieces ?? []) for (const number of piece.items ?? []) pieceTopic.set(number, piece.topic?.id ?? null);
    const withTopic = item => ({ ...item, pieceTopic: pieceTopic.get(item.number) ?? null });
    return { rows: buildRows(now.pieces, builds?.items, { titles, building: builds?.building ?? null, saved }), more: (builds?.next ?? null) !== null, builds: builds?.items ?? [], fresh: builds?.fresh ?? 0,
      now: (now.items ?? []).map(withTopic), next: (next.items ?? []).map(withTopic), title: now.pipeline?.title ?? 'Pipeline' };
  }
  // The pipeline, and in it the outcome's Build topics (item 297): the outline
  // lists none of them, so they show here, each row carrying what the outline's
  // row would. Live and Next remain on the outcome's pipeline page.
  pipelineSection(items, found, nowMs) {
    const doc = this.doc, workspace = this.handles.workspaceId, reader = this.handles.bootstrap.actor, here = found.topicId;
    if (!items) return null;
    const { now, review, other } = items.rows;
    if (!now.length && !review.length && !other.length) return null;
    const marks = row => row.item ? [row.item.title, row.item.unread, row.item.addressed, row.item.state, row.item.waiting_on, row.item.asks, row.item.state_note, row.item.work] : null;
    const said = rows => rows.map(row => [row.title, row.topic, row.stage ?? null, row.since ?? null, marks(row), row.topic === here]);
    const key = JSON.stringify(['pipe', said(now), said(review), said(other), items.more]);
    // Folded, the section still says what is new in its Build topics, which no other list shows.
    const sum = [now.find(row => row.topic === here)?.stage ?? '', items.fresh ? `${items.fresh} new` : ''].filter(Boolean).join(' · ');
    // A Build topic's row: its title and what the outline's row would carry after it, then the line under it.
    const topicRow = (row, sub = null) => {
      if (!row.topic) return element(doc, 'span', { className: 'row' }, row.title, sub);
      const link = this.placeLink({ kind: 'topic', id: row.topic, ...(row.item && questionOf(row.item, reader) ? { message: questionOf(row.item, reader) } : {}) }, row.title);
      link.onclick = event => {
        if (!plainClick(event) || !this.handles) return;
        event.preventDefault();
        const unread = landsOnUnread(event.target, event);
        const message = !unread && row.item ? nextQuestionOf(row.item, reader) : null;
        const target = { kind: 'topic', id: row.topic, ...(unread ? { at: 'unread' } : message ? { message } : {}) };
        if (!this.wide?.matches) this.close(false);
        this.handles.open(target, row.title, link);
      };
      if (row.item) paintMarks(link, row.item, reader);
      if (sub) link.append(sub);
      if (row.topic === here) link.setAttribute('aria-current', 'page');
      return link;
    };
    const group = (label, rows, sub = () => null) => [element(doc, 'div', { className: 'pipe-label', textContent: label }),
      element(doc, 'ul', { className: 'things-list' }, ...rows.map(row => element(doc, 'li', {}, topicRow(row, sub(row)))))];
    return { sum, key, node: () => {
      const box = element(doc, 'div');
      const builds = element(doc, 'div', { className: 'pipe-builds' });
      if (now.length) builds.append(...group('Now', now, row => element(doc, 'span', { className: 'sub' }, row.stage ? element(doc, 'b', { textContent: row.stage }) : 'Waiting for a stage', row.since ? ` · since ${shownTime(row.since, nowMs)}` : '')));
      if (review.length) builds.append(...group('Ready for review', review));
      if (other.length) builds.append(...group('Other Build topics', other));
      if (items.more) {
        // The rest of the Build topics, a page at a time, read again with the rail from then on.
        const more = element(doc, 'button', { type: 'button', className: 'things-more', textContent: 'More topics' });
        more.onclick = () => { this.buildWant = items.builds.length + BUILD_PAGE; this.buildFrom = this.doc.activeElement === more ? new Set([...builds.querySelectorAll('a.row')].map(row => row.getAttribute('href'))) : null; this.reload(); };
        builds.append(more);
      }
      if (builds.childElementCount) box.append(builds);
      box.append(element(doc, 'a', { className: 'pipe-open', href: pipelineHref(workspace), textContent: 'The whole pipeline →' }));
      return box;
    } };
  }
  waitingSection(rows, nowMs) {
    if (!rows.length) return null;
    const doc = this.doc, workspace = this.handles.workspaceId;
    const where = row => row.where.stage ? `${row.where.stage} · since ${shownTime(row.where.since, nowMs)}` : row.where.words;
    return { sum: String(rows.length), key: JSON.stringify(['wait', rows.map(row => [row.what, where(row)])]), node: () => element(doc, 'ul', { className: 'things-list' }, ...rows.map(row => {
      const sub = element(doc, 'span', { className: 'wait-state', textContent: where(row) });
      return element(doc, 'li', {}, element(doc, 'a', { className: 'row', href: pipelineHref(workspace, row.item.number) }, row.what, sub));
    })) };
  }
  notebookSection(items, found) {
    if (!items?.length) {
      // An empty Notebook keeps its heading, and with it the pencil that starts its first page.
      return items && this.creators.get('topic')?.available ? { sum: '', key: 'note-none', node: () => this.doc.createTextNode('') } : null;
    }
    const doc = this.doc, scope = { kind: 'topic', id: found.topicId }, more = found.notebookNext !== null;
    return { sum: `${items.length}${more ? '+' : ''}`, key: JSON.stringify(['note', scope, more, items.map(item => [item.id, item.title, item.revision, item.read_revision, item.draft === true])]), node: () => {
      const list = element(doc, 'ul', { className: 'things-list' }, ...items.map(item => {
        const link = this.placeLink({ ...scope, page: item.id }, this.notebookName(item));
        paintChanged(link, item);
        // A page shows its own first words under its title, so it reads as a page rather than a link.
        const words = openingWords(item.body, this.notebookName(item));
        if (words) link.append(element(doc, 'span', { className: 'things-opening', textContent: words }));
        return element(doc, 'li', {}, link);
      }));
      if (!more) return list;
      // The rest of the Notebook, a page of it at a time, read again with the rail from then on.
      const button = element(doc, 'button', { type: 'button', className: 'things-more', textContent: 'More pages' });
      button.onclick = () => { this.notebookWant = items.length + NOTEBOOK_PAGE; this.notebookFrom = this.doc.activeElement === button ? items.length : null; this.reload(); };
      return element(doc, 'div', {}, list, button);
    } };
  }
  linkSection(rows, nowMs, reader, href, note = null) {
    if (!rows.length) return null;
    const doc = this.doc;
    const from = row => `${row.message.author_id === reader ? 'you' : row.message.author_id} · ${shownTime(row.message.sent_ms, nowMs)}`;
    return { sum: String(rows.length), key: JSON.stringify(['link', rows.map(row => [href(row), row.title, from(row)]), note]), node: () => {
      const list = element(doc, 'ul', { className: 'things-list' }, ...rows.slice(0, 12).map(row => {
        const link = element(doc, 'a', { className: 'row', href: href(row), target: '_blank', rel: 'noopener' }, row.title, element(doc, 'span', { className: 'sub', textContent: from(row) }));
        link.title = href(row);
        return element(doc, 'li', {}, link);
      }));
      return note ? element(doc, 'div', {}, list, element(doc, 'p', { className: 'things-quiet', textContent: note })) : list;
    } };
  }
  // Skills and tools: each opens its page; one with no live record (a first
  // version that did not ship) is named, with no page to open.
  toolSection(tools) {
    if (!tools.length) return null;
    const doc = this.doc;
    return { sum: String(tools.length), key: JSON.stringify(['tools', tools.map(tool => [tool.tool_id, tool.name, tool.home, tool.live])]), node: () =>
      element(doc, 'ul', { className: 'things-list' }, ...tools.map(tool => element(doc, 'li', {}, tool.live && tool.home ? this.toolLink(tool) : element(doc, 'span', { className: 'row', textContent: tool.name })))) };
  }
  toolLink(tool) {
    const target = { kind: 'tool', id: tool.home, tool: tool.tool_id };
    const link = element(this.doc, 'a', { className: 'row', href: '?' + new URLSearchParams({ workspace: tool.home, tool: tool.tool_id }) }, tool.name);
    link.onclick = event => {
      if (!plainClick(event) || !this.handles) return;
      event.preventDefault();
      if (!this.wide?.matches) this.close(false);
      this.handles.open(target, tool.name, link);
    };
    return link;
  }
  imageSection(images, reader) {
    if (!images.length) return null;
    const doc = this.doc, { api, bootstrap, inTurn } = this.handles;
    return { sum: String(images.length), key: JSON.stringify(['img', images.map(image => [image.source_ref.id, image.attachment.id, image.attachment.sha256])]), node: () => element(doc, 'div', { className: 'things-thumbs' }, ...images.map(image => {
      const label = `${image.attachment.name ?? 'Image'}, from ${image.author_id === reader ? 'you' : image.author_id}, ${datedTime(image.sent_ms)}`;
      const link = this.placeLink({ kind: 'topic', id: image.topic_id, message: image.source_ref.id }, '');
      link.className = 'thumb'; link.title = label; link.setAttribute('aria-label', label);
      link.dataset.railImage = image.attachment.id; link.railImage = image;
      paintThumb(link, `${image.source_ref.id}:${image.attachment.id}`, () => inTurn(async () => (await api.media(bootstrap.instance_id, image.attachment, image.source_ref)).blob));
      return link;
    })) };
  }
  // A place inside the outcome: a link that opens it through the page, so
  // writing not yet saved still asks first, and a message in the open topic
  // opens in the Reader.
  placeLink(target, title, ...rest) {
    const link = element(this.doc, 'a', { className: 'row', href: '?' + new URLSearchParams(target.kind === 'topic'
      ? { topic: target.id, ...(target.message ? { message: target.message } : {}), ...(target.page ? { page: target.page } : {}) }
      : { workspace: target.id, ...(target.page ? { page: target.page } : {}) }) }, title, ...rest);
    link.onclick = event => {
      if (!plainClick(event) || !this.handles) return;
      event.preventDefault();
      // A press on a topic's unread count opens it at its oldest unread message (item 613).
      const to = target.kind === 'topic' && landsOnUnread(event.target, event) ? { kind: 'topic', id: target.id, at: 'unread' } : target;
      if (!this.wide?.matches) this.close(false);
      this.handles.open(to, title || 'that page', link);
    };
    return link;
  }
}
const denied = error => readFailure(error).kind === 'forbidden';
