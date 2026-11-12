// How a topic's loaded messages read as reply stacks (docs/reply-stacks.md):
// which stack each message is in, the order inside a stack and of the stacks,
// what a fold shows, which messages read as one line because the reader
// folded them, where the one New line goes, and what a move or a join
// sends. Nothing here touches the page or Core; reply-stacks.mjs draws what
// these answer and stack-feed.mjs sends the acts.
//
// A stack is a message and every loaded reply to it, and to those replies,
// plus each stack someone joined to it. The message it starts with (its head)
// stays at the top; its replies read as a chat does, oldest first, and a
// stack joined to it comes after them, in the order the joins were made. The
// stacks themselves keep the topic newest on top: each sits where its newest
// message would, unless the reader placed it somewhere of their own, where it
// holds whatever replies arrive.

// Acts recorded about a message (Core's message_acts, as topic_messages
// carries them): absent on a page from a Core before them, read as none.
const actsOf = item => item?.acts ?? {};

// Each act and the revision Core counts it by.
const REVISIONS = { starred: 'star_revision', dealt: 'deal_revision', folded: 'fold_revision', placed: 'place_revision', name: 'name_revision', joined: 'join_revision' };

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
// a message is on the page) into stacks. Each stack: { id: its head's id,
// head, replies: every other message in reading order, joins: Map of the id
// of each joined stack's first message to its join ({ into, by, at_ms }),
// newest: the newest seq in it, placed: the reader's own place for it or null }.
export function gather(items, has = null) {
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
  // The head each message is under, and the joined stack it came with: the
  // nearest message up from it (itself included) that was joined, else null.
  const headOf = new Map(), segmentOf = new Map();
  for (const item of items) {
    let at = item.id, segment = null;
    for (let next = up(at); next; next = up(at)) { if (next.joined && segment === null) segment = at; at = next.id; }
    headOf.set(item.id, at); segmentOf.set(item.id, segment);
  }
  const stacks = new Map();
  for (const item of items) {
    const head = headOf.get(item.id);
    if (!stacks.has(head)) stacks.set(head, { id: head, head: byId.get(head), members: [], joins: new Map() });
    stacks.get(head).members.push(item);
    if (item.id !== head && up(item.id)?.joined) stacks.get(head).joins.set(item.id, up(item.id).joined);
  }
  const bySeq = (a, b) => a.seq - b.seq;
  return [...stacks.values()].map(({ head, members, joins }) => {
    // The head's own replies first, oldest first; then each stack joined to
    // one of them, in the order it was joined, its first message and its own
    // replies, each followed in turn by the stacks joined to it.
    const within = new Map([[null, []]]), under = new Map([[null, []]]);
    for (const id of joins.keys()) { within.set(id, []); under.set(id, []); }
    for (const item of members) if (item.id !== head.id) within.get(segmentOf.get(item.id)).push(item);
    for (const [id, join] of joins) under.get(segmentOf.get(join.into) ?? null).push(byId.get(id));
    const replies = [];
    const emit = segment => {
      replies.push(...within.get(segment).sort(bySeq));
      const joined = under.get(segment).sort((a, b) => (joins.get(a.id).at_ms ?? 0) - (joins.get(b.id).at_ms ?? 0) || bySeq(a, b));
      for (const item of joined) emit(item.id);
    };
    emit(null);
    const placed = typeof actsOf(head).placed === 'number' ? actsOf(head).placed : null;
    return { id: head.id, head, replies, joins, newest: members.reduce((most, item) => Math.max(most, item.seq), 0), placed };
  });
}

// Where a stack sorts: its own place, else its newest message.
export const keyOf = stack => stack.placed ?? stack.newest;

// The stacks newest on top, each placed one where the reader put it.
export function ordered(stacks) {
  return [...stacks].sort((a, b) => keyOf(b) - keyOf(a) || b.newest - a.newest);
}

