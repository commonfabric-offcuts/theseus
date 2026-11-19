// Core owns permission and admission; this picker sends one exact operation per choice.
import { tabStops } from './topic-settings.mjs';

export function moveEnvelope({ instanceId, authority, root, source, revision, destination, operationId }) {
  return { v: 1, instance_id: instanceId, operation_id: operationId, kind: 'stack.move', target: { message_id: root },
    expected: { authority: { authority_id: authority.authority_id, authority_epoch: authority.authority_epoch }, source_topic_id: source, move_revision: revision }, args: { topic_id: destination } };
}

export function openDossierMove({ anchor, messageId, read, send, binding, moved, doc = document, win = window }) {
  const el = (tag, props = {}) => Object.assign(doc.createElement(tag), props);
  const dialog = el('dialog', { className: 'dossier-move' }); dialog.setAttribute('aria-label', 'Move dossier to topic');
  const title = el('h2', { textContent: 'Move to topic…' }), close = el('button', { type: 'button', textContent: 'Close' });
  const status = el('p', { className: 'dossier-move-status', textContent: 'Reading topics…' }); status.setAttribute('role', 'status');
  const choices = el('div', { className: 'dossier-move-choices' }), more = el('button', { type: 'button', textContent: 'More topics', hidden: true });
  const retry = el('button', { type: 'button', textContent: 'Retry', hidden: true });
  dialog.append(title, close, status, choices, more, retry); doc.body.append(dialog);
  let current = true, busy = false, cursor = null, info = null, pending = null;
  const finish = () => { current = false; dialog.close(); dialog.remove(); win.removeEventListener('pointerdown', pointer, true); if (anchor?.isConnected) anchor.focus({ preventScroll: true }); };
  close.onclick = finish;
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
  // This short-lived picker removes its window listener when it closes.
  let outsidePress = false;
  const pointer = event => {
    const box = dialog.getBoundingClientRect();
    outsidePress = event.target === dialog && event.button === 0 && event.isPrimary !== false &&
      (event.clientX < box.left || event.clientX >= box.right || event.clientY < box.top || event.clientY >= box.bottom);
  };
  const clicked = event => { if (outsidePress && event.target === dialog) finish(); outsidePress = false; };
  win.addEventListener('pointerdown', pointer, true); dialog.addEventListener('click', clicked);
  dialog.addEventListener('keydown', event => {
    const stops = tabStops(dialog), at = stops.indexOf(doc.activeElement);
    if (event.key === 'Tab' && (event.shiftKey ? at <= 0 : at === stops.length - 1)) {
      event.preventDefault(); stops[event.shiftKey ? stops.length - 1 : 0]?.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? stops.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + stops.length) % stops.length;
      stops[index]?.focus();
    }
  });
  const enable = () => { for (const button of choices.querySelectorAll('button')) button.disabled = busy; more.disabled = busy; };
  const attempt = async () => {
    if (busy || !pending) return;
    busy = true; retry.hidden = true; status.textContent = 'Moving dossier…'; enable();
    try {
      const receipt = await send(pending);
      if (!current) { if (receipt?.status === 'committed') moved(receipt); return; }
      if (receipt?.status === 'committed') { finish(); moved(receipt); return; }
      status.textContent = receipt?.error?.message ?? 'The move was not confirmed. Retry keeps the same request.';
      retry.hidden = receipt?.recorded === true;
      // A recorded refusal is final for this operation. Reopen to read fresh choices.
      if (receipt?.recorded === true) choices.replaceChildren();
    } catch { if (current) { status.textContent = 'The move was not confirmed. Retry keeps the same request.'; retry.hidden = false; } }
    finally { busy = false; if (current) enable(); }
  };
  const load = async () => {
    if (busy) return;
    busy = true; enable(); retry.hidden = true;
    try {
      const answer = await read('dossier_move_targets', { message_id: messageId, limit: 20, ...(cursor === null ? {} : { cursor }) });
      if (!current) return;
      if (answer.error) throw Error(answer.error.message);
      info ??= answer;
      if (info.root_id !== answer.root_id || info.topic_id !== answer.topic_id || info.move_revision !== answer.move_revision) throw Error('This dossier moved. Close and open its menu again.');
      for (const topic of answer.items) {
        const button = el('button', { type: 'button', textContent: topic.title }); button.dataset.topicId = topic.id;
        button.onclick = () => {
          if (busy) return;
          if (!pending || pending.args.topic_id !== topic.id) pending = moveEnvelope({ ...binding(), root: info.root_id, source: info.topic_id,
            revision: info.move_revision, destination: topic.id, operationId: win.crypto.randomUUID() });
          attempt();
        };
        choices.append(button);
      }
      cursor = answer.next_cursor; more.hidden = cursor === null;
      status.textContent = choices.children.length ? 'The whole dossier moves, keeping its replies and cover.' : 'No other open topics in this outcome.';
      if (choices.children.length === answer.items.length) choices.querySelector('button')?.focus();
    } catch (error) { if (current) { status.textContent = error.message; retry.hidden = false; } }
    finally { busy = false; if (current) enable(); }
  };
  more.onclick = load; retry.onclick = () => pending ? attempt() : load();
  dialog.showModal(); close.focus(); load();
  return { close: finish };
}
