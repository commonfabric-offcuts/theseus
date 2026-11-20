// Retained review source SHA256 f6a9777adc0ea86b0205c6eaaeb2aa33d31336e8449c94b8bc41aa079e78ae8f; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeck } from '../web/deck.mjs';
import { cardDetails, stripDetails } from '../web/card-details.mjs';
import { CardTextProjection, cardTextValue } from '../web/notebook-card-text.mjs';
const ID = n => 'c-' + String(n % 10).repeat(16).padStart(32, String(Math.floor(n / 10) % 10)).slice(0, 32);
const hidden = d => '<!-- theseus-card: ' + JSON.stringify(d) + ' -->';
const PAL = ['blue', 'rose', 'green', null];
let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const pick = a => a[rnd(a.length)];

// Ground truth: each card carries a unique words token; identities follow the words token.
function makePage(n) {
  const cards = [];
  for (let i = 0; i < n; i++) { cards.push({ title: 'T' + i + pick(['', ' long', ' x']), words: 'w' + i + ' ' + pick(['alpha', 'beta', 'gamma']) + pick(['', '\nsecond line', '\n\n- item']), id: rnd(4) ? ID(i + 1) : null }); cards[i].color = cards[i].id ? pick(PAL) : null; }
  return cards;
}
const render = cards => cards.map(c => '## ' + c.title + '\n\n' + (c.words ? c.words + '\n\n' : '') + ((c.id || c.aliases?.length) ? hidden({ id: c.id, aliases: c.aliases ?? [], color: c.color }) + '\n\n' : '')).join('');
const visible = cards => cards.map(c => '## ' + c.title + '\n\n' + (c.words ? c.words + '\n\n' : '')).join('');
const meta = body => parseDeck(body).cards.map(c => ({ title: c.title, words: cardDetails(c.words).words, ...cardDetails(c.words) }));

// Operations on the visible model, each expressed as one textarea edit (range+text), and the expected cards after it.
function op(cards, text) {
  const n = cards.length, kind = pick(['move', 'move', 'rename', 'words', 'delete', 'insert', 'swap', 'move2', 'append']);
  const starts = []; { let at = 0; for (const c of cards) { starts.push(at); at += ('## ' + c.title + '\n\n' + (c.words ? c.words + '\n\n' : '')).length; } starts.push(at); }
  const raw = i => text.slice(starts[i], starts[i + 1]);
  if (kind === 'move' && n > 1) { const i = rnd(n); let j = rnd(n); if (j === i) j = (i + 1) % n; const rest = cards.filter((_, k) => k !== i); const next = [...rest.slice(0, j), cards[i], ...rest.slice(j)]; return { kind, next, edit: { start: 0, end: text.length, insert: next.map(c => raw(cards.indexOf(c))).join('') } }; }
  if (kind === 'move2' && n > 2) { const i = rnd(n - 1); const pair = [cards[i], cards[i + 1]]; const rest = cards.filter((_, k) => k !== i && k !== i + 1); const j = rnd(rest.length + 1); const next = [...rest.slice(0, j), ...pair, ...rest.slice(j)]; return { kind, next, edit: { start: 0, end: text.length, insert: next.map(c => raw(cards.indexOf(c))).join('') } }; }
  if (kind === 'swap' && n > 1) { const i = rnd(n - 1); const next = [...cards]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; return { kind, next, edit: { start: starts[i], end: starts[i + 2], insert: raw(i + 1) + raw(i) } }; }
  if (kind === 'rename' && n) { const i = rnd(n); const to = cards[i].title + pick(['!', ' renamed', '2']); const next = cards.map((c, k) => k === i ? { ...c, title: to } : c); const s = starts[i] + 3; return { kind, next, edit: { start: s, end: s + cards[i].title.length, insert: to } }; }
  if (kind === 'words' && n) { const i = rnd(n); if (!cards[i].words) return null; const to = cards[i].words + pick(['!', ' more', '\nnew line']); const next = cards.map((c, k) => k === i ? { ...c, words: to } : c); const s = starts[i] + ('## ' + cards[i].title + '\n\n').length; return { kind, next, edit: { start: s, end: s + cards[i].words.length, insert: to } }; }
  if (kind === 'delete' && n > 1) { const i = rnd(n); const next = cards.filter((_, k) => k !== i); return { kind, next, edit: { start: starts[i], end: starts[i + 1], insert: '' } }; }
  if (kind === 'insert') { const i = rnd(n + 1); const c = { title: 'New' + rnd(1000), words: 'fresh ' + rnd(1000), id: null, color: null, fresh: true }; const next = [...cards.slice(0, i), c, ...cards.slice(i)]; return { kind, next, edit: { start: starts[i], end: starts[i], insert: '## ' + c.title + '\n\n' + c.words + '\n\n' } }; }
  if (kind === 'append' && n) { const i = rnd(n); const to = cards[i].words ? cards[i].words + pick([' ', '  ', '\t']) : cards[i].words; if (to === cards[i].words) return null; const next = cards.map((c, k) => k === i ? { ...c, words: to } : c); const s = starts[i] + ('## ' + cards[i].title + '\n\n').length + cards[i].words.length; return { kind, next, edit: { start: s, end: s, insert: to.slice(cards[i].words.length) } }; }
  return null;
}

