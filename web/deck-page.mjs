import { applyAct, cardStacks, cardText, deckBody, findCard, groupAct, groupEnd, parseDeck, placeNew, stackLine, textCard, writtenAt } from './deck.mjs';
import { messageLink, messageOf, placeLink } from './links.mjs';
import { formatWords } from './message-format.mjs';
import { routeHref } from './topic-navigation.mjs';
import { timeNode } from './times.mjs';

const UNDO_LIMIT = 50;
const KEYS = '↑ ↓ pick · ⇧↑ ⇧↓, ⌘-click select · ⌘↑ ⌘↓ move · ⇧⌘↑ ⇧⌘↓ merge · Tab under the card above, ⇧Tab out · ← fold, → unfold, ⇧⌘← ⇧⌘→ all · Return new card, ⌥Return above · click or ⌘Return edit, Escape done · ⌘⌫ remove · ⌘Z undo · ⌥→ its speech bubble';
const ASKING_KEYS = '⌘Return ask · Escape back to the cards, keeping what you wrote · ↑ ↓ ← leave a box with nothing written';
const WRITING_KEYS = '⌘Return or Escape done · Tab under the card above, ⇧Tab out · ↑ at the very start or ↓ at the very end goes on to the card beside';
// Refusals that say this person can read the page but not change it.
const READ_ONLY = new Set(['FORBIDDEN', 'OUTCOME_REACHED']);

