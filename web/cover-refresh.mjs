// One request/activity owner for cover refreshes (738) and message updates (786).
// Core owns pending/completed; this keeps only unconfirmed exact envelopes.
import { glyph } from './glyphs.mjs';
import { linkNode } from './links.mjs';
import { notTaken, NOT_TAKEN } from './api.mjs';
import { waitingDots } from './outcome-conversation.mjs';
import { stackCover } from './stack-order.mjs';
import { timeNode } from './times.mjs';

let runtime = null;
const requests = new Map(), painters = new WeakMap();
export const configureCoverRefresh = provider => { runtime = provider; };
const authorityKey = value => JSON.stringify([value?.authority_id, value?.authority_epoch]);
const storageKey = (binding, target) => `aim-next-${target.type === 'cover' ? 'cover' : 'message'}-refresh:${JSON.stringify([binding.instance_id, binding.actor, target.id])}`;
const commandKind = target => target.type === 'cover' ? 'stack.cover_refresh' : 'message.refresh';
const revisionField = target => target.type === 'cover' ? 'cover_revision' : 'message_revision';

export function mayAskForUpdate(item, viewer) {
  const author = item?.author_id ?? item?.author;
  return Boolean(item && item.author_kind === 'agent' && typeof author === 'string' && author && author !== viewer);
}
const messageTarget = item => ({ type: 'message', id: item.id ?? item.source_ref?.id,
  revision: item.revision ?? item.current_revision ?? 1,
  refresh: item.acts?.message_refresh, refresh_revision: item.acts?.message_refresh_revision ?? 0 });

// Exported so focused contracts exercise the very same door used by both UIs.
export function refreshRequest(doc, target) {
  if (!runtime || !target.id || !Number.isSafeInteger(target.revision)) return null;
  const { bootstrap } = runtime(), key = storageKey(bootstrap, target);
  let local = requests.get(key);
  if (!local) {
    local = { busy: false, request: null, confirmed: null, seen: -1, value: null, targetRevision: 0, error: '' };
    try {
      const kept = JSON.parse(doc.defaultView.localStorage.getItem(key) ?? 'null');
      if (kept) {
        if (kept.instance_id !== bootstrap.instance_id || kept.kind !== commandKind(target) ||
            kept.target?.message_id !== target.id || typeof kept.operation_id !== 'string' ||
            !Number.isSafeInteger(kept.expected?.[revisionField(target)]) || !kept.expected?.authority ||
            Object.keys(kept.args ?? {}).length) throw Error('The saved update request could not be read safely.');
        local.request = kept;
        local.error = 'The update request is not confirmed. Ask again to retry the same request.';
      }
    } catch (error) { local.error = error.message; local.storageFailed = true; }
    requests.set(key, local);
  }
  local.targetRevision = Math.max(local.targetRevision, target.revision);
  if ((target.refresh_revision ?? 0) > local.seen) {
    local.seen = target.refresh_revision ?? 0; local.value = target.refresh;
  }
  const repaint = () => {
    for (const node of doc.querySelectorAll('[data-cover-refresh]')) if (node.dataset.coverRefresh === key) painters.get(node)?.();
  };
  const state = () => {
    if (local.confirmed && local.seen >= local.confirmed.revision) local.confirmed = null;
    const refresh = local.confirmed?.value ?? local.value;
    if (local.request && refresh?.operation_id === local.request.operation_id) {
      local.request = null; local.error = '';
      try { doc.defaultView.localStorage.removeItem(key); } catch { /* Core has the fact. */ }
    }
    // A late request response cannot revive activity after ordinary edited words arrived.
    const pending = refresh?.state === 'pending' && !(target.type === 'message' && local.targetRevision > refresh.observed_revision);
    const busy = local.busy && !(target.type === 'message' && local.targetRevision > local.sendingRevision);
    return { refresh, pending, busy, error: local.error };
  };
  const send = async () => {
    if (local.busy || state().pending) return;
    local.sendingRevision = local.request?.expected?.[revisionField(target)] ?? target.revision;
    local.busy = true; local.error = ''; repaint();
    const current = runtime();
    try {
      if (local.storageFailed) throw Error('Private request storage is unavailable. Reload before asking for an update.');
      if (!local.request) {
        const { authority_id, authority_epoch } = current.bootstrap.authority;
        local.request = { v: 1, instance_id: current.bootstrap.instance_id, operation_id: crypto.randomUUID(),
          kind: commandKind(target), target: { message_id: target.id },
          expected: { [revisionField(target)]: target.revision, authority: { authority_id, authority_epoch } }, args: {} };
        try { doc.defaultView.localStorage.setItem(key, JSON.stringify(local.request)); }
        catch (error) { local.request = null; throw Error('The update request could not be kept on this device. Nothing was sent.', { cause: error }); }
      }
      const request = local.request;
      if (authorityKey(request.expected.authority) !== authorityKey(current.bootstrap.authority)) {
        throw Error('This saved update belongs to an earlier instance binding. It is kept for reconciliation.');
      }
      let receipt;
      try { receipt = await current.api.command(structuredClone(request)); }
      catch (error) {
        const why = notTaken({ error });
        throw Error(`${why.why ?? NOT_TAKEN[why.kind] ?? 'The connection was interrupted'}. The request is not confirmed; ask again to retry it.`, { cause: error });
      }
      if (receipt?.instance_id !== request.instance_id || receipt.operation_id !== request.operation_id || receipt.kind !== request.kind) {
        throw Error('The update request could not be confirmed. Ask again to retry the same request.');
      }
      if (receipt.status === 'committed' && receipt.recorded === true) {
        if (!local.confirmed || receipt.result.refresh_revision > local.confirmed.revision) {
          local.confirmed = { value: receipt.result.refresh, revision: receipt.result.refresh_revision };
        }
      } else if (receipt.recorded === true || receipt.error?.code === 'INVALID_ARGUMENT') {
        local.error = receipt.error?.message ?? 'The update request was refused; the writing is kept.';
      } else {
        throw Error(`${receipt.error?.message ?? 'The request is not confirmed'}. Ask again to retry it.`);
      }
      doc.defaultView.localStorage.removeItem(key); local.request = null;
    } catch (error) { local.error = error.message; }
    finally { local.busy = false; repaint(); current.changed(); }
  };
  return { key, state, send };
}

