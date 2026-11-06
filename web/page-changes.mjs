// What changed in a Notebook page since the revision the reader last read,
// shown as prose with what was added marked and what was removed struck
// through, never as a patch. Unchanged stretches between changes are cut to
// a little context on each side, so the changes read in place.
//
// The comparison works on lines first and then on the words of the lines
// that changed, each a shortest edit script (Myers). A script longer than
// LIMIT edits is not worked out word by word: that stretch shows as removed
// and added whole, and when the lines themselves differ that much the page
// says it was mostly rewritten. The bound keeps the work proportional to the
// page and the size of the change.

export const LIMIT = 2000;
export const CONTEXT = 120;

const words = text => text.match(/\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]/gu) ?? [];
const lines = text => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

// The shortest edit script from a to b as [kind, item] pairs, kind 'same',
// 'del' or 'ins'; null when it needs more than limit edits.
export function script(a, b, limit = LIMIT) {
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const head = a.slice(0, start).map(item => ['same', item]), tail = a.slice(endA).map(item => ['same', item]);
  const x = a.slice(start, endA), y = b.slice(start, endB), n = x.length, m = y.length, max = n + m;
  if (!n || !m) return [...head, ...x.map(item => ['del', item]), ...y.map(item => ['ins', item]), ...tail];
  // trace[d] keeps the furthest reach on diagonals -d-1..d+1 as round d
  // began, all the walk back needs, so memory grows with the edits alone.
  const offset = max + 1, trace = [], v = new Int32Array(2 * max + 3);
  let found = -1;
  for (let d = 0; d <= Math.min(max, limit) && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) { i++; j++; }
      v[offset + k] = i;
      if (i >= n && j >= m) { found = d; break; }
    }
  }
  if (found < 0) return null;
  const edits = [];
  let i = n, j = m;
  for (let d = found; d > 0; d--) {
    const reach = diagonal => trace[d][diagonal + d + 1], k = i - j;
    const down = k === -d || (k !== d && reach(k - 1) < reach(k + 1));
    const prevK = down ? k + 1 : k - 1, prevI = reach(prevK), prevJ = prevI - prevK;
    while (i > prevI + (down ? 0 : 1) && j > prevJ + (down ? 1 : 0)) edits.push(['same', x[--i]]), j--;
    if (down) edits.push(['ins', y[--j]]); else edits.push(['del', x[--i]]);
  }
  while (i > 0 && j > 0) edits.push(['same', x[--i]]), j--;
  return [...head, ...edits.reverse(), ...tail];
}

// The changes from before to after as runs of [kind, text], neighbouring
// runs of one kind joined; null when the lines differ by more than LIMIT.
export function changes(before, after, limit = LIMIT) {
  const byLine = script(lines(before), lines(after), limit);
  if (!byLine) return null;
  const runs = [];
  const add = (kind, text) => { if (!text) return; const last = runs.at(-1); if (last?.[0] === kind) last[1] += text; else runs.push([kind, text]); };
  for (let at = 0; at < byLine.length;) {
    if (byLine[at][0] === 'same') { add('same', byLine[at++][1]); continue; }
    let removed = '', added = '';
    for (; at < byLine.length && byLine[at][0] !== 'same'; at++) byLine[at][0] === 'del' ? removed += byLine[at][1] : added += byLine[at][1];
    const byWord = script(words(removed), words(added), limit);
    if (byWord) for (const [kind, text] of byWord) add(kind, text);
    else { add('del', removed); add('ins', added); }
  }
  return runs;
}

// An unchanged stretch keeps CONTEXT characters next to each change, cut at
// a space where there is one: its start after a change (follows), its end
// before one (leads). What it drops is shown as a gap.
function trimmed(text, follows, leads) {
  if (text.length <= (follows ? CONTEXT : 0) + (leads ? CONTEXT : 0) + 8) return [text];
  const start = () => { const at = text.lastIndexOf(' ', CONTEXT); return text.slice(0, at <= 0 ? CONTEXT : at); };
  const end = () => { const at = text.indexOf(' ', text.length - CONTEXT); return text.slice(at < 0 ? text.length - CONTEXT : at + 1); };
  return [follows ? start() : '', null, leads ? end() : ''];
}

const node = (doc, tag, text, className) => {
  const element = doc.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};

// Draws into host what changed from before to after; returns how many runs
// were added and removed.
export function paintChanges(host, before, after, doc = globalThis.document) {
  const runs = changes(before, after);
  host.replaceChildren();
  if (!runs) {
    host.append(node(doc, 'p', 'Most of this page was rewritten since then. The whole page is below.', 'changes-summary'));
    return { added: null, removed: null };
  }
  const counted = { added: 0, removed: 0 };
  const shown = node(doc, 'div', undefined, 'changes-text');
  runs.forEach(([kind, text], index) => {
    if (kind === 'same') {
      for (const part of trimmed(text, index > 0, index < runs.length - 1)) {
        if (part === null) shown.append(node(doc, 'span', ' … ', 'changes-gap'));
        else if (part) shown.append(doc.createTextNode(part));
      }
      return;
    }
    const mark = node(doc, kind, undefined, kind === 'ins' ? 'changes-added' : 'changes-removed');
    mark.append(node(doc, 'span', kind === 'ins' ? '[added: ' : '[removed: ', 'sr-only'), doc.createTextNode(text), node(doc, 'span', ']', 'sr-only'));
    shown.append(mark);
    counted[kind === 'ins' ? 'added' : 'removed']++;
  });
  const said = [counted.added && `${counted.added} addition${counted.added === 1 ? '' : 's'}`,
    counted.removed && `${counted.removed} removal${counted.removed === 1 ? '' : 's'}`].filter(Boolean);
  host.append(node(doc, 'p', said.length ? said.join(', ') : 'No change in the words; only its title or attachments changed.', 'changes-summary'), shown);
  return counted;
}
