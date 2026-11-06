import { imageBarrier, recoveryReadOnly } from './upload-state.mjs';

// Shared descriptions and admission decisions only. Each surface keeps its
// nodes, focus, events and captured presentation; sessions still own the work.
export const recipientChoices = names => names.map(name => ({ name, removeLabel: `Remove ${name}` }));

// active: every act on this writing is admitted. writable: typing is, which
// can hold while the acts wait (the Reader during a step).
export function writingState(editor, { active = true, writable = active, note = false, status } = {}) {
  const barrier = imageBarrier(editor);
  const readOnly = Boolean(!writable || editor.adopting || recoveryReadOnly(editor) || editor.conflict?.error?.code === 'INVALID_TOPIC_COMPOSITION');
  const preparing = editor.submissions.some(item => item.status === 'preparing' && !item.detached);
  return {
    readOnly,
    message: barrier || (status ? status(editor) : editor.journalError ? 'Recovery copy unavailable — keep this page open'
      : editor.conflict ? 'Not saved — another version needs review' : editor.dirty ? 'Not yet saved to AIM' : 'Saved to AIM'),
    sendDisabled: Boolean(!active || barrier || editor.adopting || editor.unavailable || editor.authorityRecovery || editor.conflict ||
      (!note && (preparing || !editor.context.topicId || (!editor.draft.body.trim() && !editor.draft.attachments.length)))),
    addDisabled: Boolean(!active || readOnly || editor.recoveryDiscovery || editor.unavailable || editor.authorityRecovery ||
      editor.uploadState?.entries.some(e => e.selected && e.owner.id === editor.clientCycleId && e.origin === 'retained-ref' && !e.ready_descriptor)),
  };
}

export function pasteImageError(editor, mode, readOnly) {
  if (mode === 'note') return 'Images cannot be pasted into a private note. Switch to Reply to attach an image.';
  if (readOnly) return 'This writing is read-only. Review the saved version before pasting an image.';
  if (!editor || editor.authorityRecovery) return 'Review the runtime change before pasting an image.';
  if (editor.unavailable) return 'The source or destination is unavailable. Your writing is kept; the image was not added.';
  return null;
}

export function namedPastedImage(file) {
  if (file.name) return file;
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[file.type] ?? 'bin';
  return new File([file], `pasted.${extension}`, { type: file.type, lastModified: file.lastModified });
}

export function imageChoices(uploads, active = true) {
  return uploads.current().map(e => {
    const a = e.attempts[e.choice], running = uploads.running.has(e.selection_id), state = uploads.status(e.selection_id);
    const actions = [];
    if (!running) {
      if (e.bytes_state === 'memory-only') actions.push({ label: 'Retry device save', method: 'retry' });
      else if (e.origin === 'retained-ref' || a && !['captured', 'prepared'].includes(a.phase)) actions.push({ label: 'Check confirmation', method: 'check' });
      if (a && (a.retry_allowed || ['captured', 'prepared', 'begun'].includes(a.phase))) actions.push({ label: ['begun', 'captured', 'prepared'].includes(a.phase) ? 'Continue upload' : 'Retry upload', method: 'retry' });
      if ((!a || a.publish_response?.error?.code === 'MEDIA_INVALID') && e.bytes_state === 'durable' && !e.local_error) actions.push({ label: 'Attach as download', method: 'asDownload' });
    }
    actions.push({ label: 'Remove', method: 'remove' });
    return { id: e.selection_id, text: `${e.file?.name ?? e.ready_descriptor?.name ?? 'Attachment'} · ${state}`,
      view: JSON.stringify([state, e.version, a?.phase, a?.retry_allowed, running, active]), actions };
  });
}
