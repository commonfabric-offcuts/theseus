import { outcomeColors, validOutcomeColor } from './outcome-colors.mjs';
import { OutlineMenus } from './outline-menus.mjs';
// The outline on the left of a topic (pipeline
// items 272 and 902; docs/rails.md): every outcome, with its own remembered
// disclosure. A chevron opens or folds its topics in place; its name opens
// its home. Desktop arrival keeps manual disclosure; phone arrival opens its
// current outcome without folding another.
// On a phone a folded outcome
// first opens its topics without moving (item 654); folded, it carries
// the count of everything new inside it; open, its own row has no unread
// badge (item 1164). Each topic row shows its own; Build topics and their
// counts belong to the right rail. The topic rows are today's
// (TopicRail): unread counts, the work ring, Waiting on you and Ready for
// review, Done (N) and Archived (N), in the server's order; an outcome's Build
// topics not yet Done are the right rail's, never listed here too (item 297).
// A quiet pencil beside an outcome's name starts a new topic there, and one
// beside the Outcomes heading a new outcome (item 305): each shows while the
// pointer is on its row or the keys are on it, and always on a phone. At the
// top, "N new" shows only what is new; "N waiting on you" dims other rows
// without replacing the person's disclosure choices or saved dim sets.
//
// The outline is the shell's (in-place-navigation.mjs): it stays the same
// element across moves, with its scroll and the keys' place. It reads what Core
// already serves (workspaces, workspace_topics, conversation) through the
// page that is up, and again on relevant commits (scoped on outcome homes). It
// never moves anything by itself: outcomes keep their order, a new message
// changes only counts and lights, and topics keep the order their list gives.
// Only the person moves a row (⌘↑ ⌘↓): the order they place is theirs, kept
// by Core and read back on every device (outline-order.mjs).
//
// The keys move through it as one tree (key-tree.mjs, pane-keys.mjs): ↑ ↓
// between the rows, Return opens one, ⌘→ ⌘← open and fold an outcome, → and
// ← take the tree's steps and then move to the messages (panes.mjs): → on a
// folded outcome opens it, the next lands on its pencil, the first row under
// it, and the next goes on into the messages. ↑ from the first outcome lands
// on the Outcomes heading's pencil. ⌘Return starts a new message in the
// row's topic, or in the outcome's Conversation. A click or a tap on a row
// selects it as the keys do (item 462): the keys stay on it, ringed, as its
// place opens.
//
// Which outcome is being read, which topic is open and whose list sits under
// it come from the run of the page that is up, and from nothing before it.
// Each run's reads and drawing are its own: what a run read lands only while
// it is still the page, and a run that has gone draws nothing.
import { readTopicList, TopicRail, TopicPages, WorkspacePages, reread, routeHref, topicTarget, paintUnread, arrange, PAGE } from './topic-navigation.mjs';
import { paintRowLight } from './outcome-light.mjs';
import { OneLine, OutcomeStart, TopicStart, lineFromButton } from './quick-create.mjs';
import { Superseded } from './in-place-navigation.mjs';
import { readFailure } from './freshness.mjs';
import { reloader } from './live.mjs';
import { KeyTree } from './key-tree.mjs';
import { KEY_WORDS, MESSAGE_KEY_WORDS, keyAction } from './pane-keys.mjs';
import { book, scopeOf, arrangeItems, moved, movedWords, orderOf } from './outline-order.mjs';
import { panes } from './panes.mjs';
import { presses, questionTarget } from './waiting-questions.mjs';
import { OutlineDossiers } from './outline-dossiers.mjs';
import { glyph } from './glyphs.mjs';
import { RailDimming } from './rail-dimming.mjs';
import { RailTopicFold } from './rail-topic-fold.mjs';
import { SidebarChanges, mergeSidebarDirty } from './sidebar-refresh.mjs';