// The only three stack states: header alone, latest plus unread replies,
// original message plus every reply. The original has no independent state.
export const LEVELS = ['head', 'folded', 'open'];

// Whether a reply shows at the stack's level. kept(item) holds replies that
// were unread when this partial view drew them. A fold never decides this:
// a folded reply shows where it would, as its one-line row (rowFolded).
export function shown(stack, item, { level = 'folded', kept = () => false } = {}) {
  if (level === 'open') return true;
  if (level === 'head') return false;
  return kept(item) || item.seq === newestReply(stack);
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
// What a stack shows under its head, top to bottom: { kind: 'reply', item },
// { kind: 'join', item, join } just before a joined stack's first message, and
// { kind: 'fold', items, words, fresh } for each run of replies folded away
// where it sits, so a reply kept in view never reads as inside the fold. Open
// with replies the fold would take, a { kind: 'fold-all', count } line comes
// first. unread(item): whether a folded reply counts as new on its line. A
// reply row says whether it reads as its one-line row (folded, rowFolded).
export function rowsOf(stack, { level = 'folded', kept, unread = () => false, peeked = () => false } = {}) {
  const rows = [], all = stack.replies, show = item => shown(stack, item, { level, kept });
  if (level === 'open') {
    const would = all.filter(item => !shown(stack, item, { level: 'folded', kept })).length;
    if (would) rows.push({ kind: 'fold-all', count: would, words: `Fold ${would} earlier ${replies(would)}` });
  }
  let run = [], before = true;
  const flush = () => {
    if (!run.length) return;
    const n = run.length, fresh = run.filter(unread).length;
    const words = n === all.length ? `${n} ${replies(n)}` : `${n} ${before ? 'earlier' : 'more'} ${replies(n)}`;
    rows.push({ kind: 'fold', items: run, words, fresh });
    run = [];
  };
  for (const item of all) {
    if (!show(item)) { run.push(item); continue; }
    flush(); before = false;
    if (stack.joins.has(item.id)) rows.push({ kind: 'join', item, join: stack.joins.get(item.id) });
    rows.push({ kind: 'reply', item, folded: rowFolded(item, { peeked }) });
  }
  flush();
  return rows;
}

// A stack's head row: its name (the short name someone typed, else its first
// message's first line, firstLine), who replied in the order they first did,
// and what is new: the head itself, or how many replies. folded: the first
// message is folded, so the row stands for it at every level and its full
// message does not show.
export function headOf(stack, { firstLine = text => String(text ?? '').split('\n')[0], unread = () => false, peeked = () => false } = {}) {
  const typed = actsOf(stack.head).name;
  const repliers = [];
  for (const item of stack.replies) if (!repliers.includes(item.author_id)) repliers.push(item.author_id);
  const headNew = unread(stack.head);
  return { name: typed?.text || firstLine(stack.head.body), typed: typed ?? null, count: stack.replies.length, repliers,
    headNew, fresh: headNew ? 0 : stack.replies.filter(unread).length, folded: rowFolded(stack.head, { peeked }) };
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

// The stack a join of the stack at index goes into: its neighbour that way.
export function joinOf(stacks, index, way) {
  return stacks[index + (way === 'up' ? -1 : 1)] ?? null;
}

// Every loaded message in the order the page shows them, top to bottom: each
// stack's head, then its replies, folded ones included. The Reader's ↑ and ↓
// step along it, as the eye goes down the page.
export function readingOrder(stacks) {
  return stacks.flatMap(stack => [stack.head, ...stack.replies]);
}

// The next of the same three states for ⌘→ or ⌘←, independent of which
// message has focus. Null when there is no further step that way.
export function foldStep({ level }, way, { replies: has = true } = {}) {
  const at = LEVELS.indexOf(level);
  const next = at + (way === 'open' ? 1 : -1);
  return has && at >= 0 && next >= 0 && next < LEVELS.length ? { level: LEVELS[next] } : null;
}
