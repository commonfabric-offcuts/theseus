// How a topic's loaded messages read as reply stacks (docs/reply-stacks.md):
// which stack each message is in, the order inside a stack and of the stacks,
// what a fold shows, which messages read as one line because the reader
// folded them, where the one New line goes, and what a move or a join
// sends. Nothing here touches the page or Core; reply-stacks.mjs draws what
// these answer and stack-feed.mjs sends the acts.
//
// A stack is a message and every loaded reply to it, and to those replies,
// plus each stack someone joined to it. The message it starts with (its head)
// stays at the top; every other message in it reads as a chat does, oldest
// first, a joined stack's among the rest, as one run. The
// stacks themselves keep the topic newest on top: each sits where its newest
// message would, unless the reader placed it somewhere of their own, where it
// holds whatever replies arrive. A reply of the reader's own never lifts it:
// what they answer stays where they were reading it.

// Acts recorded about a message (Core's message_acts, as topic_messages
// carries them): absent on a page from a Core before them, read as none.
const actsOf = item => item?.acts ?? {};

// Each act and the revision Core counts it by.
const REVISIONS = { aside: 'aside_revision', starred: 'star_revision', dealt: 'deal_revision', folded: 'fold_revision', placed: 'place_revision', name: 'name_revision', joined: 'join_revision' };

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
  return acts;
}

// The message each one hangs under on the page: the message it was joined to,
// else the one it answers, when that is loaded; null for a stack's head.
function parentOf(item, has) {
  const joined = actsOf(item).joined;
  if (joined?.into) return has(joined.into) ? { id: joined.into, joined } : null;
  return item.reply_to && has(item.reply_to) ? { id: item.reply_to, joined: null } : null;
}

// Gathers the loaded messages (items: topic_messages items, has(id): whether
// a message is on the page; viewer: who reads) into stacks. Each stack: { id:
// its head's id, head, replies: every other message in reading order, joins:
// Map of the id of each joined stack's first message to its join ({ into, by,
// at_ms }), newest: the newest seq in it, lifted: the newest seq that lifts it,
// any but a reply of the viewer's own (a stack joined to it lifts it however
// it began), placed: the reader's own place for it or null, dossier: the id
// of the dossier's first message as Core's position names it, else its head's }.
// A place is the dossier's, as its name is (item 550): where the stack's head
// is not its first message, the place is the one Core's position carries for
// that first message, so loading more of the dossier, which can give its stack
// another head, keeps it.
export function gather(items, { has = null, viewer = null } = {}) {
  const byId = new Map(items.map(item => [item.id, item]));
  const on = has ?? (id => byId.has(id));
  const parent = new Map(items.map(item => [item.id, parentOf(item, on)]));
  const up = id => { const next = parent.get(id); return next && byId.has(next.id) ? next : null; };
  // Core refuses a join that would loop; a loop the page still meets (from
  // rows read at different moments) is cut at its newest message, which then
  // heads its own stack.
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
  // The head each message is under.
  const headOf = new Map();
  for (const item of items) {
    let at = item.id;
    for (let next = up(at); next; next = up(at)) at = next.id;
    headOf.set(item.id, at);
  }
  const branches = new Map();
  for (const item of items) {
    const head = headOf.get(item.id);
    if (!branches.has(head)) branches.set(head, { id: head, head: byId.get(head), members: [], joins: new Map() });
    branches.get(head).members.push(item);
    if (item.id !== head && up(item.id)?.joined) branches.get(head).joins.set(item.id, up(item.id).joined);
  }
  return dossiers(branches, id => headOf.get(id)).map(({ head, members, joins }) => {
    // Every message under the head as one run, oldest first: its replies, each
    // stack joined to it and the replies to those, however deep. A join
    // changes no message, so splitting it out puts both stacks back as they were.
    const replies = members.filter(item => item.id !== head.id).sort((a, b) => a.seq - b.seq);
    const position = positionOf({ head, replies }), byRoot = position && position.root_id !== head.id && 'place_revision' in position;
    const place = byRoot ? position.placed : actsOf(head).placed, placed = typeof place === 'number' ? place : null;
    const newest = list => list.reduce((most, item) => Math.max(most, item.seq), 0);
    const own = item => item.id !== head.id && !joins.has(item.id) && viewer !== null && item.author_id === viewer;
    return { id: head.id, head, replies, joins, newest: newest(members), lifted: newest(members.filter(item => !own(item))), placed, dossier: position?.root_id ?? head.id };
  });
}

