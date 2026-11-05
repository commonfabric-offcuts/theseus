import { PAGE } from './topic-navigation.mjs';

// The outcome's own Notebook, above a topic's messages: what every topic in
// the outcome stands on, such as its architecture, ways of working and
// guidelines. Closed it is one line; open, a title per item, each opening in
// the Reader. A reader outside the outcome cannot list its Notebook and sees
// nothing; a read that fails says so and keeps what was last shown. The
// topic's changes do not cover the outcome's Notebook, so each read tells
// the Reader the revisions it saw.
export class OutcomeReferences {
  constructor({ host, count, list, more, message, read, open, denied, seen = () => {}, pageMax = PAGE }) {
    Object.assign(this, { host, count, list, more, message, read, open, isDenied: denied, seen, pageMax });
    this.items = []; this.next = null; this.loading = null; this.queued = null;
    more.onclick = () => this.load(true);
  }
  paint() {
    const ids = new Set(this.items.map(item => item.id));
    for (const row of [...this.list.children]) if (!ids.has(row.dataset.id)) row.remove();
    this.items.forEach((item, index) => {
      let row = [...this.list.children].find(child => child.dataset.id === item.id);
      if (!row) {
        row = document.createElement('button'); row.type = 'button'; row.className = 'reference'; row.dataset.id = item.id;
        this.list.append(row);
      }
      row.textContent = item.title || 'Notebook item';
      row.onclick = () => this.open(item.source_ref, row);
      if (this.list.children[index] !== row) this.list.insertBefore(row, this.list.children[index] ?? null);
    });
    this.count.textContent = this.next === null ? String(this.items.length) : `${this.items.length}+`;
    this.more.hidden = this.next === null;
    this.host.hidden = this.items.length === 0 && this.message.hidden;
  }
  // As the rails: a More shares a running read, a reload asked for while one
  // runs follows it, and a reload reads again, from the start, every item the
  // reader had, so it never folds the list back to its first page.
  load(more = false) {
    if (this.loading) {
      if (more) return this.loading;
      this.queued ??= this.loading.then(() => { this.queued = null; return this.load(); });
      return this.queued;
    }
    if (more && this.next === null) return Promise.resolve(true);
    this.loading = (more ? this.page(this.next).then(answer => ({ items: [...this.items, ...answer.items], next: answer.next_cursor }))
      : this.reread()).then(({ items, next }) => {
      this.items = items; this.next = next;
      this.message.hidden = true; this.paint(); this.seen(items);
      return true;
    }).catch(error => {
      if (this.isDenied(error)) { this.items = []; this.next = null; this.message.hidden = true; }
      else { this.message.textContent = `${error.message} The outcome references could not be read.`; this.message.hidden = false; }
      this.paint();
      return false;
    }).finally(() => { this.loading = null; });
    return this.loading;
  }
  async page(cursor, limit) {
    const answer = await this.read({ ...(limit ? { limit } : {}), ...(cursor === null ? {} : { cursor }) });
    if (!Array.isArray(answer?.items) || answer.items.some(item => !Number.isSafeInteger(item?.seq) || item.source_ref?.kind !== 'memory') ||
        !(answer.next_cursor === null || Number.isSafeInteger(answer.next_cursor))) throw Error('The outcome references are malformed.');
    return answer;
  }
  async reread() {
    const last = this.items.at(-1)?.seq ?? null, items = [];
    let next = null;
    do {
      const answer = await this.page(next, Math.min(this.pageMax, Math.max(PAGE, this.items.length)));
      items.push(...answer.items); next = answer.next_cursor;
    } while (next !== null && last !== null && next < last);
    return { items, next };
  }
}
