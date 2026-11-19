// How a topic's loaded messages read as reply stacks (docs/reply-stacks.md):
// which stack each message is in, the order inside a stack and of the stacks,
// what a fold shows, which messages read as one line because the reader
// folded them, where the one New line goes, and what a move or a join
// sends. Nothing here touches the page or Core; reply-stacks.mjs draws what
// these answer and stack-feed.mjs sends the acts.
//
// A stack is a dossier as the page holds it: a message and every loaded reply
// to it, and to those replies, plus each stack someone joined to it, by the
// dossier Core names for each (item 550). The message it starts with (its head)
// stays at the top; every other message in it reads as a chat does, oldest
// first, a joined stack's among the rest, as one run. The
// stacks themselves follow Core's stable personal order (731). Incoming replies
// never lift one. Older Core responses without an order key retain the legacy
// activity ordering below.

// Acts recorded about a message (Core's message_acts, as topic_messages
// carries them): absent on a page from a Core before them, read as none.
const actsOf = item => item?.acts ?? {};

// Each act and the revision Core counts it by.
const REVISIONS = { aside: 'aside_revision', starred: 'star_revision', dealt: 'deal_revision', folded: 'fold_revision', placed: 'place_revision', name: 'name_revision', joined: 'join_revision', cover: 'cover_revision', cover_refresh: 'cover_refresh_revision' };

// What Core holds of a message's acts, from what the page knew and an answer
// it read or was given since: each act as the later of the two by its
// revision, so an answer read before a commit never puts back what that
// commit changed, whenever it lands. Fields the page does not know are the
// answer's.
export function laterActs(known, answer) {
  if (!answer) return known ?? {};
  const acts = { ...(known ?? {}), ...answer };
  for (const [field, revision] of Object.entries(REVISIONS)) {
    if (!known || !(revision in known)) continue;
    if (!(revision in answer) || answer[revision] < known[revision]) { acts[field] = known[field]; acts[revision] = known[revision]; }
  }
  if (acts.cover) acts.cover = { ...acts.cover, refresh: acts.cover_refresh ?? acts.cover.refresh,
    refresh_revision: acts.cover_refresh_revision ?? acts.cover.refresh_revision };
  return acts;
}

// The message each one hangs under on the page: the message it was joined to,
// else the one it answers, when that is loaded; null for a stack's head.
function parentOf(item, has) {
  const joined = actsOf(item).joined;
  if (joined?.into) return has(joined.into) ? { id: joined.into, joined } : null;
  return item.reply_to && has(item.reply_to) ? { id: item.reply_to, joined: null } : null;
}

// What each loaded message (items) hangs under on the page: up(id), its parent
// there (parentOf) or null; has(id): whether a message is on the page, skip(id):
// one that is but heads nothing and is under nothing. Core refuses a join that
// would loop; a loop the page still meets (from rows read at different moments)
// is cut at its newest message.
function links(items, has, skip) {
  const byId = new Map(items.map(item => [item.id, item]));
  const on = id => (has ? has(id) : byId.has(id)) && !skip(id);
  const parent = new Map(items.map(item => [item.id, parentOf(item, on)]));
  const up = id => { const next = parent.get(id); return next && byId.has(next.id) ? next : null; };
  for (const item of items) {
    const path = [item.id];
    for (let next = up(item.id); next; next = up(path.at(-1))) {
      const back = path.indexOf(next.id);
      if (back < 0) { path.push(next.id); continue; }
      const loop = path.slice(back).map(id => byId.get(id)).sort((a, b) => b.seq - a.seq);
      parent.set(loop[0].id, null);
      break;
    }
  }
  return { byId, up };
}

