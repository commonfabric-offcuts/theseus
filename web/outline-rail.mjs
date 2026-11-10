// The outline on the left of a topic or an outcome's Conversation (pipeline
// item 272; docs/rails.md): every outcome, each with its topics folded under
// it, so what is new anywhere shows at a glance. An outcome's row is its
// light, its name (its Conversation) and where it stands; folded, it carries
// the count of everything new inside it; open, its own row counts only its
// Conversation, since each topic shows its own. The topic rows are today's
// (TopicRail): unread counts, the work ring, Waiting on you and Ready for
// review, Done (N) and Archived (N), in the server's order. Each outcome ends
// with + New topic. At the top, "N new" and "N waiting on you" add it all up,
// and a press on one shows only those.
//
// The outline is the shell's (in-place-navigation.mjs): it stays the same
// element across moves, with its folds and its scroll. It reads what Core
// already serves (workspaces, workspace_topics, conversation) through the
// page that is up, and again on every commit its live feed announces. It
// never moves anything by itself: outcomes keep their order, a new message
// changes only counts and lights, and topics keep the order their list gives.
//
// Which outcome is being read, which topic is open and whose list sits under
// it come from the run of the page that is up, and from nothing before it.
// Each run's reads and drawing are its own: what a run read lands only while
// it is still the page, and a run that has gone draws nothing.
import { TopicRail, TopicPages, WorkspacePages, reread, routeHref, paintUnread, PAGE } from './topic-navigation.mjs';
import { paintRowLight } from './outcome-light.mjs';
import { OneLine, OutcomeStart, TopicStart, lineFromButton } from './quick-create.mjs';
import { readFailure } from './freshness.mjs';
import { waitsOnReader } from './outcome-conversation.mjs';
import { reloader } from './live.mjs';

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

