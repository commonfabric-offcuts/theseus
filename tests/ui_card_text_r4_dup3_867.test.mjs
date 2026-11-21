// Retained review source SHA256 2f728c8912613423495c63ce093ccd707b850a004965dd779128052070a3a7e2; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, metaOf, parseDeck, CardTextProjection, cardDetails } from './fixtures/card_text_867.mjs';
const ID = n => 'c-' + String(n).repeat(32);
const show = rows => rows.map(r => `${r.title}:${r.id ? r.id.slice(2, 3) : '-'}/${r.color ?? '-'}`).join('  ');
const dupes = rows => { const ids = rows.map(r => r.id).filter(Boolean); return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]; };
function holdSaves(h) { const send = h.api.command; let release, arrive; const arrived = new Promise(r => arrive = r); h.api.command = async e => { arrive(); await new Promise(r => release = r); return send(e); }; return { arrived, release: () => { h.api.command = send; release(); } }; }
const span = (v, i) => { const d = parseDeck(v); let start = d.opening.length; for (let k = 0; k < i; k++) start += d.cards[k].raw.length; return { start, end: start + d.cards[i].raw.length, raw: d.cards[i].raw }; };
const editWords = (h, i, from, to) => { const v = h.p.text.value, s = span(v, i), at = s.start + s.raw.indexOf(from); return h.input(at, at + from.length, to); };

test('MECH pairs after the confirm, in the three-twin shape', () => {
  const raw = [1, 2, 3].map(n => card('Same', 'same', details(ID(n), 'rose'))).join('');
  const p = new CardTextProjection(); let text = p.show(raw);
  const edit = (start, end, insert) => { text = text.slice(0, start) + insert + text.slice(end); return p.edit(text, { start, end, inputType: 'insertText' }); };
  const s1 = span(text, 1), b1 = edit(s1.start + s1.raw.indexOf('same'), s1.start + s1.raw.indexOf('same') + 4, 'same!');
  const s2 = span(text, 2); edit(s2.start + s2.raw.indexOf('same'), s2.start + s2.raw.indexOf('same') + 4, 'same!');
  console.log('MECH pairs before confirm (text row -> old base row):', JSON.stringify(p.body));
  p.confirm(b1);
  console.log('MECH new base rows by id:', parseDeck(b1).cards.map(c => cardDetails(c.words).id.slice(2, 3)).join(','), '| new base text rows:', parseDeck(p.base.text).cards.map(c => c.words).join(','));
  console.log('MECH pairs after confirm  (text row -> new base row):', JSON.stringify(p.body), '  expected [[0,0],[1,1],[2,2]]');
  const at = span(text, 2).start; const out = edit(at, at, '## Same\n\nsame\n\n');
  console.log('MECH pairs after paste:', JSON.stringify(p.body), '->', show(metaOf(out)));
});

test('PERSIST the duplicate survives a later keystroke elsewhere and its save', async t => {
  const raw = [1, 2, 3].map(n => card('Same', 'same', details(ID(n), 'rose'))).join('');
  const h = await text867(t, raw);
  editWords(h, 1, 'same', 'same!');
  const hold = holdSaves(h); const saving = h.w.flush(); await hold.arrived;
  editWords(h, 2, 'same', 'same!');
  hold.release(); await saving;
  const at = span(h.p.text.value, 2).start; h.input(at, at, '## Same\n\nsame\n\n', 'insertFromPaste');
  await h.w.flush(); console.log('PERSIST saved 1', show(metaOf(h.w.base.content.body)), dupes(metaOf(h.w.base.content.body)).length ? 'DUPLICATE' : '');
  const x = span(h.p.text.value, 0); h.input(x.start + x.raw.indexOf('same') + 4, x.start + x.raw.indexOf('same') + 4, ' more');
  await h.w.flush(); const saved = metaOf(h.w.base.content.body);
  console.log('PERSIST saved 2', show(saved), dupes(saved).length ? 'DUPLICATE' : '');
  h.p.sync(); for (const id of dupes(saved)) console.log('PERSIST pickCardId(dup) ->', h.p.pickCardId(id), '| notice:', h.p.notice);
  assert.deepEqual(dupes(saved), []);
});
