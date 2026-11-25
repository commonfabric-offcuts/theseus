// Derived local presentation; never inserted into the authoritative message map.
export function paintPendingSends(host, editors, { topicId, placed = () => false, parent = () => null, check = () => {}, underway = () => false, restored = () => {} } = {}) {
  if (!host) return;
  const doc = host.ownerDocument, kept = new Set();
  for (const editor of editors) for (const item of editor.submissions ?? []) {
    if (!item.presentPending || item.detached || item.topicId !== topicId) continue;
    const id = item.id;
    if (item.status === 'confirmed' && placed(item.receipt?.result?.message_id)) continue;
    kept.add(id);
    let card = [...host.querySelectorAll('[data-pending-send]')].find(node => node.dataset.pendingSend === id);
    if (!card) {
      card = doc.createElement('section'); card.className = 'pending-send'; card.dataset.pendingSend = id;
      card.setAttribute('aria-live', 'polite');
      const status = doc.createElement('p'); status.className = 'pending-send-state';
      const words = doc.createElement('pre'); words.className = 'pending-send-words'; words.textContent = item.snapshot.body;
      const images = doc.createElement('p'); images.className = 'pending-send-images';
      const count = item.snapshot.attachments?.length ?? 0;
      images.textContent = `${count} ${count === 1 ? 'image' : 'images'} included`;
      images.dataset.attachments = JSON.stringify((item.snapshot.attachments ?? []).map(image => image.id));
      images.hidden = !item.snapshot.attachments?.length;
      const retry = doc.createElement('button'); retry.type = 'button'; retry.textContent = 'Check confirmation';
      retry.onclick = () => check(editor, item);
      card.append(status, words, images, retry);
    }
    const active = underway(editor, item) && !item.blocked;
    const state = item.status === 'confirmed' ? 'Sent — placing your message…' : item.status === 'refused'
      ? item.restoredWriting ? 'Not sent — writing restored' : 'Not sent — writing kept here'
      : item.blocked || !active ? 'Confirmation unknown — writing kept here' : 'Sending…';
    const status = card.querySelector('.pending-send-state'); if (status.textContent !== state) status.textContent = state;
    card.dataset.sendState = item.status;
    if (item.restoredWriting) restored(editor, item, card);
    const retry = card.querySelector('button'); retry.hidden = active;
    const offered = parent(item.sourceRef), where = offered && host.contains(offered) ? offered : null;
    const container = where?.parentElement ?? host;
    const before = where?.nextElementSibling ?? (where ? null : host.firstElementChild);
    if (card.parentElement !== container || where && card.previousElementSibling !== where) container.insertBefore(card, before === card ? card.nextElementSibling : before);
  }
  for (const card of [...host.querySelectorAll('[data-pending-send]')]) if (!kept.has(card.dataset.pendingSend)) card.remove();
}
