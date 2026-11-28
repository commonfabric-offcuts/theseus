// The archive shelf: the dossiers a reader
// archived in this topic sit at the foot of the right rail as small replicas
// of themselves, each with its title. The feed never shows them: a click
// brings one back, and a right-click or the menu key offers Bring back as a
// menu. Archiving flies
// the dossier down into the shelf, the lower right corner where the rail is
// not drawn.
import { openMessageMenu } from './message-menu.mjs';
import { archiveOrder, dossierOf, keyOf } from './stack-order.mjs';
import { keyAction } from './pane-keys.mjs';
import { ArchiveTrash } from './archive-trash.mjs';

const VIEW_KEY = 'theseus-archive-view', AUTO_LIST = 18;
// Grid: four replicas; List: three rows, each a dot and a line, as the rail's topics.
const GRID = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1.2" fill="currentColor"/><rect x="9" y="2" width="5" height="5" rx="1.2" fill="currentColor"/><rect x="2" y="9" width="5" height="5" rx="1.2" fill="currentColor"/><rect x="9" y="9" width="5" height="5" rx="1.2" fill="currentColor"/></svg>';
const LIST = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2.6" width="2.6" height="2.6" rx=".7" fill="currentColor"/><rect x="6" y="3.1" width="8" height="1.6" rx=".8" fill="currentColor"/><rect x="2" y="6.7" width="2.6" height="2.6" rx=".7" fill="currentColor"/><rect x="6" y="7.2" width="8" height="1.6" rx=".8" fill="currentColor"/><rect x="2" y="10.8" width="2.6" height="2.6" rx=".7" fill="currentColor"/><rect x="6" y="11.3" width="8" height="1.6" rx=".8" fill="currentColor"/></svg>';
const VIEWS = [['auto', 'Auto', ''], ['grid', 'Grid', GRID], ['list', 'List', LIST]];
const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = text; return node;
};
const SHEETS = 3;
// Where the page lays a node out, or null for a node it does not draw (a replica on a rail not shown, a dossier hidden).
const box = node => node?.isConnected && node.getClientRects().length ? node.getBoundingClientRect() : null;
// A copy of a dossier to fly: no ids of its own, so nothing on the page is found twice while it flies.
const copyOf = node => { const copy = node.cloneNode(true); copy.removeAttribute?.('id'); for (const each of copy.querySelectorAll?.('[id]') ?? []) each.removeAttribute('id'); return copy; };

function archivedRow(item, topicId) {
  const id = item.message_id;
  const position = { root_id: id, through: item.through, aside_revision: item.aside_revision, below: true,
    order_key: item.order_key, order_tie: item.order_tie, order_entry_key: item.order_entry_key,
    at: { messages: item.latest, acts: 0 } };
  const head = { id, topic_id: topicId, seq: item.seq, author_id: item.author_id, author_kind: item.author_kind,
    body: item.excerpt, stack_position: position };
  return { stack: { id, head, replies: [], orderKey: item.order_key, orderTie: item.order_tie, archivedProjection: true },
    section: null, starred: item.starred, projected: item };
}

// The arc down: from where the dossier sat to its end, shrinking as it goes.
const path = (rect, end) => {
  const dx = end.left - rect.left, dy = end.top - rect.top, sx = end.width / rect.width, sy = end.height / rect.height;
  return [
    { transform: 'translate(0,0) scale(1,1)', opacity: 1, borderRadius: '10px' },
    { transform: `translate(${dx * 0.35}px,${dy * 0.18}px) scale(${0.62 + sx * 0.2},${0.62 + sy * 0.2})`, opacity: 0.95, offset: 0.35 },
    { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, opacity: 0.35, borderRadius: '24px' },
  ];
};

