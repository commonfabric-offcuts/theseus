// The person's marks on messages, as this page knows them. A mark's revision
// is its whole state (odd marked, even not, 0 never marked) and only grows, so
// the page keeps, for each message, the highest revision anything has told it:
// the marks view, an open's editor_state, a receipt, or a refusal's
// current_versions. Nothing here reads a delivery or writes anything but
// message.mark.
//
// Clearing is the person's act of reading: a card's click or keypress, or the
// topic's Read it. The revision that act may clear is the one the page knew
// for that message at the act (capture), never one an answer brings later, so
// a mark renewed while the open is under way survives: the clear is refused.
// The clear is sent only for an open that succeeded and is still the one shown,
// while the page is in front; a page in the background sends it when it is
// shown again, if that same open is still shown.
import { shownTime, timeNode } from './times.mjs';

const PAGE = 50;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const pairOf = authority => ({ authority_id: authority?.authority_id, authority_epoch: authority?.authority_epoch });
const revision = value => Number.isSafeInteger(value) && value >= 0;

export class Marks {
  constructor({ api, instanceId, authority, doc = globalThis.document, win = globalThis, cancelOpen = () => false,
    recorded = () => {}, id = () => crypto.randomUUID() }) {
    if (!instanceId || typeof authority !== 'function') throw Error('Marks need a confirmed instance and its authority.');
    Object.assign(this, { api, instanceId, authority, doc, win, cancelOpen, recorded, id });
    this.known = new Map(); this.envelopes = new Map(); this.sending = new Map(); this.loads = new Map();
    this.listeners = new Set(); this.epoch = 0; this.deferred = null; this.authorityKey = null;
    const resume = () => this.resume();
    doc?.addEventListener?.('visibilitychange', resume); win?.addEventListener?.('focus', resume);
  }
  listen(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of [...this.listeners]) listener(); }

  // What the page knows of one message: its highest revision, or null.
  state(messageId) {
    const known = this.known.get(messageId);
    return known ? { marked: known.revision % 2 === 1, mark_revision: known.revision } : null;
  }
  busy(messageId) { return (this.sending.get(messageId) ?? 0) > 0; }
  // The person's marked messages in a topic, oldest first.
  marked(topicId) {
    return [...this.known].filter(([, k]) => k.topicId === topicId && k.revision % 2 === 1)
      .map(([messageId, k]) => ({ messageId, seq: k.seq, revision: k.revision })).sort((a, b) => a.seq - b.seq);
  }
  learn(messageId, value, { topicId = null, seq = null } = {}, quiet = false) {
    if (typeof messageId !== 'string' || !messageId || !revision(value)) throw Error('A mark names a message and its revision.');
    const known = this.known.get(messageId);
    if (known && known.revision >= value) {
      known.topicId ??= topicId; known.seq ??= seq; return false;
    }
    this.known.set(messageId, { revision: value, topicId: known?.topicId ?? topicId, seq: known?.seq ?? seq, epoch: this.epoch });
    if (!quiet) this.emit();
    return true;
  }

  // Reads every page of the person's marks in a topic. A mark the page knew
  // before the read began and the read no longer lists has been cleared since,
  // so it is at least one revision on; one learned while the read ran is left
  // as it is. A load asked for while one runs runs once more after it.
  // Settles true when the marks were read, false when they were not.
  load(topicId, read) {
    const running = this.loads.get(topicId);
    if (running) { running.again = true; return running.done; }
    const load = { again: false };
    load.done = (async () => {
      let read_ = false;
      do { load.again = false; read_ = await this.readAll(topicId, read).then(() => true, () => false); } while (load.again);
      return read_;
    })().finally(() => this.loads.delete(topicId));
    this.loads.set(topicId, load);
    return load.done;
  }
  async readAll(topicId, read) {
    const start = ++this.epoch, listed = new Map();
    let cursor = null;
    do {
      const page = await read({ topic_id: topicId, limit: PAGE, ...(cursor === null ? {} : { cursor }) });
      let previous = cursor ?? 0;
      if (page?.instance_id !== this.instanceId || page.topic_id !== topicId || !Array.isArray(page.items) ||
          !(page.next_cursor === null || Number.isSafeInteger(page.next_cursor))) throw Error('The marks page could not be confirmed.');
      for (const item of page.items) {
        if (typeof item?.message_id !== 'string' || !item.message_id || !Number.isSafeInteger(item.seq) || item.seq <= previous ||
            !revision(item.mark_revision) || item.mark_revision % 2 !== 1) throw Error('The marks page could not be confirmed.');
        previous = item.seq; listed.set(item.message_id, item);
      }
      if (page.next_cursor !== null && (!page.items.length || page.next_cursor !== previous)) throw Error('The marks page could not be confirmed.');
      cursor = page.next_cursor;
    } while (cursor !== null);
    let changed = false;
    for (const item of listed.values()) changed = this.learn(item.message_id, item.mark_revision, { topicId, seq: item.seq }, true) || changed;
    for (const [messageId, known] of this.known) {
      if (known.topicId === topicId && known.revision % 2 === 1 && known.epoch < start && !listed.has(messageId)) {
        changed = this.learn(messageId, known.revision + 1, {}, true) || changed;
      }
    }
    if (changed) this.emit();
  }

  // One envelope per message, state and revision, made once and sent again as
  // it is until Core records an answer to it. One made under another authority
  // is dropped: it can only be refused.
  envelope(messageId, marked, at) {
    const authority = pairOf(this.authority()), key = JSON.stringify(authority);
    if (this.authorityKey !== key) { this.envelopes.clear(); this.authorityKey = key; }
    const name = `${messageId}:${marked}:${at}`;
    if (!this.envelopes.has(name)) {
      this.envelopes.set(name, { v: 1, instance_id: this.instanceId, operation_id: this.id(), kind: 'message.mark',
        target: { message_id: messageId }, expected: { mark_revision: at, authority }, args: { marked } });
    }
    return { name, envelope: structuredClone(this.envelopes.get(name)) };
  }
  async send(messageId, marked, at) {
    if (typeof marked !== 'boolean' || !revision(at)) throw Error('A mark is sent with its state and the revision it was seen at.');
    const { name, envelope } = this.envelope(messageId, marked, at);
    this.sending.set(messageId, (this.sending.get(messageId) ?? 0) + 1); this.emit();
    try {
      const receipt = await this.api.command(envelope);
      if (receipt?.recorded !== true || receipt.operation_id !== envelope.operation_id) return receipt;
      if (this.envelopes.get(name)?.operation_id === envelope.operation_id) this.envelopes.delete(name);
      const result = receipt.result;
      if (receipt.status === 'committed' && result?.message_id === messageId) {
        this.learn(messageId, result.mark_revision, { topicId: result.topic_id, seq: result.seq }, true);
      }
      const current = receipt.error?.current_versions?.mark_revision;
      if (receipt.error?.code === 'REVISION_CONFLICT' && revision(current)) this.learn(messageId, current, {}, true);
      this.recorded(receipt);
      return receipt;
    } finally {
      const left = this.sending.get(messageId) - 1;
      if (left) this.sending.set(messageId, left); else this.sending.delete(messageId);
      this.emit();
    }
  }

  // The person's act of reading one message: the revision it may clear.
  capture(messageId) {
    const known = this.known.get(messageId);
    return known && known.revision % 2 === 1 ? { messageId, revision: known.revision } : null;
  }
  // An open, and for a reading open, the clear it earns.
  async open(registry, ref, options, act = null) {
    const presentation = await registry.open(ref, options);
    if (act) this.settle(presentation, act, registry);
    return presentation;
  }
  settle(presentation, act, registry) {
    // Only the open now shown decides the waiting clear: a superseded open's
    // late answer leaves the current one's clear alone.
    if (!presentation || !registry.isSourceCurrent(presentation)) return;
    this.deferred = null;
    if (presentation.sourceUnavailable || presentation.mark?.marked !== true) return;
    const attempt = () => {
      if (!registry.isSourceCurrent(presentation)) return;
      if (!this.shown()) { this.deferred = attempt; return; }
      this.send(act.messageId, false, act.revision).catch(() => {});
    };
    attempt();
  }
  shown() { return this.doc?.visibilityState === 'visible' && this.doc.hasFocus?.() === true; }
  resume() {
    const attempt = this.deferred;
    if (!attempt || !this.shown()) return;
    this.deferred = null; attempt();
  }
  // The page is leaving: an open under way is cancelled and a waiting clear
  // is dropped.
  leave() { this.deferred = null; this.cancelOpen(); }
}

