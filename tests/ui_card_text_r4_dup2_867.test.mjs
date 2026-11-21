// Retained review source SHA256 d7012396df57bfac0b2f079af66e0a49b5ea74ea43cfc214d30939e2926a4ce2; adaptations: docs/card-text-review-867.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { text867, card, details, hidden, A, B, C, metaOf, parseDeck, stripDetails, CardTextProjection } from './fixtures/card_text_867.mjs';
const ID = n => 'c-' + String(n).repeat(32);
const show = rows => rows.map(r => `${r.title}:${r.id ? r.id.slice(2, 3) : '-'}/${r.color ?? '-'}`).join('  ');
const dupes = rows => { const ids = rows.map(r => r.id).filter(Boolean); return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]; };
function holdSaves(h) { const send = h.api.command; let release, arrive; const arrived = new Promise(r => arrive = r); h.api.command = async e => { arrive(); await new Promise(r => release = r); return send(e); }; return { arrived, release: () => { h.api.command = send; release(); } }; }
// Offsets read from the textarea itself.
const span = (v, i) => { const d = parseDeck(v); let start = d.opening.length; for (let k = 0; k < i; k++) start += d.cards[k].raw.length; return { start, end: start + d.cards[i].raw.length, raw: d.cards[i].raw }; };
const editWords = (h, i, from, to) => { const v = h.p.text.value, s = span(v, i), at = s.start + s.raw.indexOf(from); assert.ok(s.raw.includes(from), 'words present'); return h.input(at, at + from.length, to); };
const addWords = (h, i, words) => { const v = h.p.text.value, s = span(v, i), at = s.start + s.raw.indexOf('\n'); return h.input(at, at, '\n\n' + words); };
const check = (label, rows) => { const d = dupes(rows); console.log(label, show(rows), d.length ? 'DUPLICATE ' + d.map(x => x.slice(2, 3)).join(',') : ''); return d; };

test('MOD0 module replay of fuzz r=0: five twins, edit 4, edit 5, confirm(after edit 4), insert a twin before 5', () => {
  const raw = [1, 2, 3, 4, 5].map(n => card('Same', 'same', details(ID(n), n % 2 ? 'blue' : 'green'))).join('');
  const p = new CardTextProjection(); let text = p.show(raw);
  const edit = (start, end, insert) => { text = text.slice(0, start) + insert + text.slice(end); return p.edit(text, { start, end, inputType: 'insertText' }); };
  const b1 = edit(54, 58, 'same!'); const b2 = edit(70, 74, 'same!'); p.confirm(b1);
  const out = edit(61, 61, '## Same\n\nsame\n\n');
  const d = check('MOD0', metaOf(out)); assert.deepEqual(d, []);
});

test('DUP1 real textarea: five identical twins; edit twin 4, save in flight, edit twin 5, save confirms, paste another twin before twin 5', async t => {
  const raw = [1, 2, 3, 4, 5].map(n => card('Same', 'same', details(ID(n), n % 2 ? 'blue' : 'green'))).join('');
  const h = await text867(t, raw);
  editWords(h, 3, 'same', 'same!');
  const hold = holdSaves(h); const saving = h.w.flush(); await hold.arrived;
  editWords(h, 4, 'same', 'same!');
  hold.release(); await saving;
  console.log('DUP1 base after confirm ', show(metaOf(h.w.base.content.body)));
  const at = span(h.p.text.value, 4).start;
  const rows = h.input(at, at, '## Same\n\nsame\n\n', 'insertFromPaste');
  check('DUP1 after paste        ', rows);
  await h.w.flush(); const saved = metaOf(h.w.base.content.body); const d = check('DUP1 saved              ', saved);
  h.p.sync(); for (const id of d) console.log('DUP1 cardAt duplicate id', id.slice(2, 3), '->', h.p.cardAt({ id }), '(the link to it selects nothing)');
  assert.deepEqual(d, []);
});

test('DUP1b real textarea: three identical twins; edit twin 2, save in flight, edit twin 3, confirm, paste another twin before twin 3', async t => {
  const raw = [1, 2, 3].map(n => card('Same', 'same', details(ID(n), 'rose'))).join('');
  const h = await text867(t, raw);
  editWords(h, 1, 'same', 'same!');
  const hold = holdSaves(h); const saving = h.w.flush(); await hold.arrived;
  editWords(h, 2, 'same', 'same!');
  hold.release(); await saving;
  const at = span(h.p.text.value, 2).start;
  const rows = h.input(at, at, '## Same\n\nsame\n\n', 'insertFromPaste');
  const d = check('DUP1b after paste       ', rows); assert.deepEqual(d, []);
});

test('DUP2 real textarea: three title-only "### Notes" under parents; type into Notes 2, save in flight, type into Notes 3, confirm, add a fourth section', async t => {
  const section = (p, n) => '## ' + p + '\n\n' + p.toLowerCase() + ' words\n\n### Notes\n\n' + hidden(details(ID(n), 'rose')) + '\n\n';
  const h = await text867(t, section('Alpha', 1) + section('Beta', 2) + section('Gamma', 3));
  addWords(h, 3, 'call the vendor');
  const hold = holdSaves(h); const saving = h.w.flush(); await hold.arrived;
  addWords(h, 5, 'ship it');
  hold.release(); await saving;
  console.log('DUP2 base after confirm ', show(metaOf(h.w.base.content.body)));
  const v = h.p.text.value; const rows = h.input(v.length, v.length, '## Delta\n\ndelta words\n\n### Notes\n\n', 'insertFromPaste');
  const d = check('DUP2 after new section  ', rows);
  await h.w.flush(); const saved = metaOf(h.w.base.content.body); check('DUP2 saved              ', saved);
  assert.deepEqual(dupes(saved), []);
});

test('DUP2b same but the two Notes get the SAME words typed (e.g. "TBD")', async t => {
  const section = (p, n) => '## ' + p + '\n\n' + p.toLowerCase() + ' words\n\n### Notes\n\n' + hidden(details(ID(n), 'rose')) + '\n\n';
  const h = await text867(t, section('Alpha', 1) + section('Beta', 2) + section('Gamma', 3));
  addWords(h, 3, 'TBD');
  const hold = holdSaves(h); const saving = h.w.flush(); await hold.arrived;
  addWords(h, 5, 'TBD');
  hold.release(); await saving;
  console.log('DUP2b base after confirm', show(metaOf(h.w.base.content.body)));
  const v = h.p.text.value; const rows = h.input(v.length, v.length, '## Delta\n\ndelta words\n\n### Notes\n\n', 'insertFromPaste');
  const d = check('DUP2b after new section ', rows);
  await h.w.flush(); const saved = metaOf(h.w.base.content.body); const ds = check('DUP2b saved             ', saved);
  h.p.sync(); for (const id of ds) console.log('DUP2b cardAt duplicate id', id.slice(2, 3), '->', h.p.cardAt({ id }));
  assert.deepEqual(ds, []);
});
