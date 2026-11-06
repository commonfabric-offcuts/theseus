import { checkedView } from './freshness.mjs';

// What waits for the person. The tab title carries the unread count, and a
// message sent to them by name raises a system notification while the page is
// not in front. Neither marks anything read: only reading through a message on
// screen does that.
export class Attention {
  // after: the newest delivery naming the reader that was waiting when the page
  // opened, as the server's bootstrap said. Without it, the first answer stands in.
  constructor({ api, instanceId, after = null, doc = globalThis.document, notifications = globalThis.Notification, open, focus = () => globalThis.focus?.() }) {
    Object.assign(this, { api, instanceId, doc, notifications, open, focus });
    // after: the newest delivery number already known; only a later one is news.
    this.baseTitle = doc.title; this.after = Number.isSafeInteger(after) ? after : null; this.running = null; this.again = false; this.last = null; this.here = null;
    this.unread = 0; this.addressed = 0; this.listeners = new Set();
  }
  listen(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  // Overlapping requests share one read and ask for one more after it.
  refresh() {
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      do { this.again = false; await this.load(); } while (this.again);
    })().finally(() => { this.running = null; });
    return this.running;
  }
  async load() {
    let answer;
    // The foreground lane queues; the background lane sheds, for reads that
    // keep a retry timer of their own, and this read keeps none.
    // here: the outcome the page is inside, so the answer says whether it is
    // one of the outcomes waiting on the reader.
    const args = typeof this.here === 'string' ? { workspace_id: this.here } : {};
    try { answer = checkedView(await this.api.view('attention', args, { readClass: 'foreground' }), this.instanceId); }
    catch { return; } // A failed read keeps what is shown; the next commit asks again.
    if (!Number.isSafeInteger(answer.unread) || !Number.isSafeInteger(answer.addressed) || !Array.isArray(answer.latest_addressed)) return;
    this.unread = answer.unread; this.addressed = answer.addressed;
    this.doc.title = answer.unread > 0 ? `(${answer.unread}) ${this.baseTitle}` : this.baseTitle;
    // Delivery numbers only grow, so a message that was already waiting, even
    // one first listed after newer ones are read, is never news. Without a
    // starting number, the first answer only records where the page started.
    const numbers = answer.latest_addressed.map(item => item.seq).filter(Number.isSafeInteger);
    const fresh = this.after === null ? [] : answer.latest_addressed.filter(item => Number.isSafeInteger(item.seq) && item.seq > this.after);
    this.after = Math.max(this.after ?? 0, ...numbers);
    this.last = answer;
    for (const listener of [...this.listeners]) listener(answer);
    if (this.notifications?.permission !== 'granted' || (!this.doc.hidden && this.doc.hasFocus?.())) return;
    for (const item of fresh.reverse()) this.notify(item);
  }
  notify(item) {
    const title = `${item.message.author_id} in ${item.topic.title}${item.topic.title_truncated ? '…' : ''}`;
    const shown = new this.notifications(title, { body: item.message.body.slice(0, 200), tag: item.id });
    shown.onclick = () => { this.focus(); shown.close?.(); this.open?.(item); };
  }
  // Asking is the person's choice, so it starts only from their click.
  get canAsk() { return Boolean(this.notifications) && this.notifications.permission === 'default'; }
  ask() { return this.notifications.requestPermission(); }
}

const element = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children); return node;
};

// What the reader has done with each message in a host's list, by message id,
// while it is listed: a read in flight, the whole message it brought and the
// attachment controls it offers, or what went wrong. Every paint, and every
// read as it ends, draws the list again from here.
const sentLists = new WeakMap();
// The message id and part each drawn control stands for, so that a control
// holding focus hands it to the one drawn in its place.
const sentParts = new WeakMap();

