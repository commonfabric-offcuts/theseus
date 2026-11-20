// A Notebook page in its own dialog, beside or over the feed (871 + 873).
// Its title, save confirmation and page controls stay fixed; failures and
// recovery stay in the page's scroller. The page's writing
// is the full page's own (NotebookPage: the card gestures, the shared body,
// the saving and recovery); this only hosts it over the feed.
//
// The page shown keeps its NotebookPage while the person stays on this page
// of Theseus, so ✕, Escape or a press outside closes the sheet with an
// unfinished card still open, the card picked and the place in the cards as
// they were, and puts the feed back where it was read, the focus on what
// opened the page. Opening another page replaces it: its writing goes on to
// Core and it lets go, and a card box it had open opens again with it.
//
// Opening a page reads it, as the Reader did, and what changed since the
// revision the person last read shows above its cards; a revision that
// reaches it while it shows is read as it comes.
//
// A card's speech bubble with a reply stack sets the sheet aside and opens the
// stack in the Reader; the Reader's header then says "← <page>", and closing
// the Reader brings the page back as it was. A stack in another topic opens
// there, and its way back goes back to this page of Theseus, the feed where it
// was and the page over it with its card box open. One sheet, never a pile.
import { paintChanges } from './page-changes.mjs';
import { glyph } from './glyphs.mjs';
import { timeNode } from './times.mjs';
import { DeckPage } from './deck-page.mjs';
import { NotebookDossiers } from './notebook-dossiers.mjs';

const RETURN = 'notebook-return';
// The card box a page had open when it was let go (another page, a move, a reload), opened again with it.
const WRITING = 'notebook-writing:';
const DOCKED = 'notebook-docked';
const MOVING_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '];
const here = () => globalThis.location.pathname + globalThis.location.search;
const take = key => {
  try { const value = JSON.parse(globalThis.sessionStorage.getItem(key)); globalThis.sessionStorage.removeItem(key); return value; }
  catch { return null; }
};
const keep = (key, value) => { try { globalThis.sessionStorage.setItem(key, JSON.stringify(value)); } catch {} };
// Whether this tab is on its way to or back from a card's reply stack, so a page of Theseus starting up resumes it.
export const returning = () => { try { return Boolean(globalThis.sessionStorage.getItem(RETURN)); } catch { return false; } };

// Read-only layout for an unopened page; no sheet, editor or listener is created.
export function notebookDockWanted() {
  try { const kept = JSON.parse(globalThis.sessionStorage.getItem(DOCKED)); if (typeof kept === 'boolean') return kept; } catch {}
  return true;
}
const mayWriteCards = (sheet, page) => sheet.current === page && sheet.showing && page.mode === 'cards' &&
  Boolean(page.writing?.base) && !page.readOnly && !page.writing.readOnly && !page.writing.reading &&
  !page.writing.deleted && !page.writing.closed && !page.writing.actionPending && !page.writing.actionRunning;

export function notebookSheetMenuItems(sheet, position, page = null) {
  if (position === 'first') return page?.mode === 'cards' ? [
    { key: 'edit', label: page.editing ? 'Done' : 'Edit', glyph: 'pencil', keys: '⌘Return', disabled: !mayWriteCards(sheet, page),
      act: () => { if (!mayWriteCards(sheet, page)) return; if (page.editing) page.finish(); else page.edit(); if (!page.editing) page.show(true); } },
    { key: 'undo', label: 'Undo', glyph: 'undo', keys: '⌘Z', disabled: !mayWriteCards(sheet, page) || !page.undos?.length,
      act: () => { if (mayWriteCards(sheet, page)) { page.undo(); if (!page.editing) page.show(true); } } },
  ] : [];
  if (position === 'beforeImage') return sheet.docked && sheet.dossiers ? [{ key: 'dossiers', label: 'Choose dossier…', glyph: 'dossier', act: () => sheet.dossiers.toggle() }] : [];
  if (position !== 'afterImage') return [];
  return [
    ...(sheet.canDock() ? [{ key: 'layout', label: 'Side by side', glyph: 'layout', checked: sheet.docked, act: () => sheet.setDocked(!sheet.docked) }] : []),
    ...(page ? [{ key: 'fullpage', label: 'Open as a full page', glyph: 'openpage', act: () => {
      if (sheet.current === page) sheet.goBack(sheet.fullHref(page.item, page.mode));
    } }] : []),
  ];
}

