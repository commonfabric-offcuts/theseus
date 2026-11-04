import { readableUploads, samePin } from './upload-state.mjs';
const copy = structuredClone;
const keysOnly = (value, keys) => value && Object.keys(value).every(k => keys.includes(k));
const exact = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && exact(a[k], b[k]));
};
const known = s => readableUploads(s) &&
  keysOnly(s, ['format','key','context','sourceRef','draft','localVersion','ackVersion','submissions','conflict','clientCycleId','uploadState','attempts','activeAuthority','authorityRecovery']) &&
  keysOnly(s.uploadState, ['format','revision','client_cycle_id','entries','submission_links']) &&
  s.uploadState.entries.every(e => keysOnly(e, ['selection_id','origin','binding','owner','version','selected','file','bytes_ref','bytes_state','choice','attempts','ready_descriptor','association','local_error','retained_ref','discarded','moved_to']) &&
    e.attempts.every(a => keysOnly(a, ['role','media_id','begin_operation_id','publish_operation_id','content_type','phase','begin_envelope','publish_envelope','begin_response','publish_response','last_attempt_error','ready_descriptor','retry_allowed'])));
const readyDescriptor = (d, e, a, instance) => d?.instance_id === instance && d.media_id === a.media_id && d.state === 'ready' && d.media_revision === 2 &&
  d.name === e.file.name && d.size_bytes === e.file.size && d.sha256 === e.file.sha256 && d.content_type === a.content_type && typeof d.inline === 'boolean';
const attachment = d => ({ id: d.media_id, name: d.name, content_type: d.content_type, size_bytes: d.size_bytes, sha256: d.sha256, inline: d.inline });

// This only produces candidates. The coordinator must recheck the captured
// stamp and writer lock in its final byte/metadata transaction.
export async function uploadProof(row, context, { api, read, authority }) {
  const s = row.snapshot;
  if (!known(s) || s.authorityRecovery || !samePin(s.activeAuthority, authority)) return null;
  const pin = s.activeAuthority, release = [], descriptors = new Map();
  const bootstrap = await read(options => api.bootstrap(options));
  const validBootstrap = b => b?.instance_id === context.instanceId && b.actor === context.actor && samePin(b.authority, pin);
  if (!validBootstrap(bootstrap)) return null;
  let state;
  const submissionCache = new Map();
  const canonical = async e => {
    if (e.owner.kind === 'cycle' && e.owner.id === s.clientCycleId) {
      state ??= await read(options => api.view('editor_state', { source_ref: s.sourceRef, topic_id: context.topicId, limit: 1 }, options));
      const d = state?.draft;
      return state?.instance_id === context.instanceId && exact(state.source_ref, s.sourceRef) && state.destination?.topic_id === context.topicId &&
        d?.id === s.draft.id && d.generation === s.draft.generation && d.revision === s.draft.revision &&
        s.localVersion === s.ackVersion && d.attachments.some(r => r.id === e.ready_descriptor.media_id) &&
        s.draft.attachments.some(r => r.id === e.ready_descriptor.media_id);
    }
    if (e.owner.kind !== 'submission') return false;
    const item = s.submissions.find(x => x.preparationConfirmed && !x.detached && (x.id === e.owner.id ||
      s.uploadState.submission_links[x.id]?.refs.some(ref => ref.selection_id === e.selection_id && ref.media_id === e.ready_descriptor.media_id)));
    if (!item?.preparationConfirmed || item.detached || !samePin(item.authority, pin)) return false;
    if (!submissionCache.has(item.id)) submissionCache.set(item.id, await read(options => api.view('submission', { submission_id: item.id }, options)));
    const detail = submissionCache.get(item.id);
    return detail?.instance_id === context.instanceId && detail.id === item.id && detail.prepare_operation_id === item.prepareOperationId &&
      detail.send_operation_id === item.sendOperationId && samePin(detail.authority, pin) && exact(detail.source_ref, item.sourceRef) &&
      detail.topic_id === item.topicId && detail.attachments.some(r => exact(r, attachment(e.ready_descriptor))) &&
      item.snapshot.attachments.some(r => r.id === e.ready_descriptor.media_id);
  };
  let settled = true;
  for (const e of s.uploadState.entries) {
    if (!samePin(e.binding.authority, pin) || e.binding.editor_key !== s.key || e.binding.actor_id !== context.actor || e.binding.instance_id !== context.instanceId) return null;
    if (!e.selected) {
      const neverDispatched = e.attempts.every(a => ['captured', 'prepared'].includes(a.phase) && !a.begin_response && !a.publish_response);
      const definitive = e.attempts.length > 0 && e.attempts.every(a => a.phase === 'ready' || a.begin_response?.recorded === true && a.begin_response.status === 'rejected' || a.publish_response?.recorded === true && a.publish_response.status === 'rejected');
      if (e.bytes_ref && (neverDispatched || definitive || e.discarded)) release.push(e.bytes_ref);
      if (!neverDispatched && !definitive) settled = false; // retain unknown history even after explicit byte discard
      continue;
    }
    if (e.local_error || !e.ready_descriptor || !await canonical(e)) { settled = false; continue; }
    if (e.origin === 'file') {
      const a = e.attempts[e.choice];
      if (!a || a.phase !== 'ready' || !readyDescriptor(e.ready_descriptor, e, a, context.instanceId) || !samePin(a.begin_envelope?.expected?.authority, pin) || !samePin(a.publish_envelope?.expected?.authority, pin)) return null;
      const begin = await read(options => api.view('operation', { operation_id: a.begin_operation_id }, options));
      const published = await read(options => api.view('operation', { operation_id: a.publish_operation_id }, options));
      if (begin?.recorded !== true || begin.status !== 'committed' || begin.kind !== 'media.begin' || begin.instance_id !== context.instanceId ||
          begin.operation_id !== a.begin_operation_id || begin.result?.media_id !== a.media_id || begin.result.media_revision !== 1 || begin.result.state !== 'pending' ||
          published?.recorded !== true || published.status !== 'committed' || published.kind !== 'media.publish' || published.instance_id !== context.instanceId ||
          published.operation_id !== a.publish_operation_id || !readyDescriptor(published.result, e, a, context.instanceId)) return null;
      if (e.bytes_ref) release.push(e.bytes_ref);
    }
    const media = await read(options => api.view('media', { media_id: e.ready_descriptor.media_id }, options));
    if (!exact(media, e.ready_descriptor)) return null;
    descriptors.set(media.media_id, attachment(media));
  }
  if (!validBootstrap(await read(options => api.bootstrap(options)))) return null;
  let projected = null;
  if (settled && s.uploadState.entries.every(e => !['capturing','memory-only','moved'].includes(e.bytes_state))) {
    projected = copy(row); projected.snapshot.format = 1;
    delete projected.snapshot.uploadState; delete projected.snapshot.clientCycleId;
    for (const item of projected.snapshot.submissions) {
      delete item.clientCycleId;
      item.snapshot.attachments = item.snapshot.attachments.map(r => descriptors.get(r.id) ?? r);
    }
  }
  return { release, projected };
}
