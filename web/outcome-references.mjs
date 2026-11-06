import { PAGE, paintChanged } from './topic-navigation.mjs';

// The outcome's own Notebook pages, in the sidebar beside its topics: what
// every topic in the outcome stands on, such as its architecture, ways of
// working and guidelines. Each page is a row like a topic's, by title, and
// opens in the Reader. A page the reader read before and that was revised
// since carries the count of its new revisions until they open it again. A reader outside the outcome cannot list its Notebook
// and sees nothing; a read that fails says so and keeps what was last shown.
// The topic's changes do not cover the outcome's Notebook, so each read tells
// the Reader the revisions it saw.
export class OutcomeReferences {
  constructor({ scope, host, list, more, message, read, open, denied, seen = () => {}, pageMax = PAGE }) {
    Object.assign(this, { scope, host, list, more, message, read, open, isDenied: denied, seen, pageMax });
    this.items = []; this.next = null; this.loading = null; this.queued = null;
    more.onclick = () => this.load(true);
  }
  paint() {
    const ids = new Set(this.items.map(item => item.id));
    for (const row of [...this.list.children]) if (!ids.has(row.dataset.id)) row.remove();
    this.items.forEach((item, index) => {
      let row = [...this.list.children].find(child => child.dataset.id === item.id);
      if (!row) {
        row = document.createElement('button'); row.type = 'button'; row.className = 'nav-item reference'; row.dataset.id = item.id;
        this.list.append(row);
      }
      row.textContent = item.title || 'Notebook item';
      paintChanged(row, item);
      row.onclick = () => this.open(item.source_ref, row);
      if (this.list.children[index] !== row) this.list.insertBefore(row, this.list.children[index] ?? null);
    });
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
    const prior = new Set(this.items.map(item => item.id));
    this.more.setAttribute('aria-disabled', 'true');
    this.loading = (more ? this.page(this.next, PAGE, this.items).then(answer => ({ items: [...this.items, ...answer.items], next: answer.next_cursor }))
      : this.reread()).then(({ items, next }) => {
      const focused = document.activeElement;
      this.items = items; this.next = next;
      this.message.hidden = true; this.paint(); this.seen(items);
      // More, once it has nothing left to bring, hands focus to what it brought.
      if (focused === this.more && this.more.hidden) [...this.list.children].find(row => !prior.has(row.dataset.id))?.focus();
      return true;
    }).catch(error => {
      // Someone outside the outcome cannot list its Notebook: an answer, not a failure.
      const denied = this.isDenied(error);
      if (denied) { this.items = []; this.next = null; this.message.hidden = true; }
      else { this.message.textContent = `${error.message} The outcome references could not be read.`; this.message.hidden = false; }
      this.paint();
      return denied;
    }).finally(() => { this.loading = null; this.more.removeAttribute('aria-disabled'); });
    return this.loading;
  }
  // A page follows its cursor and the items before it: each item is the
  // outcome's own, names its exact current revision, and comes later than
  // the last; a continuation moves forward.
  async page(cursor, limit, before) {
    const answer = await this.read({ limit, ...(cursor === null ? {} : { cursor }) });
    const ids = new Set(before.map(item => item.id));
    let previous = cursor ?? 0;
    for (const item of Array.isArray(answer?.items) ? answer.items : [null]) {
      if (typeof item?.id !== 'string' || ids.has(item.id) || !Number.isSafeInteger(item.seq) || item.seq <= previous ||
          !Number.isSafeInteger(item.revision) || item.revision < 1 || item.owner_scope?.kind !== 'workspace' || item.owner_scope.id !== this.scope ||
          item.source_ref?.kind !== 'memory' || item.source_ref.id !== item.id || item.source_ref.revision !== item.revision ||
          item.read_revision !== undefined && !(Number.isSafeInteger(item.read_revision) && item.read_revision >= 0 && item.read_revision <= item.revision)) {
        throw Error('The outcome references are malformed.');
      }
      ids.add(item.id); previous = item.seq;
    }
    if (!(answer.next_cursor === null || Number.isSafeInteger(answer.next_cursor) && answer.next_cursor >= previous && answer.next_cursor > (cursor ?? 0))) {
      throw Error('The outcome references are malformed.');
    }
    return answer;
  }
  async reread() {
    const last = this.items.at(-1)?.seq ?? null, items = [];
    let next = null;
    do {
      const answer = await this.page(next, Math.min(this.pageMax, Math.max(PAGE, this.items.length)), items);
      items.push(...answer.items); next = answer.next_cursor;
    } while (next !== null && last !== null && next < last);
    return { items, next };
  }
}
