// What a person does to reply stacks on a topic page or a Conversation
// (docs/reply-stacks.md), and the keys and menu items that do it: star a
// message, fold a message to one line and unfold it, rename a stack, move it,
// join it to its neighbour and split it back out, fold and open it, and put
// the last of those back with ⌘Z.
//
// A star, a folded message, a stack's place and a stack dealt with are the
// reader's own; a stack's short name and its joins are everyone's in the
// topic. Each is a new record about a message, a Core command fenced on the
// revision the page last read (aim_next/stacks.py); the page shows the act at
// once and sends the acts one after another, so a quick run of presses each
// sends the revision the one before it made. What Core holds stays the message's acts (topic-views.mjs);
// an act not yet answered is drawn over them until its answer lands, and the
// stacks are drawn again whenever an answer changes what they show. How far a
// stack is folded is the page's own; a message folded to its row is the
// reader's, on every device, until they unfold it.
import { cardIn } from './fold.mjs';
import { arrangeStacks, entries, entryOf, stackOf, stackState, setLevel, levelOf, reveal, renameInput, shownSelected, unkeep, shownView, drawn } from './reply-stacks.mjs';
import { moveOf, joinShown, foldStep, laterActs, positionOf, sideOf } from './stack-order.mjs';
import { keyAction } from './pane-keys.mjs';
import { messagePreview } from './message-preview.mjs';
import { revealSelection } from './reveal.mjs';
import { mayThumb, thumbed, reactionsOf } from './reactions.mjs';
import { contact, heard, notTaken, NOT_TAKEN } from './api.mjs';

const FIELD = { 'stack.aside': 'aside', 'message.star': 'star', 'message.deal': 'deal', 'message.fold': 'fold', 'message.fold_through': 'fold', 'stack.place': 'place', 'stack.name': 'name', 'stack.join': 'join' };
const FEED_ACTIONS = ['move-up', 'move-down', 'right', 'left', 'join-up', 'join-down', 'undo', 'fold-message'];

// Whether a touch began on something between it and the list that scrolls
// sideways (a wide table, a block of code): a sideways drag there scrolls it.
// A long message scrolling up and down in its card is not (item 381), nor is
// a box a rounding pixel or two wider than it shows.
const SIDEWAYS_SLACK = 2;
function scrollsSideways(target, list) {
  for (let at = target; at && at !== list; at = at.parentElement) {
    if (at.scrollWidth - at.clientWidth > SIDEWAYS_SLACK && /^(auto|scroll)$/.test(at.ownerDocument.defaultView.getComputedStyle(at).overflowX)) return true;
  }
  return false;
}

// A trackpad's two-finger swipe reaches the page as wheel events. One swipe
// is a run of them less than SWIPE_GAP ms apart by the events' own times; it
// acts once it has gone SWIPE_ACROSS pixels across, and further across than
// down.
const SWIPE_GAP = 250, SWIPE_ACROSS = 80;
// Whether a swipe that went across (its summed deltaX) folds the message, or
// unfolds it. With macOS's natural scrolling, the default, fingers moving
// right scroll the content left, a negative deltaX: swiped right folds, as a
// finger's swipe right does on a phone. With natural scrolling off the two
// ways change places.
const swipeFolds = across => across < 0;

// The acts a commit's result says, as the message's acts read.
function learned(kind, result, viewer, now) {
  const field = FIELD[kind], revision = { [`${field}_revision`]: result[`${field}_revision`] };
  if (kind === 'stack.aside') return { aside: result.through, ...revision };
  if (kind === 'message.star') return { starred: result.starred, ...revision };
  if (kind === 'message.deal') return { dealt: result.dealt, ...revision };
  if (kind === 'message.fold' || kind === 'message.fold_through') return { folded: result.folded, ...revision };
  if (kind === 'stack.place') return { placed: result.key, ...revision };
  if (kind === 'stack.name') return { name: result.name ? { text: result.name, by: viewer, at_ms: now } : null, ...revision };
  return { joined: result.into ? { into: result.into, by: viewer, at_ms: now } : null, ...revision };
}
// An act's words in a notice, with the card it names: "folding “The latest
// reply…”". The card is named by its one line (messagePreview), cut short to fit
// the rail.
const CARD_WORDS = 40;
const DOING = {
  'stack.aside': args => args.through === null ? 'bringing back' : 'moving below More',
  'message.star': args => args.starred ? 'starring' : 'unstarring',
  'message.deal': () => 'marking as dealt with',
  'message.fold': args => args.folded ? 'folding' : 'unfolding',
  // Option's fold (item 472): the message and every one before it in its dossier.
  'message.fold_through': () => 'folding every message up to',
  'stack.place': args => args.key === null ? 'letting new replies move' : 'moving',
  'stack.name': args => args.name ? 'renaming' : 'naming by its first line',
  'stack.join': args => args.into ? 'joining' : 'splitting out',
  'message.thumb': args => args.thumbed ? 'the thumbs-up on' : 'taking back the thumbs-up on',
  'message.answer': args => args.answer === 'yes' ? 'answering Go ahead to' : 'answering Don’t to',
  'message.mark': args => args.marked ? 'marking unread' : 'marking read',
};
function doing(kind, item, args) {
  const line = messagePreview(item), short = line.length > CARD_WORDS ? `${line.slice(0, CARD_WORDS - 1).trimEnd()}…` : line;
  return `${DOING[kind](args)} ${!short ? 'a message' : short.startsWith('“') ? short : `“${short}”`}`;
}
const upper = words => words[0].toUpperCase() + words.slice(1);
// The page's own acts, made for the person rather than by them (a stack dealt
// with as their reply arrives): settled as every act is, without a word.
const QUIET = new Set(['message.deal']);
// An act that did not commit: the attempt's own failure (error) when Core sent
// no receipt, else Core's receipt.
class ActFailure extends Error {
  constructor(envelope, { error = null, receipt = null }) {
    super('An act did not commit.', { cause: error ?? receipt });
    Object.assign(this, { envelope, error, receipt });
  }
}
// Why an act is not settled, so it is kept and sent again as it was made, under
// its own operation, once Theseus has answered since: no word on whether Core
// recorded it (api.mjs notTaken: unreached or unconfirmed), or an answer that
// Core took nothing yet (a busy lane, a session the server refused as a
// restarted one does, a receipt to try again). Core answers the same operation
// with what it recorded, or records it then (aim_next/store.py, its
// operations). Null for an answer that settles it: a refusal, said as one.
function waiting(failure) {
  const { kind } = notTaken(failure);
  return kind in WAITING ? kind : null;
}
const WAITING = {
  unreached: what => `Not known yet whether ${what} was saved: the connection was interrupted. The page asks Theseus again.`,
  unconfirmed: what => `Not known yet whether ${what} was saved: Theseus could not confirm it. The page asks again.`,
  busy: what => `${upper(what)} is not saved yet: Theseus was busy. The page sends it again.`,
  restarted: what => `${upper(what)} is not saved yet: Theseus restarted. The page sends it again.`,
};
// An answer that settles an act, in words of the act's own (notTaken's kind and
// why): what Core holds stands, and the card shows it. again: what the person
// does to make it once more, for an act the page does not send again itself.
function notSaved(what, { kind, why }, again = '') {
  if (kind === 'refused') return `${upper(what)} was not saved${why ? `: ${why}` : ''}. The card shows what Theseus holds.`;
  if (kind === 'conflict') return `${upper(what)} was not saved: ${NOT_TAKEN.conflict}. The card shows what Theseus holds.`;
  if (kind === 'unconfirmed') return `Not known whether ${what} was saved: ${NOT_TAKEN.unconfirmed}. ${again}`;
  return `${upper(what)} was not saved: ${NOT_TAKEN[kind]}. ${again}`;
}
// What the person does to make once more a card command the page does not send again itself.
const AGAIN = { 'message.thumb': 'Press again: Core keeps one of each.', 'message.answer': 'Press again: Core keeps one of each.', 'message.mark': 'Choose it again to send the same request.' };
// What an act shows at once, before Core answers.
function shownAct(kind, args, viewer, now) {
  if (kind === 'stack.aside') return { aside: args.through };
  if (kind === 'message.star') return { starred: args.starred };
  if (kind === 'message.deal') return { dealt: args.dealt };
  if (kind === 'message.fold') return { folded: args.folded };
  if (kind === 'message.fold_through') return {};
  if (kind === 'stack.place') return { placed: args.key };
  if (kind === 'stack.name') return { name: args.name ? { text: args.name, by: viewer, at_ms: now } : null };
  return { joined: args.into ? { into: args.into, by: viewer, at_ms: now } : null };
}

