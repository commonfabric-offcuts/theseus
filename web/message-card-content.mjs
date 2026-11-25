// Shared visual words for canonical and locally submitted cards. This module
// never admits a record, creates commands or binds message interactions.
import { formatWords, adoptWordsRevision } from './message-format.mjs';

const painted = new WeakMap();
export function cardWordOptions(item, { revision, showChanges = true, displayRules = [] } = {}) {
  return { partial: item.preview === true, replyBasis: item.reply_basis ?? null,
    agentReply: item.author_kind === 'agent' && Boolean(item.reply_to), copyFences: 'feed',
    revision, struck: item.struck ?? null, showChanges, displayRules };
}
export function paintCardWords(card, item, options = {}) {
  const doc = card.ownerDocument;
  let words = card.querySelector(':scope > .message-preview');
  if (!words) { words = doc.createElement('span'); words.className = 'message-preview'; card.append(words); }
  const { revision, ...visualOptions } = options;
  const key = JSON.stringify([item.body, visualOptions]);
  if (painted.get(words) !== key) {
    formatWords(words, item.body, options); painted.set(words, key);
  } else adoptWordsRevision(words, revision);
  let cue = card.querySelector(':scope > .message-preview-cue');
  if (item.preview === true && !cue) {
    cue = doc.createElement('span'); cue.className = 'message-preview-cue'; cue.textContent = 'Excerpt · Open to read the rest'; words.after(cue);
  } else if (item.preview !== true) cue?.remove();
  return words;
}
