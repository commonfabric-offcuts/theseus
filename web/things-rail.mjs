// The right rail of a topic or an outcome's Conversation (pipeline item 131;
// docs/rails.md): the outcome's things in folding sections. Starred (the
// reader's own stars, this place's first, then Elsewhere; docs/reply-stacks.md), Pipeline (what is
// live, what is in Now and at which stage, what is Next), Waiting for… (what
// the reader asked for and where it stands), Notebook pages, Previews, Pull
// requests, Images, and Skills and tools. On a Conversation it shows the
// outcome's; on a topic it shows the topic's, and "All of this outcome" is
// one tap away. A section with nothing in it is left out, or says so in one
// quiet line; nothing is made up to fill it.
//
// Everything comes from what Core already serves: pipeline, conversation,
// workspace_topics, topic_messages, topic_images and memory_items. Previews
// and pull requests are the links people posted in messages; Core keeps no
// record of a pull request's state, or of an outcome's skills and tools, so
// the rail says what it cannot know rather than guess.
//
// Like the outline it is the shell's (in-place-navigation.mjs): one element
// across moves, which reads through the page that is up. On a phone it is a
// sheet from the bottom, at middle widths a panel from the right, and beside
// the page when there is room; it reads only while it shows. What it shows
// is drawn for one place and one scope: when either changes, what was shown
// goes at once, and a read for a place or scope left behind draws nothing.
import { paintChanged, paintMarks, questionOf } from './topic-navigation.mjs';
import { paintThumb } from './image-pick.mjs';
import { clock, shownTime, datedTime } from './times.mjs';
import { readFailure } from './freshness.mjs';
import { pipelineHref } from './pipeline.mjs';
import { reloader } from './live.mjs';
import { listen } from './in-place-navigation.mjs';
import { KeyTree } from './key-tree.mjs';
import { panes } from './panes.mjs';

export const SECTIONS = [
  ['starred', 'Starred'], ['pipeline', 'Pipeline'], ['waiting', 'Waiting for…'], ['notebook', 'Notebook'], ['previews', 'Previews'],
  ['prs', 'Pull requests'], ['images', 'Images'], ['tools', 'Skills and tools'],
];
// How far back the rail looks for links and images in a whole outcome: its
// Conversation and its most recently active topics, each their newest messages.
export const OUTCOME_TOPICS = 6, MESSAGES = 50;
// How many Notebook pages the section lists at first, and how many more each More pages brings.
export const NOTEBOOK_PAGE = 20;
// How many Build topics the Pipeline section lists at first, and how many more each More topics brings.
export const BUILD_PAGE = 20;

// The outcome's Build topics (item 297), each once, as the Pipeline section
// shows them: under Now each piece being built, with its topic's row as the
// outline would draw it; then the Build topics Ready for review, until they
// are Done and fold into the outline's Done group; then any other. pieces: the
// pipeline's pieces in Now; builds: the Build topics Core lists, in its order.
export function buildRows(pieces, builds, titles = new Map()) {
  const rows = new Map((builds ?? []).map(item => [item.id, item]));
  const now = (pieces ?? []).map(piece => ({
    title: piece.topic?.title || (piece.items ?? []).map(number => titles.get(number) ?? `Item ${number}`).join(', '),
    topic: piece.topic?.id ?? null, stage: piece.stage?.name ?? null, since: piece.stage?.entered_ms ?? null, item: rows.get(piece.topic?.id) ?? null }));
  const building = new Set(now.map(row => row.topic));
  const rest = (builds ?? []).filter(item => !building.has(item.id)).map(item => ({ title: item.title, topic: item.id, item }));
  return { now, review: rest.filter(row => row.item.state === 'review'), other: rest.filter(row => row.item.state !== 'review') };
}

// Every web address in a message's words, with the words a Markdown link gave
// it, without the punctuation that ends a sentence after it.
const LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'`]+)/g;
export function linksIn(body) {
  const found = [];
  for (const match of String(body ?? '').matchAll(LINK)) {
    let url = match[2] ?? match[3], text = match[1] ?? null;
    url = url.replace(/[.,;:!?…]+$/, '');
    while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
    try { found.push({ url: new URL(url).href, text }); } catch { /* not an address */ }
  }
  return found;
}
// A pull request's address: its repository and number.
export function pullRequest(url) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
  return match ? { repo: match[2], number: Number(match[3]), href: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}` } : null;
}
// A preview: a build served on this team's private network (a tailnet name,
// or this machine), or a page whose address says it is a preview or a mockup.
export function isPreview(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (pullRequest(url) || parsed.hostname === 'github.com') return false;
  return parsed.hostname.endsWith('.ts.net') || ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || /\/(previews?|mockups?)(\/|$)/i.test(parsed.pathname);
}
const shortAddress = url => { try { const u = new URL(url); return (u.host + u.pathname).replace(/\/$/, ''); } catch { return url; } };
// The previews and pull requests in messages, newest first, each once: the
// newest message that carries it names where it came from.
export function thingsIn(messages) {
  const previews = new Map(), prs = new Map();
  for (const message of [...messages].sort((a, b) => (b.sent_ms ?? 0) - (a.sent_ms ?? 0))) {
    for (const { url, text } of linksIn(message.body)) {
      const pr = pullRequest(url);
      if (pr) {
        const key = pr.href;
        if (!prs.has(key)) prs.set(key, { ...pr, title: text ?? `${pr.repo} #${pr.number}`, message });
        else if (text && prs.get(key).title === `${pr.repo} #${pr.number}`) prs.get(key).title = text;
      } else if (isPreview(url) && !previews.has(url)) previews.set(url, { url, title: text ?? shortAddress(url), message });
    }
  }
  return { previews: [...previews.values()], prs: [...prs.values()] };
}
// What the reader asked for and where it stands: the pipeline items they
// raised that are in Now or Next, at their stage; and what they posted in the
// Conversation that nobody has taken up yet.
export function waitingFor({ reader, now = [], next = [], conversation = [], topic = null }) {
  const rows = [];
  for (const item of [...now, ...next]) {
    if (item.raised_by !== reader || item.shipped) continue;
    if (topic && item.pieceTopic !== topic) continue;
    rows.push({ what: item.title, where: item.stage?.name ? { stage: item.stage.name, since: item.stage.entered_ms } : { words: item.section === 'now' ? 'In Now' : 'Next' }, item });
  }
  if (!topic) for (const message of conversation) {
    if (message.author_id !== reader || message.item?.state !== 'new') continue;
    const takes = Array.isArray(message.item.takes) ? message.item.takes : [];
    rows.push({ what: firstWords(message.body), where: { words: takes.length ? 'Part taken up so far' : 'Not taken up yet' }, message });
  }
  return rows;
}
const firstWords = (body, max = 90) => {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text || 'A message';
};