export class StackFeed {
  // list: #messages. messages(): the loaded messages by id. keep, unread,
  // nameOf: as arrangeStacks takes them. send(envelope): Core's command.
  // reread(): reads the acts again from Core, after a refusal. starsChanged():
  // the reader's stars moved (the right rail's Starred). status(words): says
  // what became of an act; line(): the element it says it in.
  // hold(paint): repaints keeping the page where the person is. press: the
  // press held down on the page (press-hold.mjs).
  // thumb(item, on): the message's thumbs-up, as its bar's 👍 gives it (a folded row's 👍).
  // redrawn(): the stacks were drawn again, so what else shows a message's acts (the Reader's star) follows.
  // home: the page's New message composer at rest, drawn just above More (arrangeStacks); put back after
  // being up over the page, it goes to that place at once.
  constructor({ list, messages, viewer, instanceId, authority, send, keep, unread, nameOf, quiet = () => false, filterHost = null, reread = () => {}, starsChanged = () => {}, status = () => {}, line = () => null,
    refreshPositions = async () => {}, moreChanged = () => {}, arranged = () => {}, hold = paint => paint(), press, thumb = null, redrawn = () => {}, home = null, clock = () => Date.now(), doc = document }) {
    Object.assign(this, { list, messages, viewer, instanceId, authority, commandOf: send, keep, unread, nameOf, quiet, filterHost, reread, starsChanged, status, line, refreshPositions, moreChanged, arranged, hold, press, thumb, redrawn, home, clock, doc });
    home?.addEventListener('close', () => this.arrange());
    this.undos = []; this.chain = Promise.resolve(); this.newestSeen = null;
    // A stand-in for each message the page has not loaded that an act is on (a
    // dossier's root, a message Option's fold folded), kept so each act on it
    // learns the revision the act before it left, as a loaded message does.
    this.standIns = new Map();
    // The acts shown and not yet answered, by message, in the order made; and
    // the acts each message was last drawn with.
    this.pending = new Map(); this.drawn = new Map();
    // The acts not settled, by operation, each kept with its exact request
    // until Core answers it (waiting); and what the page says of each act not
    // settled or refused, by operation (or, for a card command it does not
    // send again, by command and message), in the order said.
    this.doubts = new Map(); this.notices = new Map(); this.noticeShown = ''; this.unheard = null;
    // How many reads of what shows the cards have begun, and answers said, in the order they were (answered, reading).
    this.reads = 0;
    this.listen();
    this.said = doc.createElement('div');
    this.said.className = 'sr-only'; this.said.setAttribute('aria-live', 'polite'); this.said.id = 'stack-said';
    doc.body.append(this.said);
    // Take a stack step before the document's pane navigation sees the key.
    // At either end the event bubbles untouched, so the next press leaves.
    list.addEventListener('keydown', event => this.key(event));
    // A message swiped to the right on a phone folds to its row, and its row
    // swiped to the left unfolds it; a drag on something that scrolls
    // sideways scrolls it instead.
    list.addEventListener('touchstart', event => {
      const touch = event.touches?.[0];
      this.swipe = touch && !scrollsSideways(event.target, list) ? { x: touch.clientX, y: touch.clientY, target: event.target } : null;
    }, { passive: true });
    list.addEventListener('touchend', event => this.swiped(event), { passive: true });
    // Two fingers across a laptop's trackpad do the same. Not passive: while a
    // swipe over a message goes across, the page keeps it from the browser,
    // which would otherwise go back or forward a page.
    list.addEventListener('wheel', event => this.wheeled(event), { passive: false });
  }
  get state() { return stackState(this.list); }
  // A message's acts as the page shows them: what Core holds, with each act
  // not yet answered over it. known: the message when the page has not loaded it.
  actsOf(id, known = null) {
    let acts = (this.messages().get(id) ?? known)?.acts ?? {};
    for (const shown of this.pending.get(id) ?? []) acts = { ...acts, ...shown };
    return acts;
  }
  // The loaded messages as the stacks draw them, each with its acts as shown.
  shownMessages() {
    const messages = this.messages();
    return { has: id => messages.has(id), get: id => {
      const item = messages.get(id);
      if (!item) return item;
      const acts = this.actsOf(id);
      this.drawn.set(id, JSON.stringify(acts));
      let stack_position = item.stack_position;
      for (const pending of this.pending.get(stack_position?.root_id) ?? []) {
        if ('aside' in pending) stack_position = { ...stack_position, through: pending.aside, below: pending.aside !== null };
        if ('name' in pending) stack_position = { ...stack_position, name: pending.name };
      }
      return this.pending.has(id) || stack_position !== item.stack_position ? { ...item, acts, stack_position } : item;
    } };
  }
  arrange() {
    this.hold(() => arrangeStacks(this.list, this.shownMessages(), { keep: this.keep, unread: this.unread, quiet: this.quiet, viewer: this.viewer, nameOf: this.nameOf, home: this.home, doc: this.doc, on: {
      more: () => this.moreChanged(), rename: stack => this.startRename(stack), renamed: (stack, text, how) => this.rename(stack, text, how), cancelled: stack => { this.arrange(); this.focusOn(stack.id); },
      coordinationCount: count => this.paintCoordination(count), coordinationShown: () => this.paintCoordination(),
      split: item => this.split(item), unplace: stack => this.unplace(stack), unfold: id => this.unfoldId(id), fold: id => this.foldId(id),
      folded: (stack, was) => this.remember(() => { setLevel(this.state, stack, was); this.arrange(); }),
      earlier: (stack, count) => this.say(`${count === 1 ? 'The earlier message shows' : `${count} earlier messages show`} as rows, for this visit`),
      arranged: () => this.arranged(),
    } }));
    for (const entry of entries(this.list)) {
      const card = cardIn(entry), item = this.messages().get(card.dataset.id);
      if (item) { this.paintStar(card.querySelector(':scope > .message-author'), item); this.paintFoldedThumb(card, item); }
    }
    this.redrawn();
    this.moreChanged();
  }
  // A 👍 on a folded message's row (item 390), before "Folded": the same
  // thumbs-up as the bar's 👍, pressed once given, with the count once anyone
  // has. A press gives or takes it back and unfolds nothing. It is a part of
  // the card (a button), answering its own press and keys, as the reply arrow is.
  // None on the reader's own message, which takes no thumbs-up from them. In a
  // dossier it shows only once someone has given one (item 471; data-count,
  // stack-look.css).
  paintFoldedThumb(card, item) {
    const row = card.querySelector(':scope > .message-folded');
    let button = row?.querySelector(':scope > .folded-thumb') ?? null;
    if (!row || !this.thumb || !mayThumb(item, this.viewer)) { button?.remove(); return; }
    if (!button) {
      button = this.doc.createElement('span'); button.className = 'folded-thumb'; button.setAttribute('role', 'button'); button.tabIndex = -1;
      const press = () => { const shown = this.cardItem(button); if (shown) this.thumb(shown, !thumbed(shown, this.viewer)); };
      button.onclick = event => { event.stopPropagation(); press(); };
      button.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); press(); } };
      row.insertBefore(button, row.querySelector(':scope > .folded-cue'));
    }
    const on = thumbed(item, this.viewer), count = reactionsOf(item).thumbs.length, words = on ? 'Remove thumbs up' : 'Thumbs up';
    const shown = count ? `👍 ${count}` : '👍';
    if (button.textContent !== shown) button.textContent = shown;
    button.setAttribute('aria-pressed', String(on)); button.setAttribute('aria-label', count ? `${words} (${count})` : words); button.title = words;
    button.dataset.count = String(count);
  }
  // The message a control in a card acts on: its card's. Only the card names
  // its message (data-id), so what finds a message's card finds that alone.
  cardItem(control) { return this.messages().get(control.closest('.message-card')?.dataset.id) ?? null; }
  // The star in a message's header (item 376), right after who wrote it and
  // when: the same act as Star for me in ⋯. Outline, it shows while the
  // message is lit (under the pointer, chosen by the keys, or tapped) or has
  // the focus; filled, on a message the reader starred, always (stack-look.css).
  // The card is a button, so the star is a part of it, as the reply arrow is
  // (card-reading.mjs): it answers its own press and keys, and the bar's Tab
  // reaches it first (message-menu.mjs). Kept where it is when the line is
  // painted again (author: the card's author line).
  paintStar(author, item) {
    if (!author) return;
    let star = author.querySelector(':scope > .card-star');
    if (!star) {
      star = this.doc.createElement('span'); star.className = 'card-star'; star.setAttribute('role', 'button'); star.tabIndex = -1;
      const press = () => { const shown = this.cardItem(star); if (shown) this.star(shown); };
      star.onclick = event => { event.stopPropagation(); press(); };
      star.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); press(); } };
      author.insertBefore(star, author.querySelector(':scope > .replied-mark'));
    }
    const starred = Boolean(this.actsOf(item.id, item).starred), words = starred ? 'Unstar' : 'Star for me';
    if (star.textContent !== (starred ? '★' : '☆')) star.textContent = starred ? '★' : '☆';
    star.setAttribute('aria-pressed', String(starred)); star.setAttribute('aria-label', words); star.title = words;
  }
  paintCoordination(count = this.coordinationCount ?? 0) {
    this.coordinationCount = count;
    if (!this.filterHost) return;
    let button = this.filterHost.querySelector('button');
    if (!button) {
      button = this.doc.createElement('button'); button.type = 'button'; button.className = 'filter-chip';
      this.filterHost.append(button);
      button.onclick = () => { this.state.showCoordination = !this.state.showCoordination; this.arrange(); };
    }
    button.textContent = `Show agent coordination (${count})`;
    button.setAttribute('aria-pressed', String(this.state.showCoordination));
    this.filterHost.hidden = count === 0 && this.state.showCoordination;
  }
  // Says what just happened, for a screen reader.
  say(words) { this.said.textContent = ''; this.said.textContent = words; }
  remember(undo) { this.undos.push(undo); if (this.undos.length > 50) this.undos.shift(); }
  undo() {
    const last = this.undos.pop();
    if (!last) { this.say('Nothing to put back'); return; }
    last(); this.say('Put back');
  }
  // Shows an act on the message at once and sends it after the acts before it.
  // Answered, refused or not settled, it is no longer drawn over what Core
  // holds: one not settled shows once Core says it is recorded. also: what
  // else it shows at once, as [message id, acts] (Option's fold, on several).
  act(kind, item, args, also = []) {
    const shown = shownAct(kind, args, this.viewer, this.clock());
    const shows = [[item.id, shown], ...also];
    for (const [id, mark] of shows) this.pending.set(id, [...this.pending.get(id) ?? [], mark]);
    const sent = this.chain.then(() => this.send(kind, item, args)).finally(() => {
      for (const [id, mark] of shows) {
        const left = (this.pending.get(id) ?? []).filter(each => each !== mark);
        if (left.length) this.pending.set(id, left); else this.pending.delete(id);
      }
      for (const [id] of also) this.settled(id);
      this.settled(item.id);
    });
    this.chain = sent.catch(() => {});
    sent.catch(error => this.failed({ kind, item, args }, error, true));
    return sent;
  }
  // An act that did not commit (docs/reply-stacks.md, "When an answer is lost").
  // One not settled is kept and said as such, by its act and its card, until
  // Core answers it. The acts are read again the first time, so the card shows
  // what Core holds meanwhile, and again each time no answer came at all: that
  // read is the answer the act waits for, paced as the page's reads are when
  // they fail. A busy or unconfirmed answer waits for Theseus to answer
  // something else. A refusal is said until that read shows the card (answered).
  // A failure after Core recorded the act (reading positions) says itself.
  failed(act, error, first) {
    if (!(error instanceof ActFailure)) { this.paintNotice(); this.status(error); this.reread(); return; }
    const op = error.envelope.operation_id, what = doing(act.kind, act.item, act.args), why = waiting(error);
    this.notices.delete(op);
    if (why) {
      this.doubts.set(op, { ...act, envelope: error.envelope, after: contact.answered, out: false }); this.listen();
      if (!QUIET.has(act.kind)) this.notices.set(op, { words: WAITING[why](what) });
      this.paintNotice();
    } else if (!QUIET.has(act.kind)) this.answered(op, notSaved(what, notTaken(error)), 'acts');
    if (first || !why || why === 'unreached') this.reread();
  }
  // Each act not settled goes again, as it was made, once Theseus has answered
  // anything since it failed: at the next answer, never on a timer, so an act
  // that fails again waits for a newer answer. Whatever comes of the ask, what
  // was said of the act goes with it, and only a failure that leaves it not
  // settled, or refused, says it again (failed).
  askAgain() {
    for (const [op, doubt] of this.doubts) {
      if (doubt.out || !(contact.answered > doubt.after)) continue;
      doubt.out = true;
      const sent = this.chain.then(() => this.send(doubt.kind, doubt.item, doubt.args, doubt.envelope));
      this.chain = sent.catch(() => {});
      const over = () => { this.doubts.delete(op); this.notices.delete(op); };
      sent.then(() => { over(); this.paintNotice(); }, error => { over(); this.failed(doubt, error, false); })
        .finally(() => { this.settled(doubt.item.id); if (this.gone && !this.doubts.size) this.deafen(); });
    }
  }
  // A card command the person makes again themselves (a 👍, a go-ahead answer,
  // a mark) that Theseus answered without taking it: said in words of its act
  // and card, as a refused act is. One that reached no Theseus is a connection
  // line instead (lines.mjs), which its maker says. shows: what shows the card
  // (reading).
  notTaken(kind, item, args, failure, shows) {
    this.answered(`${kind}:${item.id}`, notSaved(doing(kind, item, args), notTaken(failure), AGAIN[kind]), shows);
  }
  // An answer that settles an act, said until a read of what shows its card
  // (shows: 'acts', 'reaction:<message id>' or 'marks'), begun after it was
  // said, has landed: the card then shows what Theseus holds, and the words go
  // (item 547). A read that fails, or one begun before, ends nothing.
  answered(key, words, shows) {
    this.notices.set(key, { words, shows, at: ++this.reads });
    this.paintNotice();
  }
  // A read of what shows the cards (what) begins: the function it returns is
  // called once it has landed (topic-views.mjs, reactions.mjs, app.mjs marks).
  reading(what) {
    const began = ++this.reads;
    return () => {
      let over = false;
      for (const [key, notice] of this.notices) if (notice.shows === what && notice.at < began) { this.notices.delete(key); over = true; }
      if (over) this.paintNotice();
    };
  }
  // The page's status line says every act not settled and every refusal not
  // over; with none, a line still showing what it last said goes quiet, and one
  // something else has written since is left as it is.
  paintNotice() {
    const words = [...this.notices.values()].map(notice => notice.words).join(' ');
    if (words) { if (words !== this.noticeShown || this.line()?.textContent !== words) this.status(words); this.noticeShown = words; return; }
    if (this.noticeShown && this.line()?.textContent === this.noticeShown) this.status('');
    this.noticeShown = '';
  }
  // The page goes (unloaded, or a move in place ended its run): an act not
  // settled still goes again as Theseus answers, so it is made once whatever
  // the reader does next, and what it says lands on the page it left
  // (app.mjs, retired elements). Once none is left, it listens no more.
  dispose() { this.gone = true; if (!this.doubts.size) this.deafen(); }
  // Hearing each time Theseus answers anything (api.mjs heard), at most once.
  listen() { this.unheard ??= heard(() => this.askAgain()); }
  deafen() { this.unheard?.(); this.unheard = null; }
  // Draws the stacks again when a message's acts as shown are no longer what
  // they were last drawn with, or when an act on a dossier's unloaded root
  // settles, as its loaded replies show where it is; an answer landing under a
  // press held down waits for it to end, so nothing moves under the pointer.
  // One the page has not loaded (the Reader's, opened alone) is shown too by
  // what else shows its acts.
  settled(id) {
    if (!this.messages().has(id)) this.redrawn();
    const changed = this.messages().has(id) ? this.drawn.get(id) !== JSON.stringify(this.actsOf(id)) : this.standIns.has(id);
    if (changed) this.press.after('stacks', () => this.arrange());
  }
  // Sends an act, or sends again the exact request of one not settled (made).
  async send(kind, item, args, made = null) {
    const field = FIELD[kind];
    const current = this.messages().get(item.id) ?? item;
    const envelope = made ?? (({ authority_id, authority_epoch }) => ({ v: 1, instance_id: this.instanceId, operation_id: crypto.randomUUID(), kind, target: { message_id: item.id },
      expected: { [`${field}_revision`]: current.acts?.[`${field}_revision`] ?? 0, authority: { authority_id, authority_epoch } }, args }))(this.authority());
    let receipt;
    try { receipt = await this.commandOf(envelope); } catch (error) { throw new ActFailure(envelope, { error }); }
    if (receipt?.status !== 'committed') throw new ActFailure(envelope, { receipt });
    const answer = learned(kind, receipt.result, this.viewer, this.clock());
    // The answer goes to the message the page holds now as well: a read that landed while the act was out (a
    // 👍's reactions, a page of messages) can have put a new copy of it in the page (item 433).
    for (const each of new Set([item, current, this.messages().get(item.id)])) if (each) each.acts = laterActs(each.acts, answer);
    // Option's fold says each message it folded: one the page holds, or a stand-in for one it has not loaded.
    if (kind === 'message.fold_through') for (const { message_id, fold_revision } of receipt.result.folds) {
      if (!this.messages().has(message_id) && !this.standIns.has(message_id)) this.standIns.set(message_id, { id: message_id, acts: {} });
      const known = this.messages().get(message_id) ?? this.standIns.get(message_id);
      known.acts = laterActs(known.acts, { folded: true, fold_revision });
    }
    if (kind === 'message.star') this.starsChanged();
    // What places a dossier and names it is read again after an act that changes them: a join or a split moves
    // messages to another dossier, whose positions they carry from then on (item 470).
    if (kind === 'stack.aside' || kind === 'stack.name' || kind === 'stack.join') await this.refreshPositions();
    return receipt.result;
  }
  // The message's entry, its stack and its card.
  entryFor(id) { return entries(this.list).find(entry => entry.dataset.id === id) ?? null; }
  // Puts the keys on a message, and scrolls it into view with room beyond it
  // (reveal.mjs). Where the page's one view does not draw it (drawn: its stack
  // folds it away, or Only new draws other messages of its stack), the keys go
  // to the first message of its stack the view draws, and nowhere when it draws
  // none (below a closed More). above: something over it to bring into view
  // with it where both fit (a join line).
  focusOn(id, { above = null } = {}) {
    const found = stackOf(this.list, this.entryFor(id));
    const target = [id, found?.stack.id, ...(found?.stack.replies ?? []).map(item => item.id)]
      .map(each => each && drawn(this.list, each) && this.entryFor(each)).find(Boolean);
    if (!target) return;
    const card = cardIn(target), stop = card.hidden ? target.querySelector?.('.fold-line') ?? card : card;
    stop.focus({ preventScroll: true });
    if (above) revealSelection(above);
    revealSelection(shownSelected(target));
  }
  // A star keeps a message in view: starring a folded message unfolds it too.
  star(item) {
    const on = !this.actsOf(item.id, item).starred;
    this.act('message.star', item, { starred: on });
    if (on && this.actsOf(item.id, item).folded) { this.state.peeked.delete(item.id); this.act('message.fold', item, { folded: false }); }
    this.arrange(); this.say(on ? 'Starred, for you only' : 'Star taken off');
  }
  // The right rail's Unstar, for a message here or in another place: one this
  // page shows takes the star off its card too.
  unstar(star) {
    const item = this.messages().get(star.message_id) ?? { id: star.message_id, acts: { starred: true, star_revision: star.star_revision } };
    if (!this.actsOf(item.id, item).starred) return;
    this.act('message.star', item, { starred: false });
    this.arrange(); this.say('Star taken off');
  }
  // A stack dealt with folds to its newest reply when the reader comes back.
  deal(item) {
    const found = stackOf(this.list, this.entryFor(item.id));
    if (!found || !found.stack.replies.length || this.actsOf(item.id).dealt) return;
    this.act('message.deal', item, { dealt: true });
  }
  // Messages arrived: the stacks are drawn with them in, then the reader's own
  // reply arriving in a stack deals with the stack up to it, as does their
  // thumbs-up on a reply (thumbed). The page's first messages are none of these.
  // Such a reply also stays in view beside what answers it (it is never
  // unread, so nothing else keeps it), from the first draw it is in, until a
  // change of the stack's state or coming back lets go of it.
  arrived(items) {
    const newest = items.reduce((most, item) => Math.max(most, item.seq), 0);
    const mine = this.newestSeen === null ? []
      : items.filter(item => item.seq > this.newestSeen && item.author_id === this.viewer && (item.reply_to || this.actsOf(item.id).joined));
    for (const item of mine) this.state.kept.add(item.id);
    this.arrange();
    this.newestSeen = Math.max(this.newestSeen ?? newest, newest);
    for (const item of mine) this.deal(item);
  }
  thumbed(item) { if (stackOf(this.list, this.entryFor(item.id))?.head === false) this.deal(item); }
  // Coming back to the page: what was kept in view only while in front of the
  // reader, and is not on screen now, folds as it now would.
  cameBack(onScreen) { unkeep(this.list, section => !onScreen(section)); }
  startRename(stack) {
    this.state.renaming = stack.id; this.arrange();
    const input = renameInput(this.list, stack.id);
    input?.focus(); input?.select?.();
  }
  // A name is the dossier's: it goes on its first message, loaded or not
  // (item 470), fenced on the name Core holds there. A page whose Core sends no
  // positions names the head it shows. edited: the person typed in the field;
  // one left untouched records nothing, so it never puts back a name another
  // gave the dossier while it was open. The first line shown stands without a
  // name only where it is the first message's.
  rename(stack, text, { edited = true } = {}) {
    const item = this.rootOf(stack)?.item ?? this.messages().get(stack.id) ?? stack.head, typed = this.actsOf(item.id, item).name?.text ?? '';
    // A name is one line, its spaces made single, as Core keeps it.
    const single = words => String(words ?? '').replace(/\s+/g, ' ').trim(), name = single(text);
    this.arrange();
    // Unchanged, or the line its head row shows (headOf's preview of the head,
    // messagePreview) where that head is the first message: nothing to record.
    if (!edited || name === typed || !typed && name === messagePreview(stack.head) && item.id === stack.head.id) { this.focusOn(stack.id); return; }
    this.act('stack.name', item, { name });
    this.remember(() => { this.act('stack.name', item, { name: typed }); this.arrange(); });
    this.arrange(); this.focusOn(stack.id);
    this.say(name ? `Renamed ${name}, for everyone here` : 'Named by its first line again, for everyone here');
  }
  // The stacks a move or a join of found's stack steps among: those shown on
  // its side of More messages (sideOf, shownView).
  sideOf(found) {
    return sideOf(this.state.stacks, found.index, shownView(this.state));
  }
  move(entry, way) {
    const found = stackOf(this.list, entry);
    if (!found) return;
    const side = this.sideOf(found), changes = moveOf(side.stacks, side.index, way);
    if (!changes) { this.say(way === 'up' ? 'Already at the top' : 'Already at the bottom'); return; }
    const heads = changes.map(change => this.messages().get(change.id));
    const before = heads.map(item => this.actsOf(item.id).placed ?? null);
    changes.forEach((change, index) => this.act('stack.place', heads[index], { key: change.key }));
    this.remember(() => { heads.forEach((item, index) => this.act('stack.place', item, { key: before[index] })); this.arrange(); this.focusOn(entry.dataset.id); });
    this.arrange(); this.focusOn(entry.dataset.id);
    this.say(`Moved ${way}, placed here by you`);
  }
  unplace(stack) {
    const item = this.messages().get(stack.id), before = this.actsOf(stack.id).placed ?? null;
    this.act('stack.place', item, { key: null });
    this.remember(() => { this.act('stack.place', item, { key: before }); this.arrange(); });
    this.arrange(); this.say('New replies move it again');
  }
  // A join from the keys, ⋯ or the phone's sheet shows where it went
  // (joinShown): the stack it goes into is drawn open, and the keys stay on the
  // message acted on, brought into view with its join line. ⌘Z puts back how
  // far that stack was folded too. A join from anyone else opens nothing.
  join(entry, way) {
    const found = stackOf(this.list, entry);
    if (!found) return;
    const side = this.sideOf(found), shows = joinShown(side.stacks, side.index, way, entry.dataset.id);
    if (!shows) { this.say(way === 'up' ? 'No stack above to join' : 'No stack below to join'); return; }
    const state = this.state, was = state.levels.get(shows.open);
    const item = this.messages().get(shows.act.id), before = this.actsOf(item.id).joined?.into ?? null;
    this.act('stack.join', item, { into: shows.act.into });
    this.remember(() => {
      this.act('stack.join', item, { into: before });
      if (was === undefined) state.levels.delete(shows.open); else state.levels.set(shows.open, was);
      this.arrange(); this.focusOn(item.id);
    });
    state.levels.set(shows.open, shows.level);
    this.arrange();
    this.focusOn(shows.select, { above: [...this.list.querySelectorAll('.stack-join-line')].find(line => line.dataset.join === item.id) });
    this.say(`Joined to the stack ${way === 'up' ? 'above' : 'below'}, for everyone here`);
  }
  split(shownItem) {
    const item = this.messages().get(shownItem.id) ?? shownItem, before = this.actsOf(item.id, item).joined?.into ?? null;
    if (!before) return;
    this.act('stack.join', item, { into: null });
    this.remember(() => { this.act('stack.join', item, { into: before }); this.arrange(); this.focusOn(item.id); });
    this.arrange(); this.focusOn(item.id);
    this.say('Split back out into its own stack, for everyone here');
  }
  // → and ← on a message: a step of its stack's fold. False at either end
  // lets the pane navigation take the same key to the adjacent siderail.
  fold(entry, way) {
    const found = stackOf(this.list, entry);
    if (!found?.section || !found.stack.replies.length) return false;
    const { stack } = found, state = this.state;
    const now = { level: levelOf(state, stack.id) };
    const next = foldStep(now, way);
    if (!next) return false;
    const apply = to => {
      setLevel(state, stack, to.level);
      this.arrange(); this.focusOn(entry.dataset.id);
    };
    apply(next);
    this.remember(() => apply(now));
    this.say({ open: 'Original message and every reply shown', folded: 'Latest and unread replies shown' }[next.level]);
    return true;
  }
  // Folds a message to its one-line row (on true) or unfolds it, for the
  // reader on every device: their own act in Core (message.fold), shown at
  // once. A starred message is not folded. ⌘Z puts it back; focus: the message
  // takes the focus, so ⌘Z is at hand (not on a phone's swipe).
  setFold(item, on, { focus = true, undoable = true } = {}) {
    const acts = this.actsOf(item.id, item);
    if (Boolean(acts.folded) === on || (on && acts.starred)) return false;
    this.state.peeked.delete(item.id);
    this.act('message.fold', item, { folded: on });
    if (undoable) this.remember(() => { this.setFold(item, !on, { undoable: false }); });
    this.arrange();
    if (focus) this.focusOn(item.id);
    this.say(on ? 'Folded to one line, for you only' : 'Unfolded');
    return true;
  }
  // A press on a folded message's row (reply-stacks.mjs).
  unfoldId(id) {
    const item = this.messages().get(id);
    if (item) this.setFold(item, false);
  }
  // A click on the header of a message a dossier shows whole (reply-stacks.mjs,
  // headerClick, item 471): it folds, as x does; a starred one stays open.
  foldId(id) {
    const item = this.messages().get(id);
    if (!item) return;
    if (this.actsOf(item.id, item).starred) { this.say('Starred messages stay open'); return; }
    this.setFold(item, true);
  }
  // Option held with a swipe right (item 472): the message and every message
  // before it in its dossier fold, each for the reader alone as a plain fold
  // does (a starred one stays open), those the page has not loaded too. One
  // command (message.fold_through): Core finds the dossier's messages and says
  // which it folded. The ones in the stack shown fold at once; ⌘Z unfolds every
  // one it folded.
  foldThrough(stack, item) {
    const run = [stack.head, ...stack.replies], upTo = run.findIndex(each => each.id === item.id);
    const shown = run.slice(0, upTo + 1).map(each => this.messages().get(each.id) ?? each)
      .filter(each => { const acts = this.actsOf(each.id, each); return !acts.folded && !acts.starred; });
    for (const each of shown) this.state.peeked.delete(each.id);
    const folded = this.act('message.fold_through', item, {}, shown.map(each => [each.id, { folded: true }]))
      .then(result => result.folds.map(({ message_id }) => this.messages().get(message_id) ?? this.standIns.get(message_id)));
    folded.then(each => {
      for (const one of each) this.settled(one.id);
      this.say(!each.length ? 'Nothing to fold' : each.length === 1 ? 'Folded to one line, for you only' : `${each.length} messages folded to one line, for you only`);
    }, () => {});
    this.remember(() => folded.then(each => { for (const one of each) this.setFold(one, false, { focus: false, undoable: false }); }, () => {}));
    this.arrange();
    return true;
  }
  // A dossier's first message, as Core last said where it is, and the
  // dossier's position: the loaded message, else one standing in for it that
  // holds what the position says of its aside and its name. Null where Core
  // sent no position.
  rootOf(stack) {
    const root = positionOf(stack)?.root_id;
    const current = this.state.stacks.find(each => positionOf(each)?.root_id === root) ?? stack;
    const position = positionOf(current);
    if (!position) return null;
    if (!this.messages().has(root) && !this.standIns.has(root)) this.standIns.set(root, { id: root, acts: {} });
    const item = this.messages().get(root) ?? this.standIns.get(root);
    item.acts = laterActs(item.acts, { aside: position.through, aside_revision: position.aside_revision,
      ...('name_revision' in position ? { name: position.name, name_revision: position.name_revision } : {}) });
    return { item, position };
  }
  // What the Reader's archive button offers for the dossier a message is in
  // (item 378): Move below More, or Bring back once it is there, the same act
  // as ⋯'s (setAside), with how many of the page's messages go with it. The
  // act moves Core's whole dossier, which the page draws as more than one
  // stack where its first message is not loaded (two replies to it are two
  // stacks), so the count is of every stack drawn from that dossier. Null
  // where ⋯ offers neither: no stack drawn holds the message, or Core sent no
  // position for it.
  asideOffer(id) {
    const stack = this.state.stacks.find(each => each.id === id || each.replies.some(item => item.id === id));
    const position = stack && positionOf(stack);
    if (!position) return null;
    const dossier = this.state.stacks.filter(each => positionOf(each)?.root_id === position.root_id);
    return { stack, below: position.below, count: dossier.reduce((count, each) => count + 1 + each.replies.length, 0) };
  }
  // focus: false leaves the focus where it is, as on the Reader's archive
  // button, whose dialog keeps it while the page behind it changes.
  setAside(stack, below, { undoable = true, restoreThrough, focus = true } = {}) {
    const found = this.rootOf(stack);
    if (!found) return false;
    const { item, position } = found, root = item.id;
    // Below More through the newest message of the dossier the page has seen.
    const through = restoreThrough !== undefined ? restoreThrough : below ? [...this.messages().values()]
      .reduce((newest, each) => (each.stack_position?.root_id === root ? Math.max(newest, each.seq) : newest), position.at.messages) : null;
    // The person's own move here ends what a link drew where it sits at once,
    // before Core answers, and also when Core finds the place unchanged (the
    // same through keeps its revision, so drawnBelow's place would hold).
    for (const each of this.messages().values()) if (each.stack_position?.root_id === root) { this.state.peeked.delete(each.id); this.state.here.delete(each.id); }
    this.act('stack.aside', item, { through });
    if (undoable) this.remember(() => this.setAside(stack, position.through !== null, { undoable: false, restoreThrough: position.through }));
    this.arrange();
    // Focus goes to More where the page's one view draws it (Only new does
    // not); there the dossier keeps it, on the first message the view draws.
    if (focus) {
      if (below && this.state.more?.isConnected && !shownView(this.state).only) this.state.more.focus({ preventScroll: true });
      else this.focusOn(stack.id);
    }
    this.say(below ? 'Moved below More, for you only' : 'Brought back');
    return true;
  }
  // What a swipe over target acts on: the dossier as a whole on its title bar
  // (its head row or chevron, item 472), else the message under it.
  gestureTarget(target) {
    const entry = entryOf(this.list, target);
    const section = target?.closest?.('.reply-stack');
    const found = stackOf(this.list, entry ?? (section && this.entryFor(section.dataset.stack)));
    if (!found) return null;
    const chrome = !entry || target.closest('.stack-head') || target.closest('.stack-toggle');
    return { found, item: entry && this.messages().get(entry.dataset.id), whole: Boolean(found.section && chrome) };
  }
  // through: Option was held, so a swipe right folds the message and every one before it (foldThrough).
  swipeAct(target, folds, through = false) {
    const gesture = this.gestureTarget(target);
    if (!gesture) return false;
    if (gesture.whole && folds) return this.setAside(gesture.found.stack, true);
    if (gesture.whole && !folds && positionOf(gesture.found.stack)?.below) return this.setAside(gesture.found.stack, false);
    if (!gesture.item) return false;
    return through && folds ? this.foldThrough(gesture.found.stack, gesture.item) : this.setFold(gesture.item, folds, { focus: false });
  }
  swiped(event) {
    const start = this.swipe, touch = event.changedTouches?.[0];
    this.swipe = null;
    const across = touch && start ? touch.clientX - start.x : 0;
    if (!start || Math.abs(across) < 80 || Math.abs(touch.clientY - start.y) > 40) return;
    this.swipeAct(start.target, across > 0, event.altKey);
  }
  // A wheel event on the list: part of a trackpad swipe, or a scroll the
  // browser keeps. The message is the one under the swipe's first event, and
  // the swipe folds or unfolds it once; the rest of it, momentum and all, is
  // still kept from the browser while it goes across. A scroll further down
  // than across, a swipe that began on something scrolling sideways and the
  // wheel with Ctrl or ⌘ (zoom) are left to the browser.
  // Each event is judged on its own too (item 393): one that goes further down
  // than across ends the swipe and is the browser's, so a scroll begun in the
  // swipe's momentum, after it folded a message or before, scrolls at once.
  wheeled(event) {
    if (event.ctrlKey || event.metaKey) return;
    const [unitX, unitY] = event.deltaMode === 1 ? [16, 16] : event.deltaMode === 2 ? [this.list.clientWidth, this.doc.defaultView.innerHeight] : [1, 1];
    const across = event.deltaX * unitX, down = event.deltaY * unitY;
    if (Math.abs(down) > Math.abs(across)) { this.wheelSwipe = null; return; }
    let swipe = this.wheelSwipe;
    if (!swipe || event.timeStamp - swipe.last >= SWIPE_GAP) {
      const target = scrollsSideways(event.target, this.list) ? null : event.target;
      swipe = this.wheelSwipe = { x: 0, y: 0, target, valid: target && this.gestureTarget(target), done: false };
    }
    swipe.last = event.timeStamp;
    swipe.x += across; swipe.y += down;
    if (!swipe.valid || Math.abs(swipe.x) <= Math.abs(swipe.y)) return;
    event.preventDefault();
    if (swipe.done || Math.abs(swipe.x) < SWIPE_ACROSS) return;
    swipe.done = true;
    this.swipeAct(swipe.target, swipeFolds(swipe.x), event.altKey);
  }
  // Stack keys on a message or its chevron, never in writing. Plain arrows
  // open/fold first; the pane's document listener handles the boundary.
  key(event) {
    if (this.renameKey(event)) return;
    const action = keyAction(event);
    if (!FEED_ACTIONS.includes(action) || this.doc.querySelector('dialog[open]')) return;
    const at = this.doc.activeElement;
    if (!at || !this.list.contains(at)) return;
    if (action === 'undo' && at === this.state.more) { event.preventDefault(); this.undo(); return; }
    const toggle = at.classList?.contains('stack-toggle');
    const entry = toggle ? this.entryFor(at.closest('.reply-stack')?.dataset.stack) : entryOf(this.list, at);
    if (!entry || !(toggle || at === cardIn(entry) || at.classList?.contains('fold-line'))) return;
    if (action === 'right' || action === 'left') {
      if (this.fold(entry, action === 'right' ? 'open' : 'fold')) event.preventDefault();
      return;
    }
    if (action === 'fold-message') return this.foldKey(event, entry, toggle);
    event.preventDefault();
    if (action === 'undo') return this.undo();
    if (action === 'move-up' || action === 'move-down') return this.move(entry, action.slice(5));
    if (action === 'join-up' || action === 'join-down') return this.join(entry, action.slice(5));
  }
  // x on a message (item 388): folds it to its row, as Fold in ⋯ does
  // (setFold), and x again unfolds it; the keys stay on its row, and ⌘Z puts
  // it back. A starred message stays open, which is said. On a dossier as a
  // whole (its chevron, or its compact header) x does nothing yet; its first
  // message, shown whole or as its row once the dossier is fully open, folds
  // and unfolds as any message does (item 471).
  foldKey(event, entry, toggle) {
    if (toggle) return;
    const item = this.messages().get(entry.dataset.id);
    if (!item) return;
    const acts = this.actsOf(item.id, item), found = stackOf(this.list, entry);
    if (found?.head && found.stack.replies.length && found.section?.dataset.headOpen === 'false') return;
    event.preventDefault();
    if (acts.starred && !acts.folded) { this.say('Starred messages stay open'); return; }
    this.setFold(item, !acts.folded);
  }
  // Return on a dossier as a whole, its chevron or its compact header (the
  // head's row standing for the dossier), edits its title as Rename in ⋯ does
  // (item 385); Return saves it and Escape cancels, as there. Return on a
  // message, a head shown whole included, still replies.
  renameKey(event) {
    if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey || this.doc.querySelector('dialog[open]')) return false;
    const at = this.doc.activeElement, section = at && this.list.contains(at) ? at.closest('.reply-stack') : null;
    const head = section && this.entryFor(section.dataset.stack);
    if (!head) return false;
    const whole = at.classList.contains('stack-toggle') || (section.dataset.headOpen === 'false' && at === cardIn(head));
    const found = whole && stackOf(this.list, head);
    if (!found?.head || !found.stack.replies.length) return false;
    event.preventDefault();
    this.startRename(found.stack);
    return true;
  }
  // What ⋯ offers for the stack a message is in, with the keys that do the
  // same; on a phone, the stack's moves and joins sit behind "Move or join…".
  // first: what the message offers; last: its stack's moves and joins.
  menuItems(item, { phone = false, more = () => {} } = {}) {
    const entry = this.entryFor(item.id), found = entry && stackOf(this.list, entry);
    const starred = Boolean(this.actsOf(item.id, item).starred);
    const items = [{ label: starred ? 'Unstar' : 'Star for me', act: () => this.star(item) }];
    if (!found) return { first: items, last: [] };
    const { stack } = found, state = this.state;
    if (found.head && stack.replies.length) {
      items.push({ label: 'Rename', act: () => this.startRename(stack) });
      const open = state.levels.get(stack.id) === 'open';
      items.push({ label: open ? 'Show latest and unread replies' : 'Show all messages',
        act: () => { setLevel(state, stack, open ? 'folded' : 'open'); this.arrange(); this.focusOn(stack.id); } });
    }
    // A star keeps a message in view: a starred message offers no Fold.
    if (this.actsOf(item.id, item).folded) items.push({ label: 'Unfold', act: () => this.setFold(item, false) });
    else if (!starred) items.push({ label: 'Fold', act: () => this.setFold(item, true) });
    if (stack.joins.has(item.id)) items.push({ label: 'Split back out', act: () => this.split(item) });
    const moves = [
      ...(positionOf(stack) ? [{ label: positionOf(stack).below ? 'Bring back above More' : 'Move below More', act: () => this.setAside(stack, !positionOf(stack).below) }] : []),
      { label: 'Move its stack up', keys: '⌘↑', act: () => this.move(entry, 'up') },
      { label: 'Move its stack down', keys: '⌘↓', act: () => this.move(entry, 'down') },
      ...(stack.replies.length && foldStep({ level: levelOf(state, stack.id) }, 'fold') ? [{ label: 'Fold its stack', keys: '←', act: () => this.fold(entry, 'fold') }] : []),
      ...(stack.replies.length && foldStep({ level: levelOf(state, stack.id) }, 'open') ? [{ label: 'Open its stack', keys: '→', act: () => this.fold(entry, 'open') }] : []),
      { label: 'Join the stack above', keys: '⇧⌘↑', act: () => this.join(entry, 'up') },
      { label: 'Join the stack below', keys: '⇧⌘↓', act: () => this.join(entry, 'down') },
      ...(stack.placed !== null ? [{ label: 'Let new replies move it', act: () => this.unplace(stack) }] : []),
      ...(this.undos.length ? [{ label: 'Undo', keys: '⌘Z', act: () => this.undo() }] : []),
    ];
    return { first: items, last: phone ? [{ label: 'Move or join…', act: () => more(moves) }] : moves };
  }
  // Lands on a message, opening its stack (and, for its first message, the full words).
  land(id) {
    const entry = this.entryFor(id);
    if (!entry) return null;
    reveal(entry, { full: true });
    return this.entryFor(id);
  }
}
