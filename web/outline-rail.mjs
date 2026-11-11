// The outline on the left of a topic or an outcome's Conversation (pipeline
// item 272; docs/rails.md): every outcome, folded but for the one being read,
// so what is new anywhere shows at a glance. An outcome's row is its light,
// its name and where it stands, and the whole row opens its Conversation and
// its topics (Opened tidies every other away); folded, it carries
// the count of everything new inside it; open, its own row counts only its
// Conversation, since each topic shows its own. The topic rows are today's
// (TopicRail): unread counts, the work ring, Waiting on you and Ready for
// review, Done (N) and Archived (N), in the server's order. Each outcome ends
// with + New topic. At the top, "N new" and "N waiting on you" add it all up,
// and a press on one shows only those.
//
// The outline is the shell's (in-place-navigation.mjs): it stays the same
// element across moves, with its scroll and the keys' place. It reads what Core
// already serves (workspaces, workspace_topics, conversation) through the
// page that is up, and again on every commit its live feed announces. It
// never moves anything by itself: outcomes keep their order, a new message
// changes only counts and lights, and topics keep the order their list gives.
// Only the person moves a row (⌘↑ ⌘↓): the order they place is theirs, kept
// by Core and read back on every device (outline-order.mjs).
//
// The keys move through it as one tree (key-tree.mjs, pane-keys.mjs): ↑ ↓
// between the rows, Return opens one, ⌘→ ⌘← open and fold an outcome, → and
// ← take the tree's steps and then move to the messages (panes.mjs); → on an
// open outcome goes straight to the messages. ⌘Return starts a new message
// in the row's topic, or in the outcome's Conversation.
//
// Which outcome is being read, which topic is open and whose list sits under
// it come from the run of the page that is up, and from nothing before it.
// Each run's reads and drawing are its own: what a run read lands only while
// it is still the page, and a run that has gone draws nothing.
import { TopicRail, TopicPages, WorkspacePages, reread, routeHref, paintUnread, arrange, PAGE } from './topic-navigation.mjs';
import { paintRowLight } from './outcome-light.mjs';
import { OneLine, OutcomeStart, TopicStart, lineFromButton } from './quick-create.mjs';
import { readFailure } from './freshness.mjs';
import { waitsOnReader } from './outcome-conversation.mjs';
import { reloader } from './live.mjs';
import { KeyTree } from './key-tree.mjs';
import { KEY_WORDS, MESSAGE_KEY_WORDS, keyAction } from './pane-keys.mjs';
import { book, scopeOf, arrangeItems, moved, movedWords, orderOf } from './outline-order.mjs';
import { panes } from './panes.mjs';