// The newest messages sent to the reader by name. One in a topic they can
// still open links there, where reading it settles it; one in a topic they
// have lost can only be read here: read(item) brings its whole text and
// attachments from its source, attachment(ref, sourceRef, notice) offers each
// one, and it is marked read here.
export function paintSent(host, answer, actions) {
  // A press reaches the actions of the latest paint, as a list left alone
  // keeps the buttons an earlier one drew.
  const act = name => (...args) => sentLists.get(host).actions[name](...args);
  const [open, acknowledge, read, attachment] = ['open', 'acknowledge', 'read', 'attachment'].map(act);
  const items = Array.isArray(answer?.latest_addressed) ? answer.latest_addressed : [];
  const count = Number.isSafeInteger(answer?.addressed) ? answer.addressed : 0;
  const shown = sentLists.get(host) ?? { reads: new Map() };
  sentLists.set(host, Object.assign(shown, { answer, actions }));
  const repaint = () => paintSent(host, shown.answer, shown.actions);
  const listed = new Set(items.map(item => item.message?.id));
  for (const id of shown.reads.keys()) if (!listed.has(id)) shown.reads.delete(id);
  const held = globalThis.document.activeElement;
  const drawn = new Map();
  const part = (node, id, name) => { sentParts.set(node, { id, name }); drawn.set(`${id} ${name}`, node); return node; };
  const readWhole = item => {
    const id = item.message.id;
    const entry = shown.reads.get(id) ?? {};
    if (entry.pending) return entry.pending;
    shown.reads.set(id, entry);
    entry.notice = null;
    entry.pending = (async () => {
      try {
        const source = await read(item);
        if (source?.source_ref?.kind !== 'message' || source.source_ref.id !== item.source_ref.id) throw Error('The message could not be confirmed.');
        // A message no longer listed is forgotten: its answer is not kept.
        if (shown.reads.get(id) !== entry) return;
        // Each attachment's latest refusal, until it opens.
        entry.refusals = [];
        entry.controls = (source.attachments ?? []).map((ref, index) => attachment(ref, item.source_ref, message => {
          entry.refusals[index] = message && `${ref.name ?? 'Attachment'}: ${message}`;
          repaint();
        }));
        entry.source = source;
      } catch (error) { entry.notice = error.message; }
      finally { entry.pending = null; }
      repaint();
    })();
    repaint();
    return entry.pending;
  };
  // A list drawn again with what it already shows is left alone, so a press
  // under way finishes on the button it began on.
  const shows = JSON.stringify([count, items, items.map(item => {
    const entry = shown.reads.get(item.message?.id);
    return entry && [Boolean(entry.pending), entry.notice ?? null, entry.refusals ?? [], Boolean(entry.source), entry.controls?.length ?? 0];
  })]);
  if (shown.shows === shows) return;
  shown.shows = shows;
  // The order last drawn, so that focus on a row that leaves can move to its neighbour.
  const before = shown.order ?? [];
  shown.order = items.map(item => item.message?.id);
  if (!items.length) {
    // Focus on the last row to leave goes to the page's main region, not the body.
    const lost = Boolean(held && host.contains(held));
    host.hidden = true; host.replaceChildren();
    if (lost) host.closest('main')?.focus();
    return;
  }
  const list = element('ul', { className: 'sent-list' }, ...items.map(item => {
    const id = item.message.id;
    const place = item.topic.title + (item.topic.title_truncated ? '…' : '');
    const words = element('span', { className: 'muted', textContent: ` ${item.message.author_id}: ${item.message.body}${item.message.preview ? '…' : ''}` });
    if (item.topic_readable) {
      const link = part(element('a', { href: '?topic=' + encodeURIComponent(item.topic.id), textContent: place }), id, 'open');
      link.onclick = event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); open(item);
      };
      return element('li', {}, link, words);
    }
    const entry = shown.reads.get(id);
    const mark = part(element('button', { type: 'button', textContent: 'Mark read' }), id, 'mark');
    // Busy, not disabled: a browser drops focus from a button it disables, and
    // the row leaving must still find it there to hand it on.
    mark.onclick = () => {
      if (mark.getAttribute('aria-disabled') === 'true') return undefined;
      mark.setAttribute('aria-disabled', 'true');
      return Promise.resolve(acknowledge(item)).finally(() => { mark.removeAttribute('aria-disabled'); });
    };
    const head = [element('span', { textContent: place }), element('span', { className: 'muted', textContent: ' (you can no longer open this topic)' })];
    const notice = [entry?.notice, ...(entry?.refusals ?? [])].filter(Boolean).join(' ');
    const said = element('span', { className: 'notice', hidden: !notice, textContent: notice ? ` ${notice}` : '' });
    said.setAttribute?.('role', 'status');
    if (entry?.source) {
      return element('li', { className: 'closed-topic' }, ...head,
        element('p', { className: 'sent-whole', textContent: `${item.message.author_id}: ${entry.source.body}` }), ...entry.controls, mark, said);
    }
    const more = part(element('button', { type: 'button', textContent: entry?.pending ? 'Reading…' : 'Read it here' }), id, 'more');
    more.onclick = () => readWhole(item);
    return element('li', { className: 'closed-topic' }, ...head, words, ' ', more, ' ', mark, said);
  }));
  const heading = count > items.length ? `Sent to you by name (${count}, newest ${items.length} shown)` : `Sent to you by name (${count})`;
  host.replaceChildren(element('h2', { textContent: heading }), list);
  host.hidden = false;
  // A control that held focus keeps it when it is drawn again, as an opened
  // attachment is; one drawn anew takes it; once a read replaces Read it
  // here, that row's Mark read does; and when its row leaves the list, as one
  // marked read does, the row now in its place takes it, or else the one
  // before, or else the first row.
  if (!held || held === globalThis.document.activeElement) return;
  if (held.isConnected) { held.focus(); return; }
  const was = sentParts.get(held);
  if (!was) return;
  const row = id => drawn.get(`${id} open`) ?? drawn.get(`${id} more`) ?? drawn.get(`${id} mark`);
  const at = before.indexOf(was.id);
  const neighbour = [...before.slice(at + 1), ...before.slice(0, Math.max(at, 0)).reverse()].find(id => listed.has(id));
  (drawn.get(`${was.id} ${was.name}`) ?? row(was.id) ?? row(neighbour ?? items[0].message.id))?.focus();
}
