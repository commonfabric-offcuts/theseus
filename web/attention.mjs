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
    this.baseTitle = doc.title; this.after = Number.isSafeInteger(after) ? after : null; this.running = null; this.again = false; this.last = null;
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
    try { answer = checkedView(await this.api.view('attention', {}, { readClass: 'foreground' }), this.instanceId); }
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

// The whole messages read here, by message id, while they are listed.
const wholeMessages = new Map();

// The newest messages sent to the reader by name. One in a topic they can
// still open links there, where reading it settles it; one in a topic they
// have lost can only be read here: read(item) brings its whole text and
// attachments from its source, attachment(ref, sourceRef) offers each one,
// and it is marked read here.
export function paintSent(host, answer, { open, acknowledge, read, attachment }) {
  const items = Array.isArray(answer?.latest_addressed) ? answer.latest_addressed : [];
  const count = Number.isSafeInteger(answer?.addressed) ? answer.addressed : 0;
  const listed = new Set(items.map(item => item.message?.id));
  for (const id of wholeMessages.keys()) if (!listed.has(id)) wholeMessages.delete(id);
  if (!items.length) { host.hidden = true; host.replaceChildren(); return; }
  const list = element('ul', { className: 'sent-list' }, ...items.map(item => {
    const place = item.topic.title + (item.topic.title_truncated ? '…' : '');
    const words = element('span', { className: 'muted', textContent: ` ${item.message.author_id}: ${item.message.body}${item.message.preview ? '…' : ''}` });
    if (item.topic_readable) {
      const link = element('a', { href: '?topic=' + encodeURIComponent(item.topic.id), textContent: place });
      link.onclick = event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); open(item);
      };
      return element('li', {}, link, words);
    }
    const li = element('li', { className: 'closed-topic' });
    const draw = () => {
      const mark = element('button', { type: 'button', textContent: 'Mark read' });
      mark.onclick = () => { mark.disabled = true; return Promise.resolve(acknowledge(item)).finally(() => { mark.disabled = false; }); };
      const head = [element('span', { textContent: place }), element('span', { className: 'muted', textContent: ' (you can no longer open this topic)' })];
      const whole = wholeMessages.get(item.message.id);
      if (whole) {
        li.replaceChildren(...head, element('p', { className: 'sent-whole', textContent: `${item.message.author_id}: ${whole.body}` }),
          ...(whole.attachments ?? []).map(ref => attachment(ref, item.source_ref)), mark);
        return mark;
      }
      const more = element('button', { type: 'button', textContent: 'Read it here' });
      const said = element('span', { className: 'notice', hidden: true });
      said.setAttribute?.('role', 'status');
      let reading = false;
      more.onclick = async () => {
        if (reading) return;
        reading = true;
        let source;
        try { source = await read(item); }
        catch (error) { Object.assign(said, { textContent: ` ${error.message}`, hidden: false }); return; }
        finally { reading = false; }
        const held = globalThis.document.activeElement === more;
        wholeMessages.set(item.message.id, source);
        const next = draw();
        if (held) next.focus();
      };
      li.replaceChildren(...head, words, ' ', more, ' ', mark, said);
      return mark;
    };
    draw();
    return li;
  }));
  const heading = count > items.length ? `Sent to you by name (${count}, newest ${items.length} shown)` : `Sent to you by name (${count})`;
  host.replaceChildren(element('h2', { textContent: heading }), list);
  host.hidden = false;
}
