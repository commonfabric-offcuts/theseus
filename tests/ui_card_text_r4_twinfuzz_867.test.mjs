// Retained review source SHA256 20bbb2fc20be53110e006c97a99500f4e2d76e53e156d7916bbd49d70bcd364b; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../web/deck.mjs';
import { cardDetails, stripDetails } from '../web/card-details.mjs';
import { CardTextProjection, cardTextValue } from '../web/notebook-card-text.mjs';
const ID = n => 'c-' + String(n % 10).repeat(32);
const hidden = d => '<!-- theseus-card: ' + JSON.stringify(d) + ' -->';
const PAL = ['blue', 'rose', 'green'];
let seed = 4242; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const pick = a => a[rnd(a.length)];
// Pages with exact twins; every card identified so identity is positional ground truth.
function makePage() {
  const n = 2 + rnd(4), cards = [];
  for (let i = 0; i < n; i++) { const twin = rnd(2) === 0; cards.push({ title: twin ? 'Same' : 'T' + i, words: twin ? 'same' : 'w' + i, id: ID(i + 1), color: pick(PAL) }); }
  return cards;
}
const render = cards => cards.map(c => '## ' + c.title + '\n\n' + (c.words ? c.words + '\n\n' : '') + (c.id ? hidden({ id: c.id, aliases: [], color: c.color }) + '\n\n' : '')).join('');
const visible = cards => cards.map(c => '## ' + c.title + '\n\n' + (c.words ? c.words + '\n\n' : '')).join('');
const meta = body => parseDeck(body).cards.map(c => ({ title: c.title, ...cardDetails(c.words) }));
function op(cards, text) {
  const n = cards.length, kind = pick(['rename', 'words', 'words', 'delete', 'insert', 'retype']);
  const starts = []; { let at = 0; for (const c of cards) { starts.push(at); at += ('## ' + c.title + '\n\n' + (c.words ? c.words + '\n\n' : '')).length; } starts.push(at); }
  if (kind === 'rename') { const i = rnd(n); const to = pick(['Same', 'Other', cards[i].title + '!']); if (to === cards[i].title) return null; const next = cards.map((c, k) => k === i ? { ...c, title: to } : c); const s = starts[i] + 3; return { kind, next, edit: { start: s, end: s + cards[i].title.length, insert: to } }; }
  if (kind === 'words') { const i = rnd(n); if (!cards[i].words) return null; const to = pick(['same', 'other', cards[i].words + '!']); if (to === cards[i].words) return null; const next = cards.map((c, k) => k === i ? { ...c, words: to } : c); const s = starts[i] + ('## ' + cards[i].title + '\n\n').length; return { kind, next, edit: { start: s, end: s + cards[i].words.length, insert: to } }; }
  if (kind === 'retype') { const i = rnd(n); if (!cards[i].words) return null; const ch = cards[i].words.at(-1); const to = cards[i].words.slice(0, -1); const next = cards.map((c, k) => k === i ? { ...c, words: to } : c); const s = starts[i] + ('## ' + cards[i].title + '\n\n').length + to.length; return { kind, next, edit: { start: s, end: s + 1, insert: '' }, then: { ch } }; }
  if (kind === 'delete' && n > 1) { const i = rnd(n); const next = cards.filter((_, k) => k !== i); return { kind, next, edit: { start: starts[i], end: starts[i + 1], insert: '' } }; }
  if (kind === 'insert') { const i = rnd(n + 1); const c = { title: pick(['Same', 'New']), words: pick(['same', 'fresh']), id: null, color: null }; const next = [...cards.slice(0, i), c, ...cards.slice(i)]; return { kind, next, edit: { start: starts[i], end: starts[i], insert: '## ' + c.title + '\n\n' + c.words + '\n\n' } }; }
  return null;
}
test('R4-F3 twin fuzz: positional identity through edits, with older bodies confirmed between keystrokes', () => {
  let runs = 0, steps = 0, confirms = 0; const failures = [];
  for (let r = 0; r < 500; r++) {
    let cards = makePage(); const p = new CardTextProjection();
    let body = render(cards), text = p.show(body); const pending = []; const history = [{ start: body }];
    for (let s = 0; s < 8; s++) {
      const o = op(cards, text); if (!o) continue;
      const nextText = text.slice(0, o.edit.start) + o.edit.insert + text.slice(o.edit.end);
      const out = p.edit(nextText, { start: o.edit.start, end: o.edit.end, inputType: 'insertText' }); steps++;
      const got = meta(out), expected = o.next; const problems = [];
      if (cardTextValue(stripDetails(out)) !== nextText) problems.push('visible mismatch');
      if (got.length !== expected.length) problems.push('count');
      got.forEach((g, i) => { const e = expected[i]; if (!e) return; if (g.id !== e.id) problems.push(`id ${i}: got ${g.id?.slice(2, 3) ?? '-'} want ${e.id?.slice(2, 3) ?? '-'}`); if ((g.color ?? null) !== (e.color ?? null)) problems.push(`color ${i}`); });
      const dup = got.map(g => g.id).filter(Boolean); if (new Set(dup).size !== dup.length) problems.push('DUPLICATE ID');
      history.push({ kind: o.kind, edit: o.edit });
      if (problems.length) { failures.push({ r, s, kind: o.kind, problems, before: text, after: nextText, out, pendingSaves: pending.length, baseText: p.base.text, history }); break; }
      cards = o.next; text = nextText; body = out; pending.push(body);
      // A save sent k steps ago is confirmed now: confirm an OLDER body, never a newer one than already confirmed.
      if (rnd(3) === 0 && pending.length) { const k = rnd(pending.length); p.confirm(pending[k]); history.push({ confirm: pending[k] }); pending.splice(0, k + 1); confirms++; }
    }
    runs++;
  }
  console.log('R4-F3 runs', runs, 'steps', steps, 'confirms', confirms, 'failures', failures.length, 'duplicate-id outputs', failures.filter(f => f.problems.includes('DUPLICATE ID')).length, 'by kind', JSON.stringify(Object.fromEntries([...new Set(failures.map(f => f.kind))].map(k => [k, failures.filter(f => f.kind === k).length]))));
  for (const f of failures.slice(0, 4)) console.log(JSON.stringify(f));
  assert.deepEqual(failures.map(f => f.problems), []);
});
