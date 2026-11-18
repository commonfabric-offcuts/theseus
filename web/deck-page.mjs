import { applyAct, boxText, cardImages, cardStacks, cardText, deckBody, findCard, groupAct, groupEnd, imageStandIns, parseDeck, placeNew, stackLine, textCard, writtenAt } from './deck.mjs';
import { messageLink, messageOf, placeLink } from './links.mjs';
import { deferFencePaint } from './fence-copy.mjs';
import { formatWords } from './message-format.mjs';
import { routeHref } from './topic-navigation.mjs';
import { timeNode } from './times.mjs';
import { WritingInput } from './writing-input.mjs';
import { revealSelection } from './reveal.mjs';
import { reach } from './arrow-reach.mjs';

export const UNDO_LIMIT = 50;
const KEYS = '↑ ↓ pick · ⇧↑ ⇧↓, ⌘-click select · ⌘↑ ⌘↓ move · ⇧⌘↑ ⇧⌘↓ merge · Tab under the card above, ⇧Tab out · ← fold, → unfold, ⇧⌘← ⇧⌘→ all · Return new card, ⌥Return above · click or ⌘Return edit, Escape done · ⌘⌫ remove · ⌘Z undo · → its speech bubble';
const ASKING_KEYS = '⌘Return ask · Escape back to the cards, keeping what you wrote · ↑ ↓ ← leave a box with nothing written';
const WRITING_KEYS = 'Escape done · ⌘Return done and a new card below · ← at the very start folds the card away · ⌘↑ ⌘↓ move · Tab under the card above, ⇧Tab out · ⌥↑ ⌥↓ move a line · ↑ at the very start or ↓ at the very end goes on to the card beside';
// The same lines, short, where the cards stand in the composer over the feed (notebook-sheet.mjs); each keeps its
// long form as its tooltip.
const SHORT_KEYS = ['↑ ↓ pick · Return new card · ⌘Return edit', 'Escape done · ⌘Return next card', '⌘Return ask · Escape back'];
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
// keys and touch at every width (item 652: the laptop editor on phones for now), a card's
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
  // shortKeys: the lines of keys in their short form, the long form their tooltip.
  constructor({ host, header, item, read, send, place, askIn, shortKeys = false, doc = globalThis.document }) {
    Object.assign(this, { host, header, item, read, send, place, askIn, doc });
    // The listeners on the document go with the page when it closes (close()).
    this.listening = new AbortController();
    const signal = this.listening.signal;
    // base: the page as Core last confirmed it. acts: the person's acts since, in order. undos: what takes back
    // each of their acts, newest last. sending: the save on its way, sent again as it is until Core answers it
    // (failed while its last send went unanswered).
    // held: a refusal stopped saving until Try again. notebook: the Notebook's version when the page was read.
    // room: where an ask goes. talks: each stack's {replies, unread}, by its first message. asking: the ask being written.
    Object.assign(this, { base: null, source: null, notebook: null, acts: [], undos: [], sending: null, owed: false, held: false,
      readOnly: false, deck: parseDeck(''), picked: 0, editing: null, room: null, talks: new Map(), asking: null, drafts: new Map(),
      // keyed: a key is acting (show).
      keyed: false });
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
    // The lines of keys for the cards, for a card being written and for an ask stand in one place, all but the one
    // that applies hidden, so the line keeps the height of the longest and the cards below it stay where they are.
    this.keys = this.node('p', 'deck-keys muted');
    this.keyLines = [KEYS, WRITING_KEYS, ASKING_KEYS].map((words, i) => {
      const line = this.node('span', '', shortKeys ? SHORT_KEYS[i] : words);
      if (shortKeys) line.title = words;
      return line;
    });
    this.keys.append(...this.keyLines);
    // Safari's AutoFill, and Apple's iCloud Passwords extension in Chrome, ignore autocomplete="off" and judge a
    // box that has no label element by the page's words around it, so beside a card about tokens or codes an empty
    // box reads as a field for a one-time code. A box named by aria-labelledby is judged by its label's words
    // alone, and these name nothing AutoFill fills: not card, title or name, which read as a credit card or contact.
    const label = (id, text) => { const node = this.node('span', '', text); node.id = id; node.hidden = true; return node; };
    // The count and the buttons stand above the cards, where a phone's keyboard never covers Done.
    host.replaceChildren(this.status, this.opening, this.bar, this.keys, this.list,
      label('deck-editor-label', 'Writing: the first line is the heading, the rest its words'), label('deck-ask-label', 'Ask an agent about this'));
    // While a key acts, whatever it leaves picked comes into view by the keys' rule (show, reveal.mjs).
    doc.addEventListener('keydown', event => { this.keyed = true; try { this.key(event); } finally { this.keyed = false; } }, { signal });
    // A card under the pointer shows its speech bubble, and the pointer's highlights, only while the pointer is in
    // use: macOS hides the pointer while a person types, and the cards the keys scroll under it would light up one
    // by one. A move of the mouse itself, not of the page under it, puts the pointer in use, and any key but a
    // modifier takes it out of use.
    let pointer = null;
    doc.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      if (pointer && (pointer.x !== event.screenX || pointer.y !== event.screenY)) this.list.classList.add('deck-pointing');
      pointer = { x: event.screenX, y: event.screenY };
    }, { signal });
    doc.addEventListener('keydown', event => { if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) this.list.classList.remove('deck-pointing'); }, { signal });
  }
  node(tag, className, text) {
    const element = this.doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  // Whether the page is marked a draft, its words kept from agents (NotebookPage: as the person's writing has it).
  drafted() { return this.source?.draft === true; }

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
    if (event.target.closest?.('.fence-copy')) return;
    const command = event.metaKey || event.ctrlKey, up = event.key === 'ArrowUp', down = event.key === 'ArrowDown';
    // A card's box keeps every key but these: Escape finishes the card, and ⌘Return finishes it and opens a new card
    // below it; Tab, ⇧Tab, ⌘↑ and ⌘↓ move it as they move a picked card; ↑ at the box's very start or ↓ at its very
    // end goes on into the card beside, and ← at its very start, on a card with children, finishes it and folds
    // them away. Tab stays the box's where there is nowhere to go, as in an outliner, and so does ⌥Tab, Safari's Tab
    // for every item, so no Tab takes the focus out of a card half written.
    if (this.editing) {
      const field = this.editing.field, plain = !command && !event.shiftKey && !event.altKey;
      if (event.target !== field) return;
      // The composer's writing keys come first: ⌥↑ and ⌥↓ move a line, and the line keys of a Mac (writing-input.mjs).
      if (this.editing.input.writingKey(event)) return;
      if (event.key === 'Escape') this.finish();
      else if (event.key === 'Enter' && command) this.writeNext();
      else if (event.key === 'Tab' && !command) this.moveWriting({ kind: event.shiftKey ? 'outdent' : 'indent' });
      else if ((up || down) && command && !event.shiftKey && !event.altKey) this.moveWriting({ kind: 'move', step: up ? -1 : 1 });
      else if (plain && up && field.selectionEnd === 0) { if (!this.writeBeside(-1)) return; }
      else if (plain && down && field.selectionStart === field.value.length) { if (!this.writeBeside(1)) return; }
      else if (plain && event.key === 'ArrowLeft' && field.selectionEnd === 0) { if (!this.foldWriting()) return; }
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
    // Past the first card or the last, the arrow goes on to what lies that way
    // on the page: the bar above the cards, the header (arrow-reach.mjs). With
    // nothing focused the arrows stay the deck's, picking a card.
    const plainArrow = !command && !event.shiftKey && !event.altKey && this.list.contains(event.target);
    if (plainArrow && (up || down) && this.beside(this.picked, up ? -1 : 1) === this.picked && this.handOn(up ? 'up' : 'down')) { event.preventDefault(); return; }
    if ((up || down) && command && !event.altKey && event.shiftKey) this.act({ kind: 'merge', text, step: up ? -1 : 1, near });
    else if ((up || down) && command && !event.altKey) this.actOn('move', up ? -1 : 1);
    else if ((up || down) && event.shiftKey && !event.altKey) this.extend(this.beside(this.picked, up ? -1 : 1));
    else if ((up || down) && !event.altKey) this.pick(this.beside(this.picked, up ? -1 : 1));
    // Tab and ⇧Tab are the deck's only while there is somewhere to go, so the focus can still leave it.
    else if (event.key === 'Tab' && !command && !event.altKey) { if (!this.actOn(event.shiftKey ? 'outdent' : 'indent')) return; }
    else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && command && event.shiftKey && !event.altKey) this.foldAll(event.key === 'ArrowLeft');
    // ← and →, or ⌘← and ⌘→, are the deck's even where they change nothing, since the browser takes ⌘← and ⌘→
    // for Back and Forward.
    else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.shiftKey && !event.altKey) this.tree(event.key === 'ArrowLeft', command);
    else if (event.key === 'Enter' && command) this.edit();
    else if (event.key === 'Enter' && !event.shiftKey) this.start(event.altKey);
    else if (event.key === 'Backspace' && command) this.actOn('remove');
    else if (event.key === 'Escape' && this.selected.size) this.pick(this.picked);
    else if (event.key.toLowerCase() === 'z' && command && !event.shiftKey && !event.altKey) this.undo();
    else if (event.key === 'ArrowRight' && event.altKey && !command && !event.shiftKey) this.toBubble();
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
  // ← and → as in a tree: the picked card's children folded away or shown again, and from a card with no
  // children showing, ← goes up to its parent. From a card with none folded away, → gives the focus to its speech
  // bubble, and ⌘→ goes down to its first child.
  tree(left, command) {
    const cards = this.deck.cards, i = this.picked, card = cards[i];
    if (!card) return;
    const children = groupEnd(cards, i) > i + 1, folded = this.folded.has(card.title);
    if (left && children && !folded) this.fold(i);
    else if (left) { const parent = this.layout().parents[i]; if (parent >= 0) this.pick(parent); }
    else if (children && folded) this.fold(i);
    else if (!command) this.toBubble();
    else if (children) this.pick(i + 1);
  }
  // The arrow on from the picked card to what lies that way.
  handOn(way) {
    const from = this.list.querySelector(`.deck-card[data-index="${this.picked}"]`);
    return Boolean(from) && reach(from, way, { doc: this.doc });
  }
  // → or ⌥→: the picked card's speech bubble takes the focus, and ← gives it back to the card.
  toBubble() {
    this.list.querySelector(`.deck-card[data-index="${this.picked}"] .deck-bubble`)?.focus();
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
    button.title = 'Cards under this one';
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
  // The picked card in view, using the laptop list at every width for now (item 652).
  // A key keeps room around it (reveal.mjs); a press keeps the page where it is (item 644).
  show(focus) {
    const row = this.list.querySelector(`.deck-card[data-index="${this.picked}"]`);
    if (!row) return;
    if (this.keyed) revealSelection(row);
    if (focus) row.focus({ preventScroll: true });
  }

  // ⌘Return, Edit or a click: the picked card's text in one box, its first line the title, the cursor at `at` (a click's
  // place) or the end. The lines naming its images and its stacks stay out of the box and go back under what is
  // written, so writing never loses them; its images show under the box as they show on the card (item 321).
  edit(at = null) {
    const card = this.deck.cards[this.picked];
    if (!card || this.readOnly || this.asking) return;
    const { words, stacks, images } = this.written(card), row = this.list.querySelector(`.deck-card[data-index="${this.picked}"]`);
    // The box keeps the height of the card's words; its images stand under it at the heights they showed at.
    const pictures = row ? [...row.querySelectorAll(':scope > .deck-images > .deck-image')] : [];
    const height = Math.max(0, (row?.getBoundingClientRect().height ?? 0) - (row?.querySelector(':scope > .deck-images')?.getBoundingClientRect().height ?? 0));
    const shownAt = new Map(pictures.map(figure => [figure.dataset.cardImage, figure.getBoundingClientRect().height]));
    // A parent's first title line contains its chevron, taller by touch. Read
    // that line's actual room before replacing the card. Extra title lines
    // already wrap in the textarea, so they must not also become top padding.
    const title = row?.querySelector(':scope > .deck-title'), body = row?.querySelector(':scope > .deck-words');
    let bodyStart = null;
    if (words && title?.querySelector('.deck-fold') && body) {
      const range = this.doc.createRange(); range.selectNodeContents(title.lastChild);
      const lines = [...range.getClientRects()], extra = lines.length ? lines[lines.length - 1].top - lines[0].top : 0;
      bodyStart = body.getBoundingClientRect().top - title.getBoundingClientRect().top - extra;
    }
    this.open({ text: cardText(card), shown: cardText({ title: card.title, words }), stacks, images, kept: images.join('\n'), shownAt, depth: card.depth, near: this.picked, fresh: false, at, height, bodyStart });
  }
  written(card) {
    const { words, stacks } = cardStacks(card.words, address => (messageOf(address) ? stackLine(address) : null)), shown = cardImages(words);
    return { words: shown.words, stacks, images: shown.images.map(image => image.line) };
  }
  // What a card box makes of the card (boxText in deck.mjs).
  boxText(editing) { return boxText({ written: editing.field.value, images: editing.images, stacks: editing.stacks, fresh: editing.fresh }); }
  // Whether a card box changes its card: its words, or the images kept with it.
  boxChanged(editing) { return editing.field.value !== (editing.shown ?? editing.text) || (editing.images ?? []).join('\n') !== (editing.kept ?? ''); }
  // A card box left open when the page was let go (another page opened, a move, a reload), opened again: on the
  // card nearest where it stood whose words are what was written, the cursor where it was. False when no card is.
  reopen({ value, near, selection } = {}) {
    if (this.editing || this.asking || this.readOnly || typeof value !== 'string' || !Number.isInteger(near)) return false;
    const same = text => cardText(textCard(text)), wanted = same(value), cards = this.deck.cards;
    const order = cards.map((_, i) => i).sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
    const at = order.find(i => same(cardText({ title: cards[i].title, words: this.written(cards[i]).words })) === wanted);
    if (at === undefined) return false;
    this.reveal(at); this.pick(at); this.edit();
    const field = this.editing?.field;
    if (field && Array.isArray(selection)) field.setSelectionRange(...selection.map(n => Math.min(Number(n) || 0, field.value.length)));
    return Boolean(field);
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
    const putBack = !this.keyed ? this.holdPage() : () => {};
    if (this.editing) this.finish();
    this.selected = new Set(); this.anchor = null;
    const field = this.node('textarea', 'deck-editor');
    field.rows = 1;
    field.setAttribute('autocomplete', 'off');
    field.value = editing.shown ?? editing.text;
    if (editing.bodyStart != null) field.style.setProperty('--body-start', `${editing.bodyStart}px`);
    field.setAttribute('aria-labelledby', 'deck-editor-label');
    field.addEventListener('input', () => this.fit(field));
    this.editing = { ...editing, field, input: new WritingInput({ field }) };
    // A key that opens the card brings it into view once the box has the height it keeps, not before (paint).
    const keyed = this.keyed;
    this.keyed = false;
    this.paint();
    this.keyed = keyed;
    // On a laptop the box keeps the height its card showed at, less the room around it, and grows only when what is
    // written needs more, so the text stays where it stood (aim.css reads --kept at every width).
    if (editing.height) {
      const holder = field.closest('li'), images = holder.querySelector(':scope > .deck-images');
      const around = holder.getBoundingClientRect().height - field.getBoundingClientRect().height - (images?.getBoundingClientRect().height ?? 0);
      field.style.setProperty('--kept', `${Math.max(0, editing.height - around)}px`);
      this.fit(field);
    }
    const at = Math.min(editing.at ?? field.value.length, field.value.length);
    field.setSelectionRange(at, at);
    if (keyed) revealSelection(field.closest('li'));
    putBack();
  }
  // Tab, ⇧Tab, ⌘↑ or ⌘↓ while a card is written: the card moves by the rules of a picked card, and is saved there,
  // while the writing and the cursor stay as they were; the writing is saved when the card is finished. A new card
  // not yet made only changes where it will go.
  moveWriting(act) {
    const editing = this.editing;
    if (!editing.fresh) { this.act({ ...act, text: editing.text, near: editing.near }); return; }
    const placed = placeNew(this.deck, editing, act);
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
  // ⌘Return while a card is written: the card is finished, and a new card opens for writing beside it, below it and
  // its children, at its depth. A box with nothing written in it is only finished (a new card with nothing written is
  // not made, a card cleared goes with its children), so ⌘Return on an empty new card never makes another.
  writeNext() {
    const editing = this.editing;
    if (!/\S/.test(this.boxText(editing))) { this.finish(); return; }
    if (!editing.fresh) { const at = findCard(this.deck, editing.text, editing.near); if (at >= 0) this.picked = at; }
    this.finish();
    if (!this.editing) this.start();
  }
  // ← at the very start of a card being written that has children: the card is finished and shows, picked, with
  // its children folded away. False on a card with none (a new card, or one cleared of its text), where ← is the box's.
  foldWriting() {
    const editing = this.editing;
    if (editing.fresh || !cardText(textCard(editing.field.value))) return false;
    const at = findCard(this.deck, editing.text, editing.near);
    if (at < 0 || groupEnd(this.deck.cards, at) === at + 1) return false;
    this.picked = at;
    this.finish();
    const i = this.picked, card = this.deck.cards[i];
    if (card && groupEnd(this.deck.cards, i) > i + 1 && !this.folded.has(card.title)) this.fold(i);
    return true;
  }
  // Escape, ⌘Return or Done: what was written becomes the card; a new card with nothing written is not made.
  finish() {
    const editing = this.editing;
    if (!editing) return;
    // Finishing writing is not navigation. Subsequent move/new-card acts keep their own key.
    const keyed = this.keyed, putBack = this.holdPage();
    this.keyed = false;
    this.editing = null;
    const to = this.boxText(editing);
    let made = false;
    if (editing.fresh) made = this.act({ kind: 'add', after: editing.after, text: to, depth: editing.depth, near: editing.near });
    else if (this.boxChanged(editing)) {
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
    putBack(); this.keyed = keyed;
  }
  // A card's speech bubbles: one for each of its reply stacks, which opens it, saying Sent until its first reply
  // and then counting them, and marked only while one waits unread; or, on a card with none, one that asks an
  // agent about it. A stack begun before the messages read says nothing. A draft page asks nothing: its words
  // are kept from agents until its mark is cleared (docs/notebook-pages.md, "A draft page").
  bubbles(index, stacks) {
    const holder = this.node('div', 'deck-bubbles');
    for (const { topicId, messageId } of stacks) {
      const talk = this.talks.get(messageId), link = this.node('a', 'deck-bubble'), words = !talk ? null : talk.replies ? String(talk.replies) : 'Sent';
      link.append(mark(this.doc, BALLOON), ...(words ? [this.node('span', '', words)] : []));
      link.href = routeHref({ kind: 'topic', id: topicId, message: messageId });
      link.tabIndex = -1;
      link.setAttribute('aria-label', !talk ? 'Reply stack' : talk.replies ? `Reply stack: ${talk.replies === 1 ? '1 reply' : `${talk.replies} replies`}${talk.unread ? `, ${talk.unread} not read` : ''}` : 'Reply stack: asked, no reply yet');
      link.title = link.getAttribute('aria-label');
      link.classList.toggle('deck-unread', Boolean(talk?.unread));
      link.addEventListener('click', event => event.stopPropagation());
      holder.append(link);
    }
    if (!stacks.length && this.room?.agents.length && !this.readOnly && !this.drafted()) {
      const ask = this.node('button', 'deck-bubble deck-ask');
      ask.append(mark(this.doc, BALLOON));
      ask.type = 'button';
      ask.tabIndex = -1;
      ask.setAttribute('aria-label', 'Ask an agent about this card');
      ask.title = 'Ask an agent about this card';
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
    if (!card || !this.room?.agents.length || this.readOnly || this.asking || this.drafted()) return;
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
      // Notebook page, with the line naming this stack kept under it. Its images are quoted by name, as words.
      const card = textCard(asking.text), quoted = [`**${card.title || 'Untitled'}**`, ...imageStandIns(cardStacks(card.words, messageOf).words).split('\n')];
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
      formatWords(this.node('div', 'deck-words'), cardImages(cardStacks(card.words, messageOf).words).words, { copyFences: true }), asking.form);
    return row;
  }

  // A card's images, under its words: each one of the page's attachments, drawn by picture() (NotebookPage), or its
  // name. In a card box each keeps the height it showed at on the card, and has × to take it out of the card.
  pictures(images, editing = null) {
    const holder = this.node('div', 'deck-images');
    for (const image of images) {
      const figure = this.node('figure', 'deck-image');
      figure.dataset.cardImage = image.line;
      const at = editing?.shownAt?.get(image.line);
      if (at) figure.style.minHeight = `${at}px`;
      this.picture(figure, image);
      if (editing) {
        const remove = this.node('button', 'deck-image-remove', '×'), words = `Remove the image ${image.name || 'Image'} from this card`;
        remove.type = 'button'; remove.title = words; remove.setAttribute('aria-label', words);
        remove.addEventListener('mousedown', event => event.preventDefault());
        remove.addEventListener('click', event => { event.stopPropagation(); this.unpicture(editing, image); });
        figure.append(remove);
      }
      holder.append(figure);
    }
    return holder;
  }
  picture(figure, image) { if (!figure.querySelector(':scope > .deck-image-name')) figure.prepend(this.node('figcaption', 'deck-image-name', image.name || 'Image')); }
  // × on an image in a card box: the image leaves the card; the box keeps the focus.
  unpicture(editing, image) {
    if (this.editing !== editing || this.readOnly) return;
    editing.images = editing.images.filter(line => line !== image.line);
    this.paint();
    editing.field.focus({ preventScroll: true });
  }

  // A box takes a height of its own only when what is written needs more than it has: scrollHeight counts whole
  // pixels, so a box fitted to it would stand up to a pixel off its card's height.
  fit(field) {
    field.style.height = 'auto';
    if (field.scrollHeight > field.clientHeight) field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  }

  // A redraw can temporarily shrink the page or give WebKit a new caret. Keep
  // every vertical scroll owner, including a sheet and the document, in place.
  holdPage() {
    const places = [];
    for (let node = this.host; node; node = node.parentElement) places.push([node, node.scrollTop]);
    return () => { for (const [node, top] of places) if (node.scrollTop !== top) node.scrollTop = top; };
  }

  paint() {
    if (deferFencePaint(this.host, () => this.paint())) return;
    const putBack = !this.keyed ? this.holdPage() : () => {};
    const { cards, opening } = this.deck, editing = this.editing, asking = this.asking;
    this.opening.hidden = !/\S/.test(opening);
    if (!this.opening.hidden) formatWords(this.opening, opening.trim(), { copyFences: true });
    // A card under a folded one is drawn hidden, so the rows stand where their cards do.
    const { shown, parents } = this.layout();
    while (!shown[this.picked] && parents[this.picked] >= 0) this.picked = parents[this.picked];
    const rows = cards.map((card, index) => {
      const row = this.node('li', 'deck-card'), { words: all, stacks } = cardStacks(card.words, messageOf), { words, images } = cardImages(all);
      const title = this.node('h3', card.title ? 'deck-title' : 'deck-title muted', card.title || 'Untitled');
      if (groupEnd(cards, index) > index + 1) title.prepend(this.foldButton(index));
      row.dataset.index = String(index);
      row.hidden = !shown[index];
      row.style.setProperty('--depth', String(card.depth));
      if (parents[index] >= 0) row.append(this.node('p', 'deck-under muted', cards[parents[index]].title || 'Untitled'));
      const shownWords = formatWords(this.node('div', 'deck-words'), words, { copyFences: true });
      row.append(title, shownWords, ...(images.length ? [this.pictures(images)] : []), this.bubbles(index, stacks));
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
    // The box takes the focus as it opens, and back from the redraw where it or the cards had it, its cursor where it
    // was; never from wherever else the person has put it, a press outside the sheet among them (WebKit gives a box
    // the focus as its cursor is set, so the cursor is left as the move kept it). Read before the box moves.
    const refocus = editing && (!editing.field.isConnected || this.list.contains(this.doc.activeElement));
    if (editing) {
      const holder = this.node('li', 'deck-card deck-writing');
      const at = editing.fresh ? (editing.after === null ? 0 : findCard(this.deck, editing.after, editing.near) + 1) : findCard(this.deck, editing.text, editing.near);
      // The box stands in its card's place at its card's depth, wherever an act or a read of the page has put it.
      if (!editing.fresh && at >= 0) Object.assign(editing, { near: at, depth: cards[at].depth });
      holder.style.setProperty('--depth', String(editing.depth ?? 0));
      // Replacing a card with its shared editor must not shorten the document under it.
      if (editing.height) holder.style.minHeight = `${editing.height}px`;
      // A card with children keeps its chevron, laid out in a line of the title's own, so it stands where it showed
      // and the title starts after it; a card with words keeps them on the lines they showed on. A press around the
      // box leaves the writing its focus.
      const parent = !editing.fresh && at >= 0 && groupEnd(cards, at) > at + 1;
      holder.classList.toggle('deck-parent', parent);
      holder.classList.toggle('deck-worded', !editing.fresh && at >= 0 && Boolean(cardImages(cardStacks(cards[at].words, messageOf).words).words));
      const chevron = parent ? this.node('span', 'deck-title deck-chevron') : null;
      if (chevron) { chevron.append(this.foldButton(at)); holder.append(chevron); }
      holder.append(editing.field);
      if (editing.images?.length) holder.append(this.pictures(editing.images.map(line => cardImages(line).images[0]), editing));
      holder.addEventListener('mousedown', event => { if (event.target === holder) event.preventDefault(); });
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
    this.keyLines.forEach((line, i) => { line.style.visibility = i === (asking ? 2 : editing ? 1 : 0) ? '' : 'hidden'; });
    this.editButton.textContent = editing ? 'Done' : 'Edit';
    this.mark();
    if (editing) {
      if (refocus) {
        editing.field.focus({ preventScroll: true });
        if (selection) editing.field.setSelectionRange(...selection);
      }
      this.fit(editing.field);
      // The card being written, moved by a key on a laptop, keeps that room too (open() reveals a card a key opens).
      if (this.keyed) revealSelection(editing.field.closest('li'));
      // Pointer opening and ordinary redraws hold their place; they reveal no card.
    } else if (asking && asking.form.contains(focused)) {
      focused.focus({ preventScroll: true });
      if (focused === asking.field) asking.field.setSelectionRange(...asked);
      this.fit(asking.field);
    } else if (!asking) this.show(this.list.contains(this.doc.activeElement) || this.doc.activeElement === this.doc.body);
    putBack();
  }
}
