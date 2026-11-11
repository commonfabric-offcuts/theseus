// What a person does to reply stacks on a topic page or a Conversation
// (docs/reply-stacks.md), and the keys and menu items that do it: star a
// message, rename a stack, move it, join it to its neighbour and split it
// back out, fold and open it, and put the last of those back with ⌘Z.
//
// A star, a stack's place and a stack dealt with are the reader's own; a
// stack's short name and its joins are everyone's in the topic. Each is a new
// record about a message, a Core command fenced on the revision the page last
// read (aim_next/stacks.py); the page shows the act at once and sends the acts
// one after another, so a quick run of presses each sends the revision the
// one before it made. What Core holds stays the message's acts (topic-views.mjs);
// an act not yet answered is drawn over them until its answer lands, and the
// stacks are drawn again whenever an answer changes what they show. How far a
// stack is folded is the page's own.
import { cardIn } from './fold.mjs';
import { arrangeStacks, entries, entryOf, stackOf, stackState, reveal, renameInput, unkeep } from './reply-stacks.mjs';
import { moveOf, joinOf, foldStep, shown, laterActs } from './stack-order.mjs';
import { keyAction } from './pane-keys.mjs';
import { firstLine } from './pipeline-words.mjs';

const FIELD = { 'message.star': 'star', 'message.deal': 'deal', 'stack.place': 'place', 'stack.name': 'name', 'stack.join': 'join' };
const FEED_ACTIONS = ['move-up', 'move-down', 'open', 'fold', 'join-up', 'join-down', 'undo'];

// Whether a touch began on something between it and the list that scrolls
// sideways (a wide table, a block of code): a sideways drag there scrolls it.
function scrollsSideways(target, list) {
  for (let at = target; at && at !== list; at = at.parentElement) {
    if (at.scrollWidth > at.clientWidth && /^(auto|scroll)$/.test(at.ownerDocument.defaultView.getComputedStyle(at).overflowX)) return true;
  }
  return false;
}

// The acts a commit's result says, as the message's acts read.
function learned(kind, result, viewer, now) {
  const field = FIELD[kind], revision = { [`${field}_revision`]: result[`${field}_revision`] };
  if (kind === 'message.star') return { starred: result.starred, ...revision };
  if (kind === 'message.deal') return { dealt: result.dealt, ...revision };
  if (kind === 'stack.place') return { placed: result.key, ...revision };
  if (kind === 'stack.name') return { name: result.name ? { text: result.name, by: viewer, at_ms: now } : null, ...revision };
  return { joined: result.into ? { into: result.into, by: viewer, at_ms: now } : null, ...revision };
}
// What an act shows at once, before Core answers.
function shownAct(kind, args, viewer, now) {
  if (kind === 'message.star') return { starred: args.starred };
  if (kind === 'message.deal') return { dealt: args.dealt };
  if (kind === 'stack.place') return { placed: args.key };
  if (kind === 'stack.name') return { name: args.name ? { text: args.name, by: viewer, at_ms: now } : null };
  return { joined: args.into ? { into: args.into, by: viewer, at_ms: now } : null };
}