const requestLink = (doc, topicId, messageId, words = '') => linkNode(doc, words,
  { route: { kind: 'topic', id: topicId, message: messageId }, written: true });

// One latest line per target, from the same monotonic state as its control.
// Old request messages keep their links and get no retrospective line.
export function refreshLine(doc, target, context) {
  const request = refreshRequest(doc, target);
  if (!request) return null;
  if (!request.state().refresh?.request_id) return null;
  const line = doc.createElement('span'); line.className = 'refresh-request-line'; line.dataset.coverRefresh = request.key;
  const draw = () => {
    const { refresh } = request.state(), completed = refresh?.state === 'completed';
    // A cover's revision owns its completion footer, including direct writes.
    // Keep the request's timed pending line, without a second completion claim.
    line.hidden = !refresh?.request_id || (target.type === 'cover' && completed);
    if (line.hidden) { line.replaceChildren(); return; }
    const cover = target.type === 'cover', name = context.nameOf;
    const words = completed ? `${name(refresh.completed_by)} ${cover ? 'refreshed the cover' : 'updated this message'}`
      : `${name(refresh.by)} asked ${name(refresh.recipient)} to ${cover ? 'refresh the cover' : 'update this message'}`;
    line.replaceChildren(words + ' · ', timeNode(completed ? refresh.completed_ms : refresh.at_ms, doc));
  };
  painters.set(line, draw); draw(); return line;
}

const writtenCover = cover => Boolean(cover && (cover.by !== null || cover.stands || cover.payload));
const coverTarget = cover => ({ type: 'cover', first: !writtenCover(cover), id: cover.root_id, revision: cover.revision,
  refresh: cover.refresh, refresh_revision: cover.refresh_revision });
export const coverRequestLine = (doc, cover, context) => refreshLine(doc, coverTarget(cover), context);