// Item 550: the branches of one dossier are one stack. A branch is what the
// page's own reading of the replies gathers under one head: where that head
// hangs under a message the page has not loaded (the dossier's fork sits above
// what is loaded), each reply made under the fork starts a branch of its own.
// Core's position says which dossier each is in (positionOf): branches that
// name one first message go into the stack holding it where the page has
// loaded it, else into one stack headed by the oldest of their heads, the
// rest of their messages oldest first among its replies. A head whose join or
// split is not yet answered (moving, stack-feed.mjs) carries positions Core
// read before it, so it gathers nothing by them. branches: Map of head id to
// { id, head, members, joins }; headOf(id): the head of a loaded message's
// branch. Answers the stacks as [{ head, members, joins }].
function dossiers(branches, headOf) {
  const into = new Map();
  for (const [id, branch] of branches) {
    const position = positionOf({ head: branch.head, replies: branch.members.filter(item => item.id !== id) });
    if (position && position.root_id !== id) into.set(id, headOf(position.root_id) ?? `root:${position.root_id}`);
  }
  const group = new Map(), find = id => { let at = id; while (group.has(at)) at = group.get(at); return at; };
  for (const [id, to] of into) { const from = find(id), end = find(to); if (from !== end) group.set(from, end); }
  const gathered = new Map();
  for (const [id, branch] of branches) {
    const end = find(id);
    if (!gathered.has(end)) gathered.set(end, []);
    gathered.get(end).push(branch);
  }
  return [...gathered.values()].map(found => {
    // The head: the branch that names no other (the dossier's first message, where loaded), else the oldest head.
    const first = found.find(branch => !into.has(branch.id)) ?? found.reduce((oldest, branch) => (branch.head.seq < oldest.head.seq ? branch : oldest));
    const joins = new Map(found.flatMap(branch => [...branch.joins]));
    return { head: first.head, members: found.flatMap(branch => branch.members), joins };
  });
}

// Item 550: what the page keeps of a stack for this visit (how far it is
// open, its earlier-messages row, the first of the seven it shows) is the
// dossier's. Loading more of a dossier gives its stack
// another head when an older branch, or its first message, loads. Answers a
// Map of each stack's head before (before: the stacks as last gathered) to the
// head of its dossier's stack now (after), for each stack whose head no
// longer heads one; a head that still heads a stack keeps its own, so a join,
// which puts one dossier into another, carries nothing.
export function reheaded(before, after) {
  const now = new Map(), heads = new Set(after.map(stack => stack.id));
  for (const stack of after) if (!now.has(stack.dossier)) now.set(stack.dossier, stack.id);
  return new Map(before.filter(stack => !heads.has(stack.id) && now.has(stack.dossier)).map(stack => [stack.id, now.get(stack.dossier)]));
}

// Where a stack sorts: its own place, else its newest message that lifts it.
export const keyOf = stack => stack.placed ?? stack.lifted;

// The stacks newest on top, each placed one where the reader put it.
export function ordered(stacks) {
  return [...stacks].sort((a, b) => keyOf(b) - keyOf(a) || b.lifted - a.lifted);
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
  const all = [stack.head, ...stack.replies];
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
export function shown(stack, item, { level = 'folded', kept = () => false, earlier = false, held = null } = {}) {
  if (!earlier && earlierOf(stack, level, { held }).includes(item)) return false;
  if (level === 'open') return true;
  if (level === 'head') return false;
  return actsOf(item).starred === true || kept(item) || item.seq === newestReply(stack);
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
// stack's only where the page's own reading of it agrees (item 470): it names
// the head, or the head hangs under a message the page has not loaded and it
// names none in the stack. A join or a split, before Core answers it and
// until its messages are read again, leaves the positions Core sent before it
// on the messages it moved; such a position is another dossier's, and null
// where none fits. A head whose own join or split is not yet answered
// (moving, stack-feed.mjs) hangs under nothing the positions may say.
export function positionOf(stack) {
  const inside = new Set(stack.replies.map(item => item.id));
  const hangs = !stack.head.moving && Boolean(actsOf(stack.head).joined?.into || stack.head.reply_to);
  const fits = position => position.root_id === stack.head.id || hangs && !inside.has(position.root_id);
  return [stack.head, ...stack.replies].map(item => item.stack_position).filter(position => position && fits(position))
    .reduce((known, next) => laterPosition(known, next), null);
}