test('R4-F1 identity fuzz: unique words, random moves/renames/edits/deletes/inserts, with confirmed saves in between', () => {
  let runs = 0, steps = 0; const failures = [];
  for (let r = 0; r < 400; r++) {
    let cards = makePage(2 + rnd(5)); const p = new CardTextProjection();
    let body = render(cards), text = p.show(body);
    assert.equal(text, visible(cards));
    for (let s = 0; s < 6; s++) {
      const o = op(cards, text); if (!o) continue;
      const nextText = text.slice(0, o.edit.start) + o.edit.insert + text.slice(o.edit.end);
      const out = p.edit(nextText, { start: o.edit.start, end: o.edit.end, inputType: 'insertText' });
      steps++;
      const got = meta(out);
      const expected = o.next.map(c => ({ title: c.title, id: c.id, color: c.color }));
      const problems = [];
      if (cardTextValue(stripDetails(out)) !== nextText) problems.push('visible mismatch');
      got.forEach((g, i) => { const e = expected[i]; if (!e) return; if (g.title !== e.title) problems.push(`title ${i}`); if (g.id !== e.id && !(e.id === null && g.id === null)) problems.push(`id ${i}: got ${g.id?.slice(2, 4)} want ${e.id?.slice(2, 4)}`); if (g.color !== e.color) problems.push(`color ${i}: got ${g.color} want ${e.color}`); });
      if (got.length !== expected.length) problems.push('count');
      if (problems.length) { failures.push({ r, s, kind: o.kind, problems, before: text, after: nextText, out }); break; }
      cards = o.next; text = nextText; body = out;
      if (rnd(3) === 0) p.confirm(body); // a save confirmed between keystrokes
    }
    runs++;
  }
  console.log('R4-F1 runs', runs, 'steps', steps, 'failures', failures.length);
  for (const f of failures.slice(0, 6)) console.log(JSON.stringify(f, null, 1));
  assert.deepEqual(failures.map(f => f.problems), []);
});

test('R4-F2 sync invariant fuzz: stripDetails(edit(text)) is always the typed text, char by char, with saves', () => {
  let n = 0; const failures = [];
  const bits = [' ', '  ', '\t', '\n', '\n\n', 'x', '## H', '```', '`', '<!-- theseus-card: ', '{"id":null}', ' -->', ' ', '~~~'];
  for (let r = 0; r < 300; r++) {
    const cards = makePage(1 + rnd(4)); const p = new CardTextProjection();
    let body = render(cards); if (rnd(4) === 0) body = body.replaceAll('\n', '\r\n');
    let text = p.show(body);
    for (let s = 0; s < 12; s++) {
      const at = rnd(text.length + 1), del = rnd(3) ? 0 : rnd(Math.min(6, text.length - at + 1)), ins = rnd(4) ? pick(bits) : '';
      const next = text.slice(0, at) + ins + text.slice(at + del);
      if (next === text) continue;
      const out = p.edit(next, { start: at, end: at + del, inputType: 'insertText' }); n++;
      if (cardTextValue(stripDetails(out)) !== next) { failures.push({ body, text, next, out }); break; }
      text = next; body = out;
      if (rnd(4) === 0) p.confirm(body);
    }
  }
  console.log('R4-F2 edits', n, 'failures', failures.length);
  for (const f of failures.slice(0, 4)) console.log(JSON.stringify(f, null, 1));
  assert.equal(failures.length, 0);
});