// Which sections this person keeps open, on this browser; each is open until
// they fold it.
export class SectionFolds {
  constructor(storage, key) { Object.assign(this, { storage, key }); }
  read() { try { const value = JSON.parse(this.storage?.getItem(this.key) ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
  isOpen(name) { return this.read()[name] !== false; }
  set(name, open) { try { this.storage?.setItem(this.key, JSON.stringify({ ...this.read(), [name]: open })); } catch { /* kept for this page only */ } }
}

const element = (doc, tag, props = {}, ...children) => {
  const node = Object.assign(doc.createElement(tag), props);
  node.append(...children.filter(child => child !== null && child !== undefined && child !== false));
  return node;
};
const plainClick = event => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
const settle = promise => promise.then(value => ({ value }), error => ({ error }));

export class ThingsRail {
  constructor({ host, backdrop, storage = null, doc = host.ownerDocument, win = doc.defaultView }) {
    Object.assign(this, { host, backdrop, storage, doc, win });
    this.handles = null; this.scope = 'outcome'; this.unlisten = null; this.stale = false; this.serial = 0; this.folds = null;
    // The Notebook section's pencils, by the scope each writes in ('topic', 'outcome'); how many of its
    // pages the person has asked to see; and the first page More brought, which takes the focus from More.
    this.creators = new Map(); this.notebookWant = NOTEBOOK_PAGE; this.notebookFrom = null;
    // How many of the outcome's Build topics the person has asked to see, and the rows shown when More topics was pressed.
    this.buildWant = BUILD_PAGE; this.buildFrom = null;
    // Each place's messages and images, with the version of the topic they were read at (readPlace).
    this.kept = new Map();
    this.reload = reloader(() => this.load());
    this.build();
    // The keys move through the sections and their rows as one tree
    // (key-tree.mjs): ↑ ↓ between them, → ← and ⌘→ ⌘← open and fold a
    // section, Return opens a row, ← from a folded section goes back to the
    // messages (panes.mjs).
    this.tree = new KeyTree({ root: this.holder, doc, label: 'The outcome\'s things', rows: () => this.treeRows(), act: (action, row, rows) => this.act(action, row, rows) });
    // The sheet closes with Escape, its ✕ and a tap beside it; the shell keeps these across moves.
    listen(doc, 'keydown', event => { if (event.key === 'Escape' && this.isOpen()) { event.preventDefault(); this.close(true); } });
    listen(backdrop, 'click', () => this.close(true));
    this.wide = win.matchMedia?.('(min-width: 1181px)') ?? null;
    if (this.wide) listen(this.wide, 'change', () => { if (this.wide.matches) this.close(false); if (this.stale && this.shows()) this.reload(); });
  }
  build() {
    const doc = this.doc;
    this.heading = element(doc, 'h2', { id: 'things-heading', textContent: 'This outcome' });
    this.closer = element(doc, 'button', { type: 'button', className: 'quiet things-close', id: 'things-close', textContent: '✕' });
    this.closer.setAttribute('aria-label', 'Close');
    this.closer.onclick = () => this.close(true);
    this.onlyTopic = element(doc, 'button', { type: 'button', className: 'chip', textContent: 'Just this topic' });
    this.wholeOutcome = element(doc, 'button', { type: 'button', className: 'chip', textContent: 'All of this outcome' });
    this.onlyTopic.onclick = () => this.choose('topic'); this.wholeOutcome.onclick = () => this.choose('outcome');
    this.chips = element(doc, 'div', { className: 'things-scope', hidden: true }, this.onlyTopic, this.wholeOutcome);
    this.chips.setAttribute('role', 'group'); this.chips.setAttribute('aria-label', 'Show things from');
    this.name = element(doc, 'a', { className: 'things-name' });
    this.sections = new Map();
    const holder = this.holder = element(doc, 'div', { className: 'things-sections' });
    for (const [key, label] of SECTIONS) {
      const sum = element(doc, 'span', { className: 'sum' }), body = element(doc, 'div', { className: 'things-body' });
      const summary = element(doc, 'summary', {}, element(doc, 'span', { textContent: label }), sum);
      const details = element(doc, 'details', { className: 'things-sec', hidden: true }, summary, body);
      details.dataset.key = key;
      // What the person folds or opens is kept; the rail sets a fold only as its section appears (paint).
      details.addEventListener('toggle', () => { if (this.folds) this.folds.set(key, details.open); });
      holder.append(details);
      this.sections.set(key, { details, sum, body, drawn: null });
    }
    this.nothing = element(doc, 'p', { className: 'things-empty', hidden: true });
    this.message = element(doc, 'p', { className: 'notice', hidden: true }); this.message.setAttribute('role', 'status');
    this.retry = element(doc, 'button', { type: 'button', textContent: 'Try again', hidden: true });
    this.retry.onclick = () => this.reload();
    this.host.replaceChildren(element(doc, 'div', { className: 'things-head' }, this.heading, this.closer), this.chips, this.name, holder, this.nothing, this.message, this.retry);
    this.host.hidden = true;
  }
  // Each section shown, and under an open one what can be pressed in it.
  treeRows() {
    const rows = [];
    for (const [key, part] of this.sections) {
      if (part.details.hidden) continue;
      const summary = part.details.querySelector(':scope > summary');
      rows.push({ el: summary, level: 1, set: this.holder, key: 'section:' + key, parent: null, expanded: part.details.open });
      if (!part.details.open) continue;
      for (const el of part.body.querySelectorAll('a[href], button')) {
        rows.push({ el, level: 2, set: part.details, key: `section:${key}|${el.getAttribute('href') ?? el.textContent.trim()}`, parent: summary });
      }
    }
    return rows;
  }
  act(action, row, rows) {
    const section = row.level === 1 ? row.el.parentElement : row.el.closest('details');
    // → and ← open and fold as in the outline: → opens a folded section or
    // goes to its first row; ← folds an open one, goes from a row to its
    // section, and from a folded section back to the messages.
    if (action === 'left') { if (!this.tree.stepOut(row, rows, each => { each.el.parentElement.open = false; })) panes.step('things', 'left', this.doc); return; }
    if (action === 'right') { this.tree.stepIn(row, rows, each => { each.el.parentElement.open = true; }); return; }
    // ⌘Return: a new message in the page's place, the panel over the page put away first.
    if (action === 'write') { this.leave(); panes.write?.(null); return; }
    if (action === 'open') { section.open = true; return; }
    if (action === 'fold') { section.open = false; this.tree.go(this.tree.list().find(each => each.el === section.querySelector(':scope > summary'))); }
  }
  // The keys come to the rail, on the row they were last on.
  focus() { return this.tree.focus(); }
  isOpen() { return this.doc.documentElement.hasAttribute('data-things-open'); }
  // Whether the rail is on screen: beside the page, or open as a sheet or panel.
  shows() { return !this.host.hidden && (this.wide?.matches || this.isOpen()); }
  open() {
    this.doc.documentElement.setAttribute('data-things-open', '');
    this.backdrop.hidden = false;
    this.cover(!this.wide?.matches);
    this.control()?.setAttribute('aria-expanded', 'true');
    this.closer.focus();
    if (this.stale || !this.drawnOnce) this.reload();
  }
  close(focus) {
    if (!this.isOpen()) return;
    this.doc.documentElement.removeAttribute('data-things-open');
    this.backdrop.hidden = true;
    this.cover(false);
    const control = this.control();
    control?.setAttribute('aria-expanded', 'false');
    if (focus) control?.focus();
  }
  // Open over the dimmed page, the rail is all that can be reached: the page
  // and the outline under it take no keys, focus or presses, as under the
  // outline's drawer (rail-drawer.mjs), so a key never acts on what it covers.
  cover(on) { for (const id of ['main', 'rail']) { const part = this.doc.getElementById(id); if (part) part.inert = on; } }
  // The keys leave the rail (panes.mjs): open over the page, it closes first.
  leave() { this.close(false); }
  control() { return this.doc.getElementById('things-open'); }
  // A run starts: on a topic or a Conversation the rail shows, and the page's
  // header gets the button that opens it where it is not beside the page.
  begin(feed, route = null) {
    this.close(false);
    this.host.hidden = !feed;
    this.unlisten?.(); this.unlisten = null; this.handles = null;
    for (const creator of this.creators.values()) creator.remove();
    this.creators.clear(); this.notebookWant = NOTEBOOK_PAGE; this.buildWant = BUILD_PAGE;
    this.serial += 1;
    this.scope = route?.kind === 'topic' ? 'topic' : 'outcome';
    this.paintHead(); this.clear();
    if (!feed) return;
    const row = this.doc.querySelector('#main .eyebrow-row');
    if (row && !this.control()) {
      const button = element(this.doc, 'button', { type: 'button', id: 'things-open', className: 'things-open', textContent: 'Pipeline & pages' });
      button.setAttribute('aria-controls', 'things'); button.setAttribute('aria-expanded', 'false');
      button.onclick = () => (this.isOpen() ? this.close(true) : this.open());
      row.append(button);
    }
  }
  ready(handles) {
    if (!['topic', 'conversation'].includes(handles.route?.kind)) return;
    this.handles = handles;
    this.folds ??= new SectionFolds(this.storage, `aim-next.things.${handles.bootstrap.instance_id}.${handles.bootstrap.actor}`);
    this.scope = handles.route.kind === 'topic' ? 'topic' : 'outcome';
    this.paintHead(); this.clear();
    this.unlisten = handles.live?.listen(event => { if (event.kind === 'commit' || event.state === 'live') this.changed(); }) ?? null;
    // A new Notebook page starts from the pencil beside this section's heading
    // (docs/notebook-pages.md): the topic's while the topic's own pages show,
    // the outcome's while the outcome's do. Both go as the next run begins.
    const details = this.sections.get('notebook').details, make = handles.notebookCreate;
    if (make && handles.route.kind === 'topic' && handles.topic) this.creators.set('topic', make(details, { kind: 'topic', id: handles.topic.id }));
    if (make && handles.workspaceId) this.creators.set('outcome', make(details, { kind: 'workspace', id: handles.workspaceId }));
    for (const creator of this.creators.values()) creator.setAvailable(false);
    this.stale = true;
    if (this.shows()) this.reload();
  }
  changed() { this.stale = true; if (this.shows() && this.doc.visibilityState === 'visible') this.reload(); }
  // The page has read its topic again, or can no longer read it. A topic it
  // can no longer read is hidden at once, as the page hides its messages:
  // what the rail shows and keeps of it goes before anything is read again.
  topicChanged() {
    if (!this.handles) return;
    const id = this.handles.topic?.id;
    if (id && this.handles.readable?.() === false) { this.kept.delete(id); this.serial += 1; this.clear(); }
    this.changed();
  }
  // A message was edited (docs/message-edit.md): its words, and the previews, pull requests and lines read from
  // them, are kept with the version of its topic, which an edit does not move. Each place holding it is read again.
  messageEdited(id) {
    let held = false;
    for (const [place, kept] of this.kept) if (kept.value.messages.some(message => message.id === id)) { this.kept.delete(place); held = true; }
    if (held) this.changed();
    return held;
  }
  shown() { if (this.handles && this.stale && this.shows()) this.reload(); }
  choose(scope) {
    if (this.scope === scope) return;
    this.serial += 1;
    this.scope = scope; this.notebookWant = NOTEBOOK_PAGE; this.paintHead(); this.clear();
    this.reload();
  }
  // Nothing of the place or scope before stays on screen: every section goes,
  // with its words, until this one's read lands.
  clear() {
    for (const part of this.sections.values()) { part.drawn = null; part.details.hidden = true; part.body.replaceChildren(); part.sum.textContent = ''; }
    for (const creator of this.creators.values()) creator.setAvailable(false);
    this.nothing.hidden = true; this.message.hidden = true; this.retry.hidden = true;
    this.drawnOnce = false; this.holder.setAttribute('aria-busy', 'true');
  }
  get topicId() { return this.handles?.route?.kind === 'topic' ? this.handles.topic?.id ?? null : null; }
  get byTopic() { return this.scope === 'topic' && this.topicId !== null; }
  paintHead() {
    const handles = this.handles, byTopic = this.byTopic;
    if (!handles) {
      // A run on its way: the kind of place is known, its name not yet.
      this.chips.hidden = true;
      this.heading.textContent = this.scope === 'topic' ? 'In this topic' : 'This outcome';
      this.name.textContent = ''; this.name.removeAttribute('href'); this.name.title = '';
      return;
    }
    this.chips.hidden = this.topicId === null;
    this.onlyTopic.setAttribute('aria-pressed', String(byTopic));
    this.wholeOutcome.setAttribute('aria-pressed', String(!byTopic));
    this.heading.textContent = byTopic ? 'In this topic' : 'This outcome';
    const outcome = handles?.workspaceTitle ?? '';
    this.name.textContent = byTopic ? handles.topic.title : `${outcome} ›`;
    if (byTopic) this.name.removeAttribute('href'); else this.name.href = handles ? `?workspace=${encodeURIComponent(handles.workspaceId)}` : '';
    this.name.title = byTopic ? '' : 'The outcome’s own page';
  }
  // Everything the sections show, read again, through the run that is up
  // (its reads still waiting when it goes are never sent). A read overtaken
  // by a newer one, or by a move, says nothing; one that fails keeps what was
  // shown and offers Try again.
  async load() {
    const handles = this.handles;
    if (!handles) return true;
    const serial = ++this.serial, byTopic = this.byTopic, workspace = handles.workspaceId, topicId = this.topicId;
    const view = (name, args) => handles.view(name, args);
    this.stale = false;
    // A topic the page can no longer read (its updates refused) is not read here either.
    const readable = id => id !== handles.topic?.id || handles.readable?.() !== false;
    const pipeline = settle(this.readPipeline(view, workspace));
    const stars = settle(view('stars', { limit: 50 }));
    const notebook = byTopic && !readable(topicId) ? settle(Promise.resolve(null)) : settle(this.readNotebook(view, byTopic ? { kind: 'topic', id: topicId } : { kind: 'workspace', id: workspace }));
    const places = (byTopic ? [this.topicPlace(handles)] : await this.outcomePlaces(view, workspace)).filter(place => readable(place.id));
    if (serial !== this.serial || handles !== this.handles) return true;
    const reads = places.map(place => settle(this.readPlace(view, place, byTopic ? 24 : 12)));
    const [pipe, notes, starred, ...found] = await Promise.all([pipeline, notebook, stars, ...reads]);
    if (serial !== this.serial || handles !== this.handles) return true;
    const failed = [pipe, notes, starred, ...found].filter(read => read.error && !denied(read.error));
    const messages = found.flatMap(read => read.value ? read.value.messages.map(message => ({ ...message, place: read.value.place })) : []);
    const images = new Map();
    for (const read of found) for (const image of read.value?.images ?? []) if (!images.has(image.attachment.id)) images.set(image.attachment.id, { ...image, place: read.value.place });
    const conversation = found.find(read => read.value?.place.conversation)?.value.messages ?? [];
    this.paint({ byTopic, topicId, pipeline: pipe.value ?? (pipe.error ? undefined : null), notebook: notes.value === null ? null : notes.value?.items ?? (notes.error ? undefined : []),
      notebookMayWrite: notes.value?.reader_may_write === true, notebookNext: notes.value?.next ?? null,
      messages, images: [...images.values()].sort((a, b) => (b.sent_ms ?? 0) - (a.sent_ms ?? 0)), conversation, stars: starred.value?.items ?? (starred.error ? undefined : []) });
    this.drawnOnce = true; this.holder.removeAttribute('aria-busy');
    this.message.hidden = this.retry.hidden = !failed.length;
    if (failed.length) this.message.textContent = 'Some of this could not be read just now; what shows is what was read last.';
    return !failed.length;
  }
  // The places a whole outcome's links and images come from: its Conversation
  // and its most recently active topics.
  async outcomePlaces(view, workspace) {
    const places = [];
    const [conversation, topics] = await Promise.all([settle(view('conversation', { workspace_id: workspace })), settle(view('workspace_topics', { workspace_id: workspace, limit: OUTCOME_TOPICS }))]);
    const found = conversation.value?.conversation;
    if (found?.topic_id) places.push({ id: found.topic_id, title: 'Conversation', conversation: true, version: found.version });
    for (const topic of topics.value?.items ?? []) places.push({ id: topic.id, title: topic.title, version: topic.version });
    return places;
  }
  // The open topic alone, at the version the page last read it at (it says when that moves: topicChanged).
  topicPlace(handles) {
    const topic = handles.currentTopic?.() ?? handles.topic;
    return { id: topic.id, title: topic.title, version: topic.version };
  }
  // One place's newest messages and its images, read again only when its
  // topic has moved on since (a message, a state), so a commit elsewhere
  // reads nothing here.
  async readPlace(view, place, limit) {
    const kept = this.kept.get(place.id);
    if (kept && place.version !== undefined && kept.version === place.version && kept.limit === limit) return { ...kept.value, place };
    const [messages, images] = await Promise.all([
      view('topic_messages', { topic_id: place.id, direction: 'before', limit: MESSAGES }),
      view('topic_images', { topic_id: place.id, limit }),
    ]);
    const value = { place, messages: messages.items ?? [], images: (images.items ?? []).filter(image => image.topic_id === place.id) };
    this.kept.set(place.id, { version: place.version, limit, value });
    return value;
  }
  // The Notebook's pages from its first, as many as the person has asked for
  // (NOTEBOOK_PAGE, and as many again for each More pages), in Core's pages;
  // next says whether there are more, and whether the reader may write in it
  // comes with the first page.
  async readNotebook(view, owner_scope) {
    const items = [], want = this.notebookWant, most = this.handles?.pageMax ?? NOTEBOOK_PAGE;
    let cursor = null, mayWrite;
    do {
      const answer = await view('memory_items', { owner_scope, limit: Math.max(1, Math.min(most, want - items.length)), ...(cursor === null ? {} : { cursor }) });
      items.push(...(answer.items ?? [])); cursor = answer.next_cursor ?? null; mayWrite ??= answer.reader_may_write;
    } while (cursor !== null && items.length < want);
    return { items, next: cursor, reader_may_write: mayWrite };
  }
  async readPipeline(view, workspace) {
    const now = await view('pipeline', { workspace_id: workspace, section: 'now', limit: 100 });
    if (now.pipeline === null) return null;
    const next = await view('pipeline', { workspace_id: workspace, section: 'next', limit: 20 });
    // A pipeline that is on has Build topics (item 297); Core lists none for one that is off.
    const builds = now.pipeline?.enabled ? await this.readBuilds(view, workspace) : { items: [], next: null, fresh: 0 };
    return { now, next, builds };
  }
  // The outcome's Build topics not Done, from the first, as many as the
  // person has asked for (BUILD_PAGE, and as many again for each More topics),
  // in Core's pages and order; next says whether there are more, and fresh
  // how many messages in all of them are new to the reader (Core's builds).
  async readBuilds(view, workspace) {
    const items = [], want = this.buildWant, most = this.handles?.pageMax ?? BUILD_PAGE;
    let cursor = '', fresh = 0;
    do {
      const answer = await view('workspace_topics', { workspace_id: workspace, build: true, limit: Math.max(1, Math.min(most, want - items.length)), cursor });
      items.push(...(answer.items ?? [])); cursor = answer.next_cursor ?? null;
      fresh = Number.isSafeInteger(answer.builds?.unread) && answer.builds.unread > 0 ? answer.builds.unread : 0;
    } while (cursor !== null && items.length < want);
    return { items, next: cursor, fresh };
  }
  // Each section's words, drawn only when they change, so the pointer's hover
  // and focus stay where they were. A section takes its kept fold as it
  // appears, and is left as the person has it after that.
  paint(found) {
    const reader = this.handles.bootstrap.actor, nowMs = clock.now();
    const items = found.pipeline ? this.pipelineRows(found.pipeline) : null;
    const { previews, prs } = thingsIn(found.messages);
    // The pencil of the Notebook listed shows only to someone Core lets write it (reader_may_write).
    if (found.notebook !== undefined) for (const [scope, creator] of this.creators) creator.setAvailable((scope === 'topic') === found.byTopic && found.notebook !== null && found.notebookMayWrite);
    const shown = {
      starred: found.stars === undefined ? undefined : this.starredSection(found.stars, found, reader),
      pipeline: found.pipeline === undefined ? undefined : this.pipelineSection(items, found, nowMs),
      waiting: items || found.conversation.length ? this.waitingSection(waitingFor({ reader, now: items?.now ?? [], next: items?.next ?? [], conversation: found.byTopic ? [] : found.conversation, topic: found.byTopic ? found.topicId : null }), nowMs) : null,
      notebook: found.notebook === undefined ? undefined : this.notebookSection(found.notebook, found),
      previews: this.linkSection(previews, nowMs, reader, preview => preview.url),
      prs: this.linkSection(prs, nowMs, reader, pr => pr.href, 'Whether each is open or merged is not recorded here.'),
      images: this.imageSection(found.images, reader),
      tools: { sum: '', key: 'tools', node: () => element(this.doc, 'p', { className: 'things-quiet', textContent: 'Skills and tools are not recorded yet.' }) },
    };
    let any = false;
    for (const [key] of SECTIONS) {
      const part = this.sections.get(key), section = shown[key];
      if (section === undefined) continue; // not read this time: what showed stays
      const appears = part.details.hidden && Boolean(section);
      part.details.hidden = !section;
      if (!section) { part.drawn = null; part.body.replaceChildren(); continue; }
      // Skills and tools, and an empty Notebook kept for its pencil, are not something the place refers to.
      if (key !== 'tools' && section.key !== 'note-none') any = true;
      part.sum.textContent = section.sum;
      if (part.drawn !== section.key) {
        part.drawn = section.key;
        part.body.replaceChildren(section.node());
      }
      if (appears) part.details.open = this.folds.isOpen(key);
    }
    // More pages and More topics, pressed with the focus on them, hand the focus to the first row they brought once they have gone.
    const brought = this.notebookFrom === null ? null : this.sections.get('notebook').body.querySelectorAll('.things-list a.row')[this.notebookFrom];
    if (brought) {
      this.notebookFrom = null;
      if (!this.doc.activeElement || this.doc.activeElement === this.doc.body) brought.focus();
    }
    const builtFrom = this.buildFrom === null ? null : [...this.sections.get('pipeline').body.querySelectorAll('.pipe-builds a.row')].find(row => !this.buildFrom.has(row.getAttribute('href')));
    if (builtFrom) {
      this.buildFrom = null;
      if (!this.doc.activeElement || this.doc.activeElement === this.doc.body) builtFrom.focus();
    }
    this.nothing.hidden = any;
    this.nothing.textContent = found.byTopic ? 'This topic refers to nothing yet. “All of this outcome” shows the rest.' : 'Nothing here yet.';
  }
  pipelineRows({ now, next, builds }) {
    const titles = new Map((now.items ?? []).map(item => [item.number, item.title]));
    const pieceTopic = new Map();
    for (const piece of now.pieces ?? []) for (const number of piece.items ?? []) pieceTopic.set(number, piece.topic?.id ?? null);
    const withTopic = item => ({ ...item, pieceTopic: pieceTopic.get(item.number) ?? null });
    return { live: now.facts?.live ?? null, rows: buildRows(now.pieces, builds?.items, titles), more: (builds?.next ?? null) !== null, builds: builds?.items ?? [], fresh: builds?.fresh ?? 0,
      now: (now.items ?? []).map(withTopic), next: (next.items ?? []).map(withTopic), title: now.pipeline?.title ?? 'Pipeline' };
  }
  // The pipeline, and in it the outcome's Build topics (item 297): the outline
  // lists none of them, so they show here whichever the chips say, each row
  // carrying what the outline's row would. Live and Next are the outcome's.
  pipelineSection(items, found, nowMs) {
    const doc = this.doc, workspace = this.handles.workspaceId, reader = this.handles.bootstrap.actor, here = found.byTopic ? found.topicId : this.topicId;
    if (!items) return found.byTopic ? null : { sum: '', key: 'off', node: () => element(doc, 'p', { className: 'things-quiet', textContent: 'This outcome has no pipeline.' }) };
    const next = found.byTopic ? [] : items.next, { now, review, other } = items.rows;
    if (found.byTopic && !now.length && !review.length && !other.length) return null;
    const marks = row => row.item ? [row.item.title, row.item.unread, row.item.addressed, row.item.state, row.item.waiting_on, row.item.asks, row.item.state_note, row.item.work] : null;
    const said = rows => rows.map(row => [row.title, row.topic, row.stage ?? null, row.since ?? null, marks(row), row.topic === here]);
    const key = JSON.stringify(['pipe', items.live, said(now), said(review), said(other), items.more, next.map(item => [item.number, item.title])]);
    // Folded, the section still says what is new in its Build topics, which no other list shows.
    const sum = [found.byTopic ? (now.find(row => row.topic === here)?.stage ?? '') : `${now.length} in Now`, items.fresh ? `${items.fresh} new` : ''].filter(Boolean).join(' · ');
    // A Build topic's row: its title and what the outline's row would carry after it, then the line under it.
    const topicRow = (row, sub = null) => {
      if (!row.topic) return element(doc, 'span', { className: 'row' }, row.title, sub);
      const link = this.placeLink({ kind: 'topic', id: row.topic, ...(row.item && questionOf(row.item, reader) ? { message: questionOf(row.item, reader) } : {}) }, row.title);
      if (row.item) paintMarks(link, row.item, reader);
      if (sub) link.append(sub);
      if (row.topic === here) link.setAttribute('aria-current', 'page');
      return link;
    };
    const group = (label, rows, sub = () => null) => [element(doc, 'div', { className: 'pipe-label', textContent: label }),
      element(doc, 'ul', { className: 'things-list' }, ...rows.map(row => element(doc, 'li', {}, topicRow(row, sub(row)))))];
    return { sum, key, node: () => {
      const box = element(doc, 'div');
      if (!found.byTopic) {
        box.append(element(doc, 'div', { className: 'pipe-label', textContent: 'Live' }),
          element(doc, 'p', { className: 'things-line', textContent: items.live ? `Release ${items.live.release} · ${shownTime(items.live.deployed_ms, nowMs)}` : 'Nothing released yet' }));
      }
      const builds = element(doc, 'div', { className: 'pipe-builds' });
      if (now.length) builds.append(...group('Now', now, row => element(doc, 'span', { className: 'sub' }, row.stage ? element(doc, 'b', { textContent: row.stage }) : 'Waiting for a stage', row.since ? ` · since ${shownTime(row.since, nowMs)}` : '')));
      if (review.length) builds.append(...group('Ready for review', review));
      if (other.length) builds.append(...group('Other Build topics', other));
      if (items.more) {
        // The rest of the Build topics, a page at a time, read again with the rail from then on.
        const more = element(doc, 'button', { type: 'button', className: 'things-more', textContent: 'More topics' });
        more.onclick = () => { this.buildWant = items.builds.length + BUILD_PAGE; this.buildFrom = this.doc.activeElement === more ? new Set([...builds.querySelectorAll('a.row')].map(row => row.getAttribute('href'))) : null; this.reload(); };
        builds.append(more);
      }
      if (builds.childElementCount) box.append(builds);
      if (next.length) {
        const shownNext = next.slice(0, 5);
        box.append(element(doc, 'div', { className: 'pipe-label', textContent: 'Next' }), element(doc, 'ul', { className: 'things-list' },
          ...shownNext.map(item => element(doc, 'li', {}, element(doc, 'a', { className: 'row', href: pipelineHref(workspace, item.number), textContent: item.title }))),
          next.length > shownNext.length ? element(doc, 'li', { className: 'things-quiet', textContent: `and ${next.length - shownNext.length} more` }) : null));
      }
      if (!found.byTopic && !now.length && !review.length && !other.length && !next.length) box.append(element(doc, 'p', { className: 'things-quiet', textContent: 'Nothing in Now or Next.' }));
      box.append(element(doc, 'a', { className: 'pipe-open', href: pipelineHref(workspace), textContent: 'The whole pipeline →' }));
      return box;
    } };
  }
  waitingSection(rows, nowMs) {
    if (!rows.length) return null;
    const doc = this.doc, workspace = this.handles.workspaceId;
    const where = row => row.where.stage ? `${row.where.stage} · since ${shownTime(row.where.since, nowMs)}` : row.where.words;
    return { sum: String(rows.length), key: JSON.stringify(['wait', rows.map(row => [row.what, where(row)])]), node: () => element(doc, 'ul', { className: 'things-list' }, ...rows.map(row => {
      const sub = element(doc, 'span', { className: 'wait-state', textContent: where(row) });
      if (row.item) return element(doc, 'li', {}, element(doc, 'a', { className: 'row', href: pipelineHref(workspace, row.item.number) }, row.what, sub));
      return element(doc, 'li', {}, this.placeLink({ kind: 'topic', id: row.message.topic_id, message: row.message.id }, row.what, sub));
    })) };
  }
  // The reader's stars: this topic's (on a Conversation, this outcome's) first,
  // then the rest under Elsewhere. A press lands on the message, its stack
  // opened, where the page shows it; elsewhere it opens its topic on it.
  // Unstar beside each takes the star off, wherever its message is.
  starredSection(stars, found, reader) {
    if (!stars.length) return null;
    const doc = this.doc, here = star => (found.byTopic ? star.topic_id === found.topicId : star.workspace_id === this.handles.workspaceId);
    const mine = stars.filter(here), elsewhere = stars.filter(star => !here(star));
    const row = star => {
      const sub = element(doc, 'span', { className: 'sub', textContent: `${star.author_id === reader ? 'you' : star.author_id}${here(star) && found.byTopic ? '' : ` in ${star.conversation ? 'Conversation' : star.topic_title}`}` });
      const off = element(doc, 'button', { type: 'button', className: 'things-unstar', textContent: 'Unstar', title: 'Take the star off' });
      off.setAttribute('aria-label', `Unstar "${firstWords(star.excerpt, 40)}"`);
      off.onclick = () => this.handles.unstar?.(star);
      return element(doc, 'li', { className: 'things-starred' }, this.placeLink({ kind: 'topic', id: star.topic_id, message: star.message_id, land: true }, firstWords(star.excerpt, 70), sub), off);
    };
    return { sum: String(stars.length), key: JSON.stringify(['star', stars.map(star => [star.message_id, star.star_revision, here(star)])]), node: () => element(doc, 'div', {},
      ...(mine.length ? [element(doc, 'ul', { className: 'things-list' }, ...mine.map(row))] : []),
      ...(elsewhere.length ? [element(doc, 'div', { className: 'pipe-label', textContent: 'Elsewhere' }), element(doc, 'ul', { className: 'things-list' }, ...elsewhere.map(row))] : []),
      element(doc, 'p', { className: 'things-quiet', textContent: 'Only you see your stars.' })) };
  }
  notebookSection(items, found) {
    if (!items?.length) {
      // An empty Notebook keeps its heading, and with it the pencil that starts its first page.
      return items && this.creators.get(found.byTopic ? 'topic' : 'outcome')?.available ? { sum: '', key: 'note-none', node: () => element(this.doc, 'p', { className: 'things-quiet', textContent: 'No pages yet.' }) } : null;
    }
    const doc = this.doc, scope = found.byTopic ? { kind: 'topic', id: found.topicId } : { kind: 'workspace', id: this.handles.workspaceId }, more = found.notebookNext !== null;
    return { sum: `${items.length}${more ? '+' : ''}`, key: JSON.stringify(['note', scope, more, items.map(item => [item.id, item.title, item.revision, item.read_revision, item.draft === true])]), node: () => {
      const list = element(doc, 'ul', { className: 'things-list' }, ...items.map(item => {
        const link = this.placeLink({ ...scope, page: item.id }, item.title || 'Notebook page');
        paintChanged(link, item);
        return element(doc, 'li', {}, link);
      }));
      if (!more) return list;
      // The rest of the Notebook, a page of it at a time, read again with the rail from then on.
      const button = element(doc, 'button', { type: 'button', className: 'things-more', textContent: 'More pages' });
      button.onclick = () => { this.notebookWant = items.length + NOTEBOOK_PAGE; this.notebookFrom = this.doc.activeElement === button ? items.length : null; this.reload(); };
      return element(doc, 'div', {}, list, button);
    } };
  }
  linkSection(rows, nowMs, reader, href, note = null) {
    if (!rows.length) return null;
    const doc = this.doc;
    const from = row => `${row.message.author_id === reader ? 'you' : row.message.author_id}${row.message.place && !this.byTopic ? ` in ${row.message.place.title}` : ''} · ${shownTime(row.message.sent_ms, nowMs)}`;
    return { sum: String(rows.length), key: JSON.stringify(['link', rows.map(row => [href(row), row.title, from(row)]), note]), node: () => {
      const list = element(doc, 'ul', { className: 'things-list' }, ...rows.slice(0, 12).map(row => {
        const link = element(doc, 'a', { className: 'row', href: href(row), target: '_blank', rel: 'noopener' }, row.title, element(doc, 'span', { className: 'sub', textContent: from(row) }));
        link.title = href(row);
        return element(doc, 'li', {}, link);
      }));
      return note ? element(doc, 'div', {}, list, element(doc, 'p', { className: 'things-quiet', textContent: note })) : list;
    } };
  }
  imageSection(images, reader) {
    if (!images.length) return null;
    const doc = this.doc, { api, bootstrap, inTurn } = this.handles;
    return { sum: String(images.length), key: JSON.stringify(['img', images.map(image => image.attachment.id)]), node: () => element(doc, 'div', { className: 'things-thumbs' }, ...images.map(image => {
      const label = `${image.attachment.name ?? 'Image'}, from ${image.author_id === reader ? 'you' : image.author_id}, ${datedTime(image.sent_ms)}`;
      const link = this.placeLink({ kind: 'topic', id: image.topic_id, message: image.source_ref.id }, '');
      link.className = 'thumb'; link.title = label; link.setAttribute('aria-label', label);
      paintThumb(link, `${image.source_ref.id}:${image.attachment.id}`, () => inTurn(async () => (await api.media(bootstrap.instance_id, image.attachment, image.source_ref)).blob));
      return link;
    })) };
  }
  // A place inside the outcome: a link that opens it through the page, so
  // writing not yet saved still asks first, and a message in the open topic
  // opens in the Reader.
  placeLink(target, title, ...rest) {
    const link = element(this.doc, 'a', { className: 'row', href: '?' + new URLSearchParams(target.kind === 'topic'
      ? { topic: target.id, ...(target.message ? { message: target.message } : {}), ...(target.page ? { page: target.page } : {}) }
      : { workspace: target.id, ...(target.page ? { page: target.page } : {}) }) }, title, ...rest);
    link.onclick = event => {
      if (!plainClick(event) || !this.handles) return;
      event.preventDefault();
      if (!this.wide?.matches) this.close(false);
      this.handles.open(target, title || 'that page', link);
    };
    return link;
  }
}
const denied = error => readFailure(error).kind === 'forbidden';
