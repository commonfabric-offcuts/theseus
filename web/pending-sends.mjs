// Local submission presentation. No item here enters the canonical message map.
import { cardClass } from './author-colors.mjs';
import { paintAuthor } from './marks.mjs';
import { paintReplyLine } from './replies.mjs';
import { paintCardWords, cardWordOptions } from './message-card-content.mjs';
import { paintCardImages, dropCardImages } from './card-images.mjs';
import { samePin } from './upload-state.mjs';

const retained = new WeakMap(), adopted = new WeakSet();
const cardsOf = host => { if (!retained.has(host)) retained.set(host, new Map()); return retained.get(host); };

// Existing list holds protect reading/writing elsewhere. When focus is on
// this local card, hold that one card through its canonical stack placement.
export function keepPendingSendPlace(host, paint, { current = () => true,
  top = node => node.getBoundingClientRect().top,
  restore = null,
  scroll = delta => host.ownerDocument.defaultView.scrollBy({ top: delta, behavior: 'instant' }) } = {}) {
  const active = host.ownerDocument.activeElement, card = active?.closest?.('[data-pending-send]');
  const held = card && host.contains(card) && current() ? card : null;
  const before = held ? top(held) : null;
  const result = paint();
  const after = held?.isConnected ? held : result?.pendingReplacement;
  if (held && after?.isConnected && current() && (host.ownerDocument.activeElement === after || after.contains(host.ownerDocument.activeElement))) {
    const delta = top(after) - before;
    if (Number.isFinite(delta) && delta !== 0) { if (restore) restore(after, before); else scroll(delta); }
  }
  return result;
}

export function pendingSendVisual(editor, item, { authorKind = 'human', parent = null } = {}) {
  const snapshot = item.snapshot;
  const refs = editor.uploadState?.submission_links?.[item.id]?.refs ?? [];
  const attachments = (snapshot.attachments ?? []).map(ref => {
    const link = refs.find(link => link.media_id === ref.id);
    const entry = link && editor.uploadState.entries.find(entry => entry.selection_id === link.selection_id);
    const ready = entry?.ready_descriptor;
    if (!ready || ready.media_id !== ref.id || ready.state !== 'ready' || ready.media_revision !== 2) return { ...ref };
    return { ...ref, ...Object.fromEntries(['name', 'content_type', 'size_bytes', 'sha256', 'inline'].filter(key => ready[key] !== undefined).map(key => [key, ready[key]])) };
  });
  return { id: `local:${editor.context.instanceId}:${item.id}`, topic_id: item.topicId,
    author_id: editor.context.actor, author_kind: authorKind, body: snapshot.body, attachments,
    whisper: snapshot.whisper === true, private_to: snapshot.whisper ? snapshot.addressees?.[0] : null,
    reply_to: snapshot.reply_to ?? null, reply_to_author: parent?.author_id,
    reply_to_excerpt: parent?.body, reply_to_removal: parent?.removal, sent_ms: null };
}

export function clearPendingSends(host) {
  if (!host) return;
  for (const card of cardsOf(host).values()) { dropCardImages(card); card.remove(); }
  cardsOf(host).clear();
}

