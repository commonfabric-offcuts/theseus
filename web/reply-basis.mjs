import { glyph } from './glyphs.mjs';

export const legacyReplyHeading = 'Reply without a quote:\n\n';

// Only a message's explicit reason, or the exact historical agent-reply prefix.
// Generic formatting (Notebook prose included) does not opt into this rule.
export function replyBasisPresentation(body, { replyBasis, agentReply = false } = {}) {
  body = String(body ?? '');
  const reason = typeof replyBasis?.reason === 'string' ? replyBasis.reason : null;
  const legacy = agentReply && !replyBasis?.excerpt && body.startsWith(legacyReplyHeading) &&
    body.slice(legacyReplyHeading.length).startsWith('> ');
  if (reason === null && !legacy) return null;
  const quoted = legacy ? body.slice(legacyReplyHeading.length).split('\n\n', 1)[0] : '';
  const words = reason ?? quoted.split('\n').map(line => line.startsWith('> ') ? line.slice(2) : line).join('\n');
  return { headingEnd: legacy ? legacyReplyHeading.length : 0, label: `Reply without a quote: ${words}` };
}

export function replyBasisMark(presentation, doc) {
  const mark = doc.createElement('span');
  mark.className = 'reply-basis-mark'; mark.title = presentation.label;
  mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', presentation.label);
  mark.append(glyph('reply', doc, 14));
  return mark;
}
