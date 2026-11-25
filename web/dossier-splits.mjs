// Visit/menu-scoped discovery. Nothing learned here enters the feed window.
const size = 100;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const unavailable = () => Error('This dossier changed or is unavailable. Open its menu again.');
const active = item => !item.withheld && !item.removal && typeof item.acts?.joined?.into === 'string' && integer(item.acts?.join_revision);

export class SplitSources {
  constructor({ instanceId, topicId, rootId, read, current = () => true }) {
    Object.assign(this, { instanceId, topicId, rootId, read, current });
    this.cursor = null; this.started = false; this.pending = []; this.more = true;
  }
  check(page) {
    if (!this.current() || page?.instance_id !== this.instanceId || page.topic_id !== this.topicId || !Array.isArray(page.items) ||
        page.items.length > size || !(page.next_cursor === null || integer(page.next_cursor))) throw unavailable();
  }
  async next() {
    if (!this.current()) throw unavailable();
    let pending = this.pending, cursor = this.cursor, more = this.more;
    if (!pending.length && more) {
      const page = await this.read('message_acts', { topic_id: this.topicId, limit: size, ...(this.started ? { cursor } : {}) });
      this.check(page);
      if (!integer(page.version) || page.items.some((item, index) => typeof item?.message_id !== 'string' || !integer(item.seq) ||
          !item.acts || typeof item.acts !== 'object' || index && item.seq >= page.items[index - 1].seq) ||
          this.started && page.items.some(item => item.seq >= cursor) ||
          page.next_cursor !== null && (this.started && page.next_cursor >= cursor || page.items.length && page.next_cursor > page.items.at(-1).seq)) throw unavailable();
      pending = [...new Set(page.items.filter(item => item.acts.joined?.into).map(item => item.message_id))];
      cursor = page.next_cursor; more = cursor !== null;
    }
    const choices = [];
    if (pending.length) {
      const page = await this.read('topic_messages', { topic_id: this.topicId, message_ids: pending });
      this.check(page);
      const ids = new Set();
      for (const item of page.items) {
        if (!item || !pending.includes(item.id) || ids.has(item.id) || item.topic_id !== this.topicId) throw unavailable();
        ids.add(item.id);
        if (active(item) && item.id !== this.rootId && item.stack_position?.root_id === this.rootId) choices.push(item);
      }
      const remaining = pending.filter(id => !ids.has(id));
      if (page.next_cursor !== null && remaining.length === pending.length) throw Error('The joined dossiers could not be read. Try again.');
      pending = page.next_cursor === null ? [] : remaining;
    }
    // Publish a continuation only after both reads succeeded and stayed current.
    if (!this.current()) throw unavailable();
    Object.assign(this, { pending, cursor, more, started: true });
    return { choices, more: more || pending.length > 0 };
  }
  async fresh(choice) {
    if (!this.current()) throw unavailable();
    const page = await this.read('topic_messages', { topic_id: this.topicId, message_ids: [choice.id] });
    this.check(page);
    const item = page.items[0];
    if (page.items.length !== 1 || !item || item.id !== choice.id || item.topic_id !== this.topicId || !active(item) ||
        item.stack_position?.root_id !== this.rootId || item.acts.join_revision !== choice.acts.join_revision ||
        item.acts.joined.into !== choice.acts.joined.into) throw unavailable();
    return item;
  }
}

// Existing menus own keyboard/touch activation, dismissal, scroll and focus.
// A loading menu must still be connected before an asynchronous answer draws.
export function openSplitSources({ instanceId, topicId, rootId, read, current, show, split, say,
  labelOf = item => item.acts?.name?.text ?? String(item.body ?? '').split('\n')[0] }) {
  let menu = null, serial = 0;
  const connected = () => Boolean(menu?.root?.isConnected) && current();
  const sources = new SplitSources({ instanceId, topicId, rootId, read, current: connected });
  const display = items => { menu?.close(false); menu = show(items); return menu; };
  const loading = () => display([{ key: 'split-loading', label: 'Reading joined dossiers…', glyph: 'split', disabled: true },
    { key: 'split-cancel', label: 'Cancel', glyph: 'undo', act() {} }]);
  const failure = (error, token) => {
    if (token !== serial || !connected()) return;
    display([{ label: error.message, glyph: 'split', disabled: true }, { label: 'Close', glyph: 'undo', act() {} }]);
    say(error.message);
  };
  const choose = async (choice, generation) => {
    if (generation !== serial || !current()) return;
    const token = ++serial; loading();
    try {
      const item = await sources.fresh(choice);
      if (token !== serial || !connected()) return;
      menu.close(true); split(item);
    } catch (error) { failure(error, token); }
  };
  const next = async () => {
    if (!current()) return;
    const token = ++serial; loading();
    try {
      const page = await sources.next();
      if (token !== serial || !connected()) return;
      const items = page.choices.map(item => ({ key: `split:${item.id}`, label: `Split out: ${String(labelOf(item) || 'Joined dossier').slice(0, 200)}`,
        glyph: 'split', act: () => choose(item, token) }));
      if (!items.length) items.push({ label: page.more ? 'No joined dossiers found yet' : 'No joined dossiers to split', glyph: 'split', disabled: true });
      if (page.more) items.push({ key: 'split-more', label: 'More joined dossiers…', glyph: 'chevdown', act: next });
      items.push({ key: 'split-close', label: 'Close', glyph: 'undo', act() {} });
      display(items);
    } catch (error) { failure(error, token); }
  };
  return next();
}
