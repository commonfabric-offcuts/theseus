import { refusedAtDraft, copyChoiceKey } from './upload-state.mjs';
import { writingDiffers, keptCopy } from './writing-comparison.mjs';

export function reviewDifferences(editor, rows = []) {
  const found = [], remote = editor.authorityRecovery?.authority ? editor.authorityRecovery.remote : editor.conflict?.remote;
  if (remote !== undefined && (remote === null ? Boolean(editor.draft.body.trim() || editor.draft.attachments?.length) : writingDiffers(remote, editor)))
    found.push({ label: 'The saved private version differs from this field', draft: remote, remote: true });
  // A pending prepare owns the last confirmed slot revision while the local
  // successor has revision null. Its frozen snapshot survives reload and can
  // absorb a late matching save without inventing a new history counter.
  const revision = Number.isInteger(editor.draft.revision) ? editor.draft.revision :
    editor.submissions?.find(item => item.status === 'preparing' && !item.detached && !item.correctedBy && item.snapshot?.id === editor.draft.id)?.snapshot?.revision;
  for (const row of rows) {
    if (row.availability !== 'available' || !row.snapshot) continue;
    const s = row.snapshot, chosen = keptCopy(editor, row) || editor.refusedCopyChoices?.has(copyChoiceKey(editor, row));
    if (!chosen) for (const item of s.submissions ?? []) {
      if (refusedAtDraft(item, editor.recoveryServerDraft) && writingDiffers(item.snapshot, editor))
        found.push({ label: 'An earlier reply was not prepared and differs from this field', draft: item.snapshot, candidate: row, refused: true });
    }
    // An acknowledged older save in this exact slot is the field's history.
    // Unacknowledged or refused work never takes this shortcut.
    const olderSave = s.localVersion === s.ackVersion && !s.conflict && !s.authorityRecovery &&
      !(s.submissions ?? []).some(item => !item.detached && !item.correctedBy && item.status !== 'confirmed') &&
      s.draft?.id === editor.draft.id && Number.isInteger(revision) &&
      Number.isInteger(s.draft?.revision) && s.draft.revision <= revision;
    const selectedImages = s.uploadState?.entries?.some(e => e.selected && e.owner.kind === 'cycle');
    if ((!olderSave || selectedImages) && (!chosen || selectedImages) && writingDiffers(s.draft, editor, { ...s, comparisonDigests: row.comparisonDigests })) {
      const time = Number.isFinite(row.saved_ms) ? ' saved at ' + new Date(row.saved_ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      found.push({ label: `A copy${time} differs from this field`, draft: s.draft, candidate: row });
    }
  }
  return found;
}
