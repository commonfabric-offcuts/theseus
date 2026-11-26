// The archive shelf: the dossiers a reader
// archived in this topic sit at the foot of the right rail as small replicas
// of themselves, each with its title. The feed never shows them: a click
// brings one back, and a right-click or the menu key offers Bring back as a
// menu. Archiving flies
// the dossier down into the shelf, the lower right corner where the rail is
// not drawn.
import { openMessageMenu } from './message-menu.mjs';
import { keyAction } from './pane-keys.mjs';

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
  constructor({ doc, restore, undo = () => {}, changed = () => {}, unread = () => false }) {
    this.doc = doc; this.restore = restore; this.undo = undo; this.changed = changed; this.unread = unread;
    this.replicas = new Map(); this.stacks = new Map(); this.flights = new Map();
    // The dossiers archived on this page, the latest last: they go first on the shelf. Any other keeps Core's order.
    this.here = []; this.drawn = false; this.list = [];
    this.root = element(doc, 'section', 'archive-shelf'); this.root.id = 'archive-shelf';
    this.root.dataset.selectionOccluder = 'bottom';
    this.root.setAttribute('aria-labelledby', 'archive-shelf-heading'); this.root.hidden = true;
    const head = element(doc, 'div', 'archive-shelf-head');
    this.heading = element(doc, 'h2', '', 'Archived'); this.heading.id = 'archive-shelf-heading';
    this.count = element(doc, 'span', 'archive-shelf-count');
    head.append(this.heading, this.count, this.views());
    this.row = element(doc, 'div', 'archive-shelf-row'); this.row.setAttribute('role', 'list');
    this.root.append(head, this.row);
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
    this.gone = true; this.root.remove(); this.watching?.disconnect(); this.wide?.removeEventListener?.('change', this.recheck);
    if (this.drawn) delete this.doc.body.dataset.archiveShelf;
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
  update(notify) {
    const drawn = Boolean(this.list.length) && this.beside(), was = this.drawn;
    this.drawn = drawn; this.root.hidden = !drawn;
    if (drawn) this.doc.body.dataset.archiveShelf = 'on'; else delete this.doc.body.dataset.archiveShelf;
    if (notify && drawn !== was) this.changed(drawn);
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
  }
  // Archived here, now: first on the shelf. Brought back: it leaves the list.
  putAway(id) { this.here = [...this.here.filter(each => each !== id), id]; }
  broughtBack(id) { this.here = this.here.filter(each => each !== id); }
  // Latest on top: a dossier archived while the page is open goes first on the shelf, before those already on it,
  // so the flight down always lands where the shelf begins. The first drawing keeps Core's order.
  paint(given) {
    if (this.gone) return;
    this.place();
    const byId = new Map(given.map(each => [each.stack.id, each]));
    const mine = this.here.filter(id => byId.has(id)).reverse().map(id => byId.get(id));
    const local = new Set(mine);
    const ordered = [...mine, ...given.filter(each => !local.has(each))];
    const list = [...ordered.filter(each => each.starred), ...ordered.filter(each => !each.starred)];
    const live = new Set();
    // Every look read before any is written, so the page lays out once.
    const looks = list.map(({ stack, section }) => this.look(stack, section));
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
    this.list = list; this.update(false);
    const fresh = looks.reduce((sum, look) => sum + look.fresh, 0);
    this.count.textContent = list.length ? `${list.length}${fresh ? ` · ${fresh} new` : ''}` : '';
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
  look(stack, section) {
    const title = section?.querySelector('.stack-name')?.textContent?.trim() || (stack.head.body ?? '').split('\n')[0].slice(0, 80) || 'Dossier';
    const card = section?.querySelector('.message-card'), view = this.doc.defaultView;
    const style = (node, name) => node && view ? view.getComputedStyle(node).getPropertyValue(name).trim() : '';
    return { title, count: 1 + stack.replies.length, fresh: [stack.head, ...stack.replies].filter(this.unread).length,
      colours: [['--replica-card', style(card, 'background-color')], ['--replica-edge', style(card, 'border-top-color')], ['--replica-folder', style(section, '--stack-folder')]] };
  }
  dress(replica, { title, count, fresh, colours }) {
    replica.querySelector('.shelf-title').textContent = title;
    const size = replica.querySelector('.shelf-size'); if (size) size.textContent = count > 1 ? String(count) : '';
    const mark = replica.querySelector('.shelf-new'); mark.hidden = !fresh; mark.textContent = fresh ? `${fresh} new` : '';
    const words = `${count === 1 ? 'one message' : `${count} messages`}${fresh ? `, ${fresh} new` : ''}`;
    replica.title = `${title}: ${words}. Click to bring it back.`;
    replica.setAttribute('aria-label', `${title}, ${words}`);
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