const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
// The questions waiting on the reader in one outcome, as its light counts them.
export const asksIn = item => item?.light?.light === 'waiting' && item.light.short?.kind === 'asks' ? count(item.light.short.count) : 0;
// What an outcome's row counts: folded, everything new inside it, the part
// sent by name and its questions; open, only its Conversation's, since each
// topic row shows its own.
export function rowCount(item, { open = false, conversation = null } = {}) {
  if (!open) return { unread: count(item?.unread), addressed: count(item?.addressed) };
  return { unread: count(conversation?.unread), addressed: count(conversation?.addressed) };
}
// Everything new and every question waiting, across every outcome listed.
export function totals(items) {
  let fresh = 0, waiting = 0;
  for (const item of items ?? []) { fresh += count(item.unread); waiting += asksIn(item); }
  return { fresh, waiting };
}
// What is new outside the outcome being read: how much, in how many outcomes,
// and how many questions wait there. The line under a phone's header says it.
export function elsewhere(items, here) {
  let fresh = 0, where = 0, waiting = 0;
  for (const item of items ?? []) {
    if (item.id === here) continue;
    if (count(item.unread)) { fresh += count(item.unread); where += 1; }
    waiting += asksIn(item);
  }
  return { fresh, where, waiting };
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export function elsewhereWords({ fresh, where, waiting }) {
  return [fresh ? `${fresh} new in ${plural(where, 'other outcome', 'other outcomes')}` : '', waiting ? `${waiting} waiting on you` : ''].filter(Boolean).join(' · ');
}
// Whether an outcome shows while only what is new, or only what waits on the
// reader, is shown.
export function shownUnder(filter, item) {
  if (filter === 'new') return count(item?.unread) > 0;
  if (filter === 'waiting') return asksIn(item) > 0;
  return true;
}

// Which outcomes show their topics. The outline tidies itself: only the
// outcome being read is open, and every other is folded, with its counts
// rolled up into its row. The keys can open another for a look (⌘→ or →),
// fold the one being read (⌘← or ←), or open or fold every one (⇧⌘→ ⇧⌘←);
// the next place the person arrives at, however they get there (a click or
// Return in the outline, a link, back or forward, the phone's drawer), tidies
// those away (tidy). While a chip shows only what is new or waiting, every
// outcome it shows is open. Nothing is kept on the browser.
export class Opened {
  constructor() { this.marks = new Map(); this.every = null; }
  isOpen(id, here = null, filter = null) {
    if (filter) return true;
    if (this.marks.has(id)) return this.marks.get(id);
    return this.every ?? id === here;
  }
  set(id, open) { this.marks.set(id, open); }
  // Every outcome, those listed later included, open or folded.
  all(open) { this.marks.clear(); this.every = open; }
  tidy() { this.marks.clear(); this.every = null; }
}

const element = (doc, tag, props = {}, ...children) => {
  const node = Object.assign(doc.createElement(tag), props);
  node.append(...children); return node;
};
// A topic row's title, without its count and the words read out for it.
function rowTitle(link) {
  const copy = link.cloneNode(true);
  for (const part of copy.querySelectorAll('.sr-only, .unread-count, .topic-state, .topic-work')) part.remove();
  return copy.textContent.replace(/\s+/g, ' ').trim();
}
const plainClick = event => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export class OutlineRail {
  // host: the outline's element (the shell's). open(target, title): through
  // the page's guard (shell.open). read(name, args, readClass): a read for the
  // outline's own lists, through whichever run is up (shell.view).
  // storage: localStorage, or null.
  constructor({ host, open, read, storage = null, doc = host.ownerDocument }) {
    Object.assign(this, { host, open, read, storage, doc });
    this.handles = null; this.filter = null; this.outcomes = new Map(); this.unlisten = null; this.started = false;
    this.pages = null; this.opened = new Opened(); this.failed = false; this.listRead = false; this.run = 0; this.watch = null; this.watched = null;
    this.reload = reloader(() => this.load());
    this.build();
    this.tree = new KeyTree({ root: this.list, doc: this.doc, rows: () => this.treeRows(), act: (action, row, rows) => this.act(action, row, rows) });
    // ⇧⌘→ and ⇧⌘← open and fold every outcome from anywhere in the outline:
    // its rows (the tree hears those), its chips, New outcome or its Keys.
    this.host.addEventListener('keydown', event => {
      const action = keyAction(event);
      if (action !== 'open-all' && action !== 'fold-all') return;
      event.preventDefault();
      this.setAll(action === 'open-all');
    });
    // Undo is for the moves just made: once the keys leave the outline, they are kept as they are.
    this.list.addEventListener('focusout', event => { if (event.relatedTarget && !this.list.contains(event.relatedTarget)) book.forget(); });
    // The person's order, as it is now: moved here, on another device, or put back.
    book.listen(scope => { if (scope === scopeOf(null)) this.paint(); });
  }
  build() {
    const doc = this.doc;
    this.newCount = element(doc, 'span', { className: 'n' });
    this.waitingCount = element(doc, 'span', { className: 'n' });
    this.onlyNew = element(doc, 'button', { type: 'button', className: 'chip ol-only', id: 'outline-only-new' }, this.newCount, ' new');
    const lamp = element(doc, 'span', { className: 'outcome-light' }); lamp.dataset.light = 'waiting'; lamp.setAttribute('aria-hidden', 'true');
    this.onlyWaiting = element(doc, 'button', { type: 'button', className: 'chip ol-only', id: 'outline-only-waiting' }, lamp, this.waitingCount, ' waiting on you');
    for (const [chip, filter] of [[this.onlyNew, 'new'], [this.onlyWaiting, 'waiting']]) {
      chip.setAttribute('aria-pressed', 'false');
      chip.onclick = () => { this.filter = this.filter === filter ? null : filter; this.paint(); if (this.filter) this.reload(); };
    }
    const sums = element(doc, 'div', { className: 'ol-sums' }, this.onlyNew, this.onlyWaiting);
    sums.setAttribute('role', 'group'); sums.setAttribute('aria-label', 'Across every outcome');
    this.newOutcome = element(doc, 'button', { type: 'button', className: 'quiet ol-new-outcome', textContent: 'New outcome', id: 'outline-new-outcome' });
    const heading = element(doc, 'div', { className: 'rail-heading ol-heading' }, element(doc, 'h2', { textContent: 'Outcomes', id: 'outline-heading' }),
      element(doc, 'span', { className: 'ol-heading-tools' }, this.newOutcome));
    this.list = element(doc, 'ul', { className: 'ol-list' });
    this.list.setAttribute('aria-labelledby', 'outline-heading');
    this.empty = element(doc, 'p', { className: 'empty ol-empty', hidden: true });
    this.message = element(doc, 'p', { className: 'notice', hidden: true }); this.message.setAttribute('role', 'status');
    this.retry = element(doc, 'button', { type: 'button', textContent: 'Retry outcomes', hidden: true });
    this.retry.onclick = () => this.reload();
    this.more = element(doc, 'button', { type: 'button', textContent: 'More outcomes', hidden: true });
    this.more.onclick = () => this.loadMore();
    const key = element(doc, 'p', { className: 'topics-key muted ol-key' }, element(doc, 'span', { className: 'topic-work' }), ' Posted in or worked on in the last hour, or waiting on an answer');
    key.setAttribute('aria-hidden', 'true');
    // The keys, in plain words, under the outline (pane-keys.mjs).
    const keys = element(doc, 'details', { className: 'ol-keys muted', id: 'outline-keys' }, element(doc, 'summary', { textContent: 'Keys' }),
      ...[KEY_WORDS, MESSAGE_KEY_WORDS].flatMap((rows, at) => [...(at ? [element(doc, 'p', { className: 'ol-keys-part', textContent: 'In the messages' })] : []),
        element(doc, 'dl', {}, ...rows.flatMap(([keys, words]) => [element(doc, 'dt', { textContent: keys }), element(doc, 'dd', { textContent: words })]))]));
    this.host.replaceChildren(sums, heading, this.list, this.empty, this.message, this.retry, this.more, key, keys);
    this.host.hidden = true;
  }
  // A run of the page starts (in-place-navigation.mjs): the outline shows on
  // a topic and a Conversation, and stays put while the run reads. The place
  // before is forgotten: until the run is up, the outline knows no outcome as
  // the one being read, and nothing the run before read is drawn.
  begin(feed) {
    this.host.hidden = !feed;
    this.run += 1; this.handles = null;
    this.unlisten?.(); this.unlisten = null;
    this.watch?.disconnect(); this.watch = null; this.watched = null;
    // The list the run that went drew stays in view until the next run's own
    // has something to show; nothing in it acts meanwhile.
    for (const outcome of this.outcomes.values()) for (const part of [outcome.adopted, outcome.notes]) if (part) part.inert = true;
    if (!feed) return;
    // Under the page's header on a phone: how much is new in the other
    // outcomes, which opens the outline (rail-drawer.mjs opens on data-opens-rail).
    const header = this.doc.querySelector('#main > .topic-header');
    if (header && !this.doc.getElementById('outline-elsewhere')) {
      const line = element(this.doc, 'button', { type: 'button', id: 'outline-elsewhere', className: 'outline-elsewhere', hidden: true });
      line.dataset.opensRail = ''; line.setAttribute('aria-controls', 'rail');
      header.after(line);
    }
    this.paintHeader();
  }
  // The run is up: from now on the outline reads through it and follows its
  // live feed. handles: { view(name, args), live, api, bootstrap, workspaceId,
  // topic (the open topic, or null on a Conversation), route }.
  ready(handles) {
    if (!['topic', 'conversation'].includes(handles.route?.kind)) return;
    this.handles = handles;
    const { bootstrap } = handles;
    // What a move of the person's order is sent through, kept for the moments between runs.
    this.sender = { api: handles.api, bootstrap };
    if (!this.started) {
      this.started = true;
      this.bootstrap = bootstrap; this.pageMax = handles.pageMax ?? PAGE;
      this.pages = new WorkspacePages(bootstrap.instance_id);
      this.newOutcomeLine();
    }
    // Arriving anywhere tidies the outline: the outcome being read is open, every other folded.
    this.opened.tidy();
    this.unlisten?.();
    this.unlisten = handles.live?.listen(event => { if ((event.kind === 'commit' || event.state === 'live') && this.doc.visibilityState === 'visible') this.reload(); }) ?? null;
    for (const outcome of this.outcomes.values()) outcome.rail?.updateCurrent(this.currentTopicIn(outcome.id));
    this.doc.getElementById('rail')?.setAttribute('aria-label', 'Outcomes');
    this.paint();
    this.reload();
  }
  // The person came back to the page: what changed meanwhile shows.
  shown() { if (this.handles && this.doc.visibilityState === 'visible') this.reload(); }
  get here() { return this.handles?.workspaceId ?? null; }
  currentTopicIn(id) { const topic = this.handles?.route?.kind === 'topic' ? this.handles.topic : null; return topic && topic.workspace_id === id ? topic : null; }
  // Whether an outcome shows its topics (Opened): the one being read, a peek, or every one a chip shows.
  isOpen(id) { return this.opened.isOpen(id, this.here, this.filter); }
  // The outline is how a person moves, so it reads in the foreground lane, as
  // the side rail did. A run's own reads go through that run (handles.view):
  // one still waiting for its turn when the run goes is never sent.
  own(handles) { return (name, args) => handles.view(name, args, 'foreground'); }
  // The list of outcomes, then each open outcome's topics and Conversation,
  // for the run that is up. Settles false when any of them could not be read;
  // what it read lands only while its run is still the page.
  async load() {
    const handles = this.handles, run = this.run, mine = () => run === this.run;
    if (!handles) return true;
    const view = this.own(handles), read = args => view('workspaces', args), here = handles.workspaceId, max = handles.pageMax ?? PAGE;
    try {
      await reread(this.pages, read, max);
      book.learn(scopeOf(null), this.pages.order);
      // The outcome being read is in the outline, however far down the list it is.
      while (mine() && !this.pages.loaded.has(here) && this.pages.next !== null) this.pages.accept(await read({ limit: max, cursor: this.pages.next }), this.pages.next);
      if (!mine()) return true;
      this.failed = false;
    }
    catch (error) { if (!mine()) return true; this.failed = error; this.listRead = true; this.paint(); return false; }
    this.listRead = true;
    this.paint();
    const reads = [];
    for (const item of this.pages.items) {
      if (!this.isOpen(item.id) || !shownUnder(this.filter, item)) continue;
      const outcome = this.outcome(item);
      reads.push(this.loadTopics(outcome), this.readConversation(outcome, view));
    }
    const settled = await Promise.all(reads.map(read => Promise.resolve(read).catch(() => false)));
    if (!mine()) return true;
    this.paint();
    return settled.every(read => read !== false);
  }
  async loadMore() {
    const handles = this.handles, run = this.run;
    if (!handles || this.pages.next === null) return;
    let failed = null;
    try { this.pages.accept(await this.own(handles)('workspaces', { limit: PAGE, cursor: this.pages.next }), this.pages.next); }
    catch (error) { failed = error; }
    if (run !== this.run) return;
    if (failed) this.failed = failed;
    this.paint();
  }
  // An outcome's Conversation, for its row's count. view: the run's own
  // reads, or by default the outline's, through whichever run is up.
  async readConversation(outcome, view = (name, args) => this.read(name, args, 'foreground')) {
    try {
      const answer = await view('conversation', { workspace_id: outcome.id });
      outcome.conversation = answer.conversation ?? null; outcome.conversationRead = true;
      return true;
    } catch { return false; }
  }
  // One outcome's parts, made once: its row, and under it its topic lists
  // (TopicRail, as the side rail drew them) and + New topic.
  outcome(item) {
    let outcome = this.outcomes.get(item.id);
    if (outcome) { outcome.item = item; return outcome; }
    const doc = this.doc, id = item.id;
    const title = element(doc, 'span', { className: 'ol-title' }), standing = element(doc, 'small', { className: 'standing' });
    const name = element(doc, 'a', { className: 'ol-name' }, element(doc, 'span', { className: 'ol-name-line' }, title), standing);
    name.dataset.conversationOf = id;
    // The whole row (its light, its name and where it stands) is the one thing to press.
    const row = element(doc, 'div', { className: 'ol-row' }, name);
    // The tree's rows are the names and the topics (key-tree.mjs); what holds them is no list of its own.
    row.setAttribute('role', 'none');
    const topics = element(doc, 'div', { className: 'ol-topics', id: `ol-topics-${id}` });
    topics.setAttribute('role', 'group');
    name.setAttribute('aria-controls', topics.id);
    const li = element(doc, 'li', { className: 'ol-outcome' }, row, topics);
    li.setAttribute('role', 'none');
    li.dataset.workspaceId = id;
    // Attached before its lists are made, so every listener they add is the outline's (in-place-navigation.mjs).
    this.list.append(li);
    const part = (tag, props) => element(doc, tag, props);
    const host = part('div', { className: 'topic-list ol-topic-list' }), more = part('button', { type: 'button', textContent: 'More topics', hidden: true });
    const retry = part('button', { type: 'button', textContent: 'Retry topics', hidden: true }), message = part('div', { className: 'notice', hidden: true });
    message.setAttribute('role', 'status');
    const group = name => {
      const details = part('details', { className: 'topic-group', hidden: true }), label = part('summary', { textContent: name === 'done' ? 'Done' : 'Archived' });
      const list = part('div', { className: 'topic-list' }), button = part('button', { type: 'button', textContent: `More ${name} topics`, hidden: true });
      list.setAttribute('aria-label', `${name === 'done' ? 'Done' : 'Archived'} topics in ${item.title}`);
      details.append(label, list, button);
      return { details, label, host: list, more: button };
    };
    const done = group('done'), archived = group('archived');
    const newTopic = part('button', { type: 'button', className: 'quiet ol-new-topic', textContent: '+ New topic' });
    const own = part('div', { className: 'ol-own' });
    own.append(message, host, more, retry, done.details, archived.details, newTopic);
    topics.append(own);
    outcome = { id, item, li, name, title, standing, topics, own, newTopic, conversation: null, conversationRead: false, rail: null, adopted: null, notes: null,
      parts: { host, more, retry, message, done, archived } };
    // A click or Return opens its Conversation, and with it its topics: the
    // outline tidies itself, every other outcome folded. Already there, it tidies at once.
    name.onclick = event => {
      if (!plainClick(event)) return;
      event.preventDefault();
      this.opened.tidy(); this.paint();
      this.open(this.nameTarget(outcome), outcome.item.title);
    };
    this.topicLine(outcome);
    this.outcomes.set(id, outcome);
    return outcome;
  }
  // Opens or folds one outcome from the keys, until the next place tidies it (Opened).
  setOpen(outcome, open) {
    if (this.isOpen(outcome.id) === open && !this.filter) return;
    const run = this.run;
    this.opened.set(outcome.id, open); this.filter = null;
    this.paint();
    if (open) Promise.all([this.loadTopics(outcome), this.readConversation(outcome)]).then(() => { if (run === this.run) this.paint(); });
  }
  // Opens or folds every outcome (⇧⌘→ ⇧⌘←), until the next place tidies them.
  // Folded, the keys that were on a topic go to its outcome.
  setAll(open, row = null) {
    const run = this.run;
    this.opened.all(open); this.filter = null;
    this.paint();
    if (row && row.level > 1) this.tree.go(this.tree.list().find(each => each.el === row.outcome.name));
    if (!open) return;
    for (const outcome of this.outcomes.values()) {
      Promise.all([this.loadTopics(outcome), this.readConversation(outcome)]).then(() => { if (run === this.run) this.paint(); });
    }
  }
  // The rows the keys move through, in order: each outcome's name, and under
  // an open one everything that can be pressed there (its topics, Done (N)
  // and Archived (N) with the topics of one open, More and Retry, + New topic,
  // its Notebook's pages). A title line being typed in is writing, not a row.
  treeRows() {
    const rows = [];
    for (const li of this.list.children) {
      const outcome = this.outcomes.get(li.dataset.workspaceId);
      if (!outcome || li.hidden) continue;
      // Open as drawn: between two runs the outline knows no place, and stays as the run before drew it.
      const open = li.hasAttribute('data-open'), id = outcome.id;
      rows.push({ el: outcome.name, level: 1, set: this.list, key: 'outcome:' + id, parent: null, expanded: open, outcome });
      if (!open) continue;
      for (const el of outcome.topics.querySelectorAll('a[href], button, summary')) {
        if (el.closest('.one-line')) continue;
        const group = el.closest('details.topic-group'), summary = group?.querySelector(':scope > summary') ?? null;
        if (group && el !== summary && !group.open) continue;
        const deep = Boolean(group) && el !== summary;
        const said = el.dataset.topicId ? 'topic:' + el.dataset.topicId : el.getAttribute('href') ?? el.textContent.replace(/\(\d+\)/g, '').replace(/^\+\s*/, '').trim();
        rows.push({ el, level: deep ? 3 : 2, set: deep ? group : li, key: `${id}|${said}`, parent: deep ? summary : outcome.name,
          expanded: el === summary ? group.open : undefined, outcome });
      }
    }
    return rows;
  }
  // What a key does on a row, beyond moving between rows (key-tree.mjs).
  act(action, row, rows) {
    const open = each => (each.level === 1 ? this.setOpen(each.outcome, true) : each.el.parentElement.open = true);
    const fold = each => (each.level === 1 ? this.setOpen(each.outcome, false) : each.el.parentElement.open = false);
    // → on an open outcome goes on into the messages, as → on a topic does; ↓ reaches its topics.
    if (action === 'right') { if ((row.level === 1 && row.expanded) || !this.tree.stepIn(row, rows, open)) panes.step('outline', 'right', this.doc); return; }
    if (action === 'left') { this.tree.stepOut(row, rows, fold); return; }
    if (action === 'open') { this.setOpen(row.outcome, true); return; }
    if (action === 'fold') { this.setOpen(row.outcome, false); this.tree.go(this.tree.list().find(each => each.el === row.outcome.name)); return; }
    if (action === 'open-all' || action === 'fold-all') { this.setAll(action === 'open-all', row); return; }
    if (action === 'move-up' || action === 'move-down') { this.reorder(row, action === 'move-up' ? -1 : 1); return; }
    if (action === 'undo') this.undo();
    if (action === 'write') this.write(row);
  }
  // ⌘Return: a new message in the topic the keys are on, or in the
  // Conversation of the outcome they are on; on any other row, in the page's own place.
  write(row) {
    if (row.el.dataset.topicId) { panes.write?.({ kind: 'topic', id: row.el.dataset.topicId }, rowTitle(row.el) || 'the topic'); return; }
    if (row.level !== 1) { panes.write?.(null); return; }
    const target = this.nameTarget(row.outcome);
    if (target.kind === 'conversation') panes.write?.(target, row.outcome.item.title);
  }
  // ⌘↑ ⌘↓: an outcome among the outcomes shown, a topic within the list that
  // holds it in its outcome. The row keeps the focus; a screen reader hears
  // where it went.
  reorder(row, delta) {
    let scope, shown, visible, title;
    if (row.level === 1) {
      // Only outcomes the reader is on can be placed: one shown only because it is being read stands where it is.
      if (row.outcome.item.provisional) { this.tree.say('Only the outcomes you are on can be moved'); return; }
      const placeable = [...this.list.children].filter(li => !this.outcomes.get(li.dataset.workspaceId)?.item.provisional);
      scope = scopeOf(null);
      shown = placeable.map(li => li.dataset.workspaceId);
      visible = new Set(placeable.filter(li => !li.hidden).map(li => li.dataset.workspaceId));
      title = row.outcome.item.title;
    } else if (row.el.dataset.topicId) {
      scope = scopeOf(row.outcome.id);
      // The list the row is drawn in: the page's own under the outcome being read, else the outline's.
      const box = row.outcome.adopted?.contains(row.el) ? row.outcome.adopted : row.outcome.own;
      const links = [...box.querySelectorAll('a[data-topic-id]')];
      shown = links.map(link => link.dataset.topicId);
      visible = new Set([...row.el.parentElement.children].filter(link => link.dataset.topicId && link.getClientRects().length).map(link => link.dataset.topicId));
      title = rowTitle(row.el) || 'The topic';
    } else return;
    const id = row.level === 1 ? row.outcome.id : row.el.dataset.topicId, next = moved(shown, id, delta, visible);
    if (!next) { this.tree.say(`${title} is already ${delta < 0 ? 'first' : 'last'}`); return; }
    this.save(scope, next, shown);
    const order = next.filter(each => visible.has(each));
    this.tree.say(movedWords(title, order.indexOf(id) + 1, order.length));
  }
  // ⌘Z: the last move put back.
  undo() {
    const last = book.undo();
    if (!last) { this.tree.say('Nothing to put back'); return; }
    this.save(last.scope, last.ids, null);
    this.tree.say('Put back as it was');
  }
  // Shows the order at once and sends it; says what went wrong, if anything did.
  save(scope, shown, before) {
    const sender = this.sender;
    if (!sender) return;
    const within = scope === scopeOf(null) ? null : scope.slice('topics:'.length);
    const send = ({ ids, revision, operation }) => {
      const { authority_id, authority_epoch } = sender.bootstrap.authority;
      return sender.api.command({ v: 1, instance_id: sender.bootstrap.instance_id, operation_id: operation, kind: 'outline.order_set',
        target: within === null ? {} : { workspace_id: within }, expected: { authority: { authority_id, authority_epoch }, order_revision: revision }, args: { ids } });
    };
    book.place(scope, shown, send, before).then(result => {
      if (result.conflict) { this.tree.say('Your order changed on another device; this shows it now.'); this.readOrder(scope, within); }
      else if (result.failed) this.tree.say(`Your order could not be saved, so it is back as it was: ${result.failed.message}`);
    });
  }
  // The order as Core holds it now, read with the first page of its list: the
  // book tells every list that draws it, the page's own and the outline's.
  readOrder(scope, within) {
    const read = within === null ? this.read('workspaces', { limit: 1 }, 'foreground') : this.read('workspace_topics', { workspace_id: within, limit: 1 }, 'foreground');
    return Promise.resolve(read).then(answer => book.learn(scope, orderOf(answer))).catch(() => false);
  }
  // The keys come to the outline, on the row they were last on; coming back
  // from the messages (reading), on the row of the place being read.
  focus({ reading = false } = {}) { return this.tree.focus(reading ? row => row.el.getAttribute('aria-current') === 'page' : null); }
  // The outline's own topic lists for an outcome (TopicRail, as the side rail
  // drew them), made the first time they are wanted.
  ownRail(outcome) {
    outcome.rail ??= new TopicRail({ reader: this.bootstrap.actor, pageMax: this.pageMax,
      pages: new TopicPages(this.bootstrap.instance_id, outcome.id, this.currentTopicIn(outcome.id)), ...outcome.parts,
      storage: this.storage, area: outcome.own, denied: error => readFailure(error).kind === 'forbidden',
      read: args => this.read('workspace_topics', args, 'foreground'), open: (topicId, topicTitle) => this.open({ kind: 'topic', id: topicId }, topicTitle) });
    return outcome.rail;
  }
  // An outcome's topics, read again: the page's own list reads itself.
  loadTopics(outcome) { return outcome.adopted || outcome.id === this.here ? true : this.ownRail(outcome).load(); }
  // Under the outcome being read, the page's own topic list (its TopicRail,
  // with its guard and its checks) stands in for the outline's, from when it
  // has something to show, so the list never blinks empty on a move. Which
  // outcome that is, and which list, are found each time from the run that
  // is up; a list not ready yet is watched, and the watch asks again.
  place() {
    const rail = this.doc.getElementById('rail'), fresh = rail?.querySelector(':scope > #topic-navigation');
    const outcome = this.here ? this.outcomes.get(this.here) : null;
    // The outline's first read of the outcomes has settled, so the rows above
    // the list are drawn and do not push it down as a topic is pressed.
    if (!fresh || !outcome || !this.handles || !this.listRead) return;
    // Its first read has settled (app.mjs marks it), so it shows all it will.
    if (!('listed' in fresh.dataset)) {
      if (this.watched === fresh) return;
      this.watch?.disconnect(); this.watched = fresh;
      this.watch = new MutationObserver(() => this.place());
      this.watch.observe(fresh, { attributes: true, attributeFilter: ['data-listed'] });
      return;
    }
    this.watch?.disconnect(); this.watch = null; this.watched = null;
    this.adopt(fresh, outcome, rail);
  }
  // The page's topic list goes under its outcome, and any list held for another goes back.
  adopt(fresh, outcome, rail) {
    for (const other of this.outcomes.values()) if (other.adopted && other !== outcome) this.release(other);
    outcome.adopted?.remove(); outcome.notes?.remove(); outcome.notes = null;
    fresh.dataset.pagePart = ''; fresh.classList.add('ol-adopted');
    // New topic ends the outcome's list, in the order focus moves as well as on screen.
    const heading = fresh.querySelector(':scope > .rail-heading'), line = heading?.nextElementSibling?.classList.contains('one-line') ? heading.nextElementSibling : null;
    if (heading) fresh.append(heading, ...(line ? [line] : []));
    outcome.own.hidden = true;
    outcome.topics.prepend(fresh); outcome.adopted = fresh;
    // The outcome's Notebook follows its topics, with its light and its pages opening in place.
    const notes = rail.querySelector(':scope > #outcome-references');
    if (notes) { notes.dataset.pagePart = ''; notes.classList.add('ol-notes'); fresh.after(notes); outcome.notes = notes; }
  }
  // The outcomes in the outline: those listed, and the outcome being read
  // even before the list is read, or when it is not one the list holds (a
  // reached outcome, or one the reader is not on the team of), in its place by
  // id, so its topics are in reach from the page's first paint.
  shownItems() {
    const items = this.pages?.items ?? [];
    if (!this.here || items.some(item => item.id === this.here)) return items;
    const here = { id: this.here, title: this.handles?.workspaceTitle || 'This outcome', title_truncated: false, unread: 0, addressed: 0, light: null, provisional: true };
    return [...items, here].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  // An outcome no longer read gets the outline's own lists back.
  release(outcome) {
    outcome.adopted.remove(); outcome.adopted = null;
    outcome.notes?.remove(); outcome.notes = null;
    outcome.own.hidden = false;
    if (this.isOpen(outcome.id)) this.ownRail(outcome).load();
  }
  // An outcome's name opens its Conversation; one Core says has none opens its page.
  nameTarget(outcome) {
    return outcome.conversationRead && !outcome.conversation ? { kind: 'workspace', id: outcome.id } : { kind: 'conversation', id: outcome.id };
  }
  // + New topic: one title line under it; Return starts the topic and opens it.
  topicLine(outcome) {
    let starter = null;
    const line = new OneLine({ id: `ol-new-topic-${outcome.id}`, label: `Title of the new topic in ${outcome.item.title}`, placeholder: 'New topic title', className: 'rail-line',
      submit: async title => {
        starter ??= new TopicStart({ api: this.handles.api, bootstrap: this.handles.bootstrap, workspace: outcome.id });
        const id = await starter.start(title);
        starter = null; line.input.value = ''; close();
        await this.open({ kind: 'topic', id }, title);
      } });
    const close = lineFromButton({ button: outcome.newTopic, after: outcome.newTopic, line });
  }
  // New outcome: one title line under the heading; Return creates it and opens its page.
  newOutcomeLine() {
    let start = null;
    const line = new OneLine({ id: 'outline-new-outcome-title', label: 'Title of the new outcome', placeholder: 'New outcome title', className: 'rail-line',
      submit: async title => {
        start ??= new OutcomeStart({ api: this.handles.api, bootstrap: this.handles.bootstrap });
        const id = await start.create(title);
        start = null; line.input.value = ''; close();
        await this.open({ kind: 'workspace', id }, title);
      } });
    const close = lineFromButton({ button: this.newOutcome, after: this.newOutcome.closest('.ol-heading'), line });
  }
  // Everything the outline says, as it now stands. Rows are kept and only
  // their words change; an outcome's place is its place in the list Core gives.
  paint() {
    // Between runs there is no place to draw for: the next run draws.
    if (!this.handles) return;
    // In the person's own order, what they never placed where Core lists it (outline-order.mjs).
    const items = arrangeItems(this.shownItems(), book.ids(scopeOf(null))), route = this.handles.route;
    const shown = new Set();
    // The outcome that holds the focus stays where it is, and the others move around it, so the focus stays.
    const focused = [...this.list.children].find(li => li.contains(this.doc.activeElement)) ?? null;
    items.forEach(item => {
      const outcome = this.outcome(item), open = this.isOpen(item.id), visible = shownUnder(this.filter, item);
      shown.add(item.id);
      outcome.li.hidden = !visible;
      outcome.li.toggleAttribute('data-open', open);
      outcome.li.toggleAttribute('data-fresh', count(item.unread) > 0);
      outcome.li.toggleAttribute('data-waiting', asksIn(item) > 0);
      outcome.topics.hidden = !open;
      // The outcome being read waits for the page's own list, unless the outline has shown its topics before.
      outcome.own.hidden = Boolean(outcome.adopted) || (item.id === this.here && !outcome.rail);
      outcome.topics.setAttribute('aria-label', `Topics in ${item.title}`);
      const target = this.nameTarget(outcome);
      outcome.name.href = routeHref(target);
      if (route?.kind === 'conversation' && route.id === item.id) outcome.name.setAttribute('aria-current', 'page'); else outcome.name.removeAttribute('aria-current');
      // The words only when they change, so the pointer's hover stays on what it was on.
      const counted = rowCount(item, { open, conversation: outcome.conversation });
      // Open, the row stands for its Conversation as the side rail's row did: its work ring, and Waiting on you.
      const own = open && outcome.conversation ? { waiting: waitsOnReader(outcome.conversation, this.handles?.bootstrap.actor).length > 0, work: Boolean(outcome.conversation.work?.observed) } : null;
      const said = JSON.stringify([item.title, item.title_truncated, counted, item.light, open, own]);
      if (outcome.said !== said) {
        outcome.said = said;
        outcome.title.textContent = item.title + (item.title_truncated ? '…' : '');
        paintUnread(outcome.title, { ...counted, unread: counted.unread });
        const spoken = outcome.title.querySelector('.sr-only');
        if (spoken && open && counted.unread) spoken.textContent += ' in its Conversation';
        if (item.provisional) outcome.standing.replaceChildren(); else paintRowLight(outcome.standing, item.light);
        // The light leads the name; its words stay on the line under it.
        const lamp = outcome.standing.querySelector('.outcome-light');
        const line = outcome.name.firstChild;
        line.querySelector(':scope > .outcome-light')?.remove(); line.querySelector(':scope > .topic-state')?.remove();
        if (lamp) line.prepend(lamp);
        if (own?.work) outcome.title.append(element(this.doc, 'span', { className: 'topic-work', ariaHidden: 'true' }));
        if (own?.waiting) { const state = element(this.doc, 'span', { className: 'topic-state mine', textContent: 'Waiting on you' }); state.dataset.state = 'waiting'; line.append(state); }
      }
    });
    for (const [id, outcome] of this.outcomes) if (!shown.has(id)) { outcome.li.remove(); this.outcomes.delete(id); }
    arrange(this.list, items.map(item => this.outcomes.get(item.id).li), focused);
    const sum = totals(this.pages?.items ?? []);
    this.newCount.textContent = String(sum.fresh); this.waitingCount.textContent = String(sum.waiting);
    this.onlyNew.setAttribute('aria-pressed', String(this.filter === 'new'));
    this.onlyWaiting.setAttribute('aria-pressed', String(this.filter === 'waiting'));
    this.onlyNew.disabled = !sum.fresh && this.filter !== 'new';
    this.onlyWaiting.disabled = !sum.waiting && this.filter !== 'waiting';
    this.host.dataset.only = this.filter ?? '';
    const anyShown = items.some(item => shownUnder(this.filter, item));
    this.empty.hidden = !this.pages?.started || anyShown && items.length > 0;
    this.empty.textContent = this.filter === 'waiting' ? 'Nothing is waiting on you.' : this.filter === 'new' ? 'Nothing new anywhere.' : 'No outcomes are available yet.';
    const failure = this.failed;
    this.message.hidden = !failure; this.retry.hidden = !failure;
    if (failure) this.message.textContent = `${failure.message ?? 'The outcomes could not be read.'} Retry outcomes.`;
    this.more.hidden = !this.pages || this.pages.next === null;
    this.paintHeader();
    this.place();
  }
  // On a phone: "☰ Outcomes" carries the total and the lit light, and a line
  // under the header says how much is new in the other outcomes. Both are the
  // page's (a move puts them back fresh), so they are found each time.
  paintHeader() {
    const doc = this.doc, items = this.pages?.items ?? [], sum = totals(items);
    const control = doc.getElementById('rail-open');
    if (control) {
      let badge = control.querySelector('.unread-count'), lamp = control.querySelector('.outcome-light');
      if (!badge) {
        badge = element(doc, 'span', { className: 'unread-count' }); badge.setAttribute('aria-hidden', 'true');
        lamp = element(doc, 'span', { className: 'outcome-light' }); lamp.dataset.light = 'waiting'; lamp.setAttribute('aria-hidden', 'true');
        control.replaceChildren(element(doc, 'span', { textContent: '☰' }), ' Outcomes', badge, lamp);
        control.firstChild.setAttribute('aria-hidden', 'true');
      }
      badge.textContent = String(sum.fresh); badge.hidden = !sum.fresh; lamp.hidden = !sum.waiting;
      control.setAttribute('aria-label', ['Outcomes', sum.fresh ? `${sum.fresh} new` : '', sum.waiting ? `${sum.waiting} waiting on you` : ''].filter(Boolean).join(', '));
    }
    const line = doc.getElementById('outline-elsewhere');
    if (line) {
      const away = elsewhere(items, this.here), words = elsewhereWords(away);
      line.hidden = !words;
      if (words) {
        const lamp = element(doc, 'span', { className: 'outcome-light' }); lamp.dataset.light = 'waiting'; lamp.setAttribute('aria-hidden', 'true'); lamp.hidden = !away.waiting;
        const arrow = element(doc, 'span', { className: 'ol-go', textContent: '›' }); arrow.setAttribute('aria-hidden', 'true');
        line.replaceChildren(lamp, element(doc, 'span', { textContent: words }), arrow);
      }
    }
  }
}