// Which outcomes this person keeps open, on this browser. An outcome they
// never folded or opened is open while it is the one being read, and folded
// otherwise. Storage can be missing or refuse; the outline works without it,
// for this page only.
export class Folds {
  constructor(storage, key) { Object.assign(this, { storage, key }); this.held = this.read(); }
  read() {
    try { const value = JSON.parse(this.storage?.getItem(this.key) ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch { return {}; }
  }
  isOpen(id, here = null) { return typeof this.held[id] === 'boolean' ? this.held[id] : id === here; }
  set(id, open) {
    this.held = { ...this.read(), ...this.held, [id]: open };
    try { this.storage?.setItem(this.key, JSON.stringify(this.held)); } catch { /* kept for this page only */ }
  }
}

const element = (doc, tag, props = {}, ...children) => {
  const node = Object.assign(doc.createElement(tag), props);
  node.append(...children); return node;
};
const plainClick = event => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export class OutlineRail {
  // host: the outline's element (the shell's). open(target, title): through
  // the page's guard (shell.open). read(name, args, readClass): a read for the
  // outline's own lists, through whichever run is up (shell.view).
  // storage: localStorage, or null.
  constructor({ host, open, read, storage = null, doc = host.ownerDocument }) {
    Object.assign(this, { host, open, read, storage, doc });
    this.handles = null; this.filter = null; this.outcomes = new Map(); this.left = new Set(); this.unlisten = null; this.started = false;
    this.pages = null; this.folds = null; this.failed = false; this.listRead = false; this.run = 0; this.watch = null; this.watched = null;
    this.reload = reloader(() => this.load());
    this.build();
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
    this.foldAll = element(doc, 'button', { type: 'button', className: 'quiet ol-fold-all', textContent: 'Fold all' });
    this.foldAll.onclick = () => {
      const anyOpen = [...this.outcomes.keys()].some(id => this.isOpen(id));
      for (const id of this.outcomes.keys()) this.folds.set(id, !anyOpen);
      this.filter = null; this.paint(); this.reload();
    };
    this.newOutcome = element(doc, 'button', { type: 'button', className: 'quiet ol-new-outcome', textContent: 'New outcome', id: 'outline-new-outcome' });
    const heading = element(doc, 'div', { className: 'rail-heading ol-heading' }, element(doc, 'h2', { textContent: 'Outcomes', id: 'outline-heading' }),
      element(doc, 'span', { className: 'ol-heading-tools' }, this.foldAll, this.newOutcome));
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
    this.host.replaceChildren(sums, heading, this.list, this.empty, this.message, this.retry, this.more, key);
    this.host.hidden = true;
  }
  // A run of the page starts (in-place-navigation.mjs): the outline shows on
  // a topic and a Conversation, and stays put while the run reads. The place
  // before is forgotten: until the run is up, the outline knows no outcome as
  // the one being read, and nothing the run before read is drawn.
  begin(feed) {
    this.host.hidden = !feed;
    // An outcome open because it was being read stays open (this.left).
    if (this.here && this.isOpen(this.here)) this.left.add(this.here);
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
    if (!this.started) {
      this.started = true;
      this.bootstrap = bootstrap; this.pageMax = handles.pageMax ?? PAGE;
      this.pages = new WorkspacePages(bootstrap.instance_id);
      this.folds = new Folds(this.storage, `aim-next.outline.${bootstrap.instance_id}.${bootstrap.actor}`);
      this.newOutcomeLine();
    }
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
  // An outcome open because it was being read stays open when the page moves
  // on (this.left), for as long as the page is up: the outline never folds by itself.
  isOpen(id) { return this.filter ? true : this.folds?.isOpen(id, this.here) || (this.folds && typeof this.folds.held[id] !== 'boolean' && this.left.has(id)) || false; }
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
    const fold = element(doc, 'button', { type: 'button', className: 'ol-fold' }, element(doc, 'span', { className: 'tri', textContent: '▸' }));
    fold.firstChild.setAttribute('aria-hidden', 'true');
    const title = element(doc, 'span', { className: 'ol-title' }), standing = element(doc, 'small', { className: 'standing' });
    const name = element(doc, 'a', { className: 'ol-name' }, element(doc, 'span', { className: 'ol-name-line' }, title), standing);
    name.dataset.conversationOf = id;
    const row = element(doc, 'div', { className: 'ol-row' }, fold, name);
    const topics = element(doc, 'div', { className: 'ol-topics', id: `ol-topics-${id}` });
    topics.setAttribute('role', 'group');
    fold.setAttribute('aria-controls', topics.id);
    const li = element(doc, 'li', { className: 'ol-outcome' }, row, topics);
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
    outcome = { id, item, li, fold, name, title, standing, topics, own, newTopic, conversation: null, conversationRead: false, rail: null, adopted: null, notes: null,
      parts: { host, more, retry, message, done, archived } };
    fold.onclick = () => {
      const open = !this.isOpen(id), run = this.run;
      this.folds.set(id, open); this.filter = null;
      this.paint();
      if (open) Promise.all([this.loadTopics(outcome), this.readConversation(outcome)]).then(() => { if (run === this.run) this.paint(); });
    };
    name.onclick = event => {
      if (!plainClick(event)) return;
      event.preventDefault();
      this.open(this.nameTarget(outcome), outcome.item.title);
    };
    this.topicLine(outcome);
    this.outcomes.set(id, outcome);
    return outcome;
  }
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
    const items = this.shownItems(), route = this.handles.route;
    const shown = new Set();
    items.forEach((item, index) => {
      const outcome = this.outcome(item), open = this.isOpen(item.id), visible = shownUnder(this.filter, item);
      shown.add(item.id);
      if (this.list.children[index] !== outcome.li) this.list.insertBefore(outcome.li, this.list.children[index] ?? null);
      outcome.li.hidden = !visible;
      outcome.li.toggleAttribute('data-open', open);
      outcome.li.toggleAttribute('data-fresh', count(item.unread) > 0);
      outcome.li.toggleAttribute('data-waiting', asksIn(item) > 0);
      outcome.topics.hidden = !open;
      // The outcome being read waits for the page's own list, unless the outline has shown its topics before.
      outcome.own.hidden = Boolean(outcome.adopted) || (item.id === this.here && !outcome.rail);
      outcome.topics.setAttribute('aria-label', `Topics in ${item.title}`);
      outcome.fold.setAttribute('aria-expanded', String(open));
      outcome.fold.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} the topics in ${item.title}`);
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
    const sum = totals(this.pages?.items ?? []);
    this.newCount.textContent = String(sum.fresh); this.waitingCount.textContent = String(sum.waiting);
    this.onlyNew.setAttribute('aria-pressed', String(this.filter === 'new'));
    this.onlyWaiting.setAttribute('aria-pressed', String(this.filter === 'waiting'));
    this.onlyNew.disabled = !sum.fresh && this.filter !== 'new';
    this.onlyWaiting.disabled = !sum.waiting && this.filter !== 'waiting';
    this.host.dataset.only = this.filter ?? '';
    this.foldAll.textContent = [...this.outcomes.keys()].some(id => this.isOpen(id)) ? 'Fold all' : 'Open all';
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