export class NotebookSheet {
  // make(id, host, header, suffix, revisionShown): a NotebookPage drawing into host, calling revisionShown after each
  // change to its writing.
  // fullHref(id, mode): the page's full-page address. openStack(topicId, messageId): opens a stack's
  // first message, true when in this page's Reader, false when its topic's page loads instead.
  // goBack(address): opens the page of Theseus at that address again. reads(): the PageReads that
  // records a read and answers the revision read before, or null. source(ref): a page at a revision.
  constructor({ make, fullHref, openStack, goBack, reads = () => null, source = null, feed = null, doc = globalThis.document }) {
    Object.assign(this, { make, fullHref, openStack, goBack, reads, source, feed, doc });
    this.listening = new AbortController();
    this.docked = false; this.dockWanted = notebookDockWanted();
    this.wide = globalThis.matchMedia?.('(min-width: 1280px)');
    this.resized = () => this.setDocked(this.dockWanted && this.canDock(), false);
    this.wide?.addEventListener('change', this.resized);
    this.messageDialog = doc.getElementById('new-message-sheet');
    this.dialog = doc.createElement('dialog'); this.dialog.id = 'notebook-sheet-dialog';
    this.dialog.className = 'notebook-sheet-dialog notebook-mode';
    this.dialog.setAttribute('aria-labelledby', 'notebook-sheet-title');
    doc.body.append(this.dialog);
    this.reader = doc.getElementById('reader');
    // current: the page shown or last shown. leaving: pages let go whose writing is still on its way, by id.
    this.current = null; this.leaving = new Map(); this.showing = false; this.place = null; this.aside = null; this.serial = 0;
    const node = (tag, className, text) => { const n = doc.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
    this.node = node;
    this.root = node('section', 'notebook-sheet'); this.root.hidden = true; this.root.setAttribute('aria-labelledby', 'notebook-sheet-title');
    this.head = node('div', 'notebook-sheet-head');
    this.title = node('h2', 'notebook-sheet-title'); this.title.id = 'notebook-sheet-title';
    this.status = node('div', 'notebook-sheet-status');
    this.heading = node('div', 'notebook-sheet-heading');
    this.saved = node('span', 'notebook-sheet-saved'); this.saved.setAttribute('role', 'status');
    this.saved.setAttribute('aria-live', 'polite');
    const control = (name, icon, act) => {
      const button = node('button', 'sheet-glyph'); button.type = 'button';
      button.title = name; button.setAttribute('aria-label', name); if (icon) button.append(glyph(icon, doc)); else button.textContent = '+'; button.onclick = act; return button;
    };
    this.renameButton = control('Rename', 'pencil', () => this.pageChoice('rename'));
    this.starButton = control('Star', 'star', () => this.pageChoice('star'));
    this.heading.append(this.title, this.saved, this.renameButton, this.starButton);
    this.newButton = control('New card (Return)', null, () => {
      const page = this.current; if (mayWriteCards(this, page)) page.start();
    });
    this.actions = node('div', 'notebook-sheet-actions');
    this.closer = node('button', 'sheet-glyph notebook-sheet-close', '✕'); this.closer.type = 'button';
    this.closer.setAttribute('aria-label', 'Close, keeping your writing'); this.closer.title = 'Close, keeping your writing';
    this.closer.onclick = () => this.close();
    this.dockButton = node('button', 'sheet-glyph notebook-sheet-dock'); this.dockButton.type = 'button';
    this.dockButton.append(glyph('layout', doc)); this.dockButton.onclick = () => this.setDocked(!this.docked);
    this.actions.append(this.newButton, this.dockButton, this.closer);
    this.head.append(this.heading, this.actions);
    this.body = node('div', 'notebook-sheet-pages');
    this.root.append(this.head, this.body);
    if (feed) this.dossiers = new NotebookDossiers({ doc, host: this.root, anchor: this.dockButton, read: feed.read,
      topicId: feed.topicId, choose: id => this.openInFeed(feed.topicId, id) });
    this.paintDock();
    this.dialog.append(this.root);
    this.dialog.addEventListener('cancel', event => { if (this.showing) { event.preventDefault(); this.close(); } });
    // The sheet is put away as it closes, not when the browser's close event comes: that comes with the browser's
    // next frame, later still on a slow machine, after a key may have moved the focus on from the opener or opened
    // the next page. The event still puts away a sheet the browser closed itself, and moves no focus.
    // New message owns a different dialog, so closing either never retires the other.
    this.dialog.addEventListener('close', () => { if (!this.dialog.open && this.showing) this.closed(); });
    // Only a press that starts and ends on the backdrop closes it, as every pop-up (on every page, the topic's
    // New message handler or not).
    let outside = false;
    this.dialog.addEventListener('pointerdown', event => { outside = this.showing && event.target === this.dialog; });
    this.dialog.addEventListener('click', event => { if (outside && event.target === this.dialog) this.close(); outside = false; });
    // The keys are the page's while it shows: an arrow, Page Up or Down, Home, End or Space the page did not use
    // moves nothing behind it. Listened for on the window, after the page's own keys (document) have had their turn.
    globalThis.addEventListener('keydown', event => {
      if (!this.showing || event.defaultPrevented) return;
      const modal = this.doc.querySelector?.('dialog:modal');
      if (modal && modal !== this.dialog) return;
      // Unused Escape closes as ✕ does; while docked, keys in the feed belong to the feed.
      if (event.key === 'Escape' && !event.isComposing && (!this.docked || this.dialog.contains(event.target))) {
        if (this.dossiers?.showing) { event.preventDefault(); this.dossiers.close(true); return; }
        event.preventDefault(); this.close(); return;
      }
      if (!this.dialog.contains(event.target) || !MOVING_KEYS.includes(event.key)) return;
      if (event.target.closest?.('textarea, input, select, [contenteditable], button, a[href]') && event.key === ' ') return;
      if (event.target.closest?.('textarea, input, select, [contenteditable]')) return;
      event.preventDefault();
    }, { signal: this.listening.signal });
    // The Reader opened from a card's bubble: closing it, by any way, brings the page back.
    this.reader?.addEventListener('close', () => { if (this.aside) this.back(); });
    // A reload or a page that loads: the card box a page has open opens again with it.
    globalThis.addEventListener('pagehide', () => { for (const page of this.pages()) this.keepWriting(page); }, { signal: this.listening.signal });
  }
  pages() { return [...(this.current ? [this.current] : []), ...this.leaving.values()]; }
  canDock() { return Boolean(this.feed && this.wide?.matches); }
  paintDock() {
    this.dockButton.hidden = !this.canDock(); this.dockButton.setAttribute('aria-pressed', String(this.docked));
    const layout = 'Side by side';
    this.dockButton.title = layout; this.dockButton.setAttribute('aria-label', layout);
    this.dialog.classList.toggle('notebook-docked', this.docked);
    this.doc.body.classList.toggle('notebook-docked', this.docked);
  }
  setDocked(wanted, remember = true) {
    if (remember) { this.dockWanted = Boolean(wanted); keep(DOCKED, this.dockWanted); }
    const next = Boolean(this.showing && wanted && this.canDock());
    this.dossiers?.close();
    if (next !== this.docked) {
      const focused = this.doc.activeElement;
      // Reading while docked may move the feed. The new modal freezes that
      // current place, so its eventual close never jumps to the old opener.
      if (this.docked && this.place) Object.assign(this.place, { x: globalThis.scrollX, y: globalThis.scrollY });
      this.docked = next;
      // Reopen the same dialog immediately: delayed close events see it open
      // and cannot retire its NotebookPage or move focus to the opener.
      if (this.dialog.open) this.dialog.close();
      this.paintDock();
      if (this.docked) this.dialog.show(); else this.dialog.showModal();
      if (focused?.isConnected && this.dialog.contains(focused)) focused.focus({ preventScroll: true });
    } else this.paintDock();
  }
  async openInFeed(topicId, messageId) {
    if (!this.docked || !this.feed) return;
    if (topicId !== this.feed.topicId) return this.setAside(topicId, messageId, true);
    try { await this.feed.open(topicId, messageId); }
    catch (error) { this.current?.say?.(`The dossier could not be opened. ${error.message}`, 'attention'); }
  }
  // Whether a box between the target and the sheet would scroll that way, so the wheel is its own.
  scrolls(target, dx, dy) {
    if (!this.dialog.contains(target)) return false;
    for (let at = target; at && at !== this.dialog; at = at.parentElement) {
      const style = globalThis.getComputedStyle(at), field = at.matches('textarea');
      const y = dy && (field || /auto|scroll/.test(style.overflowY)) && (dy < 0 ? at.scrollTop > 0 : at.scrollTop + at.clientHeight < at.scrollHeight - 1);
      const x = dx && (field || /auto|scroll/.test(style.overflowX)) && (dx < 0 ? at.scrollLeft > 0 : at.scrollLeft + at.clientWidth < at.scrollWidth - 1);
      if (y || x) return true;
    }
    return false;
  }
  // Unsaved writing on this device that a load would leave behind (the page's guard).
  holds() { return this.pages().some(page => Boolean(page.writing?.journalPending || page.writing?.journalError)); }
  // A new commit: the page showing is read again; a page closed or let go is not, but writing of its own that
  // Core has not confirmed still goes (a save that went unanswered goes again once the feed is back).
  async followed(page) {
    if (this.current === page && this.showing) return page.load();
    const writing = page.writing;
    if (writing && !writing.closed && !writing.running && (writing.pending || writing.dirty)) await writing.flush();
    return true;
  }

  // opener: what takes the focus back on close. write: 'new' opens the first card of an empty page.
  async open(id, { opener = null, write = null } = {}) {
    if (!this.dialog) return false;
    const serial = ++this.serial;
    // The New message sheet, popped up, goes back to its place in the feed first, its writing kept; a page opened from
    // the Reader's words takes the Reader's place, its reply kept, so one window stands over the feed.
    if (!this.showing && this.messageDialog?.open) this.messageDialog.close();
    if (this.reader?.open && !this.aside) this.doc.getElementById('reader-close')?.click();
    if (!this.showing && !this.place) this.place = { x: globalThis.scrollX, y: globalThis.scrollY, opener: opener ?? this.doc.activeElement };
    let page = this.current?.item === id ? this.current : this.leaving.get(id) ?? null;
    if (page && page !== this.current) { this.leaving.delete(id); page.leaving = false; }
    if (this.current && this.current !== page) this.letGo(this.current);
    const first = !page;
    if (!page) {
      const host = this.node('section', 'deck-page notebook-sheet-page'); host.setAttribute('aria-label', 'Notebook page');
      const header = { eyebrow: this.node('span'), title: this.node('span'), description: this.node('span') };
      page = this.make(id, host, header, '-sheet', () => this.revised(page));
      page.menuExtras = position => notebookSheetMenuItems(this, position, page);
      page.surfaceChanged = () => this.paintHeader(page);
      page.presentStatus = (words, state, again) => this.presentStatus(page, words, state, again);
      page.keyScope = target => !this.docked || this.dialog.contains(target);
      page.sheetTitle = header.title;
      page.changes = this.node('div', 'notebook-sheet-changes'); page.changes.hidden = true;
      host.prepend(page.changes);
      // A bubble that opens a reply stack sets the page aside and opens the stack; the page comes back after.
      host.addEventListener('click', event => {
        const link = event.target.closest?.('a.deck-bubble');
        if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const query = new URL(link.href, globalThis.location.href).searchParams, topicId = query.get('topic'), messageId = query.get('message');
        if (!topicId || !messageId) return;
        event.preventDefault(); event.stopPropagation();
        if (this.docked) this.openInFeed(topicId, messageId); else this.setAside(topicId, messageId);
      }, true);
    }
    if (!page.host.isConnected) this.body.append(page.host);
    this.show(page);
    this.setDocked(this.dockWanted && this.canDock(), false);
    if (!this.dialog.open) this.dialog.showModal();
    const kept = first ? take(WRITING + id) : null;
    page.readAt = undefined;
    let loaded = false;
    try { loaded = await page.load(); } catch (error) { page.say?.(`${error.message} The page could not be read.`, 'attention'); }
    if (serial !== this.serial || this.current !== page || !this.showing) return loaded;
    if (kept && page.reopen?.(kept)) { /* the card box it had open, open again */ }
    else if (write === 'new' && page.base && !page.base.body && !page.readOnly && !page.editing) page.start();
    else this.focus(page, first);
    if (loaded) this.readPage(page, serial);
    return loaded;
  }
  show(page) {
    if (this.current && this.current !== page) { this.keep(this.current); this.current.more.remove(); }
    this.current = page;
    this.title.replaceChildren(page.sheetTitle);
    page.more.classList.add('sheet-glyph'); this.actions.insertBefore(page.more, this.closer);
    if (this.dossiers) this.dossiers.anchor = page.more;
    this.status.replaceChildren(page.status);
    // The header owns confirmation and actions; recovery stays in the same
    // scroller as the cards, which keeps its scroll position across closes.
    page.host.prepend(this.status, page.pageNotice, ...(this.dossiers ? [this.dossiers.root] : []));
    page.host.querySelector('.notebook-tools')?.remove();
    page.addImage?.remove();
    page.bar?.replaceChildren(page.count);
    this.paintHeader(page);
    this.paintSaved(page);
    if (!this.showing) {
      this.root.hidden = false; this.showing = true;
      // Nor does a wheel, a trackpad or a finger: over the backdrop or the sheet's head, and past the end of what
      // scrolls in the sheet, it moves nothing behind (overscroll-behavior holds a box that scrolls, not one that
      // cannot, nor the backdrop). Each is the sheet's own only where a box in the sheet would scroll that way: a
      // finger's way is from where it touched down, so a drag on the head, a chip or a card that cannot scroll is
      // held as a wheel there is, and a swipe through the cards is not. Listened for on the window while the sheet
      // shows: a browser hands a wheel over the backdrop, outside the dialog's own box, to the page uncancelable
      // when only the dialog listens. Two fingers are a pinch, left to the browser.
      this.still = new AbortController();
      const options = { passive: false, signal: this.still.signal };
      let down = null;
      globalThis.addEventListener('wheel', event => { if (this.docked && !this.dialog.contains(event.target)) return; if (!this.scrolls(event.target, event.deltaX, event.deltaY)) event.preventDefault(); }, options);
      globalThis.addEventListener('touchstart', event => { const at = event.touches[0]; down = event.touches.length === 1 ? { x: at.clientX, y: at.clientY } : null; }, { passive: true, signal: this.still.signal });
      globalThis.addEventListener('touchmove', event => {
        const at = event.touches[0];
        if (!down || event.touches.length !== 1 || !event.cancelable || this.docked && !this.dialog.contains(event.target)) return;
        const dx = down.x - at.clientX, dy = down.y - at.clientY;
        if ((dx || dy) && !this.scrolls(event.target, dx, dy)) event.preventDefault();
      }, options);
    }
    page.host.hidden = false;
    // The cards' and the writing's own scroll places, kept while the page was closed.
    if (page.kept) { page.host.scrollTop = page.kept.host; page.text.scrollTop = page.kept.text; }
  }
  pageChoice(key) {
    const page = this.current, w = page?.writing;
    if (!this.showing || !w || w.closed || w.actionRunning || w.actionPending) return;
    const item = page.menuItems().find(item => item.key === key);
    if (item && !item.disabled) return item.act();
  }
  paintHeader(page) {
    if (this.current !== page) return;
    const w = page.writing, available = Boolean(w?.pageState) && !w.closed && !w.deleted;
    this.renameButton.hidden = !available || page.readOnly;
    this.newButton.hidden = !available || page.mode !== 'cards' || page.readOnly;
    this.newButton.disabled = Boolean(w?.actionRunning || w?.actionPending);
    this.renameButton.disabled = this.newButton.disabled;
    this.starButton.hidden = !available;
    this.starButton.disabled = this.newButton.disabled;
    const starred = Boolean(w?.pageState?.starred), name = starred ? 'Unstar' : 'Star';
    this.starButton.title = name; this.starButton.setAttribute('aria-label', name);
    this.starButton.setAttribute('aria-pressed', String(starred));
    this.starButton.replaceChildren(glyph(starred ? 'starred' : 'star', this.doc));
  }
  presentStatus(page, words, state, again) {
    // The timestamp is the confirmation observed this visit, as on the full page.
    // Repainting the same confirmed revision must not advance it.
    if (state === 'saved' && page.writing?.base && page.lastSavedRevision !== page.writing.base.revision) {
      page.lastSavedRevision = page.writing.base.revision; page.lastSavedAt = Date.now();
    }
    page.saveState = state;
    const compact = state === 'saved' || state === 'saving';
    DeckPage.prototype.say.call(page, compact ? '' : words, compact ? null : state, again);
    this.paintSaved(page);
  }
  paintSaved(page) {
    if (this.current !== page) return;
    const state = page.saveState;
    const nodes = [];
    if (state === 'saving' || state === 'saved' && page.lastSavedAt != null) {
      const dot = this.node('span', 'notebook-save-dot'); dot.dataset.save = state; dot.setAttribute('role', 'img');
      const time = page.lastSavedAt == null ? null : timeNode(page.lastSavedAt, this.doc);
      dot.setAttribute('aria-label', state === 'saved' ? `Saved at ${time.textContent}` : 'Saving');
      dot.title = dot.getAttribute('aria-label'); nodes.push(dot);
      if (time) { time.classList.add('save-time'); nodes.push(time); }
    }
    this.saved.replaceChildren(...nodes);
  }
  keep(page) { page.kept = { host: page.host.scrollTop, text: page.text.scrollTop }; }
  // A page replaced by another: out of the sheet at once, its card box kept for its next opening, and closed once
  // its writing has gone to Core (or failed to, the device copy holding it). Opened again before that, it is the same.
  letGo(page) {
    this.keepWriting(page);
    page.host.hidden = true; page.host.remove(); page.leaving = true;
    this.leaving.set(page.item, page);
    Promise.resolve(page.writing?.flush()).catch(() => {}).finally(() => {
      if (!page.leaving) return;
      this.leaving.delete(page.item); page.close?.();
    });
  }
  keepWriting(page) {
    const editing = page.editing;
    if (editing && /\S/.test(editing.field.value)) keep(WRITING + page.item, { value: editing.field.value, near: editing.near, selection: [editing.field.selectionStart, editing.field.selectionEnd] });
  }
  // What has the focus on opening: the card being written or the ask, as they were; else the picked card,
  // or the Text view's writing where its cursor was.
  focus(page, first) {
    if (page.editing) { page.editing.field.focus({ preventScroll: true }); return; }
    if (page.asking) { page.asking.field.focus({ preventScroll: true }); return; }
    if (page.mode === 'text') { page.text.focus({ preventScroll: true }); return; }
    if (first) page.paint();
    page.show(true);
  }
  // A revision that reaches the page while it shows, after the one opening it read (a commit elsewhere, taken in
  // as the page is read again, after its own save or as the person chooses the saved version), is read too, so
  // watching an agent revise a page leaves no light on it. It shows on the cards as it comes, so nothing is drawn
  // above them for it. The person's own revisions Core counts as read already.
  revised(page) {
    this.paintHeader(page);
    const base = page.writing?.base;
    if (!this.showing || this.current !== page || page.readAt === undefined || !base?.source || base.own || base.revision <= page.readAt) return;
    this.readPage(page, this.serial, false);
  }
  // Opening a page reads it, once the person can see it, as the Reader read it; what changed since the revision
  // they last read shows above the cards. A read Core did not record says so there, and the page keeps its light.
  async readPage(page, serial, opening = true) {
    const reads = this.reads(), source = page.writing?.base?.source;
    // live: still the page shown and, for a later revision, still the revision shown (a newer one is read by its own call).
    const live = () => serial === this.serial && this.current === page && this.showing && (opening || page.writing?.base?.source === source);
    if (opening) { page.changes.hidden = true; page.changes.replaceChildren(); }
    if (!reads || !source) return;
    page.readAt = source.source_ref.revision;
    while (this.doc.visibilityState !== 'visible' || !this.doc.hasFocus()) {
      await new Promise(resolve => {
        const go = () => { globalThis.removeEventListener('focus', go); this.doc.removeEventListener('visibilitychange', go); resolve(); };
        globalThis.addEventListener('focus', go); this.doc.addEventListener('visibilitychange', go);
      });
      if (!live()) return;
    }
    const say = words => { if (!live()) return; const line = this.node('p', 'notice', words); line.setAttribute('role', 'status'); page.changes.replaceChildren(line); page.changes.hidden = false; };
    let since;
    try { since = await reads.opened(source); } catch (error) { say(error.message); return; }
    if (!opening || since === null || !live()) return;
    let earlier;
    try { earlier = await this.source({ ...source.source_ref, revision: since }); }
    catch (error) { say(`What changed since revision ${since} could not be read. ${error.message}`); return; }
    if (!live()) return;
    const changes = this.node('details', 'source-changes'); changes.open = true;
    const shown = this.node('div', 'notebook-sheet-changes-body');
    changes.append(this.node('summary', '', `What changed since you read revision ${since}`), shown);
    paintChanges(shown, earlier.body ?? '', source.body ?? '', this.doc);
    page.changes.replaceChildren(changes); page.changes.hidden = false;
  }
  close() {
    if (!this.showing) return;
    this.dialog.close();
    this.closed();
  }
  closed() {
    if (!this.showing) return;
    this.still?.abort();
    this.dossiers?.close();
    const wasDocked = this.docked; this.docked = false; this.paintDock();
    const page = this.current;
    if (page) { this.keep(page); page.host.hidden = true; }
    this.root.hidden = true; this.showing = false;
    if (this.aside) return;
    // Back where the person was reading: the modal, keys, wheel and finger keep the feed still, and
    // should anything else have moved it while the sheet was up (its scrollbar, say), it goes back; the focus goes
    // back to what opened the page.
    const place = this.place; this.place = null;
    if (!place) return;
    if (!wasDocked && (globalThis.scrollX !== place.x || globalThis.scrollY !== place.y)) globalThis.scrollTo({ left: place.x, top: place.y, behavior: 'instant' });
    if (place.opener?.isConnected) place.opener.focus({ preventScroll: true });
  }

  // A card's reply stack: the page closes, kept as it is, and the stack opens. Should the stack be in another
  // topic, its page loads with the way back kept for this tab: this address, the feed's place and the page.
  async setAside(topicId, messageId, land = false) {
    const page = this.current;
    if (!page) return;
    this.aside = { id: page.item, title: page.sheetTitle.textContent || 'Notebook page' };
    keep(RETURN, { ...this.aside, land, from: here(), x: this.place?.x ?? globalThis.scrollX, y: this.place?.y ?? globalThis.scrollY });
    this.close();
    // here: the stack opened in this page's Reader; otherwise its topic's page is loading.
    let opened = false;
    try { opened = await this.openStack(topicId, messageId, land); } catch { opened = true; }
    if (!opened) return;
    take(RETURN);
    if (this.reader?.open) this.showBack(); else if (this.aside) this.back();
  }
  // On a page of Theseus as it starts: the stack's topic, its Reader open, shows the way back; the page the stack
  // was left from, reached again by that way back, has its feed where it was and the page open over it.
  resume() {
    const aside = take(RETURN);
    if (!aside?.id) return;
    if (aside.land) { this.open(aside.id); return; }
    if (aside.back) {
      if (aside.from !== here()) return;
      globalThis.scrollTo(aside.x, aside.y);
      this.place = { x: aside.x, y: aside.y, opener: null };
      this.open(aside.id);
      return;
    }
    if (!this.reader?.open) return;
    this.aside = aside;
    this.showBack();
  }
  // "← <page>" in the Reader's header, in the place of its way back to the topic.
  showBack() {
    if (!this.reader) return;
    const header = this.reader.querySelector('.reader-header'), parent = this.doc.getElementById('reader-parent');
    if (!this.backButton) {
      this.backButton = this.node('button', 'notebook-back quiet');
      this.backButton.type = 'button';
      this.backButton.onclick = () => this.doc.getElementById('reader-close')?.click();
    }
    const title = this.aside?.title ?? 'Notebook page';
    this.backButton.textContent = `← ${title}`;
    this.backButton.setAttribute('aria-label', `Back to the Notebook page ${title}`);
    this.backButton.title = `Back to ${title}, as you left it`;
    if (parent) { parent.hidden = true; parent.before(this.backButton); } else header?.prepend(this.backButton);
    this.backButton.hidden = false;
  }
  back() {
    const aside = this.aside;
    this.aside = null;
    if (this.backButton) this.backButton.hidden = true;
    const parent = this.doc.getElementById('reader-parent'); if (parent) parent.hidden = false;
    if (!aside) return;
    // From the stack's own topic: back to the page it was left from, which opens the page again (resume).
    if (aside.from && aside.from !== here()) { keep(RETURN, { ...aside, back: true }); this.goBack(aside.from); return; }
    this.open(aside.id);
  }
  // The run ends without a pagehide (an in-place move): each page's card box is kept for its next opening, and its
  // writing closes as on pagehide.
  retire() {
    this.listening.abort(); this.showing = false;
    this.wide?.removeEventListener('change', this.resized); this.still?.abort(); this.dossiers?.close();
    this.docked = false; this.paintDock();
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
    for (const page of this.pages()) { this.keepWriting(page); page.close?.(); }
  }
}
