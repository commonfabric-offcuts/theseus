// A Notebook page in the composer over the feed (item 396): opening or
// starting a page brings up the New message sheet with the page's title, a
// Text / Cards switch with the page's draft mark, its saving sign, Full page and ✕. The page's writing
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
import { holdPlace, releasePlace } from './sheet-holder.mjs';

const RETURN = 'notebook-return';
// The card box a page had open when it was let go (another page, a move, a reload), opened again with it.
const WRITING = 'notebook-writing:';
const MOVING_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' '];
const here = () => globalThis.location.pathname + globalThis.location.search;
const take = key => {
  try { const value = JSON.parse(globalThis.sessionStorage.getItem(key)); globalThis.sessionStorage.removeItem(key); return value; }
  catch { return null; }
};
const keep = (key, value) => { try { globalThis.sessionStorage.setItem(key, JSON.stringify(value)); } catch {} };
// Whether this tab is on its way to or back from a card's reply stack, so a page of Theseus starting up resumes it.
export const returning = () => { try { return Boolean(globalThis.sessionStorage.getItem(RETURN)); } catch { return false; } };

export class NotebookSheet {
  // make(id, host, header, suffix, revisionShown): a NotebookPage drawing into host, calling revisionShown after each
  // change to its writing.
  // fullHref(id, mode): the page's full-page address. openStack(topicId, messageId): opens a stack's
  // first message, true when in this page's Reader, false when its topic's page loads instead.
  // goBack(address): opens the page of Theseus at that address again. reads(): the PageReads that
  // records a read and answers the revision read before, or null. source(ref): a page at a revision.
  constructor({ make, fullHref, openStack, goBack, reads = () => null, source = null, doc = globalThis.document }) {
    Object.assign(this, { make, fullHref, openStack, goBack, reads, source, doc });
    this.dialog = doc.getElementById('new-message-sheet');
    this.inline = doc.getElementById('inline-composer');
    this.reader = doc.getElementById('reader');
    // current: the page shown or last shown. leaving: pages let go whose writing is still on its way, by id.
    this.current = null; this.leaving = new Map(); this.showing = false; this.place = null; this.aside = null; this.serial = 0;
    const node = (tag, className, text) => { const n = doc.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
    this.node = node;
    this.root = node('section', 'notebook-sheet'); this.root.hidden = true; this.root.setAttribute('aria-labelledby', 'notebook-sheet-title');
    const head = node('div', 'notebook-sheet-head');
    this.title = node('h2', 'notebook-sheet-title'); this.title.id = 'notebook-sheet-title';
    this.views = node('div', 'notebook-sheet-views'); this.status = node('div', 'notebook-sheet-status');
    this.full = node('a', 'sheet-glyph notebook-sheet-full');
    this.full.setAttribute('aria-label', 'Open as a full page'); this.full.title = 'Open as a full page';
    this.full.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M11.5 3.5h5v5M16.5 3.5l-6 6M8.5 4.5h-4v11h11v-4"/></svg>';
    this.full.addEventListener('click', () => { if (this.current) this.full.href = this.fullHref(this.current.item, this.current.mode); });
    this.closer = node('button', 'sheet-glyph notebook-sheet-close', '✕'); this.closer.type = 'button';
    this.closer.setAttribute('aria-label', 'Close, keeping your writing'); this.closer.title = 'Close, keeping your writing';
    this.closer.onclick = () => this.close();
    head.append(this.title, this.full, this.closer, this.views, this.status);
    this.body = node('div', 'notebook-sheet-pages');
    this.root.append(head, this.body);
    this.dialog.append(this.root);
    // The sheet is put away as it closes, not when the browser's close event comes: that comes with the browser's
    // next frame, later still on a slow machine, after a key may have moved the focus on from the opener or opened
    // the next page. The event still puts away a sheet the browser closed itself, and moves no focus. The New message
    // composer, which shares the sheet, folds on it and moves the focus only on a close of its own (inline-composer.mjs),
    // so a Tab or a Space pressed since keeps the focus where the person moved it.
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
      // Escape the page did not use (a card being written takes the first) closes the sheet, as ✕ does.
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); this.close(); return; }
      if (!this.dialog.contains(event.target) || !MOVING_KEYS.includes(event.key)) return;
      if (event.target.closest?.('textarea, input, select, [contenteditable], button, a[href]') && event.key === ' ') return;
      if (event.target.closest?.('textarea, input, select, [contenteditable]')) return;
      event.preventDefault();
    });
    // The Reader opened from a card's bubble: closing it, by any way, brings the page back.
    this.reader?.addEventListener('close', () => { if (this.aside) this.back(); });
    // A reload or a page that loads: the card box a page has open opens again with it.
    globalThis.addEventListener('pagehide', () => { for (const page of this.pages()) this.keepWriting(page); });
  }
  pages() { return [...(this.current ? [this.current] : []), ...this.leaving.values()]; }
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
    if (!this.showing) holdPlace(this.dialog);
    if (this.dialog.open && !this.showing) this.dialog.close();
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
        this.setAside(topicId, messageId);
      }, true);
    }
    if (!page.host.isConnected) this.body.append(page.host);
    this.show(page);
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
    if (this.current && this.current !== page) this.keep(this.current);
    this.current = page;
    this.title.replaceChildren(page.sheetTitle);
    this.views.replaceChildren(page.views, page.draft);
    this.status.replaceChildren(page.status);
    this.full.href = this.fullHref(page.item, page.mode);
    if (!this.showing) {
      this.inlineHidden = this.inline?.hidden ?? true;
      if (this.inline) this.inline.hidden = true;
      this.labelledBy = this.dialog.getAttribute('aria-labelledby');
      this.dialog.setAttribute('aria-labelledby', 'notebook-sheet-title');
      this.dialog.classList.add('notebook-mode');
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
      globalThis.addEventListener('wheel', event => { if (!this.scrolls(event.target, event.deltaX, event.deltaY)) event.preventDefault(); }, options);
      globalThis.addEventListener('touchstart', event => { const at = event.touches[0]; down = event.touches.length === 1 ? { x: at.clientX, y: at.clientY } : null; }, { passive: true, signal: this.still.signal });
      globalThis.addEventListener('touchmove', event => {
        const at = event.touches[0];
        if (!down || event.touches.length !== 1 || !event.cancelable) return;
        const dx = down.x - at.clientX, dy = down.y - at.clientY;
        if ((dx || dy) && !this.scrolls(event.target, dx, dy)) event.preventDefault();
      }, options);
    }
    page.host.hidden = false;
    // The cards' and the writing's own scroll places, kept while the page was closed.
    if (page.kept) { page.host.scrollTop = page.kept.host; page.text.scrollTop = page.kept.text; }
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
    releasePlace(this.dialog);
    this.still?.abort();
    const page = this.current;
    if (page) { this.keep(page); page.host.hidden = true; }
    this.root.hidden = true; this.showing = false;
    this.dialog.classList.remove('notebook-mode');
    if (this.labelledBy) this.dialog.setAttribute('aria-labelledby', this.labelledBy);
    if (this.inline) this.inline.hidden = this.inlineHidden;
    if (this.aside) return;
    // Back where the person was reading: the holder, the keys, the wheel and the finger keep the feed still, and
    // should anything else have moved it while the sheet was up (its scrollbar, say), it goes back; the focus goes
    // back to what opened the page.
    const place = this.place; this.place = null;
    if (!place) return;
    if (globalThis.scrollX !== place.x || globalThis.scrollY !== place.y) globalThis.scrollTo({ left: place.x, top: place.y, behavior: 'instant' });
    if (place.opener?.isConnected) place.opener.focus({ preventScroll: true });
  }

  // A card's reply stack: the page closes, kept as it is, and the stack opens. Should the stack be in another
  // topic, its page loads with the way back kept for this tab: this address, the feed's place and the page.
  async setAside(topicId, messageId) {
    const page = this.current;
    if (!page) return;
    this.aside = { id: page.item, title: page.sheetTitle.textContent || 'Notebook page' };
    keep(RETURN, { ...this.aside, from: here(), x: this.place?.x ?? globalThis.scrollX, y: this.place?.y ?? globalThis.scrollY });
    this.close();
    // here: the stack opened in this page's Reader; otherwise its topic's page is loading.
    let opened = false;
    try { opened = await this.openStack(topicId, messageId); } catch { opened = true; }
    if (!opened) return;
    take(RETURN);
    if (this.reader?.open) this.showBack(); else if (this.aside) this.back();
  }
  // On a page of Theseus as it starts: the stack's topic, its Reader open, shows the way back; the page the stack
  // was left from, reached again by that way back, has its feed where it was and the page open over it.
  resume() {
    const aside = take(RETURN);
    if (!aside?.id) return;
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
  retire() { for (const page of this.pages()) { this.keepWriting(page); page.close?.(); } }
}
