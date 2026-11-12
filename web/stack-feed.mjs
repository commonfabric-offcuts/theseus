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
import { arrangeStacks, entries, entryOf, stackOf, stackState, setLevel, reveal, renameInput, unkeep } from './reply-stacks.mjs';
import { moveOf, joinShown, foldStep, laterActs } from './stack-order.mjs';
import { keyAction } from './pane-keys.mjs';
import { firstLine } from './pipeline-words.mjs';

const FIELD = { 'message.star': 'star', 'message.deal': 'deal', 'message.fold': 'fold', 'stack.place': 'place', 'stack.name': 'name', 'stack.join': 'join' };
const FEED_ACTIONS = ['move-up', 'move-down', 'right', 'left', 'join-up', 'join-down', 'undo'];

// Whether a touch began on something between it and the list that scrolls
// sideways (a wide table, a block of code): a sideways drag there scrolls it.
function scrollsSideways(target, list) {
  for (let at = target; at && at !== list; at = at.parentElement) {
    if (at.scrollWidth > at.clientWidth && /^(auto|scroll)$/.test(at.ownerDocument.defaultView.getComputedStyle(at).overflowX)) return true;
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
  if (kind === 'message.star') return { starred: result.starred, ...revision };
  if (kind === 'message.deal') return { dealt: result.dealt, ...revision };
  if (kind === 'message.fold') return { folded: result.folded, ...revision };
  if (kind === 'stack.place') return { placed: result.key, ...revision };
  if (kind === 'stack.name') return { name: result.name ? { text: result.name, by: viewer, at_ms: now } : null, ...revision };
  return { joined: result.into ? { into: result.into, by: viewer, at_ms: now } : null, ...revision };
}
// What an act shows at once, before Core answers.
function shownAct(kind, args, viewer, now) {
  if (kind === 'message.star') return { starred: args.starred };
  if (kind === 'message.deal') return { dealt: args.dealt };
  if (kind === 'message.fold') return { folded: args.folded };
  if (kind === 'stack.place') return { placed: args.key };
  if (kind === 'stack.name') return { name: args.name ? { text: args.name, by: viewer, at_ms: now } : null };
  return { joined: args.into ? { into: args.into, by: viewer, at_ms: now } : null };
}

export class StackFeed {
  // list: #messages. messages(): the loaded messages by id. keep, unread,
  // nameOf: as arrangeStacks takes them. send(envelope): Core's command.
  // reread(): reads the acts again from Core, after a refusal. starsChanged():
  // the reader's stars moved (the right rail's Starred). status(error): says a failure.
  // hold(paint): repaints keeping the page where the person is. press: the
  // press held down on the page (press-hold.mjs).
  constructor({ list, messages, viewer, instanceId, authority, send, keep, unread, nameOf, reread = () => {}, starsChanged = () => {}, status = () => {},
    hold = paint => paint(), press, clock = () => Date.now(), doc = document }) {
    Object.assign(this, { list, messages, viewer, instanceId, authority, commandOf: send, keep, unread, nameOf, reread, starsChanged, status, hold, press, clock, doc });
    this.undos = []; this.chain = Promise.resolve(); this.newestSeen = null;
    // The acts shown and not yet answered, by message, in the order made; and
    // the acts each message was last drawn with.
    this.pending = new Map(); this.drawn = new Map();
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
      return this.pending.has(id) ? { ...item, acts } : item;
    } };
  }
  arrange() {
    this.hold(() => arrangeStacks(this.list, this.shownMessages(), { keep: this.keep, unread: this.unread, viewer: this.viewer, nameOf: this.nameOf, doc: this.doc, on: {
      rename: stack => this.startRename(stack), renamed: (stack, text) => this.rename(stack, text), cancelled: stack => { this.arrange(); this.focusOn(stack.id); },
      split: item => this.split(item), unplace: stack => this.unplace(stack), unfold: id => this.unfoldId(id),
      folded: (stack, was) => this.remember(() => { setLevel(this.state, stack, was); this.arrange(); }),
    } }));
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
  // Answered or refused, it is no longer drawn over what Core holds.
  act(kind, item, args) {
    const shown = shownAct(kind, args, this.viewer, this.clock());
    this.pending.set(item.id, [...this.pending.get(item.id) ?? [], shown]);
    const sent = this.chain.then(() => this.send(kind, item, args)).finally(() => {
      const left = (this.pending.get(item.id) ?? []).filter(each => each !== shown);
      if (left.length) this.pending.set(item.id, left); else this.pending.delete(item.id);
      this.settled(item.id);
    });
    this.chain = sent.catch(() => {});
    sent.catch(error => { this.status(error); this.reread(); });
    return sent;
  }
  // Draws the stacks again when a message's acts as shown are no longer what
  // they were last drawn with; an answer landing under a press held down waits
  // for it to end, so nothing moves under the pointer.
  settled(id) {
    if (this.messages().has(id) && this.drawn.get(id) !== JSON.stringify(this.actsOf(id))) this.press.after('stacks', () => this.arrange());
  }
  async send(kind, item, args) {
    const field = FIELD[kind], { authority_id, authority_epoch } = this.authority();
    const current = this.messages().get(item.id) ?? item;
    let receipt;
    try {
      receipt = await this.commandOf({ v: 1, instance_id: this.instanceId, operation_id: crypto.randomUUID(), kind, target: { message_id: item.id },
        expected: { [`${field}_revision`]: current.acts?.[`${field}_revision`] ?? 0, authority: { authority_id, authority_epoch } }, args });
    } catch (error) { throw Error('Connection interrupted; whether that was saved is unknown. The page reads it again from Theseus.', { cause: error }); }
    if (receipt?.status !== 'committed') {
      if (receipt?.error?.code === 'REVISION_CONFLICT') throw Error('That changed on another tab or device; the page now shows what was saved. Nothing was changed.');
      throw Error(receipt?.error?.message ?? 'That was not confirmed. The page shows what Theseus holds.');
    }
    const answer = learned(kind, receipt.result, this.viewer, this.clock());
    for (const each of new Set([item, current])) each.acts = laterActs(each.acts, answer);
    if (kind === 'message.star') this.starsChanged();
    return receipt.result;
  }
  // The message's entry, its stack and its card.
  entryFor(id) { return entries(this.list).find(entry => entry.dataset.id === id) ?? null; }
  // Puts the keys on a message, or on its stack's head when the stack folds it
  // away, and scrolls it into view only as far as it needs. above: something
  // over it to bring into view with it where both fit (a join line).
  focusOn(id, { above = null } = {}) {
    const entry = this.entryFor(id);
    if (!entry) return;
    const target = entry.hidden ? this.entryFor(stackOf(this.list, entry)?.stack.id) : entry;
    if (!target) return;
    const card = cardIn(target), stop = card.hidden ? target.querySelector?.('.fold-line') ?? card : card;
    stop.focus({ preventScroll: true });
    above?.scrollIntoView?.({ block: 'nearest' });
    target.scrollIntoView?.({ block: 'nearest' });
  }
  // A star keeps a message in view: starring a folded message unfolds it too.
  star(item) {
    const on = !this.actsOf(item.id).starred;
    this.act('message.star', item, { starred: on });
    if (on && this.actsOf(item.id).folded) { this.state.peeked.delete(item.id); this.act('message.fold', item, { folded: false }); }
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
  rename(stack, text) {
    const item = this.messages().get(stack.id) ?? stack.head, typed = this.actsOf(item.id, item).name?.text ?? '';
    const name = String(text ?? '').replace(/\s+/g, ' ').trim();
    this.arrange();
    // Unchanged, or the first line it is named by already: nothing to record.
    if (name === typed || !typed && name === firstLine(item.body)) { this.focusOn(stack.id); return; }
    this.act('stack.name', item, { name });
    this.remember(() => { this.act('stack.name', item, { name: typed }); this.arrange(); });
    this.arrange(); this.focusOn(stack.id);
    this.say(name ? `Renamed ${name}, for everyone here` : 'Named by its first line again, for everyone here');
  }
  move(entry, way) {
    const found = stackOf(this.list, entry);
    if (!found) return;
    const stacks = this.state.stacks, changes = moveOf(stacks, found.index, way);
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
    const shows = joinShown(this.state.stacks, found.index, way, entry.dataset.id);
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
    const now = { level: state.levels.get(stack.id) ?? 'folded' };
    const next = foldStep(now, way);
    if (!next) return false;
    const apply = to => {
      setLevel(state, stack, to.level);
      this.arrange(); this.focusOn(entry.dataset.id);
    };
    apply(next);
    this.remember(() => apply(now));
    this.say({ open: 'Original message and every reply shown', folded: 'Latest and unread replies shown', head: 'Stack closed' }[next.level]);
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
  // A press on a folded message's row, or its stack's head row (reply-stacks.mjs).
  unfoldId(id) {
    const item = this.messages().get(id);
    if (item) this.setFold(item, false);
  }
  swiped(event) {
    const start = this.swipe, touch = event.changedTouches?.[0];
    this.swipe = null;
    const across = touch && start ? touch.clientX - start.x : 0;
    if (!start || Math.abs(across) < 80 || Math.abs(touch.clientY - start.y) > 40) return;
    const entry = entryOf(this.list, start.target), item = entry && this.messages().get(entry.dataset.id);
    if (!item) return;
    this.setFold(item, across > 0, { focus: false });
  }
  // A wheel event on the list: part of a trackpad swipe, or a scroll the
  // browser keeps. The message is the one under the swipe's first event, and
  // the swipe folds or unfolds it once; the rest of it, momentum and all, is
  // still kept from the browser while it goes across. A scroll further down
  // than across, a swipe that began on something scrolling sideways and the
  // wheel with Ctrl or ⌘ (zoom) are left to the browser.
  wheeled(event) {
    if (event.ctrlKey || event.metaKey) return;
    let swipe = this.wheelSwipe;
    if (!swipe || event.timeStamp - swipe.last >= SWIPE_GAP) {
      const entry = scrollsSideways(event.target, this.list) ? null : entryOf(this.list, event.target);
      swipe = this.wheelSwipe = { x: 0, y: 0, item: entry && this.messages().get(entry.dataset.id), done: false };
    }
    swipe.last = event.timeStamp;
    const [unitX, unitY] = event.deltaMode === 1 ? [16, 16] : event.deltaMode === 2 ? [this.list.clientWidth, this.doc.defaultView.innerHeight] : [1, 1];
    swipe.x += event.deltaX * unitX; swipe.y += event.deltaY * unitY;
    if (!swipe.item || Math.abs(swipe.x) <= Math.abs(swipe.y)) return;
    event.preventDefault();
    if (swipe.done || Math.abs(swipe.x) < SWIPE_ACROSS) return;
    swipe.done = true;
    this.setFold(swipe.item, swipeFolds(swipe.x), { focus: false });
  }
  // Stack keys on a message or its chevron, never in writing. Plain arrows
  // open/fold first; the pane's document listener handles the boundary.
  key(event) {
    const action = keyAction(event);
    if (!FEED_ACTIONS.includes(action) || this.doc.querySelector('dialog[open]')) return;
    const at = this.doc.activeElement;
    if (!at || !this.list.contains(at)) return;
    const toggle = at.classList?.contains('stack-toggle');
    const entry = toggle ? this.entryFor(at.closest('.reply-stack')?.dataset.stack) : entryOf(this.list, at);
    if (!entry || !(toggle || at === cardIn(entry) || at.classList?.contains('fold-line'))) return;
    if (action === 'right' || action === 'left') {
      if (this.fold(entry, action === 'right' ? 'open' : 'fold')) event.preventDefault();
      return;
    }
    event.preventDefault();
    if (action === 'undo') return this.undo();
    if (action === 'move-up' || action === 'move-down') return this.move(entry, action.slice(5));
    if (action === 'join-up' || action === 'join-down') return this.join(entry, action.slice(5));
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
      { label: 'Move its stack up', keys: '⌘↑', act: () => this.move(entry, 'up') },
      { label: 'Move its stack down', keys: '⌘↓', act: () => this.move(entry, 'down') },
      ...(stack.replies.length ? [{ label: 'Fold its stack', keys: '←', act: () => this.fold(entry, 'fold') },
        { label: 'Open its stack', keys: '→', act: () => this.fold(entry, 'open') }] : []),
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
