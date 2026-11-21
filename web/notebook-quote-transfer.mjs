// One exact pending quote survives the existing route to the owning topic.
// It is private writing in this tab, fenced by instance, actor, topic and the
// immutable page revision. The Reader claims it before its synchronous edit
// and restores it if writing cannot accept the quote.
export class NotebookQuoteTransfer {
  constructor(bootstrap, storage = globalThis.sessionStorage) {
    this.storage = storage;
    this.key = `notebook-quote:${JSON.stringify([bootstrap.instance_id, bootstrap.actor])}`;
  }
  keep(topicId, choice) {
    if (choice?.source?.kind !== 'memory' || !Number.isSafeInteger(choice.source.revision) || choice.source.revision < 1 ||
        !choice.source.id || !topicId || typeof choice.text !== 'string' || !choice.text.trim()) throw Error('The page passage could not be kept.');
    const pending = { topicId, choice, token: globalThis.crypto.randomUUID() };
    this.storage.setItem(this.key, JSON.stringify(pending));
    return pending;
  }
  forSource(topicId, source) {
    let pending;
    try { pending = JSON.parse(this.storage.getItem(this.key)); } catch { return null; }
    const ref = source?.source_ref, from = pending?.choice?.source;
    return pending?.topicId === topicId && from?.kind === 'memory' && ref?.kind === 'memory' &&
      from.id === ref.id && from.revision === ref.revision && typeof pending.choice.text === 'string' ? pending : null;
  }
  claim(pending) {
    const current = JSON.parse(this.storage.getItem(this.key));
    if (current?.token !== pending.token) return false;
    this.storage.removeItem(this.key);
    return true;
  }
  restore(pending) {
    if (this.storage.getItem(this.key) === null) this.storage.setItem(this.key, JSON.stringify(pending));
  }
}
