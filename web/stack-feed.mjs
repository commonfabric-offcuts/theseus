import { wheelSwipe } from './message-fold-swipe.mjs';
import { stackMenuItems, STARRED_FOLD_REASON } from './stack-menu-items.mjs';
import { archiveReadConfirmed } from './archive-new.mjs';
import { unstarDossier } from './dossier-unstar.mjs';
import { openSplitSources } from './dossier-splits.mjs';
import { openDossierJoin } from './dossier-join.mjs';
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
// stacks are drawn again whenever an answer changes what they show. Explicit
// dossier levels and individual message folds are separate personal Core acts.
import { cardIn } from './fold.mjs';
import { arrangeStacks, entries, entryOf, stackOf, stackState, setLevel, levelOf, reveal, renameInput, shownSelected, unkeep, shownView, drawn, repaintStackReading } from './reply-stacks.mjs';
import { moveOf, keyOf, joinShown, joinOf, foldStep, laterActs, positionOf, placeOf, sideOf, headOf, stackCover, dossierOf } from './stack-order.mjs';
import { keyAction, writing } from './pane-keys.mjs';
import { messagePreview } from './message-preview.mjs';
import { revealSelection } from './reveal.mjs';
import { mayThumb, thumbed, currentThumbs, paintThumbPending } from './reactions.mjs';
import { contact, heard, notTaken, NOT_TAKEN } from './api.mjs';
import { CoordinationChoice } from './coordination-choice.mjs';
import { firstCoverMenuItem } from './cover-refresh.mjs';
import { foldInMotion, closeUp } from './fold-motion.mjs';
import { ArchiveShelf } from './archive-shelf.mjs';