function activity(doc, target, context) {
  const request = refreshRequest(doc, target);
  if (!request) return null;
  const isCover = target.type === 'cover';
  const host = doc.createElement('span'); host.className = isCover ? 'cover-refresh' : 'message-update'; host.dataset.coverRefresh = request.key;
  const draw = () => {
    const { refresh, pending, busy, error } = request.state();
    const legacy = pending && Boolean(refresh.request_message_id), open = legacy ? '. Open the request' : '';
    const label = pending ? (isCover ? (target.first ? `Asked ${context.nameOf(refresh.recipient)} to write a cover${open}` : `Awaiting ${context.nameOf(refresh.recipient)}’s new cover${open}`)
      : `Asked ${context.nameOf(refresh.recipient)} to update this message${open}`)
      : busy ? 'Requesting an update' : target.first ? 'Ask for a cover' : 'Ask the writer to refresh this cover';
    const control = legacy ? requestLink(doc, context.topicId, refresh.request_message_id)
      : doc.createElement(pending ? 'span' : 'button');
    control.className = isCover ? 'cover-refresh-glyph' : 'message-update-activity';
    control.title = label; control.setAttribute('aria-label', label); control.dataset.pending = String(pending || busy);
    control.append(pending || busy ? waitingDots(doc, label) : glyph(target.first ? 'coverplus' : 'refresh', doc, 17));
    if (!pending) {
      control.type = 'button'; control.setAttribute('aria-disabled', String(busy));
      control.onclick = async event => { event.stopPropagation(); await request.send(); };
    }
    const status = doc.createElement('span'); status.className = 'cover-refresh-status'; status.setAttribute('role', 'status'); status.textContent = error;
    const focused = host.contains(doc.activeElement);
    const line = !isCover ? refreshLine(doc, target, context) : null;
    host.hidden = !isCover && !(pending || busy || error || refresh?.request_id);
    host.replaceChildren(...(isCover || pending || busy ? [control] : []), status, ...(line ? [line] : []));
    if (focused && !host.hidden && control.isConnected) control.focus({ preventScroll: true });
  };
  painters.set(host, draw); draw(); return host;
}

export function refreshControl(doc, cover, context) {
  return activity(doc, coverTarget(cover), context);
}
// The header and all dossier menus use this same admission and request owner.
export function firstCoverTarget(stack) {
  const cover = stackCover(stack, { alone: true });
  if (stack.id !== stack.dossier || writtenCover(cover)) return null;
  const acts = stack.head.acts ?? {};
  return { type: 'cover', first: true, id: stack.id, revision: cover?.revision ?? acts.cover_revision ?? 0,
    refresh: cover?.refresh ?? acts.cover_refresh, refresh_revision: cover?.refresh_revision ?? acts.cover_refresh_revision ?? 0 };
}
export function firstCoverControl(doc, stack, context) {
  const target = firstCoverTarget(stack);
  return target ? activity(doc, target, context) : null;
}
export function firstCoverMenuItem(doc, stack) {
  const target = firstCoverTarget(stack), request = target && refreshRequest(doc, target);
  if (!request) return null;
  const { pending, refresh } = request.state();
  if (pending && refresh.request_id) return null;
  return pending ? { label: 'Open the cover request', glyph: 'link',
    act: () => requestLink(doc, stack.head.topic_id, refresh.request_message_id, 'Open the cover request').click() }
    : { label: 'Ask for a cover', glyph: 'coverplus', act: () => request.send() };
}
export function updateMenuItem(doc, item, context) {
  if (!mayAskForUpdate(item, context.viewer)) return null;
  const request = refreshRequest(doc, messageTarget(item));
  return request ? { label: 'Ask for update', glyph: 'refresh', act: () => request.send() } : null;
}
export function messageUpdateActivity(doc, item, context) {
  if (!mayAskForUpdate(item, context.viewer) && !item.acts?.message_refresh?.request_id) return null;
  return activity(doc, messageTarget(item), context);
}

// Ordinary asks fold their source. Activity follows the message's visible row.
export function messageUpdateHost(card, entry = card) {
  if (entry !== card && card.hidden) return entry;
  if (card.classList.contains('stack-head-card') && card.closest('.reply-stack')?.dataset.headOpen === 'false') return card.querySelector(':scope > .stack-head');
  if (card.dataset.folded === 'true') return card.querySelector(':scope > .message-folded');
  if (card.dataset.earlier === 'true') return card.querySelector(':scope > .message-earlier');
  return card.querySelector(':scope > .message-author');
}