export class StackFeed {
  // list: #messages. messages(): the loaded messages by id. keep, unread,
  // nameOf: as arrangeStacks takes them. send(envelope): Core's command.
  // reread(): reads the acts again from Core, after a refusal. starsChanged():
  // the reader's stars moved (the right rail's Starred). status(error): says a failure.
  // hold(paint): repaints keeping the page where the person is.
  constructor({ list, messages, viewer, instanceId, authority, send, keep, unread, nameOf, reread = () => {}, starsChanged = () => {}, status = () => {},
    hold = paint => paint(), clock = () => Date.now(), doc = document }) {
    Object.assign(this, { list, messages, viewer, instanceId, authority, commandOf: send, keep, unread, nameOf, reread, starsChanged, status, hold, clock, doc });
    this.undos = []; this.chain = Promise.resolve(); this.newestSeen = null;
    // The acts shown and not yet answered, by message, in the order made; and
    // the acts each message was last drawn with.
    this.pending = new Map(); this.drawn = new Map();
    this.said = doc.createElement('div');
    this.said.className = 'sr-only'; this.said.setAttribute('aria-live', 'polite'); this.said.id = 'stack-said';
    doc.body.append(this.said);
    doc.addEventListener('keydown', event => this.key(event));
    // A reply swiped to the right on a phone folds into the earlier replies;
    // a drag on something that scrolls sideways scrolls it instead.
    list.addEventListener('touchstart', event => {
      const touch = event.touches?.[0];
      this.swipe = touch && !scrollsSideways(event.target, list) ? { x: touch.clientX, y: touch.clientY, target: event.target } : null;
    }, { passive: true });
    list.addEventListener('touchend', event => this.swiped(event), { passive: true });
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
      split: item => this.split(item), unplace: stack => this.unplace(stack),
      folded: (stack, was) => this.remember(() => { this.state.levels.set(stack.id, was); this.arrange(); }),
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
  // they were last drawn with.
  settled(id) {
    if (this.messages().has(id) && this.drawn.get(id) !== JSON.stringify(this.actsOf(id))) this.arrange();
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
  focusOn(id) {
    const entry = this.entryFor(id);
    if (!entry) return;
    const target = entry.hidden ? this.entryFor(stackOf(this.list, entry)?.stack.id) : entry;
    if (!target) return;
    const card = cardIn(target), stop = card.hidden ? target.querySelector?.('.fold-line') ?? card : card;
    stop.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'nearest' });
  }
  star(item) {
    const on = !this.actsOf(item.id).starred;
    this.act('message.star', item, { starred: on });
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
  arrived(items) {
    this.arrange();
    const newest = items.reduce((most, item) => Math.max(most, item.seq), 0);
    if (this.newestSeen === null) { this.newestSeen = newest; return; }
    for (const item of items) if (item.seq > this.newestSeen && item.author_id === this.viewer && (item.reply_to || this.actsOf(item.id).joined)) this.deal(item);
    this.newestSeen = Math.max(this.newestSeen, newest);
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
  join(entry, way) {
    const found = stackOf(this.list, entry);
    if (!found) return;
    const target = joinOf(this.state.stacks, found.index, way);
    if (!target) { this.say(way === 'up' ? 'No stack above to join' : 'No stack below to join'); return; }
    const item = this.messages().get(found.stack.id), before = this.actsOf(item.id).joined?.into ?? null;
    this.act('stack.join', item, { into: target.id });
    this.remember(() => { this.act('stack.join', item, { into: before }); this.arrange(); this.focusOn(item.id); });
    this.arrange(); this.focusOn(item.id);
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
  // ⌘→ and ⌘← on a message: a step of its stack's fold.
  fold(entry, way) {
    const found = stackOf(this.list, entry);
    if (!found?.section || !found.stack.replies.length) return false;
    const { stack } = found, state = this.state, starred = Boolean(this.actsOf(stack.id).starred);
    const now = { level: state.levels.get(stack.id) ?? 'folded', headOpen: starred || state.headOpen.has(stack.id) };
    const options = { onHead: found.head, replies: true };
    let next = foldStep(now, way, options);
    // A starred head keeps its full message shown: that step is passed over.
    while (next && starred && next.level === now.level && next.headOpen !== now.headOpen) next = foldStep({ ...next, headOpen: now.headOpen }, way, { ...options, onHead: false });
    if (!next) { this.say(way === 'open' ? 'Open as far as it goes' : 'Folded as far as it goes'); return true; }
    const apply = to => {
      state.levels.set(stack.id, to.level);
      if (to.headOpen) state.headOpen.add(stack.id); else state.headOpen.delete(stack.id);
      this.arrange(); this.focusOn(entry.dataset.id);
    };
    apply(next);
    this.remember(() => apply(now));
    this.say(next.headOpen !== now.headOpen ? (next.headOpen ? 'Full message shown' : 'Full message hidden')
      : { open: 'Every reply shown', folded: 'Folded to the newest and unread replies', head: 'Folded to its first message' }[next.level]);
    return true;
  }
  // A reply folded by hand, from ⋯ or a swipe: away until its stack opens.
  foldOne(item) {
    const state = this.state;
    state.handFolded.add(item.id); state.kept.delete(item.id);
    this.remember(() => { state.handFolded.delete(item.id); this.arrange(); });
    this.arrange(); this.say('Folded into the earlier replies');
  }
  swiped(event) {
    const start = this.swipe, touch = event.changedTouches?.[0];
    this.swipe = null;
    if (!start || !touch || touch.clientX - start.x < 80 || Math.abs(touch.clientY - start.y) > 40) return;
    const entry = entryOf(this.list, start.target), found = entry && stackOf(this.list, entry);
    const item = entry && this.messages().get(entry.dataset.id);
    if (!found || found.head || !item || found.stack.joins.has(item.id) || this.actsOf(item.id).starred) return;
    this.foldOne(item);
  }
  // The stack keys, on a message only, never in writing: ⌘← and ⌘→ are the
  // browser's back and forward everywhere else.
  key(event) {
    const action = keyAction(event);
    if (!FEED_ACTIONS.includes(action) || this.doc.querySelector('dialog[open]')) return;
    const at = this.doc.activeElement, entry = at && this.list.contains(at) ? entryOf(this.list, at) : null;
    if (!entry || !(at === cardIn(entry) || at.classList?.contains('fold-line'))) return;
    event.preventDefault();
    if (action === 'undo') return this.undo();
    if (action === 'move-up' || action === 'move-down') return this.move(entry, action.slice(5));
    if (action === 'join-up' || action === 'join-down') return this.join(entry, action.slice(5));
    if (!this.fold(entry, action)) this.say('No replies to open or fold');
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
      if (!starred) {
        const open = state.headOpen.has(stack.id);
        items.push({ label: open ? 'Hide the full message' : 'Show the full message', keys: open ? '⌘←' : '⌘→',
          act: () => { if (open) state.headOpen.delete(stack.id); else state.headOpen.add(stack.id); this.arrange(); this.focusOn(stack.id); } });
      }
    }
    if (!found.head && !stack.joins.has(item.id) && !starred && shown(stack, item, { level: 'folded', kept: () => true, handFolded: state.handFolded })) {
      items.push({ label: 'Fold into earlier replies', act: () => this.foldOne(item) });
    }
    if (stack.joins.has(item.id)) items.push({ label: 'Split back out', act: () => this.split(item) });
    const moves = [
      { label: 'Move its stack up', keys: '⌘↑', act: () => this.move(entry, 'up') },
      { label: 'Move its stack down', keys: '⌘↓', act: () => this.move(entry, 'down') },
      ...(stack.replies.length ? [{ label: 'Fold its stack', keys: '⌘←', act: () => this.fold(entry, 'fold') },
        { label: 'Open its stack', keys: '⌘→', act: () => this.fold(entry, 'open') }] : []),
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
