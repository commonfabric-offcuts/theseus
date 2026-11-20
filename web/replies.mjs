// What a reply card says of the message it answers: whose it is and how it
// begins, on one quiet line. A message that answers none says nothing.
import { ownWithdrawnQuestion } from './question-withdrawal.mjs';

const EXCERPT = 60;

export function replyLine(item, { parent = null, viewer = null } = {}) {
  if (!item?.reply_to) return '';
  const author = item.reply_to_author ?? 'an earlier message';
  const first = ownWithdrawnQuestion(parent, viewer) ? '' : String(item.reply_to_excerpt ?? '').split('\n')[0].trim();
  if (!first) return `Replying to ${author}`;
  const excerpt = first.length > EXCERPT ? first.slice(0, EXCERPT).trimEnd() + '…' : first;
  return `Replying to ${author}: ${excerpt}`;
}
