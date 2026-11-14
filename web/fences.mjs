// Shared fence boundaries for rendering and Notebook card/stack splitting.
// Inputs are lines without their CRLF ending; offsets refer to those lines.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

// Find complete marker runs without counting the shorter runs inside a longer fence.
function firstRun(text, fence, from) {
  let at = text.indexOf(fence.marker, from);
  while (at !== -1) {
    let end = at + 1;
    while (text[end] === fence.marker) end++;
    if (end - at >= fence.length) return { at, end };
    at = text.indexOf(fence.marker, end);
  }
  return null;
}

const endsLine = (text, run) => run && /^[ \t]*$/.test(text.slice(run.end));

export function fenceEnd(text, fence) {
  // A pasted inline span owns its closing run. A subsequent unmatched
  // terminal run still closes the outer block ("see ```x``` done```").
  let inlineLength = 0;
  for (let run = firstRun(text, fence, 0); run; run = firstRun(text, fence, run.end)) {
    const length = run.end - run.at;
    if (endsLine(text, run)) return inlineLength === length ? -1 : run.at;
    if (!inlineLength) inlineLength = length;
    else if (inlineLength === length) inlineLength = 0;
  }
  return -1;
}

// At block-line start, a same-line pair is literal fenced text. Otherwise the
// opener's remainder is conventional info, except an address is always payload.
export function fenceOpen(text, next = '') {
  const match = FENCE_OPEN.exec(text);
  if (!match) return null;
  const info = match[2].trim(), after = match[0].length - match[2].length;
  const fence = { marker: match[1][0], length: match[1].length, after, info };
  const run = firstRun(text, fence, after);
  if (run) {
    // A compact pair followed by prose stays inline, even if more pairs follow.
    if (endsLine(text, run)) return { ...fence, end: run.at, payloadAt: after, lang: '' };
    // Backtick info cannot contain backticks. Tilde info can contain tildes.
    if (fence.marker === '`') return null;
  }
  const payloadAt = /https?:\/\//i.test(info) ? after : null;
  const nextEnd = info.includes('`') ? fenceEnd(next, fence) : -1;
  const immediateClose = nextEnd >= 0 && !next.slice(0, nextEnd).trim();
  if (match[1][0] === '`' && info.includes('`') && !immediateClose && payloadAt === null) return null;
  return { ...fence, end: -1, payloadAt, lang: payloadAt !== null ? '' : /^[\w.+-]{0,40}/.exec(info.split(/\s/, 1)[0])[0] };
}