export function paintPendingSends(host, editors, { topicId, placed = () => false, parent = () => null,
  check = () => {}, underway = () => false, restored = () => {}, current = () => true,
  visual = (editor, item) => pendingSendVisual(editor, item), nameOf = id => id,
  author = (node, item) => paintAuthor(node, nameOf(item.author_id), null, false),
  readImage = async () => null, displayRules = [], end = null } = {}) {
  if (!host) return;
  if (!current()) { clearPendingSends(host); return; }
  const doc = host.ownerDocument, kept = new Set(), cards = cardsOf(host), afterParent = new Map(), roots = [];
  for (const editor of editors) for (const item of editor.submissions ?? []) {
    if (!item.presentPending || item.detached || item.topicId !== topicId || adopted.has(item)) continue;
    if (item.status === 'confirmed' && placed(item.receipt?.result?.message_id)) continue;
    const id = item.id; kept.add(id);
    let card = cards.get(id);
    if (!card) {
      card = doc.createElement('div'); card.tabIndex = -1; card.setAttribute('role', 'article');
      card.dataset.pendingSend = id;
      const heading = doc.createElement('span'); heading.className = 'message-author'; card.append(heading);
      const retry = doc.createElement('button'); retry.type = 'button'; retry.className = 'pending-send-check'; retry.textContent = 'Check confirmation';
      card.append(retry); cards.set(id, card);
    }
    const message = visual(editor, item);
    card.className = cardClass(message, editor.context.actor) + ' pending-send';
    const heading = card.querySelector(':scope > .message-author'); author(heading, message);
    let status = card.querySelector('.pending-send-state');
    if (!status) { status = doc.createElement('span'); status.className = 'pending-send-state'; status.setAttribute('role', 'status'); heading.append(status); }
    paintCardWords(card, message, cardWordOptions(message, { displayRules }));
    let reply = card.querySelector(':scope > .message-reply-to');
    if (message.reply_to) {
      if (!reply) { reply = doc.createElement('span'); reply.className = 'message-reply-to'; card.insertBefore(reply, card.querySelector('.message-preview')); }
      paintReplyLine(reply, message);
    } else reply?.remove();
    paintCardImages(card, message, async attachment => {
      if (!current() || item.detached) return null;
      const blob = await readImage(editor, item, attachment);
      return current() && !item.detached ? blob : null;
    });
    const active = underway(editor, item) && !item.blocked;
    const state = item.status === 'confirmed' ? 'Sent — placing…' : item.status === 'refused'
      ? item.restoredWriting ? 'Not sent — writing restored' : 'Not sent — writing kept here'
      : item.blocked || !active ? 'Confirmation unknown — writing kept here' : 'Sending…';
    if (status.textContent !== state) status.textContent = state;
    card.dataset.sendState = item.status;
    if (item.restoredWriting) restored(editor, item, card);
    const retry = card.querySelector('.pending-send-check'); retry.hidden = active;
    retry.onclick = event => { event?.stopPropagation(); check(editor, item); };
    // Frozen reply_to owns placement, not the editor's possibly different source.
    const offered = parent(message.reply_to ? { kind: 'message', id: message.reply_to } : null, item);
    const where = offered && host.contains(offered) ? afterParent.get(offered) ?? offered : null;
    if (where) {
      if (card.parentElement !== where.parentElement || card.previousElementSibling !== where)
        where.parentElement.insertBefore(card, where.nextElementSibling);
      afterParent.set(offered, card);
    } else roots.push(card);
  }
  for (const [id, card] of cards) if (!kept.has(id)) { dropCardImages(card); card.remove(); cards.delete(id); }
  // Place the ordered root group against one shared cursor. Checking each
  // root against the composer independently would detach A then B on every
  // unchanged A,B,composer repaint, even though the final order looked right.
  let before = end?.parentElement === host ? end : null;
  for (let index = roots.length - 1; index >= 0; index--) {
    const card = roots[index];
    if (card.parentElement !== host || card.nextElementSibling !== before) host.insertBefore(card, before);
    before = card;
  }
}

// The canonical painter calls this only after its authorized page is admitted.
export function adoptPendingSend(host, editors, message, { topicId, authority = null, current = () => true } = {}) {
  if (!host || !current() || message?.topic_id !== topicId) return null;
  const cards = cardsOf(host);
  for (const editor of editors) for (const item of editor.submissions ?? []) {
    const receipt = item.receipt, result = receipt?.result;
    if (!item.presentPending || item.detached || item.topicId !== topicId || item.status !== 'confirmed' ||
        receipt?.status !== 'committed' || receipt.recorded !== true || receipt.kind !== 'message.send' ||
        receipt.instance_id !== editor.context.instanceId || receipt.operation_id !== item.sendOperationId ||
        authority && !samePin(item.authority, authority) ||
        result?.message_id !== message.id || message.author_id !== editor.context.actor ||
        Number.isSafeInteger(result.seq) && result.seq !== message.seq) continue;
    const card = cards.get(item.id);
    if (!card || !host.contains(card)) return null;
    const active = host.ownerDocument.activeElement;
    const refocus = card === active || card.contains(active);
    for (const node of card.querySelectorAll('.pending-send-state, .pending-send-check')) node.remove();
    delete card.dataset.pendingSend; delete card.dataset.sendState; card.classList.remove('pending-send');
    cards.delete(item.id); adopted.add(item);
    return { card, refocus, active, item, editor };
  }
  return null;
}

// A Live page can beat the send receipt. Once the exact receipt arrives,
// retain the already-bound canonical card at the local card's position.
export function reconcilePlacedSend(host, editors, message, canonical, options) {
  if (!canonical || !host.contains(canonical) || canonical.dataset.id !== message?.id) return null;
  const adopted = adoptPendingSend(host, editors, message, options);
  if (!adopted || canonical === adopted.card) return null;
  const { card, refocus, active } = adopted, parent = card.parentElement;
  parent.insertBefore(canonical, card); dropCardImages(card); card.remove();
  if (refocus) {
    const sameLink = active?.tagName === 'A' ? [...canonical.querySelectorAll('a')].find(link => link.href === active.href) : null;
    (sameLink ?? canonical).focus({ preventScroll: true });
  }
  return { pendingReplacement: canonical };
}
