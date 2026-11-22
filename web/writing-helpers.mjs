import { imageBarrier } from './upload-state.mjs';
import { holdsWriting, written } from './editor.mjs';
import { timeNode } from './times.mjs';

// Shared descriptions and admission decisions only. Each surface keeps its
// nodes, focus, events and captured presentation; sessions still own the work.
export const recipientChoices = names => names.map(name => ({ name, removeLabel: `Remove ${name}` }));

// active: every act on this writing is admitted. writable: typing is, which
// can hold while the acts wait (the Reader during a step). sign: the saving
// sign's state for the save status; other words in its place carry none.
export function writingState(editor, { active = true, writable = active, note = false, status, sign } = {}) {
  const barrier = note ? null : imageBarrier(editor);
  const readOnly = Boolean(!writable || editor.adopting || editor.conflict?.error?.code === 'INVALID_TOPIC_COMPOSITION');
  const preparing = editor.submissions.some(item => item.status === 'preparing' && !item.detached);
  return {
    readOnly,
    message: barrier || (status ? status(editor) : editor.journalError ? 'Recovery copy unavailable — keep this page open'
      : editor.conflict ? 'Not saved — another version needs review' : editor.dirty ? 'Not yet saved to AIM' : 'Saved to AIM'),
    sign: barrier || !status ? '' : sign?.(editor) ?? '',
    sendDisabled: Boolean(!active || barrier || editor.adopting || editor.unavailable || editor.authorityRecovery || editor.conflict ||
      (!note && (preparing || !editor.context.topicId || !written(editor.draft)))),
    addDisabled: Boolean(!active || readOnly || editor.uploadOpaque || editor.unavailable || editor.authorityRecovery ||
      editor.uploadState?.entries.some(e => e.selected && e.owner.id === editor.clientCycleId && e.origin === 'retained-ref' && !e.ready_descriptor)),
  };
}

// When the writing was last saved, beside the saving sign's words: "Saved to
// Theseus · 4:40 AM" (item 61). A shown time (times.mjs), so the words follow
// the day at midnight; none until this page has seen a save.
export function paintSaveTime(status, ms) {
  const host = status.parentElement, doc = status.ownerDocument, old = host.querySelector(':scope > time.save-time');
  if (!Number.isSafeInteger(ms)) { old?.remove(); return; }
  if (old && old.dataset.ms === String(ms)) return;
  const shown = timeNode(ms, doc); shown.className = 'save-time';
  if (old) old.replaceWith(shown); else host.append(shown);
}

// The line above a Notebook page when the person's writing is about another
// revision of it. Writing with nothing in it is about no revision.
export function sourceChange(editor, shown) {
  const pinned = editor?.sourceRef;
  if (pinned?.kind !== 'memory' || shown?.kind !== 'memory' || pinned.revision === shown.revision || !holdsWriting(editor.draft)) return '';
  const which = `Your writing refers to revision ${pinned.revision}; you are reading revision ${shown.revision}.`;
  return shown.revision > pinned.revision ? `This page has changed since you started writing. ${which}`
    : `You are reading an earlier revision than your writing. ${which}`;
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