// The line a card is pressed by and read from: its title bar on a dossier's
// first message, else who wrote it, else its folded or earlier row.
const LINES = [':scope > .stack-head', ':scope > .message-author', ':scope > .message-folded', ':scope > .message-earlier'];
const lineOf = card => LINES.map(selector => card?.querySelector(selector)).find(line => line?.getClientRects().length) ?? card;
const NOTE_FOLD = 'Fold saved; your private note keeps this message whole';
const FIELD = { 'stack.level': 'level', 'stack.aside': 'aside', 'message.star': 'star', 'message.deal': 'deal', 'message.fold': 'fold', 'message.fold_through': 'fold', 'stack.place': 'place', 'stack.name': 'name', 'stack.join': 'join' };
// Feed and rail commands share the same revision fence and envelope.
export function stackActEnvelope({ instanceId, authority, kind, item, args, operationId = crypto.randomUUID() }) {
  const field = FIELD[kind];
  if (!field) throw Error('That message action is not available.');
  const { authority_id, authority_epoch } = authority;
  return { v: 1, instance_id: instanceId, operation_id: operationId, kind, target: { message_id: item.id },
    expected: { [`${field}_revision`]: item.acts?.[`${field}_revision`] ?? 0, authority: { authority_id, authority_epoch } }, args };
}
const FEED_ACTIONS = ['move-up', 'move-down', 'open', 'right', 'left', 'join-up', 'join-down', 'undo', 'fold-message'];

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
  if (kind === 'stack.level') return { level: result.level, ...revision };
  if (kind === 'stack.place') return { placed: result.key, ...revision };
  if (kind === 'stack.name') return { name: result.name ? { text: result.name, by: viewer, at_ms: now } : null, ...revision };
  return { joined: result.into ? { into: result.into, by: viewer, at_ms: now } : null, ...revision };
}
// An act's words in a notice, with the card it names: "folding “The latest
// reply…”". The card is named by its one line (messagePreview), cut short to fit
// the rail.
const CARD_WORDS = 40;
const DOING = {
  'stack.level': args => args.level === null ? 'restoring the default view of' : args.level === 'open' ? 'opening' : 'collapsing',
  'stack.aside': args => args.through === null ? 'bringing back' : 'archiving',
  'message.star': args => args.starred ? 'starring' : 'unstarring',
  'message.deal': () => 'marking as dealt with',
  'message.fold': args => args.folded ? 'folding' : 'unfolding',
  // Option's fold (item 472): the message and every one before it in its dossier.
  'message.fold_through': () => 'folding every message up to',
  'stack.place': args => args.key === null ? 'resetting the position of' : 'moving',
  'stack.name': args => args.name ? 'renaming' : 'naming by its first line',
  'stack.join': args => args.into ? 'joining' : 'splitting out',
  'message.thumb': args => args.thumbed ? 'the thumbs-up on' : 'taking back the thumbs-up on',
  'message.answer': args => args.answer === 'yes' ? 'answering Go ahead to' : 'answering Don’t to',
  'message.mark': args => args.marked ? 'marking unread' : 'marking read',
};
function doing(kind, item, args, name = null) {
  // Splitting removes this message from its containing dossier; that
  // dossier's name still belongs to the messages which stay there.
  const line = kind === 'stack.join' && args.into === null ? messagePreview(item) : name ?? messagePreview(item);
  const short = line.length > CARD_WORDS ? `${line.slice(0, CARD_WORDS - 1).trimEnd()}…` : line;
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
  if (kind === 'stack.level') return { level: args.level };
  if (kind === 'stack.aside') return { aside: args.through, ...(typeof args.key === 'number' ? { order_key: args.key } : {}) };
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
  // hold(paint, act?): repaints keeping the page where the person is; act
  // names the card before its callback changes anything ({id, anchor}). press: the
  // press held down on the page (press-hold.mjs).
  // navigate(): materialize waiting arrivals at the put-aside More destination.
  // Card acts (including star/menu) never invoke it.
  // thumb(item, on): the message's thumbs-up, as its bar's 👍 gives it (a folded row's 👍).
  // redrawn(): the stacks were drawn again, so what else shows a message's acts (the Reader's star) follows.
  // home: the page's New message composer at rest, drawn just above More (arrangeStacks); put back after
  // being up over the page, it goes to that place at once.
  // reply(id, card): the Reader on a message, the cursor in the reply (a title bar's Reply). menu(item, anchor):
  // the menu a right-click on a message opens, from anchor (a title bar's ⋯). colorOf: as arrangeStacks takes it.
  constructor({ list, messages, viewer, instanceId, authority, send, keep, unread, nameOf, quiet = () => false, filterHost = null, reread = () => {}, starsChanged = () => {}, status = () => {}, line = () => null,
    newest = () => {}, refreshPositions = async () => {}, acted = () => {}, moreChanged = () => {}, arranged = () => {}, hold = paint => paint(), navigate = () => {}, press, thumb = null, redrawn = () => {}, home = null, reply = () => {}, menu = () => {},
    colorOf = () => null, readNamed = null, captureArchive = () => null, captureEmptyReply = null, closeReplyToFold = null, clock = () => Date.now(), thumbPending = () => null, doc = document }) {
    Object.assign(this, { list, messages, viewer, instanceId, authority, commandOf: send, keep, unread, nameOf, quiet, filterHost, reread, starsChanged, status, line, newest, refreshPositions, acted, moreChanged, arranged, hold, navigate, press, thumb, redrawn, home, reply, menu, colorOf, captureArchive, captureEmptyReply, closeReplyToFold, clock, doc });
    this.archiveReads = new Map();
    this.thumbPending = thumbPending;
    this.readNamed = readNamed; this.headerStars = new Set();
    this.coordinationChoice = new CoordinationChoice({ instanceId, viewer, view: doc.defaultView ?? globalThis.window });
    this.state.showCoordination = this.coordinationChoice.on;
    home?.addEventListener('close', () => this.arrange());
    this.undos = []; this.chain = Promise.resolve(); this.newestSeen = null;
    // A stand-in for each message the page has not loaded that an act is on (a
    // dossier's root, a message Option's fold folded), kept so each act on it
    // learns the revision the act before it left, as a loaded message does.
    this.standIns = new Map();
    // The acts shown and not yet answered, by message, in the order made; and
    // the acts each message was last drawn with; and when each act shown was
    // made, as a count of the acts made, across messages (shownPlaces).
    this.pending = new Map(); this.drawn = new Map(); this.made = new WeakMap(); this.makes = 0;
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
    // sideways scrolls it instead. Native selection handles keep their drag.
    list.addEventListener('touchstart', event => {
      const touch = event.touches?.length === 1 ? event.touches[0] : null;
      this.swipe = touch && doc.getSelection()?.isCollapsed !== false && !scrollsSideways(event.target, list) ? { id: touch.identifier, x: touch.clientX, y: touch.clientY, target: event.target } : null;
    }, { passive: true });
    list.addEventListener('touchcancel', () => { this.swipe = null; }, { passive: true });
    list.addEventListener('touchend', event => this.swiped(event), { passive: false });
    // Two fingers across a laptop's trackpad do the same. Not passive: while a
    // swipe over a message goes across, the page keeps it from the browser,
    // which would otherwise go back or forward a page.
    list.addEventListener('wheel', event => this.wheeled(event), { passive: false });
  }
  get state() { return stackState(this.list); }
  // A star/menu action owns the hold before any optimistic change, and
  // includes synchronous focus transfers. Nested arrange calls use that hold.
  cardAct(id, act, anchor = null) {
    if (this.acting) return act();
    this.acting = true;
    try { return this.hold(act, { id, anchor }); }
    finally { this.acting = false; }
  }
  // A message's acts as the page shows them: what Core holds, with each act
  // not yet answered over it. known: the message when the page has not loaded it.
  actsOf(id, known = null) {
    let acts = ((this.arrangeMessages ?? this.messages()).get(id) ?? known)?.acts ?? {};
    for (const { stack_position, ...shown } of this.pending.get(id) ?? []) acts = { ...acts, ...shown };
    return acts;
  }
  // The loaded messages as the stacks draw them, each with its acts as shown.
  shownMessages() {
    const messages = this.arrangeMessages ?? this.messages();
    return { has: id => messages.has(id), get: id => {
      const item = messages.get(id);
      if (!item) return item;
      const acts = this.actsOf(id);
      this.drawn.set(id, JSON.stringify(acts));
      // Where a join of its dossier is not yet answered, the message shows where that act puts it (join).
      let stack_position = item.stack_position;
      for (const mark of this.pending.get(id) ?? []) if ('stack_position' in mark) stack_position = mark.stack_position;
      // A committed root act can precede its positions read. Keep its newer
      // revision, including when the first message is outside the loaded page.
      const root = stack_position?.root_id, known = messages.get(root) ?? this.standIns.get(root);
      if (known && (known.acts?.level_revision ?? -1) > (stack_position?.level_revision ?? -1)) {
        stack_position = { ...stack_position, level: known.acts.level, level_revision: known.acts.level_revision };
      }
      for (const pending of this.pending.get(root) ?? []) {
        if ('level' in pending) stack_position = { ...stack_position, level: pending.level };
        if ('aside' in pending) stack_position = { ...stack_position, through: pending.aside, below: pending.aside !== null,
          ...('order_key' in stack_position && pending.aside === null ? { order_key: pending.order_key ?? Math.min(0, ...this.state.stacks.map(keyOf)) - 1 } : {}) };
        if ('name' in pending) stack_position = { ...stack_position, name: pending.name };
        if ('placed' in pending) stack_position = { ...stack_position, placed: pending.placed,
          ...('order_key' in stack_position ? { order_key: pending.placed ?? stack_position.order_entry_key } : {}) };
      }
      const places = stack_position?.places && this.shownPlaces(stack_position, messages);
      if (places && places !== stack_position.places) stack_position = { ...stack_position, places };
      // A join or split not yet answered: the positions Core sent name the dossier it left (stack-order.mjs, positionOf).
      const moving = (this.pending.get(id) ?? []).some(mark => 'joined' in mark);
      return this.pending.has(id) || stack_position !== item.stack_position ? { ...item, acts, stack_position, ...(moving ? { moving } : {}) } : item;
    } };
  }
  forgetMessages(retained) {
    for (const id of this.drawn.keys()) if (!retained.has(id)) this.drawn.delete(id);
    for (const id of this.standIns.keys()) if (!retained.has(id) && !this.pending.has(id)) this.standIns.delete(id);
  }
  // The places on a dossier's other messages (its position's places, stack-order.mjs heldPlace) as the page holds
  // them. A place act not yet answered on any message of the dossier is the one set last, the last made first, listed
  // or not: the positions read after Let new replies move it list none of the places its ⌘Z puts back, and each shows
  // at once, as one on a stack's head did before item 550. Another listed shows as the page holds its message at that
  // place's revision or later, an act answered before the positions are read again. The list Core sent where nothing
  // differs.
  shownPlaces(position, messages) {
    const root = position.root_id, known = id => messages.get(id) ?? this.standIns.get(id);
    const making = [...this.pending].flatMap(([id, marks]) => {
      const mark = marks.findLast(each => 'placed' in each), item = known(id);
      return id !== root && mark && (item?.stack_position?.root_id ?? item?.dossier) === root ? [{ id, order: this.made.get(mark) }] : [];
    }).sort((a, b) => b.order - a.order);
    const listed = position.places.filter(each => !making.some(({ id }) => id === each.message_id)).map(each => {
      const acts = known(each.message_id) && this.actsOf(each.message_id, known(each.message_id));
      return acts && (acts.place_revision ?? 0) >= each.place_revision && acts.placed !== each.placed ? { ...each, placed: acts.placed ?? null } : each;
    });
    if (!making.length && listed.every((each, index) => each === position.places[index])) return position.places;
    const latest = position.places.reduce((most, each) => Math.max(most, each.at_ms), 0);
    return [...making.map(({ id }, index) => {
      const acts = this.actsOf(id, known(id));
      return { message_id: id, placed: acts.placed ?? null, place_revision: acts.place_revision ?? 0, at_ms: latest + making.length - index };
    }), ...listed];
  }
  arrange() {
    const before = this.arrangeMessages;
    this.arrangeMessages = this.messages();
    try { return this.paintArrangement(); }
    finally { this.arrangeMessages = before; }
  }
  // Only the synchronous pass shares this map. Nested passes take their own,
  // and deferred gestures use the ordinary current provider after it returns.
  paintArrangement() {
    const messages = this.arrangeMessages ?? this.messages();
    this.hold(() => arrangeStacks(this.list, this.shownMessages(), { keep: this.keep, unread: this.unread, quiet: this.quiet, viewer: this.viewer, nameOf: this.nameOf, colorOf: this.colorOf, home: this.home, coordinationHost: this.filterHost, doc: this.doc, on: {
      arrange: () => this.arrange(),
      navigate: () => this.navigate(), more: () => this.moreChanged(), rename: stack => this.startRename(stack), renamed: (stack, text, how) => this.rename(stack, text, how), renameFinished: stack => { this.arrange(); this.focusOn(stack.id); }, cancelled: stack => { this.arrange(); this.focusOn(stack.id); },
      coordinationCount: (count, news) => this.paintCoordination(count, news),
      star: stack => this.starDossier(stack), firstStarred: stack => this.firstStarred(stack),
      split: item => this.split(item), unplace: stack => this.unplace(stack), unfold: id => this.unfoldId(id), fold: id => this.foldId(id),
      level: (stack, level) => this.setDossierLevel(stack, level),
      folded: (stack, was) => {
        // Explicitly collapsing this dossier handles its loaded arrivals.
        // Expanding or restoring its view must not clear unrelated marks.
        if (was === 'open') {
          for (const item of [stack.head, ...stack.replies]) this.acted(item.id);
        }
      },
      earlier: (stack, count) => this.say(`${count === 1 ? 'The earlier message is' : `${count} earlier messages are`} shown, for this visit`),
      arranged: () => this.arranged(), acted: id => this.acted(id), newest: (stack, mark) => this.newest(stack, mark),
      // Reply targets the newest loaded message; the menu remains the dossier's.
      reply: stack => {
        const latest = [stack.head, ...stack.replies].reduce((a, b) => b.seq > a.seq ? b : a);
        const entry = this.entryFor(latest.id); if (entry) this.reply(latest.id, cardIn(entry));
      },
      aside: (stack, below) => this.setAside(stack, below),
      // The shelf drawn or not decides whether the feed's Archived (N) and Earlier messages show (shownView's shelved).
      // The shelf taking over Archived (N) closes it, so it comes back closed should the shelf go (this arrange then
      // hides what sits below More, as shownView is read after this).
      archived: list => {
        if (!this.list.isConnected) return;
        const shelf = this.archiveShelf(), was = Boolean(this.state.shelved); shelf?.paint(list);
        this.state.shelved = Boolean(shelf?.drawn);
        if (this.state.shelved === was) return;
        if (this.state.shelved) this.state.moreOpen = false;
        this.moreChanged();
      },
      menu: (stack, anchor, first) => { const item = this.messages().get(stack.id); if (item) this.menu(item, anchor, first); },
      landedBelow: (id, mark) => this.landedBelow(id, mark),
    } }));
    for (const entry of entries(this.list)) {
      const card = cardIn(entry), item = messages.get(card.dataset.id);
      if (item) { this.paintStar(card.querySelector(':scope > .message-author'), item); this.paintFoldedThumb(card, item); }
    }
    this.readingMembers = new Set(messages.keys());
    this.redrawn();
    this.moreChanged();
  }
  // A read-only paint must not hide an admission/retirement or current key,
  // place, join or head change. Current records and renderer preflight decide.
  updateReading(ids) {
    if (!this.list.isConnected) return;
    const messages = this.messages(), before = this.arrangeMessages;
    this.arrangeMessages = messages;
    try {
      if (!this.readingMembers || this.readingMembers.size !== messages.size ||
          [...messages.keys()].some(id => !this.readingMembers.has(id))) return this.arrange();
      let painted;
      this.hold(() => { painted = repaintStackReading(this.list, ids, this.shownMessages()); });
      if (!painted) return this.arrange();
    } finally { this.arrangeMessages = before; }
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
    const on = thumbed(item, this.viewer), count = currentThumbs(item).length, words = on ? 'Remove thumbs up' : 'Thumbs up';
    const shown = count ? `👍 ${count}` : '👍';
    if (button.textContent !== shown) button.textContent = shown;
    button.setAttribute('aria-pressed', String(on)); button.setAttribute('aria-label', count ? `${words} (${count})` : words); button.title = words;
    button.dataset.count = String(count);
    const pending = this.thumbPending?.(item.id) ?? null;
    paintThumbPending(button, pending);
    if (pending !== null) button.textContent = '👍 …';
  }
  // Giving a thumb can only retire New marks. Refresh the affected dossier's
  // existing marks without gathering/arranging all loaded messages.
  paintReactionReading(card) {
    this.updateReading([card.dataset.id]);
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
  paintCoordination(count = this.coordinationCount ?? 0, news = false) {
    this.coordinationCount = count;
    if (!this.filterHost) return;
    let button = this.filterHost.querySelector('button');
    if (!button) {
      button = this.doc.createElement('button'); button.type = 'button'; button.className = 'filter-chip';
      this.filterHost.append(button);
      button.onclick = () => {
        this.coordinationChoice.set(!this.state.showCoordination);
        this.state.showCoordination = this.coordinationChoice.on;
        this.state.coordinationHere.clear();
        this.arrange();
      };
    }
    button.textContent = `Show agent coordination (${count})`;
    button.setAttribute('aria-pressed', String(this.state.showCoordination));
    button.dataset.news = String(news);
    button.setAttribute('aria-label', `Show agent coordination (${count})${news ? ', new messages' : ''}`);
    this.filterHost.hidden = count === 0;
  }
  // Says what just happened, for a screen reader.
  say(words) { this.said.textContent = ''; this.said.textContent = words; }
  remember(undo) { this.undos.push(undo); if (this.undos.length > 50) this.undos.shift(); }
  // ⌘Z, or Undo in ⋯ (at: the line of the message whose menu it was, where a
  // refusal is said when that message is of the dossier the undo acts on). An
  // undo that does nothing gives false: a Bring back's undo on a dossier
  // starred since is held (setAside, item 635), and its note says why, so
  // nothing says it was put back.
  undo(at = null) {
    const last = this.undos.pop();
    if (!last) { this.say('Nothing to put back'); return; }
    if (last(at) !== false) this.say('Put back');
  }
  // Shows an act on the message at once and sends it after the acts before it.
  // Answered, refused or not settled, it is no longer drawn over what Core
  // holds: one not settled shows once Core says it is recorded. also: what
  // else it shows at once, as [message id, acts] (Option's fold, on several).
  act(kind, item, args, also = [], { quiet = false, committed = null } = {}) {
    const shown = shownAct(kind, args, this.viewer, this.clock());
    const shows = [[item.id, shown], ...also];
    if (!quiet && !QUIET.has(kind)) for (const [id] of shows) this.acted(id);
    for (const [id, mark] of shows) this.pending.set(id, [...this.pending.get(id) ?? [], mark]);
    this.made.set(shown, ++this.makes);
    const sent = this.chain.then(() => this.send(kind, item, args)).finally(() => {
      for (const [id, mark] of shows) {
        const left = (this.pending.get(id) ?? []).filter(each => each !== mark);
        if (left.length) this.pending.set(id, left); else this.pending.delete(id);
      }
      for (const [id] of also) this.settled(id);
      this.settled(item.id);
    });
    this.chain = sent.catch(() => {});
    sent.then(result => committed?.(result), error => this.failed({ kind, item, args, committed }, error, true));
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
    const op = error.envelope.operation_id, what = doing(act.kind, act.item, act.args, act.kind.startsWith('stack.') ? this.dossierName(act.item.id) : null), why = waiting(error);
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
      sent.then(result => { over(); this.paintNotice(); doubt.committed?.(result); }, error => { over(); this.failed(doubt, error, false); })
        .finally(() => { this.settled(doubt.item.id); if (this.gone && !this.doubts.size) this.deafen(); });
    }
  }
  // A card command the person makes again themselves (a 👍, a go-ahead answer,
  // a mark) that Theseus answered without taking it: said in words of its act
  // and card, as a refused act is. One that reached no Theseus is a connection
  // line instead (lines.mjs), which its maker says. shows: what shows the card
  // (reading).
  notTaken(kind, item, args, failure, shows) {
    this.answered(`${kind}:${item.id}`, notSaved(doing(kind, item, args, kind.startsWith('stack.') ? this.dossierName(item.id) : null), notTaken(failure), AGAIN[kind]), shows);
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
    const current = this.messages().get(item.id) ?? item;
    const envelope = made ?? stackActEnvelope({ instanceId: this.instanceId, authority: this.authority(), kind, item: current, args });
    const clearing = kind === 'stack.aside' && envelope.args.clear_new === true;
    let finishArchive = null;
    if (clearing) {
      this.archiveReads ??= new Map();
      if (!this.archiveReads.has(envelope.operation_id))
        this.archiveReads.set(envelope.operation_id, this.captureArchive?.(item.id, envelope.args.through) ?? null);
      finishArchive = this.archiveReads.get(envelope.operation_id);
    }
    let receipt;
    try { receipt = await this.commandOf(envelope); } catch (error) { throw new ActFailure(envelope, { error }); }
    if (receipt?.status !== 'committed') {
      if (clearing && receipt?.recorded === true && receipt.operation_id === envelope.operation_id)
        this.archiveReads.delete(envelope.operation_id);
      throw new ActFailure(envelope, { receipt });
    }
    if (clearing) {
      if (!archiveReadConfirmed(receipt, envelope, item.topic_id))
        throw new ActFailure(envelope, { receipt });
      this.archiveReads.delete(envelope.operation_id);
    }
    const answer = learned(kind, receipt.result, this.viewer, this.clock());
    // The answer goes to the message the page holds now as well: a read that landed while the act was out (a
    // 👍's reactions, a page of messages) can have put a new copy of it in the page (item 433).
    for (const each of new Set([item, current, this.messages().get(item.id)])) if (each) each.acts = laterActs(each.acts, answer);
    if (clearing && !this.gone) finishArchive?.();
    // Option's fold says each message it folded: one the page holds, or a stand-in for one it has not loaded.
    if (kind === 'message.fold_through') for (const { message_id, fold_revision } of receipt.result.folds) {
      if (!this.messages().has(message_id) && !this.standIns.has(message_id)) this.standIns.set(message_id, { id: message_id, acts: {} });
      const known = this.messages().get(message_id) ?? this.standIns.get(message_id);
      known.acts = laterActs(known.acts, { folded: true, fold_revision });
    }
    if (kind === 'message.star') this.starsChanged();
    // A replay may return the receipt of a pre-change star that did bring
    // its dossier back. Learn the recorded move and its revision as before.
    const back = kind === 'message.star' ? receipt.result.brought_back : null;
    if (back) {
      const known = this.messages().get(back.root_id) ?? this.standIns.get(back.root_id);
      if (known) known.acts = laterActs(known.acts, { aside: null, aside_revision: back.aside_revision });
      await this.refreshPositions();
    }
    // An unloaded first message is represented by its dossier's position.
    // Refresh that membership before dropping the pending star (646).
    if (kind === 'message.star' && !back && !this.messages().has(item.id)) await this.refreshPositions();
    // What places a dossier and names it is read again after an act that changes them: a join or a split moves
    // messages to another dossier, whose positions they carry from then on (item 470). A place on a first message
    // the page has not loaded, or on any other message of a dossier, is shown by those positions (item 550).
    if (kind === 'stack.aside' || kind === 'stack.name' || kind === 'stack.join' || kind === 'stack.place' || kind === 'stack.level') await this.refreshPositions();
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
    if (this.acting) return;
    if (above) revealSelection(above);
    revealSelection(shownSelected(target));
  }
  // A star keeps the selected message whole and raises its archived dossier
  // within Archive. It does not change the dossier's place above or below it.
  star(item) {
    return this.cardAct(item.id, () => {
      const on = !this.actsOf(item.id, item).starred;
      this.act('message.star', item, { starred: on });
      if (on && this.actsOf(item.id, item).folded) { this.state.peeked.delete(item.id); this.act('message.fold', item, { folded: false }); }
      this.arrange(); this.say(on ? 'Starred, for you only' : 'Star taken off');
    });
  }
  // The header toggle belongs to the actual first message.
  firstStarred(stack) {
    const root = dossierOf(stack), item = (this.arrangeMessages ?? this.messages()).get(root) ?? { acts: { starred: Boolean(positionOf(stack)?.starred?.includes(root)) } };
    return Boolean(this.actsOf(root, item).starred);
  }
  async starDossier(stack) {
    const root = dossierOf(stack), anchor = stack.head.id;
    if (this.gone) return;
    if ([...this.doubts.values()].some(act => act.kind === 'message.star' && act.item.id === root)) { this.paintNotice(); return; }
    if (this.headerStars.has(root) || this.pending.get(root)?.some(mark => 'starred' in mark)) return;
    this.headerStars.add(root);
    try {
      // Read one named message, without inserting it into the loaded page or
      // navigating there. Its identity and revision must both come from Core.
      const page = await this.readNamed('topic_messages', { topic_id: stack.head.topic_id, message_ids: [root] });
      if (this.gone) return;
      const current = stackOf(this.list, this.entryFor(anchor))?.stack, item = page.items?.[0];
      if (page.instance_id !== this.instanceId || page.items?.length !== 1 || !item || item.withheld || item.id !== root ||
          item.topic_id !== stack.head.topic_id || item.stack_position?.root_id !== root || !current || dossierOf(current) !== root) {
        throw Error('This dossier’s first message is unavailable or its dossier changed. No star was changed.');
      }
      if (this.pending.get(root)?.some(mark => 'starred' in mark)) return;
      const known = this.messages().get(root) ?? this.standIns.get(root) ?? item;
      known.acts = laterActs(known.acts, item.acts);
      if (!this.messages().has(root)) this.standIns.set(root, known);
      const on = !this.actsOf(root, known).starred;
      // Keep this header's New mark, folding and focus. Existing message.star
      // owns the command, revision fence, uncertain-result recovery and More.
      await this.cardAct(anchor, () => {
        const sent = this.act('message.star', known, { starred: on }, [], { quiet: true });
        this.arrange(); return sent;
      });
      if (!this.gone) this.say(on ? 'Starred, for you only' : 'Star taken off');
    } catch (error) { if (!this.gone && !(error instanceof ActFailure)) this.status(error); }
    finally { this.headerStars.delete(root); }
  }
  // The right rail's Unstar, for a message here or in another place: one this
  // page shows takes the star off its card too.
  unstar(star) {
    const item = this.messages().get(star.message_id) ?? { id: star.message_id, acts: { starred: true, star_revision: star.star_revision } };
    if (!this.actsOf(item.id, item).starred) return;
    return this.cardAct(item.id, () => {
      this.act('message.star', item, { starred: false });
      this.arrange(); this.say('Star taken off');
    });
  }
  async unstarDossier(item, stack) {
    try {
      await unstarDossier({ ...item, stack_position: positionOf(stack) }, { instanceId: this.instanceId,
        read: this.readNamed, send: member => this.act('message.star', member, { starred: false }), current: () => !this.gone });
      if (!this.gone) { this.reread(); this.say('Stars taken off this dossier'); }
    } catch (error) { if (!this.gone && !(error instanceof ActFailure)) this.status(error); }
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
    this.acted(stack.id);
    this.state.renaming = stack.id; this.arrange();
    const input = renameInput(this.list, stack.id);
    input?.focus({ preventScroll: Boolean(this.acting) }); input?.select?.();
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
    const saved = this.act('stack.name', item, { name });
    this.remember(() => { this.act('stack.name', item, { name: typed }); this.arrange(); });
    this.arrange(); this.focusOn(stack.id);
    this.say(name ? `Renamed ${name}, for everyone here` : 'Named by its first line again, for everyone here');
    return saved;
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
    const heads = changes.map(change => this.placeOn(side.stacks.find(stack => stack.id === change.id)));
    const before = changes.map(change => { const stack = side.stacks.find(each => each.id === change.id); return stack.orderKey ?? stack.placed; });
    changes.forEach((change, index) => this.act('stack.place', heads[index], { key: change.key }));
    this.remember(() => { heads.forEach((item, index) => this.act('stack.place', item, { key: before[index] })); this.arrange(); this.focusOn(entry.dataset.id); });
    this.arrange(); this.focusOn(entry.dataset.id);
    this.say(`Moved ${way}, placed here by you`);
  }
  // A place is the dossier's, as its name is (item 550): it goes on its first
  // message, loaded or not, fenced on the place Core holds there, so loading
  // more of the dossier keeps it. A page whose Core sends no positions places
  // the head it shows.
  placeOn(stack) {
    const root = this.rootOf(stack);
    return root && 'place_revision' in root.position ? root.item : this.messages().get(stack.id);
  }
  // Let new replies move it takes away every place the dossier sorts by
  // (stack-order.mjs, gather): the one on its first message, and each one on
  // another of its messages that its position lists (places), set before
  // places went on the first message, loaded or not. ⌘Z puts each back, the
  // one set first first, as the positions list them the most recently set
  // first, so the one set last is set last again and still places the dossier.
  unplace(stack) {
    const position = positionOf(stack), first = this.placeOn(stack), listed = (position?.places ?? []).filter(each => each.message_id !== first.id).reverse();
    const held = listed.map(each => {
      if (!this.messages().has(each.message_id) && !this.standIns.has(each.message_id)) this.standIns.set(each.message_id, { id: each.message_id, acts: {} });
      const item = this.messages().get(each.message_id) ?? this.standIns.get(each.message_id);
      // A stand-in says which dossier it is in, so a place act on it not yet answered shows there (shownPlaces).
      if (!this.messages().has(item.id)) item.dossier = position.root_id;
      item.acts = laterActs(item.acts, { placed: each.placed, place_revision: each.place_revision });
      return item;
    });
    const items = [first, ...held.filter(item => typeof this.actsOf(item.id, item).placed === 'number')];
    const before = items.map(item => this.actsOf(item.id, item).placed ?? null);
    items.forEach(item => this.act('stack.place', item, { key: null }));
    this.remember(() => { items.forEach((item, index) => this.act('stack.place', item, { key: before[index] })); this.arrange(); });
    this.arrange(); this.say('Position reset, for you only');
  }
  // Resolve the exact visible neighbor without changing placement or joining.
  // A new visit retires this feed; a redraw/removal cannot retain its old entry.
  joinChoice(entry, way) {
    if (this.gone || !entry?.isConnected || !this.list.isConnected || !drawn(this.list, entry.dataset.id)) return null;
    const found = stackOf(this.list, entry);
    if (!found) return null;
    const side = this.sideOf(found), target = joinOf(side.stacks, side.index, way);
    if (side.index < 0 || !target) return null;
    const from = found.stack;
    // A proposal must not materialize or merge stand-ins into the feed.
    const root = stack => {
      const position = positionOf(stack), id = position?.root_id ?? stack.id;
      return this.messages().get(id) ?? this.standIns.get(id) ?? { id, acts: { join_revision: position?.join_revision ?? 0 } };
    };
    const source = root(from), destination = root(target);
    const topic = this.messages().get(entry.dataset.id)?.topic_id;
    if (!source || !destination || !topic || from.head.topic_id !== topic || target.head.topic_id !== topic) return null;
    const ids = new Set([source.id, destination.id]);
    if ([...ids].some(id => this.pending.get(id)?.some(mark => 'joined' in mark)) ||
        [...this.doubts.values()].some(act => act.kind === 'stack.join' && ids.has(act.item.id))) return null;
    const authority = this.authority(), acts = this.actsOf(source.id, source);
    const revision = this.messages().has(source.id) ? acts.join_revision ?? 0 : Math.max(acts.join_revision ?? 0, positionOf(from)?.join_revision ?? 0);
    const names = [from, target].map(stack => headOf(stack, { preview: messagePreview }).name || 'Unnamed dossier');
    return { from: names[0], into: names[1], token: JSON.stringify([this.instanceId, topic, authority.authority_id, authority.authority_epoch,
      entry.dataset.id, source.id, from.id, dossierOf(from), destination.id, target.id, dossierOf(target),
      Boolean(positionOf(from)?.below), revision, acts.joined?.into ?? null, ...names]) };
  }
  join(entry, way, { anchor = this.doc.activeElement } = {}) {
    const choice = this.joinChoice(entry, way);
    if (!choice) { this.say('No current neighboring dossier to join. Read this dossier again.'); return; }
    const visible = node => {
      if (!node?.isConnected || !node.getClientRects?.().length) return false;
      for (let at = node; at; at = at.parentElement) if (at.hidden) return false;
      return true;
    };
    const section = stackOf(this.list, entry)?.section;
    const origin = visible(anchor) && (entry.contains(anchor) || section?.contains(anchor)) ? anchor
      : [entry.querySelector('.fold-line'), cardIn(entry)].find(visible);
    if (!origin) { this.say('Open Join from the visible dossier or message.'); return; }
    return openDossierJoin({ anchor: origin, canRestore: () => visible(origin), choice,
      current: () => visible(origin) ? this.joinChoice(entry, way) : null,
      commit: now => this.joinConfirmed(entry, way, now), say: words => this.say(words), doc: this.doc });
  }
  // The named choice delegates to the existing join owner, after rechecking.
  // A join from the keys, ⋯ or the phone's sheet shows where it went
  // (joinShown): the stack it goes into is drawn open, and the keys stay on the
  // message acted on, brought into view with its join line. ⌘Z puts back how
  // far that stack was folded too. A join from anyone else opens nothing.
  joinConfirmed(entry, way, choice) {
    if (!choice || this.joinChoice(entry, way)?.token !== choice.token) return;
    const found = stackOf(this.list, entry);
    if (!found) return;
    const side = this.sideOf(found), shows = joinShown(side.stacks, side.index, way, entry.dataset.id);
    if (!shows) { this.say(way === 'up' ? 'No stack above to join' : 'No stack below to join'); return; }
    const state = this.state, was = state.levels.get(shows.open);
    // A dossier joins as a whole, as it is named and put aside (item 550): one whose first message the page has
    // not loaded is one stack of its branches here, and the join is sent for that first message, its loaded
    // messages shown at once where the stack it joins is, and back where they were at ⌘Z.
    const from = side.stacks[side.index], position = positionOf(from), root = position && position.root_id !== from.id ? this.rootOf(from) : null;
    const item = root?.item ?? this.messages().get(shows.act.id), before = this.actsOf(item.id, item).joined?.into ?? null;
    const members = root ? [from.head, ...from.replies].map(each => [each.id, this.messages().get(each.id)?.stack_position ?? null]) : [];
    const into = root && positionOf(joinOf(side.stacks, side.index, way));
    this.act('stack.join', item, { into: shows.act.into }, into ? members.map(([id]) => [id, { stack_position: into }]) : []);
    this.remember(() => {
      this.act('stack.join', item, { into: before }, members.map(([id, was]) => [id, { stack_position: was }]));
      if (was === undefined) state.levels.delete(shows.open); else state.levels.set(shows.open, was);
      this.arrange(); this.focusOn(item.id);
    });
    state.levels.set(shows.open, shows.level);
    this.arrange();
    this.focusOn(shows.select, { above: [...this.list.querySelectorAll('.stack-join-line')].find(line => line.dataset.join === item.id) });
    this.say(`Joined to the stack ${way === 'up' ? 'above' : 'below'}, for everyone here`);
  }
  split(shownItem, { anchorId = null } = {}) {
    const item = this.messages().get(shownItem.id) ?? shownItem;
    // Discovery can read a newer revision than the loaded copy. Keep that
    // exact admitted fact; the existing command/retry owner still fences it.
    item.acts = laterActs(item.acts, shownItem.acts);
    const before = this.actsOf(item.id, item).joined?.into ?? null;
    if (!before) return;
    this.act('stack.join', item, { into: null });
    const focus = () => this.focusOn(this.entryFor(item.id) ? item.id : anchorId ?? item.id);
    this.remember(() => { this.act('stack.join', item, { into: before }); this.arrange(); focus(); });
    this.arrange(); focus();
    this.say('Split back out into its own stack, for everyone here');
  }
  splitSources(item, show) {
    const found = this.entryFor(item.id) && stackOf(this.list, this.entryFor(item.id));
    if (!found || !this.readNamed) return;
    const rootId = dossierOf(found.stack), current = () => {
      const entry = this.entryFor(item.id), now = entry && stackOf(this.list, entry);
      return !this.gone && Boolean(now) && dossierOf(now.stack) === rootId;
    };
    return openSplitSources({ instanceId: this.instanceId, topicId: item.topic_id, rootId, read: this.readNamed,
      current, show, labelOf: source => source.acts?.name?.text ?? messagePreview(source), say: words => this.status(words),
      split: source => {
        if (!current()) return;
        const known = this.messages().get(source.id), acts = known && this.actsOf(source.id, known);
        if (acts && ((acts.join_revision ?? -1) > source.acts.join_revision ||
            acts.join_revision === source.acts.join_revision && acts.joined?.into !== source.acts.joined.into)) {
          this.status('This join changed. Open its menu again.'); return;
        }
        if (this.pending.get(source.id)?.some(mark => 'joined' in mark) || [...this.doubts.values()].some(act => act.kind === 'stack.join' && act.item.id === source.id)) {
          this.paintNotice(); return;
        }
        this.split(source, { anchorId: item.id });
      } });
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
      setLevel(state, stack, to.level, { save: true });
      this.arrange(); this.focusOn(entry.dataset.id);
    };
    if (way === 'fold') this.acted(entry.dataset.id);
    apply(next);
    this.say({ open: 'Original message and every reply shown', folded: 'Latest and unread replies shown' }[next.level]);
    return true;
  }
  // Folds a message to its one-line row (on true) or unfolds it, for the
  // reader on every device: their own act in Core (message.fold), shown at
  // once. A starred message is not folded. ⌘Z puts it back; focus: the message
  // takes the focus, so ⌘Z is at hand (not on a phone's swipe).
  setFold(item, on, { focus = true, undoable = true } = {}) {
    const acts = item && this.actsOf(item.id, item);
    if (on && acts?.folded && !acts.starred) {
      if (this.hasOpenCardReply(item.id) && this.closeReplyToFold) {
        const doc = this.list.ownerDocument, active = doc.activeElement;
        return Promise.resolve(this.closeReplyToFold(item.id)).then(closed => {
          if (!closed) return false;
          const current = this.actsOf(item.id, item);
          if (!current.folded || current.starred) return false;
          return this.applySavedFold(item, focus && (doc.activeElement === active || doc.activeElement === doc.body));
        }, error => this.refuseFold(error.message));
      }
      if (this.state.peeked.has(item.id)) {
        this.captureEmptyReply?.(item.id)?.();
        return this.applySavedFold(item, focus);
      }
    }
    const reason = this.foldReason(item, on);
    if (reason) return this.refuseFold(reason);
    if (Boolean(acts.folded) === on) return false;
    this.state.peeked.delete(item.id);
    const closeReply = on && this.captureEmptyReply?.(item.id);
    const sent = this.act('message.fold', item, { folded: on }, [], { committed: closeReply ? () => {
      if (this.actsOf(item.id, item).folded && closeReply()) this.arrange();
    } : null });
    if (undoable) this.remember(() => { this.setFold(item, !on, { undoable: false }); });
    // In motion (fold-motion.mjs): the message closes to its row, or opens out of it.
    foldInMotion(this.list.ownerDocument, () => this.entryFor(item.id), () => this.arrange(), on);
    if (focus) this.focusOn(item.id);
    this.say(on ? item.yours?.note === true ? NOTE_FOLD : 'Folded to one line, for you only' : 'Unfolded');
    return sent;
  }
  hasOpenCardReply(id) { return cardIn(this.entryFor(id))?.getAttribute('data-card-reply') != null; }
  applySavedFold(item, focus) {
    this.state.peeked.delete(item.id);
    foldInMotion(this.list.ownerDocument, () => this.entryFor(item.id), () => this.arrange(), true);
    if (focus) this.focusOn(item.id);
    if (item.yours?.note === true) this.say(NOTE_FOLD);
    return true;
  }
  foldReason(item, on) {
    if (!item) return 'Nothing to fold here';
    if (!on) return null;
    const acts = this.actsOf(item.id, item);
    if (acts.starred) return STARRED_FOLD_REASON;
    if (!acts.folded) return null;
    return item.yours?.note === true ? NOTE_FOLD : 'Already folded.';
  }
  refuseFold(reason) {
    this.status(reason); this.say(reason); return false;
  }
  // The bar's Fold (item 473), as ⋯ offers it: 'unfold' on a folded message,
  // 'fold' on one that is not, and null on a starred one (a star keeps a
  // message in view) or one no stack on the page holds.
  foldState(item) {
    if (!stackOf(this.list, this.entryFor(item.id))) return null;
    const acts = this.actsOf(item.id, item);
    if (acts.starred) return acts.folded ? 'unfold' : null;
    return acts.folded && !this.hasOpenCardReply(item.id) ? 'unfold' : 'fold';
  }
  toggleFold(item) {
    const state = this.foldState(item);
    if (state) this.setFold(item, state === 'fold');
  }
  // A link, search or Starred drew message id where its dossier sits, though
  // the dossier is put below More (reply-stacks.mjs, reveal; item 426). The
  // page reads Core's places again, and the dossier holds there while Core
  // holds it at the place that read finds, not one the page held from before
  // a move it had not yet heard of. A read that fails leaves the place the
  // page held when the link was followed. A move made here meanwhile (mark
  // no longer the one kept) has ended it already.
  landedBelow(id, mark) {
    this.refreshPositions().then(() => true, () => false).then(read => {
      if (this.state.here.get(id) !== mark) return;
      const found = stackOf(this.list, this.entryFor(id)), position = found && positionOf(found.stack);
      if (read && position?.below) mark.place = placeOf(position);
      mark.pending = false;
      this.arrange();
    });
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
    const replies = new Map();
    for (const each of shown) {
      this.state.peeked.delete(each.id);
      const close = this.captureEmptyReply?.(each.id);
      if (close) replies.set(each.id, close);
    }
    const committed = result => {
      let closed = false;
      for (const { message_id } of result.folds) {
        const close = replies.get(message_id);
        if (close && this.actsOf(message_id).folded && close()) closed = true;
      }
      if (closed) this.arrange();
    };
    const folded = this.act('message.fold_through', item, {}, shown.map(each => [each.id, { folded: true }]), { committed })
      .then(result => result.folds.map(({ message_id }) => this.messages().get(message_id) ?? this.standIns.get(message_id)));
    folded.then(each => {
      for (const one of each) this.settled(one.id);
      this.say(!each.length ? 'Nothing to fold' : each.some(one => one.yours?.note === true) ? 'Folds saved; messages with your private notes stay whole' : each.length === 1 ? 'Folded to one line, for you only' : `${each.length} messages folded to one line, for you only`);
    }, () => {});
    this.remember(() => folded.then(each => { for (const one of each) this.setFold(one, false, { focus: false, undoable: false }); }, () => {}));
    this.arrange();
    return true;
  }
  // The explicit gesture is saved through the same queue/retry/refusal path
  // as other personal acts. Undo restores the prior stored preference (null
  // means the applicable default), never a temporary link reveal or quiet head.
  setDossierLevel(stack, level, { undoable = true } = {}) {
    const root = this.rootOf(stack);
    this.state.levels.delete(stack.id);
    if (!root || !('level_revision' in root.position)) {
      this.say('Read this dossier again before changing its saved view');
      this.reread(); return false;
    }
    const before = this.actsOf(root.item.id, root.item).level ?? null;
    this.act('stack.level', root.item, { level }, [], { quiet: true });
    if (undoable) this.remember(() => {
      const current = this.state.stacks.find(each => positionOf(each)?.root_id === root.item.id);
      if (!current) { this.say('Read this dossier again before restoring its saved view'); this.reread(); return false; }
      this.setDossierLevel(current, before, { undoable: false }); this.arrange();
    });
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
    // A stand-in also holds the revisions its join and place are fenced on (item 550): a dossier's first message is
    // joined and placed by it.
    item.acts = laterActs(item.acts, { aside: position.through, aside_revision: position.aside_revision,
      ...('level_revision' in position ? { level: position.level, level_revision: position.level_revision } : {}),
      ...('name_revision' in position ? { name: position.name, name_revision: position.name_revision } : {}),
      ...(!this.messages().has(root) && 'join_revision' in position ? { join_revision: position.join_revision } : {}),
      ...(!this.messages().has(root) && 'place_revision' in position ? { placed: position.placed, place_revision: position.place_revision } : {}) });
    return { item, position };
  }
  // What the Reader's archive button offers for the dossier a message is in
  // (item 378): Archive, or Bring back once it is there, the same act
  // as ⋯'s (setAside), with how many of the page's messages go with it. The
  // act moves Core's whole dossier, which the page draws as one stack, its
  // first message loaded or not (item 550), and the older messages of it More
  // messages showed where its button was as cards of their own, so the count is
  // of every stack drawn from that dossier. Null where ⋯ offers neither: no
  // stack drawn holds the message, or Core sent no position for it.
  asideOffer(id) {
    const stack = this.state.stacks.find(each => each.id === id || each.replies.some(item => item.id === id));
    const position = stack && positionOf(stack);
    if (!position) return null;
    const dossier = this.state.stacks.filter(each => positionOf(each)?.root_id === position.root_id);
    return { stack, below: position.below, count: dossier.reduce((count, each) => count + 1 + each.replies.length, 0) };
  }
  // A hidden structural question still belongs to its surviving dossier.
  // Resolve it from the existing projection, without another record or cache.
  stackFor(id) {
    const holds = stack => stack.head.id === id || stack.replies.some(item => item.id === id);
    return this.state.stacks.find(holds) ?? this.state.stacks.find(stack =>
      stack.dossier === id || stack.sourceStack && holds(stack.sourceStack)) ?? null;
  }
  // A landing keeps an ordinary message's exact card. A structural question
  // omitted by the projection takes the first eligible visible card instead.
  landingEntry(id) {
    const stack = this.stackFor(id);
    if (!stack) return null;
    const items = [stack.head, ...stack.replies], only = shownView(this.state).only;
    const target = items.find(item => item.id === id) ?? items.find(item => !only || only(item));
    return target ? this.entryFor(target.id) : null;
  }
  // The name of the dossier a message is in, as its tab shows it (item 561):
  // the name typed or minted, or, for a dossier nobody named, its first line.
  // Null for a message of its own nobody named (a stack of one, which shows no
  // tab), for one no stack drawn holds, and (item 550) for a dossier nobody
  // named whose first message is not loaded, as no line on the page is its
  // first message's (app.mjs, readerDossierName).
  dossierName(id) {
    const stack = this.stackFor(id);
    if (!stack) return null;
    const head = headOf(stack, { preview: messagePreview });
    // A projected reply head already has its shown neutral name. Looking up
    // its hidden root would replace that name with the withdrawn words.
    return head.typed?.text || (stack.sourceStack || stack.replies.length && stack.dossier === stack.head.id ? head.name : '') || null;
  }
  // The cover of the dossier a message is in, as its folder shows it (item 624, stackCover: from its place when its
  // first message is not loaded), with the topic its links go to and the dossier's first message (rootId); null for a
  // message on its own unless alone is requested (the Reader), one no stack
  // drawn holds, and a dossier with no cover.
  dossierCover(id, { alone = false } = {}) {
    const stack = this.state.stacks.find(each => each.id === id || each.replies.some(item => item.id === id))
      ?? this.state.stacks.find(each => positionOf(each)?.root_id === id);
    const candidate = stack ? stackCover(stack, { alone: true }) : null;
    const cover = candidate?.items?.length ? candidate : stack ? stackCover(stack, { alone }) : null;
    return cover ? { cover, topicId: stack.head.topic_id, rootId: positionOf(stack)?.root_id ?? stack.head.id } : null;
  }
  // The archive shelf, at the foot of the right rail: none where the page has no right rail, and
  // there the feed keeps its own Archived (N).
  archiveShelf() {
    if (!this.shelf && !this.list.ownerDocument.getElementById('things')) return null;
    // Brought back from the shelf, the dossier keeps the keys, as the feed's own Bring back does.
    this.shelf ??= new ArchiveShelf({ doc: this.list.ownerDocument, unread: this.unread,
      restore: stack => {
        if (!this.setAside(stack, false)) return;
        // A new mark on the replica promises the feed's same exact-message
        // read, not just a restored dossier whose unread reply is still folded.
        const mark = this.state.sections?.get(stack.id)?.querySelector('.stack-new-action');
        if (mark) this.newest(stack, mark);
      }, undo: () => this.undo(),
      changed: drawn => { this.state.shelved = drawn; if (drawn) this.state.moreOpen = false; this.arrange(); this.moreChanged(); } });
    return this.shelf;
  }
  setAside(stack, below, { undoable = true, restoreThrough, restoreKey, focus = true, at = null } = {}) {
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
    // Core refuses it too, for a star the page has not read yet (made on another device): its reason is
    // said on the status line as any refusal is (failed), and the dossier shows where Core holds it.
    // The archive shelf's flight: a copy of the dossier as it sits now, before it moves.
    const flight = below ? this.archiveShelf()?.departing(this.state.sections?.get(stack.id)) ?? null : null;
    // Brought back from the shelf: where its replica sits now, for the flight back up.
    const from = !below ? this.shelf?.replicaRect(stack.id) ?? null : null;
    if (below) this.shelf?.putAway(stack.id); else this.shelf?.broughtBack(stack.id);
    this.act('stack.aside', item, { through, ...(typeof restoreKey === 'number' ? { key: restoreKey } : {}),
      ...(below && restoreThrough === undefined ? { clear_new: true } : {}) }, [], { quiet: true });
    if (undoable) this.remember(at => this.setAside(stack, position.through !== null, { undoable: false, restoreThrough: position.through, restoreKey: position.order_key, at }));
    closeUp(this.list, () => this.arrange());
    // Focus goes to More where the page's one view draws it (Only new does
    // not); there the dossier keeps it, on the first message the view draws.
    if (focus) {
      // Archived, it is on the shelf: the focus goes with it to its replica.
      const shelved = below ? this.shelf?.replicas.get(stack.id) : null;
      if (shelved?.isConnected && shelved.getClientRects().length) shelved.focus({ preventScroll: true });
      else if (below && this.state.more?.isConnected && !shownView(this.state).only) this.state.more.focus({ preventScroll: true });
      else this.focusOn(stack.id);
    }
    this.say(below ? 'Archived, for you only' : 'Brought back');
    if (flight) this.shelf.fly(flight, stack.id);
    if (from && this.state.sections?.get(stack.id)) this.shelf.back(from, this.state.sections.get(stack.id));
    return true;
  }
  // What a swipe over target acts on: the dossier as a whole on its title bar
  // (its head row or chevron, item 472), else the message under it.
  gestureTarget(target) {
    if (target?.closest?.('#reader')) return null;
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
    if (!gesture) return this.refuseFold('Nothing to fold here');
    if (gesture.whole && folds) return this.setAside(gesture.found.stack, true);
    if (gesture.whole && !folds && positionOf(gesture.found.stack)?.below) return this.setAside(gesture.found.stack, false);
    if (!gesture.item) return this.refuseFold('Nothing to fold here');
    return through && folds ? this.foldThrough(gesture.found.stack, gesture.item) : this.setFold(gesture.item, folds, { focus: false });
  }
  swiped(event) {
    const start = this.swipe;
    this.swipe = null;
    const touch = [...(event.changedTouches ?? [])].find(each => each.identifier === start?.id);
    const across = touch && start ? touch.clientX - start.x : 0;
    if (!start || this.doc.getSelection()?.isCollapsed === false || Math.abs(across) < 80 || Math.abs(touch.clientY - start.y) > 40) return;
    event.preventDefault();
    this.swipeAct(start.target, across > 0, event.altKey);
  }
  // Feed and Reader share the wheel burst. The action still belongs to
  // the surface and target where the gesture began.
  wheeled(event) {
    wheelSwipe(this.list, event, target => {
      if (!target || target.closest?.('#reader') || scrollsSideways(target, this.list)) return null;
      return (across, option) => { if (!this.gone) this.swipeAct(target, swipeFolds(across), option); };
    });
  }
  // Stack keys on a message or its chevron, never in writing. Plain arrows
  // open/fold first; the pane's document listener handles the boundary.
  key(event) {
    const at = this.doc.activeElement;
    if (writing(at) || at?.closest?.('input, textarea, select, [contenteditable]') ||
        event.target?.closest?.('input, textarea, select, [contenteditable]')) return;
    const action = keyAction(event);
    if (!FEED_ACTIONS.includes(action) || this.doc.querySelector('dialog[open]:not([data-card-reply])')) return;
    if (!at || !this.list.contains(at)) return;
    if (action === 'undo' && at === this.state.more) {
      event.preventDefault();
      this.undo(); return;
    }
    const toggle = at.classList?.contains('stack-toggle');
    const entry = toggle ? this.entryFor(at.closest('.reply-stack')?.dataset.stack) : entryOf(this.list, at);
    if (!entry || !(toggle || at === cardIn(entry) || at.classList?.contains('fold-line'))) return;
    // These commands change records or their fold, not the reading destination.
    // At a fold boundary the pane owner confirms any navigation separately.
    if (action === 'right' || action === 'left') {
      if (this.fold(entry, action === 'right' ? 'open' : 'fold')) event.preventDefault();
      return;
    }
    if (action === 'fold-message') return this.foldKey(event, entry, toggle);
    event.preventDefault();
    if (action === 'undo') return this.undo();
    // The shared map's Command-Right opens other panes; in the feed it
    // archives this dossier, including when its child message has the keys.
    if (action === 'open') {
      const found = stackOf(this.list, entry);
      return found ? this.setAside(found.stack, true) : false;
    }
    if (action === 'move-up' || action === 'move-down') return this.move(entry, action.slice(5));
    if (action === 'join-up' || action === 'join-down') return this.join(entry, action.slice(5), { anchor: at });
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
    this.setFold(item, !acts.folded || (!acts.starred && this.hasOpenCardReply(item.id)));
  }
  // What ⋯ offers for the stack a message is in, with the keys that do the
  // same and each item's glyph (glyphs.mjs, items 602 and 601); on a phone,
  // the stack's moves and joins sit behind "Move or join…".
  // first: what the message offers; last: its stack's moves and joins.
  menuItems(item, { phone = false, more = () => {}, reader = false, at = null, rename = act => act() } = {}) {
    const entry = this.entryFor(item.id), found = entry && stackOf(this.list, entry);
    const stack = found?.stack, level = stack && levelOf(this.state, stack.id);
    const line = () => at ?? lineOf(this.entryFor(item.id) && cardIn(this.entryFor(item.id)));
    const dossierStarred = found?.head && positionOf(stack)?.starred?.length > 0;
    const acts = this.actsOf(item.id, item);
    const folded = acts.folded && (acts.starred || !this.hasOpenCardReply(item.id));
    return stackMenuItems({ starred: dossierStarred || Boolean(acts.starred), folded,
      head: found?.head, hasReplies: Boolean(stack?.replies.length), position: stack && positionOf(stack), below: stack && positionOf(stack)?.below,
      found: Boolean(found), reader, phone, open: level === 'open', joined: stack?.joins.has(item.id), placed: stack?.placed != null,
      splitSources: Boolean(found && this.readNamed),
      undo: this.undos.length > 0, foldable: stack && foldStep({ level }, 'fold'), openable: stack && foldStep({ level }, 'open'),
      cover: found?.head && firstCoverMenuItem(this.list.ownerDocument, stack) }, (key, value) => {
      if (key === 'star') return dossierStarred ? this.unstarDossier(item, stack) : this.star(item);
      if (key === 'rename') return rename(() => this.startRename(stack));
      if (key === 'aside') return this.setAside(stack, value, { at: line(), focus: !reader });
      if (key === 'fold') return this.setFold(item, value, { focus: !reader });
      if (key === 'level') { setLevel(this.state, stack, value, { save: true }); this.arrange(); this.focusOn(stack.id); return; }
      if (key === 'split') return this.split(item);
      if (key === 'split-sources') return this.splitSources(item, more);
      if (key === 'move-up' || key === 'move-down') return this.move(entry, value);
      if (key === 'fold-stack' || key === 'open-stack') return this.fold(entry, value);
      if (key === 'join-up' || key === 'join-down') return this.join(entry, value);
      if (key === 'reset') return this.unplace(stack);
      if (key === 'undo') return this.undo(line());
      if (key === 'moves') return more(value);
    });
  }

  // Lands on a message, opening its stack (and, for its first message, the full words).
  land(id) {
    const entry = this.entryFor(id);
    if (!entry) return null;
    reveal(entry, { full: true });
    return this.entryFor(id);
  }
}