export class ArchiveShelf {
  // restore brings a dossier back; undo is the feed's one-key undo; changed says the shelf began or stopped being
  // drawn (the rail moved beside the page or away), outside any redraw of the feed.
  constructor({ doc, restore, undo = () => {}, changed = () => {}, unread = () => false, read = null, readTrash = null,
    allows = () => true, afterRead = () => {} }) {
    this.doc = doc; this.restore = restore; this.undo = undo; this.changed = changed; this.unread = unread;
    this.read = read; this.allows = allows; this.afterRead = afterRead; this.projected = new Map(); this.given = [];
    this.suppress = new Set(); this.cursor = null; this.remaining = null; this.epoch = 0;
    this.archiveReady = !read; this.trashEmpty = false;
    this.replicas = new Map(); this.stacks = new Map(); this.flights = new Map();
    // The dossiers archived on this page, the latest last: they go first on the shelf. Any other keeps Core's order.
    this.here = []; this.drawn = false; this.list = [];
    this.root = element(doc, 'section', 'archive-shelf'); this.root.id = 'archive-shelf';
    this.root.setAttribute('aria-labelledby', 'archive-shelf-heading'); this.root.hidden = true;
    const head = this.head = element(doc, 'div', 'archive-shelf-head');
    this.heading = element(doc, 'h2', '', 'Archived'); this.heading.id = 'archive-shelf-heading';
    this.count = element(doc, 'span', 'archive-shelf-count');
    this.viewGroup = this.views();
    head.append(this.heading, this.count, this.viewGroup);
    this.row = element(doc, 'div', 'archive-shelf-row'); this.row.setAttribute('role', 'list');
    this.more = element(doc, 'button', 'archive-shelf-more', 'Show more'); this.more.hidden = true;
    this.more.type = 'button'; this.more.onclick = () => this.readPage(Boolean(this.pageError));
    this.more.setAttribute('aria-label', 'Load more archived dossiers');
    this.notice = element(doc, 'span', 'archive-shelf-notice');
    this.notice.setAttribute('role', 'status');
    this.root.append(head, this.row, this.more, this.notice);
    if (readTrash) {
      this.trash = new ArchiveTrash({ doc, read: readTrash, afterRead, folded: () => this.trashFolded() });
      this.root.append(this.trash.root);
    }
    const replicaOf = event => event.target.closest?.('.shelf-dossier') ?? null;
    this.row.addEventListener('contextmenu', event => {
      const replica = replicaOf(event); if (!replica) return;
      event.preventDefault(); this.menu(replica, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null);
    });
    this.row.addEventListener('keydown', event => {
      // The undo that worked at More works at the replica the focus went to after Archive.
      if (keyAction(event) === 'undo' && replicaOf(event)) { event.preventDefault(); this.undo(); return; }
      if (!(event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) || event.ctrlKey || event.altKey || event.metaKey) return;
      const replica = replicaOf(event); if (replica) { event.preventDefault(); this.menu(replica, null); }
    });
    // The right rail outlives a page moved to in place (in-place-navigation.mjs keeps #things), but this
    // shelf is its topic's: it leaves with the page, which hears pagehide as on an unload.
    doc.defaultView?.addEventListener('pagehide', () => this.leave(), { once: true });
  }
  // Gone with its page: a feed left behind that still hears Core draws nothing in the rail.
  leave() {
    this.trash?.show(false);
    this.gone = true; this.root.remove(); this.watching?.disconnect(); this.panelWatching?.disconnect(); this.wide?.removeEventListener?.('change', this.recheck);
    if (this.drawn) delete this.doc.body.dataset.archiveShelf;
  }
  setAvailable(available) {
    if (available === !this.unavailable) return;
    this.unavailable = !available;
    this.epoch++;
    this.started = false; this.refreshPending = false; this.pageError = false;
    this.archiveReady = !this.read; this.trashEmpty = false;
    this.trash?.invalidate();
    this.projected.clear(); this.cursor = null; this.remaining = null;
    this.paint([], new Set(), true);
  }
  removed(id, removal) {
    this.trash?.learnRemoval(id, removal);
    this.epoch++;
    this.projected.delete(id);
    this.remaining = null;
    this.paint(this.given.filter(each => dossierOf(each.stack) !== id), this.suppress, true);
    this.refresh();
  }
  // The rail is drawn again by the page as it moves; the shelf goes back in at its foot.
  place() {
    const things = this.doc.getElementById('things');
    if (!things) return false;
    // One shelf in the rail: another page's, if any were left, goes. It is put in once: moving a node
    // drops the focus inside it, so its place at the rail's foot is the stylesheet's (order).
    for (const other of things.querySelectorAll('.archive-shelf')) if (other !== this.root) other.remove();
    if (this.root.parentElement !== things) things.append(this.root);
    this.watch(things);
    return true;
  }
  // Whether the right rail stands beside the page, as the page draws it now: laid out (not hidden, as on an outcome's
  // Conversation, nor display:none, as with the Notebook docked), visible, and in the page's flow, not the panel that
  // slides over it at middle widths or the phone's sheet (both fixed). Read from the drawing, not the window's width.
  beside() {
    const things = this.root.parentElement ?? this.doc.getElementById('things'), view = this.doc.defaultView;
    if (!things?.getClientRects?.().length || typeof view?.getComputedStyle !== 'function') return false;
    const look = view.getComputedStyle(things);
    return look.visibility === 'visible' && look.display !== 'none' && look.position !== 'fixed';
  }
  // The shelf is drawn, the feed's Archived (N) hidden and the flights run only where the rail is beside the page;
  // everywhere else the feed keeps Archived (N), as before the shelf.
  inPanel() { return Boolean(this.read && this.doc.documentElement?.hasAttribute?.('data-things-open')); }
  update(notify) {
    const hasRows = !this.unavailable && Boolean(this.list.length || this.cursor || this.pageError);
    const beside = this.beside(), drawn = hasRows && beside, was = this.drawn;
    const panel = this.inPanel();
    const visible = !this.unavailable && (beside || panel);
    const emptyTrash = this.trashEmpty || this.trash?.confirmedEmpty;
    const showTrash = this.trash && (hasRows || this.archiveReady && (!emptyTrash || this.trash.root.open));
    this.drawn = drawn; this.root.hidden = !(visible && (hasRows || showTrash));
    this.head.hidden = !hasRows;
    if (hasRows) this.root.setAttribute('aria-labelledby', this.heading.id);
    else this.root.removeAttribute('aria-labelledby');
    this.viewGroup.hidden = !hasRows;
    this.trash?.show(visible && Boolean(showTrash));
    if (drawn) this.doc.body.dataset.archiveShelf = 'on'; else delete this.doc.body.dataset.archiveShelf;
    if (notify && drawn !== was) this.changed(drawn);
    if (this.read && !this.unavailable && (beside || panel)) {
      if (!this.started) { this.started = true; this.refreshPending = true; }
      if (this.refreshPending) this.refresh();
    }
  }
  trashFolded() {
    const focused = this.doc.activeElement === this.trash.summary;
    this.update(false);
    if (focused && this.root.hidden) {
      const rail = this.root.parentElement;
      const sections = rail?.querySelectorAll('.things-sec:not([hidden]) > summary') ?? [];
      (Array.from(sections).at(-1) ?? rail?.querySelector('#things-close'))?.focus({ preventScroll: true });
    }
  }
  // Drawn again as the rail moves beside the page or away: a resize across the wide rail's width, the Notebook
  // docking or undocking, the rail hidden or shown.
  watch(things) {
    if (this.watched === things) return;
    this.watched = things; this.watching?.disconnect();
    const view = this.doc.defaultView;
    this.recheck ??= () => { if (!this.gone) this.update(true); };
    if (typeof view?.ResizeObserver === 'function') { this.watching = new view.ResizeObserver(this.recheck); this.watching.observe(things); }
    if (!this.wide && typeof view?.matchMedia === 'function') { this.wide = view.matchMedia('(min-width: 1181px)'); this.wide.addEventListener?.('change', this.recheck); }
    if (this.read && !this.panelWatching && typeof view?.MutationObserver === 'function') {
      this.panelWatching = new view.MutationObserver(this.recheck);
      this.panelWatching.observe(this.doc.documentElement, { attributes: true, attributeFilter: ['data-things-open'] });
    }
  }
  // Archived here, now: first on the shelf. Brought back: it leaves the list.
  putAway(id) { this.here = [...this.here.filter(each => each !== id), id]; }
  broughtBack(id) { this.here = this.here.filter(each => each !== id); }
  // Latest on top: a dossier archived while the page is open goes first on the shelf, before those already on it,
  // so the flight down always lands where the shelf begins. The first drawing keeps Core's order.
  refresh() {
    if (!this.read || !this.started || this.gone || this.unavailable) return;
    this.trash?.invalidate();
    this.refreshPending = true;
    if (!this.pending && (this.beside() || this.inPanel())) queueMicrotask(() => {
      if (this.refreshPending && (this.beside() || this.inPanel())) this.readPage(true);
    });
  }
  async readPage(reset) {
    if (!this.read || this.gone || this.pending || this.unavailable) return;
    if (!reset && !this.cursor) return;
    const focusMore = !reset && this.doc.activeElement === this.more;
    let firstAdded = null;
    const epoch = this.epoch;
    this.refreshPending = false;
    this.pending = true; this.pageError = false;
    this.paintPaging();
    try {
      const answer = await this.read(reset ? null : this.cursor);
      await this.afterRead();
      if (this.gone || this.refreshPending || epoch !== this.epoch) return;
      if (reset) {
        this.projected.clear();
        this.archiveReady = true; this.trashEmpty = answer.trash_empty === true;
      }
      for (const item of answer.items) {
        if (!this.projected.has(item.message_id)) firstAdded ??= item.message_id;
        this.projected.set(item.message_id, archivedRow(item, answer.topic_id));
      }
      this.cursor = answer.next_cursor;
      this.remaining = answer.remaining;
    } catch (error) {
      await this.afterRead();
      if (this.gone || this.refreshPending || epoch !== this.epoch) return;
      this.projected.clear(); this.cursor = null; this.remaining = null;
      this.archiveReady = true; this.trashEmpty = false;
      if (error?.details?.error?.code === 'UNKNOWN_VIEW') this.read = null;
      else this.pageError = true;
    } finally {
      this.pending = false;
      if (!this.gone) {
        this.paint(this.given, this.suppress, true);
        if (focusMore && (this.doc.activeElement === this.more || this.doc.activeElement === this.doc.body)) {
          (this.replicas.get(firstAdded) ?? this.more).focus({ preventScroll: true });
        }
      }
    }
  }
  paintPaging() {
    this.more.hidden = !(this.cursor || this.pageError);
    this.more.disabled = this.pending === true;
    const count = this.list.every(({ stack }) => this.projected.has(dossierOf(stack))) ? this.remaining : null;
    this.more.textContent = this.pageError ? 'Retry archives' : count == null ? 'Show more' : `Show ${count} more`;
    this.more.setAttribute('aria-label', this.pageError ? 'Retry loading archived dossiers'
      : count == null ? 'Show more archived dossiers' : `Show ${count} more archived dossiers`);
    this.notice.textContent = this.pending ? 'Loading archives…' : this.pageError ? 'Could not load archived dossiers.' : '';
  }
  paint(given, suppress = new Set(), notify = false) {
    if (this.gone) return;
    if (this.unavailable) given = [];
    this.given = given; this.suppress = suppress;
    this.place();
    if (this.projected.size) {
      const current = new Set(given.map(each => dossierOf(each.stack)));
      const extra = [...this.projected].filter(([id, entry]) => !suppress.has(id) && !current.has(id) && this.allows(entry.projected))
        .map(([, entry]) => entry);
      given = [...given, ...extra].sort((a, b) => keyOf(b.stack) - keyOf(a.stack) ||
        (b.stack.orderTie ?? b.stack.lifted) - (a.stack.orderTie ?? a.stack.lifted) || b.stack.head.seq - a.stack.head.seq);
    }
    const byId = new Map(given.map(each => [each.stack.id, each]));
    const mine = this.here.filter(id => byId.has(id)).reverse().map(id => byId.get(id));
    const local = new Set(mine);
    const ordered = [...mine, ...given.filter(each => !local.has(each))];
    const list = archiveOrder(ordered, each => each.starred);
    const live = new Set();
    // Every look read before any is written, so the page lays out once.
    const looks = list.map(({ stack, section, starred, projected }) => this.look(stack, section, starred, projected));
    list.forEach(({ stack }, index) => {
      live.add(stack.id); this.stacks.set(stack.id, stack);
      let replica = this.replicas.get(stack.id);
      if (!replica) { replica = this.make(stack.id); this.replicas.set(stack.id, replica); }
      this.dress(replica, looks[index]);
      // Moved only when out of order: moving a replica would drop the focus it holds.
      const item = replica.parentElement, at = this.row.children[index] ?? null;
      if (at !== item) this.row.insertBefore(item, at);
    });
    // A replica leaving the shelf (brought back, or the archive undone) takes its flight, if still in the air, with it.
    // Its copy goes at once, before a flight back can start from the same spot.
    for (const [id, replica] of this.replicas) if (!live.has(id)) { this.land(id); replica.parentElement.remove(); this.replicas.delete(id); this.stacks.delete(id); }
    // Its replica gone from the shelf (brought back elsewhere), its menu goes too.
    if (this.menuOn && !this.menuOn.isConnected) {
      const held = this.doc.activeElement?.closest?.('.message-menu-list');
      this.closeMenu?.(false);
      // The menu held the focus: it goes to the shelf's first replica, or wherever the page puts it next.
      if (held && !held.isConnected && (!this.doc.activeElement || this.doc.activeElement === this.doc.body)) this.row.querySelector('.shelf-dossier')?.focus({ preventScroll: true });
    }
    this.list = list; this.paintPaging(); this.update(notify);
    const fresh = looks.reduce((sum, look) => sum + look.fresh, 0);
    const total = !this.read ? list.length : this.remaining === null ? null : [...this.projected.keys()].filter(id => !suppress.has(id)).length + this.remaining;
    this.count.textContent = [total || '', fresh ? `${fresh} new` : ''].filter(Boolean).join(' · ');
    this.showView();
    this.retarget();
  }
  // The shelf's two views (1055, Tony): Grid, the replicas as now, and List, one row each like the left rail's topics.
  // Auto, the default, is Grid until the shelf holds more than 18, then List. The choice is the viewer's own.
  views() {
    const doc = this.doc, group = element(doc, 'span', 'shelf-views');
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Archived view');
    let stored = null; try { stored = doc.defaultView?.localStorage.getItem(VIEW_KEY); } catch { /* a convenience */ }
    this.mode = VIEWS.some(([value]) => value === stored) ? stored : 'auto';
    for (const [value, words, glyph] of VIEWS) {
      const button = element(doc, 'button', 'shelf-view'); button.type = 'button'; button.dataset.value = value;
      if (glyph) { button.innerHTML = glyph; button.setAttribute('aria-label', words); } else button.textContent = words;
      button.onclick = () => { this.mode = value; try { doc.defaultView?.localStorage.setItem(VIEW_KEY, value); } catch { /* a convenience */ } this.showView(); };
      group.append(button);
    }
    this.viewButtons = [...group.children];
    return group;
  }
  showView() {
    const count = this.list?.length ?? 0, view = this.mode === 'auto' ? (count > AUTO_LIST ? 'list' : 'grid') : this.mode;
    if (this.root.dataset.view !== view) this.root.dataset.view = view;
    for (const button of this.viewButtons ?? []) {
      button.setAttribute('aria-pressed', String(button.dataset.value === this.mode));
      // Under Auto, the view it chose is marked, quietly.
      button.dataset.current = String(this.mode === 'auto' && button.dataset.value === view);
      button.title = button.dataset.value === 'auto' ? `Auto: Grid up to ${AUTO_LIST}, List after (now ${view === 'list' ? 'List' : 'Grid'})`
        : button.getAttribute('aria-label');
    }
  }
  make(id) {
    const doc = this.doc, item = element(doc, 'div', 'shelf-item'), replica = element(doc, 'button', 'shelf-dossier'); replica.type = 'button';
    item.setAttribute('role', 'listitem'); item.append(replica);
    replica.dataset.id = id;
    const folder = element(doc, 'span', 'shelf-folder'); folder.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < SHEETS; index += 1) {
      const sheet = element(doc, 'span', 'shelf-sheet');
      if (index === SHEETS - 1) for (let line = 0; line < 3; line += 1) sheet.append(element(doc, 'span', 'shelf-line'));
      folder.append(sheet);
    }
    replica.append(folder, element(doc, 'span', 'shelf-title'), element(doc, 'span', 'shelf-new'), element(doc, 'span', 'shelf-size'));
    // One dossier per press: the second click of a double-click lands where the next replica has closed up, and
    // brings nothing back.
    replica.onclick = event => { if (event.detail > 1) return; const stack = this.stacks.get(id); if (stack) this.restore(stack); };
    return replica;
  }
  // A replica takes the look of its original: its folder's colour, its first
  // card's colour and edge, one sheet behind for each further message (to three).
  look(stack, section, starred, projected) {
    const title = section?.querySelector('.stack-name')?.textContent?.trim() || projected?.name || (stack.head.body ?? '').split('\n')[0].slice(0, 80) || 'Dossier';
    const card = section?.querySelector('.message-card'), view = this.doc.defaultView;
    const style = (node, name) => node && view ? view.getComputedStyle(node).getPropertyValue(name).trim() : '';
    return { title, starred, count: projected?.count ?? 1 + stack.replies.length,
      fresh: projected?.unread ?? [stack.head, ...stack.replies].filter(this.unread).length,
      colours: [['--replica-card', style(card, 'background-color')], ['--replica-edge', style(card, 'border-top-color')],
        ['--replica-folder', style(section, '--stack-folder')], ['--stack-star', style(section, '--stack-star')]] };
  }
  dress(replica, { title, starred, count, fresh, colours }) {
    replica.querySelector('.shelf-title').textContent = title;
    const replies = Math.max(0, count - 1), replyWords = replies === 1 ? '1 reply' : `${replies} replies`;
    const size = replica.querySelector('.shelf-size');
    if (size) {
      size.textContent = replies ? String(replies) : '';
      size.title = replies ? replyWords : '';
      if (replies) size.setAttribute('aria-label', replyWords);
      else size.removeAttribute('aria-label');
    }
    const mark = replica.querySelector('.shelf-new'); mark.hidden = !fresh; mark.textContent = fresh ? `${fresh} new` : '';
    const words = `${replyWords}${fresh ? `, ${fresh} new` : ''}`;
    replica.title = `${title}: ${words}. Click to bring it back.`;
    replica.setAttribute('aria-label', `${title}${starred ? ', starred' : ''}, ${words}`);
    replica.dataset.archiveStarred = String(Boolean(starred));
    replica.dataset.sheets = String(Math.min(count, SHEETS));
    replica.dataset.folder = String(count > 1);
    for (const [property, value] of colours) if (value && replica.style.getPropertyValue(property) !== value) replica.style.setProperty(property, value);
  }
  menu(replica, at) {
    const stack = this.stacks.get(replica.dataset.id); if (!stack) return;
    const win = this.doc.defaultView;
    const menu = openMessageMenu({ anchor: replica, at, label: 'Archived dossier', doc: this.doc, win,
      items: [{ label: 'Bring back', glyph: 'back', act: () => this.restore(stack) }] });
    if (!menu?.root) return;
    // It goes away with any other action, as a menu on the Mac does (1027): a pointer press outside it closes it
    // already; so does a wheel or trackpad swipe anywhere else (swiping a dossier away, scrolling the feed), the
    // window losing focus, and the shelf redrawing under it.
    const close = menu.close.bind(menu), wheel = event => { if (!menu.root.contains(event.target)) menu.close(false); };
    const blur = () => menu.close(false);
    this.menuOn = replica;
    menu.close = restore => { this.doc.removeEventListener('wheel', wheel, true); win?.removeEventListener('blur', blur); if (this.closeMenu === menu.close) { this.closeMenu = null; this.menuOn = null; } close(restore); };
    this.doc.addEventListener('wheel', wheel, { capture: true, passive: true }); win?.addEventListener('blur', blur);
    this.closeMenu = menu.close;
  }
  replicaRect(id) { return box(this.replicas.get(id)); }
  // A flight ended early: its copy gone now, not when the cancelled animation settles.
  land(id) { const flying = this.flights.get(id); if (!flying) return; this.flights.delete(id); flying.flight.cancel(); flying.ghost.remove(); }
  // A dossier archived while another still flies goes first, and the replicas move along: each flight still in the
  // air turns toward where its replica stands now (one bound for the window's corner keeps its course).
  retarget() {
    for (const [id, { flight, rect, shown }] of this.flights) {
      if (!shown) continue;
      const at = box(this.replicas.get(id));
      if (at && flight.effect?.setKeyframes) flight.effect.setKeyframes(path(rect, at));
    }
  }
  // The dossier as it sits in the feed, before it moves: where, and a copy to fly.
  // Taken before the arrange that draws the replica, so it asks whether the rail stands beside the page, not whether the
  // shelf is drawn yet: the first archive into an empty shelf flies too (fly checks the replica after the arrange).
  departing(section) { const rect = box(section); return this.beside() && rect && rect.height ? { rect, ghost: copyOf(section) } : null; }
  // The flight back, quicker than the one down: the dossier, in its place in
  // the feed again, grows out of where its replica sat.
  back(from, section) {
    const view = this.doc.defaultView;
    // Where the page cannot animate (reduced motion, or no Web Animations), it is simply back.
    if (!view || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof section.animate !== 'function' || !box(section)) return;
    section.scrollIntoView({ block: 'nearest' });
    const rect = box(section); if (!rect?.height || !rect.width) return;
    const ghost = copyOf(section);
    Object.assign(ghost.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
      height: `${rect.height}px`, margin: '0', zIndex: '2000', pointerEvents: 'none', transformOrigin: '0 0', overflow: 'hidden' });
    ghost.classList.add('shelf-ghost'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
    // Unseen while its copy grows, but still the focus's place: hidden by opacity, not visibility, which drops focus.
    this.doc.body.append(ghost); section.style.opacity = '0';
    const dx = from.left - rect.left, dy = from.top - rect.top, sx = from.width / rect.width, sy = from.height / rect.height;
    ghost.animate([
      { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, opacity: 0.35, borderRadius: '24px' },
      { transform: `translate(${dx * 0.18}px,${dy * 0.35}px) scale(${0.62 + sx * 0.2},${0.62 + sy * 0.2})`, opacity: 0.95, offset: 0.65 },
      { transform: 'translate(0,0) scale(1,1)', opacity: 1, borderRadius: '10px' },
    ], { duration: 300, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).finished.catch(() => {}).finally(() => { ghost.remove(); section.style.opacity = ''; });
  }
  // The flight: a copy of the dossier as it sat in the feed shrinks along a
  // short arc into its replica (or the lower right corner should the replica
  // still be out of the window), and the replica settles in as it lands.
  fly({ rect, ghost }, id) {
    const view = this.doc.defaultView;
    if (!view || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof ghost.animate !== 'function') { ghost.remove(); return; }
    const replica = this.replicas.get(id);
    // No shelf drawn (the rail not beside the page): nothing flies, as before the shelf.
    if (!this.drawn || !box(replica)) { ghost.remove(); return; }
    // Its replica first on the shelf, brought into view in the rail if the rail had scrolled away from it (or
    // the shelf sits below the rail's fold): the dossier always lands where it can be seen.
    replica.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const at = box(replica), shown = Boolean(at && at.right <= view.innerWidth + 1 && at.top >= 0 && at.bottom <= view.innerHeight + 1);
    const end = shown ? at : { left: view.innerWidth - 72, top: view.innerHeight - 56, width: 56, height: 40 };
    if (shown) replica.classList.add('shelf-landing');
    Object.assign(ghost.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
      height: `${rect.height}px`, margin: '0', zIndex: '2000', pointerEvents: 'none', transformOrigin: '0 0', overflow: 'hidden' });
    ghost.classList.add('shelf-ghost'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
    this.doc.body.append(ghost);
    const flight = ghost.animate(path(rect, end), { duration: 440, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' });
    this.land(id); this.flights.set(id, { flight, rect, ghost, shown });
    flight.finished.catch(() => {}).finally(() => {
      if (this.flights.get(id)?.flight === flight) this.flights.delete(id);
      ghost.remove();
      if (!replica?.isConnected) return;
      replica.classList.remove('shelf-landing');
      replica.animate([{ transform: 'scale(.6)', opacity: .4 }, { transform: 'scale(1.08)', opacity: 1, offset: .6 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 220, easing: 'ease-out' });
    });
  }
}
