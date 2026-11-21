// The archive shelf: the dossiers a reader
// archived in this topic sit at the foot of the right rail as small replicas
// of themselves, each with its title. The feed never shows them: a click
// brings one back, and a right-click or the menu key offers Bring back as a
// menu. Archiving flies
// the dossier down into the shelf, the lower right corner where the rail is
// not drawn.
import { openMessageMenu } from './message-menu.mjs';

const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = text; return node;
};
const SHEETS = 3;
// Where the page lays a node out, or null for a node it does not draw (a replica on a rail not shown, a dossier hidden).
const box = node => node?.isConnected && node.getClientRects().length ? node.getBoundingClientRect() : null;

export class ArchiveShelf {
  constructor({ doc, restore }) {
    this.doc = doc; this.restore = restore;
    this.replicas = new Map(); this.stacks = new Map();
    this.root = element(doc, 'section', 'archive-shelf'); this.root.id = 'archive-shelf';
    this.root.setAttribute('aria-labelledby', 'archive-shelf-heading'); this.root.hidden = true;
    const head = element(doc, 'div', 'archive-shelf-head');
    this.heading = element(doc, 'h2', '', 'Archived'); this.heading.id = 'archive-shelf-heading';
    this.count = element(doc, 'span', 'archive-shelf-count');
    head.append(this.heading, this.count);
    this.row = element(doc, 'div', 'archive-shelf-row'); this.row.setAttribute('role', 'list');
    this.root.append(head, this.row);
    const replicaOf = event => event.target.closest?.('.shelf-dossier') ?? null;
    this.row.addEventListener('contextmenu', event => {
      const replica = replicaOf(event); if (!replica) return;
      event.preventDefault(); this.menu(replica, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null);
    });
    this.row.addEventListener('keydown', event => {
      if (!(event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) || event.ctrlKey || event.altKey || event.metaKey) return;
      const replica = replicaOf(event); if (replica) { event.preventDefault(); this.menu(replica, null); }
    });
    // The right rail outlives a page moved to in place (in-place-navigation.mjs keeps #things), but this
    // shelf is its topic's: it leaves with the page, which hears pagehide as on an unload.
    doc.defaultView?.addEventListener('pagehide', () => this.leave(), { once: true });
  }
  // Gone with its page: a feed left behind that still hears Core draws nothing in the rail.
  leave() { this.gone = true; this.root.remove(); }
  // The rail is drawn again by the page as it moves; the shelf goes back in at its foot.
  place() {
    const things = this.doc.getElementById('things');
    if (!things) return false;
    // One shelf in the rail: another page's, if any were left, goes. It is put in once: moving a node
    // drops the focus inside it, so its place at the rail's foot is the stylesheet's (order).
    for (const other of things.querySelectorAll('.archive-shelf')) if (other !== this.root) other.remove();
    if (this.root.parentElement !== things) things.append(this.root);
    return true;
  }
  // Latest on top: a dossier archived while the page is open goes first on the shelf, before those already on it,
  // so the flight down always lands where the shelf begins. The first drawing keeps Core's order.
  paint(given) {
    if (this.gone) return;
    this.place();
    const known = this.replicas.size > 0 || this.painted;
    this.painted = true;
    const fresh = known ? given.filter(({ stack }) => !this.replicas.has(stack.id)) : [];
    const list = [...fresh, ...given.filter(each => !fresh.includes(each)).sort((a, b) => this.rank(a.stack.id) - this.rank(b.stack.id))];
    const live = new Set();
    list.forEach(({ stack, section }, index) => {
      live.add(stack.id); this.stacks.set(stack.id, stack);
      let replica = this.replicas.get(stack.id);
      if (!replica) { replica = this.make(stack.id); this.replicas.set(stack.id, replica); }
      this.dress(replica, stack, section);
      // Moved only when out of order: moving a replica would drop the focus it holds.
      const at = this.row.children[index] ?? null;
      if (at !== replica) this.row.insertBefore(replica, at);
    });
    for (const [id, replica] of this.replicas) if (!live.has(id)) { replica.remove(); this.replicas.delete(id); this.stacks.delete(id); }
    // Its replica gone from the shelf (brought back elsewhere), its menu goes too.
    if (this.menuOn && !this.menuOn.isConnected) this.closeMenu?.(false);
    this.root.hidden = !list.length;
    this.doc.body.dataset.archiveShelf = list.length ? 'on' : '';
    this.count.textContent = list.length ? String(list.length) : '';
  }
  // Where a replica stands on the shelf now (one not drawn yet, after them all).
  rank(id) { const at = [...this.row.children].indexOf(this.replicas.get(id)); return at < 0 ? Infinity : at; }
  make(id) {
    const doc = this.doc, replica = element(doc, 'button', 'shelf-dossier'); replica.type = 'button';
    replica.dataset.id = id; replica.setAttribute('role', 'listitem');
    const folder = element(doc, 'span', 'shelf-folder'); folder.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < SHEETS; index += 1) {
      const sheet = element(doc, 'span', 'shelf-sheet');
      if (index === SHEETS - 1) for (let line = 0; line < 3; line += 1) sheet.append(element(doc, 'span', 'shelf-line'));
      folder.append(sheet);
    }
    replica.append(folder, element(doc, 'span', 'shelf-title'));
    replica.onclick = () => { const stack = this.stacks.get(id); if (stack) this.restore(stack); };
    return replica;
  }
  // A replica takes the look of its original: its folder's colour, its first
  // card's colour and edge, one sheet behind for each further message (to three).
  dress(replica, stack, section) {
    const title = section?.querySelector('.stack-name')?.textContent?.trim() || (stack.head.body ?? '').split('\n')[0].slice(0, 80) || 'Dossier';
    const count = 1 + stack.replies.length;
    replica.querySelector('.shelf-title').textContent = title;
    replica.title = `${title}: ${count === 1 ? 'one message' : `${count} messages`}. Click to bring it back.`;
    replica.setAttribute('aria-label', `${title}, ${count === 1 ? 'one message' : `${count} messages`}`);
    replica.dataset.sheets = String(Math.min(count, SHEETS));
    replica.dataset.folder = String(count > 1);
    const card = section?.querySelector('.message-card'), view = this.doc.defaultView;
    for (const [property, node, name] of [['--replica-card', card, 'background-color'], ['--replica-edge', card, 'border-top-color'], ['--replica-folder', section, '--stack-folder']]) {
      const value = node && view ? view.getComputedStyle(node).getPropertyValue(name).trim() : '';
      if (value) replica.style.setProperty(property, value);
    }
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
  // The dossier as it sits in the feed, before it moves: where, and a copy to fly.
  departing(section) { const rect = box(section); return rect && rect.height ? { rect, ghost: section.cloneNode(true) } : null; }
  // The flight back, quicker than the one down: the dossier, in its place in
  // the feed again, grows out of where its replica sat.
  back(from, section) {
    const view = this.doc.defaultView;
    // Where the page cannot animate (reduced motion, or no Web Animations), it is simply back.
    if (!view || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof section.animate !== 'function' || !box(section)) return;
    section.scrollIntoView({ block: 'nearest' });
    const rect = box(section); if (!rect?.height || !rect.width) return;
    const ghost = section.cloneNode(true);
    Object.assign(ghost.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
      height: `${rect.height}px`, margin: '0', zIndex: '2000', pointerEvents: 'none', transformOrigin: '0 0', overflow: 'hidden' });
    ghost.classList.add('shelf-ghost'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
    this.doc.body.append(ghost); section.style.visibility = 'hidden';
    const dx = from.left - rect.left, dy = from.top - rect.top, sx = from.width / rect.width, sy = from.height / rect.height;
    ghost.animate([
      { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, opacity: 0.35, borderRadius: '24px' },
      { transform: `translate(${dx * 0.18}px,${dy * 0.35}px) scale(${0.62 + sx * 0.2},${0.62 + sy * 0.2})`, opacity: 0.95, offset: 0.65 },
      { transform: 'translate(0,0) scale(1,1)', opacity: 1, borderRadius: '10px' },
    ], { duration: 300, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).finished.catch(() => {}).finally(() => { ghost.remove(); section.style.visibility = ''; });
  }
  // The flight: a copy of the dossier as it sat in the feed shrinks along a
  // short arc into its replica (or the lower right corner should the replica
  // still be out of the window), and the replica settles in as it lands.
  fly({ rect, ghost }, id) {
    const view = this.doc.defaultView;
    if (!view || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches || typeof ghost.animate !== 'function') { ghost.remove(); return; }
    const replica = this.replicas.get(id);
    // No shelf drawn (a phone, where the right rail is a tab): nothing flies, as before the shelf.
    if (!box(replica)) { ghost.remove(); return; }
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
    const dx = end.left - rect.left, dy = end.top - rect.top;
    const sx = end.width / rect.width, sy = end.height / rect.height;
    const flight = ghost.animate([
      { transform: 'translate(0,0) scale(1,1)', opacity: 1, borderRadius: '10px' },
      { transform: `translate(${dx * 0.35}px,${dy * 0.18}px) scale(${0.62 + sx * 0.2},${0.62 + sy * 0.2})`, opacity: 0.95, offset: 0.35 },
      { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})`, opacity: 0.35, borderRadius: '24px' },
    ], { duration: 440, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' });
    flight.finished.catch(() => {}).finally(() => {
      ghost.remove();
      if (!replica) return;
      replica.classList.remove('shelf-landing');
      replica.animate([{ transform: 'scale(.6)', opacity: .4 }, { transform: 'scale(1.08)', opacity: 1, offset: .6 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 220, easing: 'ease-out' });
    });
  }
}