// Item 550: the dossier each loaded message is in, as a Map of its id to the
// id of the dossier's first message. Core's position on a message names it
// (stack_position.root_id), and the page takes it as Core says: it never works
// a dossier out from what it has loaded, so loading more of a dossier moves no
// message into another. A message under another the page holds (it answers
// it, or was joined to it, by the acts the page shows) is in that one's
// dossier, as Core places it too, so a join or a split the page shows before
// Core's positions are read again puts its messages where the act does (item
// 470). One that hangs under nothing (a dossier's first message), whose own
// join or split is not yet answered (moving, stack-feed.mjs) or that carries
// no position (a Core before positions) is its own dossier's first message.
// has, filled, apart: as gather takes them.
export function dossiersOf(items, { has = null, filled = new Set(), apart = new Set() } = {}) {
  return dossiers(items, links(items, has, id => filled.has(id) || apart.has(id)));
}
function dossiers(items, { byId, up }) {
  const found = new Map();
  const of = (id, seen) => {
    if (found.has(id)) return found.get(id);
    if (seen.has(id)) return id;
    seen.add(id);
    const item = byId.get(id), parent = up(id), root = item.stack_position?.root_id;
    const hangs = Boolean(actsOf(item).joined?.into || item.reply_to);
    const dossier = parent ? of(parent.id, seen) : !root || !hangs || item.moving ? id : root !== id && byId.has(root) ? of(root, seen) : root;
    found.set(id, dossier);
    return dossier;
  };
  for (const item of items) of(item.id, new Set());
  return found;
}

