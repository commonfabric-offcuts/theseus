// What changed in a Notebook page since the revision the reader last read:
// prose with additions marked and removals struck through, never a patch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { script, changes, paintChanges, CONTEXT } from '../web/page-changes.mjs';

function doc() {
  class Node {
    constructor(tag, text = '') { this.tagName = tag; this.children = []; this.text = text; this.className = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    get textContent() { return this.tagName === '#text' ? this.text : this.children.map(child => child.textContent).join('') || this.text; }
    set textContent(value) { this.text = value; this.children = []; }
  }
  return { createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text), Node };
}
// What a sighted reader sees: removed words struck, added words marked, as [kind, text].
const seen = host => host.children.at(-1).children.map(child => child.tagName === '#text' ? ['same', child.text]
  : child.className === 'changes-gap' ? ['gap'] : [child.tagName, child.children[1].text]);

test('an edit script is minimal and rebuilds both sides', () => {
  const lcs = (a, b) => { const t = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) t[i][j] = a[i - 1] === b[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
    return t[a.length][b.length]; };
  let seed = 7; const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 2000; n++) {
    const a = [...Array(Math.floor(next() * 14))].map(() => 'abc'[Math.floor(next() * 3)]);
    const b = [...Array(Math.floor(next() * 14))].map(() => 'abc'[Math.floor(next() * 3)]);
    const edits = script(a, b);
    assert.deepEqual(edits.filter(e => e[0] !== 'ins').map(e => e[1]), a);
    assert.deepEqual(edits.filter(e => e[0] !== 'del').map(e => e[1]), b);
    assert.equal(edits.filter(e => e[0] === 'same').length, lcs(a, b), `${a.join('')} → ${b.join('')}`);
  }
  assert.equal(script([...'abcdef'], [...'uvwxyz'], 5), null, 'more edits than the limit are not worked out');
  assert.deepEqual(script([...'abcc'], [...'a'], 2), [['same', 'a'], ['del', 'b'], ['del', 'c'], ['del', 'c']],
    'only removing, past the limit, is linear work and is written out');
  assert.deepEqual(script([...'a'], [...'abcc'], 2), [['same', 'a'], ['ins', 'b'], ['ins', 'c'], ['ins', 'c']], 'and so is only adding');
});

test('the changes are words in place: a changed word is struck and its replacement marked, the rest left as it was', () => {
  assert.deepEqual(changes('The quick brown fox.\nSecond line stays.\n', 'The quick red fox.\nSecond line stays.\nA new line.\n'),
    [['same', 'The quick '], ['del', 'brown'], ['ins', 'red'], ['same', ' fox.\nSecond line stays.\n'], ['ins', 'A new line.\n']]);
  const d = doc(), host = d.createElement('div');
  assert.deepEqual(paintChanges(host, 'Ship on Friday.', 'Ship on Monday, after review.', d), { added: 1, removed: 1 });
  assert.equal(host.children[0].textContent, '1 addition, 1 removal');
  assert.deepEqual(seen(host), [['same', 'Ship on '], ['del', 'Friday'], ['ins', 'Monday, after review'], ['same', '.']]);
  // Screen readers hear which is which.
  const removed = host.children.at(-1).children[1];
  assert.equal(removed.className, 'changes-removed');
  assert.deepEqual(removed.children.map(c => [c.className, c.textContent]), [['sr-only', '[removed: '], ['', 'Friday'], ['sr-only', ']']]);
  // Readable, not raw: no patch markers in what is shown.
  assert.doesNotMatch(host.children.at(-1).textContent, /^[+-@]/m);
});

test('long unchanged stretches keep a little context on each side of a change, and a gap for the rest', () => {
  const filler = n => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const before = filler(200) + ' old ending. ' + filler(200), after = filler(200) + ' new ending. ' + filler(200);
  const d = doc(), host = d.createElement('div');
  paintChanges(host, before, after, d);
  const parts = seen(host);
  assert.deepEqual(parts.map(p => p[0]), ['gap', 'same', 'del', 'ins', 'same', 'gap']);
  assert.ok(parts[1][1].length <= CONTEXT && parts[1][1].length > CONTEXT / 2, 'context before: ' + parts[1][1].length);
  assert.ok(parts[4][1].length <= CONTEXT + 1 && parts[4][1].length > CONTEXT / 2, 'context after: ' + parts[4][1].length);
  assert.match(parts[1][1], /^word\d+ /); assert.match(parts[4][1], / word\d+$/);
  // Two changes far apart each keep their own context, with a gap between.
  const twice = paintChanges(host, filler(100) + ' a ' + filler(100) + ' b', filler(100) + ' A ' + filler(100) + ' B', d);
  assert.deepEqual(twice, { added: 2, removed: 2 });
  assert.deepEqual(seen(host).map(p => p[0]), ['gap', 'same', 'del', 'ins', 'same', 'gap', 'same', 'del', 'ins']);
});

