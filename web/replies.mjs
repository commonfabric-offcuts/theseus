// What a reply card says of the message it answers: whose it is and how it
// begins, on one quiet line. A message that answers none says nothing.
import { linkWords } from './links.mjs';
import { paintRemoval } from './message-removal.mjs';

const EXCERPT = 60;

function excerpt(item) {
  const first = String(item.reply_to_excerpt ?? '').split('\n')[0].trim();
  return first.length > EXCERPT ? first.slice(0, EXCERPT).trimEnd() + '…' : first;
}

export function replyLine(item) {
  if (!item?.reply_to) return '';
  const prefix = `Replying to ${item.reply_to_author ?? 'an earlier message'}`, words = excerpt(item);
  return words ? `${prefix}: ${words}` : prefix;
}

// Both initial card drawing and repaint use the same original-word boundary.
export function paintReplyLine(line, item) {
  line.replaceChildren();
  if (!item?.reply_to) return line;
  const doc = line.ownerDocument, words = excerpt(item);
  line.append(`Replying to ${item.reply_to_author ?? 'an earlier message'}`);
  if (words) {
    const original = doc.createElement('span');
    original.className = 'reply-parent-words';
    original.classList.toggle('retracted-words', item.reply_to_removal?.kind === 'retracted');
    linkWords(original, words, { partial: true });
    line.append(': ', original);
  }
  paintRemoval(line, { removal: item.reply_to_removal });
  return line;
}
