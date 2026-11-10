import { applyAct, cardText, deckBody, findCard, parseDeck } from './deck.mjs';
import { formatWords } from './message-format.mjs';
import { timeNode } from './times.mjs';

const UNDO_LIMIT = 50;
// Refusals that say this person can read the page but not change it.
const READ_ONLY = new Set(['FORBIDDEN', 'OUTCOME_REACHED']);

// A Notebook page as a deck of cards (docs/decks.md): a list sorted with the
// keys on a laptop, one card at a time, swiped through, on a phone. An act is
// made on the deck at once and written as the page's next revision; acts made
// while a save is on its way go together in the next. A save whose answer did
// not come is sent again exactly as it was, so Core answers with what it
// recorded ("A retry keeps the same operation identity"). One the page changed
// under first is made again, under a new operation, on the newer revision,
// each act finding its card by its words.
export class DeckPage {
  // read(name, args): a view's answer. send(kind, target, args, expected, operation_id): a command's receipt.
  // header: the page's {eyebrow, title, description}. place(scope): {href, title} of the topic or outcome the page is in.
  constructor({ host, header, item, read, send, place, doc = globalThis.document, narrow = globalThis.matchMedia?.('(max-width: 760px)') }) {
    Object.assign(this, { host, header, item, read, send, place, doc, narrow });
    // base: the page as Core last confirmed it. acts: the person's acts since, in order. undos: what takes back
    // each of their acts, newest last. sending: the save on its way, sent again as it is until Core answers it
    // (failed while its last send went unanswered).
    // held: a refusal stopped saving until Try again. notebook: the Notebook's version when the page was read.
    Object.assign(this, { base: null, source: null, notebook: null, acts: [], undos: [], sending: null, owed: false, held: false,
      readOnly: false, deck: parseDeck(''), picked: 0, editing: null });
    this.status = this.node('p', 'save-status deck-status'); this.status.setAttribute('role', 'status');
    this.opening = this.node('div', 'deck-opening');
    this.list = this.node('ol', 'deck-cards'); this.list.setAttribute('aria-label', 'Cards');
    this.count = this.node('span', 'deck-count');
    // A button's act leaves the focus on the picked card, so the keys go on working.
    const button = (label, act) => { const node = this.node('button', '', label); node.type = 'button'; node.onclick = () => { act(); if (!this.editing) this.show(true); }; return node; };
    this.editButton = button('Edit', () => (this.editing ? this.finish() : this.edit()));
    this.bar = this.node('div', 'deck-bar');
    this.bar.append(this.count, this.editButton, button('New card', () => this.start()), button('Undo', () => this.undo()));
    this.keys = this.node('p', 'deck-keys muted', '↑ ↓ pick · ⌘↑ ⌘↓ move · ⇧⌘↑ ⇧⌘↓ merge · Return edit, Escape done · ⌘Return new card · ⌘⌫ remove · ⌘Z undo');
    // The count and the buttons stand above the cards, where a phone's keyboard never covers Done.
    host.replaceChildren(this.status, this.opening, this.bar, this.keys, this.list);
    doc.addEventListener('keydown', event => this.key(event));
    this.list.addEventListener('scroll', () => this.scrolled(), { passive: true });
  }
  node(tag, className, text) {
    const element = this.doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  get phone() { return Boolean(this.narrow?.matches); }

  // The page as it stands, read again on every commit (app.mjs followCommits)
  // once its Notebook's version has moved, so a commit elsewhere costs one
  // short read. The version is read before the page, so no revision slips by.
  async load() {
    // A save that went unanswered goes again first, exactly as it was; while it stays unanswered the read
    // counts as failed, so the feed coming back (followCommits) sends it once more.
    if (this.sending?.failed) { await this.flush(); if (this.sending?.failed) return false; }
    if (this.sending) { this.owed = true; return true; }
    try {
      let notebook = null;
      if (this.source) {
        notebook = (await this.read('memory_items', { owner_scope: this.source.owner_scope, limit: 1 })).relevant_versions.notebook;
        if (notebook === this.notebook) return this.resume();
      }
      const source = await this.read('memory_current', { item_id: this.item });
      if (this.sending) { this.owed = true; return true; }
      const first = !this.source;
      Object.assign(this, { source, notebook });
      if (source.source_ref.revision !== this.base?.revision) this.rebase({ revision: source.source_ref.revision, body: source.body ?? '' });
      if (first) {
        await this.paintHeader();
        // A phone opens on the cards themselves, the header above scrolled away.
        if (this.phone) this.bar.scrollIntoView({ block: 'start' });
      }
      return this.resume();
    } catch (error) {
      this.say(`${error.message} The page could not be read.`, 'attention');
      return false;
    }
  }
  resume() {
    if (this.acts.length && !this.held) this.save();
    return true;
  }

  // The page from Core, with the person's acts not yet saved made again on it.
  rebase(base) {
    const keep = this.deck.cards[this.picked];
    let deck = parseDeck(base.body), lost = 0;
    const acts = this.acts.filter(act => {
      const done = applyAct(deck, act);
      if (done) deck = parseDeck(deckBody(done.deck)); else lost++;
      return Boolean(done);
    });
    Object.assign(this, { base, deck, acts });
    const found = keep ? findCard(deck, cardText(keep), this.picked) : -1;
    this.picked = found >= 0 ? found : Math.min(this.picked, Math.max(deck.cards.length - 1, 0));
    if (lost) this.say(lost === 1 ? 'One of your changes was not made: its card changed elsewhere first.' : `${lost} of your changes were not made: their cards changed elsewhere first.`, 'attention');
    this.paint();
    if (this.header.description) this.header.description.textContent = this.described();
  }

  async paintHeader() {
    const { eyebrow, title, description } = this.header;
    title.textContent = this.source.title || 'Notebook page';
    description.textContent = this.described();
    const place = await this.place(this.source.owner_scope), back = this.node('a', '', `← ${place.title}`);
    back.href = place.href;
    eyebrow.replaceChildren(back);
  }
  described() {
    const count = this.deck.cards.length;
    return `${count === 1 ? '1 card' : `${count} cards`} from a Notebook page${this.readOnly ? ', to read' : ''}`;
  }

  // The saving sign, as the writing's is: saving, saved and when, or what needs the person.
  say(words, state = null, again = null) {
    const span = this.node('span', '', words);
    if (state) span.dataset.save = state;
    this.status.replaceChildren(...(words ? [span] : []));
    if (state === 'saved') { const time = timeNode(Date.now(), this.doc); time.classList.add('save-time'); this.status.append(time); }
    if (again) { const retry = this.node('button', 'deck-again', 'Try again'); retry.type = 'button'; retry.onclick = again; this.status.append(retry); }
  }

  // An act on the deck: made at once, then saved.
  act(act, undoing = false) {
    if (this.readOnly || !this.base) return false;
    const done = applyAct(this.deck, act);
    if (!done) return false;
    this.deck = parseDeck(deckBody(done.deck)); this.acts.push(act);
    if (!undoing) this.undos = [...this.undos, done.undo].slice(-UNDO_LIMIT);
    this.picked = Math.max(done.at, 0);
    this.paint();
    this.header.description.textContent = this.described();
    this.save();
    return true;
  }
  // ⌘Z or Undo: the person's own last act, taken back as an act of its own.
  undo() {
    if (this.editing || this.readOnly) return;
    const undo = this.undos.at(-1);
    if (!undo) { this.say('Nothing to take back.'); return; }
    this.undos = this.undos.slice(0, -1);
    if (!this.act(undo, true)) this.say('Nothing taken back: that card changed since.', 'attention');
  }

  save() {
    if (this.sending || !this.acts.length || this.readOnly || !this.base) return;
    this.held = false;
    const body = deckBody(this.deck);
    // Acts that came out where they began write nothing.
    if (body === this.base.body) { this.acts = []; this.say(''); return; }
    this.sending = { operation_id: crypto.randomUUID(), body, revision: this.base.revision, acts: this.acts.length };
    return this.flush();
  }
  async flush() {
    const sending = this.sending, { title, attachments, references } = this.source;
    sending.failed = false;
    this.say('Saving…', 'saving');
    let receipt;
    try {
      receipt = await this.send('memory.revise', { item_id: this.item },
        { title, body: sending.body, attachments: attachments.map(({ id }) => ({ id })), references }, { item_revision: sending.revision }, sending.operation_id);
    } catch (error) {
      // No word on whether Core recorded it: it goes again exactly as it was.
      sending.failed = true;
      this.say(`Not saved yet. ${error.message}`, 'attention', () => this.flush());
      return;
    }
    if (receipt?.status === 'retryable') { sending.failed = true; this.say(`Not saved yet. ${receipt.error?.message ?? 'Theseus is busy.'}`, 'attention', () => this.flush()); return; }
    this.sending = null;
    if (receipt?.status === 'committed') {
      this.base = { revision: receipt.result.revision, body: sending.body };
      this.acts = this.acts.slice(sending.acts);
      this.say('Saved to Theseus', 'saved');
    } else if (receipt?.error?.code === 'REVISION_CONFLICT') {
      // Changed elsewhere first: the acts are made again on the page as it now stands, and saved under a new operation.
      try {
        const source = await this.read('memory_current', { item_id: this.item });
        this.source = source;
        this.rebase({ revision: source.source_ref.revision, body: source.body ?? '' });
      } catch (error) { this.say(`Not saved: the page changed elsewhere and could not be read again. ${error.message}`, 'attention', () => this.load()); return; }
    } else if (READ_ONLY.has(receipt?.error?.code)) {
      Object.assign(this, { readOnly: true, acts: [], undos: [] });
      this.host.classList.add('deck-read-only');
      this.rebase(this.base);
      this.say(`These cards can be read here, not changed: ${receipt.error.message}`, 'attention');
      return;
    } else {
      // Refused for another reason: the deck keeps the person's acts, unsaved, until Try again.
      this.held = true;
      this.say(`Not saved: ${receipt?.error?.message ?? 'Theseus did not take the change.'}`, 'attention', () => this.save());
      return;
    }
    if (this.acts.length) this.save();
    else if (this.owed) { this.owed = false; this.load(); }
  }

  // The keys work while the deck or nothing has the focus, and while a card is written, only its own.
  key(event) {
    if (this.host.hidden || event.defaultPrevented || event.isComposing) return;
    const command = event.metaKey || event.ctrlKey, up = event.key === 'ArrowUp', down = event.key === 'ArrowDown';
    if (this.editing) {
      if (event.target === this.editing.field && (event.key === 'Escape' || (event.key === 'Enter' && command))) { event.preventDefault(); this.finish(); }
      return;
    }
    if (event.target !== this.doc.body && !this.list.contains(event.target)) return;
    const card = this.deck.cards[this.picked], text = card ? cardText(card) : '', near = this.picked;
    if ((up || down) && command && !event.altKey) this.act({ kind: event.shiftKey ? 'merge' : 'move', text, step: up ? -1 : 1, near });
    else if ((up || down) && !event.shiftKey && !event.altKey) this.pick(this.picked + (up ? -1 : 1));
    else if (event.key === 'Enter' && command) this.start();
    else if (event.key === 'Enter' && !event.shiftKey && !event.altKey) this.edit();
    else if (event.key === 'Backspace' && command) this.act({ kind: 'remove', text, near });
    else if (event.key.toLowerCase() === 'z' && command && !event.shiftKey && !event.altKey) this.undo();
    else return;
    event.preventDefault();
  }

  pick(index) {
    if (!this.deck.cards.length) return;
    this.picked = Math.min(Math.max(index, 0), this.deck.cards.length - 1);
    this.mark();
    this.show(true);
  }
  // On a phone the card in view is the one picked.
  scrolled() {
    if (!this.phone || this.editing || !this.list.clientWidth) return;
    const index = Math.round(this.list.scrollLeft / this.list.clientWidth);
    if (index !== this.picked && index < this.deck.cards.length) { this.picked = index; this.mark(); }
  }
  mark() {
    for (const row of this.list.querySelectorAll('.deck-card')) {
      const picked = Number(row.dataset.index) === this.picked;
      row.tabIndex = picked ? 0 : -1;
      if (picked) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
    }
    this.count.textContent = this.deck.cards.length ? `${this.picked + 1} of ${this.deck.cards.length}` : 'No cards yet';
  }
  // The picked card in view; on a laptop it takes the focus when the deck has it (or nothing does).
  // A phone has no keys for the deck, so its cards never take the focus.
  show(focus) {
    const row = this.list.querySelector(`.deck-card[data-index="${this.picked}"]`);
    if (!row) return;
    if (this.phone) { this.list.scrollTo({ left: this.picked * this.list.clientWidth }); return; }
    row.scrollIntoView({ block: 'nearest' });
    if (focus) row.focus({ preventScroll: true });
  }

  // Return or Edit: the picked card's text in one box, its first line the title.
  edit() {
    const card = this.deck.cards[this.picked];
    if (card && !this.readOnly) this.open({ text: cardText(card), near: this.picked, fresh: false });
  }
  // ⌘Return or New card: an empty card after the picked one.
  start() {
    if (this.readOnly || !this.base) return;
    const card = this.deck.cards[this.picked];
    this.open({ text: '', after: card ? cardText(card) : null, near: card ? this.picked : -1, fresh: true });
  }
  open(editing) {
    if (this.editing) this.finish();
    const field = this.node('textarea', 'deck-editor');
    field.value = editing.text;
    field.setAttribute('aria-label', 'The card: its first line is its title');
    field.addEventListener('input', () => this.fit(field));
    this.editing = { ...editing, field };
    this.paint();
    field.setSelectionRange(field.value.length, field.value.length);
  }
  // Escape, ⌘Return or Done: what was written becomes the card; a new card with nothing written is not made.
  finish() {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    const to = editing.field.value;
    let made = false;
    if (editing.fresh) made = this.act({ kind: 'add', after: editing.after, text: to, near: editing.near });
    else if (to !== editing.text) {
      made = this.act({ kind: 'edit', text: editing.text, to, near: editing.near });
      // Its card changed elsewhere while it was written: what was written goes beside it, over nothing.
      if (!made && findCard(this.deck, editing.text, editing.near) < 0 && /\S/.test(to)) {
        const before = this.deck.cards[Math.min(editing.near, this.deck.cards.length) - 1];
        made = this.act({ kind: 'add', after: before ? cardText(before) : null, text: to, near: editing.near - 1 });
        if (made) this.say('That card changed elsewhere while you wrote, so what you wrote is a card of its own beside it.', 'attention');
      }
    }
    if (!made) this.paint();
    this.show(true);
  }
  fit(field) {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + 2}px`;
  }

  paint() {
    const { cards, opening } = this.deck, editing = this.editing;
    this.opening.hidden = !/\S/.test(opening);
    if (!this.opening.hidden) formatWords(this.opening, opening.trim());
    const rows = cards.map((card, index) => {
      const row = this.node('li', 'deck-card');
      row.dataset.index = String(index);
      row.append(this.node('h3', card.title ? 'deck-title' : 'deck-title muted', card.title || 'Untitled'), formatWords(this.node('div', 'deck-words'), card.words));
      row.addEventListener('click', () => { if (this.editing) this.finish(); else this.pick(index); });
      row.addEventListener('dblclick', () => { this.pick(index); this.edit(); });
      return row;
    });
    if (editing) {
      const holder = this.node('li', 'deck-card deck-writing');
      holder.append(editing.field);
      const at = editing.fresh ? (editing.after === null ? 0 : findCard(this.deck, editing.after, editing.near) + 1) : findCard(this.deck, editing.text, editing.near);
      if (editing.fresh) rows.splice(at > 0 ? at : editing.after === null ? 0 : rows.length, 0, holder);
      else if (at >= 0) rows.splice(at, 1, holder);
      else rows.splice(Math.min(editing.near, rows.length), 0, holder);
    }
    if (!rows.length) rows.push(this.node('li', 'deck-empty muted', this.readOnly ? 'No cards here.' : 'No cards yet. ⌘Return, or New card, starts one.'));
    const selection = editing && [editing.field.selectionStart, editing.field.selectionEnd];
    this.list.replaceChildren(...rows);
    this.list.classList.toggle('deck-editing', Boolean(editing));
    this.editButton.textContent = editing ? 'Done' : 'Edit';
    this.mark();
    if (editing) {
      editing.field.focus({ preventScroll: true });
      if (selection) editing.field.setSelectionRange(...selection);
      this.fit(editing.field);
      editing.field.closest('li').scrollIntoView({ block: 'nearest', inline: 'center' });
    } else this.show(this.list.contains(this.doc.activeElement) || this.doc.activeElement === this.doc.body);
  }
}