test('a page changed in more places than the limit says only that, never how much was rewritten, and the work stays bounded', () => {
  const page = tag => Array.from({ length: 2100 }, (_, i) => `${tag} line ${i}\n`).join('');
  const d = doc(), host = d.createElement('div');
  const started = performance.now();
  const tooMany = /^This page changed in too many places since then to mark them here\. The whole page as it now stands is below\.$/;
  assert.deepEqual(paintChanges(host, page('old'), page('new'), d), { added: null, removed: null });
  assert.match(host.children[0].textContent, tooMany);
  // A few edits in each of many lines: most of the page is as it was, and the words do not say otherwise.
  const lines = Array.from({ length: 12000 }, (_, i) => `Line ${i} stays as it was.\n`);
  const scattered = lines.map((line, i) => i % 9 === 0 ? line.replace('stays', 'moved') : line);
  assert.deepEqual(paintChanges(host, lines.join(''), scattered.join(''), d), { added: null, removed: null });
  assert.match(host.children[0].textContent, tooMany);
  assert.equal(host.children.length, 1, 'nothing struck or marked');
  // A page of one long line with more word edits than the limit is not drawn struck whole and then added whole.
  const words = tag => Array.from({ length: 1500 }, (_, i) => `${tag}${i}`).join(' ');
  assert.equal(changes(words('old'), words('new')), null);
  assert.deepEqual(paintChanges(host, words('old'), words('new'), d), { added: null, removed: null });
  assert.match(host.children[0].textContent, tooMany);
  // One paragraph rewritten past the limit, among lines that stand, still shows removed and added in place.
  const around = 'Kept above.\n' + words('old') + '\nKept below.\n', revised = 'Kept above.\n' + words('new') + '\nKept below.\n';
  assert.deepEqual(changes(around, revised)?.map(run => run[0]), ['same', 'del', 'ins', 'same']);
  // A megabyte page with a scattered handful of changes is worked out in place.
  const big = Array.from({ length: 20000 }, (_, i) => `Line ${i} of the long page, padded with words.\n`);
  const edited = big.map((line, i) => i % 1000 === 0 ? line.replace('padded', 'filled') : line);
  assert.deepEqual(paintChanges(host, big.join(''), edited.join(''), d), { added: 20, removed: 20 });
  assert.ok(performance.now() - started < 5000, 'took ' + (performance.now() - started));
});

test('a revision that changed only its title or attachments says so', () => {
  const d = doc(), host = d.createElement('div');
  assert.deepEqual(paintChanges(host, 'Same words.', 'Same words.', d), { added: 0, removed: 0 });
  assert.match(host.children[0].textContent, /No change in the words/);
});

test('the Reader holds what changed above the page, open, and its colors come from the theme', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const pane = /<section class="reading-pane"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
  assert.ok(pane.indexOf('id="source-changes"') >= 0 && pane.indexOf('id="source-changes"') < pane.indexOf('id="source-body"'), 'above the page');
  assert.match(pane, /<details id="source-changes" class="source-changes" open hidden>/);
  const css = readFileSync(new URL('../web/aim.css', import.meta.url), 'utf8');
  const rules = css.match(/\.(source-changes|changes-[a-z]+)[^{]*\{[^}]*\}/g) ?? [];
  assert.ok(rules.length >= 5);
  for (const rule of rules) {
    assert.doesNotMatch(rule, /#[0-9a-f]{3,8}\b/i, 'theme tokens only, so light and dark both hold: ' + rule);
    assert.doesNotMatch(rule, /border-left/, 'no coloured left edge: ' + rule);
  }
});
