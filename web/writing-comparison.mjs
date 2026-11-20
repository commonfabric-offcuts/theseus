// Writing comparisons exclude save counters, slot identity and caret hints.
// Image identities come from a canonical reference or captured byte digest;
// a file name alone is never evidence that two images differ (or match).
export const equalWritingValue = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && equalWritingValue(a[k], b[k]));
};
export function writingValue(draft) {
  if (typeof draft?.body !== 'string') return null;
  return { body: draft.body, attachments: (draft.attachments ?? []).map(r => ({ id: r.id })),
    quotes: draft.quotes ?? [], addressees: draft.addressees ?? [], intent: draft.intent ?? null,
    whisper: draft.whisper ?? null, reply_to: draft.reply_to ?? null, exchange_id: draft.exchange_id ?? null,
    opening: draft.opening ?? null };
}
export function imageValues(draft, uploadState, cycle, digests = {}) {
  const refs = (draft?.attachments ?? []).map(r => 'media:' + r.id);
  for (const e of uploadState?.entries ?? []) {
    if (!e.selected || e.owner?.kind !== 'cycle' || e.owner.id !== cycle) continue;
    const id = e.association?.media_id ?? e.retained_ref?.id ?? e.ready_descriptor?.media_id;
    if (id) { if (!refs.includes('media:' + id)) refs.push('media:' + id); }
    else if (e.file?.sha256 || digests[e.selection_id]) refs.push('bytes:' + (e.file.sha256 ?? digests[e.selection_id]) + ':' + e.file.size + ':' + e.file.type);
    else return null;
  }
  return refs;
}
export function writingDiffers(draft, editor, snapshot = {}) {
  const a = writingValue(draft), b = writingValue(editor.draft);
  if (!a || !b) return false;
  const { attachments: _a, ...wordsA } = a, { attachments: _b, ...wordsB } = b;
  if (!equalWritingValue(wordsA, wordsB)) return true;
  const imagesA = imageValues(draft, snapshot.uploadState, snapshot.clientCycleId, snapshot.comparisonDigests);
  const imagesB = imageValues(editor.draft, editor.uploadState, editor.clientCycleId, editor.comparisonDigests);
  return imagesA !== null && imagesB !== null && !equalWritingValue(imagesA, imagesB);
}
export function keptCopy(editor, row) {
  const c = row.reviewChoice, a = editor?.reviewAuthority;
  if (!c || c.stamp !== row.stamp || !a?.authority_id || c.authority?.authority_id !== a.authority_id || c.authority?.authority_epoch !== a.authority_epoch) return false;
  if (c.writerId === editor.reviewWriterId) return c.cycle === editor.clientCycleId;
  return c.draftId === editor.draft.id && c.generation === editor.draft.generation &&
    equalWritingValue(c.writing, writingValue(editor.draft)) &&
    equalWritingValue(c.images, imageValues(editor.draft, editor.uploadState, editor.clientCycleId, editor.comparisonDigests));
}