// Gathers the loaded messages (items: topic_messages items, has(id): whether
// a message is on the page; viewer: who reads) into stacks, one for each
// dossier (dossiersOf). Each stack: { id: its head's id, head, replies: every
// other message in reading order, joins: Map of the id of each joined stack's
// first message to its join ({ into, by, at_ms }), newest: the newest seq in
// it, lifted: the newest seq that lifts it, any but a reply of the viewer's
// own (a stack joined to it lifts it however it began), placed: the reader's
// own place for it or null, dossier: the id of its dossier's first message }.
// Its head is that first message where the page holds it. Where the page does
// not, the stack is gathered (item 550): its head is the oldest of its
// messages that hang under none the page holds, as each such one was a card of
// its own before 550, and not a reply of the reader's own while another can
// be, so that reply keeps its own style; the others are its branches, a Set,
// each kept in view when it is folded (shown), and the head shows whole too
// (reply-stacks.mjs); null where the stack is not gathered. A place is the
// dossier's, as its name is (item 550): where the stack's head is not its first
// message, the place is the one Core's position carries for that first
// message; where that carries none, the place set last on another of its
// messages sorts it (heldPlace).
// Item 550: what More messages loads shows where its button was
// (reply-stacks.mjs, fill). filled: the ids of older messages it loaded of the
// dossier of the stack shown last above it, which show at that stack's end,
// under what it showed, newest first, never folded away and never its head;
// apart: those of any other dossier the page drew then, each a card of its own
// there, which takes no place. Neither heads anything or is under anything,
// so nothing shown moves. A stack carries those at its end as filled, a Set.
export function gather(items, { has = null, viewer = null, filled = new Set(), apart = new Set() } = {}) {
  const { byId, up } = links(items, has, id => filled.has(id) || apart.has(id)), dossier = dossiers(items, { byId, up });
  const groups = new Map();
  for (const item of items) {
    const key = apart.has(item.id) ? item : dossier.get(item.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const oldest = list => list.reduce((most, item) => (item.seq < most.seq ? item : most));
  return [...groups].map(([key, members]) => {
    const root = dossier.get(members[0].id), fresh = members.filter(item => !filled.has(item.id)), tops = fresh.filter(item => !up(item.id));
    const theirs = tops.filter(item => viewer === null || item.author_id !== viewer);
    const head = fresh.find(item => item.id === root) ?? oldest(theirs.length ? theirs : tops.length ? tops : fresh.length ? fresh : members);
    // Every message under the head as one run, oldest first: its replies, each
    // stack joined to it and the replies to those, however deep. A join
    // changes no message, so splitting it out puts both stacks back as they were.
    // The older messages Earlier messages filled it with follow, newest first.
    const late = members.filter(item => item.id !== head.id && filled.has(item.id)).sort((a, b) => b.seq - a.seq);
    const replies = [...members.filter(item => item.id !== head.id && !filled.has(item.id)).sort((a, b) => a.seq - b.seq), ...late];
    const joins = new Map(replies.filter(item => up(item.id)?.joined).map(item => [item.id, up(item.id).joined]));
    const position = positionOf({ head, replies, dossier: root }), byRoot = position && position.root_id !== head.id && 'place_revision' in position;
    const first = byRoot ? position.placed : actsOf(head).placed, place = typeof first === 'number' ? first : heldPlace(position);
    // A card of its own that More loaded (apart) takes no place: it shows where the button was.
    const alone = apart.has(head.id), placed = !alone && typeof place === 'number' ? place : null;
    const newest = list => list.reduce((most, item) => Math.max(most, item.seq), 0);
    const own = item => item.id !== head.id && !joins.has(item.id) && viewer !== null && item.author_id === viewer;
    return { id: head.id, head, replies, joins, newest: newest(members), lifted: newest(members.filter(item => !own(item))), placed: typeof position?.order_key === 'number' && position.order_key !== placed ? null : placed, dossier: root, orderKey: alone ? null : position?.order_key, orderTie: position?.order_tie,
      filled: new Set(late.map(item => item.id)), branches: head.id === root || alone ? null : new Set(tops.filter(item => item !== head).map(item => item.id)) };
  });
}

// Item 550: before a dossier was placed on its first message, a stack was
// placed on the message heading it, a reply or a stack later joined into the
// dossier. Core's position lists the reader's own places on the dossier's
// other messages (places, each with when it was set, at_ms); the one set last
// is the dossier's, loaded or not, whichever message heads its stack. Null
// where it lists none, and where Core sends no such list.
function heldPlace(position) {
  const held = (position?.places ?? []).filter(each => typeof each.placed === 'number');
  return held.reduce((latest, each) => (latest === null || each.at_ms > latest.at_ms ? each : latest), null)?.placed ?? null;
}

// Item 550: what the page keeps of a stack for this visit (how far it is
// open, its earlier-messages row, the first of the seven it shows) is the
// dossier's. A dossier's stack can take another head as the page holds more
// of it (its first message read with a later page, or a reply of someone
// else's where every reply was the reader's own). Answers a Map of each
// stack's head before (before: the stacks as last gathered) to the head of its
// dossier's stack now (after), for each stack whose head no longer heads one;
// a head that still heads a stack keeps its own, so a join, which puts one
// dossier into another, carries nothing.
export function reheaded(before, after) {
  const now = new Map(), heads = new Set(after.map(stack => stack.id));
  for (const stack of after) if (!now.has(stack.dossier)) now.set(stack.dossier, stack.id);
  return new Map(before.filter(stack => !heads.has(stack.id) && now.has(stack.dossier)).map(stack => [stack.id, now.get(stack.dossier)]));
}

// Where a stack sorts: its own place, else its newest message that lifts it.
export const keyOf = stack => stack.orderKey ?? stack.placed ?? stack.lifted;

// The stacks newest on top, each placed one where the reader put it.
export function ordered(stacks) {
  return [...stacks].sort((a, b) => keyOf(b) - keyOf(a) || (b.orderTie ?? b.lifted) - (a.orderTie ?? a.lifted));
}

// The two stack states a person steps between (item 394): latest plus unread
// replies, and original message plus every reply. The original has no
// independent state. 'head', the header alone, is only how a quiet agent
// dossier begins (docs/reply-stacks.md, 359), never a step back to.
export const LEVELS = ['folded', 'open'];

// Item 476: an open dossier shows its newest RECENT messages, and one row for
// the rest. The messages that row stands for, top to bottom as the stack reads
// (its first message, then its replies oldest first): all but the last RECENT,
// at the open level only; none in a dossier of RECENT or fewer, and none at
// latest plus unread, which shows what it always did. A way of showing the
// dossier, never recorded: every message stays in it, where it sits.
// held: the id of the first message the dossier showed when the page drew it
// open (reply-stacks.mjs), so the seven are counted once: a message arriving
// after that hides nothing (docs/experience-guidelines.md, "Your place holds"),
// and one loaded from before goes behind the row. Held gone from the dossier,
// they are counted afresh.
export const RECENT = 7;
export function earlierOf(stack, level, { held = null } = {}) {
  // What Earlier messages filled the stack with shows at its end, never behind the row (gather, filled).
  const all = [stack.head, ...stack.replies].filter(item => !stack.filled?.has(item.id));
  if (level !== 'open') return [];
  const at = held === null ? -1 : all.findIndex(item => item.id === held);
  if (at >= 0) return all.slice(0, at);
  return all.length > RECENT ? all.slice(0, all.length - RECENT) : [];
}

// Whether a reply shows at the stack's level. A reader's stars stay visible;
// kept(item) holds replies that were unread or starred when this partial view
// drew them (reply-stacks.mjs). A fold never decides this:
// a folded reply shows where it would, as its one-line row (rowFolded). Open,
// an earlier reply (earlierOf, held) shows once its row was opened (earlier).
// Item 550: what Earlier messages filled the stack with always shows (gather,
// filled), and folded, a stack gathered from branches under a first message
// the page has not loaded keeps each branch's head in view (branches): before
// 550 each was a stack of its own, its card in view, and a fold loses none.
export function shown(stack, item, { level = 'folded', kept = () => false, earlier = false, held = null } = {}) {
  if (stack.filled?.has(item.id)) return true;
  if (!earlier && earlierOf(stack, level, { held }).includes(item)) return false;
  if (level === 'open') return true;
  if (level === 'head') return false;
  return actsOf(item).starred === true || kept(item) || item.seq === newestReply(stack) || Boolean(stack.branches?.has(item.id));
}

// Whether a message reads as its one-line row: the reader folded it (their
// own act, kept in Core), it is not starred (a star keeps a message in view),
// and it was not opened for this view by a link, search or Starred
// (peeked(item)), which shows it whole without unfolding it.
export function rowFolded(item, { peeked = () => false } = {}) {
  const acts = actsOf(item);
  return acts.folded === true && acts.starred !== true && !peeked(item);
}
const newestReply = stack => stack.replies.reduce((most, item) => Math.max(most, item.seq), 0);

const replies = n => (n === 1 ? 'reply' : 'replies');
const messages = n => (n === 1 ? 'message' : 'messages');
// What a stack shows under its head, top to bottom: { kind: 'reply', item },
// { kind: 'join', item, join } just before a joined stack's first message, and
// { kind: 'fold', items, words, fresh } for each run of replies folded away
// where it sits, so a reply kept in view never reads as inside the fold.
// unread(item): whether a folded reply counts as new on its line. A reply row
// says whether it reads as its one-line row (folded, rowFolded). Open, a
// dossier of more than RECENT messages begins with { kind: 'earlier', items,
// words, fresh }, one row for its earlier messages (earlierOf, the first
// message among them, held as earlierOf takes it), and their replies are
// drawn only once it is opened (earlier), each { kind: 'reply', item,
// earlier: true } in its place.
export function rowsOf(stack, { level = 'folded', kept, unread = () => false, peeked = () => false, earlier = false, held = null } = {}) {
  const rows = [], all = stack.replies, show = item => shown(stack, item, { level, kept, earlier, held });
  const earliest = earlierOf(stack, level, { held });
  if (earliest.length && !earlier) rows.push({ kind: 'earlier', items: earliest, words: `${earliest.length} earlier ${messages(earliest.length)}`, fresh: earliest.filter(unread).length });
  let run = [], before = true;
  const flush = () => {
    if (!run.length) return;
    const n = run.length, fresh = run.filter(unread).length;
    const words = n === all.length ? `${n} ${replies(n)}` : `${n} ${before ? 'earlier' : 'more'} ${replies(n)}`;
    rows.push({ kind: 'fold', items: run, words, fresh });
    run = [];
  };
  for (const item of all) {
    if (!show(item)) { if (!earliest.includes(item)) run.push(item); continue; }
    flush(); before = false;
    if (stack.joins.has(item.id)) rows.push({ kind: 'join', item, join: stack.joins.get(item.id) });
    rows.push({ kind: 'reply', item, folded: rowFolded(item, { peeked }) });
    if (earliest.includes(item)) rows[rows.length - 1].earlier = true;
  }
  flush();
  return rows;
}

// A stack's head row: its name (the short name someone typed, else its first
// message shown by one line, preview: message-preview.mjs), who replied in the order they first did,
// and what is new: the head itself, or how many replies. The typed name is the dossier's (item 470): its
// first message's, which Core sends with the position of every message in it,
// so a page holding only replies shows it too; where the page holds that
// message, its own acts say it. mintedBy: the agent that minted the name
// (item 479), which the row says as "Named by"; null for a typed name or none.
export function headOf(stack, { preview = item => String(item.body ?? '').split('\n')[0], unread = () => false } = {}) {
  const position = positionOf(stack);
  const typed = position && position.root_id !== stack.head.id && 'name' in position ? position.name : actsOf(stack.head).name;
  const repliers = [];
  for (const item of stack.replies) if (!repliers.includes(item.author_id)) repliers.push(item.author_id);
  const headNew = unread(stack.head);
  return { name: typed?.text || preview(stack.head), typed: typed ?? null, mintedBy: typed?.text && typed.minted === true ? typed.by : null, count: stack.replies.length, repliers,
    headNew, fresh: headNew ? 0 : stack.replies.filter(unread).length };
}

// A dossier's cover (item 624), on its name's terms: its first message's,
// which Core sends with the position of every message in it, so a stack of
// replies whose first message is above the loaded page shows it under its
// tab too; where the page holds that message, its own acts say it. Null for a
// dossier with none, and for a message on its own unless alone: true asks for
// the cover its pills show (dossier-cover.mjs).
export function stackCover(stack, { alone = false } = {}) {
  const position = positionOf(stack);
  if (position && position.root_id !== stack.head.id) return position.cover ?? null;
  return stack.replies.length || alone ? actsOf(stack.head).cover ?? null : null;
}

// The index, in the stacks as shown, of the lowest one holding anything new
// since the line's message (lineSeq): the line goes under it, so it never
// cuts a stack in two and never sits above something new. A message of the
// reader's own is not new to them. Null when the line's message is not
// loaded: the line then waits at the bottom for what loads it (unanswered.mjs).
export function lineUnder(stacks, lineSeq, viewer) {
  if (!lineSeq || !stacks.some(stack => stack.head.seq === lineSeq || stack.replies.some(item => item.seq === lineSeq))) return null;
  const fresh = item => item.seq === lineSeq || item.seq > lineSeq && item.author_id !== viewer;
  let at = null;
  stacks.forEach((stack, index) => { if (fresh(stack.head) || stack.replies.some(fresh)) at = index; });
  return at;
}

// What a move of the stack at index sends, in the stacks as shown: a place of
// its own just past its neighbour that way ('up' or 'down'), as [{ id, key }].
// Where no number fits between the two (the same place twice), the neighbour
// trades places with it, so both are placed. Null at either end, or when even
// that would not move it.
export function moveOf(stacks, index, way) {
  const step = way === 'up' ? -1 : 1, next = stacks[index + step], beyond = stacks[index + 2 * step];
  if (!next || !stacks[index]) return null;
  const near = keyOf(next), far = beyond ? keyOf(beyond) : near - step * 2;
  const key = (near + far) / 2;
  if (way === 'up' ? key > near && key < far : key < near && key > far) return [{ id: stacks[index].id, key }];
  const mine = keyOf(stacks[index]);
  if (mine === near) return null;
  return [{ id: stacks[index].id, key: near }, { id: next.id, key: mine }];
}

// The stacks in the order the page shows them, top to bottom, More messages a
// boundary: those drawn above More in their order, then those drawn below it
// in theirs. view.below(stack): drawn below More; view.hidden(stack): drawn
// but not on show (below More while it is closed, or agent coordination while
// Show agent coordination is off), and left out. Every step from a stack to
// the one beside it (a move, a join, the Reader's ↑ and ↓) reads this, never
// the stacks in their own order, which still hold the ones put aside.
export function shownOrder(stacks, view) {
  return [...stacks.filter(each => !view.below(each)), ...stacks.filter(each => view.below(each))].filter(each => !view.hidden(each));
}

// Whether a stack is drawn below More: Core holds it put aside, and no
// message of it is drawn where it sits for this view. here(item): the place
// (placeOf) Core held for the dossier when a link, search or Starred drew item
// where it sits, or nothing. That holds only while Core still holds the
// dossier at that place: a later Move below More or Bring back, from any
// device, is another place, and the dossier is drawn as Core now holds it.
export function drawnBelow(stack, here = () => null) {
  const position = positionOf(stack);
  if (!position?.below) return false;
  const place = placeOf(position);
  return ![stack.head, ...stack.replies].some(item => here(item) === place);
}

// The dossier a stack is drawn from: Core's first message of it (positionOf),
// or the stack's own head where Core sent no position. A dossier whose first
// message the page has not loaded is drawn as more than one stack.
export const dossierOf = stack => positionOf(stack)?.root_id ?? stack.id;

// The dossiers the reader starred a message in (item 635), by dossierOf: one
// a stack drawn from it shows a starred message of (its acts as the page shows
// them), or one whose position names a message the reader starred that the
// page has not loaded (has(id), Core's word for the rest). Its title bar shows
// the reader's star, and Move below More is refused while it does.
export function starredDossiers(stacks, has) {
  const found = new Set();
  for (const stack of stacks) {
    const position = positionOf(stack);
    if ([stack.head, ...stack.replies].some(item => actsOf(item).starred === true) || (position?.starred ?? []).some(id => !has(id))) found.add(dossierOf(stack));
  }
  return found;
}

// A dossier's place as Core holds it for the reader (positionOf): its first
// message and the revision of their stack.aside act on it, which each Move
// below More and Bring back that changes it raises, made on any device. Acts
// on other messages and new messages leave it the same place.
export const placeOf = position => (position ? `${position.root_id}:${position.aside_revision ?? 0}` : null);

// The page as stepping reads it: all, every message the page has where it
// sits, top to bottom, those not on show included (readingOrder of the stacks
// above More, then below it); order, those of them on show (view.hidden), and
// with view.only (the Conversation's Only new) just the messages it draws;
// shown, their ids; loaded, the ids of all; hiddenRoots, the dossier (Core's
// root_id) of each stack drawn but not on show; asideShown, whether a dossier
// put below More is on show (More open, or Only new).
export function pageOf(stacks, view) {
  const all = readingOrder(shownOrder(stacks, { below: view.below, hidden: () => false }));
  const hiddenRoots = new Set(stacks.filter(stack => view.hidden(stack)).flatMap(stack => [stack.id, positionOf(stack)?.root_id ?? stack.id]));
  const order = readingOrder(shownOrder(stacks, view)).filter(item => !view.only || view.only(item));
  return { all, order, shown: new Set(order.map(item => item.id)), loaded: new Set(all.map(item => item.id)),
    hiddenRoots, asideShown: Boolean(view.asideShown), only: view.only ?? null };
}

// The one exit for every step from a message or a stack to one beside it: the
// Reader's ↑ and ↓ and their keys, a phone's ↑ Previous and ↓ Next, a move
// and a join. A candidate ({ id, position? }, a message or a stack by its
// first message) leaves when the page shows it. One the page has loaded and
// does not show never does. One it has not loaded (Core's neighbour beyond
// what the page loaded) leaves unless the page knows it is not on show: its
// dossier is one the page holds hidden, or Core's position for it
// (topic_messages' stack_position) puts it below More while More is closed,
// or Only new is on and the page does not know it as New.
// Null for none.
export function stepTarget(candidate, page) {
  if (!candidate) return null;
  if (page.shown.has(candidate.id)) return candidate;
  if (page.loaded.has(candidate.id)) return null;
  const position = candidate.position ?? null;
  if (page.hiddenRoots.has(position?.root_id ?? candidate.id) || (position?.below && !page.asideShown)) return null;
  if (page.only && !page.only(candidate)) return null;
  return candidate;
}

// The Reader's neighbours of current (its source_ref), from Core's (core:
// { next, previous }, next the one above) and the page: from where current
// sits on the page, on show or not (opened by Read it or a link, put aside on
// another device while open, not drawn by Only new), the nearest message on
// show that way, and beyond either end of what shows only a message the page
// has not loaded. With current not loaded here, Core's neighbours are the
// candidates. Every one leaves through stepTarget. page null: current is
// another topic's, which this page's view does not hold, and Core's
// neighbours step as they are.
export function readerSteps(current, core, page) {
  const ref = item => item ? { kind: 'message', id: item.id } : null;
  if (!page) return { next: ref(core?.next), previous: ref(core?.previous) };
  const at = current?.kind === 'message' ? page.all.findIndex(item => item.id === current.id) : -1;
  const onShow = item => page.shown.has(item.id), beyond = other => other && !page.loaded.has(other.id) ? other : null;
  const next = at < 0 ? core?.next : page.all.slice(0, at).findLast(onShow) ?? beyond(core?.next);
  const previous = at < 0 ? core?.previous : page.all.slice(at + 1).find(onShow) ?? beyond(core?.previous);
  // A source ref is { kind, id } alone: Core's position only decides the step.
  return { next: ref(stepTarget(next ?? null, page)), previous: ref(stepTarget(previous ?? null, page)) };
}

// The stacks a move or a join of the stack at index steps among: those on its
// side of More, in order, each with a message the page shows (pageOf), with
// its index among them. More is a boundary, so a stack never moves or joins
// past it into a dossier the reader put aside, nor out of one, nor into a
// stack not on show.
export function sideOf(stacks, index, view) {
  const stack = stacks[index];
  if (!stack) throw Error(`No stack at ${index}.`);
  const page = pageOf(stacks, view), onShow = each => [each.head, ...each.replies].some(item => page.shown.has(item.id));
  const among = stacks.filter(each => each === stack || (view.below(each) === view.below(stack) && onShow(each)));
  return { stacks: among, index: among.indexOf(stack) };
}

// The stack a join of the stack at index goes into: its neighbour that way.
export function joinOf(stacks, index, way) {
  return stacks[index + (way === 'up' ? -1 : 1)] ?? null;
}

// What a join the reader makes, from the message acted on in the stack at
// index, shows at once: { act: { id, into }, what is sent for the stack's
// first message; open: the stack it goes into, which heads the two together,
// drawn at level, open, so its head shows whole and the joined messages show
// under their join line; select: the message acted on, which keeps the
// selection in its new place }. Null with no neighbour that way. A join that
// reaches the page from anyone else, or from another device, opens nothing.
export function joinShown(stacks, index, way, acted) {
  const from = stacks[index], into = joinOf(stacks, index, way);
  if (!from) throw Error(`No stack at ${index} to join.`);
  if (acted !== from.id && !from.replies.some(item => item.id === acted)) throw Error(`A join is made from a message in the stack it joins, not ${acted}.`);
  if (!into) return null;
  return { act: { id: from.id, into: into.id }, open: into.id, level: 'open', select: acted };
}

// Every message of stacks, top to bottom: each stack's head, then its
// replies, folded ones included. Of the stacks as shown (shownOrder), it is
// the order the Reader's ↑ and ↓ step along, as the eye goes down the page.
export function readingOrder(stacks) {
  return stacks.flatMap(stack => [stack.head, ...stack.replies]);
}

// The next of the two states for → or ←, independent of which message has
// focus; a quiet agent dossier's header alone stands before the first. Null
// when there is no further step that way.
export function foldStep({ level }, way, { replies: has = true } = {}) {
  const at = level === 'head' ? -1 : LEVELS.indexOf(level);
  const next = at + (way === 'open' ? 1 : -1);
  return has && next >= 0 && next < LEVELS.length ? { level: LEVELS[next] } : null;
}

// A position is read at a snapshot: the newest act in the topic the reader
// hears of, then the newest message they can see in the dossier. Acts only
// grow, and while they stand still a dossier only gains messages, so the later
// read has more acts, or as many and more messages. A split may leave the
// dossier fewer messages, but the split is a later act. An old page cannot
// undo a newer join, personal move, split or arriving reply.
export function laterPosition(known, answer) {
  if (!answer) return known;
  if (known && (answer.at.acts < known.at.acts || answer.at.acts === known.at.acts && answer.at.messages < known.at.messages)) return known;
  return answer;
}
// The stack's position, from the positions its messages carry. One is the
// stack's only where it names the stack's dossier (gather's dossier, item
// 550); for a stack gather did not make, where the page's own reading of it
// agrees (item 470): it names the head, or the head hangs under a message the
// page has not loaded and it names none in the stack. A join or a split,
// before Core answers it and until its messages are read again, leaves the
// positions Core sent before it on the messages it moved; such a position is
// another dossier's, and null where none fits.
export function positionOf(stack) {
  const inside = new Set(stack.replies.map(item => item.id));
  const hangs = Boolean(actsOf(stack.head).joined?.into || stack.head.reply_to);
  const fits = position => ('dossier' in stack ? position.root_id === stack.dossier : position.root_id === stack.head.id || hangs && !inside.has(position.root_id));
  return [stack.head, ...stack.replies].map(item => item.stack_position).filter(position => position && fits(position))
    .reduce((known, next) => laterPosition(known, next), null);
}

// Item 799. Admitted heads are a separate, visit-scoped presentation cache.
// They never enter the topic's loaded runs or pagination frontiers.
export class DossierHeads {
  constructor({ topicId, read, changed = () => {}, current = () => true }) {
    Object.assign(this, { topicId, read, changed, current });
    this.records = new Map(); this.serial = 0;
  }
  invalidate(id = null) {
    for (const [root, record] of this.records) if (id === null || root === id) {
      this.records.delete(root); ++this.serial;
    }
  }
  sync(messages) {
    const wanted = new Set([...dossiersOf([...messages.values()]).values()].filter(id => !messages.has(id)));
    for (const id of this.records.keys()) if (!wanted.has(id)) this.records.delete(id);
    for (const id of wanted) if (!this.records.has(id)) {
      const record = { state: 'loading', token: ++this.serial };
      this.records.set(id, record);
      Promise.resolve().then(() => this.read('topic_messages', { topic_id: this.topicId, message_ids: [id] })).then(page => {
        if (!this.current() || this.records.get(id) !== record) return;
        if (!Array.isArray(page.items)) throw Error('The dossier source could not be read.');
        const item = page.items.find(item => item.id === id);
        if (item && (item.topic_id !== this.topicId || item.stack_position?.root_id !== id)) throw Error('The dossier source identity changed.');
        Object.assign(record, item?.withheld ? { state: 'refused' } : item ? { state: 'available', item: { ...item, dossierSource: true } } : { state: 'missing' });
        this.changed();
      }).catch(error => {
        if (!this.current() || this.records.get(id) !== record) return;
        record.state = ['FORBIDDEN', 'SOURCE_UNAVAILABLE', 'NOT_FOUND', 'INVALID_ARGUMENT'].includes(error?.details?.error?.code) ? 'refused' : 'error';
        this.changed();
      });
    }
  }
  messages(loaded) {
    const result = new Map(loaded);
    for (const [id, record] of this.records) if (record.state === 'available' && !result.has(id)) result.set(id, record.item);
    return result;
  }
}

// Decorate only after gathering/ordering the actual loaded page. A fetched
// head contributes neither a sorting key nor an implied intervening message.
export function withDossierHeads(stacks, sources, { apart = new Set(), sourceRoots = new Set() } = {}) {
  return stacks.map(stack => {
    const root = sources.get(stack.dossier);
    if (!root || !root.dossierSource && !sourceRoots.has(root.id) || stack.id === stack.dossier || apart.has(stack.id)) return stack;
    return { ...stack, id: root.id, head: root, replies: [stack.head, ...stack.replies],
      branches: new Set([stack.head.id, ...(stack.branches ?? [])]), sourceHead: true };
  });
}