// The Reader's toggle for one message, or hidden where it cannot be marked.
export function paintMarkButton(button, state) {
  button.hidden = !state;
  if (!state) return;
  button.textContent = state.marked ? 'Marked unread' : 'Mark unread';
  button.setAttribute('aria-pressed', String(state.marked));
  if (state.busy) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled');
}

export const marksWords = count => `${count} message${count === 1 ? '' : 's'} marked unread`;

// What a card's message carries that the person may want to know at a glance
// (item 127, docs/topic-reading.md): how many images it has, and whether the
// person has a private note on it or a reply saved from it and not sent. Core
// says the two for the reader alone (`yours`), so another's never shows.
export function carriesOf(item) {
  const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
  return { images: attachments.filter(attachment => /^image\//.test(attachment?.content_type ?? '')).length,
    note: item?.yours?.note === true, reply: item?.yours?.reply === true };
}
// Each mark's words: its accessible name and its tooltip.
export const carryWords = { image: count => (count === 1 ? 'Has an image' : `Has ${count} images`),
  note: 'Your private note, which only you can see', reply: 'Your reply, saved and not sent' };
const carryMarks = carries => (carries ? [carries.images > 0 && ['image', carryWords.image(carries.images)],
  carries.note && ['note', carryWords.note], carries.reply && ['reply', carryWords.reply]].filter(Boolean) : []);
// The marks as one group of glyphs, each named and titled in its words, or null when there are none. A stack's head
// row, which stands for its first message while that message's card is folded into it, shows them too (reply-stacks.mjs).
export function carriesNode(doc, carries, marks = carryMarks(carries)) {
  if (!marks.length) return null;
  const held = doc.createElement('span');
  held.className = 'card-carries';
  for (const [kind, words] of marks) {
    const mark = doc.createElement('span');
    mark.className = `carry carry-${kind}`; mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', words); mark.title = words;
    held.append(mark);
  }
  return held;
}

// A card's author line: the name, an Unread pill when the message is marked,
// joined to the name's last character (a whole grapheme) so a name that wraps
// keeps the pill on its last line, then the time. The name is held in
// author-name spans, which an agent's card colors as one: split for a pill,
// its first part is the start and its last character the end. sent is when
// the message was sent, or null for one from before times were kept. carries
// (carriesOf): beside the time, a small glyph for each thing the message
// carries, a mark and not a control, named and titled in words. edited: its
// words were changed after it was sent (docs/message-edit.md), said last.
export function paintAuthor(author, name, sent, marked, edited = false, carries = null) {
  const marks = carryMarks(carries);
  const shows = JSON.stringify([name, sent, sent === null ? null : shownTime(sent), marked, edited, marks]);
  if (author.dataset.shows === shows) return;
  author.dataset.shows = shows;
  author.replaceChildren();
  const last = marked && name ? Array.from(graphemes.segment(name)).at(-1).segment : '';
  const named = document.createElement('span');
  named.className = marked ? 'author-name author-name-start' : 'author-name'; named.append(name.slice(0, name.length - last.length));
  author.append(named);
  if (marked) {
    const together = document.createElement('span'), pill = document.createElement('span'), spoken = document.createElement('span');
    together.className = 'together'; pill.className = 'unread-mark'; pill.textContent = 'Unread'; pill.setAttribute('aria-hidden', 'true');
    spoken.className = 'sr-only'; spoken.textContent = ', marked unread';
    const end = document.createElement('span');
    end.className = 'author-name author-name-end'; end.append(last);
    together.append(end, pill, spoken); author.append(together);
  }
  // The marks are joined to the time, so a line that wraps keeps them beside it.
  const held = carriesNode(document, carries, marks);
  if (sent !== null) {
    const at = document.createElement('span'), time = timeNode(sent, document);
    at.className = 'message-time';
    if (held) { const together = document.createElement('span'); together.className = 'together'; together.append(time, held); at.append(' · ', together); }
    else at.append(' · ', time);
    author.append(at);
  } else if (held) author.append(held);
  if (edited) { const mark = document.createElement('span'); mark.className = 'message-edited'; mark.append(' · Edited'); author.append(mark); }
}
