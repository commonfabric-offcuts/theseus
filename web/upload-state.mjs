import { keptCopy } from './writing-comparison.mjs';
// Client ownership is independent of the server's reusable draft slot.
export const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const pair = a => ({ authority_id: a?.authority_id, authority_epoch: a?.authority_epoch });
export const samePin = (a, b) => Boolean(a?.authority_id && a?.authority_epoch && a.authority_id === b?.authority_id && a.authority_epoch === b?.authority_epoch);
export const ownsBytes = snapshot => snapshot?.uploadState?.entries?.some(e => e.bytes_ref) === true;
export const uploadWork = editor => Boolean(editor.uploadOpaque || editor.uploadState && !editor.passiveImages || editor.imageReservation || editor.imageBusy);
// Alternative copies stay advisory; only an active adoption replaces this writing.
export const recoveryReadOnly = editor => Boolean(editor?.adopting);
export const copyChoiceKey = (editor, row) => JSON.stringify([editor.key, editor.clientCycleId, row.id, row.stamp]);
export const refusedAtDraft = (item, draft) => !item.detached && !item.correctedBy && item.status === 'refused' &&
  item.receipt?.kind === 'submission.prepare' && (draft === undefined || Boolean(draft &&
    item.snapshot.id === draft.id && item.snapshot.generation === draft.generation && item.snapshot.revision === draft.revision));
export const refusedCopyAtDraft = (row, draft) => row.availability === 'available' && readableUploads(row.snapshot) &&
  row.snapshot.submissions.some(item => refusedAtDraft(item, draft));
const known = (object, keys) => object && Object.keys(object).every(k => keys.includes(k));
export function copyNeedsImageReview(row, editor) {
  if (row.availability !== 'available') return Boolean(row.uploadPresent || row.availability === 'unreadable');
  if (row.snapshot?.format !== 2) return false;
  if (!readableUploads(row.snapshot)) return true;
  return row.snapshot.uploadState.entries.some(e => e.selected && e.owner.kind === 'cycle') ||
    refusedCopyAtDraft(row, editor?.recoveryServerDraft) && !keptCopy(editor, row) && !editor?.refusedCopyChoices?.has(copyChoiceKey(editor, row));
}
export function currentImages(editor) {
  return (Array.isArray(editor.uploadState?.entries) ? editor.uploadState.entries : []).filter(e => e?.owner?.kind === 'cycle' && e.owner.id === editor.clientCycleId && e.selected);
}
export function readableUploads(snapshot) {
  try {
  const s = snapshot?.uploadState;
  return snapshot?.format === 2 && s?.format === 2 && typeof s.client_cycle_id === 'string' && s.client_cycle_id === snapshot.clientCycleId &&
    known(s, ['format','revision','client_cycle_id','entries','submission_links']) &&
    Number.isInteger(s.revision) && Array.isArray(s.entries) && s.submission_links && typeof s.submission_links === 'object' &&
    s.entries.every(e => typeof e.selection_id === 'string' && ['file', 'retained-ref'].includes(e.origin) &&
      known(e, ['selection_id','origin','binding','owner','version','selected','file','bytes_ref','bytes_state','choice','attempts','ready_descriptor','association','local_error','retained_ref','discarded','moved_to']) &&
      known(e.binding, ['instance_id','actor_id','editor_key','source_ref','topic_id','captured_cycle_id','authority','draft_at_selection']) &&
      known(e.owner, ['kind','id']) && (!e.file || known(e.file, ['name','size','type','last_modified','sha256'])) &&
      ['cycle', 'submission'].includes(e.owner?.kind) && typeof e.owner.id === 'string' && typeof e.selected === 'boolean' &&
      ['memory-only', 'capturing', 'durable', 'released', 'moved'].includes(e.bytes_state) && Array.isArray(e.attempts) &&
      e.attempts.every(a => ['image', 'explicit-download'].includes(a.role) &&
        known(a, ['role','media_id','begin_operation_id','publish_operation_id','content_type','phase','begin_envelope','publish_envelope','begin_response','publish_response','last_attempt_error','ready_descriptor','retry_allowed']) &&
        ['captured', 'prepared', 'begin-unknown', 'begun', 'publish-unknown', 'ready', 'refused', 'authority-blocked'].includes(a.phase)));
  } catch { return false; }
}
export function imageBarrier(editor) {
  if (editor.context.kind === 'note') return null;
  if (editor.imageStorageError) return 'The image change is not saved on this device. Retry before sending.';
  if (editor.adopting || editor.imageReservation || editor.imageBusy) return 'Finish or cancel the image action before sending.';
  if (editor.uploadOpaque) return 'The saved image state needs review.';
  if (!editor.uploadState) return editor.draft.attachments?.length ? 'The attachment list needs review before sending.' : null;
  if (!readableUploads({ format: 2, uploadState: editor.uploadState, clientCycleId: editor.clientCycleId })) return 'The saved image state needs review.';
  const selected = currentImages(editor), refs = editor.draft.attachments ?? [];
  for (const e of selected) {
    if (!e.ready_descriptor || e.ready_descriptor.state !== 'ready' || e.ready_descriptor.media_revision !== 2 ||
        e.association?.cycle_id !== editor.clientCycleId || e.association.media_id !== e.ready_descriptor.media_id || e.local_error) {
      return `Finish or remove the image ${e.file?.name ?? e.ready_descriptor?.name ?? 'attachment'} before sending.`;
    }
  }
  const ids = refs.map(r => r.id);
  if (new Set(ids).size !== ids.length || selected.length !== ids.length ||
      ids.some(id => selected.filter(e => e.association?.media_id === id).length !== 1)) return 'The attachment list needs review before sending.';
  return null;
}
export function freezeImages(editor, submission) {
  const cycle = editor.clientCycleId;
  submission.clientCycleId = cycle;
  if (editor.uploadState) {
    const selected = currentImages(editor);
    const links = submission.snapshot.attachments.map(ref => ({ selection_id: selected.find(e => e.association.media_id === ref.id).selection_id, media_id: ref.id }));
    editor.uploadState.submission_links[submission.id] = { cycle_id: cycle, refs: links };
    for (const e of selected) { e.owner = { kind: 'submission', id: submission.id }; e.version++; }
    editor.uploadState.revision++;
  }
  editor.clientCycleId = crypto.randomUUID();
  if (editor.uploadState) editor.uploadState.client_cycle_id = editor.clientCycleId;
}