const count = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
// The questions waiting on the reader in one outcome, as its light counts them.
export const asksIn = item => item?.light?.light === 'waiting' && item.light.short?.kind === 'asks' ? count(item.light.short.count) : 0;
// Covers are separate from the light's said/ask topics; neither replaces the other.
export const waitingIn = item => asksIn(item) + count(item?.cover_waiting);
// Folded, the outcome's unread total and the part sent by name. Expanded,
// no outcome-level unread badge: the topics keep their own counts, including
// the Build topics in the right rail (items 1164 and 297).
export function rowCount(item, { open = false } = {}) {
  if (open) return { unread: 0, addressed: 0 };
  return { unread: count(item?.unread), addressed: count(item?.addressed) };
}
// Everything new and every question waiting, across every outcome listed.
export function totals(items) {
  let fresh = 0, waiting = 0;
  for (const item of items ?? []) { fresh += count(item.unread); waiting += waitingIn(item); }
  return { fresh, waiting };
}
// What is new outside the outcome being read: how much, in how many outcomes,
// and how many questions wait there. The line under a phone's header says it.
export function elsewhere(items, here) {
  let fresh = 0, where = 0, waiting = 0;
  for (const item of items ?? []) {
    if (item.id === here) continue;
    if (count(item.unread)) { fresh += count(item.unread); where += 1; }
    waiting += waitingIn(item);
  }
  return { fresh, where, waiting };
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export function elsewhereWords({ fresh, where, waiting }) {
  return [fresh ? `${fresh} new in ${plural(where, 'other outcome', 'other outcomes')}` : '', waiting ? `${waiting} waiting on you` : ''].filter(Boolean).join(' · ');
}
// Only New hides outcomes. Waiting uses the existing row marks as a dim layer.
export function shownUnder(filter, item) {
  if (filter === 'new') return count(item?.unread) > 0;
  return true;
}

// One fold per outcome, kept for this reader and instance on this device.
// Before an all command, new outcomes start folded except the current one.
// Filters open matching outcomes without replacing remembered choices.
export class Opened {
  constructor(storage = null, key = null) {
    Object.assign(this, { storage, key }); this.marks = new Map(); this.every = null;
    this.unsaved = new Map(); this.unsavedAll = null;
    this.read();
  }
  read() {
    try {
      const saved = JSON.parse(this.storage?.getItem(this.key) ?? '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        // The old flat boolean map is still admitted. Keep the default outside
        // the marks so no valid outcome id becomes a reserved preference key.
        const marks = saved.marks && typeof saved.marks === 'object' && !Array.isArray(saved.marks) ? saved.marks : saved;
        this.every = marks !== saved && typeof saved.every === 'boolean' ? saved.every : null;
        this.marks = new Map(Object.entries(marks).filter(([, open]) => typeof open === 'boolean'));
      }
    } catch { /* unavailable or invalid device preference: use the defaults */ }
    // Failed writes still hold on this page, and merge when storage recovers.
    if (this.unsavedAll !== null) { this.every = this.unsavedAll; this.marks.clear(); }
    for (const [id, open] of this.unsaved) this.marks.set(id, open);
  }
  isOpen(id, here = null, filter = null) {
    if (filter) return true;
    if (this.marks.has(id)) return this.marks.get(id);
    return this.every ?? id === here;
  }
  save() {
    try {
      if (this.key === null || !this.storage) return;
      this.storage.setItem(this.key, JSON.stringify({ every: this.every, marks: Object.fromEntries(this.marks) }));
      this.unsaved.clear(); this.unsavedAll = null;
    }
    catch { /* the choices still hold in this page */ }
  }
  set(id, open) {
    this.read(); // Merge this key with choices another tab made since our last read.
    this.marks.set(id, open); this.unsaved.set(id, open); this.save();
  }
  // Every outcome, including those not loaded yet; later choices are exceptions.
  all(open) {
    this.marks.clear(); this.every = open;
    this.unsaved.clear(); this.unsavedAll = open;
    this.save();
  }
}

const element = (doc, tag, props = {}, ...children) => {
  const node = Object.assign(doc.createElement(tag), props);
  node.append(...children); return node;
};
// A pencil means "new": the glyph of the page's New message (index.html), named and given its tooltip.
function pencil(doc, { id, className, label, tip }) {
  const button = element(doc, 'button', { type: 'button', className: 'ol-pencil ' + className, id, title: tip, tabIndex: -1 });
  button.setAttribute('aria-label', label);
  const glyph = doc.getElementById('new-message')?.querySelector('svg')?.cloneNode(true);
  if (!glyph) throw Error('The page has no New message pencil to draw the outline\'s from');
  button.append(glyph);
  return button;
}
// A topic row's title, without its count and the words read out for it.
function rowTitle(link) {
  const copy = link.cloneNode(true);
  for (const part of copy.querySelectorAll('.sr-only, .unread-count, .topic-state, .topic-work, .rail-hotkeycap')) part.remove();
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
    let pending = new Set(), full = false, result = true;
    const reload = reloader(async () => { const dirty = full ? null : pending; full = false; pending = new Set(); result = await this.load(dirty); });
    this.reload = (dirty = null) => { if (dirty) mergeSidebarDirty(pending, dirty); else full = true; return reload().then(() => result); };
    this.build();
    this.phoneMedia = doc.defaultView.matchMedia('(max-width: 760px)');
    this.phoneMedia.addEventListener?.('change', () => this.paint());
    this.dimming = new RailDimming({ host, storage, doc, enabled: () => Boolean(this.handles) });
    this.menus = new OutlineMenus(this);
    this.dossiers = new OutlineDossiers(this);
    this.notebookStars = new OutlineDossiers(this,{pages:true});
    // ↑ above its first row (New outcome, the heading's pencil) and ↓ below its last go on in the side rail: up to the
    // chips and the logo block, down to Keys (arrow-reach.mjs).
    this.tree = new KeyTree({ root: this.list, doc: this.doc, column: this.host.closest('.rail') ?? this.host, rows: () => this.treeRows(), act: (action, row, rows) => this.act(action, row, rows), selectOnPress: true, also: [this.newOutcome] });
    // ⇧⌘→ and ⇧⌘← open and fold every outcome from anywhere in the outline:
    // its rows (the tree hears those), its chips, New outcome or its Keys.
    this.host.addEventListener('keydown', event => {
      const action = keyAction(event);
      if (action !== 'open-all' && action !== 'fold-all') return;
      event.preventDefault();
      this.setAll(action === 'open-all');
    });
    // Undo is for the moves just made: once the keys leave the outline, they are kept as they are.
    this.list.addEventListener('focusout', event => { if (event.relatedTarget && !this.tree.holds(event.relatedTarget)) book.forget(); });
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
      chip.onclick = () => { this.filter = this.filter === filter ? null : filter; this.paint(); if (this.filter === 'new') this.reload(); };
    }
    const sums = element(doc, 'div', { className: 'ol-sums' }, this.onlyNew, this.onlyWaiting);
    sums.setAttribute('role', 'group'); sums.setAttribute('aria-label', 'Across every outcome');
    // New outcome is the heading's pencil, the first row of the outline's keys.
    this.newOutcome = pencil(doc, { id: 'outline-new-outcome', className: 'ol-new-outcome', label: 'New outcome', tip: 'New outcome' });
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
  // before is no longer current; its loaded rows stay while the next run reads.
  begin(feed) {
    this.menus.reset();
    this.host.hidden = !feed;
    this.run += 1; this.handles = null;
    this.dossiers.begin();
    this.notebookStars.begin();
    this.unlisten?.(); this.unlisten = null;
    this.colorUnlisten?.(); this.colorUnlisten = null;
    for (const outcome of this.outcomes.values()) outcome.rail?.invalidate();
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
    if (!['topic', 'conversation', 'workspace'].includes(handles.route?.kind)) return;
    this.handles = handles;
    this.outcomesKey = handles.live?.outcomes ?? null; this.readOutcomesKey = null;
    this.starting = handles.route?.kind === 'workspace';
    const { bootstrap } = handles;
    outcomeColors.bind({ api: handles.api, bootstrap });
    this.colorUnlisten?.(); this.colorUnlisten = outcomeColors.listen(() => this.paint());
    this.dimming.bind(bootstrap.instance_id, bootstrap.actor, handles);
    // What a move of the person's order is sent through, kept for the moments between runs.
    this.sender = { api: handles.api, bootstrap };
    this.initialize(bootstrap, handles.pageMax ?? PAGE);
    // Desktop navigation reads other tabs' choices without changing one.
    // Phone arrival retains654's open-current behavior.
    if (this.here && this.phone) this.opened.set(this.here, true);
    else this.opened.read();
    this.unlisten?.();
    const run = this.run, current = () => this.handles === handles && this.run === run;
    this.sidebarChanges = handles.outcomeChanges ? null : new SidebarChanges({ bootstrap, current,
      read: (name, args, readClass) => handles.view(name, args, readClass), context: () => this.changeContext(), outcomesKey: this.outcomesKey });
    let full = true;
    const changed = reloader(async () => {
      const force = full; full = false;
      try {
        const batch = await this.sidebarChanges.next();
        if (!current()) return true;
        const dirty = force ? null : batch.dirty;
        const okay = dirty && !dirty.size ? true : await this.reload(dirty);
        if (okay !== false) {
          batch.accept();
          // Initial projection reads can reveal more authorized scopes. Warm
          // those at opening, before a first unrelated send has to do it.
          if (this.sidebarChanges.hasNewScopes()) changed();
        } else full ||= force;
        return okay;
      } catch {
        if (!current()) return true;
        full = true;
        return this.reload();
      }
    });
    this.unlisten = handles.outcomeChanges ? handles.outcomeChanges.listen(dirty => this.reload(dirty))
      : handles.live?.listen(event => {
        if (typeof event.outcomes === 'string') this.outcomesKey = event.outcomes;
        this.sidebarChanges.observe(event);
        if (this.doc.visibilityState !== 'visible') return;
        if (!this.sidebarChanges.enabled) {
          // Older servers lack scoped changes. Preserve their immediate load
          // and opaque-key list caching, including folded-outcome counts.
          if (event.state === 'live') this.reload();
          else if (event.kind === 'commit') {
            const dirty = new Set(['topics', 'stars', 'pages', 'counts']);
            if (this.outcomesKey === null || this.outcomesKey !== this.readOutcomesKey) dirty.add('outcomes');
            this.reload(dirty);
          }
        } else if (event.state === 'live') { full = true; changed(); }
        else if (event.kind === 'commit') changed();
      }) ?? null;
    for (const outcome of this.outcomes.values()) outcome.rail?.updateCurrent(this.currentTopicIn(outcome.id));
    this.doc.getElementById('rail')?.setAttribute('aria-label', 'Outcomes');
    this.paint();
    if (!handles.outcomeChanges) { if (this.sidebarChanges.enabled) changed(); else this.reload(); }
  }
  // Watch the authorized open workspace lists and only Notebook topics whose
  // starred pages are displayed. Personal changes cover stars/counts globally.
  changeContext() {
    const topics = new Map(), scopes = [], starredTopics = new Set(), pages = new Map();
    for (const [id, outcome] of this.outcomes) {
      // Folded outcomes still show live counts. Their workspace keys must be
      // watched too, while actual topic lists are read only when open.
      if (this.pages?.loaded.has(id) || this.handles?.route?.kind === 'workspace' && id === this.here) scopes.push({ kind: 'workspace', id });
      for (const item of outcome.rail?.pages?.items ?? []) topics.set(item.id, id);
      if (outcome.conversation?.topic_id) topics.set(outcome.conversation.topic_id, id);
    }
    const current = this.handles?.currentTopic?.() ?? this.handles?.topic;
    if (current) {
      topics.set(current.id, current.workspace_id);
      if (!this.pages?.loaded.has(current.workspace_id)) scopes.push({ kind: 'topic', id: current.id });
    }
    for (const [id, state] of this.dossiers.states) if (state.visible !== false && state.stars.length) starredTopics.add(id);
    for (const [id, state] of this.notebookStars.states) if (state.visible !== false && state.stars.length) {
      pages.set(id, new Set(state.stars.map(item => item.item_id)));
      scopes.push({ kind: 'topic', id });
    }
    return { scopes, topics, starredTopics, pages };
  }
  initialize(bootstrap, pageMax = PAGE) {
    if (this.started && this.bootstrap.instance_id === bootstrap.instance_id && this.bootstrap.actor === bootstrap.actor) return;
    if (this.started) {
      for (const outcome of this.outcomes.values()) { outcome.fold.dispose(); outcome.li.remove(); }
      this.outcomes.clear(); this.dossiers.reset(); this.notebookStars.reset();
    }
    this.started = true; this.bootstrap = bootstrap; this.pageMax = pageMax;
    this.opened = new Opened(this.storage, `aim-next.outline-open.${JSON.stringify([bootstrap.instance_id, bootstrap.actor])}`);
    this.pages = new WorkspacePages(bootstrap.instance_id); this.newOutcomeLine();
  }
  // The topic page consumes the same retained rail as its outcome home.
  topicsFor(bootstrap, topic, pageMax) {
    this.initialize(bootstrap, pageMax);
    const outcome = this.outcome({ id: topic.workspace_id, title: 'This outcome', provisional: true });
    const rail = this.ownRail(outcome); rail.updateCurrent(topic); return rail;
  }
  // The person came back to the page: what changed meanwhile shows.
  shown() { if (this.handles && this.doc.visibilityState === 'visible') this.reload(); }
  topicChanged() {
    for (const outcome of this.outcomes.values()) outcome.rail?.updateCurrent(this.currentTopicIn(outcome.id));
    this.paint();
  }
  get here() { return this.handles?.workspaceId ?? null; }
  get phone() { return this.doc.defaultView.matchMedia('(max-width: 760px)').matches; }
  currentTopicIn(id) { const topic = this.handles?.route?.kind === 'topic' ? (this.handles.currentTopic?.() ?? this.handles.topic) : null; return topic && topic.workspace_id === id ? topic : null; }
  // Whether an outcome shows its topics (Opened): the one being read, a peek, or every one a chip shows.
  isOpen(id) { return this.opened.isOpen(id, this.phone ? this.here : null, this.filter === 'new' ? 'new' : null); }
  // The outline is how a person moves, so it reads in the foreground lane, as
  // the side rail did. A run's own reads go through that run (handles.view):
  // one still waiting for its turn when the run goes is never sent.
  own(handles) { return (name, args) => handles.view(name, args, 'foreground'); }
  // The current outcome's topics first, then outcomes and other open topics,
  // for the run that is up. Settles false when any of them could not be read;
  // what it read lands only while its run is still the page.
  async load(dirty = null) {
    const handles = this.handles, run = this.run, outcomesKey = this.outcomesKey, mine = () => run === this.run;
    if (!handles) return true;
    const starReads = new Set([...this.dossiers.states.values(), ...this.notebookStars.states.values()].map(state => state.busy).filter(Boolean));
    const view = this.own(handles), read = args => view('workspaces', args), here = handles.workspaceId, max = handles.pageMax ?? PAGE;
    const wants = key => !dirty || dirty.has(key);
    // Read the current outcome's topics before the global outcome list. Its
    // provisional row is this same outline owner, not a second card list.
    const first = wants('topics') && (!dirty?.topicWorkspaces || dirty.topicWorkspaces.has(here)) && handles.route?.kind === 'workspace' ? this.outcomes.get(here) : null;
    const firstRead = first ? await this.loadTopics(first) : true;
    if (!mine()) return true;
    this.starting = false;
    try {
      if (wants('outcomes')) await reread(this.pages, read, max);
      book.learn(scopeOf(null), this.pages.order);
      // The outcome being read is in the outline, however far down the list it is.
      while (wants('outcomes') && mine() && !this.pages.loaded.has(here) && this.pages.next !== null) this.pages.accept(await read({ limit: max, cursor: this.pages.next }), this.pages.next);
      if (!mine()) return true;
      // A list read already carries these facts. Ordinary commits refresh only
      // the loaded rows' counts, leaving list metadata and paging untouched.
      if (!wants('outcomes') && wants('counts')) await this.loadCounts(view, handles, mine);
      if (!mine()) return true;
      if (wants('outcomes')) this.readOutcomesKey = outcomesKey;
      this.failed = false;
    }
    catch (error) { if (!mine()) return true; this.failed = error; this.listRead = true; this.paint(); return false; }
    this.listRead = true;
    this.paint();
    const reads = [];
    // A directly reached outcome can be readable without being in the
    // person's workspaces list. Its provisional outline row owns its topics too.
    for (const item of this.shownItems()) {
      if (!wants('topics') || dirty?.topicWorkspaces && !dirty.topicWorkspaces.has(item.id) || !this.isOpen(item.id) || !shownUnder(this.filter, item)) continue;
      const outcome = this.outcome(item);
      if (outcome === first) continue;
      reads.push(this.loadTopics(outcome));
    }
    const settled = await Promise.all(reads.map(read => Promise.resolve(read).catch(() => false)));
    if (!mine()) return true;
    this.paint();
    // Share a sync read begun during this pass, but follow any older read
    // (including More/visible-row sync) which may predate the changed window.
    const stars = [...(wants('stars') || !dirty?.sidebar && wants('topics') ? await this.dossiers.refresh(starReads, dirty?.starTopics) : []),
      ...(wants('pages') || !dirty?.sidebar && wants('topics') ? await this.notebookStars.refresh(starReads, dirty?.pageTopics) : [])];
    return firstRead !== false && settled.every(read => read !== false) && stars.every(Boolean);
  }
  async loadCounts(view, handles, mine) {
    const ids = [...this.pages.loaded.keys()], updates = [];
    const max = handles.bootstrap.limits?.page_max ?? PAGE;
    const validCount = value => Number.isSafeInteger(value) && value >= 0;
    const fields = ['id', 'unread', 'addressed', 'build', 'cover_waiting', 'light'];
    const allowed = new Set([...fields, 'color', 'color_revision']);
    const fail = () => { throw Error('The outcome counts could not be confirmed. Retry outcomes.'); };
    for (let start = 0; start < ids.length; start += max) {
      const wanted = new Set(ids.slice(start, start + max));
      const answer = await view('workspace_counts', { workspace_ids: [...wanted] });
      if (!mine()) return;
      if (answer?.instance_id !== handles.bootstrap.instance_id || !Array.isArray(answer.items) || answer.items.length !== wanted.size) fail();
      for (const item of answer.items) {
        if (!item || !Object.keys(item).every(key => allowed.has(key)) || !fields.every(key => Object.hasOwn(item, key)) || !wanted.delete(item.id) ||
          ![item.unread, item.addressed, item.cover_waiting, item.build?.unread, item.build?.addressed].every(validCount) ||
          !(item.light === null || typeof item.light === 'object' && typeof item.light.light === 'string')) fail();
        // Never pair an incomplete color with an older row's revision.
        const color = validOutcomeColor(item);
        updates.push({ ...structuredClone(item), color: color ? item.color : undefined, color_revision: color ? item.color_revision : undefined });
      }
    }
    if (!mine()) return;
    // All chunks succeeded. A failed or retired read publishes no partial sum.
    for (const item of updates) {
      const current = this.pages.loaded.get(item.id);
      if (current) this.pages.loaded.set(item.id, { ...current, ...item });
    }
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
  // An outcome's conversation, for the write shortcut. view: the run's own
  // reads, or by default the outline's, through whichever run is up.
  async readConversation(outcome, view = (name, args) => this.read(name, args, 'foreground')) {
    try {
      const answer = await view('conversation', { workspace_id: outcome.id });
      outcome.conversation = answer.conversation ?? null; outcome.conversationRead = true;
      return true;
    } catch { return false; }
  }
  // One outcome's parts, made once: its row with its pencil, and under it its
  // topic lists (TopicRail, as the side rail drew them).
  outcome(item) {
    let outcome = this.outcomes.get(item.id);
    if (outcome) { outcome.item = item; return outcome; }
    const doc = this.doc, id = item.id;
    const title = element(doc, 'span', { className: 'ol-title' }), standing = element(doc, 'small', { className: 'standing' });
    const name = element(doc, 'a', { className: 'ol-name' }, element(doc, 'span', { className: 'ol-name-line' }, title), standing);
    name.dataset.workspaceId = id;
    const disclosure = element(doc, 'button', { type: 'button', className: 'ol-disclosure', tabIndex: 0 }, glyph('chevron', doc));
    // The name still navigates; disclosure is an independent in-place action.
    // Beside the name, the pencil that starts a new topic here; a press on it opens and folds nothing.
    const newTopic = pencil(doc, { id: `ol-pencil-${id}`, className: 'ol-new-topic', label: `New topic in ${item.title}`, tip: 'New topic' });
    const row = element(doc, 'div', { className: 'ol-row' }, disclosure, name, newTopic);
    // The tree's rows are the names and the topics (key-tree.mjs); what holds them is no list of its own.
    row.setAttribute('role', 'none');
    const topics = element(doc, 'div', { className: 'ol-topics', id: `ol-topics-${id}` });
    topics.setAttribute('role', 'group');
    name.setAttribute('aria-controls', topics.id);
    disclosure.setAttribute('aria-controls', topics.id);
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
    const own = part('div', { className: 'ol-own' });
    const footer = part('div', { className: 'ol-topic-foot' });
    footer.append(more, retry, done.details, archived.details);
    own.append(message, host, footer);
    topics.append(own);
    outcome = { id, item, li, row, disclosure, name, title, standing, waiting: null, topics, own, newTopic, conversation: null, conversationRead: false, rail: null,
      parts: { host, more, retry, message, done, archived } };
    outcome.fold = new RailTopicFold({ area: own, host, footer, doc });
    disclosure.onclick = event => {
      if (!plainClick(event)) return;
      event.preventDefault(); event.stopPropagation();
      if (this.handles) this.setOpen(outcome, !this.isOpen(id));
    };
    disclosure.onkeydown = event => {
      const action = keyAction(event);
      if (!['right', 'left', 'open', 'fold'].includes(action)) return;
      event.preventDefault(); event.stopPropagation();
      if (this.handles) this.setOpen(outcome, action === 'right' || action === 'open');
    };
    // On a phone a collapsed outcome first opens its topics here (item 654),
    // with no move and no drawer close; the next tap opens its home.
    // On a laptop, and with Return, the name opens its home. Folding is the
    // disclosure's action; the tree keeps its existing name-row keys.
    name.onclick = event => {
      if (!plainClick(event)) return;
      event.preventDefault();
      if (event.detail !== 0 && this.doc.defaultView.matchMedia('(max-width: 760px)').matches) {
        if (!this.isOpen(outcome.id)) {
          // This link expanded in place: the drawer's bubbling link listener
          // must not close it. The tree has already selected the pressed row.
          event.stopPropagation();
          this.setOpen(outcome, true);
          return;
        }
      }
      this.open(this.nameTarget(outcome), outcome.item.title);
    };
    this.topicLine(outcome);
    this.outcomes.set(id, outcome);
    return outcome;
  }
  // The phone drawer keeps its question cycle. Desktop uses the waiting pill
  // and topic rows; it carries neither a hidden cycle button nor its handler.
  phoneQuestionControl(outcome) {
    if (this.phone && !outcome.waiting) {
      const waiting = element(this.doc, 'button', { type: 'button', className: 'ol-waiting', hidden: true });
      waiting.onclick = () => this.openPhoneQuestion(outcome);
      outcome.row.append(waiting); outcome.waiting = waiting; outcome.said = null;
    } else if (!this.phone && outcome.waiting) {
      if (this.doc.activeElement === outcome.waiting) outcome.name.focus({ preventScroll: true });
      outcome.name.append(outcome.standing);
      outcome.waiting.remove(); outcome.waiting = null; outcome.said = null;
    }
  }
  async openPhoneQuestion(outcome) {
    if (!this.phone) return;
    // One read at a time. A busy flag, not disabled: disabling the button would
    // take the focus off it, and the Reader the question opens in gives the
    // focus back to what had it (item 462: the keys stay on the row pressed).
    if (outcome.asking) return;
    outcome.asking = true;
    const run = this.run;
    try {
      const answer = await this.read('outcome_light', {workspace_id:outcome.id}, 'foreground');
      if (run !== this.run) return;
      // The oldest question first, and each press after it the next (waiting-questions.mjs).
      const ask = presses.next('outcome:' + outcome.id, (answer.facts ?? []).filter(fact => fact.kind === 'ask'));
      if (!ask) {
        this.message.textContent = 'Nothing is waiting on you in this outcome now.';
        this.message.hidden = false; this.reload(); return;
      }
      await this.open(questionTarget(ask), ask.title);
    } catch (error) {
      this.message.textContent = readFailure(error).message; this.message.hidden = false;
    } finally { outcome.asking = false; }
  }
  // Opens or folds one outcome, from its disclosure or the existing keys.
  setOpen(outcome, open) {
    if (this.isOpen(outcome.id) === open && !this.filter) return;
    const run = this.run;
    this.opened.set(outcome.id, open); this.filter = null;
    this.paint();
    if (open) Promise.resolve(this.loadTopics(outcome)).then(() => { if (run === this.run) this.paint(); });
  }
  // Opens or folds every outcome (⇧⌘→ ⇧⌘←), including those loaded later.
  // Folded, the keys that were on a topic go to its outcome.
  setAll(open, row = null) {
    const run = this.run;
    this.opened.all(open); this.filter = null;
    this.paint();
    if (row && row.level > 1) this.tree.go(this.tree.list().find(each => each.el === row.outcome.name));
    if (!open) return;
    for (const outcome of this.outcomes.values()) {
      Promise.resolve(this.loadTopics(outcome)).then(() => { if (run === this.run) this.paint(); });
    }
  }
  // The rows the keys move through, in order: the Outcomes heading's pencil,
  // each outcome's name, and under an open one its pencil, then everything
  // that can be pressed there (its topics, Done (N) and Archived (N) with the
  // topics of one open, More and Retry). The outcome's Notebook is the right
  // rail's, never a row here. A folded outcome's pencil is a row too while it
  // holds the focus or its title line. A title line being typed in is
  // writing, not a row.
  treeRows() {
    const rows = [{ el: this.newOutcome, level: 1, set: this.list, key: 'new-outcome', parent: null, outcome: null, aside: true }];
    for (const li of this.list.children) {
      const outcome = this.outcomes.get(li.dataset.workspaceId);
      if (!outcome || li.hidden) continue;
      // Open as drawn: between two runs the outline knows no place, and stays as the run before drew it.
      const open = li.hasAttribute('data-open'), id = outcome.id;
      rows.push({ el: outcome.name, level: 1, set: this.list, key: 'outcome:' + id, parent: null, expanded: open, outcome });
      const pen = outcome.newTopic;
      if (open || pen === this.doc.activeElement || pen.getAttribute('aria-expanded') === 'true') rows.push({ el: pen, level: 2, set: outcome.li, key: 'pencil:' + id, parent: outcome.name, outcome, byRight: true });
      if (outcome.waiting && !outcome.waiting.hidden && outcome.waiting.getClientRects().length) rows.push({el:outcome.waiting, level:2, set:outcome.li, key:'waiting:'+id, parent:outcome.name, outcome});
      if (!open) continue;
      for (const el of outcome.topics.querySelectorAll('a[href], button, summary')) {
        if (el.closest('.one-line')) continue;
        const group = el.closest('details.topic-group'), summary = group?.querySelector(':scope > summary') ?? null;
        if (group && el !== summary && !group.open) continue;
        const deep = Boolean(group) && el !== summary;
        if(el.hidden||el.closest('[inert]')||!el.getClientRects().length)continue;
        const said = el.dataset.pageId ? 'page:'+el.dataset.pageId : el.dataset.topicId ? 'topic:' + el.dataset.topicId : el.getAttribute('href') ?? el.textContent.replace(/\(\d+\)/g, '').trim();
        const dossiers = el.closest('.ol-dossiers');
        const parent = dossiers ? [...outcome.topics.querySelectorAll('a[data-topic-id]')].find(a => a.dataset.topicId === dossiers.dataset.parentTopicId) : null;
        rows.push({ el, level: dossiers ? (deep ? 4 : 3) : deep ? 3 : 2, set: dossiers ?? (deep ? group : li), key: `${id}|${dossiers ? (el.dataset.pageId?'page:':'dossier:') + (el.dataset.pageId ?? el.dataset.dossierId ?? el.textContent) : said}`, parent: parent ?? (deep ? summary : outcome.name),
          expanded: el === summary ? group.open : undefined, outcome });
      }
    }
    return rows;
  }
  // What a key does on a row, beyond moving between rows (key-tree.mjs).
  act(action, row, rows) {
    const open = each => (each.level === 1 ? this.setOpen(each.outcome, true) : each.el.parentElement.open = true);
    const fold = each => (each.level === 1 ? this.setOpen(each.outcome, false) : each.el.parentElement.open = false);
    // → opens a folded outcome, goes from an open one to its first row (its
    // pencil), and from a row with nothing under it on into the messages.
    if (action === 'right') { if (!this.tree.stepIn(row, rows, open)) panes.step('outline', 'right', this.doc); return; }
    if (action === 'left') { this.tree.stepOut(row, rows, fold); return; }
    // The heading's pencil belongs to no outcome, so nothing opens, folds or moves one from it.
    if (!row.outcome && ['open', 'fold', 'move-up', 'move-down'].includes(action)) return;
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
    if (row.level !== 1 || !row.outcome) { panes.write?.(null); return; }
    const id = row.outcome.conversation?.topic_id;
    if (id) panes.write?.({kind:'topic', id}, row.outcome.item.title);
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
      const box = row.outcome.own;
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
  moveOutcome(id, delta) {
    const outcome = this.outcomes.get(id);
    if (outcome && this.handles) this.reorder({ level: 1, outcome, el: outcome.name }, delta);
  }
  moveTopic(id, delta) {
    const row = this.treeRows().find(row => row.el.dataset.topicId === id);
    if (!row || !this.handles) { this.tree.say('Open this topic in the outline to move it.'); return false; }
    this.reorder(row, delta); return true;
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
  focus({ reading = false } = {}) {
    if (reading) {
      const topic = this.currentTopicIn(this.here), outcome = topic && this.outcomes.get(topic.workspace_id);
      if (outcome) {
        // Coming from the feed chooses its Topic, even after folding this
        // outcome or filtering it away. Keep the other outcomes as they are.
        if (!this.isOpen(outcome.id) || outcome.li.hidden) this.setOpen(outcome, true);
        const row = [...outcome.topics.querySelectorAll('a[data-topic-id]')].find(el => el.dataset.topicId === topic.id);
        const group = row?.closest('details.topic-group');
        if (group) group.open = true;
      }
    }
    return this.tree.focus(reading ? row => row.el.getAttribute('aria-current') === 'page' : null);
  }
  // The phone's drawer opens (rail-drawer.mjs): on the outline's own place, ringed while the person's choice stands.
  drawerOpened() { return this.tree.show(); }
  // A move begins (in-place-navigation.mjs): one begun from elsewhere than the
  // outline (from: what a press was on, the focus for a key, null for back and
  // forward) leaves the row chosen there no longer the person's last choice.
  leaving(from) { if (!this.host.contains(from)) this.tree.away(); }
  // The outline's own topic lists for an outcome (TopicRail, as the side rail
  // drew them), made the first time they are wanted.
  ownRail(outcome) {
    outcome.rail ??= new TopicRail({ reader: this.bootstrap.actor, pageMax: this.pageMax,
      // An outcome's Build topics are the right rail's (item 297): its open list here leaves them out.
      pages: new TopicPages(this.bootstrap.instance_id, outcome.id, this.currentTopicIn(outcome.id), 'active', true), ...outcome.parts,
      storage: this.storage, area: outcome.own, denied: error => readFailure(error).kind === 'forbidden',
      painted: () => { outcome.fold.soon(); this.publishTopics(); },
      read: async args => {
        const run = this.run;
        let conversation;
        const view = async (name, query) => {
          if (run !== this.run) throw new Superseded();
          if (this.handles?.topicRail === outcome.rail && this.handles.topicReadAllowed?.() === false) throw Error('The runtime changed. Review saved writing before reloading.');
          const answer = await this.read(name, query, 'foreground', () => run === this.run);
          if (run !== this.run) throw new Superseded();
          return answer;
        };
        const answer = await readTopicList(view, args, value => { conversation = value; });
        if (run !== this.run) throw new Superseded();
        if (conversation !== undefined) { outcome.conversation = conversation; outcome.conversationRead = true; }
        return answer;
      }, open: (topicId, topicTitle, message, at) => this.open(topicTarget(topicId, message, at), topicTitle) });
    return outcome.rail;
  }
  // The outcome page consumes this exact rail; it never creates another
  // TopicPages or decides independently which topics qualify.
  publishTopics() {
    if (this.handles?.route?.kind !== 'workspace') return;
    const outcome = this.outcomes.get(this.here);
    const visible = outcome && !outcome.li.hidden && !outcome.topics.hidden && this.handles.readable?.() !== false;
    this.handles.outcomeTopics?.(visible ? outcome.rail?.presentation() ?? null : null);
  }
  // A topic page already requested this exact rail through OutcomeScope.
  // Other open outcomes (and outcome homes) refresh their own retained owner.
  loadTopics(outcome) {
    const rail = this.ownRail(outcome);
    return this.handles?.topicRail === rail ? Promise.resolve(true) : rail.load();
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
  // An outcome's name opens its home.
  nameTarget(outcome) {
    return { kind: 'workspace', id: outcome.id };
  }
  // The outcome's pencil: one title line under its row, whether it is open or
  // folded; Return starts the topic and opens its writing (item 1165).
  topicLine(outcome) {
    let starter = null, choice = 0;
    const line = new OneLine({ id: `ol-new-topic-${outcome.id}`, label: `Title of the new topic in ${outcome.item.title}`, placeholder: 'New topic title', className: 'rail-line',
      submit: async title => {
        const handles = this.handles, run = this.run, selected = choice;
        const navigationCurrent = handles?.navigationCurrent?.() ?? (() => false);
        const current = () => selected === choice && this.handles === handles && this.run === run && line.root.isConnected && navigationCurrent();
        starter ??= new TopicStart({ api: this.handles.api, bootstrap: this.handles.bootstrap, workspace: outcome.id });
        let id;
        try { id = await starter.start(title); }
        catch (error) { if (current()) throw error; return; }
        starter = null;
        if (!current()) {
          if (selected === choice) {
            line.input.value = ''; line.root.remove(); outcome.newTopic.setAttribute('aria-expanded', 'false');
          }
          return;
        }
        line.input.value = ''; close();
        await this.open({ kind: 'topic', id, act: 'topic-write' }, title);
      } });
    const close = lineFromButton({ button: outcome.newTopic, after: outcome.row, line });
    const toggle = outcome.newTopic.onclick;
    outcome.newTopic.onclick = () => { choice++; toggle(); };
    line.cancel = () => { choice++; close(); };
  }
  // New outcome, the heading's pencil: one title line under the heading; Return creates it and opens its page.
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
      this.phoneQuestionControl(outcome);
      const choice = outcomeColors.forDisplay(item);
      if (choice?.color) outcome.li.dataset.color = choice.color; else delete outcome.li.dataset.color;
      shown.add(item.id);
      outcome.li.hidden = !visible;
      outcome.li.toggleAttribute('data-open', open);
      outcome.li.toggleAttribute('data-fresh', count(item.unread) > 0);
      outcome.li.toggleAttribute('data-waiting', waitingIn(item) > 0);
      if (outcome.topics.hidden !== !open) outcome.topics.hidden = !open;
      outcome.disclosure.setAttribute('aria-expanded', String(open));
      outcome.disclosure.setAttribute('aria-label', `${open ? 'Fold' : 'Open'} topics in ${item.title}`);
      // One retained owner supplies these rows on both topic and outcome pages.
      outcome.own.hidden = false;
      const topicLabel = `Topics in ${item.title}`;
      if (outcome.topics.getAttribute('aria-label') !== topicLabel) outcome.topics.setAttribute('aria-label', topicLabel);
      const target = this.nameTarget(outcome);
      outcome.name.href = routeHref(target);
      if (route?.kind === 'workspace' && route.id === item.id) outcome.name.setAttribute('aria-current', 'page'); else outcome.name.removeAttribute('aria-current');
      // The words only when they change, so the pointer's hover stays on what it was on.
      const counted = rowCount(item, { open });
      const said = JSON.stringify([item.title, item.title_truncated, counted, item.light, open]);
      if (outcome.said !== said) {
        outcome.said = said;
        outcome.title.textContent = item.title + (item.title_truncated ? '…' : '');
        // On hover, the whole name, which a one-line row may cut short.
        if (outcome.name.title !== item.title) outcome.name.title = item.title;
        paintUnread(outcome.title, counted);
        if (item.provisional) outcome.standing.replaceChildren(); else paintRowLight(outcome.standing, item.light);
        // The light leads the name; its words stay on the line under it.
        const lamp = outcome.standing.querySelector('.outcome-light');
        const line = outcome.name.firstChild;
        line.querySelector(':scope > .outcome-light')?.remove(); line.querySelector(':scope > .topic-state')?.remove();
        if (lamp) line.prepend(lamp);
        // A separate control reaches the question; the name keeps navigation.
        const waits = asksIn(item) > 0;
        if (outcome.waiting) {
          outcome.waiting.hidden = !waits;
          outcome.waiting.setAttribute('aria-label', `Open a question waiting on you in ${item.title}`);
        }
        outcome.newTopic.setAttribute('aria-label', `New topic in ${item.title}`);
        (waits && outcome.waiting ? outcome.waiting : outcome.name).append(outcome.standing);
      }
    });
    for (const [id, outcome] of this.outcomes) if (!shown.has(id)) { outcome.fold.dispose(); outcome.li.remove(); this.outcomes.delete(id); }
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
    if (!this.starting) { this.dossiers.sync(); this.notebookStars.sync(); }
    if (this.pages?.started || this.failed) this.handles.outcomeList?.(this.pages.items, this.failed || null, () => this.reload());
    this.publishTopics();
    this.dimming.paintRows();
    for (const outcome of this.outcomes.values()) outcome.fold.soon();
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
    // "Pipeline & pages" (the right rail's, things-rail.mjs) carries what is new in
    // the outcome's Build topics, which only the right rail lists (item 297).
    const things = doc.getElementById('things-open');
    if (things) {
      const fresh = count(items.find(item => item.id === this.here)?.build?.unread);
      let badge = things.querySelector('.unread-count');
      if (!badge) { badge = element(doc, 'span', { className: 'unread-count' }); badge.setAttribute('aria-hidden', 'true'); things.append(badge); }
      badge.textContent = String(fresh); badge.hidden = !fresh;
      if (fresh) things.setAttribute('aria-label', `Pipeline & pages, ${fresh} new in Build topics`); else things.removeAttribute('aria-label');
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
