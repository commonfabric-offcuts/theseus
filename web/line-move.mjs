// Option-Up and Option-Down while writing (item 78), as the AIM editor did:
// the list item the cursor is on, with the lines indented under it, moves past
// the item before or after it at the same depth in the same list; a plain line
// moves past the plain line next to it in its paragraph; and a paragraph that
// is wholly the cursor's (a line of its own, or every line of it selected)
// moves past the paragraph before or after it, the blank lines between staying
// where they are. A selection moves every block it touches, when they are of
// one kind and stand together. No line's words change, only where they stand,
// and only a move that moving back undoes exactly is made: anything else is
// no move, and the key does what it normally does.
//
// lineMove(value, start, end, dir) gives the edit, {from, to, text, start,
// end} (replace value[from, to) with text, then select start..end), or null.
// dir is -1 for up and 1 for down.

const BULLET = /^[ \t]*(?:[-*+•]|\((?:\d{1,2}|[a-z])\)|(?:\d{1,2}|[a-z])\)|\d{1,2}\.)[ \t]/;

function plan(value, start, end, dir) {
  const lines = value.split('\n'), n = lines.length, at = [];
  for (let i = 0, offset = 0; i < n; offset += lines[i].length + 1, i++) at.push(offset);
  const lineOf = index => { let lo = 0, hi = n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (at[mid] <= index) lo = mid; else hi = mid - 1; } return lo; };
  const blank = lines.map(line => !/\S/.test(line));
  // Depth in columns, a tab to the next eighth, as a textarea draws it.
  const depth = lines.map(line => { let c = 0; for (const ch of /^[ \t]*/.exec(line)[0]) c = ch === '\t' ? c + 8 - c % 8 : c + 1; return c; });
  const bullet = lines.map(line => BULLET.test(line));
  // The innermost item each line stands in (-1: none), each item's last line
  // and the item it stands in. An item holds the lines indented deeper than
  // it, never past a blank line.
  const inItem = new Array(n).fill(-1), last = new Array(n).fill(-1), up = new Array(n).fill(-1), stack = [];
  let previous = -1;
  for (let k = 0; k <= n; k++) {
    if (k === n || blank[k]) { while (stack.length) last[stack.pop()] = previous; continue; }
    while (stack.length && depth[k] <= depth[stack.at(-1)]) last[stack.pop()] = previous;
    if (bullet[k]) { up[k] = stack.at(-1) ?? -1; stack.push(k); }
    inItem[k] = stack.at(-1) ?? -1;
    previous = k;
  }
  // A block: its first and last lines, the item it stands in, and its kind.
  const blockAt = k => inItem[k] >= 0 ? { first: inItem[k], last: last[inItem[k]], up: up[inItem[k]], kind: 'item' + depth[inItem[k]] }
    : { first: k, last: k, up: -1, kind: 'line' };
  const lift = block => blockAt(block.up);
  const nest = block => { let d = 0; for (let b = block.up; b >= 0; b = up[b]) d++; return d; };
  const neighbour = (block, step) => {
    const k = step > 0 ? block.last + 1 : block.first - 1;
    if (k < 0 || k >= n || blank[k]) return null;
    let other = blockAt(k);
    while (other.up !== block.up && other.up >= 0 && nest(other) > nest(block)) other = lift(other);
    return other.up === block.up && other.kind === block.kind && (step > 0 ? other.first === k : other.last === k) ? other : null;
  };
  let k1 = lineOf(start), k2 = lineOf(end > start && at[lineOf(end)] === end ? end - 1 : end);
  while (k1 <= k2 && blank[k1]) k1++;
  while (k2 >= k1 && blank[k2]) k2--;
  if (k1 > k2) return null;
  let a = blockAt(k1), b = blockAt(k2);
  while (a.up !== b.up) { const na = nest(a), nb = nest(b); if (na >= nb) a = lift(a); if (nb >= na) b = lift(b); }
  for (let block = a; block.first !== b.first;) {
    block = neighbour(block, 1);
    if (!block || block.first > b.first) return null;
  }
  let first = a.first, lastLine = b.last, other = dir > 0 ? neighbour(b, 1) : neighbour(a, -1);
  if (!other && a.kind === 'line') {
    // Plain lines with nothing next to them in their paragraph: when they are
    // whole paragraphs, they move past the paragraph beyond the blank lines.
    const whole = (first === 0 || blank[first - 1]) && (lastLine === n - 1 || blank[lastLine + 1]);
    let k = dir > 0 ? lastLine + 1 : first - 1;
    while (k >= 0 && k < n && blank[k]) k += dir;
    if (!whole || k < 0 || k >= n || k === (dir > 0 ? lastLine + 1 : first - 1)) return null;
    let from = k, to = k;
    while (from > 0 && !blank[from - 1]) from--;
    while (to < n - 1 && !blank[to + 1]) to++;
    other = { first: from, last: to };
  }
  if (!other) return null;
  const endOf = k => at[k] + lines[k].length;
  const [p0, p1, q0, q1] = dir > 0 ? [first, lastLine, other.first, other.last] : [other.first, other.last, first, lastLine];
  const upper = value.slice(at[p0], endOf(p1)), gap = value.slice(endOf(p1), at[q0]), lower = value.slice(at[q0], endOf(q1));
  const shift = dir > 0 ? lower.length + gap.length : -(upper.length + gap.length);
  // The selection, held to the blocks it moves.
  const lo = at[first], hi = endOf(lastLine), cs = Math.min(Math.max(start, lo), hi), ce = Math.min(Math.max(end, lo), hi);
  return { from: at[p0], to: endOf(q1), text: lower + gap + upper, start: cs + shift, end: ce + shift, cs, ce };
}

export function lineMove(value, start, end, dir) {
  if (typeof value !== 'string' || !Number.isInteger(start) || !Number.isInteger(end) || start > end || ![-1, 1].includes(dir)) {
    throw TypeError('lineMove needs the text, an ordered selection and a direction of -1 or 1.');
  }
  const move = plan(value, start, end, dir);
  if (!move) return null;
  const moved = value.slice(0, move.from) + move.text + value.slice(move.to), back = plan(moved, move.start, move.end, -dir);
  if (!back || moved.slice(0, back.from) + back.text + moved.slice(back.to) !== value || back.start !== move.cs || back.end !== move.ce) return null;
  return { from: move.from, to: move.to, text: move.text, start: move.start, end: move.end };
}
