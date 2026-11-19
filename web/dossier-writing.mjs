// A new dossier is a root message in the existing topic composer (861).
// Only writing crosses this boundary; both editor identities stay where they are.
import { WRITING_FIELDS, noWriting } from './editor.mjs';
import { sending } from './whisper-choice.mjs';

const NONE = noWriting();
export const dossierImage = editor => Boolean(editor.draft.attachments?.length || editor.imageBusy ||
  editor.imageReservation || editor.adopting || editor.uploadOpaque ||
  editor.uploadState && (!Array.isArray(editor.uploadState.entries) ||
    editor.uploadState.entries.some(entry => entry.selected && entry.owner?.kind !== 'submission')));
export const dossierOccupied = editor => dossierImage(editor) || WRITING_FIELDS.some(field =>
  field !== 'caret' && JSON.stringify(editor.draft[field] ?? NONE[field]) !== JSON.stringify(NONE[field]));

export function dossierWriting(source, left, { link, names, kindOf, actor, moveReply }) {
  const draft = moveReply ? left.draft : NONE;
  const addressees = moveReply ? [...new Set(names)] : [];
  let choice = sending(draft, addressees, kindOf, { answeringWhisper: Boolean(source.whisper) });
  if (source.whisper) {
    const other = source.author === actor ? source.addressees?.find(name => name !== actor) : source.author;
    if (!other || kindOf(other) !== 'agent' || moveReply && dossierOccupied(left) &&
        (addressees.length !== 1 || addressees[0] !== other || !choice.whisper)) {
      throw Error('Keep this quote private: choose Whisper to the same agent before starting a new dossier.');
    }
    addressees.splice(0, addressees.length, other);
    choice = { whisper: true, intent: null };
  }
  const quote = (source.body ?? '').split('\n').map(line => '> ' + line).join('\n');
  const body = quote + '\n\n[Source message](' + link + ')' + (draft.body ? '\n\n' + draft.body : '') + '\n';
  return { ...noWriting(), body, addressees, ...choice, caret: { start: body.length, end: body.length } };
}
