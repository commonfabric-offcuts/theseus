// Shared fence boundaries for rendering and Notebook card/stack splitting.
// Inputs are lines without their CRLF ending; offsets refer to those lines.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

// A matching run at line end closes a fence, either on its own or immediately
// after its payload. Scan backwards once, so even long unmatched runs are linear.
export function fenceEnd(text, fence, after = 0) {
  let end = text.length;
  while (end > after && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--;
  let at = end;
  while (at > after && text[at - 1] === fence.marker) at--;
  return end - at >= fence.length ? at : -1;
}

// At block-line start, a same-line pair is literal fenced text. Otherwise the
// opener's remainder is conventional info, except an address is always payload.
export function fenceOpen(text, next = '') {
  const match = FENCE_OPEN.exec(text);
  if (!match) return null;
  const info = match[2].trim(), after = match[0].length - match[2].length;
  const fence = { marker: match[1][0], length: match[1].length, after, info };
  const end = fenceEnd(text, fence, after);
  if (end >= 0) return { ...fence, end, payloadAt: after, lang: '' };
  const payloadAt = /https?:\/\//i.test(info) ? after : null;
  const nextEnd = info.includes('`') ? fenceEnd(next, fence) : -1;
  const immediateClose = nextEnd >= 0 && !next.slice(0, nextEnd).trim();
  if (match[1][0] === '`' && info.includes('`') && !immediateClose && payloadAt === null) return null;
  return { ...fence, end: -1, payloadAt, lang: payloadAt !== null ? '' : /^[\w.+-]{0,40}/.exec(info.split(/\s/, 1)[0])[0] };
}