// A card's marks, drawn as nodes in their button's own color: the speech balloon on its bubble, which aim.css
// fills while a reply waits unread, and the chevron before a parent's title, which aim.css turns down while the
// cards under it show.
const BALLOON = 'M4.5 3.5h11a2 2 0 0 1 2 2V12a2 2 0 0 1-2 2H9.5l-4 3v-3h-1a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2z', CHEVRON = 'M8 5.5l4.5 4.5L8 14.5';
function mark(doc, d) {
  const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg'), path = doc.createElementNS(ns, 'path');
  for (const [name, value] of Object.entries({ viewBox: '0 0 20 20', width: '17', height: '17', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

// A Notebook page as a deck of cards (docs/decks.md): a list sorted with the
// keys on a laptop, one card at a time, swiped through, on a phone, a card's
// children grouped under it and folded away in this browser at will. An act is
// made on the deck at once and written as the page's next revision; acts made
// while a save is on its way go together in the next. A save whose answer did
// not come is sent again exactly as it was, so Core answers with what it
// recorded ("A retry keeps the same operation identity"). One the page changed
// under first is made again, under a new operation, on the newer revision,
// each act finding its card by its words. A card's speech bubble asks an agent
// about it in a new reply stack, whose link the card keeps as a line of its
// words.
export class DeckPage {
  // read(name, args): a view's answer. send(kind, target, args, expected, operation_id): a command's receipt.
  // header: the page's {eyebrow, title, description}. place(scope): {href, title} of the topic or outcome the page is in.
  // askIn(scope): where a card's ask goes, {topicId, agents}, or null when there is nowhere.
  constructor({ host, header, item, read, send, place, askIn, doc = globalThis.document, narrow = globalThis.matchMedia?.('(max-width: 760px)') }) {
    Object.assign(this, { host, header, item, read, send, place, askIn, doc, narrow });
    // base: the page as Core last confirmed it. acts: the person's acts since, in order. undos: what takes back
    // each of their acts, newest last. sending: the save on its way, sent again as it is until Core answers it
    // (failed while its last send went unanswered).
    // held: a refusal stopped saving until Try again. notebook: the Notebook's version when the page was read.
    // room: where an ask goes. talks: each stack's {replies, unread}, by its first message. asking: the ask being written.
    Object.assign(this, { base: null, source: null, notebook: null, acts: [], undos: [], sending: null, owed: false, held: false,
      readOnly: false, deck: parseDeck(''), picked: 0, editing: null, room: null, talks: new Map(), asking: null, drafts: new Map() });
    // The cards selected together, by index, the picked card among them; and where a ⇧ selection began, with
    // the cards ⌘-clicked before it, which it keeps.
    Object.assign(this, { selected: new Set(), anchor: null });
    // The card picked when this deck was last open in this tab, by its words, so going to a stack and back lands
    // on it; read before the first paint stores the first card in its place.
    try { this.recalled = JSON.parse(globalThis.sessionStorage.getItem(`deck:${item}`)); } catch { this.recalled = null; }
    // The cards whose children are folded away in this browser, by title: the reader's own view, never the page's.
    try { this.folded = new Set(JSON.parse(globalThis.localStorage.getItem(`deck-folded:${item}`)) ?? []); } catch { this.folded = new Set(); }
    this.status = this.node('p', 'save-status deck-status'); this.status.setAttribute('role', 'status');
    this.opening = this.node('div', 'deck-opening');
    this.list = this.node('ol', 'deck-cards'); this.list.setAttribute('aria-label', 'Cards');
    this.count = this.node('span', 'deck-count');
    // A button's act leaves the focus on the picked card, so the keys go on working.
    const button = (label, act) => { const node = this.node('button', '', label); node.type = 'button'; node.onclick = () => { act(); if (!this.editing) this.show(true); }; return node; };
    this.editButton = button('Edit', () => (this.editing ? this.finish() : this.edit()));
    this.bar = this.node('div', 'deck-bar');
    this.bar.append(this.count, this.editButton, button('New card', () => this.start()), button('Undo', () => this.undo()));
    this.keys = this.node('p', 'deck-keys muted', KEYS);
    // Safari's AutoFill, and Apple's iCloud Passwords extension in Chrome, ignore autocomplete="off" and judge a
    // box that has no label element by the page's words around it, so beside a card about tokens or codes an empty
    // box reads as a field for a one-time code. A box named by aria-labelledby is judged by its label's words
    // alone, and these name nothing AutoFill fills: not card, title or name, which read as a credit card or contact.
    const label = (id, text) => { const node = this.node('span', '', text); node.id = id; node.hidden = true; return node; };
    // The count and the buttons stand above the cards, where a phone's keyboard never covers Done.
    host.replaceChildren(this.status, this.opening, this.bar, this.keys, this.list,
      label('deck-editor-label', 'Writing: the first line is the heading, the rest its words'), label('deck-ask-label', 'Ask an agent about this'));
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
        if (notebook === this.notebook) { await this.loadTalks(); return this.resume(); }
      }
      const source = await this.read('memory_current', { item_id: this.item });
      if (this.sending) { this.owed = true; return true; }
      const first = !this.source;
      Object.assign(this, { source, notebook });
      if (source.source_ref.revision !== this.base?.revision) this.rebase({ revision: source.source_ref.revision, body: source.body ?? '' });
      if (first) {
        const at = typeof this.recalled?.text === 'string' ? findCard(this.deck, this.recalled.text, this.recalled.at) : -1;
        if (at >= 0 && at !== this.picked) this.pick(at);
        await this.paintHeader();
        // A phone opens on the cards themselves, the header above scrolled away.
        if (this.phone) this.bar.scrollIntoView({ block: 'start' });
      }
      await this.loadTalks();
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
    const keep = this.deck.cards[this.picked], before = this.deck.cards;
    let deck = parseDeck(base.body), lost = 0;
    const acts = this.acts.filter(act => {
      const done = applyAct(deck, act);
      if (done) deck = parseDeck(deckBody(done.deck)); else lost++;
      return Boolean(done);
    });
    Object.assign(this, { base, deck, acts });
    this.reselect(before);
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
    // Where asks go is read once; a read that fails leaves the cards without asks, and their stacks still open.
    this.room = (await this.askIn?.(this.source.owner_scope).catch(() => null)) ?? null;
    this.paint();
  }

  // How many replies each card's stack has, and how many of them wait unread
  // for this person, from its topic's latest messages, read on every load as
  // the conversation page reads its topic. A read that fails keeps the counts.
  // SHORTCUT: only the topic's latest 100 messages are read, so a stack begun
  // before them shows its bubble with no count. To harden: a Core view of one
  // stack's replies and unread count, by its first message.
  async loadTalks() {
    const roots = new Map(), talks = new Map();
    for (const card of this.deck.cards) for (const { topicId, messageId } of cardStacks(card.words, messageOf).stacks) roots.set(messageId, topicId);
    try {
      for (const topicId of new Set(roots.values())) {
        const { items } = await this.read('topic_messages', { topic_id: topicId, direction: 'before', limit: 100 });
        const parents = new Map(items.map(item => [item.id, item.reply_to]));
        for (const id of parents.keys()) if (roots.has(id)) talks.set(id, { replies: 0, unread: 0 });
        for (const item of items) {
          for (let up = item.reply_to; up; up = parents.get(up)) {
            if (!roots.has(up)) continue;
            const talk = talks.get(up) ?? { replies: 0, unread: 0 };
            talks.set(up, { replies: talk.replies + 1, unread: talk.unread + (item.unread ? 1 : 0) });
            break;
          }
        }
      }
    } catch { return; }
    const told = map => JSON.stringify([...map].sort());
    if (told(talks) !== told(this.talks)) { this.talks = talks; this.paint(); }
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
    const before = this.deck.cards;
    this.deck = parseDeck(deckBody(done.deck)); this.acts.push(act);
    this.reselect(before);
    if (!undoing) this.undos = [...this.undos, done.undo].slice(-UNDO_LIMIT);
    this.picked = Math.max(done.at, 0);
    // The card an act leaves picked shows, unfolding the cards it now stands under, unless the act removed its
    // card (its undo adds it back): the card beside it is picked then, and paint picks a folded card over it.
    if (done.undo.kind !== 'add') this.reveal(this.picked);
    this.paint();
    this.header.description.textContent = this.described();
    this.save();
    return true;
  }
  // An act on the picked card or, with several cards selected, on all of them as one act.
  actOn(kind, step) {
    const card = this.deck.cards[this.picked], text = card ? cardText(card) : '', near = this.picked;
    if (this.selected.size < 2) return this.act({ kind, text, step, near });
    const act = groupAct(this.deck, [...this.selected], kind, { step, text, near });
    return Boolean(act) && this.act(act);
  }
  // The selected cards found again, by their words, in the deck as it now stands; a ⇧ selection begins again.
  reselect(cards) {
    const found = [...this.selected].map(i => (cards[i] ? findCard(this.deck, cardText(cards[i]), i) : -1)).filter(i => i >= 0);
    this.selected = new Set(found.length > 1 ? found : []);
    this.anchor = null;
  }
  // ⇧↑ ⇧↓ or a ⇧-click: every card that shows from where the selection began to this one, with the cards
  // ⌘-clicked before it began.
  extend(index) {
    this.anchor ??= { at: this.picked, kept: new Set(this.selected) };
    const { shown } = this.layout(), selected = new Set(this.anchor.kept);
    for (let i = Math.min(this.anchor.at, index); i <= Math.max(this.anchor.at, index); i++) if (shown[i]) selected.add(i);
    this.selected = selected.size > 1 ? selected : new Set();
    this.pick(index, true);
  }
  // ⌘-click: the card added to the selection, the picked card with it, or taken out of it.
  toggle(index) {
    const selected = new Set(this.selected.size ? this.selected : [this.picked]);
    if (!selected.delete(index)) selected.add(index);
    const to = selected.has(index) ? index : selected.has(this.picked) ? this.picked : [...selected][0] ?? index;
    this.selected = selected.size > 1 ? selected : new Set();
    this.anchor = null;
    this.pick(to, true);
  }

  // ⌘Z or Undo: the person's own last act, taken back as an act of its own.
  undo() {
    if (this.editing || this.asking || this.readOnly) return;
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

  // The keys work while the deck or nothing has the focus, and while a card is written, only its own. An input
  // method's keys are its own, among them the key that ends a composition, which Safari sends with isComposing false
  // and keyCode 229.
  key(event) {
    if (this.host.hidden || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    const command = event.metaKey || event.ctrlKey, up = event.key === 'ArrowUp', down = event.key === 'ArrowDown';
    // A card's box keeps every key but these: Escape and ⌘Return finish the card, Tab and ⇧Tab move it, and ↑ at
    // the box's very start or ↓ at its very end goes on into the card beside. Tab stays the box's where there is
    // nowhere to go, as in an outliner, and so does ⌥Tab, Safari's Tab for every item, so no Tab takes the focus
    // out of a card half written.
    if (this.editing) {
      const field = this.editing.field, plain = !command && !event.shiftKey && !event.altKey;
      if (event.target !== field) return;
      if (event.key === 'Escape' || (event.key === 'Enter' && command)) this.finish();
      else if (event.key === 'Tab' && !command) this.nestWriting(event.shiftKey ? 'outdent' : 'indent');
      else if (plain && up && field.selectionEnd === 0) { if (!this.writeBeside(-1)) return; }
      else if (plain && down && field.selectionStart === field.value.length) { if (!this.writeBeside(1)) return; }
      else return;
      event.preventDefault();
      return;
    }
    // In the ask box, Escape goes back to the cards, and so does an arrow from a box with nothing written,
    // ↑ and ↓ going on to the card beside; the writing waits for the card's next ask.
    if (this.asking?.form.contains(event.target)) {
      const plain = !command && !event.shiftKey && !event.altKey, empty = !/\S/.test(this.asking.field.value);
      if (event.key === 'Escape' || (plain && empty && event.target === this.asking.field && (up || down || event.key === 'ArrowLeft'))) {
        event.preventDefault();
        this.endAsk(true);
        if (!this.asking && (up || down)) this.pick(this.beside(this.picked, up ? -1 : 1));
      } else if (event.key === 'Enter' && command && event.target === this.asking.field) { event.preventDefault(); this.sendAsk(); }
      return;
    }
    if (event.target !== this.doc.body && !this.list.contains(event.target)) return;
    // A speech bubble with the focus presses as a link or a button does, and ← gives the focus back to its card.
    const bubble = event.target.closest?.('.deck-bubble');
    if (bubble && (event.key === 'Enter' || event.key === ' ')) return;
    if (bubble && event.key === 'ArrowLeft') { event.preventDefault(); this.show(true); return; }
    const card = this.deck.cards[this.picked], text = card ? cardText(card) : '', near = this.picked;
    if ((up || down) && command && !event.altKey && event.shiftKey) this.act({ kind: 'merge', text, step: up ? -1 : 1, near });
    else if ((up || down) && command && !event.altKey) this.actOn('move', up ? -1 : 1);
    else if ((up || down) && event.shiftKey && !event.altKey) this.extend(this.beside(this.picked, up ? -1 : 1));
    else if ((up || down) && !event.altKey) this.pick(this.beside(this.picked, up ? -1 : 1));
    // Tab and ⇧Tab are the deck's only while there is somewhere to go, so the focus can still leave it.
    else if (event.key === 'Tab' && !command && !event.altKey) { if (!this.actOn(event.shiftKey ? 'outdent' : 'indent')) return; }
    else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && command && event.shiftKey && !event.altKey) this.foldAll(event.key === 'ArrowLeft');
    // ← and →, or ⌘← and ⌘→, are the deck's even where they change nothing, since the browser takes ⌘← and ⌘→
    // for Back and Forward.
    else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.shiftKey && !event.altKey) this.tree(event.key === 'ArrowLeft');
    else if (event.key === 'Enter' && command) this.edit();
    else if (event.key === 'Enter' && !event.shiftKey) this.start(event.altKey);
    else if (event.key === 'Backspace' && command) this.actOn('remove');
    else if (event.key === 'Escape' && this.selected.size) this.pick(this.picked);
    else if (event.key.toLowerCase() === 'z' && command && !event.shiftKey && !event.altKey) this.undo();
    else if (event.key === 'ArrowRight' && event.altKey && !command && !event.shiftKey) this.list.querySelector(`.deck-card[data-index="${this.picked}"] .deck-bubble`)?.focus();
    else return;
    event.preventDefault();
  }

  // Which cards show, none under a folded card, and each card's parent (-1 for the deck's own).
  layout() {
    const cards = this.deck.cards, shown = [], parents = [], open = [];
    cards.forEach((card, i) => {
      while (open.length && cards[open.at(-1)].depth >= card.depth) open.pop();
      parents.push(open.at(-1) ?? -1);
      shown.push(open.every(at => !this.folded.has(cards[at].title)));
      open.push(i);
    });
    return { shown, parents };
  }
  // The next card that shows, a step up (-1) or down (1) from the one at `from`; `from` when none does.
  beside(from, step) {
    const { shown } = this.layout();
    for (let i = from + step; i >= 0 && i < shown.length; i += step) if (shown[i]) return i;
    return from;
  }
  // ← or →, or a click on a parent's chevron: the cards under it folded away, or shown again.
  // The fold picks its card, so an ask open on another card closes as it does for a pick, keeping its writing.
  fold(index) {
    const card = this.deck.cards[index];
    if (!card || groupEnd(this.deck.cards, index) === index + 1) return;
    if (!this.folded.delete(card.title)) this.folded.add(card.title);
    this.keepFolds();
    this.picked = index;
    this.selected = new Set(); this.anchor = null;
    if (this.asking) this.endAsk(true);
    this.paint();
  }
  // ⇧⌘← or ⇧⌘→: every card's children folded away, or every card's shown again.
  foldAll(fold) {
    const cards = this.deck.cards;
    this.folded = new Set(fold ? cards.filter((card, i) => groupEnd(cards, i) > i + 1).map(card => card.title) : []);
    this.keepFolds();
    this.selected = new Set(); this.anchor = null;
    if (this.asking) this.endAsk(true);
    this.paint();
  }
  // ← and → as in any tree: the picked card's children folded away or shown again, and from a card with no
  // children showing, ← goes up to its parent; from one whose children show, → goes down to the first.
  tree(left) {
    const cards = this.deck.cards, i = this.picked, card = cards[i];
    if (!card) return;
    const children = groupEnd(cards, i) > i + 1, folded = this.folded.has(card.title);
    if (left && children && !folded) this.fold(i);
    else if (left) { const parent = this.layout().parents[i]; if (parent >= 0) this.pick(parent); }
    else if (children) { if (folded) this.fold(i); else this.pick(i + 1); }
  }
  // Every card that the card at `index` stands under unfolded, so that it shows.
  reveal(index) {
    const { parents } = this.layout();
    let unfolded = false;
    for (let at = parents[index] ?? -1; at >= 0; at = parents[at]) unfolded = this.folded.delete(this.deck.cards[at].title) || unfolded;
    if (unfolded) this.keepFolds();
  }
  keepFolds() {
    try { globalThis.localStorage.setItem(`deck-folded:${this.item}`, JSON.stringify([...this.folded])); } catch {}
  }
  // A parent's chevron, at the start of its title.
  foldButton(index) {
    const button = this.node('button', 'deck-fold');
    button.type = 'button';
    button.tabIndex = -1;
    button.setAttribute('aria-label', 'Cards under this one');
    button.setAttribute('aria-expanded', String(!this.folded.has(this.deck.cards[index].title)));
    button.append(mark(this.doc, CHEVRON));
    // While a card is being written, a click here finishes it and folds nothing.
    button.addEventListener('click', event => { event.stopPropagation(); if (this.editing) this.finish(); else this.fold(index); });
    return button;
  }

  // A pick ends a selection, unless it is the selection's own.
  pick(index, keep = false) {
    if (!this.deck.cards.length) return;
    if (!keep) { this.selected = new Set(); this.anchor = null; }
    this.picked = Math.min(Math.max(index, 0), this.deck.cards.length - 1);
    if (this.asking && this.picked !== this.asking.near) this.endAsk(true);
    this.mark();
    this.show(true);
  }
  // On a phone the card in view is the one picked.
  scrolled() {
    if (!this.phone || this.editing || this.asking || !this.list.clientWidth) return;
    const row = this.list.querySelectorAll('.deck-card:not([hidden])')[Math.round(this.list.scrollLeft / this.list.clientWidth)];
    const index = Number(row?.dataset.index);
    if (Number.isInteger(index) && index !== this.picked) { this.picked = index; this.mark(); }
  }
  mark() {
    for (const row of this.list.querySelectorAll('.deck-card')) {
      const index = Number(row.dataset.index), picked = index === this.picked, selected = this.selected.has(index);
      row.tabIndex = picked ? 0 : -1;
      if (picked) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
      row.classList.toggle('deck-selected', selected);
      row.querySelector(':scope > .deck-selected-note')?.remove();
      if (selected) row.prepend(this.node('span', 'sr-only deck-selected-note', 'Selected. '));
    }
    const { shown } = this.layout(), seen = shown.filter(Boolean).length, away = shown.length - seen;
    const together = this.selected.size ? ` · ${this.selected.size} selected` : '';
    this.count.textContent = shown.length ? `${shown.slice(0, this.picked + 1).filter(Boolean).length} of ${seen}${away ? ` · ${away} folded` : ''}${together}` : 'No cards yet';
    const card = this.deck.cards[this.picked];
    try { if (card) globalThis.sessionStorage.setItem(`deck:${this.item}`, JSON.stringify({ text: cardText(card), at: this.picked })); } catch {}
  }
  // The picked card in view; on a laptop it takes the focus when the deck has it (or nothing does).
  // A phone has no keys for the deck, so its cards never take the focus.
  show(focus) {
    const row = this.list.querySelector(`.deck-card[data-index="${this.picked}"]`);
    if (!row) return;
    if (this.phone) { this.list.scrollTo({ left: [...this.list.querySelectorAll('.deck-card:not([hidden])')].indexOf(row) * this.list.clientWidth }); return; }
    row.scrollIntoView({ block: 'nearest' });
    if (focus) row.focus({ preventScroll: true });
  }

  // ⌘Return, Edit or a click: the picked card's text in one box, its first line the title, the cursor at `at` (a click's
  // place) or the end. The lines naming its stacks stay out of the box and go back under what is written, so writing
  // never loses them.
  edit(at = null) {
    const card = this.deck.cards[this.picked];
    if (!card || this.readOnly || this.asking) return;
    const { words, stacks } = cardStacks(card.words, address => (messageOf(address) ? stackLine(address) : null));
    this.open({ text: cardText(card), shown: cardText({ title: card.title, words }), stacks, depth: card.depth, near: this.picked, fresh: false, at });
  }
  // A click on a card: a card being written is finished first, and the clicked one, found again by its text in case
  // that moved it, opens in its box with the cursor at `at`.
  editAt(text, near, at) {
    if (this.editing) this.finish();
    const index = findCard(this.deck, text, near);
    if (index < 0) return;
    this.pick(index);
    this.edit(at);
  }
  // Where a click fell in a card, as a place in its box's text (the title, a line break, the words as written), or
  // null when it fell on neither the title nor the words.
  placeOf(event, card, words, titleNode, wordsNode) {
    const doc = this.doc, point = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
    const range = point ? null : doc.caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = point?.offsetNode ?? range?.startContainer, offset = point?.offset ?? range?.startOffset;
    if (!node) return null;
    const before = doc.createRange();
    if (card.title && titleNode.contains(node)) { before.setStart(titleNode, 0); before.setEnd(node, offset); return before.toString().length; }
    if (!wordsNode.contains(node)) return null;
    before.setStart(wordsNode, 0); before.setEnd(node, offset);
    return card.title.length + 1 + writtenAt(words, wordsNode.textContent, before.toString().length);
  }
  // Return or New card: an empty card beside the picked one, after its children; ⌥Return: right above it.
  start(above = false) {
    if (this.readOnly || !this.base || this.asking) return;
    const card = this.deck.cards[this.picked], last = !card ? -1 : above ? this.picked - 1 : groupEnd(this.deck.cards, this.picked) - 1;
    this.open({ text: '', after: last >= 0 ? cardText(this.deck.cards[last]) : null, depth: card?.depth ?? 0, near: last, fresh: true });
  }
  open(editing) {
    if (this.editing) this.finish();
    this.selected = new Set(); this.anchor = null;
    const field = this.node('textarea', 'deck-editor');
    field.setAttribute('autocomplete', 'off');
    field.value = editing.shown ?? editing.text;
    field.setAttribute('aria-labelledby', 'deck-editor-label');
    field.addEventListener('input', () => this.fit(field));
    this.editing = { ...editing, field };
    this.paint();
    const at = Math.min(editing.at ?? field.value.length, field.value.length);
    field.setSelectionRange(at, at);
  }
  // Tab or ⇧Tab while a card is written: the card goes under the card above or out of its parent by the rules of a
  // picked card, and is saved there, while the writing and the cursor stay as they were; the writing is saved when
  // the card is finished. A new card not yet made only changes where it will go.
  nestWriting(kind) {
    const editing = this.editing;
    if (!editing.fresh) { this.act({ kind, text: editing.text, near: editing.near }); return; }
    const placed = placeNew(this.deck, editing, kind);
    if (placed) { Object.assign(editing, placed); this.paint(); }
  }
  // ↑ at the very start of the card being written, or ↓ at its very end: the card is finished, and the card that
  // shows above or below it opens for writing, the cursor at that card's end or its start. False when none shows.
  writeBeside(step) {
    const editing = this.editing, { shown } = this.layout();
    // A card being written stands in its card's place; a new one, between the card it follows and the next.
    const at = editing.fresh ? (editing.after === null ? -1 : findCard(this.deck, editing.after, editing.near)) : findCard(this.deck, editing.text, editing.near);
    if (at < 0 && !(editing.fresh && editing.after === null)) return false;
    // A card cleared of all its text goes with its children when it is finished, so ↓ goes on past them.
    const cleared = !editing.fresh && !cardText(textCard(editing.field.value));
    let to = step > 0 ? (cleared ? groupEnd(this.deck.cards, at) : at + 1) : editing.fresh ? at : at - 1;
    while (to >= 0 && to < shown.length && !shown[to]) to += step;
    if (to < 0 || to >= shown.length) return false;
    this.editAt(cardText(this.deck.cards[to]), to, step < 0 ? null : 0);
    return true;
  }
  // Escape, ⌘Return or Done: what was written becomes the card; a new card with nothing written is not made.
  finish() {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    const written = editing.field.value, to = editing.stacks?.length && /\S/.test(written) ? `${written.trimEnd()}\n\n${editing.stacks.join('\n')}` : written;
    let made = false;
    if (editing.fresh) made = this.act({ kind: 'add', after: editing.after, text: to, depth: editing.depth, near: editing.near });
    else if (written !== (editing.shown ?? editing.text)) {
      made = this.act({ kind: 'edit', text: editing.text, to, near: editing.near });
      // Its card changed elsewhere while it was written: what was written goes beside it, over nothing.
      if (!made && findCard(this.deck, editing.text, editing.near) < 0 && /\S/.test(to)) {
        const before = this.deck.cards[Math.min(editing.near, this.deck.cards.length) - 1];
        made = this.act({ kind: 'add', after: before ? cardText(before) : null, text: to, depth: editing.depth, near: editing.near - 1 });
        if (made) this.say('That card changed elsewhere while you wrote, so what you wrote is a card of its own beside it.', 'attention');
      }
    }
    if (!made) this.paint();
    this.show(true);
  }
  // A card's speech bubbles: one for each of its reply stacks, which opens it, saying Sent until its first reply
  // and then counting them, and marked only while one waits unread; or, on a card with none, one that asks an
  // agent about it. A stack begun before the messages read says nothing.
  bubbles(index, stacks) {
    const holder = this.node('div', 'deck-bubbles');
    for (const { topicId, messageId } of stacks) {
      const talk = this.talks.get(messageId), link = this.node('a', 'deck-bubble'), words = !talk ? null : talk.replies ? String(talk.replies) : 'Sent';
      link.append(mark(this.doc, BALLOON), ...(words ? [this.node('span', '', words)] : []));
      link.href = routeHref({ kind: 'topic', id: topicId, message: messageId });
      link.tabIndex = -1;
      link.setAttribute('aria-label', !talk ? 'Reply stack' : talk.replies ? `Reply stack: ${talk.replies === 1 ? '1 reply' : `${talk.replies} replies`}${talk.unread ? `, ${talk.unread} not read` : ''}` : 'Reply stack: asked, no reply yet');
      link.classList.toggle('deck-unread', Boolean(talk?.unread));
      link.addEventListener('click', event => event.stopPropagation());
      holder.append(link);
    }
    if (!stacks.length && this.room?.agents.length && !this.readOnly) {
      const ask = this.node('button', 'deck-bubble deck-ask');
      ask.append(mark(this.doc, BALLOON));
      ask.type = 'button';
      ask.tabIndex = -1;
      ask.setAttribute('aria-label', 'Ask an agent about this card');
      ask.addEventListener('click', event => { event.stopPropagation(); this.ask(index); });
      holder.append(ask);
    }
    return holder;
  }
  // The speech bubble on a card with no stack: an ask about it, written in a box in its place, to one agent:
  // the only one where the deck's asks go, or, of several, the one asked last (kept in this browser), and the
  // person may choose another. One agent and not all, since each one asked would start on the same work.
  ask(index) {
    const card = this.deck.cards[index];
    if (!card || !this.room?.agents.length || this.readOnly || this.asking) return;
    if (this.editing) this.finish();
    this.selected = new Set(); this.anchor = null;
    const form = this.node('div', 'deck-ask-form'), field = this.node('textarea', 'deck-ask-field'), to = this.node('select', 'deck-ask-to');
    field.setAttribute('aria-labelledby', 'deck-ask-label');
    field.setAttribute('autocomplete', 'off');
    field.placeholder = 'Ask an agent about this…';
    field.value = this.drafts.get(cardText(card)) ?? '';
    field.addEventListener('input', () => this.fit(field));
    let last = null;
    try { last = globalThis.localStorage.getItem('deck-agent'); } catch {}
    const agents = this.room.agents.includes(last) ? [last, ...this.room.agents.filter(agent => agent !== last)] : this.room.agents;
    for (const agent of agents) { const option = this.node('option', '', agent); option.value = agent; to.append(option); }
    to.setAttribute('aria-label', 'The agent it goes to');
    const line = this.node('div', 'deck-ask-line'), send = this.node('button', '', 'Ask'), cancel = this.node('button', '', 'Cancel');
    send.type = cancel.type = 'button';
    send.onclick = () => this.sendAsk();
    cancel.onclick = () => this.endAsk();
    line.append(this.node('span', 'muted', 'To'), agents.length > 1 ? to : this.node('span', 'deck-ask-agent', agents[0]), send, cancel);
    form.append(field, line);
    this.asking = { text: cardText(card), depth: card.depth, near: index, form, field, to, envelope: null, sending: false };
    this.picked = index;
    this.paint();
    this.fit(field);
    field.focus({ preventScroll: true });
  }
  // Leaving the ask: kept, its writing waits for the card's next ask in this page; dropped by Cancel.
  endAsk(keep = false) {
    const asking = this.asking;
    if (!asking || asking.sending) return;
    if (keep && /\S/.test(asking.field.value)) this.drafts.set(asking.text, asking.field.value);
    else this.drafts.delete(asking.text);
    this.asking = null;
    this.paint();
    this.show(true);
  }
  // The ask goes as a new message where the deck's asks go, to the agent, the card quoted and the deck linked;
  // once Core has it, the card keeps the link to its stack as a line of its words. An ask whose answer does not
  // come is sent again as it was, on Try again, so Core records it once.
  async sendAsk() {
    const asking = this.asking;
    if (!asking || asking.sending) return;
    if (!asking.envelope) {
      const words = asking.field.value.trim(), agent = asking.to.value;
      if (!words || !agent) { asking.field.focus(); return; }
      // The agent is told where the card is, so it can change the card when the ask is to: a heading on a
      // Notebook page, with the line naming this stack kept under it.
      const card = textCard(asking.text), quoted = [`**${card.title || 'Untitled'}**`, ...cardStacks(card.words, messageOf).words.split('\n')];
      const body = `${words}\n\n${quoted.map(line => (line ? `> ${line}` : '>')).join('\n')}\n\n` +
        `The card is a ${'#'.repeat(asking.depth + 2)} heading on the Notebook page ${this.item}, “${this.source.title || 'Notebook page'}”, seen as cards at ` +
        `${placeLink({ kind: 'cards', id: this.item })}. To change it, revise that page and keep its Reply stack line.`;
      asking.envelope = { operation_id: crypto.randomUUID(), agent, args: { body, addressees: [agent], intent: 'ask' } };
    }
    asking.sending = asking.field.readOnly = asking.to.disabled = true;
    this.say('Asking…', 'saving');
    let receipt;
    try { receipt = await this.send('message.post', { topic_id: this.room.topicId }, asking.envelope.args, {}, asking.envelope.operation_id); }
    catch (error) { receipt = { status: 'retryable', error }; }
    asking.sending = false;
    if (receipt?.status === 'committed') {
      try { globalThis.localStorage.setItem('deck-agent', asking.envelope.agent); } catch {}
      if (this.asking === asking) this.asking = null;
      this.drafts.delete(asking.text);
      const line = stackLine(messageLink(this.room.topicId, receipt.result.message_id));
      if (!this.act({ kind: 'edit', text: asking.text, to: `${asking.text}\n\n${line}`, near: asking.near })) {
        this.paint();
        this.say('Asked, in a new reply stack. The card changed meanwhile, so it does not show the stack.', 'attention');
      }
      return;
    }
    if (receipt?.status === 'retryable') { this.say(`Not asked yet. ${receipt.error?.message ?? 'Theseus is busy.'}`, 'attention', () => this.sendAsk()); return; }
    // Refused, and recorded so: what was written stays, to change and send as a new ask.
    asking.envelope = null;
    asking.field.readOnly = asking.to.disabled = false;
    this.say(`Not asked: ${receipt?.error?.message ?? 'Theseus did not take it.'}`, 'attention');
  }
  // The card asked about, as it was when its bubble was pressed, with the ask under it.
  askRow(asking) {
    const card = textCard(asking.text), row = this.node('li', 'deck-card deck-asking');
    row.style.setProperty('--depth', String(asking.depth));
    row.append(this.node('h3', card.title ? 'deck-title' : 'deck-title muted', card.title || 'Untitled'),
      formatWords(this.node('div', 'deck-words'), cardStacks(card.words, messageOf).words), asking.form);
    return row;
  }

  fit(field) {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + 2}px`;
  }

  paint() {
    const { cards, opening } = this.deck, editing = this.editing, asking = this.asking;
    this.opening.hidden = !/\S/.test(opening);
    if (!this.opening.hidden) formatWords(this.opening, opening.trim());
    // A card under a folded one is drawn hidden, so the rows stand where their cards do; a phone shows a child's
    // parent above it, since it shows one card at a time.
    const { shown, parents } = this.layout();
    while (!shown[this.picked] && parents[this.picked] >= 0) this.picked = parents[this.picked];
    const rows = cards.map((card, index) => {
      const row = this.node('li', 'deck-card'), { words, stacks } = cardStacks(card.words, messageOf);
      const title = this.node('h3', card.title ? 'deck-title' : 'deck-title muted', card.title || 'Untitled');
      if (groupEnd(cards, index) > index + 1) title.prepend(this.foldButton(index));
      row.dataset.index = String(index);
      row.hidden = !shown[index];
      row.style.setProperty('--depth', String(card.depth));
      if (parents[index] >= 0) row.append(this.node('p', 'deck-under muted', cards[parents[index]].title || 'Untitled'));
      const shownWords = formatWords(this.node('div', 'deck-words'), words);
      row.append(title, shownWords, this.bubbles(index, stacks));
      // A click opens the card in its box with the cursor where it fell. ⌘-click and ⇧-click select, never selecting
      // the page's text, and finish a card being written first, so a click and then a ⌘-click select both cards. A
      // link or a button keeps its own click, and words a drag selected stay selected.
      const selecting = event => (event.metaKey || event.ctrlKey || event.shiftKey) && !event.target.closest('a, button');
      row.addEventListener('mousedown', event => { if (selecting(event)) event.preventDefault(); });
      row.addEventListener('click', event => {
        const text = cardText(card), writing = Boolean(this.editing);
        if (!selecting(event) && !event.target.closest('a, button') && this.doc.getSelection()?.isCollapsed !== false) {
          this.editAt(text, index, this.placeOf(event, card, words, title, shownWords));
          return;
        }
        if (writing) this.finish();
        const at = findCard(this.deck, text, index);
        if (selecting(event) && at >= 0) { if (event.shiftKey) this.extend(at); else this.toggle(at); }
        else if (!writing) this.pick(index);
      });
      return row;
    });
    if (editing) {
      const holder = this.node('li', 'deck-card deck-writing');
      const at = editing.fresh ? (editing.after === null ? 0 : findCard(this.deck, editing.after, editing.near) + 1) : findCard(this.deck, editing.text, editing.near);
      // The box stands in its card's place at its card's depth, wherever an act or a read of the page has put it.
      if (!editing.fresh && at >= 0) Object.assign(editing, { near: at, depth: cards[at].depth });
      holder.style.setProperty('--depth', String(editing.depth ?? 0));
      holder.append(editing.field);
      if (editing.fresh) rows.splice(at > 0 ? at : editing.after === null ? 0 : rows.length, 0, holder);
      else if (at >= 0) rows.splice(at, 1, holder);
      else rows.splice(Math.min(editing.near, rows.length), 0, holder);
    }
    if (asking) {
      const at = findCard(this.deck, asking.text, asking.near);
      rows.splice(at >= 0 ? at : Math.min(asking.near, rows.length), at >= 0 ? 1 : 0, this.askRow(asking));
    }
    if (!rows.length) rows.push(this.node('li', 'deck-empty muted', this.readOnly ? 'No cards here.' : 'No cards yet. Return, or New card, starts one.'));
    const selection = editing && [editing.field.selectionStart, editing.field.selectionEnd], focused = this.doc.activeElement;
    const asked = asking && [asking.field.selectionStart, asking.field.selectionEnd];
    this.list.replaceChildren(...rows);
    this.list.classList.toggle('deck-editing', Boolean(editing || asking));
    this.keys.textContent = asking ? ASKING_KEYS : editing ? WRITING_KEYS : KEYS;
    this.editButton.textContent = editing ? 'Done' : 'Edit';
    this.mark();
    if (editing) {
      editing.field.focus({ preventScroll: true });
      if (selection) editing.field.setSelectionRange(...selection);
      this.fit(editing.field);
      editing.field.closest('li').scrollIntoView({ block: 'nearest', inline: 'center' });
    } else if (asking && asking.form.contains(focused)) {
      focused.focus({ preventScroll: true });
      if (focused === asking.field) asking.field.setSelectionRange(...asked);
      this.fit(asking.field);
    } else if (!asking) this.show(this.list.contains(this.doc.activeElement) || this.doc.activeElement === this.doc.body);
  }
}
