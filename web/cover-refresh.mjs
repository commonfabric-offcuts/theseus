// Core owns pending/completed. This client retains only the exact command
// whose answer may be lost, under its captured instance/actor/authority.
import { glyph } from './glyphs.mjs';
import { linkNode } from './links.mjs';
import { notTaken, NOT_TAKEN } from './api.mjs';
import { waitingDots } from './outcome-conversation.mjs';

let runtime = null;
const requests = new Map(), painters = new WeakMap();
export const configureCoverRefresh = provider => { runtime = provider; };
const authorityKey = value => JSON.stringify([value?.authority_id, value?.authority_epoch]);
const storageKey = (binding, root) => `aim-next-cover-refresh:${JSON.stringify([binding.instance_id, binding.actor, root])}`;

export function refreshControl(doc, cover, context) {
  if (!runtime || !cover.root_id || !Number.isSafeInteger(cover.revision)) return null;
  const { bootstrap } = runtime(), key = storageKey(bootstrap, cover.root_id);
  let local = requests.get(key);
  if (!local) {
    local = { busy: false, request: null, confirmed: null, error: '' };
    try {
      const kept = JSON.parse(doc.defaultView.localStorage.getItem(key) ?? 'null');
      if (kept) {
        if (kept.instance_id !== bootstrap.instance_id || kept.kind !== 'stack.cover_refresh' ||
            kept.target?.message_id !== cover.root_id || typeof kept.operation_id !== 'string' ||
            !Number.isSafeInteger(kept.expected?.cover_revision) || !kept.expected?.authority ||
            Object.keys(kept.args ?? {}).length) throw Error('The saved refresh request could not be read safely.');
        local.request = kept;
        local.error = 'The cover request is not confirmed. Press refresh to retry the same request.';
      }
    } catch (error) { local.error = error.message; local.storageFailed = true; }
    requests.set(key, local);
  }
  const host = doc.createElement('span'); host.className = 'cover-refresh'; host.dataset.coverRefresh = key;
  const repaint = () => {
    for (const node of doc.querySelectorAll('[data-cover-refresh]')) if (node.dataset.coverRefresh === key) painters.get(node)?.();
  };
  const draw = () => {
    if (local.confirmed && (cover.refresh_revision ?? 0) >= local.confirmed.revision) local.confirmed = null;
    const refresh = local.confirmed?.value ?? cover.refresh;
    if (local.request && refresh?.operation_id === local.request.operation_id) {
      local.request = null; local.error = '';
      try { doc.defaultView.localStorage.removeItem(key); } catch { /* Core has the fact; no replacement command is needed. */ }
    }
    const pending = refresh?.state === 'pending';
    const label = pending ? `Awaiting ${context.nameOf(refresh.recipient)}’s new cover. Open the request`
      : local.busy ? 'Requesting a cover update' : 'Ask the writer to refresh this cover';
    const control = pending ? linkNode(doc, '', { route: { kind: 'topic', id: context.topicId, message: refresh.request_message_id }, written: true })
      : doc.createElement('button');
    control.className = 'cover-refresh-glyph'; control.title = label; control.setAttribute('aria-label', label);
    control.dataset.pending = String(pending || local.busy);
    control.append(pending || local.busy ? waitingDots(doc, label) : glyph('refresh', doc, 17));
    if (!pending) {
      control.type = 'button'; control.setAttribute('aria-disabled', String(local.busy));
      control.onclick = async event => {
        event.stopPropagation();
        if (local.busy) return;
        local.busy = true; local.error = ''; repaint();
        const current = runtime();
        try {
          if (local.storageFailed) throw Error('Private request storage is unavailable. Reload before requesting a cover update.');
          if (!local.request) {
            const { authority_id, authority_epoch } = current.bootstrap.authority;
            local.request = { v: 1, instance_id: current.bootstrap.instance_id, operation_id: crypto.randomUUID(),
              kind: 'stack.cover_refresh', target: { message_id: cover.root_id },
              expected: { cover_revision: cover.revision, authority: { authority_id, authority_epoch } }, args: {} };
            // Save before sending. Storage failure starts no network request.
            try { doc.defaultView.localStorage.setItem(key, JSON.stringify(local.request)); }
            catch { local.request = null; throw Error('The cover request could not be kept on this device. Nothing was sent.'); }
          }
          const request = local.request;
          if (authorityKey(request.expected.authority) !== authorityKey(current.bootstrap.authority)) {
            throw Error('This saved refresh belongs to an earlier instance binding. It is kept for reconciliation.');
          }
          let receipt;
          try { receipt = await current.api.command(structuredClone(request)); }
          catch (error) {
            const why = notTaken({ error });
            throw Error(`${why.why ?? NOT_TAKEN[why.kind] ?? 'The connection was interrupted'}. The request is not confirmed; press refresh to retry it.`);
          }
          if (receipt?.instance_id !== request.instance_id || receipt.operation_id !== request.operation_id || receipt.kind !== request.kind) {
            throw Error('The cover request could not be confirmed. Press refresh to retry the same request.');
          }
          if (receipt.status === 'committed' && receipt.recorded === true) {
            local.confirmed = { value: receipt.result.refresh, revision: receipt.result.refresh_revision };
          } else if (receipt.recorded === true || receipt.error?.code === 'INVALID_ARGUMENT') {
            local.error = receipt.error?.message ?? 'The cover refresh was refused; the cover is kept.';
          } else {
            throw Error(`${receipt.error?.message ?? 'The request is not confirmed'}. Press refresh to retry it.`);
          }
          doc.defaultView.localStorage.removeItem(key); local.request = null;
        } catch (error) { local.error = error.message; }
        finally { local.busy = false; repaint(); current.changed(); }
      };
    }
    const status = doc.createElement('span'); status.className = 'cover-refresh-status'; status.setAttribute('role', 'status');
    status.textContent = local.error || (!pending && local.busy ? 'Requesting update…' : '');
    const focused = host.contains(doc.activeElement);
    host.replaceChildren(control, status);
    if (focused) control.focus({ preventScroll: true });
  };
  painters.set(host, draw); draw(); return host;
}
